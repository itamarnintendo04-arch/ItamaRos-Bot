
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    AttachmentBuilder
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");
const { statusCard } = require("../media/statusCard");

const COLORS = Object.freeze({
    PRIMARY: GIVEAWAY_SETTINGS.DEFAULT_COLOR,
    SUCCESS: 0x22C55E
});

const LIMITS = Object.freeze({
    MAX_PRIZE_LENGTH: 200,
    MAX_DURATION_MINUTES: 60 * 24 * 365,
    MAX_IMAGE_BYTES: 25 * 1024 * 1024
});

function failure(reason, message) {
    return {
        success: false,
        reason,
        message
    };
}

function safePrize(value) {
    if (typeof value !== "string") {
        return null;
    }

    const cleaned = value
        .trim()
        .replace(/[\r\n\t]+/g, " ")
        .replace(/@/g, "@\u200b");

    if (
        cleaned.length === 0 ||
        cleaned.length > LIMITS.MAX_PRIZE_LENGTH
    ) {
        return null;
    }

    return cleaned;
}

function isValidImage(image) {
    if (!image) {
        return true;
    }

    if (
        typeof image.url !== "string" ||
        !/^https:\/\//i.test(image.url)
    ) {
        return false;
    }

    if (
        typeof image.contentType !== "string" ||
        !image.contentType.startsWith("image/")
    ) {
        return false;
    }

    if (
        typeof image.size === "number" &&
        image.size > LIMITS.MAX_IMAGE_BYTES
    ) {
        return false;
    }

    return true;
}

function createGiveawayEmbed({
    prize,
    hostId,
    winnerCount,
    minLevel = 0,
    endsAt,
    imageUrl
}) {
    const timestamp = Math.floor(
        endsAt.getTime() / 1000
    );

    const embed = new EmbedBuilder()
        .setColor(COLORS.PRIMARY)
        .setTitle("🎉 NEW GIVEAWAY!")
        .setDescription(
            [
                `## 🎁 ${prize}`,
                "",
                "A brand-new giveaway has started!",
                "",
                "Click **ENTER** below to participate.",
                "Good luck to everyone!",
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                `**👑 Hosted by:** <@${hostId}>`,
                `**🏆 Winners:** ${winnerCount}`,
                `**⭐ Minimum level:** ${minLevel > 0 ? `Level ${minLevel}+` : "Everyone"}`,
                "**Participants:** 0",
                "",
                `**📅 Ends:** <t:${timestamp}:F>`,
                `**⏳ Time remaining:** <t:${timestamp}:R>`,
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                "*Winners will be announced when the giveaway ends.*"
            ].join("\n")
        )
        .setFooter({
            text: "ItamaRos Bot • Giveaway System"
        })
        .setTimestamp();

    if (imageUrl) {
        embed.setImage(imageUrl);
    }

    return embed;
}

function createGiveawayButtons(giveawayId) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("ENTER • 0")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Success)
        )
    ];
}

async function checkBotPermissions(guild, channel) {
    let botMember;

    try {
        botMember = await guild.members.fetchMe();
    } catch (error) {
        return failure(
            "BOT_UNAVAILABLE",
            "Could not verify the bot's permissions."
        );
    }

    const permissions = channel.permissionsFor(
        botMember
    );

    if (!permissions) {
        return failure(
            "PERMISSIONS_UNAVAILABLE",
            "Could not read channel permissions."
        );
    }

    const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.EmbedLinks
    ];

    // Threads use a different permission for sending.
    if (channel.isThread?.()) {
        required.push(
            PermissionFlagsBits.SendMessagesInThreads
        );
    } else {
        required.push(
            PermissionFlagsBits.SendMessages
        );
    }

    const missing = required.filter(
        permission => !permissions.has(permission)
    );

    if (missing.length > 0) {
        return failure(
            "MISSING_BOT_PERMISSIONS",
            "The bot needs permission to view this channel, send messages and embed links."
        );
    }

    return {
        success: true,
        botMember
    };
}

async function createGiveaway({
    guild,
    channel,
    host,
    prize,
    duration,
    winners,
    minLevel = 0,
    image = null
}) {
    if (
        !guild?.id ||
        !channel?.id ||
        !host?.id
    ) {
        return failure(
            "INVALID_CONTEXT",
            "A valid server, channel and host are required."
        );
    }

    if (channel.guildId !== guild.id) {
        return failure(
            "INVALID_CHANNEL",
            "The channel does not belong to this server."
        );
    }

    if (
        !channel.isTextBased?.() ||
        typeof channel.send !== "function"
    ) {
        return failure(
            "INVALID_CHANNEL",
            "Giveaways require a text channel."
        );
    }

    const sanitizedPrize = safePrize(prize);

    if (!sanitizedPrize) {
        return failure(
            "INVALID_PRIZE",
            "The prize must contain between 1 and 200 characters."
        );
    }

    if (
        !Number.isSafeInteger(duration) ||
        duration < GIVEAWAY_SETTINGS.MIN_DURATION_MINUTES ||
        duration > LIMITS.MAX_DURATION_MINUTES
    ) {
        return failure(
            "INVALID_DURATION",
            "The giveaway duration is invalid or too long."
        );
    }

    if (
        !Number.isInteger(winners) ||
        winners < 1 ||
        winners > GIVEAWAY_SETTINGS.MAX_WINNERS
    ) {
        return failure(
            "INVALID_WINNER_COUNT",
            `The winner count must be between 1 and ${GIVEAWAY_SETTINGS.MAX_WINNERS}.`
        );
    }

    if (!Number.isSafeInteger(minLevel) ||
        minLevel < 0 || minLevel > 1000) {
        return failure(
            "INVALID_MIN_LEVEL",
            "The required level must be between 0 and 1000."
        );
    }

    if (!isValidImage(image)) {
        return failure(
            "INVALID_IMAGE",
            "Please upload a valid image under 25 MB."
        );
    }

    const permissionCheck = await checkBotPermissions(
        guild,
        channel
    );

    if (!permissionCheck.success) {
        return permissionCheck;
    }

    const now = new Date();

    const endsAt = new Date(
        now.getTime() + duration * 60 * 1000
    );

    const imageUrl = image?.url || null;

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    // Store the giveaway first so the buttons reference
    // a real MongoDB document from the very beginning.
    const giveawayDocument = {
        guildId: guild.id,
        channelId: channel.id,
        messageId: null,

        hostId: host.id,

        prize: sanitizedPrize,
        imageUrl,

        winnerCount: winners,
        minLevel,

        participants: [],
        removedParticipants: [],
        winners: [],

        endsAt,
        createdAt: now,
        updatedAt: now,

        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,

        manuallyEnded: false,
        announcementSentAt: null,

        finalizationAttempts: 0
    };

    let insertedId = null;
    let sentMessage = null;

    try {
        const insertResult = await collection.insertOne(
            giveawayDocument
        );

        insertedId = insertResult.insertedId;

        const embed = createGiveawayEmbed({
            prize: sanitizedPrize,
            hostId: host.id,
            winnerCount: winners,
            minLevel,
            endsAt,
            imageUrl
        });

        const files = [];
        if (!imageUrl) {
            const banner = await statusCard({
                kind: "giveaway",
                status: "active",
                prize: sanitizedPrize,
                subtitle: "Enter for a chance to win!"
            });
            embed.setImage("attachment://giveaway.png");
            files.push(
                new AttachmentBuilder(banner, { name: "giveaway.png" })
            );
        }

        sentMessage = await channel.send({
            embeds: [embed],
            files,
            components: [
                ...createGiveawayButtons(
                    insertedId.toString()
                )
            ],
            allowedMentions: {
                parse: []
            }
        });

        const updateResult = await collection.updateOne(
            {
                _id: insertedId,
                status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
            },
            {
                $set: {
                    messageId: sentMessage.id,
                    updatedAt: new Date()
                }
            }
        );

        if (updateResult.modifiedCount !== 1) {
            throw new Error(
                "Failed to save giveaway message ID."
            );
        }

        console.log(
            [
                "[Giveaways] Created",
                `ID: ${insertedId}`,
                `Guild: ${guild.id}`,
                `Channel: ${channel.id}`,
                `Host: ${host.id}`,
                `Winners: ${winners}`,
                `Ends: ${endsAt.toISOString()}`
            ].join(" | ")
        );

        return {
            success: true,

            giveawayId: insertedId.toString(),
            messageId: sentMessage.id,

            channelId: channel.id,
            guildId: guild.id,

            endsAt,
            winnerCount: winners,

            url:
                `https://discord.com/channels/` +
                `${guild.id}/${channel.id}/${sentMessage.id}`
        };
    } catch (error) {
        console.error(
            "[Giveaways] Creation failed:",
            error
        );

        // If the message was already posted but MongoDB
        // couldn't store its ID, remove that message so
        // users don't interact with an orphaned giveaway.
        let messageRemoved = !sentMessage;

        if (sentMessage) {
            messageRemoved = await sentMessage.delete()
                .then(() => true)
                .catch(deleteError => {
                    console.error(
                        "[Giveaways] Could not delete orphaned message:",
                        deleteError
                    );

                    return false;
                });

            // If deletion failed, disable the controls.
            if (!messageRemoved) {
                await sentMessage.edit({
                    content:
                        "⚠️ This giveaway could not be created. " +
                        "Please contact the server staff.",
                    components: []
                }).catch(() => {});
            }
        }

        if (insertedId) {
            try {
                if (messageRemoved) {
                    await collection.deleteOne({
                        _id: insertedId,
                        messageId: null
                    });
                } else {
                    await collection.updateOne(
                        {
                            _id: insertedId
                        },
                        {
                            $set: {
                                status: GIVEAWAY_SETTINGS.STATUS.CANCELLED,
                                creationFailedAt: new Date(),
                                messageId:
                                    sentMessage?.id || null
                            }
                        }
                    );
                }
            } catch (cleanupError) {
                console.error(
                    "[Giveaways] MongoDB cleanup failed:",
                    cleanupError
                );
            }
        }

        return failure(
            "CREATION_FAILED",
            "The giveaway could not be created. Please try again."
        );
    }
}

module.exports = {
    createGiveaway,
    createGiveawayEmbed,
    createGiveawayButtons
};
