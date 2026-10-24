
"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { getDatabase } = require("../../../database");

const SETTINGS = Object.freeze({
  timeZone: "Asia/Jerusalem",
  questionHour: 7,
  revealHour: 21,
  ownerPromptMinute: 5,
  checkEveryMs: 30000
});

const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: SETTINGS.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

let timer = null;
let busy = false;

// ======================================
// DATE HELPERS
// ======================================

function localTime() {
  const parts = Object.fromEntries(
    clock.formatToParts(new Date())
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return {
    date:
      `${parts.year}-${parts.month}-${parts.day}`,

    minutes:
      Number(parts.hour) * 60 +
      Number(parts.minute)
  };
}

function tomorrow(date) {
  const value = new Date(
    `${date}T00:00:00.000Z`
  );

  value.setUTCDate(
    value.getUTCDate() + 1
  );

  return value.toISOString().slice(0, 10);
}

// ======================================
// MONGODB
// ======================================

function quizzes() {
  return getDatabase().collection(
    "daily_quizzes"
  );
}

function answers() {
  return getDatabase().collection(
    "daily_quiz_winners"
  );
}

function prompts() {
  return getDatabase().collection(
    "daily_quiz_prompts"
  );
}

function quizId(guildId, date) {
  return `${guildId}:${date}`;
}

function normalizeAnswer(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ======================================
// DISCORD HELPERS
// ======================================

async function getGuild(client) {
  if (!process.env.GUILD_ID) {
    throw new Error("Missing GUILD_ID");
  }

  return client.guilds.fetch(
    process.env.GUILD_ID
  );
}

async function getTextChannel(client, id) {
  if (!id) return null;

  const channel = await client.channels
    .fetch(id)
    .catch(() => null);

  return channel?.type === ChannelType.GuildText
    ? channel
    : null;
}

function replyOptions(interaction, content) {
  return {
    content,
    allowedMentions: {
      parse: []
    },
    ...(interaction.inGuild()
      ? { flags: MessageFlags.Ephemeral }
      : {})
  };
}

function inputModal(id, title, fields) {
  const modal = new ModalBuilder()
    .setCustomId(id)
    .setTitle(title);

  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(
        field.long
          ? TextInputStyle.Paragraph
          : TextInputStyle.Short
      )
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(field.max);

    modal.addComponents(
      new ActionRowBuilder()
        .addComponents(input)
    );
  }

  return modal;
}

// ======================================
// QUESTION DISPLAY
// ======================================

function questionEmbed(quiz, reveal = false) {
  const description = reveal
    ? (
        `**${quiz.question}**\n\n` +
        `✅ **Correct answer:** ${quiz.answer}`
      )
    : (
        `**${quiz.question}**\n\n` +
        "🔐 Answer using the button below!\n" +
        "Answers stay private until 9 PM."
      );

  return new EmbedBuilder()
    .setColor(
      reveal ? 0x57f287 : 0x9b59b6
    )
    .setTitle(
      "🎮 ItamaRos | Question of the Day"
    )
    .setDescription(description)
    .setFooter({
      text:
        `Question for ${quiz.date} • Israel time`
    });
}

function answerButton(date, disabled = false) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`dq:answer:${date}`)
        .setLabel(
          disabled
            ? "Answers Closed"
            : "Answer Privately"
        )
        .setEmoji(
          disabled ? "🔒" : "✍️"
        )
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
}

// ======================================
// 07:00 - PUBLISH QUESTION
// ======================================

async function publishQuestion(client, date) {
  const guild = await getGuild(client);

  const questionChannel = await getTextChannel(
    client,
    process.env.DAILY_QUESTION_CHANNEL_ID
  );

  if (
    !questionChannel ||
    questionChannel.guildId !== guild.id
  ) {
    return;
  }

  const id = quizId(guild.id, date);

  const quiz = await quizzes().findOne({
    _id: id
  });

  if (
    !quiz?.question ||
    !quiz?.answer ||
    quiz.messageId
  ) {
    return;
  }

  const reservation = await quizzes().updateOne(
    {
      _id: id,
      messageId: { $exists: false },
      publishing: { $exists: false }
    },
    {
      $set: { publishing: true }
    }
  );

  if (!reservation.modifiedCount) {
    return;
  }

  try {
    const message = await questionChannel.send({
      content: "@everyone",
      embeds: [questionEmbed(quiz)],
      components: [answerButton(date)],
      allowedMentions: {
        parse: ["everyone"]
      }
    });

    await quizzes().updateOne(
      { _id: id },
      {
        $set: {
          messageId: message.id,
          channelId: questionChannel.id,
          publishedAt: new Date()
        },
        $unset: {
          publishing: ""
        }
      }
    );

    console.log(
      `[Daily Quiz] Published ${date}`
    );
  } catch (error) {
    await quizzes().updateOne(
      {
        _id: id,
        messageId: { $exists: false }
      },
      {
        $unset: { publishing: "" }
      }
    ).catch(() => {});

    throw error;
  }
}

// ======================================
// 21:00 - REVEAL AND ANNOUNCE
// ======================================

async function revealQuestion(client, date) {
  const guild = await getGuild(client);
  const id = quizId(guild.id, date);

  const quiz = await quizzes().findOne({
    _id: id
  });

  if (!quiz?.messageId) {
    return;
  }

  // Winners are announced in the SAME channel
  // where the daily question was published.
  const questionChannel = await getTextChannel(
    client,
    quiz.channelId
  );

  if (
    !questionChannel ||
    questionChannel.guildId !== guild.id
  ) {
    return;
  }

  // First reveal the correct answer.
  if (!quiz.revealedAt) {
    const reservation = await quizzes().updateOne(
      {
        _id: id,
        revealedAt: { $exists: false },
        revealing: { $exists: false }
      },
      {
        $set: { revealing: true }
      }
    );

    if (!reservation.modifiedCount) {
      return;
    }

    try {
      const message =
        await questionChannel.messages.fetch(
          quiz.messageId
        );

      await message.edit({
        content: "🏁 **Today's quiz is over!**",
        embeds: [questionEmbed(quiz, true)],
        components: [
          answerButton(date, true)
        ],
        allowedMentions: {
          parse: []
        }
      });

      await quizzes().updateOne(
        { _id: id },
        {
          $set: {
            revealedAt: new Date()
          },
          $unset: {
            revealing: ""
          }
        }
      );
    } catch (error) {
      await quizzes().updateOne(
        { _id: id },
        {
          $unset: { revealing: "" }
        }
      ).catch(() => {});

      throw error;
    }
  }

  // Avoid announcing results twice.
  const resultReservation =
    await quizzes().updateOne(
      {
        _id: id,
        announcedAt: { $exists: false },
        announcing: { $exists: false }
      },
      {
        $set: { announcing: true }
      }
    );

  if (!resultReservation.modifiedCount) {
    return;
  }

  try {
    const winningEntries = await answers()
      .find({ quizId: id })
      .sort({ submittedAt: 1 })
      .toArray();

    const winnerIds = [
      ...new Set(
        winningEntries.map(
          entry => entry.userId
        )
      )
    ];

    if (!winnerIds.length) {
      await questionChannel.send({
        content:
          `🏆 **Daily Quiz Results (${date})**\n\n` +
          "Nobody answered correctly today!\n\n" +
          `✅ Correct answer: **${quiz.answer}**\n\n` +
          "See you tomorrow! 💜",
        allowedMentions: {
          parse: []
        }
      });
    } else {
      for (
        let index = 0;
        index < winnerIds.length;
        index += 40
      ) {
        const group = winnerIds.slice(
          index,
          index + 40
        );

        const header = index === 0
          ? (
              "🏆 **DAILY QUIZ WINNERS!** 🏆\n\n" +
              `🎉 **${winnerIds.length} winners!**\n\n`
            )
          : (
              "🏆 **More Daily Quiz Winners!**\n\n"
            );

        const mentions = group
          .map(userId => `<@${userId}>`)
          .join(" ");

        const footer = index === 0
          ? (
              `\n\n✅ Correct answer: **${quiz.answer}**` +
              "\n\n💜 Congratulations!"
            )
          : "";

        await questionChannel.send({
          content: header + mentions + footer,
          allowedMentions: {
            parse: [],
            users: group
          }
        });
      }
    }

    await quizzes().updateOne(
      { _id: id },
      {
        $set: {
          announcedAt: new Date(),
          winnerCount: winnerIds.length
        },
        $unset: {
          announcing: ""
        }
      }
    );

    console.log(
      `[Daily Quiz] Announced ${winnerIds.length} ` +
      `winner(s) in ${questionChannel.id}`
    );
  } catch (error) {
    await quizzes().updateOne(
      { _id: id },
      {
        $unset: { announcing: "" }
      }
    ).catch(() => {});

    throw error;
  }
}

// ======================================
// 21:05 - DM SERVER OWNER
// ======================================

async function promptOwner(client, targetDate) {
  const guild = await getGuild(client);
  const id = quizId(guild.id, targetDate);

  const existing = await quizzes().findOne({
    _id: id
  });

  if (
    existing?.question &&
    existing?.answer
  ) {
    return;
  }

  try {
    await prompts().insertOne({
      _id: id,
      createdAt: new Date()
    });
  } catch (error) {
    if (error.code === 11000) {
      return;
    }

    throw error;
  }

  try {
    const owner = await guild.fetchOwner();

    const button = new ButtonBuilder()
      .setCustomId(
        `dq:prepare:${targetDate}`
      )
      .setLabel(
        "Set Tomorrow's Question"
      )
      .setStyle(ButtonStyle.Success);

    await owner.send({
      content:
        "🧠 **Prepare Tomorrow's Quiz!**\n\n" +
        `Date: **${targetDate}**\n\n` +
        "Choose tomorrow's question and its " +
        "correct answer.\n" +
        "The answer will remain private " +
        "until 9 PM.",
      components: [
        new ActionRowBuilder()
          .addComponents(button)
      ],
      allowedMentions: {
        parse: []
      }
    });
  } catch (error) {
    await prompts().deleteOne({
      _id: id
    });

    throw error;
  }
}

// ======================================
// AUTOMATIC SCHEDULER
// ======================================

async function tick(client) {
  if (busy) return;

  busy = true;

  try {
    const { date, minutes } = localTime();

    const publishAt =
      SETTINGS.questionHour * 60;

    const revealAt =
      SETTINGS.revealHour * 60;

    if (
      minutes >= publishAt &&
      minutes < publishAt + 60
    ) {
      await publishQuestion(client, date);
    }

    if (
      minutes >= revealAt &&
      minutes < revealAt + 60
    ) {
      await revealQuestion(client, date);
    }

    if (
      minutes >= revealAt +
      SETTINGS.ownerPromptMinute
    ) {
      await promptOwner(
        client,
        tomorrow(date)
      );
    }
  } catch (error) {
    console.error(
      "[Daily Quiz] Scheduler error:",
      error
    );
  } finally {
    busy = false;
  }
}

function startQuizScheduler(client) {
  if (timer) return;

  void tick(client);

  timer = setInterval(
    () => void tick(client),
    SETTINGS.checkEveryMs
  );

  console.log(
    "[Daily Quiz] 07:00 question, " +
    "21:00 results, 21:05 owner DM."
  );
}

function stopQuizScheduler() {
  if (timer) {
    clearInterval(timer);
  }

  timer = null;
}

// ======================================
// BUTTONS AND MODALS
// ======================================

async function handleQuizInteraction(interaction) {
  const customId = interaction.customId;

  if (!customId?.startsWith("dq:")) {
    return false;
  }

  const guild = await getGuild(
    interaction.client
  );

  const {
    date: today,
    minutes
  } = localTime();

  // OWNER OPENS QUESTION FORM
  if (
    interaction.isButton() &&
    customId.startsWith("dq:prepare:")
  ) {
    const targetDate = customId.slice(
      "dq:prepare:".length
    );

    if (
      interaction.user.id !== guild.ownerId ||
      targetDate <= today
    ) {
      await interaction.reply(
        replyOptions(
          interaction,
          "❌ Only the server owner may prepare a future question."
        )
      );

      return true;
    }

    await interaction.showModal(
      inputModal(
        `dq:save:${targetDate}`,
        "Tomorrow's Daily Quiz",
        [
          {
            id: "question",
            label: "Question",
            long: true,
            max: 250
          },
          {
            id: "answer",
            label: "Correct answer",
            max: 100
          }
        ]
      )
    );

    return true;
  }

  // OWNER SAVES QUESTION AND ANSWER
  if (
    interaction.isModalSubmit() &&
    customId.startsWith("dq:save:")
  ) {
    const targetDate = customId.slice(
      "dq:save:".length
    );

    if (
      interaction.user.id !== guild.ownerId ||
      targetDate <= today
    ) {
      await interaction.reply(
        replyOptions(
          interaction,
          "❌ This setup form has expired."
        )
      );

      return true;
    }

    const question = interaction.fields
      .getTextInputValue("question")
      .trim();

    const answer = interaction.fields
      .getTextInputValue("answer")
      .trim();

    if (!normalizeAnswer(answer)) {
      await interaction.reply(
        replyOptions(
          interaction,
          "❌ Please enter a meaningful answer."
        )
      );

      return true;
    }

    const id = quizId(
      guild.id,
      targetDate
    );

    const existing = await quizzes().findOne({
      _id: id
    });

    if (existing?.messageId) {
      await interaction.reply(
        replyOptions(
          interaction,
          "❌ This question is already published."
        )
      );

      return true;
    }

    await quizzes().updateOne(
      { _id: id },
      {
        $set: {
          guildId: guild.id,
          date: targetDate,
          question,
          answer,
          preparedAt: new Date()
        }
      },
      { upsert: true }
    );

    await interaction.reply(
      replyOptions(
        interaction,
        `✅ Question for ${targetDate} saved!`
      )
    );

    return true;
  }

  // MEMBER OPENS ANSWER FORM
  if (
    interaction.isButton() &&
    customId.startsWith("dq:answer:")
  ) {
    const date = customId.slice(
      "dq:answer:".length
    );

    const record = await quizzes().findOne({
      _id: quizId(guild.id, date)
    });

    if (
      !interaction.inGuild() ||
      interaction.guildId !== guild.id ||
      date !== today ||
      minutes >= SETTINGS.revealHour * 60 ||
      !record?.messageId ||
      record.revealedAt
    ) {
      await interaction.reply(
        replyOptions(
          interaction,
          "🔒 Answers are closed."
        )
      );

      return true;
    }

    await interaction.showModal(
      inputModal(
        `dq:submit:${date}`,
        "Submit Your Answer",
        [
          {
            id: "answer",
            label: "Your answer",
            max: 100
          }
        ]
      )
    );

    return true;
  }

  // CHECK MEMBER ANSWER
  if (
    interaction.isModalSubmit() &&
    customId.startsWith("dq:submit:")
  ) {
    const date = customId.slice(
      "dq:submit:".length
    );

    const id = quizId(guild.id, date);

    const record = await quizzes().findOne({
      _id: id
    });

    if (
      !interaction.inGuild() ||
      interaction.guildId !== guild.id ||
      date !== today ||
      minutes >= SETTINGS.revealHour * 60 ||
      !record?.messageId ||
      record.revealedAt
    ) {
      await interaction.reply(
        replyOptions(
          interaction,
          "🔒 Answers are closed."
        )
      );

      return true;
    }

    const submittedAnswer = interaction.fields
      .getTextInputValue("answer");

    const correct =
      normalizeAnswer(submittedAnswer) ===
      normalizeAnswer(record.answer);

    if (!correct) {
      await interaction.reply(
        replyOptions(
          interaction,
          "❌ Not quite! Try again before 9 PM."
        )
      );

      return true;
    }

    try {
      await answers().insertOne({
        _id: `${id}:${interaction.user.id}`,
        quizId: id,
        userId: interaction.user.id,
        submittedAt: new Date()
      });

      await interaction.reply(
        replyOptions(
          interaction,
          "✅ Correct! You're on today's winners list! 🎉"
        )
      );
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      await interaction.reply(
        replyOptions(
          interaction,
          "✅ You already answered correctly! 🎉"
        )
      );
    }

    return true;
  }

  return false;
}

module.exports = {
  startQuizScheduler,
  stopQuizScheduler,
  handleQuizInteraction,
  getTomorrowQuizDate: () => tomorrow(localTime().date),
  normalizeAnswer
};
