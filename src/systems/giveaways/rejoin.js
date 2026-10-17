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

async function createRejoinRequest(client, giveaway, userId) {
    const db = getDatabase();
    const collection = db.collection(GIVEAWAY_SETTINGS.COLLECTION);

    const giveawayId = giveaway._id.toString();

    const currentGiveaway = await collection.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
        removedParticipants: userId
    });

    if (!currentGiveaway) {
        return { success: false, reason: "NOT_REMOVED" };
    }

    const existingRequest = await db.collection("giveaway_rejoin_requests").findOne({
        giveawayId,
        userId,
        status: "pending"
    });

    if (existingRequest) {
        return { success: false, reason: "REQUEST_ALREADY_PENDING" };
    }

    const request = {
        giveawayId,
        guildId: giveaway.guildId,
        channelId: giveaway.channelId,
        userId,
        status: "pending",
        createdAt: new Date()
    };

    const result = await db.collection("giveaway_rejoin_requests").insertOne(request);
    const requestId = result.insertedId.toString();

    const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);

    if (!channel) {
        await db.collection("giveaway_rejoin_requests").updateOne(
            { _id: result.insertedId },
            { $set: { status: "failed", updatedAt: new Date() } }
        );

        return { success: false, reason: "CHANNEL_NOT_FOUND" };
    }

    const embed = new EmbedBuilder()
        .setColor(0xF59E0B)
        .setTitle("🔔 Giveaway Rejoin Request")
        .setDescription(
            `<@${userId}> wants to rejoin this giveaway.\n\n` +
            `**Giveaway:** ${giveaway.prize}\n` +
            `**User:** <@${userId}>`
        )
        .setFooter({ text: "Only server administrators can approve this request." })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`giveaway_rejoin_approve:${requestId}`)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`giveaway_rejoin_deny:${requestId}`)
            .setLabel("Deny")
            .setStyle(ButtonStyle.Danger)
    );

    try {
        await channel.send({
            embeds: [embed],
            components: [row]
        });
    } catch (error) {
        await db.collection("giveaway_rejoin_requests").updateOne(
            { _id: result.insertedId },
            { $set: { status: "failed", updatedAt: new Date() } }
        );

        throw error;
    }

    return { success: true, requestId };
}

async function handleRejoinApproval(interaction) {
    const isAdmin = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild
    );

    if (!isAdmin) {
        await interaction.reply({
            content: "You don't have permission to manage giveaway requests.",
            ephemeral: true
        });
        return;
    }

    const [action, requestId] = interaction.customId.split(":");

    if (!ObjectId.isValid(requestId)) {
        await interaction.reply({
            content: "Invalid request.",
            ephemeral: true
        });
        return;
    }

    const db = getDatabase();
    const requests = db.collection("giveaway_rejoin_requests");
    const requestObjectId = new ObjectId(requestId);

    const request = await requests.findOne({
        _id: requestObjectId,
        status: "pending"
    });

    if (!request) {
        await interaction.reply({
            content: "This request has already been handled or does not exist.",
            ephemeral: true
        });
        return;
    }

    const newStatus = action === "giveaway_rejoin_approve"
        ? "approved"
        : "denied";

    const updateResult = await requests.updateOne(
        {
            _id: requestObjectId,
            status: "pending"
        },
        {
            $set: {
                status: newStatus,
                handledBy: interaction.user.id,
                handledAt: new Date()
            }
        }
    );

    if (updateResult.modifiedCount !== 1) {
        await interaction.reply({
            content: "Another administrator already handled this request.",
            ephemeral: true
        });
        return;
    }

    if (newStatus === "approved") {
        const giveawayCollection = db.collection(GIVEAWAY_SETTINGS.COLLECTION);

        const updateGiveaway = await giveawayCollection.updateOne(
            {
                _id: new ObjectId(request.giveawayId),
                status: GIVEAWAY_SETTINGS.STATUS.ACTIVE,
                removedParticipants: request.userId
            },
            {
                $pull: { removedParticipants: request.userId },
                $addToSet: { participants: request.userId }
            }
        );

        if (updateGiveaway.modifiedCount !== 1) {
            await interaction.reply({
                content: "The giveaway has ended or the user is no longer eligible to rejoin.",
                ephemeral: true
            });
            return;
        }
    }

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(newStatus === "approved" ? 0x22C55E : 0xEF4444)
        .setTitle(
            newStatus === "approved"
                ? "✅ Rejoin Request Approved"
                : "❌ Rejoin Request Denied"
        )
        .addFields({
            name: "Handled By",
            value: `<@${interaction.user.id}>`
        });

    await interaction.update({
        embeds: [updatedEmbed],
        components: []
    });

    const user = await interaction.client.users.fetch(request.userId).catch(() => null);

    if (user) {
        await user.send(
            newStatus === "approved"
                ? "Your request to rejoin the giveaway was approved!"
                : "Your request to rejoin the giveaway was denied."
        ).catch(() => {});
    }
}

module.exports = {
    createRejoinRequest,
    handleRejoinApproval
};
