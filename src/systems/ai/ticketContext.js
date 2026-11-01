
"use strict";

const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getTicketType, getPublicTicketTypes } = require("../tickets/config");

const MAX_MESSAGES = 30;
const MAX_HISTORY_CHARS = 9500;
const MAX_FORM_CHARS = 3000;

function clean(value, limit = 650) {
    return String(value ?? "")
        .replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), " ")
        .trim()
        .slice(0, limit);
}

function redact(value) {
    return String(value)
        .replace(
            /(password|secret|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi,
            "$1: [REDACTED]"
        )
        .replace(
            /mfa\.[A-Za-z0-9_-]{20,}/g,
            "[REDACTED CREDENTIAL]"
        );
}

function formContext(ticket) {
    const type = getTicketType(ticket?.type);
    const values = ticket?.answers;

    if (!values || typeof values !== "object" ||
        Array.isArray(values)) {
        return [];
    }

    const names = new Map(
        (type?.fields || []).map(field => [field.id, field.label])
    );

    const output = [];
    let chars = 0;

    for (const [key, value] of Object.entries(values)) {
        if (output.length >= 8 || chars >= MAX_FORM_CHARS) break;
        if (typeof value !== "string" &&
            typeof value !== "number") continue;

        const name = clean(names.get(key) || key, 80);
        const hidden = /password|secret|token|api.?key/i.test(key);
        const answer = hidden
            ? "[REDACTED PRIVATE CREDENTIAL]"
            : redact(clean(value, 800));

        const excerpt = answer.slice(0, MAX_FORM_CHARS - chars);

        if (excerpt) {
            output.push({ field: name, answer: excerpt });
            chars += excerpt.length;
        }
    }

    return output;
}

function speakerRole(entry, ticket, botId) {
    if (entry.author.id === botId) return "AI assistant";

    if (entry.author.id === ticket.userId) {
        return "Ticket opener";
    }

    if (
        entry.author.id === ticket.claimedBy ||
        entry.author.id === entry.guild?.ownerId ||
        entry.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
        entry.member?.permissions?.has(PermissionFlagsBits.Administrator)
    ) {
        return "Server manager";
    }

    return "Ticket participant";
}

async function conversationContext(message, ticket) {
    if (!message.channel?.messages?.fetch) return [];

    let collection;
    try {
        collection = await message.channel.messages.fetch({
            limit: 90,
            before: message.id
        });
    } catch (error) {
        console.warn(
            "[Ticket AI] History unavailable:",
            error.message
        );
        return [];
    }

    const startedAt = new Date(ticket.createdAt).getTime();
    const botId = message.client.user?.id;
    const messages = [...collection.values()]
        .filter(entry =>
            entry.author &&
            !entry.webhookId &&
            (
                !entry.author.bot ||
                (
                    entry.author.id === botId &&
                    entry.reference?.messageId &&
                    /^<@!?\\d+>\\s*\\n/.test(entry.content || "")
                )
            ) &&
            (
                !Number.isFinite(startedAt) ||
                entry.createdTimestamp >= startedAt
            )
        )
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .slice(-MAX_MESSAGES);

    let used = 0;
    const result = [];

    for (const entry of messages) {
        if (used >= MAX_HISTORY_CHARS) break;

        const messageText = redact(clean(
            entry.author.id === botId
                ? entry.content.replace(/^<@!?\d+>\s*/, "")
                : entry.content,
            700
        ));
        const attachmentNames = [...entry.attachments.values()]
            .slice(0, 3)
            .map(file => clean(file.name || "attachment", 70));

        const attachmentText = attachmentNames.length
            ? "[Attachments: " + attachmentNames.join(", ") +
              "; file contents not read]"
            : "";

        const text = [messageText, attachmentText]
            .filter(Boolean)
            .join(" ")
            .slice(0, MAX_HISTORY_CHARS - used);

        if (!text) continue;

        result.push({
            speaker: speakerRole(entry, ticket, botId),
            text
        });

        used += text.length;
    }

    return result;
}

// Share only read-only, public server information. Never enumerate
// private support tickets, staff rooms, or role-restricted channels.
function serverContext(message) {
    const guild = message.guild;
    const everyone = guild?.roles?.everyone;
    const publicChannels = [...(guild?.channels?.cache?.values() || [])]
        .filter(channel =>
            channel?.type === ChannelType.GuildText &&
            everyone &&
            channel.permissionsFor?.(everyone)?.has(PermissionFlagsBits.ViewChannel) &&
            channel.permissionsFor?.(message.member)?.has(PermissionFlagsBits.ViewChannel)
        )
        .sort((a, b) => a.position - b.position)
        .slice(0, 25)
        .map(channel => clean(channel.name, 75));

    return {
        name: clean(guild?.name || "ItamaRos", 100),
        description: clean(guild?.description || "", 300),
        memberCount: Number.isFinite(guild?.memberCount) ? guild.memberCount : null,
        publicChannels,
        ticketCategories: getPublicTicketTypes().map(type => type.label),
        knownFeatures: [
            "Support tickets and staff assistance",
            "Giveaways and winner tickets",
            "Drops, XP and levels",
            "Daily questions and streaks",
            "Coins, shop and store items",
            "Kings ranks and roles",
            "Invites and member welcoming",
            "Server radio"
        ]
    };
}

async function buildTicketContext(message, ticket) {
    return {
        type: ticket.type,
        typeLabel: ticket.typeLabel,
        formAnswers: formContext(ticket),
        recentMessages: await conversationContext(message, ticket),
        server: serverContext(message)
    };
}

module.exports = {
    buildTicketContext,
    formContext,
    conversationContext,
    serverContext
};
