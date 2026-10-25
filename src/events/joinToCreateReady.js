"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");
const { cleanupOnStartup } = require("../systems/voiceRooms/manager");

const RECHECK_MS = 5 * 60 * 1000;
let timer = null;

async function reconcile(client) {
    try {
        await ensureChannels(client);
        await cleanupOnStartup(client);
    } catch (error) {
        console.error("[Voice Rooms] Setup/recovery failed:", error);
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await reconcile(client);
        if (!timer) {
            timer = setInterval(() => {
                void reconcile(client);
            }, RECHECK_MS);
            timer.unref?.();
        }
    }
};
