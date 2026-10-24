"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { changeXp, getProfile, MAX_XP } = require("./service");

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

    let profile = await changeXp(
        interaction.guildId,
        user.id,
        interaction.options.getSubcommand(),
        interaction.options.getInteger("amount", true)
    );

    let kingsNote = "";
    try {
        const member = await interaction.guild.members.fetch(user.id);
        const { reconcileMember } = require("../levels/rewards");
        await reconcileMember(member, { announce: false });
        const { syncMemberRank } = require("../kings/ranks");
        const tier = await syncMemberRank(member);
        profile = await getProfile(interaction.guildId, user.id);
        if (tier) kingsNote = " 👑 Kings Level " + tier + ".";
    } catch (error) {
        console.warn("[Kings Ranks] Staff XP role update failed:", error.message);
    }

    await interaction.editReply({
        content: `✅ <@${user.id}> now has **${profile.xp} XP** (Level **${profile.level}**).${kingsNote}`,
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
