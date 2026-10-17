export const ALLOWED_UPLOAD_MIME = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
]);
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MIME_EXTENSION: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
};

export class ImageUploadValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImageUploadValidationError';
    }
}

export function normalizeUploadMimeType(mimeType: string): string {
    const normalized = mimeType.trim().toLowerCase();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

export function parseUploadData(uploadBase64: string): Buffer | null {
    const trimmed = uploadBase64.trim();
    const dataUrlMatch = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);

    let base64Data = trimmed;
    if (dataUrlMatch) {
        base64Data = dataUrlMatch[2] ?? '';
    }

    const normalized = base64Data.replace(/\s+/g, '');
    if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
        return null;
    }

    return Buffer.from(normalized, 'base64');
}

export function detectImageMime(buffer: Buffer): string | null {
    if (
        buffer.length >= 8
        && buffer[0] === 0x89
        && buffer[1] === 0x50
        && buffer[2] === 0x4e
        && buffer[3] === 0x47
        && buffer[4] === 0x0d
        && buffer[5] === 0x0a
        && buffer[6] === 0x1a
        && buffer[7] === 0x0a
    ) {
        return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (buffer.length >= 6) {
        const gifHeader = buffer.toString('ascii', 0, 6);
        if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
            return 'image/gif';
        }
    }

    if (buffer.length >= 12) {
        const riffHeader = buffer.toString('ascii', 0, 4);
        const webpHeader = buffer.toString('ascii', 8, 12);
        if (riffHeader === 'RIFF' && webpHeader === 'WEBP') {
            return 'image/webp';
        }
    }

    const svgProbe = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).trimStart();
    if (svgProbe.startsWith('<?xml') || svgProbe.startsWith('<svg') || svgProbe.includes('<svg')) {
        return 'image/svg+xml';
    }

    return null;
}

export function validateSvgSafety(buffer: Buffer): void {
    const svgContent = buffer.toString('utf8');

    // Elementy skryptowe takze z prefiksem przestrzeni nazw (<x:script>).
    if (/<\s*(?:[a-z0-9_-]+:)?script[\s>/]/i.test(svgContent)) {
        throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone skrypty.');
    }

    // Separatorem atrybutu moze byc tez "/" albo cudzyslow, np. <svg/onload=...>.
    if (/[\s/"']on[a-z]+\s*=/i.test(svgContent)) {
        throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone atrybuty zdarzen.');
    }

    // Dozwolone sa tylko odwolania lokalne (#id); wszystko inne (javascript:, encje &#..., data:) odpada.
    for (const hrefMatch of svgContent.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
        const value = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? '').trim();
        if (!value.startsWith('#')) {
            throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone odwolania zewnetrzne.');
        }
    }

    if (/<!DOCTYPE[^>]*\[/i.test(svgContent) || /<!ENTITY/i.test(svgContent)) {
        throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone deklaracje XML Entity.');
    }

    if (/<(?:[a-z0-9_-]+:)?(?:use|image|feImage|foreignObject|style|iframe|embed|object|animate|set)[\s>/]/i.test(svgContent)) {
        throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone elementy.');
    }

    if (/data\s*:\s*text\//i.test(svgContent)) {
        throw new ImageUploadValidationError('Plik SVG zawiera niedozwolone data URI z tekstem.');
    }
}
