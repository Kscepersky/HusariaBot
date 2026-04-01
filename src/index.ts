import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import { pingCommand } from './commands/ping.js';
import { sendImgCommand } from './commands/sendimg.js';
import { ticketyConfigCommand } from './commands/ticketyconfig.js';
import { dashboardLinkCommand } from './commands/dashboardlink.js';
import {
    handleAdminCloseReasonModalSubmit,
    handleAdminCloseTicketButton,
    handleAdminCloseTicketCancel,
    handleAdminCloseTicketConfirm,
    handleOpenTicketButton,
    handleTicketsConfigModalSubmit,
    handleUserCloseTicketButton,
    handleUserCloseTicketDmButton,
    handleUserCloseTicketDmCancel,
    handleUserCloseTicketDmConfirm,
    handleUserCloseTicketCancel,
    handleUserCloseTicketConfirm,
} from './tickets/flow.js';
import {
    TICKET_CLOSE_ADMIN_BUTTON_ID,
    TICKET_CLOSE_ADMIN_CANCEL_ID,
    TICKET_CLOSE_ADMIN_CONFIRM_ID,
    TICKET_CLOSE_ADMIN_REASON_MODAL_ID,
    TICKET_CLOSE_USER_BUTTON_ID,
    TICKET_CLOSE_USER_CANCEL_ID,
    TICKET_CLOSE_USER_CONFIRM_ID,
    TICKET_CLOSE_USER_DM_BUTTON_PREFIX,
    TICKET_CLOSE_USER_DM_CANCEL_PREFIX,
    TICKET_CLOSE_USER_DM_CONFIRM_PREFIX,
    TICKETS_CONFIG_MODAL_ID,
    TICKETS_OPEN_BUTTON_ID,
} from './tickets/constants.js';
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
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

// Zarejestruj komendy w kolekcji
client.commands = new Collection();
client.commands.set(pingCommand.data.name, pingCommand);
client.commands.set(sendImgCommand.data.name, sendImgCommand);
client.commands.set(ticketyConfigCommand.data.name, ticketyConfigCommand);
client.commands.set(dashboardLinkCommand.data.name, dashboardLinkCommand);

// Event: Bot jest gotowy
client.on('clientReady', () => {
    console.log('──────────────────────────────────────');
    console.log(`✅  Bot zalogowany jako ${client.user?.tag}`);
    console.log(`📡  Serwery: ${client.guilds.cache.size}`);
    console.log('──────────────────────────────────────');
});

async function safelyReplyInteractionError<T extends {
    replied: boolean;
    deferred: boolean;
    reply: (options: any) => Promise<unknown>;
    followUp: (options: any) => Promise<unknown>;
}>(interaction: T, content: string): Promise<void> {
    const payload = { content, flags: 64 };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (err) {
        const errorCode = (err as { code?: number })?.code;
        if (errorCode !== 10062) {
            console.error('❌  Nie udało się wysłać odpowiedzi błędu interakcji:', err);
        }
    }
}

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
            if (interaction.customId === TICKETS_CONFIG_MODAL_ID) {
                await handleTicketsConfigModalSubmit(interaction);
            } else if (interaction.customId === TICKET_CLOSE_ADMIN_REASON_MODAL_ID) {
                await handleAdminCloseReasonModalSubmit(interaction);
            }
        } catch (error) {
            console.error('❌  Błąd w modal submit:', error);
            await safelyReplyInteractionError(interaction, '❌ Wystąpił błąd podczas obsługi formularza.');
        }
        return;
    }

    if (interaction.isButton()) {
        try {
            if (interaction.customId === TICKETS_OPEN_BUTTON_ID) {
                await handleOpenTicketButton(interaction);
            } else if (interaction.customId.startsWith(`${TICKET_CLOSE_USER_DM_BUTTON_PREFIX}:`)) {
                await handleUserCloseTicketDmButton(interaction);
            } else if (interaction.customId.startsWith(`${TICKET_CLOSE_USER_DM_CONFIRM_PREFIX}:`)) {
                await handleUserCloseTicketDmConfirm(interaction);
            } else if (interaction.customId.startsWith(`${TICKET_CLOSE_USER_DM_CANCEL_PREFIX}:`)) {
                await handleUserCloseTicketDmCancel(interaction);
            } else if (interaction.customId === TICKET_CLOSE_USER_BUTTON_ID) {
                await handleUserCloseTicketButton(interaction);
            } else if (interaction.customId === TICKET_CLOSE_USER_CONFIRM_ID) {
                await handleUserCloseTicketConfirm(interaction);
            } else if (interaction.customId === TICKET_CLOSE_USER_CANCEL_ID) {
                await handleUserCloseTicketCancel(interaction);
            } else if (interaction.customId === TICKET_CLOSE_ADMIN_BUTTON_ID) {
                await handleAdminCloseTicketButton(interaction);
            } else if (interaction.customId === TICKET_CLOSE_ADMIN_CONFIRM_ID) {
                await handleAdminCloseTicketConfirm(interaction);
            } else if (interaction.customId === TICKET_CLOSE_ADMIN_CANCEL_ID) {
                await handleAdminCloseTicketCancel(interaction);
            }
        } catch (error) {
            console.error('❌  Błąd w obsłudze przycisku:', error);
            await safelyReplyInteractionError(interaction, '❌ Wystąpił błąd podczas obsługi przycisku.');
        }
        return;
    }
});

// Zaloguj bota
client.login(process.env.DISCORD_TOKEN);
