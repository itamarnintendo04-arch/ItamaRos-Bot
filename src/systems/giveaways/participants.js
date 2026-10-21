
const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const RESULT = Object.freeze({
    INVALID_GIVEAWAY: "INVALID_GIVEAWAY",
    INVALID_USER: "INVALID_USER",
    NOT_FOUND: "NOT_FOUND",
    ENDED: "ENDED",
    ALREADY_JOINED: "ALREADY_JOINED",
    NOT_PARTICIPATING: "NOT_PARTICIPATING",
    REMOVED_BY_ADMIN: "REMOVED_BY_ADMIN"
});

function getCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function validateInput(giveawayId, userId) {
    if (
        typeof giveawayId !== "string" ||
        !ObjectId.isValid(giveawayId)
    ) {
        return RESULT.INVALID_GIVEAWAY;
    }

    if (
        typeof userId !== "string" ||
        !/^\d{17,20}$/.test(userId)
    ) {
        return RESULT.INVALID_USER;
    }

    return null;
}

function failure(reason) {
    return {
        success: false,
        reason
    };
}

function getParticipantCount(giveaway) {
    return Array.isArray(giveaway?.participants)
        ? giveaway.participants.length
        : 0;
}

function isActive(giveaway) {
    return (
        giveaway?.status === GIVEAWAY_SETTINGS.STATUS.ACTIVE &&
        new Date(giveaway.endsAt).getTime() > Date.now()
    );
}

async function classifyFailure(
    giveawayId,
    userId,
    action
) {
    const giveaway = await getCollection().findOne(
        {
            _id: new ObjectId(giveawayId)
        },
        {
            projection: {
                status: 1,
                endsAt: 1,
                participants: 1,
                removedParticipants: 1
            }
        }
    );

    if (!giveaway) {
        return failure(RESULT.NOT_FOUND);
    }

    if (!isActive(giveaway)) {
        return failure(RESULT.ENDED);
    }

    const participants = Array.isArray(giveaway.participants)
        ? giveaway.participants
        : [];

    const removedParticipants = Array.isArray(
        giveaway.removedParticipants
    )
        ? giveaway.removedParticipants
        : [];

    if (
        action === "join" &&
        removedParticipants.includes(userId)
    ) {
        return failure(RESULT.REMOVED_BY_ADMIN);
    }

    if (
        action === "join" &&
        participants.includes(userId)
    ) {
        return failure(RESULT.ALREADY_JOINED);
    }

    if (
        action === "leave" &&
        !participants.includes(userId)
    ) {
        return failure(RESULT.NOT_PARTICIPATING);
    }

    // The document may have changed during another request.
    // Return a safe fallback rather than reporting success.
    return failure(
        action === "join"
            ? RESULT.ALREADY_JOINED
            : RESULT.NOT_PARTICIPATING
    );
}

async function joinGiveaway(giveawayId, userId) {
    const validationError = validateInput(
        giveawayId,
        userId
    );

    if (validationError) {
        return failure(validationError);
    }

    const collection = getCollection();
    const now = new Date();

    const filter = {
        _id: new ObjectId(giveawayId),

        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,

        endsAt: {
            $gt: now
        },

        participants: {
            $ne: userId
        },

        // Critical security rule:
        // Users removed by staff cannot rejoin directly.
        removedParticipants: {
            $ne: userId
        }
    };

    const update = {
        $addToSet: {
            participants: userId
        }
    };

    const result = await collection.findOneAndUpdate(
        filter,
        update,
        {
            returnDocument: "after",
            projection: {
                participants: 1,
                endsAt: 1,
                status: 1
            }
        }
    );

    if (!result) {
        return classifyFailure(
            giveawayId,
            userId,
            "join"
        );
    }

    return {
        success: true,
        action: "JOINED",
        giveawayId,
        userId,
        participants: getParticipantCount(result),
        endsAt: result.endsAt
    };
}

async function leaveGiveaway(giveawayId, userId) {
    const validationError = validateInput(
        giveawayId,
        userId
    );

    if (validationError) {
        return failure(validationError);
    }

    const collection = getCollection();

    const filter = {
        _id: new ObjectId(giveawayId),

        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,

        endsAt: {
            $gt: new Date()
        },

        participants: userId
    };

    const update = {
        $pull: {
            participants: userId
        }
    };

    const result = await collection.findOneAndUpdate(
        filter,
        update,
        {
            returnDocument: "after",
            projection: {
                participants: 1,
                status: 1
            }
        }
    );

    if (!result) {
        return classifyFailure(
            giveawayId,
            userId,
            "leave"
        );
    }

    return {
        success: true,
        action: "LEFT",
        giveawayId,
        userId,
        participants: getParticipantCount(result)
    };
}

async function isGiveawayWinner(giveawayId, userId) {
    const validationError = validateInput(
        giveawayId,
        userId
    );

    if (validationError) {
        return false;
    }

    const giveaway = await getCollection().findOne(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ENDED,
            winners: userId
        },
        {
            projection: {
                _id: 1
            }
        }
    );

    return Boolean(giveaway);
}

module.exports = {
    joinGiveaway,
    leaveGiveaway,
    isGiveawayWinner
};
