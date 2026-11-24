import { isSnowflake } from '../permissions/permission-store.js';
import { sanitizeTicketUsername } from '../tickets/counter-store.js';
import { isModerationExempt } from '../moderation/admin-roles.js';

export const DEFAULT_MIN_ACCOUNT_AGE_DAYS = 14;
export const VERIFICATION_CHANNEL_PREFIX = 'weryfikacja-';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TOPIC_KEY = 'verificationUserId=';
const TOPIC_PATTERN = /verificationUserId=(\d{17,20})/;

export type AccountRiskLevel = 'critical' | 'high' | 'medium';

export interface AccountRisk {
    level: AccountRiskLevel;
    label: string;
}

export interface VerificationActor {
    actorId: string;
    actorRoleIds: readonly string[];
    actorIsAdministrator: boolean;
}

export function getVerificationRoleId(): string | null {
    const value = process.env.VERIFICATION_ROLE_ID?.trim();
    return isSnowflake(value) ? value : null;
}

export function getMinAccountAgeDays(): number {
    const raw = process.env.VERIFICATION_MIN_ACCOUNT_AGE_DAYS?.trim();
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_ACCOUNT_AGE_DAYS;
}

export function getAccountAgeDays(createdTimestamp: number, now: number): number {
    return Math.max(0, Math.floor((now - createdTimestamp) / DAY_MS));
}

export function requiresVerification(createdTimestamp: number, now: number, minAgeDays: number): boolean {
    return now - createdTimestamp < minAgeDays * DAY_MS;
}

export function describeAccountRisk(createdTimestamp: number, now: number): AccountRisk {
    const ageMs = now - createdTimestamp;
    if (ageMs < DAY_MS) {
        return { level: 'critical', label: '🔴 Bardzo wysokie — konto ma mniej niż dobę' };
    }
    if (ageMs < 7 * DAY_MS) {
        return { level: 'high', label: '🟠 Wysokie — konto ma mniej niż tydzień' };
    }
    return { level: 'medium', label: `🟡 Średnie — konto młodsze niż wymagany próg` };
}

export function buildVerificationChannelName(username: string): string {
    return `${VERIFICATION_CHANNEL_PREFIX}${sanitizeTicketUsername(username)}`.slice(0, 100);
}

export function buildVerificationTopic(userId: string): string {
    return `${TOPIC_KEY}${userId}`;
}

export function extractVerificationUserId(topic: string | null | undefined): string | null {
    const match = topic?.match(TOPIC_PATTERN);
    return match ? match[1] : null;
}

/** Decyzje podejmuje tylko administracja (4 rangi, owner, Administrator) - nigdy sam weryfikowany. */
export function canResolveVerification(actor: VerificationActor, subjectUserId: string): boolean {
    if (actor.actorId === subjectUserId) {
        return false;
    }
    return isModerationExempt({
        userId: actor.actorId,
        roleIds: actor.actorRoleIds,
        hasAdministratorPermission: actor.actorIsAdministrator,
    });
}

export function formatHoursOrDays(createdTimestamp: number, now: number): string {
    const ageMs = Math.max(0, now - createdTimestamp);
    if (ageMs < DAY_MS) {
        const hours = Math.floor(ageMs / HOUR_MS);
        return `${hours} h`;
    }
    const days = getAccountAgeDays(createdTimestamp, now);
    return `${days} ${days === 1 ? 'dzień' : 'dni'}`;
}
