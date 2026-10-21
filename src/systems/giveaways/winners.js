
const { EmbedBuilder } = require("discord.js");
const { ObjectId } = require("mongodb");
const { randomUUID } = require("node:crypto");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const NOTIFICATION_COLLECTION = "giveaway_winner_notifications";

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E,
    WARNING: 0xF59E0B
});

function getCollections() {
    const db = getDatabase();

    return {
        giveaways: db.collection(
            GIVEAWAY_SETTINGS.COLLECTION
        ),
        notifications: db.collection(
            NOTIFICATION_COLLECTION
        )
    };
}

function isDiscordId(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function getGiveawayLink(giveaway) {
    if (
        !giveaway.guildId ||
        !giveaway.channelId ||
        !giveaway.messageId
    ) {
        return null;
    }

    return [
        "https://discord.com/channels",
        giveaway.guildId,
        giveaway.channelId,
        giveaway.messageId
    ].join("/");
}

function getTicketLink(giveaway, channelId) {
    if (
        !isDiscordId(giveaway.guildId) ||
        !isDiscordId(channelId)
    ) {
        return null;
    }

    return (
        `https://discord.com/channels/` +
        `${giveaway.guildId}/${channelId}`
    );
}

function getTicketInstructions(giveaway, ticketResult) {
    if (ticketResult?.success && ticketResult.channelId) {
        const link = getTicketLink(
            giveaway,
            ticketResult.channelId
        );

        if (link) {
            return [
                "✅ **Your private winner ticket is ready!**",
                "",
                `🎫 [Open Your Winner Ticket](${link})`,
                "",
                "Our staff will help you claim your prize there."
            ].join("\n");
        }
    }

    if (ticketResult?.reason === "ACTIVE_TICKET") {
        const link = getTicketLink(
            giveaway,
            ticketResult.channelId
        );

        return [
            "⚠️ **You already have another active ticket.**",
            "",
            link
                ? `[Open Your Existing Ticket](${link})`
                : "Please contact the server staff.",
            "",
            "Ask a staff member to help you claim your giveaway prize."
        ].join("\n");
    }

    if (ticketResult?.reason === "IN_PROGRESS") {
        return [
            "⏳ **Your winner ticket is being prepared.**",
            "",
            "Please allow a little time for the ticket to appear.",
            "If it does not appear, contact the server staff."
        ].join("\n");
    }

    return [
        "⚠️ **Your winner ticket could not be created automatically.**",
        "",
        "Please contact the server staff to claim your prize.",
        "Your giveaway win is still valid."
    ].join("\n");
}

function buildWinnerEmbed(giveaway, ticketResult) {
    const ticketInstructions = getTicketInstructions(
        giveaway,
        ticketResult
    );

    const originalLink = getGiveawayLink(giveaway);

    const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle("🏆 YOU WON A GIVEAWAY!")
        .setDescription(
            [
                "## 🎉 Congratulations!",
                "",
                "You've been selected as a winner of an **ItamaRos Giveaway!**",
                "",
                "Your prize is waiting for you!",
                "",
                "Please follow the instructions below to claim it."
            ].join("\n")
        )
        .addFields(
            {
                name: "🎁 Your Prize",
                value: String(
                    giveaway.prize || "Giveaway Prize"
                ).slice(0, 1024),
                inline: false
            },
            {
                name: "🎫 Your Winner Ticket",
                value: ticketInstructions.slice(0, 1024),
                inline: false
            },
            {
                name: "📋 What's Next?",
                value: [
                    "Follow the instructions above.",
                    "A staff member will assist you with your reward."
                ].join("\n"),
                inline: false
            }
        )
        .setFooter({
            text: "ItamaRos Bot • Giveaway Rewards"
        })
        .setTimestamp();

    if (originalLink) {
        embed.addFields({
            name: "🎉 Original Giveaway",
            value: `[View Giveaway Results](${originalLink})`,
            inline: false
        });
    }

    if (giveaway.imageUrl) {
        embed.setThumbnail(giveaway.imageUrl);
    }

    return embed;
}

async function claimNotification(
    notifications,
    giveawayId,
    winnerId
) {
    const id = `${giveawayId}:${winnerId}`;
    const now = new Date();
    const token = randomUUID();

    const expiredAt = new Date(
        now.getTime() - LOCK_TIMEOUT_MS
    );

    try {
        const result = await notifications.findOneAndUpdate(
            {
                _id: id,
                $or: [
                    {
                        status: {
                            $exists: false
                        }
                    },
                    {
                        status: "failed"
                    },
                    {
                        status: "processing",
                        lockedAt: {
                            $lt: expiredAt
                        }
                    }
                ]
            },
            {
                $set: {
                    giveawayId,
                    winnerId,
                    status: "processing",
                    token,
                    lockedAt: now,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                },
                $inc: {
                    attempts: 1
                }
            },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

        const document = result?.value ?? result;

        if (!document || document.token !== token) {
            return null;
        }

        return {
            id,
            token
        };
    } catch (error) {
        // Another process has already claimed or
        // completed the same winner notification.
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function markNotificationSent(
    notifications,
    claim,
    ticketResult
) {
    const result = await notifications.updateOne(
        {
            _id: claim.id,
            token: claim.token,
            status: "processing"
        },
        {
            $set: {
                status: "sent",
                sentAt: new Date(),
                ticketChannelId:
                    ticketResult?.channelId || null
            },
            $unset: {
                token: "",
                lockedAt: ""
            }
        }
    );

    return result.modifiedCount === 1;
}

async function markNotificationFailed(
    notifications,
    claim,
    error
) {
    await notifications.updateOne(
        {
            _id: claim.id,
            token: claim.token,
            status: "processing"
        },
        {
            $set: {
                status: "failed",
                failedAt: new Date(),
                errorCode:
                    String(error?.code || "SEND_FAILED").slice(0, 80)
            },
            $unset: {
                token: "",
                lockedAt: ""
            }
        }
    );
}

async function sendWinnerNotification(
    client,
    giveaway,
    winnerId,
    ticketResult,
    notifications
) {
    const giveawayId = giveaway._id.toString();

    const claim = await claimNotification(
        notifications,
        giveawayId,
        winnerId
    );

    if (!claim) {
        const existing = await notifications.findOne({
            _id: `${giveawayId}:${winnerId}`
        });

        return {
            userId: winnerId,
            dmSent: existing?.status === "sent",
            alreadySent: existing?.status === "sent",
            reason: existing?.status === "sent"
                ? "ALREADY_SENT"
                : "ALREADY_PROCESSING"
        };
    }

    let delivered = false;

    try {
        const user = await client.users.fetch(
            winnerId
        );

        const embed = buildWinnerEmbed(
            giveaway,
            ticketResult
        );

        await user.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });

        delivered = true;

        const recorded = await markNotificationSent(
            notifications,
            claim,
            ticketResult
        );

        if (!recorded) {
            console.warn(
                `[Giveaways] DM delivered but completion could not be confirmed: ${winnerId}`
            );
        }

        console.log(
            `[Giveaways] Winner DM delivered to ${winnerId}.`
        );

        return {
            userId: winnerId,
            dmSent: true,
            alreadySent: false,
            recorded
        };
    } catch (error) {
        console.error(
            `[Giveaways] Winner notification error for ${winnerId}:`,
            error
        );

        // Never retry immediately when the DM was already delivered.
        if (!delivered) {
            await markNotificationFailed(
                notifications,
                claim,
                error
            ).catch(databaseError => {
                console.error(
                    "[Giveaways] Failed to store notification error:",
                    databaseError
                );
            });
        }

        return {
            userId: winnerId,
            dmSent: delivered,
            reason: delivered
                ? "DELIVERED_NOT_RECORDED"
                : "DM_FAILED"
        };
    }
}

async function notifyGiveawayWinners(
    client,
    giveaway,
    winners = [],
    ticketResults = []
) {
    if (
        !giveaway?._id ||
        !ObjectId.isValid(giveaway._id.toString())
    ) {
        console.error(
            "[Giveaways] Invalid giveaway provided to notifications."
        );

        return [];
    }

    const giveawayId = giveaway._id.toString();
    const { giveaways, notifications } = getCollections();

    // Read the final result from MongoDB.
    // The giveaway object passed by end.js may be
    // a snapshot from before the status changed.
    const current = await giveaways.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ENDED
    });

    if (!current) {
        console.warn(
            `[Giveaways] Winner notification blocked: giveaway ${giveawayId} is not ended.`
        );

        return [];
    }

    const confirmedWinners = new Set(
        Array.isArray(current.winners)
            ? current.winners.filter(isDiscordId)
            : []
    );

    const requestedWinners = new Set(
        Array.isArray(winners)
            ? winners.filter(isDiscordId)
            : []
    );

    // Only notify confirmed winners who were
    // included in the finish process.
    const eligibleWinners = [...requestedWinners].filter(
        id => confirmedWinners.has(id)
    );

    const results = Array.isArray(ticketResults)
        ? ticketResults
        : [];

    const notificationResults = [];

    for (const winnerId of eligibleWinners) {
        const ticketResult = results.find(
            result => result.userId === winnerId
        );

        try {
            const result = await sendWinnerNotification(
                client,
                current,
                winnerId,
                ticketResult,
                notifications
            );

            notificationResults.push(result);
        } catch (error) {
            console.error(
                `[Giveaways] Unexpected notification failure for ${winnerId}:`,
                error
            );

            notificationResults.push({
                userId: winnerId,
                dmSent: false,
                reason: "UNEXPECTED_ERROR"
            });
        }
    }

    const deliveredCount = notificationResults.filter(
        result => result.dmSent
    ).length;

    console.log(
        `[Giveaways] Notifications processed: ` +
        `${deliveredCount}/${eligibleWinners.length} ` +
        `for giveaway ${giveawayId}.`
    );

    return notificationResults;
}

module.exports = {
    notifyGiveawayWinners
};
