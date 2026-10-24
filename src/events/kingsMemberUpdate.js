"use strict";

const { Events } = require("discord.js");
const { onMemberUpdate } = require("../systems/kings/boosts");

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        await onMemberUpdate(oldMember, newMember);
    }
};
