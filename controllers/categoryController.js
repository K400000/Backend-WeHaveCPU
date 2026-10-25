import fs from 'fs';
import database from '../config/db.js';

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ลบไฟล์ที่เพิ่งอัปโหลดทิ้ง เมื่อ request ไม่สำเร็จ (กันไฟล์ค้าง)
function discardUpload(file) {
    if (file?.path) fs.unlink(file.path, () => {});
}

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

// ==========================================
// 5. [Admin] เพิ่มหมวดหมู่ (Create Category)
// ==========================================
export async function createCategory(req, res) {
    try {
        const name = req.body.name?.trim();
        const slug = req.body.slug?.trim();

        if (!name || !slug) {
            return res.status(400).json({ message: 'Name and slug are required' });
        }

        if (!SLUG_REGEX.test(slug)) {
            return res.status(400).json({ message: 'Slug must be lowercase letters, numbers and hyphens only' });
        }

        const strQry = `
            INSERT INTO "categories" ("name", "slug")
            VALUES ($1, $2)
            RETURNING "categoryId", "name", "slug", "createdAt";
        `;
        const result = await database.query(strQry, [name, slug]);

        return res.status(201).json({
            message: 'Category created successfully',
            category: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Category name or slug already exists' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 6. [Admin] แก้ไขหมวดหมู่ (Update Category)
// ==========================================
export async function updateCategory(req, res) {
    try {
        const { categoryId } = req.params;
        const name = req.body.name?.trim();
        const slug = req.body.slug?.trim();

        if (name === undefined && slug === undefined) {
            return res.status(400).json({ message: 'Nothing to update' });
        }

        if (name !== undefined && !name) {
            return res.status(400).json({ message: 'Name cannot be empty' });
        }

        if (slug !== undefined && !SLUG_REGEX.test(slug)) {
            return res.status(400).json({ message: 'Slug must be lowercase letters, numbers and hyphens only' });
        }

        const strQry = `
            UPDATE "categories"
            SET "name" = COALESCE($1, "name"),
                "slug" = COALESCE($2, "slug")
            WHERE "categoryId" = $3
            RETURNING "categoryId", "name", "slug", "createdAt";
        `;
        const result = await database.query(strQry, [name ?? null, slug ?? null, categoryId]);
        const category = result.rows[0];

        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        return res.status(200).json({
            message: 'Category updated successfully',
            category
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Category name or slug already exists' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 7. [Admin] ลบหมวดหมู่ (Delete Category)
// ==========================================
export async function deleteCategory(req, res) {
    try {
        const { categoryId } = req.params;

        const strQry = `
            DELETE FROM "categories"
            WHERE "categoryId" = $1
            RETURNING "categoryId";
        `;
        const result = await database.query(strQry, [categoryId]);

        if (!result.rows[0]) {
            return res.status(404).json({ message: 'Category not found' });
        }

        return res.status(200).json({ message: 'Category deleted successfully' });
    } catch (err) {
        // FK จาก products (รวมสินค้าที่ถูก soft delete) ยังอ้างอิงอยู่
        if (err.code === '23503') {
            return res.status(409).json({ message: 'Category is still used by products' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 8. [Admin] เพิ่มแบรนด์ (Create Brand)
// ==========================================
export async function createBrand(req, res) {
    try {
        const name = req.body.name?.trim();

        if (!name) {
            discardUpload(req.file);
            return res.status(400).json({ message: 'Name is required' });
        }

        const logoUrl = req.file ? `/uploads/brands/${req.file.filename}` : null;

        const strQry = `
            INSERT INTO "brands" ("name", "logoUrl")
            VALUES ($1, $2)
            RETURNING "brandId", "name", "logoUrl", "createdAt";
        `;
        const result = await database.query(strQry, [name, logoUrl]);

        return res.status(201).json({
            message: 'Brand created successfully',
            brand: result.rows[0]
        });
    } catch (err) {
        discardUpload(req.file);
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Brand name already exists' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 9. [Admin] แก้ไขแบรนด์ (Update Brand)
// ==========================================
export async function updateBrand(req, res) {
    try {
        const { brandId } = req.params;
        const name = req.body.name?.trim();
        const logoUrl = req.file ? `/uploads/brands/${req.file.filename}` : null;

        if (name === undefined && !logoUrl) {
            return res.status(400).json({ message: 'Nothing to update' });
        }

        if (name !== undefined && !name) {
            discardUpload(req.file);
            return res.status(400).json({ message: 'Name cannot be empty' });
        }

        const strQry = `
            UPDATE "brands"
            SET "name" = COALESCE($1, "name"),
                "logoUrl" = COALESCE($2, "logoUrl")
            WHERE "brandId" = $3
            RETURNING "brandId", "name", "logoUrl", "createdAt";
        `;
        const result = await database.query(strQry, [name ?? null, logoUrl, brandId]);
        const brand = result.rows[0];

        if (!brand) {
            discardUpload(req.file);
            return res.status(404).json({ message: 'Brand not found' });
        }

        return res.status(200).json({
            message: 'Brand updated successfully',
            brand
        });
    } catch (err) {
        discardUpload(req.file);
        if (err.code === '23505') {
            return res.status(409).json({ message: 'Brand name already exists' });
        }
        return res.status(500).json({ message: err.message });
    }
}

// ==========================================
// 10. [Admin] ลบแบรนด์ (Delete Brand)
// ==========================================
export async function deleteBrand(req, res) {
    try {
        const { brandId } = req.params;

        const strQry = `
            DELETE FROM "brands"
            WHERE "brandId" = $1
            RETURNING "brandId";
        `;
        const result = await database.query(strQry, [brandId]);

        if (!result.rows[0]) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        return res.status(200).json({ message: 'Brand deleted successfully' });
    } catch (err) {
        if (err.code === '23503') {
            return res.status(409).json({ message: 'Brand is still used by products' });
        }
        return res.status(500).json({ message: err.message });
    }
}
