
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");

const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const COLORS = Object.freeze({
    CANCELLED: 0xEF4444
});

const CANCEL_REASONS = Object.freeze({
    INVALID_ID: "INVALID_ID",
    NOT_FOUND: "NOT_FOUND",
    ALREADY_CANCELLED: "ALREADY_CANCELLED",
    ALREADY_ENDED: "ALREADY_ENDED",
    CONFLICT: "CONFLICT"
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

function getParticipantCount(giveaway) {
    return Array.isArray(giveaway.participants)
        ? giveaway.participants.length
        : 0;
}

function safePrize(value) {
    return String(value || "Unknown Prize")
        .replace(/@/g, "@\u200b")
        .slice(0, 200);
}

function getDiscordTimestamp(value) {
    const milliseconds = new Date(value).getTime();

    if (!Number.isFinite(milliseconds)) {
        return null;
    }

    return Math.floor(milliseconds / 1000);
}

function buildCancelledEmbed(giveaway) {
    const cancelledAt =
        giveaway.cancelledAt || new Date();

    const timestamp = getDiscordTimestamp(
        cancelledAt
    );

    const host = giveaway.hostId
        ? `<@${giveaway.hostId}>`
        : "Unknown";

    const lines = [
        "## 🚫 This Giveaway Has Been Cancelled",
        "",
        "This giveaway was cancelled by server staff.",
        "",
        "No winners have been selected.",
        "",
        `**👑 Hosted by:** ${host}`,
        `**👥 Final Entries:** ${getParticipantCount(giveaway)}`,
        "**📋 Status:** Cancelled"
    ];

    if (timestamp) {
        lines.push(
            `**🕒 Cancelled:** <t:${timestamp}:F>`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(COLORS.CANCELLED)
        .setTitle(
            `🚫 GIVEAWAY CANCELLED • ${safePrize(giveaway.prize)}`
                .slice(0, 256)
        )
        .setDescription(lines.join("\n"))
        .setFooter({
            text: "ItamaRos Bot • Giveaways"
        })
        .setTimestamp(cancelledAt);

    if (
        typeof giveaway.imageUrl === "string" &&
        /^https:\/\//i.test(giveaway.imageUrl)
    ) {
        embed.setImage(giveaway.imageUrl);
    }

    return embed;
}

function buildDisabledButtons(giveawayId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("CANCELLED")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),

            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("CLOSED")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        )
    ];
}

async function getCancellationFailureReason(giveawayId) {
    const giveaway = await getCollection().findOne(
        {
            _id: new ObjectId(giveawayId)
        },
        {
            projection: {
                status: 1
            }
        }
    );

    if (!giveaway) {
        return CANCEL_REASONS.NOT_FOUND;
    }

    if (
        giveaway.status ===
        GIVEAWAY_SETTINGS.STATUS.CANCELLED
    ) {
        return CANCEL_REASONS.ALREADY_CANCELLED;
    }

    if (
        giveaway.status ===
        GIVEAWAY_SETTINGS.STATUS.ENDED
    ) {
        return CANCEL_REASONS.ALREADY_ENDED;
    }

    return CANCEL_REASONS.CONFLICT;
}

async function cancelGiveaway(giveawayId) {
    if (!isValidGiveawayId(giveawayId)) {
        return failure(CANCEL_REASONS.INVALID_ID);
    }

    const collection = getCollection();
    const objectId = new ObjectId(giveawayId);

    const cancelledAt = new Date();

    // Atomic state transition:
    // Only an ACTIVE giveaway may become CANCELLED.
    //
    // This prevents an already-ended giveaway from
    // being cancelled after winners were selected.
    const result = await collection.updateOne(
        {
            _id: objectId,
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
        },
        {
            $set: {
                status: GIVEAWAY_SETTINGS.STATUS.CANCELLED,
                cancelledAt,
                cancellationVersion: 2
            }
        }
    );

    if (result.modifiedCount !== 1) {
        return failure(
            await getCancellationFailureReason(giveawayId)
        );
    }

    // Fetch the authoritative cancelled record.
    const giveaway = await collection.findOne({
        _id: objectId,
        status: GIVEAWAY_SETTINGS.STATUS.CANCELLED
    });

    if (!giveaway) {
        // The cancellation has already succeeded,
        // even if this follow-up read failed to locate it.
        return {
            success: true,
            giveaway: {
                _id: objectId,
                status: GIVEAWAY_SETTINGS.STATUS.CANCELLED,
                cancelledAt
            },
            messageUpdatePossible: false
        };
    }

    console.log(
        `[Giveaways] Cancelled giveaway ${giveawayId}.`
    );

    return {
        success: true,
        giveaway,
        cancelledAt,
        messageUpdatePossible: Boolean(
            giveaway.guildId &&
            giveaway.channelId &&
            giveaway.messageId
        )
    };
}

async function disableCancelledGiveaway(client, giveaway) {
    try {
        if (!giveaway?._id) {
            return false;
        }

        const giveawayId = giveaway._id.toString();

        if (!isValidGiveawayId(giveawayId)) {
            return false;
        }

        // Never trust an outdated snapshot.
        // A Discord edit must be performed only
        // for a giveaway that is actually cancelled.
        const current = await getCollection().findOne({
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.CANCELLED
        });

        if (!current) {
            console.warn(
                `[Giveaways] Giveaway is not cancelled: ${giveawayId}`
            );

            return false;
        }

        if (
            !current.guildId ||
            !current.channelId ||
            !current.messageId
        ) {
            console.warn(
                `[Giveaways] Missing original message reference: ${giveawayId}`
            );

            return false;
        }

        const guild = await client.guilds.fetch(
            current.guildId
        ).catch(() => null);

        if (!guild) {
            console.warn(
                `[Giveaways] Guild unavailable: ${giveawayId}`
            );

            return false;
        }

        const channel = await guild.channels.fetch(
            current.channelId
        ).catch(() => null);

        if (
            !channel?.isTextBased() ||
            !channel.messages
        ) {
            console.warn(
                `[Giveaways] Channel unavailable: ${giveawayId}`
            );

            return false;
        }

        const message = await channel.messages.fetch(
            current.messageId
        ).catch(() => null);

        if (!message) {
            console.warn(
                `[Giveaways] Original message unavailable: ${giveawayId}`
            );

            return false;
        }

        const embed = buildCancelledEmbed(current);

        // This edits the ORIGINAL giveaway message.
        // No separate winner announcement is created.
        await message.edit({
            content: "🚫 **This giveaway has been cancelled.**",
            embeds: [embed],
            components: buildDisabledButtons(giveawayId),
            allowedMentions: {
                parse: []
            }
        });

        // Best-effort tracking for diagnostics.
        try {
            await getCollection().updateOne(
                {
                    _id: current._id,
                    status: GIVEAWAY_SETTINGS.STATUS.CANCELLED
                },
                {
                    $set: {
                        cancelledMessageUpdatedAt: new Date()
                    },
                    $unset: {
                        cancelledMessageUpdateError: ""
                    }
                }
            );
        } catch (databaseError) {
            console.error(
                "[Giveaways] Cancellation message was updated, " +
                "but MongoDB tracking failed:",
                databaseError
            );
        }

        console.log(
            `[Giveaways] Original cancellation message updated: ${giveawayId}`
        );

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Could not update cancelled giveaway:",
            error
        );

        // MongoDB cancellation is still valid.
        // Record the failure for troubleshooting.
        try {
            const giveawayId = giveaway?._id?.toString();

            if (isValidGiveawayId(giveawayId)) {
                await getCollection().updateOne(
                    {
                        _id: new ObjectId(giveawayId),
                        status: GIVEAWAY_SETTINGS.STATUS.CANCELLED
                    },
                    {
                        $set: {
                            cancelledMessageUpdateError:
                                String(error.message || "UNKNOWN_ERROR")
                                    .slice(0, 250),
                            cancelledMessageUpdateFailedAt:
                                new Date()
                        }
                    }
                );
            }
        } catch (databaseError) {
            console.error(
                "[Giveaways] Could not save cancellation error:",
                databaseError
            );
        }

        return false;
    }
}

module.exports = {
    cancelGiveaway,
    disableCancelledGiveaway
};
