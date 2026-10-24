"use strict";

const { Events, ChannelType, PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../../database");
const config = require("../systems/radio/config");
const radioPlayer = require("../systems/radio/player");
const radioCredits = require("../systems/radio/credits");
const { ensureChannels, refreshChannels } = require("../systems/setup/channels");

const RETRY_INTERVAL_MS = 30_000;
const UNHEALTHY_RESTART_MS = 60_000;
let starting = false;
let retryTimer = null;
let disconnectedSince = null;

async function resolveRadioChannel(client) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) throw new Error("GUILD_ID is missing.");

    const guild = await client.guilds.fetch(guildId);
    let saved = null;
    try {
        saved = await getDatabase().collection("bot_system_channels")
            .findOne({ _id: guildId + ":radio" });
    } catch (error) {
        console.warn("[Radio] Could not read saved radio channel:", error.message);
    }

    let managed = {};
    try {
        managed = await ensureChannels(client) || {};
    } catch (error) {
        console.warn("[Radio] Channel setup failed:", error.message);
    }

    const channels = await guild.channels.fetch();
    const candidates = [
        managed.radio,
        process.env.RADIO_VOICE_CHANNEL_ID,
        config.voiceChannelId,
        saved?.channelId
    ].filter(Boolean);

    let channel = null;
    for (const id of candidates) {
        const found = channels.get(id);
        if (found?.type === ChannelType.GuildVoice) {
            channel = found;
            break;
        }
    }
    if (!channel) {
        channel = channels.find(item =>
            item.type === ChannelType.GuildVoice &&
            ["radio", "radio-station", "רדיו"].includes(
                item.name.trim().toLowerCase()
            )
        ) || null;
    }
    if (!channel && process.env.BOT_AUTO_CHANNELS !== "false") {
        const created = await refreshChannels(client);
        if (created?.radio) {
            const found = await guild.channels.fetch(created.radio)
                .catch(() => null);
            if (found?.type === ChannelType.GuildVoice) channel = found;
        }
    }
    if (!channel) {
        throw new Error(
            "Radio voice channel missing. Check #radio or enable BOT_AUTO_CHANNELS."
        );
    }
    // Auto-detected channel ID survives within the running process.
    process.env.RADIO_VOICE_CHANNEL_ID = channel.id;
    return channel;
}

async function startRadio(client) {
    if (starting) return;

    if (radioPlayer.running) {
        if (radioPlayer.getStatus().connected || radioPlayer.connecting) {
            disconnectedSince = null;
            return;
        }
        if (!disconnectedSince) disconnectedSince = Date.now();
        if (Date.now() - disconnectedSince < UNHEALTHY_RESTART_MS) return;

        console.warn("[Radio] Voice offline for over 60 seconds, restarting player.");
        radioPlayer.stop();
        disconnectedSince = null;
    }

    starting = true;
    try {
        const channel = await resolveRadioChannel(client);
        const me = await channel.guild.members.fetchMe();
        const permissions = channel.permissionsFor(me);
        for (const required of [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
        ]) {
            if (!permissions?.has(required)) {
                throw new Error(
                    "The bot needs View Channel, Connect and Speak in #" +
                    channel.name + ". Check role and channel overrides."
                );
            }
        }

        const tracks = radioPlayer.loadTracks();
        if (!tracks.length) {
            throw new Error("No supported radio tracks in assets/radio.");
        }
        await radioPlayer.start(channel);
        disconnectedSince = null;
        console.log(
            "[Radio] Connected to " + channel.name + " (" + channel.id +
            "), " + tracks.length + " music tracks."
        );

        if (config.credits.enabled &&
            typeof channel.send === "function" && channel.messages) {
            radioCredits.start(channel, radioPlayer).catch(error =>
                console.warn("[Radio] Credits update failed:", error.message)
            );
        }
    } catch (error) {
        console.error("[Radio] Startup/health check failed:", error);
    } finally {
        starting = false;
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        if (!config.autoJoin) {
            console.log("[Radio] AutoJoin disabled.");
            return;
        }
        // Always schedule retries, even when the first setup attempt fails.
        if (!retryTimer) {
            retryTimer = setInterval(() => {
                startRadio(client).catch(error =>
                    console.error("[Radio] Periodic retry failed:", error)
                );
            }, RETRY_INTERVAL_MS);
            retryTimer.unref?.();
        }
        await startRadio(client);
    }
};
