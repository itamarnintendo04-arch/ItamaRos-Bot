
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { DROP_SETTINGS } = require("./config");

async function claimDrop(interaction, dropId) {
    const db = getDatabase();
    const drops = db.collection(DROP_SETTINGS.COLLECTION);

    // Atomically allow only the first user to claim the drop.
    const result = await drops.updateOne(
        {
            _id: dropId,
            guildId: interaction.guildId,
            status: DROP_SETTINGS.STATUS.ACTIVE,
            winnerId: null
        },
        {
            $set: {
                winnerId: interaction.user.id,
                winnerUsername: interaction.user.username,
                status: DROP_SETTINGS.STATUS.ENDED,
                endedAt: new Date()
            }
        }
    );

    if (result.modifiedCount !== 1) {
        const existingDrop = await drops.findOne({
            _id: dropId,
            guildId: interaction.guildId
        });

        if (!existingDrop) {
            return interaction.reply({
                content: "❌ This drop does not exist.",
                ephemeral: true
            });
        }

        if (existingDrop.winnerId) {
            return interaction.reply({
                content: `❌ This drop has already been claimed by <@${existingDrop.winnerId}>.`,
                ephemeral: true
            });
        }

        return interaction.reply({
            content: "❌ This drop is no longer active.",
            ephemeral: true
        });
    }

    const channel = await interaction.guild.channels
        .fetch(interaction.channelId)
        .catch(() => null);

    let message = null;

    if (channel && existingMessageId(dropId)) {
        // The message is fetched below using the saved message ID.
        message = await channel.messages
            .fetch(existingMessageId(dropId))
            .catch(() => null);
    }

    if (message) {
        const oldEmbed = message.embeds[0];

        const embed = oldEmbed
            ? EmbedBuilder.from(oldEmbed)
            : new EmbedBuilder().setTitle("DROP ENDED");

        embed
            .setTitle("🎉 DROP CLAIMED!")
            .setColor(0x22C55E)
            .addFields({
                name: "Winner",
                value: `<@${interaction.user.id}>`,
                inline: false
            })
            .setTimestamp();

        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${DROP_SETTINGS.CLAIM_BUTTON_ID}:${dropId}`)
                .setLabel("Claimed")
                .setStyle(ButtonStyle.Success)
                .setEmoji("🎉")
                .setDisabled(true)
        );

        await message.edit({
            embeds: [embed],
            components: [disabledRow]
        }).catch(console.error);
    }

    return interaction.reply({
        content: `🎉 Congratulations <@${interaction.user.id}>! You won **${(await drops.findOne({ _id: dropId }))?.prize || "the drop"}**!`,
        allowedMentions: {
            users: [interaction.user.id]
        }
    });
}

function existingMessageId() {
    return null;
}

module.exports = {
    claimDrop
};
