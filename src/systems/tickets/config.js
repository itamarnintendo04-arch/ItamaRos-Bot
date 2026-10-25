
"use strict";

// ==================================================
// ITAMAROS BOT • TICKET CONFIGURATION 3.0
// ==================================================

// Ticket categories
// Only categories with publicEnabled: true
// may appear in the public support panel.

const TICKET_TYPES = {
    REPORT: {
        id: "report",
        label: "Report a member",
        emoji: "🚨",

        publicEnabled: true,
        claim: true,

        fields: [
            {
                id: "userId",
                label: "Reported User ID",
                style: 1,
                required: true,
                maxLength: 30
            },
            {
                id: "reason",
                label: "Reason for Report",
                style: 2,
                required: true,
                maxLength: 1000
            },
            {
                id: "evidence",
                label: "Evidence (Optional)",
                style: 2,
                required: false,
                maxLength: 500
            }
        ]
    },

    MANAGEMENT: {
        id: "management",
        label: "Help from management",
        emoji: "🛡️",

        publicEnabled: true,
        claim: true,

        fields: [
            {
                id: "subject",
                label: "Subject",
                style: 1,
                required: true,
                maxLength: 100
            },
            {
                id: "description",
                label: "Describe your issue",
                style: 2,
                required: true,
                maxLength: 1000
            }
        ]
    },

    GIVEAWAY: {
        id: "giveaway",
        label: "Giveaway Winner",
        emoji: "🎉",

        // Never show this category publicly.
        publicEnabled: false,

        // Staff handle prize delivery directly.
        claim: false,

        // Used by the giveaway and staff systems.
        automaticCreation: true,
        staffCreation: true,

        // Giveaway tickets must not count towards
        // the normal support ticket limit.
        bypassActiveTicketLimit: true,

        // Retained for compatibility with
        // existing giveaway ticket records.
        // Public modal creation is blocked
        // by forms.js, interactionCreate.js
        // and create.js.
        fields: [
            {
                id: "channel",
                label: "Giveaway Channel",
                style: 1,
                required: true,
                maxLength: 100
            },
            {
                id: "messageId",
                label: "Giveaway Message ID",
                style: 1,
                required: true,
                maxLength: 30
            },
            {
                id: "details",
                label: "Additional Information",
                style: 2,
                required: true,
                maxLength: 1000
            }
        ]
    },

    SERVER_QUESTIONS: {
        id: "server_questions", label: "General Server Questions", emoji: "❓",
        publicEnabled: true, claim: true,
        fields: [
            { id: "question", label: "What is your question about the server?",
              style: 2, required: true, maxLength: 1000 },
            { id: "context", label: "Additional details (optional)",
              style: 2, required: false, maxLength: 1000 }
        ]
    },
    DAILY_QUIZ_HELP: {
        id: "daily_quiz_help", label: "Daily Questions — Help", emoji: "🧠",
        publicEnabled: true, claim: true,
        fields: [
            { id: "question", label: "What is your daily quiz question?",
              style: 2, required: true, maxLength: 1000 },
            { id: "quizDate", label: "Question date (optional)",
              style: 1, required: false, maxLength: 40 }
        ]
    },
    DAILY_QUIZ_REWARD: {
        id: "daily_quiz_reward", label: "Daily Questions — Claim Prize",
        emoji: "🏆", publicEnabled: false, claim: false,
        automaticCreation: true, bypassActiveTicketLimit: true,
        fields: [
            { id: "streak", label: "Completed Daily Quiz Streak",
              style: 1, required: true, maxLength: 100 },
            { id: "details", label: "Reward delivery details",
              style: 2, required: false, maxLength: 1000 }
        ]
    },
    BUG_REPORT: {
        id: "bug_report", label: "Report a Bug", emoji: "🐛",
        publicEnabled: true, claim: true,
        fields: [
            { id: "question", label: "What is not working?",
              style: 2, required: true, maxLength: 1000 },
            { id: "steps", label: "How can we reproduce it?",
              style: 2, required: false, maxLength: 1000 }
        ]
    },
    SUGGESTION: {
        id: "suggestion", label: "Server Suggestion", emoji: "💡",
        publicEnabled: true, claim: true,
        fields: [
            { id: "question", label: "What would you like to suggest?",
              style: 2, required: true, maxLength: 1000 },
            { id: "benefit", label: "How would it improve the server?",
              style: 2, required: false, maxLength: 1000 }
        ]
    },

    PARTNERSHIP: {
        id: "partnership",
        label: "Partnership",
        emoji: "🤝",

        publicEnabled: true,
        claim: true,

        fields: [
            {
                id: "serverName",
                label: "Server Name",
                style: 1,
                required: true,
                maxLength: 100
            },
            {
                id: "invite",
                label: "Permanent Invite Link",
                style: 1,
                required: true,
                maxLength: 200
            },
            {
                id: "members",
                label: "Number of Members",
                style: 1,
                required: true,
                maxLength: 20
            },
            {
                id: "proposal",
                label: "Partnership Proposal",
                style: 2,
                required: true,
                maxLength: 1000
            }
        ]
    }
};

// ==================================================
// GENERAL TICKET SETTINGS
// ==================================================

const TICKET_SETTINGS = {
    // ----------------------------------------------
    // TICKET LIMITS
    // ----------------------------------------------

    // One active REGULAR support ticket per user.
    MAX_ACTIVE_TICKETS: 1,

    // Giveaway tickets can exist alongside
    // regular support tickets.
    GIVEAWAY_BYPASS_TICKET_LIMIT: true,

    // Automatic winner tickets must be identified
    // by giveaway ID + winner ID.
    GIVEAWAY_UNIQUE_PER_WINNER: true,

    // ----------------------------------------------
    // MANAGEMENT PERMISSIONS
    // ----------------------------------------------

    // Primary manager permission.
    ADMIN_PERMISSION: "ManageGuild",

    // Accepted permissions for ticket management.
    ADMIN_PERMISSIONS: [
        "ManageGuild",
        "Administrator"
    ],

    ONLY_MANAGERS_CAN_CLOSE: true,
    ONLY_MANAGERS_CAN_DELETE: true,
    ONLY_MANAGERS_CAN_CLAIM: true,

    // ----------------------------------------------
    // BUTTON CUSTOM IDS
    // ----------------------------------------------

    CLOSE_BUTTON: "ticket_close",
    DELETE_BUTTON: "ticket_delete",
    CLAIM_BUTTON: "ticket_claim",

    CLOSE_REQUEST_BUTTON: "ticket_close_request",
    CLOSE_REQUEST_MODAL: "ticket_close_request_modal",

    CLOSE_REVIEW_PREFIX: "ticket_close_review",

    DELETE_CONFIRM_BUTTON: "ticket_delete_confirm",
    DELETE_CANCEL_BUTTON: "ticket_delete_cancel",

    // ----------------------------------------------
    // CLOSE REQUESTS
    // ----------------------------------------------

    ALLOW_CLOSE_REQUESTS: true,

    // The user may leave their request blank.
    CLOSE_REQUEST_MESSAGE_REQUIRED: false,

    // Staff may also close without a message.
    CLOSURE_MESSAGE_REQUIRED: false,

    REQUIRE_MANAGER_APPROVAL: true,

    // ----------------------------------------------
    // CHANNEL BEHAVIOR
    // ----------------------------------------------

    REUSE_CHANNELS: true,

    KEEP_OLD_MESSAGES: true,

    LOCK_CHANNEL_AFTER_CLOSE: true,

    REQUIRE_CLOSED_BEFORE_DELETE: true,

    // ----------------------------------------------
    // TRANSCRIPTS
    // ----------------------------------------------

    SAVE_TRANSCRIPTS: true,

    SEND_TRANSCRIPT_TO_CLOSING_ADMIN: true,

    REQUIRE_TRANSCRIPT_BEFORE_DELETE: true,

    // ----------------------------------------------
    // NOTIFICATIONS
    // ----------------------------------------------

    SEND_REOPEN_DM: true,
    SEND_CLOSE_DM: true,

    // Discord ephemeral messages are visible
    // only to the user who triggered them.
    USE_EPHEMERAL_RESPONSES: true
};

// ==================================================
// HELPERS
// ==================================================

function getTicketType(typeId) {
    return Object.values(TICKET_TYPES).find(
        type => type.id === typeId
    ) || null;
}

function getPublicTicketTypes() {
    return Object.values(TICKET_TYPES).filter(
        type => type.publicEnabled === true
    );
}

function isPublicTicketType(typeId) {
    return getTicketType(typeId)?.publicEnabled === true;
}

function isAutomaticOnlyTicketType(typeId) {
    return typeId === TICKET_TYPES.GIVEAWAY.id ||
        typeId === TICKET_TYPES.DAILY_QUIZ_REWARD.id;
}

function isGiveawayTicketType(typeId) {
    return typeId === TICKET_TYPES.GIVEAWAY.id;
}

// ==================================================
// EXPORTS
// ==================================================

module.exports = {
    TICKET_TYPES,
    TICKET_SETTINGS,

    getTicketType,
    getPublicTicketTypes,
    isPublicTicketType,
    isGiveawayTicketType,
    isAutomaticOnlyTicketType
};
