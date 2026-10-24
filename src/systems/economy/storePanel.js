"use strict";

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");
const { getDatabase } = require("../../../database");
const economy = require("./service");

const STORE_CHANNEL_ID = "1550947251927523358";
const PANEL_COLLECTION = "store_panels";
const PAGE_SIZE = 25;
const MAX_ITEMS = 100;
const pending = new Map();

function storePanels() {
    return getDatabase().collection(PANEL_COLLECTION);
}

function clean(value, limit = 65) {
    return String(value || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[@*_~|<>]/g, "")
        .trim().slice(0, limit);
}

function num(value) {
    return Number(value || 0).toLocaleString("en-US");
}

async function getCatalog(guildId) {
    return economy.listItems(guildId);
}

function storeEmbed(items, symbol) {
    const featured = items.slice(0, 8);
    const summary = featured.map(item => {
        const label = clean(item.name);
        const soldOut = item.stock === 0;
        return (item.hasImage ? "🖼️ " : "📦 ") +
            "**" + label + "**  •  " +
            num(item.price) + " " + clean(symbol, 12) +
            (soldOut ? "  •  SOLD OUT" : "");
    });

    return new EmbedBuilder()
        .setColor(0x7C4DFF)
        .setTitle("🛍️ ItamaRos | Item Store")
        .setDescription([
            "**Welcome to the official ItamaRos shop!**",
            "Buy digital items, collect rewards and manage your inventory.",
            "",
            "**FEATURED PRODUCTS**",
            featured.length
                ? summary.join("\n\n")
                : "🌟 New products will appear here soon!",
            items.length > featured.length
                ? "\n+" + (items.length - featured.length) +
                    " more items in the menu below."
                : "",
            "",
            "**STORE COMMANDS — AVAILABLE TO EVERYONE**",
            "🛒 \`/shop\` — open the public shop with Buy buttons.",
            "🛍️ \`/store buy\` — purchase even if buttons are unavailable.",
            "📦 \`/store info\` — details and optional product image.",
            "🎒 \`/store inventory\` — owned items.",
            "✨ \`/store use\` — use an owned item.",
            "💰 \`/store bank\` — view bank savings.",
            "🏆 \`/store leaderboard\` — top coin holders.",
            "⭐ \`/xp-leaderboard\` — top XP earners.",
            "🧾 \`/store list\` — all available items.",
            "",
            "💜 All purchases use virtual server coins."
        ].join("\n").slice(0, 3800))
        .setFooter({
            text: "ItamaRos Bot • Command guide • Public shop uses /shop"
        })
        .setTimestamp();
}

function storeComponents(items, requestedPage = 0) {
    const count = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(
        Math.trunc(Number(requestedPage) || 0),
        count - 1
    ));
    const rows = [];

    const subset = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (subset.length) {
        const selector = new StringSelectMenuBuilder()
            .setCustomId("is:pick:" + page)
            .setPlaceholder("🛍️ Choose a product to view")
            .setMinValues(1)
            .setMaxValues(1);

        for (const item of subset) {
            selector.addOptions({
                label: clean(item.name, 95) || "Product",
                description: clean(
                    num(item.price) + " coins • " +
                    (item.stock === 0 ? "Sold out" : item.category),
                    100
                ),
                value: item.key
            });
        }

        rows.push(new ActionRowBuilder().addComponents(selector));
    }

    const nav = new ActionRowBuilder();
    nav.addComponents(
        new ButtonBuilder()
            .setCustomId("is:page:" + (page - 1))
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId("is:page:" + (page + 1))
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page + 1 >= count),
        new ButtonBuilder()
            .setCustomId("is:inventory")
            .setLabel("My inventory")
            .setEmoji("🎒")
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId("is:wallet")
            .setLabel("My wallet")
            .setEmoji("🪙")
            .setStyle(ButtonStyle.Secondary)
    );
    rows.push(nav);
    return rows;
}

async function makeShopPayload(guildId, page = 0) {
    const [items, settings] = await Promise.all([
        getCatalog(guildId), economy.getSettings(guildId)
    ]);
    return {
        embeds: [storeEmbed(items, settings.currency)],
        components: [],
        allowedMentions: { parse: [] }
    };
}

async function updateStorePanel(guild) {
    if (!guild || guild.id !== process.env.GUILD_ID) return false;

    // The user selected the existing channel: never create channels.
    const channel = await guild.channels.fetch(STORE_CHANNEL_ID)
        .catch(() => null);

    if (!channel || channel.guildId !== guild.id ||
        typeof channel.send !== "function" ||
        !channel.isTextBased?.()) {
        console.warn(
            "[Item Store] Existing #item-store is unavailable. " +
            "No new channel will be created."
        );
        return false;
    }

    const bot = await guild.members.fetchMe();
    const permissions = channel.permissionsFor(bot);
    if (![PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks]
        .every(flag => permissions?.has(flag))) {
        console.warn(
            "[Item Store] Missing permissions for original #item-store."
        );
        return false;
    }

    const saved = await storePanels().findOne({ _id: guild.id });
    const payload = await makeShopPayload(guild.id);

    if (saved?.channelId === channel.id && saved.messageId) {
        const previous = await channel.messages
            .fetch(saved.messageId)
            .catch(() => null);

        if (previous?.author?.id === bot.id) {
            await previous.edit(payload);
            console.log(
                "[Item Store] Refreshed command-only shop panel in " +
                channel.name
            );
            return true;
        }
    }

    const message = await channel.send(payload);
    await storePanels().updateOne({ _id: guild.id }, {
        $set: {
            guildId: guild.id,
            channelId: channel.id,
            messageId: message.id,
            updatedAt: new Date()
        }
    }, { upsert: true });

    console.log(
        "[Item Store] Posted command-only shop panel to #" +
        channel.name + " (" + channel.id + ")."
    );
    return true;
}

function refreshStorePanel(guild) {
    const key = guild?.id;
    if (!key) return Promise.resolve(false);
    const prior = pending.get(key) || Promise.resolve();
    const next = prior.catch(() => {})
        .then(() => updateStorePanel(guild));
    pending.set(key, next);
    void next.finally(() => {
        if (pending.get(key) === next) pending.delete(key);
    }).catch(() => {});
    return next;
}

module.exports = {
    STORE_CHANNEL_ID, PAGE_SIZE, clean,
    storeEmbed, storeComponents, makeShopPayload, refreshStorePanel
};
