"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    XP_PER_LEVEL, XP_GROWTH_PER_LEVEL, xpRequiredForLevel,
    totalXpForLevel, xpToLevel, xpProgress
} = require("../src/systems/xp/progression");

test("each interval doubles its predecessor, from 3 levels to 2 to 1", () => {
    assert.equal(XP_PER_LEVEL, 50);
    assert.equal(XP_GROWTH_PER_LEVEL, 2);
    for (let level = 0; level < 15; level++) {
        assert.equal(xpRequiredForLevel(level), 50 * 2 ** Math.floor(level / 3));
    }
    for (let level = 15; level < 30; level++) {
        assert.equal(xpRequiredForLevel(level), 1600 * 2 ** Math.floor((level - 15) / 2));
    }
    for (let level = 30; level < 60; level++) {
        assert.equal(xpRequiredForLevel(level), 409600 * 2 ** (level - 30));
    }
});

test("all thresholds, boundaries and mathematical totals are exact", () => {
    const examples = new Map([
        [0, 0], [1, 50], [2, 100], [3, 150],
        [4, 250], [5, 350], [6, 450], [7, 650],
        [15, 4650], [16, 6250], [17, 7850],
        [18, 11050], [30, 615850], [31, 1025450],
        [32, 1844650]
    ]);
    for (const [level, amount] of examples) {
        assert.equal(totalXpForLevel(level), amount);
    }
    let accrued = 0;
    for (let level = 0; level <= 60; level++) {
        assert.equal(totalXpForLevel(level), accrued);
        assert.equal(xpToLevel(accrued), level);
        if (level > 0) assert.equal(xpToLevel(accrued - 1), level - 1);
        accrued += xpRequiredForLevel(level);
    }
});
test("the progress displayed for a new level starts from zero", () => {
    assert.equal(xpProgress(249).level, 3);
    assert.equal(xpProgress(249).xpToNextLevel, 1);
    assert.equal(xpProgress(250).level, 4);
    assert.equal(xpProgress(250).xpRequiredThisLevel, 100);
});
