"use strict";

const { Events } = require("discord.js");
const { ensureChannels, refreshChannels } =
    require("../systems/setup/channels");

const RECHECK_INTERVAL_MS = 15 * 60 * 1000;
let scheduler = null;

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        const channels = await ensureChannels(client);
        console.log(
            "[Setup] System channels ready: " +
            Object.keys(channels).join(", ")
        );

        if (!scheduler) {
            scheduler = setInterval(() => {
                void refreshChannels(client).catch(error =>
                    console.warn(
                        "[Setup] Periodic channel check failed:",
                        error.message
                    )
                );
            }, RECHECK_INTERVAL_MS);
            scheduler.unref?.();
        }
    }
};
