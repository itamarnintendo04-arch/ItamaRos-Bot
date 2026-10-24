
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
const {
  connectDatabase
} = require("../database");

// ==========================================
// ITAMAROS BOT - MAIN APPLICATION
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
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

client.commands.set(
  ticketCommand.data.name,
  ticketCommand
);

client.commands.set(
  warnCommand.data.name,
  warnCommand
);

// ==========================================
// IMPORT NEW SYSTEMS
// ==========================================

const {
  handleWordFilter
} = require(
  "./systems/moderation/wordFilter"
);

const {
  handleQuizInteraction
} = require(
  "./systems/dailyQuestion/quiz"
);

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
        <p>Server is running.</p>
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
// LOAD EXISTING EVENTS
// ==========================================

// Keep the original event loader.
// This includes:
// - Ticket interactions
// - Ticket AI mentions
// - Daily Quiz scheduler
// - Channel deletion handling

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
      !event.name ||
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

// Uses fixed words, NOT Gemini AI.
// Runs alongside the existing ticket AI.

client.on(
  Events.MessageCreate,
  message => {
    if (!message.inGuild()) return;
    if (message.author.bot) return;
    if (message.webhookId) return;

    handleWordFilter(message)
      .catch(error => {
        console.error(
          "[Word Filter] Error:",
          error
        );
      });
  }
);

// ==========================================
// DAILY QUIZ INTERACTIONS
// ==========================================

// Handles:
// - Answer Privately button
// - Answer submission form
// - Set Tomorrow's Question button
// - Owner question setup form

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isButton() &&
      !interaction.isModalSubmit()
    ) {
      return;
    }

    if (
      !interaction.customId?.startsWith(
        "dq:"
      )
    ) {
      return;
    }

    try {
      await handleQuizInteraction(
        interaction
      );
    } catch (error) {
      console.error(
        "[Daily Quiz] Interaction error:",
        error
      );

      const payload = {
        content:
          "❌ Something went wrong. " +
          "Please try again.",
        allowedMentions: {
          parse: []
        }
      };

      if (interaction.inGuild()) {
        payload.flags =
          MessageFlags.Ephemeral;
      }

      try {
        if (
          interaction.replied ||
          interaction.deferred
        ) {
          await interaction.followUp(
            payload
          );
        } else {
          await interaction.reply(
            payload
          );
        }
      } catch (replyError) {
        console.error(
          "[Daily Quiz] Reply failed:",
          replyError
        );
      }
    }
  }
);

// ==========================================
// REGISTER SLASH COMMANDS
// ==========================================

// Register commands individually.
// This preserves other existing Discord
// application commands instead of deleting
// them with a bulk overwrite.

async function registerCommands() {
  const rest = new REST({
    version: "10"
  }).setToken(config.DISCORD_TOKEN);

  const route = Routes.applicationGuildCommands(
    config.CLIENT_ID,
    config.GUILD_ID
  );

  console.log(
    "[Commands] Registering slash commands..."
  );

  for (const command of client.commands.values()) {
    const commandData =
      command.data.toJSON();

    // Guild commands are already restricted
    // to the specified server.
    delete commandData.contexts;
    delete commandData.integration_types;

    await rest.post(route, {
      body: commandData
    });

    console.log(
      `[Commands] Registered /${commandData.name}`
    );
  }

  console.log(
    "[Commands] Registration complete!"
  );
}

// ==========================================
// EXECUTE SLASH COMMANDS
// ==========================================

client.on(
  Events.InteractionCreate,
  async interaction => {
    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const command = client.commands.get(
      interaction.commandName
    );

    if (!command) return;

    try {
      await command.execute(
        interaction,
        client
      );
    } catch (error) {
      console.error(
        `[Commands] /${interaction.commandName} failed:`,
        error
      );

      const response = {
        content:
          "❌ An error occurred while " +
          "executing this command.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: {
          parse: []
        }
      };

      try {
        if (
          interaction.deferred ||
          interaction.replied
        ) {
          await interaction.followUp(
            response
          );
        } else {
          await interaction.reply(
            response
          );
        }
      } catch (replyError) {
        console.error(
          "[Commands] Error response failed:",
          replyError
        );
      }
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
      "================================"
    );

    console.log(
      `[Discord] Logged in as ${readyClient.user.tag}`
    );

    console.log(
      "[ItamaRos] Ticket System enabled"
    );

    console.log(
      "[ItamaRos] Ticket AI enabled"
    );

    console.log(
      "[ItamaRos] Word Filter enabled"
    );

    console.log(
      "[ItamaRos] /warn command enabled"
    );

    console.log(
      "[ItamaRos] Daily Quiz enabled"
    );

    console.log(
      "================================"
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
