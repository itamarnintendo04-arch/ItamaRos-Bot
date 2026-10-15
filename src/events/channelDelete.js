const { getDatabase } = require("../../database");
module.exports = {
    name: "channelDelete",
    async execute(channel) {
        try {
            const db = getDatabase();
            if (!db) {
                throw new Error("MongoDB is not connected.");
            }
            const tickets = db.collection("tickets");
            const result = await tickets.deleteMany({
                channelId: channel.id
            });
            if (result.deletedCount > 0) {
                console.log(
                    `[Tickets] Deleted ${result.deletedCount} database record(s) for channel ${channel.id}.`
                );
            }
        } catch (error) {
            console.error(
                "[Tickets] Failed to synchronize deleted channel:",
                error
            );
        }
    }
};
