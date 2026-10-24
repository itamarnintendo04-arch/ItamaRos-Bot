"use strict";

const { getDatabase } = require("../../../database");

const COLLECTION = "invite_attributions";
const snapshots = new Map();
const guildJoinQueues = new Map();

function records() {
    return getDatabase().collection(COLLECTION);
}

function isTrackedGuild(guildId) {
    return Boolean(
        process.env.GUILD_ID &&
        guildId === process.env.GUILD_ID
    );
}

function snapshotInvites(invites) {
    const result = new Map();
    for (const invite of invites.values()) {
        if (!invite.code) continue;
        result.set(invite.code, {
            uses: Math.max(0, invite.uses || 0),
            inviterId: invite.inviter?.id || null
        });
    }
    return result;
}

async function refreshBaseline(guild) {
    if (!isTrackedGuild(guild.id)) return false;
    try {
        const invites = await guild.invites.fetch({ cache: false });
        snapshots.set(guild.id, snapshotInvites(invites));
        console.log(
            "[Invites] Initial baseline loaded: " +
            invites.size + " invite links."
        );
        return true;
    } catch (error) {
        console.warn(
            "[Invites] Could not read invites. Give bot Manage Server: " +
            error.message
        );
        snapshots.delete(guild.id);
        return false;
    }
}

async function initialize(client) {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;

    const guild = await client.guilds.fetch(guildId)
        .catch(() => null);
    if (!guild) {
        console.warn("[Invites] Guild not accessible.");
        return;
    }

    await refreshBaseline(guild);
}

function rememberCreatedInvite(invite) {
    const guildId = invite.guild?.id;
    if (!isTrackedGuild(guildId)) return;
    const snapshot = snapshots.get(guildId);
    if (!snapshot) return;

    snapshot.set(invite.code, {
        uses: Math.max(0, invite.uses || 0),
        inviterId: invite.inviter?.id || null
    });
}

function forgetDeletedInvite(invite) {
    const guildId = invite.guild?.id;
    if (!isTrackedGuild(guildId)) return;
    snapshots.get(guildId)?.delete(invite.code);
}

async function detectInvite(member) {
    const guild = member.guild;
    const before = snapshots.get(guild.id);
    let current;
    try {
        current = snapshotInvites(
            await guild.invites.fetch({ cache: false })
        );
    } catch (error) {
        console.warn(
            "[Invites] Failed to detect who invited " +
            member.id + ": " + error.message
        );
        return { inviterId: null, inviteCode: null };
    }

    // Store the newest counts even when attribution is uncertain.
    snapshots.set(guild.id, current);

    // If we restarted without a snapshot, don't guess.
    if (!before) {
        return { inviterId: null, inviteCode: null };
    }

    const increased = [];
    for (const [code, info] of current.entries()) {
        const previous = before.get(code)?.uses || 0;
        const delta = info.uses - previous;
        if (delta > 0) {
            increased.push({ code, info, delta });
        }
    }

    // Multiple invite links or multiple joins between checks
    // make attributing a specific join unsafe.
    if (increased.length !== 1 || increased[0].delta !== 1) {
        return { inviterId: null, inviteCode: null };
    }

    const match = increased[0];
    const inviterId = match.info.inviterId;

    if (!inviterId || inviterId === member.id) {
        return { inviterId: null, inviteCode: null };
    }

    return {
        inviterId,
        inviteCode: match.code
    };
}

async function countInvites(guildId, inviterId, activeOnly = true) {
    return records().countDocuments({
        guildId,
        inviterId,
        ...(activeOnly ? { active: true } : {})
    });
}

async function getInvitation(guildId, memberId) {
    return records().findOne({
        _id: guildId + ":" + memberId
    });
}

async function recordJoin(member, attribution) {
    const now = new Date();
    await records().updateOne(
        { _id: member.guild.id + ":" + member.id },
        {
            $set: {
                guildId: member.guild.id,
                memberId: member.id,
                inviterId: attribution.inviterId,
                inviteCode: attribution.inviteCode,
                active: true,
                joinedAt: now,
                updatedAt: now
            },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );

    const [theirInvites, inviterInvites] = await Promise.all([
        countInvites(member.guild.id, member.id),
        attribution.inviterId
            ? countInvites(member.guild.id, attribution.inviterId)
            : Promise.resolve(null)
    ]);

    return {
        ...attribution,
        theirInvites,
        inviterInvites
    };
}

async function processMemberJoin(member) {
    if (!isTrackedGuild(member.guild.id) || member.user?.bot) {
        return null;
    }

    // Serialize invite checks for members joining in quick succession.
    // If multiple joins are already reflected in the same snapshot,
    // detectInvite returns Unknown instead of inventing an inviter.
    const guildId = member.guild.id;
    const previous = guildJoinQueues.get(guildId) ||
        Promise.resolve();

    const work = previous
        .catch(() => {})
        .then(async () => {
            const attribution = await detectInvite(member);
            return recordJoin(member, attribution);
        });

    guildJoinQueues.set(guildId, work);
    try {
        return await work;
    } finally {
        if (guildJoinQueues.get(guildId) === work) {
            guildJoinQueues.delete(guildId);
        }
    }
}

async function processMemberLeave(member) {
    if (!isTrackedGuild(member.guild.id) || member.user?.bot) {
        return;
    }

    await records().updateOne(
        { _id: member.guild.id + ":" + member.id },
        {
            $set: {
                active: false,
                leftAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
}

module.exports = {
    isTrackedGuild,
    initialize,
    refreshBaseline,
    rememberCreatedInvite,
    forgetDeletedInvite,
    processMemberJoin,
    processMemberLeave,
    countInvites,
    getInvitation,
    records
};
