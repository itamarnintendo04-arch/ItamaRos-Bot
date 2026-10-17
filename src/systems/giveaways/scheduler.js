
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");
const { endGiveaway } = require("./end");

let schedulerInterval = null;
let isChecking = false;

async function checkExpiredGiveaways(client) {
    if (isChecking) return;

    isChecking = true;

    try {
        const collection = getDatabase().collection(
            GIVEAWAY_SETTINGS.COLLECTION
        );

        const expiredGiveaways = await collection.find({
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
            endsAt: { $lte: new Date() }
        }).toArray();

        for (const giveaway of expiredGiveaways) {
            try {
                const result = await endGiveaway(
                    giveaway._id.toString()
                );

                if (!result.success) continue;

                const guild = await client.guilds.fetch(
                    giveaway.guildId
                ).catch(() => null);

                if (!guild) continue;

                const channel = await guild.channels.fetch(
                    giveaway.channelId
                ).catch(() => null);

                if (!channel) continue;

                const message = await channel.messages.fetch(
                    giveaway.messageId
                ).catch(() => null);

                if (!message) continue;

                const winnerText = result.winners.length
                    ? result.winners.map(id => `<@${id}>`).join(", ")
                    : "No participants entered this giveaway.";

                await message.reply({
                    content: [
                        "🎉 **GIVEAWAY ENDED!**",
                        "",
                        `**Prize:** ${giveaway.prize}`,
                        `**Winner(s):** ${winnerText}`
                    ].join("\n")
                });

            } catch (error) {
                console.error(
                    `[Giveaways] Failed to finish giveaway ${giveaway._id}:`,
                    error
                );
            }
        }
    } catch (error) {
        console.error("[Giveaways] Scheduler error:", error);
    } finally {
        isChecking = false;
    }
}

function startGiveawayScheduler(client) {
    if (schedulerInterval) return;

    checkExpiredGiveaways(client);

    schedulerInterval = setInterval(() => {
        checkExpiredGiveaways(client);
    }, 30 * 1000);

    console.log("[Giveaways] Scheduler started.");
}

function stopGiveawayScheduler() {
    if (!schedulerInterval) return;

    clearInterval(schedulerInterval);
    schedulerInterval = null;

    console.log("[Giveaways] Scheduler stopped.");
}

module.exports = {
    startGiveawayScheduler,
    stopGiveawayScheduler,
    checkExpiredGiveaways
};
