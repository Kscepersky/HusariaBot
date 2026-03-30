import { EmbedBuilder } from 'discord.js';
import { HusariaColors, ColorChoices } from './husaria-theme.js';

/**
 * Opcje do zbudowania embeddeda Husarii.
 */
export interface EmbedOptions {
    title: string;
    description: string;
    color: number;
}

/**
 * Surowe dane wejściowe z formularza / komendy.
 */
export interface RawEmbedInput {
    title: string;
    description: string;
    colorName?: string;
}

/**
 * Parsuje surowe dane wejściowe na znormalizowane EmbedOptions.
 * - Trymuje whitespace z tytułu i opisu
 * - Rozwiązuje nazwę koloru na wartość hex (fallback: RED)
 */
export function parseEmbedOptions(input: RawEmbedInput): EmbedOptions {
    const colorName = input.colorName ?? '';
    const color = ColorChoices[colorName] ?? HusariaColors.RED;

    return {
        title: input.title.trim(),
        description: input.description.trim(),
        color,
    };
}

/**
 * Buduje EmbedBuilder w stylu Husarii z podanymi opcjami.
 * Obsługuje wieloliniowy tekst, emotki, kolory z palety.
 */
export function buildHusariaEmbed(options: EmbedOptions): EmbedBuilder {
    const fullDescription = `# **${options.title}**\n${options.description}`;

    return new EmbedBuilder()
        .setColor(options.color)
        .setDescription(fullDescription)
        .setFooter({ text: 'G2 Hussars' })
        .setTimestamp();
}

// ─── Match (Mecz) ────────────────────────────────────────────────────────────

export interface MatchEmbedData {
    g2Emoji: string;
    gameEmoji: string;
    gameName: string;
    rival: string;
    competition: string;
    timestamp: number;
    stream?: string;
}

export function buildMatchEmbed(data: MatchEmbedData): EmbedBuilder {
    const titleLine = [data.g2Emoji, `G2 vs ${data.rival}`].filter(Boolean).join(' ');
    const gameValue = [data.gameEmoji, data.gameName].filter(Boolean).join(' ');

    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setDescription(`# **${titleLine}**`)
        .addFields(
            { name: '🏆 Rozgrywki', value: data.competition,                              inline: true  },
            { name: '🎮 Gra',       value: gameValue,                                     inline: true  },
            { name: '📅 Kiedy',     value: `<t:${data.timestamp}:F> (<t:${data.timestamp}:R>)`, inline: false },
        )
        .setFooter({ text: 'G2 Hussars' })
        .setTimestamp();

    if (data.stream) {
        embed.addFields({ name: '📺 Oglądaj live', value: data.stream, inline: false });
    }

    return embed;
}

// ─── Result (Wynik) ───────────────────────────────────────────────────────────

export interface ResultEmbedData {
    gameEmoji: string;
    gameName: string;
    rival: string;
    score: string;
    competition: string;
    comment?: string;
    isWin: boolean;
}

export function buildResultEmbed(data: ResultEmbedData): EmbedBuilder {
    const outcomeEmoji = data.isWin ? '✅' : '❌';
    const outcomeText  = data.isWin ? 'Wygrana' : 'Porażka';
    const color        = data.isWin ? HusariaColors.GREEN : HusariaColors.RED;
    const gameValue    = [data.gameEmoji, data.gameName].filter(Boolean).join(' ');

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(`# **${outcomeEmoji} ${outcomeText}! | G2 vs ${data.rival}**`)
        .addFields(
            { name: '📊 Wynik',     value: data.score,       inline: true },
            { name: '🏆 Rozgrywki', value: data.competition, inline: true },
            { name: '🎮 Gra',       value: gameValue,        inline: true },
        )
        .setFooter({ text: 'G2 Hussars' })
        .setTimestamp();

    if (data.comment) {
        embed.addFields({ name: '💬 Komentarz', value: data.comment, inline: false });
    }

    return embed;
}

// ─── Giveaway ─────────────────────────────────────────────────────────────────

export interface GiveawayEmbedData {
    prize: string;
    requirements: string;
    endsAt: number;
}

export function buildGiveawayEmbed(data: GiveawayEmbedData): EmbedBuilder {
    return new EmbedBuilder()
        .setColor(HusariaColors.GOLD)
        .setDescription(`# **🎁 GIVEAWAY**\n${data.prize}`)
        .addFields(
            { name: '📋 Wymagania', value: data.requirements,                                        inline: false },
            { name: '⏰ Koniec',    value: `<t:${data.endsAt}:F> (<t:${data.endsAt}:R>)`, inline: false },
        )
        .setFooter({ text: 'G2 Hussars' })
        .setTimestamp();
}
