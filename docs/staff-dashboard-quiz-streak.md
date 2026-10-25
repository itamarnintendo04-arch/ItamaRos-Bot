# Staff Dashboard, Support Forms and Daily Quiz Prize Streaks

Everything sent to Discord from these systems is in English.

## Demo/test guild

The bot uses the Render environment setting `GUILD_ID` as the **only
configured guild** for the private dashboard and quiz streak commands.
It does not hardcode another server ID or copy data to another guild.
The dashboard shows metrics from that guild's MongoDB collections.

A private `#bot-dashboard` channel is created/refreshed for roles
with `Manage Server` / `Administrator`. Only the bot and those staff
roles receive channel viewing permissions. It updates every 15 minutes
while the service is running.

- `/dashboard view`: private dashboard with system buttons.
- `/dashboard publish`: post/update the staff-only panel.
- Sections: Overview, XP, Kings, Economy/Shop, Giveaways, Drops,
  Tickets, Daily Quiz, Radio, Invites, YouTube, Moderation and Setup.

All sections are **read-only**. Each shows relevant admin commands,
counts, current states or setup instructions. Manager commands are
hidden from regular Discord users through default command permissions.
Secrets and tokens from Render are never displayed.

## Support Center ticket types

The public select menu opens a **modal directly**. Its form asks the
question relevant to the ticket category. Public forms:

- Member Report
- Management Help
- Partnership
- **General Server Questions**: "What is your question about the server?"
- **Daily Questions — Help**: "What is your daily quiz question?"
- **Bug Report**: "What is not working?"
- **Server Suggestion**: "What would you like to suggest?"

**Daily Questions — Claim Prize** is an automatic, private ticket for
verified winners of a configured streak. It is not in the normal menu.
Normal Daily Quiz Help does **not** claim a prize. Giveaway claim tickets
also remain private/automatic.

## Start a multi-day prize streak

A manager runs:

`/quiz-tomorrow question:... answer:... streak_days:7`

This saves the next day's normal quiz and schedules a **seven-day**
prize streak starting tomorrow (2–30 days are supported).

For each subsequent day the manager supplies a separate question:

`/quiz-streak set-day day:2 question:... answer:...`

Repeat until all days are prepared. Commands:

- `/quiz-streak status` — shows all dates and missing questions.
- `/quiz-streak set-day` — add/change an unpublished future question.
- `/quiz-streak retry-prizes` — verify completed participants and
  retry tickets if Discord creation previously failed.
- `/quiz-streak cancel` — cancel the prize streak. Prepared daily
  questions stay available as ordinary quizzes.

The existing Daily Quiz schedule still publishes each prepared question
and privately accepts members' answers. A correct answer is stored
in `daily_quiz_winners`. A prize ticket is created **only after**
all consecutive streak dates have a correct answer for that member;
a single normal correct answer never opens a prize claim ticket.

MongoDB collections:

- `daily_quizzes`: day questions, answer and publication status
- `daily_quiz_winners`: daily verified winners, unique ID per day/user
- `daily_quiz_streaks`: start/end dates and required day count
- `daily_quiz_reward_claims`: unique per-streak prize claims and status
- `tickets`: private claim ticket records
- `bot_dashboard`: persistent dashboard message/channel references

Missing daily questions must be prepared by staff. The bot does not
invent or duplicate a question when a future day is not configured.

## Verification

The repository now includes automated Node 22 GitHub Actions checks.
Passing syntax checks and tests is not a replacement for a full live
Discord and MongoDB test. After deploying the latest commit on Render,
verify the configured guild, bot role hierarchy, private channel
permissions, Daily Quiz answer buttons and prize ticket creation.
