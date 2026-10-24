"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");
const {
    STORE_CHANNEL_ID,
    refreshStorePanel
} = require("./storePanel");

const data = new SlashCommandBuilder()
    .setName("shop-panel")
    .setDescription("Publish or refresh the interactive shop in item-store")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function execute(interaction) {
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
        return interaction.reply({
            content: "❌ Manage Server permission required.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const success = await refreshStorePanel(interaction.guild);
        await interaction.editReply({
            content: success
                ? "✅ Shop panel refreshed in <#" +
                    STORE_CHANNEL_ID + ">."
                : "❌ Could not publish the shop panel. " +
                    "Check the bot permissions in item-store.",
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[Shop Panel]", error);
        await interaction.editReply({
            content: "❌ Could not update the shop panel.",
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
