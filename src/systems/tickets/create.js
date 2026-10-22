
"use strict";

const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const { randomUUID } = require("node:crypto");
const { getDatabase } = require("../../../database");
const { TICKET_SETTINGS, TICKET_TYPES } = require("./config");

// ================================================
// ITAMAROS BOT • TICKET CREATION ENGINE 2.0
// ================================================

const SETTINGS = Object.freeze({
    COLOR: 0x5865F2,
    LOCK_MS: 10 * 60 * 1000,
    MAX_DESCRIPTION: 3900,
    MAX_ROLE_OVERWRITES: 90
});

const PUBLIC_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
];

function tickets() {
    return getDatabase().collection("tickets");
}

function locks() {
    return getDatabase().collection("ticket_creation_locks");
}

function failure(reason, extra = {}) {
    return { success: false, reason, ...extra };
}

function getTicketType(typeId) {
    return Object.values(TICKET_TYPES).find(
        type => type.id === typeId
    ) || null;
}

function isRestrictedType(typeId) {
    return typeId === TICKET_TYPES.GIVEAWAY.id;
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
            "MISSING_BOT_PERMISSIONS\n\nCannot access the bot member."
        );
    }

    const required = [
        [PermissionFlagsBits.ManageChannels, "Manage Channels"],
        [PermissionFlagsBits.ManageRoles, "Manage Roles"],
        [PermissionFlagsBits.ViewChannel, "View Channels"],
        [PermissionFlagsBits.SendMessages, "Send Messages"],
        [PermissionFlagsBits.ReadMessageHistory, "Read Message History"],
        [PermissionFlagsBits.EmbedLinks, "Embed Links"]
    ];

    const missing = required
        .filter(([flag]) => !bot.permissions.has(flag))
        .map(([, name]) => name);

    if (missing.length) {
        throw new Error([
            "MISSING_BOT_PERMISSIONS",
            "",
            "Enable these permissions:",
            ...missing.map(name => `• ${name}`)
        ].join("\n"));
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
            allow: PUBLIC_PERMISSIONS
        },
        {
            id: botId,
            allow: [
                ...PUBLIC_PERMISSIONS,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    for (const role of staffRoles.values()) {
        overwrites.push({
            id: role.id,
            allow: [
                ...PUBLIC_PERMISSIONS,
                PermissionFlagsBits.ManageMessages
            ]
        });
    }

    if (overwrites.length > SETTINGS.MAX_ROLE_OVERWRITES) {
        throw new Error("TOO_MANY_STAFF_ROLES");
    }

    return overwrites;
}

// ================================================
// ATOMIC CREATION RESERVATION
// ================================================

async function acquireLock(guildId, userId) {
    const id = `${guildId}:${userId}`;
    const token = randomUUID();
    const now = new Date();

    try {
        const result = await locks().updateOne(
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

    await locks().updateOne(
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
// EXISTING TICKET CHECK
// ================================================

async function findActiveTicket(guild, userId) {
    const active = await tickets()
        .find({
            guildId: guild.id,
            userId,
            status: "open"
        })
        .toArray();

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

            continue;
        }

        await tickets().updateOne(
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

    return { count, channel: firstChannel };
}

async function findReusableChannel(guild, userId) {
    if (!TICKET_SETTINGS.REUSE_CHANNELS) {
        return null;
    }

    const previous = await tickets().findOne(
        {
            guildId: guild.id,
            userId,
            status: "closed"
        },
        {
            sort: { updatedAt: -1 }
        }
    );

    if (!previous) return null;

    const channel = await guild.channels.fetch(
        previous.channelId
    ).catch(() => null);

    if (
        !channel ||
        channel.type !== ChannelType.GuildText
    ) {
        return null;
    }

    // Do not reuse a channel that currently belongs
    // to an open ticket.
    const occupied = await tickets().findOne({
        guildId: guild.id,
        channelId: channel.id,
        status: "open"
    });

    return occupied ? null : channel;
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

        const registered = await tickets().findOne({
            guildId: guild.id,
            channelId: channel.id
        });

        if (!registered) {
            return channel;
        }
    }

    return null;
}

async function configureChannel(
    channel,
    overwrites
) {
    await channel.permissionOverwrites.set(overwrites);
}

// ================================================
// WELCOME EMBED
// ================================================

function buildWelcomeEmbed(type, userId, answers, sessionId) {
    const submitted = Object.entries(answers || {});

    const lines = [
        `Welcome <@${userId}>!`,
        "",
        "Your private support ticket has been opened.",
        "",
        "### 📋 Submitted Information",
        ""
    ];

    for (const [key, value] of submitted) {
        const safeKey = cleanText(key, 80);
        const safeValue = cleanText(value, 900);

        const line = `**${safeKey}:** ${safeValue}`;

        const candidate = [...lines, line].join("\n");

        if (candidate.length > SETTINGS.MAX_DESCRIPTION) {
            lines.push(
                "*Additional details were shortened.*"
            );
            break;
        }

        lines.push(line, "");
    }

    lines.push(
        "",
        "### 🛡️ What Happens Next?",
        "Our support team will review your request.",
        "",
        "Please wait for an authorized staff member."
    );

    return new EmbedBuilder()
        .setColor(SETTINGS.COLOR)
        .setTitle(`${type.emoji} ${type.label}`)
        .setDescription(
            lines.join("\n").slice(
                0,
                SETTINGS.MAX_DESCRIPTION
            )
        )
        .addFields({
            name: "📋 Status",
            value: "🟡 Awaiting Staff",
            inline: true
        })
        .setFooter({
            text: `ItamaRos Bot • Session ${sessionId}`
        })
        .setTimestamp();
}

// ================================================
// MAIN TICKET CREATION
// ================================================

async function createTicket(interaction, ticketData) {
    const { guild, user } = interaction;

    if (!guild?.id || !user?.id) {
        return failure("SERVER_ONLY");
    }

    if (
        !ticketData ||
        typeof ticketData.type !== "string"
    ) {
        return failure("INVALID_TICKET_DATA");
    }

    const ticketType = getTicketType(ticketData.type);

    if (!ticketType) {
        return failure("INVALID_TICKET_TYPE");
    }

    // SECURITY:
    // The public ticket creation API must never
    // create a Giveaway Winner ticket.
    //
    // Verified winners use winnerTicket.js.
    // Authorized managers will use a separate command.
    if (isRestrictedType(ticketType.id)) {
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

    const lock = await acquireLock(
        guild.id,
        user.id
    );

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

        const maxTickets = Math.max(
            1,
            Number(TICKET_SETTINGS.MAX_ACTIVE_TICKETS) || 1
        );

        if (active.count >= maxTickets) {
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

        const topic = getTicketTopic(
            guild.id,
            user.id
        );

        if (!channel) {
            channel = await findRecoverableChannel(
                guild,
                topic
            );
        }

        if (!channel) {
            channel = await guild.channels.create({
                name: createTicketName(user.username),
                type: ChannelType.GuildText,
                topic,
                permissionOverwrites: overwrites,
                reason:
                    `ItamaRos support ticket for ${user.id}`
            });

            createdChannel = true;
        } else {
            await configureChannel(
                channel,
                overwrites
            );
        }

        const sessionId = `${Date.now()}-${user.id}`;

        const now = new Date();

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

        await tickets().insertOne(ticketRecord);
        ticketSaved = true;

        const embed = buildWelcomeEmbed(
            ticketType,
            user.id,
            answers,
            sessionId
        );

        let welcomeMessageSent = false;

        try {
            await channel.send({
                content: `<@${user.id}>`,
                embeds: [embed],
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

        console.log(
            `[Tickets] Created ticket ${channel.id} ` +
            `for ${user.id} (${ticketType.id}).`
        );

        return {
            success: true,
            reused,
            channel,
            sessionId,
            welcomeMessageSent
        };
    } catch (error) {
        console.error(
            "[Tickets] Creation failed:",
            error
        );

        // Never delete a channel after its ticket record
        // was successfully saved.
        if (!ticketSaved && createdChannel && channel) {
            await channel.delete(
                "Rolling back failed ticket creation"
            ).catch(cleanupError => {
                console.error(
                    "[Tickets] Channel cleanup failed:",
                    cleanupError
                );
            });
        }

        throw error;
    } finally {
        await releaseLock(lock).catch(error => {
            console.error(
                "[Tickets] Could not release creation lock:",
                error
            );
        });
    }
}

module.exports = {
    createTicket
};
