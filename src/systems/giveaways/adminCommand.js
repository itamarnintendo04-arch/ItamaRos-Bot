
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require("discord.js");

const {
    getGiveawayEntrants,
    removeGiveawayParticipant
} = require("./admin");

const COLORS = Object.freeze({
    PRIMARY: 0x8B5CF6,
    SUCCESS: 0x22C55E,
    WARNING: 0xF59E0B,
    ERROR: 0xEF4444
});

const DISPLAY_LIMIT = 30;

const data = new SlashCommandBuilder()
    .setName("giveaway-admin")
    .setDescription("Manage giveaway participants and removals")
    .setDMPermission(false)
    .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("entrants")
            .setDescription("View participants in a giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("remove")
            .setDescription("Remove a participant from an active giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
            .addUserOption(option =>
                option
                    .setName("user")
                    .setDescription("The participant to remove")
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("removed")
            .setDescription("View participants removed by staff")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
    );

function createEmbed({
    title,
    description,
    color = COLORS.PRIMARY,
    fields = []
}) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Giveaway Administration"
        })
        .setTimestamp();

    if (fields.length) {
        embed.addFields(fields);
    }

    return embed;
}

function safeText(value, maxLength = 200) {
    return String(value ?? "Unknown")
        .replace(/@/g, "@\u200b")
        .slice(0, maxLength);
}

function getStatusLabel(giveaway) {
    const status = giveaway?.status;

    if (status === "active") {
        if (
            giveaway.endsAt &&
            new Date(giveaway.endsAt).getTime() <= Date.now()
        ) {
            return "⌛ Awaiting finalization";
        }

        return "🟢 Active";
    }

    if (status === "ended") {
        return "🏁 Ended";
    }

    if (status === "cancelled") {
        return "🚫 Cancelled";
    }

    return "Unknown";
}

function formatUsers(userIds, limit = DISPLAY_LIMIT) {
    const ids = Array.isArray(userIds)
        ? [...new Set(userIds)]
        : [];

    if (!ids.length) {
        return {
            text: "No users to display.",
            total: 0,
            hidden: 0
        };
    }

    const displayed = ids.slice(0, limit);

    const lines = displayed.map((id, index) => {
        return `${index + 1}. <@${id}>`;
    });

    const hidden = ids.length - displayed.length;

    if (hidden > 0) {
        lines.push(
            "",
            `*...and ${hidden} more user(s).*`
        );
    }

    return {
        text: lines.join("\n"),
        total: ids.length,
        hidden
    };
}

function getFailureMessage(reason) {
    const messages = {
        INVALID_ID:
            "The giveaway ID is invalid.",

        INVALID_USER:
            "The selected user is invalid.",

        NOT_FOUND:
            "No matching giveaway was found in this server.",

        ENDED:
            "This giveaway is no longer accepting participant changes.",

        NOT_PARTICIPATING:
            "This user is not currently participating in the giveaway.",

        NOT_FOUND_OR_NOT_PARTICIPATING:
            "The giveaway is unavailable or the user is not participating."
    };

    return messages[reason] ||
        "The requested action could not be completed.";
}

async function showError(interaction, message) {
    await interaction.editReply({
        embeds: [
            createEmbed({
                title: "❌ Action Unavailable",
                description: message,
                color: COLORS.ERROR
            })
        ],
        allowedMentions: {
            parse: []
        }
    });
}

async function handleEntrants(interaction, giveawayId) {
    const result = await getGiveawayEntrants(
        giveawayId,
        {
            guildId: interaction.guildId
        }
    );

    if (!result.success) {
        await showError(
            interaction,
            getFailureMessage(result.reason)
        );

        return;
    }

    const {
        giveaway,
        participants,
        count,
        removedCount
    } = result;

    const list = formatUsers(participants);

    const embed = createEmbed({
        title: "👥 Giveaway Participants",
        description: [
            `### 🎁 ${safeText(giveaway.prize)}`,
            "",
            "**Current Participants**",
            list.text
        ].join("\n"),

        color: COLORS.PRIMARY,

        fields: [
            {
                name: "👥 Participants",
                value: String(count),
                inline: true
            },
            {
                name: "🚫 Removed",
                value: String(removedCount),
                inline: true
            },
            {
                name: "📋 Status",
                value: getStatusLabel(giveaway),
                inline: true
            }
        ]
    });

    await interaction.editReply({
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });
}

async function handleRemoved(interaction, giveawayId) {
    const result = await getGiveawayEntrants(
        giveawayId,
        {
            guildId: interaction.guildId
        }
    );

    if (!result.success) {
        await showError(
            interaction,
            getFailureMessage(result.reason)
        );

        return;
    }

    const list = formatUsers(
        result.removedParticipants
    );

    const embed = createEmbed({
        title: "🛡️ Removed Giveaway Participants",

        description: [
            `### 🎁 ${safeText(result.giveaway.prize)}`,
            "",
            "**Users Removed by Staff**",
            list.text,
            "",
            "### Rejoin Policy",
            "Removed users cannot re-enter directly.",
            "An administrator must approve their rejoin request.",
            "",
            "Approved users are automatically added back to the giveaway."
        ].join("\n"),

        color: COLORS.WARNING,

        fields: [
            {
                name: "🚫 Removed Users",
                value: String(result.removedCount),
                inline: true
            },
            {
                name: "👥 Active Participants",
                value: String(result.count),
                inline: true
            },
            {
                name: "📋 Status",
                value: getStatusLabel(result.giveaway),
                inline: true
            }
        ]
    });

    await interaction.editReply({
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });
}

async function handleRemove(interaction, giveawayId) {
    const user = interaction.options.getUser(
        "user",
        true
    );

    const result = await removeGiveawayParticipant(
        giveawayId,
        user.id,
        {
            guildId: interaction.guildId,
            removedBy: interaction.user.id,
            client: interaction.client
        }
    );

    if (!result.success) {
        await showError(
            interaction,
            getFailureMessage(result.reason)
        );

        return;
    }

    const updateStatus = result.messageUpdated
        ? "✅ Updated"
        : "⚠️ Could not refresh the public message";

    const dmStatus = result.dmSent
        ? "✅ Sent"
        : "⚠️ Not delivered";

    const embed = createEmbed({
        title: "✅ Participant Removed",

        description: [
            `**${user.username}** was removed from the giveaway.`,
            "",
            `### 🎁 ${safeText(result.giveaway.prize)}`,
            "",
            "The user cannot rejoin without administrator approval.",
            "",
            "To request re-entry, they must press ENTER and wait for staff approval."
        ].join("\n"),

        color: COLORS.SUCCESS,

        fields: [
            {
                name: "👤 Removed User",
                value: `<@${user.id}>`,
                inline: true
            },
            {
                name: "👮 Removed By",
                value: `<@${interaction.user.id}>`,
                inline: true
            },
            {
                name: "👥 Remaining Participants",
                value: String(result.participants),
                inline: false
            },
            {
                name: "🔄 Public Message",
                value: updateStatus,
                inline: true
            },
            {
                name: "📨 User Notification",
                value: dmStatus,
                inline: true
            }
        ]
    });

    await interaction.editReply({
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    });

    console.log(
        `[GiveawayAdmin] ${interaction.user.id} removed ` +
        `${user.id} from ${giveawayId}.`
    );
}

async function execute(interaction) {
    if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "giveaway-admin"
    ) {
        return false;
    }

    try {
        if (
            !interaction.inGuild() ||
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageGuild
            )
        ) {
            await interaction.reply({
                content:
                    "❌ You need the Manage Server permission to use this command.",
                flags: MessageFlags.Ephemeral
            });

            return true;
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const subcommand = interaction.options.getSubcommand();

        const giveawayId = interaction.options.getString(
            "giveaway_id",
            true
        );

        switch (subcommand) {
            case "entrants":
                await handleEntrants(
                    interaction,
                    giveawayId
                );
                break;

            case "removed":
                await handleRemoved(
                    interaction,
                    giveawayId
                );
                break;

            case "remove":
                await handleRemove(
                    interaction,
                    giveawayId
                );
                break;

            default:
                await showError(
                    interaction,
                    "Unknown giveaway administration command."
                );
        }

        return true;
    } catch (error) {
        console.error(
            "[GiveawayAdmin] Command error:",
            error
        );

        const response = {
            content:
                "❌ Something went wrong while managing the giveaway.",
            embeds: [],
            allowedMentions: {
                parse: []
            }
        };

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(response);
            } else {
                await interaction.reply({
                    ...response,
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            console.error(
                "[GiveawayAdmin] Could not send error response:",
                replyError
            );
        }

        return true;
    }
}

module.exports = {
    data,
    execute,
    handleGiveawayAdminInteraction: execute
};
