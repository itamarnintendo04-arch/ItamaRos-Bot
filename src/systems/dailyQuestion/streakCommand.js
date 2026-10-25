"use strict";

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder
} = require("discord.js");
const {
    getStreakStats, scheduleStreakDay, cancelStreak
} = require("./streak");
const { normalizeAnswer } = require("./quiz");

const data = new SlashCommandBuilder()
    .setName("quiz-streak")
    .setDescription("Manage the upcoming multi-day Daily Quiz prize streak")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("status")
        .setDescription("See the streak and its prepared questions"))
    .addSubcommand(s => s.setName("set-day")
        .setDescription("Prepare a question for a specific day of the streak")
        .addIntegerOption(o => o.setName("day")
            .setDescription("Day number inside the streak")
            .setMinValue(1).setMaxValue(30).setRequired(true))
        .addStringOption(o => o.setName("question")
            .setDescription("The question for this day")
            .setMinLength(1).setMaxLength(250).setRequired(true))
        .addStringOption(o => o.setName("answer")
            .setDescription("Correct answer (kept private until reveal)")
            .setMinLength(1).setMaxLength(100).setRequired(true)))
    .addSubcommand(s => s.setName("cancel")
        .setDescription("End the scheduled streak without cancelling normal quizzes"));

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID ||
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: "❌ Manage Server permission is required in the configured guild.",
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const choice = interaction.options.getSubcommand();
        if (choice === "cancel") {
            const cancelled = await cancelStreak(interaction.guildId);
            return interaction.editReply({ content: cancelled
                ? "✅ Daily Quiz prize streak cancelled. Scheduled regular questions remain."
                : "ℹ️ There is no active prize streak to cancel." });
        }
        if (choice === "set-day") {
            const question = interaction.options.getString("question", true).trim();
            const answer = interaction.options.getString("answer", true).trim();
            if (!normalizeAnswer(answer)) throw Error("Please provide a valid answer.");
            const record = await scheduleStreakDay(
                interaction.guildId, interaction.options.getInteger("day", true),
                question, answer, interaction.user.id
            );
            return interaction.editReply({
                content: "✅ Day " + record.day + "/" + record.days +
                    " prepared for " + record.date +
                    ". The correct answer is saved privately."
            });
        }
        const data = await getStreakStats(interaction.guildId);
        if (!data) return interaction.editReply({
            content: "No streak configured. Use /quiz-tomorrow with streak_days to start one."
        });
        const schedule = data.schedule.map(item =>
            (item.prepared ? "✅" : "❌") + " **Day " + item.number +
            "** (" + item.date + ")" +
            (item.published ? " • Published" : "")
        );
        const embed = new EmbedBuilder()
            .setColor(0xA77FEF)
            .setTitle("🏆 Daily Quiz Prize Streak")
            .setDescription([
                "**Status:** " + data.status,
                "**Dates:** " + data.startDate + " → " + data.endDate,
                "**Duration:** " + data.days + " days",
                "**Prepared questions:** " + data.daysPrepared +
                    "/" + data.days,
                "",
                "**Daily questions**",
                schedule.join("\n"),
                "",
                "Participants must answer every scheduled day correctly.",
                "A private prize-claim ticket opens after a fully completed streak.",
                "Use /quiz-streak set-day to schedule later days."
            ].join("\n").slice(0, 4000));
        return interaction.editReply({ embeds: [embed] });
    } catch (error) {
        return interaction.editReply({
            content: "❌ " + String(error.message || error).slice(0, 350)
        });
    }
}

module.exports = { data, execute };
