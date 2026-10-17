const { announceGiveawayEnd } = require("./announce");
const { notifyGiveawayWinners } = require("./winners");

async function finishGiveaway(client, giveaway, winners) {
    console.log(`[Giveaways] Finishing giveaway ${giveaway._id}...`);

    let announcementSent = false;
    let notifications = [];

    try {
        announcementSent = await announceGiveawayEnd(
            client,
            giveaway,
            winners
        );
    } catch (error) {
        console.error("[Giveaways] Announcement error:", error);
    }

    if (winners.length > 0) {
        notifications = await notifyGiveawayWinners(
            client,
            giveaway,
            winners
        );
    }

    console.log(`[Giveaways] Giveaway ${giveaway._id} finished.`);

    return {
        success: announcementSent,
        announcementSent,
        notifications
    };
}

module.exports = { finishGiveaway };
