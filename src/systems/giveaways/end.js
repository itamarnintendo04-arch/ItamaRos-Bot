
const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function endGiveaway(giveawayId) {
    if (!ObjectId.isValid(giveawayId)) {
        throw new Error("Invalid giveaway ID.");
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
    });

    if (!giveaway) {
        return {
            success: false,
            reason: "NOT_FOUND"
        };
    }

    if (giveaway.endsAt > new Date()) {
        return {
            success: false,
            reason: "NOT_ENDED"
        };
    }

    const participants = [...new Set(giveaway.participants)];

    const shuffled = [...participants];

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const winners = shuffled.slice(
        0,
        giveaway.winnerCount
    );

    const result = await collection.updateOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $lte: new Date() }
        },
        {
            $set: {
                status: GIVEAWAY_SETTINGS.STATUS.ENDED,
                winners,
                endedAt: new Date()
            }
        }
    );

    if (result.modifiedCount === 0) {
        return {
            success: false,
            reason: "ALREADY_ENDED"
        };
    }

    return {
        success: true,
        giveaway,
        winners
    };
}

async function forceEndGiveaway(giveawayId) {
    if (!ObjectId.isValid(giveawayId)) {
        throw new Error("Invalid giveaway ID.");
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
    });

    if (!giveaway) {
        return {
            success: false,
            reason: "NOT_FOUND"
        };
    }

    const participants = [...new Set(giveaway.participants)];
    const shuffled = [...participants];

    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const winners = shuffled.slice(
        0,
        giveaway.winnerCount
    );

    const result = await collection.updateOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
        },
        {
            $set: {
                status: GIVEAWAY_SETTINGS.STATUS.ENDED,
                winners,
                endedAt: new Date(),
                manuallyEnded: true
            }
        }
    );

    if (result.modifiedCount === 0) {
        return {
            success: false,
            reason: "ALREADY_ENDED"
        };
    }

    return {
        success: true,
        giveaway,
        winners
    };
}

module.exports = {
    endGiveaway,
    forceEndGiveaway
};
