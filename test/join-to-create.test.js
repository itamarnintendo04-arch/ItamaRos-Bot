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
process.env.CREATE_YOUR_CHANNEL_ID = LOBBY_ID;

const documents = new Map();
const members = new Collection();
const voiceStates = new Collection();
const channelCache = new Collection();
const renameHistory = [];
let channelCreates = 0;
let channelDeletes = 0;
let permissionEdits = 0;
let memberMoves = 0;
let failNextRename = false;
let allowManage = true;

function collection(name) {
    const table = name === "bot_system_channels"
        ? new Map([[
            process.env.GUILD_ID + ":create-your-channel",
            { channelId: LOBBY_ID }
        ]])
        : documents;
    return {
        findOne: async query => {
            const doc = table.get(query._id);
            return doc && Object.entries(query).every(
                ([key, value]) => doc[key] === value
            ) ? { ...doc } : null;
        },
        updateOne: async (query, update) => {
            const old = table.get(query._id);
            if (old && query.ownerId && old.ownerId !== query.ownerId) {
                return { matchedCount: 0 };
            }
            table.set(query._id, {
                ...(old || { _id: query._id }),
                ...update.$set
            });
            return { matchedCount: 1 };
        },
        deleteOne: async query => {
            const old = table.get(query._id);
            if (old && (!query.ownerId || old.ownerId === query.ownerId)) {
                table.delete(query._id);
            }
        }
    };
}

function stub(path, exports) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
stub(dbPath, {
    getDatabase: () => ({ collection })
});
stub(setupPath, {
    normalizeChannelName: value =>
        String(value || "").toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-+|-+$/g, "")
});
delete require.cache[managerPath];
const manager = require("../src/systems/voiceRooms/manager");

const guild = {
    id: process.env.GUILD_ID,
    members: {
        fetchMe: async () => ({
            id: "222222222222222222",
            permissions: { has: () => true }
        }),
        fetch: async id => members.get(id) || null
    },
    channels: {
        cache: channelCache,
        fetch: async id => id
            ? channelCache.get(id) || null : channelCache,
        create: async () => { channelCreates++; throw Error("Unexpected create"); }
    },
    voiceStates: { cache: voiceStates }
};
const lobby = {
    id: LOBBY_ID,
    guildId: guild.id,
    guild,
    type: ChannelType.GuildVoice,
    name: "➕ Create Your Channel",
    members: new Collection(),
    permissionsFor() {
        return { has: flag => flag === P.ManageChannels && allowManage };
    },
    permissionOverwrites: {
        edit: async () => { permissionEdits++; },
        delete: async () => { permissionEdits++; }
    },
    async setName(name, reason) {
        if (failNextRename) {
            failNextRename = false;
            throw Error("Discord permission denied");
        }
        renameHistory.push({ name, reason });
        this.name = name;
    },
    async delete() {
        channelDeletes++;
        throw Error("Cannot delete permanent lobby");
    }
};
channelCache.set(LOBBY_ID, lobby);

function createMember(id, displayName) {
    const member = {
        id, displayName,
        user: { id, bot: false, username: displayName },
        voice: { channelId: null }
    };
    members.set(id, member);
    return member;
}

async function transition(member, nextId) {
    const prior = member.voice.channelId;
    lobby.members.delete(member.id);
    if (nextId === LOBBY_ID) lobby.members.set(member.id, member);
    member.voice.channelId = nextId;
    if (nextId) voiceStates.set(member.id, { channelId: nextId });
    else voiceStates.delete(member.id);
    await manager.handleVoiceStateChange(
        { guild, id: member.id, member, channelId: prior },
        { guild, id: member.id, member, channelId: nextId }
    );
}

const recordId = guild.id + ":" + lobby.id;
const original = "➕ Create Your Channel";

test("first join renames the same permanent channel, without creation or moving", async () => {
    const member = createMember("333333333333333333", "Alice");
    await transition(member, LOBBY_ID);
    assert.equal(lobby.name, "Alice's Channel");
    assert.equal(member.voice.channelId, LOBBY_ID);
    assert.equal(documents.get(recordId).ownerId, member.id);
    assert.equal(channelCreates, 0);
    assert.equal(channelDeletes, 0);
    assert.equal(permissionEdits, 0);
    assert.equal(memberMoves, 0);
});

test("joining while occupied never changes owner or channel name", async () => {
    const guest = createMember("444444444444444444", "Guest");
    await transition(guest, LOBBY_ID);
    assert.equal(lobby.name, "Alice's Channel");
    assert.equal(documents.get(recordId).ownerId, "333333333333333333");
    assert.equal(channelCreates, 0);
});

test("a guest leaving does not release another member's ownership", async () => {
    await transition(members.get("444444444444444444"), null);
    assert.equal(lobby.name, "Alice's Channel");
    assert.equal(documents.get(recordId).ownerId, "333333333333333333");
});

test("owner leaving restores the original name without deleting channel", async () => {
    const guest = members.get("444444444444444444");
    await transition(guest, LOBBY_ID);
    await transition(members.get("333333333333333333"), null);
    assert.equal(lobby.name, original);
    assert.equal(documents.has(recordId), false);
    assert.equal(guest.voice.channelId, LOBBY_ID);
    assert.equal(channelCache.has(LOBBY_ID), true);
    assert.equal(channelDeletes, 0);
});

test("next entrant claims same channel even if a guest stayed", async () => {
    const newOwner = createMember("555555555555555555", "New Host");
    await transition(newOwner, LOBBY_ID);
    assert.equal(lobby.name, "New Host's Channel");
    assert.equal(documents.get(recordId).ownerId, newOwner.id);
    assert.equal(channelCreates, 0);
});

test("only actual owner can rename using bot command", async () => {
    const newOwner = members.get("555555555555555555");
    const guest = members.get("444444444444444444");
    await assert.rejects(
        () => manager.renameOwnedChannel(guild, guest, "Not Allowed"),
        /Only the current voice room owner/
    );
    const name = await manager.renameOwnedChannel(guild, newOwner,
        "Gaming 🎮 Room");
    assert.equal(name, "Gaming 🎮 Room");
    assert.equal(lobby.name, name);
    assert.equal(documents.get(recordId).claimedName, name);
    assert.equal((await manager.getOwnership(guild, newOwner)).isOwner, true);
    assert.equal((await manager.getOwnership(guild, guest)).isOwner, false);
    await transition(newOwner, null);
    assert.equal(lobby.name, original);
});

test("startup keeps active owner but resets stale voice claims", async () => {
    const owner = createMember("666666666666666666", "Restart User");
    await transition(owner, LOBBY_ID);
    await manager.cleanupOnStartup({
        guilds: { fetch: async id => {
            assert.equal(id, guild.id);
            return guild;
        } }
    });
    assert.equal(lobby.name, "Restart User's Channel");

    // Simulate process downtime: voice state already changed.
    lobby.members.delete(owner.id);
    owner.voice.channelId = null;
    voiceStates.delete(owner.id);
    await manager.cleanupOnStartup({
        guilds: { fetch: async () => guild }
    });
    assert.equal(lobby.name, original);
    assert.equal(documents.has(recordId), false);
});

test("joining another guild is ignored", async () => {
    const oldName = lobby.name;
    await manager.handleVoiceStateChange(
        { guild: { id: "777777777777777777" }, channelId: null },
        { guild: { id: "777777777777777777" }, channelId: LOBBY_ID }
    );
    assert.equal(lobby.name, oldName);
});

test("Discord rename errors do not leave false ownership", async () => {
    const owner = createMember("888888888888888888", "Failed Rename");
    failNextRename = true;
    await assert.rejects(
        () => transition(owner, LOBBY_ID),
        /Discord permission denied/
    );
    assert.equal(documents.has(recordId), false);
    assert.equal(lobby.name, original);
    await transition(owner, null);
});

test("a user joining again can claim after a failed rename", async () => {
    const owner = members.get("888888888888888888");
    await transition(owner, LOBBY_ID);
    assert.equal(documents.get(recordId).ownerId, owner.id);
    await transition(owner, null);
    assert.equal(lobby.name, original);
});

test("without Manage Channels the bot does not claim", async () => {
    const owner = createMember("999999999999999999", "No Permission");
    allowManage = false;
    await assert.rejects(
        () => transition(owner, LOBBY_ID),
        /needs Manage Channels/
    );
    assert.equal(lobby.name, original);
    assert.equal(documents.has(recordId), false);
    allowManage = true;
    await transition(owner, null);
});

test("deleting unrelated channel does not affect the permanent lobby", async () => {
    await manager.cleanupDeletedChannel({
        id: "101010101010101010", guildId: guild.id
    });
    assert.equal(channelCache.has(LOBBY_ID), true);
    assert.equal(channelCreates, 0);
    assert.equal(channelDeletes, 0);
    assert.equal(permissionEdits, 0);
});

test("room names sanitize mentions and control characters", () => {
    assert.equal(manager.safeRoomName({
        displayName: "@Admin\nHello"
    }), "Admin Hello's Channel");
    assert.equal(manager.safeCustomName(" @Renamed\nRoom "),
        "Renamed Room");
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
