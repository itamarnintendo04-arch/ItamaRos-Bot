const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const { ObjectId } = require("mongodb");
const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");
const { TICKET_TYPES, TICKET_SETTINGS } = require("../tickets/config");

async function createGiveawayWinnerTicket(client, giveawayId, winnerId) {
    if (!ObjectId.isValid(giveawayId)) {
        return { success: false, reason: "INVALID_GIVEAWAY_ID" };
    }

    const db = getDatabase();

    const giveaway = await db.collection(
        GIVEAWAY_SETTINGS.COLLECTION
    ).findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ENDED,
        winners: winnerId
    });

    if (!giveaway) {
        return { success: false, reason: "NOT_A_WINNER" };
    }

    const tickets = db.collection("tickets");

    const existingTicket = await tickets.findOne({
        guildId: giveaway.guildId,
        userId: winnerId,
        type: TICKET_TYPES.GIVEAWAY.id,
        giveawayId,
        status: "open"
    });

    if (existingTicket) {
        return {
            success: true,
            alreadyExists: true,
            channelId: existingTicket.channelId
        };
    }

    const guild = await client.guilds.fetch(giveaway.guildId);
    const member = await guild.members.fetch(winnerId).catch(() => null);

    if (!member) {
        return { success: false, reason: "WINNER_NOT_IN_SERVER" };
    }

    const botMember = guild.members.me;

    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return { success: false, reason: "MISSING_BOT_PERMISSION" };
    }

    const ticketType = TICKET_TYPES.GIVEAWAY;

    const channel = await guild.channels.create({
        name: `ticket-${member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 20)}-giveaway`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: winnerId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks
                ]
            },
            {
                id: botMember.id,
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

    const answers = {
        channel: `<#${giveaway.channelId}>`,
        messageId: giveaway.messageId,
        details: `Giveaway prize: ${giveaway.prize}`
    };

    const sessionId = `${Date.now()}-${winnerId}`;

    try {
        await tickets.insertOne({
            guildId: guild.id,
            channelId: channel.id,
            userId: winnerId,
            username: member.user.username,
            type: ticketType.id,
            typeLabel: ticketType.label,
            claimEnabled: ticketType.claim,
            answers,
            giveawayId,
            status: "open",
            sessionId,
            claimedBy: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const embed = new EmbedBuilder()
            .setColor(0x22C55E)
            .setTitle(`${ticketType.emoji} ${ticketType.label}`)
            .setDescription(
                [
                    `Congratulations <@${winnerId}>!`,
                    "",
                    `You won **${giveaway.prize}**.`,
                    "",
                    "**Giveaway Information:**",
                    `**Channel:** <#${giveaway.channelId}>`,
                    `**Message ID:** ${giveaway.messageId}`,
                    "",
                    "Our management team will help you claim your prize."
                ].join("\n")
            )
            .setFooter({ text: `Ticket Session: ${sessionId}` })
            .setTimestamp();

        await channel.send({
            content: `<@${winnerId}>`,
            embeds: [embed]
        });

        console.log(`[Giveaways] Winner ticket created for ${winnerId}.`);

        return {
            success: true,
            channelId: channel.id
        };
    } catch (error) {
        await channel.delete().catch(() => {});
        throw error;
    }
}

module.exports = { createGiveawayWinnerTicket };
