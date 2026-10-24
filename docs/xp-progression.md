# Progressive XP — ItamaRos Bot

XP levels have **no configured maximum level**. There is only the
technical limit of JavaScript safe integer storage (9,007,199,254,740,991 XP).

## XP required for each next level

The first level costs 200 XP. The next level costs 250 XP,
then 300 XP, 350 XP, and so forth, increasing by 50 XP every time.

`xpNeededForNextLevel = 200 + 50 * currentLevel`

`totalXpForLevel(L) = 200 * L + 25 * L * (L - 1)`

| New level | Additional XP | Total XP needed |
| --- | ---: | ---: |
| 1 | 200 | 200 |
| 2 | 250 | 450 |
| 3 | 300 | 750 |
| 4 | 350 | 1,100 |
| 5 | 400 | 1,500 |
| 6 | 450 | 1,950 |
| 10 | 650 | 4,250 |
| 20 | 1,150 | 13,500 |
| 50 | 2,650 | 71,250 |
| 100 | 5,150 | 267,500 |

Player profiles and existing XP balances are **not erased or reset**.
After deployment the player's displayed level will be recalculated
using the new progression, which can be lower than under the old
200-XP-per-level system even though their XP stays unchanged.

`/level` displays the current level, XP into the current level,
the XP needed to advance, and the total XP needed for the next level.

`/xp-leaderboard` uses the same calculation. Staff `/xp` commands
and giveaways support level requirements beyond 1,000.

**Kings roles remain capped at five tiers by design.** Their activity
XP thresholds follow the first four new level milestones:
Kings 1 at 0, Kings 2 at 200, Kings 3 at 450,
Kings 4 at 750, Kings 5 at 1,100 activity XP.
Milestone bonus XP does not count towards Kings progression.
