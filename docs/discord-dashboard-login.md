# ItamaRos Bot — Secure Discord Manager Login

The browser-based **ItamaRos Staff Dashboard** is available at:

**https://YOUR-RENDER-SERVICE.onrender.com/admin**

Its pages are protected by Discord OAuth2. It is not enough to know the URL:
the user must sign in to Discord and hold **Manage Server** or
**Administrator** permissions **in the one configured GUILD_ID**.
Server owners also qualify.

## One-time setup

1. Open the bot's application in the official
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2**, create the Redirect URI:
   **https://YOUR-RENDER-SERVICE.onrender.com/admin/callback**
   (replace the example service domain with your own service URL).
3. Add the following **secret/environment values on Render**, NOT GitHub:
   - \`CLIENT_ID\`: the Discord application ID (already used by the bot).
   - \`DISCORD_CLIENT_SECRET\`: the Discord application's OAuth2 client secret.
     Treat this as a password; never send it to members or commit it.
   - \`DASHBOARD_REDIRECT_URI\`: the exact callback URL from Step 2.
   - \`GUILD_ID\`: the server ID where managers should be verified
     (already used by the bot).
   - \`MONGODB_URI\`: already needed to persist hashed web sessions.
4. Deploy the updated Render Web Service. The root URL and \`/health\`
   remain available without authentication.
5. Visit \`/admin\` and choose **Continue with Discord**.

**You must register exactly the same Redirect URI with Discord that is set
in Render**. For production, use HTTPS. On local development only,
\`http://localhost/.../admin/callback\` is allowed if registered at Discord
and correctly configured; plain-HTTP public servers are intentionally blocked.

## Access control

- OAuth2 asks the user only for the Discord **identify** scope.
  Your bot looks up guild membership and permissions using its existing
  authorized Discord bot connection.
- A successful OAuth response alone does **not** grant dashboard access.
  A fresh guild-member fetch must show the server's owner, an Administrator,
  or a role with Manage Server.
- The server does not accept a client-supplied role or server ID.
  All checks use \`GUILD_ID\` from Render.
- Permission verification is repeated **on every protected page request**.
  Access is revoked if the Discord user loses their staff role or leaves
  the server.
- Sessions expire after **8 hours**. Logging out removes the session.
- OAuth2 login requests use a **single-use 10-minute state token** checked
  against both a SameSite HTTP-only cookie and a MongoDB record.
- HTTP-only session cookies use the Secure flag over HTTPS.
- MongoDB stores only SHA-256 hashes of session/state tokens, not the raw
  cookies or the user's OAuth2 tokens.
- Discord's OAuth2 access token is used to read \`/users/@me\` and discarded.
  The application never asks for or stores a Discord password.
- Session and OAuth2 state records have MongoDB expiration indexes.
- The dashboard uses no public REST API for staff actions.
  Current browser dashboard sections show read-only server statistics;
  the in-Discord managers' dashboard retains its buttons and controls.

## Common issues

**"Discord login is not configured"**:
Set \`DISCORD_CLIENT_SECRET\` and \`DASHBOARD_REDIRECT_URI\` in Render.

**"Invalid OAuth2 redirect_uri"**:
Use exactly the same URL in Render and Discord's OAuth2 redirect list.

**"Access denied"**:
Sign in with an account that has Manage Server / Administrator
in the server indicated by Render's \`GUILD_ID\`. A general server-member
role is not enough.

**"Dashboard is temporarily unavailable"**:
Check Render logs for MongoDB connectivity or Discord API issues.
The bot must be online to revalidate permissions.

**Security note:** Never share your bot token, Discord client secret,
MongoDB URI or session cookie. The dashboard should be reachable
only through HTTPS on the real Render service.

## Testing

\`npm test\` includes mocked OAuth2 and permissions tests:
anonymous access, a valid manager login, CSRF/replayed-state rejection,
an unprivileged member rejection and revocation after role removal.

GitHub Actions syntax/tests do not establish live Discord OAuth2 success.
After configuring the environment, test with one authorized manager and
one ordinary member account.
