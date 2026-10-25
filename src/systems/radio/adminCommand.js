"use strict";

const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    MessageFlags
} = require("discord.js");
const { getDatabase } = require("../../../database");

const radioPlayer = require("./player");
const radio = require("../../events/radioReady");

const data = new SlashCommandBuilder()
    .setName("radio-admin")
    .setDescription("Check or restart the continuous radio stream")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName("status")
        .setDescription("Show the current voice connection and playback state"))
    .addSubcommand(s => s.setName("restart")
        .setDescription("Reconnect to radio and restart the playlist"))
    .addSubcommand(s => s.setName("set-channel")
        .setDescription("Choose the voice channel and connect Radio immediately")
        .addChannelOption(o => o.setName("voice_channel")
            .setDescription("The Discord voice channel where Radio will play")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)));

function describe(state) {
    return [
        "📻 **ItamaRos Radio**",
        "**Player:** " + (state.running ? "Running" : "Stopped"),
        "**Voice connection:** " + (state.connected ? "Connected ✅" : "Disconnected ❌"),
        "**Voice channel:** " + (state.channelId ?
            "<#" + state.channelId + ">" : "Not selected"),
        "**Playing:** " + (state.currentTrack?.title || "No track yet"),
        "**Queued tracks:** " + (state.queuedTracks || 0),
        "**Startup error:** " + (state.lastError || "None")
    ].join("\n").slice(0, 1900);
}

async function execute(interaction) {
    if (!interaction.inGuild() ||
        interaction.guildId !== process.env.GUILD_ID ||
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
            content: "❌ Manage Server permission required.",
            flags: MessageFlags.Ephemeral
        });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const action = interaction.options.getSubcommand();
        if (action === "set-channel") {
            const channel = interaction.options.getChannel("voice_channel", true);
            if (channel.type !== ChannelType.GuildVoice ||
                channel.guildId !== interaction.guildId) {
                throw new Error("Choose a voice channel from this server.");
            }
            const me = await interaction.guild.members.fetchMe();
            const perms = channel.permissionsFor(me);
            const needed = [
                [PermissionFlagsBits.ViewChannel, "View Channel"],
                [PermissionFlagsBits.Connect, "Connect"],
                [PermissionFlagsBits.Speak, "Speak"]
            ];
            const missing = needed.filter(([bit]) => !perms?.has(bit))
                .map(([, label]) => label);
            if (missing.length) {
                throw new Error("Grant the bot " + missing.join(", ") +
                    " in #" + channel.name + " before enabling Radio.");
            }
            await getDatabase().collection("radio_settings").updateOne({
                _id: interaction.guildId
            }, {
                $set: {
                    guildId: interaction.guildId,
                    voiceChannelId: channel.id,
                    configuredBy: interaction.user.id,
                    updatedAt: new Date()
                }
            }, { upsert: true });
            radioPlayer.stop();
            const connected = await radio.startRadio(interaction.client);
            await interaction.editReply({
                content: (connected
                    ? "✅ Radio channel saved and connected to <#" + channel.id + ">."
                    : "⚠️ Channel saved, but the voice connection is still failing.") +
                    "\n" + describe(radio.status()),
                allowedMentions: { parse: [] }
            });
            return;
        }

        if (action === "restart") {
            radioPlayer.stop();
            const connected = await radio.startRadio(interaction.client);
            const state = radio.status();
            await interaction.editReply({
                content: (connected ? "✅ Restart requested.\n" :
                    "⚠️ Radio connection failed. Check the error below.\n") +
                    describe(state),
                allowedMentions: { parse: [] }
            });
            return;
        }
        await interaction.editReply({
            content: describe(radio.status()),
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.error("[Radio Admin] Error:", error);
        await interaction.editReply({
            content: "❌ " + String(error.message || error).slice(0, 250),
            allowedMentions: { parse: [] }
        }).catch(() => {});
    }
}

module.exports = { data, execute };
