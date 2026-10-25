import database from '../config/db.js';

// ==========================================
// 1. ดึงหมวดหมู่ทั้งหมด (Get All Categories)
// ==========================================
export async function getCategories(req, res) {
    try {
        const strQry = `
            SELECT
                c."categoryId",
                c."name",
                c."slug",
                COUNT(p."productId")::int AS "productCount"
            FROM "categories" c
            LEFT JOIN "products" p 
                ON p."categoryId" = c."categoryId"
                AND p."deletedAt" IS NULL
                AND p."isActive" = true
            GROUP BY c."categoryId", c."name", c."slug"
            ORDER BY c."name" ASC;
        `;
        const result = await database.query(strQry);
        return res.status(200).json(result.rows);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 2. ดึงหมวดหมู่ตาม ID (Get Category By ID)
// ==========================================
export async function getCategoryById(req, res) {
    try {
        const { categoryId } = req.params;

        const strQry = `
            SELECT
                c."categoryId",
                c."name",
                c."slug",
                c."createdAt"
            FROM "categories" c
            WHERE c."categoryId" = $1;
        `;
        const result = await database.query(strQry, [categoryId]);
        const category = result.rows[0];

        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        return res.status(200).json(category);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 3. ดึงแบรนด์ทั้งหมด (Get All Brands)
// ==========================================
export async function getBrands(req, res) {
    try {
        const strQry = `
            SELECT
                b."brandId",
                b."name",
                b."logoUrl",
                COUNT(p."productId")::int AS "productCount"
            FROM "brands" b
            LEFT JOIN "products" p
                ON p."brandId" = b."brandId"
                AND p."deletedAt" IS NULL
                AND p."isActive" = true
            GROUP BY b."brandId", b."name", b."logoUrl"
            ORDER BY b."name" ASC;
        `;
        const result = await database.query(strQry);
        return res.status(200).json(result.rows);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 4. ดึงแบรนด์ตาม ID (Get Brand By ID)
// ==========================================
export async function getBrandById(req, res) {
    try {
        const { brandId } = req.params;

        const strQry = `
            SELECT
                b."brandId",
                b."name",
                b."logoUrl",
                b."createdAt"
            FROM "brands" b
            WHERE b."brandId" = $1;
        `;
        const result = await database.query(strQry, [brandId]);
        const brand = result.rows[0];

        if (!brand) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        return res.status(200).json(brand);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
}
