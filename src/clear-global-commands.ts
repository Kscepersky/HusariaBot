import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';

config();

const token = process.env.DISCORD_TOKEN!;
const clientId = process.env.CLIENT_ID!;

const rest = new REST({ version: '10' }).setToken(token);

async function clearGlobalCommands() {
    try {
        console.log('🗑️  Usuwam wszystkie globalne komendy...');

        await rest.put(Routes.applicationCommands(clientId), { body: [] });

        console.log('✅  Globalne komendy usunięte. Może minąć do 1h zanim znikną z Discord.');
    } catch (error) {
        console.error('❌  Błąd:', error);
    }
}

clearGlobalCommands();
