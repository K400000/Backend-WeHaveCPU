import pool from '../config/db.js';

/**
 * Execute next_order_no() or fallback to atomic orderCounters query
 */
export const getNextOrderNo = async (client) => {
    try {
        const fnCheck = await client.query("SELECT 1 FROM pg_proc WHERE proname = 'next_order_no'");
        if (fnCheck.rows.length > 0) {
            const res = await client.query('SELECT next_order_no() AS "orderNo"');
            if (res.rows[0]?.orderNo) return res.rows[0].orderNo;
        }
    } catch {
        // Fallback if execution fails
    }

    // Atomic order counter increment using Asia/Bangkok date
    const todayRes = await client.query("SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') AS today");
    const today = todayRes.rows[0].today;
    const counterRes = await client.query(
        `
        INSERT INTO "orderCounters" ("orderDate", "lastSeq")
        VALUES ($1::date, 1)
        ON CONFLICT ("orderDate")
        DO UPDATE SET "lastSeq" = "orderCounters"."lastSeq" + 1
        RETURNING "lastSeq";
        `,
        [today]
    );
    const seq = String(counterRes.rows[0].lastSeq).padStart(4, '0');
    return `${today}${seq}`;
};

/**
 * Checkout process in atomic transaction
 * Validates cart, locks products, deducts stock, sets expiresAt (24h), logs status
 */
export const checkout = async (userId, shippingData) => {
    const { recipientName, recipientPhone, shippingAddress, note } = shippingData;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Lock and find active cart order
        const cartRes = await client.query(
            `
            SELECT "orderId", "totalQty", "totalAmount"
            FROM "orders"
            WHERE "userId" = $1 AND "status" = 'cart'
            FOR UPDATE;
            `,
            [userId]
        );

        const cart = cartRes.rows[0];
        if (!cart) {
            throw { status: 404, message: 'Cart not found or already checked out' };
        }

        // 2. Lock and retrieve order items with product details
        const itemsRes = await client.query(
            `
            SELECT 
                oi."orderItemId",
                oi."productId",
                oi."quantity",
                oi."unitPrice",
                oi."subtotal",
                p."name" AS "productName",
                p."stock",
                p."isActive",
                p."deletedAt"
            FROM "orderItems" oi
            JOIN "products" p ON oi."productId" = p."productId"
            WHERE oi."orderId" = $1
            FOR UPDATE OF p;
            `,
            [cart.orderId]
        );

        const items = itemsRes.rows;
        if (items.length === 0) {
            throw { status: 400, message: 'Cannot checkout an empty cart' };
        }

        // 3. Validate product availability and stock
        for (const item of items) {
            if (item.deletedAt || !item.isActive) {
                throw {
                    status: 400,
                    message: `Product "${item.productName}" is no longer available`
                };
            }
            if (item.stock < item.quantity) {
                throw {
                    status: 400,
                    message: `Insufficient stock for "${item.productName}". Available: ${item.stock}, requested: ${item.quantity}`
                };
            }
        }

        // 4. Deduct stock for each product
        for (const item of items) {
            await client.query(
                `
                UPDATE "products"
                SET "stock" = "stock" - $1,
                    "updatedAt" = NOW()
                WHERE "productId" = $2;
                `,
                [item.quantity, item.productId]
            );
        }

        // 5. Generate official orderNo
        const orderNo = await getNextOrderNo(client);

        // 6. Transition order from cart to pending
        const updateOrderRes = await client.query(
            `
            UPDATE "orders"
            SET "orderNo" = $1,
                "status" = 'pending',
                "recipientName" = $2,
                "recipientPhone" = $3,
                "shippingAddress" = $4,
                "note" = $5,
                "confirmedAt" = NOW(),
                "expiresAt" = NOW() + INTERVAL '24 hours',
                "updatedAt" = NOW()
            WHERE "orderId" = $6
            RETURNING *;
            `,
            [orderNo, recipientName, recipientPhone, shippingAddress, note || null, cart.orderId]
        );

        // 7. Log order status transition
        await client.query(
            `
            INSERT INTO "orderStatusLogs" ("orderId", "oldStatus", "newStatus", "changedBy", "changedAt")
            VALUES ($1, 'cart', 'pending', $2, NOW());
            `,
            [cart.orderId, userId]
        );

        await client.query('COMMIT');
        return {
            order: updateOrderRes.rows[0],
            items
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Mock payment process
 * Changes status to paid, logs status, creates shipment record
 */
export const payOrder = async (orderId, userId) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Lock and fetch order
        const orderRes = await client.query(
            `
            SELECT *
            FROM "orders"
            WHERE "orderId" = $1 AND "userId" = $2
            FOR UPDATE;
            `,
            [orderId, userId]
        );

        const order = orderRes.rows[0];
        if (!order) {
            throw { status: 404, message: 'Order not found' };
        }

        if (order.status !== 'pending') {
            throw {
                status: 400,
                message: `Order cannot be paid. Current status: ${order.status}`
            };
        }

        if (order.expiresAt && new Date() > new Date(order.expiresAt)) {
            throw {
                status: 400,
                message: 'Order payment deadline has expired (24 hours exceeded)'
            };
        }

        // 2. Update order to paid
        const updateOrderRes = await client.query(
            `
            UPDATE "orders"
            SET "status" = 'paid',
                "paidAt" = NOW(),
                "updatedAt" = NOW()
            WHERE "orderId" = $1
            RETURNING *;
            `,
            [orderId]
        );

        // 3. Log order status transition
        await client.query(
            `
            INSERT INTO "orderStatusLogs" ("orderId", "oldStatus", "newStatus", "changedBy", "changedAt")
            VALUES ($1, 'pending', 'paid', $2, NOW());
            `,
            [orderId, userId]
        );

        // 4. Initialize shipment record (status: preparing)
        const shipmentRes = await client.query(
            `
            INSERT INTO "shipments" ("orderId", "status", "createdAt", "updatedAt")
            VALUES ($1, 'preparing', NOW(), NOW())
            ON CONFLICT ("orderId") DO UPDATE SET "updatedAt" = NOW()
            RETURNING "shipmentId";
            `,
            [orderId]
        );

        const shipmentId = shipmentRes.rows[0]?.shipmentId;
        if (shipmentId) {
            await client.query(
                `
                INSERT INTO "shipmentEvents" ("shipmentId", "status", "note", "changedBy", "createdAt")
                VALUES ($1, 'preparing', 'ชำระเงินเรียบร้อย รอร้านจัดเตรียมพัสดุ', $2, NOW());
                `,
                [shipmentId, userId]
            );
        }

        await client.query('COMMIT');
        return updateOrderRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Cancel unpaid pending order and refund stock atomically
 * Invokes cancel_order() stored function or pure transaction fallback
 */
export const cancelOrder = async (orderId, userId, reason = 'Customer cancelled', isAdmin = false) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check for cancel_order stored procedure/function
        const fnCheck = await client.query("SELECT 1 FROM pg_proc WHERE proname = 'cancel_order'");
        if (fnCheck.rows.length > 0) {
            try {
                await client.query('SELECT cancel_order($1, $2, $3)', [orderId, reason, userId]);
                const res = await client.query('SELECT * FROM "orders" WHERE "orderId" = $1', [orderId]);
                await client.query('COMMIT');
                return res.rows[0];
            } catch {
                // If stored proc signature differs, proceed with standard atomic query below
            }
        }

        // Standard transaction: check order status
        const orderQry = isAdmin
            ? 'SELECT * FROM "orders" WHERE "orderId" = $1 FOR UPDATE;'
            : 'SELECT * FROM "orders" WHERE "orderId" = $1 AND "userId" = $2 FOR UPDATE;';
        const orderParams = isAdmin ? [orderId] : [orderId, userId];

        const orderRes = await client.query(orderQry, orderParams);
        const order = orderRes.rows[0];

        if (!order) {
            throw { status: 404, message: 'Order not found' };
        }

        if (order.status !== 'pending') {
            throw {
                status: 400,
                message: `Only unpaid pending orders can be cancelled. Current status: ${order.status}`
            };
        }

        // Return stock back to products
        await client.query(
            `
            UPDATE "products" p
            SET "stock" = p."stock" + oi."quantity",
                "updatedAt" = NOW()
            FROM "orderItems" oi
            WHERE oi."orderId" = $1 AND p."productId" = oi."productId";
            `,
            [orderId]
        );

        // Update order status to cancelled
        const updateRes = await client.query(
            `
            UPDATE "orders"
            SET "status" = 'cancelled',
                "cancelledAt" = NOW(),
                "cancelReason" = $1,
                "updatedAt" = NOW()
            WHERE "orderId" = $2
            RETURNING *;
            `,
            [reason, orderId]
        );

        // Log order status transition
        await client.query(
            `
            INSERT INTO "orderStatusLogs" ("orderId", "oldStatus", "newStatus", "changedBy", "changedAt")
            VALUES ($1, 'pending', 'cancelled', $2, NOW());
            `,
            [orderId, userId]
        );

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Update order status (Admin / System order advancement)
 */
export const updateOrderStatus = async (orderId, newStatus, changedBy, note = null) => {
    const allowedTransitions = {
        cart: ['pending'],
        pending: ['paid', 'cancelled'],
        paid: ['shipped'],
        shipped: ['completed']
    };

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderRes = await client.query('SELECT * FROM "orders" WHERE "orderId" = $1 FOR UPDATE;', [orderId]);
        const order = orderRes.rows[0];
        if (!order) {
            throw { status: 404, message: 'Order not found' };
        }

        const validNext = allowedTransitions[order.status] || [];
        if (!validNext.includes(newStatus)) {
            throw {
                status: 400,
                message: `Invalid status transition from "${order.status}" to "${newStatus}"`
            };
        }

        // If transitioning to cancelled, refund stock
        if (newStatus === 'cancelled') {
            await client.query(
                `
                UPDATE "products" p
                SET "stock" = p."stock" + oi."quantity",
                    "updatedAt" = NOW()
                FROM "orderItems" oi
                WHERE oi."orderId" = $1 AND p."productId" = oi."productId";
                `,
                [orderId]
            );
        }

        const updateRes = await client.query(
            `
            UPDATE "orders"
            SET "status" = $1,
                "updatedAt" = NOW(),
                "cancelledAt" = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE "cancelledAt" END,
                "cancelReason" = CASE WHEN $1 = 'cancelled' THEN $2 ELSE "cancelReason" END
            WHERE "orderId" = $3
            RETURNING *;
            `,
            [newStatus, note || 'admin', orderId]
        );

        await client.query(
            `
            INSERT INTO "orderStatusLogs" ("orderId", "oldStatus", "newStatus", "changedBy", "changedAt")
            VALUES ($1, $2, $3, $4, NOW());
            `,
            [orderId, order.status, newStatus, changedBy]
        );

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Get orders list for a user (excluding 'cart')
 */
export const getUserOrders = async (userId) => {
    const query = `
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
            s."trackingNo"
        FROM "orders" o
        LEFT JOIN "shipments" s ON o."orderId" = s."orderId"
        WHERE o."userId" = $1 AND o."status" != 'cart'
        ORDER BY o."createdAt" DESC;
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
};

/**
 * Get detailed order information including items and tracking timeline
 */
export const getOrderDetails = async (orderId, userId, isAdmin = false) => {
    const orderQry = `
        SELECT 
            o.*,
            s."shipmentId",
            s."status" AS "shipmentStatus",
            s."courier",
            s."trackingNo",
            s."shippedAt",
            s."deliveredAt"
        FROM "orders" o
        LEFT JOIN "shipments" s ON o."orderId" = s."orderId"
        WHERE o."orderId" = $1 ${!isAdmin ? 'AND o."userId" = $2' : ''};
    `;
    const orderParams = isAdmin ? [orderId] : [orderId, userId];
    const orderRes = await pool.query(orderQry, orderParams);
    const order = orderRes.rows[0];

    if (!order) {
        throw { status: 404, message: 'Order not found' };
    }

    // Fetch items with primary images
    const itemsQry = `
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
        WHERE oi."orderId" = $1
        ORDER BY oi."orderItemId" ASC;
    `;
    const itemsRes = await pool.query(itemsQry, [orderId]);

    // Fetch shipment events timeline if shipment exists
    let events = [];
    if (order.shipmentId) {
        const eventsQry = `
            SELECT "eventId", "status", "note", "changedBy", "createdAt"
            FROM "shipmentEvents"
            WHERE "shipmentId" = $1
            ORDER BY "createdAt" ASC;
        `;
        const eventsRes = await pool.query(eventsQry, [order.shipmentId]);
        events = eventsRes.rows;
    }

    return {
        ...order,
        items: itemsRes.rows,
        events
    };
};

/**
 * [Admin] List all orders (excluding 'cart') with date range filter + pagination
 * dateFrom / dateTo are inclusive Thai-time dates (YYYY-MM-DD) matched on confirmedAt
 */
export const adminListOrders = async ({ dateFrom, dateTo, page, limit }) => {
    const query = `
        SELECT
            o."orderId",
            o."orderNo",
            o."userId",
            u."email",
            u."firstName",
            u."lastName",
            o."status",
            o."totalQty",
            o."totalAmount",
            o."recipientName",
            o."recipientPhone",
            o."confirmedAt",
            o."paidAt",
            o."expiresAt",
            o."cancelledAt",
            o."cancelReason",
            s."status" AS "shipmentStatus",
            s."courier",
            s."trackingNo",
            COUNT(*) OVER()::int AS "total"
        FROM "orders" o
        JOIN "users" u ON u."userId" = o."userId"
        LEFT JOIN "shipments" s ON s."orderId" = o."orderId"
        WHERE o."status" <> 'cart'
          AND ($1::date IS NULL OR o."confirmedAt" >= ($1::date)::timestamp AT TIME ZONE 'Asia/Bangkok')
          AND ($2::date IS NULL OR o."confirmedAt" < (($2::date) + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')
        ORDER BY o."confirmedAt" DESC, o."orderId" DESC
        LIMIT $3 OFFSET $4;
    `;
    const { rows } = await pool.query(query, [dateFrom, dateTo, limit, (page - 1) * limit]);
    const total = rows[0]?.total ?? 0;

    return {
        data: rows.map(({ total: _total, ...row }) => row),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
};

/**
 * [Admin] Order detail: customer, items, shipment + timeline, status history
 */
export const adminGetOrderDetail = async (orderId) => {
    const query = `
        SELECT
            o.*,
            json_build_object(
                'userId', u."userId",
                'email', u."email",
                'firstName', u."firstName",
                'lastName', u."lastName",
                'phone', u."phone"
            ) AS "user",
            (
                SELECT COALESCE(json_agg(item_obj), '[]'::json)
                FROM (
                    SELECT oi."orderItemId", oi."productId", oi."productSku", oi."productName",
                           oi."unitPrice", oi."quantity", oi."subtotal"
                    FROM "orderItems" oi
                    WHERE oi."orderId" = o."orderId"
                    ORDER BY oi."orderItemId" ASC
                ) AS item_obj
            ) AS "items",
            (
                SELECT row_to_json(shipment_obj)
                FROM (
                    SELECT s."shipmentId", s."status", s."courier", s."trackingNo",
                           s."shippedAt", s."deliveredAt",
                           (
                               SELECT COALESCE(json_agg(event_obj), '[]'::json)
                               FROM (
                                   SELECT se."eventId", se."status", se."note", se."changedBy", se."createdAt"
                                   FROM "shipmentEvents" se
                                   WHERE se."shipmentId" = s."shipmentId"
                                   ORDER BY se."createdAt" ASC, se."eventId" ASC
                               ) AS event_obj
                           ) AS "events"
                    FROM "shipments" s
                    WHERE s."orderId" = o."orderId"
                ) AS shipment_obj
            ) AS "shipment",
            (
                SELECT COALESCE(json_agg(log_obj), '[]'::json)
                FROM (
                    SELECT l."logId", l."oldStatus", l."newStatus", l."changedBy", l."changedAt"
                    FROM "orderStatusLogs" l
                    WHERE l."orderId" = o."orderId"
                    ORDER BY l."changedAt" ASC, l."logId" ASC
                ) AS log_obj
            ) AS "statusLogs"
        FROM "orders" o
        JOIN "users" u ON u."userId" = o."userId"
        WHERE o."orderId" = $1 AND o."status" <> 'cart';
    `;
    const { rows } = await pool.query(query, [orderId]);
    return rows[0] || null;
};

// null = ยังไม่มีแถว shipments, ลำดับเลื่อนทีละขั้น
const SHIPMENT_STEPS = [null, 'preparing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];

const SHIPMENT_NOTES = {
    preparing: 'ร้านกำลังจัดเตรียมพัสดุ',
    shipped: 'ส่งมอบพัสดุให้ขนส่งแล้ว',
    in_transit: 'พัสดุอยู่ระหว่างขนส่ง',
    out_for_delivery: 'พัสดุกำลังนำจ่าย',
    delivered: 'จัดส่งสำเร็จ'
};

/**
 * [Admin] Advance shipment exactly one step (atomic)
 * paid -> (create shipment) preparing -> shipped -> in_transit -> out_for_delivery -> delivered
 * shipped => order 'shipped' (requires courier + trackingNo), delivered => order 'completed'
 */
export const advanceShipment = async (orderId, adminId, { status, courier, trackingNo, note }) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const orderRes = await client.query('SELECT * FROM "orders" WHERE "orderId" = $1 FOR UPDATE;', [orderId]);
        const order = orderRes.rows[0];

        if (!order || order.status === 'cart') {
            throw { status: 404, message: 'Order not found' };
        }

        if (!['paid', 'shipped'].includes(order.status)) {
            throw {
                status: 400,
                message: `Shipment can only be advanced on paid/shipped orders. Current status: ${order.status}`
            };
        }

        const shipRes = await client.query('SELECT * FROM "shipments" WHERE "orderId" = $1 FOR UPDATE;', [orderId]);
        let shipment = shipRes.rows[0];

        const currentIdx = SHIPMENT_STEPS.indexOf(shipment ? shipment.status : null);
        const nextStatus = SHIPMENT_STEPS[currentIdx + 1];

        if (!nextStatus) {
            throw { status: 400, message: 'Shipment already delivered' };
        }

        if (status && status !== nextStatus) {
            throw {
                status: 400,
                message: `Shipment must advance one step at a time. Next status: "${nextStatus}"`
            };
        }

        const newCourier = courier?.trim() || shipment?.courier || null;
        const newTrackingNo = trackingNo?.trim() || shipment?.trackingNo || null;

        if (nextStatus === 'shipped' && (!newCourier || !newTrackingNo)) {
            throw { status: 400, message: 'Courier and trackingNo are required to mark as shipped' };
        }

        if (!shipment) {
            const created = await client.query(
                `
                INSERT INTO "shipments" ("orderId", "status", "courier", "trackingNo")
                VALUES ($1, 'preparing', $2, $3)
                RETURNING *;
                `,
                [orderId, newCourier, newTrackingNo]
            );
            shipment = created.rows[0];
        } else {
            const updated = await client.query(
                `
                UPDATE "shipments"
                SET "status" = $1,
                    "courier" = $2,
                    "trackingNo" = $3,
                    "shippedAt" = CASE WHEN $1 = 'shipped' THEN NOW() ELSE "shippedAt" END,
                    "deliveredAt" = CASE WHEN $1 = 'delivered' THEN NOW() ELSE "deliveredAt" END,
                    "updatedAt" = NOW()
                WHERE "shipmentId" = $4
                RETURNING *;
                `,
                [nextStatus, newCourier, newTrackingNo, shipment.shipmentId]
            );
            shipment = updated.rows[0];
        }

        await client.query(
            `
            INSERT INTO "shipmentEvents" ("shipmentId", "status", "note", "changedBy", "createdAt")
            VALUES ($1, $2, $3, $4, NOW());
            `,
            [shipment.shipmentId, nextStatus, note?.trim() || SHIPMENT_NOTES[nextStatus], adminId]
        );

        // shipped -> order shipped, delivered -> order completed
        const orderStatusByShipment = { shipped: 'shipped', delivered: 'completed' };
        const newOrderStatus = orderStatusByShipment[nextStatus];
        let updatedOrder = order;

        if (newOrderStatus) {
            // status <> $1 กันซ้ำ หาก DB trigger เปลี่ยนสถานะบิลให้แล้ว
            const orderUpdate = await client.query(
                `
                UPDATE "orders"
                SET "status" = $1, "updatedAt" = NOW()
                WHERE "orderId" = $2 AND "status" <> $1
                RETURNING *;
                `,
                [newOrderStatus, orderId]
            );

            if (orderUpdate.rows[0]) {
                updatedOrder = orderUpdate.rows[0];
                await client.query(
                    `
                    INSERT INTO "orderStatusLogs" ("orderId", "oldStatus", "newStatus", "changedBy", "changedAt")
                    VALUES ($1, $2, $3, $4, NOW());
                    `,
                    [orderId, order.status, newOrderStatus, adminId]
                );
            } else {
                const refreshed = await client.query('SELECT * FROM "orders" WHERE "orderId" = $1;', [orderId]);
                updatedOrder = refreshed.rows[0];
            }
        }

        await client.query('COMMIT');
        return { order: updatedOrder, shipment };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};
