const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");
const { getDatabase } = require("../../../database");
const { buildTranscript } = require("./transcript");
const COLLECTION_NAME = "tickets";
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
    return db.collection(COLLECTION_NAME);
}
function buildDeleteConfirmation() {
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Delete Ticket")
        .setDescription(
            "Are you sure you want to permanently delete this ticket?\n\n" +
            "A transcript will be sent to you before deletion."
        )
        .setFooter({
            text: "This action cannot be undone."
        });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_delete_confirm")
            .setLabel("Confirm Delete")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("ticket_delete_cancel")
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
}
async function handleDeleteButton(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can delete tickets.",
            ephemeral: true
        });
    }
    const collection = getTicketCollection();
    const ticket = await collection.findOne({
        guildId: interaction.guildId,
        channelId: interaction.channelId
    });
    if (!ticket) {
        return interaction.reply({
            content: "❌ This channel is not registered as a ticket.",
            ephemeral: true
        });
    }
    return interaction.reply({
        ...buildDeleteConfirmation(),
        ephemeral: true
    });
}
async function handleDeleteCancel(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can cancel this action.",
            ephemeral: true
        });
    }
    return interaction.update({
        content: "✅ Ticket deletion cancelled.",
        embeds: [],
        components: []
    });
}
async function handleDeleteConfirm(interaction) {
    if (!isAdmin(interaction)) {
        return interaction.reply({
            content: "❌ Only administrators can delete tickets.",
            ephemeral: true
        });
    }
    await interaction.deferReply({ ephemeral: true });
    const collection = getTicketCollection();
    const channel = interaction.channel;
    const ticket = await collection.findOne(
        {
            guildId: interaction.guildId,
            channelId: channel.id
        },
        {
            sort: { createdAt: -1 }
        }
    );
    if (!ticket) {
        return interaction.editReply(
            "❌ This ticket could not be found in the database."
        );
    }
    let transcript;
    try {
        transcript = await buildTranscript(channel, ticket);
    } catch (error) {
        console.error("Ticket transcript error:", error);
        return interaction.editReply(
            "❌ Failed to create the ticket transcript. The ticket was not deleted."
        );
    }
    let transcriptSent = false;
    try {
        await interaction.user.send({
            content: `📄 Transcript for ticket **${channel.name}**`,
            files: [transcript]
        });
        transcriptSent = true;
    } catch (error) {
        console.error("Transcript DM failed:", error);
    }
    try {
        await interaction.editReply(
            transcriptSent
                ? "✅ Transcript sent. Deleting the ticket channel..."
                : "⚠️ I couldn't send the transcript to your DMs. The ticket will not be deleted."
        );
        if (!transcriptSent) {
            return;
        }
        await channel.delete("Ticket deleted by an administrator");
        await collection.deleteMany({
            guildId: interaction.guildId,
            channelId: channel.id
        });
    } catch (error) {
        console.error("Ticket deletion error:", error);
        try {
            await interaction.followUp({
                content: "❌ Something went wrong while deleting the ticket.",
                ephemeral: true
            });
        } catch {
            // The interaction may no longer be available.
        }
    }
}
module.exports = {
    handleDeleteButton,
    handleDeleteConfirm,
    handleDeleteCancel,
    buildDeleteConfirmation
};
