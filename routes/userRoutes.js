import { Router } from 'express';
import {
    getProfile, updateProfile, changePassword,
    adminGetUsers, adminChangeUserStatus, adminPromoteUser, adminDemoteUser,
    adminSetUserRoleByEmail
} from '../controllers/userController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/roleMiddleware.js';
import { uploadProfileImage } from '../middlewares/uploadMiddleware.js';

const router = Router();

// ทุก Route ในนี้ต้องผ่านการตรวจสอบสถานะการ Login
router.use(authenticate);

/**
 * @swagger
 * /api/users/admin:
 *   get:
 *     summary: List users with filters, search and pagination (Admin)
 *     tags: [Users (Admin)]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, suspended, banned]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [member, admin]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Matches email or full name (case-insensitive)
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
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Users with pagination { page, limit, total, totalPages }
 *       400:
 *         description: Invalid query
 *       403:
 *         description: Admin access required
 */
router.get('/admin', requireAdmin, adminGetUsers);

/**
 * @swagger
 * /api/users/admin/{userId}/status:
 *   patch:
 *     summary: Change user status and log it (Admin)
 *     description: Cannot change own status. Admin targets must be demoted first.
 *     tags: [Users (Admin)]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status, reason]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, banned]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Invalid input, own account, or status unchanged
 *       403:
 *         description: Target is an admin
 *       404:
 *         description: User not found
 */
router.patch('/admin/:userId/status', requireAdmin, adminChangeUserStatus);

/**
 * @swagger
 * /api/users/admin/{userId}/promote:
 *   patch:
 *     summary: Promote an active member to admin (Admin)
 *     tags: [Users (Admin)]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User promoted (promotedBy = current admin)
 *       400:
 *         description: Already admin or user is not active
 *       404:
 *         description: User not found
 */
router.patch('/admin/:userId/promote', requireAdmin, adminPromoteUser);

/**
 * @swagger
 * /api/users/admin/{userId}/demote:
 *   patch:
 *     summary: Demote an admin to member (Admin)
 *     description: Cannot demote yourself. Clears promotedBy.
 *     tags: [Users (Admin)]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Admin demoted
 *       400:
 *         description: Own account or user is not an admin
 *       404:
 *         description: User not found
 */
router.patch('/admin/:userId/demote', requireAdmin, adminDemoteUser);

/**
 * @swagger
 * /api/users/admin/set-role:
 *   patch:
 *     summary: Set user role (member or admin) by email (Admin)
 *     description: |
 *       กำหนด role ของผู้ใช้โดยใช้ email แทน userId ในครั้งเดียว.<br>
 *       **ข้อจำกัด:** ไม่สามารถเปลี่ยน role ของตนเองได้, user ต้องมี status = active เพื่อ promote เป็น admin.<br>
 *       **หมายเหตุ:** การเปลี่ยน role จะมีผลทันที ไม่มีการตรวจสอบว่ามีบิลหรือตะกร้าค้างอยู่.
 *     tags: [Users (Admin)]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, role]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               role:
 *                 type: string
 *                 enum: [member, admin]
 *                 example: admin
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       400:
 *         description: Invalid input, own account, role unchanged, or user is not active (for promote)
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User with given email not found
 */
router.patch('/admin/set-role', requireAdmin, adminSetUserRoleByEmail);

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
