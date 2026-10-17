
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

function createTicketName(username) {
    const safeUsername = username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 20);

    return `ticket-${safeUsername || "user"}`;
}

function getMissingPermissions(guild) {
    const botMember = guild.members.me;

    if (!botMember) {
        return ["View Server"];
    }

    const requiredPermissions = [
        {
            flag: PermissionFlagsBits.ManageChannels,
            name: "Manage Channels"
        },
        {
            flag: PermissionFlagsBits.ManageRoles,
            name: "Manage Roles"
        },
        {
            flag: PermissionFlagsBits.ViewChannel,
            name: "View Channels"
        },
        {
            flag: PermissionFlagsBits.SendMessages,
            name: "Send Messages"
        },
        {
            flag: PermissionFlagsBits.ReadMessageHistory,
            name: "Read Message History"
        }
    ];

    return requiredPermissions
        .filter(permission =>
            !botMember.permissions.has(permission.flag)
        )
        .map(permission => permission.name);
}

function permissionError(missing) {
    return new Error(
        [
            "MISSING_BOT_PERMISSIONS",
            "",
            "Please open:",
            "Server Settings → Roles → ItamaRos Bot",
            "",
            "Enable the following permissions:",
            ...missing.map(permission => `• ${permission}`)
        ].join("\n")
    );
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

    // Check whether the user already has an active ticket.
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

        // The channel no longer exists, so close the stale record.
        await collection.updateOne(
            { _id: activeTicket._id },
            {
                $set: {
                    status: "deleted",
                    updatedAt: new Date()
                }
            }
        );
    }

    // Check bot permissions before creating or modifying channels.
    const missingPermissions = getMissingPermissions(guild);

    if (missingPermissions.length > 0) {
        throw permissionError(missingPermissions);
    }

    const previousTicket = await collection.findOne(
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
    let reused = false;

    if (
        TICKET_SETTINGS.REUSE_CHANNELS &&
        previousTicket
    ) {
        channel = await guild.channels.fetch(
            previousTicket.channelId
        ).catch(() => null);

        if (channel) {
            reused = true;
        }
    }

    if (!channel) {
        channel = await guild.channels.create({
            name: createTicketName(user.username),
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [
                        PermissionFlagsBits.ViewChannel
                    ]
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

    try {
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
                        ([key, value]) =>
                            `**${key}:** ${value || "Not provided"}`
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
            reused,
            channel,
            sessionId
        };
    } catch (error) {
        // Do not leave an empty channel if ticket creation failed.
        if (!reused && channel) {
            await channel.delete(
                "Ticket creation failed"
            ).catch(() => {});
        }

        throw error;
    }
}

module.exports = {
    createTicket
};
