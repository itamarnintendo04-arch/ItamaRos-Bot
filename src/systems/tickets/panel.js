
const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js");

const { TICKET_TYPES } = require("./config");

/**
 * Builds the main ticket panel.
 */
function buildTicketPanel() {
    const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🎫 Support Center")
        .setDescription(
            [
                "Welcome to our support center!",
                "",
                "Select the type of ticket you want to open from the menu below.",
                "",
                "**Available Ticket Categories:**",
                "",
                "🚨 **Report a member**",
                "Report rule violations or inappropriate behavior.",
                "",
                "🛡️ **Help from management**",
                "Get assistance from our management team.",
                "",
                "🎉 **Giveaway Winner**",
                "Claim your giveaway prize.",
                "",
                "🤝 **Partnership**",
                "Submit a partnership proposal.",
                "",
                "Please provide accurate information when opening a ticket."
            ].join("\n")
        )
        .setFooter({
            text: "ItamaRos Support • We're here to help!"
        })
        .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("ticket_type_select")
        .setPlaceholder("🎫 Select a ticket category")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            Object.values(TICKET_TYPES).map((type) => ({
                label: type.label,
                value: type.id,
                description: getTicketDescription(type.id),
                emoji: type.emoji
            }))
        );

    const row = new ActionRowBuilder()
        .addComponents(selectMenu);

    return {
        embeds: [embed],
        components: [row]
    };
}

/**
 * Returns the description for each ticket category.
 */
function getTicketDescription(typeId) {
    const descriptions = {
        report: "Report a member of the server.",
        management: "Contact the management team.",
        giveaway: "Claim a giveaway prize.",
        partnership: "Submit a partnership proposal."
    };

    return descriptions[typeId] || "Open a support ticket.";
}

module.exports = {
    buildTicketPanel
};
