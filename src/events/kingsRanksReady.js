"use strict";

const { Events } = require("discord.js");
const { ensureChannels } = require("../systems/setup/channels");
const {
    ensureRankInfrastructure, syncMemberRank
} = require("../systems/kings/ranks");

let refreshTimer = null;

async function syncExistingKings(client) {
    const setup = await ensureRankInfrastructure(client);
    const members = await setup.guild.members.fetch();
    const rankRoleIds = new Set([...setup.roles.values()].map(role => role.id));
    let synced = 0;

    for (const member of members.values()) {
        if (member.user?.bot ||
            (!member.roles.cache.has(setup.baseRole.id) &&
             ![...rankRoleIds].some(id => member.roles.cache.has(id)))) continue;
        try {
            await syncMemberRank(member, { infrastructure: setup });
            synced++;
        } catch (error) {
            console.warn("[Kings Ranks] Could not sync " + member.id + ": " +
                error.message);
        }
    }
    console.log("[Kings Ranks] Synchronized " + synced + " members.");
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await ensureChannels(client);
        await syncExistingKings(client);

        if (!refreshTimer) {
            refreshTimer = setInterval(() => {
                syncExistingKings(client).catch(error => {
                    console.warn("[Kings Ranks] Periodic sync failed:", error);
                });
            }, 30 * 60 * 1000);
            refreshTimer.unref?.();
        }
    }
};
