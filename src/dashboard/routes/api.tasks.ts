import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireSectionAccess } from '../middleware/require-section-access.js';
import { taskWriteRateLimiter } from '../middleware/rate-limit.js';
import { zodErrorToMessage } from '../validation/request-schemas.js';
import { parsePositiveIntQuery } from './query-utils.js';
import { buildActorContext } from './actor-context.js';
import { describeUsers } from '../user-summaries.js';
import { getOwnerId, isOwner } from '../../permissions/access.js';
import { getPermissionStore, isSnowflake } from '../../permissions/permission-store.js';
import { getTaskStore } from '../../tasks/task-store.js';
import {
    MAX_TASK_ATTACHMENTS_PER_UPLOAD,
    TaskAttachmentValidationError,
    assertStorageAvailable,
    removeAttachmentFiles,
    resolveAttachmentPath,
    storeAttachmentFiles,
    validateAttachmentUploads,
    type AttachmentUpload,
} from '../../tasks/attachments.js';
import { notifyTaskAssigned } from '../../tasks/notifications.js';
import { requestTaskBoardRefresh } from '../../tasks/board.js';
import {
    TASK_COMPLETION_NOTE_MAX_LENGTH,
    TASK_COMPLETION_NOTE_MIN_LENGTH,
    TASK_DESCRIPTION_MAX_LENGTH,
    TASK_PRIORITIES,
    TASK_TITLE_MAX_LENGTH,
    type NewAttachmentRecord,
    type Task,
    type TaskAttachmentKind,
    type TaskStatus,
} from '../../tasks/types.js';
import { createLogger } from '../../utils/logger.js';

/**
 * API tasków. Cała ścieżka `/tasks` stoi za `requireSectionAccess('tasks')`,
 * który przy każdym żądaniu odświeża uprawnienia z bazy i Discorda.
 * Reguły per task (kto edytuje / kończy) sprawdzane są niezależnie od UI.
 */

export const tasksRouter = Router();
const tasksLogger = createLogger('dashboard:api:tasks');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const HISTORY_PAGE_SIZE_DEFAULT = 15;
const HISTORY_PAGE_SIZE_MAX = 50;
const SEARCH_MAX_LENGTH = 100;
const DUE_AT_PAST_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const DUE_AT_MAX_FUTURE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
/** 8 MB w base64 + prefiks data URL. */
const ATTACHMENT_BASE64_MAX_LENGTH = 11_300_000;

const attachmentUploadSchema = z.strictObject({
    mimeType: z.string().max(50),
    dataBase64: z.string().min(1).max(ATTACHMENT_BASE64_MAX_LENGTH),
});

const assigneeSchema = z.string().regex(SNOWFLAKE_PATTERN, 'Niepoprawne ID osoby.').nullable();
const dueAtSchema = z.number().int().nullable();

const createTaskSchema = z.strictObject({
    title: z.string().trim().min(1, 'Tytuł jest wymagany.').max(TASK_TITLE_MAX_LENGTH),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX_LENGTH).default(''),
    priority: z.enum(TASK_PRIORITIES).default('normal'),
    assigneeId: assigneeSchema,
    dueAt: dueAtSchema.default(null),
    attachments: z.array(attachmentUploadSchema).max(MAX_TASK_ATTACHMENTS_PER_UPLOAD).default([]),
});

const updateTaskSchema = z.strictObject({
    title: z.string().trim().min(1, 'Tytuł jest wymagany.').max(TASK_TITLE_MAX_LENGTH).optional(),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX_LENGTH).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigneeId: assigneeSchema.optional(),
    dueAt: dueAtSchema.optional(),
});

const completeTaskSchema = z.strictObject({
    note: z.string().trim()
        .min(TASK_COMPLETION_NOTE_MIN_LENGTH, `Opisz krótko, co zostało zrobione (min. ${TASK_COMPLETION_NOTE_MIN_LENGTH} znaki).`)
        .max(TASK_COMPLETION_NOTE_MAX_LENGTH),
    attachments: z.array(attachmentUploadSchema).max(MAX_TASK_ATTACHMENTS_PER_UPLOAD).default([]),
});

interface TaskActor {
    id: string;
    isOwner: boolean;
}

class TaskRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
        this.name = 'TaskRequestError';
    }
}

function getActor(req: Request): TaskActor {
    const id = req.session.user?.id ?? '';
    return { id, isOwner: isOwner(id) };
}

export function canEditTask(task: Task, actor: TaskActor): boolean {
    return task.status === 'open' && (actor.isOwner || task.creatorId === actor.id);
}

export function canCompleteTask(task: Task, actor: TaskActor): boolean {
    return task.status === 'open' && (actor.isOwner || task.assigneeId === null || task.assigneeId === actor.id);
}

/** Usunięte taski (i ich załączniki) widzi tylko owner. */
function canViewTask(task: Pick<Task, 'status'>, actor: TaskActor): boolean {
    return task.status !== 'deleted' || actor.isOwner;
}

function serializeTask(task: Task, actor: TaskActor) {
    return {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        status: task.status,
        creatorId: task.creatorId,
        assigneeId: task.assigneeId,
        dueAt: task.dueAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedBy: task.completedBy,
        completedAt: task.completedAt,
        completionNote: task.completionNote,
        deletedBy: task.deletedBy,
        deletedAt: task.deletedAt,
        // Nazwa pliku na dysku nigdy nie wychodzi do klienta.
        attachments: task.attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            url: `/api/tasks/attachments/${attachment.id}`,
        })),
        permissions: {
            canEdit: canEditTask(task, actor),
            canDelete: canEditTask(task, actor),
            canComplete: canCompleteTask(task, actor),
        },
    };
}

function taskUserIds(tasks: readonly Task[]): string[] {
    return tasks.flatMap((task) => [task.creatorId, task.assigneeId, task.completedBy, task.deletedBy].filter((id): id is string => Boolean(id)));
}

/** Osoby, którym można przypisać task: owner i każdy z dostępem do dashboardu. */
async function listAssigneeIds(): Promise<string[]> {
    const entries = await (await getPermissionStore()).list();
    return [...new Set([getOwnerId(), ...entries.map((entry) => entry.userId)])];
}

async function assertAssignable(assigneeId: string | null): Promise<void> {
    if (assigneeId === null) return;
    if (!(await listAssigneeIds()).includes(assigneeId)) {
        throw new TaskRequestError(400, 'Tej osobie nie można przypisać taska (brak dostępu do dashboardu).');
    }
}

function assertDueAt(dueAt: number | null | undefined): void {
    if (dueAt === null || dueAt === undefined) return;
    const now = Date.now();
    if (dueAt < now - DUE_AT_PAST_TOLERANCE_MS || dueAt > now + DUE_AT_MAX_FUTURE_MS) {
        throw new TaskRequestError(400, 'Nieprawidłowy termin taska.');
    }
}

function parseTaskId(req: Request): string {
    const taskId = String(req.params['taskId'] ?? '');
    if (!UUID_PATTERN.test(taskId)) {
        throw new TaskRequestError(404, 'Nie znaleziono taska.');
    }
    return taskId;
}

async function loadVisibleTask(req: Request, actor: TaskActor): Promise<Task> {
    const task = await (await getTaskStore()).getTask(parseTaskId(req));
    if (!task || !canViewTask(task, actor)) {
        throw new TaskRequestError(404, 'Nie znaleziono taska.');
    }
    return task;
}

async function saveUploads(uploads: readonly AttachmentUpload[], kind: TaskAttachmentKind): Promise<NewAttachmentRecord[]> {
    const prepared = validateAttachmentUploads(uploads);
    if (prepared.length === 0) return [];
    assertStorageAvailable(prepared, await (await getTaskStore()).getAttachmentBytesTotal());
    return storeAttachmentFiles(prepared, kind);
}

function respondError(req: Request, res: Response, error: unknown, code: string, message: string): void {
    if (error instanceof TaskRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof TaskAttachmentValidationError) {
        res.status(400).json({ error: error.message });
        return;
    }

    tasksLogger.error(code, message, buildActorContext(req.session.user), error);
    res.status(500).json({ error: 'Nie udało się wykonać operacji na taskach.' });
}

async function resolveRecipients(assigneeId: string | null): Promise<string[]> {
    return assigneeId === null ? listAssigneeIds() : [assigneeId];
}

/**
 * DM-y nie mogą blokować ani psuć odpowiedzi API - task jest już zapisany, więc
 * nawet ustalanie odbiorców dzieje się w tle (inaczej błąd dałby 500 i duplikat przy ponowieniu).
 */
function notifyInBackground(task: Task, actorId: string, excludedIds: readonly (string | null)[] = []): void {
    void resolveRecipients(task.assigneeId)
        .then((recipients) => notifyTaskAssigned(task, actorId, recipients.filter((id) => !excludedIds.includes(id))))
        .catch((error: unknown) => {
            tasksLogger.error('TASK_NOTIFY_FAILED', 'Nie udalo sie wyslac powiadomien o tasku.', { taskId: task.id }, error);
        });
}

tasksRouter.use('/tasks', requireSectionAccess('tasks'), taskWriteRateLimiter);

// GET /api/tasks/meta — zalogowany uzytkownik i lista osob do przypisania
tasksRouter.get('/tasks/meta', async (req, res) => {
    try {
        const actor = getActor(req);
        const assigneeIds = await listAssigneeIds();
        const users = await describeUsers(assigneeIds);

        res.json({
            me: actor,
            assignees: assigneeIds.map((id) => users[id] ?? { id, username: null, globalName: null, avatar: null }),
            limits: {
                titleMaxLength: TASK_TITLE_MAX_LENGTH,
                descriptionMaxLength: TASK_DESCRIPTION_MAX_LENGTH,
                noteMinLength: TASK_COMPLETION_NOTE_MIN_LENGTH,
                noteMaxLength: TASK_COMPLETION_NOTE_MAX_LENGTH,
                maxAttachments: MAX_TASK_ATTACHMENTS_PER_UPLOAD,
            },
        });
    } catch (error) {
        respondError(req, res, error, 'TASKS_META_FAILED', 'Nie udalo sie pobrac metadanych taskow.');
    }
});

// GET /api/tasks/attachments/:attachmentId — plik zalacznika (tylko przez autoryzowana trase)
tasksRouter.get('/tasks/attachments/:attachmentId', async (req, res) => {
    try {
        const attachmentId = String(req.params['attachmentId'] ?? '');
        if (!UUID_PATTERN.test(attachmentId)) {
            throw new TaskRequestError(404, 'Nie znaleziono pliku.');
        }

        const found = await (await getTaskStore()).getAttachment(attachmentId);
        if (!found || !canViewTask({ status: found.taskStatus }, getActor(req))) {
            throw new TaskRequestError(404, 'Nie znaleziono pliku.');
        }

        const filePath = resolveAttachmentPath(found.attachment.storedName);
        res.setHeader('Content-Type', found.attachment.mimeType);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.sendFile(filePath, { dotfiles: 'deny' }, (error) => {
            if (error && !res.headersSent) {
                res.status(404).json({ error: 'Nie znaleziono pliku.' });
            }
        });
    } catch (error) {
        respondError(req, res, error, 'TASK_ATTACHMENT_FAILED', 'Nie udalo sie pobrac zalacznika taska.');
    }
});

function parseHistoryStatuses(raw: unknown, actor: TaskActor): TaskStatus[] {
    if (raw === 'deleted') return actor.isOwner ? ['deleted'] : [];
    if (raw === 'all') return actor.isOwner ? ['done', 'deleted'] : ['done'];
    return ['done'];
}

function parseAssigneeFilter(raw: unknown): string | null | undefined {
    if (raw === 'all') return null;
    return typeof raw === 'string' && isSnowflake(raw) ? raw : undefined;
}

// GET /api/tasks?scope=mine|open|history — listy taskow
tasksRouter.get('/tasks', async (req, res) => {
    try {
        const actor = getActor(req);
        const store = await getTaskStore();
        const scope = req.query['scope'];
        const openTasks = await store.listOpenTasks();
        const mine = openTasks.filter((task) => task.assigneeId === actor.id || task.assigneeId === null);
        const now = Date.now();
        const counts = {
            mine: mine.length,
            open: openTasks.length,
            overdue: openTasks.filter((task) => task.dueAt !== null && task.dueAt < now).length,
        };

        if (scope === 'history') {
            const search = typeof req.query['search'] === 'string' ? req.query['search'].slice(0, SEARCH_MAX_LENGTH) : undefined;
            const page = await store.listTasks({
                statuses: parseHistoryStatuses(req.query['status'], actor),
                assigneeId: parseAssigneeFilter(req.query['assignee']),
                search,
                page: parsePositiveIntQuery(req.query['page'], 1),
                pageSize: Math.min(parsePositiveIntQuery(req.query['pageSize'], HISTORY_PAGE_SIZE_DEFAULT), HISTORY_PAGE_SIZE_MAX),
            });
            res.json({
                tasks: page.tasks.map((task) => serializeTask(task, actor)),
                users: await describeUsers(taskUserIds(page.tasks)),
                pagination: { page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages },
                counts,
            });
            return;
        }

        const tasks = scope === 'open' ? openTasks : mine;
        res.json({
            tasks: tasks.map((task) => serializeTask(task, actor)),
            users: await describeUsers(taskUserIds(tasks)),
            pagination: null,
            counts,
        });
    } catch (error) {
        respondError(req, res, error, 'TASKS_LIST_FAILED', 'Nie udalo sie pobrac listy taskow.');
    }
});

// POST /api/tasks — nowy task (+ DM do przypisanych, odswiezenie listy na Discordzie)
tasksRouter.post('/tasks', async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: zodErrorToMessage(parsed.error) });
        return;
    }

    const actor = getActor(req);
    let stored: NewAttachmentRecord[] = [];
    try {
        const { attachments, ...input } = parsed.data;
        assertDueAt(input.dueAt);
        await assertAssignable(input.assigneeId);

        stored = await saveUploads(attachments, 'description');
        const task = await (await getTaskStore()).createTask({ ...input, creatorId: actor.id }, stored);
        stored = [];

        tasksLogger.info('TASK_CREATED', 'Utworzono task.', {
            ...buildActorContext(req.session.user),
            taskId: task.id,
            assigneeId: task.assigneeId ?? 'all',
            attachmentCount: task.attachments.length,
        });

        notifyInBackground(task, actor.id);
        requestTaskBoardRefresh();
        res.status(201).json({ task: serializeTask(task, actor) });
    } catch (error) {
        await removeAttachmentFiles(stored.map((record) => record.storedName));
        respondError(req, res, error, 'TASK_CREATE_FAILED', 'Nie udalo sie utworzyc taska.');
    }
});

// GET /api/tasks/:taskId — szczegoly z historia zmian
tasksRouter.get('/tasks/:taskId', async (req, res) => {
    try {
        const actor = getActor(req);
        const task = await loadVisibleTask(req, actor);
        const events = await (await getTaskStore()).listEvents(task.id);
        const changedAssignees = events.flatMap((event) => {
            const change = event.changes['assigneeId'];
            return change ? [change.before, change.after].filter((id): id is string => typeof id === 'string') : [];
        });

        res.json({
            task: serializeTask(task, actor),
            events,
            users: await describeUsers([...taskUserIds([task]), ...events.map((event) => event.actorId), ...changedAssignees]),
        });
    } catch (error) {
        respondError(req, res, error, 'TASK_GET_FAILED', 'Nie udalo sie pobrac taska.');
    }
});

// PATCH /api/tasks/:taskId — edycja (autor lub owner)
tasksRouter.patch('/tasks/:taskId', async (req, res) => {
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: zodErrorToMessage(parsed.error) });
        return;
    }

    try {
        const actor = getActor(req);
        const task = await loadVisibleTask(req, actor);
        if (task.status !== 'open') throw new TaskRequestError(409, 'Task jest już zamknięty.');
        if (!canEditTask(task, actor)) throw new TaskRequestError(403, 'Edytować task może tylko jego autor lub owner.');

        // Walidujemy tylko faktycznie zmieniane pola: przeterminowany task albo osoba, ktora
        // stracila dostep, nie moga blokowac edycji np. samego priorytetu.
        if (parsed.data.dueAt !== undefined && parsed.data.dueAt !== task.dueAt) assertDueAt(parsed.data.dueAt);
        if (parsed.data.assigneeId !== undefined && parsed.data.assigneeId !== task.assigneeId) {
            await assertAssignable(parsed.data.assigneeId);
        }

        const result = await (await getTaskStore()).updateTask(task.id, parsed.data, actor.id);
        if (!result) throw new TaskRequestError(409, 'Task jest już zamknięty.');

        if (result.before.assigneeId !== result.after.assigneeId) {
            notifyInBackground(result.after, actor.id, [result.before.assigneeId]);
        }

        tasksLogger.info('TASK_UPDATED', 'Zmieniono task.', { ...buildActorContext(req.session.user), taskId: task.id });
        requestTaskBoardRefresh();
        res.json({ task: serializeTask(result.after, actor) });
    } catch (error) {
        respondError(req, res, error, 'TASK_UPDATE_FAILED', 'Nie udalo sie zapisac taska.');
    }
});

// POST /api/tasks/:taskId/complete — ukonczenie z obowiazkowa notatka
tasksRouter.post('/tasks/:taskId/complete', async (req, res) => {
    const parsed = completeTaskSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: zodErrorToMessage(parsed.error) });
        return;
    }

    let stored: NewAttachmentRecord[] = [];
    try {
        const actor = getActor(req);
        const task = await loadVisibleTask(req, actor);
        if (task.status !== 'open') throw new TaskRequestError(409, 'Task jest już zamknięty.');
        if (!canCompleteTask(task, actor)) throw new TaskRequestError(403, 'Ten task jest przypisany do innej osoby.');

        stored = await saveUploads(parsed.data.attachments, 'completion');
        const completed = await (await getTaskStore()).completeTask(task.id, actor.id, parsed.data.note, stored);
        if (!completed) throw new TaskRequestError(409, 'Task został już zamknięty przez kogoś innego.');
        stored = [];

        tasksLogger.info('TASK_COMPLETED', 'Ukonczono task.', { ...buildActorContext(req.session.user), taskId: task.id });
        requestTaskBoardRefresh();
        res.json({ task: serializeTask(completed, actor) });
    } catch (error) {
        await removeAttachmentFiles(stored.map((record) => record.storedName));
        respondError(req, res, error, 'TASK_COMPLETE_FAILED', 'Nie udalo sie ukonczyc taska.');
    }
});

// DELETE /api/tasks/:taskId — soft-delete (autor lub owner)
tasksRouter.delete('/tasks/:taskId', async (req, res) => {
    try {
        const actor = getActor(req);
        const task = await loadVisibleTask(req, actor);
        if (task.status !== 'open') throw new TaskRequestError(409, 'Można usunąć tylko otwarty task.');
        if (!canEditTask(task, actor)) throw new TaskRequestError(403, 'Usunąć task może tylko jego autor lub owner.');

        const deleted = await (await getTaskStore()).deleteTask(task.id, actor.id);
        if (!deleted) throw new TaskRequestError(409, 'Można usunąć tylko otwarty task.');

        tasksLogger.warn('TASK_DELETED', 'Usunieto task.', { ...buildActorContext(req.session.user), taskId: task.id });
        requestTaskBoardRefresh();
        res.json({ success: true });
    } catch (error) {
        respondError(req, res, error, 'TASK_DELETE_FAILED', 'Nie udalo sie usunac taska.');
    }
});
