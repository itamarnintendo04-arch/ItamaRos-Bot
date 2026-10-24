
"use strict";

const { getDatabase } = require("../../../database");
const { buildTicketContext } = require("./ticketContext");

// ================================================
// ITAMAROS BOT • AI MENTION HANDLER 2.0
// ================================================

const SETTINGS = Object.freeze({
    COOLDOWN_MS: 15000,
    MAX_QUESTION_LENGTH: 1500,
    MAX_RESPONSE_LENGTH: 1800
});

const cooldowns = new Map();
const activeChannels = new Set();

const OUT_OF_SCOPE_MESSAGE = [
    "🛡️ **Server Support Only**",
    "",
    "Sorry! I'm only here to help with the ItamaRos Discord server.",
    "",
    "I can assist with tickets, giveaways, prizes,",
    "partnerships, and other server-related questions.",
    "",
    "Please ask a question related to this server! 💜"
].join("\n");

const SUPPORT_TOPICS = [
    "ticket",
    "support",
    "help",
    "server",
    "discord",
    "giveaway",
    "winner",
    "prize",
    "claim",
    "drop",
    "partnership",
    "partner",
    "report",
    "member",
    "staff",
    "admin",
    "manager",
    "close",
    "delete",
    "xp",
    "level",
    "radio",
    "music",
    "bot",
    "command",
    "invite",
    "role",
    "channel",
    "problem",
    "issue",
    "question",
    "request"
];

const OFF_TOPIC_PATTERNS = [
    /\bgeometry\b/i,
    /\btrigonometry\b/i,
    /\balgebra\b/i,
    /\bcalculus\b/i,
    /\bhomework\b/i,
    /\brecipe\b/i,
    /\bcooking\b/i,
    /\bweather\b/i,
    /\bcapital of\b/i,
    /\bwrite (me )?(a )?(poem|essay|story)\b/i,
    /\bsolve (this|the) equation\b/i
];

// ================================================
// DATABASE
// ================================================

function getTickets() {
    const database = getDatabase();

    if (!database) {
        throw new Error("MongoDB is not connected.");
    }

    return database.collection("tickets");
}

async function findOpenTicket(message) {
    return getTickets().findOne(
        {
            guildId: message.guild.id,
            channelId: message.channel.id,
            status: "open"
        },
        {
            sort: { createdAt: -1 }
        }
    );
}

// ================================================
// QUESTION HELPERS
// ================================================

function removeBotMention(content, botId) {
    const mention = new RegExp(
        `<@!?${botId}>`,
        "g"
    );

    return String(content || "")
        .replace(mention, "")
        .trim();
}

function containsTopic(question) {
    const lower = question.toLowerCase();

    return SUPPORT_TOPICS.some(topic => {
        const pattern = new RegExp(
            `\\b${topic}\\b`,
            "i"
        );

        return pattern.test(lower);
    });
}

function isClearlyOffTopic(question) {
    const explicitlyOffTopic = OFF_TOPIC_PATTERNS.some(
        pattern => pattern.test(question)
    );

    // If the question refers to the server,
    // allow support-related questions.
    if (containsTopic(question)) {
        return false;
    }

    return explicitlyOffTopic;
}

function normalizeResponse(response) {
    return String(response || "")
        .trim()
        .slice(0, SETTINGS.MAX_RESPONSE_LENGTH);
}

// ================================================
// USER MENTION
// ================================================

async function replyToUser(message, response) {
    const userId = message.author.id;

    // Real user mention at the beginning.
    const content = [
        `<@${userId}>`,
        normalizeResponse(response)
    ].join("\n\n");

    return message.reply({
        content,
        allowedMentions: {
            parse: [],
            users: [userId],
            repliedUser: false
        }
    });
}

// ================================================
// COOLDOWN
// ================================================

function getCooldownKey(message) {
    return `${message.guild.id}:${message.author.id}`;
}

function getRemainingCooldown(key) {
    const last = cooldowns.get(key) || 0;

    return Math.max(
        0,
        SETTINGS.COOLDOWN_MS -
        (Date.now() - last)
    );
}

function applyCooldown(key) {
    const now = Date.now();

    cooldowns.set(key, now);

    // Remove expired entries occasionally.
    if (cooldowns.size > 1000) {
        for (const [id, time] of cooldowns) {
            if (now - time > SETTINGS.COOLDOWN_MS) {
                cooldowns.delete(id);
            }
        }
    }
}

// ================================================
// BUILT-IN SUPPORT REPLIES
// ================================================

async function defaultSupportReply({ question }) {
    const text = question.toLowerCase();

    if (
        /\b(giveaway|winner|prize)\b/.test(text)
    ) {
        return [
            "🎉 **Giveaway Support**",
            "",
            "If you won a giveaway, a private winner",
            "ticket should be created automatically.",
            "",
            "Please wait for server management",
            "to help you receive your prize."
        ].join("\n");
    }

    if (/\b(close|closure|delete)\b/.test(text)) {
        return [
            "🔒 **Ticket Closure**",
            "",
            "Click **Close Ticket** to request closure.",
            "",
            "You can include an optional message.",
            "Only server managers can approve",
            "and complete the closure."
        ].join("\n");
    }

    if (/\b(report|evidence)\b/.test(text)) {
        return [
            "🚨 **Report Support**",
            "",
            "Please explain what happened and",
            "provide relevant evidence if available.",
            "",
            "Server management will review your report."
        ].join("\n");
    }

    if (/\b(partner|partnership)\b/.test(text)) {
        return [
            "🤝 **Partnership Support**",
            "",
            "Please explain your partnership proposal.",
            "A server manager will review it."
        ].join("\n");
    }

    if (/\b(xp|level)\b/.test(text)) {
        return [
            "⭐ **XP Support**",
            "",
            "You can earn XP through server activity.",
            "Server managers can help with XP issues."
        ].join("\n");
    }

    if (/\b(radio|music)\b/.test(text)) {
        return [
            "🎵 **Radio Support**",
            "",
            "The server radio feature is being developed.",
            "A manager can provide more information."
        ].join("\n");
    }

    return [
        "🤖 **ItamaRos Support Assistant**",
        "",
        "I can help with server tickets, giveaways,",
        "reports, partnerships, XP, radio, and commands.",
        "",
        "Please describe your server-related issue.",
        "",
        "*Advanced AI responses are not connected yet.*"
    ].join("\n");
}

// ================================================
// FACTORY
// ================================================

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

        if (
            !botId ||
            !message.mentions.users.has(botId)
        ) {
            return false;
        }

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

        // No replies outside active ticket channels.
        if (!ticket) {
            return false;
        }

        const question = removeBotMention(
            message.content,
            botId
        );

        if (!question) {
            await replyToUser(
                message,
                "🤖 Hi! Ask me a question about the ItamaRos server."
            ).catch(() => {});

            return true;
        }

        if (
            question.length >
            SETTINGS.MAX_QUESTION_LENGTH
        ) {
            await replyToUser(
                message,
                "❌ Your question is too long. Please shorten it."
            ).catch(() => {});

            return true;
        }

        const cooldownKey = getCooldownKey(message);

        const remaining = getRemainingCooldown(
            cooldownKey
        );

        if (remaining > 0) {
            await replyToUser(
                message,
                `⏳ Please wait ${Math.ceil(
                    remaining / 1000
                )} seconds before asking again.`
            ).catch(() => {});

            return true;
        }

        const channelId = message.channel.id;

        if (activeChannels.has(channelId)) {
            await replyToUser(
                message,
                "⏳ I'm already answering a question in this ticket."
            ).catch(() => {});

            return true;
        }

        applyCooldown(cooldownKey);
        activeChannels.add(channelId);

        try {
            await message.channel.sendTyping();

            let response;

            if (isClearlyOffTopic(question)) {
                response = OUT_OF_SCOPE_MESSAGE;
            } else {
                response = await generateReply({
                    question,
                    ticket: await buildTicketContext(message, ticket)
                });
            }

            if (!response || !String(response).trim()) {
                throw new Error("EMPTY_AI_RESPONSE");
            }

            // Don't respond if the ticket was closed
            // during processing.
            const latest = await findOpenTicket(
                message
            );

            if (
                !latest ||
                String(latest._id) !== String(ticket._id)
            ) {
                return true;
            }

            await replyToUser(
                message,
                response
            );

            return true;
        } catch (error) {
            console.error(
                "[AI] Mention handler error:",
                error
            );

            await replyToUser(
                message,
                "❌ I couldn't answer right now. Please contact server management."
            ).catch(() => {});

            return true;
        } finally {
            activeChannels.delete(channelId);
        }
    };
}

const handleAiMention = createAiMentionHandler();

module.exports = {
    handleAiMention,
    createAiMentionHandler
};
