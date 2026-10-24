
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { DROP_SETTINGS } = require("./config");
const { statusCard } = require("../media/statusCard");

async function endDrop({ guild, dropId, endedBy }) {
    if (!ObjectId.isValid(dropId)) {
        return {
            success: false,
            reason: "INVALID_ID"
        };
    }

    const db = getDatabase();
    const drops = db.collection(DROP_SETTINGS.COLLECTION);
    const objectId = new ObjectId(dropId);

    const drop = await drops.findOne({
        _id: objectId,
        guildId: guild.id
    });

    if (!drop) {
        return {
            success: false,
            reason: "NOT_FOUND"
        };
    }

    if (drop.status !== DROP_SETTINGS.STATUS.ACTIVE) {
        return {
            success: false,
            reason: drop.winnerId
                ? "ALREADY_CLAIMED"
                : "NOT_ACTIVE"
        };
    }

    const result = await drops.updateOne(
        {
            _id: objectId,
            guildId: guild.id,
            status: DROP_SETTINGS.STATUS.ACTIVE,
            winnerId: null
        },
        {
            $set: {
                status: DROP_SETTINGS.STATUS.ENDED,
                endedAt: new Date(),
                endedBy: endedBy.id
            }
        }
    );

    if (result.modifiedCount !== 1) {
        return {
            success: false,
            reason: "ALREADY_CLAIMED"
        };
    }

    const channel = await guild.channels
        .fetch(drop.channelId)
        .catch(() => null);

    if (channel && drop.messageId) {
        const message = await channel.messages
            .fetch(drop.messageId)
            .catch(() => null);

        if (message) {
            const embed = new EmbedBuilder()
                .setTitle("DROP ENDED")
                .setDescription(
                    `**Prize:** ${drop.prize}\n\n` +
                    "**This drop was manually ended.**\n" +
                    "No winner was selected."
                )
                .setColor(0xEF4444)
                .setTimestamp();

            if (drop.imageUrl) {
                embed.setImage(drop.imageUrl);
            }

            const files = [];
            try {
                const png = await statusCard({
                    kind: "drop",
                    status: "ended",
                    prize: drop.prize,
                    subtitle: "No winner selected"
                });
                embed.setImage("attachment://drop-ended.png");
                files.push(
                    new AttachmentBuilder(png, { name: "drop-ended.png" })
                );
            } catch (error) {
                console.warn(
                    "[Drops] End banner unavailable:",
                    error.message
                );
            }

            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(
                        `${DROP_SETTINGS.CLAIM_BUTTON_ID}:${dropId}`
                    )
                    .setLabel("Drop Ended")
                    .setEmoji("🎉")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true)
            );

            await message.edit({
                embeds: [embed],
                components: [disabledRow],
                ...(files.length ? { files, attachments: [] } : {})
            });
        }
    }

    return {
        success: true,
        drop
    };
}

module.exports = {
    endDrop
};
