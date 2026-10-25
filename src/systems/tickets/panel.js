
"use strict";

const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js");

const { TICKET_TYPES } = require("./config");

/**
 * =====================================================
 * ITAMAROS BOT
 * SUPPORT CENTER PANEL 2.0
 * =====================================================
 *
 * Public support ticket panel.
 *
 * Giveaway winner tickets are not available through
 * the public menu.
 *
 * Winners receive their tickets automatically.
 * Staff-created giveaway tickets use a separate,
 * permission-protected workflow.
 *
 * IMPORTANT:
 * Menu filtering alone is not a security check.
 * Ticket interaction handlers must also enforce
 * giveaway creation permissions.
 * =====================================================
 */

const PANEL_SETTINGS = Object.freeze({
    COLOR: 0x5865F2,

    SELECT_MENU_ID: "ticket_type_select",

    TITLE: "🎫 ITAMAROS SUPPORT CENTER",

    FOOTER: "ItamaRos Bot • Support Center",

    MAX_MENU_OPTIONS: 25
});

const PUBLIC_TICKET_TYPES = Object.freeze([
    TICKET_TYPES.REPORT.id,
    TICKET_TYPES.MANAGEMENT.id,
    TICKET_TYPES.PARTNERSHIP.id,
    TICKET_TYPES.SERVER_QUESTIONS.id,
    TICKET_TYPES.DAILY_QUIZ_HELP.id,
    TICKET_TYPES.BUG_REPORT.id,
    TICKET_TYPES.SUGGESTION.id
]);

const CATEGORY_DESCRIPTIONS = Object.freeze({
    report: {
        title: "🚨 Report a Member",
        description:
            "Report rule violations or inappropriate behavior.",
        menuDescription:
            "Report a member to server staff."
    },

    management: {
        title: "🛡️ Management Support",
        description:
            "Get assistance directly from our management team.",
        menuDescription:
            "Contact the server management team."
    },

    server_questions: { title: "❓ General Server Questions", description: "Ask anything about the server and its rules.", menuDescription: "Ask our team about the server." },
    daily_quiz_help: { title: "🧠 Daily Questions — Help", description: "Questions about the quiz, not prize claims.", menuDescription: "Ask about daily quiz questions." },
    bug_report: { title: "🐛 Bug Reports", description: "Report something that is not working.", menuDescription: "Report a bot or server issue." },
    suggestion: { title: "💡 Suggestions", description: "Share an idea to improve the community.", menuDescription: "Suggest a new improvement." },
    partnership: {
        title: "🤝 Partnerships",
        description:
            "Submit a partnership proposal for your server.",
        menuDescription:
            "Request a server partnership."
    }
});

/**
 * Return only ticket categories available to
 * regular members.
 *
 * Giveaway tickets are intentionally excluded.
 */
function getPublicTicketTypes() {
    const types = Object.values(TICKET_TYPES);

    return types.filter(type => {
        if (!type || typeof type.id !== "string") {
            return false;
        }

        return PUBLIC_TICKET_TYPES.includes(type.id);
    });
}

/**
 * Build the description shown in the main Embed.
 */
function buildPanelDescription() {
    const lines = [
        "## Welcome to ItamaRos Support!",
        "",
        "Need help? Our team is here for you.",
        "",
        "Choose a ticket category using the menu below.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "### 📂 SUPPORT CATEGORIES",
        ""
    ];

    const publicTypes = getPublicTicketTypes();

    for (const type of publicTypes) {
        const category = CATEGORY_DESCRIPTIONS[type.id];

        if (!category) {
            continue;
        }

        lines.push(
            `**${category.title}**`,
            category.description,
            ""
        );
    }

    lines.push(
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "### 🏆 GIVEAWAY WINNERS",
        "",
        "Verified giveaway winners receive a private ticket automatically.",
        "",
        "Please do not create a regular support ticket to claim a giveaway you did not win.",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "### 📋 SUPPORT GUIDELINES",
        "",
        "• Choose the correct ticket category.",
        "• Provide accurate and clear information.",
        "• Be respectful to our support team.",
        "• Wait for a staff member to assist you.",
        "",
        "💜 **Thank you for being part of ItamaRos!**"
    );

    return lines.join("\n");
}

/**
 * Build the panel Embed.
 */
function buildPanelEmbed() {
    return new EmbedBuilder()
        .setColor(PANEL_SETTINGS.COLOR)
        .setTitle(PANEL_SETTINGS.TITLE)
        .setDescription(buildPanelDescription())
        .setFooter({
            text: PANEL_SETTINGS.FOOTER
        })
        .setTimestamp();
}

/**
 * Get the short description for a menu option.
 */
function getTicketDescription(typeId) {
    const category = CATEGORY_DESCRIPTIONS[typeId];

    return category?.menuDescription ||
        "Open a support ticket.";
}

/**
 * Build the public ticket selection menu.
 *
 * Keep the original custom ID so the existing
 * interaction router can recognize this menu.
 */
function buildTicketSelectMenu() {
    const publicTypes = getPublicTicketTypes();

    if (publicTypes.length === 0) {
        throw new Error(
            "[Tickets] No public ticket categories configured."
        );
    }

    if (
        publicTypes.length >
        PANEL_SETTINGS.MAX_MENU_OPTIONS
    ) {
        throw new Error(
            "[Tickets] Too many public ticket categories."
        );
    }

    const options = publicTypes.map(type => ({
        label: type.label,
        value: type.id,
        description: getTicketDescription(type.id),
        emoji: type.emoji
    }));

    return new StringSelectMenuBuilder()
        .setCustomId(PANEL_SETTINGS.SELECT_MENU_ID)
        .setPlaceholder("🎫 Select a support category")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);
}

/**
 * Build the entire ticket panel.
 *
 * Compatible with the existing ticket panel command.
 */
function buildTicketPanel() {
    const embed = buildPanelEmbed();

    const selectMenu = buildTicketSelectMenu();

    const row = new ActionRowBuilder()
        .addComponents(selectMenu);

    return {
        embeds: [embed],
        components: [row],
        allowedMentions: {
            parse: []
        }
    };
}

module.exports = {
    buildTicketPanel,
    buildPanelEmbed,
    buildTicketSelectMenu,
    getPublicTicketTypes,
    getTicketDescription
};
