# ItamaRos Bot: MongoDB-backed, progressive XP and chat rewards

The XP system is **unlimited in gameplay levels**. XP and activity records
are stored in MongoDB, never in an in-memory map or local JSON file.
There is only a JavaScript/Mongo numeric precision boundary
(`Number.MAX_SAFE_INTEGER`), not a configured rank cap.

## Level requirements

The first three levels cost **50 XP per level**. The requirement then
increases by **50 XP** in stages:

- **Levels 1–15:** every 3 levels the XP price rises by 50.
- **Levels 16–30:** every 2 levels the XP price rises by 50.
- **Levels 31 onward:** every single level adds another 50 XP.

These stages are continuous. Progression never resets at a stage boundary.

| New XP level | Added XP | Total XP |
| --- | ---: | ---: |
| 1 | 50 | 50 |
| 2 | 50 | 100 |
| 3 | 50 | 150 |
| 4 | 100 | 250 |
| 5 | 100 | 350 |
| 6 | 100 | 450 |
| 7 | 150 | 600 |
| 9 | 150 | 900 |
| 10 | 200 | 1,100 |
| 15 | 250 | 2,250 |
| 16 | 300 | 2,550 |
| 17 | 300 | 2,850 |
| 18 | 350 | 3,200 |
| 30 | 650 | 9,200 |
| 31 | 700 | 9,900 |
| 32 | 750 | 10,650 |

`src/systems/xp/progression.js` is the single source of truth for
the maths. `/level`, `/xp-leaderboard`, role milestones, Kings
rank checks and minimum-level giveaway eligibility read the same
progressive level formula.

## Increasing chat-activity rewards

Every eligible message earns progressively more XP:

- First eligible message: **5 XP**.
- Second: **6 XP**.
- Third: **7 XP**.
- Each new eligible message increases the award by **1 XP**.

Spam safeguards: **60-second cooldown**, minimum message length,
blocked-word validation, ignore bots/webhooks, and reject an
immediately repeated message after normalization. Rewards depend
only on *eligible* messages, not messages spammed during cooldown.

The MongoDB `member_xp` collection stores per-guild/member:

- `xp`: total XP (never reset during this migration).
- `activityXp`: earned activity XP (used for rank milestone checks).
- `bonusXpAwarded`: extra XP from milestone/shop rewards; does
  not advance activity-only tiers.
- `messageXpAwards`: count of eligible, XP-awarded chat messages.
- `lastMessageXp`: amount granted by the latest eligible message.
- `lastMessageXpAt`: date of the last grant.
- `lastXpMessageHash`: a hash of the last credited message to
  detect exact repeats without storing its text.

Each successful message grant atomically updates its XP and activity
counter in a MongoDB update pipeline. Stats survive Render restarts.
Existing users keep their accumulated XP, though their *displayed*
XP level is recalculated using the newer threshold formula.
Users whose old profiles lack `messageXpAwards` start the new growing
chat-award counter at zero (existing XP is preserved).

## Kings compatibility

Kings role progression remains a separate set of **five** roles
and categories. They correspond to first four activity-level
milestones: 0 / 50 / 100 / 150 / 250 activity XP. Kings Level 5
is the maximum Kings *rank*, not the maximum regular XP level.

## Testing

Run `npm test` (Node 22+) to verify boundary values, stage
transitions, unlimited levels and chat reward calculations.
