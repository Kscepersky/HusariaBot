import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    type User,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { resolveShipVerdict, rollShipPercent } from './ship-score.js';

const SELF_SHIP_PERCENT = 100;
const SELF_SHIP_TEXT = 'Milosc wlasna to podstawa. Szacun za pewnosc siebie.';
const BOT_SHIP_PERCENT = 99;
const BOT_SHIP_TEXT = 'Bot jest zajety obsluga serwera, ale cos tam iskrzy...';
const CARD_FILE_NAME = 'ship.png';

export interface ShipReplyOptions {
    first: User;
    second: User;
    /** Tytul embeda bez imion, np. "Ship". */
    title: string;
    /** Opcjonalna linijka pod wynikiem, np. kto swata. */
    footerText?: string;
}

function displayName(user: User): string {
    return user.globalName ?? user.username;
}

function avatarUrl(user: User): string {
    return user.displayAvatarURL({ extension: 'png', forceStatic: true, size: 256 });
}

function resolveOutcome(first: User, second: User): { percent: number; text: string; emoji: string } {
    if (first.id === second.id) {
        return { percent: SELF_SHIP_PERCENT, text: SELF_SHIP_TEXT, emoji: '🪞' };
    }

    if (first.bot || second.bot) {
        return { percent: BOT_SHIP_PERCENT, text: BOT_SHIP_TEXT, emoji: '🤖' };
    }

    const percent = rollShipPercent();
    const verdict = resolveShipVerdict(percent);
    return { percent, text: verdict.text, emoji: verdict.emoji };
}

/** Wspolny przebieg /ship i /zeswataj: losuje wynik, renderuje karte i odpowiada publicznie. */
export async function replyWithShip(
    interaction: ChatInputCommandInteraction,
    options: ShipReplyOptions,
): Promise<void> {
    if (!interaction.guildId) {
        await interaction.reply({
            content: '❌ Ta komenda dziala tylko na serwerze.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const { first, second } = options;
    const { percent, text, emoji } = resolveOutcome(first, second);

    await interaction.deferReply();

    const embed = new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle(`💘 ${options.title}: ${displayName(first)} + ${displayName(second)}`)
        .setDescription(`${emoji} **${percent}%** - ${text}`)
        .setTimestamp();

    if (options.footerText) {
        embed.setFooter({ text: options.footerText });
    }

    try {
        const { renderShipCard } = await import('./ship-card-renderer.js');
        const cardBuffer = await renderShipCard({
            firstName: displayName(first),
            secondName: displayName(second),
            firstAvatarUrl: avatarUrl(first),
            secondAvatarUrl: avatarUrl(second),
            percent,
        });

        embed.setImage(`attachment://${CARD_FILE_NAME}`);
        await interaction.editReply({
            content: '',
            embeds: [embed],
            files: [new AttachmentBuilder(cardBuffer, { name: CARD_FILE_NAME })],
        });
    } catch (error) {
        console.error(`⚠️ Nie udalo sie wyrenderowac karty /${interaction.commandName}, fallback do embeda:`, error);
        await interaction.editReply({ content: '', embeds: [embed] });
    }
}
