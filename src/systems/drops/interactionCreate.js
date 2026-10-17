
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
                const image = interaction.options.getAttachment("image");

                if (!interaction.channel?.isTextBased() || !interaction.channel.guild) {
                    return interaction.reply({
                        content: "❌ Drops can only be created in a server text channel.",
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                const result = await createDrop({
                    guild: interaction.guild,
                    channel: interaction.channel,
                    host: interaction.user,
                    prize,
                    image: image || null
                });

                return interaction.editReply({
                    content: `✅ Drop created successfully in ${interaction.channel}!`
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
                    const messages = {
                        INVALID_ID: "❌ Invalid drop ID.",
                        NOT_FOUND: "❌ This drop does not exist.",
                        ALREADY_CLAIMED: "❌ This drop has already been claimed.",
                        NOT_ACTIVE: "❌ This drop is not active."
                    };

                    return interaction.editReply({
                        content: messages[result.reason] || "❌ Could not end this drop."
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
