
"use strict";

const {
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { TICKET_TYPES } = require("./config");

// ==================================================
// ITAMAROS BOT • TICKET CLAIM SYSTEM 3.0
// ==================================================

const SETTINGS = Object.freeze({
    CLAIM_BUTTON: "ticket_claim",

    SUCCESS_COLOR: 0x57F287,
    RELEASE_COLOR: 0xFEE75C,
    ERROR_COLOR: 0xED4245
});

// ==================================================
// DATABASE
// ==================================================

function getTicketCollection() {
    const database = getDatabase();

    if (!database) {
        throw new Error("MongoDB is not connected.");
    }

    return database.collection("tickets");
}

// ==================================================
// PERMISSIONS
// ==================================================

function isServerManager(interaction) {
    if (!interaction.inGuild()) {
        return false;
    }

    const permissions = interaction.memberPermissions;

    return Boolean(
        permissions?.has(
            PermissionFlagsBits.ManageGuild
        ) ||
        permissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

// ==================================================
// BUTTON BUILDER
// ==================================================

function buildClaimButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETTINGS.CLAIM_BUTTON)
            .setLabel("Claim / Release Ticket")
            .setEmoji("🛡️")
            .setStyle(ButtonStyle.Primary)
    );
}

// ==================================================
// EMBEDS
// ==================================================

function createEmbed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Support Management"
        })
        .setTimestamp();
}

// ==================================================
// PRIVATE RESPONSE
// ==================================================

async function privateReply(interaction, message) {
    const payload =
        typeof message === "string"
            ? { content: message }
            : message;

    const response = {
        ...payload,
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(response);
    }

    return interaction.reply({
        ...response,
        flags: MessageFlags.Ephemeral
    });
}

// ==================================================
// TICKET VALIDATION
// ==================================================

function getTicketType(ticket) {
    return Object.values(TICKET_TYPES).find(
        type => type.id === ticket.type
    ) || null;
}

function canClaimTicket(ticket) {
    const type = getTicketType(ticket);

    if (!type) {
        return false;
    }

    // Giveaway winner tickets are not claimable.
    if (type.id === TICKET_TYPES.GIVEAWAY.id) {
        return false;
    }

    // Respect both the ticket type configuration
    // and the setting saved in the ticket record.
    return (
        type.claim === true &&
        ticket.claimEnabled !== false
    );
}

// ==================================================
// CHANNEL ANNOUNCEMENT
// ==================================================

async function announceClaimChange(
    channel,
    managerId,
    action
) {
    const claimed = action === "claimed";

    const embed = claimed
        ? createEmbed(
            "🛡️ Ticket Claimed",
            [
                `**Manager:** <@${managerId}>`,
                "",
                "This ticket is now being handled by a server manager.",
                "",
                "Please wait for the manager to assist you."
            ].join("\n"),
            SETTINGS.SUCCESS_COLOR
        )
        : createEmbed(
            "🔄 Ticket Claim Released",
            [
                `**Manager:** <@${managerId}>`,
                "",
                "This manager is no longer responsible for the ticket.",
                "",
                "Another server manager can now claim it."
            ].join("\n"),
            SETTINGS.RELEASE_COLOR
        );

    try {
        await channel.send({
            embeds: [embed],
            allowedMentions: {
                parse: []
            }
        });

        return true;
    } catch (error) {
        console.error(
            "[Tickets] Claim announcement failed:",
            error
        );

        return false;
    }
}

// ==================================================
// CLAIM / RELEASE HANDLER
// ==================================================

async function handleClaimButton(interaction) {
    // ==============================================
    // PERMISSION CHECK
    // ==============================================

    if (!isServerManager(interaction)) {
        await privateReply(
            interaction,
            "❌ Only server managers can claim or release tickets."
        );

        return true;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    try {
        const collection = getTicketCollection();

        // ==========================================
        // FIND ACTIVE TICKET
        // ==========================================

        const ticket = await collection.findOne(
            {
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                status: "open"
            },
            {
                sort: {
                    createdAt: -1
                }
            }
        );

        if (!ticket) {
            await privateReply(
                interaction,
                "❌ This channel does not contain an open ticket."
            );

            return true;
        }

        // ==========================================
        // TICKET TYPE VALIDATION
        // ==========================================

        if (!canClaimTicket(ticket)) {
            await privateReply(
                interaction,
                [
                    "❌ Claiming is disabled for this ticket type.",
                    "",
                    "Giveaway winner tickets are handled directly by server management."
                ].join("\n")
            );

            return true;
        }

        const managerId = interaction.user.id;

        // ==========================================
        // RELEASE OWN CLAIM
        // ==========================================

        if (ticket.claimedBy === managerId) {
            const result = await collection.updateOne(
                {
                    _id: ticket._id,
                    status: "open",
                    claimedBy: managerId
                },
                {
                    $set: {
                        claimedBy: null,
                        claimedAt: null,
                        updatedAt: new Date()
                    }
                }
            );

            if (result.modifiedCount !== 1) {
                await privateReply(
                    interaction,
                    "❌ The ticket changed while processing your request. Please try again."
                );

                return true;
            }

            const announced = await announceClaimChange(
                interaction.channel,
                managerId,
                "released"
            );

            await privateReply(
                interaction,
                {
                    embeds: [
                        createEmbed(
                            "✅ Claim Released",
                            [
                                "You have released responsibility for this ticket.",
                                "",
                                "Other server managers can now claim it.",
                                "",
                                announced
                                    ? "📢 The ticket channel has been updated."
                                    : "⚠️ The change was saved, but the channel announcement could not be sent."
                            ].join("\n"),
                            SETTINGS.RELEASE_COLOR
                        )
                    ]
                }
            );

            console.log(
                `[Tickets] ${managerId} released ticket ${ticket.channelId}.`
            );

            return true;
        }

        // ==========================================
        // ALREADY CLAIMED BY ANOTHER MANAGER
        // ==========================================

        if (ticket.claimedBy) {
            await privateReply(
                interaction,
                {
                    embeds: [
                        createEmbed(
                            "❌ Ticket Already Claimed",
                            [
                                "This ticket is already being handled by another manager.",
                                "",
                                `**Current Manager:** <@${ticket.claimedBy}>`,
                                "",
                                "Only the manager who claimed this ticket can release it."
                            ].join("\n"),
                            SETTINGS.ERROR_COLOR
                        )
                    ]
                }
            );

            return true;
        }

        // ==========================================
        // ATOMIC CLAIM
        // ==========================================

        const now = new Date();

        const result = await collection.updateOne(
            {
                _id: ticket._id,
                status: "open",
                $or: [
                    {
                        claimedBy: {
                            $exists: false
                        }
                    },
                    {
                        claimedBy: null
                    },
                    {
                        claimedBy: ""
                    }
                ]
            },
            {
                $set: {
                    claimedBy: managerId,
                    claimedAt: now,
                    updatedAt: now
                }
            }
        );

        // Only one manager can win the claim race.
        if (result.modifiedCount !== 1) {
            const latest = await collection.findOne({
                _id: ticket._id
            });

            if (latest?.status !== "open") {
                await privateReply(
                    interaction,
                    "❌ This ticket is no longer open."
                );

                return true;
            }

            await privateReply(
                interaction,
                latest?.claimedBy
                    ? `❌ Another manager claimed this ticket first: <@${latest.claimedBy}>.`
                    : "❌ The claim could not be completed. Please try again."
            );

            return true;
        }

        // ==========================================
        // PUBLIC ANNOUNCEMENT
        // ==========================================

        const announced = await announceClaimChange(
            interaction.channel,
            managerId,
            "claimed"
        );

        // ==========================================
        // PRIVATE CONFIRMATION
        // ==========================================

        await privateReply(
            interaction,
            {
                embeds: [
                    createEmbed(
                        "✅ Ticket Claimed!",
                        [
                            "You are now responsible for this ticket.",
                            "",
                            `**Ticket:** <#${ticket.channelId}>`,
                            "",
                            "Click **Claim / Release Ticket** again if you want to release it.",
                            "",
                            announced
                                ? "📢 The ticket channel has been notified."
                                : "⚠️ The claim was saved, but the channel announcement could not be sent."
                        ].join("\n"),
                        SETTINGS.SUCCESS_COLOR
                    )
                ]
            }
        );

        console.log(
            `[Tickets] ${managerId} claimed ticket ${ticket.channelId}.`
        );

        return true;

    } catch (error) {
        console.error(
            "[Tickets] Claim operation failed:",
            error
        );

        await privateReply(
            interaction,
            "❌ An error occurred while updating the ticket. Please check the Render logs."
        ).catch(() => {});

        return true;
    }
}

module.exports = {
    buildClaimButton,
    handleClaimButton
};
