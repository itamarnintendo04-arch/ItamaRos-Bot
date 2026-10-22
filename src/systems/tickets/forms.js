
"use strict";

const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require("discord.js");

const { TICKET_TYPES } = require("./config");

// ==================================================
// ITAMAROS BOT • TICKET FORMS SYSTEM 3.0
// ==================================================

const SETTINGS = Object.freeze({
    FORM_PREFIX: "ticket_form_",
    OPEN_PREFIX: "ticket_form_open_",
    HELP_PREFIX: "ticket_help_",

    MAX_FIELDS: 5,
    MAX_MODAL_TITLE: 45,
    MAX_FIELD_LABEL: 45,
    MAX_FIELD_LENGTH: 4000
});

// ==================================================
// FIND TICKET TYPE
// ==================================================

function findTicketType(typeKey) {
    if (typeof typeKey !== "string" || !typeKey) {
        return null;
    }

    return (
        TICKET_TYPES[typeKey] ||
        Object.values(TICKET_TYPES).find(
            type => type.id === typeKey
        ) ||
        null
    );
}

// ==================================================
// PUBLIC FORM SECURITY
// ==================================================

function isGiveawayType(type) {
    return Boolean(
        type &&
        type.id === TICKET_TYPES.GIVEAWAY.id
    );
}

function getPublicTicketType(typeKey) {
    const type = findTicketType(typeKey);

    if (!type) {
        throw new Error("INVALID_TICKET_TYPE");
    }

    // Giveaway winner tickets must only be created
    // by the automatic giveaway system or by the
    // dedicated staff command.
    //
    // Public panels, old buttons and old modals
    // are never allowed to open this type.
    if (isGiveawayType(type)) {
        throw new Error("GIVEAWAY_RESTRICTED");
    }

    return type;
}

// ==================================================
// FORM FIELD VALIDATION
// ==================================================

function validateFormDefinition(type) {
    if (
        !Array.isArray(type.fields) ||
        type.fields.length < 1 ||
        type.fields.length > SETTINGS.MAX_FIELDS
    ) {
        throw new Error("INVALID_FORM_CONFIGURATION");
    }

    const seenIds = new Set();

    for (const field of type.fields) {
        if (
            typeof field.id !== "string" ||
            field.id.length < 1 ||
            field.id.length > 100 ||
            seenIds.has(field.id)
        ) {
            throw new Error("INVALID_FORM_FIELD_ID");
        }

        seenIds.add(field.id);

        if (
            typeof field.label !== "string" ||
            field.label.length < 1 ||
            field.label.length > SETTINGS.MAX_FIELD_LABEL
        ) {
            throw new Error("INVALID_FORM_FIELD_LABEL");
        }

        if (
            !Number.isInteger(field.maxLength) ||
            field.maxLength < 1 ||
            field.maxLength > SETTINGS.MAX_FIELD_LENGTH
        ) {
            throw new Error("INVALID_FORM_FIELD_LENGTH");
        }
    }
}

// ==================================================
// BUILD FORM MODAL
// ==================================================

function buildTicketModal(typeKey) {
    const ticketType = getPublicTicketType(typeKey);

    validateFormDefinition(ticketType);

    const modal = new ModalBuilder()
        .setCustomId(
            `${SETTINGS.FORM_PREFIX}${ticketType.id}`
        )
        .setTitle(
            String(ticketType.label).slice(
                0,
                SETTINGS.MAX_MODAL_TITLE
            )
        );

    const rows = ticketType.fields.map(field => {
        const input = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(
                field.style === 2
                    ? TextInputStyle.Paragraph
                    : TextInputStyle.Short
            )
            .setRequired(Boolean(field.required))
            .setMaxLength(field.maxLength);

        if (
            typeof field.placeholder === "string" &&
            field.placeholder.length > 0
        ) {
            input.setPlaceholder(
                field.placeholder.slice(0, 100)
            );
        }

        if (field.required) {
            input.setMinLength(1);
        }

        return new ActionRowBuilder()
            .addComponents(input);
    });

    modal.addComponents(...rows);

    return modal;
}

// ==================================================
// LEGACY FORM BUTTONS
// ==================================================

// Old ticket panels may still use an extra
// "Open Form" button.
//
// New panels open modals directly from the
// category selection menu.
function buildFormPromptButtons(typeKey) {
    const ticketType = getPublicTicketType(typeKey);

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${SETTINGS.OPEN_PREFIX}${ticketType.id}`
            )
            .setLabel("Open Form")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(
                `${SETTINGS.HELP_PREFIX}${ticketType.id}`
            )
            .setLabel("How to Find Discord IDs")
            .setEmoji("🔎")
            .setStyle(ButtonStyle.Secondary)
    );
}

// ==================================================
// DISCORD DEVELOPER MODE HELP
// ==================================================

async function handleTicketHelp(interaction) {
    const customId = interaction.customId || "";

    if (!customId.startsWith(SETTINGS.HELP_PREFIX)) {
        return interaction.reply({
            content: "❌ Invalid help button.",
            flags: MessageFlags.Ephemeral
        });
    }

    const typeId = customId.slice(
        SETTINGS.HELP_PREFIX.length
    );

    let ticketType;

    try {
        ticketType = getPublicTicketType(typeId);
    } catch {
        return interaction.reply({
            content:
                "❌ This ticket category is unavailable. Please use the current support panel.",
            flags: MessageFlags.Ephemeral
        });
    }

    const instructions = [
        "🔎 **How to Find Discord IDs**",
        "",
        `**Ticket Category:** ${ticketType.label}`,
        "",
        "**Step 1 — Enable Developer Mode**",
        "1. Open Discord User Settings.",
        "2. Open Advanced.",
        "3. Enable Developer Mode.",
        "",
        "**Step 2 — Copy the ID you need**",
        "",
        "**👤 User ID**",
        "Open the user's profile or context menu and choose Copy User ID.",
        "",
        "**💬 Message ID**",
        "Right-click or long-press a message and choose Copy Message ID.",
        "",
        "**📁 Channel ID**",
        "Right-click or long-press a channel and choose Copy Channel ID.",
        "",
        "**Step 3 — Return to the form**",
        "Paste the ID into the appropriate field.",
        "",
        "💡 On some devices, these options appear under an additional menu."
    ];

    return interaction.reply({
        content: instructions.join("\n"),
        flags: MessageFlags.Ephemeral,
        allowedMentions: {
            parse: []
        }
    });
}

// ==================================================
// READ MODAL ANSWERS
// ==================================================

function getTicketFormAnswers(interaction) {
    const customId = interaction.customId || "";

    if (
        !interaction.isModalSubmit() ||
        !customId.startsWith(SETTINGS.FORM_PREFIX)
    ) {
        throw new Error("INVALID_FORM_SUBMISSION");
    }

    const typeId = customId.slice(
        SETTINGS.FORM_PREFIX.length
    );

    // Prevent submissions of old Giveaway
    // winner modals as well.
    const ticketType = getPublicTicketType(typeId);

    validateFormDefinition(ticketType);

    const answers = {};

    for (const field of ticketType.fields) {
        let value = "";

        try {
            value = interaction.fields
                .getTextInputValue(field.id) || "";
        } catch (error) {
            if (field.required) {
                throw new Error(
                    `MISSING_REQUIRED_FIELD:${field.id}`
                );
            }
        }

        value = value.trim();

        if (field.required && !value) {
            throw new Error(
                `MISSING_REQUIRED_FIELD:${field.id}`
            );
        }

        if (value.length > field.maxLength) {
            throw new Error(
                `FIELD_TOO_LONG:${field.id}`
            );
        }

        answers[field.id] = value;
    }

    return {
        type: ticketType.id,
        typeLabel: ticketType.label,
        emoji: ticketType.emoji,
        claimEnabled: Boolean(ticketType.claim),
        answers
    };
}

// ==================================================
// EXPORTS
// ==================================================

module.exports = {
    buildTicketModal,
    buildFormPromptButtons,
    handleTicketHelp,
    getTicketFormAnswers
};
