
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

            return interaction.showModal(
                buildTicketModal(type.id)
            );
        }

        // OLD HELP BUTTON
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("ticket_help_")
        ) {
            const { handleTicketHelp } = require("./forms");
            return handleTicketHelp(interaction);
        }

        // OLD OPEN FORM BUTTON
        if (
            interaction.isButton() &&
            interaction.customId.startsWith("ticket_form_open_")
        ) {
            const typeId = interaction.customId.replace(
                "ticket_form_open_",
                ""
            );

            return interaction.showModal(
                buildTicketModal(typeId)
            );
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

            // USER ALREADY HAS AN ACTIVE TICKET
            if (
                !result.success &&
                result.reason === "ACTIVE_TICKET"
            ) {
                return interaction.editReply({
                    content: [
                        "❌ You already have an active ticket!",
                        "",
                        `Open your existing ticket here: ${result.channel}`,
                        "",
                        "Please close your current ticket before opening another one."
                    ].join("\n")
                });
            }

            if (!result.success) {
                return interaction.editReply({
                    content: "❌ Could not create your ticket. Please try again."
                });
            }

            return interaction.editReply({
                content: result.reused
                    ? `✅ Your previous ticket channel has been reopened: ${result.channel}`
                    : `✅ Your ticket has been created successfully: ${result.channel}`
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

        let errorMessage =
            "❌ Something went wrong while processing your ticket.";

        if (error.message?.startsWith("MISSING_BOT_PERMISSIONS")) {
            errorMessage = [
                "❌ **ItamaRos Bot is missing permissions!**",
                "",
                "Go to:",
                "**Server Settings → Roles → ItamaRos Bot**",
                "",
                "Enable the following permissions:",
                "",
                error.message.split("\n").slice(2).join("\n")
            ].join("\n");
        }

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: errorMessage
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
