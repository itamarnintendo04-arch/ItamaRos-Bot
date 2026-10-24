"use strict";
const { PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../../../database");

const PERIOD_MS = 5 * 60 * 1000;
const COLLECTION = "youtube_notifications";
let started = false;
let running = false;

function settings() {
  return {
    youtubeId: (process.env.YOUTUBE_CHANNEL_ID || "").trim(),
    discordId: (process.env.YOUTUBE_UPDATES_CHANNEL_ID || "").trim(),
    apiKey: (process.env.YOUTUBE_API_KEY || "").trim()
  };
}

function unescapeXml(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function tag(xml, name) {
  const re = new RegExp("<" + name + ">([\\s\\S]*?)<\\/" + name + ">", "i");
  return unescapeXml(xml.match(re)?.[1] || "").trim();
}

function parseFeed(xml) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .slice(0, 15)
    .map(([, e]) => ({
      id: tag(e, "yt:videoId"),
      title: tag(e, "title"),
      published: new Date(tag(e, "published"))
    }))
    .filter(v => /^[A-Za-z0-9_-]{11}$/.test(v.id) &&
      v.title && Number.isFinite(v.published.getTime()))
    .sort((a, b) => a.published - b.published);
}

async function fetchYoutube(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "ItamaRos-Bot/1.0" }
  });
  if (!res.ok) throw new Error("YouTube HTTP " + res.status);
  return res;
}

async function getFeed(channelId) {
  const url = "https://www.youtube.com/feeds/videos.xml?channel_id=" +
    encodeURIComponent(channelId);
  return parseFeed(await (await fetchYoutube(url)).text());
}

function seconds(duration) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(
    String(duration || "")
  );
  return m ? Number(m[1] || 0) * 86400 +
    Number(m[2] || 0) * 3600 +
    Number(m[3] || 0) * 60 +
    Number(m[4] || 0) : null;
}

async function getMetadata(ids, key) {
  if (!key || !ids.length) return new Map();
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,liveStreamingDetails");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("key", key);
  try {
    const json = await (await fetchYoutube(url.toString())).json();
    return new Map((json.items || []).map(v => [v.id, {
      duration: seconds(v.contentDetails?.duration),
      live: v.snippet?.liveBroadcastContent === "live",
      upcoming: v.snippet?.liveBroadcastContent === "upcoming",
      actualStart: Boolean(v.liveStreamingDetails?.actualStartTime),
      isStream: Boolean(v.liveStreamingDetails)
    }]));
  } catch (e) {
    console.warn("[YouTube] Metadata unavailable:", e.message);
    return new Map();
  }
}

async function classify(id, meta) {
  if (meta?.upcoming) return "upcoming";
  if (meta?.live || meta?.actualStart) return "live";
  if (meta?.isStream || (meta && (meta.duration === null ||
    meta.duration > 180))) return "video";

  // A normal video URL redirects away from the Shorts page.
  try {
    const response = await fetchYoutube(
      "https://www.youtube.com/shorts/" + id,
      { method: "HEAD", redirect: "follow" }
    );
    if (new URL(response.url).pathname.startsWith("/shorts/")) {
      return "short";
    }
  } catch (e) {
    console.warn("[YouTube] Shorts check failed:", e.message);
  }
  return "video";
}

function messageFor(video, kind) {
  const headings = {
    short: "📱 **New Short Uploaded!**",
    video: "🎬 **New Video Uploaded!**",
    live: "🔴 **New Live Stream!**"
  };
  const url = kind === "short"
    ? "https://www.youtube.com/shorts/" + video.id
    : "https://www.youtube.com/watch?v=" + video.id;
  return {
    content: headings[kind] + "\n\n" + url,
    allowedMentions: { parse: [] }
  };
}

async function updatesChannel(client, id) {
  const channel = await client.channels.fetch(id);
  if (!channel?.guild || !channel.isTextBased() ||
      typeof channel.send !== "function") {
    throw new Error("Updates channel must be a server text channel.");
  }
  const member = await channel.guild.members.fetchMe();
  const permissions = channel.permissionsFor(member);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.SendMessages)) {
    throw new Error("Bot needs View Channel and Send Messages permissions.");
  }
  return channel;
}

async function poll(client) {
  if (running) return;
  const cfg = settings();
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(cfg.youtubeId) ||
      !/^\d{17,20}$/.test(cfg.discordId)) return;
  running = true;
  try {
    const videos = await getFeed(cfg.youtubeId);
    if (!videos.length) {
      console.warn("[YouTube] Empty or unavailable feed.");
      return;
    }

    const db = getDatabase();
    const records = db.collection(COLLECTION);
    const state = db.collection("youtube_notification_state");
    const prefix = cfg.youtubeId + ":" + cfg.discordId;

    if (!await state.findOne({ _id: prefix })) {
      // Initial setup should not flood Discord with old videos.
      for (const video of videos) {
        await records.updateOne(
          { _id: prefix + ":" + video.id },
          { $setOnInsert: {
            status: "seen", videoId: video.id,
            published: video.published, createdAt: new Date()
          } },
          { upsert: true }
        );
      }
      await state.updateOne(
        { _id: prefix },
        { $setOnInsert: { initializedAt: new Date() } },
        { upsert: true }
      );
      console.log("[YouTube] Initialized with " + videos.length +
        " existing videos. Waiting for new uploads.");
      return;
    }

    const metadata = await getMetadata(videos.map(v => v.id), cfg.apiKey);
    let channel = null;

    for (const video of videos) {
      const id = prefix + ":" + video.id;
      const previous = await records.findOne({ _id: id });
      if (previous?.status === "seen" || previous?.status === "sent") {
        continue;
      }

      const kind = await classify(video.id, metadata.get(video.id));
      if (kind === "upcoming") continue;

      if (!channel) channel = await updatesChannel(client, cfg.discordId);

      // Claim a video atomically to avoid two pollers posting it.
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + 120000);
      let claimed;
      try {
        claimed = await records.updateOne(
          { _id: id, $or: [
            { status: { $exists: false } },
            { status: "retry" },
            { status: "sending", leaseUntil: { $lte: now } }
          ] },
          { $set: {
            status: "sending", leaseUntil,
            videoId: video.id, title: video.title,
            published: video.published, updatedAt: now
          }, $setOnInsert: { createdAt: now } },
          { upsert: !previous }
        );
      } catch (e) {
        if (e.code === 11000) continue;
        throw e;
      }
      if (!claimed.modifiedCount && !claimed.upsertedCount) continue;

      try {
        const sent = await channel.send(messageFor(video, kind));
        await records.updateOne({ _id: id }, {
          $set: {
            status: "sent", kind, discordMessageId: sent.id,
            sentAt: new Date()
          },
          $unset: { leaseUntil: "" }
        });
        console.log("[YouTube] Announced " + kind + " " + video.id);
      } catch (e) {
        await records.updateOne({ _id: id }, {
          $set: { status: "retry", error: String(e.message).slice(0, 200) },
          $unset: { leaseUntil: "" }
        });
        throw e;
      }
    }
  } catch (error) {
    console.error("[YouTube] Poll failed:", error);
  } finally {
    running = false;
  }
}

function startYouTubeUpdates(client) {
  if (started) return;
  const cfg = settings();
  if (!cfg.youtubeId || !cfg.discordId) {
    console.log("[YouTube] Disabled: set YOUTUBE_CHANNEL_ID and " +
      "YOUTUBE_UPDATES_CHANNEL_ID in Render.");
    return;
  }
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(cfg.youtubeId) ||
      !/^\d{17,20}$/.test(cfg.discordId)) {
    console.error("[YouTube] Invalid channel IDs.");
    return;
  }

  started = true;
  poll(client).catch(console.error);
  const timer = setInterval(() => poll(client).catch(console.error), PERIOD_MS);
  timer.unref?.();
  console.log("[YouTube] Checking uploads every five minutes.");
  if (!cfg.apiKey) {
    console.warn("[YouTube] No YOUTUBE_API_KEY; live detection may be incomplete.");
  }
}

module.exports = { startYouTubeUpdates, parseFeed, seconds, messageFor };
