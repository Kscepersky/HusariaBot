import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AttachmentBuilder,
    MessageFlags,
} from 'discord.js';
import { ensureSupportRole } from '../utils/role-access.js';

export const listEmojisCommand = {
    data: new SlashCommandBuilder()
        .setName('listemojis')
        .setDescription('📋 Wypisz wszystkie emotki z serwera')
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        if (!interaction.inGuild() || !interaction.guild) {
            await interaction.reply({
                content: '❌ Ta komenda działa tylko na serwerze Discord.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const emojiLines = interaction.guild.emojis.cache
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
            .map((emoji) => {
                const mention = emoji.animated
                    ? `<a:${emoji.name}:${emoji.id}>`
                    : `<:${emoji.name}:${emoji.id}>`;

                return `${emoji.name}: '${mention}'`;
            });

        if (emojiLines.length === 0) {
            await interaction.reply({
                content: 'ℹ️ Ten serwer nie ma żadnych własnych emotek.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const output = emojiLines.join('\n');
        const file = new AttachmentBuilder(Buffer.from(output, 'utf8'), {
            name: 'server-emojis.txt',
            description: 'Lista emotek serwerowych',
        });

        await interaction.reply({
            content: `✅ Znalazłem ${emojiLines.length} emotek.`,
            files: [file],
            flags: MessageFlags.Ephemeral,
        });
    },
};
