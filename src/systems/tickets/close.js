
"use strict";

const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const { getDatabase } = require("../../../database");
const { buildTranscript } = require("./transcript");

const SETTINGS = Object.freeze({
    CLOSE_BUTTON: "ticket_close",
    CLOSE_MODAL: "ticket_close_modal",
    REQUEST_BUTTON: "ticket_close_request",
    REQUEST_MODAL: "ticket_close_request_modal",
    REVIEW_PREFIX: "ticket_close_review",
    COLOR: 0x5865F2,
    SUCCESS: 0x22C55E,
    WARNING: 0xF59E0B,
    ERROR: 0xEF4444
});

function getTickets() {
    return getDatabase().collection("tickets");
}

function isManager(interaction) {
    return Boolean(
        interaction.inGuild() &&
        (
            interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            ) ||
            interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        )
    );
}

function createEmbed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Ticket Management"
        })
        .setTimestamp();
}

function cleanText(value, max = 1000) {
    return String(value || "")
        .trim()
        .replace(/@/g, "@\u200b")
        .slice(0, max);
}

async function privateReply(interaction, content) {
    const payload = {
        content,
        allowedMentions: { parse: [] }
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

async function getOpenTicket(interaction) {
    if (!interaction.inGuild()) return null;

    return getTickets().findOne({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        status: "open"
    });
}

// ================================================
// BUTTON BUILDERS
// ================================================

function buildCloseButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETTINGS.CLOSE_BUTTON)
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );
}

function buildRequestButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETTINGS.REQUEST_BUTTON)
            .setLabel("Request Closure")
            .setEmoji("📨")
            .setStyle(ButtonStyle.Primary)
    );
}

function buildReviewButtons(requestId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${SETTINGS.REVIEW_PREFIX}:approve:${requestId}`
            )
            .setLabel("Approve & Close")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(
                `${SETTINGS.REVIEW_PREFIX}:deny:${requestId}`
            )
            .setLabel("Deny")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
    );
}

// ================================================
// MODALS
// ================================================

function buildCloseModal() {
    const modal = new ModalBuilder()
        .setCustomId(SETTINGS.CLOSE_MODAL)
        .setTitle("Close Ticket");

    const message = new TextInputBuilder()
        .setCustomId("closure_message")
        .setLabel("Message to ticket owner (optional)")
        .setPlaceholder("Write a final message, or leave blank.")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

    modal.addComponents(
        new ActionRowBuilder().addComponents(message)
    );

    return modal;
}

function buildRequestModal() {
    const modal = new ModalBuilder()
        .setCustomId(SETTINGS.REQUEST_MODAL)
        .setTitle("Request Ticket Closure");

    const message = new TextInputBuilder()
        .setCustomId("request_message")
        .setLabel("Message to staff (optional)")
        .setPlaceholder(
            "Why would you like to close this ticket?"
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

    modal.addComponents(
        new ActionRowBuilder().addComponents(message)
    );

    return modal;
}

// ================================================
// CLOSE BUTTON
// ================================================

async function handleCloseButton(interaction) {
    const ticket = await getOpenTicket(interaction);

    if (!ticket) {
        await privateReply(
            interaction,
            "❌ This channel does not have an open ticket."
        );
        return true;
    }

    if (isManager(interaction)) {
        await interaction.showModal(buildCloseModal());
        return true;
    }

    // The regular member receives an ephemeral
    // response inside the ticket channel.
    const embed = createEmbed(
        "🔒 Request Ticket Closure",
        [
            "Only server managers can close tickets.",
            "",
            "You can send a closure request to the staff team.",
            "",
            "Your message is optional.",
            "",
            "The ticket will remain open until a manager approves."
        ].join("\n"),
        SETTINGS.COLOR
    );

    await interaction.reply({
        embeds: [embed],
        components: [buildRequestButton()],
        flags: MessageFlags.Ephemeral
    });

    return true;
}

// ================================================
// REQUEST BUTTON
// ================================================

async function handleCloseRequestButton(interaction) {
    const ticket = await getOpenTicket(interaction);

    if (!ticket) {
        await privateReply(
            interaction,
            "❌ This ticket is no longer open."
        );
        return true;
    }

    if (
        ticket.userId !== interaction.user.id &&
        !isManager(interaction)
    ) {
        await privateReply(
            interaction,
            "❌ Only the ticket owner can request closure."
        );
        return true;
    }

    if (ticket.closeRequest?.status === "pending") {
        await privateReply(
            interaction,
            "⏳ A closure request is already awaiting review."
        );
        return true;
    }

    await interaction.showModal(buildRequestModal());
    return true;
}

// ================================================
// REQUEST MODAL SUBMISSION
// ================================================

async function handleCloseRequestModal(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const ticket = await getOpenTicket(interaction);

    if (!ticket) {
        await privateReply(
            interaction,
            "❌ This ticket is already closed."
        );
        return true;
    }

    if (
        ticket.userId !== interaction.user.id &&
        !isManager(interaction)
    ) {
        await privateReply(
            interaction,
            "❌ You cannot request closure for this ticket."
        );
        return true;
    }

    const message = cleanText(
        interaction.fields.getTextInputValue(
            "request_message"
        )
    );

    const requestId = randomUUID();

    // One pending request per open ticket.
    const update = await getTickets().updateOne(
        {
            _id: ticket._id,
            status: "open",
            $or: [
                { "closeRequest.status": { $exists: false } },
                { "closeRequest.status": "denied" },
                { "closeRequest.status": "failed" }
            ]
        },
        {
            $set: {
                closeRequest: {
                    id: requestId,
                    status: "pending",
                    requestedBy: interaction.user.id,
                    message,
                    requestedAt: new Date()
                },
                updatedAt: new Date()
            }
        }
    );

    if (update.modifiedCount !== 1) {
        await privateReply(
            interaction,
            "⏳ A closure request is already pending, or the ticket has been closed."
        );
        return true;
    }

    const embed = createEmbed(
        "📨 NEW TICKET CLOSURE REQUEST",
        [
            `**Ticket owner:** <@${ticket.userId}>`,
            `**Requested by:** <@${interaction.user.id}>`,
            "",
            "**Optional Message:**",
            message || "*No message provided.*",
            "",
            "### 🛡️ Staff Review",
            "A server manager can approve or deny this request.",
            "",
            "**Status:** ⏳ Pending"
        ].join("\n"),
        SETTINGS.WARNING
    );

    try {
        const reviewMessage = await interaction.channel.send({
            embeds: [embed],
            components: [buildReviewButtons(requestId)],
            allowedMentions: { parse: [] }
        });

        await getTickets().updateOne(
            {
                _id: ticket._id,
                "closeRequest.id": requestId,
                "closeRequest.status": "pending"
            },
            {
                $set: {
                    "closeRequest.messageId": reviewMessage.id
                }
            }
        );

        await privateReply(
            interaction,
            "✅ Your closure request has been sent to server management."
        );
    } catch (error) {
        console.error(
            "[Tickets] Closure request message failed:",
            error
        );

        await getTickets().updateOne(
            {
                _id: ticket._id,
                "closeRequest.id": requestId,
                "closeRequest.status": "pending"
            },
            {
                $set: {
                    "closeRequest.status": "failed"
                }
            }
        );

        await privateReply(
            interaction,
            "❌ The request could not be sent. Please try again."
        );
    }

    return true;
}

// ================================================
// CLOSURE NOTIFICATION
// ================================================

async function notifyTicketOwner(
    interaction,
    ticket,
    message
) {
    try {
        const user = await interaction.client.users.fetch(
            ticket.userId
        );

        await user.send({
            embeds: [
                createEmbed(
                    "🔒 Your Ticket Has Been Closed",
                    [
                        "Your ticket has been closed by server management.",
                        "",
                        "**Management Message:**",
                        message || "*No additional message.*",
                        "",
                        "Thank you for contacting our support team!"
                    ].join("\n"),
                    SETTINGS.SUCCESS
                )
            ]
        });

        return true;
    } catch (error) {
        console.warn(
            "[Tickets] Could not DM ticket owner:",
            error
        );
        return false;
    }
}

// ================================================
// ACTUAL TICKET CLOSURE
// ================================================

async function closeTicket(
    interaction,
    ticket,
    closureMessage,
    expectedRequestId = null
) {
    const now = new Date();

    const filter = {
        _id: ticket._id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        status: "open"
    };

    if (expectedRequestId) {
        filter["closeRequest.id"] = expectedRequestId;
        filter["closeRequest.status"] = "pending";
    }

    const set = {
        status: "closed",
        closedAt: now,
        closedBy: interaction.user.id,
        closureMessage,
        updatedAt: now
    };

    if (expectedRequestId) {
        set["closeRequest.status"] = "approved";
        set["closeRequest.reviewedBy"] = interaction.user.id;
        set["closeRequest.reviewedAt"] = now;
    } else if (ticket.closeRequest?.status === "pending") {
        set["closeRequest.status"] = "closed";
        set["closeRequest.reviewedBy"] = interaction.user.id;
        set["closeRequest.reviewedAt"] = now;
    }

    const result = await getTickets().updateOne(
        filter,
        { $set: set }
    );

    if (result.modifiedCount !== 1) {
        return {
            success: false,
            reason: "ALREADY_CLOSED"
        };
    }

    // Ticket is officially closed in MongoDB.
    // Other operations are best-effort.
    let transcriptSent = false;

    try {
        const transcript = await buildTranscript(
            interaction.channel,
            ticket
        );

        if (transcript) {
            await interaction.user.send({
                content:
                    `📄 Ticket transcript for <@${ticket.userId}>`,
                files: [transcript],
                allowedMentions: { parse: [] }
            });

            transcriptSent = true;
        }
    } catch (error) {
        console.error(
            "[Tickets] Transcript delivery failed:",
            error
        );
    }

    const dmSent = await notifyTicketOwner(
        interaction,
        ticket,
        closureMessage
    );

    try {
        await interaction.channel.permissionOverwrites.edit(
            ticket.userId,
            {
                SendMessages: false
            }
        );
    } catch (error) {
        console.error(
            "[Tickets] Could not lock channel:",
            error
        );
    }

    try {
        await interaction.channel.send({
            embeds: [
                createEmbed(
                    "🔒 TICKET CLOSED",
                    [
                        `**Closed by:** <@${interaction.user.id}>`,
                        `**Ticket owner:** <@${ticket.userId}>`,
                        "",
                        "**Management Message:**",
                        closureMessage || "*No additional message.*",
                        "",
                        "This ticket is now inactive."
                    ].join("\n"),
                    SETTINGS.ERROR
                )
            ],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error(
            "[Tickets] Could not post closure message:",
            error
        );
    }

    return {
        success: true,
        dmSent,
        transcriptSent
    };
}

// ================================================
// DIRECT MANAGER CLOSURE
// ================================================

async function handleCloseModal(interaction) {
    if (!isManager(interaction)) {
        await privateReply(
            interaction,
            "❌ Only server managers can close tickets."
        );
        return true;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const ticket = await getOpenTicket(interaction);

    if (!ticket) {
        await privateReply(
            interaction,
            "❌ This ticket is already closed."
        );
        return true;
    }

    const message = cleanText(
        interaction.fields.getTextInputValue(
            "closure_message"
        )
    );

    const result = await closeTicket(
        interaction,
        ticket,
        message
    );

    await privateReply(
        interaction,
        result.success
            ? "✅ Ticket closed successfully."
            : "❌ This ticket has already been closed."
    );

    return true;
}

// ================================================
// MANAGER APPROVE / DENY REQUEST
// ================================================

async function handleCloseReviewButton(interaction) {
    const parts = interaction.customId.split(":");

    if (
        parts.length !== 3 ||
        parts[0] !== SETTINGS.REVIEW_PREFIX ||
        !["approve", "deny"].includes(parts[1])
    ) {
        return false;
    }

    if (!isManager(interaction)) {
        await privateReply(
            interaction,
            "❌ Only server managers can review closure requests."
        );
        return true;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const action = parts[1];
    const requestId = parts[2];

    const ticket = await getOpenTicket(interaction);

    if (
        !ticket ||
        ticket.closeRequest?.id !== requestId ||
        ticket.closeRequest?.status !== "pending" ||
        (
            ticket.closeRequest.messageId &&
            ticket.closeRequest.messageId !== interaction.message.id
        )
    ) {
        await privateReply(
            interaction,
            "❌ This request is no longer pending."
        );
        return true;
    }

    if (action === "approve") {
        const result = await closeTicket(
            interaction,
            ticket,
            ticket.closeRequest.message || "",
            requestId
        );

        if (!result.success) {
            await privateReply(
                interaction,
                "❌ This request was already processed."
            );
            return true;
        }
    } else {
        const result = await getTickets().updateOne(
            {
                _id: ticket._id,
                status: "open",
                "closeRequest.id": requestId,
                "closeRequest.status": "pending"
            },
            {
                $set: {
                    "closeRequest.status": "denied",
                    "closeRequest.reviewedBy": interaction.user.id,
                    "closeRequest.reviewedAt": new Date(),
                    updatedAt: new Date()
                }
            }
        );

        if (result.modifiedCount !== 1) {
            await privateReply(
                interaction,
                "❌ This request was already processed."
            );
            return true;
        }

        // A later staff decision cannot push an ephemeral
        // message into another user's existing interaction.
        // Notify the requester by DM instead.
        try {
            const user = await interaction.client.users.fetch(
                ticket.closeRequest.requestedBy
            );

            await user.send({
                embeds: [
                    createEmbed(
                        "❌ Closure Request Denied",
                        "Your closure request was denied by server management. Your ticket remains open.",
                        SETTINGS.WARNING
                    )
                ]
            });
        } catch (error) {
            console.warn(
                "[Tickets] Could not notify requester:",
                error
            );
        }
    }

    const approved = action === "approve";

    await interaction.message.edit({
        embeds: [
            createEmbed(
                approved
                    ? "✅ Closure Request Approved"
                    : "❌ Closure Request Denied",
                [
                    `**Reviewed by:** <@${interaction.user.id}>`,
                    "",
                    approved
                        ? "The ticket has been closed."
                        : "The ticket remains open."
                ].join("\n"),
                approved ? SETTINGS.SUCCESS : SETTINGS.ERROR
            )
        ],
        components: [],
        allowedMentions: { parse: [] }
    }).catch(() => {});

    await privateReply(
        interaction,
        approved
            ? "✅ Request approved. Ticket closed."
            : "❌ Request denied. Ticket remains open."
    );

    return true;
}

module.exports = {
    buildCloseButton,
    buildCloseModal,
    buildRequestModal,
    handleCloseButton,
    handleCloseModal,
    handleCloseRequestButton,
    handleCloseRequestModal,
    handleCloseReviewButton
};
