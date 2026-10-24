"use strict";

const { getDatabase } = require("../../../database");
const { PermissionFlagsBits } = require("discord.js");
const feed = require("./feed");

const CONFIG_COLLECTION = "youtube_subscriptions";
const SEEN_COLLECTION = "youtube_notifications";
const MAX_NEW_UPLOAD_AGE_MS = 48 * 60 * 60 * 1000;
const YOUTUBE_ID = /^UC[A-Za-z0-9_-]{22}$/;
const DISCORD_ID = /^\d{17,20}$/;

function renderConfig() {
    return {
        guildId: (process.env.GUILD_ID || "").trim(),
        youtubeChannelId: (process.env.YOUTUBE_CHANNEL_ID || "").trim(),
        discordChannelId: (
            process.env.YOUTUBE_UPDATES_CHANNEL_ID ||
            process.env.DISCORD_UPDATES_CHANNEL_ID ||
            ""
        ).trim()
    };
}

let scheduler = null;
let running = false;

function settings() {
    return getDatabase().collection(CONFIG_COLLECTION);
}

function seen() {
    return getDatabase().collection(SEEN_COLLECTION);
}

function checkInterval() {
    const entered = Number(
        process.env.YOUTUBE_CHECK_INTERVAL_MINUTES || 3
    );

    const minutes = Number.isFinite(entered)
        ? Math.max(2, Math.min(30, entered))
        : 3;

    return Math.round(minutes * 60000);
}

async function getConfig(guildId) {
    return settings().findOne({ _id: guildId });
}

function seenId(guildId, videoId) {
    return guildId + ":" + videoId;
}

async function setup({ guildId, youtubeSource, discordChannelId }) {
    // Validate the configured YouTube handle and its public feed.
    const channelId = await feed.resolveChannelId(youtubeSource);
    const uploads = await feed.channelVideos(channelId);
    const [categories, metadata] = await Promise.all([
        feed.categoryFeeds(channelId),
        feed.videoMetadata(uploads)
    ]);

    const now = new Date();

    // Initial seeding prevents a flood of older uploads.
    for (const video of uploads) {
        const kind = feed.classify(
            video,
            categories.get(video.id),
            metadata.get(video.id)
        );

        await seen().updateOne(
            { _id: seenId(guildId, video.id) },
            {
                $setOnInsert: {
                    guildId,
                    youtubeChannelId: channelId,
                    videoId: video.id,
                    state: kind === "upcoming"
                        ? "upcoming" : "seeded",
                    kind,
                    firstSeenAt: now
                }
            },
            { upsert: true }
        );
    }

    await settings().updateOne(
        { _id: guildId },
        {
            $set: {
                guildId,
                channelId,
                youtubeSource,
                discordChannelId,
                enabled: true,
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: now
            }
        },
        { upsert: true }
    );

    console.log(
        "[YouTube] Configured channel " +
        channelId + " for Discord guild " + guildId
    );

    return {
        channelId,
        discordChannelId,
        seededCount: uploads.length
    };
}

async function disable(guildId) {
    return settings().updateOne(
        { _id: guildId },
        { $set: { enabled: false, updatedAt: new Date() } }
    );
}

async function updatesChannel(client, config) {
    const guild = await client.guilds
        .fetch(config.guildId)
        .catch(() => null);

    if (!guild) throw new Error("Discord server unavailable.");

    const channel = await guild.channels
        .fetch(config.discordChannelId)
        .catch(() => null);

    if (!channel?.isTextBased?.() ||
        typeof channel.send !== "function") {
        throw new Error("Discord updates channel unavailable.");
    }

    const bot = await guild.members.fetchMe();
    const permission = channel.permissionsFor(bot);

    if (
        !permission?.has(PermissionFlagsBits.ViewChannel) ||
        !permission?.has(PermissionFlagsBits.SendMessages) ||
        !permission?.has(PermissionFlagsBits.MentionEveryone)
    ) {
        throw new Error(
            "Missing View Channel, Send Messages or Mention @everyone permission."
        );
    }

    return channel;
}

async function pollGuild(client, config) {
    if (!config?.enabled) {
        return { checked: 0, sent: 0 };
    }

    const uploads = await feed.channelVideos(config.channelId);
    const [categories, metadata] = await Promise.all([
        feed.categoryFeeds(config.channelId),
        feed.videoMetadata(uploads)
    ]);

    let sent = 0;
    const list = [...uploads].reverse();

    for (const video of list) {
        const kind = feed.classify(
            video,
            categories.get(video.id),
            metadata.get(video.id)
        );

        const id = seenId(config.guildId, video.id);

        // Upcoming streams are not live yet. We remember them
        // and allow a single notification if they go live.
        if (kind === "upcoming") {
            await seen().updateOne(
                { _id: id },
                {
                    $setOnInsert: {
                        guildId: config.guildId,
                        youtubeChannelId: config.channelId,
                        videoId: video.id,
                        kind,
                        state: "upcoming",
                        firstSeenAt: new Date()
                    }
                },
                { upsert: true }
            );
            continue;
        }

        const publishTime = video.publishedAt?.getTime();
        const tooOld =
            kind !== "live" &&
            Number.isFinite(publishTime) &&
            Date.now() - publishTime > MAX_NEW_UPLOAD_AGE_MS;

        if (tooOld) {
            await seen().updateOne(
                { _id: id },
                {
                    $setOnInsert: {
                        guildId: config.guildId,
                        youtubeChannelId: config.channelId,
                        videoId: video.id,
                        kind,
                        state: "seeded",
                        firstSeenAt: new Date()
                    }
                },
                { upsert: true }
            );
            continue;
        }

        let previouslyUpcoming = false;
        let newlyInserted = false;

        try {
            await seen().insertOne({
                _id: id,
                guildId: config.guildId,
                youtubeChannelId: config.channelId,
                videoId: video.id,
                kind,
                state: "sending",
                firstSeenAt: new Date()
            });

            newlyInserted = true;
        } catch (error) {
            if (error.code !== 11000) throw error;

            if (kind !== "live") continue;

            const claimed = await seen().updateOne(
                {
                    _id: id,
                    youtubeChannelId: config.channelId,
                    state: "upcoming"
                },
                {
                    $set: {
                        state: "sending",
                        kind
                    }
                }
            );

            if (!claimed.modifiedCount) continue;

            previouslyUpcoming = true;
        }

        // Only the process that won the atomic MongoDB claim
        // may post a notification for this video.
        try {
            const channel = await updatesChannel(client, config);
            const message = await channel.send(
                feed.announcement(video, kind)
            );

            await seen().updateOne(
                { _id: id, state: "sending" },
                {
                    $set: {
                        state: "sent",
                        kind,
                        sentAt: new Date(),
                        messageId: message.id
                    }
                }
            );

            sent++;
            console.log(
                "[YouTube] Announced " + kind +
                " " + video.id + " in " + config.guildId
            );
        } catch (error) {
            if (newlyInserted) {
                await seen().deleteOne({
                    _id: id,
                    state: "sending"
                }).catch(() => {});
            } else if (previouslyUpcoming) {
                await seen().updateOne(
                    { _id: id, state: "sending" },
                    { $set: { state: "upcoming" } }
                ).catch(() => {});
            }

            throw error;
        }
    }

    return { checked: uploads.length, sent };
}

async function configureFromRender(client) {
    const values = renderConfig();

    if (!values.youtubeChannelId || !values.discordChannelId) {
        console.warn(
            "[YouTube] Not enabled: set YOUTUBE_CHANNEL_ID and " +
            "YOUTUBE_UPDATES_CHANNEL_ID in Render."
        );
        return false;
    }

    if (!DISCORD_ID.test(values.guildId) ||
        !YOUTUBE_ID.test(values.youtubeChannelId) ||
        !DISCORD_ID.test(values.discordChannelId)) {
        throw new Error(
            "Invalid GUILD_ID, YOUTUBE_CHANNEL_ID or " +
            "YOUTUBE_UPDATES_CHANNEL_ID."
        );
    }

    await updatesChannel(client, values);

    const current = await getConfig(values.guildId);
    if (
        current?.enabled &&
        current.channelId === values.youtubeChannelId &&
        current.discordChannelId === values.discordChannelId
    ) {
        console.log(
            "[YouTube] Resuming existing notification subscription."
        );
        return true;
    }

    const configured = await setup({
        guildId: values.guildId,
        youtubeSource: values.youtubeChannelId,
        discordChannelId: values.discordChannelId
    });

    console.log(
        "[YouTube] Configured from Render. Previous uploads saved: " +
        configured.seededCount
    );
    return true;
}

async function pollAll(client) {
    if (running) return;
    running = true;

    try {
        const values = renderConfig();
        if (!DISCORD_ID.test(values.guildId) ||
            !YOUTUBE_ID.test(values.youtubeChannelId) ||
            !DISCORD_ID.test(values.discordChannelId)) {
            return;
        }

        const config = await getConfig(values.guildId);
        const configs = (
            config?.enabled &&
            config.channelId === values.youtubeChannelId &&
            config.discordChannelId === values.discordChannelId
        ) ? [config] : [];

        for (const config of configs) {
            try {
                await pollGuild(client, config);
            } catch (error) {
                console.error(
                    "[YouTube] Check failed (" +
                    config.guildId + "):",
                    error.message
                );
            }
        }
    } finally {
        running = false;
    }
}

function start(client) {
    if (scheduler) return;

    void (async () => {
        if (await configureFromRender(client)) {
            await pollAll(client);
        }
    })().catch(error => {
        console.error("[YouTube] Startup configuration failed:", error);
    });

    scheduler = setInterval(() => {
        void pollAll(client).catch(error => {
            console.error("[YouTube] Scheduled check error:", error);
        });
    }, checkInterval());

    console.log(
        "[YouTube] Watcher started. Poll interval: " +
        (checkInterval() / 60000) + " minutes."
    );
}

function stop() {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
}

module.exports = {
    getConfig,
    setup,
    disable,
    configureFromRender,
    pollGuild,
    pollAll,
    updatesChannel,
    start,
    stop
};
