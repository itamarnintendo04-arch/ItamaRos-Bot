"use strict";

// Private giveaway management messages.
// Discord doesn't provide bots with a native clipboard-copy button;
// this button returns the ID in a private, selectable message.

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    PermissionFlagsBits
} = require("discord.js");
const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const COPY_PREFIX = "ga:copy";

function isValidObjectId(id) {
    return typeof id === "string" &&
        /^[0-9a-f]{24}$/i.test(id);
}

function validDiscordId(id) {
    return typeof id === "string" &&
        /^\d{17,20}$/.test(id);
}

function giveawayUrl(giveaway) {
    if (
        !validDiscordId(giveaway.guildId) ||
        !validDiscordId(giveaway.channelId) ||
        !validDiscordId(giveaway.messageId)
    ) {
        return null;
    }
    return `https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId}`;
}

function safe(value, max = 200) {
    return String(value ?? "Unknown")
        .replace(/@/g, "@\u200b")
        .slice(0, max);
}

function createManagerButtons(giveaway) {
    const giveawayId = giveaway._id?.toString?.() ||
        String(giveaway.giveawayId || "");

    const guildId = giveaway.guildId;
    if (!validDiscordId(guildId) || !isValidObjectId(giveawayId)) {
        return [];
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${COPY_PREFIX}:${guildId}:${giveawayId}`)
            .setLabel("Copy Giveaway ID")
            .setEmoji("📋")
            .setStyle(ButtonStyle.Secondary)
    );

    const url = giveawayUrl(giveaway);
    if (url) {
        row.addComponents(
            new ButtonBuilder()
                .setLabel("View Giveaway")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Link)
                .setURL(url)
        );
    }

    return [row];
}

function createManagerMessage(giveaway, { title } = {}) {
    const id = giveaway._id?.toString?.() ||
        String(giveaway.giveawayId || "");

    const participantCount = Array.isArray(giveaway.participants)
        ? giveaway.participants.length
        : 0;

    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle(title || "🎉 Giveaway Management")
        .setDescription([
            `**🎁 Prize:** ${safe(giveaway.prize)}`,
            `**👑 Host:** <@${giveaway.hostId}>`,
            `**🏆 Winners:** ${giveaway.winnerCount ?? "Unknown"}`,
            `**⭐ Minimum level:** ${(giveaway.minLevel ?? 0) > 0 ? `Level ${giveaway.minLevel}+` : "Everyone"}`,
            `**👥 Participants:** ${participantCount}`,
            `**📋 Status:** ${safe(giveaway.status || "active", 30)}`,
            "",
            `**🆔 Giveaway ID:** \`${id}\``,
            "",
            "Use **Copy Giveaway ID** below to open a private, selectable ID."
        ].join("\n"))
        .setFooter({
            text: "ItamaRos Bot • Management only"
        })
        .setTimestamp();

    const endMs = new Date(giveaway.endsAt).getTime();
    if (Number.isFinite(endMs)) {
        embed.addFields({
            name: "⏳ Ends",
            value: `<t:${Math.floor(endMs / 1000)}:F> (<t:${Math.floor(endMs / 1000)}:R>)`
        });
    }

    return {
        embeds: [embed],
        components: createManagerButtons(giveaway),
        allowedMentions: { parse: [] }
    };
}

async function notifyGiveawayManagers(interaction, giveawayId) {
    if (!isValidObjectId(giveawayId) || !interaction.inGuild()) {
        return;
    }

    const giveaway = await getDatabase()
        .collection(GIVEAWAY_SETTINGS.COLLECTION)
        .findOne({
            _id: new ObjectId(giveawayId),
            guildId: interaction.guildId
        });

    if (!giveaway) {
        console.warn("[Giveaway Admin] Newly created giveaway not found.");
        return;
    }

    const payload = createManagerMessage(giveaway, {
        title: "🎉 New Giveaway Created"
    });

    // Giveaways IDs belong in the private moderation log only.
    // Don't DM creator/owner, and never publish IDs in public channels.
    const staffChannelId = process.env.MOD_LOG_CHANNEL_ID ||
        process.env.GIVEAWAY_ADMIN_CHANNEL_ID;

    if (!staffChannelId) {
        console.warn(
            "[Giveaway Admin] Configure MOD_LOG_CHANNEL_ID in Render to receive private IDs."
        );
        return;
    }

    const channel = await interaction.guild.channels
        .fetch(staffChannelId)
        .catch(() => null);

    if (
        !channel ||
        !channel.isTextBased() ||
        typeof channel.send !== "function"
    ) {
        console.warn("[Giveaway Admin] Staff channel not found.");
        return;
    }

    const everyoneCanView = channel.permissionsFor(
        interaction.guild.roles.everyone
    )?.has(PermissionFlagsBits.ViewChannel);

    if (everyoneCanView !== false) {
        console.warn(
            "[Giveaway Admin] Staff channel is not private; management message skipped."
        );
        return;
    }

    try {
        await channel.send(payload);
        console.log(
            `[Giveaway Admin] Posted management message in ${channel.id}.`
        );
    } catch (error) {
        console.error(
            "[Giveaway Admin] Failed to notify staff channel:",
            error.message
        );
    }
}

async function handleCopyGiveawayId(interaction) {
    if (
        !interaction.isButton() ||
        !interaction.customId?.startsWith(`${COPY_PREFIX}:`)
    ) {
        return false;
    }

    const parts = interaction.customId.split(":");
    const guildId = parts[2];
    const giveawayId = parts[3];

    const respond = async (content) => interaction.reply({
        content,
        ...(interaction.inGuild()
            ? { flags: MessageFlags.Ephemeral }
            : {}),
        allowedMentions: { parse: [] }
    });

    if (
        parts.length !== 4 ||
        !validDiscordId(guildId) ||
        !isValidObjectId(giveawayId)
    ) {
        await respond("❌ Invalid giveaway ID button.");
        return true;
    }

    const guild = await interaction.client.guilds
        .fetch(guildId)
        .catch(() => null);

    if (!guild) {
        await respond("❌ The server is not available.");
        return true;
    }

    // Important: never expose management IDs without
    // re-checking permission at button-click time.
    const member = await guild.members
        .fetch(interaction.user.id)
        .catch(() => null);

    if (
        guild.ownerId !== interaction.user.id &&
        !member?.permissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
        await respond(
            "❌ You need Manage Server permission to view this giveaway ID."
        );
        return true;
    }

    const giveaway = await getDatabase()
        .collection(GIVEAWAY_SETTINGS.COLLECTION)
        .findOne({
            _id: new ObjectId(giveawayId),
            guildId
        });

    if (!giveaway) {
        await respond("❌ Giveaway not found in this server.");
        return true;
    }

    await respond([
        "📋 **Giveaway ID — ready to copy:**",
        "",
        `\`${giveawayId}\``,
        "",
        "Select the ID or press and hold it to copy it.",
        "Discord bot buttons cannot copy directly to your clipboard."
    ].join("\n"));

    return true;
}

module.exports = {
    createManagerMessage,
    createManagerButtons,
    notifyGiveawayManagers,
    handleCopyGiveawayId
};
