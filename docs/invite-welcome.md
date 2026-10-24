# ItamaRos Bot — Invites and Welcome

## Required setup (Render)

Set WELCOME_CHANNEL_ID to the destination Discord channel's numeric ID.
GUILD_ID is already used by the rest of ItamaRos Bot.

- Enable **Server Members Intent** (Privileged Gateway Intents) in
  Discord Developer Portal > Application > Bot.
- The bot needs **Manage Server** to read current invite counters.
- Give the bot **View Channel**, **Send Messages**, **Embed Links**
  and **Attach Files** in the welcome channel.
- The app also requests the Guild Invites Gateway intent for
  new/deleted invite events.

For the channel ID, enable Discord Developer Mode, right-click or
long-press the welcome channel and select **Copy Channel ID**.

## Behavior

On startup, the bot snapshots currently active Discord invite links.
When a new member joins, it fetches the counters again. If exactly
one link increased by one use, the member is attributed to the
owner of that invite. Otherwise the inviter is **Unknown** (e.g.
vanity invites, missing permissions, expired/deleted one-use links,
or several simultaneous joins).

The welcome message is sent **only in the welcome channel** (not DM),
and contains a dynamic 1200 x 480 PNG welcome card with the joining
member's name, inviter name if identified and both invite counts.
The Discord embed shows the inviter as a profile mention and
includes the number of currently present members invited by
that inviter and the number invited by the newcomer.

Bot downloads no user avatars; the PNG is generated locally with
the sharp dependency from styled SVG. If image generation fails,
a text welcome fallback is sent.

## Staff commands (Manage Server permission)

- /invites user member: shows whom a user was invited by,
  active invited members and all invited members tracked.
- /invites list member page: shows exactly which members that
  inviter brought in, with current/left status, 20 per page.
- /invites top: ranks inviters by number of currently present
  members attributed to them.

All reports are ephemeral.

Invite member attribution and counts are saved in MongoDB collection
invite_attributions. On member leave, their record is marked
inactive; invite counts therefore reflect members still in the server.
Tracking starts when this feature is enabled and cannot reconstruct
joins that happened earlier. A cached invite snapshot is refreshed
at every join, while records persist through Render restarts.

The bot intentionally does **not** invent inviters when attribution
cannot be proven from Discord invite counters. Some tracking may
remain unknown due to limitations in Discord invite information.
