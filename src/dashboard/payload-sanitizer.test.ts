import { describe, expect, it } from 'vitest';
import {
    STORED_UPLOAD_PLACEHOLDER,
    resolveStoredUpload,
    sanitizeEmbedPayload,
    stripUnsafeEscapes,
} from './payload-sanitizer.js';

const ESC = '\u001b';

describe('stripUnsafeEscapes', () => {
    it('zachowuje poprawne sekwencje SGR (kolor, pogrubienie, reset)', () => {
        const text = `${ESC}[1;31mCzerwony${ESC}[0m i ${ESC}[4;47mtło${ESC}[0m`;
        expect(stripUnsafeEscapes(text)).toBe(text);
    });

    it('usuwa ESC, który nie tworzy dozwolonej sekwencji SGR', () => {
        expect(stripUnsafeEscapes(`${ESC}[2Jczyść`)).toBe('[2Jczyść');
        expect(stripUnsafeEscapes(`${ESC}]0;tytuł\u0007x`)).toBe(']0;tytułx');
        expect(stripUnsafeEscapes(`${ESC}[38;5;196mx`)).toBe('[38;5;196mx');
    });

    it('usuwa pozostałe znaki sterujące, ale zachowuje nowe linie i tabulatory', () => {
        expect(stripUnsafeEscapes('a\u0000b\u0007c\nd\te')).toBe('abc\nd\te');
    });
});

describe('sanitizeEmbedPayload', () => {
    it('przepuszcza ANSI w treści, ale czyści tytuł z wszystkich sekwencji', () => {
        const payload = sanitizeEmbedPayload({
            mode: 'embedded',
            channelId: '123456789012345678',
            title: `${ESC}[31mTytuł${ESC}[0m`,
            content: `\`\`\`ansi\n${ESC}[31mtekst${ESC}[0m\n\`\`\``,
        });

        expect(payload.title).toBe('[31mTytuł[0m');
        expect(payload.content).toContain(`${ESC}[31mtekst${ESC}[0m`);
    });

    it('nie wpuszcza niebezpiecznych sekwencji ESC do treści', () => {
        const payload = sanitizeEmbedPayload({ content: `${ESC}[2Jx` });
        expect(payload.content).toBe('[2Jx');
    });

    it('toleruje nieprawidłowe body', () => {
        expect(sanitizeEmbedPayload(null).content).toBe('');
    });
});

describe('resolveStoredUpload', () => {
    const base = sanitizeEmbedPayload({ imageMode: 'upload' });

    it('zwraca payload bez zmian, gdy nie ma placeholdera', () => {
        const payload = { ...base, uploadBase64: 'abc' };
        expect(resolveStoredUpload(payload)).toBe(payload);
    });

    it('podmienia placeholder na zapisany upload bez mutowania wejścia', () => {
        const payload = { ...base, uploadBase64: STORED_UPLOAD_PLACEHOLDER };
        const resolved = resolveStoredUpload(payload, { ...base, uploadBase64: 'REAL' });

        expect(resolved?.uploadBase64).toBe('REAL');
        expect(payload.uploadBase64).toBe(STORED_UPLOAD_PLACEHOLDER);
    });

    it('zwraca null, gdy brak zapisanego uploadu lub zapisany to też placeholder', () => {
        const payload = { ...base, uploadBase64: STORED_UPLOAD_PLACEHOLDER };
        expect(resolveStoredUpload(payload)).toBeNull();
        expect(resolveStoredUpload(payload, { ...base, uploadBase64: STORED_UPLOAD_PLACEHOLDER })).toBeNull();
    });
});
