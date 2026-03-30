# HusariaBot

A Discord bot built with TypeScript and discord.js for server automation, styled embeds, and utility commands.

## Features

- Slash command architecture with modular command files.
- Interactive embed creator with preview and publish flow.
- Multiple embed templates for community use-cases.
- Server emoji export command.
- Image sender command that reads files from the local img folder.
- Type-safe codebase with TypeScript and Vitest test coverage for embed builders.

## Available Commands

| Command | Description | Notes |
| --- | --- | --- |
| /ping | Checks bot latency and gateway ping. | Basic health check. |
| /embed | Opens an interactive embed builder. | Requires Manage Messages permission. |
| /listemojis | Exports all custom server emojis to a text file. | Output format: NAME: '<:name:ID>' (or animated variant). |
| /sendimg | Sends an image selected from the img folder. | Requires Manage Messages permission. |

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
  utils/           # Embed builders, theme, emoji helpers
  index.ts         # Bot runtime entry point
  deploy-commands.ts
img/               # Static images used by commands/embeds
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

## License

ISC
