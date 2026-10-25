# ➕ Create Your Channel — one permanent voice channel

The ItamaRos Bot uses **one permanent Discord voice channel** named **➕ Create Your Channel** in the server configured by `GUILD_ID`. It does **not** create extra voice channels or move anyone elsewhere.

## Member experience

1. The first person enters **➕ Create Your Channel**.
2. The **same channel** changes its name to `DisplayName's Channel`.
3. The first person becomes the **temporary owner** while they remain connected. Other members may enter without changing the owner or name.
4. The owner can rename the room safely with `/voice-room rename name:<name>`. Use `/voice-room status` to check ownership.
5. **When that owner leaves the voice channel, its name returns immediately to ➕ Create Your Channel**, even if other members are still inside.
6. If others stay after the owner leaves, the room remains unclaimed with its original name. The next person to enter claims it.
7. No voice channels are created, deleted, or moved. The Discord voice channel ID is always the same.

### Security

The member's ownership is managed by the bot. We deliberately **do not** grant `Manage Channels` to the member: that Discord permission could let them delete the shared permanent channel. The bot provides the safe rename action instead. Users can still participate in ordinary voice chat.

## Setup

- `GUILD_ID`: the existing server ID.
- `MONGODB_URI`: the existing MongoDB connection.
- `BOT_AUTO_CHANNELS=true` (default): creates the **one permanent lobby** if it does not already exist.
- `CREATE_YOUR_CHANNEL_ID` (optional): the ID of an existing permanent voice channel. The auto-setup also records its chosen ID in MongoDB.

The bot needs **Manage Channels** in the voice channel to rename it. The bot also needs permission to see the voice channel and **Guild Voice States** intent.

If `BOT_AUTO_CHANNELS=false`, create the `➕ Create Your Channel` voice channel manually and set `CREATE_YOUR_CHANNEL_ID`.

## Persistence

Current ownership is kept in the MongoDB `voice_channel_claims` collection. The bot checks owner presence on startup and periodically; if the owner disconnected while the bot was offline, it restores the original name. It never deletes or edits the XP, tickets, giveaways, radio or older voice-room data.

## Hosting

This feature works only when the Discord bot is online. Simply joining a Discord support server for a hosting provider does **not** deploy or run the bot. Configure a real Node.js hosting service before expecting the voice channel to react.
