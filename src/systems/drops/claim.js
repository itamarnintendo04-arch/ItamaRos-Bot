
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

    const drop = await drops.findOne({
        _id: dropId,
        guildId: interaction.guildId
    });

    if (!drop) {
        return interaction.reply({
            content: "❌ This drop does not exist.",
            ephemeral: true
        });
    }

    if (drop.status !== DROP_SETTINGS.STATUS.ACTIVE) {
        return interaction.reply({
            content: "❌ This drop is no longer active.",
            ephemeral: true
        });
    }

    // Only one user can win, even if multiple people click simultaneously.
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
        return interaction.reply({
            content: "❌ Someone else has already claimed this drop!",
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle("🎉 DROP CLAIMED!")
        .setDescription(
            `**Prize:** ${drop.prize}\n\n` +
            `**Winner:** <@${interaction.user.id}>\n\n` +
            `Congratulations!`
        )
        .setColor(0x22C55E)
        .setTimestamp();

    if (drop.imageUrl) {
        embed.setImage(drop.imageUrl);
    }

    const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${DROP_SETTINGS.CLAIM_BUTTON_ID}:${dropId}`)
            .setLabel("Claimed")
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
    );

    await interaction.update({
        embeds: [embed],
        components: [disabledRow]
    });

    return true;
}

module.exports = {
    claimDrop
};
