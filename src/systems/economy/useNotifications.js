"use strict";

const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../../../database");

function useHistory() {
    return getDatabase().collection("economy_item_use_notifications");
}

function safe(value, n = 100) {
    return String(value || "")
        .replace(/[<>\u0000-\u001f\u007f]/g, "")
        .replace(/@/g, "@\u200b")
        .slice(0, n);
}

async function notifyItemUsed({ guild, user, item, action }) {
    if (!guild || !user || !item) return;

    const event = {
        guildId: guild.id,
        userId: user.id,
        itemKey: item.key,
        itemName: item.name,
        itemType: item.type,
        action: action || "used",
        createdAt: new Date()
    };

    try {
        await useHistory().insertOne(event);
    } catch (error) {
        console.warn(
            "[Item Store] Item-use audit could not be written:",
            error.message
        );
    }

    const embed = new EmbedBuilder()
        .setTitle("📦 Store Item Used")
        .setColor(0x8B5CF6)
        .setDescription([
            "**Member:** <@" + user.id + ">",
            "**Item:** " + safe(item.name),
            "**Product ID:** " + safe(item.key, 50),
            "**Type:** " + safe(item.type, 30),
            "**Action:** " + safe(action || "used", 35)
        ].join("\n"))
        .setTimestamp();

    const message = {
        embeds: [embed],
        allowedMentions: { parse: [] }
    };

    const channelId = process.env.MOD_LOG_CHANNEL_ID ||
        process.env.GIVEAWAY_ADMIN_CHANNEL_ID;
    if (channelId) {
        try {
            const channel = await guild.channels.fetch(channelId)
                .catch(() => null);
            const publicView = channel?.permissionsFor(
                guild.roles.everyone
            )?.has(PermissionFlagsBits.ViewChannel);
            const bot = await guild.members.fetchMe();
            const botCanSend = channel?.permissionsFor(bot)?.has(
                PermissionFlagsBits.SendMessages
            );

            if (channel?.isTextBased?.() &&
                typeof channel.send === "function" &&
                publicView === false && botCanSend) {
                await channel.send(message);
            } else {
                console.warn(
                    "[Item Store] Private moderation log unavailable."
                );
            }
        } catch (error) {
            console.warn(
                "[Item Store] Failed to notify mod-log:",
                error.message
            );
        }
    }

    // Staff-owner DM is a fallback, and keeps the server owner
    // informed even when a private mod-log channel isn't configured.
    try {
        const owner = await guild.fetchOwner();
        await owner.send(message);
    } catch (error) {
        console.warn(
            "[Item Store] Could not DM guild owner:",
            error.message
        );
    }
}

module.exports = { notifyItemUsed };
