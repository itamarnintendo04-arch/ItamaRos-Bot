"use strict";

const { Events } = require("discord.js");
const { handleVoiceStateChange } =
    require("../systems/voiceRooms/manager");

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        await handleVoiceStateChange(oldState, newState);
    }
};
