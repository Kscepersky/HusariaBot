const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function buildConfirmKey(userId: string, itemId: number): string {
    return `${userId}:${itemId}`;
}

export function trackConfirmation(key: string, timeoutMs: number, onExpire: () => Promise<void>): void {
    const existing = pendingTimers.get(key);
    if (existing !== undefined) clearTimeout(existing);

    const timer = setTimeout(async () => {
        pendingTimers.delete(key);
        await onExpire();
    }, timeoutMs);

    pendingTimers.set(key, timer);
}

export function markConfirmationHandled(key: string): void {
    const timer = pendingTimers.get(key);
    if (timer !== undefined) {
        clearTimeout(timer);
        pendingTimers.delete(key);
    }
}
