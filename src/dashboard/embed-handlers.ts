import { EmbedBuilder } from 'discord.js';
import { HusariaColors, ColorChoices } from '../utils/husaria-theme.js';

export type EmbedType =
    | 'announcement'
    | 'welcome'
    | 'rulebook'
    | 'zgloszenia';

export interface EmbedFormData {
    type: EmbedType;
    channelId: string;
    // announcement
    title?: string;
    description?: string;
    colorName?: string;
    // welcome
    message?: string;
    imageUrl?: string;
    // rulebook
    rulesText?: string;
    // zgloszenia
    infoText?: string;
}

export function buildEmbedJson(data: EmbedFormData): object {
    switch (data.type) {
        case 'announcement': {
            const color = ColorChoices[data.colorName ?? ''] ?? HusariaColors.RED;
            return new EmbedBuilder()
                .setColor(color)
                .setDescription(`# **${data.title}**\n${data.description}`)
                .toJSON();
        }

        case 'welcome': {
            const normalizedImageUrl = data.imageUrl?.trim();
            const embed = new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setDescription(`# **Witaj na Husarii!**\n${data.message}`);
            if (normalizedImageUrl) embed.setImage(normalizedImageUrl);
            return embed.toJSON();
        }

        case 'rulebook':
            return new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setDescription(`# **Regulamin serwera G2 Hussars**\n${data.rulesText}`)
                .toJSON();

        case 'zgloszenia':
            return new EmbedBuilder()
                .setColor(HusariaColors.RED)
                .setDescription(`# **Zgłoszenia**\n${data.infoText}`)
                .toJSON();
    }
}

export function validateEmbedForm(data: EmbedFormData): string | null {
    switch (data.type) {
        case 'announcement':
            if (!data.title?.trim())       return 'Tytuł jest wymagany.';
            if (!data.description?.trim()) return 'Treść jest wymagana.';
            break;
        case 'welcome':
            if (!data.message?.trim()) return 'Wiadomość powitalna jest wymagana.';
            if (data.imageUrl?.trim()) {
                try {
                    const parsed = new URL(data.imageUrl.trim());
                    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                        return 'URL bannera musi zaczynać się od http:// lub https://.';
                    }
                } catch {
                    return 'URL bannera ma nieprawidłowy format.';
                }
            }
            break;
        case 'rulebook':
            if (!data.rulesText?.trim()) return 'Treść regulaminu jest wymagana.';
            break;
        case 'zgloszenia':
            if (!data.infoText?.trim()) return 'Tekst informacyjny jest wymagany.';
            break;
    }
    if (!data.channelId) return 'Wybierz kanał docelowy.';
    return null;
}
