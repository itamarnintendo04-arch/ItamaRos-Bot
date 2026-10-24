"use strict";

const { Events } = require("discord.js");
const { refreshChannels } =
    require("../systems/setup/channels");
const { ensureRankInfrastructure } = require("../systems/kings/ranks");

let check = null;

module.exports = {
    name: Events.ChannelDelete,
    async execute(channel, client) {
        if (!channel?.guildId ||
            channel.guildId !== process.env.GUILD_ID) {
            return;
        }

        // Coalesce deletion bursts into one API reconciliation pass.
        if (check) clearTimeout(check);
        check = setTimeout(() => {
            check = null;
            void (async () => {
                await refreshChannels(client);
                await ensureRankInfrastructure(client, { refresh: true });
            })().catch(error => {
                console.error(
                    "[Setup] Channel/Kings category recreation failed:",
                    error.message
                );
            });
        }, 3000);
        check.unref?.();
    }
};
