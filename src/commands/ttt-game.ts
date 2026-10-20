import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    type User,
} from 'discord.js';
import { recordTttMatch } from '../economy/ttt-store.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    EMPTY_BOARD,
    TTT_BOARD_SIZE,
    applyMove,
    getResult,
    otherMark,
    type TttBoard,
    type TttMark,
    type TttMatchOutcome,
    type TttResult,
} from './ttt-logic.js';

const CUSTOM_ID_PREFIX = 'ttt';
const CARD_FILE_NAME = 'ttt.png';
const BOARD_ROW_SIZE = 3;
/** Pusty, ale niepusty dla Discorda napis przycisku. */
const EMPTY_CELL_LABEL = '​';
const MARK_EMOJI: Readonly<Record<TttMark, string>> = { X: '❌', O: '⭕' };

export const TTT_ACCEPT_TIMEOUT_MS = 60_000;
export const TTT_TURN_TIMEOUT_MS = 60_000;

interface TttGame {
    id: string;
    guildId: string;
    challenger: User;
    opponent: User;
    phase: 'pending' | 'playing';
    /** Kto gra jakim znakiem - ustalane po przyjeciu wyzwania. */
    players: Readonly<Record<TttMark, User>> | null;
    board: TttBoard;
    turn: TttMark;
    timer: ReturnType<typeof setTimeout>;
    /** Interakcja komendy - sluzy do edycji wiadomosci po timeoucie. */
    origin: ChatInputCommandInteraction;
}

type UpdatePayload = Parameters<ButtonInteraction['update']>[0];

const games = new Map<string, TttGame>();
const activePairs = new Map<string, string>();

function pairKey(guildId: string, firstId: string, secondId: string): string {
    return `${guildId}:${[firstId, secondId].sort().join(':')}`;
}

function displayName(user: User): string {
    return user.globalName ?? user.username;
}

function avatarUrl(user: User): string {
    return user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
}

function customId(action: string, gameId: string, extra?: number): string {
    return [CUSTOM_ID_PREFIX, action, gameId, extra].filter((part) => part !== undefined).join(':');
}

function parseCustomId(raw: string): { action: string; gameId: string; cell?: number } | null {
    const parts = raw.split(':');
    if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 3) {
        return null;
    }

    const cell = parts[3] === undefined ? undefined : Number(parts[3]);
    return { action: parts[1]!, gameId: parts[2]!, ...(cell !== undefined ? { cell } : {}) };
}

function baseEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder().setColor(HusariaColors.RED).setTitle(title).setDescription(description);
}

function buildChallengeButtons(gameId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(customId('accept', gameId))
            .setLabel('Przyjmij')
            .setEmoji('⚔️')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(customId('decline', gameId))
            .setLabel('Odrzuc')
            .setStyle(ButtonStyle.Danger),
    );
}

function buildCellButton(gameId: string, board: TttBoard, index: number): ButtonBuilder {
    const cell = board[index] ?? null;
    const button = new ButtonBuilder().setCustomId(customId('move', gameId, index));

    if (cell === null) {
        return button.setLabel(EMPTY_CELL_LABEL).setStyle(ButtonStyle.Secondary);
    }

    return button
        .setEmoji(MARK_EMOJI[cell])
        .setStyle(cell === 'X' ? ButtonStyle.Danger : ButtonStyle.Primary)
        .setDisabled(true);
}

/** Siatka 3x3 z przyciskow + rzad z poddaniem. */
export function buildBoardRows(gameId: string, board: TttBoard): ActionRowBuilder<ButtonBuilder>[] {
    const rows = Array.from({ length: TTT_BOARD_SIZE / BOARD_ROW_SIZE }, (_, row) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            ...Array.from({ length: BOARD_ROW_SIZE }, (_, column) =>
                buildCellButton(gameId, board, row * BOARD_ROW_SIZE + column),
            ),
        ),
    );

    rows.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(customId('surrender', gameId))
                .setLabel('Poddaj sie')
                .setEmoji('🏳️')
                .setStyle(ButtonStyle.Secondary),
        ),
    );
    return rows;
}

function buildTurnEmbed(game: TttGame): EmbedBuilder {
    const players = game.players!;
    return baseEmbed(
        '⭕❌ Kolko i krzyzyk',
        `${MARK_EMOJI.X} ${players.X}  vs  ${MARK_EMOJI.O} ${players.O}\n\n` +
            `⏳ Ruch: ${players[game.turn]} ${MARK_EMOJI[game.turn]} *(60 s)*`,
    );
}

function endGame(game: TttGame): void {
    clearTimeout(game.timer);
    games.delete(game.id);
    activePairs.delete(pairKey(game.guildId, game.challenger.id, game.opponent.id));
}

function scheduleTimeout(gameId: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
        void handleTimeout(gameId);
    }, timeoutMs);
}

function outcomeForWinner(game: TttGame, winner: User): TttMatchOutcome {
    return winner.id === game.challenger.id ? 'first' : 'second';
}

/** Wspolne zakonczenie partii: zapis do rankingu, karta canvas i wiadomosc koncowa. */
async function concludeGame(
    game: TttGame,
    outcome: TttMatchOutcome,
    headline: string,
    detail: string,
    respond: (payload: UpdatePayload) => Promise<unknown>,
    result: TttResult | null,
): Promise<void> {
    endGame(game);
    const players = game.players!;
    const winner = outcome === 'draw' ? null : outcome === 'first' ? game.challenger : game.opponent;
    const winnerMark: TttMark | null = winner ? (players.X.id === winner.id ? 'X' : 'O') : null;

    const embed = baseEmbed(headline, detail)
        .setColor(winner ? HusariaColors.GOLD : HusariaColors.DARK_GRAY)
        .setTimestamp();

    try {
        await recordTttMatch(game.guildId, game.challenger.id, game.opponent.id, outcome);
    } catch (error) {
        console.error('❌ Nie udalo sie zapisac wyniku /kk:', error);
        embed.setFooter({ text: 'Nie udalo sie zapisac wyniku do rankingu.' });
    }

    try {
        const { renderTttCard } = await import('./ttt-card-renderer.js');
        const card = await renderTttCard({
            xName: displayName(players.X),
            oName: displayName(players.O),
            xAvatarUrl: avatarUrl(players.X),
            oAvatarUrl: avatarUrl(players.O),
            board: game.board,
            result,
            winnerMark,
        });

        embed.setImage(`attachment://${CARD_FILE_NAME}`);
        await respond({
            content: '',
            embeds: [embed],
            components: [],
            files: [new AttachmentBuilder(card, { name: CARD_FILE_NAME })],
        });
    } catch (error) {
        console.error('⚠️ Nie udalo sie wyrenderowac karty /kk, fallback do embeda:', error);
        await respond({ content: '', embeds: [embed], components: [] });
    }
}

async function handleTimeout(gameId: string): Promise<void> {
    const game = games.get(gameId);
    if (!game) {
        return;
    }

    if (game.phase === 'pending') {
        endGame(game);
        try {
            await game.origin.editReply({
                content: '',
                embeds: [
                    baseEmbed('⌛ Pojedynek wygasl', `${game.opponent} nie odpowiedzial na wyzwanie.`)
                        .setColor(HusariaColors.DARK_GRAY),
                ],
                components: [],
            });
        } catch (error) {
            console.error('⚠️ Nie udalo sie zaktualizowac wygaslego pojedynku /kk:', error);
        }
        return;
    }

    // Walkower: gracz, na ktorego czekamy, przegrywa.
    const idle = game.players![game.turn];
    const winner = idle.id === game.challenger.id ? game.opponent : game.challenger;
    try {
        await concludeGame(
            game,
            outcomeForWinner(game, winner),
            `⌛ Walkower: wygrywa ${displayName(winner)}!`,
            `${idle} nie wykonal ruchu w 60 sekund.`,
            (payload) => game.origin.editReply(payload as Parameters<typeof game.origin.editReply>[0]),
            null,
        );
    } catch (error) {
        console.error('⚠️ Nie udalo sie zakonczyc walkowerem pojedynku /kk:', error);
    }
}

export async function startTttChallenge(interaction: ChatInputCommandInteraction): Promise<void> {
    const opponent = interaction.options.getUser('osoba', true);
    const challenger = interaction.user;

    const rejection = !interaction.guildId
        ? 'Ta komenda dziala tylko na serwerze.'
        : opponent.id === challenger.id
            ? 'Nie mozesz zagrac sam ze soba.'
            : opponent.bot
                ? 'Boty nie graja w kolko i krzyzyk.'
                : activePairs.has(pairKey(interaction.guildId, challenger.id, opponent.id))
                    ? 'Miedzy wami trwa juz pojedynek.'
                    : null;

    if (rejection || !interaction.guildId) {
        await interaction.reply({ content: `❌ ${rejection}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game: TttGame = {
        id: interaction.id,
        guildId: interaction.guildId,
        challenger,
        opponent,
        phase: 'pending',
        players: null,
        board: EMPTY_BOARD,
        turn: 'X',
        timer: scheduleTimeout(interaction.id, TTT_ACCEPT_TIMEOUT_MS),
        origin: interaction,
    };
    games.set(game.id, game);
    activePairs.set(pairKey(game.guildId, challenger.id, opponent.id), game.id);

    await interaction.reply({
        content: `${opponent}`,
        embeds: [
            baseEmbed(
                '⭕❌ Kolko i krzyzyk',
                `${challenger} rzuca wyzwanie ${opponent}!\nZnaki wylosuje bot. Masz 60 sekund na odpowiedz.`,
            ),
        ],
        components: [buildChallengeButtons(game.id)],
        allowedMentions: { users: [opponent.id] },
    });
}

async function handleDecline(interaction: ButtonInteraction, game: TttGame): Promise<void> {
    if (![game.challenger.id, game.opponent.id].includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    endGame(game);
    const verb = interaction.user.id === game.opponent.id ? 'odrzucil wyzwanie' : 'wycofal wyzwanie';
    await interaction.update({
        content: '',
        embeds: [
            baseEmbed('🚫 Pojedynek odwolany', `${interaction.user} ${verb}.`).setColor(HusariaColors.DARK_GRAY),
        ],
        components: [],
    });
}

async function handleAccept(interaction: ButtonInteraction, game: TttGame): Promise<void> {
    if (interaction.user.id !== game.opponent.id) {
        await interaction.reply({
            content: '❌ Tylko wyzwany gracz moze przyjac pojedynek.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    clearTimeout(game.timer);
    const challengerStarts = Math.random() < 0.5;
    const next: TttGame = {
        ...game,
        phase: 'playing',
        players: challengerStarts
            ? { X: game.challenger, O: game.opponent }
            : { X: game.opponent, O: game.challenger },
        timer: scheduleTimeout(game.id, TTT_TURN_TIMEOUT_MS),
    };
    games.set(game.id, next);

    await interaction.update({
        content: '',
        embeds: [buildTurnEmbed(next)],
        components: buildBoardRows(next.id, next.board),
    });
}

async function handleMove(interaction: ButtonInteraction, game: TttGame, cell: number | undefined): Promise<void> {
    const players = game.players;
    if (game.phase !== 'playing' || !players || ![players.X.id, players.O.id].includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (players[game.turn].id !== interaction.user.id) {
        await interaction.reply({ content: '❌ Teraz nie Twoja kolej.', flags: MessageFlags.Ephemeral });
        return;
    }

    const board = cell === undefined ? null : applyMove(game.board, cell, game.turn);
    if (!board) {
        await interaction.reply({ content: '❌ To pole jest juz zajete.', flags: MessageFlags.Ephemeral });
        return;
    }

    const result = getResult(board);
    const updated: TttGame = { ...game, board };

    if (result?.kind === 'win') {
        const winner = players[result.mark];
        await concludeGame(
            updated,
            outcomeForWinner(game, winner),
            `🏆 Wygrywa ${displayName(winner)}!`,
            `${MARK_EMOJI.X} ${players.X}  vs  ${MARK_EMOJI.O} ${players.O}`,
            (payload) => interaction.update(payload),
            result,
        );
        return;
    }

    if (result?.kind === 'draw') {
        await concludeGame(
            updated,
            'draw',
            '🤝 Remis!',
            `${MARK_EMOJI.X} ${players.X}  vs  ${MARK_EMOJI.O} ${players.O}`,
            (payload) => interaction.update(payload),
            result,
        );
        return;
    }

    clearTimeout(game.timer);
    const next: TttGame = {
        ...updated,
        turn: otherMark(game.turn),
        timer: scheduleTimeout(game.id, TTT_TURN_TIMEOUT_MS),
    };
    games.set(game.id, next);

    await interaction.update({
        content: '',
        embeds: [buildTurnEmbed(next)],
        components: buildBoardRows(next.id, next.board),
    });
}

async function handleSurrender(interaction: ButtonInteraction, game: TttGame): Promise<void> {
    const players = game.players;
    if (game.phase !== 'playing' || !players || ![players.X.id, players.O.id].includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    const winner = interaction.user.id === game.challenger.id ? game.opponent : game.challenger;
    await concludeGame(
        game,
        outcomeForWinner(game, winner),
        `🏳️ ${displayName(interaction.user)} sie poddaje - wygrywa ${displayName(winner)}!`,
        `${MARK_EMOJI.X} ${players.X}  vs  ${MARK_EMOJI.O} ${players.O}`,
        (payload) => interaction.update(payload),
        null,
    );
}

/** Obsluga przyciskow /kk. Zwraca true, gdy customId nalezy do tej gry. */
export async function handleTttButton(interaction: ButtonInteraction): Promise<boolean> {
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
    } else if (parsed.action === 'move') {
        await handleMove(interaction, game, parsed.cell);
    } else if (parsed.action === 'surrender') {
        await handleSurrender(interaction, game);
    } else {
        await interaction.reply({ content: '❌ Ta akcja nie jest teraz dostepna.', flags: MessageFlags.Ephemeral });
    }

    return true;
}

/** Tylko do testow: czysci stan w pamieci. */
export function resetTttGamesForTests(): void {
    for (const game of games.values()) {
        clearTimeout(game.timer);
    }
    games.clear();
    activePairs.clear();
}
