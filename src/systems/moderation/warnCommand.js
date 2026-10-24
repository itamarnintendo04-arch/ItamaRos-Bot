
"use strict";

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown
} = require("discord.js");

const {
  getDatabase
} = require("../../../database");

// ==========================================
// ITAMAROS BOT - MANUAL WARNING COMMAND
// ==========================================

const command = new SlashCommandBuilder()
  .setName("warn")
  .setDescription(
    "Send an official warning to a server member."
  )
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ModerateMembers
  )
  .addUserOption(option =>
    option
      .setName("user")
      .setDescription(
        "The member who should receive a warning."
      )
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName("reason")
      .setDescription(
        "Explain why the member is being warned."
      )
      .setMinLength(3)
      .setMaxLength(500)
      .setRequired(true)
  );

// ==========================================
// HELPERS
// ==========================================

function getWarningsCollection() {
  return getDatabase().collection(
    "moderation_warnings"
  );
}

function safeText(value) {
  return escapeMarkdown(
    String(value ?? "")
      .replace(/@everyone/gi, "@\u200beveryone")
      .replace(/@here/gi, "@\u200bhere")
      .trim()
  );
}

function buildWarningEmbed(guild, moderator, reason) {
  return new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle("⚠️ Official Server Warning")
    .setDescription(
      "You have received a warning from " +
      `**${safeText(guild.name)}**.\n\n` +
      "Please review the reason below and " +
      "follow the server rules."
    )
    .addFields(
      {
        name: "📝 Reason",
        value: safeText(reason)
      },
      {
        name: "🛡️ Issued By",
        value: safeText(moderator.username)
      }
    )
    .setFooter({
      text:
        "ItamaRos Moderation • " +
        "Please keep our community respectful 💜"
    })
    .setTimestamp();
}

async function sendPrivateReply(
  interaction,
  content
) {
  return interaction.editReply({
    content,
    allowedMentions: {
      parse: []
    }
  });
}

// ==========================================
// PERMISSION CHECKS
// ==========================================

async function validateTarget(
  interaction,
  targetUser
) {
  const guild = interaction.guild;

  if (!guild) {
    return {
      valid: false,
      reason:
        "❌ This command can only be used in a server."
    };
  }

  const moderator = await guild.members.fetch(
    interaction.user.id
  );

  const targetMember = await guild.members
    .fetch(targetUser.id)
    .catch(() => null);

  if (!targetMember) {
    return {
      valid: false,
      reason:
        "❌ The selected user is not a member of this server."
    };
  }

  if (targetUser.bot) {
    return {
      valid: false,
      reason:
        "❌ You cannot warn bots."
    };
  }

  if (targetUser.id === interaction.user.id) {
    return {
      valid: false,
      reason:
        "❌ You cannot warn yourself."
    };
  }

  if (targetUser.id === guild.ownerId) {
    return {
      valid: false,
      reason:
        "❌ You cannot warn the server owner."
    };
  }

  const isOwner =
    interaction.user.id === guild.ownerId;

  if (
    !isOwner &&
    moderator.roles.highest.comparePositionTo(
      targetMember.roles.highest
    ) <= 0
  ) {
    return {
      valid: false,
      reason:
        "❌ You cannot warn a member with an equal or higher role."
    };
  }

  return {
    valid: true,
    targetMember
  };
}

// ==========================================
// EXECUTE /warn
// ==========================================

async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({
      content:
        "❌ This command is only available in a server.",
      flags: MessageFlags.Ephemeral
    });
  }

  const isOwner =
    interaction.user.id ===
    interaction.guild.ownerId;

  const canModerate =
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ModerateMembers
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    );

  if (!isOwner && !canModerate) {
    return interaction.reply({
      content:
        "❌ Only server moderators can use this command.",
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    const targetUser =
      interaction.options.getUser(
        "user",
        true
      );

    const reason =
      interaction.options.getString(
        "reason",
        true
      ).trim();

    const validation = await validateTarget(
      interaction,
      targetUser
    );

    if (!validation.valid) {
      return sendPrivateReply(
        interaction,
        validation.reason
      );
    }

    const guild = interaction.guild;

    // Record warning before attempting the DM.
    const result =
      await getWarningsCollection().insertOne({
        guildId: guild.id,
        userId: targetUser.id,
        moderatorId: interaction.user.id,
        reason,
        source: "manual",
        createdAt: new Date(),
        dmDelivered: false,
        status: "pending"
      });

    const embed = buildWarningEmbed(
      guild,
      interaction.user,
      reason
    );

    let delivered = false;

    try {
      await targetUser.send({
        embeds: [embed],
        allowedMentions: {
          parse: []
        }
      });

      delivered = true;
    } catch (error) {
      console.warn(
        "[Warn] Failed to deliver DM:",
        error.message
      );
    }

    await getWarningsCollection().updateOne(
      {
        _id: result.insertedId
      },
      {
        $set: {
          dmDelivered: delivered,
          status: delivered
            ? "delivered"
            : "dm_failed",
          updatedAt: new Date()
        }
      }
    );

    if (!delivered) {
      return sendPrivateReply(
        interaction,
        "⚠️ **Warning Recorded**\n\n" +
        `👤 User: ${targetUser.username}\n` +
        `📝 Reason: ${reason}\n\n` +
        "The warning was saved, but I couldn't " +
        "send the user a DM. They may have " +
        "disabled private messages."
      );
    }

    return sendPrivateReply(
      interaction,
      "✅ **Warning Sent Successfully!**\n\n" +
      `👤 User: ${targetUser.username}\n` +
      `📝 Reason: ${reason}\n\n` +
      "📩 The user received a private warning.\n" +
      "💾 The warning was saved in MongoDB."
    );
  } catch (error) {
    console.error(
      "[Warn] Command failed:",
      error
    );

    return sendPrivateReply(
      interaction,
      "❌ An error occurred while processing " +
      "this warning."
    ).catch(() => {});
  }
}

module.exports = {
  data: command,
  execute
};
