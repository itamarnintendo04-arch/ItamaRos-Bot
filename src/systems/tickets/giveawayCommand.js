
"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");

const { randomUUID, createHash } = require("node:crypto");

const { getDatabase } = require("../../../database");
const { TICKET_TYPES } = require("./config");

// ==================================================
// ITAMAROS BOT • MANUAL GIVEAWAY TICKETS
// ==================================================

const SETTINGS = Object.freeze({
    COLOR: 0x22C55E,
    ERROR_COLOR: 0xEF4444,
    WARNING_COLOR: 0xF59E0B,
    LOCK_DURATION_MS: 10 * 60 * 1000
});

const data = new SlashCommandBuilder()
    .setName("giveaway-ticket")
    .setDescription("Manage giveaway winner tickets")
    .setDMPermission(false)
    .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("create")
            .setDescription(
                "Create a private giveaway ticket for a member"
            )
            .addUserOption(option =>
                option
                    .setName("user")
                    .setDescription(
                        "Member who should receive the ticket"
                    )
                    .setRequired(true)
            )
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("Giveaway prize")
                    .setMinLength(1)
                    .setMaxLength(200)
                    .setRequired(true)
            )
    );

// ==================================================
// DATABASE
// ==================================================

function ticketCollection() {
    return getDatabase().collection("tickets");
}

function lockCollection() {
    // Shared with normal support-ticket creation.
    return getDatabase().collection("ticket_creation_locks");
}

function makePrizeKey(prize) {
    return createHash("sha256")
        .update(prize.trim().toLowerCase())
        .digest("hex")
        .slice(0, 24);
}

function ticketTopic(userId, prizeKey) {
    return (
        "ItamaRos Manual Giveaway | " +
        `user=${userId} | prize=${prizeKey}`
    );
}

function sanitize(value, maximum = 200) {
    return String(value ?? "")
        .trim()
        .replace(/[\r\n\t]+/g, " ")
        .replace(/@/g, "@\u200b")
        .slice(0, maximum);
}

function ticketUrl(guildId, channelId) {
    return (
        `https://discord.com/channels/` +
        `${guildId}/${channelId}`
    );
}

// ==================================================
// PERMISSIONS
// ==================================================

function isManager(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        ) ||
        interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    );
}

async function checkBotPermissions(guild) {
    const bot = await guild.members.fetchMe()
        .catch(() => null);

    if (!bot) {
        throw new Error("BOT_MEMBER_UNAVAILABLE");
    }

    const required = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
    ];

    const missing = required.filter(
        flag => !bot.permissions.has(flag)
    );

    if (missing.length) {
        throw new Error("MISSING_BOT_PERMISSIONS");
    }

    return bot;
}

async function buildChannelPermissions(
    guild,
    targetId,
    botId
) {
    await guild.roles.fetch();

    const memberPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
    ];

    const overwrites = [
        {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: targetId,
            allow: memberPermissions
        },
        {
            id: botId,
            allow: [
                ...memberPermissions,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    for (const role of guild.roles.cache.values()) {
        if (role.id === guild.id) continue;

        const staffRole =
            role.permissions.has(
                PermissionFlagsBits.ManageGuild
            ) ||
            role.permissions.has(
                PermissionFlagsBits.Administrator
            );

        if (!staffRole) continue;

        overwrites.push({
            id: role.id,
            allow: memberPermissions
        });
    }

    if (overwrites.length > 95) {
        throw new Error("TOO_MANY_STAFF_ROLES");
    }

    return overwrites;
}

// ==================================================
// CREATION LOCK
// ==================================================

async function acquireLock(guildId, userId) {
    const id = `${guildId}:${userId}`;
    const token = randomUUID();
    const now = new Date();

    try {
        const result = await lockCollection().updateOne(
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
                        now.getTime() +
                        SETTINGS.LOCK_DURATION_MS
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

    await lockCollection().updateOne(
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

// ==================================================
// EXISTING / RECOVERABLE TICKETS
// ==================================================

async function findExistingTicket(
    guild,
    userId,
    prizeKey
) {
    const existing = await ticketCollection().find({
        guildId: guild.id,
        userId,
        type: TICKET_TYPES.GIVEAWAY.id,
        source: "staff_giveaway",
        manualPrizeKey: prizeKey,
        status: "open"
    }).toArray();

    for (const ticket of existing) {
        const channel = await guild.channels.fetch(
            ticket.channelId
        ).catch(() => null);

        if (channel) {
            return channel;
        }

        await ticketCollection().updateOne(
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

    return null;
}

async function findRecoverableChannel(
    guild,
    userId,
    prizeKey
) {
    const expectedTopic = ticketTopic(
        userId,
        prizeKey
    );

    const channels = await guild.channels.fetch();

    for (const channel of channels.values()) {
        if (
            channel?.type !== ChannelType.GuildText ||
            channel.topic !== expectedTopic
        ) {
            continue;
        }

        const recorded = await ticketCollection().findOne({
            guildId: guild.id,
            channelId: channel.id
        });

        if (!recorded) {
            return channel;
        }
    }

    return null;
}

// ==================================================
// EMBEDS
// ==================================================

function makeEmbed(title, description, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Giveaway Support"
        })
        .setTimestamp();
}

function winnerEmbed(userId, prize, managerId, botId) {
    return new EmbedBuilder()
        .setColor(SETTINGS.COLOR)
        .setTitle("🏆 GIVEAWAY PRIZE TICKET")
        .setDescription([
            `Congratulations <@${userId}>! 🎉`,
            "",
            "A server manager has opened a private giveaway ticket for you.",
            "",
            "Our staff will assist you with your prize.",
            "",
            "**Please wait for a staff member.**",
            "",
            "🤖 **Need AI help?** Mention <@" + botId + "> here.",
            "The AI only helps with the ItamaRos server",
            "and this giveaway ticket's subject."
        ].join("\n"))
        .addFields(
            {
                name: "🎁 Prize",
                value: sanitize(prize)
            },
            {
                name: "👤 Recipient",
                value: `<@${userId}>`,
                inline: true
            },
            {
                name: "🛡️ Created By",
                value: `<@${managerId}>`,
                inline: true
            },
            {
                name: "📋 Status",
                value: "🟡 Awaiting Staff"
            }
        )
        .setFooter({
            text: "ItamaRos Bot • Winner Support"
        })
        .setTimestamp();
}

function closeButton() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("ticket_close")
            .setLabel("Close Ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Danger)
    );
}

async function reply(interaction, embed) {
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
            embeds: [embed],
            allowedMentions: { parse: [] }
        });
    }

    return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    });
}

// ==================================================
// MAIN COMMAND
// ==================================================

async function execute(interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "giveaway-ticket"
    ) {
        return false;
    }

    if (!interaction.inGuild() || !isManager(interaction)) {
        await reply(
            interaction,
            makeEmbed(
                "❌ Permission Denied",
                "Only authorized server managers can create giveaway tickets.",
                SETTINGS.ERROR_COLOR
            )
        );

        return true;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    let lock = null;
    let createdChannel = false;
    let channel = null;
    let saved = false;

    try {
        const guild = interaction.guild;

        const target = interaction.options.getUser(
            "user",
            true
        );

        const prize = interaction.options.getString(
            "prize",
            true
        ).trim();

        if (!prize || prize.length > 200) {
            await reply(
                interaction,
                makeEmbed(
                    "❌ Invalid Prize",
                    "The prize must be between 1 and 200 characters.",
                    SETTINGS.ERROR_COLOR
                )
            );

            return true;
        }

        if (target.bot) {
            await reply(
                interaction,
                makeEmbed(
                    "❌ Invalid Recipient",
                    "Giveaway tickets cannot be created for bots.",
                    SETTINGS.ERROR_COLOR
                )
            );

            return true;
        }

        const member = await guild.members.fetch(
            target.id
        ).catch(() => null);

        if (!member) {
            await reply(
                interaction,
                makeEmbed(
                    "❌ Member Not Found",
                    "The selected user must be a member of this server.",
                    SETTINGS.ERROR_COLOR
                )
            );

            return true;
        }

        const bot = await checkBotPermissions(guild);

        const prizeKey = makePrizeKey(prize);

        lock = await acquireLock(
            guild.id,
            target.id
        );

        if (!lock) {
            await reply(
                interaction,
                makeEmbed(
                    "⏳ Creation In Progress",
                    "Another ticket operation is already running for this member.",
                    SETTINGS.WARNING_COLOR
                )
            );

            return true;
        }

        // Same user + same prize should not create
        // duplicate active staff giveaway tickets.
        const existing = await findExistingTicket(
            guild,
            target.id,
            prizeKey
        );

        if (existing) {
            await reply(
                interaction,
                makeEmbed(
                    "🎫 Ticket Already Exists",
                    [
                        "This member already has an active ticket for that prize.",
                        "",
                        `[Open Existing Ticket](${ticketUrl(
                            guild.id,
                            existing.id
                        )})`
                    ].join("\n"),
                    SETTINGS.WARNING_COLOR
                )
            );

            return true;
        }

        const overwrites =
            await buildChannelPermissions(
                guild,
                target.id,
                bot.id
            );

        // Reuse an unfinished channel creation
        // if Render previously stopped midway.
        channel = await findRecoverableChannel(
            guild,
            target.id,
            prizeKey
        );

        if (!channel) {
            const safeName = target.username
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, "-")
                .replace(/-+/g, "-")
                .slice(0, 18) || "winner";

            channel = await guild.channels.create({
                name: `winner-${safeName}`,
                type: ChannelType.GuildText,
                topic: ticketTopic(
                    target.id,
                    prizeKey
                ),
                permissionOverwrites: overwrites,
                reason:
                    `Manual giveaway ticket created by ${interaction.user.id}`
            });

            createdChannel = true;
        } else {
            await channel.permissionOverwrites.set(
                overwrites
            );
        }

        const now = new Date();
        const sessionId = `${Date.now()}-${target.id}`;

        await ticketCollection().insertOne({
            guildId: guild.id,
            channelId: channel.id,
            userId: target.id,
            username: target.username,

            type: TICKET_TYPES.GIVEAWAY.id,
            typeLabel: TICKET_TYPES.GIVEAWAY.label,
            claimEnabled: Boolean(
                TICKET_TYPES.GIVEAWAY.claim
            ),

            answers: {
                channel: "Created by server management",
                messageId: "Staff-created ticket",
                details: `Prize: ${sanitize(prize)}`
            },

            prize: sanitize(prize),
            manualPrizeKey: prizeKey,

            status: "open",
            sessionId,
            claimedBy: null,

            source: "staff_giveaway",
            autoCreated: false,
            staffCreated: true,
            createdBy: interaction.user.id,

            createdAt: now,
            updatedAt: now
        });

        saved = true;

        let welcomeSent = false;

        try {
            await channel.send({
                content: `<@${target.id}>`,
                embeds: [
                    winnerEmbed(
                        target.id,
                        prize,
                        interaction.user.id,
                        interaction.client.user.id
                    )
                ],
                components: [closeButton()],
                allowedMentions: {
                    parse: [],
                    users: [target.id]
                }
            });

            welcomeSent = true;
        } catch (error) {
            console.error(
                "[GiveawayTicket] Welcome message failed:",
                error
            );
        }

        const link = ticketUrl(
            guild.id,
            channel.id
        );

        await reply(
            interaction,
            makeEmbed(
                "✅ Giveaway Ticket Created!",
                [
                    `**Recipient:** <@${target.id}>`,
                    `**Prize:** ${sanitize(prize)}`,
                    "",
                    `🎫 [Open Private Ticket](${link})`,
                    "",
                    welcomeSent
                        ? "The ticket is ready for staff assistance."
                        : "The ticket was created, but its welcome message could not be sent."
                ].join("\n"),
                SETTINGS.COLOR
            )
        );

        console.log(
            `[GiveawayTicket] Manager ${interaction.user.id} ` +
            `created ticket ${channel.id} for ${target.id}.`
        );

        return true;
    } catch (error) {
        console.error(
            "[GiveawayTicket] Creation failed:",
            error
        );

        if (!saved && createdChannel && channel) {
            await channel.delete(
                "Rolling back failed manual giveaway ticket"
            ).catch(cleanupError => {
                console.error(
                    "[GiveawayTicket] Channel cleanup failed:",
                    cleanupError
                );
            });
        }

        const reason =
            error.message === "MISSING_BOT_PERMISSIONS"
                ? "The bot needs Manage Channels, Manage Roles, View Channel, Send Messages and Embed Links permissions. Check its role in Server Settings."
                : error.message === "TOO_MANY_STAFF_ROLES"
                    ? "This server has too many management roles to configure the ticket."
                    : "The ticket could not be created. Please check the Render logs.";

        await reply(
            interaction,
            makeEmbed(
                "❌ Ticket Creation Failed",
                reason,
                SETTINGS.ERROR_COLOR
            )
        ).catch(() => {});

        return true;
    } finally {
        if (lock) {
            await releaseLock(lock).catch(error => {
                console.error(
                    "[GiveawayTicket] Lock cleanup failed:",
                    error
                );
            });
        }
    }
}

module.exports = {
    data,
    execute
};
