
"use strict";

/**
 * =====================================================
 * ITAMAROS BOT
 * GIVEAWAY SYSTEM CONFIGURATION
 * =====================================================
 *
 * Central configuration for the giveaway system.
 *
 * Keep button IDs, database collection names,
 * and status values stable for existing giveaways.
 *
 * =====================================================
 */

const GIVEAWAY_SETTINGS = Object.freeze({

    // ================================================
    // DATABASE
    // ================================================

    COLLECTION: "giveaways",

    COLLECTIONS: Object.freeze({
        GIVEAWAYS: "giveaways",
        REJOIN_REQUESTS: "giveaway_rejoin_requests",
        WINNER_TICKET_JOBS: "giveaway_winner_ticket_jobs",
        WINNER_NOTIFICATIONS: "giveaway_winner_notifications",
        STAFF_NOTIFICATIONS: "giveaway_staff_notifications"
    }),

    // ================================================
    // BUTTON IDENTIFIERS
    // ================================================

    // Do not rename these IDs while existing
    // giveaway messages are still active.
    JOIN_BUTTON_ID: "giveaway_join",
    LEAVE_BUTTON_ID: "giveaway_leave",

    REJOIN_BUTTONS: Object.freeze({
        APPROVE: "giveaway_rejoin_approve",
        DENY: "giveaway_rejoin_deny"
    }),

    // ================================================
    // GIVEAWAY STATUS
    // ================================================

    STATUS: Object.freeze({
        ACTIVE: "active",
        ENDED: "ended",
        CANCELLED: "cancelled"
    }),

    // ================================================
    // VISUAL DESIGN
    // ================================================

    DEFAULT_COLOR: 0x8B5CF6,

    COLORS: Object.freeze({
        PRIMARY: 0x8B5CF6,
        SUCCESS: 0x22C55E,
        WARNING: 0xF59E0B,
        ERROR: 0xEF4444,
        ENDED: 0x64748B,
        CANCELLED: 0xEF4444,
        INFO: 0x3B82F6
    }),

    BRANDING: Object.freeze({
        NAME: "ItamaRos Bot",
        GIVEAWAY_FOOTER: "ItamaRos Bot • Giveaways",
        WINNER_FOOTER: "ItamaRos Bot • Giveaway Rewards",
        ADMIN_FOOTER: "ItamaRos Bot • Giveaway Management"
    }),

    // ================================================
    // GIVEAWAY LIMITS
    // ================================================

    MIN_DURATION_MINUTES: 1,

    MAX_DURATION_MINUTES: 525600,

    MAX_WINNERS: 20,

    MAX_PRIZE_LENGTH: 200,

    MAX_IMAGE_BYTES: 25 * 1024 * 1024,

    // ================================================
    // PARTICIPATION
    // ================================================

    PARTICIPATION: Object.freeze({
        ALLOW_DUPLICATE_ENTRIES: false,
        REQUIRE_APPROVAL_AFTER_REMOVAL: true,
        SEND_ENTRY_CONFIRMATION_DM: true,
        SEND_WINNER_DM: true
    }),

    // ================================================
    // AUTOMATIC FINALIZATION
    // ================================================

    SCHEDULER: Object.freeze({
        CHECK_INTERVAL_MS: 30 * 1000,
        RECOVERY_INTERVAL_MS: 5 * 60 * 1000,
        RECOVERY_DELAY_MS: 5 * 60 * 1000,
        BATCH_SIZE: 25,
        MAX_FINALIZATION_ATTEMPTS: 4
    }),

    // ================================================
    // WINNER TICKETS
    // ================================================

    // Must match the giveaway ticket type identifier
    // defined in src/systems/tickets/config.js.
    TICKET_TYPE: "giveaway",

    WINNER_TICKETS: Object.freeze({
        AUTO_CREATE: true,
        ALLOW_MANUAL_ADMIN_CREATION: true,
        ALLOW_MANUAL_USER_CREATION: false,
        ONE_TICKET_PER_WINNER_PER_GIVEAWAY: true
    }),

    // ================================================
    // REJOIN APPROVAL
    // ================================================

    REJOIN: Object.freeze({
        REQUIRE_MANAGER_APPROVAL: true,
        AUTO_ADD_AFTER_APPROVAL: true,
        NOTIFY_USER_OF_DECISION: true
    }),

    // ================================================
    // ACTIVE GIVEAWAYS
    // ================================================

    ACTIVE_LIST: Object.freeze({
        PAGE_SIZE: 10,
        MAX_PAGE: 10000,
        SHOW_IMAGE_THUMBNAILS: true
    })

});

module.exports = {
    GIVEAWAY_SETTINGS
};
