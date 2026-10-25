import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import database from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// 1. รายการสินค้า (Admin List Products)
// ==========================================
export async function getAdminProducts(req, res) {
    try {
        const {
            search = '',
            categoryId,
            brandId,
            isActive,
            stockStatus,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const queryParams = [];
        let whereClauses = ['p."deletedAt" IS NULL'];

        // ค้นหาตามชื่อสินค้า หรือ SKU
        if (search.trim()) {
            queryParams.push(`%${search.trim().toLowerCase()}%`);
            whereClauses.push(`(LOWER(p."name") LIKE $${queryParams.length} OR LOWER(p."sku") LIKE $${queryParams.length})`);
        }

        // กรองตามหมวดหมู่
        if (categoryId) {
            queryParams.push(categoryId);
            whereClauses.push(`p."categoryId" = $${queryParams.length}`);
        }

        // กรองตามแบรนด์
        if (brandId) {
            queryParams.push(brandId);
            whereClauses.push(`p."brandId" = $${queryParams.length}`);
        }

        // กรองตามสถานะการแสดงผล
        if (isActive !== undefined && isActive !== '') {
            queryParams.push(isActive === 'true');
            whereClauses.push(`p."isActive" = $${queryParams.length}`);
        }

        // กรองตามสถานะสต็อก
        if (stockStatus === 'out_of_stock') {
            whereClauses.push(`p."stock" = 0`);
        } else if (stockStatus === 'in_stock') {
            whereClauses.push(`p."stock" > 0`);
        }

        const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // นับจำนวนทั้งหมดสำหรับ Pagination
        const countQry = `SELECT COUNT(*)::int AS "total" FROM "products" p ${whereSQL};`;
        const countRes = await database.query(countQry, queryParams);
        const totalItems = countRes.rows[0]?.total || 0;

        // คำนวณ Sorting ที่ปลอดภัย
        const validSortCols = {
            productId: 'p."productId"',
            sku: 'p."sku"',
            name: 'p."name"',
            price: 'p."price"',
            stock: 'p."stock"',
            createdAt: 'p."createdAt"'
        };
        const sortColumn = validSortCols[sortBy] || 'p."createdAt"';
        const sortDirection = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Query รายการสินค้าพร้อมข้อมูลหมวดหมู่ แบรนด์ และรูปภาพหลัก
        queryParams.push(parseInt(limit, 10));
        const limitParam = `$${queryParams.length}`;
        queryParams.push(offset);
        const offsetParam = `$${queryParams.length}`;

        const strQry = `
            SELECT 
                p."productId",
                p."sku",
                p."name",
                p."description",
                p."price",
                p."stock",
                p."categoryId",
                c."name" AS "categoryName",
                p."brandId",
                b."name" AS "brandName",
                p."specs",
                p."isActive",
                p."createdAt",
                p."updatedAt",
                (
                    SELECT "imageUrl" 
                    FROM "productImages" 
                    WHERE "productId" = p."productId" AND "isPrimary" = true 
                    LIMIT 1
                ) AS "primaryImage"
            FROM "products" p
            LEFT JOIN "categories" c ON p."categoryId" = c."categoryId"
            LEFT JOIN "brands" b ON p."brandId" = b."brandId"
            ${whereSQL}
            ORDER BY ${sortColumn} ${sortDirection}
            LIMIT ${limitParam} OFFSET ${offsetParam};
        `;

        const result = await database.query(strQry, queryParams);

        return res.status(200).json({
            pagination: {
                totalItems,
                totalPages: Math.ceil(totalItems / parseInt(limit, 10)),
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            },
            data: result.rows
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ดูรายละเอียดสินค้า 1 ชิ้นพร้อมรูปภาพทั้งหมด (สำหรับหน้า Edit)
export async function getAdminProductById(req, res) {
    try {
        const { productId } = req.params;

        const strQry = `
            SELECT 
                p."productId",
                p."sku",
                p."name",
                p."description",
                p."price",
                p."stock",
                p."categoryId",
                c."name" AS "categoryName",
                p."brandId",
                b."name" AS "brandName",
                p."specs",
                p."isActive",
                p."createdAt",
                p."updatedAt"
            FROM "products" p
            LEFT JOIN "categories" c ON p."categoryId" = c."categoryId"
            LEFT JOIN "brands" b ON p."brandId" = b."brandId"
            WHERE p."productId" = $1 AND p."deletedAt" IS NULL;
        `;
        const result = await database.query(strQry, [productId]);
        const product = result.rows[0];

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // ดึงรูปภาพทั้งหมดของสินค้านี้
        const imagesQry = `
            SELECT "imageId", "imageUrl", "isPrimary", "sortOrder"
            FROM "productImages"
            WHERE "productId" = $1
            ORDER BY "isPrimary" DESC, "sortOrder" ASC, "imageId" ASC;
        `;
        const imagesRes = await database.query(imagesQry, [productId]);
        product.images = imagesRes.rows;

        return res.status(200).json(product);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 2. เพิ่มสินค้า (Create Product)
// ==========================================
export async function createProduct(req, res) {
    try {
        const adminId = req.user?.userId;
        const {
            sku,
            name,
            description = '',
            price,
            stock = 0,
            categoryId,
            brandId = null,
            specs = {},
            isActive = true
        } = req.body;

        // Validation ฟิลด์บังคับ
        if (!sku || !name || price === undefined || !categoryId) {
            return res.status(400).json({ message: 'SKU, name, price, and categoryId are required' });
        }

        if (Number(price) < 0 || Number(stock) < 0) {
            return res.status(400).json({ message: 'Price and stock must be greater than or equal to 0' });
        }

        // ตรวจสอบ SKU ซ้ำ
        const checkSku = await database.query(
            `SELECT "productId" FROM "products" WHERE LOWER("sku") = LOWER($1);`,
            [sku.trim()]
        );
        if (checkSku.rows.length > 0) {
            return res.status(409).json({ message: `SKU '${sku}' already exists` });
        }

        // ตรวจสอบ Category ว่ามีอยู่จริง
        const checkCat = await database.query(
            `SELECT "categoryId" FROM "categories" WHERE "categoryId" = $1;`,
            [categoryId]
        );
        if (checkCat.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid categoryId' });
        }

        const insertQry = `
            INSERT INTO "products" (
                "sku", "name", "description", "price", "stock",
                "categoryId", "brandId", "specs", "isActive", "createdBy"
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *;
        `;
        const values = [
            sku.trim().toUpperCase(),
            name.trim(),
            description ? description.trim() : '',
            parseFloat(price),
            parseInt(stock, 10),
            categoryId,
            brandId || null,
            typeof specs === 'string' ? specs : JSON.stringify(specs),
            Boolean(isActive),
            adminId
        ];

        const result = await database.query(insertQry, values);

        return res.status(201).json({
            message: 'Product created successfully',
            product: result.rows[0]
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 3. แก้ไขสินค้า (Update Product)
// ==========================================
export async function updateProduct(req, res) {
    try {
        const { productId } = req.params;
        const {
            sku,
            name,
            description,
            price,
            stock,
            categoryId,
            brandId,
            specs,
            isActive
        } = req.body;

        // ตรวจสอบว่าสินค้ามีอยู่และยังไม่ถูกลบ
        const checkProd = await database.query(
            `SELECT * FROM "products" WHERE "productId" = $1 AND "deletedAt" IS NULL;`,
            [productId]
        );
        const currentProd = checkProd.rows[0];
        if (!currentProd) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // ถ้าเปลี่ยน SKU ต้องไม่ซ้ำกับของสินค้าอื่น
        if (sku && sku.trim().toUpperCase() !== currentProd.sku) {
            const checkSku = await database.query(
                `SELECT "productId" FROM "products" WHERE LOWER("sku") = LOWER($1) AND "productId" != $2;`,
                [sku.trim(), productId]
            );
            if (checkSku.rows.length > 0) {
                return res.status(409).json({ message: `SKU '${sku}' already exists` });
            }
        }

        // ถ้าเปลี่ยน Category ต้องมีอยู่จริง
        if (categoryId && categoryId !== currentProd.categoryId) {
            const checkCat = await database.query(
                `SELECT "categoryId" FROM "categories" WHERE "categoryId" = $1;`,
                [categoryId]
            );
            if (checkCat.rows.length === 0) {
                return res.status(400).json({ message: 'Invalid categoryId' });
            }
        }

        const updateQry = `
            UPDATE "products"
            SET 
                "sku" = COALESCE($1, "sku"),
                "name" = COALESCE($2, "name"),
                "description" = COALESCE($3, "description"),
                "price" = COALESCE($4, "price"),
                "stock" = COALESCE($5, "stock"),
                "categoryId" = COALESCE($6, "categoryId"),
                "brandId" = $7,
                "specs" = COALESCE($8, "specs"),
                "isActive" = COALESCE($9, "isActive"),
                "updatedAt" = NOW()
            WHERE "productId" = $10 AND "deletedAt" IS NULL
            RETURNING *;
        `;
        const values = [
            sku ? sku.trim().toUpperCase() : null,
            name ? name.trim() : null,
            description !== undefined ? description : null,
            price !== undefined ? parseFloat(price) : null,
            stock !== undefined ? parseInt(stock, 10) : null,
            categoryId || null,
            brandId !== undefined ? brandId : currentProd.brandId,
            specs !== undefined ? (typeof specs === 'string' ? specs : JSON.stringify(specs)) : null,
            isActive !== undefined ? Boolean(isActive) : null,
            productId
        ];

        const result = await database.query(updateQry, values);

        return res.status(200).json({
            message: 'Product updated successfully',
            product: result.rows[0]
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 4. ลบ / ซ่อน สินค้า (Delete & Hide)
// ==========================================

// ซ่อนหรือเปิดแสดงสินค้า (Toggle / Set isActive)
export async function toggleProductActive(req, res) {
    try {
        const { productId } = req.params;
        const { isActive } = req.body;

        let strQry = '';
        let params = [];

        if (isActive !== undefined) {
            strQry = `
                UPDATE "products"
                SET "isActive" = $1, "updatedAt" = NOW()
                WHERE "productId" = $2 AND "deletedAt" IS NULL
                RETURNING "productId", "name", "isActive";
            `;
            params = [Boolean(isActive), productId];
        } else {
            // สลับสถานะอัตโนมัติ
            strQry = `
                UPDATE "products"
                SET "isActive" = NOT "isActive", "updatedAt" = NOW()
                WHERE "productId" = $1 AND "deletedAt" IS NULL
                RETURNING "productId", "name", "isActive";
            `;
            params = [productId];
        }

        const result = await database.query(strQry, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        return res.status(200).json({
            message: `Product is now ${result.rows[0].isActive ? 'visible' : 'hidden'}`,
            product: result.rows[0]
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ลบสินค้าแบบ Soft Delete (อัปเดต deletedAt ตาม sql_documents.md)
export async function deleteProduct(req, res) {
    try {
        const { productId } = req.params;

        const strQry = `
            UPDATE "products"
            SET "deletedAt" = NOW(), "isActive" = false, "updatedAt" = NOW()
            WHERE "productId" = $1 AND "deletedAt" IS NULL
            RETURNING "productId", "name", "deletedAt";
        `;
        const result = await database.query(strQry, [productId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Product not found or already deleted' });
        }

        return res.status(200).json({
            message: 'Product deleted successfully',
            deletedProduct: result.rows[0]
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 5. อัปโหลดรูปภาพสินค้า (Upload Product Images)
// ==========================================
export async function uploadProductImages(req, res) {
    try {
        const { productId } = req.params;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No image files uploaded' });
        }

        // ตรวจสอบว่าสินค้ามีอยู่จริง
        const checkProd = await database.query(
            `SELECT "productId" FROM "products" WHERE "productId" = $1 AND "deletedAt" IS NULL;`,
            [productId]
        );
        if (checkProd.rows.length === 0) {
            // ลบไฟล์ที่อัปโหลดขึ้นมาทิ้งถ้าไม่พบสินค้า
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
            });
            return res.status(404).json({ message: 'Product not found' });
        }

        // ตรวจสอบว่าสินค้านี้มีรูปภาพหลักหรือยัง
        const checkPrimary = await database.query(
            `SELECT "imageId" FROM "productImages" WHERE "productId" = $1 AND "isPrimary" = true;`,
            [productId]
        );
        const hasPrimary = checkPrimary.rows.length > 0;

        const insertedImages = [];

        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const imageUrl = `/uploads/products/${file.filename}`;
            // ถ้ารูปแรกและยังไม่เคยมีรูปหลัก ให้รูปนี้เป็นรูปหลักทันที
            const isPrimary = !hasPrimary && i === 0;

            const insertQry = `
                INSERT INTO "productImages" ("productId", "imageUrl", "isPrimary", "sortOrder")
                VALUES ($1, $2, $3, $4)
                RETURNING *;
            `;
            const result = await database.query(insertQry, [productId, imageUrl, isPrimary, i]);
            insertedImages.push(result.rows[0]);
        }

        return res.status(201).json({
            message: 'Images uploaded successfully',
            images: insertedImages
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 6. จัดการรูปภาพสินค้า (Manage Product Images)
// ==========================================

// ตั้งรูปหลัก (Set Primary Image)
export async function setPrimaryImage(req, res) {
    try {
        const { productId, imageId } = req.params;

        // ตรวจสอบว่ารูปนี้เป็นของสินค้านี้จริง
        const checkImg = await database.query(
            `SELECT "imageId" FROM "productImages" WHERE "imageId" = $1 AND "productId" = $2;`,
            [imageId, productId]
        );
        if (checkImg.rows.length === 0) {
            return res.status(404).json({ message: 'Image not found for this product' });
        }

        // เคลียร์รูปหลักเดิม และตั้งรูปนี้เป็นรูปหลักใหม่
        await database.query(
            `UPDATE "productImages" SET "isPrimary" = false WHERE "productId" = $1;`,
            [productId]
        );

        await database.query(
            `UPDATE "productImages" SET "isPrimary" = true WHERE "imageId" = $1 AND "productId" = $2;`,
            [imageId, productId]
        );

        return res.status(200).json({ message: 'Primary image updated successfully', primaryImageId: imageId });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ลบรูปภาพสินค้า (Delete Product Image)
export async function deleteProductImage(req, res) {
    try {
        const { productId, imageId } = req.params;

        // ดึงข้อมูลรูปภาพเพื่อนำไปลบไฟล์จริง
        const findImg = await database.query(
            `SELECT "imageId", "imageUrl", "isPrimary" FROM "productImages" WHERE "imageId" = $1 AND "productId" = $2;`,
            [imageId, productId]
        );
        const image = findImg.rows[0];

        if (!image) {
            return res.status(404).json({ message: 'Image not found' });
        }

        // ลบแถวออกจากฐานข้อมูล
        await database.query(`DELETE FROM "productImages" WHERE "imageId" = $1;`, [imageId]);

        // ลบไฟล์จริงออกจาก Storage
        try {
            const filename = path.basename(image.imageUrl);
            const filePath = path.join(__dirname, '../public/uploads/products', filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (fileErr) {
            console.warn('Failed to delete physical image file:', fileErr.message);
        }

        // ถ้ารูปที่ลบเป็นรูปหลัก ให้หารูปอื่นที่เหลืออยู่ตั้งเป็นรูปหลักแทน
        if (image.isPrimary) {
            await database.query(`
                UPDATE "productImages"
                SET "isPrimary" = true
                WHERE "imageId" = (
                    SELECT "imageId" FROM "productImages"
                    WHERE "productId" = $1
                    ORDER BY "sortOrder" ASC, "imageId" ASC
                    LIMIT 1
                );
            `, [productId]);
        }

        return res.status(200).json({ message: 'Product image deleted successfully' });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 7. รายการสินค้า Public (Public List Products)
// ==========================================
export async function getProducts(req, res) {
    try {
        const {
            search = '',
            categoryId,
            brandId,
            minPrice,
            maxPrice,
            inStock,
            page = 1,
            limit = 20,
            sortBy = 'createdAt',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const queryParams = [];
        let whereClauses = ['p."deletedAt" IS NULL', 'p."isActive" = true'];

        // ค้นหาตามชื่อสินค้า หรือ SKU
        if (search.trim()) {
            queryParams.push(`%${search.trim().toLowerCase()}%`);
            whereClauses.push(`(LOWER(p."name") LIKE $${queryParams.length} OR LOWER(p."sku") LIKE $${queryParams.length})`);
        }

        // กรองตามหมวดหมู่
        if (categoryId) {
            queryParams.push(parseInt(categoryId, 10));
            whereClauses.push(`p."categoryId" = $${queryParams.length}`);
        }

        // กรองตามแบรนด์
        if (brandId) {
            queryParams.push(parseInt(brandId, 10));
            whereClauses.push(`p."brandId" = $${queryParams.length}`);
        }

        // กรองตามช่วงราคา
        if (minPrice !== undefined && minPrice !== '') {
            queryParams.push(parseFloat(minPrice));
            whereClauses.push(`p."price" >= $${queryParams.length}`);
        }
        if (maxPrice !== undefined && maxPrice !== '') {
            queryParams.push(parseFloat(maxPrice));
            whereClauses.push(`p."price" <= $${queryParams.length}`);
        }

        // กรองตามสต็อก
        if (inStock === 'true') {
            whereClauses.push(`p."stock" > 0`);
        }

        const whereSQL = `WHERE ${whereClauses.join(' AND ')}`;

        // นับจำนวนทั้งหมดสำหรับ Pagination
        const countQry = `SELECT COUNT(*)::int AS "total" FROM "products" p ${whereSQL};`;
        const countRes = await database.query(countQry, queryParams);
        const totalItems = countRes.rows[0]?.total || 0;

        // คำนวณ Sorting ที่ปลอดภัย
        const validSortCols = {
            productId: 'p."productId"',
            name: 'p."name"',
            price: 'p."price"',
            stock: 'p."stock"',
            createdAt: 'p."createdAt"'
        };
        const sortColumn = validSortCols[sortBy] || 'p."createdAt"';
        const sortDirection = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        queryParams.push(parseInt(limit, 10));
        const limitParam = `$${queryParams.length}`;
        queryParams.push(offset);
        const offsetParam = `$${queryParams.length}`;

        const strQry = `
            SELECT
                p."productId",
                p."sku",
                p."name",
                p."description",
                p."price",
                p."stock",
                p."categoryId",
                c."name" AS "categoryName",
                p."brandId",
                b."name" AS "brandName",
                b."logoUrl" AS "brandLogoUrl",
                p."specs",
                p."createdAt",
                (
                    SELECT "imageUrl"
                    FROM "productImages"
                    WHERE "productId" = p."productId" AND "isPrimary" = true
                    LIMIT 1
                ) AS "primaryImage"
            FROM "products" p
            LEFT JOIN "categories" c ON p."categoryId" = c."categoryId"
            LEFT JOIN "brands" b ON p."brandId" = b."brandId"
            ${whereSQL}
            ORDER BY ${sortColumn} ${sortDirection}
            LIMIT ${limitParam} OFFSET ${offsetParam};
        `;

        const result = await database.query(strQry, queryParams);

        return res.status(200).json({
            pagination: {
                totalItems,
                totalPages: Math.ceil(totalItems / parseInt(limit, 10)),
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            },
            data: result.rows
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 8. รายละเอียดสินค้า Public (Public Product Detail)
// ==========================================
export async function getProductById(req, res) {
    try {
        const { productId } = req.params;

        const strQry = `
            SELECT
                p."productId",
                p."sku",
                p."name",
                p."description",
                p."price",
                p."stock",
                p."categoryId",
                c."name" AS "categoryName",
                c."slug" AS "categorySlug",
                p."brandId",
                b."name" AS "brandName",
                b."logoUrl" AS "brandLogoUrl",
                p."specs",
                p."createdAt",
                p."updatedAt"
            FROM "products" p
            LEFT JOIN "categories" c ON p."categoryId" = c."categoryId"
            LEFT JOIN "brands" b ON p."brandId" = b."brandId"
            WHERE p."productId" = $1 AND p."deletedAt" IS NULL AND p."isActive" = true;
        `;
        const result = await database.query(strQry, [productId]);
        const product = result.rows[0];

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // ดึงรูปภาพทั้งหมดของสินค้านี้
        const imagesQry = `
            SELECT "imageId", "imageUrl", "isPrimary", "sortOrder"
            FROM "productImages"
            WHERE "productId" = $1
            ORDER BY "isPrimary" DESC, "sortOrder" ASC, "imageId" ASC;
        `;
        const imagesRes = await database.query(imagesQry, [productId]);
        product.images = imagesRes.rows;

        return res.status(200).json(product);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}
