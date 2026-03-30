import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import { pingCommand } from './commands/ping.js';
import { listEmojisCommand } from './commands/listemojis.js';
import { sendImgCommand } from './commands/sendimg.js';
import {
    embedCommand,
    EMBED_MODAL_MATCH,
    EMBED_MODAL_RESULT,
    EMBED_MODAL_ANNOUNCEMENT,
    EMBED_MODAL_GIVEAWAY,
    EMBED_MODAL_WELCOME,
    EMBED_MODAL_RULEBOOK,
} from './commands/embed.js';
import { handleMatchModalSubmit }        from './embeds/match.js';
import { handleResultModalSubmit }       from './embeds/result.js';
import { handleAnnouncementModalSubmit } from './embeds/announcement.js';
import { handleGiveawayModalSubmit }     from './embeds/giveaway.js';
import { handleWelcomeModalSubmit }      from './embeds/welcome.js';
import { handleRulebookModalSubmit }     from './embeds/rulebook.js';

// Załaduj zmienne środowiskowe z .env
config();

// Rozszerzenie typów Client o kolekcję komend
declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

// Stwórz klienta Discord
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// Zarejestruj komendy w kolekcji
client.commands = new Collection();
client.commands.set(pingCommand.data.name, pingCommand);
client.commands.set(listEmojisCommand.data.name, listEmojisCommand);
client.commands.set(sendImgCommand.data.name, sendImgCommand);
client.commands.set(embedCommand.data.name, embedCommand);

// Event: Bot jest gotowy
client.on('clientReady', () => {
    console.log('──────────────────────────────────────');
    console.log(`✅  Bot zalogowany jako ${client.user?.tag}`);
    console.log(`📡  Serwery: ${client.guilds.cache.size}`);
    console.log('──────────────────────────────────────');
});

// Event: Obsługa interakcji
client.on('interactionCreate', async (interaction) => {
    // Obsługa slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`❌  Nie znaleziono komendy: ${interaction.commandName}`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`❌  Błąd w komendzie ${interaction.commandName}:`, error);

            const reply = { content: '❌ Wystąpił błąd podczas wykonywania komendy.', ephemeral: true as const };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
        return;
    }

    // Obsługa modal submit (formularze)
    if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId === EMBED_MODAL_MATCH) {
                await handleMatchModalSubmit(interaction);
            } else if (interaction.customId === EMBED_MODAL_RESULT) {
                await handleResultModalSubmit(interaction);
            } else if (interaction.customId === EMBED_MODAL_ANNOUNCEMENT) {
                await handleAnnouncementModalSubmit(interaction);
            } else if (interaction.customId === EMBED_MODAL_GIVEAWAY) {
                await handleGiveawayModalSubmit(interaction);
            } else if (interaction.customId === EMBED_MODAL_WELCOME) {
                await handleWelcomeModalSubmit(interaction);
            } else if (interaction.customId === EMBED_MODAL_RULEBOOK) {
                await handleRulebookModalSubmit(interaction);
            }
        } catch (error) {
            console.error('❌  Błąd w modal submit:', error);
        }
        return;
    }
});

// Zaloguj bota
client.login(process.env.DISCORD_TOKEN);
