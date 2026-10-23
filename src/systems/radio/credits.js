
const {
  EmbedBuilder,
  escapeMarkdown,
} = require("discord.js");

const config = require("./config");

const MESSAGE_MARKER = "📌 ItamaRos Radio | Music Credits";

class RadioCredits {
  constructor() {
    this.channel = null;
    this.player = null;
    this.message = null;

    this.updateQueue = Promise.resolve();

    this.onTrackStart = (track) => {
      this.queueUpdate(track);
    };

    this.onStopped = () => {
      this.queueUpdate(null);
    };
  }

  // Prevent Markdown formatting from breaking
  clean(value, fallback = "Unknown") {
    if (typeof value !== "string" || !value.trim()) {
      return fallback;
    }

    return escapeMarkdown(value.trim());
  }

  // Accept only safe http(s) links
  safeUrl(value) {
    if (typeof value !== "string") return null;

    try {
      const url = new URL(value);

      if (
        url.protocol !== "https:" &&
        url.protocol !== "http:"
      ) {
        return null;
      }

      return url.toString();
    } catch {
      return null;
    }
  }

  // Format one track's attribution
  formatTrack(track, index) {
    const title = this.clean(track.title);
    const artist = this.clean(track.artist);

    const license = this.clean(
      track.license,
      "License not specified"
    );

    const source = this.safeUrl(track.source);
    const licenseUrl = this.safeUrl(track.licenseUrl);

    const lines = [
      `**${index + 1}. ${title}**`,
      `Artist: ${artist}`,
      `License: ${license}`,
    ];

    if (source) {
      lines.push(`[Music Source](${source})`);
    }

    if (licenseUrl) {
      lines.push(`[License Terms](${licenseUrl})`);
    }

    return lines.join("\n");
  }

  // Main currently-playing embed
  createNowPlayingEmbed(track) {
    const active = Boolean(track);

    const embed = new EmbedBuilder()
      .setColor(active ? 0x9b59b6 : 0x5865f2)
      .setTitle(
        active
          ? "🎧 NOW PLAYING"
          : "📻 ITAMAROS RADIO"
      )
      .setFooter({
        text: config.credits.footer,
      })
      .setTimestamp();

    if (!active) {
      embed.setDescription(
        "The radio is currently offline or starting.\n" +
        "Music credits are listed below."
      );

      return embed;
    }

    const title = this.clean(track.title);
    const artist = this.clean(track.artist);

    const license = this.clean(
      track.license,
      "Not specified"
    );

    embed
      .setDescription(
        `### 🎵 ${title}\n` +
        `**Artist:** ${artist}\n\n` +
        "🔊 Enjoy the music!"
      )
      .addFields(
        {
          name: "🎼 License",
          value: license,
          inline: true,
        },
        {
          name: "📡 Station",
          value: "ItamaRos Radio",
          inline: true,
        }
      );

    const source = this.safeUrl(track.source);

    if (source) {
      embed.addFields({
        name: "🔗 Original Source",
        value: `[View Track Source](${source})`,
        inline: false,
      });
    }

    return embed;
  }

  // Create an embed containing all song credits
  createCreditsEmbed(tracks) {
    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("📜 Music Credits")
      .setFooter({
        text: `${tracks.length} tracks | ItamaRos Radio`,
      });

    if (tracks.length === 0) {
      return embed.setDescription(
        "No tracks have been loaded yet."
      );
    }

    // Discord limits embed descriptions to
    // 4096 characters.
    const maxDescriptionLength = 3800;

    let description = "";
    let included = 0;

    for (let i = 0; i < tracks.length; i++) {
      const section = this.formatTrack(
        tracks[i],
        i
      );

      const addition = description
        ? `\n\n${section}`
        : section;

      if (
        description.length + addition.length >
        maxDescriptionLength
      ) {
        break;
      }

      description += addition;
      included++;
    }

    if (included < tracks.length) {
      description +=
        `\n\n*${tracks.length - included} more tracks ` +
        "are not displayed in this message.*";
    }

    return embed.setDescription(description);
  }

  // Find the radio's existing pinned message
  async findPinnedMessage(channel) {
    const manager = channel.messages;

    let pinnedMessages;

    if (typeof manager.fetchPins === "function") {
      const result = await manager.fetchPins();

      pinnedMessages = result.items.map(
        (item) => item.message || item
      );
    } else {
      const collection = await manager.fetchPinned();

      pinnedMessages = [...collection.values()];
    }

    const botId = channel.client.user.id;

    return (
      pinnedMessages.find((message) => {
        return (
          message.author?.id === botId &&
          message.content === MESSAGE_MARKER
        );
      }) || null
    );
  }

  // Retrieve or create one message
  async ensureMessage() {
    if (!this.channel) {
      throw new Error(
        "Radio credits channel is not initialized."
      );
    }

    if (this.message) {
      return this.message;
    }

    // Reuse the pinned message after a restart
    const existing = await this.findPinnedMessage(
      this.channel
    );

    if (existing) {
      this.message = existing;
      console.log(
        "[Radio Credits] Reusing pinned message."
      );

      return existing;
    }

    const message = await this.channel.send({
      content: MESSAGE_MARKER,
      embeds: [
        this.createNowPlayingEmbed(null),
      ],
      allowedMentions: {
        parse: [],
      },
    });

    this.message = message;

    if (config.credits.autoPin) {
      try {
        await message.pin(
          "ItamaRos Radio music credits"
        );

        console.log(
          "[Radio Credits] Message pinned."
        );
      } catch (error) {
        console.error(
          "[Radio Credits] Could not pin:",
          error.message
        );
      }
    }

    return message;
  }

  // Update the existing pinned message
  async updateNowPlaying(track) {
    if (!config.credits.enabled) return;

    if (!this.channel || !this.player) return;

    const message = await this.ensureMessage();

    const tracks = this.player.loadTracks();

    const embeds = [
      this.createNowPlayingEmbed(track),
      this.createCreditsEmbed(tracks),
    ];

    await message.edit({
      content: MESSAGE_MARKER,
      embeds,
      allowedMentions: {
        parse: [],
      },
    });

    console.log(
      "[Radio Credits] Updated:",
      track?.title || "Offline"
    );
  }

  // Ensure updates happen in order
  queueUpdate(track) {
    this.updateQueue = this.updateQueue
      .catch(() => {})
      .then(() => this.updateNowPlaying(track))
      .catch((error) => {
        console.error(
          "[Radio Credits] Update failed:",
          error.message
        );

        // Allow recreation if message was deleted
        if (error.code === 10008) {
          this.message = null;
        }
      });

    return this.updateQueue;
  }

  // Start tracking radio events
  async start(channel, radioPlayer) {
    if (!config.credits.enabled) {
      return;
    }

    if (
      !channel ||
      typeof channel.send !== "function" ||
      !channel.messages
    ) {
      throw new Error(
        "Radio credits need a text-enabled voice channel."
      );
    }

    if (
      !radioPlayer ||
      typeof radioPlayer.loadTracks !== "function" ||
      typeof radioPlayer.on !== "function"
    ) {
      throw new Error(
        "A valid RadioPlayer instance is required."
      );
    }

    // Avoid duplicate listeners
    this.detach();

    this.channel = channel;
    this.player = radioPlayer;
    this.message = null;

    radioPlayer.on(
      "trackStart",
      this.onTrackStart
    );

    radioPlayer.on(
      "stopped",
      this.onStopped
    );

    // Show the current song immediately,
    // including after a bot restart.
    const currentTrack = radioPlayer.running
      ? radioPlayer.currentTrack
      : null;

    await this.queueUpdate(currentTrack);

    console.log(
      "[Radio Credits] System initialized."
    );
  }

  // Remove listeners without deleting the pin
  detach() {
    if (this.player) {
      this.player.off(
        "trackStart",
        this.onTrackStart
      );

      this.player.off(
        "stopped",
        this.onStopped
      );
    }

    this.player = null;
    this.channel = null;
    this.message = null;
  }
}

module.exports = new RadioCredits();
module.exports.RadioCredits = RadioCredits;
