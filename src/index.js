
"use strict";

require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
  MessageFlags
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const config = require("../config");
const { connectDatabase } = require("../database");

// ==========================================
// ITAMAROS BOT - MAIN APPLICATION
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
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
  activeGiveawaysCommand,

  {
    data: dropCommand.data,
    execute: handleDropInteraction
  },

  giveawayTicketCommand,
  levelCommand,
  xpCommand,
  tomorrowQuizCommand
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

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8"
  });

  res.end(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        >
        <title>ItamaRos Bot</title>
      </head>
      <body>
        <h1>💜 ItamaRos Bot</h1>
        <p>Discord Bot Web Service</p>
        <p>Service is running.</p>
      </body>
    </html>
  `);
});

server.listen(PORT, () => {
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
