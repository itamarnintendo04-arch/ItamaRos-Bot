const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const giveawayCommand = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Manage server giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription("Create a new giveaway")
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("The giveaway prize")
                    .setRequired(true)
                    .setMaxLength(200)
            )
            .addStringOption(option =>
                option
                    .setName("duration")
                    .setDescription("Duration: 1M, 1H, 1D or 1W")
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option
                    .setName("winners")
                    .setDescription("Number of winners")
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(20)
            )
            .addChannelOption(option =>
                option
                    .setName("channel")
                    .setDescription("Channel where the giveaway will be posted")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addAttachmentOption(option =>
                option
                    .setName("image")
                    .setDescription("Optional giveaway image")
                    .setRequired(false)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription("End an active giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("cancel")
            .setDescription("Cancel an active giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("The giveaway ID")
                    .setRequired(true)
            )
    );

module.exports = { giveawayCommand };
