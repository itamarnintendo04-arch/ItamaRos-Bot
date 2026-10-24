"use strict";

const { Events } = require("discord.js");
const { processMemberLeave } = require("../systems/invites/tracker");

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        await processMemberLeave(member);
    }
};
