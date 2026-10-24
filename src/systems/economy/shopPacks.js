"use strict";

// Shop Pack reward definitions. This module does not perform checkout.
// Automatic rewards are XP, coins and Discord roles.
// External rewards are fulfilled by staff through a private shop ticket.
const MAX_EXTERNAL = 10;
const MAX_ROLES = 10;

function validateShopRewards(input) {
    if (!input || typeof input !== "object") {
        throw new Error("Shop rewards are required.");
    }
    const isPack = input.isPack === true;
    const xp = input.xp ?? 0;
    const coins = input.coins ?? 0;
    const roles = input.roles ?? [];
    const external = input.external ?? [];
    if (!Number.isSafeInteger(xp) || xp < 0 || xp > 200000) {
        throw new Error("XP must be between 0 and 200,000.");
    }
    if (!Number.isSafeInteger(coins) || coins < 0 || coins > 1000000000) {
        throw new Error("Invalid coin reward.");
    }
    if (!Array.isArray(roles) || roles.length > MAX_ROLES ||
        roles.some(id => !/^\d{17,20}$/.test(id)) ||
        new Set(roles).size !== roles.length) {
        throw new Error("Invalid or duplicate role rewards.");
    }
    if (!Array.isArray(external) || external.length > MAX_EXTERNAL ||
        external.some(name => typeof name !== "string" ||
            name.trim().length < 2 || name.trim().length > 150)) {
        throw new Error("Invalid external rewards.");
    }
    const cleanedExternal = external.map(name => name.trim());
    const rewardCount = Number(xp > 0) + Number(coins > 0) +
        roles.length + cleanedExternal.length;
    if (rewardCount < 1) {
        throw new Error("Choose at least one reward.");
    }
    if (!isPack && rewardCount !== 1) {
        throw new Error("Regular products can contain only one reward. Enable Shop Pack for multiple rewards.");
    }
    return Object.freeze({
        isPack, xp, coins,
        roles: Object.freeze([...roles]),
        external: Object.freeze(cleanedExternal)
    });
}

function needsShopTicket(rewards) {
    return Array.isArray(rewards?.external) && rewards.external.length > 0;
}

function summary(rewards) {
    const parts = [];
    if (rewards.xp) parts.push(rewards.xp + " XP");
    if (rewards.coins) parts.push(rewards.coins + " coins");
    for (const role of rewards.roles || []) parts.push("<@&" + role + ">");
    for (const name of rewards.external || []) parts.push("Staff delivery: " + name);
    return parts.join("\n");
}

module.exports = { validateShopRewards, needsShopTicket, summary };
