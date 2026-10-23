
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "../../..");

const radioConfig = {
  // Discord voice channel
  voiceChannelId: process.env.RADIO_VOICE_CHANNEL_ID || null,

  // Local music files
  musicFolder: path.join(ROOT_DIR, "assets", "radio"),

  // Track metadata and licensing credits
  tracksFile: path.join(ROOT_DIR, "assets", "radio", "tracks.json"),

  // Supported audio formats
  supportedFormats: [".mp3", ".wav", ".ogg", ".flac", ".m4a"],

  // Playback settings
  shuffle: true,
  loop: true,
  autoJoin: true,
  autoReconnect: true,

  // Reconnection settings
  reconnectDelayMs: 5000,

  // Discord voice channel chat
  credits: {
    enabled: true,
    autoPin: true,
    updateNowPlaying: true,
    title: "📻 ItamaRos Radio | Music Credits",
    footer: "Powered by ItamaRos Bot 🎧",
  },
};

module.exports = radioConfig;
