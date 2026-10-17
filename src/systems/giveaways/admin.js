const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function getGiveawayEntrants(giveawayId) {
    if (!ObjectId.isValid(giveawayId)) {
        return { success: false, reason: "INVALID_ID" };
    }

    const giveaway = await getDatabase()
        .collection(GIVEAWAY_SETTINGS.COLLECTION)
        .findOne({ _id: new ObjectId(giveawayId) });

    if (!giveaway) {
        return { success: false, reason: "NOT_FOUND" };
    }

    return {
        success: true,
        giveaway,
        participants: giveaway.participants || [],
        count: (giveaway.participants || []).length
    };
}

async function removeGiveawayParticipant(giveawayId, userId) {
    if (!ObjectId.isValid(giveawayId)) {
        return { success: false, reason: "INVALID_ID" };
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const result = await collection.updateOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            participants: userId
        },
        {
            $pull: { participants: userId },
            $addToSet: { removedParticipants: userId }
        }
    );

    if (result.modifiedCount === 0) {
        return {
            success: false,
            reason: "NOT_FOUND_OR_NOT_PARTICIPATING"
        };
    }

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId)
    });

    return {
        success: true,
        giveaway,
        participants: giveaway.participants.length
    };
}

module.exports = {
    getGiveawayEntrants,
    removeGiveawayParticipant
};
