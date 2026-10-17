
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { DROP_SETTINGS } = require("./config");

async function endDrop({ guild, dropId, endedBy }) {
    const db = getDatabase();
    const drops = db.collection(DROP_SETTINGS.COLLECTION);

    const drop = await drops.findOne({
        _id: dropId,
        guildId: guild.id,
        status: DROP_SETTINGS.STATUS.ACTIVE
    });

    if (!drop) {
        return {
            success: false,
            reason: "NOT_ACTIVE"
        };
    }

    const result = await drops.updateOne(
        {
            _id: dropId,
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
                    "This drop was manually ended.\n" +
                    "No winner was selected."
                )
                .setColor(0xEF4444)
                .setTimestamp();

            if (drop.imageUrl) {
                embed.setImage(drop.imageUrl);
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
                components: [disabledRow]
            }).catch(console.error);
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
