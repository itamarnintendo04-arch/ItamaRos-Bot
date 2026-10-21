
const {
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { randomUUID } = require("node:crypto");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const { announceGiveawayEnd } = require("./announce");
const { notifyGiveawayWinners } = require("./winners");
const { createGiveawayWinnerTicket } = require("./winnerTicket");

const STAFF_NOTIFICATIONS = "giveaway_staff_notifications";
const STAFF_LOCK_MS = 5 * 60 * 1000;

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E,
    WARNING: 0xF59E0B,
    INFO: 0x8B5CF6
});

function isDiscordId(value) {
    return typeof value === "string" &&
        /^\d{17,20}$/.test(value);
}

function giveawayUrl(giveaway) {
    if (
        !giveaway.guildId ||
        !giveaway.channelId ||
        !giveaway.messageId
    ) {
        return null;
    }

    return (
        `https://discord.com/channels/` +
        `${giveaway.guildId}/` +
        `${giveaway.channelId}/` +
        `${giveaway.messageId}`
    );
}

function uniqueWinnerIds(giveaway) {
    if (!Array.isArray(giveaway.winners)) {
        return [];
    }

    return [
        ...new Set(
            giveaway.winners.filter(isDiscordId)
        )
    ];
}

function buildStaffEmbed(
    giveaway,
    winners,
    ticketResults
) {
    const noWinners = winners.length === 0;

    const successful = ticketResults.filter(
        result => result.success
    ).length;

    const failures = ticketResults.filter(
        result => !result.success
    );

    const winnerText = noWinners
        ? "No eligible winners."
        : winners.map(
            id => `<@${id}>`
        ).join("\n").slice(0, 1000);

    const ticketText = noWinners
        ? "No winner tickets required."
        : `${successful}/${winners.length} winner tickets available.`;

    const embed = new EmbedBuilder()
        .setColor(
            failures.length ? COLORS.WARNING : COLORS.SUCCESS
        )
        .setTitle(
            noWinners
                ? "🎁 Giveaway Ended — No Winners"
                : "🏆 Giveaway Results — Staff Notice"
        )
        .setDescription(
            [
                "An ItamaRos giveaway has finished.",
                "",
                "**Staff Action:**",
                noWinners
                    ? "No prizes need to be distributed."
                    : "Please make sure the winners receive their prizes through their private tickets."
            ].join("\n")
        )
        .addFields(
            {
                name: "🎁 Prize",
                value: String(
                    giveaway.prize || "Unknown"
                ).slice(0, 1024)
            },
            {
                name: "🏆 Winners",
                value: winnerText || "None"
            },
            {
                name: "🎫 Winner Tickets",
                value: ticketText
            },
            {
                name: "📋 Giveaway ID",
                value: `\`${giveaway._id.toString()}\``
            }
        )
        .setFooter({
            text: "ItamaRos Bot • Staff Notifications"
        })
        .setTimestamp();

    if (failures.length) {
        const failureText = failures.map(result => {
            return (
                `<@${result.userId}> — ` +
                `${result.reason || "UNKNOWN_ERROR"}`
            );
        }).join("\n");

        embed.addFields({
            name: "⚠️ Tickets Requiring Attention",
            value: failureText.slice(0, 1024) || "Unknown"
        });
    }

    const url = giveawayUrl(giveaway);

    if (url) {
        embed.addFields({
            name: "🔗 Giveaway",
            value: `[View Results](${url})`
        });
    }

    return embed;
}

async function getStaffRecipients(client, giveaway) {
    const recipients = new Set();

    const guild = await client.guilds.fetch(
        giveaway.guildId
    ).catch(() => null);

    if (!guild) {
        return {
            guildFound: false,
            ids: []
        };
    }

    // Always include the server owner and the host.
    if (isDiscordId(guild.ownerId)) {
        recipients.add(guild.ownerId);
    }

    if (isDiscordId(giveaway.hostId)) {
        recipients.add(giveaway.hostId);
    }

    // Fetch server members to identify authorized managers.
    // This requires the appropriate Discord member intent.
    try {
        const members = await guild.members.fetch();

        for (const member of members.values()) {
            if (member.user.bot) {
                continue;
            }

            if (
                member.permissions.has(
                    PermissionFlagsBits.ManageGuild
                ) ||
                member.permissions.has(
                    PermissionFlagsBits.Administrator
                )
            ) {
                recipients.add(member.id);
            }
        }
    } catch (error) {
        console.warn(
            "[Giveaways] Could not fetch all managers. " +
            "Using available cached members and server owner."
        );

        for (const member of guild.members.cache.values()) {
            if (
                !member.user.bot &&
                (
                    member.permissions.has(
                        PermissionFlagsBits.ManageGuild
                    ) ||
                    member.permissions.has(
                        PermissionFlagsBits.Administrator
                    )
                )
            ) {
                recipients.add(member.id);
            }
        }
    }

    return {
        guildFound: true,
        ids: [...recipients]
    };
}

async function claimStaffNotification(
    collection,
    giveawayId,
    userId
) {
    const id = `${giveawayId}:${userId}`;
    const token = randomUUID();
    const now = new Date();

    try {
        const result = await collection.findOneAndUpdate(
            {
                _id: id,
                $or: [
                    { status: { $exists: false } },
                    { status: "failed" },
                    {
                        status: "processing",
                        lockedAt: {
                            $lt: new Date(
                                now.getTime() - STAFF_LOCK_MS
                            )
                        }
                    }
                ]
            },
            {
                $set: {
                    giveawayId,
                    userId,
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

        return { id, token };
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function completeStaffNotification(
    collection,
    claim,
    sent,
    reason = null
) {
    await collection.updateOne(
        {
            _id: claim.id,
            token: claim.token,
            status: "processing"
        },
        {
            $set: {
                status: sent ? "sent" : "failed",
                updatedAt: new Date(),
                ...(sent
                    ? { sentAt: new Date() }
                    : {
                        failedAt: new Date(),
                        failureReason: String(
                            reason || "DM_FAILED"
                        ).slice(0, 100)
                    })
            },
            $unset: {
                token: "",
                lockedAt: ""
            }
        }
    );
}

async function notifyGiveawayStaff(
    client,
    giveaway,
    winners,
    ticketResults
) {
    const results = [];

    const recipients = await getStaffRecipients(
        client,
        giveaway
    );

    if (!recipients.guildFound) {
        return {
            success: false,
            recipients: 0,
            delivered: 0,
            results,
            reason: "GUILD_NOT_FOUND"
        };
    }

    const collection = getDatabase().collection(
        STAFF_NOTIFICATIONS
    );

    const giveawayId = giveaway._id.toString();

    const embed = buildStaffEmbed(
        giveaway,
        winners,
        ticketResults
    );

    for (const userId of recipients.ids) {
        try {
            const claim = await claimStaffNotification(
                collection,
                giveawayId,
                userId
            );

            if (!claim) {
                const existing = await collection.findOne({
                    _id: `${giveawayId}:${userId}`
                });

                results.push({
                    userId,
                    sent: existing?.status === "sent",
                    alreadyProcessed: true
                });

                continue;
            }

            let delivered = false;

            try {
                const user = await client.users.fetch(
                    userId
                );

                await user.send({
                    embeds: [embed],
                    allowedMentions: {
                        parse: []
                    }
                });

                delivered = true;

                results.push({
                    userId,
                    sent: true
                });
            } catch (error) {
                console.warn(
                    `[Giveaways] Staff DM failed for ${userId}:`,
                    error.code || error.message
                );

                results.push({
                    userId,
                    sent: false,
                    reason: "DM_FAILED"
                });
            }

            try {
                await completeStaffNotification(
                    collection,
                    claim,
                    delivered,
                    delivered ? null : "DM_FAILED"
                );
            } catch (error) {
                console.error(
                    "[Giveaways] Could not persist staff notification:",
                    error
                );
            }
        } catch (error) {
            console.error(
                `[Giveaways] Staff notification error for ${userId}:`,
                error
            );

            results.push({
                userId,
                sent: false,
                reason: "UNEXPECTED_ERROR"
            });
        }
    }

    const delivered = results.filter(
        result => result.sent
    ).length;

    return {
        success: delivered > 0 || recipients.ids.length === 0,
        recipients: recipients.ids.length,
        delivered,
        results
    };
}

async function safelyAnnounce(client, giveaway, winners) {
    try {
        return await announceGiveawayEnd(
            client,
            giveaway,
            winners
        );
    } catch (error) {
        console.error(
            "[Giveaways] Announcement stage failed:",
            error
        );

        return false;
    }
}

async function createWinnerTickets(
    client,
    giveaway,
    winners
) {
    const results = [];

    for (const userId of winners) {
        try {
            const result = await createGiveawayWinnerTicket(
                client,
                giveaway._id.toString(),
                userId
            );

            results.push({
                userId,
                ...result
            });
        } catch (error) {
            console.error(
                `[Giveaways] Ticket creation failed for ${userId}:`,
                error
            );

            results.push({
                userId,
                success: false,
                reason: "UNEXPECTED_ERROR"
            });
        }
    }

    return results;
}

async function finishGiveaway(
    client,
    giveaway,
    winners = []
) {
    if (
        !giveaway?._id ||
        !ObjectId.isValid(giveaway._id.toString())
    ) {
        return {
            success: false,
            reason: "INVALID_GIVEAWAY"
        };
    }

    const giveawayId = giveaway._id.toString();

    console.log(
        `[Giveaways] Finalization started: ${giveawayId}`
    );

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    // The database is the source of truth.
    // Never trust an outdated giveaway snapshot.
    const current = await collection.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ENDED
    });

    if (!current) {
        return {
            success: false,
            reason: "GIVEAWAY_NOT_ENDED"
        };
    }

    // Winners must already be selected by end.js.
    // Never redraw winners during finalization.
    const confirmedWinners = uniqueWinnerIds(current);

    // Stage 1: Public results.
    const announcementSent = await safelyAnnounce(
        client,
        current,
        confirmedWinners
    );

    // Stage 2: Create or locate private tickets.
    const ticketResults = await createWinnerTickets(
        client,
        current,
        confirmedWinners
    );

    // Stage 3: Send private winner notifications.
    let notifications = [];

    if (confirmedWinners.length > 0) {
        try {
            notifications = await notifyGiveawayWinners(
                client,
                current,
                confirmedWinners,
                ticketResults
            );
        } catch (error) {
            console.error(
                "[Giveaways] Winner DM stage failed:",
                error
            );
        }
    }

    // Stage 4: Inform staff.
    let staffNotifications = {
        success: false,
        recipients: 0,
        delivered: 0,
        results: []
    };

    try {
        staffNotifications = await notifyGiveawayStaff(
            client,
            current,
            confirmedWinners,
            ticketResults
        );
    } catch (error) {
        console.error(
            "[Giveaways] Staff notification stage failed:",
            error
        );
    }

    const ticketSuccessCount = ticketResults.filter(
        result => result.success
    ).length;

    const failedTickets = ticketResults.filter(
        result => !result.success
    ).length;

    const dmSuccessCount = notifications.filter(
        result => result.dmSent
    ).length;

    const report = {
        giveawayId,
        winners: confirmedWinners.length,

        announcementSent,

        ticketResults,
        ticketSuccessCount,
        failedTickets,

        notifications,
        dmSuccessCount,

        staffNotifications,

        processedAt: new Date()
    };

    // Keep a diagnostic summary on the giveaway.
    // Per-winner notifications and ticket jobs maintain
    // their own persistent completion records.
    try {
        await collection.updateOne(
            {
                _id: current._id,
                status: GIVEAWAY_SETTINGS.STATUS.ENDED
            },
            {
                $set: {
                    lastFinalizationAt: report.processedAt,
                    finalizationSummary: {
                        winners: report.winners,
                        announcementSent,
                        ticketSuccessCount,
                        failedTickets,
                        dmSuccessCount,
                        staffNotificationsDelivered:
                            staffNotifications.delivered
                    }
                },
                $inc: {
                    finalizationAttempts: 1
                }
            }
        );
    } catch (error) {
        console.error(
            "[Giveaways] Could not save finalization summary:",
            error
        );
    }

    console.log(
        [
            `[Giveaways] Finalization complete: ${giveawayId}`,
            `Winners: ${report.winners}`,
            `Announcement: ${announcementSent}`,
            `Tickets: ${ticketSuccessCount}/${report.winners}`,
            `Winner DMs: ${dmSuccessCount}/${report.winners}`,
            `Staff DMs: ${staffNotifications.delivered}/${staffNotifications.recipients}`
        ].join(" | ")
    );

    return {
        success: announcementSent,
        announcementSent,

        giveawayId,
        winners: confirmedWinners,

        ticketResults,
        notifications,
        staffNotifications,

        summary: {
            winners: report.winners,
            ticketSuccessCount,
            failedTickets,
            dmSuccessCount,
            staffNotificationsDelivered:
                staffNotifications.delivered
        }
    };
}

module.exports = {
    finishGiveaway
};
