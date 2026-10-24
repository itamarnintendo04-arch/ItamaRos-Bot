"use strict";

const { getDatabase } = require("../../../database");
const { createHash } = require("node:crypto");

const {
    XP_PER_LEVEL,
    XP_GROWTH_PER_LEVEL,
    MAX_XP,
    safeXp,
    xpToLevel,
    xpProgress,
    xpRequiredForLevel,
    totalXpForLevel
} = require("./progression");

// Only one qualified message can earn XP per cooldown period.
// The grant grows by +1 XP with every qualifying message: 5, 6, 7, ...
const XP_PER_MESSAGE = 5;
const MESSAGE_XP_GROWTH = 1;
const MESSAGE_COOLDOWN_MS = 60000;

function messageReward(awards) {
    const count = Number.isSafeInteger(awards) && awards >= 0 ? awards : 0;
    return Math.min(MAX_XP, XP_PER_MESSAGE + MESSAGE_XP_GROWTH * count);
}

function profiles() {
    return getDatabase().collection("member_xp");
}

function memberId(guildId, userId) {
    return `${guildId}:${userId}`;
}

async function getProfile(guildId, userId) {
    const profile = await profiles().findOne({
        _id: memberId(guildId, userId)
    });

    return {
        guildId,
        userId,
        ...xpProgress(profile?.xp ?? 0),
        chatMessagesRewarded: profile?.messageXpAwards || 0,
        lastMessageXp: profile?.lastMessageXp || 0,
        nextMessageXp: messageReward(profile?.messageXpAwards || 0)
    };
}

async function getLevel(guildId, userId) {
    const profile = await getProfile(guildId, userId);
    return profile.level;
}

async function awardMessageXp(message) {
    if (!message?.inGuild?.() ||
        message.author?.bot || message.webhookId ||
        message.content?.trim().length < 3) {
        return false;
    }

    const { findBlockedWords } = require("../moderation/wordFilter");
    if (findBlockedWords(message.content).length) return false;

    const guildId = message.guildId;
    const userId = message.author.id;
    const id = memberId(guildId, userId);
    const now = new Date();
    const cutoff = new Date(now.getTime() - MESSAGE_COOLDOWN_MS);
    const hash = createHash("sha256")
        .update(message.content.trim().toLowerCase().replace(/\\s+/g, " "))
        .digest("hex");

    // A persisted count drives progressive chat XP, even after bot restarts.
    // A conditional MongoDB pipeline makes each grant and count atomic.
    const count = { $ifNull: ["$messageXpAwards", 0] };
    const grant = { $add: [XP_PER_MESSAGE,
        { $multiply: [MESSAGE_XP_GROWTH, count] }
    ] };

    const update = await profiles().updateOne({
        _id: id,
        xp: { $lt: MAX_XP },
        lastXpMessageHash: { $ne: hash },
        $or: [
            { lastMessageXpAt: { $exists: false } },
            { lastMessageXpAt: { $lte: cutoff } }
        ]
    }, [{
        $set: {
            xp: { $min: [
                MAX_XP,
                { $add: [{ $ifNull: ["$xp", 0] }, grant] }
            ] },
            // Bonus XP from milestone/store rewards never boosts activity XP.
            activityXp: { $min: [
                MAX_XP,
                { $add: [
                    { $ifNull: ["$activityXp", {
                        $max: [0, { $subtract: [
                            { $ifNull: ["$xp", 0] },
                            { $ifNull: ["$bonusXpAwarded", 0] }
                        ] }]
                    }] },
                    grant
                ] }
            ] },
            messageXpAwards: { $add: [count, 1] },
            lastMessageXp: grant,
            lastXpMessageHash: hash,
            lastMessageXpAt: now,
            guildId, userId,
            updatedAt: now
        }
    }]);

    if (update.modifiedCount) return true;

    // The new-member path is intentionally separate: an upsert with a
    // cooldown predicate could instead attempt to insert a duplicate _id.
    // A simultaneous first message gets just one XP grant.
    try {
        await profiles().insertOne({
            _id: id, guildId, userId,
            xp: XP_PER_MESSAGE,
            activityXp: XP_PER_MESSAGE,
            bonusXpAwarded: 0,
            messageXpAwards: 1,
            lastMessageXp: XP_PER_MESSAGE,
            lastXpMessageHash: hash,
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
    MESSAGE_XP_GROWTH,
    MESSAGE_COOLDOWN_MS,
    messageReward,
    XP_GROWTH_PER_LEVEL,
    MAX_XP,
    xpRequiredForLevel,
    totalXpForLevel,
    xpToLevel,
    getProfile,
    getLevel,
    awardMessageXp,
    changeXp
};
