import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { pingCommand } from './commands/ping.js';
import { sendImgCommand } from './commands/sendimg.js';
import { ticketyConfigCommand } from './commands/ticketyconfig.js';
import { dashboardLinkCommand } from './commands/dashboardlink.js';

config();

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;
const guildId = process.env.GUILD_ID;

// Zbierz dane wszystkich komend
const commands = [
    pingCommand.data.toJSON(),
    sendImgCommand.data.toJSON(),
    ticketyConfigCommand.data.toJSON(),
    dashboardLinkCommand.data.toJSON(),
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
    }
}

deploy();
