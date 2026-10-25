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
let lastError = null;

async function resolveRadioChannel(client) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) throw new Error("GUILD_ID is missing.");

    const guild = await client.guilds.fetch(guildId);
    let saved = null;
    let preferred = null;
    try {
        [saved, preferred] = await Promise.all([
            getDatabase().collection("bot_system_channels")
                .findOne({ _id: guildId + ":radio" }),
            getDatabase().collection("radio_settings")
                .findOne({ _id: guildId })
        ]);
    } catch (error) {
        console.warn("[Radio] Could not read radio settings:", error.message);
    }

    let managed = {};
    try {
        managed = await ensureChannels(client) || {};
    } catch (error) {
        console.warn("[Radio] Channel setup failed:", error.message);
    }

    const channels = await guild.channels.fetch();
    const candidates = [
        preferred?.voiceChannelId,
        process.env.RADIO_VOICE_CHANNEL_ID,
        config.voiceChannelId,
        saved?.channelId,
        managed.radio
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
            "No accessible voice channel selected for Radio. " +
            "Use /radio-admin set-channel to choose a Discord voice channel, " +
            "or enable BOT_AUTO_CHANNELS."
        );
    }
    return channel;
}

async function startRadio(client) {
    if (starting) return false;

    if (radioPlayer.running) {
        if (radioPlayer.getStatus().connected || radioPlayer.connecting) {
            disconnectedSince = null;
            return true;
        }
        if (!disconnectedSince) disconnectedSince = Date.now();
        if (Date.now() - disconnectedSince < UNHEALTHY_RESTART_MS) return false;

        console.warn("[Radio] Voice offline for over 60 seconds, restarting player.");
        radioPlayer.stop();
        disconnectedSince = null;
    }

    starting = true;
    try {
        const channel = await resolveRadioChannel(client);
        const me = await channel.guild.members.fetchMe();
        const permissions = channel.permissionsFor(me);
        const required = [
            [PermissionFlagsBits.ViewChannel, "View Channel"],
            [PermissionFlagsBits.Connect, "Connect"],
            [PermissionFlagsBits.Speak, "Speak"]
        ];
        const missing = required.filter(([bit]) => !permissions?.has(bit))
            .map(([, label]) => label);
        if (missing.length) {
            throw new Error("Missing voice permissions in " +
                channel.name + " (" + channel.id + "): " +
                missing.join(", ") + ". Check the bot role and " +
                "channel-specific permissions.");
        }
        if (channel.userLimit && channel.members.size >= channel.userLimit &&
            !permissions?.has(PermissionFlagsBits.MoveMembers)) {
            throw new Error("The voice channel is full (user limit " +
                channel.userLimit + "). Free a slot or grant Move Members.");
        }

        const tracks = radioPlayer.loadTracks();
        if (!tracks.length) {
            throw new Error("No supported radio tracks in assets/radio.");
        }
        await radioPlayer.start(channel);
        disconnectedSince = null;
        lastError = null;
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
        return true;
    } catch (error) {
        lastError = String(error.message || error);
        console.error("[Radio] Startup/health check failed:", error);
        return false;
    } finally {
        starting = false;
    }
}

function status() {
    return { ...radioPlayer.getStatus(), lastError, starting };
}

module.exports = {
    startRadio, status, resolveRadioChannel,
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
