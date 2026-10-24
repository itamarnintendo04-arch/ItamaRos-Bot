
const {
    PermissionFlagsBits,
    MessageFlags
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");

const { GIVEAWAY_SETTINGS } = require("./config");
const { createGiveaway } = require("./create");
const { forceEndGiveaway } = require("./end");
const { finishGiveaway } = require("./finish");

const {
    cancelGiveaway,
    disableCancelledGiveaway
} = require("./cancel");

const { handleGiveawayButtons } = require("./buttons");
const { handleRejoinApproval } = require("./rejoin");

function parseDuration(value) {
    if (typeof value !== "string") return null;

    const match = value.trim().match(/^(\d+)\s*([mhdw])$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        return null;
    }

    const multipliers = {
        m: 1,
        h: 60,
        d: 1440,
        w: 10080
    };

    const minutes = amount * multipliers[match[2].toLowerCase()];

    if (
        !Number.isSafeInteger(minutes) ||
        minutes < GIVEAWAY_SETTINGS.MIN_DURATION_MINUTES
    ) {
        return null;
    }

    return minutes;
}

async function handleGiveawayInteraction(interaction) {
    try {
        if (interaction.isButton()) {
            const customId = interaction.customId;

            if (
                customId.startsWith(`${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:`) ||
                customId.startsWith(`${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:`)
            ) {
                return await handleGiveawayButtons(interaction);
            }

            if (
                customId.startsWith("giveaway_rejoin_") ||
                customId.startsWith("rejoin_")
            ) {
                return await handleRejoinApproval(interaction);
            }

            return false;
        }

        if (!interaction.isChatInputCommand()) {
            return false;
        }

        if (interaction.commandName !== "giveaway") {
            return false;
        }

        if (!interaction.inGuild()) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )
        ) {
            await interaction.reply({
                content: "You need the Manage Server permission to manage giveaways.",
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        const subcommand = interaction.options.getSubcommand();

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        if (subcommand === "start") {
            const prize = interaction.options.getString("prize", true);
            const durationValue = interaction.options.getString("duration", true);
            const winners = interaction.options.getInteger("winners", true);
            const minLevel = interaction.options.getInteger("min_level") ?? 0;
            const image = interaction.options.getAttachment("image");

            const duration = parseDuration(durationValue);

            if (duration === null) {
                await interaction.editReply({
                    content: "Invalid duration. Use a format such as 30m, 2h, 1d or 1w."
                });
                return true;
            }

            if (
                winners < 1 ||
                winners > GIVEAWAY_SETTINGS.MAX_WINNERS
            ) {
                await interaction.editReply({
                    content: `The number of winners must be between 1 and ${GIVEAWAY_SETTINGS.MAX_WINNERS}.`
                });
                return true;
            }

            if (
                image &&
                !image.contentType?.startsWith("image/")
            ) {
                await interaction.editReply({
                    content: "Please upload a valid image attachment."
                });
                return true;
            }

            if (!interaction.channel?.isTextBased()) {
                await interaction.editReply({
                    content: "Giveaways can only be created in text channels."
                });
                return true;
            }

            const result = await createGiveaway({
                guild: interaction.guild,
                channel: interaction.channel,
                host: interaction.user,
                prize,
                duration,
                winners,
                minLevel,
                image
            });

            if (!result || result.success === false) {
                await interaction.editReply({
                    content: "Could not create the giveaway. Please check the bot permissions."
                });
                return true;
            }

            // This response is ephemeral (manager only).
            // Never publish the database ID to participants.
            await interaction.editReply({
                content: [
                    "🎉 **Giveaway created successfully!**",
                    "",
                    `🎁 **Prize:** ${prize}`,
                    `🏆 **Winners:** ${winners}`,
                    `⭐ **Minimum level:** ${minLevel > 0 ? `Level ${minLevel}+` : "Everyone"}`,
                    "",
                    `🆔 **Giveaway ID:** \`${result.giveawayId}\``,
                    `🔗 **Giveaway message:** ${result.url}`,
                    "",
                    "Save the ID to use /giveaway end,",
                    "/giveaway cancel or /giveaway-admin."
                ].join("\n"),
                allowedMentions: { parse: [] }
            });

            return true;
        }

        if (subcommand === "end" || subcommand === "cancel") {
            const giveawayId = interaction.options.getString(
                "giveaway_id",
                true
            );

            if (!ObjectId.isValid(giveawayId)) {
                await interaction.editReply({
                    content: "Invalid giveaway ID."
                });
                return true;
            }

            const collection = getDatabase().collection(
                GIVEAWAY_SETTINGS.COLLECTION
            );

            const existing = await collection.findOne({
                _id: new ObjectId(giveawayId),
                guildId: interaction.guildId
            });

            if (!existing) {
                await interaction.editReply({
                    content: "This giveaway was not found in this server."
                });
                return true;
            }

            if (existing.status !== GIVEAWAY_SETTINGS.STATUS.ACTIVE) {
                await interaction.editReply({
                    content: "This giveaway is no longer active."
                });
                return true;
            }

            if (subcommand === "end") {
                const result = await forceEndGiveaway(giveawayId);

                if (!result.success) {
                    await interaction.editReply({
                        content: "The giveaway could not be ended. It may already have finished."
                    });
                    return true;
                }

                const finishResult = await finishGiveaway(
                    interaction.client,
                    result.giveaway,
                    result.winners
                );

                await interaction.editReply({
                    content: finishResult.announcementSent
                        ? "🎉 The giveaway has ended and the winner announcement was sent."
                        : "The giveaway has ended, but the public announcement could not be completed. Check the bot logs."
                });

                return true;
            }

            const result = await cancelGiveaway(giveawayId);

            if (!result.success) {
                await interaction.editReply({
                    content: "The giveaway could not be cancelled. It may already have finished."
                });
                return true;
            }

            const messageUpdated = await disableCancelledGiveaway(
                interaction.client,
                result.giveaway
            );

            await interaction.editReply({
                content: messageUpdated
                    ? "🚫 Giveaway cancelled successfully."
                    : "The giveaway was cancelled, but the original message could not be updated."
            });

            return true;
        }

        await interaction.editReply({
            content: "Unknown giveaway subcommand."
        });

        return true;
    } catch (error) {
        console.error("[Giveaways] Interaction error:", error);

        const content = "❌ An unexpected error occurred while processing the giveaway.";

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content });
            } else {
                await interaction.reply({
                    content,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error(
                "[Giveaways] Failed to respond to interaction:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    handleGiveawayInteraction
};
