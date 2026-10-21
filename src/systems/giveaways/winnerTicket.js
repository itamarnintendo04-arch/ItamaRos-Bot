
const {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const { ObjectId } = require("mongodb");

const { getDatabase } = require("../../../database");
const { GIVEAWAY_SETTINGS } = require("./config");

const {
    TICKET_TYPES,
    TICKET_SETTINGS
} = require("../tickets/config");

const JOB_COLLECTION = "giveaway_winner_ticket_jobs";
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E
});

function getCollections() {
    const db = getDatabase();

    return {
        giveaways: db.collection(
            GIVEAWAY_SETTINGS.COLLECTION
        ),
        tickets: db.collection("tickets"),
        jobs: db.collection(JOB_COLLECTION)
    };
}

function fail(reason, extra = {}) {
    return {
        success: false,
        reason,
        ...extra
    };
}

function isDiscordId(value) {
    return (
        typeof value === "string" &&
        /^\d{17,20}$/.test(value)
    );
}

function getJobId(giveawayId, winnerId) {
    return `${giveawayId}:${winnerId}`;
}

function getTopic(giveawayId, winnerId) {
    return (
        `ItamaRos Giveaway Winner | ` +
        `giveaway=${giveawayId} | winner=${winnerId}`
    );
}

function getChannelName(member) {
    const safeName = member.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20);

    return `ticket-${safeName || "winner"}-giveaway`;
}

function getGiveawayLink(giveaway) {
    if (
        !giveaway.guildId ||
        !giveaway.channelId ||
        !giveaway.messageId
    ) {
        return null;
    }

    return (
        `https://discord.com/channels/` +
        `${giveaway.guildId}/` +
        `${giveaway.channelId}/` +
        `${giveaway.messageId}`
    );
}

function getConfiguredStaffRoleIds() {
    const ids = new Set();

    const settings = TICKET_SETTINGS || {};

    const possibleIds = [
        settings.STAFF_ROLE_ID,
        settings.ADMIN_ROLE_ID,
        settings.SUPPORT_ROLE_ID
    ];

    const possibleArrays = [
        settings.STAFF_ROLE_IDS,
        settings.ADMIN_ROLE_IDS,
        settings.SUPPORT_ROLE_IDS
    ];

    for (const id of possibleIds) {
        if (isDiscordId(id)) {
            ids.add(id);
        }
    }

    for (const list of possibleArrays) {
        if (!Array.isArray(list)) continue;

        for (const id of list) {
            if (isDiscordId(id)) {
                ids.add(id);
            }
        }
    }

    return ids;
}

async function buildPermissionOverwrites(
    guild,
    winnerId,
    botId
) {
    await guild.roles.fetch();

    const staffIds = getConfiguredStaffRoleIds();

    // Roles with Manage Server or Administrator permissions
    // are also recognized as server staff.
    for (const role of guild.roles.cache.values()) {
        if (role.id === guild.id) {
            continue;
        }

        const isStaff = role.permissions.has(
            PermissionFlagsBits.ManageGuild
        ) || role.permissions.has(
            PermissionFlagsBits.Administrator
        );

        if (isStaff) {
            staffIds.add(role.id);
        }
    }

    const viewPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles
    ];

    const overwrites = [
        {
            id: guild.id,
            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },
        {
            id: winnerId,
            allow: viewPermissions
        },
        {
            id: botId,
            allow: [
                ...viewPermissions,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    for (const roleId of staffIds) {
        if (
            !guild.roles.cache.has(roleId) ||
            roleId === guild.id ||
            roleId === winnerId ||
            roleId === botId
        ) {
            continue;
        }

        overwrites.push({
            id: roleId,
            allow: [
                ...viewPermissions,
                PermissionFlagsBits.ManageMessages
            ]
        });
    }

    // Discord allows a limited number of overwrites per channel.
    if (overwrites.length > 95) {
        throw new Error(
            "Too many staff role permission overwrites."
        );
    }

    return overwrites;
}

function buildWinnerEmbed(
    giveaway,
    winnerId,
    sessionId
) {
    const link = getGiveawayLink(giveaway);

    const lines = [
        `# 🏆 Congratulations, <@${winnerId}>!`,
        "",
        "You have won an **ItamaRos Giveaway**!",
        "",
        "Our staff will help you claim your prize.",
        "",
        "Please wait for a staff member to assist you."
    ];

    if (link) {
        lines.push(
            "",
            `🎉 [View the original giveaway](${link})`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle("🎫 GIVEAWAY WINNER TICKET")
        .setDescription(lines.join("\n"))
        .addFields(
            {
                name: "🎁 Your Prize",
                value: String(giveaway.prize || "Giveaway Prize"),
                inline: false
            },
            {
                name: "👤 Winner",
                value: `<@${winnerId}>`,
                inline: true
            },
            {
                name: "📋 Ticket Status",
                value: "🟡 Awaiting Staff",
                inline: true
            }
        )
        .setFooter({
            text: `ItamaRos Bot • Session ${sessionId}`
        })
        .setTimestamp();

    if (giveaway.imageUrl) {
        embed.setThumbnail(giveaway.imageUrl);
    }

    return embed;
}

async function findExistingTicket(
    guild,
    tickets,
    filter
) {
    const ticket = await tickets.findOne({
        ...filter,
        status: "open"
    });

    if (!ticket) {
        return null;
    }

    const channel = await guild.channels.fetch(
        ticket.channelId
    ).catch(() => null);

    if (channel) {
        return ticket;
    }

    // Close a stale record when its channel is gone.
    await tickets.updateOne(
        {
            _id: ticket._id,
            status: "open",
            channelId: ticket.channelId
        },
        {
            $set: {
                status: "closed",
                updatedAt: new Date(),
                channelMissing: true
            }
        }
    );

    return null;
}

async function claimTicketJob(
    jobs,
    jobId,
    giveawayId,
    winnerId
) {
    const now = new Date();

    try {
        const job = await jobs.findOneAndUpdate(
            {
                _id: jobId,
                $or: [
                    {
                        status: {
                            $exists: false
                        }
                    },
                    {
                        status: "failed"
                    },
                    {
                        status: "creating",
                        lockedAt: {
                            $lt: new Date(
                                now.getTime() - LOCK_TIMEOUT_MS
                            )
                        }
                    }
                ]
            },
            {
                $set: {
                    giveawayId,
                    winnerId,
                    status: "creating",
                    lockedAt: now,
                    updatedAt: now
                },
                $setOnInsert: {
                    createdAt: now
                },
                $inc: {
                    attempts: 1
                }
            },
            {
                upsert: true,
                returnDocument: "after"
            }
        );

        // Support MongoDB driver return shapes.
        return job?.value ?? job;
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function findRecoverableChannel(
    guild,
    topic
) {
    const channels = await guild.channels.fetch();

    return channels.find(channel =>
        channel &&
        channel.type === ChannelType.GuildText &&
        channel.topic === topic
    ) || null;
}

async function updateJob(
    jobs,
    jobId,
    status,
    extra = {}
) {
    await jobs.updateOne(
        {
            _id: jobId
        },
        {
            $set: {
                status,
                updatedAt: new Date(),
                ...extra
            },
            $unset: {
                lockedAt: ""
            }
        }
    );
}

async function createGiveawayWinnerTicket(
    client,
    giveawayId,
    winnerId
) {
    if (
        !ObjectId.isValid(giveawayId) ||
        !isDiscordId(winnerId)
    ) {
        return fail("INVALID_GIVEAWAY_ID");
    }

    const {
        giveaways,
        tickets,
        jobs
    } = getCollections();

    const giveaway = await giveaways.findOne({
        _id: new ObjectId(giveawayId),
        status: GIVEAWAY_SETTINGS.STATUS.ENDED,
        winners: winnerId
    });

    if (!giveaway) {
        return fail("NOT_A_WINNER");
    }

    const ticketType = TICKET_TYPES.GIVEAWAY;

    if (!ticketType?.id) {
        return fail("TICKET_TYPE_NOT_CONFIGURED");
    }

    const guild = await client.guilds.fetch(
        giveaway.guildId
    ).catch(() => null);

    if (!guild) {
        return fail("GUILD_NOT_FOUND");
    }

    const member = await guild.members.fetch(
        winnerId
    ).catch(() => null);

    if (!member) {
        return fail("WINNER_NOT_IN_SERVER");
    }

    const botMember = await guild.members.fetchMe()
        .catch(() => null);

    if (
        !botMember ||
        !botMember.permissions.has(
            PermissionFlagsBits.ManageChannels
        )
    ) {
        return fail("MISSING_BOT_PERMISSION");
    }

    const sameTicketFilter = {
        guildId: guild.id,
        userId: winnerId,
        type: ticketType.id,
        giveawayId
    };

    // First check whether this winner ticket already exists.
    const existing = await findExistingTicket(
        guild,
        tickets,
        sameTicketFilter
    );

    if (existing) {
        return {
            success: true,
            alreadyExists: true,
            channelId: existing.channelId
        };
    }

    // Respect the existing one-active-ticket policy.
    if (TICKET_SETTINGS.MAX_ACTIVE_TICKETS === 1) {
        const anotherTicket = await findExistingTicket(
            guild,
            tickets,
            {
                guildId: guild.id,
                userId: winnerId
            }
        );

        if (anotherTicket) {
            return fail("ACTIVE_TICKET", {
                channelId: anotherTicket.channelId
            });
        }
    }

    const jobId = getJobId(
        giveawayId,
        winnerId
    );

    const job = await claimTicketJob(
        jobs,
        jobId,
        giveawayId,
        winnerId
    );

    if (!job) {
        // Another process may already be creating the ticket.
        const existingAfterClaim = await findExistingTicket(
            guild,
            tickets,
            sameTicketFilter
        );

        if (existingAfterClaim) {
            return {
                success: true,
                alreadyExists: true,
                channelId: existingAfterClaim.channelId
            };
        }

        return fail("IN_PROGRESS");
    }

    let channel = null;
    let newlyCreated = false;
    let ticketSaved = false;

    try {
        // Recheck after obtaining the job reservation.
        const existingAfterLock = await findExistingTicket(
            guild,
            tickets,
            sameTicketFilter
        );

        if (existingAfterLock) {
            await updateJob(
                jobs,
                jobId,
                "completed",
                {
                    channelId: existingAfterLock.channelId,
                    completedAt: new Date()
                }
            );

            return {
                success: true,
                alreadyExists: true,
                channelId: existingAfterLock.channelId
            };
        }

        const topic = getTopic(
            giveawayId,
            winnerId
        );

        // A previous Render restart may have interrupted
        // creation after Discord created the channel.
        if (job.attempts > 1) {
            channel = await findRecoverableChannel(
                guild,
                topic
            );
        }

        if (!channel) {
            const overwrites = await buildPermissionOverwrites(
                guild,
                winnerId,
                botMember.id
            );

            channel = await guild.channels.create({
                name: getChannelName(member),
                type: ChannelType.GuildText,
                topic,
                permissionOverwrites: overwrites,
                reason:
                    `ItamaRos Giveaway Winner: ` +
                    `${giveawayId} / ${winnerId}`
            });

            newlyCreated = true;
        }

        const sessionId = `${Date.now()}-${winnerId}`;

        const answers = {
            channel: `<#${giveaway.channelId}>`,
            messageId: giveaway.messageId || "Unknown",
            details:
                `Giveaway prize: ${giveaway.prize}`
        };

        const ticketRecord = {
            guildId: guild.id,
            channelId: channel.id,
            userId: winnerId,
            username: member.user.username,

            type: ticketType.id,
            typeLabel: ticketType.label,
            claimEnabled: Boolean(ticketType.claim),

            giveawayId,
            answers,

            status: "open",
            sessionId,
            claimedBy: null,

            autoCreated: true,
            source: "giveaway_winner",

            createdAt: new Date(),
            updatedAt: new Date()
        };

        await tickets.insertOne(ticketRecord);
        ticketSaved = true;

        // The ticket record is now persistent.
        // A message failure must not delete a valid ticket.
        let welcomeMessageSent = false;

        try {
            const embed = buildWinnerEmbed(
                giveaway,
                winnerId,
                sessionId
            );

            await channel.send({
                content: `<@${winnerId}>`,
                embeds: [embed],
                allowedMentions: {
                    users: [winnerId],
                    parse: []
                }
            });

            welcomeMessageSent = true;
        } catch (error) {
            console.error(
                "[WinnerTicket] Welcome message failed:",
                error
            );
        }

        try {
            await updateJob(
                jobs,
                jobId,
                "completed",
                {
                    channelId: channel.id,
                    completedAt: new Date(),
                    welcomeMessageSent
                }
            );
        } catch (error) {
            // A valid ticket already exists in the tickets
            // collection. Do not recreate it.
            console.error(
                "[WinnerTicket] Job completion update failed:",
                error
            );
        }

        console.log(
            `[WinnerTicket] Created ${channel.id} ` +
            `for winner ${winnerId}.`
        );

        return {
            success: true,
            alreadyExists: false,
            channelId: channel.id,
            welcomeMessageSent
        };
    } catch (error) {
        console.error(
            "[WinnerTicket] Creation failed:",
            error
        );

        if (!ticketSaved && newlyCreated && channel) {
            await channel.delete(
                "Rolling back failed winner ticket creation"
            ).catch(cleanupError => {
                console.error(
                    "[WinnerTicket] Channel cleanup failed:",
                    cleanupError
                );
            });
        }

        try {
            await updateJob(
                jobs,
                jobId,
                ticketSaved ? "completed" : "failed",
                {
                    ...(ticketSaved && channel
                        ? { channelId: channel.id }
                        : {}),
                    failedAt: new Date()
                }
            );
        } catch (jobError) {
            console.error(
                "[WinnerTicket] Job state update failed:",
                jobError
            );
        }

        return fail(
            ticketSaved
                ? "TICKET_PARTIALLY_CREATED"
                : "CREATION_FAILED"
        );
    }
}

module.exports = {
    createGiveawayWinnerTicket
};
