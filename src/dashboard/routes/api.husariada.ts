import { randomInt } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireSectionAccess } from '../middleware/require-section-access.js';
import { zodErrorToMessage } from '../validation/request-schemas.js';
import { buildActorContext } from './actor-context.js';
import { TaskAttachmentValidationError } from '../../tasks/attachments.js';
import { getHusariadaStore, HusariadaConflictError, type HusariadaStore } from '../../husariada/store.js';
import { removeQuestionImages, resolveQuestionImagePath, storeQuestionImage } from '../../husariada/images.js';
import { getHusariadaChannelId } from '../../husariada/runtime-config.js';
import {
    ANSWER_MAX_LENGTH,
    MAX_QUESTIONS_PER_QUIZ,
    QUESTION_PROMPT_MAX_LENGTH,
    QUIZ_DESCRIPTION_MAX_LENGTH,
    QUIZ_TITLE_MAX_LENGTH,
    SETTINGS_BOUNDS,
    type HusariadaEvent,
    type Question,
    type QuestionImage,
    type QuestionPatch,
} from '../../husariada/types.js';
import { createLogger } from '../../utils/logger.js';

/**
 * API zakladki Husariada. Dashboard nie steruje gra bezposrednio - zapisuje polecenia
 * do kolejki w SQLite, a bot (jedyny wlasciciel polaczenia z Discordem) je wykonuje.
 */

export const husariadaRouter = Router();
const husariadaLogger = createLogger('dashboard:api:husariada');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Bot zapisuje heartbeat co 5 s - po 20 s ciszy uznajemy go za offline. */
export const BOT_OFFLINE_AFTER_MS = 20_000;
const IMAGE_BASE64_MAX_LENGTH = 11_300_000;
const EVENT_HISTORY_LIMIT = 20;
const STATE_STANDINGS_LIMIT = 10;

const imageUploadSchema = z.strictObject({
    mimeType: z.string().max(50),
    dataBase64: z.string().min(1).max(IMAGE_BASE64_MAX_LENGTH),
});

const answerSchema = z.string().trim().min(1, 'Każda odpowiedź musi mieć treść.').max(ANSWER_MAX_LENGTH, `Odpowiedź może mieć max ${ANSWER_MAX_LENGTH} znaków.`);

const quizSchema = z.strictObject({
    title: z.string().trim().min(1, 'Tytuł quizu jest wymagany.').max(QUIZ_TITLE_MAX_LENGTH),
    description: z.string().trim().max(QUIZ_DESCRIPTION_MAX_LENGTH).default(''),
});

const quizPatchSchema = quizSchema.partial();

const questionSchema = z.strictObject({
    prompt: z.string().trim().min(1, 'Treść pytania jest wymagana.').max(QUESTION_PROMPT_MAX_LENGTH),
    answers: z.tuple([answerSchema, answerSchema, answerSchema, answerSchema]),
    correctIndex: z.number().int().min(0).max(3),
    image: imageUploadSchema.optional(),
});

const questionPatchSchema = z.strictObject({
    prompt: questionSchema.shape.prompt.optional(),
    answers: questionSchema.shape.answers.optional(),
    correctIndex: questionSchema.shape.correctIndex.optional(),
    /** `null` usuwa obrazek. */
    image: imageUploadSchema.nullable().optional(),
});

const reorderSchema = z.strictObject({
    questionIds: z.array(z.string().regex(UUID_PATTERN)).min(1).max(MAX_QUESTIONS_PER_QUIZ),
});

function settingField(key: keyof typeof SETTINGS_BOUNDS) {
    const bounds = SETTINGS_BOUNDS[key];
    return z.number().int().min(bounds.min).max(bounds.max).optional();
}

const settingsSchema = z.strictObject({
    timeLimitSec: settingField('timeLimitSec'),
    maxPoints: settingField('maxPoints'),
    leaderboardEvery: settingField('leaderboardEvery'),
    leaderboardSeconds: settingField('leaderboardSeconds'),
    revealSeconds: settingField('revealSeconds'),
    introSeconds: settingField('introSeconds'),
});

const startEventSchema = z.strictObject({
    quizId: z.string().regex(UUID_PATTERN, 'Wybierz quiz.'),
    shuffle: z.boolean().default(false),
    questionCount: z.number().int().min(1).max(MAX_QUESTIONS_PER_QUIZ).nullable().default(null),
});

const commandSchema = z.strictObject({
    type: z.enum(['pause', 'resume', 'stop', 'skip']),
});

class HusariadaRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'HusariadaRequestError';
    }
}

function actorId(req: Request): string {
    return req.session.user?.id ?? '';
}

function parseId(req: Request, param: string, notFound: string): string {
    const value = String(req.params[param] ?? '');
    if (!UUID_PATTERN.test(value)) {
        throw new HusariadaRequestError(404, notFound);
    }
    return value;
}

function respondError(req: Request, res: Response, error: unknown, code: string, message: string): void {
    if (error instanceof HusariadaRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof HusariadaConflictError) {
        res.status(409).json({ error: error.message });
        return;
    }
    if (error instanceof TaskAttachmentValidationError) {
        res.status(400).json({ error: error.message });
        return;
    }
    husariadaLogger.error(code, message, buildActorContext(req.session.user), error);
    res.status(500).json({ error: 'Nie udało się wykonać operacji Husariady.' });
}

function validate<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw new HusariadaRequestError(400, zodErrorToMessage(parsed.error));
    }
    return parsed.data;
}

function serializeQuestion(question: Question) {
    return {
        id: question.id,
        quizId: question.quizId,
        position: question.position,
        prompt: question.prompt,
        answers: question.answers,
        correctIndex: question.correctIndex,
        imageUrl: question.image ? `/api/husariada/questions/${question.id}/image` : null,
        updatedAt: question.updatedAt,
    };
}

async function assertQuizEditable(store: HusariadaStore, quizId: string): Promise<void> {
    if (!(await store.getQuiz(quizId))) {
        throw new HusariadaRequestError(404, 'Nie znaleziono quizu.');
    }
    if (await store.isQuizInActiveEvent(quizId)) {
        throw new HusariadaRequestError(409, 'Ten quiz jest właśnie rozgrywany - edycja będzie możliwa po zakończeniu eventu.');
    }
}

async function loadQuestion(store: HusariadaStore, req: Request): Promise<Question> {
    const question = await store.getQuestion(parseId(req, 'questionId', 'Nie znaleziono pytania.'));
    if (!question) {
        throw new HusariadaRequestError(404, 'Nie znaleziono pytania.');
    }
    return question;
}

/** Losowa kolejnosc (Fisher-Yates z kryptograficznym RNG) i opcjonalne przyciecie liczby pytan. */
export function pickQuestionOrder(ids: readonly string[], shuffle: boolean, count: number | null, random: (max: number) => number = randomInt): string[] {
    const ordered = [...ids];
    if (shuffle) {
        for (let index = ordered.length - 1; index > 0; index -= 1) {
            const swap = random(index + 1);
            [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
        }
    }
    return count === null ? ordered : ordered.slice(0, count);
}

async function isBotOnline(store: HusariadaStore): Promise<{ online: boolean; heartbeatAt: number | null }> {
    const raw = await store.getMeta('engine_heartbeat_at');
    const heartbeatAt = raw ? Number(raw) : null;
    return {
        heartbeatAt: Number.isFinite(heartbeatAt) ? heartbeatAt : null,
        online: heartbeatAt !== null && Date.now() - heartbeatAt < BOT_OFFLINE_AFTER_MS,
    };
}

function serializeEvent(event: HusariadaEvent | null) {
    if (!event) return null;
    return {
        id: event.id,
        quizId: event.quizId,
        quizTitle: event.quizTitle,
        status: event.status,
        phase: event.phase,
        currentIndex: event.currentIndex,
        questionCount: event.questionCount,
        settings: event.settings,
        startedBy: event.startedBy,
        createdAt: event.createdAt,
        startedAt: event.startedAt,
        finishedAt: event.finishedAt,
        questionDeadlineAt: event.questionDeadlineAt,
        pauseRequested: event.pauseRequested,
    };
}

husariadaRouter.use('/husariada', requireSectionAccess('husariada'));

// GET /api/husariada/state — stan gry na zywo (polling z dashboardu)
husariadaRouter.get('/husariada/state', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const event = await store.getActiveEvent();
        const [bot, settings, commands, standings, answered] = await Promise.all([
            isBotOnline(store),
            store.getSettings(),
            store.listRecentCommands(5),
            event ? store.getStandings(event.id) : Promise.resolve([]),
            event && event.currentIndex >= 0 ? store.countAnswers(event.id, event.currentIndex) : Promise.resolve(0),
        ]);
        res.json({
            event: serializeEvent(event),
            settings,
            bot,
            channelConfigured: getHusariadaChannelId() !== null,
            currentAnswers: answered,
            players: standings.length,
            standings: standings.slice(0, STATE_STANDINGS_LIMIT),
            recentCommands: commands,
            limits: { bounds: SETTINGS_BOUNDS, maxQuestions: MAX_QUESTIONS_PER_QUIZ },
        });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_STATE_FAILED', 'Nie udalo sie pobrac stanu Husariady.');
    }
});

// ─── Quizy ──────────────────────────────────────────────────────────────────

husariadaRouter.get('/husariada/quizzes', async (req, res) => {
    try {
        res.json({ quizzes: await (await getHusariadaStore()).listQuizzes() });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUIZZES_FAILED', 'Nie udalo sie pobrac quizow.');
    }
});

husariadaRouter.post('/husariada/quizzes', async (req, res) => {
    try {
        const input = validate(quizSchema, req.body);
        const quiz = await (await getHusariadaStore()).createQuiz({ ...input, createdBy: actorId(req) });
        husariadaLogger.info('HUSARIADA_QUIZ_CREATED', 'Utworzono quiz Husariady.', { ...buildActorContext(req.session.user), quizId: quiz.id });
        res.status(201).json({ quiz });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUIZ_CREATE_FAILED', 'Nie udalo sie utworzyc quizu.');
    }
});

husariadaRouter.get('/husariada/quizzes/:quizId', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const quizId = parseId(req, 'quizId', 'Nie znaleziono quizu.');
        const quiz = await store.getQuiz(quizId);
        if (!quiz) throw new HusariadaRequestError(404, 'Nie znaleziono quizu.');
        res.json({
            quiz,
            locked: await store.isQuizInActiveEvent(quizId),
            questions: (await store.listQuestions(quizId)).map(serializeQuestion),
        });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUIZ_GET_FAILED', 'Nie udalo sie pobrac quizu.');
    }
});

husariadaRouter.patch('/husariada/quizzes/:quizId', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const quizId = parseId(req, 'quizId', 'Nie znaleziono quizu.');
        const patch = validate(quizPatchSchema, req.body);
        const quiz = await store.updateQuiz(quizId, patch);
        if (!quiz) throw new HusariadaRequestError(404, 'Nie znaleziono quizu.');
        res.json({ quiz });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUIZ_UPDATE_FAILED', 'Nie udalo sie zapisac quizu.');
    }
});

husariadaRouter.delete('/husariada/quizzes/:quizId', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const quizId = parseId(req, 'quizId', 'Nie znaleziono quizu.');
        await assertQuizEditable(store, quizId);
        const images = await store.deleteQuiz(quizId);
        if (!images) throw new HusariadaRequestError(404, 'Nie znaleziono quizu.');
        await removeQuestionImages(images);
        husariadaLogger.warn('HUSARIADA_QUIZ_DELETED', 'Usunieto quiz Husariady.', { ...buildActorContext(req.session.user), quizId });
        res.json({ success: true });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUIZ_DELETE_FAILED', 'Nie udalo sie usunac quizu.');
    }
});

husariadaRouter.post('/husariada/quizzes/:quizId/reorder', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const quizId = parseId(req, 'quizId', 'Nie znaleziono quizu.');
        const { questionIds } = validate(reorderSchema, req.body);
        await assertQuizEditable(store, quizId);
        await store.reorderQuestions(quizId, questionIds);
        res.json({ questions: (await store.listQuestions(quizId)).map(serializeQuestion) });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_REORDER_FAILED', 'Nie udalo sie zmienic kolejnosci pytan.');
    }
});

// ─── Pytania ────────────────────────────────────────────────────────────────

husariadaRouter.post('/husariada/quizzes/:quizId/questions', async (req, res) => {
    let storedImage: QuestionImage | null = null;
    try {
        const store = await getHusariadaStore();
        const quizId = parseId(req, 'quizId', 'Nie znaleziono quizu.');
        const input = validate(questionSchema, req.body);
        await assertQuizEditable(store, quizId);
        if ((await store.getQuiz(quizId))!.questionCount >= MAX_QUESTIONS_PER_QUIZ) {
            throw new HusariadaRequestError(409, `Quiz może mieć maksymalnie ${MAX_QUESTIONS_PER_QUIZ} pytań.`);
        }

        storedImage = input.image ? await storeQuestionImage(input.image) : null;
        const question = await store.createQuestion(quizId, {
            prompt: input.prompt, answers: input.answers, correctIndex: input.correctIndex, image: storedImage,
        });
        storedImage = null;
        res.status(201).json({ question: serializeQuestion(question) });
    } catch (error) {
        await removeQuestionImages([storedImage]);
        respondError(req, res, error, 'HUSARIADA_QUESTION_CREATE_FAILED', 'Nie udalo sie dodac pytania.');
    }
});

husariadaRouter.patch('/husariada/questions/:questionId', async (req, res) => {
    let storedImage: QuestionImage | null = null;
    try {
        const store = await getHusariadaStore();
        const question = await loadQuestion(store, req);
        const input = validate(questionPatchSchema, req.body);
        await assertQuizEditable(store, question.quizId);

        const patch: QuestionPatch = { prompt: input.prompt, answers: input.answers, correctIndex: input.correctIndex };
        if (input.image === null) {
            patch.image = null;
        } else if (input.image) {
            storedImage = await storeQuestionImage(input.image);
            patch.image = storedImage;
        }

        const result = await store.updateQuestion(question.id, patch);
        if (!result) throw new HusariadaRequestError(404, 'Nie znaleziono pytania.');
        storedImage = null;
        if (patch.image !== undefined && result.before.image?.storedName !== result.after.image?.storedName) {
            await removeQuestionImages([result.before.image]);
        }
        res.json({ question: serializeQuestion(result.after) });
    } catch (error) {
        await removeQuestionImages([storedImage]);
        respondError(req, res, error, 'HUSARIADA_QUESTION_UPDATE_FAILED', 'Nie udalo sie zapisac pytania.');
    }
});

husariadaRouter.delete('/husariada/questions/:questionId', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const question = await loadQuestion(store, req);
        await assertQuizEditable(store, question.quizId);
        const deleted = await store.deleteQuestion(question.id);
        await removeQuestionImages([deleted?.image ?? null]);
        res.json({ success: true });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_QUESTION_DELETE_FAILED', 'Nie udalo sie usunac pytania.');
    }
});

husariadaRouter.get('/husariada/questions/:questionId/image', async (req, res) => {
    try {
        const question = await loadQuestion(await getHusariadaStore(), req);
        if (!question.image) throw new HusariadaRequestError(404, 'To pytanie nie ma obrazka.');
        res.setHeader('Content-Type', question.image.mimeType);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.sendFile(resolveQuestionImagePath(question.image), { dotfiles: 'deny' }, (error) => {
            if (error && !res.headersSent) res.status(404).json({ error: 'Nie znaleziono pliku.' });
        });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_IMAGE_FAILED', 'Nie udalo sie pobrac obrazka pytania.');
    }
});

// ─── Ustawienia ─────────────────────────────────────────────────────────────

husariadaRouter.get('/husariada/settings', async (req, res) => {
    try {
        res.json({ settings: await (await getHusariadaStore()).getSettings(), bounds: SETTINGS_BOUNDS });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_SETTINGS_FAILED', 'Nie udalo sie pobrac ustawien.');
    }
});

husariadaRouter.put('/husariada/settings', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const settings = await store.updateSettings(validate(settingsSchema, req.body));
        // Odswiezenie embeda "brak eventu" z nowymi zasadami (bot zignoruje, gdy event trwa).
        await store.enqueueCommand('refresh_lobby', null, actorId(req));
        husariadaLogger.info('HUSARIADA_SETTINGS_UPDATED', 'Zmieniono ustawienia Husariady.', { ...buildActorContext(req.session.user) });
        res.json({ settings });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_SETTINGS_UPDATE_FAILED', 'Nie udalo sie zapisac ustawien.');
    }
});

// ─── Eventy ─────────────────────────────────────────────────────────────────

husariadaRouter.post('/husariada/events', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const input = validate(startEventSchema, req.body);
        if (!getHusariadaChannelId()) {
            throw new HusariadaRequestError(409, 'Brak HUSARIADA_CHANNEL_ID w konfiguracji - bot nie wie, gdzie prowadzić quiz.');
        }
        if (!(await isBotOnline(store)).online) {
            throw new HusariadaRequestError(409, 'Bot nie odpowiada. Uruchom bota i spróbuj ponownie.');
        }
        const questions = await store.listQuestions(input.quizId);
        if (questions.length === 0) {
            throw new HusariadaRequestError(409, 'Quiz nie ma żadnych pytań.');
        }

        const questionIds = pickQuestionOrder(questions.map((question) => question.id), input.shuffle, input.questionCount);
        const event = await store.createEvent({
            quizId: input.quizId,
            startedBy: actorId(req),
            settings: await store.getSettings(),
            questionIds,
        });
        await store.enqueueCommand('start', event.id, actorId(req));
        husariadaLogger.info('HUSARIADA_EVENT_CREATED', 'Uruchomiono event Husariady.', {
            ...buildActorContext(req.session.user), eventId: event.id, quizId: event.quizId, questionCount: event.questionCount,
        });
        res.status(201).json({ event: serializeEvent(event) });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_EVENT_CREATE_FAILED', 'Nie udalo sie uruchomic eventu.');
    }
});

husariadaRouter.post('/husariada/events/:eventId/commands', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const eventId = parseId(req, 'eventId', 'Nie znaleziono eventu.');
        const { type } = validate(commandSchema, req.body);
        const active = await store.getActiveEvent();
        if (!active || active.id !== eventId) {
            throw new HusariadaRequestError(409, 'Ten event już się zakończył.');
        }
        const command = await store.enqueueCommand(type, eventId, actorId(req));
        husariadaLogger.info('HUSARIADA_COMMAND_QUEUED', 'Wyslano polecenie do Husariady.', {
            ...buildActorContext(req.session.user), eventId, command: type,
        });
        res.status(202).json({ command });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_COMMAND_FAILED', 'Nie udalo sie wyslac polecenia.');
    }
});

husariadaRouter.get('/husariada/events', async (req, res) => {
    try {
        const events = await (await getHusariadaStore()).listEvents(EVENT_HISTORY_LIMIT);
        res.json({ events: events.map(serializeEvent) });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_EVENTS_FAILED', 'Nie udalo sie pobrac historii eventow.');
    }
});

husariadaRouter.get('/husariada/events/:eventId', async (req, res) => {
    try {
        const store = await getHusariadaStore();
        const event = await store.getEvent(parseId(req, 'eventId', 'Nie znaleziono eventu.'));
        if (!event) throw new HusariadaRequestError(404, 'Nie znaleziono eventu.');
        res.json({ event: serializeEvent(event), standings: await store.getStandings(event.id) });
    } catch (error) {
        respondError(req, res, error, 'HUSARIADA_EVENT_GET_FAILED', 'Nie udalo sie pobrac wynikow eventu.');
    }
});
