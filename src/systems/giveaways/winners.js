const { EmbedBuilder } = require("discord.js");

async function notifyGiveawayWinners(client, giveaway, winners) {
    const results = [];

    for (const winnerId of winners) {
        try {
            const user = await client.users.fetch(winnerId);

            const embed = new EmbedBuilder()
                .setColor(0x22C55E)
                .setTitle("🎉 YOU WON A GIVEAWAY!")
                .setDescription(
                    [
                        `Congratulations! You won **${giveaway.prize}**!`,
                        "",
                        `**Hosted by:** <@${giveaway.hostId}>`,
                        "",
                        "Please open a **Giveaway Winner** ticket in the server to claim your prize.",
                        "Our staff will help you with the next steps."
                    ].join("\n")
                )
                .setFooter({ text: "ItamaRos Bot • Giveaway System" })
                .setTimestamp();

            await user.send({ embeds: [embed] });

            results.push({
                userId: winnerId,
                dmSent: true
            });

            console.log(`[Giveaways] Winner DM sent to ${winnerId}.`);
        } catch (error) {
            console.error(
                `[Giveaways] Could not DM winner ${winnerId}:`,
                error.message
            );

            results.push({
                userId: winnerId,
                dmSent: false
            });
        }
    }

    return results;
}

module.exports = { notifyGiveawayWinners };
