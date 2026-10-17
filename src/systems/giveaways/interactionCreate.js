const { PermissionFlagsBits } = require("discord.js");

const { createGiveaway } = require("./create");
const { forceEndGiveaway } = require("./end");
const { finishGiveaway } = require("./finish");

const {
    cancelGiveaway,
    disableCancelledGiveaway
} = require("./cancel");

const { handleGiveawayButtons } = require("./buttons");

function parseDuration(value) {
    const match = /^(\d+)(M|H|D|W)$/i.exec(value.trim());

    if (!match) {
        throw new Error("Invalid duration. Use formats like 1M, 1H, 1D or 1W.");
    }

    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();

    const multipliers = {
        M: 1,
        H: 60,
        D: 1440,
        W: 10080
    };

    const minutes = amount * multipliers[unit];

    if (!Number.isSafeInteger(minutes) || minutes < 1) {
        throw new Error("Duration must be at least 1 minute.");
    }

    return minutes;
}

async function handleGiveawayInteraction(interaction) {
    try {
        if (interaction.isButton()) {
            if (
                interaction.customId.startsWith("giveaway_join:") ||
                interaction.customId.startsWith("giveaway_leave:")
            ) {
                await handleGiveawayButtons(interaction);
            }

            return;
        }

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
            const durationInput = interaction.options.getString("duration");
            const winners = interaction.options.getInteger("winners");
            const channel = interaction.options.getChannel("channel");
            const attachment = interaction.options.getAttachment("image");

            const duration = parseDuration(durationInput);

            if (
                attachment &&
                (!attachment.contentType ||
                    !attachment.contentType.startsWith("image/"))
            ) {
                return interaction.editReply({
                    content: "❌ The attachment must be an image."
                });
            }

            const result = await createGiveaway({
                guild: interaction.guild,
                channel,
                host: interaction.user,
                prize,
                duration,
                winners,
                image: attachment
            });

            if (!result?.success) {
                return interaction.editReply({
                    content: `❌ Could not create giveaway: ${result?.reason || "Unknown error."}`
                });
            }

            return interaction.editReply({
                content: `✅ Giveaway created successfully in ${channel}.\n[Jump to Giveaway](${result.message.url})`
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

        const message =
            `❌ ${error.message || "Something went wrong while processing this giveaway."}`;

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
