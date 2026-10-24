"use strict";
const { ChannelType, PermissionFlagsBits: P, EmbedBuilder } = require("discord.js");
const { createHash } = require("node:crypto");
const { getDatabase } = require("../../../database");
const NAME = "bot-commands";
let pending;

function db() { return getDatabase().collection("public_command_directory"); }
function isPublic(command) {
    const d = command?.data?.toJSON?.();
    if (!d || d.name === "kings-giveaway") return false;
    const p = d.default_member_permissions;
    return p === undefined || p === null || BigInt(p) === 0n;
}
function entries(commands) {
    const out = [];
    for (const command of commands.values()) {
        if (!isPublic(command)) continue;
        const d = command.data.toJSON();
        let sub = [];
        for (const option of d.options || []) {
            if (option.type === 1) sub.push(option);
            if (option.type === 2) for (const item of option.options || []) {
                if (item.type === 1) sub.push({
                    name: option.name + " " + item.name,
                    description: item.description
                });
            }
        }
        if (!sub.length) sub = [{ name: "", description: d.description }];
        for (const item of sub) out.push({
            name: "/" + d.name + (item.name ? " " + item.name : ""),
            description: item.description || ""
        });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
}
function clean(s, n) {
    return String(s || "").replace(/[\r\n\t]/g, " ")
        .replace(/@/g, "@\u200b").replace(/[<>]/g, "").slice(0, n);
}
function payloads(commands) {
    const list = entries(commands);
    const lines = list.map(x => "• **" + clean(x.name, 85) +
        "** — " + clean(x.description, 110));
    const pages = []; let page = [], size = 0;
    for (const line of lines) {
        if (page.length && size + line.length > 3300) {
            pages.push(page); page = []; size = 0;
        }
        page.push(line); size += line.length + 1;
    }
    if (page.length || !pages.length) pages.push(page);
    return pages.map((group, i) => ({
        embeds: [new EmbedBuilder().setColor(0x8152E8)
            .setTitle(i ? "📖 Public Commands — Continued" :
                "📖 ItamaRos Bot — Public Commands")
            .setDescription((i ? "" :
                "Commands for everyone. Updated automatically.\n\n") +
                (group.join("\n") || "No public commands registered."))
            .setFooter({ text: list.length + " public commands • " +
                (i + 1) + "/" + pages.length })],
        allowedMentions: { parse: [] }
    }));
}
async function getChannel(guild) {
    const channels = await guild.channels.fetch();
    const saved = await db().findOne({ _id: guild.id });
    const known = saved?.channelId && channels.get(saved.channelId);
    if (known?.type === ChannelType.GuildText) return known;
    const matching = [...channels.values()].filter(c =>
        c.type === ChannelType.GuildText && c.name === NAME);
    if (matching.length > 1) throw Error("Duplicate bot-commands channels.");
    if (matching.length === 1) return matching[0];
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) {
        throw Error("Manage Channels permission required.");
    }
    const ch = await guild.channels.create({
        name: NAME, type: ChannelType.GuildText,
        permissionOverwrites: [
            { id: guild.id, allow: [P.ViewChannel, P.ReadMessageHistory],
                deny: [P.SendMessages, P.SendMessagesInThreads,
                    P.CreatePublicThreads, P.CreatePrivateThreads, P.AddReactions] },
            { id: me.id, allow: [P.ViewChannel, P.ReadMessageHistory,
                P.SendMessages, P.EmbedLinks] }
        ],
        reason: "ItamaRos: public commands reference"
    });
    console.log("[Commands Directory] Created #" + NAME + ": " + ch.id);
    return ch;
}
async function lock(ch, guild) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) {
        console.warn("[Commands Directory] Cannot lock channel: missing permission.");
        return;
    }
    const overwrite = ch.permissionOverwrites.cache.get(guild.id);
    const denied = [P.SendMessages, P.SendMessagesInThreads,
        P.CreatePublicThreads, P.CreatePrivateThreads, P.AddReactions];
    if (!overwrite || denied.some(x => !overwrite.deny.has(x)) ||
        !overwrite.allow.has(P.ViewChannel)) {
        await ch.permissionOverwrites.edit(guild.id, {
            ViewChannel: true, ReadMessageHistory: true,
            SendMessages: false, SendMessagesInThreads: false,
            CreatePublicThreads: false, CreatePrivateThreads: false,
            AddReactions: false
        }, { reason: "Read-only public commands" });
    }
    if (!ch.permissionsFor(me)?.has(P.SendMessages) ||
        !ch.permissionsFor(me)?.has(P.EmbedLinks)) {
        await ch.permissionOverwrites.edit(me.id, {
            ViewChannel: true, ReadMessageHistory: true,
            SendMessages: true, EmbedLinks: true
        }, { reason: "Bot manages public commands" });
    }
}
async function publish(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const ch = await getChannel(guild);
    await lock(ch, guild);
    const messages = payloads(client.commands);
    const digest = createHash("sha256").update(JSON.stringify(
        messages.map(m => m.embeds.map(e => e.toJSON()))
    )).digest("hex");
    const old = await db().findOne({ _id: guild.id });
    const ids = old?.channelId === ch.id ? old.messageIds || [] : [];
    const found = await Promise.all(ids.map(id =>
        ch.messages.fetch(id).catch(() => null)));
    if (old?.digest === digest && ids.length === messages.length &&
        found.every(m => m?.author?.id === client.user.id)) return;
    const newIds = [];
    for (let i = 0; i < messages.length; i++) {
        const previous = found[i];
        const msg = previous?.author?.id === client.user.id
            ? await previous.edit(messages[i])
            : await ch.send(messages[i]);
        newIds.push(msg.id);
    }
    for (const m of found.slice(messages.length)) {
        if (m?.author?.id === client.user.id) await m.delete().catch(() => {});
    }
    await db().updateOne({ _id: guild.id }, { $set: {
        channelId: ch.id, messageIds: newIds, digest, updatedAt: new Date()
    } }, { upsert: true });
    console.log("[Commands Directory] Published " +
        entries(client.commands).length + " commands.");
}
async function removeRadioInfo(client) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const all = await guild.channels.fetch();
    const found = [...all.values()].filter(ch =>
        ch.type === ChannelType.GuildText && ch.name === "radio-info");
    if (found.length !== 1) {
        if (found.length > 1) console.warn(
            "[Commands Directory] Multiple radio-info channels; skipped deletion.");
        return;
    }
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(P.ManageChannels)) {
        console.warn("[Commands Directory] Can't remove radio-info.");
        return;
    }
    await found[0].delete("Radio information channel no longer needed");
    await getDatabase().collection("bot_system_channels")
        .deleteOne({ _id: guild.id + ":radio-info" });
    console.log("[Commands Directory] Deleted #radio-info; voice radio retained.");
}
async function sync(client) {
    if (pending) return pending;
    pending = (async () => {
        await publish(client);
        await removeRadioInfo(client);
    })().finally(() => { pending = null; });
    return pending;
}
module.exports = { NAME, isPublic, entries, payloads, publish, removeRadioInfo, sync };
