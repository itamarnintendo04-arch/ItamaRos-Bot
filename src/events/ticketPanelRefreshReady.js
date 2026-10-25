"use strict";

const { Events, ChannelType } = require("discord.js");
const { getDatabase } = require("../../database");
const { ensureChannels } = require("../systems/setup/channels");
const { buildTicketPanel } = require("../systems/tickets/panel");

/**
 * Refresh a pre-existing ticket panel without creating another channel.
 * All new public categories use direct question forms in English.
 */
async function refreshTicketPanel(client) {
    if (!process.env.GUILD_ID) {
        throw new Error("GUILD_ID is not configured.");
    }
    await ensureChannels(client);
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const collection = getDatabase().collection("bot_system_channels");
    const recordId = guild.id + ":ticket-panel";
    const record = await collection.findOne({ _id: recordId });
    const channel = record?.channelId
        ? await guild.channels.fetch(record.channelId).catch(() => null)
        : null;
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error("Support ticket panel channel was not found.");
    }
    const messageId = record?.panelMessageId || record?.introMessageId;
    const previous = messageId
        ? await channel.messages.fetch(messageId).catch(() => null)
        : null;
    const payload = buildTicketPanel();
    const message = previous?.author?.id === client.user.id
        ? await previous.edit(payload)
        : await channel.send(payload);

    await collection.updateOne({ _id: recordId }, {
        $set: {
            guildId: guild.id, channelId: channel.id,
            panelMessageId: message.id, introSent: true,
            updatedAt: new Date()
        }
    }, { upsert: true });
    console.log("[Tickets] English support panel refreshed in #" +
        channel.name + " (" + channel.id + ").");
    return channel;
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    refreshTicketPanel,
    async execute(client) {
        try {
            await refreshTicketPanel(client);
        } catch (error) {
            console.error("[Tickets] Could not refresh support panel:", error);
        }
    }
};
