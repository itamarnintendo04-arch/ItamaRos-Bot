
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const COLLECTION = "giveaway_rejoin_requests";

const COLORS = Object.freeze({
    PENDING: 0xF59E0B,
    APPROVED: 0x22C55E,
    DENIED: 0xEF4444
});

const REQUEST_STATUS = Object.freeze({
    PENDING: "pending",
    PROCESSING: "processing",
    APPROVED: "approved",
    DENIED: "denied",
    FAILED: "failed",
    EXPIRED: "expired"
});

const BUTTON_PREFIX = "giveaway_rejoin_";

function requestsCollection() {
    return getDatabase().collection(COLLECTION);
}

function giveawaysCollection() {
    return getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );
}

function requestId(giveawayId, userId) {
    return `${giveawayId}:${userId}`;
}

function isValidUserId(userId) {
    return typeof userId === "string" &&
        /^\d{17,20}$/.test(userId);
}

function isActive(giveaway) {
    return giveaway &&
        giveaway.status === GIVEAWAY_SETTINGS.STATUS.ACTIVE &&
        new Date(giveaway.endsAt).getTime() > Date.now();
}

function buildEmbed({
    title,
    description,
    color,
    fields = []
}) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Giveaway Management"
        })
        .setTimestamp();

    if (fields.length) {
        embed.addFields(fields);
    }

    return embed;
}

function reviewButtons(giveawayId, userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${BUTTON_PREFIX}approve:${giveawayId}:${userId}`
            )
            .setLabel("Approve")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(
                `${BUTTON_PREFIX}deny:${giveawayId}:${userId}`
            )
            .setLabel("Deny")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

async function sendPrivateNotification(
    client,
    userId,
    approved,
    giveaway
) {
    try {
        const user = await client.users.fetch(userId);

        const embed = approved
            ? buildEmbed({
                title: "✅ Rejoin Request Approved!",
                color: COLORS.APPROVED,
                description: [
                    "Great news!",
                    "",
                    `Your request to rejoin **${giveaway.prize}** was approved.`,
                    "",
                    "🎉 You have been automatically added to the giveaway.",
                    "Good luck!"
                ].join("\n")
            })
            : buildEmbed({
                title: "❌ Rejoin Request Denied",
                color: COLORS.DENIED,
                description: [
                    `Your request to rejoin **${giveaway.prize}** was denied by server staff.`,
                    "",
                    "You are not participating in this giveaway."
                ].join("\n")
            });

        await user.send({ embeds: [embed] });

        return true;
    } catch (error) {
        console.log(
            `[Giveaways] Could not DM rejoin decision to ${userId}.`
        );

        return false;
    }
}

async function refreshGiveawayMessage(client, giveawayId) {
    try {
        const giveaway = await giveawaysCollection().findOne({
            _id: new ObjectId(giveawayId),
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $gt: new Date() }
        });

        if (!giveaway?.messageId) {
            return false;
        }

        const guild = await client.guilds.fetch(
            giveaway.guildId
        );

        const channel = await guild.channels.fetch(
            giveaway.channelId
        );

        if (!channel?.isTextBased() || !channel.messages) {
            return false;
        }

        const message = await channel.messages.fetch(
            giveaway.messageId
        );

        if (!message.embeds.length) {
            return false;
        }

        const existingButtons = message.components.flatMap(
            row => row.components
        );

        // Never enable buttons that are already disabled.
        if (
            existingButtons.length &&
            existingButtons.every(button => button.disabled)
        ) {
            return false;
        }

        const count = Array.isArray(giveaway.participants)
            ? giveaway.participants.length
            : 0;

        const oldDescription =
            message.embeds[0].description || "";

        const pattern = /(\*\*Participants:\*\*\s*)[\d,]+/i;

        const description = pattern.test(oldDescription)
            ? oldDescription.replace(
                pattern,
                (_, prefix) => `${prefix}${count}`
            )
            : `${oldDescription}\n\n**Participants:** ${count}`;

        const embed = EmbedBuilder.from(
            message.embeds[0]
        ).setDescription(description);

        const row = new ActionRowBuilder().addComponents(
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
        );

        await message.edit({
            embeds: [embed],
            components: [row]
        });

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Failed to refresh rejoin count:",
            error
        );

        return false;
    }
}

async function createRejoinRequest(
    client,
    giveaway,
    userId
) {
    if (
        !giveaway?._id ||
        !ObjectId.isValid(giveaway._id.toString()) ||
        !isValidUserId(userId)
    ) {
        return {
            success: false,
            reason: "INVALID_REQUEST"
        };
    }

    const giveawayId = giveaway._id.toString();

    // Always recheck MongoDB instead of trusting stale data.
    const current = await giveawaysCollection().findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
        endsAt: { $gt: new Date() },
        removedParticipants: userId
    });

    if (!current) {
        return {
            success: false,
            reason: "NOT_ELIGIBLE"
        };
    }

    const id = requestId(giveawayId, userId);
    const now = new Date();

    // One stable request record per user and giveaway.
    // A denied or failed request may be submitted again.
    try {
        const result = await requestsCollection().findOneAndUpdate(
            {
                _id: id,
                status: {
                    $nin: [
                        REQUEST_STATUS.PENDING,
                        REQUEST_STATUS.PROCESSING,
                        REQUEST_STATUS.APPROVED
                    ]
                }
            },
            {
                $set: {
                    giveawayId,
                    guildId: current.guildId,
                    userId,
                    status: REQUEST_STATUS.PENDING,
                    requestedAt: now,
                    reviewedBy: null,
                    reviewedAt: null,
                    channelId: null,
                    messageId: null
                }
            },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

        if (!result) {
            return {
                success: false,
                reason: "ALREADY_PENDING"
            };
        }
    } catch (error) {
        if (error.code === 11000) {
            return {
                success: false,
                reason: "ALREADY_PENDING"
            };
        }

        throw error;
    }

    try {
        const guild = await client.guilds.fetch(
            current.guildId
        );

        const channel = await guild.channels.fetch(
            current.channelId
        );

        if (!channel?.isTextBased() || !channel.send) {
            throw new Error("Giveaway channel unavailable.");
        }

        const embed = buildEmbed({
            title: "📨 Giveaway Rejoin Request",
            color: COLORS.PENDING,
            description: [
                "A previously removed participant wants to rejoin.",
                "",
                "An administrator must review this request."
            ].join("\n"),
            fields: [
                {
                    name: "👤 Participant",
                    value: `<@${userId}>`,
                    inline: true
                },
                {
                    name: "🎁 Giveaway",
                    value: current.prize,
                    inline: true
                },
                {
                    name: "📋 Status",
                    value: "⏳ Pending review",
                    inline: false
                }
            ]
        });

        const message = await channel.send({
            embeds: [embed],
            components: [
                reviewButtons(giveawayId, userId)
            ],
            allowedMentions: {
                parse: []
            }
        });

        await requestsCollection().updateOne(
            {
                _id: id,
                status: REQUEST_STATUS.PENDING
            },
            {
                $set: {
                    channelId: channel.id,
                    messageId: message.id
                }
            }
        );

        return {
            success: true,
            requestId: id,
            messageId: message.id
        };
    } catch (error) {
        console.error(
            "[Giveaways] Failed to create rejoin request:",
            error
        );

        await requestsCollection().updateOne(
            {
                _id: id,
                status: REQUEST_STATUS.PENDING
            },
            {
                $set: {
                    status: REQUEST_STATUS.FAILED,
                    failedAt: new Date()
                }
            }
        );

        return {
            success: false,
            reason: "REQUEST_FAILED"
        };
    }
}

async function handleRejoinApproval(interaction) {
    if (!interaction.isButton()) {
        return false;
    }

    const parts = interaction.customId.split(":");
    const action = parts[0];
    const giveawayId = parts[1];
    const userId = parts[2];

    const approveAction = `${BUTTON_PREFIX}approve`;
    const denyAction = `${BUTTON_PREFIX}deny`;

    if (
        action !== approveAction &&
        action !== denyAction
    ) {
        return false;
    }

    const approved = action === approveAction;

    try {
        if (
            !interaction.inGuild() ||
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )
        ) {
            await interaction.reply({
                content: "❌ You need the Manage Server permission to review rejoin requests.",
                flags: MessageFlags.Ephemeral
            });

            return true;
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        if (
            parts.length !== 3 ||
            !ObjectId.isValid(giveawayId) ||
            !isValidUserId(userId)
        ) {
            await interaction.editReply({
                content: "Invalid rejoin request."
            });

            return true;
        }

        const id = requestId(giveawayId, userId);

        const request = await requestsCollection().findOne({
            _id: id,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            messageId: interaction.message.id
        });

        if (!request) {
            await interaction.editReply({
                content: "This request could not be found."
            });

            return true;
        }

        if (request.status !== REQUEST_STATUS.PENDING) {
            await interaction.editReply({
                content: "This request has already been reviewed or is being processed."
            });

            return true;
        }

        // Claim the request atomically.
        // Only one manager can process a pending request.
        const claim = await requestsCollection().updateOne(
            {
                _id: id,
                status: REQUEST_STATUS.PENDING,
                guildId: interaction.guildId,
                messageId: interaction.message.id
            },
            {
                $set: {
                    status: REQUEST_STATUS.PROCESSING,
                    reviewedBy: interaction.user.id,
                    reviewedAt: new Date()
                }
            }
        );

        if (claim.modifiedCount !== 1) {
            await interaction.editReply({
                content: "Another administrator is already reviewing this request."
            });

            return true;
        }

        const giveaway = await giveawaysCollection().findOne({
            _id: new ObjectId(giveawayId),
            guildId: interaction.guildId
        });

        if (!isActive(giveaway)) {
            await requestsCollection().updateOne(
                {
                    _id: id,
                    status: REQUEST_STATUS.PROCESSING
                },
                {
                    $set: {
                        status: REQUEST_STATUS.EXPIRED
                    }
                }
            );

            await interaction.message.edit({
                components: []
            }).catch(() => {});

            await interaction.editReply({
                content: "This giveaway is no longer active. The request has expired."
            });

            return true;
        }

        if (approved) {
            // Atomic approval:
            // remove the restriction and add the participant together.
            const update = await giveawaysCollection().updateOne(
                {
                    _id: new ObjectId(giveawayId),
                    guildId: interaction.guildId,
                    status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
                    endsAt: { $gt: new Date() },
                    removedParticipants: userId
                },
                {
                    $pull: {
                        removedParticipants: userId
                    },
                    $addToSet: {
                        participants: userId
                    }
                }
            );

            if (update.modifiedCount !== 1) {
                // No participation change was made.
                // Allow a retry only while still pending review.
                await requestsCollection().updateOne(
                    {
                        _id: id,
                        status: REQUEST_STATUS.PROCESSING
                    },
                    {
                        $set: {
                            status: REQUEST_STATUS.PENDING,
                            reviewedBy: null,
                            reviewedAt: null
                        }
                    }
                );

                await interaction.editReply({
                    content: "The user could not be added. The giveaway may have changed or ended."
                });

                return true;
            }
        }

        const finalStatus = approved
            ? REQUEST_STATUS.APPROVED
            : REQUEST_STATUS.DENIED;

        await requestsCollection().updateOne(
            {
                _id: id,
                status: REQUEST_STATUS.PROCESSING
            },
            {
                $set: {
                    status: finalStatus,
                    completedAt: new Date()
                }
            }
        );

        const updatedEmbed = buildEmbed({
            title: approved
                ? "✅ Rejoin Request Approved"
                : "❌ Rejoin Request Denied",
            color: approved
                ? COLORS.APPROVED
                : COLORS.DENIED,
            description: approved
                ? [
                    `<@${userId}> has been approved.`,
                    "",
                    "The user has been automatically added to the giveaway."
                ].join("\n")
                : [
                    `<@${userId}>'s rejoin request was denied.`,
                    "",
                    "The participant remains removed."
                ].join("\n"),
            fields: [
                {
                    name: "🎁 Giveaway",
                    value: giveaway.prize
                },
                {
                    name: "👮 Reviewed by",
                    value: `<@${interaction.user.id}>`
                },
                {
                    name: "📋 Final Status",
                    value: approved
                        ? "✅ Approved"
                        : "❌ Denied"
                }
            ]
        });

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [],
            allowedMentions: {
                parse: []
            }
        }).catch(error => {
            console.error(
                "[Giveaways] Could not edit review message:",
                error
            );
        });

        if (approved) {
            await refreshGiveawayMessage(
                interaction.client,
                giveawayId
            );
        }

        const dmSent = await sendPrivateNotification(
            interaction.client,
            userId,
            approved,
            giveaway
        );

        await interaction.editReply({
            content: approved
                ? `✅ <@${userId}> was approved and automatically added to the giveaway.${dmSent ? " A DM was sent." : " The user could not be notified by DM."}`
                : `❌ <@${userId}>'s request was denied.${dmSent ? " A DM was sent." : " The user could not be notified by DM."}`,
            allowedMentions: {
                parse: []
            }
        });

        console.log(
            `[Giveaways] Rejoin ${finalStatus}: ` +
            `${userId} / ${giveawayId} / ${interaction.user.id}`
        );

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Rejoin approval error:",
            error
        );

        try {
            const response = {
                content: "❌ An error occurred while reviewing the request. Please check the bot logs."
            };

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(response);
            } else {
                await interaction.reply({
                    ...response,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error(
                "[Giveaways] Could not respond to reviewer:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    createRejoinRequest,
    handleRejoinApproval
};
