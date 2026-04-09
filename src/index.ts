import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { config } from 'dotenv';
import { pingCommand } from './commands/ping.js';
import { sendImgCommand } from './commands/sendimg.js';
import { ticketyConfigCommand } from './commands/ticketyconfig.js';
import { dashboardLinkCommand } from './commands/dashboardlink.js';
import { dailyCommand } from './commands/daily.js';
import { streakDailyCommand } from './commands/streak-daily.js';
import { dodajCoinsyCommand } from './commands/dodaj-coinsy.js';
import { dodajXpCommand } from './commands/dodaj-xp.js';
import { usunCoinsyCommand } from './commands/usun-coinsy.js';
import { resetujLevelCommand } from './commands/resetuj-level.js';
import { resetujCoinsyCommand } from './commands/resetuj-coinsy.js';
import { leaderboardXpCommand } from './commands/leaderboard-xp.js';
import { stankontaCommand } from './commands/stankonta.js';
import { levelCommand } from './commands/level.js';
import { muteCommand } from './commands/mute.js';
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
import { handleVoiceStateUpdate } from './voice-channels/flow.js';
import { cleanupOrphanedTemporaryVoiceRecords } from './voice-channels/service.js';
import { handleEconomyResetButton } from './economy/admin-reset-buttons.js';
import { handleEconomyLeaderboardButton } from './economy/leaderboard-buttons.js';
import { handleEconomyMessageCreate, startEconomyVoiceXpTicker } from './economy/runtime.js';
import { startTimeoutExpiryTicker } from './timeouts/runtime.js';
import { createLogger } from './utils/logger.js';
// Załaduj zmienne środowiskowe z .env
config();

const BOT_HEARTBEAT_INTERVAL_MS = 60_000;
let stopEconomyVoiceTicker: (() => void) | null = null;
let stopTimeoutExpiryTicker: (() => void) | null = null;
const botLogger = createLogger('bot:runtime');

function isBotDevLogsEnabled(): boolean {
    const forceDisabled = process.env.BOT_DEV_LOGS === '0';
    return process.env.NODE_ENV !== 'production' && !forceDisabled;
}

function formatWebSocketState(state: number): string {
    switch (state) {
        case 0:
            return 'CONNECTING';
        case 1:
            return 'OPEN';
        case 2:
            return 'CLOSING';
        case 3:
            return 'CLOSED';
        default:
            return `UNKNOWN(${state})`;
    }
}

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
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Zarejestruj komendy w kolekcji
client.commands = new Collection();
client.commands.set(pingCommand.data.name, pingCommand);
client.commands.set(sendImgCommand.data.name, sendImgCommand);
client.commands.set(ticketyConfigCommand.data.name, ticketyConfigCommand);
client.commands.set(dashboardLinkCommand.data.name, dashboardLinkCommand);
client.commands.set(dailyCommand.data.name, dailyCommand);
client.commands.set(streakDailyCommand.data.name, streakDailyCommand);
client.commands.set(dodajCoinsyCommand.data.name, dodajCoinsyCommand);
client.commands.set(dodajXpCommand.data.name, dodajXpCommand);
client.commands.set(usunCoinsyCommand.data.name, usunCoinsyCommand);
client.commands.set(resetujLevelCommand.data.name, resetujLevelCommand);
client.commands.set(resetujCoinsyCommand.data.name, resetujCoinsyCommand);
client.commands.set(leaderboardXpCommand.data.name, leaderboardXpCommand);
client.commands.set(stankontaCommand.data.name, stankontaCommand);
client.commands.set(levelCommand.data.name, levelCommand);
client.commands.set(muteCommand.data.name, muteCommand);

// Event: Bot jest gotowy
client.on('clientReady', () => {
    botLogger.info('BOT_READY', 'Bot zalogowany.', {
        botTag: client.user?.tag ?? null,
        guildCount: client.guilds.cache.size,
    });
    if (isBotDevLogsEnabled()) {
        botLogger.debug('BOT_DEV_HEALTH', 'Stan websocket po uruchomieniu.', {
            wsState: formatWebSocketState(client.ws.status),
            pingMs: client.ws.ping,
        });

        setInterval(() => {
            const uptimeSec = Math.floor(process.uptime());
            botLogger.debug('BOT_HEARTBEAT', 'Heartbeat procesu bota.', {
                active: true,
                wsState: formatWebSocketState(client.ws.status),
                pingMs: client.ws.ping,
                guildCount: client.guilds.cache.size,
                uptimeSec,
            });
        }, BOT_HEARTBEAT_INTERVAL_MS).unref();
    }

    void cleanupOrphanedTemporaryVoiceRecords(client).catch((error) => {
        botLogger.error('BOT_VOICE_ORPHAN_CLEANUP_FAILED', 'Nie udalo sie posprzatac osieroconych rekordow kanałów voice.', {}, error);
    });

    stopEconomyVoiceTicker?.();
    stopEconomyVoiceTicker = startEconomyVoiceXpTicker(client);

    stopTimeoutExpiryTicker?.();
    stopTimeoutExpiryTicker = startTimeoutExpiryTicker(client);

});

client.on('warn', (warning) => {
    if (isBotDevLogsEnabled()) {
        botLogger.warn('BOT_WARN', 'Discord client warning.', {
            warning,
        });
    }
});

client.on('error', (error) => {
    botLogger.error('BOT_CLIENT_ERROR', 'Discord client error.', {}, error);
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
                botLogger.error('BOT_INTERACTION_ERROR_REPLY_FAILED', 'Nie udalo sie wyslac odpowiedzi bledu interakcji.', {
                    discordErrorCode: errorCode ?? null,
                }, err);
        }
    }
}

// Event: Obsługa interakcji
client.on('interactionCreate', async (interaction) => {
    // Obsługa slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            botLogger.error('BOT_COMMAND_NOT_FOUND', 'Nie znaleziono komendy.', {
                commandName: interaction.commandName,
            });
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            botLogger.error('BOT_COMMAND_EXECUTION_FAILED', 'Blad wykonania komendy.', {
                commandName: interaction.commandName,
                actorUserId: interaction.user.id,
            }, error);

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
            botLogger.error('BOT_MODAL_SUBMIT_FAILED', 'Blad obslugi modal submit.', {
                customId: interaction.customId,
                actorUserId: interaction.user.id,
            }, error);
            await safelyReplyInteractionError(interaction, '❌ Wystąpił błąd podczas obsługi formularza.');
        }
        return;
    }

    if (interaction.isButton()) {
        try {
            if (await handleEconomyResetButton(interaction)) {
                return;
            }

            if (await handleEconomyLeaderboardButton(interaction)) {
                return;
            }

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
            botLogger.error('BOT_BUTTON_HANDLER_FAILED', 'Blad obslugi przycisku.', {
                customId: interaction.customId,
                actorUserId: interaction.user.id,
            }, error);
            await safelyReplyInteractionError(interaction, '❌ Wystąpił błąd podczas obsługi przycisku.');
        }
        return;
    }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        await handleVoiceStateUpdate(oldState, newState);
    } catch (error) {
        botLogger.error('BOT_VOICE_STATE_HANDLER_FAILED', 'Blad obslugi tymczasowych kanałow voice.', {
            guildId: newState.guild.id,
            actorUserId: newState.member?.id,
        }, error);
    }
});

client.on('messageCreate', async (message) => {
    try {
        await handleEconomyMessageCreate(message);
    } catch (error) {
        botLogger.error('BOT_XP_MESSAGE_HANDLER_FAILED', 'Blad naliczania XP za wiadomosc.', {
            guildId: message.guildId ?? undefined,
            actorUserId: message.author.id,
        }, error);
    }
});

// Zaloguj bota
const discordToken = process.env.DISCORD_TOKEN?.trim();

if (!discordToken) {
    botLogger.fatal('BOT_TOKEN_MISSING', 'Brakuje DISCORD_TOKEN. Bot nie moze wystartowac.');
    process.exit(1);
}

if (isBotDevLogsEnabled()) {
    botLogger.debug('BOT_INIT_START', 'Start inicjalizacji bota.', {
        hasDiscordToken: Boolean(discordToken),
        commandCount: client.commands.size,
    });
}

void client.login(discordToken).then(() => {
    if (isBotDevLogsEnabled()) {
        botLogger.debug('BOT_LOGIN_ACCEPTED', 'Login request accepted by Discord Gateway.');
    }
}).catch((error) => {
    botLogger.fatal('BOT_LOGIN_FAILED', 'Nie udalo sie zalogowac do Discorda.', {}, error);
    process.exit(1);
});
