const { PermissionFlagsBits } = require("discord.js");

const { createGiveaway } = require("./create");
const { forceEndGiveaway } = require("./end");
const { finishGiveaway } = require("./finish");
const {
    cancelGiveaway,
    disableCancelledGiveaway
} = require("./cancel");
const { handleGiveawayButtons } = require("./buttons");

async function handleGiveawayInteraction(interaction) {
    try {
        // Handle giveaway buttons
        if (interaction.isButton()) {
            if (
                interaction.customId.startsWith("giveaway_join:") ||
                interaction.customId.startsWith("giveaway_leave:")
            ) {
                await handleGiveawayButtons(interaction);
            }

            return;
        }

        // Handle giveaway slash commands
        if (
            !interaction.isChatInputCommand() ||
            interaction.commandName !== "giveaway"
        ) {
            return;
        }

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return interaction.reply({
                content: "❌ You need Administrator permissions to manage giveaways.",
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "start") {
            await interaction.deferReply({ ephemeral: true });

            const prize = interaction.options.getString("prize");
            const duration = interaction.options.getString("duration");
            const winners = interaction.options.getInteger("winners");
            const channel = interaction.options.getChannel("channel");

            const result = await createGiveaway({
                guild: interaction.guild,
                channel,
                host: interaction.user,
                prize,
                duration,
                winners
            });

            if (result?.success === false) {
                return interaction.editReply({
                    content: `❌ Could not create giveaway: ${result.reason || "Unknown error."}`
                });
            }

            return interaction.editReply({
                content: `✅ Giveaway created successfully in ${channel}.`
            });
        }

        if (subcommand === "end") {
            await interaction.deferReply({ ephemeral: true });

            const giveawayId = interaction.options.getString("giveaway_id");

            const result = await forceEndGiveaway(giveawayId);

            if (!result.success) {
                return interaction.editReply({
                    content: "❌ Giveaway not found or it has already ended."
                });
            }

            await finishGiveaway(
                interaction.client,
                result.giveaway,
                result.winners
            );

            return interaction.editReply({
                content: "✅ Giveaway ended successfully."
            });
        }

        if (subcommand === "cancel") {
            await interaction.deferReply({ ephemeral: true });

            const giveawayId = interaction.options.getString("giveaway_id");
            const result = await cancelGiveaway(giveawayId);

            if (!result.success) {
                return interaction.editReply({
                    content: "❌ Giveaway not found or it has already ended."
                });
            }

            await disableCancelledGiveaway(
                interaction.client,
                result.giveaway
            );

            return interaction.editReply({
                content: "✅ Giveaway cancelled successfully."
            });
        }
    } catch (error) {
        console.error("[Giveaways] Interaction error:", error);

        const message = "❌ Something went wrong while processing this giveaway.";

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: message }).catch(() => {});
        } else {
            await interaction.reply({
                content: message,
                ephemeral: true
            }).catch(() => {});
        }
    }
}

module.exports = { handleGiveawayInteraction };
