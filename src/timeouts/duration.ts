const DURATION_PATTERN = /^(\d+)\s*(s|m|h|d|mo|y)$/i;

const SECOND_IN_MS = 1000;
const MINUTE_IN_MS = 60 * SECOND_IN_MS;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const MONTH_IN_MS = 30 * DAY_IN_MS;
const YEAR_IN_MS = 365 * DAY_IN_MS;

export const MAX_TIMEOUT_DURATION_MS = 10 * YEAR_IN_MS;

export const TIMEOUT_DURATION_UNITS = ['s', 'm', 'h', 'd', 'mo', 'y'] as const;

export type TimeoutDurationUnit = (typeof TIMEOUT_DURATION_UNITS)[number];

export interface ParsedTimeoutDuration {
    amount: number;
    unit: TimeoutDurationUnit;
    durationMs: number;
    normalized: string;
}

const DURATION_UNIT_MULTIPLIER: Readonly<Record<TimeoutDurationUnit, number>> = {
    s: SECOND_IN_MS,
    m: MINUTE_IN_MS,
    h: HOUR_IN_MS,
    d: DAY_IN_MS,
    mo: MONTH_IN_MS,
    y: YEAR_IN_MS,
};

function resolveTimeoutDurationUnit(input: string): TimeoutDurationUnit | null {
    const normalizedInput = input.trim().toLowerCase();
    if (!TIMEOUT_DURATION_UNITS.includes(normalizedInput as TimeoutDurationUnit)) {
        return null;
    }

    return normalizedInput as TimeoutDurationUnit;
}

function resolveUnitMultiplier(unit: TimeoutDurationUnit): number {
    return DURATION_UNIT_MULTIPLIER[unit];
}

export function parseTimeoutDurationParts(amountInput: number, unitInput: string): ParsedTimeoutDuration {
    if (!Number.isInteger(amountInput) || amountInput <= 0) {
        throw new Error('Czas timeoutu musi byc dodatnia liczba calkowita.');
    }

    const unit = resolveTimeoutDurationUnit(unitInput);
    if (!unit) {
        throw new Error('Nieprawidlowa jednostka czasu timeoutu.');
    }

    const durationMs = amountInput * resolveUnitMultiplier(unit);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new Error('Czas timeoutu jest nieprawidlowy.');
    }

    if (durationMs > MAX_TIMEOUT_DURATION_MS) {
        throw new Error('Maksymalny timeout to 10y.');
    }

    return {
        amount: amountInput,
        unit,
        durationMs,
        normalized: `${amountInput}${unit}`,
    };
}

export function parseTimeoutDuration(input: string): ParsedTimeoutDuration {
    const rawValue = input.trim();
    const match = DURATION_PATTERN.exec(rawValue);

    if (!match) {
        throw new Error('Nieprawidlowy format czasu. Uzyj: 30s, 15m, 1h, 2d, 1mo lub 1y.');
    }

    const amount = Number.parseInt(match[1] ?? '', 10);
    const unit = (match[2] ?? '').toLowerCase();
    return parseTimeoutDurationParts(amount, unit);
}

export function formatTimeoutDurationHuman(valueMs: number): string {
    const totalSeconds = Math.max(1, Math.ceil(valueMs / SECOND_IN_MS));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }

    const totalMinutes = Math.ceil(totalSeconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) {
        if (hours > 0) {
            return `${days}d ${hours}h`;
        }

        return `${days}d`;
    }

    if (hours > 0) {
        if (minutes > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${hours}h`;
    }

    return `${minutes}m`;
}
