"use strict";

const { Events } = require("discord.js");
const { onMemberUpdate } = require("../systems/kings/boosts");
const { syncMemberRank } = require("../systems/kings/ranks");

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        const previousBoost = Boolean(oldMember.premiumSinceTimestamp);
        const nextBoost = Boolean(newMember.premiumSinceTimestamp);
        const kingsRole = process.env.KINGS_ROLE_ID;
        const roleChanged = Boolean(kingsRole &&
            oldMember.roles.cache.has(kingsRole) !==
            newMember.roles.cache.has(kingsRole));
        await onMemberUpdate(oldMember, newMember);
        if (roleChanged || previousBoost !== nextBoost) {
            await syncMemberRank(newMember);
        }
    }
};
