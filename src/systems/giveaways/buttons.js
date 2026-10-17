
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const {
    joinGiveaway,
    leaveGiveaway
} = require("./participants");

async function handleGiveawayButtons(interaction) {
    if (!interaction.isButton()) return false;

    const [action, giveawayId] = interaction.customId.split(":");

    if (
        action !== GIVEAWAY_SETTINGS.JOIN_BUTTON_ID &&
        action !== GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID
    ) {
        return false;
    }

    if (!ObjectId.isValid(giveawayId)) {
        await interaction.reply({
            content: "This giveaway could not be found.",
            ephemeral: true
        });
        return true;
    }

    await interaction.deferReply({
        ephemeral: true
    });

    let result;

    if (action === GIVEAWAY_SETTINGS.JOIN_BUTTON_ID) {
        result = await joinGiveaway(
            giveawayId,
            interaction.user.id
        );
    } else {
        result = await leaveGiveaway(
            giveawayId,
            interaction.user.id
        );
    }

    const messages = {
        INVALID_GIVEAWAY: "Invalid giveaway.",
        NOT_FOUND: "This giveaway could not be found.",
        ENDED: "This giveaway has already ended.",
        ALREADY_JOINED: "You are already in this giveaway!",
        NOT_PARTICIPATING:
            "You must enter the giveaway before you can leave it."
    };

    if (!result.success) {
        await interaction.editReply({
            content: messages[result.reason] || "Something went wrong."
        });

        return true;
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId)
    });

    if (!giveaway) {
        await interaction.editReply({
            content: "This giveaway could not be found."
        });
        return true;
    }

    const channel = await interaction.guild.channels.fetch(
        giveaway.channelId
    ).catch(() => null);

    const message = channel
        ? await channel.messages.fetch(
            giveaway.messageId
        ).catch(() => null)
        : null;

    if (message && message.embeds[0]) {
        const oldEmbed = message.embeds[0];

        const embed = EmbedBuilder.from(oldEmbed)
            .setDescription(
                oldEmbed.description.replace(
                    /\*\*Participants:\*\* \d+/,
                    `**Participants:** ${result.participants}`
                )
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
                )
                .setLabel(`ENTER ${result.participants}`)
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
                .setCustomId(
                    `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveawayId}`
                )
                .setLabel("LEAVE")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Danger)
        );

        await message.edit({
            embeds: [embed],
            components: [row]
        });
    }

    await interaction.editReply({
        content: action === GIVEAWAY_SETTINGS.JOIN_BUTTON_ID
            ? "🎉 You successfully entered the giveaway!"
            : "❌ You have left the giveaway."
    });

    return true;
}

module.exports = {
    handleGiveawayButtons
};
