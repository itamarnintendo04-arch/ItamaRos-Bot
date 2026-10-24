# ItamaRos Bot: YouTube notifications via Render

The bot reads its configuration from Render; no Discord setup
command is needed.

Required variables:
- YOUTUBE_CHANNEL_ID: the YouTube UC... channel ID, not the @handle.
- YOUTUBE_UPDATES_CHANNEL_ID: destination Discord channel ID.
- YOUTUBE_API_KEY: YouTube Data API v3 key. Put in Render secrets.
- GUILD_ID: the Discord server ID, already in Render.

Optional YOUTUBE_CHECK_INTERVAL_MINUTES: 3 (range: 2 to 30).

To find the YouTube Channel ID, sign into the channel owner account:
https://www.youtube.com/account_advanced
and copy "Channel ID" (UC...).

In Discord Developer Mode, long-press/right-click the updates channel
and select Copy Channel ID.

The bot must have View Channel, Send Messages and Mention @everyone
permissions in that destination channel.

On deployment, it reads Render variables, checks permissions, and
seeds old uploads into MongoDB to avoid posting a backlog.
On subsequent restarts it resumes the persisted configuration.

Notifications are written as follows, each preceded by @everyone:

New Short Uploaded!
https://www.youtube.com/shorts/VIDEO_ID

New Video Uploaded!
https://www.youtube.com/watch?v=VIDEO_ID

New Live Started!
https://www.youtube.com/watch?v=VIDEO_ID

The YouTube public Atom feed is polled approximately every 3 minutes.
YouTube may not identify every Short or reveal every live transition
in its feed, so categorization and delivery times are best-effort.
An API key improves livestream classification.

Subscriptions are stored in MongoDB collection youtube_subscriptions;
previously announced IDs in youtube_notifications. The legacy /youtube
command is retired and will be unregistered on bot startup.
