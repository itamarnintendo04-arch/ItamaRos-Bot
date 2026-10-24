"use strict";

const { getDatabase, getMongoClient } = require("../../../database");
const { ROLE_DEFINITIONS, ensureLevelInfrastructure } =
    require("./setup");
const { MAX_XP, totalXpForLevel } = require("../xp/service");
const { MAX_BALANCE } = require("../economy/service");

const MAX_PROGRESS = MAX_XP;
const MAX_BACKFILL_PROFILES = 2000;

const xpProfiles = () => getDatabase().collection("member_xp");
const economyAccounts = () =>
    getDatabase().collection("economy_accounts");
const milestoneClaims = () =>
    getDatabase().collection("level_milestone_claims");

function xpId(guildId, userId) {
    return guildId + ":" + userId;
}
function rewardId(guildId, userId, tier) {
    return guildId + ":" + userId + ":rank:" + tier;
}

async function awardOne(guildId, userId, definition) {
    const session = getMongoClient().startSession();
    try {
        return await session.withTransaction(async () => {
            const profile = await xpProfiles().findOne({
                _id: xpId(guildId, userId)
            }, { session });
            if (!profile) return false;

            // Distinguish activity-earned XP from rank bonus XP.
            // Old XP accounts get their earned XP migrated on
            // their next chat reward.
            const baseXp = Math.max(0, Math.min(
                MAX_PROGRESS,
                Number(profile.activityXp ??
                    Math.max(0, (profile.xp || 0) -
                        (profile.bonusXpAwarded || 0))) || 0
            ));
            if (baseXp < definition.requiredXp) return false;

            const already = await milestoneClaims().findOne({
                _id: rewardId(guildId, userId, definition.tier)
            }, { session });
            if (already) return false;

            await economyAccounts().updateOne({
                _id: xpId(guildId, userId)
            }, {
                $setOnInsert: {
                    guildId, userId, cash: 0, bank: 0,
                    dailyAt: new Date(0),
                    workAt: new Date(0),
                    stealAt: new Date(0),
                    playAt: new Date(0),
                    createdAt: new Date()
                }
            }, { upsert: true, session });

            const coins = await economyAccounts().updateOne({
                _id: xpId(guildId, userId),
                cash: { $lte: MAX_BALANCE - definition.reward }
            }, {
                $inc: { cash: definition.reward }
            }, { session });

            if (coins.modifiedCount !== 1) {
                throw new Error(
                    "Coin wallet is full; milestone reward was not claimed."
                );
            }

            await xpProfiles().updateOne({
                _id: xpId(guildId, userId)
            }, [{
                $set: {
                    xp: {
                        $min: [
                            MAX_XP,
                            { $add: [
                                { $ifNull: ["$xp", 0] },
                                definition.reward
                            ] }
                        ]
                    },
                    activityXp: { $ifNull: [
                        "$activityXp", baseXp
                    ] },
                    bonusXpAwarded: {
                        $add: [
                            { $ifNull: ["$bonusXpAwarded", 0] },
                            definition.reward
                        ]
                    },
                    updatedAt: new Date()
                }
            }], { session });

            // Unique _id + same transaction as XP and coins makes
            // awards all-or-nothing and safe across bot restarts.
            await milestoneClaims().insertOne({
                _id: rewardId(guildId, userId, definition.tier),
                guildId,
                userId,
                tier: definition.tier,
                activityXpWhenClaimed: baseXp,
                rewardXp: definition.reward,
                rewardCoins: definition.reward,
                grantedAt: new Date()
            }, { session });

            return true;
        });
    } finally {
        await session.endSession();
    }
}

async function highestClaimedTier(guildId, userId) {
    const claims = await milestoneClaims()
        .find({ guildId, userId })
        .project({ tier: 1 })
        .toArray();
    return Math.max(0, ...claims.map(row => Number(row.tier || 0)));
}

async function updateMemberRole(member, roles, highest) {
    if (highest < 1) return false;
    const bot = await member.guild.members.fetchMe();
    const desired = roles.get(highest);
    if (!desired) return false;
    if (desired.position >= bot.roles.highest.position) {
        throw new Error(
            "The bot role must be higher than Level " +
            highest + " role."
        );
    }

    if (!member.roles.cache.has(desired.id)) {
        await member.roles.add(
            desired, "ItamaRos Level " + highest + " milestone"
        );
    }

    // Only the highest level role appears next to a member.
    // Higher-level channels also allow higher-tier roles.
    for (const [tier, role] of roles) {
        if (tier !== highest && member.roles.cache.has(role.id)) {
            await member.roles.remove(
                role, "Promoted to Level " + highest
            );
        }
    }
    return true;
}

async function reconcileMember(member, { announce = true } = {}) {
    if (!member || member.user?.bot ||
        member.guild?.id !== process.env.GUILD_ID) {
        return null;
    }

    const guildId = member.guild.id;
    const userId = member.id;

    const profile = await xpProfiles().findOne({
        _id: xpId(guildId, userId)
    });
    if (!profile) return null;

    const infrastructure = await ensureLevelInfrastructure(
        member.client
    );
    if (!infrastructure?.roles?.size) return null;

    const newlyGranted = [];
    for (const definition of ROLE_DEFINITIONS) {
        if (await awardOne(guildId, userId, definition)) {
            newlyGranted.push(definition);
        }
    }

    const highest = await highestClaimedTier(guildId, userId);
    try {
        await updateMemberRole(
            member, infrastructure.roles, highest
        );
    } catch (error) {
        console.warn(
            "[Levels] Role sync failed for " + userId +
            ": " + error.message
        );
    }

    if (newlyGranted.length) {
        console.log(
            "[Levels] Granted " +
            newlyGranted.map(x => "Level " + x.tier)
                .join(", ") +
            " to " + userId
        );

        if (announce) {
            const text = newlyGranted.map(x =>
                "⭐ **Level " + x.tier + " reached!** " +
                "You received " +
                x.reward.toLocaleString("en-US") + " coins and " +
                x.reward.toLocaleString("en-US") + " bonus XP."
            ).join("\n");

            // No public mentions or unexpected announcements.
            await member.send({
                content: text +
                    "\nUse /level and /economy balance to view your progress.",
                allowedMentions: { parse: [] }
            }).catch(() => {});
        }
    }

    return {
        highest, newlyGranted: newlyGranted.map(x => x.tier)
    };
}

async function reconcilePreviousMembers(client) {
    const guild = await client.guilds.fetch(
        process.env.GUILD_ID
    );
    const existing = await xpProfiles().find({
        guildId: guild.id,
        xp: { $gte: totalXpForLevel(1) }
    }).limit(MAX_BACKFILL_PROFILES).toArray();

    for (const item of existing) {
        try {
            const member = await guild.members.fetch(item.userId)
                .catch(() => null);
            if (member) {
                await reconcileMember(member, { announce: false });
            }
        } catch (error) {
            console.warn(
                "[Levels] Could not sync old member " +
                item.userId + ": " + error.message
            );
        }
    }
    console.log(
        "[Levels] Finished backfill of " +
        existing.length + " existing XP profiles."
    );
}

module.exports = {
    awardOne,
    highestClaimedTier,
    reconcileMember,
    reconcilePreviousMembers
};
