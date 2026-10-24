"use strict";

const { Events } = require("discord.js");
const { ensureLevelInfrastructure } = require("../systems/levels/setup");
const { reconcilePreviousMembers } = require("../systems/levels/rewards");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        try {
            await ensureLevelInfrastructure(client);
            await reconcilePreviousMembers(client);
        } catch (error) {
            console.error(
                "[Levels] Startup failed:",
                error.message
            );
        }
    }
};
