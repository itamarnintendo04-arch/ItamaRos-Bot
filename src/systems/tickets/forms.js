
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { TICKET_TYPES } = require("./config");

/**
 * Creates a ticket form modal.
 */
function buildTicketModal(typeKey) {
    const ticketType = TICKET_TYPES[typeKey];

    if (!ticketType) {
        throw new Error(`Unknown ticket type: ${typeKey}`);
    }

    const modal = new ModalBuilder()
        .setCustomId(`ticket_form_${ticketType.id}`)
        .setTitle(ticketType.label);

    const components = ticketType.fields.map((field) => {
        const input = new TextInputBuilder()
            .setCustomId(field.id)
            .setLabel(field.label)
            .setStyle(
                field.style === 2
                    ? TextInputStyle.Paragraph
                    : TextInputStyle.Short
            )
            .setRequired(field.required)
            .setMaxLength(field.maxLength);

        return new ActionRowBuilder().addComponents(input);
    });

    modal.addComponents(...components);

    return modal;
}

/**
 * Creates the buttons shown before opening the form.
 */
function buildFormPromptButtons(typeKey) {
    const ticketType = TICKET_TYPES[typeKey];

    if (!ticketType) {
        throw new Error(`Unknown ticket type: ${typeKey}`);
    }

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_form_open_${ticketType.id}`)
            .setLabel("Open Form")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`ticket_help_${ticketType.id}`)
            .setLabel("I don't find it")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("🔎")
    );
}

/**
 * Handles the Developer Mode help button.
 */
async function handleTicketHelp(interaction) {
    await interaction.reply({
        ephemeral: true,
        content: [
            "**How to find a Discord ID**",
            "",
            "**Step 1:** Open Discord User Settings.",
            "**Step 2:** Go to Advanced.",
            "**Step 3:** Enable Developer Mode.",
            "",
            "**To copy a Message ID:**",
            "1. Find the giveaway message.",
            "2. Right-click or long-press the message.",
            "3. Select Copy Message ID.",
            "",
            "**To copy a Channel ID:**",
            "1. Find the channel.",
            "2. Right-click or long-press it.",
            "3. Select Copy Channel ID.",
            "",
            "**To copy a User ID:**",
            "1. Open the user's profile.",
            "2. Open the profile options.",
            "3. Select Copy User ID.",
            "",
            "Return to the ticket form and paste the copied ID."
        ].join("\n")
    });
}

/**
 * Reads and validates submitted modal fields.
 */
function getTicketFormAnswers(interaction) {
    const typeId = interaction.customId.replace(
        "ticket_form_",
        ""
    );

    const ticketType = Object.values(TICKET_TYPES).find(
        (type) => type.id === typeId
    );

    if (!ticketType) {
        throw new Error(`Unknown ticket form: ${typeId}`);
    }

    const answers = {};

    for (const field of ticketType.fields) {
        answers[field.id] = interaction.fields
            .getTextInputValue(field.id)
            .trim();
    }

    return {
        type: ticketType.id,
        typeLabel: ticketType.label,
        emoji: ticketType.emoji,
        claimEnabled: ticketType.claim,
        answers
    };
}

module.exports = {
    buildTicketModal,
    buildFormPromptButtons,
    handleTicketHelp,
    getTicketFormAnswers
};
