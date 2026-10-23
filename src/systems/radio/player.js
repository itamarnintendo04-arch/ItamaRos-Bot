
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
} = require("@discordjs/voice");

const config = require("./config");

class RadioPlayer extends EventEmitter {
  constructor() {
    super();

    this.channel = null;
    this.connection = null;

    this.running = false;
    this.connecting = false;

    this.queue = [];
    this.currentTrack = null;

    this.nextTimer = null;
    this.reconnectTimer = null;

    this.audioPlayer = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.running) {
        this.scheduleNext(300);
      }
    });

    this.audioPlayer.on("error", (error) => {
      console.error("[Radio] Playback error:", error);

      this.emit("playbackError", error);

      if (this.running) {
        this.audioPlayer.stop(true);
        this.scheduleNext(1500);
      }
    });
  }

  // Find every supported music file automatically
  loadTracks() {
    if (!fs.existsSync(config.musicFolder)) {
      console.warn(
        "[Radio] Music folder not found:",
        config.musicFolder
      );

      return [];
    }

    const files = fs.readdirSync(config.musicFolder)
      .filter((file) => {
        const fullPath = path.join(config.musicFolder, file);

        return (
          fs.statSync(fullPath).isFile() &&
          config.supportedFormats.includes(
            path.extname(file).toLowerCase()
          )
        );
      });

    let credits = [];

    if (fs.existsSync(config.tracksFile)) {
      try {
        const json = JSON.parse(
          fs.readFileSync(config.tracksFile, "utf8")
        );

        credits = Array.isArray(json.tracks)
          ? json.tracks
          : [];
      } catch (error) {
        console.error(
          "[Radio] Invalid tracks.json:",
          error.message
        );
      }
    }

    return files.map((file) => {
      const metadata = credits.find(
        (track) => track.file === file
      );

      const fallbackTitle = path.parse(file).name;

      return {
        file,
        path: path.join(config.musicFolder, file),

        title: metadata?.title || fallbackTitle,
        artist: metadata?.artist || "Unknown Artist",

        source: metadata?.source || null,
        license: metadata?.license || null,
        licenseUrl: metadata?.licenseUrl || null,
      };
    });
  }

  // Fisher-Yates shuffle
  shuffleTracks(tracks) {
    const result = [...tracks];

    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [result[i], result[j]] = [
        result[j],
        result[i],
      ];
    }

    return result;
  }

  refreshQueue() {
    const tracks = this.loadTracks();

    if (tracks.length === 0) {
      console.warn("[Radio] No music files available.");
      return false;
    }

    this.queue = config.shuffle
      ? this.shuffleTracks(tracks)
      : tracks;

    // Avoid immediate repetition between cycles
    if (
      this.queue.length > 1 &&
      this.currentTrack?.file === this.queue[0].file
    ) {
      const first = this.queue.shift();
      this.queue.push(first);
    }

    console.log(
      `[Radio] Loaded ${this.queue.length} songs.`
    );

    return true;
  }

  // Connect to the configured Discord voice channel
  async start(channel) {
    if (!channel?.isVoiceBased?.()) {
      throw new Error(
        "A valid Discord voice channel is required."
      );
    }

    if (this.running) {
      console.log("[Radio] Already running.");
      return;
    }

    this.channel = channel;
    this.running = true;

    if (!this.refreshQueue()) {
      this.running = false;
      throw new Error(
        "No playable music files found in assets/radio."
      );
    }

    try {
      await this.connect();

      console.log(
        `[Radio] Started in ${channel.name}`
      );
    } catch (error) {
      this.running = false;
      this.destroyConnection();
      throw error;
    }
  }

  async connect() {
    if (!this.running || this.connecting) return;

    this.connecting = true;

    try {
      this.destroyConnection();

      const connection = joinVoiceChannel({
        channelId: this.channel.id,
        guildId: this.channel.guild.id,
        adapterCreator:
          this.channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });

      this.connection = connection;

      connection.subscribe(this.audioPlayer);

      connection.on(
        VoiceConnectionStatus.Disconnected,
        () => {
          if (!this.running) return;

          console.warn(
            "[Radio] Voice disconnected."
          );

          this.audioPlayer.stop(true);
          this.scheduleReconnect();
        }
      );

      connection.on("error", (error) => {
        console.error(
          "[Radio] Voice connection error:",
          error
        );

        this.emit("connectionError", error);

        if (this.running) {
          this.scheduleReconnect();
        }
      });

      await entersState(
        connection,
        VoiceConnectionStatus.Ready,
        30000
      );

      console.log("[Radio] Voice connection ready.");

      this.clearReconnectTimer();

      if (
        this.running &&
        this.audioPlayer.state.status ===
          AudioPlayerStatus.Idle
      ) {
        this.scheduleNext(100);
      }

      this.emit("connected", this.channel);
    } finally {
      this.connecting = false;
    }
  }

  // Select and play the next song
  playNext() {
    if (!this.running) return;

    if (
      !this.connection ||
      this.connection.state.status !==
        VoiceConnectionStatus.Ready
    ) {
      return;
    }

    if (this.queue.length === 0) {
      if (!config.loop) {
        this.stop();
        return;
      }

      if (!this.refreshQueue()) {
        this.scheduleNext(5000);
        return;
      }
    }

    const track = this.queue.shift();

    if (!track || !fs.existsSync(track.path)) {
      this.scheduleNext(300);
      return;
    }

    try {
      const resource = createAudioResource(
        track.path,
        {
          metadata: track,
          inlineVolume: false,
        }
      );

      this.currentTrack = track;

      this.audioPlayer.play(resource);

      console.log(
        `[Radio] Now playing: ${track.title}`
      );

      // Other modules can use this event
      // to update the pinned credits message.
      this.emit("trackStart", track);
    } catch (error) {
      console.error(
        "[Radio] Could not play track:",
        error
      );

      this.emit("playbackError", error);
      this.scheduleNext(1000);
    }
  }

  scheduleNext(delay = 300) {
    if (!this.running) return;

    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
    }

    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.playNext();
    }, delay);
  }

  scheduleReconnect() {
    if (
      !this.running ||
      !config.autoReconnect ||
      this.reconnectTimer
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;

      if (!this.running) return;

      if (this.connecting) {
        this.scheduleReconnect();
        return;
      }

      try {
        await this.connect();
      } catch (error) {
        console.error(
          "[Radio] Reconnect failed:",
          error.message
        );

        this.scheduleReconnect();
      }
    }, config.reconnectDelayMs);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  destroyConnection() {
    if (!this.connection) return;

    const connection = this.connection;
    this.connection = null;

    connection.removeAllListeners();

    if (
      connection.state.status !==
      VoiceConnectionStatus.Destroyed
    ) {
      connection.destroy();
    }
  }

  // Stop the radio manually
  stop() {
    this.running = false;

    if (this.nextTimer) {
      clearTimeout(this.nextTimer);
      this.nextTimer = null;
    }

    this.clearReconnectTimer();

    this.audioPlayer.stop(true);
    this.destroyConnection();

    this.queue = [];
    this.currentTrack = null;
    this.channel = null;

    console.log("[Radio] Stopped.");
    this.emit("stopped");
  }

  // Skip the current song
  skip() {
    if (!this.running) return false;

    this.audioPlayer.stop(true);
    this.scheduleNext(100);

    return true;
  }

  getStatus() {
    return {
      running: this.running,
      connected:
        this.connection?.state.status ===
        VoiceConnectionStatus.Ready,
      channelId: this.channel?.id || null,
      currentTrack: this.currentTrack,
      queuedTracks: this.queue.length,
    };
  }
}

module.exports = new RadioPlayer();
module.exports.RadioPlayer = RadioPlayer;
