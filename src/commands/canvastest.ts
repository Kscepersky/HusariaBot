import {
    AttachmentBuilder,
    ChatInputCommandInteraction,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { isOwner } from '../permissions/access.js';
import { CANVAS_PREVIEWS, findCanvasPreview, type CanvasPreview } from './canvas-previews.js';

/** Discord pozwala na max 10 zalacznikow w jednej wiadomosci. */
const MAX_ATTACHMENTS = 10;

export const canvastestCommand = {
    data: new SlashCommandBuilder()
        .setName('canvastest')
        .setDescription('🖼️ Podglad kart canvas z przykladowymi danymi (owner)')
        .setDefaultMemberPermissions(0)
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('karta')
                .setDescription('Ktora karte pokazac (domyslnie wszystkie)')
                .addChoices(...CANVAS_PREVIEWS.map((preview) => ({ name: preview.label, value: preview.key })))
                .setRequired(false),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({
                content: '❌ Ta komenda jest dostepna tylko dla ownera.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const requestedKey = interaction.options.getString('karta');
        const selected: readonly CanvasPreview[] = requestedKey
            ? [findCanvasPreview(requestedKey)].filter((preview): preview is CanvasPreview => preview !== undefined)
            : CANVAS_PREVIEWS.slice(0, MAX_ATTACHMENTS);

        if (selected.length === 0) {
            await interaction.reply({
                content: '❌ Nieznana karta.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const context = { user: interaction.user, partner: interaction.client.user };
        const results = await Promise.allSettled(selected.map((preview) => preview.render(context)));

        const files: AttachmentBuilder[] = [];
        const failures: string[] = [];
        results.forEach((result, index) => {
            const preview = selected[index]!;
            if (result.status === 'fulfilled') {
                files.push(new AttachmentBuilder(result.value, { name: `${preview.key}.png` }));
                return;
            }

            console.error(`❌ Nie udalo sie wyrenderowac podgladu "${preview.key}":`, result.reason);
            failures.push(preview.label);
        });

        const lines = [
            `🖼️ Podglad kart: ${files.length}/${selected.length}`,
            ...failures.map((label) => `❌ Blad renderowania: ${label}`),
        ];
        await interaction.editReply({ content: lines.join('\n'), files });
    },
};
