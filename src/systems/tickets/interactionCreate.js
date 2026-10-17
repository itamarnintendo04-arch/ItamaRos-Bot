
const { MessageFlags } = require("discord.js");

const { TICKET_TYPES } = require("./config");

const {
    buildTicketModal,
    buildFormPromptButtons,
    handleTicketHelp,
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

async function handleTicketInteraction(interaction) {
    try {
        // SELECT MENU
        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === "ticket_type_select"
        ) {
            const selectedType = interaction.values[0];

            const type = Object.values(TICKET_TYPES).find(
                item => item.id === selectedType
            );

            if (!type) {
                return interaction.reply({
                    content: "❌ Invalid ticket type.",
                    flags: MessageFlags.Ephemeral
                });
            }

            const prompt = buildFormPromptButtons(type.id);

            return interaction.reply({
                content:
                    `You selected **${type.label}**.\n\n` +
                    "Click **Open Form** to continue, or use the help button if you need assistance.",
                components: [prompt],
                flags: MessageFlags.Ephemeral
            });
        }

        // OPEN FORM
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("ticket_form_open_")
        ) {
            const typeId = interaction.customId.replace(
                "ticket_form_open_",
                ""
            );

            const type = Object.values(TICKET_TYPES).find(
                item => item.id === typeId
            );

            if (!type) {
                return interaction.reply({
                    content: "❌ Invalid ticket type.",
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.showModal(
                buildTicketModal(typeId)
            );
        }

        // HELP BUTTON
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("ticket_help_")
        ) {
            return handleTicketHelp(interaction);
        }

        // FORM SUBMISSION
        if (
            interaction.isModalSubmit() &&
            interaction.customId.startsWith("ticket_form_")
        ) {
            const formData = getTicketFormAnswers(interaction);

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });

            const result = await createTicket(
                interaction,
                formData
            );

            return interaction.editReply({
                content: result.reused
                    ? "✅ Your previous ticket channel has been reopened."
                    : "✅ Your ticket has been created successfully."
            });
        }

        // CLOSE TICKET
        if (
            interaction.isButton() &&
            interaction.customId === "ticket_close"
        ) {
            return handleCloseButton(interaction);
        }

        if (
            interaction.isModalSubmit() &&
            interaction.customId === "ticket_close_modal"
        ) {
            return handleCloseModal(interaction);
        }

        // CLAIM TICKET
        if (
            interaction.isButton() &&
            interaction.customId === "ticket_claim"
        ) {
            return handleClaimButton(interaction);
        }

        // DELETE TICKET
        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete"
        ) {
            return handleDeleteButton(interaction);
        }

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete_confirm"
        ) {
            return handleDeleteConfirm(interaction);
        }

        if (
            interaction.isButton() &&
            interaction.customId === "ticket_delete_cancel"
        ) {
            return handleDeleteCancel(interaction);
        }

    } catch (error) {
        console.error("[Ticket interaction error]", error);

        const errorMessage =
            "❌ Something went wrong while processing your ticket.";

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error(
                "[Ticket error response failed]",
                replyError
            );
        }
    }
}

module.exports = {
    handleTicketInteraction
};
