# Automatic Discord channels — ItamaRos Bot

## How it works

On each bot startup, the setup manager checks for an existing channel for every fixed-channel subsystem. It uses a valid configured Discord channel ID first, then the channel ID saved in MongoDB, then a matching channel name. Only if none is found does it create a channel.

New channels receive an English welcome/instructions message with their related slash commands. The support-tickets channel receives the real interactive ticket selection panel, not only text. Voice radio gets an additional text channel called radio-info containing instructions.

The setup is idempotent: IDs and whether the welcome was posted live in MongoDB's bot_system_channels collection. Deleting a channel triggers a recheck, and the bot rechecks every 15 minutes. Existing channels keep their manual permissions and are not rewritten.

System channels:

- welcome — member join images and invite counts; /invites commands
- support-tickets — support form and interactive menu; /ticket
- giveaways — /giveaway start
- drops — /drop start
- shop — /store list, /economy daily, /economy math
- daily-question — quiz message, staff /quiz-tomorrow
- youtube-updates — automatic YouTube posts from Render configuration
- mod-log — private management messages, giveaway IDs and /giveaway-admin
- kings-welcome — Kings role onboarding
- kings-giveaways — Kings-only /giveaway start
- kings-drops — Kings-only /drop start
- kings-shop — Kings-only lounge and shop commands (shared inventory/catalog for now)
- radio-info — radio instructions
- radio — voice channel, bot audio only

## Security and permissions

The bot needs Manage Channels, View Channel, Send Messages, Read Message History, Embed Links, Attach Files, and any additional permissions required by each subsystem. For Kings role auto-creation, the bot needs Manage Roles and its role must be above Kings.

The bot creates a non-administrative Kings role if no safe existing Kings role is found. It does not automatically give boosters any administrator, moderation or management permissions.

New mod-log channels are hidden from @everyone and only accessible to staff with applicable role permissions. New Kings channels deny @everyone View Channel and allow only Kings. Existing channels with unsafe visibility are not reused for these private areas; an alternate private channel is created instead.

Discord channel and Kings role IDs generated automatically are stored in MongoDB and assigned to the corresponding environment variable for the running Node process. They are NOT written to Render secrets. On subsequent restarts they are restored from MongoDB.

Optional Render variable BOT_AUTO_CHANNELS=false disables all automatic provisioning.

## Kings booster rewards are permanent

If a booster stops before 48 complete hours, the Kings role granted by this system is removed, which also removes access to Kings-only channels, giveaways, drops and Kings lounge. No XP or virtual currency is deducted by the booster-stop handler. If they kept the boost for 48 hours, the Kings role becomes permanent. Existing manually granted Kings roles are not revoked.

Important: the separate Level 1/2/3 coin and XP reward thresholds have not yet been defined or deployed. This setup does not invent milestone conditions or award unconfigured bonuses.

## Configuration already supplied

The WELCOME_CHANNEL_ID configured in Render is reused rather than creating a duplicate welcome channel.
