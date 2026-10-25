import { Router } from 'express';
import {
    getProducts,
    getProductById,
    getAdminProducts,
    getAdminProductById,
    createProduct,
    updateProduct,
    toggleProductActive,
    deleteProduct,
    uploadProductImages,
    setPrimaryImage,
    deleteProductImage
} from '../controllers/productController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/roleMiddleware.js';
import { uploadProductImage } from '../middlewares/uploadMiddleware.js';

const router = Router();

// ==========================================
// Public Product Endpoints (ไม่ต้อง Login)
// ==========================================

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Get products list with search, filters and pagination (Public)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name or SKU
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: integer
 *         description: Filter by category ID
 *       - in: query
 *         name: brandId
 *         schema:
 *           type: integer
 *         description: Filter by brand ID
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price filter
 *       - in: query
 *         name: inStock
 *         schema:
 *           type: boolean
 *         description: Filter only in-stock products
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [productId, name, price, stock, createdAt]
 *           default: createdAt
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: DESC
 *     responses:
 *       200:
 *         description: Products list with pagination
 */
router.get('/', getProducts);

/**
 * @swagger
 * /api/products/{productId}:
 *   get:
 *     summary: Get product detail by ID (Public)
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Product detail with all images
 *       404:
 *         description: Product not found or not available
 */
router.get('/:productId', getProductById);

// ==========================================
// Admin Product Endpoints (ต้องผ่าน authenticate และ requireAdmin)
// ==========================================

/**
 * @swagger
 * /api/products/admin:
 *   get:
 *     summary: Get all products for Admin (including hidden, with filters and pagination)
 *     tags: [Admin Products]
 */
router.get('/admin', authenticate, requireAdmin, getAdminProducts);

/**
 * @swagger
 * /api/products/admin/{productId}:
 *   get:
 *     summary: Get single product detail for Admin edit page
 *     tags: [Admin Products]
 */
router.get('/admin/:productId', authenticate, requireAdmin, getAdminProductById);

/**
 * @swagger
 * /api/products:
 *   post:
 *     summary: Create new product
 *     tags: [Admin Products]
 */
router.post('/', authenticate, requireAdmin, createProduct);

/**
 * @swagger
 * /api/products/{productId}:
 *   put:
 *     summary: Update product details
 *     tags: [Admin Products]
 */
router.put('/:productId', authenticate, requireAdmin, updateProduct);

/**
 * @swagger
 * /api/products/{productId}/status:
 *   patch:
 *     summary: Toggle or set product visibility (isActive)
 *     tags: [Admin Products]
 */
router.patch('/:productId/status', authenticate, requireAdmin, toggleProductActive);

/**
 * @swagger
 * /api/products/{productId}:
 *   delete:
 *     summary: Soft delete product (sets deletedAt)
 *     tags: [Admin Products]
 */
router.delete('/:productId', authenticate, requireAdmin, deleteProduct);

/**
 * @swagger
 * /api/products/{productId}/images:
 *   post:
 *     summary: Upload product images (up to 5 images)
 *     tags: [Admin Products]
 */
router.post(
    '/:productId/images',
    authenticate,
    requireAdmin,
    uploadProductImage.array('images', 5),
    uploadProductImages
);

/**
 * @swagger
 * /api/products/{productId}/images/{imageId}/primary:
 *   patch:
 *     summary: Set primary image for product
 *     tags: [Admin Products]
 */
router.patch('/:productId/images/:imageId/primary', authenticate, requireAdmin, setPrimaryImage);

/**
 * @swagger
 * /api/products/{productId}/images/{imageId}:
 *   delete:
 *     summary: Delete product image
 *     tags: [Admin Products]
 */
router.delete('/:productId/images/:imageId', authenticate, requireAdmin, deleteProductImage);

export default router;
