"use strict";

const {
    SlashCommandBuilder,
    MessageFlags
} = require("discord.js");

const { getProfile, XP_PER_LEVEL, MAX_LEVEL } = require(
    "./service"
);

const data = new SlashCommandBuilder()
    .setName("level")
    .setDescription("View your or another member's level")
    .addUserOption(option =>
        option
            .setName("user")
            .setDescription("Member to view (defaults to you)")
            .setRequired(false)
    );

async function execute(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({
            content: "❌ Use this command inside a server.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const user = interaction.options.getUser("user") ??
        interaction.user;

    if (user.bot) {
        await interaction.reply({
            content: "🤖 Bots do not earn XP.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const profile = await getProfile(interaction.guildId, user.id);

    await interaction.reply({
        content: [
            `⭐ **<@${user.id}>'s level**`,
            `**Level:** ${profile.level}/${MAX_LEVEL}`,
            `**Total XP:** ${profile.xp}`,
            profile.level === MAX_LEVEL
                ? "🏆 Maximum level reached!"
                : `**Progress:** ${profile.xpInLevel}/${XP_PER_LEVEL} XP`,
            profile.level === MAX_LEVEL
                ? ""
                : `**XP to next level:** ${profile.xpToNextLevel}`
        ].filter(Boolean).join("\n"),
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
