"use strict";

const { Events, ChannelType } = require("discord.js");
const { getDatabase } = require("../../database");
const { ensureChannels } = require("../systems/setup/channels");
const { buildTicketPanel } = require("../systems/tickets/panel");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        if (!process.env.GUILD_ID) return;
        try {
            await ensureChannels(client);
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            const collection = getDatabase().collection("bot_system_channels");
            const recordId = guild.id + ":ticket-panel";
            const record = await collection.findOne({ _id: recordId });
            const channel = record?.channelId
                ? await guild.channels.fetch(record.channelId).catch(() => null)
                : null;
            if (!channel || channel.type !== ChannelType.GuildText) {
                console.warn("[Tickets] Support panel channel was not found.");
                return;
            }
            const current = record.introMessageId
                ? await channel.messages.fetch(record.introMessageId)
                    .catch(() => null)
                : null;
            const panel = buildTicketPanel();
            let message;
            if (current?.author?.id === client.user.id) {
                message = await current.edit(panel);
                console.log("[Tickets] Existing panel updated with new English categories.");
            } else {
                message = await channel.send(panel);
                console.log("[Tickets] Posted updated support ticket panel.");
            }
            await collection.updateOne({ _id: recordId }, {
                $set: {
                    guildId: guild.id, channelId: channel.id,
                    introMessageId: message.id,
                    introSent: true, updatedAt: new Date()
                }
            }, { upsert: true });
        } catch (error) {
            console.error("[Tickets] Could not refresh support panel:", error);
        }
    }
};
