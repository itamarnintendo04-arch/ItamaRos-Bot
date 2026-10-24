"use strict";

const { SlashCommandBuilder, MessageFlags, EmbedBuilder } =
    require("discord.js");
const { getDatabase } = require("../../../database");
const { RANKS, baseKingsRole, getMemberTier } = require("./ranks");
const { isStaff } = require("../economy/kingsAccess");

const data = new SlashCommandBuilder()
    .setName("kings-rank")
    .setDescription("Check your Kings level, unlocks and next promotion")
    .setDMPermission(false)
    .addUserOption(o => o.setName("member")
        .setDescription("Check a member (defaults to you)")
        .setRequired(false));

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID) {
        return interaction.reply({
            content: "❌ Only available inside the ItamaRos server.",
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const user = interaction.options.getUser("member") || interaction.user;
        const member = await interaction.guild.members.fetch(user.id);
        const baseRole = await baseKingsRole(interaction.guild);
        if (!baseRole) throw new Error("Kings role has not been configured.");

        const tier = await getMemberTier(member, baseRole);
        const staff = isStaff(member);
        const xpProfile = await getDatabase().collection("member_xp").findOne({
            _id: interaction.guildId + ":" + user.id
        });
        const activityXp = Math.max(0, Number(
            xpProfile?.activityXp ??
            ((xpProfile?.xp || 0) - (xpProfile?.bonusXpAwarded || 0))
        ) || 0);

        const next = tier > 0 ? RANKS.find(rank => rank.tier > tier) : null;
        const unlocks = tier ? RANKS.filter(rank => rank.tier <= tier)
            .map(rank => "• Level " + rank.tier + ": " +
                rank.channels.join(", ")).join("\n") : "No Kings areas unlocked.";

        const embed = new EmbedBuilder()
            .setColor(0xC6A1FF)
            .setTitle("👑 ItamaRos Kings Progress")
            .setDescription([
                "**Member:** <@" + user.id + ">",
                "**Kings rank:** " + (tier ? "Level " + tier + "/5" :
                    "Not a Kings member"),
                "**Rank XP:** " + activityXp.toLocaleString("en-US"),
                "!tier ? "**Next step:** Become a Kings member to unlock Level 1." : "",
                next ? "**Next Kings level:** " + Math.max(0,
                    next.requiredXp - activityXp) + " activity XP remaining"
                    : tier === 5 ? "**Status:** Maximum rank reached!" : "",
                staff ? "🛡️ Server managers can access every Kings category." : "",
                "",
                "**Unlocked categories and perks**",
                unlocks
            ].filter(Boolean).join("\n").slice(0, 4000));

        await interaction.editReply({
            embeds: [embed],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[Kings Rank] Could not read rank:", error);
        await interaction.editReply({
            content: "❌ " + String(error.message || error).slice(0, 250),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
