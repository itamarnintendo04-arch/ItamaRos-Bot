"use strict";

const { getDatabase } = require("../../../database");
const { createTicket } = require("../tickets/create");

const MIN_DAYS = 2;
const MAX_DAYS = 30;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const streaks = () => getDatabase().collection("daily_quiz_streaks");
const quizzes = () => getDatabase().collection("daily_quizzes");
const winners = () => getDatabase().collection("daily_quiz_winners");
const claims = () => getDatabase().collection("daily_quiz_reward_claims");
const tickets = () => getDatabase().collection("tickets");

function addDays(date, count) {
    if (!datePattern.test(date) || !Number.isInteger(count)) {
        throw new Error("Invalid quiz date.");
    }
    const time = Date.parse(date + "T00:00:00.000Z");
    if (!Number.isFinite(time)) throw new Error("Invalid quiz date.");
    return new Date(time + count * 86400000).toISOString().slice(0, 10);
}

function dayIndex(startDate, date) {
    if (!datePattern.test(date)) return -1;
    return Math.round((Date.parse(date + "T00:00:00.000Z") -
        Date.parse(startDate + "T00:00:00.000Z")) / 86400000);
}

function streakKey(guildId) {
    return guildId + ":active";
}

async function getStreak(guildId) {
    return streaks().findOne({ _id: streakKey(guildId) });
}

function validDay(streak, date) {
    if (!streak || streak.status === "cancelled") return -1;
    const index = dayIndex(streak.startDate, date);
    return index >= 0 && index < streak.days ? index : -1;
}

async function startStreak(guildId, startDate, days, managerId) {
    if (!Number.isSafeInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
        throw new Error("Streak must last between 2 and 30 days.");
    }
    const current = await getStreak(guildId);
    if (current && current.status !== "cancelled" &&
        current.endDate >= startDate) {
        throw new Error("A Daily Quiz streak is already scheduled or active.");
    }
    const doc = {
        guildId, startDate, days, endDate: addDays(startDate, days - 1),
        status: "scheduled", createdBy: managerId,
        updatedAt: new Date()
    };
    // One active/scheduled streak per server. Its record is persisted.
    await streaks().updateOne({ _id: streakKey(guildId) },
        { $set: doc, $setOnInsert: { createdAt: new Date() } },
        { upsert: true });
    return { _id: streakKey(guildId), ...doc };
}

async function scheduleStreakDay(guildId, number, question, answer, managerId) {
    const streak = await getStreak(guildId);
    if (!streak || streak.status === "cancelled") {
        throw new Error("No scheduled Daily Quiz streak exists.");
    }
    if (!Number.isInteger(number) || number < 1 || number > streak.days) {
        throw new Error("The day number is outside this streak.");
    }
    const date = addDays(streak.startDate, number - 1);
    const id = guildId + ":" + date;
    const old = await quizzes().findOne({ _id: id });
    if (old?.publishedAt || old?.publishing || old?.messageId) {
        throw new Error("The selected day's question has already been published.");
    }
    if (date < new Date().toISOString().slice(0, 10) ||
        !String(question).trim() || !String(answer).trim()) {
        throw new Error("Enter a valid future date, question and answer.");
    }
    await quizzes().updateOne({ _id: id, messageId: { $exists: false } }, {
        $set: {
            guildId, date, question: question.trim(), answer: answer.trim(),
            streakStartDate: streak.startDate,
            streakDay: number, streakDays: streak.days,
            preparedBy: managerId, preparedAt: new Date()
        }
    }, { upsert: true });
    return { date, day: number, days: streak.days };
}

async function getStreakStats(guildId) {
    const streak = await getStreak(guildId);
    if (!streak) return null;
    const data = [];
    for (let i = 0; i < streak.days; i++) {
        const date = addDays(streak.startDate, i);
        const quiz = await quizzes().findOne({ _id: guildId + ":" + date });
        data.push({ number: i + 1, date, prepared: Boolean(quiz?.question &&
            quiz?.answer), published: Boolean(quiz?.messageId) });
    }
    return { ...streak, daysPrepared: data.filter(x=>x.prepared).length, schedule: data };
}

async function cancelStreak(guildId) {
    const result = await streaks().updateOne({
        _id: streakKey(guildId), status: { $ne: "cancelled" }
    }, { $set: { status: "cancelled", updatedAt: new Date() } });
    return result.modifiedCount === 1;
}

async function rewardTicket(guild, user, streak) {
    const claimId = guild.id + ":" + user.id + ":" + streak.startDate;
    try {
        await claims().insertOne({
            _id: claimId, guildId: guild.id, userId: user.id,
            streakStartDate: streak.startDate, days: streak.days,
            status: "pending", createdAt: new Date()
        });
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
    const existing = await tickets().findOne({
        guildId: guild.id, userId: user.id, rewardClaimId: claimId,
        status: { $ne: "deleted" }
    });
    if (existing) {
        await claims().updateOne({ _id: claimId }, {
            $set: { status: "created", channelId: existing.channelId,
                updatedAt: new Date() }
        });
        return existing.channelId;
    }
    const claimed = await claims().updateOne({
        _id: claimId,
        $or: [
            { status: "pending" }, { status: "error" },
            { status: "creating", leaseUntil: { $lt: new Date() } }
        ]
    }, { $set: {
        status: "creating",
        leaseUntil: new Date(Date.now() + 10 * 60000),
        updatedAt: new Date()
    } });
    if (!claimed.modifiedCount) return null;

    try {
        const result = await createTicket({
            guild, user, client: guild.client
        }, {
            type: "daily_quiz_reward",
            rewardClaimId: claimId,
            answers: {
                streak: "Completed " + streak.days +
                    " consecutive Daily Quiz questions, " +
                    streak.startDate + " to " + streak.endDate,
                details: "Reward verified automatically. Staff will arrange prize delivery."
            }
        });
        if (!result.success) throw new Error(result.reason);
        await claims().updateOne({ _id: claimId }, {
            $set: { status: "created", channelId: result.channel.id,
                updatedAt: new Date() },
            $unset: { leaseUntil: "" }
        });
        return result.channel.id;
    } catch (error) {
        await claims().updateOne({ _id: claimId }, {
            $set: { status: "error",
                lastError: String(error.message || error).slice(0, 300),
                updatedAt: new Date() },
            $unset: { leaseUntil: "" }
        }).catch(() => {});
        throw error;
    }
}

// Called only AFTER the normal daily quiz answer is verified and inserted
// into daily_quiz_winners, ensuring a member earns credit once per day.
// Require a correct response on ALL days before awarding the prize.
async function recordCorrectAnswer(guild, user, date) {
    const streak = await getStreak(guild.id);
    const index = validDay(streak, date);
    if (index < 0) return null;

    let completed = 0;
    for (let i = 0; i <= index; i++) {
        const day = addDays(streak.startDate, i);
        const answerId = guild.id + ":" + day + ":" + user.id;
        if (!await winners().findOne({ _id: answerId })) break;
        completed++;
    }

    if (completed <= index) {
        return { day: index + 1, days: streak.days, completed, eligible: false };
    }
    if (completed !== streak.days) {
        return { day: index + 1, days: streak.days, completed, eligible: true };
    }
    const channelId = await rewardTicket(guild, user, streak);
    return { day: index + 1, days: streak.days, completed,
        eligible: true, won: true, channelId };
}

async function retryPrizeTickets(guild) {
    const streak = await getStreak(guild.id);
    if (!streak || streak.status === "cancelled" ||
        new Date().toISOString().slice(0, 10) < streak.endDate) {
        return { checked: 0, awarded: 0, errors: 0 };
    }
    const rows = await winners()
        .find({ quizId: guild.id + ":" + streak.endDate })
        .limit(1000).toArray();
    const result = { checked: 0, awarded: 0, errors: 0 };
    for (const row of rows) {
        result.checked++;
        try {
            const member = await guild.members.fetch(row.userId).catch(() => null);
            if (!member) continue;
            const progress = await recordCorrectAnswer(guild, member.user, streak.endDate);
            if (progress?.won && progress.channelId) result.awarded++;
        } catch (error) {
            result.errors++;
            console.error("[Daily Quiz] Could not retry prize:", row.userId, error);
        }
    }
    return result;
}

module.exports = {
    MIN_DAYS, MAX_DAYS, addDays, dayIndex, getStreak, validDay,
    startStreak, scheduleStreakDay, getStreakStats, cancelStreak,
    recordCorrectAnswer, rewardTicket, retryPrizeTickets
};
