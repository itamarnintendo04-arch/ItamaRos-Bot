"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const channels = await ensureChannels(client);
        console.log(
            "[Setup] System channels ready: " +
            Object.keys(channels).join(", ")
        );
    }
};
