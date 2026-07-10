import { Router } from 'express';
import { authMiddleware, authorize } from '../../middlewares/auth';
import * as C from './coupon.controller';

const router = Router();

// ── Student (checkout) ──
router.post('/validate', authMiddleware, C.validateCoupon);

// ── Admin / Training Manager ──
router.get('/', authMiddleware, authorize('admin', 'trainingManager'), C.getAllCoupons);
router.post('/', authMiddleware, authorize('admin', 'trainingManager'), C.createCoupon);
router.patch('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.updateCoupon);
router.delete('/:id', authMiddleware, authorize('admin', 'trainingManager'), C.deleteCoupon);

export const CourseCouponRoutes = router;
