"use strict";

const { Events } = require("discord.js");
const { cleanupDeletedChannel } =
    require("../systems/voiceRooms/manager");

module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        await cleanupDeletedChannel(channel);
    }
};
