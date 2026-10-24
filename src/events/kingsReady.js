"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");
const { start } = require("../systems/kings/boosts");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await ensureChannels(client);
        start(client);
    }
};
