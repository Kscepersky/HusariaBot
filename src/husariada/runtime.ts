import { MessageFlags, type ButtonInteraction, type Client } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import { getHusariadaChannelId } from './runtime-config.js';
import { createDiscordChannelPort } from './discord-port.js';
import { answerLabel, isAnswerCustomId, parseAnswerCustomId } from './embeds.js';
import { HusariadaEngine } from './engine.js';
import type { AnswerOutcome } from './engine-types.js';
import { getHusariadaStore } from './store.js';

/** Uruchomienie Husariady w procesie bota: silnik, polling polecen z dashboardu, heartbeat. */

export const COMMAND_POLL_INTERVAL_MS = 1_000;
export const HEARTBEAT_INTERVAL_MS = 5_000;

const runtimeLogger = createLogger('husariada:runtime');
let engine: HusariadaEngine | null = null;

/** Startuje silnik (po `clientReady`) i zwraca funkcje zatrzymujaca. */
export function startHusariadaRuntime(client: Client): () => void {
    const channelId = getHusariadaChannelId();
    if (!channelId) {
        runtimeLogger.info('HUSARIADA_DISABLED', 'Brak HUSARIADA_CHANNEL_ID - Husariada wylaczona.');
        return () => undefined;
    }

    let stopped = false;
    let polling = false;
    const timers: NodeJS.Timeout[] = [];

    void (async () => {
        const store = await getHusariadaStore();
        if (stopped) return;
        const instance = new HusariadaEngine(store, createDiscordChannelPort(client, channelId));
        engine = instance;
        await instance.recover();

        const beat = (): void => {
            void store.setMeta('engine_heartbeat_at', String(Date.now())).catch((error: unknown) => {
                runtimeLogger.warn('HUSARIADA_HEARTBEAT_FAILED', 'Nie udalo sie zapisac heartbeatu Husariady.', {}, error);
            });
        };
        beat();

        timers.push(setInterval(() => {
            if (polling) return;
            polling = true;
            void instance.processCommands()
                .catch((error: unknown) => runtimeLogger.error('HUSARIADA_POLL_FAILED', 'Blad pobierania polecen Husariady.', {}, error))
                .finally(() => { polling = false; });
        }, COMMAND_POLL_INTERVAL_MS), setInterval(beat, HEARTBEAT_INTERVAL_MS));

        runtimeLogger.info('HUSARIADA_STARTED', 'Silnik Husariady uruchomiony.', { channelId });
    })().catch((error: unknown) => {
        runtimeLogger.error('HUSARIADA_START_FAILED', 'Nie udalo sie uruchomic silnika Husariady.', {}, error);
    });

    return () => {
        stopped = true;
        timers.forEach((timer) => clearInterval(timer));
        engine?.shutdown();
        engine = null;
    };
}

function outcomeMessage(outcome: AnswerOutcome): string {
    switch (outcome.status) {
        case 'recorded':
            return `✅ Zapisano odpowiedź **${answerLabel(outcome.choiceIndex)}**. Wynik zobaczysz po zakończeniu pytania.`;
        case 'duplicate':
            return 'ℹ️ Już odpowiedziałeś na to pytanie — liczy się pierwsza odpowiedź.';
        case 'closed':
            return '⌛ Czas na odpowiedź minął.';
    }
}

/** Przyciski odpowiedzi. Odpowiedz zapisuje sie pod ID klikajacego, jedna na pytanie. */
export async function handleHusariadaButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!isAnswerCustomId(interaction.customId)) {
        return false;
    }

    const parsed = parseAnswerCustomId(interaction.customId);
    if (!parsed || !engine) {
        await interaction.reply({ content: '⌛ To pytanie jest już nieaktywne.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const displayName = interaction.inCachedGuild()
        ? interaction.member.displayName
        : (interaction.user.globalName ?? interaction.user.username);

    const outcome = await engine.handleAnswer({
        ...parsed,
        userId: interaction.user.id,
        displayName,
        avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
        clickedAt: interaction.createdTimestamp,
    });

    await interaction.reply({ content: outcomeMessage(outcome), flags: MessageFlags.Ephemeral });
    return true;
}
