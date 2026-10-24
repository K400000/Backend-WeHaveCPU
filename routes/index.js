import { Router } from 'express';

// นำเข้า Routes ย่อย (ต้องใส่นามสกุล .js)
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import cartRoutes from './cartRoutes.js';
import orderRoutes from './orderRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';

const router = Router();

// กำหนด URL Prefix สำหรับแต่ละโมดูล
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
