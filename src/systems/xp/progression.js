"use strict";

// Unlimited gameplay levels with increasingly demanding XP requirements.
//
// Levels 1-15: difficulty rises by +50 XP after each group of three.
// Levels 16-30: difficulty rises by +50 XP after each group of two.
// Levels 31+: difficulty rises by +50 XP after each level.
//
// Each group is calculated from the previous group: there are no resets.
const XP_PER_LEVEL = 50;
const XP_GROWTH_PER_LEVEL = 50;
const THREE_LEVEL_PHASE_END = 15;
const TWO_LEVEL_PHASE_END = 30;

// JavaScript/MongoDB numbers require a finite technical safety boundary;
// this is NOT a configured level cap.
const MAX_XP = Number.MAX_SAFE_INTEGER;

function safeXp(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAX_XP, Math.floor(value)));
}

function xpRequiredForLevel(level) {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new RangeError("Invalid XP level.");
    }
    if (level < THREE_LEVEL_PHASE_END) {
        return XP_PER_LEVEL + XP_GROWTH_PER_LEVEL * Math.floor(level / 3);
    }
    if (level < TWO_LEVEL_PHASE_END) {
        return 300 + XP_GROWTH_PER_LEVEL * Math.floor((level - 15) / 2);
    }
    return 700 + XP_GROWTH_PER_LEVEL * (level - 30);
}

function totalXpForLevel(level) {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new RangeError("Invalid XP level.");
    }
    if (level <= THREE_LEVEL_PHASE_END) {
        const wholeGroups = Math.floor(level / 3);
        const remaining = level % 3;
        // Three levels at each of 50, 100, 150, 200, 250 XP.
        return 75 * wholeGroups * (wholeGroups + 1) +
            remaining * 50 * (wholeGroups + 1);
    }

    // First 15 levels cost 2,250 XP in total.
    if (level <= TWO_LEVEL_PHASE_END) {
        const count = level - THREE_LEVEL_PHASE_END;
        const pairs = Math.floor(count / 2);
        const remaining = count % 2;
        return 2250 + 600 * pairs + 50 * pairs * (pairs - 1) +
            remaining * (300 + 50 * pairs);
    }

    // Levels 16-30 cost 6,950 additional XP.
    const count = level - TWO_LEVEL_PHASE_END;
    return 9200 + 700 * count + 25 * count * (count - 1);
}

function xpToLevel(value) {
    const xp = safeXp(value);
    // Binary search avoids a loop proportional to the user's high level.
    let lower = 0;
    let upper = 1;
    while (totalXpForLevel(upper) <= xp) upper *= 2;
    while (lower + 1 < upper) {
        const mid = Math.floor((lower + upper) / 2);
        if (totalXpForLevel(mid) <= xp) lower = mid;
        else upper = mid;
    }
    return lower;
}

function xpProgress(value) {
    const xp = safeXp(value);
    const level = xpToLevel(xp);
    const currentLevelXp = totalXpForLevel(level);
    const nextLevelXp = totalXpForLevel(level + 1);
    return {
        xp,
        level,
        xpInLevel: xp - currentLevelXp,
        xpRequiredThisLevel: xpRequiredForLevel(level),
        xpToNextLevel: Math.max(0, nextLevelXp - xp),
        currentLevelXp,
        nextLevelXp
    };
}

module.exports = {
    XP_PER_LEVEL,
    XP_GROWTH_PER_LEVEL,
    THREE_LEVEL_PHASE_END,
    TWO_LEVEL_PHASE_END,
    MAX_XP,
    safeXp,
    xpRequiredForLevel,
    totalXpForLevel,
    xpToLevel,
    xpProgress
};
