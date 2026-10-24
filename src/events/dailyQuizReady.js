
"use strict";

const { Events } = require("discord.js");

const {
  startQuizScheduler
} = require("../systems/dailyQuestion/quiz");

// ======================================
// ITAMAROS DAILY QUIZ
// AUTOMATIC STARTUP EVENT
// ======================================

module.exports = {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      console.log(
        "[Daily Quiz] Initializing..."
      );

      startQuizScheduler(client);

      console.log(
        "[Daily Quiz] Scheduler started!"
      );

      console.log(
        "[Daily Quiz] Question: 07:00"
      );

      console.log(
        "[Daily Quiz] Reveal: 21:00"
      );

      console.log(
        "[Daily Quiz] Timezone: Asia/Jerusalem"
      );
    } catch (error) {
      console.error(
        "[Daily Quiz] Startup failed:",
        error
      );
    }
  }
};
