import { Router } from 'express';
import {
    checkoutOrder,
    payMockOrder,
    cancelMyOrder,
    updateStatus,
    getMyOrders,
    getOrderById,
    getOrderTracking
} from '../controllers/orderController.js';
import { authenticate } from '../middlewares/authMiddleware.js';

const router = Router();

// Protect all order routes with JWT authentication
router.use(authenticate);

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
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
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
