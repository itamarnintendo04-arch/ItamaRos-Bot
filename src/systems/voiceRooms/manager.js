"use strict";

const { ChannelType, PermissionFlagsBits: P } = require("discord.js");
const { getDatabase } = require("../../../database");
const { ensureChannels, normalizeChannelName } = require("../setup/channels");

const COLLECTION = "temporary_voice_channels";
const LOBBY_KEY = "create-your-channel";
const USER_PERMISSION_BITS = [
    P.ViewChannel, P.Connect, P.ManageChannels,
    P.MoveMembers, P.MuteMembers, P.DeafenMembers
];
const BOT_PERMISSION_BITS = [
    P.ViewChannel, P.Connect, P.ManageChannels,
    P.MoveMembers, P.Speak
];

const pendingCreators = new Set();
const pendingRoomUpdates = new Set();

const rooms = () => getDatabase().collection(COLLECTION);
const lockKey = (guildId, memberId) => guildId + ":" + memberId;

function safeRoomName(member) {
    const displayName = String(
        member?.displayName || member?.user?.globalName ||
        member?.user?.username || "Member"
    )
        .replace(/[\r\n\t]/g, " ")
        .replace(/@/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 72) || "Member";

    return displayName + "'s Channel";
}

function isVoiceChannel(channel, guildId) {
    return Boolean(channel?.guildId === guildId &&
        channel.type === ChannelType.GuildVoice);
}

async function findChannel(guild, id) {
    if (!id) return null;
    return guild.channels.cache.get(id) ||
        await guild.channels.fetch(id).catch(() => null);
}

async function resolveLobby(guild, newChannelId) {
    if (!newChannelId) return null;
    const savedId = process.env.CREATE_YOUR_CHANNEL_ID;
    const known = await findChannel(guild, newChannelId);
    // Never mistake a user's temporary room for a join-to-create lobby.
    if (savedId && newChannelId !== savedId &&
        normalizeChannelName(known?.name) !== LOBBY_KEY) {
        return null;
    }

    let stored = null;
    if (newChannelId !== savedId) {
        stored = await getDatabase().collection("bot_system_channels")
            .findOne({ _id: guild.id + ":" + LOBBY_KEY });
    }

    const isTarget = [savedId, stored?.channelId]
        .includes(newChannelId) ||
        normalizeChannelName(known?.name) === LOBBY_KEY;

    if (isTarget && isVoiceChannel(known, guild.id)) return known;

    if (process.env.BOT_AUTO_CHANNELS !== "false") {
        const managed = await ensureChannels(guild.client);
        const id = managed?.[LOBBY_KEY];
        if (id && id === newChannelId) {
            const channel = await findChannel(guild, id);
            if (isVoiceChannel(channel, guild.id)) return channel;
        }
    }
    return null;
}

function privateOverwrites(lobby, member, botId) {
    const overwrites = new Map();
    for (const item of lobby.permissionOverwrites?.cache?.values() || []) {
        overwrites.set(item.id, {
            id: item.id,
            type: item.type,
            allow: item.allow.bitfield,
            deny: item.deny.bitfield
        });
    }
    // Owners can manage only their personal voice channel, not the server.
    overwrites.set(member.id, {
        id: member.id,
        allow: USER_PERMISSION_BITS
    });
    overwrites.set(botId, {
        id: botId,
        allow: BOT_PERMISSION_BITS
    });
    return [...overwrites.values()];
}

async function createRoom(lobby, member) {
    const guild = lobby.guild;
    const key = lockKey(guild.id, member.id);
    if (pendingCreators.has(key)) return null;
    pendingCreators.add(key);

    let channel = null;
    let recorded = false;
    try {
        // Only create for the configured server, and only while the user
        // is still inside the Create Your Channel voice lobby.
        if (guild.id !== process.env.GUILD_ID ||
            member.user?.bot || member.voice.channelId !== lobby.id) {
            return null;
        }

        // Prevent duplicate rooms for someone who re-enters the lobby.
        const previous = await rooms().findOne({
            guildId: guild.id, ownerId: member.id
        });
        if (previous) {
            const existing = await findChannel(guild, previous._id);
            if (isVoiceChannel(existing, guild.id)) {
                if (member.voice.channelId === lobby.id) {
                    await member.voice.setChannel(existing,
                        "Return to your temporary voice room");
                }
                return existing;
            }
            await rooms().deleteOne({ _id: previous._id, guildId: guild.id });
        }

        const bot = await guild.members.fetchMe();
        if (!bot.permissions.has(P.ManageChannels) ||
            !bot.permissions.has(P.MoveMembers)) {
            throw new Error(
                "The bot requires Manage Channels and Move Members " +
                "to create and assign temporary voice rooms."
            );
        }

        if (member.voice.channelId !== lobby.id) return null;

        channel = await guild.channels.create({
            name: safeRoomName(member),
            type: ChannelType.GuildVoice,
            parent: lobby.parentId || null,
            bitrate: lobby.bitrate,
            userLimit: lobby.userLimit || 0,
            permissionOverwrites: privateOverwrites(
                lobby, member, bot.id
            ),
            reason: "Join to Create: temporary room for " + member.id
        });

        // If they left during creation, delete the unused room.
        if (member.voice.channelId !== lobby.id) {
            await channel.delete("Join to Create: creator left").catch(() => {});
            channel = null;
            return null;
        }

        await rooms().insertOne({
            _id: channel.id,
            guildId: guild.id,
            lobbyId: lobby.id,
            ownerId: member.id,
            createdAt: new Date()
        });
        recorded = true;
        await member.voice.setChannel(channel,
            "Join to Create: your personal voice channel");
        console.log("[Voice Rooms] Created " + channel.name +
            " (" + channel.id + ") for " + member.id);
        return channel;
    } catch (error) {
        console.error("[Voice Rooms] Could not create room:", error);
        if (recorded) {
            await rooms().deleteOne({ _id: channel.id, guildId: guild.id })
                .catch(() => {});
        }
        if (channel) {
            await channel.delete("Join to Create: setup failed")
                .catch(() => {});
        }
        return null;
    } finally {
        pendingCreators.delete(key);
    }
}

function occupants(channel, departedUserId = null) {
    return [...(channel.members?.values() || [])]
        .filter(member => !member.user?.bot &&
            member.id !== departedUserId &&
            member.voice?.channelId === channel.id);
}

async function reconcileRoom(guild, record, departedUserId = null) {
    if (pendingRoomUpdates.has(record._id)) return;
    pendingRoomUpdates.add(record._id);
    try {
        const channel = await findChannel(guild, record._id);
        if (!isVoiceChannel(channel, guild.id)) {
            await rooms().deleteOne({ _id: record._id, guildId: guild.id });
            return;
        }
        const members = occupants(channel, departedUserId);
        if (members.length === 0) {
            await channel.delete("Join to Create: room is empty");
            await rooms().deleteOne({ _id: record._id, guildId: guild.id });
            console.log("[Voice Rooms] Deleted empty room " + record._id);
            return;
        }

        if (members.some(member => member.id === record.ownerId)) return;
        // Preserve an occupied room when its creator leaves by making
        // the next remaining participant the new room owner.
        const nextOwner = members[0];
        await channel.permissionOverwrites.edit(
            nextOwner.id,
            {
                ViewChannel: true, Connect: true,
                ManageChannels: true, MoveMembers: true,
                MuteMembers: true, DeafenMembers: true
            },
            { reason: "Join to Create: new room owner" }
        );
        if (record.ownerId !== nextOwner.id) {
            await channel.permissionOverwrites.delete(record.ownerId,
                "Join to Create: previous owner left").catch(error =>
                console.warn("[Voice Rooms] Previous owner permissions:",
                    error.message)
            );
        }
        await channel.setName(
            safeRoomName(nextOwner),
            "Join to Create: ownership transferred"
        );
        await rooms().updateOne({
            _id: record._id,
            guildId: guild.id,
            ownerId: record.ownerId
        }, {
            $set: {
                ownerId: nextOwner.id,
                updatedAt: new Date()
            }
        });
        console.log("[Voice Rooms] Transferred " + record._id +
            " to " + nextOwner.id);
    } catch (error) {
        console.error("[Voice Rooms] Room reconciliation failed:", error);
    } finally {
        pendingRoomUpdates.delete(record._id);
    }
}

async function handleVoiceStateChange(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    if (!guild || guild.id !== process.env.GUILD_ID ||
        oldState.channelId === newState.channelId) return;

    // A leave or move can empty the old room or require ownership transfer.
    if (oldState.channelId) {
        const record = await rooms().findOne({
            _id: oldState.channelId, guildId: guild.id
        });
        if (record) {
            await reconcileRoom(guild, record, oldState.id);
        }
    }

    if (newState.channelId) {
        const lobby = await resolveLobby(guild, newState.channelId);
        if (!lobby) return;
        const member = newState.member ||
            await guild.members.fetch(newState.id).catch(() => null);
        if (member && !member.user?.bot) await createRoom(lobby, member);
    }
}

async function cleanupOnStartup(client) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();

    const records = await rooms().find({ guildId }).toArray();
    for (const record of records) {
        await reconcileRoom(guild, record);
    }
}

async function cleanupDeletedChannel(channel) {
    if (!channel?.guildId || channel.guildId !== process.env.GUILD_ID) return;
    await rooms().deleteOne({ _id: channel.id, guildId: channel.guildId });
}

module.exports = {
    safeRoomName,
    resolveLobby,
    createRoom,
    reconcileRoom,
    handleVoiceStateChange,
    cleanupOnStartup,
    cleanupDeletedChannel
};
