"use strict";

const { Events, ChannelType } = require("discord.js");
const { normalizeChannelName } = require("../systems/setup/channels");

const SUSPECT_IDS = Object.freeze([
    "1563469786644742145",
    "1563469795578347581",
    "1563469804797562991",
    "1563469814905966652",
    "1563469820064829480",
    "1563469824707928084",
    "1563469829732569098",
    "1563469835537621164"
]);

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const channels = await guild.channels.fetch();
        console.log("[Channel Audit] START");
        for (const channel of channels.values()) {
            if (![ChannelType.GuildText, ChannelType.GuildAnnouncement,
                ChannelType.GuildVoice].includes(channel.type)) continue;

            const exact = SUSPECT_IDS.includes(channel.id);
            const descriptor = {
                name: channel.name,
                id: channel.id,
                kind: channel.type,
                suspect: exact,
                createdAt: channel.createdAt?.toISOString(),
                parent: channel.parentId || null
            };

            if (exact && channel.messages) {
                try {
                    const msgs = await channel.messages.fetch({ limit: 4 });
                    descriptor.recent = msgs.map(message => ({
                        id: message.id,
                        isBot: Boolean(message.author?.bot),
                        hasComponents: message.components?.length > 0,
                        hasAttachments: message.attachments?.size > 0
                    }));
                    descriptor.reachedFour = msgs.size >= 4;
                } catch (error) {
                    descriptor.messageCheck = error.message;
                }
            }

            console.log("[Channel Audit] " + JSON.stringify(descriptor));
        }
        console.log("[Channel Audit] END");
    }
};
