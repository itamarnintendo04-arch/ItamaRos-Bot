"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    XP_PER_LEVEL,
    XP_GROWTH_PER_LEVEL,
    THREE_LEVEL_PHASE_END,
    TWO_LEVEL_PHASE_END,
    xpRequiredForLevel,
    totalXpForLevel,
    xpToLevel,
    xpProgress
} = require("../src/systems/xp/progression");

test("XP starts at 50 and grows after groups of 3, 2, then 1 level", () => {
    assert.equal(XP_PER_LEVEL, 50);
    assert.equal(XP_GROWTH_PER_LEVEL, 50);
    assert.equal(THREE_LEVEL_PHASE_END, 15);
    assert.equal(TWO_LEVEL_PHASE_END, 30);

    for (let level = 0; level < 15; level++) {
        assert.equal(xpRequiredForLevel(level), 50 * (1 + Math.floor(level / 3)));
    }
    for (let level = 15; level < 30; level++) {
        assert.equal(xpRequiredForLevel(level), 300 + 50 * Math.floor((level - 15) / 2));
    }
    for (let level = 30; level < 250; level++) {
        assert.equal(xpRequiredForLevel(level), 700 + 50 * (level - 30));
    }
});

test("cumulative level thresholds", () => {
    const points = new Map([
        [0, 0], [1, 50], [2, 100], [3, 150],
        [4, 250], [5, 350], [6, 450],
        [9, 900], [12, 1500], [15, 2250],
        [17, 2850], [19, 3550], [30, 9200],
        [31, 9900], [32, 10650]
    ]);
    for (const [level, xp] of points) {
        assert.equal(totalXpForLevel(level), xp);
    }
});

test("all level boundaries are exact (first 5000 levels)", () => {
    for (let level = 1; level <= 5000; level++) {
        const needed = totalXpForLevel(level);
        assert.equal(xpToLevel(needed - 1), level - 1);
        assert.equal(xpToLevel(needed), level);
    }
});

test("XP has no fixed maximum gameplay level", () => {
    const highLevel = 1200;
    assert.equal(xpToLevel(totalXpForLevel(highLevel)), highLevel);
    assert.equal(xpToLevel(totalXpForLevel(highLevel + 1)), highLevel + 1);
});

test("progress and remaining XP update on every level", () => {
    const before = xpProgress(249);
    assert.equal(before.level, 3);
    assert.equal(before.xpRequiredThisLevel, 100);
    assert.equal(before.xpInLevel, 99);
    assert.equal(before.xpToNextLevel, 1);

    const after = xpProgress(250);
    assert.equal(after.level, 4);
    assert.equal(after.xpInLevel, 0);
    assert.equal(after.xpRequiredThisLevel, 100);
    assert.equal(after.xpToNextLevel, 100);
});

test("chat rewards grow after every eligible message", () => {
    const { XP_PER_MESSAGE, MESSAGE_XP_GROWTH, messageReward } =
        require("../src/systems/xp/service");
    assert.equal(XP_PER_MESSAGE, 5);
    assert.equal(MESSAGE_XP_GROWTH, 1);
    assert.equal(messageReward(0), 5);
    assert.equal(messageReward(1), 6);
    assert.equal(messageReward(2), 7);
    assert.equal(messageReward(20), 25);
    assert.equal(messageReward(1500), 1505);
});

test("Kings unlock the five rank milestones from the same XP curve", () => {
    const { RANKS, tierForXp } = require("../src/systems/kings/ranks");
    const thresholds = [0, 50, 100, 150, 250];
    assert.deepEqual(RANKS.map(rank => rank.requiredXp), thresholds);
    for (let i = 0; i < thresholds.length; i++) {
        assert.equal(tierForXp(thresholds[i]), i + 1);
        if (i > 0) assert.equal(tierForXp(thresholds[i] - 1), i);
    }
});
