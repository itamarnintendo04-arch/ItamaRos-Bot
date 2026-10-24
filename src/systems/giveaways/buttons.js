
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");

const { GIVEAWAY_SETTINGS } = require("./config");

const {
    joinGiveaway,
    leaveGiveaway
} = require("./participants");

const {
    createRejoinRequest
} = require("./rejoin");

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E,
    ERROR: 0xEF4444,
    INFO: 0x8B5CF6,
    WARNING: 0xF59E0B
});

function createResponse(title, description, color = COLORS.INFO) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: "ItamaRos Bot • Giveaways" })
        .setTimestamp();
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

function getErrorMessage(reason) {
    const messages = {
        INVALID_ID: "The giveaway ID is invalid.",
        INVALID_GIVEAWAY: "This giveaway is invalid.",
        NOT_FOUND: "This giveaway could not be found.",
        ENDED: "This giveaway is no longer active.",
        ALREADY_JOINED: "You are already participating in this giveaway.",
        NOT_PARTICIPATING: "You are not participating in this giveaway.",
        REMOVED: "You need administrator approval to rejoin.",
        REMOVED_BY_ADMIN: "You need administrator approval to rejoin.",
        ALREADY_REMOVED: "You need administrator approval to rejoin."
    };

    return messages[reason] || "The action could not be completed.";
}

function updateParticipantDescription(description, count) {
    const currentDescription = description || "";

    const patterns = [
        /(\*\*Participants:\*\*\s*)[\d,]+/i,
        /(\*\*Entries:\*\*\s*)[\d,]+/i
    ];

    for (const pattern of patterns) {
        if (pattern.test(currentDescription)) {
            return currentDescription.replace(
                pattern,
                (_, prefix) => `${prefix}${count}`
            );
        }
    }

    return [
        currentDescription,
        "",
        `**Participants:** ${count}`
    ].join("\n");
}

function createGiveawayButtons(giveawayId, count) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
            )
            .setLabel(`ENTER • ${count}`)
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Success)
    );
}

// LEAVE is shown privately after a second or later ENTER click.
// It is never added to the public giveaway announcement.
function createPrivateLeaveButton(giveawayId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveawayId}`
            )
            .setLabel("LEAVE GIVEAWAY")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

async function refreshGiveawayMessage(interaction, giveawayId) {
    try {
        const collection = getDatabase().collection(
            GIVEAWAY_SETTINGS.COLLECTION
        );

        const giveaway = await collection.findOne({
            _id: new ObjectId(giveawayId),
            guildId: interaction.guildId,
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $gt: new Date() }
        });

        if (!giveaway) {
            return false;
        }

        const channel = await interaction.guild.channels.fetch(
            giveaway.channelId
        ).catch(() => null);

        if (
            !channel ||
            !channel.isTextBased() ||
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

        // Never reactivate buttons that another process disabled.
        const existingButtons = message.components.flatMap(
            row => row.components
        );

        if (
            existingButtons.length > 0 &&
            existingButtons.every(button => button.disabled)
        ) {
            return false;
        }

        const participants = Array.isArray(giveaway.participants)
            ? giveaway.participants
            : [];

        const count = participants.length;

        const embed = EmbedBuilder.from(message.embeds[0]);

        embed.setDescription(
            updateParticipantDescription(
                message.embeds[0].description,
                count
            )
        );

        await message.edit({
            embeds: [embed],
            components: [
                createGiveawayButtons(giveawayId, count)
            ]
        });

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Failed to refresh participant count:",
            error
        );

        return false;
    }
}

async function sendJoinDM(user, giveaway) {
    try {
        const endTimestamp = Math.floor(
            new Date(giveaway.endsAt).getTime() / 1000
        );

        const url = getGiveawayLink(giveaway);

        const description = [
            `You're officially entered in the giveaway for **${giveaway.prize}**!`,
            "",
            `**Ends:** <t:${endTimestamp}:F>`,
            `**Time remaining:** <t:${endTimestamp}:R>`,
            "",
            "Good luck! Winners will be notified when the giveaway ends.",
            url ? `\n[View Giveaway](${url})` : ""
        ].join("\n");

        const embed = createResponse(
            "🎉 Giveaway Entry Confirmed!",
            description,
            COLORS.SUCCESS
        );

        await user.send({
            embeds: [embed],
            allowedMentions: { parse: [] }
        });

        return true;
    } catch (error) {
        // Users may disable DMs. Their entry is still valid.
        console.log(
            `[Giveaways] Could not send entry DM to ${user.id}.`
        );

        return false;
    }
}

async function handleRemovedParticipant(
    interaction,
    giveaway
) {
    const result = await createRejoinRequest(
        interaction.client,
        giveaway,
        interaction.user.id
    );

    if (result?.success) {
        await interaction.editReply({
            embeds: [
                createResponse(
                    "📨 Approval Requested",
                    [
                        "You were previously removed from this giveaway.",
                        "",
                        "A request has been sent for administrator review.",
                        "You can participate again only after approval."
                    ].join("\n"),
                    COLORS.WARNING
                )
            ]
        });

        return true;
    }

    const alreadyPending = [
        "ALREADY_PENDING",
        "REQUEST_EXISTS",
        "PENDING_REQUEST"
    ].includes(result?.reason);

    await interaction.editReply({
        embeds: [
            createResponse(
                alreadyPending
                    ? "⏳ Request Pending"
                    : "⚠️ Approval Required",
                alreadyPending
                    ? "Your rejoin request is already awaiting administrator approval."
                    : "You need administrator approval to rejoin this giveaway. The request could not be submitted automatically; please contact the server staff.",
                COLORS.WARNING
            )
        ]
    });

    return true;
}

async function handleGiveawayButtons(interaction) {
    if (!interaction.isButton()) {
        return false;
    }

    const parts = interaction.customId.split(":");
    const action = parts[0];
    const giveawayId = parts[1];

    const isJoin = action === GIVEAWAY_SETTINGS.JOIN_BUTTON_ID;
    const isLeave = action === GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID;

    if (!isJoin && !isLeave) {
        return false;
    }

    try {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        if (
            parts.length !== 2 ||
            !ObjectId.isValid(giveawayId)
        ) {
            await interaction.editReply({
                embeds: [
                    createResponse(
                        "❌ Invalid Giveaway",
                        "This giveaway button is invalid.",
                        COLORS.ERROR
                    )
                ]
            });

            return true;
        }

        if (!interaction.inGuild()) {
            await interaction.editReply({
                content: "Giveaway buttons can only be used in a server."
            });

            return true;
        }

        const collection = getDatabase().collection(
            GIVEAWAY_SETTINGS.COLLECTION
        );

        // Verify the giveaway belongs to this exact message.
        const giveaway = await collection.findOne({
            _id: new ObjectId(giveawayId),
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            ...(isJoin ? { messageId: interaction.message.id } : {})
        });

        if (!giveaway) {
            await interaction.editReply({
                embeds: [
                    createResponse(
                        "🔎 Giveaway Not Found",
                        "This button is not connected to a valid giveaway in this server.",
                        COLORS.ERROR
                    )
                ]
            });

            return true;
        }

        if (
            giveaway.status !== GIVEAWAY_SETTINGS.STATUS.ACTIVE ||
            new Date(giveaway.endsAt).getTime() <= Date.now()
        ) {
            await interaction.editReply({
                embeds: [
                    createResponse(
                        "⌛ Giveaway Closed",
                        "This giveaway is no longer accepting entries.",
                        COLORS.WARNING
                    )
                ]
            });

            return true;
        }

        // A private LEAVE button must come from a second ENTER.
        // The offer expires, cannot be used after a normal exit,
        // and is validated against active MongoDB participation.
        if (isLeave) {
            const offerAt = giveaway.leaveOffers?.[interaction.user.id];
            const validOffer =
                typeof offerAt === "number" &&
                Date.now() >= offerAt &&
                Date.now() - offerAt <= 15 * 60 * 1000;

            if (!validOffer) {
                await interaction.editReply({
                    embeds: [
                        createResponse(
                            "🔒 Leave Not Available",
                            "Click ENTER again on the giveaway message to see your private LEAVE button.",
                            COLORS.WARNING
                        )
                    ],
                    components: []
                });
                return true;
            }
        }

        if (isJoin) {
            const removedParticipants = Array.isArray(
                giveaway.removedParticipants
            )
                ? giveaway.removedParticipants
                : [];

            if (
                removedParticipants.includes(interaction.user.id)
            ) {
                return await handleRemovedParticipant(
                    interaction,
                    giveaway
                );
            }
        }

        const result = isJoin
            ? await joinGiveaway(giveawayId, interaction.user.id)
            : await leaveGiveaway(giveawayId, interaction.user.id);

        if (!result?.success) {
            if (isJoin && result.reason === "LEVEL_TOO_LOW") {
                await interaction.editReply({
                    embeds: [
                        createResponse(
                            "🔒 Level Required",
                            `This giveaway requires **Level ${result.requiredLevel}+**. Your current level is **${result.currentLevel}**. Keep chatting to earn XP!`,
                            COLORS.WARNING
                        )
                    ],
                    components: []
                });
                return true;
            }

            if (isJoin && result.reason === "ALREADY_JOINED") {
                // The next ENTER from an existing participant
                // offers an ephemeral LEAVE button. We don't
                // store or display the number of clicks.
                const offered = await collection.updateOne(
                    {
                        _id: new ObjectId(giveawayId),
                        guildId: interaction.guildId,
                        channelId: interaction.channelId,
                        messageId: interaction.message.id,
                        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
                        endsAt: { $gt: new Date() },
                        participants: interaction.user.id
                    },
                    {
                        $set: {
                            [`leaveOffers.${interaction.user.id}`]: Date.now()
                        }
                    }
                );

                if (!offered.matchedCount) {
                    await interaction.editReply({
                        content: "⌛ This giveaway is no longer available."
                    });
                    return true;
                }

                await interaction.editReply({
                    embeds: [
                        createResponse(
                            "🎉 Already Entered!",
                            "You are already participating. If you wish to leave, use the private button below. After leaving, the next ENTER will be a fresh entry.",
                            COLORS.INFO
                        )
                    ],
                    components: [createPrivateLeaveButton(giveawayId)]
                });
                return true;
            }

            if (
                isJoin &&
                [
                    "REMOVED",
                    "REMOVED_BY_ADMIN",
                    "ALREADY_REMOVED"
                ].includes(result?.reason)
            ) {
                const latestGiveaway = await collection.findOne({
                    _id: new ObjectId(giveawayId),
                    guildId: interaction.guildId
                });

                if (latestGiveaway) {
                    return await handleRemovedParticipant(
                        interaction,
                        latestGiveaway
                    );
                }
            }

            await interaction.editReply({
                embeds: [
                    createResponse(
                        "⚠️ Action Unavailable",
                        getErrorMessage(result?.reason),
                        COLORS.WARNING
                    )
                ]
            });

            return true;
        }

        // The entry/exit succeeded in MongoDB.
        // A Discord message edit failure must not undo that result.
        const refreshed = await refreshGiveawayMessage(
            interaction,
            giveawayId
        );

        if (isJoin) {
            const embed = createResponse(
                "🎉 You're Entered!",
                [
                    `You have successfully entered the giveaway for **${giveaway.prize}**.`,
                    "",
                    "Good luck! Watch for the winner announcement.",
                    refreshed
                        ? ""
                        : "\nYour entry was saved successfully."
                ].join("\n"),
                COLORS.SUCCESS
            );

            await interaction.editReply({
                embeds: [embed]
            });

            await sendJoinDM(
                interaction.user,
                giveaway
            );
        } else {
            await interaction.editReply({
                components: [],
                embeds: [
                    createResponse(
                        "✅ Entry Removed",
                        [
                            `You have left the giveaway for **${giveaway.prize}**.`,
                            "",
                            "You can enter again while the giveaway remains active."
                        ].join("\n"),
                        COLORS.INFO
                    )
                ]
            });
        }

        return true;
    } catch (error) {
        console.error(
            "[Giveaways] Button interaction error:",
            error
        );

        try {
            const response = {
                content: "❌ Something went wrong. Please try again."
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
                "[Giveaways] Failed to respond to button:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    handleGiveawayButtons
};
