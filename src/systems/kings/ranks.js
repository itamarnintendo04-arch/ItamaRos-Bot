"use strict";

const { ChannelType, PermissionFlagsBits: P } = require("discord.js");
const { getDatabase } = require("../../../database");
const { XP_PER_LEVEL } = require("../xp/service");

// Kings ranks are separate from general XP reward roles.
// Every 200 activity XP unlocks another Kings tier, up to tier five.
const RANKS = Object.freeze([
    { tier: 1, requiredXp: 0, color: 0xB6A1FF, category: "👑 KINGS",
      channels: ["lounge", "news", "help"] },
    { tier: 2, requiredXp: 200, color: 0x84D7FF, category: "👑 KINGS • LEVEL 2",
      channels: ["strategy-lv2", "events-lv2", "giveaways-lv2"] },
    { tier: 3, requiredXp: 400, color: 0x71E7C0, category: "👑 KINGS • LEVEL 3",
      channels: ["drops-lv3", "edits-lv3", "requests-lv3"] },
    { tier: 4, requiredXp: 600, color: 0xFFD580, category: "👑 KINGS • LEVEL 4",
      channels: ["shop-lv4", "royal-events-lv4", "rewards-lv4"] },
    { tier: 5, requiredXp: 800, color: 0xFF9FD0, category: "👑 KINGS • LEVEL 5",
      channels: ["royal-lounge-lv5", "premium-events-lv5", "vip-perks-lv5"] }
]);
const MAX_RANK = RANKS.length;
const safeId = id => /^\d{17,20}$/.test(String(id || ""));
const roleTable = () => getDatabase().collection("bot_system_roles");
const channelsTable = () => getDatabase().collection("bot_system_channels");
let infrastructurePromise = null;
const synchronizing = new Map();

function tierForXp(xp) {
    return Math.min(MAX_RANK, Math.max(1, 1 + Math.floor(Math.max(0, xp) / 200)));
}

function staffRole(role, guild) {
    return role.id !== guild.id &&
        !role.managed &&
        (role.permissions.has(P.ManageGuild) ||
         role.permissions.has(P.Administrator));
}

async function baseKingsRole(guild) {
    await guild.roles.fetch();
    const saved = await roleTable().findOne({ _id: guild.id + ":kings" });
    const candidates = [process.env.KINGS_ROLE_ID, saved?.roleId];
    for (const id of candidates) {
        if (safeId(id) && guild.roles.cache.has(id)) return guild.roles.cache.get(id);
    }
    return guild.roles.cache.find(role =>
        role.name.toLowerCase() === "kings" && !role.managed
    ) || null;
}

async function ensureRankRoles(guild) {
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has(P.ManageRoles)) {
        throw new Error("Bot needs Manage Roles to maintain Kings level roles.");
    }
    await guild.roles.fetch();
    const roles = new Map();
    for (const definition of RANKS) {
        const key = guild.id + ":kings-level-" + definition.tier;
        const saved = await roleTable().findOne({ _id: key });
        let role = saved?.roleId && guild.roles.cache.get(saved.roleId);
        if (!role || role.managed || role.id === guild.id) {
            role = guild.roles.cache.find(item =>
                item.name.toLowerCase() === ("Kings Level " + definition.tier).toLowerCase() &&
                !item.managed
            );
        }
        if (!role) {
            role = await guild.roles.create({
                name: "Kings Level " + definition.tier,
                color: definition.color,
                hoist: true,
                mentionable: false,
                permissions: [],
                reason: "ItamaRos Kings five-level rank system"
            });
        }
        if (role.permissions.has(P.ManageGuild) ||
            role.permissions.has(P.Administrator)) {
            throw new Error("Unsafe permissions on Kings Level " + definition.tier);
        }
        if (bot.roles.highest.position <= role.position) {
            throw new Error("Move the bot role above Kings Level " + definition.tier);
        }
        roles.set(definition.tier, role);
        await roleTable().updateOne({ _id: key }, {
            $set: { guildId: guild.id, tier: definition.tier, roleId: role.id,
                updatedAt: new Date() }
        }, { upsert: true });
    }
    return roles;
}

function rankOverwrites(guild, botId, baseRole, roles, minimum) {
    const permissions = [P.ViewChannel, P.ReadMessageHistory,
        P.SendMessages, P.EmbedLinks, P.AttachFiles];
    const allowed = new Map([
        [guild.id, { id: guild.id, deny: [P.ViewChannel] }],
        [botId, { id: botId, allow: [
            ...permissions, P.ManageChannels, P.ManageMessages
        ] }]
    ]);
    if (minimum === 1 && baseRole) {
        allowed.set(baseRole.id, { id: baseRole.id, allow: permissions });
    }
    for (const [tier, role] of roles) {
        allowed.set(role.id, tier >= minimum
            ? { id: role.id, allow: permissions }
            : { id: role.id, deny: [P.ViewChannel] });
    }
    for (const role of guild.roles.cache.values()) {
        if (staffRole(role, guild)) {
            allowed.set(role.id, { id: role.id, allow: permissions });
        }
    }
    return [...allowed.values()];
}

async function persistChannel(guild, key, channel, extra = {}) {
    await channelsTable().updateOne({ _id: guild.id + ":" + key }, {
        $set: { guildId: guild.id, key, channelId: channel.id,
            channelName: channel.name, updatedAt: new Date(), ...extra }
    }, { upsert: true });
}

async function ensureRankChannels(guild, baseRole, roles) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) {
        throw new Error("Bot needs Manage Channels for Kings categories.");
    }
    const cache = await guild.channels.fetch();
    for (const definition of RANKS) {
        const tier = definition.tier;
        const categoryKey = "kings-level-" + tier + "-category";
        const savedCategory = await channelsTable().findOne({
            _id: guild.id + ":" + categoryKey
        });
        let category = cache.get(savedCategory?.channelId);
        if (category?.type !== ChannelType.GuildCategory) {
            category = cache.find(channel =>
                channel.type === ChannelType.GuildCategory &&
                channel.name === definition.category
            );
        }
        const overwrites = rankOverwrites(
            guild, me.id, baseRole, roles, tier
        );
        if (!category) {
            category = await guild.channels.create({
                name: definition.category,
                type: ChannelType.GuildCategory,
                permissionOverwrites: overwrites,
                reason: "Kings level " + tier + " private category"
            });
            cache.set(category.id, category);
        } else {
            await category.permissionOverwrites.set(overwrites,
                "Sync Kings level " + tier + " access and staff permissions");
        }
        await persistChannel(guild, categoryKey, category, { tier, type: "category" });

        for (const name of definition.channels) {
            const key = "kings-level-" + tier + "-" + name;
            const saved = await channelsTable().findOne({
                _id: guild.id + ":" + key
            });
            let channel = cache.get(saved?.channelId);
            if (channel?.type !== ChannelType.GuildText) {
                channel = cache.find(item =>
                    item.type === ChannelType.GuildText &&
                    item.parentId === category.id && item.name === name
                );
            }
            let created = false;
            if (!channel) {
                channel = await guild.channels.create({
                    name,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    permissionOverwrites: overwrites,
                    topic: "Kings level " + tier + "+ • Higher levels keep access",
                    reason: "Kings level " + tier + " exclusive area"
                });
                cache.set(channel.id, channel);
                created = true;
            } else {
                // Re-synchronize channel permissions to its tier category.
                if (channel.parentId !== category.id) {
                    await channel.setParent(category.id, { lockPermissions: true });
                } else {
                    await channel.lockPermissions();
                }
            }
            if (created) {
                await channel.send({
                    content: "👑 **Kings Level " + tier + "**\n\n" +
                        "Welcome to " + name + "! This channel is available " +
                        "to Kings Level " + tier + " and higher. " +
                        "Higher ranks always keep access to lower-rank channels.\n\n" +
                        (tier === 1
                            ? "Explore the lounge and community help channels."
                            : "Your Kings rank has unlocked extra benefits and spaces."),
                    allowedMentions: { parse: [] }
                }).catch(error => console.warn("[Kings Ranks] Intro failed:", error.message));
            }
            await persistChannel(guild, key, channel, {
                tier, parentId: category.id, type: "text"
            });
        }
    }
}

async function ensureRankInfrastructure(client, { refresh = false } = {}) {
    if (infrastructurePromise && !refresh) return infrastructurePromise;
    if (infrastructurePromise && refresh) {
        await infrastructurePromise.catch(() => {});
    }
    infrastructurePromise = (async () => {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const baseRole = await baseKingsRole(guild);
        if (!baseRole) {
            throw new Error("Base Kings role missing. Run automatic setup first.");
        }
        const roles = await ensureRankRoles(guild);
        await ensureRankChannels(guild, baseRole, roles);
        console.log("[Kings Ranks] Five level roles and categories ready.");
        return { guild, baseRole, roles };
    })().catch(error => {
        infrastructurePromise = null;
        throw error;
    });
    return infrastructurePromise;
}

async function getMemberTier(member, baseRole) {
    if (!member?.roles.cache.has(baseRole.id)) return 0;
    const record = await getDatabase().collection("member_xp").findOne({
        _id: member.guild.id + ":" + member.id
    });
    // Milestone rewards award bonus XP. Only activity/staff XP
    // progresses the Kings ladder so a milestone cannot skip ranks.
    const earned = Math.max(0, Number(record?.activityXp ??
        (record?.xp || 0) - (record?.bonusXpAwarded || 0)) || 0);
    return tierForXp(earned);
}

async function syncMemberRank(member, { infrastructure = null } = {}) {
    if (!member || member.user?.bot ||
        member.guild?.id !== process.env.GUILD_ID) return 0;
    const key = member.guild.id + ":" + member.id;
    if (synchronizing.has(key)) return synchronizing.get(key);
    const work = (async () => {
        const setup = infrastructure || await ensureRankInfrastructure(member.client);
        const current = await member.guild.members.fetch({
            user: member.id, force: true
        });
        const tier = await getMemberTier(current, setup.baseRole);
        const nextRole = tier ? setup.roles.get(tier) : null;
        const bot = await member.guild.members.fetchMe();

        if (nextRole && !current.roles.cache.has(nextRole.id)) {
            if (nextRole.position >= bot.roles.highest.position) {
                throw new Error("Bot role must be above " + nextRole.name);
            }
            await current.roles.add(nextRole, "Kings promoted to Level " + tier);
        }
        const previous = [...setup.roles.values()].filter(role =>
            role.id !== nextRole?.id && current.roles.cache.has(role.id)
        );
        if (previous.length) {
            await current.roles.remove(previous,
                tier ? "Kings rank replaced by Level " + tier : "Kings membership ended");
        }
        return tier;
    })().finally(() => synchronizing.delete(key));
    synchronizing.set(key, work);
    return work;
}

module.exports = {
    RANKS, MAX_RANK, tierForXp, baseKingsRole,
    ensureRankRoles, ensureRankChannels, ensureRankInfrastructure,
    getMemberTier, syncMemberRank
};
