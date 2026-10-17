
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType
} = require("discord.js");

const giveawayCommand = new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Manage server giveaways")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription("Start a new giveaway")
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("What is the prize?")
                    .setRequired(true)
                    .setMaxLength(100)
            )
            .addIntegerOption(option =>
                option
                    .setName("duration")
                    .setDescription("Duration in minutes")
                    .setRequired(true)
                    .setMinValue(1)
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
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription("End an active giveaway")
            .addStringOption(option =>
                option
                    .setName("giveaway_id")
                    .setDescription("Giveaway message ID")
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
                    .setDescription("Giveaway message ID")
                    .setRequired(true)
            )
    );

module.exports = {
    giveawayCommand
};
