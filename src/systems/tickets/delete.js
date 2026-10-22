
"use strict";

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { buildTranscript } = require("./transcript");

// ==================================================
// ITAMAROS BOT • TICKET DELETION SYSTEM 3.0
// ==================================================

const SETTINGS = Object.freeze({
    DELETE_BUTTON: "ticket_delete",
    CONFIRM_BUTTON: "ticket_delete_confirm",
    CANCEL_BUTTON: "ticket_delete_cancel",

    SUCCESS: 0x22C55E,
    ERROR: 0xED4245,
    WARNING: 0xF59E0B
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

function isManager(interaction) {
    if (!interaction.inGuild()) {
        return false;
    }

    const permissions = interaction.memberPermissions;

    return Boolean(
        permissions?.has(
            PermissionFlagsBits.Administrator
        ) ||
        permissions?.has(
            PermissionFlagsBits.ManageGuild
        )
    );
}

// ==================================================
// EMBEDS
// ==================================================

function makeEmbed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Ticket Administration"
        })
        .setTimestamp();
}

// ==================================================
// PRIVATE RESPONSES
// ==================================================

async function replyPrivately(interaction, content) {
    const payload = typeof content === "string"
        ? { content }
        : content;

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

// ==================================================
// TICKET LOOKUP
// ==================================================

async function getTicketState(interaction) {
    const collection = getTicketCollection();

    const scope = {
        guildId: interaction.guildId,
        channelId: interaction.channelId
    };

    const activeTicket = await collection.findOne({
        ...scope,
        status: "open"
    });

    if (activeTicket) {
        return {
            state: "open",
            ticket: activeTicket
        };
    }

    const deletingTicket = await collection.findOne({
        ...scope,
        status: "deleting"
    });

    if (deletingTicket) {
        return {
            state: "deleting",
            ticket: deletingTicket
        };
    }

    const closedTicket = await collection.findOne(
        {
            ...scope,
            status: "closed"
        },
        {
            sort: {
                closedAt: -1,
                updatedAt: -1
            }
        }
    );

    if (closedTicket) {
        return {
            state: "closed",
            ticket: closedTicket
        };
    }

    return {
        state: "missing",
        ticket: null
    };
}

// ==================================================
// DELETE CONFIRMATION
// ==================================================

function buildDeleteConfirmation() {
    const embed = makeEmbed(
        "🗑️ Delete Closed Ticket?",
        [
            "Are you sure you want to permanently delete this ticket channel?",
            "",
            "📄 **Before deletion:**",
            "A transcript will be generated and sent to your Discord DMs.",
            "",
            "🔒 **Safety:**",
            "If the transcript cannot be delivered, the channel will not be deleted.",
            "",
            "⚠️ **This action cannot be undone.**"
        ].join("\n"),
        SETTINGS.WARNING
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(SETTINGS.CONFIRM_BUTTON)
            .setLabel("Confirm Delete")
            .setEmoji("🗑️")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId(SETTINGS.CANCEL_BUTTON)
            .setLabel("Cancel")
            .setEmoji("✖️")
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        embeds: [embed],
        components: [row]
    };
}

// ==================================================
// INITIAL DELETE BUTTON
// ==================================================

async function handleDeleteButton(interaction) {
    if (!isManager(interaction)) {
        await replyPrivately(
            interaction,
            "❌ Only server managers can delete tickets."
        );

        return true;
    }

    const state = await getTicketState(interaction);

    if (state.state === "open") {
        await replyPrivately(
            interaction,
            {
                embeds: [
                    makeEmbed(
                        "🔒 Close Ticket First",
                        [
                            "This ticket is still open.",
                            "",
                            "You must close the ticket before deleting it.",
                            "",
                            "Use the **🔒 Close Ticket** button first."
                        ].join("\n"),
                        SETTINGS.WARNING
                    )
                ]
            }
        );

        return true;
    }

    if (state.state === "deleting") {
        await replyPrivately(
            interaction,
            "⏳ This ticket is already being deleted."
        );

        return true;
    }

    if (state.state !== "closed") {
        await replyPrivately(
            interaction,
            "❌ No closed ticket was found in this channel."
        );

        return true;
    }

    await replyPrivately(
        interaction,
        buildDeleteConfirmation()
    );

    return true;
}

// ==================================================
// CANCEL DELETE
// ==================================================

async function handleDeleteCancel(interaction) {
    if (!isManager(interaction)) {
        await replyPrivately(
            interaction,
            "❌ Only server managers can manage ticket deletion."
        );

        return true;
    }

    await interaction.update({
        content: "✅ Ticket deletion cancelled.",
        embeds: [],
        components: [],
        allowedMentions: {
            parse: []
        }
    });

    return true;
}

// ==================================================
// CONFIRM DELETE
// ==================================================

async function handleDeleteConfirm(interaction) {
    if (!isManager(interaction)) {
        await replyPrivately(
            interaction,
            "❌ Only server managers can delete tickets."
        );

        return true;
    }

    await interaction.deferUpdate();

    const collection = getTicketCollection();
    const channel = interaction.channel;

    if (!channel || !interaction.guildId) {
        await interaction.editReply({
            content: "❌ Ticket channel unavailable.",
            embeds: [],
            components: []
        });

        return true;
    }

    const state = await getTicketState(interaction);

    if (state.state !== "closed") {
        const message = state.state === "open"
            ? "❌ Close the ticket before deleting it."
            : "❌ This ticket is unavailable or already being deleted.";

        await interaction.editReply({
            content: message,
            embeds: [],
            components: []
        });

        return true;
    }

    const ticket = state.ticket;

    // ==============================================
    // STEP 1: GENERATE TRANSCRIPT
    // ==============================================

    let transcript;

    try {
        transcript = await buildTranscript(
            channel,
            ticket
        );

        if (!transcript) {
            throw new Error(
                "Transcript generator returned no file."
            );
        }
    } catch (error) {
        console.error(
            "[Tickets] Transcript generation failed:",
            error
        );

        await interaction.editReply({
            content: [
                "❌ Could not generate the transcript.",
                "",
                "**The ticket was not deleted.**"
            ].join("\n"),
            embeds: [],
            components: []
        });

        return true;
    }

    // ==============================================
    // STEP 2: SEND TRANSCRIPT TO MANAGER
    // ==============================================

    try {
        await interaction.user.send({
            content: [
                "📄 **ItamaRos Ticket Transcript**",
                "",
                `**Server:** ${interaction.guild.name}`,
                `**Ticket:** ${channel.name}`,
                `**Ticket Owner ID:** ${ticket.userId}`,
                `**Ticket Type:** ${ticket.typeLabel || ticket.type}`,
                "",
                "This transcript was requested before deleting the ticket channel."
            ].join("\n"),
            files: [transcript],
            allowedMentions: {
                parse: []
            }
        });
    } catch (error) {
        console.error(
            "[Tickets] Transcript DM failed:",
            error
        );

        await interaction.editReply({
            content: [
                "❌ I couldn't send the transcript to your DMs.",
                "",
                "Please allow direct messages from the bot and try again.",
                "",
                "**The ticket was not deleted.**"
            ].join("\n"),
            embeds: [],
            components: []
        });

        return true;
    }

    // ==============================================
    // STEP 3: RESERVE DELETION IN MONGODB
    // ==============================================

    const now = new Date();

    let reservation;

    try {
        reservation = await collection.updateOne(
            {
                _id: ticket._id,
                guildId: interaction.guildId,
                channelId: channel.id,
                status: "closed"
            },
            {
                $set: {
                    status: "deleting",
                    deletionStartedAt: now,
                    deletionRequestedBy: interaction.user.id,
                    updatedAt: now
                }
            }
        );
    } catch (error) {
        console.error(
            "[Tickets] Could not reserve deletion:",
            error
        );

        await interaction.editReply({
            content: "❌ Database error. The channel was not deleted.",
            embeds: [],
            components: []
        });

        return true;
    }

    if (reservation.modifiedCount !== 1) {
        await interaction.editReply({
            content: [
                "❌ This ticket's status changed before deletion.",
                "",
                "The channel was not deleted."
            ].join("\n"),
            embeds: [],
            components: []
        });

        return true;
    }

    // ==============================================
    // STEP 4: INFORM MANAGER
    // ==============================================

    try {
        await interaction.editReply({
            content: [
                "✅ Transcript delivered to your DMs.",
                "",
                "🗑️ Deleting the closed ticket channel..."
            ].join("\n"),
            embeds: [],
            components: []
        });
    } catch (error) {
        console.warn(
            "[Tickets] Could not update deletion response:",
            error
        );
    }

    // ==============================================
    // STEP 5: DELETE DISCORD CHANNEL
    // ==============================================

    try {
        await channel.delete(
            `Ticket deleted by manager ${interaction.user.id}`
        );
    } catch (error) {
        console.error(
            "[Tickets] Channel deletion failed:",
            error
        );

        // Restore the closed state on failed deletion.
        await collection.updateOne(
            {
                _id: ticket._id,
                status: "deleting",
                deletionRequestedBy: interaction.user.id
            },
            {
                $set: {
                    status: "closed",
                    updatedAt: new Date(),
                    deletionError: String(
                        error.message || error
                    ).slice(0, 500)
                },
                $unset: {
                    deletionStartedAt: "",
                    deletionRequestedBy: ""
                }
            }
        ).catch(restoreError => {
            console.error(
                "[Tickets] State restoration failed:",
                restoreError
            );
        });

        // The ephemeral response may no longer
        // be available after a channel operation.
        await interaction.followUp({
            content: [
                "❌ Failed to delete the ticket channel.",
                "",
                "The ticket has not been deleted from Discord."
            ].join("\n"),
            flags: MessageFlags.Ephemeral
        }).catch(() => {});

        return true;
    }

    // ==============================================
    // STEP 6: PRESERVE DELETION HISTORY
    // ==============================================

    try {
        await collection.updateMany(
            {
                guildId: interaction.guildId,
                channelId: channel.id,
                status: {
                    $in: ["closed", "deleting"]
                }
            },
            {
                $set: {
                    status: "deleted",
                    deletedAt: new Date(),
                    deletedBy: interaction.user.id,
                    updatedAt: new Date()
                },
                $unset: {
                    deletionStartedAt: "",
                    deletionRequestedBy: ""
                }
            }
        );

        console.log(
            `[Tickets] Channel ${channel.id} deleted by ` +
            `${interaction.user.id}. Records preserved.`
        );
    } catch (error) {
        // The channel is already gone. Keep the error
        // visible in logs for later database reconciliation.
        console.error(
            "[Tickets] Deleted channel but failed to update database:",
            error
        );
    }

    return true;
}

module.exports = {
    handleDeleteButton,
    handleDeleteConfirm,
    handleDeleteCancel,
    buildDeleteConfirmation
};
