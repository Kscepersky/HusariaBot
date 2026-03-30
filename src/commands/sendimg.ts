import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    AttachmentBuilder,
    MessageFlags,
} from 'discord.js';
import { readdirSync, existsSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { ensureSupportRole } from '../utils/role-access.js';

const IMG_DIR = join(__dirname, '..', '..', 'img');
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function getImageFileNames(): string[] {
    if (!existsSync(IMG_DIR)) {
        return [];
    }

    return readdirSync(IMG_DIR)
        .filter((fileName) => SUPPORTED_EXTENSIONS.has(extname(fileName).toLowerCase()))
        .sort((a, b) => a.localeCompare(b));
}

const imageFileNames = getImageFileNames();

const builder = new SlashCommandBuilder()
    .setName('sendimg')
    .setDescription('🖼️ Wyślij wybrany obraz z folderu img na kanał')
    .setDefaultMemberPermissions(null)
    .addStringOption((option) => {
        option
            .setName('plik')
            .setDescription('Wybierz plik obrazu z folderu img')
            .setRequired(true);

        for (const fileName of imageFileNames.slice(0, 25)) {
            option.addChoices({ name: fileName, value: fileName });
        }

        return option;
    });

export const sendImgCommand = {
    data: builder,

    async execute(interaction: ChatInputCommandInteraction) {
        if (!(await ensureSupportRole(interaction))) {
            return;
        }

        const selectedFile = interaction.options.getString('plik', true);
        const currentImageFileNames = getImageFileNames();

        if (!currentImageFileNames.includes(selectedFile)) {
            await interaction.reply({
                content: '❌ Wybrany plik nie istnieje w folderze img. Jeśli dodałeś nowy plik, uruchom ponownie deploy komend.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const filePath = join(IMG_DIR, selectedFile);
        const attachment = new AttachmentBuilder(filePath).setName(basename(selectedFile));

        const targetChannel = interaction.channel;
        if (!targetChannel?.isTextBased() || !('send' in targetChannel)) {
            await interaction.reply({
                content: '❌ Ten kanał nie obsługuje wysyłania wiadomości.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await targetChannel.send({ files: [attachment] });
        await interaction.reply({
            content: `✅ Wysłano obraz: **${selectedFile}**`,
            flags: MessageFlags.Ephemeral,
        });
    },
};
