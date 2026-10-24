"use strict";

const {
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");
const { getDatabase } = require("../../../database");
const { buildTicketPanel } = require("../tickets/panel");

const DISCORD_ID = /^\d{17,20}$/;
const COLLECTION = "bot_system_channels";
const ROLE_COLLECTION = "bot_system_roles";
const P = PermissionFlagsBits;

const SPECIFICATIONS = Object.freeze([
    {
        key: "welcome", name: "welcome", env: "WELCOME_CHANNEL_ID",
        type: "text", policy: "announcements",
        intro: "💜 **Welcome to ItamaRos!**\n\nNew members get their welcome card, server member count, and invite information here.\n\n🛡️ **For managers:** use /invites user, /invites list and /invites top to review invitations."
    },
    {
        key: "ticket-panel", name: "support-tickets", type: "text",
        policy: "announcements", panel: true,
        intro: "🎫 **ItamaRos Support Center**\n\nChoose a ticket type below to open a private support ticket.\n\n🛡️ **Staff:** /ticket publishes another panel when needed."
    },
    {
        key: "giveaways", name: "giveaways", type: "text",
        policy: "announcements",
        intro: "🎉 **Giveaways**\n\nWinners and prize announcements appear here.\n\n🛡️ **Staff:** /giveaway start opens a giveaway in this channel. /giveaway-admin manages participants. Giveaway IDs are staff-only in mod-log."
    },
    {
        key: "drops", name: "drops", type: "text",
        policy: "announcements",
        intro: "⚡ **Drops**\n\nBe the first to press the claim button to win a drop!\n\n🛡️ **Staff:** /drop start publishes a new drop in this channel."
    },
    {
        key: "shop", name: "item-store", env: "STORE_CHANNEL_ID",
        type: "text", policy: "normal",
        intro: "🛒 **ItamaRos Item Store**\n\nUse /shop to open the public interactive shop. Use /store buy if buttons are unavailable. /store use reports item redemptions to staff.\n\nCheck your coins with /store bank and rankings with /store leaderboard and /xp-leaderboard.\n\n🛡️ Staff: /shop-panel for the command guide, /store-admin for products."
    },
    {
        key: "daily-question", name: "daily-question",
        env: "DAILY_QUESTION_CHANNEL_ID", type: "text",
        policy: "announcements",
        intro: "🧠 **Question of the Day**\n\nA question is posted automatically each day. Use its answer button to participate.\n\n🛡️ **Staff:** set the next question with /quiz-tomorrow."
    },
    {
        key: "youtube-updates", name: "youtube-updates",
        env: "YOUTUBE_UPDATES_CHANNEL_ID",
        aliases: ["DISCORD_UPDATES_CHANNEL_ID"],
        type: "text", policy: "announcements",
        intro: "📺 **YouTube Updates**\n\nNew Shorts, videos and live streams will be announced here automatically, with @everyone on each upload.\n\n🛡️ **Staff:** set YOUTUBE_CHANNEL_ID and YOUTUBE_API_KEY in Render. No Discord setup command is needed."
    },
    {
        key: "mod-log", name: "mod-log", env: "MOD_LOG_CHANNEL_ID",
        aliases: ["GIVEAWAY_ADMIN_CHANNEL_ID"],
        type: "text", policy: "staff",
        intro: "🛡️ **Private Mod Log**\n\nGiveaway IDs and admin-only Copy ID buttons are posted here after /giveaway start.\n\nUse /giveaway-admin info for detailed giveaway management. This channel is for staff only."
    },
    {
        key: "kings-welcome", name: "kings-welcome",
        env: "KINGS_WELCOME_CHANNEL_ID",
        type: "text", policy: "kings",
        intro: "👑 **Welcome to Kings!**\n\nServer boosters receive the Kings role and access to members-only channels.\n\nBoost for **at least 48 hours** to retain the Kings role permanently. If a boost ends earlier, Kings-only access is removed, but earned coins and XP always remain."
    },
    {
        key: "kings-giveaways", name: "kings-giveaways",
        type: "text", policy: "kings",
        intro: "👑🎉 **Kings Giveaways**\n\nPrivate to Kings members.\n\n🛡️ **Staff:** /giveaway start creates a giveaway inside this channel. Only Kings members can access the channel and enter."
    },
    {
        key: "kings-drops", name: "kings-drops",
        type: "text", policy: "kings",
        intro: "👑⚡ **Kings Drops**\n\nExclusive drops for Kings members.\n\n🛡️ **Staff:** /drop start creates a drop inside this private Kings channel."
    },
    {
        key: "kings-shop", name: "kings-shop",
        type: "text", policy: "kings",
        intro: "👑🛒 **Kings Lounge**\n\nA private lounge for Kings members.\n\nUse /store list, /store inventory, and /economy balance. Kings-only products are shown privately to Kings at their required rank. /shop opens your own Kings offers."
    },
    {
        key: "radio", name: "radio",
        env: "RADIO_VOICE_CHANNEL_ID",
        type: "voice", policy: "radio",
        intro: "📻 **ItamaRos Radio**\n\nJoin this voice channel to listen to the radio. Playback starts automatically when the bot has licensed music available."
    }
]);

const CHANNEL_ALIASES = Object.freeze({
    welcome: ["welcome", "welcomes", "ברוכים-הבאים"],
    "ticket-panel": ["support-tickets", "tickets", "ticket", "support",
        "support-center", "ticket-panel", "ticket-support", "טיקטים", "תמיכה"],
    giveaways: ["giveaways", "giveaway", "הגרלות", "הגרלה"],
    drops: ["drops", "drop", "דרופים", "דרופ"],
    shop: ["item-store", "shop", "store", "economy-shop", "coin-shop", "coins",
        "חנות", "חנות-מטבעות"],
    "daily-question": ["daily-question", "daily-quiz", "question-of-the-day",
        "שאלת-היום"],
    "youtube-updates": ["youtube-updates", "youtube-notifications",
        "youtube-feed", "עדכוני-יוטיוב"],
    "mod-log": ["mod-log", "mod-logs", "moderation-log",
        "staff-log", "staff-logs", "לוג-מנהלים"],
    "kings-welcome": ["kings-welcome", "welcome-kings", "king-welcome",
        "ברוכים-הבאים-מלכים"],
    "kings-giveaways": ["kings-giveaways", "king-giveaways", "הגרלות-מלכים"],
    "kings-drops": ["kings-drops", "king-drops", "דרופים-מלכים"],
    "kings-shop": ["kings-shop", "king-shop", "חנות-מלכים"],
    radio: ["radio", "radio-station", "רדיו"]
});

function normalizeChannelName(value) {
    return String(value || "")
        .normalize("NFKC")
        .toLowerCase()
        // Strip emojis/decorations and tolerate bullet separators.
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

function channelNames(spec) {
    return new Set(
        [spec.name, ...(CHANNEL_ALIASES[spec.key] || [])]
            .map(normalizeChannelName)
    );
}

let bootstrapPromise = null;
let bootstrapComplete = false;

function records() {
    return getDatabase().collection(COLLECTION);
}

function roleRecords() {
    return getDatabase().collection(ROLE_COLLECTION);
}

function scopedId(guildId, key) {
    return guildId + ":" + key;
}

function isCompatible(channel, spec, guildId) {
    return Boolean(channel &&
        channel.guildId === guildId &&
        (spec.type === "voice"
            ? channel.type === ChannelType.GuildVoice
            : [ChannelType.GuildText, ChannelType.GuildAnnouncement]
                .includes(channel.type)));
}

function roleValid(role, guildId) {
    if (!role || role.id === guildId || role.managed) return false;
    // Never auto-grant a high-privilege role to a server booster.
    const blocked = [
        P.Administrator, P.ManageGuild, P.ManageRoles,
        P.ManageChannels, P.BanMembers, P.KickMembers,
        P.ManageWebhooks, P.ModerateMembers
    ];
    return blocked.every(permission => !role.permissions.has(permission));
}

async function getKingsRole(guild) {
    await guild.roles.fetch();
    const preferred = process.env.KINGS_ROLE_ID;
    const stored = await roleRecords().findOne({
        _id: scopedId(guild.id, "kings")
    });

    let role = [preferred, stored?.roleId]
        .filter(value => DISCORD_ID.test(String(value || "")))
        .map(id => guild.roles.cache.get(id))
        .find(item => roleValid(item, guild.id));

    if (!role) {
        role = guild.roles.cache.find(item =>
            roleValid(item, guild.id) &&
            item.name.toLowerCase() === "kings"
        );
    }

    if (!role) {
        const bot = await guild.members.fetchMe();
        if (!bot.permissions.has(P.ManageRoles)) {
            console.warn(
                "[Setup] Kings role missing; grant bot Manage Roles to create it."
            );
            return null;
        }

        role = await guild.roles.create({
            name: "Kings",
            color: 0xD6B46D,
            hoist: true,
            mentionable: false,
            permissions: [],
            reason: "ItamaRos auto-setup: server booster Kings role"
        });
        console.log("[Setup] Created Kings role: " + role.id);
    }

    // Apply only for this running process. IDs are also persisted in DB;
    // Render environment values are never modified by this function.
    process.env.KINGS_ROLE_ID = role.id;
    await roleRecords().updateOne(
        { _id: scopedId(guild.id, "kings") },
        {
            $set: {
                guildId: guild.id, roleId: role.id,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );
    return role;
}

async function staffRoleOverwrites(guild) {
    await guild.roles.fetch();
    const matches = guild.roles.cache.filter(role =>
        role.id !== guild.id &&
        (role.permissions.has(P.ManageGuild) ||
         role.permissions.has(P.Administrator))
    );
    return [...matches.values()].slice(0, 85).map(role => ({
        id: role.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages]
    }));
}

async function permissionOverwrites(guild, botId, spec, kingsRole) {
    const bot = {
        id: botId,
        allow: [
            P.ViewChannel,
            P.ReadMessageHistory,
            P.SendMessages,
            P.EmbedLinks,
            P.AttachFiles,
            P.ManageMessages,
            P.MentionEveryone,
            P.Connect,
            P.Speak
        ]
    };

    if (spec.policy === "staff") {
        return [
            { id: guild.id, deny: [P.ViewChannel] },
            bot,
            ...await staffRoleOverwrites(guild)
        ];
    }

    if (spec.policy === "kings") {
        if (!kingsRole) return null;
        return [
            { id: guild.id, deny: [P.ViewChannel] },
            bot,
            {
                id: kingsRole.id,
                allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages]
            },
            ...(await staffRoleOverwrites(guild)).filter(
                entry => entry.id !== kingsRole.id
            )
        ];
    }

    if (spec.policy === "radio") {
        return [
            { id: guild.id, allow: [P.ViewChannel, P.Connect],
                deny: [P.Speak] },
            bot
        ];
    }

    if (spec.policy === "announcements") {
        return [
            { id: guild.id, deny: [P.SendMessages] },
            bot
        ];
    }

    return [bot];
}

function findByNameUnsafe(channels, spec, guildId) {
    const aliases = channelNames(spec);
    for (const channel of channels.values()) {
        if (isCompatible(channel, spec, guildId) &&
            aliases.has(normalizeChannelName(channel.name))) {
            return true;
        }
    }
    return false;
}

function privateEnough(channel, spec, guild, kingsRole) {
    if (spec.policy !== "staff" && spec.policy !== "kings") {
        return true;
    }
    const everyone = channel.permissionsFor(guild.roles.everyone);
    if (!everyone || everyone.has(P.ViewChannel)) return false;
    if (spec.policy === "kings") {
        if (!kingsRole) return false;
        const kings = channel.permissionsFor(kingsRole);
        if (!kings || !kings.has(P.ViewChannel)) return false;
    }
    return true;
}

function matchingChannels(channels, spec, guildId, guild, kingsRole) {
    const aliases = channelNames(spec);
    return [...channels.values()].filter(channel =>
        isCompatible(channel, spec, guildId) &&
        aliases.has(normalizeChannelName(channel.name)) &&
        privateEnough(channel, spec, guild, kingsRole)
    );
}

function findByName(channels, spec, guildId, guild, kingsRole) {
    const matches = matchingChannels(
        channels, spec, guildId, guild, kingsRole
    );

    // Never guess which one is correct when there are duplicates.
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
        console.warn(
            "[Setup] Multiple existing channels look like " +
            spec.key + ": " +
            matches.map(item => item.name + " (" + item.id + ")")
                .join(", ") +
            ". Review them manually; no new channel will be created."
        );
    }
    return null;
}

async function resolveOne(guild, channels, spec, kingsRole) {
    const recordId = scopedId(guild.id, spec.key);
    const saved = await records().findOne({ _id: recordId });
    const ids = [
        process.env[spec.env || "ITAMAROS_UNUSED_KEY"],
        ...(spec.aliases || []).map(key => process.env[key]),
        saved?.channelId
    ].filter(value => DISCORD_ID.test(String(value || "")));

    let channel = ids.map(value => channels.get(value))
        .find(candidate =>
            isCompatible(candidate, spec, guild.id) &&
            privateEnough(candidate, spec, guild, kingsRole)
        );

    if (!channel) {
        channel = findByName(
            channels, spec, guild.id, guild, kingsRole
        );
    }

    let created = false;
    if (!channel) {
        const matches = matchingChannels(
            channels, spec, guild.id, guild, kingsRole
        );
        if (matches.length > 1) {
            console.warn(
                "[Setup] Channel " + spec.key +
                " has ambiguous matches; creation skipped."
            );
            return null;
        }

        const me = await guild.members.fetchMe();
        if (!me.permissions.has(P.ManageChannels)) {
            throw new Error(
                "Manage Channels is required to create #" + spec.name
            );
        }

        const overwrites = await permissionOverwrites(
            guild, me.id, spec, kingsRole
        );
        if (!overwrites) {
            console.warn(
                "[Setup] Private Kings channel deferred until Kings role exists: " +
                spec.name
            );
            return null;
        }

        channel = await guild.channels.create({
            name: (
                spec.policy === "staff" || spec.policy === "kings"
            ) && findByNameUnsafe(channels, spec, guild.id)
                ? spec.name + "-private"
                : spec.name,
            type: spec.type === "voice"
                ? ChannelType.GuildVoice
                : ChannelType.GuildText,
            permissionOverwrites: overwrites,
            reason: "ItamaRos auto-setup: " + spec.key
        });
        channels.set(channel.id, channel);
        created = true;
        console.log("[Setup] Created #" + spec.name + ": " + channel.id);
    }

    // Staff must be able to use Kings channels even without the Kings role.
    // Only add/refresh staff-role overrides; preserve other existing settings.
    if (spec.policy === "kings" && !created) {
        const me = await guild.members.fetchMe();
        if (channel.permissionsFor(me)?.has(P.ManageRoles)) {
            for (const role of await staffRoleOverwrites(guild)) {
                if (role.id === kingsRole?.id) continue;
                await channel.permissionOverwrites.edit(role.id, {
                    ViewChannel: true,
                    ReadMessageHistory: true,
                    SendMessages: true
                }, { reason: "ItamaRos: staff access to Kings channels" })
                    .catch(error => console.warn(
                        "[Setup] Kings staff access failed in " +
                        channel.name + ": " + error.message
                    ));
            }
        }
    }

    // NEVER change existing channel permission overwrites here.
    // A manually created channel retains its owner's configuration.
    if (spec.env) process.env[spec.env] = channel.id;
    for (const alias of spec.aliases || []) {
        if (!process.env[alias]) process.env[alias] = channel.id;
    }

    const needsIntro = created || (
        saved?.autoCreated === true &&
        saved?.introSent !== true
    );

    await records().updateOne(
        { _id: recordId },
        {
            $set: {
                guildId: guild.id,
                key: spec.key,
                channelId: channel.id,
                channelName: channel.name,
                type: spec.type,
                policy: spec.policy,
                autoCreated: created || Boolean(
                    saved?.autoCreated && saved.channelId === channel.id
                ),
                ...(created ? { introSent: false } : {}),
                updatedAt: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true }
    );

    if (needsIntro && spec.type === "text") {
        try {
            const intro = spec.panel
                ? buildTicketPanel()
                : { content: spec.intro, allowedMentions: { parse: [] } };

            const message = await channel.send(intro);

            await records().updateOne(
                { _id: recordId, channelId: channel.id },
                { $set: {
                    introSent: true,
                    introMessageId: message.id,
                    introSentAt: new Date()
                } }
            );
        } catch (error) {
            console.warn(
                "[Setup] Couldn't send intro for #" + spec.name +
                ": " + error.message
            );
        }
    }

    return channel;
}

async function restoreKnownChannels(client) {
    const guildId = process.env.GUILD_ID;
    const guild = await client.guilds.fetch(guildId);
    const channels = new Map(await guild.channels.fetch());
    await guild.roles.fetch();

    const storedRole = await roleRecords().findOne({
        _id: scopedId(guildId, "kings")
    });
    const kingsRole = [
        process.env.KINGS_ROLE_ID,
        storedRole?.roleId
    ]
        .filter(item => DISCORD_ID.test(String(item || "")))
        .map(id => guild.roles.cache.get(id))
        .find(item => roleValid(item, guildId)) ||
        guild.roles.cache.find(item =>
            item.name.toLowerCase() === "kings" &&
            roleValid(item, guildId)
        ) || null;

    if (kingsRole) process.env.KINGS_ROLE_ID = kingsRole.id;

    const results = {};
    for (const spec of SPECIFICATIONS) {
        const stored = await records().findOne({
            _id: scopedId(guildId, spec.key)
        });
        const candidates = [
            process.env[spec.env || "ITAMAROS_UNUSED_KEY"],
            ...(spec.aliases || []).map(key => process.env[key]),
            stored?.channelId
        ].filter(id => DISCORD_ID.test(String(id || "")));

        let channel = candidates.map(id => channels.get(id))
            .find(item => isCompatible(item, spec, guildId) &&
                privateEnough(item, spec, guild, kingsRole));

        if (!channel) {
            channel = findByName(
                channels, spec, guildId, guild, kingsRole
            );
        }
        if (!channel) continue;

        results[spec.key] = channel.id;
        if (spec.env) process.env[spec.env] = channel.id;
        for (const key of spec.aliases || []) {
            if (!process.env[key]) process.env[key] = channel.id;
        }
    }

    console.log(
        "[Setup] Creation paused; restored " +
        Object.keys(results).length +
        " known system channel IDs without creating anything."
    );
    return results;
}

async function runSetup(client) {
    if (process.env.BOT_AUTO_CHANNELS === "false") {
        return restoreKnownChannels(client);
    }

    const guildId = process.env.GUILD_ID;
    if (!DISCORD_ID.test(String(guildId || ""))) {
        throw new Error("Invalid GUILD_ID; cannot set up channels.");
    }

    const guild = await client.guilds.fetch(guildId);
    const loaded = await guild.channels.fetch();
    const channels = new Map(loaded);
    const kingsRole = await getKingsRole(guild).catch(error => {
        console.warn("[Setup] Kings role unavailable:", error.message);
        return null;
    });

    const results = {};
    for (const spec of SPECIFICATIONS) {
        try {
            const channel = await resolveOne(
                guild, channels, spec, kingsRole
            );
            if (channel) results[spec.key] = channel.id;
        } catch (error) {
            console.warn(
                "[Setup] Channel " + spec.key + " failed: " +
                error.message
            );
        }
    }

    console.log(
        "[Setup] Ready: " + Object.keys(results).length +
        " of " + SPECIFICATIONS.length + " system channels."
    );
    return results;
}

async function ensureChannels(client) {
    if (bootstrapComplete) return bootstrapPromise;

    if (!bootstrapPromise) {
        bootstrapPromise = runSetup(client).then(result => {
            bootstrapComplete = true;
            return result;
        }).catch(error => {
            bootstrapPromise = null;
            throw error;
        });
    }

    return bootstrapPromise;
}

// Manual deletion or later permission changes can be reconciled
// without restarting the entire bot.
let refreshPromise = null;
async function refreshChannels(client) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
        if (bootstrapPromise) {
            await bootstrapPromise.catch(() => {});
        }
        bootstrapComplete = false;
        bootstrapPromise = null;
        return ensureChannels(client);
    })().finally(() => {
        refreshPromise = null;
    });
    return refreshPromise;
}

module.exports = {
    SPECIFICATIONS,
    normalizeChannelName,
    restoreKnownChannels,
    getKingsRole,
    permissionOverwrites,
    resolveOne,
    runSetup,
    ensureChannels,
    refreshChannels
};
