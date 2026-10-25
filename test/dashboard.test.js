"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection, PermissionFlagsBits } = require("discord.js");

const dbPath = require.resolve("../database");
const radioPath = require.resolve("../src/systems/radio/player");
const streakPath = require.resolve("../src/systems/dailyQuestion/streak");
const dashPath = require.resolve("../src/systems/dashboard/dashboard");

for (const [path, stub] of [
    [dbPath, { getDatabase: () => ({
        collection: () => ({ countDocuments: async () => 7 })
    }) }],
    [radioPath, { getStatus: () => ({
        connected: true, running: true, channelId: "123456789012345678",
        currentTrack: { title: "Demo Track" }
    }) }],
    [streakPath, { getStreakStats: async () => null }]
]) {
    require.cache[path] = { id: path, filename: path,
        loaded: true, exports: stub };
}
delete require.cache[dashPath];
const dashboard = require("../src/systems/dashboard/dashboard");

test("dashboard denies ordinary members and other servers", () => {
    const original = process.env.GUILD_ID;
    process.env.GUILD_ID = "test-guild";
    const candidate = {
        inGuild: () => true,
        guildId: "test-guild",
        memberPermissions: { has: () => false }
    };
    assert.equal(dashboard.ensureStaff(candidate), false);
    candidate.memberPermissions.has = flag =>
        flag === PermissionFlagsBits.ManageGuild;
    assert.equal(dashboard.ensureStaff(candidate), true);
    candidate.guildId = "other-guild";
    assert.equal(dashboard.ensureStaff(candidate), false);
    if (original === undefined) delete process.env.GUILD_ID;
    else process.env.GUILD_ID = original;
});

test("all dashboard sections render safely and have functional button IDs", async () => {
    const guild = {
        id: "test-guild", name: "ItamaRos Test",
        roles: { fetch: async () => new Collection() }
    };
    for (const [section] of dashboard.SECTIONS) {
        const payload = await dashboard.build(guild, section);
        assert.equal(payload.embeds.length, 1);
        assert.match(payload.embeds[0].toJSON().title, /Dashboard/);
        const buttons = payload.components.flatMap(row => row.toJSON().components);
        assert.ok(buttons.length >= dashboard.SECTIONS.length);
        assert.ok(buttons.length <= 25);
        assert.ok(buttons.some(button => button.custom_id === "dash:" + section));
    }
});
