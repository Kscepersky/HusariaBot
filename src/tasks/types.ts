export const TASK_PRIORITIES = ['high', 'normal', 'low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['open', 'done', 'deleted'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_EVENT_TYPES = ['created', 'edited', 'completed', 'deleted'] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export type TaskAttachmentKind = 'description' | 'completion';

export const TASK_TITLE_MAX_LENGTH = 100;
export const TASK_DESCRIPTION_MAX_LENGTH = 2000;
export const TASK_COMPLETION_NOTE_MIN_LENGTH = 3;
export const TASK_COMPLETION_NOTE_MAX_LENGTH = 1000;

export interface TaskAttachment {
    id: string;
    taskId: string;
    kind: TaskAttachmentKind;
    /** Nazwa pliku na dysku - zawsze `<uuid>.<ext>` wygenerowane przez serwer. */
    storedName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
    createdAt: number;
}

export interface Task {
    id: string;
    title: string;
    description: string;
    priority: TaskPriority;
    status: TaskStatus;
    creatorId: string;
    /** `null` = task przypisany do wszystkich. */
    assigneeId: string | null;
    dueAt: number | null;
    createdAt: number;
    updatedAt: number;
    completedBy: string | null;
    completedAt: number | null;
    completionNote: string | null;
    deletedBy: string | null;
    deletedAt: number | null;
    attachments: TaskAttachment[];
}

export interface TaskEvent {
    id: string;
    taskId: string;
    type: TaskEventType;
    actorId: string;
    /** Zmienione pola przy edycji (`{ pole: { before, after } }`), pusty obiekt dla pozostalych. */
    changes: Record<string, { before: unknown; after: unknown }>;
    createdAt: number;
}

export interface NewAttachmentRecord {
    id: string;
    kind: TaskAttachmentKind;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
}

export interface NewTaskInput {
    title: string;
    description: string;
    priority: TaskPriority;
    assigneeId: string | null;
    dueAt: number | null;
    creatorId: string;
}

export interface TaskPatch {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    assigneeId?: string | null;
    dueAt?: number | null;
}

export interface TaskListQuery {
    statuses: readonly TaskStatus[];
    /** `undefined` = bez filtra, `null` = tylko taski "dla wszystkich". */
    assigneeId?: string | null;
    search?: string;
    page: number;
    pageSize: number;
}

export interface TaskPage {
    tasks: Task[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

export function isTaskPriority(value: unknown): value is TaskPriority {
    return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value);
}
