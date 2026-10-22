
"use strict";

const { getDatabase } = require("../../../database");

// ==================================================
// ITAMAROS BOT • AI LIMITS SYSTEM 1.0
// ==================================================

const AI_LIMITS = Object.freeze({
    MAX_USER_REQUESTS_PER_DAY: 10,
    MAX_GLOBAL_REQUESTS_PER_DAY: 100,

    COOLDOWN_MS: 15 * 1000,

    MAX_QUESTION_LENGTH: 1500,
    MAX_RESPONSE_LENGTH: 1800,

    // Keep usage records for three days.
    HISTORY_RETENTION_DAYS: 3
});

// ==================================================
// DATABASE COLLECTIONS
// ==================================================

function getUsageCollection() {
    const database = getDatabase();

    if (!database) {
        throw new Error("MongoDB is not connected.");
    }

    return database.collection("ai_usage");
}

function getTicketCollection() {
    const database = getDatabase();

    if (!database) {
        throw new Error("MongoDB is not connected.");
    }

    return database.collection("tickets");
}

// ==================================================
// TIME HELPERS
// ==================================================

function getUtcDay(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function getNextUtcDay(date = new Date()) {
    const next = new Date(date);

    next.setUTCHours(24, 0, 0, 0);

    return next;
}

function getExpirationDate(date = new Date()) {
    const expiration = getNextUtcDay(date);

    expiration.setUTCDate(
        expiration.getUTCDate() +
        AI_LIMITS.HISTORY_RETENTION_DAYS
    );

    return expiration;
}

function secondsUntil(date, now = new Date()) {
    if (!date) return 0;

    return Math.max(
        0,
        Math.ceil(
            (new Date(date).getTime() - now.getTime()) / 1000
        )
    );
}

// ==================================================
// RESPONSE HELPERS
// ==================================================

function deny(reason, message, extra = {}) {
    return {
        allowed: false,
        reason,
        message,
        ...extra
    };
}

function allow(extra = {}) {
    return {
        allowed: true,
        reason: null,
        message: null,
        ...extra
    };
}

// ==================================================
// VALIDATION
// ==================================================

function validDiscordId(id) {
    return (
        typeof id === "string" &&
        /^\d{15,22}$/.test(id)
    );
}

function validateQuestion(question) {
    if (typeof question !== "string") {
        return deny(
            "INVALID_QUESTION",
            "❌ Please send a valid question."
        );
    }

    const trimmed = question.trim();

    if (!trimmed) {
        return deny(
            "EMPTY_QUESTION",
            "🤖 Please ask a question about the ItamaRos server."
        );
    }

    if (
        trimmed.length >
        AI_LIMITS.MAX_QUESTION_LENGTH
    ) {
        return deny(
            "QUESTION_TOO_LONG",
            `❌ Your question must be ${AI_LIMITS.MAX_QUESTION_LENGTH} characters or fewer.`
        );
    }

    return allow({
        question: trimmed
    });
}

// ==================================================
// ACTIVE TICKET VALIDATION
// ==================================================

async function checkActiveTicket(guildId, channelId) {
    return getTicketCollection().findOne({
        guildId,
        channelId,
        status: "open"
    });
}

// ==================================================
// USAGE DOCUMENT HELPERS
// ==================================================

async function ensureUsageDocument(
    collection,
    id,
    kind,
    day,
    now
) {
    await collection.updateOne(
        { _id: id },
        {
            $setOnInsert: {
                kind,
                day,
                count: 0,
                createdAt: now,
                expiresAt: getExpirationDate(now)
            }
        },
        { upsert: true }
    );
}

// One atomic update reserves one request.
// This prevents two simultaneous requests
// from both consuming the same final slot.
async function reserveUsage(
    collection,
    id,
    maximum,
    now,
    cooldownMs = 0
) {
    const filter = {
        _id: id,
        count: { $lt: maximum }
    };

    if (cooldownMs > 0) {
        filter.$or = [
            { nextAllowedAt: { $exists: false } },
            { nextAllowedAt: { $lte: now } }
        ];
    }

    const update = {
        $inc: {
            count: 1
        },
        $set: {
            updatedAt: now
        }
    };

    if (cooldownMs > 0) {
        update.$set.nextAllowedAt = new Date(
            now.getTime() + cooldownMs
        );
    }

    const result = await collection.updateOne(
        filter,
        update
    );

    return result.modifiedCount === 1;
}

async function refundGlobalReservation(
    collection,
    globalId
) {
    const result = await collection.updateOne(
        {
            _id: globalId,
            count: { $gt: 0 }
        },
        {
            $inc: {
                count: -1
            },
            $set: {
                updatedAt: new Date()
            }
        }
    );

    return result.modifiedCount === 1;
}

// ==================================================
// DENIAL REASONS
// ==================================================

async function getUserDenial(
    collection,
    userKey,
    now
) {
    const record = await collection.findOne({
        _id: userKey
    });

    if (!record) {
        return deny(
            "RETRY",
            "⏳ Please try your question again."
        );
    }

    if (
        record.count >=
        AI_LIMITS.MAX_USER_REQUESTS_PER_DAY
    ) {
        return deny(
            "USER_DAILY_LIMIT",
            [
                "🚫 **Daily AI Limit Reached**",
                "",
                "You have used all 10 AI questions for today.",
                "Your limit resets at 00:00 UTC."
            ].join("\n"),
            {
                resetAt: getNextUtcDay(now)
            }
        );
    }

    const wait = secondsUntil(
        record.nextAllowedAt,
        now
    );

    if (wait > 0) {
        return deny(
            "COOLDOWN",
            `⏳ Please wait ${wait} seconds before asking another question.`,
            {
                retryAfterSeconds: wait
            }
        );
    }

    return deny(
        "RETRY",
        "⏳ Please try your question again."
    );
}

// ==================================================
// MAIN LIMIT CHECK
// ==================================================

// Call this function before sending a question
// to any external AI provider.
//
// One successful call consumes one daily request.
//
// Input:
// {
//     guildId: string,
//     channelId: string,
//     userId: string,
//     question: string
// }
//
// Output:
// {
//     allowed: boolean,
//     reason: string | null,
//     message: string | null,
//     remaining?: number
// }

async function checkAndConsumeAiLimit(input = {}) {
    const {
        guildId,
        channelId,
        userId,
        question
    } = input;

    if (
        !validDiscordId(guildId) ||
        !validDiscordId(channelId) ||
        !validDiscordId(userId)
    ) {
        return deny(
            "INVALID_CONTEXT",
            "❌ Invalid Discord request."
        );
    }

    const questionCheck = validateQuestion(question);

    if (!questionCheck.allowed) {
        return questionCheck;
    }

    try {
        // AI is permitted only inside active tickets.
        const ticket = await checkActiveTicket(
            guildId,
            channelId
        );

        if (!ticket) {
            return deny(
                "NOT_A_TICKET",
                "🎫 ItamaRos AI is available only in open support tickets."
            );
        }

        const now = new Date();
        const day = getUtcDay(now);

        const globalKey = `global:${day}`;
        const userKey =
            `user:${guildId}:${userId}:${day}`;

        const usage = getUsageCollection();

        await ensureUsageDocument(
            usage,
            globalKey,
            "global",
            day,
            now
        );

        await ensureUsageDocument(
            usage,
            userKey,
            "user",
            day,
            now
        );

        // ------------------------------------------
        // STEP 1: GLOBAL DAILY RESERVATION
        // ------------------------------------------

        const globalReserved = await reserveUsage(
            usage,
            globalKey,
            AI_LIMITS.MAX_GLOBAL_REQUESTS_PER_DAY,
            now
        );

        if (!globalReserved) {
            return deny(
                "GLOBAL_DAILY_LIMIT",
                [
                    "🚫 **ItamaRos AI Daily Limit Reached**",
                    "",
                    "The server's AI usage limit has been reached.",
                    "Please try again tomorrow."
                ].join("\n"),
                {
                    resetAt: getNextUtcDay(now)
                }
            );
        }

        let userReserved = false;

        try {
            // --------------------------------------
            // STEP 2: USER QUOTA + COOLDOWN
            // --------------------------------------

            userReserved = await reserveUsage(
                usage,
                userKey,
                AI_LIMITS.MAX_USER_REQUESTS_PER_DAY,
                now,
                AI_LIMITS.COOLDOWN_MS
            );

            if (!userReserved) {
                return await getUserDenial(
                    usage,
                    userKey,
                    now
                );
            }

            // --------------------------------------
            // STEP 3: SUCCESS
            // --------------------------------------

            const record = await usage.findOne({
                _id: userKey
            });

            return allow({
                ticketId: String(ticket._id),

                remaining: Math.max(
                    0,
                    AI_LIMITS.MAX_USER_REQUESTS_PER_DAY -
                    (record?.count || 0)
                ),

                resetAt: getNextUtcDay(now)
            });
        } finally {
            // If user reservation failed, return
            // the global slot.
            if (!userReserved) {
                await refundGlobalReservation(
                    usage,
                    globalKey
                ).catch(error => {
                    console.error(
                        "[AI Limits] Global refund failed:",
                        error
                    );
                });
            }
        }
    } catch (error) {
        console.error(
            "[AI Limits] Database check failed:",
            error
        );

        // Fail closed: never bypass limits
        // when MongoDB is unavailable.
        return deny(
            "LIMIT_SERVICE_UNAVAILABLE",
            [
                "⚠️ **AI Temporarily Unavailable**",
                "",
                "I couldn't verify your usage limit.",
                "Please try again later."
            ].join("\n")
        );
    }
}

// ==================================================
// READ USAGE
// ==================================================

async function getAiUsage(guildId, userId) {
    if (
        !validDiscordId(guildId) ||
        !validDiscordId(userId)
    ) {
        return null;
    }

    const now = new Date();
    const day = getUtcDay(now);

    const usage = getUsageCollection();

    const [user, global] = await Promise.all([
        usage.findOne({
            _id: `user:${guildId}:${userId}:${day}`
        }),

        usage.findOne({
            _id: `global:${day}`
        })
    ]);

    const userCount = user?.count || 0;
    const globalCount = global?.count || 0;

    return {
        userUsed: userCount,
        userRemaining: Math.max(
            0,
            AI_LIMITS.MAX_USER_REQUESTS_PER_DAY -
            userCount
        ),

        globalUsed: globalCount,
        globalRemaining: Math.max(
            0,
            AI_LIMITS.MAX_GLOBAL_REQUESTS_PER_DAY -
            globalCount
        ),

        cooldownSeconds: secondsUntil(
            user?.nextAllowedAt,
            now
        ),

        resetAt: getNextUtcDay(now)
    };
}

// ==================================================
// EXPORTS
// ==================================================

module.exports = {
    AI_LIMITS,
    validateQuestion,
    checkAndConsumeAiLimit,
    getAiUsage
};
