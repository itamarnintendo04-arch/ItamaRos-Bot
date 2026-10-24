"use strict";
const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { getDatabase } = require("../../../database");

async function ensureShopTicket(guild, user, item, checkoutId) {
    const external = item.externalRewards || [];
    if (!external.length) return null;
    const orders = getDatabase().collection("shop_delivery_orders");
    const orderId = guild.id + ":" + user.id + ":" + checkoutId;
    const existing = await orders.findOne({ _id: orderId });
    if (existing?.channelId) {
        const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
        if (channel) return channel;
    }
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error("Shop ticket creation requires Manage Channels permission.");
    }
    const staff = guild.roles.cache.filter(r =>
        r.permissions.has(PermissionFlagsBits.ManageGuild) &&
        !r.managed && r.id !== guild.id
    );
    const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: me.id, allow: [PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
        ...staff.map(role => ({ id: role.id, allow: [
            PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory] }))
    ];
    const channel = await guild.channels.create({
        name: "shop-" + user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 35),
        type: ChannelType.GuildText,
        topic: "Shop delivery for " + user.id + " | " + item.key,
        permissionOverwrites: overwrites,
        reason: "External Shop Pack delivery"
    });
    try {
        await orders.updateOne({ _id: orderId }, {
            $set: { guildId: guild.id, userId: user.id,
                itemKey: item.key, itemName: item.name,
                externalRewards: external, channelId: channel.id,
                status: "awaiting_staff", updatedAt: new Date() },
            $setOnInsert: { createdAt: new Date() }
        }, { upsert: true });
        const embed = new EmbedBuilder().setColor(0x8b5cf6)
            .setTitle("🛍️ Shop Order Created")
            .setDescription("Your purchase is confirmed! A staff member will deliver your external rewards here shortly.")
            .addFields(
                { name: "Product", value: item.name.slice(0, 100) },
                { name: "External rewards", value: external.map((x,i) => (i+1)+". "+x).join("\n").slice(0, 1024) },
                { name: "Status", value: "Awaiting staff delivery" }
            );
        await channel.send({ content: "<@" + user.id + ">",
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
                .setCustomId("is:delivered:" + channel.id)
                .setLabel("Mark as Delivered").setStyle(ButtonStyle.Success))],
            allowedMentions: { users: [user.id] } });
        return channel;
    } catch (error) {
        console.error("[Shop Tickets] Ticket setup failed:", error);
        throw error;
    }
}
async function markShopDelivered(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "❌ Staff only.", flags: MessageFlags.Ephemeral });
        return;
    }
    const order = await getDatabase().collection("shop_delivery_orders").findOne({
        guildId: interaction.guildId, channelId: interaction.channelId
    });
    if (!order) throw new Error("Shop order not found.");
    await getDatabase().collection("shop_delivery_orders").updateOne({
        _id: order._id, status: "awaiting_staff"
    }, { $set: { status: "delivered", deliveredBy: interaction.user.id,
        deliveredAt: new Date() } });
    await interaction.update({ components: [] });
    await interaction.followUp({ content: "✅ External rewards marked as delivered by <@" +
        interaction.user.id + ">. Staff may now close this ticket.",
        allowedMentions: { users: [interaction.user.id] } });
}
module.exports = { ensureShopTicket, markShopDelivered };
