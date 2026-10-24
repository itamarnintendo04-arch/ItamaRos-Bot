"use strict";

const { getDatabase } = require("../../../database");
const { sendKingsWelcome } = require("./welcome");

const RETENTION_MS = 48 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const DISCORD_ID = /^\d{17,20}$/;
const COLLECTION = "kings_boost_history";

let timer = null;
let checking = false;

function history() {
    return getDatabase().collection(COLLECTION);
}

function config() {
    return {
        guildId: String(process.env.GUILD_ID || "").trim(),
        kingsRoleId: String(process.env.KINGS_ROLE_ID || "").trim(),
        welcomeChannelId: String(process.env.KINGS_WELCOME_CHANNEL_ID || "").trim()
    };
}

function readyFor(member) {
    const cfg = config();
    return DISCORD_ID.test(cfg.guildId) &&
        DISCORD_ID.test(cfg.kingsRoleId) &&
        member?.guild?.id === cfg.guildId &&
        !member.user?.bot;
}

function memberKey(guildId, userId) {
    return guildId + ":" + userId;
}

function boostedSince(member) {
    const raw = member?.premiumSinceTimestamp ||
        member?.premiumSince || null;
    const number = Number(raw instanceof Date ? raw.getTime() : raw);
    return Number.isFinite(number) && number > 0 ?
        new Date(number) : null;
}

async function editRole(member, add) {
    const roleId = config().kingsRoleId;
    if (!DISCORD_ID.test(roleId)) {
        throw new Error("KINGS_ROLE_ID is not configured in Render.");
    }
    const role = await member.guild.roles.fetch(roleId);
    if (!role || role.id === member.guild.id || role.managed) {
        throw new Error("Kings role missing or not assignable.");
    }

    const me = await member.guild.members.fetchMe();
    if (me.roles.highest.position <= role.position) {
        throw new Error(
            "Place the bot's highest role ABOVE Kings in Discord."
        );
    }

    const alreadyHas = member.roles.cache.has(roleId);
    if (add && !alreadyHas) {
        await member.roles.add(role, "ItamaRos Kings: server boost");
        return true;
    }
    if (!add && alreadyHas) {
        await member.roles.remove(role, "Kings boost ended before 48 hours");
        return true;
    }
    return false;
}

async function startedBoosting(member, startedAt, options = {}) {
    const now = new Date();
    const key = memberKey(member.guild.id, member.id);
    const previous = await history().findOne({ _id: key });

    // Never claim a manually granted Kings role belongs to the bot.
    const alreadyKings = member.roles.cache.has(config().kingsRoleId);
    const added = await editRole(member, true);
    const botGranted = Boolean(
        previous?.botGranted ||
        (added && !alreadyKings)
    );

    await history().updateOne(
        { _id: key },
        {
            $set: {
                guildId: member.guild.id,
                userId: member.id,
                currentBoostStartedAt: startedAt,
                lastConfirmedBoostAt: now,
                activeBoost: true,
                botGranted,
                permanentKings: Boolean(previous?.permanentKings),
                updatedAt: now
            },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );

    // A permanent King can boost again without losing the earned role.
    if (added && !options.silent) {
        await sendKingsWelcome(member, config().welcomeChannelId)
            .catch(error => {
                console.warn(
                    "[Kings] Welcome announcement failed:",
                    error.message
                );
            });
    }

    console.log(
        "[Kings] Boost detected for " + member.id +
        " (Kings granted: " + added + ")."
    );
    return { added, permanent: Boolean(previous?.permanentKings) };
}

async function stoppedBoosting(member, options = {}) {
    const now = new Date();
    const key = memberKey(member.guild.id, member.id);
    const previous = await history().findOne({ _id: key });

    // A missing end event during Render downtime cannot establish
    // precisely when the boost ended. Only count the last time we
    // actually OBSERVED the boost still active.
    const beganAt = options.startedAt ||
        previous?.currentBoostStartedAt || null;
    const observedEnd = options.lastObservedAt || now;
    const verifiedDuration = beganAt
        ? Math.max(
            0,
            new Date(observedEnd).getTime() -
                new Date(beganAt).getTime()
        )
        : 0;
    const permanent = Boolean(previous?.permanentKings) ||
        verifiedDuration >= RETENTION_MS;

    if (!permanent && previous?.botGranted) {
        await editRole(member, false);
    }

    await history().updateOne(
        { _id: key },
        {
            $set: {
                guildId: member.guild.id,
                userId: member.id,
                activeBoost: false,
                permanentKings: permanent,
                lastBoostStoppedAt: now,
                verifiedBoostDurationMs: verifiedDuration,
                botGranted: permanent
                    ? Boolean(previous?.botGranted)
                    : false,
                updatedAt: now
            },
            $setOnInsert: { createdAt: now }
        },
        { upsert: true }
    );

    console.log(
        "[Kings] " + member.id + " stopped boosting after " +
        Math.floor(verifiedDuration / 3600000) +
        " verified hours. Kings role " +
        (permanent ? "retained." : "not retained.")
    );
    return { permanent, verifiedDuration };
}

async function onMemberUpdate(oldMember, member) {
    if (!readyFor(member)) return;

    const before = boostedSince(oldMember);
    const after = boostedSince(member);

    // Do not react to username, avatar or unrelated role updates.
    if (Boolean(before) === Boolean(after)) return;

    if (after) {
        await startedBoosting(member, after);
        return;
    }
    await stoppedBoosting(member, { startedAt: before });
}

async function checkMembers(client) {
    if (checking) return;
    const cfg = config();
    if (!DISCORD_ID.test(cfg.guildId) ||
        !DISCORD_ID.test(cfg.kingsRoleId)) return;

    checking = true;
    try {
        const guild = await client.guilds.fetch(cfg.guildId);
        const rows = await history().find({
            guildId: cfg.guildId,
            activeBoost: true
        }).limit(1000).toArray();

        for (const saved of rows) {
            try {
                const member = await guild.members.fetch(saved.userId)
                    .catch(() => null);
                if (!member) {
                    // The user left the server. Don't leave an
                    // unverified permanent-rank grant in the database.
                    await history().updateOne(
                        { _id: saved._id },
                        { $set: {
                            activeBoost: false,
                            lastBoostStoppedAt: new Date(),
                            updatedAt: new Date()
                        } }
                    );
                    continue;
                }

                const activeSince = boostedSince(member);
                if (!activeSince) {
                    await stoppedBoosting(member, {
                        startedAt: saved.currentBoostStartedAt,
                        lastObservedAt: saved.lastConfirmedBoostAt ||
                            saved.currentBoostStartedAt
                    });
                    continue;
                }

                const startedAt = activeSince;
                if (!member.roles.cache.has(cfg.kingsRoleId)) {
                    await editRole(member, true);
                }

                await history().updateOne(
                    { _id: saved._id },
                    { $set: {
                        activeBoost: true,
                        currentBoostStartedAt: startedAt,
                        lastConfirmedBoostAt: new Date(),
                        permanentKings: Boolean(saved.permanentKings) ||
                            Date.now() - startedAt.getTime() >= RETENTION_MS,
                        updatedAt: new Date()
                    } }
                );
            } catch (error) {
                console.warn(
                    "[Kings] Could not reconcile user " +
                    saved.userId + ": " + error.message
                );
            }
        }
    } catch (error) {
        console.error("[Kings] Reconciliation failed:", error);
    } finally {
        checking = false;
    }
}

function start(client) {
    if (timer) return;
    if (!DISCORD_ID.test(config().kingsRoleId)) {
        console.warn(
            "[Kings] Set KINGS_ROLE_ID in Render to enable boost ranks."
        );
        return;
    }
    void checkMembers(client);
    timer = setInterval(() => {
        void checkMembers(client);
    }, CHECK_INTERVAL_MS);
    timer.unref?.();
    console.log("[Kings] Boost-role watchdog started.");
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    RETENTION_MS,
    boostedSince,
    onMemberUpdate,
    startedBoosting,
    stoppedBoosting,
    checkMembers,
    start,
    stop
};
