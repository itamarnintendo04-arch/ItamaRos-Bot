
const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    PermissionFlagsBits
} = require("discord.js");

const { getDatabase } = require("../../../database");
const { buildTranscript } = require("./transcript");

function getTickets() {
    return getDatabase().collection("tickets");
}

function isAdmin(member) {
    return member.permissions.has(
        PermissionFlagsBits.Administrator
    );
}

function buildCloseButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_close")
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );
}

function buildCloseModal() {
    const modal = new ModalBuilder()
        .setCustomId("ticket_close_modal")
        .setTitle("Close Ticket");

    const messageInput = new TextInputBuilder()
        .setCustomId("closure_message")
        .setLabel("Message to the ticket owner")
        .setPlaceholder("Write your message here...")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

    modal.addComponents(
        new ActionRowBuilder().addComponents(messageInput)
    );

    return modal;
}

async function handleCloseButton(interaction) {
    if (!isAdmin(interaction.member)) {
        return interaction.reply({
            content: "❌ Only administrators can close tickets.",
            ephemeral: true
        });
    }

    const ticket = await getTickets().findOne({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        status: "open"
    });

    if (!ticket) {
        return interaction.reply({
            content: "❌ This channel does not have an active ticket.",
            ephemeral: true
        });
    }

    await interaction.showModal(buildCloseModal());
}

async function handleCloseModal(interaction) {
    if (!isAdmin(interaction.member)) {
        return interaction.reply({
            content: "❌ Only administrators can close tickets.",
            ephemeral: true
        });
    }

    await interaction.deferReply({
        ephemeral: true
    });

    const collection = getTickets();

    const ticket = await collection.findOne({
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
        status: "open"
    });

    if (!ticket) {
        return interaction.editReply({
            content: "❌ This ticket is already closed or does not exist."
        });
    }

    const closureMessage = interaction.fields
        .getTextInputValue("closure_message")
        .trim();

    if (!closureMessage) {
        return interaction.editReply({
            content: "❌ A closure message is required."
        });
    }

    // Generate transcript before closing.
    const transcript = await buildTranscript(
        interaction.channel,
        ticket
    );

    // Update database safely.
    const updateResult = await collection.updateOne(
        {
            _id: ticket._id,
            status: "open"
        },
        {
            $set: {
                status: "closed",
                closedAt: new Date(),
                closedBy: interaction.user.id,
                closureMessage,
                updatedAt: new Date()
            }
        }
    );

    if (updateResult.modifiedCount !== 1) {
        return interaction.editReply({
            content: "❌ This ticket has already been closed."
        });
    }

    // Send closure message to ticket owner.
    let dmSent = false;

    try {
        const owner = await interaction.client.users.fetch(
            ticket.userId
        );

        const dmEmbed = new EmbedBuilder()
            .setColor("#ED4245")
            .setTitle("🔒 Your Ticket Has Been Closed")
            .setDescription([
                "Your ticket has been closed by our management team.",
                "",
                "**Management Message:**",
                closureMessage,
                "",
                "Thank you for contacting our support team!"
            ].join("\n"))
            .setTimestamp();

        await owner.send({
            embeds: [dmEmbed]
        });

        dmSent = true;

    } catch (error) {
        console.error(
            "[Ticket Closure DM Error]",
            error
        );
    }

    // Send transcript to closing administrator.
    let transcriptSent = false;

    if (transcript) {
        try {
            await interaction.user.send({
                content: [
                    "📄 **Ticket Transcript**",
                    "",
                    `**Ticket Owner:** <@${ticket.userId}>`,
                    `**Ticket Type:** ${ticket.typeLabel}`,
                    `**Channel:** ${ticket.channelId}`
                ].join("\n"),
                files: [transcript]
            });

            transcriptSent = true;

        } catch (error) {
            console.error(
                "[Ticket Transcript Delivery Error]",
                error
            );
        }
    }

    // Disable the owner's ability to send messages.
    try {
        await interaction.channel.permissionOverwrites.edit(
            ticket.userId,
            {
                SendMessages: false
            }
        );
    } catch (error) {
        console.error(
            "[Ticket Permission Error]",
            error
        );
    }

    // Publish closure information in the ticket channel.
    const closedEmbed = new EmbedBuilder()
        .setColor("#ED4245")
        .setTitle("🔒 Ticket Closed")
        .setDescription([
            `**Closed by:** ${interaction.user}`,
            `**Ticket owner:** <@${ticket.userId}>`,
            "",
            "**Management Message:**",
            closureMessage,
            "",
            "This channel is now inactive.",
            "Your previous messages will remain available.",
            "This channel can be reused when you open another ticket."
        ].join("\n"))
        .setTimestamp();

    await interaction.channel.send({
        embeds: [closedEmbed]
    });

    const results = [
        "✅ Ticket closed successfully.",
        "",
        `📩 Owner DM: ${dmSent ? "Sent" : "Could not be delivered"}`,
        `📄 Transcript: ${transcriptSent ? "Sent" : "Could not be delivered"}`
    ].join("\n");

    await interaction.editReply({
        content: results
    });
}

module.exports = {
    buildCloseButton,
    buildCloseModal,
    handleCloseButton,
    handleCloseModal
};
