
"use strict";

const { getDatabase } = require("../../../database");

// ==================================================
// ITAMAROS BOT • AI LIMITS SYSTEM 2.0
// UNLIMITED DAILY QUESTIONS
// ==================================================

const AI_LIMITS = Object.freeze({
    // No daily user quota.
    MAX_USER_REQUESTS_PER_DAY: null,

    // No daily server quota.
    MAX_GLOBAL_REQUESTS_PER_DAY: null,

    // Anti-spam protection only.
    COOLDOWN_MS: 15 * 1000,

    MAX_QUESTION_LENGTH: 1500,
    MAX_RESPONSE_LENGTH: 1800
});

// ==================================================
// DATABASE
// ==================================================

function getUsageCollection() {
    const db = getDatabase();

    if (!db) {
        throw new Error("MongoDB is not connected.");
    }

    return db.collection("ai_cooldowns");
}

function getTicketCollection() {
    const db = getDatabase();

    if (!db) {
        throw new Error("MongoDB is not connected.");
    }

    return db.collection("tickets");
}

// ==================================================
// HELPERS
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

function isValidDiscordId(value) {
    return (
        typeof value === "string" &&
        /^\d{15,22}$/.test(value)
    );
}

function getCooldownId(guildId, userId) {
    return `ai:${guildId}:${userId}`;
}

function getSecondsRemaining(nextAllowedAt, now = new Date()) {
    if (!nextAllowedAt) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (
                new Date(nextAllowedAt).getTime() -
                now.getTime()
            ) / 1000
        )
    );
}

// ==================================================
// QUESTION VALIDATION
// ==================================================

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
            [
                "❌ Your question is too long.",
                "",
                `Maximum length: ${AI_LIMITS.MAX_QUESTION_LENGTH} characters.`
            ].join("\n")
        );
    }

    return allow({
        question: trimmed
    });
}

// ==================================================
// ACTIVE TICKET CHECK
// ==================================================

async function checkActiveTicket(guildId, channelId) {
    return getTicketCollection().findOne({
        guildId,
        channelId,
        status: "open"
    });
}

// ==================================================
// ATOMIC COOLDOWN RESERVATION
// ==================================================

async function reserveCooldown(guildId, userId) {
    const collection = getUsageCollection();

    const id = getCooldownId(
        guildId,
        userId
    );

    const now = new Date();

    const nextAllowedAt = new Date(
        now.getTime() + AI_LIMITS.COOLDOWN_MS
    );

    // Ensure a single document exists for this user.
    // _id is unique by default in MongoDB.
    await collection.updateOne(
        { _id: id },
        {
            $setOnInsert: {
                guildId,
                userId,
                createdAt: now,
                nextAllowedAt: new Date(0)
            }
        },
        { upsert: true }
    );

    // Atomic check-and-update:
    // Only one simultaneous request can
    // reserve the next cooldown interval.
    const result = await collection.updateOne(
        {
            _id: id,
            nextAllowedAt: { $lte: now }
        },
        {
            $set: {
                nextAllowedAt,
                lastUsedAt: now
            }
        }
    );

    if (result.modifiedCount === 1) {
        return allow({
            cooldownSeconds: 0,
            nextAllowedAt,
            unlimited: true
        });
    }

    const record = await collection.findOne({
        _id: id
    });

    const remaining = getSecondsRemaining(
        record?.nextAllowedAt,
        now
    );

    return deny(
        "COOLDOWN",
        `⏳ Please wait ${Math.max(1, remaining)} seconds before asking another question.`,
        {
            retryAfterSeconds: Math.max(1, remaining)
        }
    );
}

// ==================================================
// MAIN LIMIT CHECK
// ==================================================

// Call this function only after confirming
// that the message mentions the bot.
//
// Unlike the previous version, this function
// does NOT consume any daily quota.
//
// Input:
// {
//     guildId,
//     channelId,
//     userId,
//     question
// }

async function checkAndConsumeAiLimit(input = {}) {
    const {
        guildId,
        channelId,
        userId,
        question
    } = input;

    // ----------------------------------------------
    // STEP 1: VALIDATE DISCORD CONTEXT
    // ----------------------------------------------

    if (
        !isValidDiscordId(guildId) ||
        !isValidDiscordId(channelId) ||
        !isValidDiscordId(userId)
    ) {
        return deny(
            "INVALID_CONTEXT",
            "❌ Invalid Discord request."
        );
    }

    // ----------------------------------------------
    // STEP 2: VALIDATE QUESTION
    // ----------------------------------------------

    const validation = validateQuestion(question);

    if (!validation.allowed) {
        return validation;
    }

    try {
        // ------------------------------------------
        // STEP 3: CHECK ACTIVE TICKET
        // ------------------------------------------

        const ticket = await checkActiveTicket(
            guildId,
            channelId
        );

        if (!ticket) {
            return deny(
                "NOT_A_TICKET",
                "🎫 ItamaRos AI only works inside open support tickets."
            );
        }

        // ------------------------------------------
        // STEP 4: CHECK ANTI-SPAM COOLDOWN
        // ------------------------------------------

        const cooldown = await reserveCooldown(
            guildId,
            userId
        );

        if (!cooldown.allowed) {
            return cooldown;
        }

        // ------------------------------------------
        // STEP 5: UNLIMITED ACCESS
        // ------------------------------------------

        return allow({
            ticketId: String(ticket._id),
            question: validation.question,

            // No daily limit!
            unlimited: true,

            cooldownMs: AI_LIMITS.COOLDOWN_MS,
            nextAllowedAt: cooldown.nextAllowedAt
        });

    } catch (error) {
        console.error(
            "[AI Limits] Validation failed:",
            error
        );

        // If the database cannot be reached,
        // don't bypass the ticket and spam checks.
        return deny(
            "LIMIT_SERVICE_UNAVAILABLE",
            [
                "⚠️ **AI Temporarily Unavailable**",
                "",
                "I couldn't verify your ticket or cooldown.",
                "Please try again later."
            ].join("\n")
        );
    }
}

// ==================================================
// READ CURRENT COOLDOWN
// ==================================================

async function getAiUsage(guildId, userId) {
    if (
        !isValidDiscordId(guildId) ||
        !isValidDiscordId(userId)
    ) {
        return null;
    }

    const collection = getUsageCollection();

    const record = await collection.findOne({
        _id: getCooldownId(guildId, userId)
    });

    return {
        unlimited: true,

        dailyLimit: null,
        dailyRemaining: null,

        cooldownSeconds: getSecondsRemaining(
            record?.nextAllowedAt
        ),

        lastUsedAt: record?.lastUsedAt || null,
        nextAllowedAt: record?.nextAllowedAt || null
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
