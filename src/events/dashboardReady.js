"use strict";
const { Events } = require("discord.js");
const { ensureDashboard } = require("../systems/dashboard/dashboard");

let refreshing = false;
let refreshTimer = null;

async function refresh(client) {
    if (refreshing) return;
    refreshing = true;
    try {
        const channel = await ensureDashboard(client);
        console.log("[Dashboard] Staff panel ready: #" + channel.name);
    } catch (error) {
        console.error("[Dashboard] Refresh failed:", error.message);
    } finally {
        refreshing = false;
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await refresh(client);
        if (!refreshTimer) {
            refreshTimer = setInterval(() => {
                void refresh(client);
            }, 15 * 60 * 1000);
            refreshTimer.unref?.();
        }
    }
};
