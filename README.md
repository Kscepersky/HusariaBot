<div align="center">

# HusariaBot

**A production-grade Discord bot for the G2 Hussars community.**  
Built with TypeScript, discord.js v14, and an Express-powered admin dashboard.

![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

</div>

---

## Overview

HusariaBot is a fully self-hosted Discord bot with a built-in web admin dashboard. It covers the complete lifecycle of a community server: engagement through a leveling and coin economy, content publishing via a rich post creator with scheduling, automated voice channel management, a support ticket system, and role-based moderation tools.

Every subsystem is backed by structured JSON logging with per-scope loggers, Discord webhook alerting on critical failures, and a SQLite persistence layer that survives process restarts.

---

## Dashboard preview

![husariabot_dashboard](img/husariadashboard_preview.png)
---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Slash Commands](#slash-commands)
- [Dashboard](#dashboard)
- [Project Architecture](#project-architecture)
- [Testing](#testing)
- [Logging](#logging)
- [License](#license)

---

## Features

### Economy System

A fully configurable engagement system tracking XP, levels, and a server currency (Cebuliony).

- **XP & Leveling** — Members earn XP by sending messages (with per-user cooldown) and spending time in voice channels. Two leveling modes (`progressive` exponential, `linear`) and two curve formulas (`default`, `formula_v2`) can be tuned per guild without a redeploy.
- **Cebuliony (coins)** — Server currency awarded on level-up, daily claim, and watchparty participation.
- **Daily Rewards with Streak** — Configurable coin range, streak multiplier, max streak days, and grace window. Streak is preserved if the member claims within the grace period after missing a day.
- **Level Cards** — Canvas-generated image cards showing avatar, level, global rank, and XP progress bar. Rendered and returned as a Discord attachment.
- **Leaderboard** — Paginated ranking by XP or coins with Discord avatars, member display names, and personal rank highlighting.
- **Role Mappings** — Automatic Discord role assignment when a member reaches a configured level threshold. Managed from the dashboard without touching code.
- **Bulk CSV Import** — Import economy snapshots directly: `userId,level,totalxp,messages,voiceMinutes`. Validates each row with clear line-numbered error messages.
- **Staff Protection** — Configurable set of staff roles exempt from specific economy mechanics (e.g. XP exclusion zones).

### Watchparty

- Automatically creates a dedicated voice channel when a watchparty-enabled post is published or scheduled.
- Awards an XP multiplier and a per-minute coin bonus to all active participants.
- Full lifecycle management: channel opens at the scheduled time, closes automatically when empty or when the event ends. Includes rollback on persistence failure.

### Temporary Voice Channels

- Members joining the trigger channel immediately get their own private voice channel in the configured category.
- The channel is deleted automatically when the last member leaves.

### Support Tickets

- Configurable ticket panel published via `/ticketyconfig` — renders an embed with interactive buttons.
- Monotonic ticket counter with persisted state across restarts.
- Full ticket history stored in a JSON file.

### Timeouts (Mute)

- `/mute` command with configurable duration (minutes / hours / days) and a mandatory reason.
- Implemented via a dedicated `SERVER_MUTE_ROLE_ID` role rather than Discord's native timeout, providing more control.
- Auto-release on expiry with SQLite persistence — survives process restarts.
- Full audit log: who muted, who was muted, duration, and reason.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 6 |
| Runtime | Node.js 20+ |
| Discord | discord.js v14 |
| Web (dashboard) | Express v5 |
| Database | SQLite via `sqlite` + `sqlite3` |
| Input validation | Zod v4 |
| Image generation | Canvas |
| Sessions | express-session + SQLite store |
| Rate limiting | express-rate-limit |
| Testing | Vitest |
| Dev runner | tsx |
| Build | tsc |

---

## Prerequisites

- **Node.js** v20 or later
- **npm** v9 or later
- A Discord application registered in the [Discord Developer Portal](https://discord.com/developers/applications) with the following **Privileged Gateway Intents** enabled:
  - `GUILD_MEMBERS`
  - `GUILD_MESSAGES`
  - `MESSAGE_CONTENT`
  - `GUILD_VOICE_STATES`
- *(Optional)* A [PandaScore](https://pandascore.co/) API key for the G2 match history section.

---

## Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/Kscepersky/HusariaBot.git
cd HusariaBot

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and fill in all required values (see section below)

# 4. Register slash commands on your server
npm run deploy

# 5. Start the bot and dashboard as separate processes
npm run dev            # bot  — development mode (tsx watch)
npm run dashboard:dev  # dashboard — development mode (tsx watch)
```

**Production:**

```bash
npm run build      # compile TypeScript → dist/
npm start          # start the bot from dist/
npm run dashboard  # start the dashboard from dist/
```

> The bot and the dashboard are two independent Node.js processes. In production, run them as separate service units (e.g. two PM2 instances, two systemd services, or two Docker containers).

---

## Environment Variables

Copy `.env.example` to `.env` and fill in every value:

```env
# ── Discord Bot ──────────────────────────────────────────────────────────────
DISCORD_TOKEN=              # Bot token — Discord Developer Portal → Bot → Token
CLIENT_ID=                  # Application ID — Developer Portal → General Information
GUILD_ID=                   # Your server ID (guild-scoped commands deploy instantly)

# ── Role IDs ─────────────────────────────────────────────────────────────────
# Right-click a role in Discord → Copy Role ID
ADMIN_ROLE_ID=
MODERATOR_ROLE_ID=
COMMUNITY_MANAGER_ROLE_ID=
DEV_ROLE_ID=
SERVER_MUTE_ROLE_ID=        # Role assigned by /mute — must be below bot's highest role

# ── Channel & Category IDs ────────────────────────────────────────────────────
SUPPORT_CATEGORY_ID=           # Category where ticket channels are created
VOICE_TRIGGER_CHANNEL_ID=      # Joining this channel creates a private voice channel
VOICE_CATEGORY_ID=             # Category for temporary private voice channels
WATCHPARTY_CATEGORY_ID=        # Category for watchparty voice channels
LEVEL_UP_ANNOUNCE_CHANNEL_ID=  # Text channel for level-up announcements (optional)

# ── Dashboard OAuth2 ──────────────────────────────────────────────────────────
# Discord Developer Portal → OAuth2 → General
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
DASHBOARD_PORT=3000
DASHBOARD_BASE_URL=http://localhost:3000
DASHBOARD_SESSION_SECRET=      # Min 32 random chars — generate: openssl rand -hex 32
DASHBOARD_SESSION_TTL_HOURS=24
DASHBOARD_TRUST_PROXY=0        # Set to 1 if the dashboard is behind a reverse proxy

# ── Dashboard Rate Limiting ───────────────────────────────────────────────────
DASHBOARD_RATE_LIMIT_WINDOW_MS=900000     # 15 min window, 240 req max
DASHBOARD_RATE_LIMIT_MAX=240
DASHBOARD_MUTATION_RATE_LIMIT_WINDOW_MS=60000   # 1 min window, 80 mutations max
DASHBOARD_MUTATION_RATE_LIMIT_MAX=80
DASHBOARD_AUTH_RATE_LIMIT_WINDOW_MS=900000      # 15 min window, 30 auth attempts max
DASHBOARD_AUTH_RATE_LIMIT_MAX=30

# ── External Integrations ─────────────────────────────────────────────────────
PANDASCORE_API_KEY=        # PandaScore key (optional — powers the G2 match browser)
LOG_ALERT_WEBHOOK_URL=     # Discord webhook URL for error/fatal level log alerts

# ── Storage Paths (optional, default to working directory) ───────────────────
ECONOMY_DB_PATH=
DASHBOARD_SESSION_DB_PATH=

# ── Development ───────────────────────────────────────────────────────────────
DEV_LOGS=1
BOT_DEV_LOGS=1
```

---

## Slash Commands

### Available to Everyone

| Command | Description |
|---|---|
| `/daily` | Claim daily Cebuliony with streak multiplier |
| `/streak-daily` | Show your current daily streak and active multiplier |
| `/stankonta` | Display your current coin balance |
| `/level` | Show your level card — XP, global rank, and progress bar |
| `/leaderboard-xp` | Server leaderboard ranked by XP and level |

### Administration Only

> Commands registered with `setDefaultMemberPermissions(null)` — access is controlled exclusively through Discord's Integration settings on the server. No code-level permission check is needed.

| Command | Description |
|---|---|
| `/dodaj-xp` | Add XP to a member (with optional reason) |
| `/dodaj-coinsy` | Add Cebuliony to a member |
| `/usun-coinsy` | Remove Cebuliony from a member |
| `/resetuj-level` | Reset a member's level and XP to zero (requires confirmation) |
| `/resetuj-coinsy` | Reset a member's coin balance to zero (requires confirmation) |
| `/mute` | Assign a timed mute via the Server Mute role |
| `/ticketyconfig` | Publish the ticket panel embed to a specified channel |
| `/sendimg` | Send an image from the `/img` library to a channel |
| `/ping` | Check bot latency and Discord gateway connection status |

---

## Dashboard

The dashboard is a separate Express web application secured by Discord OAuth2. Access is restricted to members holding one of the configured admin roles (Admin, Moderator, Community Manager, Dev).

### Post Creator

A full-featured publishing tool that targets any text or announcement channel on the server:

- **Embed mode** — Build a rich Discord embed: title, description, color, author, footer, and image field. Live Discord-style preview rendered in the browser before sending.
- **Plain text mode** — Standard Discord message with full markdown and user/role mention support.
- **Role ping** — Optional role mention sent as a separate message immediately before the post. The bot validates that the role still exists before sending.
- **Image attach** — Attach from the server image library or upload a file (PNG, JPG, GIF, WebP — max 20 MB). SVG uploads are rejected by a multi-layer content security check.
- **Live preview** — WYSIWYG preview that re-renders on every keystroke.

### Scheduler

- Schedule posts for any future date and time.
- Manage the queue: edit, cancel, or immediately publish any pending post.
- Persistence survives process restarts — the scheduler re-registers all pending timers on startup using stored metadata.

### Sent Post History

- Complete history of every sent and scheduled post with statuses: `sent`, `pending`, `failed`, `cancelled`.
- Edit and resend any historical post directly from the history view.
- User mentions (`<@userId>`) are resolved to real display names via a prefetch from the Discord API before rendering.
- Associated Discord event and watchparty channel statuses shown inline.

### Economy Management

- Full leaderboard view with Discord avatars, paginated by XP or coins.
- Per-user account inspection and manual edit (XP, coins, message count, voice minutes).
- Bulk import via CSV: `userId,level,totalxp,messages,voiceMinutes`.
- Level → role mapping editor: configure which Discord role is awarded at which level threshold.
- Server activity statistics: message and voice minute charts over configurable date ranges, top users by composite score.

### Discord Events

- Create native Discord Scheduled Events directly from the post creator.
- Optionally link an event to a watchparty channel — the bot manages the channel lifecycle automatically.

### Watchparty Management

- Create watchparty voice channels linked to scheduled posts from the dashboard.
- Full lifecycle view: pending → open → closed, with last error and channel ID shown.
- Automatic channel rollback if persistence fails after channel creation.

### G2 Match Browser

- Pulls match history and results from the PandaScore API.
- Server-side response cache to avoid redundant API calls.

---

## Project Architecture

```
src/
├── index.ts                      # Bot entry point — loads client, registers event handlers
├── deploy-commands.ts            # Slash command registration script
│
├── commands/                     # One file per slash command
│   ├── daily.ts
│   ├── level.ts
│   ├── leaderboard-xp.ts
│   ├── mute.ts
│   ├── ticketyconfig.ts
│   └── ...
│
├── economy/
│   ├── types.ts                  # Domain types: EconomyConfig, EconomyUserState, …
│   ├── database.ts               # SQLite initialization and schema migrations
│   ├── repository.ts             # Data access layer — all SQL behind a consistent interface
│   ├── runtime.ts                # Bot event handlers: XP award on message, voice tick
│   ├── stats-store.ts            # Daily stats aggregation and time-series queries
│   └── ...
│
├── voice-channels/               # Temporary private voice channel lifecycle
├── tickets/                      # Ticket panel, history store, monotonic counter
├── timeouts/                     # Timed mute with SQLite-persisted auto-release
│
├── utils/
│   ├── logger.ts                 # Structured logger — .jsonl + .log + Discord webhook
│   ├── embed-builder.ts          # Discord embed construction utilities
│   ├── role-access.ts            # Role-based access checks
│   └── ...
│
└── dashboard/
    ├── index.ts                  # Dashboard entry point
    ├── server.ts                 # Express app setup, security headers, middleware chain
    ├── discord-api.ts            # Discord REST API client (bot token)
    ├── publish-flow.ts           # Core publish logic: ping → embed/text → image
    ├── embed-handlers.ts         # Embed payload validation and construction
    ├── event-publisher.ts        # Discord Scheduled Event creation
    ├── watchparty-publisher.ts   # Watchparty channel creation and teardown
    ├── watchparty-lifecycle.ts   # Watchparty open/close lifecycle management
    │
    ├── routes/
    │   └── api.ts                # All REST endpoints (~2 700 lines, 60+ routes)
    │
    ├── scheduler/
    │   ├── service.ts            # Scheduler — Node.js timers, re-registered on startup
    │   ├── store.ts              # Scheduled post persistence (JSON file)
    │   └── types.ts
    │
    ├── middleware/               # Auth, authorization, session, rate limiting
    ├── validation/               # Zod schemas for all API request bodies
    ├── views/                    # Server-rendered HTML (dashboard.html, login.html)
    ├── public/
    │   ├── css/style.css         # Dashboard stylesheet
    │   └── js/app.js             # Dashboard frontend — vanilla JS SPA, no bundler
    └── g2-matches/               # PandaScore API client, response cache, types
```

### Design Patterns

| Pattern | Where Applied |
|---|---|
| **Repository Pattern** | `economy/repository.ts` — data access fully decoupled from business logic |
| **Immutable Updates** | Entire codebase — all state changes produce new objects via spread; no in-place mutation |
| **Structured Logging** | `utils/logger.ts` — every operation logged with `action`, `scope`, context object, and full error stack |
| **Schema Validation** | `dashboard/validation/` — every API boundary validated with Zod before any processing |
| **SQLite Write Lock** | `economy/database.ts` — writes serialized through a `Promise` chain to prevent race conditions |
| **OAuth2 + CSRF** | `dashboard/middleware/` — Discord OAuth2 login flow, role assertion, timing-safe CSRF token comparison |

---

## Testing

```bash
npm test              # Run all tests (Vitest, single pass)
npm run test:watch    # Watch mode — reruns on file change
```

Test coverage includes:

- **Economy logic** — XP award, leveling curve, daily claim, streak calculation, CSV import validation
- **Repositories** — all SQL operations run against an in-memory SQLite database
- **Slash command parsing** — argument extraction and validation for each command
- **Voice channel module** — store, flow, and service layer tested in isolation
- **Dashboard embed handlers** — payload building, validation edge cases
- **PandaScore client** — API response parsing and error handling

---

## Logging

Every module creates a scoped logger via `createLogger(scope)` from `src/utils/logger.ts`.

**Outputs:**

| Output | Description |
|---|---|
| `logs/system-YYYY-MM-DD.jsonl` | Newline-delimited JSON — one entry per line, machine-readable |
| `logs/system-YYYY-MM-DD.log` | Human-readable formatted log for tailing in a terminal |
| Discord webhook | Automatic alert posted to `LOG_ALERT_WEBHOOK_URL` on `error` and `fatal` level entries |

**Active scopes:** `dashboard:api`, `dashboard:publish-flow`, `dashboard:scheduler`, and one per feature module.

**Entry schema:**

```json
{
  "timestampIso": "2026-05-10T14:23:01.000Z",
  "timestampMs": 1746885781000,
  "level": "error",
  "action": "EMBED_SEND_FAILED",
  "scope": "dashboard:publish-flow",
  "message": "Failed to send embed to Discord channel.",
  "context": {
    "channelId": "123456789012345678",
    "mode": "embedded",
    "publishedByUserId": "987654321098765432"
  },
  "error": {
    "name": "DiscordRequestError",
    "message": "Missing Access",
    "stack": "DiscordRequestError: Missing Access\n    at ..."
  }
}
```

---

## License

[MIT](LICENSE)
