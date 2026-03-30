# HusariaBot

A Discord bot built with TypeScript and discord.js for server automation, styled embeds, and utility commands.

## Features

- Slash command architecture with modular command files.
- Interactive embed creator with preview and publish flow.
- Multiple embed templates for community use-cases.
- Server emoji export command.
- Image sender command that reads files from the local img folder.
- Type-safe codebase with TypeScript and Vitest test coverage for embed builders.
- Ticket system with configurable panel, per-user ticket channels, and persistent ticket numbering.
- Role-based access control for command execution and modal actions.

## Available Commands

| Command | Description | Notes |
| --- | --- | --- |
| /ping | Checks bot latency and gateway ping. | Basic health check. |
| /embed | Opens an interactive embed builder. | Executable only by Zarząd and Moderator roles. |
| /listemojis | Exports all custom server emojis to a text file. | Output format: NAME: '<:name:ID>' (or animated variant). |
| /sendimg | Sends an image selected from the img folder. | Executable only by Zarząd and Moderator roles. |
| /ticketyconfig | Publishes the ticket panel in the current channel. | Executable only by Zarząd and Moderator roles. |

## Ticket System

### Configuration flow

1. Run /ticketyconfig.
2. Fill the modal with the ticket system description.
3. Bot publishes the ticket panel embed with:
   - H1 heading in embed body.
   - Real server emoji (G2Hussars variants with fallback).
   - Green Otwórz ticket button.

### Ticket creation flow

- Ticket channels are created in category.
- Channel naming format:
  - zgloszenie-username-ticketNumber
- Ticket numbers are persistent and stored in:
  - data/ticket-counter.json
- Access to each ticket channel:
  - ticket author
  - Zarząd role
  - Moderator role
  - bot account

### First ticket message

- Red embed.
- Greeting text for the ticket author.
- Mention of Zarząd and Moderator roles inside embed content.
- In-channel close controls:
  - only Zamknij Ticket (Administracja), red button.

### User close flow

- User receives a private ephemeral close button after ticket creation.
- User confirms close in private interaction flow.
- Bot sends DM to the user with:
  - server emoji instead of :G2Hussars: text
  - lowercase word ticket
  - bold ticket channel name
  - final period
- Ticket channel is deleted.

### Admin close flow

- Admin clicks red Zamknij Ticket (Administracja).
- Admin confirms and submits required close reason in modal.
- Bot sends DM to ticket author with:
  - server emoji
  - bold ticket name
  - bold close reason
  - info about which admin closed the ticket
- Ticket channel is deleted.

### Interaction reliability

- Open-ticket button handling uses deferred interaction reply to avoid timeout issues.
- Duplicate ticket checks fetch channels from API to reduce cache-only race problems.

## Embed Templates

The /embed command currently supports:

- Match announcement
- Match result
- Free-form announcement
- Giveaway
- Welcome message
- Server rulebook
- Zgłoszenia

## Tech Stack

- Node.js
- TypeScript
- discord.js v14
- dotenv
- Vitest

## Project Structure

```text
src/
  commands/        # Slash commands
  embeds/          # Modal handlers and embed publishing flows
  tickets/         # Ticket lifecycle, constants, and counter storage
  utils/           # Embed builders, theme, emoji helpers
  index.ts         # Bot runtime entry point
  deploy-commands.ts
img/               # Static images used by commands/embeds
data/              # Persistent runtime data (ticket counter)
```

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Create environment variables

Create a .env file in the project root:

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_client_id_here
GUILD_ID=your_guild_id_here
```

Notes:

- GUILD_ID is optional. If provided, commands are registered as guild commands (instant updates).
- Without GUILD_ID, commands are registered globally (can take up to 1 hour to propagate).

### 3) Deploy slash commands

```bash
npm run deploy
```

### 4) Start the bot

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## Scripts

- npm run dev - Run bot with tsx
- npm run build - Compile TypeScript
- npm start - Run compiled bot from dist
- npm run deploy - Register slash commands
- npm run clear-global - Clear global slash commands
- npm test - Run tests once
- npm run test:watch - Run tests in watch mode

## Security

- Do not commit your .env file.
- Do not share your DISCORD_TOKEN.
- Regenerate token immediately if it is ever exposed.
- Runtime role checks are enforced in commands, modal handlers, and ticket admin actions.

## License

ISC
