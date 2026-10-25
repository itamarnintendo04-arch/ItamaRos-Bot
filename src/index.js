
"use strict";

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
  MessageFlags,
  PermissionFlagsBits
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const config = require("../config");
const { connectDatabase } = require("../database");
const {
  handleDashboardRequest,
  isDashboardRequest,
  initializeIndexes: initializeWebSessionIndexes
} = require("./web/discordDashboardAuth");

// ==========================================
// ITAMAROS BOT - MAIN APPLICATION
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Collection();

// ==========================================
// IMPORT COMMANDS
// ==========================================

const ticketCommand = require(
  "./systems/tickets/command"
);

const warnCommand = require(
  "./systems/moderation/warnCommand"
);

const giveawayCommand = require(
  "./systems/giveaways/command"
);

const kingsGiveawayCommand = require("./systems/giveaways/kingsCommand");
const giveawayAdminCommand = require(
  "./systems/giveaways/adminCommand"
);

const activeGiveawaysCommand = require(
  "./systems/giveaways/activeGiveaways"
);

const dropCommand = require(
  "./systems/drops/command"
);

const giveawayTicketCommand = require(
  "./systems/tickets/giveawayCommand"
);

const levelCommand = require("./systems/xp/levelCommand");
const xpCommand = require("./systems/xp/xpCommand");
const invitesCommand = require("./systems/invites/command");
const economyCommand = require("./systems/economy/command");
const shopPanelCommand = require("./systems/economy/panelCommand");
const storeCommand = require("./systems/economy/storeCommand");
const openShopCommand = require("./systems/economy/openShopCommand");
const xpLeaderboardCommand = require("./systems/xp/leaderboardCommand");
const storeAdminCommand = require("./systems/economy/adminCommand");
const radioAdminCommand = require("./systems/radio/adminCommand");
const kingsRankCommand = require("./systems/kings/rankCommand");
const dashboardCommand = require("./systems/dashboard/command");
const quizStreakCommand = require("./systems/dailyQuestion/streakCommand");
const tomorrowQuizCommand = require(
  "./systems/dailyQuestion/tomorrowCommand"
);

// ==========================================
// IMPORT INTERACTION HANDLERS
// ==========================================

const {
  handleGiveawayInteraction
} = require(
  "./systems/giveaways/interactionCreate"
);

const {
  handleDropInteraction
} = require(
  "./systems/drops/interactionCreate"
);

const {
  handleQuizInteraction
} = require(
  "./systems/dailyQuestion/quiz"
);

// ==========================================
// IMPORT OTHER SYSTEMS
// ==========================================

const {
  handleWordFilter
} = require(
  "./systems/moderation/wordFilter"
);

const {
  startGiveawayScheduler
} = require(
  "./systems/giveaways/scheduler"
);

const {
  GIVEAWAY_SETTINGS
} = require(
  "./systems/giveaways/config"
);

const {
  handleCopyGiveawayId
} = require(
  "./systems/giveaways/adminNotifications"
);

const {
  DROP_SETTINGS
} = require(
  "./systems/drops/config"
);

// ==========================================
// REGISTER LOCAL COMMAND HANDLERS
// ==========================================

// Some older command modules export only
// their command data. Their actual execution
// logic is located in interactionCreate.js.

const commandModules = [
  ticketCommand,
  warnCommand,

  {
    data: giveawayCommand.data,
    execute: handleGiveawayInteraction
  },

  giveawayAdminCommand,
  kingsGiveawayCommand,
  activeGiveawaysCommand,

  {
    data: dropCommand.data,
    execute: handleDropInteraction
  },

  giveawayTicketCommand,
  levelCommand,
  xpCommand,
  tomorrowQuizCommand,
  invitesCommand,
  economyCommand,
  openShopCommand,
  storeCommand,
  xpLeaderboardCommand,
  shopPanelCommand,
  storeAdminCommand,
  radioAdminCommand,
  kingsRankCommand,
  dashboardCommand,
  quizStreakCommand
];

for (const command of commandModules) {
  if (
    !command?.data?.name ||
    typeof command.data.toJSON !== "function" ||
    typeof command.execute !== "function"
  ) {
    throw new Error(
      "Invalid command configuration."
    );
  }

  if (client.commands.has(command.data.name)) {
    throw new Error(
      `Duplicate command: ${command.data.name}`
    );
  }

  // Staff commands must be hidden from members without the required permissions.
  const staffOnly = /(?:-admin)$/.test(command.data.name) ||
    ["warn", "kings-giveaway", "giveaway", "drop"].includes(command.data.name);
  if (staffOnly && command.data.setDefaultMemberPermissions &&
      command.data.toJSON().default_member_permissions == null) {
    command.data.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  }

  client.commands.set(
    command.data.name,
    command
  );

  console.log(
    `[Commands] Loaded /${command.data.name}`
  );
}

// ==========================================
// RENDER HTTP SERVER
// ==========================================

const PORT = Number(process.env.SERVER_PORT || process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  if (isDashboardRequest(req)) {
    void handleDashboardRequest(req, res, client).catch(error => {
      console.error("[Web Dashboard] Request error:", error.message);
      if (!res.headersSent) {
        res.writeHead(503, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
      }
      if (!res.writableEnded) {
        res.end("Dashboard is temporarily unavailable.");
      }
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      "Allow": "GET, HEAD"
    });
    res.end("Method not allowed.");
    return;
  }

  // Preserve a lightweight public health-check endpoint for Render.
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end("ItamaRos Bot - Health OK");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>ItamaRos Bot</title></head>' +
    '<body style="background:#100d1e;color:#f5efff;font-family:system-ui;' +
    'display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">' +
    '<main><h1>💜 ItamaRos Bot</h1>' +
    '<p>Discord community bot is running.</p>' +
    '<p><a href="/admin" style="color:#bd9cff">Open secure staff dashboard</a></p>' +
    '</main></body></html>'
  );
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `[HTTP] Listening on port ${PORT}`
  );
});

// ==========================================
// LOAD EXISTING EVENT FILES
// ==========================================

// Keeps the existing ticket event handlers,
// ticket AI, daily quiz and channel events.

const eventsPath = path.join(
  __dirname,
  "events"
);

if (fs.existsSync(eventsPath)) {
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter(file => file.endsWith(".js"));

  for (const file of eventFiles) {
    const event = require(
      path.join(eventsPath, file)
    );

    if (
      !event?.name ||
      typeof event.execute !== "function"
    ) {
      console.warn(
        `[Events] Invalid event: ${file}`
      );

      continue;
    }

    const listener = (...args) => {
      Promise.resolve()
        .then(() =>
          event.execute(...args, client)
        )
        .catch(error => {
          console.error(
            `[Events] Error in ${file}:`,
            error
          );
        });
    };

    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }

    console.log(
      `[Events] Loaded ${file}`
    );
  }
}

// ==========================================
// MULTILINGUAL WORD FILTER
// ==========================================

// Fixed words only.
// Gemini stays in ticket support.

client.on(
  Events.MessageCreate,
  message => {
    if (!message.inGuild()) return;
    if (message.author.bot) return;
    if (message.webhookId) return;

    handleWordFilter(message).catch(error => {
      console.error(
        "[Word Filter] Error:",
        error
      );
    });
  }
);

// ==========================================
// REGISTER DISCORD SLASH COMMANDS
// ==========================================

// Individual upserts avoid deleting unrelated
// commands already registered for the guild.

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(config.DISCORD_TOKEN);

  const route = Routes.applicationGuildCommands(
    config.CLIENT_ID,
    config.GUILD_ID
  );

  console.log(
    "[Commands] Registering all commands..."
  );

  // Retire commands superseded by server automation and the
  // interactive shop. Buyers use the item-store panel and not /store.
  try {
    const existing = await rest.get(route);
    const retired = new Set(["youtube"]);
    for (const legacy of Array.isArray(existing) ? existing : []) {
      if (!retired.has(legacy.name)) continue;
      await rest.delete(
        Routes.applicationGuildCommand(
          config.CLIENT_ID,
          config.GUILD_ID,
          legacy.id
        )
      );
      console.log(
        "[Commands] Removed retired /" + legacy.name + " command."
      );
    }
  } catch (error) {
    console.warn(
      "[Commands] Could not remove retired commands:",
      error.message
    );
  }

  for (const command of client.commands.values()) {
    const data = command.data.toJSON();

    // These are guild commands.
    delete data.contexts;
    delete data.integration_types;

    await rest.post(route, {
      body: data
    });

    console.log(
      `[Commands] Registered /${data.name}`
    );
  }

  console.log(
    `[Commands] ${client.commands.size} commands registered.`
  );
}

// ==========================================
// SHARED INTERACTION ERROR RESPONSE
// ==========================================

async function replyWithError(interaction) {
  const response = {
    content:
      "❌ Something went wrong. Please try again.",
    allowedMentions: {
      parse: []
    }
  };

  try {
    if (interaction.deferred) {
      await interaction.editReply(response);
    } else if (interaction.replied) {
      await interaction.followUp({
        ...response,
        ...(interaction.inGuild()
          ? { flags: MessageFlags.Ephemeral }
          : {})
      });
    } else {
      await interaction.reply({
        ...response,
        ...(interaction.inGuild()
          ? { flags: MessageFlags.Ephemeral }
          : {})
      });
    }
  } catch (error) {
    console.error(
      "[Interactions] Error reply failed:",
      error.message
    );
  }
}

// ==========================================
// HANDLE COMMANDS AND BUTTONS
// ==========================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    try {
      // ----------------------------------
      // SLASH COMMANDS
      // ----------------------------------

      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(
          interaction.commandName
        );

        if (!command) return;

        await command.execute(
          interaction,
          client
        );

        return;
      }

      // ----------------------------------
      // BUTTONS AND MODALS
      // ----------------------------------

      if (
        !interaction.isButton() &&
        !interaction.isModalSubmit()
      ) {
        return;
      }

      const customId = interaction.customId;

      // ----------------------------------
      // DAILY QUIZ
      // ----------------------------------

      if (customId.startsWith("dq:")) {
        await handleQuizInteraction(
          interaction
        );

        return;
      }

      if (!interaction.isButton()) {
        return;
      }

      // ----------------------------------
      // PRIVATE GIVEAWAY MANAGEMENT BUTTON
      // ----------------------------------

      if (customId.startsWith("ga:copy:")) {
        await handleCopyGiveawayId(interaction);
        return;
      }

      // ----------------------------------
      // GIVEAWAY BUTTONS
      // ----------------------------------

      const giveawayButton =
        customId.startsWith(
          `${GIVEAWAY_SETTINGS.JOIN_BUTTON_ID}:`
        ) ||
        customId.startsWith(
          `${GIVEAWAY_SETTINGS.LEAVE_BUTTON_ID}:`
        ) ||
        customId.startsWith(
          "giveaway_rejoin_"
        ) ||
        customId.startsWith(
          "rejoin_"
        );

      if (giveawayButton) {
        await handleGiveawayInteraction(
          interaction
        );

        return;
      }

      // ----------------------------------
      // DROP BUTTONS
      // ----------------------------------

      if (
        customId.startsWith(
          `${DROP_SETTINGS.CLAIM_BUTTON_ID}:`
        )
      ) {
        await handleDropInteraction(
          interaction
        );

        return;
      }

      // Ticket buttons and forms are already
      // handled by src/events/interactionCreate.js.
    } catch (error) {
      console.error(
        "[Interactions] Handler failed:",
        error
      );

      await replyWithError(interaction);
    }
  }
);

// ==========================================
// BOT READY
// ==========================================

client.once(
  Events.ClientReady,
  readyClient => {
    console.log(
      "===================================="
    );

    console.log(
      `[Discord] Logged in as ${readyClient.user.tag}`
    );

    console.log(
      `[Commands] ${client.commands.size} commands loaded`
    );

    console.log(
      "[Systems] Ticket support enabled"
    );

    console.log(
      "[Systems] Ticket AI event loaded"
    );

    console.log(
      "[Systems] Word Filter enabled"
    );

    console.log(
      "[Systems] Daily Quiz event loaded"
    );

    // Automatically finish expired giveaways.
    try {
      startGiveawayScheduler(
        readyClient
      );

      console.log(
        "[Systems] Giveaway Scheduler started"
      );
    } catch (error) {
      console.error(
        "[Giveaways] Scheduler startup failed:",
        error
      );
    }

    console.log(
      "===================================="
    );
  }
);

// ==========================================
// START BOT
// ==========================================

async function start() {
  try {
    console.log(
      "[MongoDB] Connecting..."
    );

    await connectDatabase();

    console.log(
      "[MongoDB] Connected successfully!"
    );
    await initializeWebSessionIndexes().catch(error => {
      console.warn(
        "[Web Dashboard] Session index setup failed:",
        error.message
      );
    });

    await registerCommands();

    console.log(
      "[Discord] Connecting..."
    );

    await client.login(
      config.DISCORD_TOKEN
    );
  } catch (error) {
    console.error(
      "[Startup] Failed:",
      error
    );

    process.exitCode = 1;
    server.close();
  }
}

start();
