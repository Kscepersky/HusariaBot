const WARSAW_TIME_ZONE = 'Europe/Warsaw';

const DATETIME_LOCAL_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function parseOffsetMinutes(offsetLabel: string): number | null {
    const normalized = offsetLabel.replace('UTC', 'GMT');
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(normalized);
    if (!match) {
        return null;
    }

    const sign = match[1] === '-' ? -1 : 1;
    const hourPart = Number.parseInt(match[2] ?? '0', 10);
    const minutePart = Number.parseInt(match[3] ?? '0', 10);

    if (!Number.isFinite(hourPart) || !Number.isFinite(minutePart)) {
        return null;
    }

    return sign * ((hourPart * 60) + minutePart);
}

function getZoneOffsetMinutes(timestamp: number): number | null {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: WARSAW_TIME_ZONE,
        timeZoneName: 'shortOffset',
        hour: '2-digit',
    });

    const parts = formatter.formatToParts(new Date(timestamp));
    const zonePart = parts.find((part) => part.type === 'timeZoneName')?.value;

    if (!zonePart) {
        return null;
    }

    return parseOffsetMinutes(zonePart);
}

function matchesWarsawLocalTime(timestamp: number, expectedValue: string): boolean {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: WARSAW_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const formatted = formatter
        .format(new Date(timestamp))
        .replace(' ', 'T');

    return formatted === expectedValue;
}

export function parseWarsawDateTimeToTimestamp(dateTimeLocal: string): number | null {
    const normalized = dateTimeLocal.trim();
    const match = DATETIME_LOCAL_REGEX.exec(normalized);

    if (!match) {
        return null;
    }

    const year = Number.parseInt(match[1] ?? '0', 10);
    const month = Number.parseInt(match[2] ?? '0', 10);
    const day = Number.parseInt(match[3] ?? '0', 10);
    const hour = Number.parseInt(match[4] ?? '0', 10);
    const minute = Number.parseInt(match[5] ?? '0', 10);

    const normalizedMonth = month - 1;
    const candidateUtc = Date.UTC(year, normalizedMonth, day, hour, minute, 0, 0);
    const dateCandidate = new Date(candidateUtc);

    // Reject invalid dates such as 2026-02-31.
    if (
        dateCandidate.getUTCFullYear() !== year
        || dateCandidate.getUTCMonth() !== normalizedMonth
        || dateCandidate.getUTCDate() !== day
        || dateCandidate.getUTCHours() !== hour
        || dateCandidate.getUTCMinutes() !== minute
    ) {
        return null;
    }

    let timestamp = candidateUtc;
    for (let index = 0; index < 3; index += 1) {
        const offsetMinutes = getZoneOffsetMinutes(timestamp);
        if (offsetMinutes === null) {
            return null;
        }

        const nextTimestamp = candidateUtc - (offsetMinutes * 60 * 1000);
        if (nextTimestamp === timestamp) {
            break;
        }

        timestamp = nextTimestamp;
    }

    return matchesWarsawLocalTime(timestamp, normalized) ? timestamp : null;
}

export function formatTimestampInWarsaw(timestamp: number): string {
    return new Intl.DateTimeFormat('pl-PL', {
        timeZone: WARSAW_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(timestamp));
}
