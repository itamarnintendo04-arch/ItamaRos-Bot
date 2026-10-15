const {
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");
const { getDatabase } = require("../../../database");
const { TICKET_TYPES } = require("./config");
function isAdmin(interaction) {
    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    ) ?? false;
}
function getTicketCollection() {
    const db = getDatabase();
    if (!db) {
        throw new Error("MongoDB is not connected.");
    }
    return db.collection("tickets");
}
async function handleClaimButton(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can claim tickets.",
            ephemeral: true
        });
    }
    const collection = getTicketCollection();
    const ticket = await collection.findOne({
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        status: "open"
    });
    if (!ticket) {
        return interaction.reply({
            content: "❌ This ticket is not open.",
            ephemeral: true
        });
    }
    const ticketType = Object.values(TICKET_TYPES).find(
        type => type.id === ticket.type
    );
    if (!ticketType?.claim) {
        return interaction.reply({
            content: "❌ Claiming is disabled for this ticket type.",
            ephemeral: true
        });
    }
    if (ticket.claimedBy === interaction.user.id) {
        const result = await collection.updateOne(
            {
                _id: ticket._id,
                status: "open",
                claimedBy: interaction.user.id
            },
            {
                $unset: { claimedBy: "" },
                $set: { updatedAt: new Date() }
            }
        );
        if (!result.modifiedCount) {
            return interaction.reply({
                content: "❌ The ticket claim could not be released.",
                ephemeral: true
            });
        }
        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle("Ticket Claim Released")
            .setDescription(
                `${interaction.user} released responsibility for this ticket.`
            );
        await interaction.channel.send({ embeds: [embed] });
        return interaction.reply({
            content: "✅ You released this ticket.",
            ephemeral: true
        });
    }
    if (ticket.claimedBy) {
        return interaction.reply({
            content: "❌ This ticket has already been claimed by another administrator.",
            ephemeral: true
        });
    }
    const result = await collection.updateOne(
        {
            _id: ticket._id,
            status: "open",
            $or: [
                { claimedBy: { $exists: false } },
                { claimedBy: null }
            ]
        },
        {
            $set: {
                claimedBy: interaction.user.id,
                claimedAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
    if (!result.modifiedCount) {
        return interaction.reply({
            content: "❌ Someone else claimed this ticket first.",
            ephemeral: true
        });
    }
    const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("Ticket Claimed")
        .setDescription(
            `This ticket is now being handled by ${interaction.user}.`
        );
    await interaction.channel.send({ embeds: [embed] });
    return interaction.reply({
        content: "✅ You successfully claimed this ticket.",
        ephemeral: true
    });
}
module.exports = {
    handleClaimButton
};
