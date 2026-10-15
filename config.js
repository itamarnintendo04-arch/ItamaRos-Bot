require("dotenv").config();
const requiredVariables = [
    "DISCORD_TOKEN",
    "CLIENT_ID",
    "GUILD_ID",
    "MONGODB_URI"
];
for (const variable of requiredVariables) {
    if (!process.env[variable]) {
        throw new Error(
            `Missing environment variable: ${variable}`
        );
    }
}
module.exports = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    MONGODB_URI: process.env.MONGODB_URI
};
