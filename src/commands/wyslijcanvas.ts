import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { ensureSectionAccess } from '../utils/role-access.js';
import { createLogger } from '../utils/logger.js';
import { CHANNEL_CANVASES } from './channel-canvases.js';

const commandLogger = createLogger('bot:wyslijcanvas');

const DISCORD_MISSING_ACCESS = 50001;
const DISCORD_MISSING_PERMISSIONS = 50013;

function discordErrorCode(error: unknown): number | null {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'number' ? code : null;
}

export const wyslijCanvasCommand = {
    data: new SlashCommandBuilder()
        .setName('wyslijcanvas')
        .setDescription('🎨 Wyślij na ten kanał baner (canvas), np. REGULAMIN')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('canvas')
                .setDescription('Który baner wysłać (domyślnie pierwszy z listy)')
                .addChoices(...CHANNEL_CANVASES.map((canvas) => ({ name: canvas.label, value: canvas.key })))
                .setRequired(false),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        // Wysylka grafik na kanaly to czesc kreatora publikacji - te same uprawnienia co /sendimg.
        if (!(await ensureSectionAccess(interaction, 'embed-creator'))) {
            return;
        }

        const requestedKey = interaction.options.getString('canvas') ?? CHANNEL_CANVASES[0]?.key;
        const canvas = CHANNEL_CANVASES.find((item) => item.key === requestedKey);
        if (!canvas) {
            await interaction.reply({ content: '❌ Nieznany canvas.', flags: MessageFlags.Ephemeral });
            return;
        }

        const targetChannel = interaction.channel;
        if (!targetChannel?.isTextBased() || !('send' in targetChannel)) {
            await interaction.reply({
                content: '❌ Ten kanał nie obsługuje wysyłania wiadomości.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Render moze potrwac dluzej niz 3 s (duze logo), a potwierdzenie ma widziec tylko autor.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let image: Buffer;
        try {
            image = await canvas.render();
        } catch (error) {
            commandLogger.error('CHANNEL_CANVAS_RENDER_FAILED', 'Nie udalo sie wyrenderowac canvasa.', {
                actorUserId: interaction.user.id,
                canvas: canvas.key,
            }, error);
            await interaction.editReply({ content: '❌ Nie udało się wygenerować obrazka. Spróbuj ponownie później.' });
            return;
        }

        try {
            await targetChannel.send({ files: [new AttachmentBuilder(image, { name: canvas.fileName })] });
        } catch (error) {
            const code = discordErrorCode(error);
            const missingAccess = code === DISCORD_MISSING_ACCESS || code === DISCORD_MISSING_PERMISSIONS;
            commandLogger.error('CHANNEL_CANVAS_SEND_FAILED', 'Nie udalo sie wyslac canvasa na kanal.', {
                actorUserId: interaction.user.id,
                canvas: canvas.key,
                channelId: interaction.channelId,
                discordErrorCode: code,
            }, error);
            await interaction.editReply({
                content: missingAccess
                    ? '❌ Bot nie ma uprawnień do pisania i dołączania plików na tym kanale.'
                    : '❌ Nie udało się wysłać obrazka na kanał.',
            });
            return;
        }

        commandLogger.info('CHANNEL_CANVAS_SENT', 'Wyslano canvas na kanal.', {
            actorUserId: interaction.user.id,
            canvas: canvas.key,
            channelId: interaction.channelId,
        });
        await interaction.editReply({ content: `✅ Wysłano baner **${canvas.label}** na ten kanał.` });
    },
};
