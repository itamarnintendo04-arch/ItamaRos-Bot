"use strict";

const { ChannelType, PermissionFlagsBits: P } =
    require("discord.js");
const { getDatabase } = require("../../../database");
const { totalXpForLevel } = require("../xp/progression");

const ROLE_DEFINITIONS = Object.freeze([
    { tier: 1, name: "Level 1", color: 0x72C7F6, requiredXp: totalXpForLevel(1), reward: 500 },
    { tier: 2, name: "Level 2", color: 0xAA83FF, requiredXp: totalXpForLevel(2), reward: 1500 },
    { tier: 3, name: "Level 3", color: 0xFFD166, requiredXp: totalXpForLevel(3), reward: 3000 },
    { tier: 4, name: "Level 4", color: 0x7EE1C1, requiredXp: totalXpForLevel(4), reward: 4500 },
    { tier: 5, name: "Level 5", color: 0xFF97C2, requiredXp: totalXpForLevel(5), reward: 6000 }
]);

const CHANNELS = Object.freeze([
    { tier: 1, name: "level-1" },
    { tier: 2, name: "level-2" },
    { tier: 3, name: "level-3" },
    { tier: 4, name: "level-4" },
    { tier: 5, name: "level-5" }
]);
const RULES_CHANNEL = "boost-rules";
const ID = /^\d{17,20}$/;

let setupPromise = null;
const roleTable = () => getDatabase().collection("bot_system_roles");
const channelTable = () => getDatabase().collection("bot_system_channels");

function roleKey(guildId, tier) {
    return guildId + ":level-" + tier;
}

function channelKey(guildId, key) {
    return guildId + ":" + key;
}

function cleanName(name) {
    return String(name || "").normalize("NFKD")
        .toLowerCase().replace(/\p{M}/gu, "")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

function isHarmlessRole(role) {
    if (!role || role.managed) return false;
    const forbidden = [
        P.Administrator, P.ManageGuild, P.ManageRoles,
        P.ManageChannels, P.ManageMessages, P.ManageWebhooks,
        P.BanMembers, P.KickMembers, P.ModerateMembers
    ];
    return forbidden.every(permission =>
        !role.permissions.has(permission));
}

async function ensureLevelRoles(guild) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageRoles)) {
        throw new Error("Manage Roles permission needed.");
    }
    await guild.roles.fetch();

    const roles = new Map();

    for (const definition of ROLE_DEFINITIONS) {
        const stored = await roleTable().findOne({
            _id: roleKey(guild.id, definition.tier)
        });

        let role = stored && guild.roles.cache.get(stored.roleId);
        if (!isHarmlessRole(role)) role = null;

        if (!role) {
            role = guild.roles.cache.find(item =>
                item.name === definition.name &&
                isHarmlessRole(item)
            );
        }

        if (!role) {
            role = await guild.roles.create({
                name: definition.name,
                color: definition.color,
                hoist: true,
                mentionable: false,
                permissions: [],
                reason: "ItamaRos XP rank level " + definition.tier
            });
            console.log(
                "[Levels] Created role " +
                role.name + " (" + role.id + ")."
            );
        }

        if (role.position >= me.roles.highest.position) {
            console.warn(
                "[Levels] Move the bot role above " + role.name +
                " in Discord to allow automatic rank assignment."
            );
        }

        roles.set(definition.tier, role);
        await roleTable().updateOne(
            { _id: roleKey(guild.id, definition.tier) },
            { $set: {
                guildId: guild.id,
                tier: definition.tier,
                roleId: role.id,
                updatedAt: new Date()
            } },
            { upsert: true }
        );
    }
    return roles;
}

function tierOverwrites(guild, botId, tier, roles) {
    const base = [
        {
            id: guild.id,
            deny: [
                P.ViewChannel,
                P.SendMessages,
                P.CreatePublicThreads,
                P.CreatePrivateThreads
            ]
        },
        { id: botId, allow: [
            P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
            P.EmbedLinks, P.AttachFiles, P.ManageMessages
        ] }
    ];
    for (const staffRole of guild.roles.cache.values()) {
        if (staffRole.id !== guild.id &&
            (staffRole.permissions.has(P.ManageGuild) ||
             staffRole.permissions.has(P.Administrator))) {
            base.push({
                id: staffRole.id,
                allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory]
            });
        }
    }
    for (const [level, role] of roles) {
        if (level >= tier) {
            base.push({
                id: role.id,
                allow: [
                    P.ViewChannel, P.SendMessages,
                    P.ReadMessageHistory
                ]
            });
        }
    }
    return base;
}

function messageDenied() {
    return {
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: false
    };
}

function boostRules() {
    return [
        "👑 **ITAMAROS — BOOST & RANK RULES**",
        "",
        "🚀 **Server Boost → Kings**",
        "• When you boost the server, you receive the Kings role.",
        "• Kings unlocks exclusive channels, giveaways and drops.",
        "• Boost for at least 48 hours and Kings is kept permanently.",
        "• If you stop before 48 hours, Kings and Kings-only access are removed.",
        "• **Coins and XP already earned are NEVER taken away because a boost stopped.**",
        "",
        "⭐ **ACTIVITY RANKS**",
        "• XP levels have no fixed maximum.",
        "• Levels 1–15: XP requirements increase every 3 levels.",
        "• Levels 16–30: requirements increase every 2 levels.",
        "• From Level 31: requirements increase after every level.",
        "• Qualified chat messages earn increasing XP: 5, then 6, 7, etc.",
        "• Chat XP has a 60-second cooldown and repeated-text checks.",
        "• **Level 1** — " + totalXpForLevel(1) +
            " activity XP → Level 1 role, 500 bonus coins and XP.",
        "• **Level 2** — " + totalXpForLevel(2) +
            " activity XP → Level 2 role, 1,500 bonus coins and XP.",
        "• **Level 3** — " + totalXpForLevel(3) +
            " activity XP → Level 3 role, 3,000 bonus coins and XP.",
        "• **Level 4** — " + totalXpForLevel(4) +
            " activity XP → Level 4 role, 4,500 bonus coins and XP.",
        "• **Level 5** — " + totalXpForLevel(5) +
            " activity XP → Level 5 role, 6,000 bonus coins and XP.",
        "",
        "🎁 Each rank reward is paid **once per user**.",
        "📈 Bonus XP does not count toward the next activity-rank milestone.",
        "🔒 Each rank unlocks its level channels and lower-level rank channels.",
        "",
        "👑 **KINGS RANKS (1–5)**",
        "• Active or permanently retained Kings members receive exactly one Kings Level role.",
        "• Kings tiers follow rising activity-XP milestones: 0, " +
            totalXpForLevel(1) + ", " + totalXpForLevel(2) + ", " +
            totalXpForLevel(3) + ", " + totalXpForLevel(4) + ".",
        "• Rank bonus XP is excluded so milestones do not skip Kings levels.",
        "• Kings Level 5 can use all lower Kings categories and perks.",
        "• Administrators and staff with Manage Server can access every Kings category.",
        "",
        "💜 Be respectful, follow server rules and enjoy ItamaRos!",
        "",
        "🛡️ This is a read-only information channel. Only the bot",
        "publishes instructions here."
    ].join("\n");
}

async function persistChannel(guild, key, channel, introId) {
    await channelTable().updateOne(
        { _id: channelKey(guild.id, key) },
        {
            $set: {
                guildId: guild.id, key,
                channelId: channel.id,
                channelName: channel.name,
                updatedAt: new Date(),
                ...(introId ? {
                    introMessageId: introId,
                    introSent: true,
                    introSentAt: new Date()
                } : {})
            }
        },
        { upsert: true }
    );
}

async function locateOrCreate(guild, name, key, permissionOverwrites) {
    const existing = await channelTable().findOne({
        _id: channelKey(guild.id, key)
    });
    const all = await guild.channels.fetch();

    const byId = existing && all.get(existing.channelId);
    const matches = [...all.values()].filter(item =>
        item.type === ChannelType.GuildText &&
        cleanName(item.name) === name
    );

    let channel = byId?.type === ChannelType.GuildText
        ? byId : matches.length === 1 ? matches[0] : null;

    if (!channel && matches.length > 1) {
        console.warn(
            "[Levels] Ambiguous existing channels for " +
            name + ", refusing to make a duplicate."
        );
        return null;
    }

    if (!channel) {
        const bot = await guild.members.fetchMe();
        if (!bot.permissions.has(P.ManageChannels)) {
            throw new Error("Manage Channels permission needed.");
        }

        channel = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            permissionOverwrites,
            reason: "ItamaRos rank system: " + key
        });

        console.log(
            "[Levels] Created #" +
            channel.name + " (" + channel.id + ")."
        );
    }

    return { channel, existing };
}

async function applyOverwrites(guild, channel, tier, roles) {
    const bot = await guild.members.fetchMe();

    if (tier) {
        await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: false,
            SendMessages: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false
        }, { reason: "ItamaRos rank-only channel" });

        await channel.permissionOverwrites.edit(bot.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
        });

        // A high-level rank can visit lower-level rank channels.
        const allowed = new Set([guild.id, bot.id]);
        for (const staffRole of guild.roles.cache.values()) {
            if (staffRole.id !== guild.id &&
                (staffRole.permissions.has(P.ManageGuild) ||
                 staffRole.permissions.has(P.Administrator))) {
                allowed.add(staffRole.id);
                await channel.permissionOverwrites.edit(staffRole.id, {
                    ViewChannel: true, SendMessages: true,
                    ReadMessageHistory: true
                });
            }
        }
        for (const [level, role] of roles) {
            if (level >= tier) {
                allowed.add(role.id);
                await channel.permissionOverwrites.edit(role.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                });
            } else if (channel.permissionOverwrites.cache.has(role.id)) {
                await channel.permissionOverwrites.edit(role.id, {
                    ViewChannel: false,
                    SendMessages: false
                });
            }
        }

        // Clear accidental visibility granted to unrelated roles.
        for (const overwrite of channel.permissionOverwrites.cache.values()) {
            if (allowed.has(overwrite.id)) continue;
            if (overwrite.type === 0 && overwrite.allow.has(P.ViewChannel)) {
                await channel.permissionOverwrites.edit(overwrite.id, {
                    ViewChannel: false
                });
            }
        }

        return;
    }

    // Everyone can see the boost rules; only the bot can speak.
    await channel.permissionOverwrites.edit(guild.id, {
        ViewChannel: true,
        ...messageDenied()
    }, { reason: "ItamaRos: public read-only boost rules" });

    // Existing channel role overwrites may bypass the @everyone
    // read-only restriction. Deny only those that explicitly allow
    // writing, rather than adding a permission overwrite per role
    // (Discord channels are capped at 100 overwrites).
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
        if (overwrite.id === bot.id ||
            overwrite.id === guild.id ||
            overwrite.type !== 0) continue;
        const sends = [
            P.SendMessages, P.SendMessagesInThreads,
            P.CreatePublicThreads, P.CreatePrivateThreads,
            P.AddReactions
        ];
        if (sends.some(permission => overwrite.allow.has(permission))) {
            await channel.permissionOverwrites.edit(
                overwrite.id, messageDenied()
            );
        }
    }

    await channel.permissionOverwrites.edit(bot.id, {
        ViewChannel: true,
        SendMessages: true,
        SendMessagesInThreads: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        AttachFiles: true
    });
}

async function ensureChannels(guild, roles) {
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has(P.ManageChannels)) {
        throw new Error("Manage Channels permission needed.");
    }

    const results = {};
    for (const { tier, name } of CHANNELS) {
        const perms = tierOverwrites(
            guild, bot.id, tier, roles
        );

        const record = await locateOrCreate(
            guild, name, "level-" + tier, perms
        );
        if (!record) continue;

        const { channel, existing } = record;
        await applyOverwrites(guild, channel, tier, roles);

        if (!existing?.introSent) {
            const intro = await channel.send({
                content:
                    "⭐ **ItamaRos Level " + tier + " Members**\n\n" +
                    "This channel is exclusive to Level " + tier +
                    " members and higher ranks.\n\n" +
                    "Use /level to view XP progress and /economy balance " +
                    "to check your coins.",
                allowedMentions: { parse: [] }
            });

            await persistChannel(
                guild, "level-" + tier, channel, intro.id
            );
        } else {
            await persistChannel(
                guild, "level-" + tier, channel
            );
        }

        results[tier] = channel.id;
    }

    const record = await locateOrCreate(
        guild,
        RULES_CHANNEL,
        "boost-rules",
        [
            { id: guild.id, allow: [P.ViewChannel],
                deny: [P.SendMessages, P.AddReactions] },
            { id: bot.id, allow: [
                P.ViewChannel, P.SendMessages,
                P.EmbedLinks, P.AttachFiles
            ] }
        ]
    );

    if (record) {
        await applyOverwrites(
            guild, record.channel, null, roles
        );

        const oldId = record.existing?.introMessageId;
        let msg = oldId
            ? await record.channel.messages.fetch(oldId)
                .catch(() => null)
            : null;

        if (msg?.author?.id === bot.id) {
            await msg.edit({
                content: boostRules(),
                allowedMentions: { parse: [] }
            });
        } else {
            msg = await record.channel.send({
                content: boostRules(),
                allowedMentions: { parse: [] }
            });
        }
        await persistChannel(
            guild, "boost-rules", record.channel,
            msg.id
        );
        results.rules = record.channel.id;
    }

    return results;
}

async function ensureLevelInfrastructure(client) {
    if (setupPromise) return setupPromise;
    setupPromise = (async () => {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const roles = await ensureLevelRoles(guild);
        const channels = await ensureChannels(guild, roles);

        console.log(
            "[Levels] Ready: " + roles.size +
            " roles, " + Object.keys(channels).length +
            " channels."
        );
        return { roles, channels };
    })().catch(error => {
        setupPromise = null;
        throw error;
    });
    return setupPromise;
}

module.exports = {
    ROLE_DEFINITIONS,
    ensureLevelRoles,
    ensureLevelInfrastructure,
    ensureChannels,
    boostRules
};
