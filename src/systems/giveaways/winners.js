const { EmbedBuilder } = require("discord.js");

async function notifyGiveawayWinners(client, giveaway, winners, ticketResults = []) {
    const notifications = [];

    for (const winnerId of winners) {
        try {
            const user = await client.users.fetch(winnerId);

            const ticketResult = ticketResults.find(
                result => result.userId === winnerId
            );

            let ticketMessage;

            if (ticketResult?.success && ticketResult.channelId) {
                const ticketLink =
                    `https://discord.com/channels/${giveaway.guildId}/${ticketResult.channelId}`;

                ticketMessage =
                    `Your private winner ticket is ready!\n` +
                    `Open it here: <#${ticketResult.channelId}>\n` +
                    `[Open Ticket](${ticketLink})`;
            } else if (ticketResult?.reason === "ACTIVE_TICKET") {
                ticketMessage =
                    "You already have an active ticket in the server. " +
                    "Please close it or contact the staff team to claim your prize.";
            } else {
                ticketMessage =
                    "We couldn't automatically create your winner ticket. " +
                    "Please contact the server staff for assistance.";
            }

            const embed = new EmbedBuilder()
                .setColor(0x22C55E)
                .setTitle("🎉 Congratulations! You Won!")
                .setDescription(
                    `You won **${giveaway.prize}**!\n\n` +
                    `Please claim your prize using the instructions below.`
                )
                .addFields({
                    name: "🎫 Winner Ticket",
                    value: ticketMessage
                })
                .setFooter({ text: "ItamaRos Bot" })
                .setTimestamp();

            await user.send({ embeds: [embed] });

            notifications.push({
                userId: winnerId,
                dmSent: true
            });
        } catch (error) {
            console.error(
                `[Giveaways] Could not DM winner ${winnerId}:`,
                error
            );

            notifications.push({
                userId: winnerId,
                dmSent: false
            });
        }
    }

    return notifications;
}

module.exports = { notifyGiveawayWinners };
