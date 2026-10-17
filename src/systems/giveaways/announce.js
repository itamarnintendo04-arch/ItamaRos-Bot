const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function announceGiveawayEnd(client, giveaway, winners) {
    const db = getDatabase();

    const guild = await client.guilds.fetch(giveaway.guildId).catch(() => null);

    if (!guild) {
        console.error("[Giveaways] Could not find giveaway guild.");
        return false;
    }

    const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);

    if (!channel || !channel.isTextBased()) {
        console.error("[Giveaways] Could not find giveaway channel.");
        return false;
    }

    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);

    if (!message) {
        console.error("[Giveaways] Could not find original giveaway message.");
        return false;
    }

    const winnerText = winners.length
        ? winners.map(id => `<@${id}>`).join(", ")
        : "No participants entered this giveaway.";

    const embed = new EmbedBuilder()
        .setColor(0x6B7280)
        .setTitle("🎉 GIVEAWAY ENDED")
        .setDescription(
            [
                `**Prize:** ${giveaway.prize}`,
                "",
                `**Hosted by:** <@${giveaway.hostId}>`,
                `**Winner(s):** ${winnerText}`,
                "",
                `**Total Entries:** ${giveaway.participants.length}`
            ].join("\n")
        )
        .setTimestamp();

    const disabledButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveaway._id}`)
            .setLabel("GIVEAWAY ENDED")
            .setEmoji("🎉")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true),

        new ButtonBuilder()
            .setCustomId(`${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveaway._id}`)
            .setLabel("CLOSED")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );

    await message.edit({
        embeds: [embed],
        components: [disabledButtons]
    });

    if (winners.length) {
        await channel.send({
            content: `🎉 Congratulations ${winnerText}! You won **${giveaway.prize}**!`
        });
    } else {
        await channel.send({
            content: `The giveaway for **${giveaway.prize}** has ended without any entries.`
        });
    }

    await db.collection(GIVEAWAY_SETTINGS.COLLECTION).updateOne(
        { _id: giveaway._id },
        { $set: { announcementSentAt: new Date() } }
    );

    console.log(`[Giveaways] End announcement sent for ${giveaway._id}.`);

    return true;
}

module.exports = { announceGiveawayEnd };
