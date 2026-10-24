"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");
const { initialize } = require("../systems/invites/tracker");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await ensureChannels(client);
        await initialize(client);
    }
};
