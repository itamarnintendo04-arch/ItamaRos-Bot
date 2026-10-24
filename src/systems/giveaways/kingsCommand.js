"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { createGiveaway } = require("./create");
const { GIVEAWAY_SETTINGS } = require("./config");
const {
    notifyGiveawayManagers,
    createManagerButtons
} = require("./adminNotifications");

const data = new SlashCommandBuilder()
    .setName("kings-giveaway")
    .setDescription("Start a premium giveaway for any Kings rank")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName("prize")
        .setDescription("Royal giveaway prize")
        .setMinLength(1).setMaxLength(200).setRequired(true))
    .addStringOption(o => o.setName("duration")
        .setDescription("Examples: 30m, 2h, 1d, 1w")
        .setMinLength(2).setMaxLength(12).setRequired(true))
    .addIntegerOption(o => o.setName("winners")
        .setDescription("How many Kings win?")
        .setMinValue(1)
        .setMaxValue(GIVEAWAY_SETTINGS.MAX_WINNERS)
        .setRequired(true))
    .addAttachmentOption(o => o.setName("image")
        .setDescription("Optional royal giveaway image")
        .setRequired(false));

function parseDuration(input) {
    const m = String(input || "").trim().match(/^(\d+)\s*([mhdw])$/i);
    if (!m) return null;
    const amount = Number(m[1]);
    const multipliers = { m: 1, h: 60, d: 1440, w: 10080 };
    const minutes = amount * multipliers[m[2].toLowerCase()];
    if (!Number.isSafeInteger(minutes) ||
        minutes < GIVEAWAY_SETTINGS.MIN_DURATION_MINUTES ||
        minutes > GIVEAWAY_SETTINGS.MAX_DURATION_MINUTES) {
        return null;
    }
    return minutes;
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
        return interaction.reply({
            content: "❌ Manage Server permission required.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const duration = parseDuration(
            interaction.options.getString("duration", true)
        );
        if (!duration) {
            throw new Error("Invalid duration. Try 30m, 2h, 1d or 1w.");
        }

        const image = interaction.options.getAttachment("image");
        if (image && !image.contentType?.startsWith("image/")) {
            throw new Error("Please attach a valid image.");
        }

        const prize = interaction.options.getString("prize", true);
        const winners = interaction.options.getInteger("winners", true);

        const result = await createGiveaway({
            guild: interaction.guild,
            channel: interaction.channel,
            host: interaction.user,
            prize, duration, winners, image,
            kingsOnly: true,
            minLevel: 0
        });

        if (!result?.success) {
            throw new Error(result?.message ||
                "Could not create the Kings giveaway.");
        }

        await interaction.editReply({
            content: [
                "👑 **Royal Kings Giveaway Created!**",
                "",
                "🎁 **Prize:** " + prize,
                "🏆 **Winners:** " + winners,
                "👑 **Eligibility:** Any Kings rank (no level minimum)",
                "🎫 **Winner tickets:** Automatically opened at the end",
                "",
                "🆔 **Giveaway ID:** " + result.giveawayId,
                "🔗 " + result.url,
                "",
                "Use /giveaway end or /giveaway cancel with this ID."
            ].join("\n"),
            components: createManagerButtons({
                ...result,
                _id: result.giveawayId
            }),
            allowedMentions: { parse: [] }
        });

        await notifyGiveawayManagers(
            interaction, result.giveawayId
        ).catch(error => {
            console.warn(
                "[Kings Giveaway] Staff alert failed:",
                error.message
            );
        });
    } catch (error) {
        console.error("[Kings Giveaway] Creation failed:", error);
        await interaction.editReply({
            content: "❌ " + String(error.message).slice(0, 220),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute, parseDuration };
