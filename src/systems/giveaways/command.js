
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType
} = require("discord.js");

const data = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Manage server giveaways.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription("Start a new giveaway in this channel.")
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("The giveaway prize.")
                    .setMaxLength(200)
                    .setRequired(true)
            )
            .addStringOption(option =>
                option
                    .setName("duration")
                    .setDescription("Duration: 1M, 1H, 1D or 1W.")
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName("winners")
                    .setDescription("Number of winners.")
                    .setMinValue(1)
                    .setMaxValue(20)
                    .setRequired(true)
            )
            .addAttachmentOption(option =>
                option
                    .setName("image")
                    .setDescription("Optional giveaway image.")
                    .setRequired(false)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription("End an active giveaway.")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID.")
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("cancel")
            .setDescription("Cancel an active giveaway.")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID.")
                    .setRequired(true)
            )
    );

module.exports = {
    data
};
