
"use strict";

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    EmbedBuilder
} = require("discord.js");

const { buildTicketPanel } = require("./panel");

// ================================================
// ITAMAROS BOT • TICKET PANEL COMMAND 2.0
// ================================================

const COLORS = Object.freeze({
    SUCCESS: 0x22C55E,
    ERROR: 0xEF4444,
    WARNING: 0xF59E0B
});

const data = new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Publish the ItamaRos Support Center panel")
    .setDMPermission(false)
    .setDefaultMemberPermissions(
        PermissionFlagsBits.Administrator
    );

function buildResponse(title, description, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: "ItamaRos Bot • Ticket Administration"
        })
        .setTimestamp();
}

function getPanelUrl(guildId, channelId, messageId) {
    return (
        `https://discord.com/channels/` +
        `${guildId}/${channelId}/${messageId}`
    );
}

async function checkBotPermissions(interaction) {
    const { guild, channel } = interaction;

    const botMember = await guild.members.fetchMe()
        .catch(() => null);

    if (!botMember) {
        return {
            success: false,
            missing: ["Bot member unavailable"]
        };
    }

    const permissions = channel.permissionsFor(
        botMember
    );

    if (!permissions) {
        return {
            success: false,
            missing: ["Channel permissions unavailable"]
        };
    }

    const required = [
        {
            flag: PermissionFlagsBits.ViewChannel,
            label: "View Channel"
        },
        {
            flag: PermissionFlagsBits.EmbedLinks,
            label: "Embed Links"
        },
        {
            flag: channel.isThread?.()
                ? PermissionFlagsBits.SendMessagesInThreads
                : PermissionFlagsBits.SendMessages,
            label: "Send Messages"
        }
    ];

    const missing = required
        .filter(item => !permissions.has(item.flag))
        .map(item => item.label);

    return {
        success: missing.length === 0,
        missing
    };
}

async function respond(interaction, embed) {
    const payload = {
        embeds: [embed],
        allowedMentions: {
            parse: []
        }
    };

    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload);
    }

    return interaction.reply({
        ...payload,
        flags: MessageFlags.Ephemeral
    });
}

async function execute(interaction) {
    try {
        // ========================================
        // SERVER VALIDATION
        // ========================================

        if (!interaction.inGuild()) {
            await respond(
                interaction,
                buildResponse(
                    "❌ Server Only",
                    "This command can only be used inside a Discord server.",
                    COLORS.ERROR
                )
            );

            return;
        }

        // ========================================
        // ADMINISTRATOR VALIDATION
        // ========================================

        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            await respond(
                interaction,
                buildResponse(
                    "🛡️ Administrator Only",
                    "Only server administrators can publish the support panel.",
                    COLORS.ERROR
                )
            );

            return;
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        // ========================================
        // CHANNEL VALIDATION
        // ========================================

        const channel = interaction.channel;

        if (
            !channel?.isTextBased() ||
            typeof channel.send !== "function"
        ) {
            await respond(
                interaction,
                buildResponse(
                    "⚠️ Unsupported Channel",
                    "Please use this command in a server text channel.",
                    COLORS.WARNING
                )
            );

            return;
        }

        // ========================================
        // BOT PERMISSIONS
        // ========================================

        const permissionCheck = await checkBotPermissions(
            interaction
        );

        if (!permissionCheck.success) {
            const permissions = permissionCheck.missing
                .map(name => `• ${name}`)
                .join("\n");

            await respond(
                interaction,
                buildResponse(
                    "❌ Missing Bot Permissions",
                    [
                        "ItamaRos Bot cannot publish the support panel in this channel.",
                        "",
                        "**Missing permissions:**",
                        permissions,
                        "",
                        "Please check the bot role and channel permissions."
                    ].join("\n"),
                    COLORS.ERROR
                )
            );

            return;
        }

        // ========================================
        // BUILD SUPPORT PANEL
        // ========================================

        const panel = buildTicketPanel();

        // ========================================
        // PUBLISH SUPPORT PANEL
        // ========================================

        const message = await channel.send({
            ...panel,
            allowedMentions: {
                parse: []
            }
        });

        const panelUrl = getPanelUrl(
            interaction.guildId,
            channel.id,
            message.id
        );

        // ========================================
        // SUCCESS RESPONSE
        // ========================================

        const successEmbed = buildResponse(
            "✅ Support Panel Published!",
            [
                "The **ItamaRos Support Center** has been published successfully!",
                "",
                `**📍 Channel:** <#${channel.id}>`,
                "",
                `🔗 [View Support Panel](${panelUrl})`,
                "",
                "**Available Categories:**",
                "🚨 Report a Member",
                "🛡️ Management Support",
                "🤝 Partnership",
                "",
                "🏆 Giveaway winner tickets are handled separately.",
                "",
                "Your members can now open support tickets!"
            ].join("\n"),
            COLORS.SUCCESS
        );

        await respond(
            interaction,
            successEmbed
        );

        console.log(
            [
                "[Tickets] Support panel published",
                `Guild: ${interaction.guildId}`,
                `Channel: ${channel.id}`,
                `Message: ${message.id}`,
                `Administrator: ${interaction.user.id}`
            ].join(" | ")
        );

    } catch (error) {
        console.error(
            "[Tickets] Failed to publish support panel:",
            error
        );

        try {
            await respond(
                interaction,
                buildResponse(
                    "❌ Support Panel Error",
                    [
                        "The support panel could not be published.",
                        "",
                        "Please verify the bot permissions and try again.",
                        "",
                        "If the problem continues, check the Render logs."
                    ].join("\n"),
                    COLORS.ERROR
                )
            );
        } catch (replyError) {
            console.error(
                "[Tickets] Failed to send command response:",
                replyError
            );
        }
    }
}

module.exports = {
    data,
    execute
};
