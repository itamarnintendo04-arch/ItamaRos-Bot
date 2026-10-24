"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    XP_PER_LEVEL,
    XP_GROWTH_PER_LEVEL,
    xpRequiredForLevel,
    totalXpForLevel,
    xpToLevel,
    xpProgress
} = require("../src/systems/xp/progression");

test("the first level costs 200 XP and each next level costs 50 more", () => {
    assert.equal(XP_PER_LEVEL, 200);
    assert.equal(XP_GROWTH_PER_LEVEL, 50);
    for (let level = 0; level < 1000; level++) {
        assert.equal(xpRequiredForLevel(level),
            200 + level * 50);
    }
});

test("progressive cumulative XP threshold examples", () => {
    assert.equal(totalXpForLevel(0), 0);
    assert.equal(totalXpForLevel(1), 200);
    assert.equal(totalXpForLevel(2), 450);
    assert.equal(totalXpForLevel(3), 750);
    assert.equal(totalXpForLevel(4), 1100);
    assert.equal(totalXpForLevel(5), 1500);
    assert.equal(totalXpForLevel(10), 4250);
});

test("all level boundaries are handled exactly", () => {
    for (let level = 1; level <= 1000; level++) {
        const needed = totalXpForLevel(level);
        assert.equal(xpToLevel(needed - 1), level - 1);
        assert.equal(xpToLevel(needed), level);
    }
});

test("no fixed maximum of one thousand levels", () => {
    const highLevel = 1200;
    assert.equal(xpToLevel(totalXpForLevel(highLevel)), highLevel);
    assert.equal(xpToLevel(totalXpForLevel(highLevel + 1)),
        highLevel + 1);
});

test("profile progress resets only when a level is crossed", () => {
    assert.deepEqual(
        (({ level, xpInLevel, xpRequiredThisLevel, xpToNextLevel }) =>
            ({ level, xpInLevel, xpRequiredThisLevel, xpToNextLevel }))
            (xpProgress(449)),
        {
            level: 1,
            xpInLevel: 249,
            xpRequiredThisLevel: 250,
            xpToNextLevel: 1
        }
    );
    assert.equal(xpProgress(450).level, 2);
    assert.equal(xpProgress(450).xpInLevel, 0);
    assert.equal(xpProgress(450).xpRequiredThisLevel, 300);
});
