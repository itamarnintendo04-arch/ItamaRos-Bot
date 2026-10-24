"use strict";

const { Events } = require("discord.js");
const { refreshChannels } =
    require("../systems/setup/channels");

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
            void refreshChannels(client).catch(error => {
                console.error(
                    "[Setup] Channel recreation failed:",
                    error.message
                );
            });
        }, 3000);
        check.unref?.();
    }
};
