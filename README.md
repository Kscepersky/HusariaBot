# HusariaBot

Modern Discord bot written in TypeScript with an admin dashboard, ticket system, post publisher, and G2 matches integration (PandaScore + SQLite).

## Table of Contents

1. Overview
2. Key Features
3. Architecture
4. Requirements
5. Quick Start
6. Environment Configuration
7. Bot Commands
8. Dashboard
9. Development Scripts
10. Security and GitHub Commit Checklist
11. Troubleshooting
12. License

## Overview

The project runs as two processes:

1. Discord bot
2. Web dashboard (Express + Discord OAuth2)

This separates moderation/publishing workflows from in-Discord operations.

## Key Features

- Slash commands for staff and members.
- Ticket system with persistent counter.
- Temporary voice channels with reconnect grace period.
- Dashboard post creator (embedded and plain message modes) with preview.
- Scheduled posting with edit support.
- Sent-post history with edit, retry, and delete flows.
- Discord Scheduled Events management.
- Optional watchparty voice channel lifecycle (scheduled/open/closed/deleted).
- Economy module (daily, streak, XP, level, admin mutations, leaderboard in dashboard).
- G2 matches database based on PandaScore + SQLite.
- Unit/integration tests with Vitest.

## Architecture

```text
src/
  commands/                 Slash commands
  tickets/                  Ticket logic
  voice-channels/           Temporary voice channels (create/move/cleanup)
  economy/                  Economy domain (repo/runtime/admin/leaderboard)
  embeds/                   Embed templates and builders
  dashboard/
    routes/                 Dashboard API routes
    scheduler/              Post scheduler
    g2-matches/             PandaScore + SQLite integration
    public/                 Dashboard frontend assets
data/                       Local data (SQLite/JSON)
img/                        Image library
```

## Requirements

- Node.js 20.17+ (Node.js 22 LTS recommended)
- npm 9+
- Discord application + bot configured in Discord Developer Portal
- For `canvas`: on some environments without prebuilt binaries you may need native build tooling (Windows Build Tools / Python / C++ toolchain)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy environment template:

```bash
copy .env.example .env
```

3. Fill values in `.env`.

4. Register slash commands:

```bash
npm run deploy
```

5. Start the bot:

```bash
npm run dev
```

6. Start the dashboard (optional):

```bash
npm run dashboard
```

## Environment Configuration

Source of truth: `.env.example`.

Most important variables:

| Variable | Required | Description |
| --- | --- | --- |
| DISCORD_TOKEN | yes | Bot token |
| CLIENT_ID | yes | Discord application ID |
| GUILD_ID | recommended | Test guild for instant command propagation |
| ADMIN_ROLE_ID | yes | Admin role ID |
| MODERATOR_ROLE_ID | yes | Moderator role ID |
| COMMUNITY_MANAGER_ROLE_ID | yes (dashboard) | Community Manager role ID |
| DEV_ROLE_ID | yes (dashboard) | Dev role ID (full dashboard + economy access) |
| SUPPORT_CATEGORY_ID | yes | Tickets category ID |
| VOICE_TRIGGER_CHANNEL_ID | yes (temp voice) | Trigger voice channel ID |
| VOICE_CATEGORY_ID | yes (temp voice) | Category ID for temporary voice channels |
| WATCHPARTY_CATEGORY_ID | no (watchparty) | Category ID for watchparty voice channels |
| DISCORD_CLIENT_SECRET | yes (dashboard) | OAuth2 client secret |
| DISCORD_REDIRECT_URI | yes (dashboard) | OAuth redirect URI |
| DASHBOARD_SESSION_SECRET | yes (dashboard) | Express session secret |
| DASHBOARD_SESSION_DB_PATH | no | Dashboard session SQLite path |
| ECONOMY_DB_PATH | no | Economy SQLite path |
| LEVEL_UP_ANNOUNCE_CHANNEL_ID | no | Text channel ID for natural level-up announcements |
| DASHBOARD_SESSION_TTL_HOURS | no | Dashboard session TTL in hours |
| DASHBOARD_TRUST_PROXY | no | Proxy trust setting (1/0) |
| DASHBOARD_PORT | no | Dashboard port (default: 3000) |
| DASHBOARD_BASE_URL | yes (dashboard) | Public dashboard URL used by `/dashboard` command |
| PANDASCORE_API_KEY | yes (G2 module) | PandaScore API key |
| DEV_LOGS | no | Dashboard developer logs (1/0) |
| BOT_DEV_LOGS | no | Bot heartbeat/dev logs (1/0) |
| DASHBOARD_RATE_LIMIT_WINDOW_MS | no | Global dashboard rate-limit window (ms) |
| DASHBOARD_RATE_LIMIT_MAX | no | Max global dashboard requests per window |
| DASHBOARD_AUTH_RATE_LIMIT_WINDOW_MS | no | OAuth callback rate-limit window (ms) |
| DASHBOARD_AUTH_RATE_LIMIT_MAX | no | Max OAuth callbacks per window |
| DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS | no | Dashboard mutation rate-limit window (ms) |
| DASHBOARD_MUTATION_RATE_LIMIT_MAX | no | Max dashboard mutations per window |

Temporary voice flow:

1. User joins `VOICE_TRIGGER_CHANNEL_ID`.
2. Bot creates `username-voice` in `VOICE_CATEGORY_ID` and moves the user.
3. If user already has an active temp channel, bot moves user to it instead of creating another.
4. Empty temp channels are removed after 10 seconds (grace period for reconnect).

## Bot Commands

| Command | Description | Access |
| --- | --- | --- |
| /ping | Health check and latency | Admin/Moderator/CommunityManager/Dev |
| /dashboard | Dashboard link | Admin/Moderator/CommunityManager/Dev |
| /sendimg | Send image from `img` library | Admin/Moderator/CommunityManager/Dev |
| /ticketyconfig | Configure ticket panel | Admin/Moderator/CommunityManager/Dev |
| /daily | Claim daily coin reward | All guild members |
| /streak-daily | Show daily streak and multiplier | All guild members |
| /leaderboard-xp | XP/level leaderboard | All guild members |
| /stankonta | Private coin balance summary | All guild members |
| /level | Public level card image with XP progress | All guild members |
| /dodaj-coinsy | Add coins to target user | Admin/Moderator/CommunityManager/Dev |
| /dodaj-xp | Add XP to target user | Admin/Moderator/CommunityManager/Dev |
| /usun-coinsy | Remove coins from target user | Admin/Moderator/CommunityManager/Dev |
| /resetuj-level | Reset target user level and XP | Admin/Moderator/CommunityManager/Dev |
| /resetuj-coinsy | Reset target user coins | Admin/Moderator/CommunityManager/Dev |

## Dashboard

Default URL: `http://localhost:3000`

Dashboard modules:

- Post creator (embedded/message).
- Scheduled posts.
- Sent posts (edit, retry, delete).
- Discord Scheduled Events management (CRUD).
- G2 matches (PandaScore sync, filters, refresh).
- Economy settings (daily, leveling, text/voice XP, reset users, strict CSV import snapshot, role rewards per level).
- Economy leaderboard (XP/coins sorting, pagination, Discord display names/avatars, message and voice-minute stats).
- Economy access policy: settings/mutations/import/level-role mappings are Dev-only; leaderboard is available for Admin/Moderator/CommunityManager/Dev.

Economy CSV import format:

- Strict no-header rows: `userId,level,xp,messages,voiceMinutes`
- `level` uses HusariaBot internal scale where first level is `1`
- `xp` means XP inside current level (not total XP)
- Import uses current leveling curve to convert level + xp into total XP
- Import works in snapshot mode (overwrites target state fields, does not add)
- Import is fail-fast with full rollback on first invalid row

Dashboard scripts:

- `npm run dashboard`
- `npm run dashboard:dev`

## Development Scripts

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run deploy`
- `npm run clear-global`
- `npm test`
- `npm run test:watch`

## Security and GitHub Commit Checklist

Before committing:

1. Never commit `.env` or any environment file with real secrets.
2. Commit only `.env.example` with placeholders.
3. Verify staged files:

```bash
git diff --cached --name-only
```

4. If any secret might have leaked, rotate immediately:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_SECRET`
   - `PANDASCORE_API_KEY`
   - `DASHBOARD_SESSION_SECRET`

Additional security rules:

- Staff operations are role-protected.
- Dashboard validates mutation payloads.
- CSRF tokens are required for mutating API endpoints.
- Multi-layer rate limiting is enabled (global + OAuth callback + API mutations).
- Dashboard sessions are stored in SQLite (not MemoryStore).
- Do not publish logs containing environment data.

## Troubleshooting

### Commands do not appear in Discord

1. Verify `CLIENT_ID` and token.
2. Run `npm run deploy`.
3. If using global commands, wait for propagation.

### Dashboard login fails

1. Redirect URI must exactly match Discord Developer Portal.
2. Verify `DISCORD_CLIENT_SECRET`.
3. Confirm the user has required staff role.

### G2 matches are not syncing

1. Verify `PANDASCORE_API_KEY`.
2. Check PandaScore rate limits.
3. Enable dashboard dev logs (`DEV_LOGS=1`).

### Discord event creation fails

1. Bot must have `Manage Events` permission.
2. Verify `GUILD_ID` and bot membership in guild.
3. Ensure event date/time is in the future.

### Build/tests fail

```bash
npm run build
npm test
```

## License

MIT
