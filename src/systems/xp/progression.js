"use strict";

// XP progression has no preset gameplay level cap.
// Level 1 takes 200 XP, then each next level costs 50 more:
// 200, 250, 300, 350, 400, ...
// Accumulated XP required for level L:
// 200L + (50L(L-1))/2 = 25L² + 175L.
const XP_PER_LEVEL = 200;
const XP_GROWTH_PER_LEVEL = 50;

// JavaScript's safe integer limit is a technical storage boundary,
// not a configured maximum level or XP achievement.
const MAX_XP = Number.MAX_SAFE_INTEGER;

function safeXp(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(MAX_XP, Math.floor(value)));
}

function xpRequiredForLevel(level) {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new RangeError("Invalid XP level.");
    }
    return XP_PER_LEVEL + XP_GROWTH_PER_LEVEL * level;
}

function totalXpForLevel(level) {
    if (!Number.isSafeInteger(level) || level < 0) {
        throw new RangeError("Invalid XP level.");
    }
    return XP_PER_LEVEL * level +
        (XP_GROWTH_PER_LEVEL * level * (level - 1)) / 2;
}

function xpToLevel(value) {
    const xp = safeXp(value);
    // Quadratic inverse. Correct floating-point rounding near exact
    // thresholds rather than relying on the approximation alone.
    let level = Math.max(0, Math.floor(
        (Math.sqrt((XP_PER_LEVEL - XP_GROWTH_PER_LEVEL / 2) ** 2 +
            2 * XP_GROWTH_PER_LEVEL * xp) -
            (XP_PER_LEVEL - XP_GROWTH_PER_LEVEL / 2)) /
        XP_GROWTH_PER_LEVEL
    ));
    while (totalXpForLevel(level + 1) <= xp) level++;
    while (level && totalXpForLevel(level) > xp) level--;
    return level;
}

function xpProgress(value) {
    const xp = safeXp(value);
    const level = xpToLevel(xp);
    const currentLevelXp = totalXpForLevel(level);
    const nextLevelXp = totalXpForLevel(level + 1);
    const xpRequiredThisLevel = xpRequiredForLevel(level);
    return {
        xp,
        level,
        xpInLevel: xp - currentLevelXp,
        xpRequiredThisLevel,
        xpToNextLevel: Math.max(0, nextLevelXp - xp),
        currentLevelXp,
        nextLevelXp
    };
}

module.exports = {
    XP_PER_LEVEL,
    XP_GROWTH_PER_LEVEL,
    MAX_XP,
    safeXp,
    xpRequiredForLevel,
    totalXpForLevel,
    xpToLevel,
    xpProgress
};
