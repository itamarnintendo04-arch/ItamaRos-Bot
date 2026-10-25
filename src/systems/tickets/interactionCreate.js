
"use strict";

const {
    MessageFlags
} = require("discord.js");

const {
    TICKET_TYPES
} = require("./config");

const {
    buildTicketModal,
    getTicketFormAnswers
} = require("./forms");

const {
    createTicket
} = require("./create");

const {
    handleCloseButton,
    handleCloseModal,
    handleCloseRequestButton,
    handleCloseRequestModal,
    handleCloseReviewButton
} = require("./close");

const {
    handleDeleteButton,
    handleDeleteConfirm,
    handleDeleteCancel
} = require("./delete");

const {
    handleClaimButton
} = require("./claim");

// ==================================================
// ITAMAROS BOT • TICKET INTERACTION ROUTER 3.0
// ==================================================

const IDS = Object.freeze({
    SELECT: "ticket_type_select",

    HELP_PREFIX: "ticket_help_",
    OPEN_PREFIX: "ticket_form_open_",
    FORM_PREFIX: "ticket_form_",

    CLOSE: "ticket_close",
    CLOSE_MODAL: "ticket_close_modal",

    CLOSE_REQUEST: "ticket_close_request",
    CLOSE_REQUEST_MODAL: "ticket_close_request_modal",
    CLOSE_REVIEW_PREFIX: "ticket_close_review:",

    CLAIM: "ticket_claim",

    DELETE: "ticket_delete",
    DELETE_CONFIRM: "ticket_delete_confirm",
    DELETE_CANCEL: "ticket_delete_cancel"
});

const MESSAGES = Object.freeze({
    SERVER_ONLY:
        "❌ This action can only be used inside a server.",

    INVALID_TYPE:
        "❌ This ticket category is invalid or unavailable.",

    GIVEAWAY_RESTRICTED: [
        "🏆 **Giveaway Winner Tickets**",
        "",
        "You cannot open giveaway winner tickets through the public support panel.",
        "",
        "🎉 Verified giveaway winners receive their tickets automatically.",
        "",
        "🛡️ Server managers may create a giveaway ticket for a selected member using the dedicated administration command.",
        "",
        "If you won but did not receive your ticket, contact server staff."
    ].join("\n"),

    ACTIVE_TICKET: [
        "❌ **You Already Have an Active Ticket!**",
        "",
        "Please use your existing support ticket before opening another one."
    ].join("\n"),

    CREATION_IN_PROGRESS:
        "⏳ Your ticket is already being created. Please try again shortly.",

    CREATION_FAILED:
        "❌ Your ticket could not be created. Please try again.",

    UNKNOWN_ERROR:
        "❌ Something went wrong while processing your ticket."
});

// ==================================================
// HELPERS
// ==================================================

function getGiveawayTypeId() {
    return TICKET_TYPES.GIVEAWAY?.id || "giveaway";
}

function isGiveawayType(typeId) {
    return typeId === getGiveawayTypeId();
}

function getTicketType(typeId) {
    return Object.values(TICKET_TYPES).find(
        type => type?.id === typeId
    ) || null;
}

function getFormTypeFromCustomId(customId) {
    if (
        typeof customId !== "string" ||
        !customId.startsWith(IDS.FORM_PREFIX)
    ) {
        return null;
    }

    const suffix = customId.slice(
        IDS.FORM_PREFIX.length
    );

    // Existing forms are identified by type.
    // Never allow a public giveaway form.
    if (
        suffix === getGiveawayTypeId() ||
        suffix.startsWith(
            `${getGiveawayTypeId()}_`
        ) ||
        suffix.startsWith(
            `${getGiveawayTypeId()}:`
        )
    ) {
        return getGiveawayTypeId();
    }

    return suffix;
}

function isRestrictedFormData(formData) {
    if (!formData || typeof formData !== "object") {
        return false;
    }

    return [
        formData.type,
        formData.typeId,
        formData.ticketType,
        formData.ticketTypeId
    ].some(isGiveawayType);
}

async function respondPrivately(interaction, content) {
    const payload = {
        content,
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

async function rejectGiveawayForm(interaction) {
    await respondPrivately(
        interaction,
        MESSAGES.GIVEAWAY_RESTRICTED
    );

    return true;
}

async function requireServer(interaction) {
    if (interaction.inGuild()) {
        return true;
    }

    await respondPrivately(
        interaction,
        MESSAGES.SERVER_ONLY
    );

    return false;
}

// ==================================================
// PUBLIC TICKET SELECT MENU
// ==================================================

async function handleTicketSelect(interaction) {
    const selectedType = interaction.values?.[0];

    if (isGiveawayType(selectedType)) {
        return rejectGiveawayForm(interaction);
    }

    const type = getTicketType(selectedType);

    if (!type || type.publicEnabled !== true) {
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

// ==================================================
// LEGACY TICKET BUTTONS
// ==================================================

async function handleLegacyHelp(interaction) {
    const typeId = interaction.customId.slice(
        IDS.HELP_PREFIX.length
    );

    if (isGiveawayType(typeId)) {
        return rejectGiveawayForm(interaction);
    }

    const type = getTicketType(typeId);

    if (!type) {
        await respondPrivately(
            interaction,
            MESSAGES.INVALID_TYPE
        );

        return true;
    }

    const { handleTicketHelp } = require("./forms");

    if (typeof handleTicketHelp !== "function") {
        await respondPrivately(
            interaction,
            "❌ This old ticket button is no longer supported. Please use the current support panel."
        );

        return true;
    }

    await handleTicketHelp(interaction);
    return true;
}

async function handleLegacyFormOpen(interaction) {
    const typeId = interaction.customId.slice(
        IDS.OPEN_PREFIX.length
    );

    if (isGiveawayType(typeId)) {
        return rejectGiveawayForm(interaction);
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

// ==================================================
// TICKET FORM SUBMISSION
// ==================================================

async function handleTicketForm(interaction) {
    const formType = getFormTypeFromCustomId(
        interaction.customId
    );

    // Block public giveaway forms from old panels.
    if (isGiveawayType(formType)) {
        return rejectGiveawayForm(interaction);
    }

    const formData = getTicketFormAnswers(
        interaction
    );

    if (isRestrictedFormData(formData)) {
        return rejectGiveawayForm(interaction);
    }

    if (
        !formData ||
        !getTicketType(formData.type)
    ) {
        await respondPrivately(
            interaction,
            MESSAGES.INVALID_TYPE
        );

        return true;
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
                const channelText = result.channel
                    ? `${result.channel}`
                    : "your existing ticket";

                await interaction.editReply({
                    content: [
                        MESSAGES.ACTIVE_TICKET,
                        "",
                        `🎫 **Existing Ticket:** ${channelText}`
                    ].join("\n")
                });

                return true;
            }

            case "CREATION_IN_PROGRESS": {
                await interaction.editReply({
                    content: MESSAGES.CREATION_IN_PROGRESS
                });

                return true;
            }

            case "GIVEAWAY_RESTRICTED":
            case "FORBIDDEN_TICKET_TYPE":
            case "NOT_AUTHORIZED": {
                await interaction.editReply({
                    content: MESSAGES.GIVEAWAY_RESTRICTED
                });

                return true;
            }

            case "MISSING_BOT_PERMISSIONS": {
                await interaction.editReply({
                    content: [
                        "❌ **Missing Bot Permissions**",
                        "",
                        "Please ask a server administrator to check the permissions of the ItamaRos Bot role."
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

    const ticketChannel = result.channel
        ? `${result.channel}`
        : "your ticket channel";

    const text = result.reused
        ? [
            "✅ **Ticket Reopened!**",
            "",
            `🎫 ${ticketChannel}`,
            "",
            "Your previous ticket channel is available again."
        ].join("\n")
        : [
            "✅ **Ticket Created Successfully!**",
            "",
            `🎫 ${ticketChannel}`,
            "",
            "Please wait for server staff to assist you."
        ].join("\n");

    await interaction.editReply({
        content: text,
        allowedMentions: {
            parse: []
        }
    });

    return true;
}

// ==================================================
// CLOSE TICKET AND CLOSURE REQUEST ROUTING
// ==================================================

async function routeTicketClose(interaction) {
    if (
        interaction.isButton() &&
        interaction.customId === IDS.CLOSE
    ) {
        return await handleCloseButton(interaction);
    }

    if (
        interaction.isModalSubmit() &&
        interaction.customId === IDS.CLOSE_MODAL
    ) {
        return await handleCloseModal(interaction);
    }

    if (
        interaction.isButton() &&
        interaction.customId === IDS.CLOSE_REQUEST
    ) {
        return await handleCloseRequestButton(
            interaction
        );
    }

    if (
        interaction.isModalSubmit() &&
        interaction.customId === IDS.CLOSE_REQUEST_MODAL
    ) {
        return await handleCloseRequestModal(
            interaction
        );
    }

    if (
        interaction.isButton() &&
        interaction.customId.startsWith(
            IDS.CLOSE_REVIEW_PREFIX
        )
    ) {
        return await handleCloseReviewButton(
            interaction
        );
    }

    return false;
}

// ==================================================
// CLAIM / DELETE TICKET ROUTING
// ==================================================

async function routeTicketManagement(interaction) {
    if (!interaction.isButton()) {
        return false;
    }

    switch (interaction.customId) {
        case IDS.CLAIM:
            await handleClaimButton(interaction);
            return true;

        case IDS.DELETE:
            await handleDeleteButton(interaction);
            return true;

        case IDS.DELETE_CONFIRM:
            await handleDeleteConfirm(interaction);
            return true;

        case IDS.DELETE_CANCEL:
            await handleDeleteCancel(interaction);
            return true;

        default:
            return false;
    }
}

// ==================================================
// MAIN INTERACTION ROUTER
// ==================================================

async function handleTicketInteraction(interaction) {
    try {
        // PUBLIC TICKET MENU
        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === IDS.SELECT
        ) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await handleTicketSelect(
                interaction
            );
        }

        // LEGACY HELP BUTTON
        if (
            interaction.isButton() &&
            interaction.customId.startsWith(
                IDS.HELP_PREFIX
            )
        ) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await handleLegacyHelp(
                interaction
            );
        }

        // LEGACY OPEN FORM BUTTON
        if (
            interaction.isButton() &&
            interaction.customId.startsWith(
                IDS.OPEN_PREFIX
            )
        ) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await handleLegacyFormOpen(
                interaction
            );
        }

        // TICKET FORM
        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith(
                IDS.FORM_PREFIX
            )
        ) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await handleTicketForm(
                interaction
            );
        }

        // CLOSING / REQUESTING CLOSURE
        const closeInteraction =
            (
                interaction.isButton() &&
                (
                    interaction.customId === IDS.CLOSE ||
                    interaction.customId === IDS.CLOSE_REQUEST ||
                    interaction.customId.startsWith(
                        IDS.CLOSE_REVIEW_PREFIX
                    )
                )
            ) ||
            (
                interaction.isModalSubmit() &&
                (
                    interaction.customId === IDS.CLOSE_MODAL ||
                    interaction.customId === IDS.CLOSE_REQUEST_MODAL
                )
            );

        if (closeInteraction) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await routeTicketClose(
                interaction
            );
        }

        // CLAIM / DELETE
        if (
            interaction.isButton() &&
            [
                IDS.CLAIM,
                IDS.DELETE,
                IDS.DELETE_CONFIRM,
                IDS.DELETE_CANCEL
            ].includes(interaction.customId)
        ) {
            if (!await requireServer(interaction)) {
                return true;
            }

            return await routeTicketManagement(
                interaction
            );
        }

        return false;
    } catch (error) {
        console.error(
            "[Tickets] Interaction routing error:",
            error
        );

        let errorMessage = MESSAGES.UNKNOWN_ERROR;

        if (
            error.message?.startsWith(
                "MISSING_BOT_PERMISSIONS"
            )
        ) {
            errorMessage = [
                "❌ **Missing Bot Permissions!**",
                "",
                "Please open:",
                "**Server Settings → Roles → ItamaRos Bot**",
                "",
                "Make sure the bot can manage ticket channels, send messages and manage the required permissions."
            ].join("\n");
        }

        try {
            await respondPrivately(
                interaction,
                errorMessage
            );
        } catch (replyError) {
            console.error(
                "[Tickets] Failed to send error response:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    handleTicketInteraction
};
