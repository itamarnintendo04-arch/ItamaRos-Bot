
const {
    SlashCommandBuilder,
    EmbedBuilder
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const data = new SlashCommandBuilder()
    .setName("active-giveaways")
    .setDescription("View all active giveaways in this server");

async function execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
        const collection = getDatabase().collection(
            GIVEAWAY_SETTINGS.COLLECTION
        );

        const giveaways = await collection
            .find({
                guildId: interaction.guildId,
                status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
            })
            .sort({ endsAt: 1 })
            .toArray();

        if (giveaways.length === 0) {
            return interaction.editReply({
                content: "🎉 There are currently no active giveaways in this server."
            });
        }

        const embeds = [];
        const displayedGiveaways = giveaways.slice(0, 10);

        for (const giveaway of displayedGiveaways) {
            const participantCount = Array.isArray(giveaway.participants)
                ? giveaway.participants.length
                : 0;

            const endTime = Math.floor(
                new Date(giveaway.endsAt).getTime() / 1000
            );

            const giveawayUrl =
                `https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${giveaway.messageId}`;

            const embed = new EmbedBuilder()
                .setColor(GIVEAWAY_SETTINGS.DEFAULT_COLOR)
                .setTitle(`🎁 ${giveaway.prize}`)
                .setDescription([
                    `**Hosted by:** <@${giveaway.hostId}>`,
                    `**Participants:** ${participantCount}`,
                    `**Ends:** <t:${endTime}:F>`,
                    `**Time remaining:** <t:${endTime}:R>`,
                    "",
                    `[Jump to Giveaway](${giveawayUrl})`
                ].join("\n"));

            if (giveaway.imageUrl) {
                embed.setThumbnail(giveaway.imageUrl);
            }

            embeds.push(embed);
        }

        const extraCount = giveaways.length - displayedGiveaways.length;

        return interaction.editReply({
            content: `🎉 **Active Giveaways: ${giveaways.length}**`,
            embeds,
            ...(extraCount > 0
                ? {
                    allowedMentions: { parse: [] }
                }
                : {})
        });
    } catch (error) {
        console.error("[ActiveGiveaways] Error:", error);

        return interaction.editReply({
            content: "❌ Could not load the active giveaways."
        });
    }
}

module.exports = {
    data,
    execute
};
