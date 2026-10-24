"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { getDatabase } = require("../../../database");
const { XP_PER_LEVEL } = require("./service");

const data = new SlashCommandBuilder()
    .setName("xp-leaderboard")
    .setDescription("Display the top 10 XP earners in ItamaRos")
    .setDMPermission(false);

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID) {
        return interaction.reply({
            content: "❌ Only available in the ItamaRos server.",
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        const profiles = await getDatabase()
            .collection("member_xp")
            .find({ guildId: interaction.guildId, xp: { $gt: 0 } })
            .sort({ xp: -1 })
            .limit(10)
            .project({ userId: 1, xp: 1 })
            .toArray();

        const lines = profiles.map((row, index) =>
            (index + 1) + ". <@" + row.userId + "> — **" +
            Number(row.xp).toLocaleString("en-US") + " XP** " +
            "(Level " + Math.floor(row.xp / XP_PER_LEVEL) + ")"
        );

        await interaction.editReply({
            content: [
                "⭐ **ItamaRos XP Leaderboard**",
                "",
                lines.length ? lines.join("\n") :
                    "No members have earned XP yet.",
                "",
                "Each 200 XP = 1 level."
            ].join("\n"),
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[XP] Leaderboard failed:", error);
        await interaction.editReply({
            content: "❌ The XP leaderboard is unavailable.",
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
