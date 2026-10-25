import * as orderService from '../services/orderService.js';

/**
 * Handle checkout: convert cart to pending order, deduct stock, generate orderNo
 */
export const checkoutOrder = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { recipientName, recipientPhone, shippingAddress, note } = req.body;

        if (!recipientName || !recipientPhone || !shippingAddress) {
            return res.status(400).json({
                message: 'recipientName, recipientPhone, and shippingAddress are required'
            });
        }

        const result = await orderService.checkout(userId, {
            recipientName: recipientName.trim(),
            recipientPhone: recipientPhone.trim(),
            shippingAddress: shippingAddress.trim(),
            note: note ? note.trim() : null
        });

        return res.status(201).json({
            message: 'Checkout successful. Order is pending payment.',
            order: result.order,
            items: result.items
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};

/**
 * Handle mock payment: advance order from pending to paid
 */
export const payMockOrder = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const updatedOrder = await orderService.payOrder(parseInt(orderId, 10), userId);

        return res.status(200).json({
            message: 'Payment completed successfully (Mock).',
            order: updatedOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};

/**
 * Cancel unpaid pending order (User or Admin)
 */
export const cancelMyOrder = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;
        const { reason } = req.body;
        const isAdmin = req.user?.role === 'admin';

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const cancelledOrder = await orderService.cancelOrder(
            parseInt(orderId, 10),
            userId,
            reason || (isAdmin ? 'admin' : 'Customer cancelled'),
            isAdmin
        );

        return res.status(200).json({
            message: 'Order cancelled successfully and stock refunded.',
            order: cancelledOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};

/**
 * Update order status (Admin)
 */
export const updateStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, note } = req.body;
        const userId = req.user?.userId;

        if (req.user?.role !== 'admin') {
            return res.status(403).json({ message: 'Forbidden. Admin privileges required.' });
        }

        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        const updatedOrder = await orderService.updateOrderStatus(
            parseInt(orderId, 10),
            status,
            userId,
            note
        );

        return res.status(200).json({
            message: 'Order status updated successfully',
            order: updatedOrder
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};

/**
 * Get user order history
 */
export const getMyOrders = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const orders = await orderService.getUserOrders(userId);

        return res.status(200).json({
            orders
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};

/**
 * Get specific order details with items and timeline
 */
export const getOrderById = async (req, res) => {
    try {
        const userId = req.user?.userId;
        const { orderId } = req.params;
        const isAdmin = req.user?.role === 'admin';

        if (!orderId) {
            return res.status(400).json({ message: 'Valid orderId is required' });
        }

        const order = await orderService.getOrderDetails(
            parseInt(orderId, 10),
            userId,
            isAdmin
        );

        return res.status(200).json({
            order
        });
    } catch (err) {
        return res.status(err.status || 500).json({ message: err.message });
    }
};
