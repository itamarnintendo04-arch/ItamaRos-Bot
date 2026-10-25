"use strict";

// Discord OAuth2 login for the private, web-based staff dashboard.
// No user access tokens, client secrets, passwords or bot tokens are
// stored in MongoDB. OAuth state and session cookies are random;
// only their SHA-256 hashes are persisted.
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { PermissionFlagsBits: P } = require("discord.js");
const { getDatabase } = require("../../database");
const { SECTIONS, build } = require("../systems/dashboard/dashboard");

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const AUTH_STATE_COOKIE = "itamaros_auth_state";
const SESSION_COOKIE = "itamaros_admin_session";
const SNOWFLAKE = /^\d{17,20}$/;
let indexesPromise = null;

const hash = value => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const states = () => getDatabase().collection("dashboard_oauth_states");
const sessions = () => getDatabase().collection("dashboard_web_sessions");

function oauthSettings() {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DASHBOARD_REDIRECT_URI;
    if (!SNOWFLAKE.test(String(clientId || "")) ||
        !clientSecret || !redirectUri) return null;
    let parsed;
    try { parsed = new URL(redirectUri); } catch { return null; }
    const local = parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1";
    if ((parsed.protocol !== "https:" &&
         !(local && parsed.protocol === "http:")) ||
        parsed.pathname !== "/admin/callback" ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
        return null;
    }
    return {
        clientId, clientSecret, redirectUri,
        secure: parsed.protocol === "https:"
    };
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

function cookies(req) {
    const map = new Map();
    for (const part of String(req.headers.cookie || "").split(";")) {
        const index = part.indexOf("=");
        if (index === -1) continue;
        map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
    return map;
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a || ""));
    const y = Buffer.from(String(b || ""));
    return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(name, value, secure, maxAge, path = "/admin") {
    return name + "=" + value +
        "; HttpOnly; SameSite=Lax; Path=" + path +
        (secure ? "; Secure" : "") + "; Max-Age=" + maxAge;
}

function securityHeaders(contentType = "text/html; charset=utf-8") {
    return {
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'"
        ].join("; ")
    };
}

function response(res, status, html, headers = {}) {
    res.writeHead(status, { ...securityHeaders(), ...headers });
    res.end(html);
}
function redirect(res, location, headers = {}) {
    res.writeHead(303, { ...securityHeaders(), Location: location, ...headers });
    res.end();
}

function layout(title, content) {
    return '<!DOCTYPE html><html lang="en"><head>' +
        '<meta charset="utf-8"><meta name="viewport" ' +
        'content="width=device-width, initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow">' +
        '<title>' + escapeHtml(title) + ' • ItamaRos</title>' +
        '<style>' +
        ':root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}' +
        '*{box-sizing:border-box}body{margin:0;min-height:100vh;color:#f5f3ff;' +
        'background:radial-gradient(circle at 15% 0,#272057 0,transparent 42%),#0e0c19}' +
        '.wrap{max-width:1150px;margin:0 auto;padding:28px 22px 90px}' +
        '.bar{display:flex;align-items:center;gap:14px;justify-content:space-between;' +
        'padding:18px 0;border-bottom:1px solid #342c4b}.brand{font-weight:850;' +
        'font-size:22px;letter-spacing:-.8px;color:#fff;text-decoration:none}' +
        '.brand span{color:#bca5ff}.right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
        'h1{font-size:clamp(28px,5vw,46px);letter-spacing:-1.6px;margin:0 0 14px}' +
        'h2{font-size:22px;margin:0 0 15px}.muted{color:#b0a8c6;line-height:1.65}' +
        '.hero{padding:72px 0 35px;max-width:800px}.hero p{font-size:17px}' +
        '.panel{background:#1b172b;border:1px solid #3d3157;border-radius:20px;' +
        'padding:25px;box-shadow:0 12px 45px #05030844}.btn{display:inline-flex;' +
        'align-items:center;justify-content:center;gap:8px;background:#7654d5;' +
        'color:white;border:1px solid #9980ef;border-radius:11px;padding:12px 20px;' +
        'font-size:14px;font-weight:750;text-decoration:none;cursor:pointer}' +
        '.btn:hover{background:#8e6df2}.btn.ghost{background:#201932;border-color:#413957}' +
        '.btn.ghost:hover{background:#312345}.badge{background:#30254b;color:#c9b4ff;' +
        'padding:7px 11px;border-radius:999px;font-size:12px}' +
        '.nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}' +
        '.nav a{color:#d2c8ec;text-decoration:none;border:1px solid #39304d;' +
        'border-radius:10px;padding:10px 13px;background:#1b1729;font-size:13px}' +
        '.nav a:hover,.nav a.selected{background:#432e79;color:white;border-color:#9274d5}' +
        '.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}' +
        '.metric{min-height:56px;border:1px solid #3b3051;border-radius:12px;' +
        'padding:15px 18px;background:#221c34;line-height:1.45;overflow-wrap:anywhere}' +
        '.metric strong{color:#dcc5ff}.alert{border-left:3px solid #ae8aff;padding:12px 15px;' +
        'background:#2a2040;border-radius:6px;margin:20px 0}' +
        'footer{color:#887c9f;font-size:12px;margin-top:32px}' +
        '@media(max-width:680px){.bar{align-items:flex-start;flex-direction:column}' +
        '.hero{padding-top:42px}.wrap{padding:18px 16px 55px}}' +
        '</style></head><body><div class="wrap">' + content +
        '</div></body></html>';
}

function loginPage(reason = "", status = 200) {
    const configured = Boolean(oauthSettings());
    const reasonHtml = reason
        ? '<p class="alert">' + escapeHtml(reason) + '</p>' : "";
    const content = '<header class="bar">' +
        '<a class="brand" href="/">Itama<span>Ros</span> / Admin</a>' +
        '<span class="badge">Protected management console</span></header>' +
        '<main class="hero"><h1>Manage your community.<br>Securely.</h1>' +
        '<p class="muted">Sign in with a Discord account that has ' +
        '<strong>Manage Server</strong> or <strong>Administrator</strong> ' +
        'permissions in the configured ItamaRos server.</p>' +
        reasonHtml + '<div class="panel"><h2>Discord verification required</h2>' +
        '<p class="muted">Your permissions will be checked against the real ' +
        'Discord server. A link to this page does not grant access.</p>' +
        (configured
            ? '<a class="btn" href="/admin/login">Continue with Discord</a>'
            : '<p class="alert">Discord login is not configured. ' +
              'An administrator must set its OAuth2 credentials on Render.</p>') +
        '</div></main><footer>ItamaRos Bot • Secure staff access</footer>';
    return { status: configured ? status : 503, body: layout("Staff login", content) };
}

function denyPage(message) {
    return layout("Access denied", '<header class="bar"><a class="brand" ' +
        'href="/">Itama<span>Ros</span> / Admin</a></header>' +
        '<main class="hero"><h1>Access denied</h1><div class="panel">' +
        '<p class="muted">' + escapeHtml(message) + '</p>' +
        '<a href="/admin" class="btn">Sign in with another account</a>' +
        '</div></main>');
}

function asMarkup(text) {
    // Discord embed descriptions can contain Markdown. Escape text before
    // adding limited visual emphasis; never render raw user-supplied HTML.
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function dashboardPage(guild, session, section, description, csrf) {
    const menu = SECTIONS.map(([key, title, emoji]) =>
        '<a ' + (key === section ? 'class="selected" ' : '') +
        'href="/admin?section=' + encodeURIComponent(key) + '">' +
        emoji + ' ' + escapeHtml(title) + '</a>'
    ).join("");
    const sectionTitle = SECTIONS.find(entry => entry[0] === section);
    const lines = String(description).split("\n").filter(line => line.trim());
    const content = '<header class="bar">' +
        '<a class="brand" href="/admin">Itama<span>Ros</span> / Dashboard</a>' +
        '<div class="right"><span class="badge">✓ Verified Server Manager</span>' +
        '<span class="muted">' + escapeHtml(session.displayName || session.username) +
        '</span><form action="/admin/logout" method="post">' +
        '<input type="hidden" name="csrf" value="' + escapeHtml(csrf) + '">' +
        '<button class="btn ghost" type="submit">Log out</button></form></div>' +
        '</header><main><section class="hero"><h1>Server control center</h1>' +
        '<p class="muted">Signed in as an authorized manager of ' +
        '<strong>' + escapeHtml(guild.name) + '</strong>. ' +
        'Permissions are revalidated with Discord on every page load.</p>' +
        '</section><nav class="nav" aria-label="Dashboard sections">' + menu +
        '</nav><div class="panel"><h2>' + sectionTitle[2] + ' ' +
        escapeHtml(sectionTitle[1]) + '</h2><div class="metrics">' +
        lines.map(line => '<div class="metric">' + asMarkup(line) + '</div>').join("") +
        '</div></div></main>' +
        '<footer>ItamaRos Bot • Read-only statistics • MongoDB-backed • ' +
        'Staff permissions verified by Discord</footer>';
    return layout("Server dashboard", content);
}

function parseRoute(req) {
    try {
        const url = new URL(req.url || "/", "http://local.internal");
        return url.pathname.startsWith("/admin") ? url : null;
    } catch { return null; }
}

function isDashboardRequest(req) {
    return Boolean(parseRoute(req));
}

async function initializeIndexes() {
    if (!indexesPromise) {
        indexesPromise = Promise.all([
            states().createIndex({ expiresAt: 1 }, {
                expireAfterSeconds: 0, name: "oauth_state_expiry"
            }),
            sessions().createIndex({ expiresAt: 1 }, {
                expireAfterSeconds: 0, name: "dashboard_session_expiry"
            })
        ]).catch(error => {
            indexesPromise = null;
            throw error;
        });
    }
    return indexesPromise;
}

async function verifyManager(client, userId, serverId = process.env.GUILD_ID) {
    if (!SNOWFLAKE.test(String(userId || "")) ||
        !SNOWFLAKE.test(String(serverId || "")) ||
        !client?.isReady?.()) return null;
    const guild = await client.guilds.fetch(serverId);
    // Force a fresh Discord API read. Do not trust OAuth "guilds",
    // the client's claimed roles or stale cache entries.
    const member = await guild.members.fetch({
        user: userId, force: true, cache: false
    }).catch(error => {
        // "Unknown Member" is not a manager. Other errors must fail closed.
        if (error.code === 10007) return null;
        throw error;
    });
    if (!member) return null;
    const authorized = guild.ownerId === userId ||
        member.permissions.has(P.ManageGuild) ||
        member.permissions.has(P.Administrator);
    return authorized ? { guild, member } : null;
}

async function getSession(req) {
    const value = cookies(req).get(SESSION_COOKIE);
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
    const record = await sessions().findOne({
        _id: hash(value), guildId: process.env.GUILD_ID,
        expiresAt: { $gt: new Date() }
    });
    return record || null;
}

function clearCookies(settings) {
    const secure = settings?.secure !== false;
    return [
        cookie(AUTH_STATE_COOKIE, "", secure, 0),
        cookie(SESSION_COOKIE, "", secure, 0)
    ];
}

async function login(res) {
    const settings = oauthSettings();
    if (!settings) {
        const page = loginPage();
        response(res, page.status, page.body);
        return;
    }
    await initializeIndexes();
    const state = token();
    await states().insertOne({
        _id: hash(state), createdAt: new Date(),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS)
    });

    const url = new URL("https://discord.com/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", settings.clientId);
    url.searchParams.set("redirect_uri", settings.redirectUri);
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "consent");
    redirect(res, url.toString(), {
        "Set-Cookie": cookie(AUTH_STATE_COOKIE, state, settings.secure, 600)
    });
}

async function discordUser(code, settings) {
    const credentials = Buffer.from(
        settings.clientId + ":" + settings.clientSecret
    ).toString("base64");
    const body = new URLSearchParams({
        grant_type: "authorization_code", code,
        redirect_uri: settings.redirectUri
    });
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST", headers: {
            Authorization: "Basic " + credentials,
            "Content-Type": "application/x-www-form-urlencoded"
        }, body, signal: AbortSignal.timeout(10000)
    });
    if (!tokenRes.ok) throw Error("Discord authorization failed.");
    const tokens = await tokenRes.json();
    if (!tokens?.access_token || tokens.token_type?.toLowerCase() !== "bearer") {
        throw Error("Invalid Discord authorization response.");
    }
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: "Bearer " + tokens.access_token },
        signal: AbortSignal.timeout(10000)
    });
    if (!userRes.ok) throw Error("Unable to verify Discord account.");
    const user = await userRes.json();
    if (!SNOWFLAKE.test(String(user?.id || ""))) {
        throw Error("Discord returned an invalid account.");
    }
    return { id: user.id, username: user.username,
        displayName: user.global_name || user.username };
}

async function callback(req, res, url, client) {
    const settings = oauthSettings();
    if (!settings) {
        const p = loginPage();
        return response(res, p.status, p.body);
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const returned = cookies(req).get(AUTH_STATE_COOKIE);
    const clearState = {
        "Set-Cookie": cookie(AUTH_STATE_COOKIE, "", settings.secure, 0)
    };
    if (url.searchParams.has("error")) {
        return redirect(res, "/admin?reason=cancelled", clearState);
    }
    if (!state || !returned || !safeEqual(state, returned) ||
        !code || code.length > 2048 ||
        (url.searchParams.has("iss") &&
            url.searchParams.get("iss") !== "https://discord.com")) {
        return response(res, 400, denyPage("Invalid or expired Discord login."),
            clearState);
    }
    // Atomic consumption of a 10-minute, single-use OAuth state.
    const record = await states().findOneAndDelete({
        _id: hash(state), expiresAt: { $gt: new Date() }
    });
    if (!record) {
        return response(res, 400, denyPage("This login attempt has expired."),
            clearState);
    }

    const user = await discordUser(code, settings);
    const staff = await verifyManager(client, user.id);
    if (!staff) {
        return response(res, 403, denyPage(
            "This account is not a manager of the configured Discord server. " +
            "You need Manage Server or Administrator permission."
        ), clearState);
    }
    const session = token();
    await sessions().insertOne({
        _id: hash(session),
        guildId: staff.guild.id,
        userId: user.id,
        username: String(user.username || "Discord member").slice(0, 80),
        displayName: String(user.displayName || "").slice(0, 80),
        csrf: token(),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    });
    redirect(res, "/admin", {
        "Set-Cookie": [
            cookie(AUTH_STATE_COOKIE, "", settings.secure, 0),
            cookie(SESSION_COOKIE, session, settings.secure,
                Math.floor(SESSION_TTL_MS / 1000))
        ]
    });
}

async function readPostBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) throw Error("Request is too large.");
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function handleDashboardRequest(req, res, client) {
    const url = parseRoute(req);
    if (!url) return false;
    if (!["GET", "HEAD", "POST"].includes(req.method)) {
        response(res, 405, denyPage("Method not allowed."), {
            Allow: "GET, HEAD, POST"
        });
        return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/login") {
        await login(res);
        return true;
    }
    if (req.method === "GET" && url.pathname === "/admin/callback") {
        try {
            await callback(req, res, url, client);
        } catch (error) {
            console.warn("[Web Dashboard] OAuth callback rejected:", error.message);
            if (!res.headersSent) response(res, 401, denyPage(
                "Discord sign-in could not be verified. Please try again."
            ));
        }
        return true;
    }
    const settings = oauthSettings();
    const session = await getSession(req);
    if (req.method === "POST" && url.pathname === "/admin/logout") {
        if (!session) {
            redirect(res, "/admin", { "Set-Cookie": clearCookies(settings) });
            return true;
        }
        const body = new URLSearchParams(await readPostBody(req));
        if (!safeEqual(body.get("csrf"), session.csrf)) {
            response(res, 403, denyPage("Security token mismatch."));
            return true;
        }
        await sessions().deleteOne({ _id: session._id });
        redirect(res, "/admin", { "Set-Cookie": clearCookies(settings) });
        return true;
    }
    if (url.pathname !== "/admin" || req.method !== "GET") {
        response(res, 404, denyPage("Page not found."));
        return true;
    }
    if (!session) {
        const reason = url.searchParams.get("reason") === "cancelled"
            ? "Discord sign-in was cancelled." : "";
        const page = loginPage(reason);
        response(res, page.status, page.body, {
            "Set-Cookie": cookie(SESSION_COOKIE, "", settings?.secure !== false, 0)
        });
        return true;
    }
    const authorized = await verifyManager(client, session.userId);
    if (!authorized) {
        await sessions().deleteOne({ _id: session._id });
        response(res, 403, denyPage(
            "Your account no longer has Manage Server or Administrator " +
            "permission in the configured Discord server."
        ), { "Set-Cookie": clearCookies(settings) });
        return true;
    }
    const requested = url.searchParams.get("section") || "overview";
    const section = SECTIONS.some(entry => entry[0] === requested)
        ? requested : "overview";
    const payload = await build(authorized.guild, section);
    const description = payload.embeds[0]?.data?.description || "No data available.";
    response(res, 200, dashboardPage(authorized.guild, session, section,
        description, session.csrf));
    return true;
}

module.exports = {
    handleDashboardRequest,
    isDashboardRequest,
    verifyManager,
    oauthSettings,
    escapeHtml,
    safeEqual,
    initializeIndexes,
    hash
};
