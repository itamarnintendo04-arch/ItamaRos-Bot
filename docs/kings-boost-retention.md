# Kings boost retention — ItamaRos Bot

## Render variables

- GUILD_ID — Discord server ID (already configured).
- KINGS_ROLE_ID — the numeric Discord ID of the Kings role.
- KINGS_WELCOME_CHANNEL_ID — the numeric Discord ID for #kings-welcome.

## Discord permissions

- Turn on the privileged Server Members Intent in Discord Developer Portal.
- Grant the bot Manage Roles; its top role must be above the Kings role.
- Give the bot View Channel, Send Messages, Embed Links and Attach Files in #kings-welcome.
- Use Discord channel permission overwrites to restrict exclusive channels to Kings.

## Retention

- When a user starts boosting, Kings is automatically granted.
- A newly granted King gets a welcome in #kings-welcome with a Sharp PNG and avatar when available.
- If the boost stops before 48 hours, Kings granted by this system is removed.
- After at least 48 hours, Kings rank is permanently retained if boosting stops.
- Existing staff-granted Kings roles are left alone.
- Someone who earned permanent Kings cannot lose it due to a later short boost.
- Normal XP, wallet coins, and other unrelated roles are never reduced on booster exit.
- Separate Level 1, 2 and 3 role thresholds and coin/XP milestone rewards are not wired up yet.

## Restart behavior

MongoDB collection: kings_boost_history.
At startup the bot scans existing boosters without flooding the welcome channel,
then reconciles active boosters every 30 minutes.
If the boost stops while the bot is offline, Discord does not expose the precise
stop time. The system uses the last confirmed active observation as a conservative
boundary; unverified offline time cannot be counted toward permanent Kings.
