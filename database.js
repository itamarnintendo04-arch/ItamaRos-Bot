const { MongoClient } = require("mongodb");

let client;
let database;

async function connectDatabase() {
    if (database) {
        return database;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error(
            "MONGODB_URI environment variable is missing."
        );
    }

    client = new MongoClient(uri);

    await client.connect();

    database = client.db();

    console.log("[MongoDB] Connected successfully.");

    return database;
}

function getDatabase() {
    if (!database) {
        throw new Error(
            "MongoDB has not been connected yet."
        );
    }

    return database;
}

async function disconnectDatabase() {
    if (client) {
        await client.close();

        client = null;
        database = null;

        console.log("[MongoDB] Disconnected.");
    }
}

module.exports = {
    connectDatabase,
    getDatabase,
    disconnectDatabase
};
