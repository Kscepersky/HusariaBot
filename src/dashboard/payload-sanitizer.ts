import type { EmbedFormData, EventDraftFormData, MatchInfoSnapshot } from './embed-handlers.js';

export const STORED_UPLOAD_PLACEHOLDER = '[stored]';
export const STORED_UPLOAD_ERROR = 'Zapisana grafika nie jest już dostępna. Wgraj plik ponownie.';

export function normalizeTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true';
}

// Dozwolone sekwencje to wyłącznie SGR z kodami, które renderuje Discord:
// reset (0), pogrubienie (1), podkreślenie (4), kolory tekstu (30-37) i tła (40-47).
const SGR_CODE = '(?:0|1|4|3[0-7]|4[0-7])';
const ALLOWED_SGR_SEQUENCE = new RegExp(`^\\u001b\\[(?:${SGR_CODE}(?:;${SGR_CODE})*)?m`);
// eslint-disable-next-line no-control-regex
const DISALLOWED_CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g;

/**
 * Usuwa znaki sterujące z tekstu publikacji. Zostawia nowe linie, tabulatory
 * oraz ESC tylko wtedy, gdy otwiera dozwoloną sekwencję SGR (kolory ANSI).
 */
export function stripUnsafeEscapes(value: string): string {
    let result = '';

    for (let index = 0; index < value.length; index += 1) {
        const char = value[index] ?? '';

        if (char === '\u001b') {
            if (ALLOWED_SGR_SEQUENCE.test(value.slice(index, index + 32))) {
                result += char;
            }
            continue;
        }

        result += char;
    }

    return result.replace(DISALLOWED_CONTROL_CHARS, '');
}

/** Tytuł nie renderuje ANSI, więc usuwamy z niego wszystkie znaki sterujące. */
export function stripAllControlChars(value: string): string {
    return value.replace(/\u001b/g, '').replace(DISALLOWED_CONTROL_CHARS, '');
}

export function sanitizeMatchInfo(input: unknown): MatchInfoSnapshot | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const raw = input as Partial<MatchInfoSnapshot>;
    const matchId = normalizeTrimmedString(raw.matchId);
    if (!matchId) {
        return undefined;
    }

    return {
        matchId,
        game: normalizeTrimmedString(raw.game),
        g2TeamName: normalizeTrimmedString(raw.g2TeamName),
        opponent: normalizeTrimmedString(raw.opponent),
        tournament: normalizeTrimmedString(raw.tournament),
        matchType: normalizeTrimmedString(raw.matchType),
        beginAtUtc: normalizeTrimmedString(raw.beginAtUtc),
        date: normalizeTrimmedString(raw.date),
        time: normalizeTrimmedString(raw.time),
    };
}

export function sanitizeEventDraft(input: unknown): EventDraftFormData | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    const raw = input as Partial<EventDraftFormData>;

    return {
        enabled: normalizeBoolean(raw.enabled),
        title: normalizeTrimmedString(raw.title),
        description: normalizeTrimmedString(raw.description),
        location: normalizeTrimmedString(raw.location),
        startAtLocal: normalizeTrimmedString(raw.startAtLocal),
        endAtLocal: normalizeTrimmedString(raw.endAtLocal),
    };
}

function normalizeEventDraftForCompare(input: EventDraftFormData | undefined): {
    enabled: boolean;
    title: string;
    description: string;
    location: string;
    startAtLocal: string;
    endAtLocal: string;
} | null {
    if (!input || input.enabled !== true) {
        return null;
    }

    return {
        enabled: true,
        title: normalizeTrimmedString(input.title),
        description: normalizeTrimmedString(input.description),
        location: normalizeTrimmedString(input.location),
        startAtLocal: normalizeTrimmedString(input.startAtLocal),
        endAtLocal: normalizeTrimmedString(input.endAtLocal),
    };
}

export function areEventDraftsEqual(left: EventDraftFormData | undefined, right: EventDraftFormData | undefined): boolean {
    const normalizedLeft = normalizeEventDraftForCompare(left);
    const normalizedRight = normalizeEventDraftForCompare(right);

    if (!normalizedLeft || !normalizedRight) {
        return false;
    }

    return normalizedLeft.title === normalizedRight.title
        && normalizedLeft.description === normalizedRight.description
        && normalizedLeft.location === normalizedRight.location
        && normalizedLeft.startAtLocal === normalizedRight.startAtLocal
        && normalizedLeft.endAtLocal === normalizedRight.endAtLocal;
}

/**
 * Klient dostaje w odpowiedziach placeholder zamiast base64 uploadu. Przy zapisie
 * podmieniamy go z powrotem na dane z istniejącego posta; bez nich zwracamy null,
 * żeby placeholder nigdy nie trafił do store (publikacja i tak by się nie powiodła).
 */
export function resolveStoredUpload(payload: EmbedFormData, existing?: EmbedFormData): EmbedFormData | null {
    if (normalizeTrimmedString(payload.uploadBase64) !== STORED_UPLOAD_PLACEHOLDER) {
        return payload;
    }

    const existingBase64 = normalizeTrimmedString(existing?.uploadBase64);
    if (!existingBase64 || existingBase64 === STORED_UPLOAD_PLACEHOLDER) {
        return null;
    }

    return { ...payload, uploadBase64: existingBase64 };
}

export function sanitizeEmbedPayload(rawBody: unknown): EmbedFormData {
    const body = (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody))
        ? rawBody as Record<string, unknown>
        : {};

    const mentionRoleEnabled = normalizeBoolean(body.mentionRoleEnabled);

    return {
        mode: normalizeTrimmedString(body.mode) as EmbedFormData['mode'],
        channelId: normalizeTrimmedString(body.channelId),
        title: stripAllControlChars(normalizeTrimmedString(body.title)),
        content: stripUnsafeEscapes(normalizeTrimmedString(body.content)),
        colorName: normalizeTrimmedString(body.colorName),
        mentionRoleEnabled,
        mentionRoleId: mentionRoleEnabled ? normalizeTrimmedString(body.mentionRoleId) : '',
        imageMode: normalizeTrimmedString(body.imageMode) as EmbedFormData['imageMode'],
        imageFilename: normalizeTrimmedString(body.imageFilename),
        uploadFileName: normalizeTrimmedString(body.uploadFileName),
        uploadMimeType: normalizeTrimmedString(body.uploadMimeType),
        uploadBase64: normalizeTrimmedString(body.uploadBase64),
        matchInfo: sanitizeMatchInfo(body.matchInfo),
        eventDraft: sanitizeEventDraft(body.eventDraft),
    };
}
