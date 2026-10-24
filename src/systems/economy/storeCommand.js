"use strict";

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const eco = require("./service");
const { notifyItemUsed } = require("./useNotifications");
const { buyProduct, rewardSummary } = require("./rewardPurchase");
const { productDetails } = require("./storeInteraction");
const { clean } = require("./storePanel");
const { getAccess, visibleItems, assertCanAccess } = require("./kingsAccess");

const data = new SlashCommandBuilder()
    .setName("store")
    .setDescription("Shop using commands (always works without buttons)")
    .setDMPermission(false);

data.addSubcommand(s =>
    s.setName("list").setDescription("Browse all current shop items")
);

data.addSubcommand(s =>
    s.setName("inventory").setDescription("See purchased items")
        .addUserOption(o => o.setName("member")
            .setDescription("Member (default: you)")
            .setRequired(false))
);

data.addSubcommand(s =>
    s.setName("info").setDescription("Get item details and optional image")
        .addStringOption(o => o.setName("item")
            .setDescription("Product ID or item name")
            .setRequired(true))
);

for (const action of ["buy", "sell"]) {
    data.addSubcommand(s =>
        s.setName(action)
            .setDescription(action + " items without using shop buttons")
            .addStringOption(o => o.setName("item")
                .setDescription("Product ID").setRequired(true))
            .addIntegerOption(o => o.setName("quantity")
                .setDescription("Quantity (default: 1)")
                .setMinValue(1).setMaxValue(50).setRequired(false))
    );
}

data.addSubcommand(s =>
    s.setName("use").setDescription("Use a purchased item; notify staff")
        .addStringOption(o => o.setName("item")
            .setDescription("Item ID").setRequired(true))
);

data.addSubcommand(s =>
    s.setName("bank").setDescription("Check virtual coins in your bank")
        .addUserOption(o => o.setName("member")
            .setDescription("Member (default: you)")
            .setRequired(false))
);

data.addSubcommand(s =>
    s.setName("leaderboard")
        .setDescription("See the top virtual coin balances")
);

function fmt(value, symbol) {
    return Number(value || 0).toLocaleString("en-US") +
        " " + clean(symbol, 12);
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID) {
        return interaction.reply({
            content: "❌ This command is server-only.",
            flags: MessageFlags.Ephemeral
        });
    }

    const action = interaction.options.getSubcommand();
    await interaction.deferReply({
        flags: action === "leaderboard"
            ? 0 : MessageFlags.Ephemeral
    });

    try {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const currency = (await eco.getSettings(guildId)).currency;
        const key = interaction.options.getString("item");
        const quantity = interaction.options.getInteger("quantity") || 1;

        let response = "";

        if (action === "list") {
            const items = visibleItems(
                await eco.listItems(guildId),
                await getAccess(interaction.guild, userId)
            );
            response = "🛍️ **Available Products**\n\n" +
                (items.length ? items.map(item =>
                    "📦 **" + clean(item.name, 70) + "** • " +
                    fmt(item.price, currency) +
                    (item.type === "reward"
                        ? "\n🎁 Instant: " + rewardSummary(item) : "") +
                    "\nID: " + item.key +
                    " • " + (item.stock === null
                        ? "Unlimited stock"
                        : item.stock + " left")
                ).join("\n\n") : "There are no products for sale.");
        } else if (action === "info") {
            const item = await eco.getItem(guildId, key);
            if (!item || !item.enabled) throw new Error("Product not found.");
            await assertCanAccess(interaction.guild, userId, item);
            const payload = await productDetails(guildId, item);
            // The deferred reply is already ephemeral.
            delete payload.flags;
            await interaction.editReply(payload);
            return;
        } else if (action === "inventory") {
            const member = interaction.options.getUser("member") ||
                interaction.user;
            if (member.bot) throw new Error("Bots do not have inventories.");
            const items = await eco.getInventory(guildId, member.id);
            response = "🎒 **Inventory — <@" + member.id + ">**\n\n" +
                (items.length ? items.map(item =>
                    "• " + clean(item.itemName) +
                    " ×" + item.quantity + "\nID: " + item.itemKey
                ).join("\n") : "No items purchased yet.");
        } else if (action === "buy") {
            if (interaction.user.bot) throw new Error("Bots cannot buy items.");
            const result = await buyProduct(
                interaction.guild, interaction.user, key, quantity,
                interaction.id
            );
            response = "✅ Bought **" + result.quantity +
                " × " + clean(result.item.name) +
                "** for **" + fmt(result.cost, currency) +
                "**.\n" + (result.instant
                    ? "🎁 Delivered instantly: " + rewardSummary(result.item)
                    : "Your purchase is saved in your inventory.");
            if (result.instant) {
                if (result.item.externalRewards?.length) {
                    try {
                        const { ensureShopTicket } = require("./shopTickets");
                        const ticket = await ensureShopTicket(
                            interaction.guild, interaction.user,
                            result.item, interaction.id
                        );
                        response += "\\n🎫 Private delivery ticket: <#" + ticket.id + ">";
                    } catch (error) {
                        console.error("[Shop] Paid order ticket failed:", error);
                        response += "\\n⚠️ Purchase succeeded, but delivery ticket could not be opened. Contact staff.";
                    }
                }
                await notifyItemUsed({
                    guild: interaction.guild,
                    user: interaction.user,
                    item: result.item,
                    action: "Instant rewards delivered"
                });
            }
        } else if (action === "sell") {
            const item = await eco.getItem(guildId, key);
            if (item?.type === "reward") {
                throw new Error("Instant rewards cannot be sold back.");
            }
            const result = await eco.sell(
                guildId, userId, key, quantity
            );
            response = "✅ Sold **" + result.quantity +
                " × " + clean(result.item.name) +
                "** for **" + fmt(result.reward, currency) + "**.";
        } else if (action === "use") {
            const item = await eco.getItem(guildId, key);
            if (!item) throw new Error("Product not found.");

            if (item.type === "reward") {
                throw new Error("Instant rewards are delivered at purchase; no /store use needed.");
            }
            if (item.type === "role") {
                const member = await interaction.guild.members.fetch(userId);
                await eco.redeemRole(guildId, userId, key, member);
            } else {
                await eco.useItem(guildId, userId, key);
            }

            response = "✨ Used **" + clean(item.name) +
                "**. The server management team has been notified.";
            await notifyItemUsed({
                guild: interaction.guild,
                user: interaction.user,
                item,
                action: item.type === "role" ? "Redeemed role" : "Used item"
            });
        } else if (action === "bank") {
            const target = interaction.options.getUser("member") ||
                interaction.user;
            if (target.bot) throw new Error("Bots cannot own coins.");
            const account = await eco.getAccount(guildId, target.id);
            response = "🏦 **Bank of <@" + target.id + ">**\n\n" +
                "**Bank:** " + fmt(account.bank, currency) +
                "\n**Wallet:** " + fmt(account.cash, currency) +
                "\n**Total:** " +
                fmt(account.cash + account.bank, currency);
        } else if (action === "leaderboard") {
            const top = await eco.top(guildId);
            response = "🏆 **ItamaRos Coin Leaderboard**\n\n" +
                (top.length ? top.map((entry, index) =>
                    (index + 1) + ". <@" + entry.userId + "> — " +
                    fmt(entry.total, currency)
                ).join("\n") : "No coin balances yet.");
        } else {
            throw new Error("Unknown shop action.");
        }

        await interaction.editReply({
            content: response.slice(0, 1950),
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[Store] Slash command failed:", error);
        await interaction.editReply({
            content: "❌ " +
                String(error.message || "Store action failed.").slice(0, 200),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
