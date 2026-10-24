
"use strict";

const {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

// ==========================================
// ITAMAROS BOT - MULTILINGUAL WORD FILTER
// ==========================================

const SETTINGS = {
  enabled: true,
  warningCooldownMs: 120000,
  maxMessageLength: 4000
};

// Edit this list whenever you want.
const BLOCKED_WORDS = {
  hebrew: [
    "מטומטם",
    "מטומטמת",
    "אידיוט",
    "אידיוטית",
    "דביל",
    "דבילית",
    "טיפש",
    "טיפשה",
    "סתום",
    "סתמי"
  ],

  english: [
    "idiot",
    "moron",
    "loser",
    "shut up"
  ],

  arabic: [
    "غبي",
    "غبية",
    "أحمق"
  ],

  spanish: [
    "idiota",
    "imbécil",
    "estúpido"
  ],

  french: [
    "imbécile",
    "stupide"
  ],

  german: [
    "dummkopf",
    "schwachkopf"
  ],

  russian: [
    "идиот",
    "дурак"
  ],

  portuguese: [
    "burro",
    "burra"
  ]
};

const cooldowns = new Map();
const activeUsers = new Set();

function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase();
}

function escapeRegex(text) {
  return text.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

// Require complete words or phrases.
// "idiot" does not match "idiotic".
const compiledWords = Object.entries(
  BLOCKED_WORDS
).flatMap(([language, words]) => {
  return words.map(word => ({
    language,
    word,
    regex: new RegExp(
      `(^|[^\\p{L}\\p{N}])(${escapeRegex(normalize(word))})(?=$|[^\\p{L}\\p{N}])`,
      "iu"
    )
  }));
});

function findBlockedWords(content) {
  const text = normalize(content);
  const found = [];

  for (const entry of compiledWords) {
    const match = entry.regex.exec(text);

    if (!match) continue;

    found.push({
      word: match[2],
      language: entry.language
    });
  }

  return found;
}

function isOnCooldown(message) {
  const key =
    `${message.guild.id}:${message.author.id}`;

  const previous = cooldowns.get(key) || 0;

  return (
    Date.now() - previous <
    SETTINGS.warningCooldownMs
  );
}

function applyCooldown(message) {
  const key =
    `${message.guild.id}:${message.author.id}`;

  cooldowns.set(key, Date.now());

  if (cooldowns.size > 1000) {
    const now = Date.now();

    for (const [userId, time] of cooldowns) {
      if (
        now - time >
        SETTINGS.warningCooldownMs
      ) {
        cooldowns.delete(userId);
      }
    }
  }
}

async function getPrivateLogChannel(guild) {
  const id = process.env.MOD_LOG_CHANNEL_ID;

  if (!id) return null;

  const channel = await guild.channels
    .fetch(id)
    .catch(() => null);

  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    channel.guildId !== guild.id
  ) {
    return null;
  }

  // Never send message reports into a public channel.
  const everyonePermissions =
    channel.permissionsFor(
      guild.roles.everyone
    );

  if (
    !everyonePermissions ||
    everyonePermissions.has(
      PermissionFlagsBits.ViewChannel
    )
  ) {
    console.warn(
      "[Word Filter] Log channel is not private."
    );

    return null;
  }

  return channel;
}

async function sendStaffReport(message, matches) {
  const channel = await getPrivateLogChannel(
    message.guild
  );

  if (!channel) return;

  const words = matches
    .map(match =>
      `${match.word} (${match.language})`
    )
    .join(", ");

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("🛡️ Word Filter Report")
    .addFields(
      {
        name: "👤 User",
        value:
          `Username: ${message.author.username}\n` +
          `User ID: ${message.author.id}`
      },
      {
        name: "📍 Channel",
        value: `<#${message.channelId}>`
      },
      {
        name: "🔎 Matched Words",
        value: words.slice(0, 1024)
      },
      {
        name: "📨 Original Message",
        value:
          "The complete message is attached."
      },
      {
        name: "🔗 Message Link",
        value: message.url
      }
    )
    .setFooter({
      text:
        "Keyword match only. Staff must review context."
    })
    .setTimestamp();

  const attachment = new AttachmentBuilder(
    Buffer.from(message.content, "utf8"),
    {
      name: `message-${message.id}.txt`
    }
  );

  await channel.send({
    embeds: [embed],
    files: [attachment],
    allowedMentions: {
      parse: []
    }
  });
}

async function warnAboutLanguage(message) {
  await message.reply({
    content: [
      "🛡️ **Please Keep It Respectful!**",
      "",
      "Your message may contain language",
      "that is disrespectful to others.",
      "",
      "Please keep our community friendly. 💜"
    ].join("\n"),

    allowedMentions: {
      parse: [],
      repliedUser: false
    }
  });
}

async function handleWordFilter(message) {
  if (!SETTINGS.enabled) return false;

  if (!message?.inGuild?.()) {
    return false;
  }

  if (
    message.author.bot ||
    message.webhookId
  ) {
    return false;
  }

  if (
    !message.content ||
    message.content.length >
    SETTINGS.maxMessageLength
  ) {
    return false;
  }

  const matches = findBlockedWords(
    message.content
  );

  if (!matches.length) return false;

  const key =
    `${message.guild.id}:${message.author.id}`;

  if (
    isOnCooldown(message) ||
    activeUsers.has(key)
  ) {
    return false;
  }

  activeUsers.add(key);

  try {
    await warnAboutLanguage(message);

    applyCooldown(message);

    await sendStaffReport(
      message,
      matches
    ).catch(error => {
      console.error(
        "[Word Filter] Staff report failed:",
        error.message
      );
    });

    return true;
  } catch (error) {
    console.error(
      "[Word Filter] Warning failed:",
      error.message
    );

    return false;
  } finally {
    activeUsers.delete(key);
  }
}

module.exports = {
  BLOCKED_WORDS,
  findBlockedWords,
  handleWordFilter
};
