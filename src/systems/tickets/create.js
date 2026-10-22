
"use strict";

const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const { getDatabase } = require("../../../database");
const { TICKET_SETTINGS, TICKET_TYPES } = require("./config");

const SETTINGS = Object.freeze({
    COLOR: 0x5865F2,
    LOCK_MS: 10 * 60 * 1000,
    MAX_DESCRIPTION: 3900,
    MAX_OVERWRITES: 90
});

const USER_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
];

function getTickets() {
    return getDatabase().collection("tickets");
}

function getLocks() {
    return getDatabase().collection("ticket_creation_locks");
}

function failure(reason, extra = {}) {
    return {
        success: false,
        reason,
        ...extra
    };
}

function getTicketType(typeId) {
    return Object.values(TICKET_TYPES).find(
        type => type.id === typeId
    ) || null;
}

function createTicketName(username) {
    const safe = String(username || "user")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20);

    return `ticket-${safe || "user"}`;
}

function getTicketTopic(guildId, userId) {
    return `ItamaRos Support | guild=${guildId} | user=${userId}`;
}

function cleanText(value, maxLength = 900) {
    return String(value ?? "Not provided")
        .replace(/@/g, "@\u200b")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
        .slice(0, maxLength);
}

async function checkPermissions(guild) {
    const bot = await guild.members.fetchMe()
        .catch(() => null);

    if (!bot) {
        throw new Error(
            "MISSING_BOT_PERMISSIONS\nBot member unavailable."
        );
    }

    const required = [
        [PermissionFlagsBits.ManageChannels, "Manage Channels"],
        [PermissionFlagsBits.ManageRoles, "Manage Roles"],
        [PermissionFlagsBits.ViewChannel, "View Channel"],
        [PermissionFlagsBits.SendMessages, "Send Messages"],
        [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
        [PermissionFlagsBits.EmbedLinks, "Embed Links"]
    ];

    const missing = required
        .filter(([flag]) => !bot.permissions.has(flag))
        .map(([, name]) => name);

    if (missing.length) {
        throw new Error(
            [
                "MISSING_BOT_PERMISSIONS",
                "",
                ...missing
            ].join("\n")
        );
    }

    return bot;
}

async function getStaffRoles(guild) {
    await guild.roles.fetch();

    return guild.roles.cache.filter(role =>
        role.id !== guild.id &&
        (
            role.permissions.has(
                PermissionFlagsBits.ManageGuild
            ) ||
            role.permissions.has(
                PermissionFlagsBits.Administrator
            )
        )
    );
}

function buildOverwrites(guild, userId, botId, staffRoles) {
    const overwrites = [
        {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: userId,
            allow: USER_PERMISSIONS
        },
        {
            id: botId,
            allow: [
                ...USER_PERMISSIONS,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    for (const role of staffRoles.values()) {
        overwrites.push({
            id: role.id,
            allow: [
                ...USER_PERMISSIONS,
                PermissionFlagsBits.ManageMessages
            ]
        });
    }

    if (overwrites.length > SETTINGS.MAX_OVERWRITES) {
        throw new Error("TOO_MANY_STAFF_ROLES");
    }

    return overwrites;
}

// ================================================
// CLOSE BUTTON
// ================================================

function buildTicketControls() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(TICKET_SETTINGS.CLOSE_BUTTON)
                .setLabel("Close Ticket")
                .setEmoji("🔒")
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

// ================================================
// CREATION LOCK
// ================================================

async function acquireLock(guildId, userId) {
    const id = `${guildId}:${userId}`;
    const token = randomUUID();
    const now = new Date();

    try {
        const result = await getLocks().updateOne(
            {
                _id: id,
                $or: [
                    { status: { $ne: "creating" } },
                    { expiresAt: { $lte: now } }
                ]
            },
            {
                $set: {
                    status: "creating",
                    token,
                    expiresAt: new Date(
                        now.getTime() + SETTINGS.LOCK_MS
                    ),
                    updatedAt: now
                }
            },
            { upsert: true }
        );

        if (
            result.modifiedCount !== 1 &&
            result.upsertedCount !== 1
        ) {
            return null;
        }

        return { id, token };
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function releaseLock(lock) {
    if (!lock) return;

    await getLocks().updateOne(
        {
            _id: lock.id,
            token: lock.token
        },
        {
            $set: {
                status: "idle",
                updatedAt: new Date()
            },
            $unset: {
                token: "",
                expiresAt: ""
            }
        }
    );
}

// ================================================
// EXISTING TICKETS
// ================================================

async function findActiveTicket(guild, userId) {
    const active = await getTickets().find({
        guildId: guild.id,
        userId,
        status: "open",
        type: { $ne: TICKET_TYPES.GIVEAWAY.id }
    }).toArray();

    let count = 0;
    let firstChannel = null;

    for (const ticket of active) {
        const channel = await guild.channels.fetch(
            ticket.channelId
        ).catch(() => null);

        if (channel) {
            count++;

            if (!firstChannel) {
                firstChannel = channel;
            }
        } else {
            await getTickets().updateOne(
                {
                    _id: ticket._id,
                    status: "open"
                },
                {
                    $set: {
                        status: "deleted",
                        channelMissing: true,
                        updatedAt: new Date()
                    }
                }
            );
        }
    }

    return { count, channel: firstChannel };
}

async function findReusableChannel(guild, userId) {
    if (!TICKET_SETTINGS.REUSE_CHANNELS) {
        return null;
    }

    const previous = await getTickets().find({
        guildId: guild.id,
        userId,
        status: "closed",
        type: { $ne: TICKET_TYPES.GIVEAWAY.id }
    }).sort({
        updatedAt: -1
    }).limit(10).toArray();

    for (const ticket of previous) {
        const channel = await guild.channels.fetch(
            ticket.channelId
        ).catch(() => null);

        if (
            !channel ||
            channel.type !== ChannelType.GuildText
        ) {
            continue;
        }

        const occupied = await getTickets().findOne({
            guildId: guild.id,
            channelId: channel.id,
            status: "open"
        });

        if (!occupied) {
            return channel;
        }
    }

    return null;
}

async function findRecoverableChannel(guild, topic) {
    const channels = await guild.channels.fetch();

    for (const channel of channels.values()) {
        if (
            channel?.type !== ChannelType.GuildText ||
            channel.topic !== topic
        ) {
            continue;
        }

        const registered = await getTickets().findOne({
            guildId: guild.id,
            channelId: channel.id
        });

        if (!registered) {
            return channel;
        }
    }

    return null;
}

// ================================================
// WELCOME MESSAGE
// ================================================

function buildWelcomeEmbed(type, userId, answers, sessionId) {
    const lines = [
        `Welcome <@${userId}>!`,
        "",
        "Your private support ticket has been created.",
        "",
        "### 📋 Submitted Information",
        ""
    ];

    for (const [key, value] of Object.entries(answers)) {
        const line =
            `**${cleanText(key, 80)}:** ${cleanText(value)}`;

        if (
            [...lines, line].join("\n").length >
            SETTINGS.MAX_DESCRIPTION - 250
        ) {
            lines.push("*Additional information was shortened.*");
            break;
        }

        lines.push(line, "");
    }

    lines.push(
        "",
        "### 🛡️ Support Status",
        "**Awaiting Staff**",
        "",
        "A staff member will assist you shortly.",
        "",
        "🔒 Only authorized staff can close this ticket."
    );

    return new EmbedBuilder()
        .setColor(SETTINGS.COLOR)
        .setTitle(`${type.emoji} ${type.label}`)
        .setDescription(
            lines.join("\n").slice(0, SETTINGS.MAX_DESCRIPTION)
        )
        .setFooter({
            text: `ItamaRos Bot • Session ${sessionId}`
        })
        .setTimestamp();
}

// ================================================
// CREATE TICKET
// ================================================

async function createTicket(interaction, ticketData) {
    const { guild, user } = interaction;

    if (!guild?.id || !user?.id) {
        return failure("SERVER_ONLY");
    }

    const ticketType = getTicketType(ticketData?.type);

    if (!ticketType) {
        return failure("INVALID_TICKET_TYPE");
    }

    // Giveaway tickets are never created
    // through the public ticket form.
    if (ticketType.id === TICKET_TYPES.GIVEAWAY.id) {
        return failure("GIVEAWAY_RESTRICTED");
    }

    const answers = ticketData.answers;

    if (
        !answers ||
        typeof answers !== "object" ||
        Array.isArray(answers)
    ) {
        return failure("INVALID_TICKET_DATA");
    }

    const botMember = await checkPermissions(guild);

    const staffRoles = await getStaffRoles(guild);

    const overwrites = buildOverwrites(
        guild,
        user.id,
        botMember.id,
        staffRoles
    );

    const lock = await acquireLock(guild.id, user.id);

    if (!lock) {
        return failure("CREATION_IN_PROGRESS");
    }

    let channel = null;
    let createdChannel = false;
    let ticketSaved = false;
    let reused = false;

    try {
        const active = await findActiveTicket(
            guild,
            user.id
        );

        const maximum = Math.max(
            1,
            Number(TICKET_SETTINGS.MAX_ACTIVE_TICKETS) || 1
        );

        if (active.count >= maximum) {
            return failure("ACTIVE_TICKET", {
                channel: active.channel
            });
        }

        channel = await findReusableChannel(
            guild,
            user.id
        );

        if (channel) {
            reused = true;
        }

        if (!channel) {
            channel = await findRecoverableChannel(
                guild,
                getTicketTopic(guild.id, user.id)
            );
        }

        if (!channel) {
            channel = await guild.channels.create({
                name: createTicketName(user.username),
                type: ChannelType.GuildText,
                topic: getTicketTopic(guild.id, user.id),
                permissionOverwrites: overwrites,
                reason: `Support ticket for ${user.id}`
            });

            createdChannel = true;
        } else {
            await channel.permissionOverwrites.set(
                overwrites
            );
        }

        const now = new Date();
        const sessionId = `${Date.now()}-${user.id}`;

        const ticketRecord = {
            guildId: guild.id,
            channelId: channel.id,
            userId: user.id,
            username: user.username,

            type: ticketType.id,
            typeLabel: ticketType.label,
            claimEnabled: Boolean(ticketType.claim),

            answers,
            status: "open",
            sessionId,
            claimedBy: null,

            autoCreated: false,
            source: "public_panel",

            createdAt: now,
            updatedAt: now
        };

        await getTickets().insertOne(ticketRecord);

        ticketSaved = true;

        // Every regular ticket gets a Close Ticket button.
        // The close.js handler must enforce staff permissions.
        const welcomeEmbed = buildWelcomeEmbed(
            ticketType,
            user.id,
            answers,
            sessionId
        );

        let welcomeMessageSent = false;

        try {
            await channel.send({
                content: `<@${user.id}>`,
                embeds: [welcomeEmbed],
                components: buildTicketControls(),
                allowedMentions: {
                    parse: [],
                    users: [user.id]
                }
            });

            welcomeMessageSent = true;
        } catch (error) {
            console.error(
                "[Tickets] Welcome message failed:",
                error
            );
        }

        return {
            success: true,
            reused,
            channel,
            sessionId,
            welcomeMessageSent
        };
    } catch (error) {
        console.error("[Tickets] Creation failed:", error);

        if (!ticketSaved && createdChannel && channel) {
            await channel.delete(
                "Rolling back failed ticket creation"
            ).catch(() => {});
        }

        throw error;
    } finally {
        await releaseLock(lock).catch(error => {
            console.error(
                "[Tickets] Failed to release creation lock:",
                error
            );
        });
    }
}

module.exports = {
    createTicket
};
