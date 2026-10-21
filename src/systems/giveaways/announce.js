
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

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E,
    ENDED: 0x64748B,
    EMPTY: 0xF59E0B
});

const LOCK_DURATION_MS = 120_000;

function getCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function getWinnerIds(giveaway) {
    return [
        ...new Set(
            (Array.isArray(giveaway.winners)
                ? giveaway.winners
                : []
            ).filter(id =>
                typeof id === "string" &&
                /^\d{17,20}$/.test(id)
            )
        )
    ];
}

function buildDisabledButtons(giveawayId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("GIVEAWAY ENDED")
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

function buildEndedEmbed(giveaway, winners) {
    const hasWinners = winners.length > 0;

    const winnerText = hasWinners
        ? winners.map(id => `<@${id}>`).join("\n")
        : "No winners — there were no eligible entries.";

    const participantCount = Array.isArray(
        giveaway.participants
    )
        ? giveaway.participants.length
        : 0;

    const endedAt = giveaway.endedAt
        ? new Date(giveaway.endedAt)
        : new Date();

    const timestamp = Math.floor(
        endedAt.getTime() / 1000
    );

    const embed = new EmbedBuilder()
        .setColor(
            hasWinners
                ? COLORS.ENDED
                : COLORS.EMPTY
        )
        .setTitle("🎉 GIVEAWAY ENDED")
        .setDescription(
            [
                "## 🎁 Giveaway Results",
                "",
                `**Prize:** ${giveaway.prize}`,
                "",
                `**Hosted by:** <@${giveaway.hostId}>`,
                "",
                "**🏆 Winner(s)**",
                winnerText,
                "",
                `**👥 Total Entries:** ${participantCount}`,
                `**🕒 Ended:** <t:${timestamp}:F>`
            ].join("\n")
        )
        .setFooter({
            text: "ItamaRos Bot • Giveaway Results"
        })
        .setTimestamp(endedAt);

    if (giveaway.imageUrl) {
        embed.setImage(giveaway.imageUrl);
    }

    return embed;
}

function buildAnnouncementEmbed(giveaway, winners) {
    if (winners.length === 0) {
        return new EmbedBuilder()
            .setColor(COLORS.EMPTY)
            .setTitle("🎁 Giveaway Finished")
            .setDescription(
                [
                    `The giveaway for **${giveaway.prize}** has ended.`,
                    "",
                    "There were no eligible participants, so no winners were selected."
                ].join("\n")
            )
            .setFooter({
                text: "ItamaRos Bot • Giveaways"
            })
            .setTimestamp();
    }

    const mentions = winners.map(
        id => `<@${id}>`
    ).join(", ");

    return new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle("🏆 GIVEAWAY WINNERS!")
        .setDescription(
            [
                "## 🎉 Congratulations!",
                "",
                mentions,
                "",
                `You've won **${giveaway.prize}**!`,
                "",
                "📩 Check your DMs for information about claiming your prize.",
                "",
                "Thank you to everyone who participated!"
            ].join("\n")
        )
        .addFields({
            name: "🎁 Prize",
            value: String(giveaway.prize),
            inline: true
        })
        .setFooter({
            text: "ItamaRos Bot • Congratulations!"
        })
        .setTimestamp();
}

async function claimAnnouncement(giveawayId) {
    const collection = getCollection();

    const now = new Date();
    const expiredLock = new Date(
        now.getTime() - LOCK_DURATION_MS
    );

    const token = randomUUID();

    const claimed = await collection.findOneAndUpdate(
        {
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ENDED,
            announcementSentAt: { $exists: false },
            $or: [
                { announcementState: { $ne: "processing" } },
                { announcementClaimedAt: { $lt: expiredLock } }
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

    return claimed
        ? { giveaway: claimed, token }
        : null;
}

async function releaseAnnouncement(giveawayId, token) {
    await getCollection().updateOne(
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

async function editOriginalGiveaway(
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
            embeds: [
                buildEndedEmbed(giveaway, winners)
            ],
            components: [
                ...buildDisabledButtons(
                    giveaway._id.toString()
                )
            ],
            allowedMentions: {
                parse: []
            }
        });

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Could not edit original giveaway:",
            error
        );

        return false;
    }
}

async function sendPublicAnnouncement(
    channel,
    giveaway,
    winners
) {
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

    return message.id;
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

    if (!ObjectId.isValid(giveawayId)) {
        return false;
    }

    // Claim the job atomically so manual and scheduled
    // endings do not normally announce the same giveaway twice.
    const claim = await claimAnnouncement(
        giveawayId
    );

    if (!claim) {
        const current = await getCollection().findOne({
            _id: new ObjectId(giveawayId)
        });

        if (current?.announcementSentAt) {
            console.log(
                `[Giveaways] Announcement already completed: ${giveawayId}`
            );
            return true;
        }

        console.log(
            `[Giveaways] Announcement unavailable or processing: ${giveawayId}`
        );

        return false;
    }

    const current = claim.giveaway;
    const token = claim.token;

    try {
        const guild = await client.guilds.fetch(
            current.guildId
        ).catch(() => null);

        if (!guild) {
            throw new Error("Giveaway guild not found.");
        }

        const channel = await guild.channels.fetch(
            current.channelId
        ).catch(() => null);

        if (
            !channel?.isTextBased() ||
            !channel.messages ||
            !channel.send
        ) {
            throw new Error("Giveaway channel unavailable.");
        }

        // Use winners saved in MongoDB as the source of truth,
        // rather than an older copy passed to this function.
        const finalWinners = getWinnerIds(current);

        // Editing the old message and sending the new
        // announcement are independent operations.
        const originalUpdated = await editOriginalGiveaway(
            channel,
            current,
            finalWinners
        );

        let announcementMessageId =
            current.announcementMessageId || null;

        if (!announcementMessageId) {
            announcementMessageId =
                await sendPublicAnnouncement(
                    channel,
                    current,
                    finalWinners
                );

            // Store the new message ID so a retry can
            // reuse the existing public announcement.
            await getCollection().updateOne(
                {
                    _id: current._id,
                    announcementToken: token
                },
                {
                    $set: {
                        announcementMessageId
                    }
                }
            );
        }

        const updateResult = await getCollection().updateOne(
            {
                _id: current._id,
                announcementToken: token,
                announcementState: "processing"
            },
            {
                $set: {
                    announcementState: "completed",
                    announcementSentAt: new Date(),
                    originalMessageUpdated: originalUpdated
                },
                $unset: {
                    announcementToken: "",
                    announcementClaimedAt: ""
                }
            }
        );

        if (updateResult.modifiedCount !== 1) {
            console.error(
                `[Giveaways] Lost announcement claim: ${giveawayId}`
            );
            return false;
        }

        console.log(
            `[Giveaways] Winner announcement completed: ${giveawayId}`
        );

        return true;
    } catch (error) {
        console.error(
            `[Giveaways] Announcement failed: ${giveawayId}`,
            error
        );

        await releaseAnnouncement(
            giveawayId,
            token
        ).catch(releaseError => {
            console.error(
                "[Giveaways] Failed to release announcement lock:",
                releaseError
            );
        });

        return false;
    }
}

module.exports = {
    announceGiveawayEnd
};
