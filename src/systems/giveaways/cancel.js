const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function cancelGiveaway(giveawayId) {
    if (!ObjectId.isValid(giveawayId)) {
        return {
            success: false,
            reason: "INVALID_ID"
        };
    }

    const collection = getDatabase().collection(
        GIVEAWAY_SETTINGS.COLLECTION
    );

    const giveaway = await collection.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
    });

    if (!giveaway) {
        return {
            success: false,
            reason: "NOT_FOUND"
        };
    }

    const result = await collection.updateOne(
        {
            _id: giveaway._id,
            status: GIVEAWAY_SETTINGS.STATUS.ACTIVE
        },
        {
            $set: {
                status: GIVEAWAY_SETTINGS.STATUS.CANCELLED,
                cancelledAt: new Date()
            }
        }
    );

    if (result.modifiedCount === 0) {
        return {
            success: false,
            reason: "NOT_FOUND"
        };
    }

    return {
        success: true,
        giveaway
    };
}

async function disableCancelledGiveaway(client, giveaway) {
    try {
        const guild = await client.guilds.fetch(giveaway.guildId);
        const channel = await guild.channels.fetch(giveaway.channelId);

        if (!channel || !channel.isTextBased()) return false;

        const message = await channel.messages.fetch(giveaway.messageId);

        const disabledButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:${giveaway._id}`)
                .setLabel("CANCELLED")
                .setEmoji("🎉")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),

            new ButtonBuilder()
                .setCustomId(`${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:${giveaway._id}`)
                .setLabel("CLOSED")
                .setEmoji("❌")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        await message.edit({
            content: "🚫 **This giveaway has been cancelled.**",
            components: [disabledButtons]
        });

        return true;
    } catch (error) {
        console.error("[Giveaways] Could not update cancelled giveaway:", error);
        return false;
    }
}

module.exports = {
    cancelGiveaway,
    disableCancelledGiveaway
};
