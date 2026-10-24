"use strict";

const {
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");

const youtube = require("./watcher");

// Settings and announced video IDs are persisted in MongoDB,
// so restarting Render does not reset the subscription.

const data = new SlashCommandBuilder()
    .setName("youtube")
    .setDescription("Manage YouTube video, Shorts and livestream alerts")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("setup")
            .setDescription("Send new YouTube uploads and livestreams to a Discord channel")
            .addChannelOption(option =>
                option.setName("updates_channel")
                    .setDescription("Discord text/announcement channel for updates")
                    .addChannelTypes(
                        ChannelType.GuildText,
                        ChannelType.GuildAnnouncement
                    )
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName("youtube_channel")
                    .setDescription("YouTube @handle, UC... channel ID or URL (default @ItamaRos)")
                    .setMinLength(2)
                    .setMaxLength(200)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("status")
            .setDescription("Show the YouTube subscription")
    )
    .addSubcommand(sub =>
        sub.setName("check")
            .setDescription("Check for new YouTube content now")
    )
    .addSubcommand(sub =>
        sub.setName("disable")
            .setDescription("Stop sending YouTube updates")
    );

function channelDefault() {
    return process.env.YOUTUBE_CHANNEL_ID ||
        process.env.YOUTUBE_CHANNEL_HANDLE ||
        "@ItamaRos";
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

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const action = interaction.options.getSubcommand();

    try {
        if (action === "setup") {
            const channel = interaction.options.getChannel(
                "updates_channel", true
            );

            const source = (
                interaction.options.getString("youtube_channel") ||
                channelDefault()
            ).trim();

            if (
                channel.guildId !== interaction.guildId ||
                ![ChannelType.GuildText, ChannelType.GuildAnnouncement]
                    .includes(channel.type)
            ) {
                await interaction.editReply({
                    content: "❌ Select a server text or announcement channel."
                });
                return;
            }

            // Catch missing Discord posting permissions before saving.
            await youtube.updatesChannel(interaction.client, {
                guildId: interaction.guildId,
                discordChannelId: channel.id
            });

            const subscription = await youtube.setup({
                guildId: interaction.guildId,
                youtubeSource: source,
                discordChannelId: channel.id
            });

            await interaction.editReply({
                content: [
                    "✅ **YouTube updates enabled!**",
                    "",
                    "📺 **YouTube:** https://www.youtube.com/channel/" +
                        subscription.channelId,
                    "📢 **Discord updates:** <#" +
                        subscription.discordChannelId + ">",
                    "",
                    "🎬 Shorts: **New Short Uploaded!**",
                    "🎥 Videos: **New Video Uploaded!**",
                    "🔴 Livestreams: **New Live Started!**",
                    "",
                    "✅ " + subscription.seededCount +
                        " existing uploads remembered (no old-video spam).",
                    "New posts are checked automatically every few minutes.",
                    "Optional: set YOUTUBE_API_KEY in Render for" +
                        " more reliable live detection."
                ].join("\n"),
                allowedMentions: { parse: [] }
            });

            return;
        }

        const subscription = await youtube.getConfig(
            interaction.guildId
        );

        if (!subscription) {
            await interaction.editReply({
                content: "⚠️ Not configured yet. Use /youtube setup."
            });
            return;
        }

        if (action === "status") {
            const sourceName = String(
                subscription.youtubeSource || "Unknown"
            ).replace(/@/g, "@\u200b");

            await interaction.editReply({
                content: [
                    "📺 **YouTube Updates**",
                    "",
                    "**Status:** " +
                        (subscription.enabled ? "🟢 Enabled" : "🔴 Disabled"),
                    "**YouTube:** https://www.youtube.com/channel/" +
                        subscription.channelId,
                    "**Discord:** <#" + subscription.discordChannelId + ">",
                    "**Configured source:** " + sourceName,
                    "**Interval:** " +
                        (process.env.YOUTUBE_CHECK_INTERVAL_MINUTES || "3") +
                        " minutes",
                    "",
                    "Run /youtube check to look for uploads now."
                ].join("\n"),
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (action === "check") {
            if (!subscription.enabled) {
                await interaction.editReply({
                    content: "⚠️ Tracking is disabled. Run /youtube setup."
                });
                return;
            }

            const result = await youtube.pollGuild(
                interaction.client,
                subscription
            );

            await interaction.editReply({
                content: [
                    "🔎 **YouTube check complete!**",
                    "**Videos checked:** " + result.checked,
                    "**Notifications sent:** " + result.sent
                ].join("\n")
            });
            return;
        }

        if (action === "disable") {
            await youtube.disable(interaction.guildId);
            await interaction.editReply({
                content: "✅ YouTube updates disabled. Re-enable with /youtube setup."
            });
            return;
        }

        await interaction.editReply({
            content: "❌ Unsupported YouTube action."
        });
    } catch (error) {
        console.error("[YouTube] Command error:", error);
        const reason = String(error?.message || "");
        const canReveal = /youtube|channel|feed|permission|HTTP 4[0-9]{2}/i
            .test(reason);

        await interaction.editReply({
            content: canReveal
                ? "❌ YouTube check/setup failed: " + reason.slice(0, 450)
                : "❌ YouTube request failed. Check the Render logs."
        }).catch(() => {});
    }
}

module.exports = { data, execute };
