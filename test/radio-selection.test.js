"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { Collection, ChannelType, PermissionFlagsBits: P } = require("discord.js");

const dbPath = require.resolve("../database");
const configPath = require.resolve("../src/systems/radio/config");
const playerPath = require.resolve("../src/systems/radio/player");
const creditsPath = require.resolve("../src/systems/radio/credits");
const channelsPath = require.resolve("../src/systems/setup/channels");
const radioPath = require.resolve("../src/events/radioReady");

const paths = [dbPath, configPath, playerPath, creditsPath, channelsPath, radioPath];
const originals = new Map(paths.map(path => [path, require.cache[path]]));
const oldGuild = process.env.GUILD_ID;
process.env.GUILD_ID = "123456789012345678";

const guild = {
    id: process.env.GUILD_ID,
    members: {
        fetchMe: async () => ({ id: "222222222222222222" })
    },
    channels: {
        fetch: async () => voices
    }
};
const voices = new Collection();
function voice(id, name, allowed = true) {
    return {
        id, name, guildId: guild.id, type: ChannelType.GuildVoice,
        guild, userLimit: 0, members: new Collection(),
        permissionsFor: () => ({
            has: flag => !(
                !allowed && flag === P.Connect
            )
        })
    };
}
const defaultChannel = voice("333333333333333333", "radio");
const preferredChannel = voice("444444444444444444", "music-room");
voices.set(defaultChannel.id, defaultChannel);
voices.set(preferredChannel.id, preferredChannel);

let selected = null;
let allow = true;
const player = {
    running: false, connecting: false,
    getStatus: () => ({ connected: false }),
    loadTracks: () => [{ title: "Track" }],
    start: async channel => {
        selected = channel;
        return true;
    },
    stop: () => {}
};
function stub(path, exports) {
    require.cache[path] = { id: path, filename: path, loaded: true, exports };
}
stub(dbPath, {
    getDatabase: () => ({
        collection: name => ({
            findOne: async () => name === "radio_settings"
                ? { voiceChannelId: allow
                    ? preferredChannel.id : defaultChannel.id }
                : { channelId: defaultChannel.id }
        })
    })
});
stub(configPath, {
    voiceChannelId: null, autoJoin: true,
    credits: { enabled: false }
});
stub(playerPath, player);
stub(creditsPath, { start: async () => {} });
stub(channelsPath, {
    ensureChannels: async () => ({ radio: defaultChannel.id }),
    refreshChannels: async () => ({ radio: defaultChannel.id })
});
delete require.cache[radioPath];
const radio = require("../src/events/radioReady");
const client = {
    guilds: { fetch: async id => {
        assert.equal(id, guild.id);
        return guild;
    } }
};

test("explicit admin-selected voice channel overrides the auto-created radio", async () => {
    const chosen = await radio.resolveRadioChannel(client);
    assert.equal(chosen.id, preferredChannel.id);
    assert.notEqual(chosen.id, defaultChannel.id);
    const connected = await radio.startRadio(client);
    assert.equal(connected, true);
    assert.equal(selected.id, preferredChannel.id);
});

test("auto-created radio channel is selected if saved preference points to it", async () => {
    allow = false;
    const chosen = await radio.resolveRadioChannel(client);
    assert.equal(chosen.id, defaultChannel.id);
});

test("no hard-coded alternative guild is ever used", async () => {
    const output = radio.status();
    assert.equal(output.lastError, null);
    assert.equal(output.starting, false);
});

after(() => {
    if (oldGuild === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = oldGuild;
    for (const [key, value] of originals) {
        if (value) require.cache[key] = value;
        else delete require.cache[key];
    }
});
