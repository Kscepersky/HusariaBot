import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder,
} from 'discord.js';
import { HusariaColors } from '../utils/husaria-theme.js';
import { pickAnimationMessages, rollKulaAnswer } from './kula-answers.js';

const MAX_QUESTION_LENGTH = 200;
const ANIMATION_STEPS = 3;
const STEP_DELAY_MS = 1600;
const FINAL_DELAY_MS = 1400;
const STEP_ICONS = ['🔮', '✨', '🌫️'] as const;

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildStepEmbed(question: string, message: string, step: number): EmbedBuilder {
    const icon = STEP_ICONS[step % STEP_ICONS.length]!;

    return new EmbedBuilder()
        .setColor(HusariaColors.DARK_GRAY)
        .setTitle(`${icon} Kryształowa kula`)
        .setDescription(`**Pytanie:** ${question}\n\n*${message}*`);
}

export const kulaCommand = {
    data: new SlashCommandBuilder()
        .setName('kula')
        .setDescription('🔮 Zapytaj kryształowej kuli o pytanie na tak lub nie')
        .setDMPermission(false)
        .addStringOption((option) =>
            option
                .setName('pytanie')
                .setDescription('Pytanie, na ktore kula ma odpowiedziec tak lub nie')
                .setMaxLength(MAX_QUESTION_LENGTH)
                .setRequired(true),
        ),

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ Ta komenda dziala tylko na serwerze.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const question = interaction.options.getString('pytanie', true).trim().slice(0, MAX_QUESTION_LENGTH);
        const answer = rollKulaAnswer();
        const messages = pickAnimationMessages(ANIMATION_STEPS);

        await interaction.deferReply();

        try {
            for (const [step, message] of messages.entries()) {
                await interaction.editReply({ embeds: [buildStepEmbed(question, message, step)] });
                await sleep(step === messages.length - 1 ? FINAL_DELAY_MS : STEP_DELAY_MS);
            }

            const isYes = answer.verdict === 'yes';
            const finalEmbed = new EmbedBuilder()
                .setColor(isYes ? HusariaColors.GREEN : HusariaColors.RED)
                .setTitle(isYes ? '🔮 Kula mówi: TAK' : '🔮 Kula mówi: NIE')
                .setDescription(`**Pytanie:** ${question}\n\n**${answer.text}**`)
                .setFooter({ text: `Zapytał(a): ${interaction.user.globalName ?? interaction.user.username}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [finalEmbed] });
        } catch (error) {
            console.error('❌  Nie udalo sie wykonac /kula:', error);
            await interaction.editReply({
                content: '❌ Kula pekla podczas wrozenia. Sprobuj ponownie.',
                embeds: [],
            }).catch(() => undefined);
        }
    },
};
