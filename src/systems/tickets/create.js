
const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const { TICKET_SETTINGS, TICKET_TYPES } = require("./config");
const { getDatabase } = require("../../../database");

function getTicketCollection() {
    return getDatabase().collection("tickets");
}

function createTicketName(username, type) {
    const safeUsername = username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 20);

    return `ticket-${safeUsername || "user"}`;
}

async function createTicket(interaction, ticketData) {
    const { guild, user } = interaction;
    const collection = getTicketCollection();

    const ticketType = Object.values(TICKET_TYPES).find(
        type => type.id === ticketData.type
    );

    if (!ticketType) {
        throw new Error("Invalid ticket type.");
    }

    const activeTicket = await collection.findOne({
        guildId: guild.id,
        userId: user.id,
        status: "open"
    });

    if (activeTicket) {
        const existingChannel = await guild.channels.fetch(
            activeTicket.channelId
        ).catch(() => null);

        if (existingChannel) {
            return {
                success: false,
                reason: "ACTIVE_TICKET",
                channel: existingChannel
            };
        }

        await collection.updateOne(
            { _id: activeTicket._id },
            { $set: { status: "deleted" } }
        );
    }

    let previousTicket = await collection.findOne(
        {
            guildId: guild.id,
            userId: user.id,
            status: "closed"
        },
        {
            sort: { updatedAt: -1 }
        }
    );

    let channel = null;

    if (
        TICKET_SETTINGS.REUSE_CHANNELS &&
        previousTicket
    ) {
        channel = await guild.channels.fetch(
            previousTicket.channelId
        ).catch(() => null);
    }

    if (!channel) {
        channel = await guild.channels.create({
            name: createTicketName(user.username, ticketData.type),
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                },
                {
                    id: guild.members.me.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels,
                        PermissionFlagsBits.ManageMessages
                    ]
                }
            ]
        });
    } else {
        await channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true
        });
    }

    const sessionId = `${Date.now()}-${user.id}`;

    const ticketRecord = {
        guildId: guild.id,
        channelId: channel.id,
        userId: user.id,
        username: user.username,
        type: ticketData.type,
        typeLabel: ticketData.typeLabel,
        claimEnabled: ticketType.claim,
        answers: ticketData.answers,
        status: "open",
        sessionId,
        claimedBy: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };

    await collection.insertOne(ticketRecord);

    const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle(`${ticketType.emoji} ${ticketType.label}`)
        .setDescription(
            [
                `Hello <@${user.id}>!`,
                "",
                "Your ticket has been created successfully.",
                "",
                "**Submitted Information:**",
                ...Object.entries(ticketData.answers).map(
                    ([key, value]) => `**${key}:** ${value || "Not provided"}`
                ),
                "",
                "Our management team will assist you shortly."
            ].join("\n")
        )
        .setFooter({
            text: `Ticket Session: ${sessionId}`
        })
        .setTimestamp();

    await channel.send({
        content: `<@${user.id}>`,
        embeds: [embed]
    });

    return {
        success: true,
        channel,
        sessionId
    };
}

module.exports = {
    createTicket
};
