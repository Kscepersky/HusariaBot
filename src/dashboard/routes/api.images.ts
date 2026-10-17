import { buildActorContext } from './actor-context.js';
import { Router,   } from 'express';
import { config } from 'dotenv';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { requireSectionAccess, } from '../middleware/require-section-access.js';
import {
    imageLibraryRenameSchema,
    imageLibraryUploadSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import { parsePositiveIntQuery } from './query-utils.js';
import {
    ImageUploadValidationError,
    MAX_UPLOAD_BYTES,
    detectImageMime,
    normalizeUploadMimeType,
    parseUploadData,
    validateSvgSafety,
} from '../image-upload.js';
import {
    normalizeTrimmedString,
} from '../payload-sanitizer.js';
import { createLogger } from '../../utils/logger.js';

config();

export const imagesRouter = Router();
const apiLogger = createLogger('dashboard:api');

const IMAGE_LIBRARY_PAGE_SIZE_DEFAULT = 8;

const IMAGE_LIBRARY_PAGE_SIZE_MAX = 64;

const IMAGE_LIBRARY_ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const IMAGE_LIBRARY_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

class ImageLibraryValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ImageLibraryValidationError';
    }
}

export function isClientValidationError(error: unknown): boolean {
    return error instanceof ImageLibraryValidationError || error instanceof ImageUploadValidationError;
}

function resolveImageLibraryDirectoryPath(): string {
    return join(__dirname, '..', '..', '..', 'img');
}

function resolveSafeImageFilename(rawValue: string): string | null {
    const normalized = rawValue.trim();
    if (!normalized || normalized === '.' || normalized === '..' || normalized.length > 255) {
        return null;
    }

    if (/[\\/]/.test(normalized)) {
        return null;
    }

    if (/[<>:"|?*\x00-\x1F]/.test(normalized)) {
        return null;
    }

    return normalized;
}

function resolveImageLibraryExtension(filename: string): string {
    return extname(filename).toLowerCase();
}

function listImageLibraryEntries(searchQuery: string, sortBy: ImageLibrarySortBy): ImageLibraryEntry[] {
    const imageDirectoryPath = resolveImageLibraryDirectoryPath();
    if (!existsSync(imageDirectoryPath)) {
        return [];
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();

    const entries = readdirSync(imageDirectoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
            const extension = resolveImageLibraryExtension(entry.name);
            if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
                return null;
            }

            if (normalizedSearch && !entry.name.toLowerCase().includes(normalizedSearch)) {
                return null;
            }

            const stats = statSync(join(imageDirectoryPath, entry.name));
            return {
                name: entry.name,
                sizeBytes: stats.size,
                modifiedAt: stats.mtimeMs,
                mimeType: IMAGE_LIBRARY_MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
            } satisfies ImageLibraryEntry;
        })
        .filter((entry): entry is ImageLibraryEntry => entry !== null);

    if (sortBy === 'name_asc') {
        return entries.sort((left, right) => left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' }));
    }

    return entries.sort((left, right) => {
        if (left.modifiedAt !== right.modifiedAt) {
            return right.modifiedAt - left.modifiedAt;
        }

        return left.name.localeCompare(right.name, 'pl', { sensitivity: 'base' });
    });
}

interface ImageLibraryEntry {
    name: string;
    sizeBytes: number;
    modifiedAt: number;
    mimeType: string;
}

type ImageLibrarySortBy = 'newest' | 'name_asc';

// GET /api/images — list available images from /img directory with pagination/search/sort
imagesRouter.get('/images', requireSectionAccess('image-library'), (req, res) => {
    try {
        const search = normalizeTrimmedString(req.query.search);
        const sortByRaw = normalizeTrimmedString(req.query.sortBy);
        const sortBy: ImageLibrarySortBy = sortByRaw === 'name_asc' ? 'name_asc' : 'newest';

        const pageSizeRequested = parsePositiveIntQuery(req.query.pageSize, IMAGE_LIBRARY_PAGE_SIZE_DEFAULT);
        const pageSize = Math.max(1, Math.min(IMAGE_LIBRARY_PAGE_SIZE_MAX, pageSizeRequested));

        const allEntries = listImageLibraryEntries(search, sortBy);
        const totalItems = allEntries.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

        const requestedPage = parsePositiveIntQuery(req.query.page, 1);
        const page = Math.min(requestedPage, totalPages);
        const startIndex = (page - 1) * pageSize;
        const pageEntries = allEntries.slice(startIndex, startIndex + pageSize);

        res.json({
            success: true,
            images: pageEntries.map((entry) => entry.name),
            entries: pageEntries.map((entry) => ({
                ...entry,
                url: `/img/${encodeURIComponent(entry.name)}`,
            })),
            pagination: {
                page,
                pageSize,
                totalItems,
                totalPages,
            },
            search,
            sortBy,
        });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_LIST_FAILED', 'Nie udalo sie pobrac listy obrazow.', {
            ...buildActorContext(req.session.user),
        }, error);
        res.status(500).json({ error: 'Nie udało się pobrać listy obrazów.' });
    }
});

// POST /api/images/upload — upload image into /img library
imagesRouter.post('/images/upload', requireSectionAccess('image-library'), async (req, res) => {
    const parsedBody = imageLibraryUploadSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(parsedBody.data.filename);
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const extension = resolveImageLibraryExtension(normalizedFilename);
        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        const expectedMimeType = IMAGE_LIBRARY_MIME_BY_EXTENSION[extension];
        const normalizedMimeType = normalizeUploadMimeType(parsedBody.data.uploadMimeType);
        if (!expectedMimeType || normalizedMimeType !== expectedMimeType) {
            res.status(400).json({ error: 'Typ MIME nie zgadza sie z rozszerzeniem pliku.' });
            return;
        }

        const imageBuffer = parseUploadData(parsedBody.data.uploadBase64);
        if (!imageBuffer || imageBuffer.length === 0) {
            res.status(400).json({ error: 'Wgrany plik ma nieprawidlowy format.' });
            return;
        }

        if (imageBuffer.length > MAX_UPLOAD_BYTES) {
            res.status(400).json({ error: 'Wgrany plik jest za duzy (max 20 MB).' });
            return;
        }

        const detectedMimeType = detectImageMime(imageBuffer);
        if (!detectedMimeType || detectedMimeType !== expectedMimeType) {
            res.status(400).json({ error: 'Zawartosc pliku nie zgadza sie z deklarowanym typem obrazu.' });
            return;
        }

        if (expectedMimeType === 'image/svg+xml') {
            try {
                validateSvgSafety(imageBuffer);
            } catch (svgError) {
                if (svgError instanceof ImageUploadValidationError) {
                    throw new ImageLibraryValidationError(svgError.message);
                }
                throw svgError;
            }
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        await mkdir(imageDirectoryPath, { recursive: true });

        const targetFilePath = join(imageDirectoryPath, normalizedFilename);
        if (existsSync(targetFilePath)) {
            res.status(409).json({ error: 'Plik o tej nazwie juz istnieje w bibliotece.' });
            return;
        }

        await writeFile(targetFilePath, imageBuffer, { flag: 'wx' });
        const fileStats = statSync(targetFilePath);

        apiLogger.info('IMAGE_LIBRARY_UPLOAD_SUCCESS', 'Dodano obraz do biblioteki grafik.', {
            actorUserId,
            imageFilename: normalizedFilename,
            sizeBytes: fileStats.size,
        });

        res.json({
            success: true,
            entry: {
                name: normalizedFilename,
                sizeBytes: fileStats.size,
                modifiedAt: fileStats.mtimeMs,
                mimeType: expectedMimeType,
                url: `/img/${encodeURIComponent(normalizedFilename)}`,
            },
        });
    } catch (error) {
        if (isClientValidationError(error)) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'Nieprawidlowe dane obrazu.',
            });
            return;
        }

        apiLogger.error('IMAGE_LIBRARY_UPLOAD_FAILED', 'Nie udalo sie dodac obrazu do biblioteki.', {
            actorUserId,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie dodac obrazu do biblioteki.' });
    }
});

// PATCH /api/images/rename — rename image in /img library
imagesRouter.patch('/images/rename', requireSectionAccess('image-library'), async (req, res) => {
    const parsedBody = imageLibraryRenameSchema.safeParse(req.body);
    if (!parsedBody.success) {
        res.status(400).json({ error: zodErrorToMessage(parsedBody.error) });
        return;
    }

    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(parsedBody.data.filename);
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const normalizedNewFilenameBase = resolveSafeImageFilename(parsedBody.data.newFilename);
        if (!normalizedNewFilenameBase) {
            res.status(400).json({ error: 'Nieprawidlowa nowa nazwa pliku.' });
            return;
        }

        const oldExtension = resolveImageLibraryExtension(normalizedFilename);
        const newExtension = resolveImageLibraryExtension(normalizedNewFilenameBase);
        const normalizedNewFilename = newExtension
            ? normalizedNewFilenameBase
            : `${normalizedNewFilenameBase}${oldExtension}`;

        const finalExtension = resolveImageLibraryExtension(normalizedNewFilename);
        if (finalExtension !== oldExtension) {
            res.status(400).json({ error: 'Nie można zmienić rozszerzenia pliku.' });
            return;
        }

        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(finalExtension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        if (normalizedFilename === normalizedNewFilename) {
            res.status(400).json({ error: 'Nowa nazwa pliku musi byc inna niz obecna.' });
            return;
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        const sourcePath = join(imageDirectoryPath, normalizedFilename);
        const destinationPath = join(imageDirectoryPath, normalizedNewFilename);

        if (!existsSync(sourcePath)) {
            res.status(404).json({ error: 'Nie znaleziono pliku do zmiany nazwy.' });
            return;
        }

        if (existsSync(destinationPath)) {
            res.status(409).json({ error: 'Plik o docelowej nazwie juz istnieje.' });
            return;
        }

        await rename(sourcePath, destinationPath);
        const fileStats = statSync(destinationPath);

        apiLogger.info('IMAGE_LIBRARY_RENAME_SUCCESS', 'Zmieniono nazwe obrazu w bibliotece grafik.', {
            actorUserId,
            previousFilename: normalizedFilename,
            nextFilename: normalizedNewFilename,
        });

        res.json({
            success: true,
            entry: {
                name: normalizedNewFilename,
                sizeBytes: fileStats.size,
                modifiedAt: fileStats.mtimeMs,
                mimeType: IMAGE_LIBRARY_MIME_BY_EXTENSION[finalExtension] ?? 'application/octet-stream',
                url: `/img/${encodeURIComponent(normalizedNewFilename)}`,
            },
        });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_RENAME_FAILED', 'Nie udalo sie zmienic nazwy obrazu.', {
            actorUserId,
            filename: parsedBody.data.filename,
            newFilename: parsedBody.data.newFilename,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie zmienic nazwy obrazu.' });
    }
});

// DELETE /api/images/:filename — delete image from /img library
imagesRouter.delete('/images/:filename', requireSectionAccess('image-library'), async (req, res) => {
    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const normalizedFilename = resolveSafeImageFilename(String(req.params.filename ?? ''));
        if (!normalizedFilename) {
            res.status(400).json({ error: 'Nieprawidlowa nazwa pliku.' });
            return;
        }

        const extension = resolveImageLibraryExtension(normalizedFilename);
        if (!IMAGE_LIBRARY_ALLOWED_EXTENSIONS.has(extension)) {
            res.status(400).json({ error: 'Nieobslugiwany format pliku graficznego.' });
            return;
        }

        const imageDirectoryPath = resolveImageLibraryDirectoryPath();
        const targetFilePath = join(imageDirectoryPath, normalizedFilename);

        if (!existsSync(targetFilePath)) {
            res.status(404).json({ error: 'Nie znaleziono pliku do usuniecia.' });
            return;
        }

        await unlink(targetFilePath);

        apiLogger.info('IMAGE_LIBRARY_DELETE_SUCCESS', 'Usunieto obraz z biblioteki grafik.', {
            actorUserId,
            imageFilename: normalizedFilename,
        });

        res.json({ success: true, deletedFilename: normalizedFilename });
    } catch (error) {
        apiLogger.error('IMAGE_LIBRARY_DELETE_FAILED', 'Nie udalo sie usunac obrazu z biblioteki.', {
            actorUserId,
            filename: req.params.filename,
        }, error);
        res.status(500).json({ error: 'Nie udalo sie usunac obrazu z biblioteki.' });
    }
});

