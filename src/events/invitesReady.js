"use strict";

const { Events } = require("discord.js");
const { initialize } = require("../systems/invites/tracker");

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        await initialize(client);
    }
};
