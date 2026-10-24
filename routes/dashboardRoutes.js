import { Router } from 'express';
import { getDashboardSummary, getDashboardCharts } from '../controllers/dashboardController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/roleMiddleware.js';

const router = Router();

// Dashboard เข้าถึงได้เฉพาะผู้ใช้ที่ Login แล้ว และมีสิทธิ์ Admin เท่านั้น
router.use(authenticate);
router.use(requireAdmin);

/**
 * @swagger
 * /api/dashboard/summary:
 *   get:
 *     summary: Get dashboard summary (Today, Month, Year, All-time and Overview)
 *     tags: [Admin Dashboard]
 *     responses:
 *       200:
 *         description: Dashboard summary data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get('/summary', getDashboardSummary);

/**
 * @swagger
 * /api/dashboard/charts:
 *   get:
 *     summary: Get dashboard chart statistics (day, month, year)
 *     tags: [Admin Dashboard]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, month, year]
 *           default: day
 *         description: Filter charts by day (last 30 days), month (last 12 months), or year (last 5 years)
 *     responses:
 *       200:
 *         description: Chart data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get('/charts', getDashboardCharts);

export default router;
