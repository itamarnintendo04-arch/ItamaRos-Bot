"use strict";

const { Events } = require("discord.js");
const {
  startYouTubeUpdates
} = require("../systems/youtube/updates");

// Automatically starts after the bot connects to Discord.
// No extra slash commands or gateway intents required.
module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      startYouTubeUpdates(client);
    } catch (error) {
      console.error("[YouTube] Startup failed:", error);
    }
  }
};
