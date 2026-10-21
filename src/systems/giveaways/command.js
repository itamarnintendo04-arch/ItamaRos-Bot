
const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

const { GIVEAWAY_SETTINGS } = require("./config");

const MAX_PRIZE_LENGTH = 200;

const MAX_DURATION_LENGTH = 12;

const DURATION_HELP = [
    "Examples: 30m, 2h, 1d, 1w"
].join(" ");

const data = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription(
        "Create and manage ItamaRos server giveaways"
    )

    // This command is available only inside servers.
    .setDMPermission(false)

    // Discord hides the command from users without
    // Manage Server, but the interaction handler
    // must still verify permissions.
    .setDefaultMemberPermissions(
        PermissionFlagsBits.ManageGuild
    )

    // =============================================
    // /giveaway start
    // =============================================
    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription(
                "Start a giveaway in the current channel"
            )

            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription(
                        "What can participants win?"
                    )
                    .setMinLength(1)
                    .setMaxLength(MAX_PRIZE_LENGTH)
                    .setRequired(true)
            )

            .addStringOption(option =>
                option
                    .setName("duration")
                    .setDescription(DURATION_HELP)
                    .setMinLength(2)
                    .setMaxLength(MAX_DURATION_LENGTH)
                    .setRequired(true)
            )

            .addIntegerOption(option =>
                option
                    .setName("winners")
                    .setDescription(
                        "Number of winners to select"
                    )
                    .setMinValue(1)
                    .setMaxValue(
                        GIVEAWAY_SETTINGS.MAX_WINNERS
                    )
                    .setRequired(true)
            )

            .addAttachmentOption(option =>
                option
                    .setName("image")
                    .setDescription(
                        "Optional image to display in the giveaway"
                    )
                    .setRequired(false)
            )
    )

    // =============================================
    // /giveaway end
    // =============================================
    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription(
                "End an active giveaway and select winners"
            )

            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription(
                        "The ID of the giveaway to end"
                    )
                    .setMinLength(24)
                    .setMaxLength(24)
                    .setRequired(true)
            )
    )

    // =============================================
    // /giveaway cancel
    // =============================================
    .addSubcommand(subcommand =>
        subcommand
            .setName("cancel")
            .setDescription(
                "Cancel an active giveaway without selecting winners"
            )

            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription(
                        "The ID of the giveaway to cancel"
                    )
                    .setMinLength(24)
                    .setMaxLength(24)
                    .setRequired(true)
            )
    );

module.exports = {
    data
};
