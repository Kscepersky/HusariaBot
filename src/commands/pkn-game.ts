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
import { recordPknMatch } from '../economy/pkn-store.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import {
    PKN_MOVES,
    PKN_MOVE_EMOJI,
    PKN_MOVE_LABEL,
    isPknMove,
    resolveRound,
    type PknMove,
} from './pkn-logic.js';

const CUSTOM_ID_PREFIX = 'pkn';
const CARD_FILE_NAME = 'pkn.png';
export const PKN_ACCEPT_TIMEOUT_MS = 60_000;
export const PKN_PICK_TIMEOUT_MS = 60_000;

interface PknGame {
    id: string;
    guildId: string;
    challenger: User;
    opponent: User;
    phase: 'pending' | 'playing';
    picks: Readonly<Record<string, PknMove>>;
    timer: ReturnType<typeof setTimeout>;
    /** Interakcja komendy - sluzy do edycji wiadomosci po timeoucie. */
    origin: ChatInputCommandInteraction;
}

const games = new Map<string, PknGame>();
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

function customId(action: string, gameId: string, extra?: string): string {
    return [CUSTOM_ID_PREFIX, action, gameId, extra].filter(Boolean).join(':');
}

function parseCustomId(raw: string): { action: string; gameId: string; move?: string } | null {
    const parts = raw.split(':');
    if (parts[0] !== CUSTOM_ID_PREFIX || parts.length < 3) {
        return null;
    }

    return { action: parts[1]!, gameId: parts[2]!, ...(parts[3] ? { move: parts[3] } : {}) };
}

export function buildChallengeButtons(gameId: string): ActionRowBuilder<ButtonBuilder> {
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

export function buildMoveButtons(gameId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...PKN_MOVES.map((move) =>
            new ButtonBuilder()
                .setCustomId(customId('pick', gameId, move))
                .setLabel(PKN_MOVE_LABEL[move])
                .setEmoji(PKN_MOVE_EMOJI[move])
                .setStyle(ButtonStyle.Primary),
        ),
    );
}

function baseEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder().setColor(HusariaColors.RED).setTitle(title).setDescription(description);
}

function endGame(game: PknGame): void {
    clearTimeout(game.timer);
    games.delete(game.id);
    activePairs.delete(pairKey(game.guildId, game.challenger.id, game.opponent.id));
}

function scheduleExpiry(gameId: string, timeoutMs: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
        void expireGame(gameId);
    }, timeoutMs);
}

async function expireGame(gameId: string): Promise<void> {
    const game = games.get(gameId);
    if (!game) {
        return;
    }

    endGame(game);
    const description = game.phase === 'pending'
        ? `${game.opponent} nie odpowiedzial na wyzwanie.`
        : 'Czas na wybor minal - gra anulowana, bez zmian w rankingu.';

    try {
        await game.origin.editReply({
            content: '',
            embeds: [baseEmbed('⌛ Pojedynek wygasl', description).setColor(HusariaColors.DARK_GRAY)],
            components: [],
        });
    } catch (error) {
        console.error('⚠️ Nie udalo sie zaktualizowac wygaslego pojedynku /pkn:', error);
    }
}

export async function startPknChallenge(interaction: ChatInputCommandInteraction): Promise<void> {
    const opponent = interaction.options.getUser('osoba', true);
    const challenger = interaction.user;

    const rejection = !interaction.guildId
        ? 'Ta komenda dziala tylko na serwerze.'
        : opponent.id === challenger.id
            ? 'Nie mozesz zagrac sam ze soba.'
            : opponent.bot
                ? 'Boty nie graja w papier, kamien, nozyce.'
                : activePairs.has(pairKey(interaction.guildId, challenger.id, opponent.id))
                    ? 'Miedzy wami trwa juz pojedynek.'
                    : null;

    if (rejection || !interaction.guildId) {
        await interaction.reply({ content: `❌ ${rejection}`, flags: MessageFlags.Ephemeral });
        return;
    }

    const game: PknGame = {
        id: interaction.id,
        guildId: interaction.guildId,
        challenger,
        opponent,
        phase: 'pending',
        picks: {},
        timer: scheduleExpiry(interaction.id, PKN_ACCEPT_TIMEOUT_MS),
        origin: interaction,
    };
    games.set(game.id, game);
    activePairs.set(pairKey(game.guildId, challenger.id, opponent.id), game.id);

    await interaction.reply({
        content: `${opponent}`,
        embeds: [
            baseEmbed(
                '🪨📄✂️ Papier, kamien, nozyce',
                `${challenger} rzuca wyzwanie ${opponent}!\nMasz 60 sekund na odpowiedz.`,
            ),
        ],
        components: [buildChallengeButtons(game.id)],
        allowedMentions: { users: [opponent.id] },
    });
}

async function handleDecline(interaction: ButtonInteraction, game: PknGame): Promise<void> {
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

async function handleAccept(interaction: ButtonInteraction, game: PknGame): Promise<void> {
    if (interaction.user.id !== game.opponent.id) {
        await interaction.reply({
            content: '❌ Tylko wyzwany gracz moze przyjac pojedynek.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    clearTimeout(game.timer);
    const next: PknGame = { ...game, phase: 'playing', timer: scheduleExpiry(game.id, PKN_PICK_TIMEOUT_MS) };
    games.set(game.id, next);

    await interaction.update({
        content: '',
        embeds: [
            baseEmbed(
                '⚔️ Pojedynek rozpoczety',
                `${game.challenger} vs ${game.opponent}\nWybierzcie ruch - widzi go tylko wybierajacy. Macie 60 sekund.`,
            ),
        ],
        components: [buildMoveButtons(game.id)],
    });
}

async function finishGame(interaction: ButtonInteraction, game: PknGame): Promise<void> {
    const firstMove = game.picks[game.challenger.id]!;
    const secondMove = game.picks[game.opponent.id]!;
    const outcome = resolveRound(firstMove, secondMove);
    endGame(game);

    const winner = outcome === 'draw' ? null : outcome === 'first' ? game.challenger : game.opponent;
    const title = winner ? `🏆 Wygrywa ${displayName(winner)}!` : '🤝 Remis!';
    const embed = baseEmbed(title, `${PKN_MOVE_LABEL[firstMove]} vs ${PKN_MOVE_LABEL[secondMove]}`)
        .setColor(winner ? HusariaColors.GOLD : HusariaColors.DARK_GRAY);

    try {
        await recordPknMatch(game.guildId, game.challenger.id, game.opponent.id, outcome);
    } catch (error) {
        console.error('❌ Nie udalo sie zapisac wyniku /pkn:', error);
        embed.setFooter({ text: 'Nie udalo sie zapisac wyniku do rankingu.' });
    }

    try {
        const { renderPknCard } = await import('./pkn-card-renderer.js');
        const card = await renderPknCard({
            firstName: displayName(game.challenger),
            secondName: displayName(game.opponent),
            firstAvatarUrl: avatarUrl(game.challenger),
            secondAvatarUrl: avatarUrl(game.opponent),
            firstMove,
            secondMove,
            outcome,
        });

        embed.setImage(`attachment://${CARD_FILE_NAME}`);
        await interaction.update({
            content: '',
            embeds: [embed],
            components: [],
            files: [new AttachmentBuilder(card, { name: CARD_FILE_NAME })],
        });
    } catch (error) {
        console.error('⚠️ Nie udalo sie wyrenderowac karty /pkn, fallback do embeda:', error);
        await interaction.update({ content: '', embeds: [embed], components: [] });
    }
}

async function handlePick(interaction: ButtonInteraction, game: PknGame, move: string | undefined): Promise<void> {
    const isPlayer = [game.challenger.id, game.opponent.id].includes(interaction.user.id);
    if (!isPlayer || game.phase !== 'playing' || !move || !isPknMove(move)) {
        await interaction.reply({ content: '❌ To nie jest Twoj pojedynek.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (game.picks[interaction.user.id]) {
        await interaction.reply({ content: '❌ Juz wybrales swoj ruch.', flags: MessageFlags.Ephemeral });
        return;
    }

    const updated: PknGame = { ...game, picks: { ...game.picks, [interaction.user.id]: move } };
    games.set(game.id, updated);

    if (Object.keys(updated.picks).length === 2) {
        await finishGame(interaction, updated);
        return;
    }

    await interaction.reply({
        content: `${PKN_MOVE_EMOJI[move]} Wybrales **${PKN_MOVE_LABEL[move]}**. Czekam na przeciwnika...`,
        flags: MessageFlags.Ephemeral,
    });
}

/** Obsluga przyciskow /pkn. Zwraca true, gdy customId nalezy do tej gry. */
export async function handlePknButton(interaction: ButtonInteraction): Promise<boolean> {
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
    } else if (parsed.action === 'pick') {
        await handlePick(interaction, game, parsed.move);
    } else {
        await interaction.reply({ content: '❌ Ta akcja nie jest teraz dostepna.', flags: MessageFlags.Ephemeral });
    }

    return true;
}

/** Tylko do testow: czysci stan w pamieci. */
export function resetPknGamesForTests(): void {
    for (const game of games.values()) {
        clearTimeout(game.timer);
    }
    games.clear();
    activePairs.clear();
}
