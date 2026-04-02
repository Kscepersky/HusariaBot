import { z } from 'zod';

const booleanLikeSchema = z.union([z.boolean(), z.literal('true'), z.literal('false')]);

const optionalStringSchema = z.string().max(20_000_000).optional();

const matchInfoSchema = z.object({
    matchId: optionalStringSchema,
    game: optionalStringSchema,
    g2TeamName: optionalStringSchema,
    opponent: optionalStringSchema,
    tournament: optionalStringSchema,
    matchType: optionalStringSchema,
    beginAtUtc: optionalStringSchema,
    date: optionalStringSchema,
    time: optionalStringSchema,
}).strip();

const eventDraftSchema = z.object({
    enabled: booleanLikeSchema.optional(),
    title: optionalStringSchema,
    description: optionalStringSchema,
    location: optionalStringSchema,
    startAtLocal: optionalStringSchema,
    endAtLocal: optionalStringSchema,
}).strip();

export const dashboardEventSchema = z.object({
    title: optionalStringSchema,
    description: optionalStringSchema,
    location: optionalStringSchema,
    startAtLocal: optionalStringSchema,
    endAtLocal: optionalStringSchema,
}).strip();

export const sendImageSchema = z.object({
    filename: z.string().min(1).max(255),
    channelId: z.string().regex(/^\d{17,20}$/),
}).strip();

export const embedPayloadSchema = z.object({
    mode: optionalStringSchema,
    channelId: optionalStringSchema,
    title: optionalStringSchema,
    content: optionalStringSchema,
    colorName: optionalStringSchema,
    mentionRoleEnabled: booleanLikeSchema.optional(),
    mentionRoleId: optionalStringSchema,
    imageMode: optionalStringSchema,
    imageFilename: optionalStringSchema,
    uploadFileName: optionalStringSchema,
    uploadMimeType: optionalStringSchema,
    uploadBase64: optionalStringSchema,
    matchInfo: matchInfoSchema.optional(),
    eventDraft: eventDraftSchema.optional(),
    scheduleAtLocal: optionalStringSchema,
}).strip();

export const scheduledPayloadSchema = embedPayloadSchema.extend({
    scheduleAtLocal: z.string().min(1).max(200),
}).strip();

export const scheduledSentEditPayloadSchema = embedPayloadSchema.strip();

export function zodErrorToMessage(error: z.ZodError): string {
    const issue = error.issues[0];
    if (!issue) {
        return 'Nieprawidlowe dane wejsciowe.';
    }

    const path = issue.path.join('.');
    if (!path) {
        return 'Nieprawidlowe dane wejsciowe.';
    }

    return `Nieprawidlowe dane wejsciowe w polu: ${path}.`;
}