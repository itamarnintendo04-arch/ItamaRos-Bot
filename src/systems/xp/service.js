"use strict";

const { getDatabase } = require("../../../database");

const XP_PER_LEVEL = 200;
const XP_PER_MESSAGE = 20;
const MESSAGE_COOLDOWN_MS = 60000;
const MAX_LEVEL = 1000;
const MAX_XP = XP_PER_LEVEL * MAX_LEVEL;

function profiles() {
    return getDatabase().collection("member_xp");
}

function memberId(guildId, userId) {
    return `${guildId}:${userId}`;
}

function safeXp(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAX_XP, Math.floor(value)));
}

function xpToLevel(value) {
    return Math.floor(safeXp(value) / XP_PER_LEVEL);
}

async function getProfile(guildId, userId) {
    const profile = await profiles().findOne({
        _id: memberId(guildId, userId)
    });

    const xp = safeXp(profile?.xp ?? 0);

    return {
        guildId,
        userId,
        xp,
        level: xpToLevel(xp),
        xpInLevel: xp % XP_PER_LEVEL,
        xpToNextLevel: xp >= MAX_XP
            ? 0
            : XP_PER_LEVEL - (xp % XP_PER_LEVEL)
    };
}

async function getLevel(guildId, userId) {
    const profile = await getProfile(guildId, userId);
    return profile.level;
}

async function awardMessageXp(message) {
    if (!message?.inGuild?.() ||
        message.author?.bot ||
        message.webhookId ||
        message.content?.trim().length < 3) {
        return false;
    }

    const { findBlockedWords } = require(
        "../moderation/wordFilter"
    );

    if (findBlockedWords(message.content).length) {
        return false;
    }

    const guildId = message.guildId;
    const userId = message.author.id;
    const id = memberId(guildId, userId);
    const now = new Date();
    const cutoff = new Date(now.getTime() - MESSAGE_COOLDOWN_MS);

    // Existing profiles only earn XP once every minute.
    const update = await profiles().updateOne(
        {
            _id: id,
            xp: { $lt: MAX_XP },
            $or: [
                { lastMessageXpAt: { $exists: false } },
                { lastMessageXpAt: { $lte: cutoff } }
            ]
        },
        [{
            $set: {
                xp: {
                    $min: [
                        MAX_XP,
                        { $add: [
                            { $ifNull: ["$xp", 0] },
                            XP_PER_MESSAGE
                        ] }
                    ]
                },
                // Chat activity counts toward rank levels.
                // Rank XP bonuses do NOT increment this value.
                activityXp: {
                    $min: [
                        MAX_XP,
                        { $add: [
                            { $ifNull: [
                                "$activityXp",
                                { $max: [
                                    0,
                                    { $subtract: [
                                        { $ifNull: ["$xp", 0] },
                                        { $ifNull: ["$bonusXpAwarded", 0] }
                                    ] }
                                ] }
                            ] },
                            XP_PER_MESSAGE
                        ] }
                    ]
                },
                lastMessageXpAt: now,
                updatedAt: now
            }
        }]
    );

    if (update.modifiedCount) {
        return true;
    }

    // New member document. Unique _id handles
    // simultaneous messages safely.
    try {
        await profiles().insertOne({
            _id: id,
            guildId,
            userId,
            xp: XP_PER_MESSAGE,
            activityXp: XP_PER_MESSAGE,
            bonusXpAwarded: 0,
            lastMessageXpAt: now,
            updatedAt: now
        });
        return true;
    } catch (error) {
        if (error.code === 11000) return false;
        throw error;
    }
}

async function changeXp(guildId, userId, operation, amount) {
    if (!["add", "remove", "set"].includes(operation) ||
        !Number.isSafeInteger(amount) ||
        amount < 0 || amount > MAX_XP) {
        throw new Error("Invalid XP change.");
    }

    const current = operation === "set"
        ? amount
        : operation === "add"
            ? amount
            : -amount;

    const expression = operation === "set"
        ? amount
        : {
            $add: [
                { $ifNull: ["$xp", 0] },
                current
            ]
        };

    // The aggregation update clamps XP to 0..MAX_XP
    // atomically, even with concurrent staff commands.
    await profiles().updateOne(
        { _id: memberId(guildId, userId) },
        [
            {
                $set: {
                    guildId,
                    userId,
                    xp: {
                        $min: [
                            MAX_XP,
                            { $max: [0, expression] }
                        ]
                    },
                    activityXp: {
                        $min: [MAX_XP, { $max: [0,
                            operation === "set" ? amount : {
                                $add: [
                                    { $ifNull: ["$activityXp",
                                        { $max: [0, { $subtract: [
                                            { $ifNull: ["$xp", 0] },
                                            { $ifNull: ["$bonusXpAwarded", 0] }
                                        ] }] }
                                    ] },
                                    current
                                ]
                            }
                        ] }]
                    },
                    updatedAt: new Date()
                }
            }
        ],
        { upsert: true }
    );

    return getProfile(guildId, userId);
}

module.exports = {
    XP_PER_LEVEL,
    XP_PER_MESSAGE,
    MAX_LEVEL,
    MAX_XP,
    xpToLevel,
    getProfile,
    getLevel,
    awardMessageXp,
    changeXp
};
