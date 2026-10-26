import { Router } from 'express';
import {
    checkoutOrder,
    payMockOrder,
    cancelMyOrder,
    updateStatus,
    getMyOrders,
    getOrderById,
    getOrderTracking,
    adminGetOrders,
    adminGetOrderById,
    adminCancelOrder,
    adminAdvanceShipment
} from '../controllers/orderController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requireAdmin } from '../middlewares/roleMiddleware.js';

const router = Router();

// Protect all order routes with JWT authentication
router.use(authenticate);

// ---------- Admin routes (ต้องอยู่ก่อน '/:orderId' เพื่อไม่ให้ 'admin' ถูกจับเป็น orderId) ----------

/**
 * @swagger
 * /api/orders/admin:
 *   get:
 *     summary: List all orders with date range filter and pagination (Admin)
 *     tags: [Orders (Admin)]
 *     parameters:
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive start date (YYYY-MM-DD, Thai time) on confirmedAt
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Inclusive end date (YYYY-MM-DD, Thai time) on confirmedAt
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
 *         description: Orders (cart excluded) with pagination { page, limit, total, totalPages }
 *       400:
 *         description: Invalid query
 *       403:
 *         description: Admin access required
 */
router.get('/admin', requireAdmin, adminGetOrders);

/**
 * @swagger
 * /api/orders/admin/{orderId}:
 *   get:
 *     summary: Order detail with customer, items, shipment timeline and status logs (Admin)
 *     tags: [Orders (Admin)]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order detail
 *       404:
 *         description: Order not found
 */
router.get('/admin/:orderId', requireAdmin, adminGetOrderById);

/**
 * @swagger
 * /api/orders/admin/{orderId}/cancel:
 *   post:
 *     summary: Cancel an unpaid (pending) order and refund stock (Admin)
 *     tags: [Orders (Admin)]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order cancelled (cancelReason = admin)
 *       400:
 *         description: Order is not pending
 *       404:
 *         description: Order not found
 */
router.post('/admin/:orderId/cancel', requireAdmin, adminCancelOrder);

/**
 * @swagger
 * /api/orders/admin/{orderId}/shipment:
 *   patch:
 *     summary: Advance shipment one step (Admin)
 *     description: >
 *       First call on a paid order creates the shipment as preparing. Order is
 *       preparing -> shipped -> in_transit -> out_for_delivery -> delivered.
 *       shipped needs courier + trackingNo and sets the order to shipped;
 *       delivered sets the order to completed.
 *     tags: [Orders (Admin)]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [preparing, shipped, in_transit, out_for_delivery, delivered]
 *                 description: Optional. If sent, must equal the next step.
 *               courier:
 *                 type: string
 *               trackingNo:
 *                 type: string
 *               note:
 *                 type: string
 *                 description: Timeline text (defaults per status)
 *     responses:
 *       200:
 *         description: Shipment advanced
 *       400:
 *         description: Invalid step, order not paid/shipped, or missing courier/trackingNo
 *       404:
 *         description: Order not found
 */
router.patch('/admin/:orderId/shipment', requireAdmin, adminAdvanceShipment);

/**
 * @swagger
 * /api/orders/checkout:
 *   post:
 *     summary: Checkout current shopping cart to create order
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipientName
 *               - recipientPhone
 *               - shippingAddress
 *             properties:
 *               recipientName:
 *                 type: string
 *               recipientPhone:
 *                 type: string
 *               shippingAddress:
 *                 type: string
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: Checkout successful, order is pending payment
 *       400:
 *         description: Validation error or insufficient stock
 *       404:
 *         description: Cart not found
 */
router.post('/checkout', checkoutOrder);

/**
 * @swagger
 * /api/orders/{orderId}/pay:
 *   post:
 *     summary: Mock payment confirmation for an order
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Payment confirmed and status updated to paid
 *       400:
 *         description: Order not in pending state or expired
 *       404:
 *         description: Order not found
 */
router.post('/:orderId/pay', payMockOrder);

/**
 * @swagger
 * /api/orders/{orderId}/cancel:
 *   post:
 *     summary: Cancel an unpaid pending order and refund stock
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order cancelled and stock restored
 *       400:
 *         description: Order cannot be cancelled
 *       404:
 *         description: Order not found
 */
router.post('/:orderId/cancel', cancelMyOrder);

/**
 * @swagger
 * /api/orders/{orderId}/status:
 *   patch:
 *     summary: Update order status (Admin only)
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, paid, shipped, completed, cancelled]
 *               note:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       403:
 *         description: Admin privileges required
 */
router.patch('/:orderId/status', updateStatus);

/**
 * @swagger
 * /api/orders:
 *   get:
 *     summary: Get order history for current authenticated user
 *     tags: [Orders]
 *     responses:
 *       200:
 *         description: List of user orders
 */
router.get('/', getMyOrders);

/**
 * @swagger
 * /api/orders/{orderId}:
 *   get:
 *     summary: Get details of a specific order including items and timeline
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get('/:orderId', getOrderById);

/**
 * @swagger
 * /api/orders/{orderId}/tracking:
 *   get:
 *     summary: Get shipment tracking information and events timeline
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Tracking details with events timeline
 *       404:
 *         description: Order not found
 */
router.get('/:orderId/tracking', getOrderTracking);
router.get('/:orderId/timeline', getOrderTracking);

export default router;
