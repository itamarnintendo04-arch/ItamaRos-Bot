const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

async function createRejoinRequest(client, giveawayId, userId) {
    if (!ObjectId.isValid(giveawayId)) {
        return { success: false, reason: "INVALID_ID" };
    }

    const db = getDatabase();
    const giveaways = db.collection(GIVEAWAY_SETTINGS.COLLECTION);

    const giveaway = await giveaways.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
        removedParticipants: userId
    });

    if (!giveaway) {
        return { success: false, reason: "NOT_REMOVED" };
    }

    const requests = db.collection("giveawayRejoinRequests");

    const existingRequest = await requests.findOne({
        giveawayId,
        userId,
        status: "pending"
    });

    if (existingRequest) {
        return { success: false, reason: "REQUEST_PENDING" };
    }

    const request = {
        giveawayId,
        userId,
        guildId: giveaway.guildId,
        status: "pending",
        createdAt: new Date()
    };

    const result = await requests.insertOne(request);
    const requestId = result.insertedId.toString();

    const guild = await client.guilds.fetch(giveaway.guildId);
    const channel = await guild.channels.fetch(giveaway.channelId);

    if (!channel || !channel.isTextBased()) {
        await requests.updateOne(
            { _id: result.insertedId },
            { $set: { status: "failed" } }
        );

        return { success: false, reason: "CHANNEL_NOT_FOUND" };
    }

    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle("🔔 Giveaway Rejoin Request")
        .setDescription(
            [
                `**User:** <@${userId}>`,
                `**Prize:** ${giveaway.prize}`,
                "",
                "This user was previously removed from the giveaway.",
                "An administrator must approve or deny their request to rejoin."
            ].join("\n")
        )
        .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`giveaway_rejoin_approve:${requestId}`)
            .setLabel("APPROVE")
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId(`giveaway_rejoin_deny:${requestId}`)
            .setLabel("DENY")
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
        embeds: [embed],
        components: [buttons]
    });

    return { success: true };
}

async function handleRejoinApproval(interaction) {
    const [action, requestId] = interaction.customId.split(":");

    if (!interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    )) {
        return interaction.reply({
            content: "❌ Only administrators can review rejoin requests.",
            ephemeral: true
        });
    }

    if (!ObjectId.isValid(requestId)) {
        return interaction.reply({
            content: "❌ Invalid request.",
            ephemeral: true
        });
    }

    const db = getDatabase();
    const requests = db.collection("giveawayRejoinRequests");

    const request = await requests.findOne({
        _id: new ObjectId(requestId),
        status: "pending"
    });

    if (!request) {
        return interaction.reply({
            content: "❌ This request has already been handled or does not exist.",
            ephemeral: true
        });
    }

    if (action === "giveaway_rejoin_approve") {
        const result = await db.collection(
            GIVEAWAY_SETTINGS.COLLECTION
        ).updateOne(
            {
                _id: new ObjectId(request.giveawayId),
                status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
                removedParticipants: request.userId
            },
            {
                $addToSet: { participants: request.userId },
                $pull: { removedParticipants: request.userId }
            }
        );

        if (result.modifiedCount === 0) {
            await requests.updateOne(
                { _id: request._id, status: "pending" },
                { $set: { status: "failed", reviewedAt: new Date() } }
            );

            return interaction.reply({
                content: "❌ The giveaway is no longer active or the request is invalid.",
                ephemeral: true
            });
        }

        await requests.updateOne(
            { _id: request._id, status: "pending" },
            {
                $set: {
                    status: "approved",
                    reviewedBy: interaction.user.id,
                    reviewedAt: new Date()
                }
            }
        );

        await interaction.update({
            content: `✅ <@${request.userId}> was approved to rejoin the giveaway.`,
            embeds: [],
            components: []
        });

        return;
    }

    if (action === "giveaway_rejoin_deny") {
        await requests.updateOne(
            { _id: request._id, status: "pending" },
            {
                $set: {
                    status: "denied",
                    reviewedBy: interaction.user.id,
                    reviewedAt: new Date()
                }
            }
        );

        await interaction.update({
            content: `❌ <@${request.userId}>'s rejoin request was denied.`,
            embeds: [],
            components: []
        });
    }
}

module.exports = {
    createRejoinRequest,
    handleRejoinApproval
};
