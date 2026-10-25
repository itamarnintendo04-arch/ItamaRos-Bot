"use strict";

// Progressive XP difficulty: double the previous requirement whenever a new
// interval begins. The interval shrinks as the member progresses:
// level 1-15: every three levels, 16-30: every two, 31+: every one.
// Only safe integer XP balances are stored in MongoDB (a technical boundary).
const XP_PER_LEVEL = 50;
const XP_GROWTH_PER_LEVEL = 2; // multiplier, not an additive amount
const THREE_LEVEL_PHASE_END = 15;
const TWO_LEVEL_PHASE_END = 30;
const MAX_XP = Number.MAX_SAFE_INTEGER;

const FIRST_PHASE_TOTAL = 3 * XP_PER_LEVEL * (2 ** 5 - 1); // 4,650
const SECOND_PHASE_TOTAL = FIRST_PHASE_TOTAL +
    2 * 1600 * (2 ** 7 - 1) + 1600 * 2 ** 7; // 615,850

function safeXp(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAX_XP, Math.floor(value)));
}

function ensureLevel(level) {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new RangeError("Invalid XP level.");
    }
}

function xpRequiredForLevel(level) {
    ensureLevel(level);
    if (level < THREE_LEVEL_PHASE_END) {
        return XP_PER_LEVEL * 2 ** Math.floor(level / 3);
    }
    if (level < TWO_LEVEL_PHASE_END) {
        return 1600 * 2 ** Math.floor((level - 15) / 2);
    }
    return 409600 * 2 ** (level - TWO_LEVEL_PHASE_END);
}

function totalXpForLevel(level) {
    ensureLevel(level);
    if (level <= THREE_LEVEL_PHASE_END) {
        const groups = Math.floor(level / 3);
        const remainder = level % 3;
        return 3 * XP_PER_LEVEL * (2 ** groups - 1) +
            remainder * XP_PER_LEVEL * 2 ** groups;
    }
    if (level <= TWO_LEVEL_PHASE_END) {
        const count = level - THREE_LEVEL_PHASE_END;
        const pairs = Math.floor(count / 2);
        const remainder = count % 2;
        return FIRST_PHASE_TOTAL + 3200 * (2 ** pairs - 1) +
            remainder * 1600 * 2 ** pairs;
    }
    return SECOND_PHASE_TOTAL +
        409600 * (2 ** (level - TWO_LEVEL_PHASE_END) - 1);
}

function xpToLevel(value) {
    const xp = safeXp(value);
    let low = 0;
    let high = 1;
    while (totalXpForLevel(high) <= xp) high *= 2;
    while (low + 1 < high) {
        const mid = Math.floor((high + low) / 2);
        if (totalXpForLevel(mid) <= xp) low = mid;
        else high = mid;
    }
    return low;
}

function xpProgress(value) {
    const xp = safeXp(value);
    const level = xpToLevel(xp);
    const currentLevelXp = totalXpForLevel(level);
    const nextLevelXp = totalXpForLevel(level + 1);
    return {
        xp, level,
        xpInLevel: xp - currentLevelXp,
        xpRequiredThisLevel: xpRequiredForLevel(level),
        xpToNextLevel: Math.max(0, nextLevelXp - xp),
        currentLevelXp, nextLevelXp
    };
}

module.exports = {
    XP_PER_LEVEL, XP_GROWTH_PER_LEVEL,
    THREE_LEVEL_PHASE_END, TWO_LEVEL_PHASE_END, MAX_XP,
    safeXp, xpRequiredForLevel, totalXpForLevel, xpToLevel, xpProgress
};
