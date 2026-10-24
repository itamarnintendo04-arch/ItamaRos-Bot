"use strict";

const {
    SlashCommandBuilder,
    MessageFlags
} = require("discord.js");

const { getProfile } = require("./service");

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
            "⭐ **Level progress**",
            "**Member:** <@" + user.id + ">",
            "**Level:** " + profile.level + " (no fixed maximum)",
            "**Total XP:** " + profile.xp.toLocaleString("en-US"),
            "**Progress:** " + profile.xpInLevel.toLocaleString("en-US") +
                "/" + profile.xpRequiredThisLevel.toLocaleString("en-US") + " XP",
            "**XP to next level:** " +
                profile.xpToNextLevel.toLocaleString("en-US"),
            "**Next level at:** " +
                profile.nextLevelXp.toLocaleString("en-US") + " XP",
            "",
            "💬 **Chat activity rewards**",
            "**Messages that earned XP:** " +
                profile.chatMessagesRewarded.toLocaleString("en-US"),
            "**XP for your next eligible chat message:** " +
                profile.nextMessageXp.toLocaleString("en-US"),
            "**Latest chat XP award:** " +
                profile.lastMessageXp.toLocaleString("en-US")
        ].join("\n"),
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
