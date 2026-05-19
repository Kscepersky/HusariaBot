import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import {
    shopItemCreateSchema,
    shopItemUpdateSchema,
    shopOrderCancelSchema,
    zodErrorToMessage,
} from '../validation/request-schemas.js';
import {
    createShopItem,
    updateShopItem,
    deleteShopItem,
    getShopItemsPage,
    getOrderById,
    getOrdersPage,
    completeOrder,
    cancelOrder,
} from '../../shop/repository.js';
import {
    getGuildMember,
    getGuildEmojis,
    hasRequiredRole,
    sendDirectMessage,
} from '../discord-api.js';
import { closeOrderTicketProgrammatic } from '../../tickets/flow.js';
import { getBotClient } from '../../bot-client.js';
import { createLogger } from '../../utils/logger.js';

const shopApiLogger = createLogger('dashboard:api:shop');

export const shopApiRouter = Router();

const SHOP_ITEMS_PAGE_SIZE_DEFAULT = 20;
const SHOP_ITEMS_PAGE_SIZE_MAX = 100;
const SHOP_ORDERS_PAGE_SIZE_DEFAULT = 20;
const SHOP_ORDERS_PAGE_SIZE_MAX = 100;

function parsePositiveIntQuery(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

async function requireShopAdminRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ error: 'Brakuje GUILD_ID.' });
        return;
    }

    const userId = req.session.user?.id;
    if (!userId) {
        res.status(401).json({ error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const member = await getGuildMember(userId, guildId);
        if (!member || !hasRequiredRole(member)) {
            res.status(403).json({ error: 'Brak uprawnień do zarządzania sklepem.' });
            return;
        }

        next();
    } catch (error) {
        shopApiLogger.error('SHOP_ROLE_VERIFY_FAILED', 'Nie udało się zweryfikować uprawnień do sklepu.', { userId }, error);
        res.status(502).json({ error: 'Nie udało się zweryfikować uprawnień użytkownika.' });
    }
}

// GET /api/shop/items
shopApiRouter.get('/items', requireAuth, requireShopAdminRole, async (req, res) => {
    const page = parsePositiveIntQuery(req.query['page'], 1);
    const pageSize = Math.min(
        parsePositiveIntQuery(req.query['pageSize'], SHOP_ITEMS_PAGE_SIZE_DEFAULT),
        SHOP_ITEMS_PAGE_SIZE_MAX
    );
    const includeInactive = req.query['includeInactive'] === 'true';

    try {
        const data = await getShopItemsPage(page, pageSize, includeInactive);
        res.json({ success: true, data });
    } catch (error) {
        shopApiLogger.error('SHOP_ITEMS_LIST_ERROR', 'Błąd podczas pobierania listy przedmiotów.', { page, pageSize }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// POST /api/shop/items
shopApiRouter.post('/items', requireAuth, requireShopAdminRole, async (req, res) => {
    const parsed = shopItemCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: zodErrorToMessage(parsed.error) });
        return;
    }

    try {
        const item = await createShopItem(parsed.data);
        shopApiLogger.info('SHOP_ITEM_CREATED', 'Utworzono nowy przedmiot w sklepie.', {
            itemId: item.id,
            itemName: item.name,
            actorUserId: req.session.user?.id,
        });
        res.status(201).json({ success: true, data: item });
    } catch (error) {
        shopApiLogger.error('SHOP_ITEM_CREATE_ERROR', 'Błąd podczas tworzenia przedmiotu.', {
            actorUserId: req.session.user?.id,
        }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// PATCH /api/shop/items/:id
shopApiRouter.patch('/items/:id', requireAuth, requireShopAdminRole, async (req, res) => {
    const itemId = Number.parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isFinite(itemId)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowe ID przedmiotu.' });
        return;
    }

    const parsed = shopItemUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: zodErrorToMessage(parsed.error) });
        return;
    }

    try {
        const item = await updateShopItem(itemId, parsed.data);
        if (!item) {
            res.status(404).json({ success: false, error: 'Przedmiot nie istnieje.' });
            return;
        }

        shopApiLogger.info('SHOP_ITEM_UPDATED', 'Zaktualizowano przedmiot w sklepie.', {
            itemId,
            actorUserId: req.session.user?.id,
        });
        res.json({ success: true, data: item });
    } catch (error) {
        shopApiLogger.error('SHOP_ITEM_UPDATE_ERROR', 'Błąd podczas aktualizacji przedmiotu.', {
            itemId,
            actorUserId: req.session.user?.id,
        }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// DELETE /api/shop/items/:id
shopApiRouter.delete('/items/:id', requireAuth, requireShopAdminRole, async (req, res) => {
    const itemId = Number.parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isFinite(itemId)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowe ID przedmiotu.' });
        return;
    }

    try {
        const result = await deleteShopItem(itemId);
        if (result.blockedByActiveOrders) {
            res.status(409).json({ success: false, error: 'Nie można usunąć przedmiotu z aktywnymi zamówieniami.' });
            return;
        }

        if (!result.deleted) {
            res.status(404).json({ success: false, error: 'Przedmiot nie istnieje.' });
            return;
        }

        shopApiLogger.info('SHOP_ITEM_DELETED', 'Usunięto przedmiot ze sklepu.', {
            itemId,
            actorUserId: req.session.user?.id,
        });
        res.json({ success: true });
    } catch (error) {
        shopApiLogger.error('SHOP_ITEM_DELETE_ERROR', 'Błąd podczas usuwania przedmiotu.', {
            itemId,
            actorUserId: req.session.user?.id,
        }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// GET /api/shop/orders
shopApiRouter.get('/orders', requireAuth, requireShopAdminRole, async (req, res) => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) {
        res.status(500).json({ success: false, error: 'Brakuje GUILD_ID.' });
        return;
    }

    const page = parsePositiveIntQuery(req.query['page'], 1);
    const pageSize = Math.min(
        parsePositiveIntQuery(req.query['pageSize'], SHOP_ORDERS_PAGE_SIZE_DEFAULT),
        SHOP_ORDERS_PAGE_SIZE_MAX
    );
    const status = resolveStatusFilter(req.query['status']);
    const userId = resolveUserIdFilter(req.query['userId']);

    try {
        const data = await getOrdersPage({ guildId, status, userId, page, pageSize });
        res.json({ success: true, data });
    } catch (error) {
        shopApiLogger.error('SHOP_ORDERS_LIST_ERROR', 'Błąd podczas pobierania zamówień.', { page, pageSize, status, userId }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// GET /api/shop/orders/:id
shopApiRouter.get('/orders/:id', requireAuth, requireShopAdminRole, async (req, res) => {
    const orderId = Number.parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isFinite(orderId)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowe ID zamówienia.' });
        return;
    }

    try {
        const order = await getOrderById(orderId);
        if (!order) {
            res.status(404).json({ success: false, error: 'Zamówienie nie istnieje.' });
            return;
        }

        shopApiLogger.info('SHOP_ORDER_PII_ACCESS', 'Admin wyświetlił szczegóły zamówienia.', {
            orderId,
            actorUserId: req.session.user?.id,
        });

        res.json({ success: true, data: order });
    } catch (error) {
        shopApiLogger.error('SHOP_ORDER_GET_ERROR', 'Błąd podczas pobierania zamówienia.', { orderId }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// POST /api/shop/orders/:id/complete
shopApiRouter.post('/orders/:id/complete', requireAuth, requireShopAdminRole, async (req, res) => {
    const orderId = Number.parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isFinite(orderId)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowe ID zamówienia.' });
        return;
    }

    const actorUserId = req.session.user?.id;

    try {
        const order = await completeOrder(orderId);
        if (!order) {
            res.status(404).json({ success: false, error: 'Zamówienie nie istnieje lub nie jest w stanie oczekującym.' });
            return;
        }

        shopApiLogger.info('SHOP_ORDER_COMPLETED', 'Zrealizowano zamówienie.', {
            orderId,
            userId: order.userId,
            actorUserId,
        });

        void sendCompletionDm(order.userId, order.id).catch((dmError) => {
            shopApiLogger.warn('SHOP_ORDER_DM_FAILED', 'Nie udało się wysłać DM o realizacji zamówienia.', {
                orderId,
                userId: order.userId,
            }, dmError);
        });

        const guildId = process.env.GUILD_ID;
        const botClient = getBotClient();
        if (guildId && botClient) {
            const adminMention = actorUserId ? `<@${actorUserId}>` : 'administratora';
            void closeOrderTicketProgrammatic({
                client: botClient,
                guildId,
                orderId,
                notificationMessage: `@here Zamówienie **#${orderId}** zostało zrealizowane przez ${adminMention}. Ticket zostanie zamknięty za 60 sekund...`,
                closedByUserId: actorUserId ?? 'dashboard',
                closedByTag: actorUserId ?? 'dashboard',
                closeReason: `Zamówienie #${orderId} zostało zrealizowane.`,
            }).catch((ticketError) => {
                shopApiLogger.warn('SHOP_ORDER_TICKET_COMPLETE_NOTIFY_FAILED', 'Nie udało się powiadomić ticketu o realizacji zamówienia.', { orderId }, ticketError);
            });
        }

        res.json({ success: true, data: order });
    } catch (error) {
        shopApiLogger.error('SHOP_ORDER_COMPLETE_ERROR', 'Błąd podczas realizacji zamówienia.', {
            orderId,
            actorUserId,
        }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

// POST /api/shop/orders/:id/cancel
shopApiRouter.post('/orders/:id/cancel', requireAuth, requireShopAdminRole, async (req, res) => {
    const orderId = Number.parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isFinite(orderId)) {
        res.status(400).json({ success: false, error: 'Nieprawidłowe ID zamówienia.' });
        return;
    }

    const parsed = shopOrderCancelSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ success: false, error: zodErrorToMessage(parsed.error) });
        return;
    }

    const actorUserId = req.session.user?.id;
    if (!actorUserId) {
        res.status(401).json({ success: false, error: 'Brak autoryzacji.' });
        return;
    }

    try {
        const { order, refunded } = await cancelOrder({
            orderId,
            cancelledByUserId: actorUserId,
            cancelReason: parsed.data.reason,
        });

        if (!order) {
            res.status(404).json({ success: false, error: 'Zamówienie nie istnieje lub nie jest w stanie oczekującym.' });
            return;
        }

        shopApiLogger.info('SHOP_ORDER_CANCELLED', 'Anulowano zamówienie.', {
            orderId,
            userId: order.userId,
            refunded,
            actorUserId,
        });

        void sendCancellationDm(order.userId, order.id, actorUserId, parsed.data.reason).catch((dmError) => {
            shopApiLogger.warn('SHOP_ORDER_CANCEL_DM_FAILED', 'Nie udało się wysłać DM o anulowaniu zamówienia.', {
                orderId,
                userId: order.userId,
            }, dmError);
        });

        const guildId = process.env.GUILD_ID;
        const botClient = getBotClient();
        if (guildId && botClient) {
            void closeOrderTicketProgrammatic({
                client: botClient,
                guildId,
                orderId,
                notificationMessage: `@here Zamówienie **#${orderId}** zostało anulowane przez <@${actorUserId}>. Ticket zostanie zamknięty za 60 sekund...`,
                closedByUserId: actorUserId,
                closedByTag: actorUserId,
                closeReason: `Zamówienie #${orderId} anulowane: ${parsed.data.reason}`,
            }).catch((ticketError) => {
                shopApiLogger.warn('SHOP_ORDER_TICKET_CANCEL_NOTIFY_FAILED', 'Nie udało się powiadomić ticketu o anulowaniu zamówienia.', { orderId }, ticketError);
            });
        }

        res.json({ success: true, data: { order, refunded } });
    } catch (error) {
        shopApiLogger.error('SHOP_ORDER_CANCEL_ERROR', 'Błąd podczas anulowania zamówienia.', {
            orderId,
            actorUserId,
        }, error);
        res.status(500).json({ success: false, error: 'Błąd serwera.' });
    }
});

function resolveStatusFilter(value: unknown): 'pending' | 'completed' | 'cancelled' | 'all' {
    if (value === 'pending' || value === 'completed' || value === 'cancelled') return value;
    return 'all';
}

function resolveUserIdFilter(value: unknown): string | undefined {
    if (typeof value === 'string' && /^\d{17,20}$/.test(value.trim())) {
        return value.trim();
    }
    return undefined;
}

async function sendCompletionDm(userId: string, orderId: number): Promise<void> {
    const content = `✅ Twoje zamówienie **#${orderId}** zostało zrealizowane.`;
    await sendDirectMessage(userId, content);
}

async function resolveG2HussarsEmoji(): Promise<string> {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return '⚔️';

    try {
        const emojis = await getGuildEmojis(guildId);
        const emoji = emojis.find(
            (e) => e.name === 'G2Hussars' || e.name === 'g2hussars' || e.name === 'G2_Hussars'
        );
        if (!emoji) return '⚔️';
        return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
    } catch {
        return '⚔️';
    }
}

async function sendCancellationDm(
    userId: string,
    orderId: number,
    cancelledByUserId: string,
    reason: string,
): Promise<void> {
    const g2Emoji = await resolveG2HussarsEmoji();
    const content = `${g2Emoji} Twoje zamówienie o numerze **#${orderId}** zostało anulowane przez <@${cancelledByUserId}> z powodu: ${reason}`;
    await sendDirectMessage(userId, content);
}
