"use strict";

// YouTube Atom feeds: no API key or third-party npm packages needed.
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const URL = "https://www.youtube.com/feeds/videos.xml";

function tag(xml, name) {
    const regex = new RegExp(
        "<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">",
        "i"
    );
    const match = xml.match(regex);
    if (!match) return "";
    return match[1]
        .replace(/&#x([a-f0-9]+);/gi, (_s, n) => {
            const code = Number.parseInt(n, 16);
            return code > 0 && code < 1114112
                ? String.fromCodePoint(code) : "";
        })
        .replace(/&#([0-9]+);/g, (_s, n) => {
            const code = Number(n);
            return code > 0 && code < 1114112
                ? String.fromCodePoint(code) : "";
        })
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function parseFeed(xml) {
    if (
        typeof xml !== "string" ||
        !xml.includes("<feed") ||
        !xml.includes("youtube.com")
    ) {
        throw new Error("Invalid YouTube channel feed.");
    }

    const entries = xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/g) || [];
    const seen = new Set();
    const videos = [];

    for (const entry of entries) {
        const id = tag(entry, "yt:videoId");
        if (!VIDEO_ID.test(id) || seen.has(id)) continue;
        seen.add(id);

        const published = Date.parse(tag(entry, "published"));

        videos.push({
            id,
            title: tag(entry, "title").slice(0, 250),
            publishedAt: Number.isFinite(published)
                ? new Date(published) : null
        });
    }

    return {
        channelId: tag(xml, "yt:channelId"),
        videos
    };
}

async function fetchText(url) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
        throw new Error("YouTube HTTP " + response.status);
    }

    return response.text();
}

async function resolveChannelId(source) {
    const value = String(source || "").trim();
    if (CHANNEL_ID.test(value)) return value;

    const channelUrl = value.match(
        /(?:^|\/)channel\/(UC[A-Za-z0-9_-]{22})(?:$|[/?#])/
    );
    if (channelUrl) return channelUrl[1];

    const normalized = value
        .replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, "")
        .replace(/^@/, "")
        .split(/[/?#]/)[0];

    if (!/^[A-Za-z0-9_.-]{2,40}$/.test(normalized)) {
        throw new Error("Use @channel or a YouTube channel ID (UC...).");
    }

    const html = await fetchText(
        "https://www.youtube.com/@" + encodeURIComponent(normalized)
    );

    const patterns = [
        /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
        /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/,
        /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/
    ];

    for (const pattern of patterns) {
        const found = html.match(pattern)?.[1];
        if (found) return found;
    }

    throw new Error(
        "Could not read the YouTube @handle. Use the channel's UC... ID."
    );
}

async function channelVideos(channelId) {
    if (!CHANNEL_ID.test(channelId)) {
        throw new Error("Invalid YouTube channel ID.");
    }

    const parsed = parseFeed(
        await fetchText(URL + "?channel_id=" + channelId)
    );

    if (parsed.channelId && parsed.channelId !== channelId) {
        throw new Error("YouTube returned a different channel.");
    }

    return parsed.videos;
}

async function categoryFeeds(channelId) {
    const categories = new Map();

    // YouTube's Shorts/live uploads playlists are optional,
    // so errors here must not stop the main channel feed.
    await Promise.all([
        ["UUSH", "short"],
        ["UULV", "live"]
    ].map(async ([prefix, category]) => {
        try {
            const playlistId = prefix + channelId.slice(2);
            const xml = await fetchText(
                URL + "?playlist_id=" + playlistId
            );
            for (const video of parseFeed(xml).videos) {
                categories.set(video.id, category);
            }
        } catch {
            // Some YouTube playlist feeds are unavailable.
        }
    }));

    return categories;
}

async function videoMetadata(videos) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key || videos.length === 0) return new Map();

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set(
        "part",
        "snippet,contentDetails,liveStreamingDetails"
    );
    url.searchParams.set(
        "id",
        videos.slice(0, 50).map(item => item.id).join(",")
    );
    url.searchParams.set("key", key);

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
            throw new Error("YouTube Data API HTTP " + response.status);
        }
        const result = await response.json();
        return new Map(
            (result.items || []).map(item => [item.id, item])
        );
    } catch (error) {
        console.warn("[YouTube] Metadata unavailable:", error.message);
        return new Map();
    }
}

function classify(video, category, details) {
    const status = details?.snippet?.liveBroadcastContent;
    const stream = details?.liveStreamingDetails;

    if (status === "upcoming") return "upcoming";
    if (status === "live" && !stream?.actualEndTime) return "live";
    if (stream?.actualEndTime) return "video";

    if (
        category === "short" ||
        /#shorts?\b/i.test(video.title) ||
        /#shorts?\b/i.test(details?.snippet?.description || "")
    ) {
        return "short";
    }

    // Without API data, the live playlist is only a hint.
    if (category === "live" && !details) return "live";

    return "video";
}

function announcement(video, kind) {
    const base = "https://www.youtube.com/";
    const url = kind === "short"
        ? base + "shorts/" + video.id
        : base + "watch?v=" + video.id;

    const heading = kind === "short"
        ? "🎬 **New Short Uploaded!**"
        : kind === "live"
            ? "🔴 **New Live Started!**"
            : "🎥 **New Video Uploaded!**";

    return {
        content: "@everyone\n\n" + heading + "\n" + url,
        allowedMentions: { parse: ["everyone"] }
    };
}

module.exports = {
    parseFeed,
    resolveChannelId,
    channelVideos,
    categoryFeeds,
    videoMetadata,
    classify,
    announcement
};
