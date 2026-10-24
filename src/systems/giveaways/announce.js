
"use strict";

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const COLORS = Object.freeze({
    ENDED: 0x64748B,
    SUCCESS: 0x22C55E,
    EMPTY: 0xF59E0B
});

function collection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function validId(value) {
    return typeof value === "string" &&
        /^[a-fA-F0-9]{24}$/.test(value);
}

function safePrize(value) {
    return String(value || "Unknown Prize")
        .replace(/@/g, "@\u200b")
        .slice(0, 200);
}

function getWinners(giveaway) {
    const winners = Array.isArray(giveaway.winners)
        ? giveaway.winners
        : [];

    return [
        ...new Set(
            winners.filter(
                id => typeof id === "string" &&
                    /^\d{17,20}$/.test(id)
            )
        )
    ];
}

function getEndDate(giveaway) {
    const date = new Date(
        giveaway.endedAt || giveaway.endsAt
    );

    return Number.isFinite(date.getTime())
        ? date
        : new Date();
}

function disabledButtons(giveawayId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("GIVEAWAY ENDED")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        )
    ];
}

function buildResultsEmbed(giveaway, winners) {
    const endDate = getEndDate(giveaway);
    const timestamp = Math.floor(
        endDate.getTime() / 1000
    );

    const count = Array.isArray(giveaway.participants)
        ? giveaway.participants.length
        : 0;

    const winnerText = winners.length
        ? winners.map(id => `<@${id}>`).join("\n")
        : "No eligible winners.";

    const embed = new EmbedBuilder()
        .setColor(
            winners.length
                ? COLORS.ENDED
                : COLORS.EMPTY
        )
        .setTitle("🏁 GIVEAWAY ENDED")
        .setDescription([
            `## 🎁 ${safePrize(giveaway.prize)}`,
            "",
            "### 🏆 Winners",
            winnerText,
            "",
            `**👑 Hosted by:** <@${giveaway.hostId}>`,
            `**👥 Total Entries:** ${count}`,
            `**📅 Ended:** <t:${timestamp}:F>`,
            "",
            "**Status:** Completed"
        ].join("\n"))
        .setFooter({
            text: "ItamaRos Bot • Giveaway Results"
        })
        .setTimestamp(endDate);

    if (
        typeof giveaway.imageUrl === "string" &&
        /^https:\/\//i.test(giveaway.imageUrl)
    ) {
        embed.setImage(giveaway.imageUrl);
    }

    return embed;
}

function buildAnnouncementEmbed(giveaway, winners) {
    if (winners.length === 0) {
        return new EmbedBuilder()
            .setColor(COLORS.EMPTY)
            .setTitle("🎁 Giveaway Finished")
            .setDescription([
                `The giveaway for **${safePrize(giveaway.prize)}** has ended.`,
                "",
                "No eligible entries were available.",
                "No winners were selected."
            ].join("\n"))
            .setFooter({
                text: "ItamaRos Bot • Giveaways"
            })
            .setTimestamp();
    }

    const mentions = winners.map(
        id => `<@${id}>`
    ).join("\n");

    return new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle("🏆 GIVEAWAY WINNERS!")
        .setDescription([
            "## 🎉 Congratulations!",
            "",
            mentions,
            "",
            `**Prize:** ${safePrize(giveaway.prize)}`,
            "",
            "You've won an ItamaRos giveaway!",
            "",
            "📩 Check your DMs for your winner ticket.",
            "Our staff will help you claim your reward.",
            "",
            "Thank you to everyone who participated!"
        ].join("\n"))
        .setFooter({
            text: "ItamaRos Bot • Giveaway Winners"
        })
        .setTimestamp();
}

async function claimAnnouncement(giveawayId) {
    const now = new Date();
    const token = randomUUID();

    const expiredAt = new Date(
        now.getTime() - LOCK_TIMEOUT_MS
    );

    const result = await collection().findOneAndUpdate(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ENDED,

            // MongoDB matches both null and missing fields.
            // Compatible with create.js.
            announcementSentAt: null,

            $or: [
                {
                    announcementState: {
                        $ne: "processing"
                    }
                },
                {
                    announcementClaimedAt: {
                        $lt: expiredAt
                    }
                },
                {
                    announcementClaimedAt: {
                        $exists: false
                    }
                }
            ]
        },
        {
            $set: {
                announcementState: "processing",
                announcementClaimedAt: now,
                announcementToken: token
            }
        },
        {
            returnDocument: "after"
        }
    );

    if (!result || result.announcementToken !== token) {
        return null;
    }

    return {
        giveaway: result,
        token
    };
}

async function releaseAnnouncement(giveawayId, token) {
    await collection().updateOne(
        {
            _id: new ObjectId(giveawayId),
            announcementToken: token,
            announcementState: "processing"
        },
        {
            $set: {
                announcementState: "retry",
                announcementFailedAt: new Date()
            },
            $unset: {
                announcementToken: "",
                announcementClaimedAt: ""
            }
        }
    );
}

async function editOriginalMessage(
    channel,
    giveaway,
    winners
) {
    if (!giveaway.messageId) {
        return false;
    }

    try {
        const message = await channel.messages.fetch(
            giveaway.messageId
        );

        await message.edit({
            content: "🏁 **This giveaway has ended.**",
            embeds: [
                buildResultsEmbed(giveaway, winners)
            ],
            components: disabledButtons(
                giveaway._id.toString()
            ),
            allowedMentions: {
                parse: []
            }
        });

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Original message update failed:",
            error
        );

        return false;
    }
}

async function ensurePublicAnnouncement(
    channel,
    giveaway,
    winners,
    token
) {
    // Reuse the announcement from an earlier attempt.
    if (giveaway.announcementMessageId) {
        const existing = await channel.messages.fetch(
            giveaway.announcementMessageId
        ).catch(() => null);

        if (existing) {
            return {
                success: true,
                messageId: existing.id,
                reused: true
            };
        }
    }

    const embed = buildAnnouncementEmbed(
        giveaway,
        winners
    );

    const content = winners.length
        ? `🎉 ${winners.map(id => `<@${id}>`).join(" ")}`
        : "🎁 Giveaway finished.";

    const message = await channel.send({
        content,
        embeds: [embed],
        allowedMentions: {
            parse: [],
            users: winners
        }
    });

    // Save the reference immediately after sending.
    const saved = await collection().updateOne(
        {
            _id: giveaway._id,
            announcementToken: token,
            announcementState: "processing"
        },
        {
            $set: {
                announcementMessageId: message.id,
                announcementMessageCreatedAt: new Date()
            }
        }
    );

    if (saved.modifiedCount !== 1) {
        throw new Error(
            "Announcement was sent but its message ID could not be confirmed."
        );
    }

    return {
        success: true,
        messageId: message.id,
        reused: false
    };
}

async function announceGiveawayEnd(
    client,
    giveaway,
    winners = []
) {
    if (!giveaway?._id) {
        return false;
    }

    const giveawayId = giveaway._id.toString();

    if (!validId(giveawayId)) {
        return false;
    }

    let claim;

    try {
        claim = await claimAnnouncement(giveawayId);
    } catch (error) {
        console.error(
            "[Giveaways] Failed to claim announcement:",
            error
        );

        return false;
    }

    if (!claim) {
        const current = await collection().findOne({
            _id: new ObjectId(giveawayId)
        });

        // Already successfully completed.
        if (
            current?.status === GIVEAWAY_SETTINGS.STATUS.ENDED &&
            current.announcementSentAt
        ) {
            return true;
        }

        // Another process is handling it, or the
        // giveaway has not reached the ended state.
        return false;
    }

    const current = claim.giveaway;
    const token = claim.token;

    try {
        const guild = await client.guilds.fetch(
            current.guildId
        );

        const channel = await guild.channels.fetch(
            current.channelId
        );

        if (
            !channel?.isTextBased() ||
            !channel.messages ||
            !channel.send
        ) {
            throw new Error(
                "The giveaway channel is unavailable."
            );
        }

        // Always trust the final winners stored
        // in MongoDB by end.js.
        const confirmedWinners = getWinners(current);

        // The original panel and the announcement
        // are separate operations.
        const originalUpdated = await editOriginalMessage(
            channel,
            current,
            confirmedWinners
        );

        const announcement = await ensurePublicAnnouncement(
            channel,
            current,
            confirmedWinners,
            token
        );

        if (!originalUpdated) {
            // Keep the announcement message ID.
            // A later retry can fix the old panel
            // without sending another announcement.
            throw new Error(
                "The public announcement was sent, but the original giveaway message still needs updating."
            );
        }

        if (!announcement.success) {
            throw new Error(
                "The public announcement was not confirmed."
            );
        }

        const completedAt = new Date();

        const saved = await collection().updateOne(
            {
                _id: current._id,
                status: GIVEAWAY_SETTINGS.STATUS.ENDED,
                announcementToken: token,
                announcementState: "processing"
            },
            {
                $set: {
                    announcementState: "completed",
                    announcementSentAt: completedAt,
                    originalMessageUpdated: true
                },
                $unset: {
                    announcementToken: "",
                    announcementClaimedAt: "",
                    announcementFailedAt: ""
                }
            }
        );

        if (saved.modifiedCount !== 1) {
            throw new Error(
                "Could not confirm announcement completion."
            );
        }

        console.log(
            `[Giveaways] Announcement completed: ${giveawayId}`
        );

        return true;
    } catch (error) {
        console.error(
            `[Giveaways] Announcement incomplete: ${giveawayId}`,
            error
        );

        await releaseAnnouncement(
            giveawayId,
            token
        ).catch(releaseError => {
            console.error(
                "[Giveaways] Could not release announcement lock:",
                releaseError
            );
        });

        return false;
    }
}

module.exports = {
    announceGiveawayEnd
};
