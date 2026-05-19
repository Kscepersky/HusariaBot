import { getEconomyDatabase } from '../economy/database.js';
import type {
    ShopItem,
    ShopItemCreateInput,
    ShopItemUpdateInput,
    ShopItemsPage,
    ShopOrder,
    ShopOrderCancelInput,
    ShopOrderCreateInput,
    ShopOrderStatus,
    ShopOrdersPage,
    ShopOrdersQuery,
    ShopPurchaseOutcome,
} from './types.js';

interface ShopItemRow {
    id: number;
    name: string;
    description: string;
    price: number;
    stock: number;
    max_per_user: number;
    is_active: number;
    created_at: number;
    updated_at: number;
}

interface ShopOrderRow {
    id: number;
    guild_id: string;
    user_id: string;
    item_id: number;
    item_name_snapshot: string;
    item_price_snapshot: number;
    status: ShopOrderStatus;
    cancelled_by_user_id: string | null;
    cancel_reason: string | null;
    created_at: number;
    updated_at: number;
}

function mapItemRow(row: ShopItemRow): ShopItem {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        stock: row.stock,
        maxPerUser: row.max_per_user,
        isActive: row.is_active === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapOrderRow(row: ShopOrderRow): ShopOrder {
    return {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        itemId: row.item_id,
        itemNameSnapshot: row.item_name_snapshot,
        itemPriceSnapshot: row.item_price_snapshot,
        status: row.status,
        cancelledByUserId: row.cancelled_by_user_id,
        cancelReason: row.cancel_reason,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export async function getShopItems(includeInactive = false): Promise<ShopItem[]> {
    const db = await getEconomyDatabase();
    const rows = includeInactive
        ? await db.all<ShopItemRow[]>('SELECT * FROM shop_items ORDER BY id ASC')
        : await db.all<ShopItemRow[]>('SELECT * FROM shop_items WHERE is_active = 1 ORDER BY id ASC');
    return rows.map(mapItemRow);
}

export async function getShopItemById(id: number): Promise<ShopItem | null> {
    const db = await getEconomyDatabase();
    const row = await db.get<ShopItemRow>('SELECT * FROM shop_items WHERE id = ?', id);
    return row ? mapItemRow(row) : null;
}

export async function getShopItemsPage(page: number, pageSize: number, includeInactive = false): Promise<ShopItemsPage> {
    const db = await getEconomyDatabase();
    const offset = (page - 1) * pageSize;

    const whereClause = includeInactive ? '' : 'WHERE is_active = 1';

    const countRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM shop_items ${whereClause}`
    );
    const total = countRow?.total ?? 0;

    const rows = await db.all<ShopItemRow[]>(
        `SELECT * FROM shop_items ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`,
        pageSize,
        offset
    );

    return {
        items: rows.map(mapItemRow),
        total,
        page,
        pageSize,
    };
}

export async function createShopItem(input: ShopItemCreateInput): Promise<ShopItem> {
    const db = await getEconomyDatabase();
    const now = Date.now();

    const result = await db.run(
        `INSERT INTO shop_items (name, description, price, stock, max_per_user, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.name,
        input.description,
        input.price,
        input.stock,
        input.maxPerUser,
        input.isActive ? 1 : 0,
        now,
        now
    );

    const row = await db.get<ShopItemRow>('SELECT * FROM shop_items WHERE id = ?', result.lastID);
    if (!row) throw new Error('Failed to retrieve created shop item');
    return mapItemRow(row);
}

export async function updateShopItem(id: number, input: ShopItemUpdateInput): Promise<ShopItem | null> {
    const db = await getEconomyDatabase();
    const now = Date.now();

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) { setClauses.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { setClauses.push('description = ?'); values.push(input.description); }
    if (input.price !== undefined) { setClauses.push('price = ?'); values.push(input.price); }
    if (input.stock !== undefined) { setClauses.push('stock = ?'); values.push(input.stock); }
    if (input.maxPerUser !== undefined) { setClauses.push('max_per_user = ?'); values.push(input.maxPerUser); }
    if (input.isActive !== undefined) { setClauses.push('is_active = ?'); values.push(input.isActive ? 1 : 0); }

    if (setClauses.length === 0) return getShopItemById(id);

    setClauses.push('updated_at = ?');
    values.push(now);
    values.push(id);

    await db.run(
        `UPDATE shop_items SET ${setClauses.join(', ')} WHERE id = ?`,
        ...values
    );

    return getShopItemById(id);
}

export async function deleteShopItem(id: number): Promise<{ deleted: boolean; blockedByActiveOrders: boolean }> {
    const db = await getEconomyDatabase();

    const activeOrderCount = await db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM shop_orders WHERE item_id = ? AND status = 'pending'`,
        id
    );

    if ((activeOrderCount?.count ?? 0) > 0) {
        return { deleted: false, blockedByActiveOrders: true };
    }

    const result = await db.run('DELETE FROM shop_items WHERE id = ?', id);
    const deleted = (result.changes ?? 0) > 0;

    if (deleted) {
        const countRow = await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM shop_items');
        if ((countRow?.total ?? 0) === 0) {
            await db.run("DELETE FROM sqlite_sequence WHERE name = 'shop_items'");
        }
    }

    return { deleted, blockedByActiveOrders: false };
}

export async function purchaseShopItem(input: ShopOrderCreateInput): Promise<ShopPurchaseOutcome> {
    const db = await getEconomyDatabase();
    const now = Date.now();

    return db.run('BEGIN IMMEDIATE').then(async () => {
        try {
            const itemRow = await db.get<ShopItemRow>(
                'SELECT * FROM shop_items WHERE id = ?',
                input.itemId
            );

            if (!itemRow) {
                await db.run('ROLLBACK');
                return { success: false, reason: 'item_not_found' } as const;
            }

            if (itemRow.is_active === 0) {
                await db.run('ROLLBACK');
                return { success: false, reason: 'item_inactive' } as const;
            }

            // stock=0 means unlimited supply; stock>0 means limited supply

            if (itemRow.max_per_user > 0) {
                const userOrderCount = await db.get<{ count: number }>(
                    `SELECT COUNT(*) AS count FROM shop_orders
                     WHERE guild_id = ? AND user_id = ? AND item_id = ?
                       AND status IN ('pending', 'completed')`,
                    input.guildId,
                    input.userId,
                    input.itemId
                );
                if ((userOrderCount?.count ?? 0) >= itemRow.max_per_user) {
                    await db.run('ROLLBACK');
                    return { success: false, reason: 'limit_reached' } as const;
                }
            }

            const userRow = await db.get<{ coins: number }>(
                'SELECT coins FROM economy_users WHERE guild_id = ? AND user_id = ?',
                input.guildId,
                input.userId
            );

            const currentCoins = userRow?.coins ?? 0;
            if (currentCoins < itemRow.price) {
                await db.run('ROLLBACK');
                return { success: false, reason: 'insufficient_funds' } as const;
            }

            await db.run(
                'UPDATE economy_users SET coins = coins - ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
                itemRow.price,
                now,
                input.guildId,
                input.userId
            );

            if (itemRow.stock > 0) {
                // Limited supply: decrement. When last unit sells, auto-deactivate so
                // stock=0 is not mistaken for "unlimited" until admin restocks.
                await db.run(
                    `UPDATE shop_items SET
                         stock = stock - 1,
                         is_active = CASE WHEN stock = 1 THEN 0 ELSE is_active END,
                         updated_at = ?
                     WHERE id = ?`,
                    now,
                    input.itemId
                );
            }
            // stock=0 (unlimited): no decrement needed

            const insertResult = await db.run(
                `INSERT INTO shop_orders
                     (guild_id, user_id, item_id, item_name_snapshot, item_price_snapshot,
                      status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
                input.guildId,
                input.userId,
                input.itemId,
                itemRow.name,
                itemRow.price,
                now,
                now
            );

            await db.run('COMMIT');

            const orderRow = await db.get<ShopOrderRow>(
                'SELECT * FROM shop_orders WHERE id = ?',
                insertResult.lastID
            );

            if (!orderRow) throw new Error('Failed to retrieve created order');

            return {
                success: true,
                order: mapOrderRow(orderRow),
                newBalance: currentCoins - itemRow.price,
            } as const;
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    });
}

export async function getOrderById(id: number): Promise<ShopOrder | null> {
    const db = await getEconomyDatabase();
    const row = await db.get<ShopOrderRow>('SELECT * FROM shop_orders WHERE id = ?', id);
    return row ? mapOrderRow(row) : null;
}

export async function getOrdersByUser(guildId: string, userId: string, page: number, pageSize: number): Promise<ShopOrdersPage> {
    const db = await getEconomyDatabase();
    const offset = (page - 1) * pageSize;

    const countRow = await db.get<{ total: number }>(
        'SELECT COUNT(*) AS total FROM shop_orders WHERE guild_id = ? AND user_id = ?',
        guildId,
        userId
    );
    const total = countRow?.total ?? 0;

    const rows = await db.all<ShopOrderRow[]>(
        `SELECT * FROM shop_orders WHERE guild_id = ? AND user_id = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        guildId,
        userId,
        pageSize,
        offset
    );

    return {
        orders: rows.map(mapOrderRow),
        total,
        page,
        pageSize,
    };
}

export async function getOrdersPage(query: ShopOrdersQuery): Promise<ShopOrdersPage> {
    const db = await getEconomyDatabase();
    const { guildId, status, userId, page, pageSize } = query;
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['guild_id = ?'];
    const params: unknown[] = [guildId];

    if (status && status !== 'all') {
        conditions.push('status = ?');
        params.push(status);
    }

    if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = await db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM shop_orders ${whereClause}`,
        ...params
    );
    const total = countRow?.total ?? 0;

    const rows = await db.all<ShopOrderRow[]>(
        `SELECT * FROM shop_orders ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        ...params,
        pageSize,
        offset
    );

    return {
        orders: rows.map(mapOrderRow),
        total,
        page,
        pageSize,
    };
}

export async function completeOrder(orderId: number): Promise<ShopOrder | null> {
    const db = await getEconomyDatabase();
    const now = Date.now();

    await db.run(
        `UPDATE shop_orders SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'pending'`,
        now,
        orderId
    );

    return getOrderById(orderId);
}

export async function cancelOrder(input: ShopOrderCancelInput): Promise<{ order: ShopOrder | null; refunded: number }> {
    const db = await getEconomyDatabase();
    const now = Date.now();

    return db.run('BEGIN IMMEDIATE').then(async () => {
        try {
            const orderRow = await db.get<ShopOrderRow>(
                `SELECT * FROM shop_orders WHERE id = ? AND status = 'pending'`,
                input.orderId
            );

            if (!orderRow) {
                await db.run('ROLLBACK');
                return { order: null, refunded: 0 };
            }

            await db.run(
                `UPDATE shop_orders
                 SET status = 'cancelled', cancelled_by_user_id = ?, cancel_reason = ?, updated_at = ?
                 WHERE id = ?`,
                input.cancelledByUserId,
                input.cancelReason,
                now,
                input.orderId
            );

            await db.run(
                `UPDATE economy_users SET coins = coins + ?, updated_at = ?
                 WHERE guild_id = ? AND user_id = ?`,
                orderRow.item_price_snapshot,
                now,
                orderRow.guild_id,
                orderRow.user_id
            );

            // Restore 1 unit only for non-unlimited items (stock=0 + is_active=true means unlimited).
            // Also reactivate if the item was auto-deactivated when the last unit sold.
            await db.run(
                `UPDATE shop_items SET
                     stock = CASE WHEN stock = 0 AND is_active = 1 THEN 0 ELSE stock + 1 END,
                     is_active = 1,
                     updated_at = ?
                 WHERE id = ?`,
                now,
                orderRow.item_id
            );

            await db.run('COMMIT');

            const updatedOrder = await getOrderById(input.orderId);
            return { order: updatedOrder, refunded: orderRow.item_price_snapshot };
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    });
}
