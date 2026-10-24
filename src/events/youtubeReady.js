"use strict";

const { Events } = require("discord.js");
const { start } = require("../systems/youtube/watcher");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        // Auto-resume every configured YouTube subscription after Render restarts.
        start(client);
        console.log("[YouTube] Automatic watcher initialized.");
    }
};
