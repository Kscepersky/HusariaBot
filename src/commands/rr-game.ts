import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    type InteractionEditReplyOptions,
    type User,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import type { RrCardEvent } from './rr-card-renderer.js';
import { randomBelow } from './rr-random.js';
import { RR_CHAMBERS, RR_SPINS_PER_PLAYER, loadRevolver, pullTrigger, type Revolver } from './rr-logic.js';

const CUSTOM_ID_PREFIX = 'rr';
const CARD_FILE_NAME = 'rr.png';
const TITLE = '🔫 Rosyjska ruletka';

export const RR_ACCEPT_TIMEOUT_MS = 60_000;
export const RR_TURN_TIMEOUT_MS = 30_000;

type PlayerIndex = 0 | 1;
type RespondFn = (payload: InteractionEditReplyOptions) => Promise<unknown>;

interface RrGame {
    id: string;
    guildId: string;
    /** Gracze: [0] = wyzywajacy, [1] = wyzwany. */
    players: readonly [User, User];
    phase: 'pending' | 'playing';
    turn: PlayerIndex;
    /** Po zakreceniu bebna rywal musi strzelic - nie moze zakrecic ponownie. */
    forcedShot: boolean;
    revolver: Revolver;
    spinsLeft: readonly [number, number];
    lastEvent: string;
    timer: ReturnType<typeof setTimeout>;
    /** Interakcja komendy - sluzy do edycji wiadomosci po timeoucie. */
    origin: ChatInputCommandInteraction;
}

const games = new Map<string, RrGame>();
const activePairs = new Map<string, string>();
/** Kolejka edycji wiadomosci na gre - zapewnia, ze karty ida w kolejnosci ruchow. */
const editQueues = new Map<string, Promise<unknown>>();

function pairKey(guildId: string, firstId: string, secondId: string): string {
    return `${guildId}:${[firstId, secondId].sort().join(':')}`;
}

function displayName(user: User): string {
    return user.globalName ?? user.username;
}

function avatarUrl(user: User): string {
    return user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
}

function customId(action: string, gameId: string): string {
    return `${CUSTOM_ID_PREFIX}:${action}:${gameId}`;
}

function parseCustomId(raw: string): { action: string; gameId: string } | null {
    const parts = raw.split(':');
    if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 3) {
        return null;
    }

    return { action: parts[1]!, gameId: parts[2]! };
}

function otherIndex(index: PlayerIndex): PlayerIndex {
    return index === 0 ? 1 : 0;
}

function baseEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder().setColor(HusariaColors.RED).setTitle(title).setDescription(description);
}

function buildChallengeButtons(gameId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(customId('accept', gameId))
            .setLabel('Przyjmij')
            .setEmoji('🔫')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(customId('decline', gameId))
            .setLabel('Odrzuc')
            .setStyle(ButtonStyle.Danger),
    );
}

/** Dwa przyciski: Strzal oraz Zakrec bebnem (niedostepny po wykorzystaniu lub gdy rywal zakrecil). */
export function buildActionButtons(game: RrGame): ActionRowBuilder<ButtonBuilder>[] {
    const canSpin = !game.forcedShot && game.spinsLeft[game.turn] > 0;

    return [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(customId('shoot', game.id))
                .setLabel('Strzal')
                .setEmoji('🔫')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(customId('spin', game.id))
                .setLabel(`Zakrec bebnem (${game.spinsLeft[game.turn]})`)
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!canSpin),
        ),
    ];
}

function endGame(game: RrGame): void {
    clearTimeout(game.timer);
    games.delete(game.id);
    activePairs.delete(pairKey(game.guildId, game.players[0].id, game.players[1].id));
    editQueues.delete(game.id);
}

function scheduleTimeout(gameId: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
        void handleTimeout(gameId);
    }, timeoutMs);
}

function enqueueEdit(gameId: string, task: () => Promise<unknown>): Promise<unknown> {
    const previous = editQueues.get(gameId) ?? Promise.resolve();
    const next = previous.then(task, task);
    editQueues.set(gameId, next.catch(() => undefined));
    return next;
}

interface CardState {
    event: RrCardEvent;
    activeIndex: PlayerIndex | null;
    loserIndex?: PlayerIndex;
}

/** Karta + embed dla biezacego stanu gry; przy bledzie renderowania wraca do samego embeda. */
async function buildMessage(
    game: RrGame,
    embed: EmbedBuilder,
    components: ActionRowBuilder<ButtonBuilder>[],
    card: CardState,
): Promise<InteractionEditReplyOptions> {
    try {
        const { renderRrCard } = await import('./rr-card-renderer.js');
        const buffer = await renderRrCard({
            names: [displayName(game.players[0]), displayName(game.players[1])],
            avatarUrls: [avatarUrl(game.players[0]), avatarUrl(game.players[1])],
            activeIndex: card.activeIndex,
            loserIndex: card.loserIndex ?? null,
            firedChambers: game.revolver.pulls,
            rotation: game.revolver.rotation,
            event: card.event,
            spinsLeft: game.spinsLeft,
        });

        embed.setImage(`attachment://${CARD_FILE_NAME}`);
        return {
            content: '',
            embeds: [embed],
            components,
            files: [new AttachmentBuilder(buffer, { name: CARD_FILE_NAME })],
            attachments: [],
        };
    } catch (error) {
        console.error('⚠️ Nie udalo sie wyrenderowac karty /rr, fallback do embeda:', error);
        return { content: '', embeds: [embed], components, attachments: [] };
    }
}

function turnEmbed(game: RrGame): EmbedBuilder {
    const seconds = RR_TURN_TIMEOUT_MS / 1000;
    const forced = game.forcedShot ? ' *(musi strzelic)*' : '';
    return baseEmbed(TITLE, `${game.lastEvent}\n\n⏳ Ruch: ${game.players[game.turn]}${forced} *(${seconds} s)*`);
}

async function sendTurn(game: RrGame, event: RrCardEvent, respond: RespondFn): Promise<void> {
    const message = await buildMessage(game, turnEmbed(game), buildActionButtons(game), {
        event,
        activeIndex: game.turn,
    });
    await respond(message);
}

async function sendBang(game: RrGame, loserIndex: PlayerIndex, respond: RespondFn): Promise<void> {
    const loser = game.players[loserIndex];
    const winner = game.players[otherIndex(loserIndex)];
    const embed = baseEmbed(`🏆 Wygrywa ${displayName(winner)}!`, `💥 BANG! ${loser} dostal kule.`)
        .setColor(HusariaColors.GOLD)
        .setTimestamp();

    const message = await buildMessage(game, embed, [], { event: 'bang', activeIndex: null, loserIndex });
    await respond(message);
}

type ActionResult = { game: RrGame; event: RrCardEvent; loserIndex: PlayerIndex | null };

/** Czysta zmiana stanu po akcji gracza, bez zadnych efektow ubocznych. */
function applyAction(game: RrGame, action: 'shoot' | 'spin'): ActionResult {
    const actor = game.players[game.turn];
    const rival = game.players[otherIndex(game.turn)];

    if (action === 'spin') {
        const spinsLeft: [number, number] =
            game.turn === 0
                ? [game.spinsLeft[0] - 1, game.spinsLeft[1]]
                : [game.spinsLeft[0], game.spinsLeft[1] - 1];
        return {
            event: 'spin',
            loserIndex: null,
            game: {
                ...game,
                spinsLeft,
                revolver: loadRevolver(randomBelow),
                forcedShot: true,
                turn: otherIndex(game.turn),
                lastEvent: `🔄 ${actor} zakrecil beben - ${rival} musi strzelic!`,
            },
        };
    }

    const { revolver, hit } = pullTrigger(game.revolver);
    if (hit) {
        return { event: 'bang', loserIndex: game.turn, game: { ...game, revolver } };
    }

    return {
        event: 'click',
        loserIndex: null,
        game: {
            ...game,
            revolver,
            forcedShot: false,
            turn: otherIndex(game.turn),
            lastEvent: `💨 Klik... ${actor} przezyl.`,
        },
    };
}

/** Wspolny przebieg ruchu: stan zmieniany synchronicznie, edycja wiadomosci w kolejce. */
async function performAction(
    game: RrGame,
    action: 'shoot' | 'spin',
    respond: RespondFn,
): Promise<void> {
    clearTimeout(game.timer);
    const result = applyAction(game, action);

    if (result.loserIndex !== null) {
        endGame(result.game);
        await enqueueEdit(game.id, () => sendBang(result.game, result.loserIndex!, respond));
        return;
    }

    const next: RrGame = { ...result.game, timer: scheduleTimeout(game.id, RR_TURN_TIMEOUT_MS) };
    games.set(game.id, next);
    await enqueueEdit(game.id, () => sendTurn(next, result.event, respond));
}

async function handleTimeout(gameId: string): Promise<void> {
    const game = games.get(gameId);
    if (!game) {
        return;
    }

    const respond: RespondFn = (payload) => game.origin.editReply(payload);

    try {
        if (game.phase === 'pending') {
            endGame(game);
            await respond({
                content: '',
                embeds: [
                    baseEmbed('⌛ Pojedynek wygasl', `${game.players[1]} nie odpowiedzial na wyzwanie.`)
                        .setColor(HusariaColors.DARK_GRAY),
                ],
                components: [],
            });
            return;
        }

        // Bezczynny gracz: spust zostaje pociagniety za niego.
        await performAction(game, 'shoot', respond);
    } catch (error) {
        console.error('⚠️ Nie udalo sie obsluzyc timeoutu /rr:', error);
        endGame(game);
    }
}

export async function startRrChallenge(interaction: ChatInputCommandInteraction): Promise<void> {
    const opponent = interaction.options.getUser('osoba', true);
    const challenger = interaction.user;

    const rejection = !interaction.guildId
        ? 'Ta komenda dziala tylko na serwerze.'
        : opponent.id === challenger.id
            ? 'Nie mozesz zagrac sam ze soba.'
            : opponent.bot
                ? 'Boty nie graja w rosyjska ruletke.'
                : activePairs.has(pairKey(interaction.guildId, challenger.id, opponent.id))
                    ? 'Miedzy wami trwa juz pojedynek.'
                    : null;

    if (rejection || !interaction.guildId) {
        await interaction.reply({ content: `❌ ${rejection}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game: RrGame = {
        id: interaction.id,
        guildId: interaction.guildId,
        players: [challenger, opponent],
        phase: 'pending',
        turn: 0,
        forcedShot: false,
        revolver: { bulletAt: 0, pulls: 0, rotation: 0 },
        spinsLeft: [RR_SPINS_PER_PLAYER, RR_SPINS_PER_PLAYER],
        lastEvent: '',
        timer: scheduleTimeout(interaction.id, RR_ACCEPT_TIMEOUT_MS),
        origin: interaction,
    };
    games.set(game.id, game);
    activePairs.set(pairKey(game.guildId, challenger.id, opponent.id), game.id);

    await interaction.reply({
        content: `${opponent}`,
        embeds: [
            baseEmbed(
                TITLE,
                `${challenger} rzuca wyzwanie ${opponent}!\n` +
                    `Jeden rewolwer, ${RR_CHAMBERS} komor, jedna kula. Masz 60 sekund na odpowiedz.`,
            ),
        ],
        components: [buildChallengeButtons(game.id)],
        allowedMentions: { users: [opponent.id] },
    });
}

async function handleDecline(interaction: ButtonInteraction, game: RrGame): Promise<void> {
    if (!game.players.some((player) => player.id === interaction.user.id)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    endGame(game);
    const verb = interaction.user.id === game.players[1].id ? 'odrzucil wyzwanie' : 'wycofal wyzwanie';
    await interaction.update({
        content: '',
        embeds: [
            baseEmbed('🚫 Pojedynek odwolany', `${interaction.user} ${verb}.`).setColor(HusariaColors.DARK_GRAY),
        ],
        components: [],
    });
}

async function handleAccept(interaction: ButtonInteraction, game: RrGame): Promise<void> {
    if (interaction.user.id !== game.players[1].id) {
        await interaction.reply({
            content: '❌ Tylko wyzwany gracz moze przyjac pojedynek.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    clearTimeout(game.timer);
    const turn: PlayerIndex = randomBelow(2) === 0 ? 0 : 1;
    const next: RrGame = {
        ...game,
        phase: 'playing',
        turn,
        revolver: loadRevolver(randomBelow),
        lastEvent: '🎲 Los zdecydowal, kto zaczyna.',
        timer: scheduleTimeout(game.id, RR_TURN_TIMEOUT_MS),
    };
    games.set(game.id, next);

    await interaction.deferUpdate();
    await enqueueEdit(game.id, () =>
        sendTurn(next, 'ready', (payload) => interaction.editReply(payload)),
    );
}

async function handleAction(
    interaction: ButtonInteraction,
    game: RrGame,
    action: 'shoot' | 'spin',
): Promise<void> {
    if (game.phase !== 'playing' || !game.players.some((player) => player.id === interaction.user.id)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (game.players[game.turn].id !== interaction.user.id) {
        await interaction.reply({ content: '❌ Teraz nie Twoja kolej.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (action === 'spin' && (game.forcedShot || game.spinsLeft[game.turn] <= 0)) {
        await interaction.reply({
            content: game.forcedShot
                ? '❌ Rywal zakrecil beben - musisz strzelic.'
                : '❌ Wykorzystales juz swoje zakrecenie.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    // Stan zmienia sie synchronicznie w performAction, wiec kolejne klikniecie widzi juz nowa ture.
    // Edycja czeka na potwierdzenie klikniecia (deferUpdate), bo renderowanie karty trwa dluzej niz 3 s limitu.
    const deferred = interaction.deferUpdate();
    await performAction(game, action, async (payload) => {
        await deferred;
        return interaction.editReply(payload);
    });
}

/** Obsluga przyciskow /rr. Zwraca true, gdy customId nalezy do tej gry. */
export async function handleRrButton(interaction: ButtonInteraction): Promise<boolean> {
    const parsed = parseCustomId(interaction.customId);
    if (!parsed) {
        return false;
    }

    const game = games.get(parsed.gameId);
    if (!game) {
        await interaction.reply({ content: '⌛ Ten pojedynek juz wygasl.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (parsed.action === 'accept' && game.phase === 'pending') {
        await handleAccept(interaction, game);
    } else if (parsed.action === 'decline' && game.phase === 'pending') {
        await handleDecline(interaction, game);
    } else if (parsed.action === 'shoot' || parsed.action === 'spin') {
        await handleAction(interaction, game, parsed.action);
    } else {
        await interaction.reply({ content: '❌ Ta akcja nie jest teraz dostepna.', flags: MessageFlags.Ephemeral });
    }

    return true;
}

/** Tylko do testow: czysci stan w pamieci. */
export function resetRrGamesForTests(): void {
    for (const game of games.values()) {
        clearTimeout(game.timer);
    }
    games.clear();
    activePairs.clear();
    editQueues.clear();
}
