
const { PermissionFlagsBits } = require("discord.js");

const { createDrop } = require("./create");
const { claimDrop } = require("./claim");
const { endDrop } = require("./end");

const { DROP_SETTINGS } = require("./config");

async function handleDropInteraction(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName !== "drop") return;

            if (!interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )) {
                return interaction.reply({
                    content: "❌ You need the Manage Server permission to use this command.",
                    ephemeral: true
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "start") {
                const prize = interaction.options.getString("prize");
                const channel = interaction.options.getChannel("channel");
                const image = interaction.options.getAttachment("image");

                await interaction.deferReply({ ephemeral: true });

                const result = await createDrop({
                    guild: interaction.guild,
                    channel,
                    host: interaction.user,
                    prize,
                    image: image || null
                });

                return interaction.editReply({
                    content: `✅ Drop created successfully in ${channel}!`
                });
            }

            if (subcommand === "end") {
                const dropId = interaction.options.getString("drop_id");

                await interaction.deferReply({ ephemeral: true });

                const result = await endDrop({
                    guild: interaction.guild,
                    dropId,
                    endedBy: interaction.user
                });

                if (!result.success) {
                    return interaction.editReply({
                        content: result.reason === "ALREADY_CLAIMED"
                            ? "❌ This drop has already been claimed."
                            : "❌ This drop is not active or does not exist."
                    });
                }

                return interaction.editReply({
                    content: "✅ The drop has been ended successfully."
                });
            }
        }

        if (interaction.isButton()) {
            const [buttonId, dropId] = interaction.customId.split(":");

            if (buttonId !== DROP_SETTINGS.CLAIM_BUTTON_ID) return;

            return claimDrop(interaction, dropId);
        }
    } catch (error) {
        console.error("[DROPS] Interaction error:", error);

        const message = "❌ Something went wrong while processing this drop.";

        if (interaction.deferred || interaction.replied) {
            return interaction.editReply({
                content: message
            }).catch(() => {});
        }

        return interaction.reply({
            content: message,
            ephemeral: true
        }).catch(() => {});
    }
}

module.exports = {
    handleDropInteraction
};
