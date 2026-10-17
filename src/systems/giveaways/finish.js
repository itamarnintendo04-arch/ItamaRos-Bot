const { announceGiveawayEnd } = require("./announce");
const { notifyGiveawayWinners } = require("./winners");
const { createGiveawayWinnerTicket } = require("./winnerTicket");

async function finishGiveaway(client, giveaway, winners) {
    console.log(`[Giveaways] Finishing giveaway ${giveaway._id}...`);

    let announcementSent = false;
    const ticketResults = [];

    try {
        announcementSent = await announceGiveawayEnd(
            client,
            giveaway,
            winners
        );
    } catch (error) {
        console.error("[Giveaways] Announcement error:", error);
    }

    for (const winnerId of winners) {
        try {
            const result = await createGiveawayWinnerTicket(
                client,
                giveaway._id.toString(),
                winnerId
            );

            ticketResults.push({
                userId: winnerId,
                ...result
            });
        } catch (error) {
            console.error(
                `[Giveaways] Could not create winner ticket for ${winnerId}:`,
                error
            );

            ticketResults.push({
                userId: winnerId,
                success: false,
                reason: "TICKET_CREATION_FAILED"
            });
        }
    }

    let notifications = [];

    if (winners.length > 0) {
        notifications = await notifyGiveawayWinners(
            client,
            giveaway,
            winners,
            ticketResults
        );
    }

    console.log(`[Giveaways] Giveaway ${giveaway._id} finished.`);

    return {
        success: announcementSent,
        announcementSent,
        ticketResults,
        notifications
    };
}

module.exports = { finishGiveaway };
