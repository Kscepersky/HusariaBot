import { describe, it, expect, vi } from 'vitest';
import {
    buildZgloszeniaModal,
    EMBED_MODAL_ZGLOSZENIA,
    handleZgloszeniaModalSubmit,
} from './zgloszenia.js';

describe('buildZgloszeniaModal', () => {
    it('powinien ustawić poprawny customId i pole wiadomości', () => {
        const modal = buildZgloszeniaModal();
        const json = modal.toJSON() as any;

        expect(json.custom_id).toBe(EMBED_MODAL_ZGLOSZENIA);
        expect(json.title).toBe('📋 Zgłoszenia');

        const input = json.components?.[0]?.components?.[0];
        expect(input?.custom_id).toBe('zgloszenia_message');
        expect(input?.required).toBe(true);
        expect(input?.max_length).toBe(4000);
    });
});

describe('handleZgloszeniaModalSubmit', () => {
    it('powinien opublikować embed po kliknięciu Publikuj', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const update = vi.fn().mockResolvedValue(undefined);

        const btnInteraction = {
            customId: 'husaria_zgloszenia_publish',
            update,
        };

        const interaction = {
            fields: {
                getTextInputValue: vi.fn().mockReturnValue('  Treść zgłoszenia  '),
            },
            guild: null,
            channel: {
                isTextBased: () => true,
                send,
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockResolvedValue(btnInteraction),
                    },
                },
            }),
            editReply: vi.fn(),
        } as any;

        await handleZgloszeniaModalSubmit(interaction);

        expect(send).toHaveBeenCalledTimes(1);
        const sentPayload = send.mock.calls[0]?.[0];
        expect(sentPayload?.embeds?.[0]?.toJSON().description).toContain('Zgłoszenia');
        expect(update).toHaveBeenCalledWith({ content: '✅ Embed wysłany!', embeds: [], components: [] });
    });

    it('powinien anulować wysyłkę po kliknięciu Anuluj', async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const update = vi.fn().mockResolvedValue(undefined);

        const btnInteraction = {
            customId: 'husaria_zgloszenia_cancel',
            update,
        };

        const interaction = {
            fields: {
                getTextInputValue: vi.fn().mockReturnValue('Treść zgłoszenia'),
            },
            guild: null,
            channel: {
                isTextBased: () => true,
                send,
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockResolvedValue(btnInteraction),
                    },
                },
            }),
            editReply: vi.fn(),
        } as any;

        await handleZgloszeniaModalSubmit(interaction);

        expect(send).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ content: '❌ Anulowano.', embeds: [], components: [] });
    });

    it('powinien zgłosić błąd dla kanału bez wsparcia wysyłki', async () => {
        const update = vi.fn().mockResolvedValue(undefined);

        const btnInteraction = {
            customId: 'husaria_zgloszenia_publish',
            update,
        };

        const interaction = {
            fields: {
                getTextInputValue: vi.fn().mockReturnValue('Treść zgłoszenia'),
            },
            guild: null,
            channel: {
                isTextBased: () => false,
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockResolvedValue(btnInteraction),
                    },
                },
            }),
            editReply: vi.fn(),
        } as any;

        await handleZgloszeniaModalSubmit(interaction);

        expect(update).toHaveBeenCalledWith({
            content: '❌ Nie udało się wysłać embeda: ten kanał nie obsługuje wiadomości tekstowych.',
            embeds: [],
            components: [],
        });
    });

    it('powinien zgłosić błąd, gdy publikacja embeda się nie powiedzie', async () => {
        const send = vi.fn().mockRejectedValue(new Error('send failed'));
        const update = vi.fn().mockResolvedValue(undefined);

        const btnInteraction = {
            customId: 'husaria_zgloszenia_publish',
            update,
        };

        const interaction = {
            fields: {
                getTextInputValue: vi.fn().mockReturnValue('Treść zgłoszenia'),
            },
            guild: null,
            channel: {
                isTextBased: () => true,
                send,
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockResolvedValue(btnInteraction),
                    },
                },
            }),
            editReply: vi.fn(),
        } as any;

        await handleZgloszeniaModalSubmit(interaction);

        expect(update).toHaveBeenCalledWith({
            content: '❌ Nie udało się opublikować embeda. Sprawdź uprawnienia bota i spróbuj ponownie.',
            embeds: [],
            components: [],
        });
    });

    it('powinien zakończyć flow komunikatem timeout', async () => {
        const editReply = vi.fn().mockResolvedValue(undefined);

        const interaction = {
            fields: {
                getTextInputValue: vi.fn().mockReturnValue('Treść zgłoszenia'),
            },
            guild: null,
            channel: {
                isTextBased: () => true,
                send: vi.fn(),
            },
            reply: vi.fn().mockResolvedValue({
                resource: {
                    message: {
                        awaitMessageComponent: vi.fn().mockRejectedValue(new Error('time limit exceeded')),
                    },
                },
            }),
            editReply,
        } as any;

        await handleZgloszeniaModalSubmit(interaction);

        expect(editReply).toHaveBeenCalledWith({ content: '⏰ Czas minął — anulowano.', components: [] });
    });
});
