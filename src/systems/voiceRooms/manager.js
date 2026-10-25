"use strict";

const { ChannelType, PermissionFlagsBits: P } = require("discord.js");
const { getDatabase } = require("../../../database");
const { normalizeChannelName } = require("../setup/channels");

const COLLECTION = "voice_channel_claims";
const KEY = "create-your-channel";
const DEFAULT_NAME = "➕ Create Your Channel";
const locks = new Map();
const claims = () => getDatabase().collection(COLLECTION);
const claimId = (guildId, channelId) => guildId + ":" + channelId;
const isVoice = channel => channel?.type === ChannelType.GuildVoice;

function safeRoomName(member) {
    const display = String(
        member?.displayName || member?.user?.globalName ||
        member?.user?.username || "Member"
    )
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .replace(/@/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const name = Array.from(display).slice(0, 70).join("") || "Member";
    return name + "'s Channel";
}

function safeCustomName(input) {
    const name = Array.from(String(input || "")
        .replace(/[\x00-\x1f\x7f]/g, " ")
        .replace(/@/g, "")
        .replace(/\s+/g, " ")
        .trim()).slice(0, 80).join("");
    if (name.length < 2) throw Error("Channel name must be at least 2 characters.");
    return name;
}

async function locked(channelId, callback) {
    const prior = locks.get(channelId) || Promise.resolve();
    const current = prior.catch(() => {}).then(callback);
    locks.set(channelId, current);
    try {
        return await current;
    } finally {
        if (locks.get(channelId) === current) locks.delete(channelId);
    }
}

async function findChannel(guild, id) {
    if (!id) return null;
    return guild.channels.cache.get(id) ||
        await guild.channels.fetch(id).catch(() => null);
}

async function resolveLobby(guild, channelId) {
    if (!channelId || guild.id !== process.env.GUILD_ID) return null;
    const channel = await findChannel(guild, channelId);
    if (!channel || !isVoice(channel) || channel.guildId !== guild.id) {
        return null;
    }
    if (process.env.CREATE_YOUR_CHANNEL_ID === channelId) return channel;

    const [stored, claim] = await Promise.all([
        getDatabase().collection("bot_system_channels").findOne({
            _id: guild.id + ":" + KEY
        }),
        claims().findOne({ _id: claimId(guild.id, channelId) })
    ]);
    if (stored?.channelId === channelId || claim?.channelId === channelId) {
        return channel;
    }

    // Accept existing voice channels by name only when no different
    // channel has been explicitly selected.
    if (process.env.CREATE_YOUR_CHANNEL_ID || stored?.channelId) {
        return null;
    }
    return ["create-your-channel", "join-to-create", "create-channel"]
        .includes(normalizeChannelName(channel.name)) ? channel : null;
}

function ownerPresent(channel, ownerId, departedId = null) {
    if (!ownerId || ownerId === departedId) return false;
    const member = channel.members?.get(ownerId);
    if (member?.voice?.channelId === channel.id) return true;
    const state = channel.guild?.voiceStates?.cache?.get(ownerId);
    return state?.channelId === channel.id;
}

// A permanent voice channel must never receive ManageChannels permission
// for the claiming user: that could let them DELETE the permanent channel.
// Ownership is logical and tracked by the bot. Owners can rename it using
// /voice-room rename, and the original name is always restored on exit.

async function releaseUnlocked(channel, current) {
    if (!current) return false;
    // Keep the claim stored if Discord rejects the rename; the next event
    // or startup reconciliation can then repair the channel safely.
    if (channel.name !== DEFAULT_NAME) {
        await channel.setName(DEFAULT_NAME, "Voice owner left — restore lobby");
    }
    await claims().deleteOne({
        _id: claimId(channel.guild.id, channel.id),
        ownerId: current.ownerId
    });
    console.log("[Voice Room] Released " + channel.id +
        " after " + current.ownerId + " left.");
    return true;
}

async function claimChannel(channel, member) {
    if (!isVoice(channel) || channel.guild.id !== process.env.GUILD_ID ||
        member.user?.bot || member.voice?.channelId !== channel.id) {
        return false;
    }
    return locked(channel.id, async () => {
        if (member.voice?.channelId !== channel.id) return false;

        const me = await channel.guild.members.fetchMe();
        if (!channel.permissionsFor(me)?.has(P.ManageChannels)) {
            throw Error("The bot needs Manage Channels in " + DEFAULT_NAME);
        }

        const id = claimId(channel.guild.id, channel.id);
        const existing = await claims().findOne({ _id: id });
        if (existing?.ownerId) {
            if (ownerPresent(channel, existing.ownerId)) return false;
            await releaseUnlocked(channel, existing);
        }

        const claimedName = safeRoomName(member);
        // Changing the existing voice channel is the ONLY Discord channel
        // mutation here. No create, delete or setChannel is ever called.
        await channel.setName(claimedName,
            "First voice participant claimed the channel");
        try {
            await claims().updateOne({ _id: id }, {
                $set: {
                    guildId: channel.guild.id,
                    channelId: channel.id,
                    ownerId: member.id,
                    claimedName,
                    claimedAt: new Date()
                }
            }, { upsert: true });
        } catch (error) {
            await channel.setName(DEFAULT_NAME,
                "Database failed — restore voice lobby").catch(() => {});
            throw error;
        }

        // Handle a user disconnecting while the Discord API call was in flight.
        if (member.voice?.channelId !== channel.id) {
            const current = await claims().findOne({ _id: id });
            if (current?.ownerId === member.id) {
                await releaseUnlocked(channel, current);
            }
            return false;
        }
        console.log("[Voice Room] " + member.id +
            " claimed existing channel " + channel.id);
        return true;
    });
}

async function releaseChannel(channel, userId) {
    return locked(channel.id, async () => {
        const existing = await claims().findOne({
            _id: claimId(channel.guild.id, channel.id)
        });
        if (!existing || existing.ownerId !== userId) return false;
        return releaseUnlocked(channel, existing);
    });
}

async function handleVoiceStateChange(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild || guild.id !== process.env.GUILD_ID ||
        oldState.channelId === newState.channelId) return;

    if (oldState.channelId) {
        const oldChannel = await resolveLobby(guild, oldState.channelId);
        if (oldChannel) {
            // Only the person who claimed it can end their ownership.
            // Other members may stay; no new Discord channel is created.
            await releaseChannel(oldChannel, oldState.id);
        }
    }

    if (newState.channelId) {
        const channel = await resolveLobby(guild, newState.channelId);
        if (!channel) return;
        const member = newState.member ||
            await guild.members.fetch(newState.id).catch(() => null);
        if (member && !member.user?.bot) {
            await claimChannel(channel, member);
        }
    }
}

async function renameOwnedChannel(guild, member, name) {
    const channel = await resolveLobby(guild, member.voice?.channelId);
    if (!channel) throw Error("Join the Create Your Channel voice channel first.");
    return locked(channel.id, async () => {
        const record = await claims().findOne({
            _id: claimId(guild.id, channel.id)
        });
        if (!record || record.ownerId !== member.id ||
            member.voice?.channelId !== channel.id) {
            throw Error("Only the current voice room owner may rename it.");
        }
        const newName = safeCustomName(name);
        await channel.setName(newName, "Voice room owner renamed their channel");
        await claims().updateOne({
            _id: record._id, ownerId: member.id
        }, { $set: { claimedName: newName, updatedAt: new Date() } });
        return newName;
    });
}

async function getOwnership(guild, member) {
    const channel = await resolveLobby(guild, member.voice?.channelId);
    if (!channel) return null;
    const record = await claims().findOne({
        _id: claimId(guild.id, channel.id)
    });
    return {
        channel,
        ownerId: record?.ownerId || null,
        isOwner: record?.ownerId === member.id
    };
}

async function cleanupOnStartup(client) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    const record = await getDatabase().collection("bot_system_channels")
        .findOne({ _id: guildId + ":" + KEY });
    const lobbyId = process.env.CREATE_YOUR_CHANNEL_ID || record?.channelId;
    const lobby = lobbyId
        ? await resolveLobby(guild, lobbyId)
        : [...guild.channels.cache.values()].find(channel =>
            isVoice(channel) &&
            normalizeChannelName(channel.name) === KEY
        );
    if (!lobby) return;
    await locked(lobby.id, async () => {
        const existing = await claims().findOne({
            _id: claimId(guildId, lobby.id)
        });
        if (existing) {
            if (!ownerPresent(lobby, existing.ownerId)) {
                await releaseUnlocked(lobby, existing);
            }
            return;
        }
        if (lobby.name !== DEFAULT_NAME) {
            await lobby.setName(DEFAULT_NAME,
                "Restore permanent Create Your Channel voice lobby");
        }
    });
}

async function cleanupDeletedChannel(channel) {
    if (!channel?.guildId || channel.guildId !== process.env.GUILD_ID) {
        return;
    }
    await claims().deleteOne({
        _id: claimId(channel.guildId, channel.id)
    });
}

module.exports = {
    DEFAULT_NAME,
    safeRoomName,
    safeCustomName,
    resolveLobby,
    claimChannel,
    releaseChannel,
    renameOwnedChannel,
    getOwnership,
    handleVoiceStateChange,
    cleanupOnStartup,
    cleanupDeletedChannel
};
