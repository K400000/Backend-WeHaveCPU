import database from '../config/db.js';

// 1. ดูตะกร้าสินค้าของผู้ใช้
export async function getCart(req, res) {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        // ค้นหาบิลสถานะ cart ของ user
        const cartQry = `
            SELECT "orderId", "totalQty", "totalAmount"
            FROM "orders"
            WHERE "userId" = $1 AND "status" = 'cart'
            LIMIT 1;
        `;
        const cartResult = await database.query(cartQry, [userId]);
        const cart = cartResult.rows[0];

        if (!cart) {
            return res.status(200).json({
                orderId: null,
                items: [],
                totalQty: 0,
                totalAmount: 0
            });
        }

        // ดึงรายการสินค้าในตะกร้าพร้อมรูปภาพหลัก
        const strQry = `
            SELECT 
                oi."orderItemId",
                oi."productId",
                oi."productSku",
                oi."productName",
                oi."unitPrice",
                oi."quantity",
                oi."subtotal",
                p."stock",
                p."isActive",
                p."deletedAt",
                (
                    SELECT "imageUrl"
                    FROM "productImages"
                    WHERE "productId" = oi."productId" AND "isPrimary" = true
                    LIMIT 1
                ) AS "imageUrl"
            FROM "orderItems" oi
            JOIN "products" p ON oi."productId" = p."productId"
            WHERE oi."orderId" = $1
            ORDER BY oi."orderItemId" ASC;
        `;
        const itemsResult = await database.query(strQry, [cart.orderId]);

        return res.status(200).json({
            orderId: cart.orderId,
            items: itemsResult.rows,
            totalQty: Number(cart.totalQty) || 0,
            totalAmount: Number(cart.totalAmount) || 0
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// 2. เพิ่มสินค้าลงในตะกร้า
export async function addToCart(req, res) {
    try {
        const userId = req.user?.userId;
        const { productId, quantity = 1 } = req.body;

        if (!productId || Number(quantity) <= 0) {
            return res.status(400).json({ message: 'Valid productId and quantity are required' });
        }

        const qty = parseInt(quantity, 10);

        // ตรวจสอบสินค้าและ Stock
        const productQry = `
            SELECT "productId", "name", "price", "stock", "sku", "isActive", "deletedAt"
            FROM "products"
            WHERE "productId" = $1
            LIMIT 1;
        `;
        const productRes = await database.query(productQry, [productId]);
        const product = productRes.rows[0];

        if (!product || product.deletedAt || !product.isActive) {
            return res.status(404).json({ message: 'Product not found or unavailable' });
        }

        if (product.stock < qty) {
            return res.status(400).json({ message: 'Insufficient stock available' });
        }

        // ตรวจสอบหรือสร้าง Order สถานะ 'cart'
        let orderId;
        const findCartQry = `
            SELECT "orderId" FROM "orders"
            WHERE "userId" = $1 AND "status" = 'cart'
            LIMIT 1;
        `;
        const cartRes = await database.query(findCartQry, [userId]);

        if (cartRes.rows.length > 0) {
            orderId = cartRes.rows[0].orderId;
        } else {
            const createCartQry = `
                INSERT INTO "orders" ("userId", "status", "totalQty", "totalAmount")
                VALUES ($1, 'cart', 0, 0)
                RETURNING "orderId";
            `;
            const newCartRes = await database.query(createCartQry, [userId]);
            orderId = newCartRes.rows[0].orderId;
        }

        // ตรวจสอบว่ามีสินค้านี้ในตะกร้าหรือยัง
        const checkItemQry = `
            SELECT "orderItemId", "quantity"
            FROM "orderItems"
            WHERE "orderId" = $1 AND "productId" = $2;
        `;
        const itemRes = await database.query(checkItemQry, [orderId, productId]);

        if (itemRes.rows.length > 0) {
            const existingItem = itemRes.rows[0];
            const newQty = existingItem.quantity + qty;

            if (newQty > product.stock) {
                return res.status(400).json({ message: `Cannot add more. Max stock available is ${product.stock}` });
            }

            const updateItemQry = `
                UPDATE "orderItems"
                SET "quantity" = $1, "subtotal" = $1 * "unitPrice"
                WHERE "orderItemId" = $2
                RETURNING *;
            `;
            await database.query(updateItemQry, [newQty, existingItem.orderItemId]);
        } else {
            const insertItemQry = `
                INSERT INTO "orderItems" (
                    "orderId", "productId", "productSku", "productName", 
                    "unitPrice", "quantity", "subtotal"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $5 * $6)
                RETURNING *;
            `;
            await database.query(insertItemQry, [
                orderId,
                product.productId,
                product.sku,
                product.name,
                product.price,
                qty
            ]);
        }

        // ปรับปรุงยอดรวม totalQty และ totalAmount ใน orders
        const updateTotalsQry = `
            UPDATE "orders"
            SET "totalQty" = COALESCE((SELECT SUM("quantity") FROM "orderItems" WHERE "orderId" = $1), 0),
                "totalAmount" = COALESCE((SELECT SUM("subtotal") FROM "orderItems" WHERE "orderId" = $1), 0),
                "updatedAt" = NOW()
            WHERE "orderId" = $1;
        `;
        await database.query(updateTotalsQry, [orderId]);

        return res.status(200).json({ message: 'Product added to cart successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// 3. แก้ไขจำนวนสินค้าในตะกร้า
export async function updateCartItem(req, res) {
    try {
        const userId = req.user?.userId;
        const { itemId } = req.params;
        const { quantity } = req.body;

        const qty = parseInt(quantity, 10);
        if (isNaN(qty) || qty < 0) {
            return res.status(400).json({ message: 'Valid quantity is required' });
        }

        // ดึงข้อมูลรายการสินค้าและตรวจสอบว่าเป็นของ User คนนี้จริง
        const itemQry = `
            SELECT oi."orderItemId", oi."orderId", oi."productId", oi."unitPrice", p."stock"
            FROM "orderItems" oi
            JOIN "orders" o ON oi."orderId" = o."orderId"
            JOIN "products" p ON oi."productId" = p."productId"
            WHERE oi."orderItemId" = $1 AND o."userId" = $2 AND o."status" = 'cart';
        `;
        const itemRes = await database.query(itemQry, [itemId, userId]);
        const item = itemRes.rows[0];

        if (!item) {
            return res.status(404).json({ message: 'Cart item not found' });
        }

        // ถ้าจำนวนเป็น 0 ให้ลบออกจากตะกร้า
        if (qty === 0) {
            await database.query(`DELETE FROM "orderItems" WHERE "orderItemId" = $1;`, [itemId]);
        } else {
            if (qty > item.stock) {
                return res.status(400).json({ message: `Requested quantity exceeds available stock (${item.stock})` });
            }

            const updateQry = `
                UPDATE "orderItems"
                SET "quantity" = $1, "subtotal" = $1 * "unitPrice"
                WHERE "orderItemId" = $2;
            `;
            await database.query(updateQry, [qty, itemId]);
        }

        // อัปเดตยอดรวมใน orders
        const updateTotalsQry = `
            UPDATE "orders"
            SET "totalQty" = COALESCE((SELECT SUM("quantity") FROM "orderItems" WHERE "orderId" = $1), 0),
                "totalAmount" = COALESCE((SELECT SUM("subtotal") FROM "orderItems" WHERE "orderId" = $1), 0),
                "updatedAt" = NOW()
            WHERE "orderId" = $1;
        `;
        await database.query(updateTotalsQry, [item.orderId]);

        return res.status(200).json({ message: 'Cart item updated successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// 4. ลบสินค้าออกจากตะกร้า
export async function removeCartItem(req, res) {
    try {
        const userId = req.user?.userId;
        const { itemId } = req.params;

        // ตรวจสอบความถูกต้องและดึง orderId
        const findQry = `
            SELECT oi."orderItemId", oi."orderId"
            FROM "orderItems" oi
            JOIN "orders" o ON oi."orderId" = o."orderId"
            WHERE oi."orderItemId" = $1 AND o."userId" = $2 AND o."status" = 'cart';
        `;
        const findRes = await database.query(findQry, [itemId, userId]);
        const item = findRes.rows[0];

        if (!item) {
            return res.status(404).json({ message: 'Cart item not found' });
        }

        // ลบ item
        await database.query(`DELETE FROM "orderItems" WHERE "orderItemId" = $1;`, [itemId]);

        // อัปเดตยอดรวมใน orders
        const updateTotalsQry = `
            UPDATE "orders"
            SET "totalQty" = COALESCE((SELECT SUM("quantity") FROM "orderItems" WHERE "orderId" = $1), 0),
                "totalAmount" = COALESCE((SELECT SUM("subtotal") FROM "orderItems" WHERE "orderId" = $1), 0),
                "updatedAt" = NOW()
            WHERE "orderId" = $1;
        `;
        await database.query(updateTotalsQry, [item.orderId]);

        return res.status(200).json({ message: 'Cart item removed successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}
