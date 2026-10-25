"use strict";
const { Events } = require("discord.js");
const { interaction } = require("../systems/dashboard/dashboard");
module.exports = {
    name: Events.InteractionCreate,
    async execute(context) {
        if (!context.isButton?.() ||
            !context.customId?.startsWith("dash:")) return;
        try {
            await interaction(context);
        } catch (error) {
            console.error("[Dashboard] Interaction failed:", error);
            if (!context.replied && !context.deferred) {
                await context.reply({ content: "❌ Dashboard error.",
                    ephemeral: true }).catch(() => {});
            } else {
                await context.editReply({ content: "❌ Dashboard error." })
                    .catch(() => {});
            }
        }
    }
};
