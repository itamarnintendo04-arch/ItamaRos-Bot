"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { getDatabase } = require("../../../database");
const {
    getTomorrowQuizDate,
    normalizeAnswer
} = require("./quiz");
const { getStreak, startStreak } = require("./streak");

const data = new SlashCommandBuilder()
    .setName("quiz-tomorrow")
    .setDescription("Set tomorrow's Daily Quiz question and answer")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
        option.setName("question")
            .setDescription("Question to post tomorrow at 07:00")
            .setMinLength(1)
            .setMaxLength(250)
            .setRequired(true)
    )
    .addStringOption(option =>
        option.setName("answer")
            .setDescription("Correct answer, revealed tomorrow at 21:00")
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true)
    )
    .addIntegerOption(o => o.setName("streak_days")
        .setDescription("Start a prize streak tomorrow (2–30 consecutive days)")
        .setMinValue(2).setMaxValue(30).setRequired(false));

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
        await interaction.reply({
            content: "❌ This command requires Manage Server permission in the configured server.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const question = interaction.options
        .getString("question", true).trim();

    const answer = interaction.options
        .getString("answer", true).trim();

    if (!question || !normalizeAnswer(answer)) {
        await interaction.reply({
            content: "❌ Enter a meaningful question and answer.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const date = getTomorrowQuizDate();
    const streakDays = interaction.options.getInteger("streak_days");
    if (streakDays) {
        const active = await getStreak(interaction.guildId);
        if (active && active.status !== "cancelled" && active.endDate >= date) {
            await interaction.editReply({ content:
                "❌ A Daily Quiz prize streak is already scheduled. Use /quiz-streak status." });
            return;
        }
    }
    const id = `${interaction.guildId}:${date}`;
    const collection = getDatabase().collection("daily_quizzes");
    const current = await collection.findOne({ _id: id });

    if (current?.messageId ||
        current?.publishedAt ||
        current?.publishing) {
        await interaction.editReply({
            content: "❌ That question is already being published or has been published."
        });
        return;
    }

    const update = {
        $set: {
            guildId: interaction.guildId,
            date,
            question,
            answer,
            preparedAt: new Date(),
            preparedBy: interaction.user.id
        }
    };

    if (current) {
        const result = await collection.updateOne(
            {
                _id: id,
                messageId: { $exists: false },
                publishing: { $exists: false }
            },
            update
        );

        if (!result.matchedCount) {
            await interaction.editReply({
                content: "❌ This question can no longer be changed."
            });
            return;
        }
    } else {
        try {
            await collection.insertOne({
                _id: id,
                ...update.$set
            });
        } catch (error) {
            if (error.code === 11000) {
                await interaction.editReply({
                    content: "⚠️ Another manager saved this question. Please run the command again to replace it."
                });
                return;
            }
            throw error;
        }
    }

    if (streakDays) {
        try {
            await startStreak(interaction.guildId, date, streakDays, interaction.user.id);
        } catch (error) {
            await interaction.editReply({ content: "⚠️ Tomorrow\u0027s quiz was saved, but the streak could not be started: " + error.message });
            return;
        }
    }

    await interaction.editReply({
        content: [
            `✅ **Tomorrow's quiz was saved for ${date}!**`,
            `🧠 **Question:** ${question.replace(/@/g, "@\u200b")}`,
            "🔒 Correct answer saved privately.",
            "📅 Publishes at 07:00 on the server\u0027s daily schedule.",
            "🏆 Answer and winners announced at 21:00.",
            ...(streakDays ? [
                "🏆 **Prize streak started:** " + streakDays + " days, beginning tomorrow.",
                "Prepare days 2–" + streakDays + " with /quiz-streak set-day.",
                "Correctly complete every daily question to receive a prize ticket."
            ] : [])
        ].join("\n"),
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
