"use strict";

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../../../database");
const economy = require("./service");

// Always use the user's existing original item-store channel.
const STORE_CHANNEL_ID = "1550947251927523358";
const PANEL_COLLECTION = "store_panels";
const pending = new Map();

function storePanels() {
    return getDatabase().collection(PANEL_COLLECTION);
}

function safeText(value, limit) {
    return String(value || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[@*_~|<>\\]/g, "")
        .trim()
        .slice(0, limit);
}

async function makeShopEmbed(guildId) {
    const [items, settings] = await Promise.all([
        economy.listItems(guildId),
        economy.getSettings(guildId)
    ]);

    const currency = safeText(settings.currency, 12) || "🪙";
    const entries = items.slice(0, 15).map((item, index) => {
        const name = safeText(item.name, 60) || item.key;
        const stock = item.stock === null
            ? "Unlimited stock"
            : String(item.stock) + " in stock";
        const cost = Number(item.price).toLocaleString("en-US");
        return "**" + (index + 1) + ". " + name + "** — " +
            cost + " " + currency + "\n" +
            "/store buy • " + safeText(item.key, 45) +
            " • " + stock;
    });

    return new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle("🛒 ItamaRos Item Store")
        .setDescription([
            "**Welcome to the official ItamaRos virtual item shop!**",
            "",
            "### 📦 Shop inventory",
            items.length
                ? entries.join("\n\n")
                : "No items for sale yet. Staff can use /store-admin create.",
            items.length > 15
                ? "\nShowing 15 items. /store list displays the full catalog."
                : "",
            "",
            "### 🛍️ Store commands",
            "• /store list — browse all items",
            "• /store buy — purchase an item",
            "• /store sell — sell an owned item",
            "• /store inventory — see your items",
            "• /store info — item information",
            "• /store use — use an item or redeem a role",
            "",
            "### 🪙 Earn more coins",
            "/economy daily • /economy work • /economy quiz • /economy solve",
            "",
            "**Staff:** use /store-admin to manage items and balances."
        ].join("\n").slice(0, 4000))
        .setFooter({ text: "ItamaRos Bot • Shop updates automatically" })
        .setTimestamp();
}

async function updateStorePanel(guild) {
    if (!guild || guild.id !== process.env.GUILD_ID) return false;

    const channel = await guild.channels.fetch(STORE_CHANNEL_ID)
        .catch(() => null);

    if (!channel || channel.guildId !== guild.id ||
        typeof channel.send !== "function" ||
        !channel.isTextBased?.()) {
        console.warn(
            "[Item Store] Original #item-store unavailable; " +
            "no other channel will be used."
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
            "[Item Store] Bot needs View Channel, Send Messages, " +
            "and Embed Links in #item-store."
        );
        return false;
    }

    const saved = await storePanels().findOne({ _id: guild.id });
    const embed = await makeShopEmbed(guild.id);

    if (saved?.channelId === channel.id && saved.messageId) {
        const previous = await channel.messages
            .fetch(saved.messageId)
            .catch(() => null);
        if (previous?.author?.id === bot.id) {
            await previous.edit({
                embeds: [embed],
                allowedMentions: { parse: [] }
            });
            console.log(
                "[Item Store] Refreshed existing shop panel in " +
                channel.name
            );
            return true;
        }
    }

    const message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] }
    });

    await storePanels().updateOne(
        { _id: guild.id },
        { $set: {
            guildId: guild.id,
            channelId: channel.id,
            messageId: message.id,
            updatedAt: new Date()
        } },
        { upsert: true }
    );

    console.log(
        "[Item Store] Posted shop panel to existing #" +
        channel.name + " (" + channel.id + ")."
    );
    return true;
}

function refreshStorePanel(guild) {
    const key = guild?.id;
    if (!key) return Promise.resolve(false);

    const before = pending.get(key) || Promise.resolve();
    const next = before.catch(() => {})
        .then(() => updateStorePanel(guild));

    pending.set(key, next);
    void next.finally(() => {
        if (pending.get(key) === next) pending.delete(key);
    }).catch(() => {});
    return next;
}

module.exports = {
    STORE_CHANNEL_ID,
    makeShopEmbed,
    refreshStorePanel
};
