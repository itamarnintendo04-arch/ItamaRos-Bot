"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const databaseId = require.resolve("../database");
const blockedWordsId = require.resolve("../src/systems/moderation/wordFilter");
const serviceId = require.resolve("../src/systems/xp/service");
const previousDatabase = require.cache[databaseId];
const previousWords = require.cache[blockedWordsId];
const previousService = require.cache[serviceId];

let record = null;
const mongo = {
    collection(name) {
        assert.equal(name, "member_xp");
        return {
            async findOne() {
                return record;
            },
            async updateOne(filter, stages) {
                if (!record) return { modifiedCount: 0 };
                // Minimal Mongo conditional-filter simulation.
                if (record.lastXpMessageHash === filter.lastXpMessageHash.$ne ||
                    record.lastMessageXpAt > filter.$or[1].lastMessageXpAt.$lte) {
                    return { modifiedCount: 0 };
                }

                const original = record;
                const evaluate = value => {
                    if (typeof value === "string" && value.startsWith("$")) {
                        return original[value.slice(1)];
                    }
                    if (!value || typeof value !== "object" ||
                        value instanceof Date) return value;
                    const [operator, argumentsValue] = Object.entries(value)[0];
                    const args = argumentsValue.map(evaluate);
                    if (operator === "$ifNull") return args[0] ?? args[1];
                    if (operator === "$add") return args.reduce((a, b) => a + b, 0);
                    if (operator === "$multiply") return args.reduce((a, b) => a * b, 1);
                    if (operator === "$subtract") return args[0] - args[1];
                    if (operator === "$min") return Math.min(...args);
                    if (operator === "$max") return Math.max(...args);
                    throw new Error("Unsupported Mongo expression: " + operator);
                };

                const next = { ...original };
                for (const [key, expr] of Object.entries(stages[0].$set)) {
                    next[key] = evaluate(expr);
                }
                record = next;
                return { modifiedCount: 1 };
            },
            async insertOne(doc) {
                if (record) {
                    const duplicate = new Error("duplicate _id");
                    duplicate.code = 11000;
                    throw duplicate;
                }
                record = { ...doc };
            }
        };
    }
};

function stubModule(id, exports) {
    require.cache[id] = {
        id, filename: id, loaded: true, exports
    };
}

stubModule(databaseId, { getDatabase: () => mongo });
stubModule(blockedWordsId, { findBlockedWords: () => [] });
delete require.cache[serviceId];
const xp = require("../src/systems/xp/service");

function message(content) {
    return {
        inGuild: () => true,
        author: { id: "test-member", bot: false },
        webhookId: null,
        guildId: "test-guild",
        content
    };
}

test("Mongo persists escalating XP and rejects cooldown/duplicate spam", async () => {
    record = null;

    assert.equal(await xp.awardMessageXp(message("A thoughtful message")), true);
    assert.equal(record.xp, 5);
    assert.equal(record.activityXp, 5);
    assert.equal(record.messageXpAwards, 1);
    assert.equal(record.lastMessageXp, 5);

    // Repeating the same text is blocked, even if the cooldown ends.
    record.lastMessageXpAt = new Date(Date.now() - 61000);
    assert.equal(await xp.awardMessageXp(message("A thoughtful message")), false);
    assert.equal(record.xp, 5);

    // A different message immediately after a reward is still on cooldown.
    record.lastMessageXpAt = new Date();
    assert.equal(await xp.awardMessageXp(message("Another useful message")), false);

    // After the cooldown a different message grows the award to 6 XP.
    record.lastMessageXpAt = new Date(Date.now() - 61000);
    assert.equal(await xp.awardMessageXp(message("Another useful message")), true);
    assert.equal(record.xp, 11);
    assert.equal(record.activityXp, 11);
    assert.equal(record.messageXpAwards, 2);
    assert.equal(record.lastMessageXp, 6);

    const profile = await xp.getProfile("test-guild", "test-member");
    assert.equal(profile.chatMessagesRewarded, 2);
    assert.equal(profile.nextMessageXp, 7);
});

test.after(() => {
    if (previousDatabase) require.cache[databaseId] = previousDatabase;
    else delete require.cache[databaseId];
    if (previousWords) require.cache[blockedWordsId] = previousWords;
    else delete require.cache[blockedWordsId];
    if (previousService) require.cache[serviceId] = previousService;
    else delete require.cache[serviceId];
});
