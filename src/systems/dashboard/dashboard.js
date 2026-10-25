"use strict";

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits: P, MessageFlags, ChannelType
} = require("discord.js");
const { getDatabase } = require("../../../database");
const radio = require("../radio/player");
const { getStreakStats } = require("../dailyQuestion/streak");

const SECTIONS = Object.freeze([
    ["overview", "Overview", "📊"], ["xp", "XP & Levels", "⭐"],
    ["kings", "Kings", "👑"], ["shop", "Economy", "🛒"],
    ["giveaways", "Giveaways", "🎉"], ["drops", "Drops", "⚡"],
    ["tickets", "Tickets", "🎫"], ["quiz", "Daily Quiz", "🧠"],
    ["radio", "Radio", "📻"],
    ["invites", "Invites", "🎟️"],
    ["youtube", "YouTube", "📺"],
    ["moderation", "Moderation", "🛡️"],
    ["setup", "Setup", "⚙️"]
]);
const format = n => Number(n || 0).toLocaleString("en-US");
const guildId = () => process.env.GUILD_ID;

function ensureStaff(interaction) {
    return Boolean(interaction.inGuild?.() &&
        interaction.guildId === guildId() &&
        interaction.memberPermissions?.has(P.ManageGuild));
}

async function count(collection, filter = {}) {
    try {
        return await getDatabase().collection(collection).countDocuments(filter);
    } catch (error) {
        console.warn("[Dashboard] Failed to count " + collection + ": " + error.message);
        return null;
    }
}
const outputCount = v => v === null ? "Unavailable" : format(v);

async function stats(guild, section) {
    const id = guild.id;
    if (section === "xp") {
        const [profiles, claims] = await Promise.all([
            count("member_xp", { guildId: id }),
            count("level_milestone_claims", { guildId: id })
        ]);
        return [
            "**XP profiles:** " + outputCount(profiles),
            "**Milestone claims:** " + outputCount(claims),
            "**Progression:** +50 initial XP; requirement doubles every 3/2/1 levels.",
            "**Chat rewards:** 5, 6, 7 XP and growing for eligible messages.",
            "**Commands:** /level, /xp-leaderboard, /xp add/remove/set",
            "**Storage:** MongoDB member_xp"
        ];
    }
    if (section === "kings") {
        const roles = await guild.roles.fetch();
        return [
            "**Kings level roles:** " + roles.filter(role =>
                /^Kings Level [1-5]$/i.test(role.name)).size + "/5",
            "**Categories:** Five private tiers, with cumulative access.",
            "**Managers:** Access every tier.",
            "**Commands:** /kings-rank, /kings-giveaway",
            "**Storage:** bot_system_roles, bot_system_channels"
        ];
    }
    if (section === "shop") {
        const [items, accounts, orders] = await Promise.all([
            count("economy_items", { guildId: id }),
            count("economy_accounts", { guildId: id }),
            count("shop_delivery_orders", { guildId: id })
        ]);
        return [
            "**Catalog products:** " + outputCount(items),
            "**Wallets:** " + outputCount(accounts),
            "**External deliveries:** " + outputCount(orders),
            "**Features:** Shop Packs, XP/coins/roles, staff delivery tickets, Kings-only items.",
            "**Commands:** /shop, /store, /store-admin, /economy",
            "**Storage:** MongoDB economy collections"
        ];
    }
    if (section === "giveaways") {
        const [all, active] = await Promise.all([
            count("giveaways", { guildId: id }),
            count("giveaways", { guildId: id, status: "active" })
        ]);
        return [
            "**Giveaways total:** " + outputCount(all),
            "**Active giveaways:** " + outputCount(active),
            "**Features:** Timed entries, Kings giveaways, winner tickets.",
            "**Commands:** /giveaway, /giveaway-admin, /active-giveaways",
            "**Storage:** MongoDB giveaways"
        ];
    }
    if (section === "drops") {
        const [all, active] = await Promise.all([
            count("drops", { guildId: id }),
            count("drops", { guildId: id, status: "active" })
        ]);
        return [
            "**Drops total:** " + outputCount(all),
            "**Active drops:** " + outputCount(active),
            "**Features:** First-claim winner, instant results.",
            "**Commands:** /drop",
            "**Storage:** MongoDB drops"
        ];
    }
    if (section === "tickets") {
        const [open, closed, prizes] = await Promise.all([
            count("tickets", { guildId: id, status: "open" }),
            count("tickets", { guildId: id, status: "closed" }),
            count("daily_quiz_reward_claims", { guildId: id })
        ]);
        return [
            "**Open tickets:** " + outputCount(open),
            "**Closed tickets:** " + outputCount(closed),
            "**Daily Quiz prize claims:** " + outputCount(prizes),
            "**Forms:** General Server Questions, Daily Quiz Help, Bugs, Suggestions,",
            "Member Reports, Partnerships, Management, verified reward claims.",
            "**Commands:** /ticket, /giveaway-ticket",
            "**Storage:** MongoDB tickets and claim records"
        ];
    }
    if (section === "quiz") {
        const [quizzes, winners, streak] = await Promise.all([
            count("daily_quizzes", { guildId: id }),
            count("daily_quiz_winners", { quizId: { $regex: "^" + id + ":" } }),
            getStreakStats(id)
        ]);
        return [
            "**Prepared quizzes:** " + outputCount(quizzes),
            "**Correct answers recorded:** " + outputCount(winners),
            "**Prize streak:** " + (streak ? streak.status : "Not configured"),
            ...(streak ? [
                "**Streak dates:** " + streak.startDate + " to " + streak.endDate,
                "**Questions prepared:** " + streak.daysPrepared + "/" + streak.days
            ] : []),
            "**Commands:** /quiz-tomorrow, /quiz-streak",
            "**Storage:** MongoDB daily_quizzes, daily_quiz_winners, daily_quiz_streaks"
        ];
    }
    if (section === "invites") {
        return [
            "**Features:** Invite tracking, invite leaderboards, welcome cards.",
            "**Commands:** /invites user, /invites list, /invites top",
            "**Automatic:** Member welcome DM and join information.",
            "**Access:** Server managers only for invite management."
        ];
    }
    if (section === "youtube") {
        return [
            "**Features:** Automatic announcements for videos, Shorts and streams.",
            "**Channel:** #youtube-updates (managed automatically).",
            "**Configuration:** YOUTUBE_CHANNEL_ID and YOUTUBE_API_KEY in Render.",
            "**Privacy:** Provider secrets are never displayed here."
        ];
    }
    if (section === "moderation") {
        return [
            "**Features:** Report tickets, word filtering, moderation logs.",
            "**Commands:** /warn and server management commands.",
            "**Channel:** Private #mod-log.",
            "**Access:** Managers only."
        ];
    }
    if (section === "setup") {
        const channels = await count("bot_system_channels", { guildId: id });
        return [
            "**Managed channels:** " + outputCount(channels),
            "**Server:** " + guild.name,
            "**Identity:** Environment-configured GUILD_ID (private).",
            "**Features:** Channel recovery, command directory, tickets, Kings",
            "levels, giveaways, drops, radio, daily quiz, shop and invites.",
            "**Commands:** /dashboard, /ticket, /shop-panel",
            "**Storage:** MongoDB; deployment: Render Web Service."
        ];
    }
    if (section === "radio") {
        const status = radio.getStatus();
        return [
            "**Voice:** " + (status.connected ? "Connected ✅" : "Disconnected ❌"),
            "**Playback:** " + (status.running ? "Active" : "Stopped"),
            "**Channel:** " + (status.channelId ? "<#" + status.channelId + ">" : "Unresolved"),
            "**Track:** " + (status.currentTrack?.title || "None"),
            "**Commands:** /radio-admin status, /radio-admin restart",
            "**Configuration:** Licensed tracks in assets/radio; 500ms gap"
        ];
    }
    const [xp, tickets, giveaways, drops, accounts, quizzes] = await Promise.all([
        count("member_xp", { guildId: id }),
        count("tickets", { guildId: id, status: "open" }),
        count("giveaways", { guildId: id, status: "active" }),
        count("drops", { guildId: id, status: "active" }),
        count("economy_accounts", { guildId: id }),
        count("daily_quizzes", { guildId: id })
    ]);
    return [
        "**XP members:** " + outputCount(xp),
        "**Wallets:** " + outputCount(accounts),
        "**Open support tickets:** " + outputCount(tickets),
        "**Active giveaways:** " + outputCount(giveaways),
        "**Active drops:** " + outputCount(drops),
        "**Quiz records:** " + outputCount(quizzes),
        "**Radio:** " + (radio.getStatus().connected ? "Online ✅" : "Needs attention ⚠️"),
        "",
        "Select a system below for its status and manager commands.",
        "Only authorized staff can use this dashboard."
    ];
}

function buttons(active) {
    const actions = SECTIONS.map(([id, label, emoji]) =>
        new ButtonBuilder().setCustomId("dash:" + id)
            .setLabel(label).setEmoji(emoji)
            .setStyle(id === active ? ButtonStyle.Primary : ButtonStyle.Secondary));
    actions.push(new ButtonBuilder().setCustomId("dash:refresh")
        .setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Success));
    const rows = [];
    for (let start = 0; start < actions.length; start += 5) {
        rows.push(new ActionRowBuilder().addComponents(...actions.slice(start, start + 5)));
    }
    return rows;
}

async function build(guild, section = "overview") {
    if (!SECTIONS.some(item => item[0] === section)) section = "overview";
    const title = SECTIONS.find(item => item[0] === section);
    const details = await stats(guild, section);
    return {
        embeds: [new EmbedBuilder().setTitle("💜 ItamaRos • Staff Dashboard")
            .setColor(0x8B5CF6)
            .setDescription("**" + title[2] + " " + title[1] + "**\n\n" +
                details.join("\n").slice(0, 3750))
            .setFooter({ text: "Configured test guild • Staff only • MongoDB" })
            .setTimestamp()],
        components: buttons(section),
        allowedMentions: { parse: [] }
    };
}

async function ensureDashboard(client) {
    if (!guildId()) throw Error("GUILD_ID is required for staff dashboard.");
    const guild = await client.guilds.fetch(guildId());
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has(P.ManageChannels)) {
        throw Error("Manage Channels is required for the private dashboard.");
    }
    await guild.roles.fetch();
    const perms = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: bot.id, allow: [
            P.ViewChannel, P.ReadMessageHistory, P.SendMessages,
            P.EmbedLinks, P.ManageMessages, P.ManageChannels] },
        ...guild.roles.cache.filter(role => role.id !== guild.id &&
            (role.permissions.has(P.ManageGuild) ||
             role.permissions.has(P.Administrator))).map(role => ({
                id: role.id, allow: [
                    P.ViewChannel, P.ReadMessageHistory,
                    P.SendMessages, P.EmbedLinks
                ]
            }))
    ].slice(0, 95);
    const entries = await guild.channels.fetch();
    const collection = getDatabase().collection("bot_dashboard");
    const saved = await collection.findOne({ _id: guild.id });
    let channel = entries.get(saved?.channelId);
    if (channel?.type !== ChannelType.GuildText) channel = entries.find(c =>
        c.type === ChannelType.GuildText && c.name === "bot-dashboard");
    if (!channel) {
        channel = await guild.channels.create({
            name: "bot-dashboard", type: ChannelType.GuildText,
            permissionOverwrites: perms,
            reason: "Private ItamaRos test server dashboard"
        });
    } else {
        await channel.permissionOverwrites.set(perms,
            "Ensure the dashboard is visible only to authorized staff");
    }
    const payload = await build(guild);
    let message = saved?.messageId ? await channel.messages.fetch(saved.messageId)
        .catch(() => null) : null;
    if (message?.author?.id === client.user.id) {
        await message.edit(payload);
    } else {
        message = await channel.send(payload);
    }
    await collection.updateOne({ _id: guild.id }, {
        $set: { guildId: guild.id, channelId: channel.id,
            messageId: message.id, updatedAt: new Date() }
    }, { upsert: true });
    return channel;
}

async function interaction(interaction) {
    const id = interaction.customId || "";
    if (!interaction.isButton() || !id.startsWith("dash:")) return false;
    if (!ensureStaff(interaction)) {
        await interaction.reply({ content: "❌ Staff only.",
            flags: MessageFlags.Ephemeral });
        return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const section = id === "dash:refresh" ? "overview" : id.slice(5);
    if (!SECTIONS.some(entry => entry[0] === section)) {
        await interaction.editReply({ content: "Unknown dashboard section." });
        return true;
    }
    await interaction.editReply(await build(interaction.guild, section));
    return true;
}

module.exports = {
    ensureStaff, build, ensureDashboard, interaction, SECTIONS
};
