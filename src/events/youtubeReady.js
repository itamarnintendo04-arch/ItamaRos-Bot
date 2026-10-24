"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");
const { start } = require("../systems/youtube/watcher");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        // Auto-resume every configured YouTube subscription after Render restarts.
        await ensureChannels(client);
        start(client);
        console.log("[YouTube] Automatic watcher initialized.");
    }
};
