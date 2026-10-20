import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { loadChampionCatalog } from './champion-data.js';
import { buildLolProfile, type LolProfile } from './lol-profile.js';
import { REGIONS, RiotApiError, createRiotClient, parseRiotId, type LolRegion } from './riot-api.js';

const CARD_FILE_NAME = 'statylol.png';
const DEFAULT_REGION: LolRegion = 'eune';
const MAX_RIOT_TAG_INPUT_LENGTH = 40;

function isRegion(value: string | null | undefined): value is LolRegion {
    return value !== null && value !== undefined && value in REGIONS;
}

function resolveRegion(selected: string | null): LolRegion {
    if (isRegion(selected)) {
        return selected;
    }

    const fromEnv = process.env.RIOT_DEFAULT_REGION?.trim().toLowerCase();
    return isRegion(fromEnv) ? fromEnv : DEFAULT_REGION;
}

function describeRiotError(error: RiotApiError): string {
    switch (error.status) {
        case 404:
            return '❌ Nie znaleziono takiego gracza. Sprawdź Riot ID (Nick#TAG) i wybrany region.';
        case 401:
        case 403:
            return '❌ Klucz Riot API jest nieprawidłowy lub wygasł. Daj znać administratorowi bota.';
        case 429:
            return '❌ Przekroczono limit zapytań do Riot API. Spróbuj ponownie za chwilę.';
        default:
            return '❌ Riot API nie odpowiada poprawnie. Spróbuj ponownie za chwilę.';
    }
}

function buildEmbed(profile: LolProfile): EmbedBuilder {
    const rank = profile.rank;
    const rankText = rank
        ? `${rank.tier} ${rank.division} · ${rank.lp} LP`
        : 'bez rangi w Solo/Duo';

    return new EmbedBuilder()
        .setColor(HusariaColors.RED)
        .setTitle(`📊 ${profile.gameName}#${profile.tagLine} (${profile.regionLabel})`)
        .setDescription(`Poziom **${profile.level}** · ${rankText}`)
        .setTimestamp();
}

export const statylolCommand = {
    data: new SlashCommandBuilder()
        .setName('statylol')
        .setDescription('📊 Pokaż profil gracza League of Legends: ranga, mainy i ostatnie mecze')
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('riottag')
                .setDescription('Riot ID w formacie Nick#TAG')
                .setMaxLength(MAX_RIOT_TAG_INPUT_LENGTH)
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('region')
                .setDescription('Serwer gry (domyślnie EUNE)')
                .addChoices(
                    ...(Object.entries(REGIONS) as Array<[LolRegion, (typeof REGIONS)[LolRegion]]>).map(
                        ([value, info]) => ({ name: info.label, value }),
                    ),
                ),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ Ta komenda dziala tylko na serwerze.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const apiKey = process.env.RIOT_API_KEY?.trim();
        if (!apiKey) {
            await interaction.reply({
                content: '❌ Ta komenda nie jest jeszcze skonfigurowana (brak RIOT_API_KEY).',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const riotId = parseRiotId(interaction.options.getString('riottag', true));
        if (!riotId) {
            await interaction.reply({
                content: '❌ Podaj Riot ID w formacie `Nick#TAG`, np. `Faker#KR1`.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const region = resolveRegion(interaction.options.getString('region'));
        await interaction.deferReply();

        try {
            const catalog = await loadChampionCatalog();
            const profile = await buildLolProfile(createRiotClient({ apiKey }), catalog, riotId, region);
            const embed = buildEmbed(profile);

            try {
                const { renderStatyLolCard } = await import('./statylol-card-renderer.js');
                const cardBuffer = await renderStatyLolCard(profile);

                embed.setImage(`attachment://${CARD_FILE_NAME}`);
                await interaction.editReply({
                    content: '',
                    embeds: [embed],
                    files: [new AttachmentBuilder(cardBuffer, { name: CARD_FILE_NAME })],
                });
            } catch (error) {
                console.error('⚠️ Nie udalo sie wyrenderowac karty /statylol, fallback do embeda:', error);
                await interaction.editReply({ content: '', embeds: [embed] });
            }
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /statylol:', error);
            const content = error instanceof RiotApiError
                ? describeRiotError(error)
                : '❌ Nie udalo sie pobrac danych gracza. Sprobuj ponownie za chwile.';
            await interaction.editReply({ content, embeds: [] }).catch(() => undefined);
        }
    },
};
