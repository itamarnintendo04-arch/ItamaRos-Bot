"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { changeXp, MAX_XP } = require("./service");

const data = new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Manage member XP")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false);

for (const [name, description] of [
    ["add", "Add XP to a member"],
    ["remove", "Remove XP from a member"],
    ["set", "Set a member's total XP"]
]) {
    data.addSubcommand(sub =>
        sub.setName(name)
            .setDescription(description)
            .addUserOption(option =>
                option.setName("user")
                    .setDescription("Member to update")
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName("amount")
                    .setDescription("Amount of XP")
                    .setMinValue(0)
                    .setMaxValue(MAX_XP)
                    .setRequired(true)
            )
    );
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
        await interaction.reply({
            content: "❌ Manage Server permission is required.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const user = interaction.options.getUser("user", true);

    if (user.bot) {
        await interaction.reply({
            content: "❌ Bots cannot receive XP.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const profile = await changeXp(
        interaction.guildId,
        user.id,
        interaction.options.getSubcommand(),
        interaction.options.getInteger("amount", true)
    );

    await interaction.editReply({
        content: `✅ <@${user.id}> now has **${profile.xp} XP** (Level **${profile.level}**).`,
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
