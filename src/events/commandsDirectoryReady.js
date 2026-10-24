"use strict";
const { Events } = require("discord.js");
const { sync } = require("../systems/setup/commandsDirectory");
let interval;
module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await sync(client).catch(error =>
            console.warn("[Commands Directory] Startup failed:", error.message));
        if (!interval) {
            interval = setInterval(() => {
                void sync(client).catch(error =>
                    console.warn("[Commands Directory] Refresh failed:", error.message));
            }, 15 * 60 * 1000);
            interval.unref?.();
        }
    }
};