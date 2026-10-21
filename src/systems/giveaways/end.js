
const { randomInt } = require("node:crypto");
const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const MAX_RETRIES = 5;

const END_REASONS = Object.freeze({
    INVALID_ID: "INVALID_ID",
    NOT_FOUND: "NOT_FOUND",
    NOT_ENDED: "NOT_ENDED",
    ALREADY_ENDED: "ALREADY_ENDED",
    CANCELLED: "CANCELLED",
    CONCURRENT_UPDATE: "CONCURRENT_UPDATE"
});

function getCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function failure(reason) {
    return {
        success: false,
        reason
    };
}

function isValidGiveawayId(value) {
    return (
        typeof value === "string" &&
        /^[a-fA-F0-9]{24}$/.test(value)
    );
}

function isValidDiscordId(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function getEligibleParticipants(giveaway) {
    if (!Array.isArray(giveaway.participants)) {
        return [];
    }

    const removedUsers = new Set(
        Array.isArray(giveaway.removedParticipants)
            ? giveaway.removedParticipants
            : []
    );

    const eligibleUsers = giveaway.participants.filter(
        userId =>
            isValidDiscordId(userId) &&
            !removedUsers.has(userId)
    );

    // Remove duplicate IDs while preserving each user's
    // single valid entry.
    return [...new Set(eligibleUsers)];
}

function getWinnerCount(giveaway) {
    const requested = Number(giveaway.winnerCount);

    if (!Number.isInteger(requested) || requested < 1) {
        return 1;
    }

    return Math.min(
        requested,
        GIVEAWAY_SETTINGS.MAX_WINNERS
    );
}

function selectWinners(participants, requestedCount) {
    if (!participants.length) {
        return [];
    }

    const pool = [...participants];

    // Fisher-Yates shuffle using Node.js crypto.
    // randomInt avoids modulo bias.
    for (let i = pool.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);

        [pool[i], pool[j]] = [
            pool[j],
            pool[i]
        ];
    }

    const count = Math.min(
        requestedCount,
        pool.length
    );

    return pool.slice(0, count);
}

function buildParticipantsCondition(giveaway) {
    // The update must use the same participant list
    // that was used to select the winners.
    //
    // If someone joins or leaves in between,
    // MongoDB will reject this finalization attempt.

    if (Array.isArray(giveaway.participants)) {
        return {
            participants: giveaway.participants
        };
    }

    return {
        participants: {
            $exists: false
        }
    };
}

async function getFailureReason(
    collection,
    giveawayId,
    manual
) {
    const current = await collection.findOne({
        _id: new ObjectId(giveawayId)
    });

    if (!current) {
        return END_REASONS.NOT_FOUND;
    }

    if (
        current.status ===
        GIVEAWAY_SETTINGS.STATUS.ENDED
    ) {
        return END_REASONS.ALREADY_ENDED;
    }

    if (
        current.status ===
        GIVEAWAY_SETTINGS.STATUS.CANCELLED
    ) {
        return END_REASONS.CANCELLED;
    }

    if (
        !manual &&
        new Date(current.endsAt).getTime() > Date.now()
    ) {
        return END_REASONS.NOT_ENDED;
    }

    return END_REASONS.CONCURRENT_UPDATE;
}

async function finalizeGiveaway(
    giveawayId,
    { manual = false } = {}
) {
    if (!isValidGiveawayId(giveawayId)) {
        return failure(END_REASONS.INVALID_ID);
    }

    const collection = getCollection();
    const objectId = new ObjectId(giveawayId);

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES;
        attempt++
    ) {
        const now = new Date();

        const filter = {
            _id: objectId,
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
        };

        // Automatic endings are allowed only after
        // the scheduled ending time.
        if (!manual) {
            filter.endsAt = {
                $lte: now
            };
        }

        const giveaway = await collection.findOne(
            filter
        );

        if (!giveaway) {
            const reason = await getFailureReason(
                collection,
                giveawayId,
                manual
            );

            return failure(reason);
        }

        const eligibleParticipants =
            getEligibleParticipants(giveaway);

        const winnerCount =
            getWinnerCount(giveaway);

        const winners = selectWinners(
            eligibleParticipants,
            winnerCount
        );

        const completedAt = new Date();

        // Compare against the exact participant array.
        // Only one active -> ended transition can succeed.
        const updateFilter = {
            _id: objectId,
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,

            ...buildParticipantsCondition(giveaway)
        };

        if (!manual) {
            updateFilter.endsAt = {
                $lte: completedAt
            };
        }

        const update = {
            $set: {
                status: GIVEAWAY_SETTINGS.STATUS.ENDED,

                winners,
                endedAt: completedAt,

                manuallyEnded: manual,

                eligibleEntries:
                    eligibleParticipants.length,

                actualWinnerCount:
                    winners.length,

                finalizationVersion: 2
            }
        };

        const result = await collection.updateOne(
            updateFilter,
            update
        );

        if (result.modifiedCount === 1) {
            const completedGiveaway =
                await collection.findOne({
                    _id: objectId
                });

            const finalGiveaway = completedGiveaway || {
                ...giveaway,
                status: GIVEAWAY_SETTINGS.STATUS.ENDED,
                ...update.$set
            };

            console.log(
                [
                    "[Giveaways] Giveaway finalized",
                    `ID: ${giveawayId}`,
                    `Mode: ${manual ? "manual" : "automatic"}`,
                    `Entries: ${eligibleParticipants.length}`,
                    `Winners: ${winners.length}`,
                    `Attempts: ${attempt}`
                ].join(" | ")
            );

            return {
                success: true,

                giveaway: finalGiveaway,
                winners,

                winnerCount: winners.length,
                participantCount:
                    eligibleParticipants.length,

                manuallyEnded: manual,
                endedAt: completedAt
            };
        }

        // The status or participant list changed.
        // Retry using a fresh database snapshot.
        console.warn(
            `[Giveaways] Finalization conflict for ` +
            `${giveawayId}. Attempt ${attempt}/${MAX_RETRIES}.`
        );
    }

    const reason = await getFailureReason(
        collection,
        giveawayId,
        manual
    );

    return failure(reason);
}

async function endGiveaway(giveawayId) {
    return finalizeGiveaway(
        giveawayId,
        { manual: false }
    );
}

async function forceEndGiveaway(giveawayId) {
    return finalizeGiveaway(
        giveawayId,
        { manual: true }
    );
}

module.exports = {
    endGiveaway,
    forceEndGiveaway,
    selectWinners,
    getEligibleParticipants
};
