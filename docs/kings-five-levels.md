# ItamaRos Bot — Kings Five-Level System

This system uses **one base Kings role plus exactly one active Kings Level role**.
Only one of Kings Level 1/2/3/4/5 is assigned at any time. When promoted,
the previous tier role is removed; when Kings membership ends, all Kings level
roles are removed. The base Kings role remains as long as the member's
booster/permanent-membership rules allow it.

## Tier progression

| Kings rank | Minimum activity XP | Category | Channels |
| --- | ---: | --- | --- |
| Level 1 | 0 | 👑 KINGS | lounge, news, help |
| Level 2 | 50 | 👑 KINGS • LEVEL 2 | strategy-lv2, events-lv2, giveaways-lv2 |
| Level 3 | 100 | 👑 KINGS • LEVEL 3 | drops-lv3, edits-lv3, requests-lv3 |
| Level 4 | 150 | 👑 KINGS • LEVEL 4 | shop-lv4, royal-events-lv4, rewards-lv4 |
| Level 5 | 250 | 👑 KINGS • LEVEL 5 | royal-lounge-lv5, premium-events-lv5, vip-perks-lv5 |

Activity XP is stored in `member_xp.activityXp`. Extra XP granted by
level-milestone rewards does not advance Kings tier. Staff XP edits update
activity XP so they can promote/demote users.

Higher-tier roles can view all lower-tier categories and channels.
Guild roles with Manage Server / Administrator are also explicitly allowed
in all Kings categories, including if they do not have the Kings role.
A channel name includes its level suffix except for Level 1.

The bot needs Manage Channels and Manage Roles, and its role must be above
the Kings and Kings Level roles in the Discord role list. Only the bot manages
tier role assignment and channel permission synchronization.

## Exclusive products in the regular store

Managers use `/store-admin create` or `/store-admin update` with:

- `kings_only: true`
- `kings_min_level: 1..5`

A product is eligible only for members with the base Kings role **and**
enough Kings rank, plus staff who have Manage Server. The shared
`#item-store` message never displays exclusive product names. Instead,
the `Kings offers` button shows an ephemeral catalog filtered for the
member who clicked it. The private results in `/shop`, `/store list`,
and `/store info` follow the same server-side access checks. Checkout
also rechecks access.

Regular product Buy buttons show the product's price and a coin emoji.
The store currently uses virtual server currency only.

## Commands

- `/kings-rank`: view your Kings rank, next level and unlocked areas.
- `/radio-admin status`: staff-only status, channel and latest error.
- `/radio-admin restart`: staff-only radio reconnection.

Administrative slash commands have default Discord permission restrictions;
nonmanagers should not see them in the normal command picker.

## Radio troubleshooting

The bot first resolves the configured or auto-created `#radio` voice channel,
falling back to a saved channel ID or exact radio name if necessary.
It requires **View Channel**, **Connect** and **Speak** in that voice channel.

The radio uses local music tracks from `assets/radio`, loops the playlist,
and schedules a 500 ms delay between songs. If disconnected it reconnects;
after an extended unhealthy connection it restarts automatically.

To diagnose, run `/radio-admin status` after deployment, or
`/radio-admin restart`. The error text will identify missing channel
configuration or permission issues. Check Render service logs for deeper
voice handshake/network errors. A Render Web Service must remain running
for uninterrupted playback, and its Node version must satisfy the
`@discordjs/voice` engine requirement (Node.js >=22.12.0).

> Deployment and real Discord playback cannot be established solely by code
> changes. Test a running instance and verify the radio connection after
> Render deploy.
