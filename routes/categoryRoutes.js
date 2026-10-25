import { Router } from 'express';
import { getCategories, getCategoryById } from '../controllers/categoryController.js';
import { getBrands, getBrandById } from '../controllers/categoryController.js';

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

export default router;
