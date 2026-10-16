
require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Collection,
    Events,
    REST,
    Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");

const config = require("../config");
const { connectDatabase } = require("../database");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

// =========================
// RENDER HTTP SERVER
// =========================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    res.end(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>ItamaRos Tickets</title>
        </head>
        <body>
            <h1>ItamaRos Tickets</h1>
            <p>Ticket System Web Service</p>
            <p>Web Service is running.</p>
        </body>
        </html>
    `);
});

server.listen(PORT, () => {
    console.log(`[HTTP] Listening on port ${PORT}`);
});

// =========================
// LOAD EVENTS
// =========================

const eventsPath = path.join(__dirname, "events");

if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath)
        .filter(file => file.endsWith(".js"));

    for (const file of eventFiles) {
        const event = require(path.join(eventsPath, file));

        if (!event.name || typeof event.execute !== "function") {
            console.warn(`[Events] Invalid event: ${file}`);
            continue;
        }

        if (event.once) {
            client.once(event.name, (...args) =>
                event.execute(...args, client)
            );
        } else {
            client.on(event.name, (...args) =>
                event.execute(...args, client)
            );
        }

        console.log(`[Events] Loaded ${event.name}`);
    }
}

// =========================
// LOAD TICKET COMMAND
// =========================

const ticketCommand = require("./systems/tickets/command");

client.commands.set(
    ticketCommand.data.name,
    ticketCommand
);

// =========================
// REGISTER SLASH COMMANDS
// =========================

async function registerCommands() {
    if (!config.CLIENT_ID) {
        throw new Error("Missing CLIENT_ID in config.js");
    }

    if (!config.GUILD_ID) {
        throw new Error("Missing GUILD_ID in config.js");
    }

    if (!config.DISCORD_TOKEN) {
        throw new Error("Missing DISCORD_TOKEN in config.js");
    }

    const rest = new REST({ version: "10" })
        .setToken(config.DISCORD_TOKEN);

    const commands = [
        ticketCommand.data.toJSON()
    ];

    console.log("[Commands] Registering slash commands...");

    await rest.put(
        Routes.applicationGuildCommands(
            config.CLIENT_ID,
            config.GUILD_ID
        ),
        { body: commands }
    );

    console.log("[Commands] Successfully registered /ticket");
}

// =========================
// DISPATCH SLASH COMMANDS
// =========================

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error("[Commands] Error:", error);

        const response = {
            content: "❌ An error occurred while executing this command.",
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(response);
        } else {
            await interaction.reply(response);
        }
    }
});

// =========================
// READY EVENT
// =========================

client.once(Events.ClientReady, readyClient => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
});

// =========================
// START
// =========================

async function start() {
    try {
        await connectDatabase();

        console.log("[MongoDB] Connected.");

        await registerCommands();

        await client.login(config.DISCORD_TOKEN);
    } catch (error) {
        console.error("[Startup] Failed:", error);
        process.exit(1);
    }
}

start();
