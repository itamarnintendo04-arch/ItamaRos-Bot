"use strict";
const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags
} = require("discord.js");
const {
    ensureStaff, build, ensureDashboard
} = require("./dashboard");

const data = new SlashCommandBuilder()
    .setName("dashboard")
    .setDescription("Open the private ItamaRos test-server administration dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand(s => s.setName("view")
        .setDescription("Show your private interactive dashboard"))
    .addSubcommand(s => s.setName("publish")
        .setDescription("Create or refresh the private #bot-dashboard channel"));

async function execute(interaction) {
    if (!ensureStaff(interaction)) {
        return interaction.reply({
            content: "❌ Manage Server permission required in the configured guild.",
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        if (interaction.options.getSubcommand() === "publish") {
            const channel = await ensureDashboard(interaction.client);
            await interaction.editReply({
                content: "✅ Private dashboard published in <#" + channel.id +
                    ">. Only authorized staff can view it.",
                allowedMentions: { parse: [] }
            });
        } else {
            await interaction.editReply(await build(interaction.guild));
        }
    } catch (error) {
        console.error("[Dashboard] Admin command error:", error);
        await interaction.editReply({
            content: "❌ Dashboard unavailable: " +
                String(error.message || error).slice(0, 350)
        });
    }
}
module.exports = { data, execute };
