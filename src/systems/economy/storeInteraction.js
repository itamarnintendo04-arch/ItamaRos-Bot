"use strict";

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require("discord.js");
const economy = require("./service");
const { buyProduct, rewardSummary } = require("./rewardPurchase");
const { notifyItemUsed } = require("./useNotifications");
const images = require("./itemImages");
const { assertCanAccess, getAccess, visibleItems } = require("./kingsAccess");
const {
    STORE_CHANNEL_ID,
    storeComponents,
    clean,
    refreshStorePanel
} = require("./storePanel");

const PREFIX = "is:";
const ITEM_KEY = /^[a-z0-9_-]{2,45}$/;

function number(value) {
    return Number(value || 0).toLocaleString("en-US");
}

function ephemeral(content) {
    return {
        content, flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    };
}

async function productDetails(guildId, item) {
    const symbol = (await economy.getSettings(guildId)).currency;
    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle("📦 " + clean(item.name, 70))
        .setDescription(
            clean(item.description || "No description provided.", 500)
        )
        .addFields(
            { name: "Price", value:
                number(item.price) + " " + clean(symbol, 12),
                inline: true
            },
            { name: "Availability",
                value: item.stock === null
                    ? "Unlimited"
                    : item.stock === 0
                        ? "Sold out" : number(item.stock) + " left",
                inline: true
            },
            { name: "Category", value: clean(item.category, 40) || "General",
                inline: true
            },
            { name: "Product type", value: clean(item.type, 20),
                inline: true }
        )
        .setFooter({ text: "Item ID: " + item.key });
    if (item.type === "reward") {
        embed.addFields({
            name: item.externalRewards?.length ? "🎁 Rewards and staff delivery" : "🎁 Instant delivery after payment",
            value: rewardSummary(item),
            inline: false
        });
    }

    const payload = {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("is:buy:" + item.key)
                    .setLabel("Buy")
                    .setEmoji("🛍️")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!item.enabled || item.stock === 0),
                new ButtonBuilder()
                    .setCustomId("is:sell:" + item.key)
                    .setLabel("Sell")
                    .setEmoji("🪙")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId("is:use:" + item.key)
                    .setLabel("Use item")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(
                        item.type === "collectible" ||
                        item.type === "reward"
                    )
            )
        ],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    };

    if (item.hasImage) {
        try {
            const photo = await images.productImage(guildId, item.key);
            if (photo) {
                embed.setImage(photo.url);
                payload.files = [photo.attachment];
            }
        } catch (error) {
            console.warn(
                "[Item Store] Product image unavailable:",
                error.message
            );
        }
    }

    return payload;
}

async function inventoryMessage(guildId, userId) {
    const [list, wallet, settings] = await Promise.all([
        economy.getInventory(guildId, userId),
        economy.getAccount(guildId, userId),
        economy.getSettings(guildId)
    ]);

    return [
        "🎒 **Your ItamaRos Inventory**",
        "",
        list.length
            ? list.slice(0, 35).map(item =>
                "• **" + clean(item.itemName) +
                "** ×" + item.quantity +
                " (ID: " + item.itemKey + ")"
            ).join("\n")
            : "Your inventory is currently empty.",
        "",
        "🪙 **Wallet:** " + number(wallet.cash) +
            " " + clean(settings.currency, 12)
    ].join("\n").slice(0, 1900);
}

async function walletMessage(guildId, userId) {
    const [account, settings] = await Promise.all([
        economy.getAccount(guildId, userId),
        economy.getSettings(guildId)
    ]);

    return "🪙 **Your Coins**\n\n" +
        "Wallet: **" + number(account.cash) + "** " +
        clean(settings.currency, 12) + "\n" +
        "Bank: **" + number(account.bank) + "** " +
        clean(settings.currency, 12) + "\n" +
        "Total: **" + number(account.bank + account.cash) + "**.";
}

async function openQuantityModal(interaction, mode, key) {
    const modal = new ModalBuilder()
        .setCustomId("is:checkout:" + mode + ":" + key)
        .setTitle(mode === "buy" ? "Purchase item" : "Sell item");

    const quantity = new TextInputBuilder()
        .setCustomId("quantity")
        .setLabel("How many? (1–50)")
        .setPlaceholder("1")
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(2)
        .setRequired(true)
        .setValue("1");

    modal.addComponents(
        new ActionRowBuilder().addComponents(quantity)
    );
    await interaction.showModal(modal);
}

async function processCheckout(interaction, mode, key) {
    const raw = interaction.fields.getTextInputValue("quantity").trim();
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw)) {
        return interaction.reply(
            ephemeral("❌ Quantity must be between 1 and 50.")
        );
    }

    const quantity = Number(raw);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const item = await economy.getItem(interaction.guildId, key);
    if (!item) {
        throw new Error("This product no longer exists.");
    }

    let message = "";
    if (mode === "buy") {
        await assertCanAccess(interaction.guild, interaction.user.id, item);
        const purchase = await buyProduct(
            interaction.guild, interaction.user, key, quantity
        );
        message = "✅ Bought **" + quantity +
            " × " + clean(purchase.item.name) +
            "** for **" + number(purchase.cost) +
            "** virtual coins.\n" + (purchase.instant
                ? "🎁 Delivered immediately: " + rewardSummary(purchase.item)
                : "Open My inventory in the store to view it.");
        if (purchase.instant) {
            await notifyItemUsed({
                guild: interaction.guild,
                user: interaction.user,
                item: purchase.item,
                action: "Instant rewards delivered"
            });
        }
    } else {
        if (item.type === "reward") {
            throw new Error("Instant rewards cannot be sold back.");
        }
        const sale = await economy.sell(
            interaction.guildId, interaction.user.id,
            key, quantity
        );
        message = "✅ Sold **" + quantity +
            " × " + clean(sale.item.name) +
            "** for **" + number(sale.reward) + "** virtual coins.";
    }

    await interaction.editReply({
        content: message,
        allowedMentions: { parse: [] }
    });

    // Update stock/availability shown on the shared panel.
    await refreshStorePanel(interaction.guild).catch(error =>
        console.warn(
            "[Item Store] Could not refresh after purchase:",
            error.message
        )
    );
}

async function useProduct(interaction, key) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const item = await economy.getItem(interaction.guildId, key);
    if (!item) throw new Error("Item not found.");

    if (item.type === "reward") {
        throw new Error("This reward was already delivered at purchase.");
    }
    if (item.type === "role") {
        const member = await interaction.guild.members.fetch(
            interaction.user.id
        );
        await economy.redeemRole(
            interaction.guildId, interaction.user.id, key, member
        );
    } else {
        await economy.useItem(
            interaction.guildId, interaction.user.id, key
        );
    }

    // Report every successful redemption to private staff audit
    // and server owner, whether used through buttons or /store use.
    await notifyItemUsed({
        guild: interaction.guild,
        user: interaction.user,
        item,
        action: item.type === "role" ? "Redeemed role" : "Used item"
    });

    await interaction.editReply({
        content: "✨ You used **" + clean(item.name) +
            "**! A notification was sent to server staff.",
        allowedMentions: { parse: [] }
    });
}

async function openBuyConfirmation(interaction, item) {
    await assertCanAccess(interaction.guild, interaction.user.id, item);
    const cfg = await economy.getSettings(interaction.guildId);
    const isInstant = item.type === "reward";
    const hasExternal = Boolean(item.externalRewards?.length);
    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle("🛒 Confirm your purchase")
        .setDescription([
            "**" + clean(item.name, 70) + "**",
            "",
            "**Price:** " + number(item.price) + " " +
                clean(cfg.currency, 12),
            isInstant
                ? (hasExternal ? "🎁 **Automatic rewards are immediate; external rewards are delivered by staff in a private ticket:**" : "🎁 **This purchase delivers immediately:**")
                : "📦 This item will be added to your inventory.",
            isInstant ? rewardSummary(item) : "",
            "",
            isInstant
                ? "You do NOT need to use this item afterward."
                : "Choose the quantity after confirming.",
            "Do you want to buy it?"
        ].filter(Boolean).join("\n"));

    await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("is:confirm:" + item.key + ":" + item.price)
                .setLabel("Buy")
                .setEmoji("🛍️")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("is:decline:" + item.key)
                .setLabel("No thanks")
                .setStyle(ButtonStyle.Secondary)
        )],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    });
}

async function confirmBuy(interaction, key, expectedPrice) {
    const item = await economy.getItem(interaction.guildId, key);
    if (!item || !item.enabled || item.stock === 0) {
        throw new Error("This product is no longer available.");
    }
    await assertCanAccess(interaction.guild, interaction.user.id, item);
    if (item.price !== expectedPrice) {
        throw new Error(
            "The price has changed. Please open the shop again."
        );
    }
    if (item.type !== "reward") {
        return openQuantityModal(interaction, "buy", key);
    }

    await interaction.deferUpdate();
    const purchase = await buyProduct(
        interaction.guild, interaction.user, key, 1,
        interaction.message.id
    );
    await notifyItemUsed({
        guild: interaction.guild,
        user: interaction.user,
        item: purchase.item,
        action: "Shop purchase completed"
    }).catch(error => console.warn("[Shop] Notification failed:", error));
    let ticketMessage = "";
    if (item.externalRewards?.length) {
        try {
            const { ensureShopTicket } = require("./shopTickets");
            const ticket = await ensureShopTicket(interaction.guild, interaction.user, item, interaction.message.id);
            ticketMessage = "\n🎫 Your private delivery ticket: <#" + ticket.id + ">";
        } catch (error) {
            console.error("[Shop] Paid order needs staff attention:", error);
            ticketMessage = "\n⚠️ Payment succeeded, but ticket creation failed. Contact staff with your purchase details.";
        }
    }
    await interaction.editReply({
        content: "✅ **Purchase complete!**\n" +
            "🛍️ **" + clean(item.name) + "** — " +
            number(purchase.cost) + " coins\n" +
            "🎁 **Your rewards:** " + rewardSummary(item) + ticketMessage,
        embeds: [],
        components: [],
        allowedMentions: { parse: [] }
    });
}

async function handleStoreInteraction(interaction) {
    const id = interaction.customId;
    if (!id || !id.startsWith(PREFIX)) return false;

    try {
        if (interaction.isButton() && /^is:delivered:\d+$/.test(id)) {
            const { markShopDelivered } = require("./shopTickets");
            await markShopDelivered(interaction);
            return true;
        }
        if (!interaction.inGuild() ||
            interaction.guildId !== process.env.GUILD_ID) {
            await interaction.reply(ephemeral(
                "❌ This shop is only available in the ItamaRos server."
            ));
            return true;
        }

        if (interaction.isStringSelectMenu() &&
            /^is:pick:\d+$/.test(id)) {
            const key = interaction.values?.[0];
            if (!ITEM_KEY.test(key || "")) {
                await interaction.reply(ephemeral("❌ Invalid product."));
                return true;
            }
            const item = await economy.getItem(
                interaction.guildId, key
            );
            if (!item || !item.enabled) {
                await interaction.reply(ephemeral(
                    "❌ This item is no longer available."
                ));
                return true;
            }

            await assertCanAccess(interaction.guild, interaction.user.id, item);
            await interaction.reply(await productDetails(
                interaction.guildId, item
            ));
            return true;
        }

        if (interaction.isButton() && /^is:page:-?\d+$/.test(id)) {
            const page = Number(id.split(":")[2]);
            const items = visibleItems(
                await economy.listItems(interaction.guildId),
                await getAccess(interaction.guild, interaction.user.id)
            );
            await interaction.update({
                components: storeComponents(items, page)
            });
            return true;
        }

        if (interaction.isButton() && id === "is:inventory") {
            await interaction.reply(ephemeral(
                await inventoryMessage(
                    interaction.guildId, interaction.user.id
                )
            ));
            return true;
        }

        if (interaction.isButton() && id === "is:wallet") {
            await interaction.reply(ephemeral(
                await walletMessage(
                    interaction.guildId, interaction.user.id
                )
            ));
            return true;
        }

        const confirmation = id.match(
            /^is:confirm:([a-z0-9_-]{2,45}):(\d{1,10})$/
        );
        if (interaction.isButton() && confirmation) {
            await confirmBuy(
                interaction, confirmation[1], Number(confirmation[2])
            );
            return true;
        }

        if (interaction.isButton() &&
            /^is:decline:[a-z0-9_-]{2,45}$/.test(id)) {
            await interaction.update({
                content: "👌 Purchase cancelled. No coins were spent.",
                embeds: [],
                components: [],
                allowedMentions: { parse: [] }
            });
            return true;
        }

        const itemAction = id.match(
            /^is:(buy|sell|use):([a-z0-9_-]{2,45})$/
        );

        if (interaction.isButton() && itemAction) {
            const [, mode, key] = itemAction;
            const item = await economy.getItem(
                interaction.guildId, key
            );
            if (!item) throw new Error("Product no longer exists.");
            if (mode === "buy") {
                await assertCanAccess(interaction.guild, interaction.user.id, item);
            }
            if (mode === "buy" && (!item.enabled ||
                item.stock === 0)) {
                throw new Error("This item is not available for purchase.");
            }

            if (mode === "use") {
                await useProduct(interaction, key);
            } else if (mode === "buy") {
                await openBuyConfirmation(interaction, item);
            } else {
                await openQuantityModal(interaction, mode, key);
            }
            return true;
        }

        const checkout = id.match(
            /^is:checkout:(buy|sell):([a-z0-9_-]{2,45})$/
        );
        if (interaction.isModalSubmit() && checkout) {
            await processCheckout(
                interaction, checkout[1], checkout[2]
            );
            return true;
        }

        await interaction.reply(ephemeral(
            "❌ This shop action is no longer available."
        ));
        return true;
    } catch (error) {
        console.error("[Item Store] Action failed:", error);
        const payload = {
            content: "❌ " +
                String(error.message || "Shop action failed.").slice(0, 180),
            allowedMentions: { parse: [] }
        };

        try {
            if (interaction.deferred) {
                await interaction.editReply(payload);
            } else if (interaction.replied) {
                await interaction.followUp({
                    ...payload, flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    ...payload, flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.warn(
                "[Item Store] Could not reply:",
                replyError.message
            );
        }
        return true;
    }
}

module.exports = {
    handleStoreInteraction,
    productDetails,
    inventoryMessage,
    walletMessage
};
