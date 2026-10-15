const { handleTicketInteraction } = require("../systems/tickets/interactionCreate");
module.exports = {
    name: "interactionCreate",
    async execute(interaction) {
        try {
            // Ticket interactions
            await handleTicketInteraction(interaction);
        } catch (error) {
            console.error("[InteractionCreate] Error:", error);
            const errorMessage =
                "❌ An unexpected error occurred.";
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: errorMessage,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error(
                    "[InteractionCreate] Failed to send error:",
                    replyError
                );
            }
        }
    }
};
