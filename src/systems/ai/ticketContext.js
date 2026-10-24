
"use strict";

const { PermissionFlagsBits } = require("discord.js");
const { getTicketType } = require("../tickets/config");

const MAX_MESSAGES = 14;
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

function speakerRole(entry, ticket) {
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
            limit: 35,
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
    const messages = [...collection.values()]
        .filter(entry =>
            entry.author &&
            !entry.author.bot &&
            !entry.webhookId &&
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
        if (used >= 5200) break;

        const messageText = redact(clean(entry.content, 650));
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
            .slice(0, 5200 - used);

        if (!text) continue;

        result.push({
            speaker: speakerRole(entry, ticket),
            text
        });

        used += text.length;
    }

    return result;
}

async function buildTicketContext(message, ticket) {
    return {
        type: ticket.type,
        typeLabel: ticket.typeLabel,
        formAnswers: formContext(ticket),
        recentMessages: await conversationContext(message, ticket)
    };
}

module.exports = {
    buildTicketContext,
    formContext,
    conversationContext
};
