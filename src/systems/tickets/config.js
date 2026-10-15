
const TICKET_TYPES = {
    REPORT: {
        id: "report",
        label: "Report a member",
        emoji: "🚨",
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
        claim: false,
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

    PARTNERSHIP: {
        id: "partnership",
        label: "Partnership",
        emoji: "🤝",
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

const TICKET_SETTINGS = {
    MAX_ACTIVE_TICKETS: 1,

    ADMIN_PERMISSION: "Administrator",

    CLOSE_BUTTON: "ticket_close",
    DELETE_BUTTON: "ticket_delete",
    CLAIM_BUTTON: "ticket_claim",

    REUSE_CHANNELS: true,
    KEEP_OLD_MESSAGES: true,

    SAVE_TRANSCRIPTS: true,
    SEND_TRANSCRIPT_TO_CLOSING_ADMIN: true,

    SEND_REOPEN_DM: true,
    SEND_CLOSE_DM: true
};

module.exports = {
    TICKET_TYPES,
    TICKET_SETTINGS
};
