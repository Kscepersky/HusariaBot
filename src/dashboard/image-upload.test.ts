import { describe, expect, it } from 'vitest';
import {
    ImageUploadValidationError,
    detectImageMime,
    normalizeUploadMimeType,
    parseUploadData,
    validateSvgSafety,
} from './image-upload.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('image-upload', () => {
    it('normalizuje image/jpg do image/jpeg', () => {
        expect(normalizeUploadMimeType(' IMAGE/JPG ')).toBe('image/jpeg');
    });

    it('parsuje data URL i czysty base64, odrzuca śmieci', () => {
        const base64 = PNG_HEADER.toString('base64');

        expect(parseUploadData(`data:image/png;base64,${base64}`)?.equals(PNG_HEADER)).toBe(true);
        expect(parseUploadData(base64)?.equals(PNG_HEADER)).toBe(true);
        expect(parseUploadData('[stored]')).toBeNull();
        expect(parseUploadData('')).toBeNull();
    });

    it('wykrywa typ po zawartości pliku', () => {
        expect(detectImageMime(PNG_HEADER)).toBe('image/png');
        expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
        expect(detectImageMime(Buffer.from('GIF89a....'))).toBe('image/gif');
        expect(detectImageMime(Buffer.from('<svg xmlns="x"></svg>'))).toBe('image/svg+xml');
        expect(detectImageMime(Buffer.from('zwykły tekst'))).toBeNull();
    });

    it.each([
        '<svg><script>alert(1)</script></svg>',
        '<svg onload="x()"></svg>',
        '<svg><use href="#a"/></svg>',
        '<svg><style>*{}</style></svg>',
        '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>',
        '<svg/onload=alert(1)></svg>',
        '<svg><x:script>alert(1)</x:script></svg>',
        '<svg><a href="&#106;avascript:alert(1)"><rect/></a></svg>',
        '<svg><foreignObject><form action="https://evil.example"></form></foreignObject></svg>',
        '<svg><a xlink:href="https://evil.example"><rect/></a></svg>',
    ])('odrzuca niebezpieczne SVG: %s', (svg) => {
        expect(() => validateSvgSafety(Buffer.from(svg))).toThrow(ImageUploadValidationError);
    });

    it('akceptuje bezpieczne SVG', () => {
        expect(() => validateSvgSafety(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).not.toThrow();
    });
});
