"use strict";

const { Events } = require("discord.js");
const { awardMessageXp } = require("../systems/xp/service");

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        await awardMessageXp(message);
    }
};
