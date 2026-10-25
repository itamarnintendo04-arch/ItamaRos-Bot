"use strict";

const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { renameOwnedChannel, getOwnership } = require("./manager");

const data = new SlashCommandBuilder()
    .setName("voice-room")
    .setDescription("Manage your claimed voice channel")
    .setDMPermission(false)
    .addSubcommand(option => option
        .setName("rename")
        .setDescription("Rename the shared voice channel while you own it")
        .addStringOption(field => field
            .setName("name")
            .setDescription("Your channel name (2–80 characters)")
            .setMinLength(2)
            .setMaxLength(80)
            .setRequired(true)))
    .addSubcommand(option => option
        .setName("status")
        .setDescription("See whether you currently own the voice channel"));

async function execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild ||
        interaction.guildId !== process.env.GUILD_ID) {
        return interaction.reply({
            content: "❌ This command is unavailable in this server.",
            flags: MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const member = await interaction.guild.members.fetch(
            interaction.user.id
        );
        const action = interaction.options.getSubcommand();

        if (action === "rename") {
            const name = await renameOwnedChannel(
                interaction.guild, member,
                interaction.options.getString("name", true)
            );
            return interaction.editReply({
                content: "✅ Voice room renamed to **" +
                    name.replace(/\*/g, "") + "**. " +
                    "Its name will return to **➕ Create Your Channel** " +
                    "when you leave.",
                allowedMentions: { parse: [] }
            });
        }

        const ownership = await getOwnership(interaction.guild, member);
        if (!ownership) {
            return interaction.editReply(
                "❌ Join **➕ Create Your Channel** first."
            );
        }
        return interaction.editReply({
            content: ownership.isOwner
                ? "✅ You own <#" + ownership.channel.id + "> until you leave."
                : ownership.ownerId
                    ? "ℹ️ Another member currently owns this voice channel."
                    : "ℹ️ This voice channel is currently unclaimed.",
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.warn("[Voice Room] Command failed:",
            String(error.message || error).slice(0, 150));
        return interaction.editReply({
            content: "❌ " +
                String(error.message || error).slice(0, 150),
            allowedMentions: { parse: [] }
        });
    }
}

module.exports = { data, execute };
