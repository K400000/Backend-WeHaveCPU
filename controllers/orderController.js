import database from '../config/db.js';
import * as orderService from '../services/orderService.js';

/**
 * 1. ประวัติคำสั่งซื้อทั้งหมดของผู้ใช้ (ไม่รวมสถานะ 'cart')
 */
export async function getMyOrders(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        try {
            await orderService.expirePendingOrders();
        } catch (e) {
            // ignore
        }

        const strQry = `
            SELECT 
                o."orderId",
                o."orderNo",
                o."status",
                o."totalQty",
                o."totalAmount",
                o."recipientName",
                o."recipientPhone",
                o."shippingAddress",
                o."confirmedAt",
                o."paidAt",
                o."expiresAt",
                o."cancelledAt",
                o."cancelReason",
                o."createdAt",
                s."status" AS "shipmentStatus",
                s."courier",
                s."trackingNo",
                (
                    SELECT COALESCE(json_agg(item_obj), '[]'::json)
                    FROM (
                        SELECT 
                            oi."orderItemId",
                            oi."productId",
                            oi."productSku",
                            oi."productName",
                            oi."unitPrice",
                            oi."quantity",
                            oi."subtotal",
                            (
                                SELECT "imageUrl"
                                FROM "productImages"
                                WHERE "productId" = oi."productId" AND "isPrimary" = true
                                LIMIT 1
                            ) AS "imageUrl"
                        FROM "orderItems" oi
                        WHERE oi."orderId" = o."orderId"
                    ) AS item_obj
                ) AS "items"
            FROM "orders" o
            LEFT JOIN "shipments" s ON o."orderId" = s."orderId"
            WHERE o."userId" = $1 AND o."status" != 'cart'
            ORDER BY o."createdAt" DESC;
        `;

        const result = await database.query(strQry, [userId]);
        return res.status(200).json(result.rows);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

/**
 * 2. รายละเอียดคำสั่งซื้อ + รายการสินค้า + ข้อมูลพัสดุ + ไทม์ไลน์พัสดุ
 */
export async function getOrderById(req, res) {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;
        const isAdmin = req.user?.role === 'admin';

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        try {
            await orderService.expirePendingOrders();
        } catch (e) {
            // ignore
        }

        const strQry = `
            SELECT 
                o."orderId",
                o."orderNo",
                o."userId",
                o."status",
                o."totalQty",
                o."totalAmount",
                o."recipientName",
                o."recipientPhone",
                o."shippingAddress",
                o."note",
                o."confirmedAt",
                o."paidAt",
                o."expiresAt",
                o."cancelledAt",
                o."cancelReason",
                o."createdAt",
                o."updatedAt",

                -- รายการสินค้าในบิลพร้อมรูปหลัก
                (
                    SELECT COALESCE(json_agg(item_obj), '[]'::json)
                    FROM (
                        SELECT 
                            oi."orderItemId",
                            oi."productId",
                            oi."productSku",
                            oi."productName",
                            oi."unitPrice",
                            oi."quantity",
                            oi."subtotal",
                            (
                                SELECT "imageUrl"
                                FROM "productImages"
                                WHERE "productId" = oi."productId" AND "isPrimary" = true
                                LIMIT 1
                            ) AS "imageUrl"
                        FROM "orderItems" oi
                        WHERE oi."orderId" = o."orderId"
                        ORDER BY oi."orderItemId" ASC
                    ) AS item_obj
                ) AS "items",

                -- ข้อมูลพัสดุและไทม์ไลน์ติดตามพัสดุ
                (
                    SELECT row_to_json(shipment_obj)
                    FROM (
                        SELECT 
                            s."shipmentId",
                            s."status",
                            s."courier",
                            s."trackingNo",
                            s."shippedAt",
                            s."deliveredAt",
                            (
                                SELECT COALESCE(json_agg(event_obj), '[]'::json)
                                FROM (
                                    SELECT 
                                        se."eventId",
                                        se."status",
                                        se."note",
                                        se."createdAt"
                                    FROM "shipmentEvents" se
                                    WHERE se."shipmentId" = s."shipmentId"
                                    ORDER BY se."createdAt" ASC
                                ) AS event_obj
                            ) AS "events"
                        FROM "shipments" s
                        WHERE s."orderId" = o."orderId"
                    ) AS shipment_obj
                ) AS "shipment"

            FROM "orders" o
            WHERE o."orderId" = $1 ${!isAdmin ? 'AND o."userId" = $2' : ''}
            LIMIT 1;
        `;

        const queryParams = isAdmin ? [orderId] : [orderId, userId];
        const result = await database.query(strQry, queryParams);
        const order = result.rows[0];

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        return res.status(200).json(order);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

/**
 * 3. ติดตามสถานะและไทม์ไลน์พัสดุ (Tracking & Events Timeline)
 */
export async function getOrderTracking(req, res) {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;
        const isAdmin = req.user?.role === 'admin';

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        // ตรวจสอบสิทธิ์ว่ามีบิลนี้และเป็นเจ้าของจริง (หรือเป็น Admin)
        const checkQry = `
            SELECT "orderId", "orderNo", "status"
            FROM "orders"
            WHERE "orderId" = $1 ${!isAdmin ? 'AND "userId" = $2' : ''}
            LIMIT 1;
        `;
        const checkParams = isAdmin ? [orderId] : [orderId, userId];
        const checkRes = await database.query(checkQry, checkParams);

        if (checkRes.rows.length === 0) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const order = checkRes.rows[0];

        // ดึงข้อมูลการจัดส่งและไทม์ไลน์เหตุการณ์ (timeline และ events)
        const strQry = `
            SELECT 
                s."shipmentId",
                s."orderId",
                o."orderNo",
                s."status" AS "shipmentStatus",
                o."status" AS "orderStatus",
                s."courier",
                s."trackingNo",
                s."shippedAt",
                s."deliveredAt",
                (
                    SELECT COALESCE(json_agg(event_obj), '[]'::json)
                    FROM (
                        SELECT 
                            se."eventId",
                            se."status",
                            se."note",
                            se."createdAt"
                        FROM "shipmentEvents" se
                        WHERE se."shipmentId" = s."shipmentId"
                        ORDER BY se."createdAt" ASC
                    ) AS event_obj
                ) AS "timeline",
                (
                    SELECT COALESCE(json_agg(event_obj), '[]'::json)
                    FROM (
                        SELECT 
                            se."eventId",
                            se."status",
                            se."note",
                            se."createdAt"
                        FROM "shipmentEvents" se
                        WHERE se."shipmentId" = s."shipmentId"
                        ORDER BY se."createdAt" ASC
                    ) AS event_obj
                ) AS "events"
            FROM "shipments" s
            JOIN "orders" o ON s."orderId" = o."orderId"
            WHERE s."orderId" = $1
            LIMIT 1;
        `;

        const result = await database.query(strQry, [orderId]);
        const tracking = result.rows[0];

        if (!tracking) {
            return res.status(200).json({
                orderId: order.orderId,
                orderNo: order.orderNo,
                orderStatus: order.status,
                shipmentStatus: 'preparing',
                courier: null,
                trackingNo: null,
                timeline: [],
                events: []
            });
        }

        return res.status(200).json(tracking);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}


/**
 * Handle checkout: convert cart to pending order, deduct stock, generate orderNo
 */
export async function checkoutOrder(req, res) {
    try {
        const userId = req.user?.userId;
        const { recipientName, recipientPhone, shippingAddress, note } = req.body;

        if (!recipientName || !recipientPhone || !shippingAddress) {
            return res.status(400).json({
                message: 'recipientName, recipientPhone, and shippingAddress are required'
            });
        }

        const result = await orderService.checkout(userId, {
            recipientName: recipientName.trim(),
            recipientPhone: recipientPhone.trim(),
            shippingAddress: shippingAddress.trim(),
            note: note ? note.trim() : null
        });

        return res.status(201).json({
            message: 'Checkout successful. Order is pending payment.',
            order: result.order,
            items: result.items
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * Handle mock payment: advance order from pending to paid
 */
export async function payMockOrder(req, res) {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const updatedOrder = await orderService.payOrder(parseInt(orderId, 10), userId);

        return res.status(200).json({
            message: 'Payment completed successfully (Mock).',
            order: updatedOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * Cancel unpaid pending order (User or Admin)
 */
export async function cancelMyOrder(req, res) {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;
        const isAdmin = req.user?.role === 'admin';

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const cancelledOrder = await orderService.cancelOrder(
            parseInt(orderId, 10),
            userId,
            isAdmin ? 'admin' : 'customer',
            isAdmin
        );

        return res.status(200).json({
            message: 'Order cancelled successfully and stock refunded.',
            order: cancelledOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseOrderId(value) {
    return /^\d+$/.test(value) ? parseInt(value, 10) : null;
}

/**
 * [Admin] รายการคำสั่งซื้อทั้งหมด (ไม่รวม 'cart') + กรองช่วงวันที่ + แบ่งหน้า
 */
export async function adminGetOrders(req, res) {
    try {
        const { dateFrom, dateTo } = req.query;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

        if ((dateFrom && !DATE_REGEX.test(dateFrom)) || (dateTo && !DATE_REGEX.test(dateTo))) {
            return res.status(400).json({ message: 'dateFrom and dateTo must be in YYYY-MM-DD format' });
        }

        if (dateFrom && dateTo && dateFrom > dateTo) {
            return res.status(400).json({ message: 'dateFrom cannot be after dateTo' });
        }

        if (page < 1 || limit < 1) {
            return res.status(400).json({ message: 'page and limit must be positive integers' });
        }

        const result = await orderService.adminListOrders({
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            page,
            limit
        });

        return res.status(200).json(result);
    } catch (err) {
        // วันที่ที่ format ถูกแต่ไม่มีจริง (เช่น 2026-02-31) -> PG error 22008
        if (err.code === '22008') {
            return res.status(400).json({ message: 'Invalid date' });
        }
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * [Admin] รายละเอียดคำสั่งซื้อ (ลูกค้า, สินค้า, พัสดุ+ไทม์ไลน์, ประวัติสถานะ)
 */
export async function adminGetOrderById(req, res) {
    try {
        const orderId = parseOrderId(req.params.orderId);
        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const order = await orderService.adminGetOrderDetail(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        return res.status(200).json(order);
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * [Admin] ยกเลิกบิลที่ยังไม่จ่าย (pending) + คืน stock, cancelReason = 'admin'
 */
export async function adminCancelOrder(req, res) {
    try {
        const orderId = parseOrderId(req.params.orderId);
        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const cancelledOrder = await orderService.cancelOrder(orderId, req.user.userId, 'admin', true);

        return res.status(200).json({
            message: 'Order cancelled successfully and stock refunded.',
            order: cancelledOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * [Admin] เลื่อนสถานะพัสดุทีละขั้น (กรอกขนส่ง + เลขพัสดุตอน shipped)
 */
export async function adminAdvanceShipment(req, res) {
    try {
        const orderId = parseOrderId(req.params.orderId);
        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const { status, courier, trackingNo, note } = req.body;

        const result = await orderService.advanceShipment(orderId, req.user.userId, {
            status,
            courier,
            trackingNo,
            note
        });

        return res.status(200).json({
            message: `Shipment advanced to "${result.shipment.status}"`,
            ...result
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}

/**
 * Update order status (Admin)
 */
export async function updateStatus(req, res) {
    try {
        const { orderId } = req.params;
        const { status, note } = req.body;
        const userId = req.user?.userId;

        if (req.user?.role !== 'admin') {
            return res.status(403).json({ message: 'Forbidden. Admin privileges required.' });
        }

        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        const updatedOrder = await orderService.updateOrderStatus(
            parseInt(orderId, 10),
            status,
            userId,
            note
        );

        return res.status(200).json({
            message: 'Order status updated successfully',
            order: updatedOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
}
