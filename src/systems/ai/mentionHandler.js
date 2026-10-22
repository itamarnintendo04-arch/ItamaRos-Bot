
"use strict";

const { getDatabase } = require("../../../database");

// ==================================================
// ITAMAROS BOT • AI MENTION HANDLER 1.0
// ==================================================

const SETTINGS = Object.freeze({
    COOLDOWN_MS: 12000,
    MAX_QUESTION_LENGTH: 1500,
    MAX_REPLY_LENGTH: 1800,
    MAX_TRACKED_USERS: 1000
});

const cooldowns = new Map();
const processingChannels = new Set();

// ==================================================
// DATABASE
// ==================================================

function getTicketsCollection() {
    const database = getDatabase();

    if (!database) {
        throw new Error("MongoDB is not connected.");
    }

    return database.collection("tickets");
}

// ==================================================
// HELPERS
// ==================================================

function cleanQuestion(content, botId) {
    return String(content || "")
        .replace(
            new RegExp(`<@!?${botId}>`, "g"),
            ""
        )
        .trim();
}

function cleanReply(content) {
    return String(content || "")
        .trim()
        .replace(/@everyone/g, "@\u200beveryone")
        .replace(/@here/g, "@\u200bhere")
        .slice(0, SETTINGS.MAX_REPLY_LENGTH);
}

function isOnCooldown(userId) {
    const lastRequest = cooldowns.get(userId);

    if (!lastRequest) {
        return false;
    }

    return Date.now() - lastRequest <
        SETTINGS.COOLDOWN_MS;
}

function registerCooldown(userId) {
    if (cooldowns.size >= SETTINGS.MAX_TRACKED_USERS) {
        const now = Date.now();

        for (const [id, timestamp] of cooldowns) {
            if (
                now - timestamp >
                SETTINGS.COOLDOWN_MS
            ) {
                cooldowns.delete(id);
            }
        }

        if (cooldowns.size >= SETTINGS.MAX_TRACKED_USERS) {
            const oldest = cooldowns.keys().next().value;

            if (oldest) {
                cooldowns.delete(oldest);
            }
        }
    }

    cooldowns.set(userId, Date.now());
}

async function findOpenTicket(message) {
    return getTicketsCollection().findOne(
        {
            guildId: message.guild.id,
            channelId: message.channel.id,
            status: "open"
        },
        {
            sort: {
                createdAt: -1
            }
        }
    );
}

async function replySafely(message, content) {
    return message.reply({
        content,
        allowedMentions: {
            parse: [],
            repliedUser: false
        }
    });
}

// ==================================================
// TEMPORARY SUPPORT ASSISTANT
// ==================================================

// This is a temporary response engine.
// It works without an external API.
//
// Later, a compatible AI provider can replace
// this function through createAiMentionHandler().

async function defaultSupportReply({ question, ticket }) {
    const text = question.toLowerCase();

    if (
        text.includes("giveaway") ||
        text.includes("prize") ||
        text.includes("winner")
    ) {
        return [
            "🎉 **Giveaway Support**",
            "",
            "If you won a giveaway, server management will help you claim your prize.",
            "",
            "Please wait for an authorized staff member.",
            "Never share your password or verification codes."
        ].join("\n");
    }

    if (
        text.includes("close") ||
        text.includes("delete ticket")
    ) {
        return [
            "🔒 **Ticket Closure**",
            "",
            "Only server managers can close tickets.",
            "",
            "To request closure, click **Close Ticket** and then **Request Closure**.",
            "",
            "You can include an optional message."
        ].join("\n");
    }

    if (
        text.includes("report") ||
        text.includes("evidence")
    ) {
        return [
            "🚨 **Report Support**",
            "",
            "Please provide a clear explanation of the issue.",
            "",
            "Include relevant evidence if you have any.",
            "A server manager will review your report."
        ].join("\n");
    }

    if (
        text.includes("partnership") ||
        text.includes("partner")
    ) {
        return [
            "🤝 **Partnership Support**",
            "",
            "Please explain your partnership proposal.",
            "",
            "A server manager will review your request."
        ].join("\n");
    }

    if (
        text.includes("claim") &&
        ticket.type !== "giveaway"
    ) {
        return [
            "🛡️ **Ticket Claim**",
            "",
            "The Claim Ticket feature allows a server manager to take responsibility for a support ticket.",
            "",
            "Please wait for staff assistance."
        ].join("\n");
    }

    return [
        "🤖 **ItamaRos Support Assistant**",
        "",
        "I can help with:",
        "• Giveaway questions",
        "• Ticket closure requests",
        "• Member reports",
        "• Partnerships",
        "• Ticket management",
        "",
        "For other questions, a server manager can assist you.",
        "",
        "*Advanced AI responses are not enabled yet.*"
    ].join("\n");
}

// ==================================================
// HANDLER FACTORY
// ==================================================

// Provide a custom generateReply function later
// when we connect an eligible AI provider.
//
// generateReply receives:
// {
//     question: string,
//     ticket: {
//         type: string,
//         typeLabel: string
//     }
// }
//
// It must return a string.

function createAiMentionHandler(options = {}) {
    const generateReply =
        typeof options.generateReply === "function"
            ? options.generateReply
            : defaultSupportReply;

    return async function handleAiMention(message) {
        if (!message?.guild || !message?.author) {
            return false;
        }

        if (message.author.bot || message.webhookId) {
            return false;
        }

        const botId = message.client.user?.id;

        if (!botId) {
            return false;
        }

        // The message must mention ItamaRos Bot.
        if (!message.mentions.users.has(botId)) {
            return false;
        }

        // Prevent responding in unrelated channels.
        let ticket;

        try {
            ticket = await findOpenTicket(message);
        } catch (error) {
            console.error(
                "[AI] Ticket lookup failed:",
                error
            );

            return false;
        }

        if (!ticket) {
            return false;
        }

        const question = cleanQuestion(
            message.content,
            botId
        );

        if (!question) {
            await replySafely(
                message,
                "🤖 Hi! Mention me with a question and I'll try to help you."
            ).catch(() => {});

            return true;
        }

        if (
            question.length >
            SETTINGS.MAX_QUESTION_LENGTH
        ) {
            await replySafely(
                message,
                "❌ Your question is too long. Please send a shorter message."
            ).catch(() => {});

            return true;
        }

        const userId = message.author.id;
        const channelId = message.channel.id;

        if (isOnCooldown(userId)) {
            await replySafely(
                message,
                "⏳ Please wait a few seconds before asking another question."
            ).catch(() => {});

            return true;
        }

        if (processingChannels.has(channelId)) {
            await replySafely(
                message,
                "⏳ I'm already answering another question in this ticket."
            ).catch(() => {});

            return true;
        }

        registerCooldown(userId);
        processingChannels.add(channelId);

        try {
            await message.channel.sendTyping();

            // Only the current question and ticket
            // category are sent to the response engine.
            // We do not forward the full private
            // ticket conversation automatically.
            const response = await generateReply({
                question,
                ticket: {
                    type: ticket.type,
                    typeLabel:
                        ticket.typeLabel ||
                        ticket.type
                }
            });

            const text = cleanReply(response);

            if (!text) {
                throw new Error("EMPTY_AI_RESPONSE");
            }

            // Avoid replying if a staff member
            // closed the ticket during processing.
            const latestTicket =
                await findOpenTicket(message);

            if (
                !latestTicket ||
                String(latestTicket._id) !==
                String(ticket._id)
            ) {
                return true;
            }

            await replySafely(message, text);

            return true;
        } catch (error) {
            console.error(
                "[AI] Support assistant error:",
                error
            );

            await replySafely(
                message,
                "❌ I couldn't process your question. Please try again later or contact server management."
            ).catch(() => {});

            return true;
        } finally {
            processingChannels.delete(channelId);
        }
    };
}

// Default handler — currently uses the
// built-in support responses.
const handleAiMention = createAiMentionHandler();

module.exports = {
    handleAiMention,
    createAiMentionHandler
};
