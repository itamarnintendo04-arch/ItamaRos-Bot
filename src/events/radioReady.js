"use strict";

const {
    Events,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const config = require("../systems/radio/config");
const radioPlayer = require("../systems/radio/player");
const radioCredits = require("../systems/radio/credits");

// The configured voice channel is joined when Discord is ready.
// A missed connection is retried without restarting Render.
const RETRY_INTERVAL_MS = 60000;

let starting = false;
let retryTimer = null;

async function startRadio(client) {
    if (starting || radioPlayer.running) {
        return;
    }

    if (!config.voiceChannelId) {
        console.warn(
            "[Radio] Missing RADIO_VOICE_CHANNEL_ID in Render."
        );
        return;
    }

    starting = true;

    try {
        const channel = await client.channels.fetch(
            config.voiceChannelId
        );

        if (!channel || channel.type !== ChannelType.GuildVoice) {
            throw new Error(
                "RADIO_VOICE_CHANNEL_ID must point to a regular voice channel."
            );
        }

        const me = await channel.guild.members.fetchMe();
        const permissions = channel.permissionsFor(me);

        const needed = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak
        ];

        if (
            !permissions ||
            needed.some(permission => !permissions.has(permission))
        ) {
            throw new Error(
                "The bot role needs View Channel, Connect and Speak permissions."
            );
        }

        const tracks = radioPlayer.loadTracks();

        if (tracks.length === 0) {
            throw new Error(
                "No supported music files found in assets/radio."
            );
        }

        await radioPlayer.start(channel);

        console.log(
            `[Radio] Connected to ${channel.name}. Songs available: ${tracks.length}.`
        );

        // Credits are a bonus; music should still play if the
        // voice channel's text chat doesn't allow messages.
        if (
            config.credits.enabled &&
            typeof channel.send === "function" &&
            channel.messages
        ) {
            radioCredits.start(channel, radioPlayer)
                .catch(error => {
                    console.warn(
                        "[Radio] Could not publish credits:",
                        error.message
                    );
                });
        }
    } catch (error) {
        console.error(
            "[Radio] Startup failed:",
            error
        );
    } finally {
        starting = false;
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,

    async execute(client) {
        if (!config.autoJoin) return;

        await startRadio(client);

        if (!retryTimer) {
            retryTimer = setInterval(() => {
                startRadio(client).catch(error => {
                    console.error(
                        "[Radio] Retry error:",
                        error
                    );
                });
            }, RETRY_INTERVAL_MS);

            retryTimer.unref?.();
        }
    }
};
