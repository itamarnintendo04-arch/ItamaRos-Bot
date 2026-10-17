
const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

const data = new SlashCommandBuilder()
    .setName("drop")
    .setDescription("Manage server drops.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(subcommand =>
        subcommand
            .setName("start")
            .setDescription("Create a new drop in this channel.")
            .addStringOption(option =>
                option
                    .setName("prize")
                    .setDescription("The prize for this drop.")
                    .setMaxLength(200)
                    .setRequired(true)
            )
            .addAttachmentOption(option =>
                option
                    .setName("image")
                    .setDescription("Optional image for the drop.")
                    .setRequired(false)
            )
    )

    .addSubcommand(subcommand =>
        subcommand
            .setName("end")
            .setDescription("Manually end an active drop.")
            .addStringOption(option =>
                option
                    .setName("drop_id")
                    .setDescription("The ID of the drop.")
                    .setRequired(true)
            )
    );

module.exports = {
    data
};
