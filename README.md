# HusariaBot

HusariaBot is a TypeScript Discord bot for moderation workflows, ticket management, rich embeds, and an optional web dashboard for admins.

## Table of Contents

1. Overview
2. Features
3. Requirements
4. Quick Start
5. Environment Variables
6. Commands
7. Dashboard
8. Ticket System
9. Development
10. Security
11. Troubleshooting
12. License

## Overview

The project contains two main runtime parts:

1. Discord bot process (slash commands, tickets, embeds)
2. Admin dashboard (Discord OAuth login + embed/image publishing)

## Features

- Modular slash command architecture
- Role-based access control (`ADMIN_ROLE_ID`, `MODERATOR_ROLE_ID`)
- Dashboard-first embed publishing flow with multiple templates
- Image sender from local `img/` assets
- Ticket panel and per-user ticket channels with persistent counters
- Admin dashboard with Discord OAuth2 authentication
- Vitest-based automated tests

## Requirements

- Node.js 18+
- npm 9+
- Discord application and bot token

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill required values.

3. Register slash commands:

```bash
npm run deploy
```

4. Start the bot:

```bash
npm run dev
```

5. (Optional) Start dashboard:

```bash
npm run dashboard
```

## Environment Variables

Use `.env.example` as the source of truth. Key variables:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `ADMIN_ROLE_ID`
- `MODERATOR_ROLE_ID`
- `SUPPORT_CATEGORY_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_REDIRECT_URI`
- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_PORT` (optional, default `3000`)

Notes:

- `GUILD_ID` enables instant guild command updates.
- Without `GUILD_ID`, global command propagation may take up to about 1 hour.

## Commands

| Command | Description | Access |
| --- | --- | --- |
| `/ping` | Health check and gateway latency | Admin/Moderator |
| `/dashboard` | Sends secure link to admin dashboard | Admin/Moderator |
| `/sendimg` | Sends selected image from `img/` | Admin/Moderator |
| `/ticketyconfig` | Publishes ticket panel | Admin/Moderator |

## Dashboard

The dashboard is available at `http://localhost:3000` by default.

### Run

```bash
npm run dashboard
```

### API endpoints used by UI

- `GET /api/me`
- `GET /api/channels`
- `GET /api/images`
- `POST /api/send-image`
- `POST /api/embed`

### Dashboard scripts

- `npm run dashboard` - start once
- `npm run dashboard:dev` - watch mode via `tsx`

## Ticket System

### Ticket setup

1. Run `/ticketyconfig`
2. Fill in panel modal
3. Bot publishes ticket panel with open button

### Behavior

- Ticket channel naming: `zgloszenie-username-ticketNumber`
- Counter persistence file: `data/ticket-counter.json`
- Access includes ticket author, staff roles, and bot account
- Admin close flow requires reason submission

## Development

### Core scripts

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run deploy`
- `npm run clear-global`
- `npm test`
- `npm run test:watch`

### Project structure

```text
src/
  commands/
  embeds/
  tickets/
  utils/
  dashboard/
img/
data/
```

## Security

- Never commit `.env` files with real credentials
- Rotate `DISCORD_TOKEN` and `DISCORD_CLIENT_SECRET` immediately if exposed
- Keep `DASHBOARD_SESSION_SECRET` strong and unique per environment
- Staff-only operations are guarded by role checks
- Dashboard now validates incoming payload sizes and welcome-image URL format

## Troubleshooting

### Commands not visible

1. Ensure `CLIENT_ID` is valid
2. Run `npm run deploy`
3. If using global commands, wait for propagation

### Dashboard login fails

1. Verify `DISCORD_REDIRECT_URI` matches Discord Developer Portal exactly
2. Verify `DISCORD_CLIENT_SECRET`
3. Ensure user has required staff role in target guild

### Image send fails from dashboard

1. Ensure files exist in `img/`
2. Confirm channel was selected
3. Verify bot permissions in target channel (`Send Messages`, `Attach Files`)

### Build or runtime errors

```bash
npm run build
npm test
```

## License

ISC
