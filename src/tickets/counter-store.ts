import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

interface TicketCounterData {
    lastNumber: number;
}

const COUNTER_FILE_PATH = join(process.cwd(), 'data', 'ticket-counter.json');
let counterLock = Promise.resolve();

function toTicketCounterData(content: string): TicketCounterData {
    try {
        const parsed = JSON.parse(content) as Partial<TicketCounterData>;
        if (typeof parsed.lastNumber === 'number' && Number.isInteger(parsed.lastNumber) && parsed.lastNumber >= 0) {
            return { lastNumber: parsed.lastNumber };
        }
    } catch {
        return { lastNumber: 0 };
    }

    return { lastNumber: 0 };
}

async function ensureCounterFile(filePath: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });

    try {
        await readFile(filePath, 'utf8');
    } catch {
        await writeFile(filePath, JSON.stringify({ lastNumber: 0 }, null, 2), 'utf8');
    }
}

export function formatTicketNumber(ticketNumber: number): string {
    return ticketNumber.toString().padStart(2, '0');
}

export function sanitizeTicketUsername(username: string): string {
    const normalized = username
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toLowerCase();

    return normalized.length > 0 ? normalized.slice(0, 60) : 'uzytkownik';
}

export async function getNextTicketNumber(filePath: string = COUNTER_FILE_PATH): Promise<number> {
    const nextValuePromise = counterLock.then(async () => {
        await ensureCounterFile(filePath);

        const content = await readFile(filePath, 'utf8');
        const data = toTicketCounterData(content);
        const nextValue = data.lastNumber + 1;

        const updatedData: TicketCounterData = { lastNumber: nextValue };
        await writeFile(filePath, JSON.stringify(updatedData, null, 2), 'utf8');
        return nextValue;
    });

    counterLock = nextValuePromise.then(
        () => undefined,
        () => undefined,
    );

    return nextValuePromise;
}
