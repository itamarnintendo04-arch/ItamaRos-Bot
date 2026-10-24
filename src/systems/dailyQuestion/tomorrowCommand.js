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
    );

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

    await interaction.editReply({
        content: [
            `✅ **Tomorrow's quiz was saved for ${date}!**`,
            `🧠 **Question:** ${question.replace(/@/g, "@\u200b")}`,
            "🔒 Correct answer saved privately.",
            "📅 Publishes at 07:00 (Israel time).",
            "🏆 Answer and winners announced at 21:00."
        ].join("\n"),
        allowedMentions: { parse: [] }
    });
}

module.exports = { data, execute };
