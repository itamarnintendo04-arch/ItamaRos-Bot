"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");

const databasePath = require.resolve("../database");
const ticketsPath = require.resolve("../src/systems/tickets/create");
const modulePath = require.resolve("../src/systems/dailyQuestion/streak");

const records = new Map();
const keys = name => {
    if (!records.has(name)) records.set(name, new Map());
    return records.get(name);
};
const db = {
    collection(name) {
        const collection = keys(name);
        return {
            async findOne(query) {
                if (query._id) return collection.get(query._id) || null;
                return [...collection.values()].find(value =>
                    (!query.guildId || value.guildId === query.guildId) &&
                    (!query.userId || value.userId === query.userId) &&
                    (!query.rewardClaimId ||
                        value.rewardClaimId === query.rewardClaimId) &&
                    (!query.status?.$ne || value.status !== query.status.$ne)
                ) || null;
            },
            async insertOne(record) {
                if (collection.has(record._id)) {
                    const error = Error("duplicate");
                    error.code = 11000;
                    throw error;
                }
                collection.set(record._id, record);
                return { insertedId: record._id };
            },
            async updateOne(query, update, options = {}) {
                let current = collection.get(query._id);
                if (current) {
                    if (query.status?.$ne === current.status) return { modifiedCount: 0 };
                    if (query.$or &&
                        !query.$or.some(clause => {
                            if (clause.status && typeof clause.status === "string") {
                                return current.status === clause.status;
                            }
                            return clause.status === "creating" &&
                                current.leaseUntil < clause.leaseUntil.$lt;
                        })) return { modifiedCount: 0 };
                } else if (!options.upsert) {
                    return { modifiedCount: 0 };
                }
                current = current || { _id: query._id, ...(update.$setOnInsert || {}) };
                Object.assign(current, update.$set || {});
                for (const key of Object.keys(update.$unset || {})) delete current[key];
                collection.set(query._id, current);
                return { modifiedCount: 1, matchedCount: 1 };
            },
            find(query) {
                const values = [...collection.values()].filter(value =>
                    !query.quizId || value.quizId === query.quizId
                );
                return { limit() { return this; }, async toArray() { return values; } };
            }
        };
    }
};

const originalDb = require.cache[databasePath];
const originalCreate = require.cache[ticketsPath];
const originalStreak = require.cache[modulePath];
let createdCount = 0;
require.cache[databasePath] = {
    id: databasePath, filename: databasePath, loaded: true,
    exports: { getDatabase: () => db }
};
require.cache[ticketsPath] = {
    id: ticketsPath, filename: ticketsPath, loaded: true,
    exports: {
        async createTicket(interaction, record) {
            createdCount++;
            const id = "ticket-" + createdCount;
            await db.collection("tickets").insertOne({
                _id: id, rewardClaimId: record.rewardClaimId,
                guildId: interaction.guild.id, userId: interaction.user.id,
                channelId: id, status: "open"
            });
            return { success: true, channel: { id } };
        }
    }
};
delete require.cache[modulePath];
const streak = require("../src/systems/dailyQuestion/streak");

test("streak dates are consecutive and the expected number of days", () => {
    assert.equal(streak.addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(streak.dayIndex("2099-11-01", "2099-11-03"), 2);
    assert.equal(streak.dayIndex("2099-11-01", "2099-10-31"), -1);
    assert.equal(streak.streakStatus({
        startDate: "2099-11-01", endDate: "2099-11-03",
        status: "scheduled"
    }, "2099-11-02"), "active");
    assert.equal(streak.validDay({
        startDate: "2099-11-01", status: "scheduled", days: 3
    }, "2099-11-03"), 2);
});

test("only successful answers on every day unlock a single prize ticket", async () => {
    const guild = { id: "test-guild", client: { user: { id: "bot" } } };
    const winner = { id: "winner" };
    const partial = { id: "partial" };

    await streak.startStreak(guild.id, "2099-11-01", 3, "manager");
    await streak.scheduleStreakDay(guild.id, 2,
        "What is the second question?", "second", "manager");
    const summary = await streak.getStreakStats(guild.id);
    assert.equal(summary.days, 3);
    assert.equal(summary.schedule[1].prepared, true);

    for (let i = 0; i < 3; i++) {
        const date = streak.addDays("2099-11-01", i);
        await db.collection("daily_quiz_winners").insertOne({
            _id: guild.id + ":" + date + ":" + winner.id,
            quizId: guild.id + ":" + date, userId: winner.id
        });
    }
    await db.collection("daily_quiz_winners").insertOne({
        _id: guild.id + ":2099-11-03:" + partial.id,
        quizId: guild.id + ":2099-11-03", userId: partial.id
    });

    const notEligible = await streak.recordCorrectAnswer(guild, partial, "2099-11-03");
    assert.equal(notEligible.won, undefined);
    assert.equal(notEligible.eligible, false);

    const reward = await streak.recordCorrectAnswer(guild, winner, "2099-11-03");
    assert.equal(reward.won, true);
    assert.equal(reward.channelId, "ticket-1");
    const twice = await streak.recordCorrectAnswer(guild, winner, "2099-11-03");
    assert.equal(twice.channelId, "ticket-1");
    assert.equal(createdCount, 1);
});

test.after(() => {
    if (originalDb) require.cache[databasePath] = originalDb;
    else delete require.cache[databasePath];
    if (originalCreate) require.cache[ticketsPath] = originalCreate;
    else delete require.cache[ticketsPath];
    if (originalStreak) require.cache[modulePath] = originalStreak;
    else delete require.cache[modulePath];
});
