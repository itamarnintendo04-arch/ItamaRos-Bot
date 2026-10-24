
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { DROP_SETTINGS } = require("./config");
const { statusCard } = require("../media/statusCard");

async function createDrop({
    guild,
    channel,
    host,
    prize,
    image = null
}) {
    if (!guild || !channel || !host) {
        throw new Error("Missing drop information.");
    }

    if (!prize || prize.length > 200) {
        throw new Error("Invalid drop prize.");
    }

    if (!channel.isTextBased() || !channel.guild) {
        throw new Error("Invalid drop channel.");
    }

    if (
        image &&
        (!image.contentType || !image.contentType.startsWith("image/"))
    ) {
        throw new Error("The drop attachment must be an image.");
    }

    const collection = getDatabase().collection(
        DROP_SETTINGS.COLLECTION
    );

    const drop = {
        guildId: guild.id,
        channelId: channel.id,
        messageId: null,
        hostId: host.id,
        hostUsername: host.username,
        prize,
        imageUrl: image?.url || null,
        winnerId: null,
        winnerUsername: null,
        status: DROP_SETTINGS.STATUS.ACTIVE,
        createdAt: new Date(),
        endedAt: null
    };

    const result = await collection.insertOne(drop);
    const dropId = result.insertedId.toString();

    const embed = new EmbedBuilder()
        .setColor(DROP_SETTINGS.DEFAULT_COLOR)
        .setTitle("🎉 DROP!")
        .setDescription([
            `## ${prize}`,
            "",
            `**Hosted by:** <@${host.id}>`,
            "",
            "⚡ **FIRST CLICK WINS!**",
            "Click the button below to claim this prize.",
            "",
            "Good luck!"
        ].join("\n"))
        .setFooter({
            text: "ItamaRos Drops"
        })
        .setTimestamp();

    if (image?.url) {
        embed.setImage(image.url);
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${DROP_SETTINGS.CLAIM_BUTTON_ID}:${dropId}`)
            .setLabel("CLAIM PRIZE")
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Success)
    );

    try {
        const files = [];
        if (!image?.url) {
            const banner = await statusCard({
                kind: "drop",
                status: "active",
                prize,
                subtitle: "First to click CLAIM wins!"
            });
            embed.setImage("attachment://drop.png");
            files.push(
                new AttachmentBuilder(banner, { name: "drop.png" })
            );
        }

        const message = await channel.send({
            embeds: [embed],
            components: [row],
            files,
            allowedMentions: { parse: [] }
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
            dropId,
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
    createDrop
};
