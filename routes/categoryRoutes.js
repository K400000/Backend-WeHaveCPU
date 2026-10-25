import { Router } from 'express';
import {
    getCategories, getCategoryById, getBrands, getBrandById,
    createCategory, updateCategory, deleteCategory,
    createBrand, updateBrand, deleteBrand
} from '../controllers/categoryController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/roleMiddleware.js';
import { uploadBrandLogo } from '../middlewares/uploadMiddleware.js';

const router = Router();

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: Get all product categories with product count (Public)
 *     tags: [Categories & Brands]
 *     responses:
 *       200:
 *         description: List of all categories
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   categoryId:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   slug:
 *                     type: string
 *                   productCount:
 *                     type: integer
 */
router.get('/', getCategories);

/**
 * @swagger
 * /api/categories/{categoryId}:
 *   get:
 *     summary: Get category by ID (Public)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Category detail
 *       404:
 *         description: Category not found
 */
router.get('/:categoryId', getCategoryById);

/**
 * @swagger
 * /api/categories/brands/all:
 *   get:
 *     summary: Get all brands with product count (Public)
 *     tags: [Categories & Brands]
 *     responses:
 *       200:
 *         description: List of all brands
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   brandId:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   logoUrl:
 *                     type: string
 *                   productCount:
 *                     type: integer
 */
router.get('/brands/all', getBrands);

/**
 * @swagger
 * /api/categories/brands/{brandId}:
 *   get:
 *     summary: Get brand by ID (Public)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: brandId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Brand detail
 *       404:
 *         description: Brand not found
 */
router.get('/brands/:brandId', getBrandById);

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: Create category (Admin)
 *     tags: [Categories & Brands]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *                 description: lowercase letters, numbers, hyphens (e.g. cpu, graphics-card)
 *     responses:
 *       201:
 *         description: Category created
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Name or slug already exists
 */
router.post('/', authenticate, requireAdmin, createCategory);

/**
 * @swagger
 * /api/categories/{categoryId}:
 *   put:
 *     summary: Update category (Admin)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *     responses:
 *       200:
 *         description: Category updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Category not found
 *       409:
 *         description: Name or slug already exists
 */
router.put('/:categoryId', authenticate, requireAdmin, updateCategory);

/**
 * @swagger
 * /api/categories/{categoryId}:
 *   delete:
 *     summary: Delete category (Admin)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Category deleted
 *       404:
 *         description: Category not found
 *       409:
 *         description: Category is still used by products
 */
router.delete('/:categoryId', authenticate, requireAdmin, deleteCategory);

/**
 * @swagger
 * /api/categories/brands:
 *   post:
 *     summary: Create brand with optional logo upload (Admin)
 *     tags: [Categories & Brands]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Brand created
 *       400:
 *         description: Invalid input
 *       409:
 *         description: Brand name already exists
 */
router.post('/brands', authenticate, requireAdmin, uploadBrandLogo.single('logo'), createBrand);

/**
 * @swagger
 * /api/categories/brands/{brandId}:
 *   put:
 *     summary: Update brand name and/or logo (Admin)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: brandId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Brand updated
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Brand not found
 *       409:
 *         description: Brand name already exists
 */
router.put('/brands/:brandId', authenticate, requireAdmin, uploadBrandLogo.single('logo'), updateBrand);

/**
 * @swagger
 * /api/categories/brands/{brandId}:
 *   delete:
 *     summary: Delete brand (Admin)
 *     tags: [Categories & Brands]
 *     parameters:
 *       - in: path
 *         name: brandId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Brand deleted
 *       404:
 *         description: Brand not found
 *       409:
 *         description: Brand is still used by products
 */
router.delete('/brands/:brandId', authenticate, requireAdmin, deleteBrand);

export default router;
