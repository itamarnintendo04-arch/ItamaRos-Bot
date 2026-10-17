
const {
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const data = new SlashCommandBuilder()
    .setName("drop")
    .setDescription("Manage server drops")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription("Start a new drop")
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("The drop prize")
                    .setRequired(true)
                    .setMaxLength(200)
            )
            .addChannelOption(option =>
                option
                    .setName("channel")
                    .setDescription("Channel where the drop will be posted")
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addAttachmentOption(option =>
                option
                    .setName("image")
                    .setDescription("Optional drop image")
                    .setRequired(false)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription("Manually end an active drop")
            .addStringOption(option =>
                option
                    .setName("drop_id")
                    .setDescription("The drop ID")
                    .setRequired(true)
            )
    );

module.exports = {
    data
};
