# Join to Create — temporary voice rooms

The bot automatically manages a permanent voice channel named **Create Your Channel** in the Discord guild configured by `GUILD_ID`.

## Member experience

1. Join **Create Your Channel**.
2. The bot creates a separate voice channel named **<display name>'s Channel**.
3. The bot moves you into the new channel and grants you channel-level management rights.
4. You can rename and manage your temporary room. Other members may join.
5. If the owner leaves while other members are inside, ownership and the channel name transfer to one of them.
6. When the last human leaves, the temporary room is deleted. **Create Your Channel** itself remains available.

The bot automatically rechecks rooms after reconnecting or restarting, removes empty ones and recovers ownership of occupied rooms.

## Requirements

- `GUILD_ID`: Discord server ID (already used by the bot)
- `MONGODB_URI`: existing MongoDB connection (no new database required)
- `BOT_AUTO_CHANNELS=true` (the default): creates or finds the voice lobby automatically
- `CREATE_YOUR_CHANNEL_ID` (optional): ID of an existing voice lobby; the bot also persists its selection in MongoDB

The bot's server role needs **Manage Channels** (for creating and removing rooms), **Move Members**, and access to the lobby. It must be able to set channel permission overwrites, including permissions for the temporary room owner. Check **Manage Roles** if Discord rejects setting channel permissions.

If `BOT_AUTO_CHANNELS=false`, create a voice channel named **Create Your Channel** and configure `CREATE_YOUR_CHANNEL_ID` (or let the existing channel lookup resolve it).

## Storage

Temporary room records are stored in the `temporary_voice_channels` MongoDB collection. Records do not alter ticket, giveaway, XP, or radio data.

## Hosting

This feature requires a running Discord bot process. While the bot is offline, it cannot move members, create channels, transfer ownership, or delete empty rooms. Once it starts, it reconciles the rooms it previously created.
