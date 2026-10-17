
const { PermissionFlagsBits } = require("discord.js");

const { createGiveaway } = require("./create");
const { endGiveaway } = require("./finish");
const { cancelGiveaway } = require("./cancel");
const { handleGiveawayButton } = require("./buttons");

function parseDuration(value) {
    const match = /^(\d+)(M|H|D|W)$/i.exec(value);

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();

    if (!Number.isSafeInteger(amount) || amount < 1) return null;

    const multipliers = {
        M: 1,
        H: 60,
        D: 1440,
        W: 10080
    };

    const minutes = amount * multipliers[unit];

    return Number.isSafeInteger(minutes) ? minutes : null;
}

async function handleGiveawayInteraction(interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName !== "giveaway") return;

            if (!interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )) {
                return interaction.reply({
                    content: "❌ You need the Manage Server permission.",
                    ephemeral: true
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "start") {
                const prize = interaction.options.getString("prize");
                const durationInput = interaction.options.getString("duration");
                const winners = interaction.options.getInteger("winners");
                const image = interaction.options.getAttachment("image");

                const duration = parseDuration(durationInput);

                if (!duration) {
                    return interaction.reply({
                        content: "❌ Invalid duration. Use 1M, 1H, 1D or 1W.",
                        ephemeral: true
                    });
                }

                if (
                    image &&
                    (!image.contentType ||
                    !image.contentType.startsWith("image/"))
                ) {
                    return interaction.reply({
                        content: "❌ The attachment must be an image.",
                        ephemeral: true
                    });
                }

                if (!interaction.channel?.isTextBased()) {
                    return interaction.reply({
                        content: "❌ Giveaways can only be created in a text channel.",
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                await createGiveaway({
                    guild: interaction.guild,
                    channel: interaction.channel,
                    host: interaction.user,
                    prize,
                    duration,
                    winners,
                    image
                });

                return interaction.editReply({
                    content: `✅ Giveaway created successfully in ${interaction.channel}!`
                });
            }

            if (subcommand === "end") {
                const giveawayId = interaction.options.getString("giveaway_id");

                await interaction.deferReply({ ephemeral: true });

                await endGiveaway(interaction.client, giveawayId);

                return interaction.editReply({
                    content: "✅ Giveaway ended successfully."
                });
            }

            if (subcommand === "cancel") {
                const giveawayId = interaction.options.getString("giveaway_id");

                await interaction.deferReply({ ephemeral: true });

                await cancelGiveaway(interaction.client, giveawayId);

                return interaction.editReply({
                    content: "✅ Giveaway cancelled successfully."
                });
            }
        }

        if (interaction.isButton()) {
            return handleGiveawayButton(interaction);
        }
    } catch (error) {
        console.error("[GIVEAWAYS] Interaction error:", error);

        const message = "❌ Something went wrong while processing the giveaway.";

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
    handleGiveawayInteraction
};
