"use strict";

const {
    SlashCommandBuilder,
    MessageFlags,
    PermissionFlagsBits
} = require("discord.js");
const {
    countInvites,
    getInvitation,
    records
} = require("./tracker");

const PAGE_SIZE = 20;

const data = new SlashCommandBuilder()
    .setName("invites")
    .setDescription("View and manage Discord invite statistics")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("user")
            .setDescription("See someone's invitation counts and who invited them")
            .addUserOption(option =>
                option.setName("member")
                    .setDescription("Person to check")
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("See which members a user invited")
            .addUserOption(option =>
                option.setName("member")
                    .setDescription("Inviter")
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName("page")
                    .setDescription("Page of invited users, 20 per page")
                    .setMinValue(1)
                    .setRequired(false)
            )
    )
    .addSubcommand(sub =>
        sub.setName("top")
            .setDescription("Show the top server inviters")
    );

async function execute(interaction) {
    if (!interaction.inGuild() ||
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild
        )) {
        await interaction.reply({
            content: "❌ Manage Server permission is required.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const guildId = interaction.guildId;
    const action = interaction.options.getSubcommand();

    try {
        if (action === "user") {
            const target = interaction.options.getUser("member", true);
            const [active, total, attribution] = await Promise.all([
                countInvites(guildId, target.id, true),
                countInvites(guildId, target.id, false),
                getInvitation(guildId, target.id)
            ]);

            await interaction.editReply({
                content: [
                    "🎟️ **Invite Statistics**",
                    "",
                    "**Member:** <@" + target.id + ">",
                    "**Currently in server:** " + active + " invited members",
                    "**Total tracked:** " + total + " members",
                    "**Invited by:** " +
                        (
                            attribution?.inviterId
                                ? "<@" + attribution.inviterId + ">"
                                : "Unknown / not tracked"
                        ),
                    "",
                    "Tracking begins when the invitation system is enabled."
                ].join("\n"),
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (action === "list") {
            const target = interaction.options.getUser("member", true);
            const page = interaction.options.getInteger("page") || 1;
            const total = await countInvites(guildId, target.id, false);

            const invited = await records()
                .find({
                    guildId,
                    inviterId: target.id
                })
                .sort({ joinedAt: -1 })
                .skip((page - 1) * PAGE_SIZE)
                .limit(PAGE_SIZE)
                .toArray();

            const rows = invited.map((entry, index) =>
                ((page - 1) * PAGE_SIZE + index + 1) + ". " +
                "<@" + entry.memberId + "> — " +
                (entry.active ? "✅ In server" : "🚪 Left server")
            );

            await interaction.editReply({
                content: [
                    "📋 **Members invited by <@" + target.id + ">**",
                    "**Total tracked:** " + total,
                    "**Page:** " + page + "/" +
                        Math.max(1, Math.ceil(total / PAGE_SIZE)),
                    "",
                    ...(rows.length ? rows : ["No records on this page."])
                ].join("\n"),
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (action === "top") {
            const top = await records().aggregate([
                {
                    $match: {
                        guildId,
                        active: true,
                        inviterId: { $type: "string" }
                    }
                },
                {
                    $group: {
                        _id: "$inviterId",
                        count: { $sum: 1 }
                    }
                },
                { $sort: { count: -1, _id: 1 } },
                { $limit: 10 }
            ]).toArray();

            await interaction.editReply({
                content: [
                    "🏆 **Top Inviters — Current Members**",
                    "",
                    ...(top.length
                        ? top.map((record, index) =>
                            (index + 1) + ". <@" + record._id +
                            "> — **" + record.count + "** invites"
                        )
                        : ["No tracked invites yet."])
                ].join("\n"),
                allowedMentions: { parse: [] }
            });
            return;
        }

        await interaction.editReply({
            content: "❌ Unknown invite command."
        });
    } catch (error) {
        console.error("[Invites] Command failed:", error);
        await interaction.editReply({
            content: "❌ Couldn't load invite statistics. Check Render logs."
        }).catch(() => {});
    }
}

module.exports = { data, execute };
