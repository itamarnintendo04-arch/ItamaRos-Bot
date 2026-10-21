
const { getDatabase } = require("../../../database");

const { GIVEAWAY_SETTINGS } = require("./config");
const { endGiveaway } = require("./end");
const { finishGiveaway } = require("./finish");

const SCHEDULER_SETTINGS = Object.freeze({
    CHECK_INTERVAL_MS: 30 * 1000,
    RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
    RECOVERY_DELAY_MS: 5 * 60 * 1000,
    BATCH_SIZE: 25,
    MAX_FINALIZATION_ATTEMPTS: 4
});

let schedulerTimer = null;
let isChecking = false;
let isStopping = false;
let lastRecoveryCheck = 0;

function getGiveawaysCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function log(message) {
    console.log(`[GiveawayScheduler] ${message}`);
}

function logError(message, error) {
    console.error(
        `[GiveawayScheduler] ${message}`,
        error
    );
}

async function processExpiredGiveaway(client, giveaway) {
    const giveawayId = giveaway._id.toString();

    try {
        // end.js atomically changes active -> ended.
        // Only the successful transition starts finalization.
        const result = await endGiveaway(giveawayId);

        if (!result.success) {
            log(
                `Skipped ${giveawayId}: ${result.reason}`
            );

            return false;
        }

        log(`Giveaway ended: ${giveawayId}`);

        const finalization = await finishGiveaway(
            client,
            result.giveaway,
            result.winners
        );

        log(
            `Initial finalization: ${giveawayId} | ` +
            `announcement=${Boolean(finalization.announcementSent)}`
        );

        return true;
    } catch (error) {
        logError(
            `Failed to process giveaway ${giveawayId}:`,
            error
        );

        return false;
    }
}

async function processExpiredGiveaways(client) {
    const collection = getGiveawaysCollection();

    const expiredGiveaways = await collection
        .find({
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: {
                $lte: new Date()
            }
        })
        .sort({
            endsAt: 1
        })
        .limit(SCHEDULER_SETTINGS.BATCH_SIZE)
        .toArray();

    if (expiredGiveaways.length === 0) {
        return {
            found: 0,
            processed: 0
        };
    }

    log(
        `Found ${expiredGiveaways.length} expired giveaway(s).`
    );

    let processed = 0;

    for (const giveaway of expiredGiveaways) {
        if (isStopping) break;

        const success = await processExpiredGiveaway(
            client,
            giveaway
        );

        if (success) {
            processed++;
        }
    }

    return {
        found: expiredGiveaways.length,
        processed
    };
}

function needsRecovery(giveaway) {
    const summary = giveaway.finalizationSummary;

    if (!summary) {
        return true;
    }

    if (summary.announcementSent !== true) {
        return true;
    }

    if (
        Number(summary.failedTickets || 0) > 0
    ) {
        return true;
    }

    if (
        Number(summary.ticketSuccessCount || 0) <
        Number(summary.winners || 0)
    ) {
        return true;
    }

    if (
        Number(summary.dmSuccessCount || 0) <
        Number(summary.winners || 0)
    ) {
        return true;
    }

    return false;
}

async function processIncompleteGiveaways(client) {
    const collection = getGiveawaysCollection();

    const cutoff = new Date(
        Date.now() -
        SCHEDULER_SETTINGS.RECOVERY_DELAY_MS
    );

    // The recovery query excludes recently finalized
    // giveaways and those that exhausted retry limits.
    const candidates = await collection
        .find({
            status: GIVEAWAY_SETTINGS.STATUS.ENDED,

            endedAt: {
                $lte: cutoff
            },

            $and: [
                {
                    $or: [
                        {
                            finalizationAttempts: {
                                $exists: false
                            }
                        },
                        {
                            finalizationAttempts: {
                                $lt:
                                    SCHEDULER_SETTINGS.MAX_FINALIZATION_ATTEMPTS
                            }
                        }
                    ]
                },
                {
                    $or: [
                        {
                            lastFinalizationAt: {
                                $exists: false
                            }
                        },
                        {
                            lastFinalizationAt: {
                                $lte: cutoff
                            }
                        }
                    ]
                },
                {
                    $or: [
                        {
                            finalizationSummary: {
                                $exists: false
                            }
                        },
                        {
                            "finalizationSummary.announcementSent": {
                                $ne: true
                            }
                        },
                        {
                            "finalizationSummary.failedTickets": {
                                $gt: 0
                            }
                        },
                        {
                            $expr: {
                                $lt: [
                                    {
                                        $ifNull: [
                                            "$finalizationSummary.ticketSuccessCount",
                                            0
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            "$finalizationSummary.winners",
                                            0
                                        ]
                                    }
                                ]
                            }
                        },
                        {
                            $expr: {
                                $lt: [
                                    {
                                        $ifNull: [
                                            "$finalizationSummary.dmSuccessCount",
                                            0
                                        ]
                                    },
                                    {
                                        $ifNull: [
                                            "$finalizationSummary.winners",
                                            0
                                        ]
                                    }
                                ]
                            }
                        }
                    ]
                }
            ]
        })
        .sort({
            endedAt: 1
        })
        .limit(SCHEDULER_SETTINGS.BATCH_SIZE)
        .toArray();

    let recovered = 0;
    let attempted = 0;

    for (const giveaway of candidates) {
        if (isStopping) break;

        if (!needsRecovery(giveaway)) {
            continue;
        }

        const giveawayId = giveaway._id.toString();

        log(
            `Recovering incomplete giveaway: ${giveawayId}`
        );

        attempted++;

        try {
            const result = await finishGiveaway(
                client,
                giveaway,
                giveaway.winners || []
            );

            const latest = await collection.findOne({
                _id: giveaway._id
            });

            if (
                result &&
                latest &&
                !needsRecovery(latest)
            ) {
                recovered++;

                log(
                    `Recovery completed: ${giveawayId}`
                );
            } else {
                log(
                    `Recovery remains incomplete: ${giveawayId}`
                );
            }
        } catch (error) {
            logError(
                `Recovery failed for ${giveawayId}:`,
                error
            );

            // Prevent an unexpected exception from
            // causing endless immediate retries.
            await collection.updateOne(
                {
                    _id: giveaway._id,
                    status: GIVEAWAY_SETTINGS.STATUS.ENDED
                },
                {
                    $set: {
                        lastFinalizationAt: new Date()
                    },
                    $inc: {
                        finalizationAttempts: 1
                    }
                }
            ).catch(databaseError => {
                logError(
                    "Could not record recovery error:",
                    databaseError
                );
            });
        }
    }

    return {
        found: candidates.length,
        attempted,
        recovered
    };
}

async function checkExpiredGiveaways(client) {
    if (isChecking || isStopping) {
        return {
            success: false,
            reason: "BUSY"
        };
    }

    if (!client?.isReady?.()) {
        return {
            success: false,
            reason: "CLIENT_NOT_READY"
        };
    }

    isChecking = true;

    try {
        const expired = await processExpiredGiveaways(
            client
        );

        let recovery = null;

        const now = Date.now();

        if (
            now - lastRecoveryCheck >=
            SCHEDULER_SETTINGS.RECOVERY_INTERVAL_MS
        ) {
            // Reserve this recovery cycle before awaiting it.
            lastRecoveryCheck = now;

            try {
                recovery = await processIncompleteGiveaways(
                    client
                );
            } catch (error) {
                logError(
                    "Recovery scan failed:",
                    error
                );
            }
        }

        return {
            success: true,
            expired,
            recovery
        };
    } catch (error) {
        logError(
            "Scheduler check failed:",
            error
        );

        return {
            success: false,
            reason: "CHECK_FAILED"
        };
    } finally {
        isChecking = false;
    }
}

function startGiveawayScheduler(client) {
    if (schedulerTimer) {
        log("Scheduler is already running.");

        return false;
    }

    if (!client) {
        throw new Error(
            "A Discord client is required to start the giveaway scheduler."
        );
    }

    isStopping = false;
    lastRecoveryCheck = 0;

    schedulerTimer = setInterval(() => {
        checkExpiredGiveaways(client).catch(error => {
            logError(
                "Unexpected interval failure:",
                error
            );
        });
    }, SCHEDULER_SETTINGS.CHECK_INTERVAL_MS);

    // The Discord client keeps the Node.js process alive.
    // The scheduler timer does not need to do that.
    schedulerTimer.unref?.();

    log(
        `Started. Checks every ` +
        `${SCHEDULER_SETTINGS.CHECK_INTERVAL_MS / 1000}s.`
    );

    // Check immediately after starting, provided the
    // Discord client is already ready.
    checkExpiredGiveaways(client).catch(error => {
        logError(
            "Initial scheduler check failed:",
            error
        );
    });

    return true;
}

function stopGiveawayScheduler() {
    isStopping = true;

    if (!schedulerTimer) {
        return false;
    }

    clearInterval(schedulerTimer);
    schedulerTimer = null;

    log("Scheduler stopped.");

    return true;
}

module.exports = {
    startGiveawayScheduler,
    stopGiveawayScheduler,
    checkExpiredGiveaways,

    // Compatibility aliases for older integrations.
    startScheduler: startGiveawayScheduler,
    stopScheduler: stopGiveawayScheduler
};
