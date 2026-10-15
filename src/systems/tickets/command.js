const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");
const {
    buildTicketPanel
} = require("./panel");
const data = new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Post the ticket support panel.")
    .setDefaultMemberPermissions(
        PermissionFlagsBits.Administrator
    );
async function execute(interaction) {
    if (
        !interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return interaction.reply({
            content: "❌ Only administrators can use this command.",
            ephemeral: true
        });
    }
    await interaction.deferReply({
        ephemeral: true
    });
    try {
        const panel = buildTicketPanel();
        await interaction.channel.send(panel);
        return interaction.editReply({
            content: "✅ The ticket panel has been posted successfully."
        });
    } catch (error) {
        console.error("Ticket panel error:", error);
        return interaction.editReply({
            content: "❌ Failed to post the ticket panel."
        });
    }
}
module.exports = {
    data,
    execute
};
