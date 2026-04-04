import { REST, Routes } from 'discord.js';
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

config();

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Brakuje ${name}. Nie mozna zarejestrowac komend.`);
    }

    return value;
}

const token = requireEnv('DISCORD_TOKEN');
const clientId = requireEnv('CLIENT_ID');
const guildId = process.env.GUILD_ID;

// Zbierz dane wszystkich komend
const commands = [
    pingCommand.data.toJSON(),
    sendImgCommand.data.toJSON(),
    ticketyConfigCommand.data.toJSON(),
    dashboardLinkCommand.data.toJSON(),
    dailyCommand.data.toJSON(),
    streakDailyCommand.data.toJSON(),
    dodajCoinsyCommand.data.toJSON(),
    dodajXpCommand.data.toJSON(),
    usunCoinsyCommand.data.toJSON(),
    resetujLevelCommand.data.toJSON(),
    resetujCoinsyCommand.data.toJSON(),
    leaderboardXpCommand.data.toJSON(),
    stankontaCommand.data.toJSON(),
    levelCommand.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
    try {
        console.log(`🔄  Rejestruję ${commands.length} komend(y)...`);

        if (guildId) {
            // Guild commands — rejestrują się natychmiast (idealne do testowania)
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
                body: commands,
            });
            console.log(`✅  Zarejestrowano komendy na serwerze: ${guildId}`);
        } else {
            // Global commands — mogą zająć do 1h żeby się pojawić
            await rest.put(Routes.applicationCommands(clientId), {
                body: commands,
            });
            console.log('✅  Zarejestrowano komendy globalnie (może zająć do 1h)');
        }
    } catch (error) {
        console.error('❌  Błąd rejestracji komend:', error);
        process.exitCode = 1;
    }
}

deploy();
