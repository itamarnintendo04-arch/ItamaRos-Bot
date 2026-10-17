
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

function getGiveawayCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

async function joinGiveaway(giveawayId, userId) {
    const collection = getGiveawayCollection();

    const { ObjectId } = require("mongodb");

    if (!ObjectId.isValid(giveawayId)) {
        return {
            success: false,
            reason: "INVALID_GIVEAWAY"
        };
    }

    const result = await collection.updateOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $gt: new Date() },
            participants: { $ne: userId }
        },
        {
            $addToSet: {
                participants: userId
            }
        }
    );

    if (result.modifiedCount === 0) {
        const giveaway = await collection.findOne({
            _id: new ObjectId(giveawayId)
        });

        if (!giveaway) {
            return {
                success: false,
                reason: "NOT_FOUND"
            };
        }

        if (
            giveaway.status !== GIVEAWAY_SETTINGS.STATUS.ACTIVE ||
            giveaway.endsAt <= new Date()
        ) {
            return {
                success: false,
                reason: "ENDED"
            };
        }

        return {
            success: false,
            reason: "ALREADY_JOINED"
        };
    }

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId)
    });

    return {
        success: true,
        participants: giveaway.participants.length
    };
}

async function leaveGiveaway(giveawayId, userId) {
    const collection = getGiveawayCollection();

    const { ObjectId } = require("mongodb");

    if (!ObjectId.isValid(giveawayId)) {
        return {
            success: false,
            reason: "INVALID_GIVEAWAY"
        };
    }

    const result = await collection.updateOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $gt: new Date() },
            participants: userId
        },
        {
            $pull: {
                participants: userId
            }
        }
    );

    if (result.modifiedCount === 0) {
        const giveaway = await collection.findOne({
            _id: new ObjectId(giveawayId)
        });

        if (!giveaway) {
            return {
                success: false,
                reason: "NOT_FOUND"
            };
        }

        if (
            giveaway.status !== GIVEAWAY_SETTINGS.STATUS.ACTIVE ||
            giveaway.endsAt <= new Date()
        ) {
            return {
                success: false,
                reason: "ENDED"
            };
        }

        return {
            success: false,
            reason: "NOT_PARTICIPATING"
        };
    }

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId)
    });

    return {
        success: true,
        participants: giveaway.participants.length
    };
}

async function isGiveawayWinner(giveawayId, userId) {
    const { ObjectId } = require("mongodb");

    if (!ObjectId.isValid(giveawayId)) {
        return false;
    }

    const giveaway = await getGiveawayCollection().findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ENDED,
        winners: userId
    });

    return Boolean(giveaway);
}

module.exports = {
    joinGiveaway,
    leaveGiveaway,
    isGiveawayWinner
};
