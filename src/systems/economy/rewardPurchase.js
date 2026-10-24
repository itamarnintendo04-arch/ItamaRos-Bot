"use strict";

const { getDatabase, getMongoClient } = require("../../../database");
const eco = require("./service");
const { MAX_XP } = require("../xp/service");

function fail(message) {
    throw new Error(message);
}

async function validateRewardRole(member, roleId) {
    if (!roleId) return null;
    if (!member || !member.guild) {
        fail("Could not verify the member's Discord roles.");
    }
    const role = await member.guild.roles.fetch(roleId);
    if (!role || role.managed || role.id === member.guild.id) {
        fail("This reward role is no longer assignable.");
    }
    const { PermissionFlagsBits } = require("discord.js");
    const forbidden = [
        PermissionFlagsBits.Administrator,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageWebhooks
    ];
    if (forbidden.some(p => role.permissions.has(p))) {
        fail("This reward role has unsafe permissions.");
    }
    if (role.name === "Kings" ||
        /^Level [1-3]$/.test(role.name)) {
        fail("This special role cannot be sold.");
    }
    if (member.roles.cache.has(roleId)) {
        fail("You already own this reward role.");
    }
    const me = await member.guild.members.fetchMe();
    if (me.roles.highest.position <= role.position) {
        fail("The bot's highest role must be above the reward role.");
    }
    return role;
}

async function purchaseReward(guild, user, itemKey, member, checkoutId) {
    const guildId = guild.id;
    const userId = user.id;
    const item = await eco.getItem(guildId, itemKey);
    if (!item || !item.enabled || item.type !== "reward") {
        fail("This instant reward is no longer for sale.");
    }
    const reward = item.rewards;
    if (!reward) fail("This reward product is not configured.");

    const role = await validateRewardRole(member, reward.roleId);
    let roleGranted = false;

    // External Discord roles cannot be part of a Mongo transaction.
    // Grant first, and remove only this new grant on a failed purchase.
    // Existing roles are never touched.
    if (role) {
        await member.roles.add(role, "ItamaRos instant shop reward");
        roleGranted = true;
    }

    const session = getMongoClient().startSession();
    try {
        const result = await session.withTransaction(async () => {
            if (checkoutId) {
                await getDatabase()
                    .collection("economy_reward_checkout_claims")
                    .insertOne({
                        _id: guildId + ":" + userId + ":" + checkoutId,
                        guildId, userId, itemKey,
                        createdAt: new Date()
                    }, { session });
            }
            const current = await eco.catalog().findOne({
                _id: item._id,
                enabled: true,
                type: "reward"
            }, { session });
            if (!current) fail("Product no longer available.");
            if (current.stock !== null && current.stock < 1) {
                fail("This reward is sold out.");
            }

            const price = current.price;
            const coins = current.rewards.coins;
            const xp = current.rewards.xp;
            const net = coins - price;

            await eco.accounts().updateOne({
                _id: eco.id(guildId, userId)
            }, {
                $setOnInsert: {
                    guildId, userId, cash: 0, bank: 0,
                    dailyAt: new Date(0), workAt: new Date(0),
                    stealAt: new Date(0), playAt: new Date(0),
                    createdAt: new Date()
                }
            }, { upsert: true, session });

            const debitAndReward = await eco.accounts().updateOne({
                _id: eco.id(guildId, userId),
                cash: { $gte: price, $lte: eco.MAX_BALANCE - net }
            }, {
                $inc: { cash: net }
            }, { session });
            if (!debitAndReward.matchedCount) {
                fail("Not enough wallet coins or balance limit reached.");
            }

            if (current.stock !== null) {
                const reserved = await eco.catalog().updateOne({
                    _id: current._id,
                    stock: { $gte: 1 },
                    enabled: true
                }, { $inc: { stock: -1 } }, { session });
                if (!reserved.modifiedCount) fail("Product sold out.");
            }

            if (xp > 0) {
                const key = guildId + ":" + userId;
                await getDatabase().collection("member_xp").updateOne(
                    { _id: key },
                    [{
                        $set: {
                            guildId, userId,
                            xp: {
                                $min: [
                                    MAX_XP,
                                    { $add: [
                                        { $ifNull: ["$xp", 0] },
                                        xp
                                    ] }
                                ]
                            },
                            updatedAt: new Date()
                        }
                    }],
                    { upsert: true, session }
                );
            }

            await eco.journal().insertOne({
                guildId, kind: "instant_reward_purchase",
                userId, targetId: null,
                amount: price, itemKey: current.key,
                reward: current.rewards,
                quantity: 1, createdAt: new Date()
            }, { session });

            return {
                item: current, quantity: 1, cost: price,
                rewards: current.rewards,
                instant: true
            };
        });
        return result;
    } catch (error) {
        if (roleGranted) {
            try {
                await member.roles.remove(
                    role, "Reverted failed shop purchase"
                );
            } catch (rollbackError) {
                console.error(
                    "[Item Store] CRITICAL: Failed to roll back role:",
                    guildId, userId, role.id, rollbackError
                );
            }
        }
        if (error.code === 11000 && checkoutId) {
            fail("This checkout has already been completed.");
        }
        throw error;
    } finally {
        await session.endSession();
    }
}

async function buyProduct(guild, user, key, quantity, checkoutId) {
    const item = await eco.getItem(guild.id, key);
    if (!item) fail("Product not found.");
    if (item.type !== "reward") {
        return eco.buy(guild.id, user.id, key, quantity);
    }
    if (quantity !== 1) {
        fail("Instant reward products are purchased one at a time.");
    }
    const member = await guild.members.fetch(user.id);
    return purchaseReward(guild, user, key, member, checkoutId);
}

function rewardSummary(item) {
    if (item.type !== "reward") return "";
    const r = item.rewards || {};
    const values = [
        r.xp ? "⭐ " + r.xp.toLocaleString("en-US") + " XP" : "",
        r.coins ? "🪙 " + r.coins.toLocaleString("en-US") + " coins" : "",
        r.roleId ? "👑 <@&" + r.roleId + ">" : ""
    ].filter(Boolean);
    return values.join(" + ");
}

module.exports = { buyProduct, rewardSummary, validateRewardRole };
