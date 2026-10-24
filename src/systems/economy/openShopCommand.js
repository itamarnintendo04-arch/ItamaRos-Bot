"use strict";

const {
    SlashCommandBuilder, MessageFlags,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");
const economy = require("./service");
const { rewardSummary } = require("./rewardPurchase");
const { STORE_CHANNEL_ID, clean } = require("./storePanel");
const { getAccess, visibleItems } = require("./kingsAccess");

const data = new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Open the public ItamaRos shop in item-store")
    .setDMPermission(false);

const MAX_VISIBLE = 20;
const userCooldowns = new Map();
const COOLDOWN_MS = 60 * 1000;

function format(value) {
    return Number(value || 0).toLocaleString("en-US");
}

async function makePublicShop(guildId) {
    const [items, cfg] = await Promise.all([
        economy.listItems(guildId),
        economy.getSettings(guildId)
    ]);
    const publicItems = items.filter(item => item.kingsOnly !== true);
    const featured = publicItems.slice(0, MAX_VISIBLE);
    const currency = clean(cfg.currency, 12) || "🪙";

    const lines = featured.map((item, index) =>
        "**" + (index + 1) + ". " + clean(item.name, 65) +
        "** — " + format(item.price) + " " + currency +
        (item.stock === 0
            ? " • SOLD OUT"
            : item.stock === null
                ? " • Unlimited"
                : " • " + item.stock + " left") +
        (item.type === "reward" ?
            "\n🎁 Instant: " + rewardSummary(item) : "") +
        "\nID: " + item.key
    );

    const embed = new EmbedBuilder()
        .setColor(0x8250E5)
        .setTitle("🛒 ItamaRos Public Shop")
        .setDescription([
            "**Choose a product and press its Buy button below!**",
            "",
            lines.length ? lines.join("\n\n")
                : "No products available at the moment.",
            "",
            publicItems.length > MAX_VISIBLE
                ? "More products are available with /store list."
                : "",
            "🛟 Buttons not working? /store buy always works as backup.",
            "💜 Instant reward items grant XP, coins and roles as soon as you pay.",
            "📦 /store info shows details and optional product pictures.",
            "🎒 /store inventory • ✨ /store use • 💰 /store bank"
        ].join("\n").slice(0, 3950))
        .setFooter({
            text: "Item Store • Virtual coins only • Public message"
        })
        .setTimestamp();

    const buyable = featured.filter(x =>
        x.stock === null || x.stock > 0
    );

    const rows = [];
    for (let i = 0; i < buyable.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(
            ...buyable.slice(i, i + 5).map(item =>
                new ButtonBuilder()
                    .setCustomId("is:buy:" + item.key)
                    .setLabel("Buy " + clean(item.name, 55))
                    .setStyle(ButtonStyle.Success)
            )
        ));
    }

    return {
        embeds: [embed],
        components: rows,
        allowedMentions: { parse: [] }
    };
}

async function makePrivateKingsShop(guild, userId) {
    const access = await getAccess(guild, userId);
    if (!access.king && !access.staff) return null;
    const items = visibleItems(
        await economy.listItems(guild.id), access
    ).filter(item => item.kingsOnly === true);
    if (!items.length) return null;

    const featured = items.slice(0, MAX_VISIBLE);
    const symbol = clean((await economy.getSettings(guild.id)).currency, 12);
    const embed = new EmbedBuilder()
        .setColor(0xD6B46D)
        .setTitle("👑 Kings Exclusive Shop")
        .setDescription([
            "**Only you can see this Kings catalog.**",
            "Eligible items for your current Kings rank:",
            "",
            ...featured.map(item => "👑 **" + clean(item.name, 60) + "** • " +
                format(item.price) + " " + symbol +
                "\\nLevel " + (item.minKingsLevel || 0) + "+ • ID: " + item.key),
            items.length > MAX_VISIBLE
                ? "\\nUse /store list to view more Kings products."
                : ""
        ].join("\\n").slice(0, 3850));

    const buyable = featured.filter(item => item.stock === null || item.stock > 0);
    const rows = [];
    for (let i = 0; i < buyable.length && rows.length < 4; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(
            ...buyable.slice(i, i + 5).map(item => new ButtonBuilder()
                .setCustomId("is:buy:" + item.key)
                .setLabel("Buy " + clean(item.name, 55))
                .setStyle(ButtonStyle.Success))
        ));
    }
    return { embeds: [embed], components: rows };
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID) {
        return interaction.reply({
            content: "❌ Use this command in the ItamaRos server.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    try {
        const channel = await interaction.guild.channels.fetch(
            STORE_CHANNEL_ID
        ).catch(() => null);
        if (!channel || !channel.isTextBased?.() ||
            typeof channel.send !== "function") {
            throw new Error("The original item-store channel is missing.");
        }

        const me = await interaction.guild.members.fetchMe();
        const perms = channel.permissionsFor(me);
        if (![PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks].every(p => perms?.has(p))) {
            throw new Error("Bot needs permission to publish in item-store.");
        }

        const timestamp = Date.now();
        const cooldownKey = interaction.guildId + ":" +
            interaction.user.id;
        const last = userCooldowns.get(cooldownKey) || 0;

        if (timestamp - last < COOLDOWN_MS) {
            throw new Error(
                "Shop was opened recently. Try again in " +
                Math.ceil((COOLDOWN_MS - (timestamp - last)) / 1000) +
                " seconds."
            );
        }

        // Prevent users from spamming multiple public shop messages.
        userCooldowns.set(cooldownKey, timestamp);
        let message;
        try {
            message = await channel.send(
                await makePublicShop(interaction.guildId)
            );
        } catch (error) {
            userCooldowns.delete(cooldownKey);
            throw error;
        }

        const kingsShop = await makePrivateKingsShop(interaction.guild, interaction.user.id)
            .catch(error => {
                console.warn("[Shop] Kings catalog unavailable:", error);
                return null;
            });
        await interaction.editReply({
            ...(kingsShop || {}),
            content: "✅ The shop is open for everyone in <#" +
                STORE_CHANNEL_ID + ">!\n" +
                "🔗 " + message.url,
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[Shop] Could not open public shop:", error);
        await interaction.editReply({
            content: "❌ " +
                String(error.message || "Shop unavailable.").slice(0, 220),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute, makePublicShop, makePrivateKingsShop };
