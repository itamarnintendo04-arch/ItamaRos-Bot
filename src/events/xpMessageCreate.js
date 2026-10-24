"use strict";

const { Events } = require("discord.js");
const { awardMessageXp } = require("../systems/xp/service");
const { reconcileMember } = require("../systems/levels/rewards");
const { syncMemberRank } = require("../systems/kings/ranks");

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        const awarded = await awardMessageXp(message);
        if (!awarded) return;

        // Role milestones use chat-earned XP and each rank reward
        // is paid just once. Failures must not remove earned XP.
        const member = message.member ||
            await message.guild.members.fetch(message.author.id);
        try {
            await reconcileMember(member);
        } catch (error) {
            console.warn("[Levels] Could not check chat milestone:", error.message);
        }
        try {
            await syncMemberRank(member);
        } catch (error) {
            console.warn("[Kings Ranks] XP promotion failed:", error.message);
        }
    }
};
