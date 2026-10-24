"use strict";

const { Events } = require("discord.js");
const { start } = require("../systems/kings/boosts");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        start(client);
    }
};
