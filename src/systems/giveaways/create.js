
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function createGiveaway({
    guild,
    channel,
    host,
    prize,
    duration,
    winners
}) {
    if (!guild || !channel || !host) {
        throw new Error("Missing giveaway information.");
    }

    if (!prize || prize.length > 100) {
        throw new Error("Invalid giveaway prize.");
    }

    if (
        !Number.isInteger(duration) ||
        duration < GIVEAWAY_SETTINGS.MIN_DURATION_MINUTES
    ) {
        throw new Error("Invalid giveaway duration.");
    }

    if (
        !Number.isInteger(winners) ||
        winners < 1 ||
        winners > GIVEAWAY_SETTINGS.MAX_WINNERS
    ) {
        throw new Error("Invalid winner count.");
    }

    if (!channel.isTextBased() || !channel.guild) {
        throw new Error("Invalid giveaway channel.");
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const endsAt = new Date(
        Date.now() + duration * 60 * 1000
    );

    const giveaway = {
        guildId: guild.id,
        channelId: channel.id,
        messageId: null,
        hostId: host.id,
        hostUsername: host.username,
        prize,
        winnerCount: winners,
        participants: [],
        winners: [],
        endsAt,
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
        createdAt: new Date()
    };

    const result = await collection.insertOne(giveaway);
    const giveawayId = result.insertedId.toString();

    const embed = new EmbedBuilder()
        .setColor(GIVEAWAY_SETTINGS.DEFAULT_COLOR)
        .setTitle("🎉 GIVEAWAY")
        .setDescription([
            `## ${prize}`,
            "",
            `**Hosted by:** <@${host.id}>`,
            `**Winners:** ${winners}`,
            `**Participants:** 0`,
            "",
            `**Ends:** <t:${Math.floor(endsAt.getTime() / 1000)}:F>`,
            `**Time remaining:** <t:${Math.floor(endsAt.getTime() / 1000)}:R>`,
            "",
            "Click 🎉 to enter or ❌ to leave!"
        ].join("\n"))
        .setFooter({
            text: "Good luck to everyone!"
        })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(
                `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveawayId}`
            )
            .setLabel("0")
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

    try {
        const message = await channel.send({
            embeds: [embed],
            components: [row]
        });

        await collection.updateOne(
            { _id: result.insertedId },
            {
                $set: {
                    messageId: message.id
                }
            }
        );

        return {
            success: true,
            giveawayId,
            message
        };
    } catch (error) {
        await collection.deleteOne({
            _id: result.insertedId
        });

        throw error;
    }
}

module.exports = {
    createGiveaway
};
