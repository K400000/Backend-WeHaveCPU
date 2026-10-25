import { Router } from 'express';
import { getProfile, updateProfile, changePassword } from '../controllers/userController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { uploadProfileImage } from '../middlewares/uploadMiddleware.js';

const router = Router();

// ทุก Route ในนี้ต้องผ่านการตรวจสอบสถานะการ Login
router.use(authenticate);

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Profile]
 */
router.get('/profile', getProfile);

/**
 * @swagger
 * /api/users/profile:
 *   put:
 *     summary: Update profile info (supports JSON and avatar file upload)
 *     tags: [Profile]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               avatar:
 *                 type: string
 *                 format: binary
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 */
router.put('/profile', uploadProfileImage.single('avatar'), updateProfile);

/**
 * @swagger
 * /api/users/change-password:
 *   put:
 *     summary: Change user password
 *     tags: [Profile]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 */
router.put('/change-password', changePassword);

export default router;
