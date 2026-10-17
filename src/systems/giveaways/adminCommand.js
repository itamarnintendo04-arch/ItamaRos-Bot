const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");

const {
    getGiveawayEntrants,
    removeGiveawayParticipant
} = require("./admin");

const adminGiveawayCommand = new SlashCommandBuilder()
    .setName("giveaway-admin")
    .setDescription("Manage giveaway participants")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(subcommand =>
        subcommand
            .setName("entrants")
            .setDescription("View giveaway participants")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("remove")
            .setDescription("Remove a participant from a giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
            .addUserOption(option =>
                option
                    .setName("user")
                    .setDescription("The participant to remove")
                    .setRequired(true)
            )
    );

async function handleAdminGiveawayCommand(interaction) {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "giveaway-admin") return;

    if (!interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    )) {
        return interaction.reply({
            content: "❌ Administrator permissions are required.",
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const giveawayId = interaction.options.getString("giveaway_id");

    if (subcommand === "entrants") {
        const result = await getGiveawayEntrants(giveawayId);

        if (!result.success) {
            return interaction.editReply({
                content: "❌ Giveaway not found."
            });
        }

        const participants = result.participants;

        const embed = new EmbedBuilder()
            .setColor(0x8B5CF6)
            .setTitle("🎉 Giveaway Participants")
            .setDescription(
                participants.length
                    ? participants.map((id, index) =>
                        `**${index + 1}.** <@${id}>`
                    ).join("\n")
                    : "No participants yet."
            )
            .addFields({
                name: "Total Entries",
                value: String(result.count),
                inline: true
            });

        return interaction.editReply({
            embeds: [embed]
        });
    }

    if (subcommand === "remove") {
        const user = interaction.options.getUser("user");

        const result = await removeGiveawayParticipant(
            giveawayId,
            user.id
        );

        if (!result.success) {
            return interaction.editReply({
                content: "❌ User is not participating, or the giveaway was not found or has ended."
            });
        }

        return interaction.editReply({
            content: `✅ <@${user.id}> was removed from the giveaway. They must request administrator approval before rejoining.`
        });
    }
}

module.exports = {
    adminGiveawayCommand,
    handleAdminGiveawayCommand
};
