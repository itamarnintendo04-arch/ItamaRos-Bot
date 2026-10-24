"use strict";

const { Events } = require("discord.js");
const { handleStoreInteraction } =
    require("../systems/economy/storeInteraction");

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction.customId?.startsWith("is:")) return;
        await handleStoreInteraction(interaction);
    }
};
