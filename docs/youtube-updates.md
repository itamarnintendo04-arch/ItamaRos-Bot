# YouTube updates for ItamaRos Bot

Managers can use /youtube setup and select the text/announcement
channel where new YouTube uploads should appear. Optionally set
youtube_channel to a YouTube @handle, UC... channel ID, or channel URL;
the default source is @ItamaRos.

Other commands: /youtube status, /youtube check and /youtube disable.

Bot permissions: View Channel and Send Messages for the selected
Discord channel.

For basic tracking, the bot uses YouTube's public Atom feed.
Optional Render environment variables:

- YOUTUBE_API_KEY: improves livestream and upcoming event detection.
  Set this securely in Render, NOT in GitHub.
- YOUTUBE_CHECK_INTERVAL_MINUTES: default 3, minimum 2, maximum 30.
- YOUTUBE_CHANNEL_ID or YOUTUBE_CHANNEL_HANDLE: overrides default @ItamaRos.

The output format is:

🎬 New Short Uploaded!
https://www.youtube.com/shorts/VIDEO_ID

🎥 New Video Uploaded!
https://www.youtube.com/watch?v=VIDEO_ID

🔴 New Live Started!
https://www.youtube.com/watch?v=VIDEO_ID

Existing uploads are seeded into MongoDB when first configured to avoid
spamming old uploads. New video records and subscription configuration
are stored in youtube_notifications and youtube_subscriptions.

YouTube's public feed does not always identify Shorts or exactly when a
livestream begins. Classification is best effort without an API key,
especially if the creator doesn't use #Shorts. There will be a delay
due to YouTube publication latency plus the chosen polling interval.
