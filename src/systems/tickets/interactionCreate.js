
"use strict";

const { MessageFlags } = require("discord.js");

const { TICKET_TYPES } = require("./config");

const {
    buildTicketModal,
    getTicketFormAnswers
} = require("./forms");

const { createTicket } = require("./create");

const {
    handleCloseButton,
    handleCloseModal
} = require("./close");

const {
    handleDeleteButton,
    handleDeleteConfirm,
    handleDeleteCancel
} = require("./delete");

const { handleClaimButton } = require("./claim");

/**
 * =====================================================
 * ITAMAROS BOT
 * TICKET INTERACTION SYSTEM 2.0
 * =====================================================
 *
 * Handles:
 * - Ticket category selection
 * - Legacy ticket buttons
 * - Ticket forms
 * - Ticket creation
 * - Ticket claiming
 * - Ticket closing
 * - Ticket deletion
 *
 * Giveaway winner tickets:
 * - Cannot be requested through public interactions
 * - Are automatically created for verified winners
 * - May be created by staff through a separate,
 *   permission-protected admin command
 *
 * =====================================================
 */

const SETTINGS = Object.freeze({
    SELECT_MENU_ID: "ticket_type_select",

    FORM_PREFIX: "ticket_form_",
    HELP_PREFIX: "ticket_help_",
    OPEN_PREFIX: "ticket_form_open_",

    GIVEAWAY_TYPE: TICKET_TYPES.GIVEAWAY.id
});

const MESSAGES = Object.freeze({
    GIVEAWAY_RESTRICTED: [
        "🏆 **Giveaway Winner Tickets**",
        "",
        "Giveaway winner tickets cannot be opened manually through the public support panel.",
        "",
        "✅ Verified winners receive their tickets automatically.",
        "🛡️ Server staff can create giveaway tickets through their administration commands.",
        "",
        "If you won a giveaway but did not receive your ticket, please contact the server staff."
    ].join("\n"),

    INVALID_TYPE:
        "❌ This ticket category is invalid or unavailable.",

    SERVER_ONLY:
        "❌ Tickets can only be opened inside a server.",

    CREATION_FAILED:
        "❌ Could not create your ticket. Please try again.",

    UNKNOWN_ERROR:
        "❌ Something went wrong while processing your ticket."
});

function isGiveawayType(typeId) {
    return (
        typeof typeId === "string" &&
        typeId === SETTINGS.GIVEAWAY_TYPE
    );
}

function isGiveawayFormId(customId) {
    if (typeof customId !== "string") {
        return false;
    }

    const giveawayForm =
        `${SETTINGS.FORM_PREFIX}${SETTINGS.GIVEAWAY_TYPE}`;

    return (
        customId === giveawayForm ||
        customId.startsWith(`${giveawayForm}_`) ||
        customId.startsWith(`${giveawayForm}:`)
    );
}

function isRestrictedFormData(formData) {
    if (
        !formData ||
        typeof formData !== "object"
    ) {
        return false;
    }

    const candidates = [
        formData.type,
        formData.typeId,
        formData.ticketType,
        formData.ticketTypeId
    ];

    return candidates.some(isGiveawayType);
}

function getTicketType(typeId) {
    return Object.values(TICKET_TYPES).find(
        type => type.id === typeId
    ) || null;
}

async function respondPrivately(
    interaction,
    content
) {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
            content,
            allowedMentions: {
                parse: []
            }
        });

        return;
    }

    await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: {
            parse: []
        }
    });
}

async function rejectGiveawayRequest(interaction) {
    await respondPrivately(
        interaction,
        MESSAGES.GIVEAWAY_RESTRICTED
    );

    return true;
}

/**
 * SELECT MENU
 *
 * The public menu never allows a user to choose
 * Giveaway Winner, even if an old panel still
 * contains the option.
 */
async function handleTicketSelect(interaction) {
    const selectedType = interaction.values?.[0];

    if (isGiveawayType(selectedType)) {
        return rejectGiveawayRequest(interaction);
    }

    const type = getTicketType(selectedType);

    if (!type) {
        await respondPrivately(
            interaction,
            MESSAGES.INVALID_TYPE
        );

        return true;
    }

    await interaction.showModal(
        buildTicketModal(type.id)
    );

    return true;
}

/**
 * LEGACY BUTTONS
 *
 * Older ticket panels may still have buttons.
 * Protect these routes too.
 */
async function handleLegacyHelp(interaction) {
    const typeId = interaction.customId.slice(
        SETTINGS.HELP_PREFIX.length
    );

    if (isGiveawayType(typeId)) {
        return rejectGiveawayRequest(interaction);
    }

    const { handleTicketHelp } = require("./forms");

    await handleTicketHelp(interaction);

    return true;
}

async function handleLegacyFormOpen(interaction) {
    const typeId = interaction.customId.slice(
        SETTINGS.OPEN_PREFIX.length
    );

    if (isGiveawayType(typeId)) {
        return rejectGiveawayRequest(interaction);
    }

    const type = getTicketType(typeId);

    if (!type) {
        await respondPrivately(
            interaction,
            MESSAGES.INVALID_TYPE
        );

        return true;
    }

    await interaction.showModal(
        buildTicketModal(type.id)
    );

    return true;
}

/**
 * TICKET CREATION
 *
 * Reject public giveaway requests before
 * calling the ticket creation system.
 *
 * A second authorization check must also
 * exist inside create.js.
 */
async function handleTicketForm(interaction) {
    if (isGiveawayFormId(interaction.customId)) {
        return rejectGiveawayRequest(interaction);
    }

    const formData = getTicketFormAnswers(
        interaction
    );

    if (isRestrictedFormData(formData)) {
        return rejectGiveawayRequest(interaction);
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const result = await createTicket(
        interaction,
        formData
    );

    if (!result?.success) {
        switch (result?.reason) {
            case "ACTIVE_TICKET": {
                const existingChannel =
                    result.channel || "your existing ticket";

                await interaction.editReply({
                    content: [
                        "❌ **You Already Have an Active Ticket!**",
                        "",
                        `🎫 Existing ticket: ${existingChannel}`,
                        "",
                        "Please close your current ticket before opening another regular support ticket."
                    ].join("\n")
                });

                return true;
            }

            case "FORBIDDEN_TICKET_TYPE":
            case "GIVEAWAY_RESTRICTED":
            case "NOT_AUTHORIZED": {
                await interaction.editReply({
                    content:
                        MESSAGES.GIVEAWAY_RESTRICTED
                });

                return true;
            }

            case "MISSING_BOT_PERMISSIONS": {
                await interaction.editReply({
                    content: [
                        "❌ **Missing Bot Permissions**",
                        "",
                        "ItamaRos Bot does not have all the permissions required to create your ticket.",
                        "",
                        "Please ask a server administrator to check the bot role and channel permissions."
                    ].join("\n")
                });

                return true;
            }

            default: {
                await interaction.editReply({
                    content: MESSAGES.CREATION_FAILED
                });

                return true;
            }
        }
    }

    const ticketChannel =
        result.channel || "your ticket channel";

    const response = result.reused
        ? [
            "✅ **Ticket Reopened!**",
            "",
            `🎫 ${ticketChannel}`,
            "",
            "Your previous ticket channel is ready."
        ].join("\n")
        : [
            "✅ **Ticket Created Successfully!**",
            "",
            `🎫 ${ticketChannel}`,
            "",
            "Please wait for a staff member to assist you."
        ].join("\n");

    await interaction.editReply({
        content: response,
        allowedMentions: {
            parse: []
        }
    });

    return true;
}

/**
 * TICKET INTERACTION ROUTER
 */
async function handleTicketInteraction(interaction) {
    try {
        // ============================================
        // PUBLIC TICKET SELECT MENU
        // ============================================

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === SETTINGS.SELECT_MENU_ID
        ) {
            if (!interaction.inGuild()) {
                await respondPrivately(
                    interaction,
                    MESSAGES.SERVER_ONLY
                );

                return true;
            }

            return await handleTicketSelect(
                interaction
            );
        }

        // ============================================
        // LEGACY HELP BUTTON
        // ============================================

        if (
            interaction.isButton() &&
            interaction.customId.startsWith(
                SETTINGS.HELP_PREFIX
            )
        ) {
            return await handleLegacyHelp(
                interaction
            );
        }

        // ============================================
        // LEGACY OPEN FORM BUTTON
        // ============================================

        if (
            interaction.isButton() &&
            interaction.customId.startsWith(
                SETTINGS.OPEN_PREFIX
            )
        ) {
            return await handleLegacyFormOpen(
                interaction
            );
        }

        // ============================================
        // TICKET FORM SUBMISSION
        // ============================================

        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith(
                SETTINGS.FORM_PREFIX
            )
        ) {
            if (!interaction.inGuild()) {
                await respondPrivately(
                    interaction,
                    MESSAGES.SERVER_ONLY
                );

                return true;
            }

            return await handleTicketForm(
                interaction
            );
        }

        // ============================================
        // CLOSE TICKET
        // ============================================

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_close"
        ) {
            await handleCloseButton(interaction);
            return true;
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId === "ticket_close_modal"
        ) {
            await handleCloseModal(interaction);
            return true;
        }

        // ============================================
        // CLAIM TICKET
        // ============================================

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_claim"
        ) {
            await handleClaimButton(interaction);
            return true;
        }

        // ============================================
        // DELETE TICKET
        // ============================================

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete"
        ) {
            await handleDeleteButton(interaction);
            return true;
        }

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete_confirm"
        ) {
            await handleDeleteConfirm(interaction);
            return true;
        }

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete_cancel"
        ) {
            await handleDeleteCancel(interaction);
            return true;
        }

        return false;

    } catch (error) {
        console.error(
            "[Tickets] Interaction error:",
            error
        );

        let errorMessage = MESSAGES.UNKNOWN_ERROR;

        if (
            error.message?.startsWith(
                "MISSING_BOT_PERMISSIONS"
            )
        ) {
            errorMessage = [
                "❌ **ItamaRos Bot Is Missing Permissions!**",
                "",
                "Please check:",
                "**Server Settings → Roles → ItamaRos Bot**",
                "",
                "Make sure the bot has the permissions required for ticket channels."
            ].join("\n");
        }

        try {
            await respondPrivately(
                interaction,
                errorMessage
            );
        } catch (replyError) {
            console.error(
                "[Tickets] Error response failed:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    handleTicketInteraction
};
