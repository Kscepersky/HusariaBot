export type ShopOrderStatus = 'pending' | 'completed' | 'cancelled';

export interface ShopItem {
    id: number;
    name: string;
    description: string;
    price: number;
    stock: number;
    maxPerUser: number;
    isActive: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface ShopOrder {
    id: number;
    guildId: string;
    userId: string;
    itemId: number;
    itemNameSnapshot: string;
    itemPriceSnapshot: number;
    status: ShopOrderStatus;
    cancelledByUserId: string | null;
    cancelReason: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface ShopItemCreateInput {
    name: string;
    description: string;
    price: number;
    stock: number;
    maxPerUser: number;
    isActive: boolean;
}

export interface ShopItemUpdateInput {
    name?: string;
    description?: string;
    price?: number;
    stock?: number;
    maxPerUser?: number;
    isActive?: boolean;
}

export interface ShopOrderCreateInput {
    guildId: string;
    userId: string;
    itemId: number;
}

export interface ShopOrderCancelInput {
    orderId: number;
    cancelledByUserId: string;
    cancelReason: string;
}

export interface ShopItemsPage {
    items: ShopItem[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ShopOrdersPage {
    orders: ShopOrder[];
    total: number;
    page: number;
    pageSize: number;
}

export type ShopOrderStatusFilter = ShopOrderStatus | 'all';

export interface ShopOrdersQuery {
    guildId: string;
    status?: ShopOrderStatusFilter;
    userId?: string;
    page: number;
    pageSize: number;
}

export interface ShopPurchaseResult {
    success: true;
    order: ShopOrder;
    newBalance: number;
}

export interface ShopPurchaseError {
    success: false;
    reason: 'insufficient_funds' | 'item_not_found' | 'item_inactive' | 'limit_reached';
}

export type ShopPurchaseOutcome = ShopPurchaseResult | ShopPurchaseError;
