"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, PermissionFlagsBits: P, Collection } =
    require("discord.js");

const dbPath = require.resolve("../database");
const setupPath = require.resolve("../src/systems/setup/channels");
const managerPath = require.resolve("../src/systems/voiceRooms/manager");
const originals = new Map(
    [dbPath, setupPath, managerPath].map(path => [path, require.cache[path]])
);
const oldGuildId = process.env.GUILD_ID;
const oldLobbyId = process.env.CREATE_YOUR_CHANNEL_ID;
process.env.GUILD_ID = "123456789012345678";
const LOBBY_ID = "111111111111111111";
const BOT_ID = "222222222222222222";
process.env.CREATE_YOUR_CHANNEL_ID = LOBBY_ID;

const records = new Map();
const systemChannels = new Map();
const names = [];
const removed = [];
const overwritten = [];
const members = new Collection();
const channelCache = new Collection();
let idCounter = 900000000000000000n;
const db = {
    collection(name) {
        return name === "bot_system_channels"
            ? {
                findOne: async query => systemChannels.get(query._id) || null
            }
            : {
                findOne: async query =>
                    [...records.values()].find(record =>
                        Object.entries(query).every(
                            ([key, value]) => record[key] === value
                        )
                    ) || null,
                insertOne: async doc => {
                    if (records.has(doc._id)) {
                        const error = Error("Duplicate");
                        error.code = 11000;
                        throw error;
                    }
                    records.set(doc._id, { ...doc });
                },
                deleteOne: async query => {
                    const item = records.get(query._id);
                    if (item && (!query.guildId ||
                        item.guildId === query.guildId)) {
                        records.delete(query._id);
                    }
                },
                updateOne: async (query, update) => {
                    const item = records.get(query._id);
                    if (item && item.ownerId === query.ownerId) {
                        Object.assign(item, update.$set);
                    }
                },
                find: () => ({
                    toArray: async () => [...records.values()]
                })
            };
    }
};
function stub(path, exports) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
stub(dbPath, { getDatabase: () => db });
stub(setupPath, {
    ensureChannels: async () => ({ "create-your-channel": LOBBY_ID }),
    normalizeChannelName: str =>
        String(str || "").toLowerCase().trim().replace(/\s+/g, "-")
});
delete require.cache[managerPath];
const manager = require("../src/systems/voiceRooms/manager");

const guild = {
    id: process.env.GUILD_ID,
    client: {},
    members: {
        fetchMe: async () => ({
            id: BOT_ID, permissions: { has: () => true }
        }),
        fetch: async id => members.get(id)
    },
    channels: {
        cache: channelCache,
        fetch: async id => id
            ? channelCache.get(id) || null : channelCache,
        create: async options => {
            const id = String(++idCounter);
            const channel = voice(id, options.name);
            channel.createdOptions = options;
            channelCache.set(id, channel);
            return channel;
        }
    }
};
function voice(id, name) {
    const channel = {
        id, name,
        guild, guildId: guild.id,
        type: ChannelType.GuildVoice,
        members: new Collection(),
        parentId: null,
        bitrate: 64000,
        userLimit: 0,
        permissionOverwrites: {
            cache: new Collection(),
            edit: async (who, perms) => overwritten.push({
                channelId: id, who, perms
            }),
            delete: async who => overwritten.push({
                channelId: id, removed: who
            })
        },
        delete: async reason => {
            removed.push({ id, reason });
            channelCache.delete(id);
        },
        setName: async name => {
            names.push({ id, name });
            channel.name = name;
        }
    };
    return channel;
}
const lobby = voice(LOBBY_ID, "Create Your Channel");
channelCache.set(LOBBY_ID, lobby);

function createMember(id, username) {
    const member = {
        id, displayName: username,
        user: { id, username, bot: false },
        voice: {
            channelId: null,
            async setChannel(channel) {
                const old = channelCache.get(this.channelId);
                old?.members.delete(id);
                this.channelId = channel.id;
                channel.members.set(id, member);
            }
        }
    };
    members.set(id, member);
    return member;
}
async function joinLobby(member) {
    await member.voice.setChannel(lobby);
    await manager.handleVoiceStateChange(
        { guild, id: member.id, channelId: null },
        {
            guild, id: member.id, member, channelId: lobby.id
        }
    );
}
async function leaveRoom(member) {
    const oldId = member.voice.channelId;
    const currentChannel = channelCache.get(oldId);
    currentChannel.members.delete(member.id);
    member.voice.channelId = null;
    await manager.handleVoiceStateChange(
        { guild, id: member.id, channelId: oldId },
        { guild, id: member.id, member, channelId: null }
    );
}

test("entering the permanent lobby creates a temporary channel with owner rights", async () => {
    const owner = createMember("333333333333333333", "Voice Owner");
    await joinLobby(owner);
    assert.notEqual(owner.voice.channelId, LOBBY_ID);
    const room = channelCache.get(owner.voice.channelId);
    assert.equal(room.name, "Voice Owner's Channel");
    assert.equal(room.createdOptions.parent, null);
    assert.equal(room.createdOptions.type, ChannelType.GuildVoice);
    const ownerOverwrite = room.createdOptions.permissionOverwrites
        .find(entry => entry.id === owner.id);
    assert.ok(ownerOverwrite);
    assert.ok(ownerOverwrite.allow.includes(P.ManageChannels));
    const botOverwrite = room.createdOptions.permissionOverwrites
        .find(entry => entry.id === BOT_ID);
    assert.ok(botOverwrite.allow.includes(P.MoveMembers));
    assert.equal(records.get(room.id).ownerId, owner.id);
    assert.ok(channelCache.has(LOBBY_ID), "The lobby remains permanent");
});

test("when owner leaves, a remaining member inherits the room and its name", async () => {
    const owner = members.get("333333333333333333");
    const room = channelCache.get(owner.voice.channelId);
    const guest = createMember("444444444444444444", "Next Host");
    await guest.voice.setChannel(room);
    await leaveRoom(owner);
    assert.equal(room.name, "Next Host's Channel");
    assert.equal(records.get(room.id).ownerId, guest.id);
    assert.ok(overwritten.some(x => x.who === guest.id &&
        x.perms.ManageChannels === true));
    assert.ok(overwritten.some(x => x.removed === owner.id));
    assert.ok(channelCache.has(room.id));
});

test("the room is deleted when the last human member leaves", async () => {
    const guest = members.get("444444444444444444");
    const id = guest.voice.channelId;
    await leaveRoom(guest);
    assert.ok(!records.has(id));
    assert.ok(!channelCache.has(id));
    assert.ok(channelCache.has(LOBBY_ID));
    assert.ok(removed.some(x => x.id === id));
});

test("the bot ignores voice changes in other guilds", async () => {
    const before = records.size;
    await manager.handleVoiceStateChange(
        { guild: { id: "000000000000000000" }, channelId: null },
        { guild: { id: "000000000000000000" }, channelId: LOBBY_ID }
    );
    assert.equal(records.size, before);
});

test("re-entering uses an existing owned room rather than creating a duplicate", async () => {
    const user = createMember("555555555555555555", "Repeat Host");
    await joinLobby(user);
    const roomId = user.voice.channelId;
    // An existing room can have other members while its owner visits the lobby.
    const other = createMember("666666666666666666", "Visitor");
    await other.voice.setChannel(channelCache.get(roomId));
    await user.voice.setChannel(lobby);
    const before = records.size;
    await manager.handleVoiceStateChange(
        { guild, id: user.id, channelId: roomId },
        { guild, id: user.id, member: user, channelId: LOBBY_ID }
    );
    assert.equal(user.voice.channelId, roomId);
    assert.equal(records.size, before);
    await leaveRoom(user);
    await leaveRoom(other);
});

test("startup reconciliation removes abandoned empty rooms", async () => {
    const user = createMember("777777777777777777", "Gone");
    await joinLobby(user);
    const roomId = user.voice.channelId;
    channelCache.get(roomId).members.delete(user.id);
    user.voice.channelId = null;
    await manager.cleanupOnStartup({
        guilds: { fetch: async () => guild }
    });
    assert.equal(records.has(roomId), false);
    assert.equal(channelCache.has(roomId), false);
});

test("channel deletion clears only its own temporary-room record", async () => {
    const id = "888888888888888888";
    records.set(id, {
        _id: id, ownerId: "somebody", guildId: guild.id
    });
    await manager.cleanupDeletedChannel({ id, guildId: guild.id });
    assert.equal(records.has(id), false);
    assert.ok(channelCache.has(LOBBY_ID));
});

after(() => {
    if (oldGuildId === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = oldGuildId;
    if (oldLobbyId === undefined) delete process.env.CREATE_YOUR_CHANNEL_ID;
    else process.env.CREATE_YOUR_CHANNEL_ID = oldLobbyId;
    for (const [path, entry] of originals) {
        if (entry) require.cache[path] = entry;
        else delete require.cache[path];
    }
});
