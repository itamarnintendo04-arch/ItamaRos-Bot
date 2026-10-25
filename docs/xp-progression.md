# ItamaRos Bot — XP progression and chat activity

The bot keeps earned XP in MongoDB. Existing XP balances are preserved.
A member's displayed level is recalculated using the current progression.

## Levels get more demanding

Every step **doubles the previous XP requirement** instead of adding a
constant amount.

- Levels 1–15: requirement doubles **every 3 levels**.
- Levels 16–30: requirement doubles **every 2 levels**.
- Level 31 onward: requirement doubles **every level**.

| New level | Additional XP | Total XP needed |
| --- | ---: | ---: |
| 1 | 50 | 50 |
| 2 | 50 | 100 |
| 3 | 50 | 150 |
| 4 | 100 | 250 |
| 5 | 100 | 350 |
| 6 | 100 | 450 |
| 7 | 200 | 650 |
| 10 | 400 | 1,450 |
| 13 | 800 | 3,050 |
| 15 | 800 | 4,650 |
| 16 | 1,600 | 6,250 |
| 17 | 1,600 | 7,850 |
| 18 | 3,200 | 11,050 |
| 30 | 204,800 | 615,850 |
| 31 | 409,600 | 1,025,450 |
| 32 | 819,200 | 1,844,650 |

These exponential requirements get very large. There is no hard-coded
gameplay level maximum, but the current MongoDB/JavaScript XP representation
uses numbers and cannot safely represent an arbitrarily large value:
the maximum precisely representable integer XP is
`Number.MAX_SAFE_INTEGER`. This imposes a **technical ceiling** that
requires a future BigInt/string-backed schema to go beyond safely.

`src/systems/xp/progression.js` defines the thresholds. Both the
member level and the Kings rank progression use that formula.

## Increasing XP from real chat participation

An eligible message grants **5 XP** initially. Each subsequently
credited message gives 1 XP more: 5, 6, 7, 8 and so forth.

Eligibility includes a 60-second cooldown, a minimum of three
characters, a word filter, and repeated-message checks. Repeating a
message or sending messages during cooldown does not increase the award.

MongoDB collection `member_xp` stores:

- `xp`: total XP (not reset during migration).
- `activityXp`: chat/staff activity XP, excluding shop/milestone bonuses.
- `bonusXpAwarded`: awarded bonus XP.
- `messageXpAwards`: persisted number of messages granted XP.
- `lastMessageXp`: XP from the latest eligible message.
- `lastMessageXpAt`: last award time.
- `lastXpMessageHash`: normalized SHA-256 content hash for repeat detection.

The next-message grant and count survive bot/Render restarts.
Old profiles without `messageXpAwards` start the *new escalating
chat counter* at zero while preserving accumulated XP.

`/level` shows the level, progress, next requirement,
total XP and next chat message's award.

Kings is a **separate five-rank system**, using activity XP thresholds
0 / 50 / 100 / 150 / 250. Its five tiers do not cap the main XP system.

## QA

GitHub Actions `ItamaRos Bot Checks` runs JavaScript syntax checks
and `npm test` for progression, MongoDB activity rules, quiz prize streak
and Discord command/form smoke tests. Live tests in the configured
Discord guild must still be performed after a Render deployment.
