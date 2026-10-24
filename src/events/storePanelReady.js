"use strict";

const { Events } = require("discord.js");
const { refreshStorePanel } =
    require("../systems/economy/storePanel");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            const guild = await client.guilds.fetch(
                process.env.GUILD_ID
            );
            await refreshStorePanel(guild);
        } catch (error) {
            console.error(
                "[Item Store] Panel setup failed:",
                error.message
            );
        }
    }
};
