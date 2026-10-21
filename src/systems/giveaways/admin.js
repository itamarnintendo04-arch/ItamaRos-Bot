
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const COLORS = Object.freeze({
    WARNING: 0xF59E0B,
    ERROR: 0xEF4444
});

function collection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function isValidGiveawayId(id) {
    return (
        typeof id === "string" &&
        ObjectId.isValid(id)
    );
}

function isValidUserId(id) {
    return (
        typeof id === "string" &&
        /^\d{17,20}$/.test(id)
    );
}

function failure(reason) {
    return {
        success: false,
        reason
    };
}

function buildFilter(giveawayId, guildId) {
    const filter = {
        _id: new ObjectId(giveawayId)
    };

    if (guildId) {
        filter.guildId = guildId;
    }

    return filter;
}

function getParticipants(giveaway) {
    return Array.isArray(giveaway?.participants)
        ? giveaway.participants
        : [];
}

function getRemovedParticipants(giveaway) {
    return Array.isArray(giveaway?.removedParticipants)
        ? giveaway.removedParticipants
        : [];
}

function buildParticipantButtons(giveawayId, count) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel(`ENTER • ${count}`)
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("LEAVE")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

function updateEmbedCount(oldEmbed, count) {
    const embed = EmbedBuilder.from(oldEmbed);

    const description = oldEmbed.description || "";

    const patterns = [
        /(\*\*Participants:\*\*\s*)[\d,]+/i,
        /(\*\*Entries:\*\*\s*)[\d,]+/i
    ];

    let updated = false;
    let newDescription = description;

    for (const pattern of patterns) {
        if (pattern.test(newDescription)) {
            newDescription = newDescription.replace(
                pattern,
                (_, prefix) => `${prefix}${count}`
            );

            updated = true;
            break;
        }
    }

    if (!updated) {
        newDescription +=
            `\n\n**Participants:** ${count}`;
    }

    embed.setDescription(newDescription);

    return embed;
}

async function refreshGiveawayMessage(
    client,
    giveawayId
) {
    try {
        const giveaway = await collection().findOne({
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $gt: new Date() }
        });

        if (!giveaway?.messageId) {
            return false;
        }

        const guild = await client.guilds.fetch(
            giveaway.guildId
        ).catch(() => null);

        if (!guild) {
            return false;
        }

        const channel = await guild.channels.fetch(
            giveaway.channelId
        ).catch(() => null);

        if (
            !channel?.isTextBased() ||
            !channel.messages
        ) {
            return false;
        }

        const message = await channel.messages.fetch(
            giveaway.messageId
        ).catch(() => null);

        if (!message || !message.embeds.length) {
            return false;
        }

        const buttons = message.components.flatMap(
            row => row.components
        );

        const joinId =
            `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`;

        const leaveId =
            `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveawayId}`;

        const joinButton = buttons.find(
            button => button.customId === joinId
        );

        const leaveButton = buttons.find(
            button => button.customId === leaveId
        );

        // Only refresh a valid, still-interactive panel.
        // Never recreate buttons after an ending or cancellation.
        if (
            !joinButton ||
            !leaveButton ||
            joinButton.disabled ||
            leaveButton.disabled
        ) {
            return false;
        }

        const count = getParticipants(giveaway).length;

        const embed = updateEmbedCount(
            message.embeds[0],
            count
        );

        await message.edit({
            embeds: [embed],
            components: buildParticipantButtons(
                giveawayId,
                count
            )
        });

        return true;
    } catch (error) {
        console.error(
            "[GiveawayAdmin] Message refresh failed:",
            error
        );

        return false;
    }
}

async function notifyRemovedParticipant(
    client,
    giveaway,
    userId
) {
    try {
        const user = await client.users.fetch(userId);

        const embed = new EmbedBuilder()
            .setColor(COLORS.WARNING)
            .setTitle("⚠️ Giveaway Entry Removed")
            .setDescription(
                [
                    `Your entry in the giveaway for **${giveaway.prize}** was removed by server staff.`,
                    "",
                    "If you want to participate again, you can request approval.",
                    "",
                    "### How to request approval",
                    "1. Return to the original giveaway.",
                    "2. Click **ENTER**.",
                    "3. Wait for an administrator to review your request.",
                    "",
                    "You will be added back automatically if approved."
                ].join("\n")
            )
            .setFooter({
                text: "ItamaRos Bot • Giveaway Management"
            })
            .setTimestamp();

        await user.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });

        return true;
    } catch (error) {
        console.log(
            `[GiveawayAdmin] Could not notify removed user ${userId}.`
        );

        return false;
    }
}

async function getGiveawayEntrants(
    giveawayId,
    options = {}
) {
    if (!isValidGiveawayId(giveawayId)) {
        return failure("INVALID_ID");
    }

    const filter = buildFilter(
        giveawayId,
        options.guildId
    );

    const giveaway = await collection().findOne(
        filter
    );

    if (!giveaway) {
        return failure("NOT_FOUND");
    }

    const participants = getParticipants(giveaway);
    const removedParticipants =
        getRemovedParticipants(giveaway);

    return {
        success: true,
        giveaway,
        participants,
        count: participants.length,
        removedParticipants,
        removedCount: removedParticipants.length
    };
}

async function removeGiveawayParticipant(
    giveawayId,
    userId,
    options = {}
) {
    if (!isValidGiveawayId(giveawayId)) {
        return failure("INVALID_ID");
    }

    if (!isValidUserId(userId)) {
        return failure("INVALID_USER");
    }

    const giveaways = collection();

    const filter = {
        ...buildFilter(
            giveawayId,
            options.guildId
        ),

        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
        endsAt: { $gt: new Date() },
        participants: userId
    };

    // Both operations are atomic on the same document:
    // 1. Remove the user from participants.
    // 2. Block direct re-entry until staff approval.
    const update = {
        $pull: {
            participants: userId
        },

        $addToSet: {
            removedParticipants: userId
        },

        $set: {
            lastParticipantRemovalAt: new Date(),
            ...(options.removedBy
                ? {
                    lastParticipantRemovedBy:
                        options.removedBy
                }
                : {})
        }
    };

    const result = await giveaways.updateOne(
        filter,
        update
    );

    if (result.modifiedCount !== 1) {
        const existing = await giveaways.findOne(
            buildFilter(
                giveawayId,
                options.guildId
            )
        );

        if (!existing) {
            return failure("NOT_FOUND");
        }

        if (
            existing.status !==
                GIVEAWAY_SETTINGS.STATUS.ACTIVE ||
            new Date(existing.endsAt).getTime() <= Date.now()
        ) {
            return failure("ENDED");
        }

        if (
            !getParticipants(existing).includes(userId)
        ) {
            return failure("NOT_PARTICIPATING");
        }

        return failure(
            "NOT_FOUND_OR_NOT_PARTICIPATING"
        );
    }

    // Re-read the document after the atomic update.
    const giveaway = await giveaways.findOne(
        buildFilter(
            giveawayId,
            options.guildId
        )
    );

    if (!giveaway) {
        return failure("NOT_FOUND");
    }

    let messageUpdated = false;
    let dmSent = false;

    if (options.client) {
        // Updating Discord is best-effort.
        // The MongoDB removal remains valid even if it fails.
        messageUpdated = await refreshGiveawayMessage(
            options.client,
            giveawayId
        );

        dmSent = await notifyRemovedParticipant(
            options.client,
            giveaway,
            userId
        );
    }

    console.log(
        `[GiveawayAdmin] Removed ${userId} ` +
        `from giveaway ${giveawayId}.`
    );

    return {
        success: true,

        giveaway,
        userId,

        participants:
            getParticipants(giveaway).length,

        removedParticipants:
            getRemovedParticipants(giveaway),

        messageUpdated,
        dmSent,

        requiresApproval: true
    };
}

module.exports = {
    getGiveawayEntrants,
    removeGiveawayParticipant,
    refreshGiveawayMessage
};
