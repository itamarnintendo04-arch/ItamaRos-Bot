"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { PermissionFlagsBits: P } = require("discord.js");

const databasePath = require.resolve("../database");
const dashboardPath = require.resolve("../src/systems/dashboard/dashboard");
const authPath = require.resolve("../src/web/discordDashboardAuth");
const originals = new Map([
    [databasePath, require.cache[databasePath]],
    [dashboardPath, require.cache[dashboardPath]],
    [authPath, require.cache[authPath]]
]);
const originalEnv = {
    CLIENT_ID: process.env.CLIENT_ID,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
    DASHBOARD_REDIRECT_URI: process.env.DASHBOARD_REDIRECT_URI,
    GUILD_ID: process.env.GUILD_ID
};
const previousFetch = global.fetch;

process.env.CLIENT_ID = "123456789012345678";
process.env.GUILD_ID = "987654321098765432";
process.env.DISCORD_CLIENT_SECRET = "test-secret-not-real";
process.env.DASHBOARD_REDIRECT_URI =
    "https://demo.example/admin/callback";

const tables = new Map();
function table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const rows = tables.get(name);
    return {
        createIndex: async () => "ttl_index",
        insertOne: async doc => {
            if (rows.has(doc._id)) throw Error("duplicate");
            rows.set(doc._id, doc);
        },
        findOne: async query => {
            const record = rows.get(query._id);
            if (!record) return null;
            if (query.guildId && record.guildId !== query.guildId) {
                return null;
            }
            if (query.expiresAt?.$gt &&
                !(record.expiresAt > query.expiresAt.$gt)) return null;
            return record;
        },
        findOneAndDelete: async query => {
            const doc = rows.get(query._id);
            if (!doc || !(doc.expiresAt > query.expiresAt.$gt)) return null;
            rows.delete(query._id);
            return doc;
        },
        deleteOne: async query => rows.delete(query._id)
    };
}
function stub(id, exports) {
    require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub(databasePath, {
    getDatabase: () => ({ collection: table })
});
stub(dashboardPath, {
    SECTIONS: [["overview", "Overview", "📊"]],
    build: async () => ({
        embeds: [{ data: { description:
            "**Private dashboard:** 7 open tickets" } }]
    })
});
delete require.cache[authPath];
const auth = require("../src/web/discordDashboardAuth");

let authorized = true;
const guild = {
    id: process.env.GUILD_ID,
    name: 'ItamaRos <Test>',
    ownerId: "222222222222222222",
    members: {
        fetch: async ({ user, force, cache }) => {
            assert.equal(force, true);
            assert.equal(cache, false);
            assert.equal(user, "111111111111111111");
            return { permissions: {
                has: flag => authorized &&
                    (flag === P.ManageGuild || flag === P.Administrator)
            } };
        }
    }
};
const client = {
    isReady: () => true,
    guilds: { fetch: async id => {
        assert.equal(id, process.env.GUILD_ID);
        return guild;
    } }
};
function req(method, url, cookie = "", body = "") {
    return {
        method, url, headers: { cookie },
        async *[Symbol.asyncIterator]() {
            if (body) yield Buffer.from(body);
        }
    };
}
function res() {
    return {
        status: null, headers: {}, body: "",
        headersSent: false, writableEnded: false,
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
            this.headersSent = true;
        },
        end(body = "") {
            this.body = String(body);
            this.writableEnded = true;
        }
    };
}
async function visit(method, url, cookie = "", body = "") {
    const output = res();
    const handled = await auth.handleDashboardRequest(
        req(method, url, cookie, body), output, client);
    assert.equal(handled, true);
    assert.equal(output.writableEnded, true);
    return output;
}
function rawCookie(value) {
    return Array.isArray(value) ? value.map(x => x.split(";")[0])
        : [value.split(";")[0]];
}
let exchanged = 0;
global.fetch = async (url, options) => {
    if (String(url).endsWith("/oauth2/token")) {
        exchanged++;
        assert.equal(options.method, "POST");
        assert.match(String(options.headers.Authorization), /^Basic /);
        return { ok: true, json: async () => ({
            access_token: "short-test-token", token_type: "Bearer"
        }) };
    }
    if (String(url).endsWith("/users/@me")) {
        assert.equal(options.headers.Authorization, "Bearer short-test-token");
        return { ok: true, json: async () => ({
            id: "111111111111111111", username: "verified_manager",
            global_name: "Verified Manager"
        }) };
    }
    throw Error("Unexpected external request");
};

test("requires Discord OAuth, blocks login CSRF, and revalidates roles", async () => {
    let result = await visit("GET", "/admin");
    assert.equal(result.status, 200);
    assert.match(result.body, /Continue with Discord/);
    assert.doesNotMatch(result.body, /7 open tickets/);

    result = await visit("GET", "/admin/login");
    assert.equal(result.status, 303);
    const url = new URL(result.headers.Location);
    assert.equal(url.hostname, "discord.com");
    assert.equal(url.searchParams.get("scope"), "identify");
    const stateCookie = rawCookie(result.headers["Set-Cookie"])[0];
    assert.match(result.headers["Set-Cookie"], /HttpOnly; SameSite=Lax/);
    assert.match(result.headers["Set-Cookie"], /Secure/);

    const params = url.searchParams;
    const invalid = await visit("GET",
        "/admin/callback?state=not-the-same&code=not-a-code",
        stateCookie);
    assert.equal(invalid.status, 400);
    assert.equal(exchanged, 0);

    const callback = await visit("GET",
        "/admin/callback?code=sample-code&state=" +
        encodeURIComponent(params.get("state")) +
        "&iss=https%3A%2F%2Fdiscord.com", stateCookie);
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.Location, "/admin");
    const cookie = rawCookie(callback.headers["Set-Cookie"])
        .find(x => x.startsWith("itamaros_admin_session="));
    assert.ok(cookie);
    assert.match(callback.headers["Set-Cookie"][1], /HttpOnly/);
    assert.equal(exchanged, 1);

    const replay = await visit("GET",
        "/admin/callback?code=sample-code&state=" +
        encodeURIComponent(params.get("state")), stateCookie);
    assert.equal(replay.status, 400);
    assert.equal(exchanged, 1);

    result = await visit("GET", "/admin", cookie);
    assert.equal(result.status, 200);
    assert.match(result.body, /7 open tickets/);
    assert.match(result.body, /ItamaRos &lt;Test&gt;/);
    assert.doesNotMatch(result.body, /short-test-token/);

    // A role change in Discord revokes access to an existing session.
    authorized = false;
    const revoked = await visit("GET", "/admin", cookie);
    assert.equal(revoked.status, 403);
    assert.doesNotMatch(revoked.body, /7 open tickets/);
    const loggedOut = await visit("GET", "/admin", cookie);
    assert.equal(loggedOut.status, 200);
    assert.match(loggedOut.body, /Continue with Discord/);
});

test("OAuth never accepts an unprivileged Discord member", async () => {
    authorized = false;
    const request = await visit("GET", "/admin/login");
    const loginUrl = new URL(request.headers.Location);
    const stateCookie = rawCookie(request.headers["Set-Cookie"])[0];
    const result = await visit("GET",
        "/admin/callback?code=another-code&state=" +
            encodeURIComponent(loginUrl.searchParams.get("state")),
        stateCookie);
    assert.equal(result.status, 403);
    assert.match(result.body, /not a manager/);
    assert.ok(!result.headers["Set-Cookie"]?.includes(
        "itamaros_admin_session"));
});

after(() => {
    global.fetch = previousFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    for (const [key, value] of originals) {
        if (value) require.cache[key] = value;
        else delete require.cache[key];
    }
});
