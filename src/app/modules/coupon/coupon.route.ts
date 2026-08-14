import { Router } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import * as C from './coupon.controller';

const router = Router();

// Coupons discount real money — a training operation. Role list unchanged.
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager'),
  requireCapability('training.manage'),
];

// ── Student (checkout) ──
router.post('/validate', authMiddleware, C.validateCoupon);

// ── Admin / Training Manager ──
router.get('/', ...trainingWrite, C.getAllCoupons);
router.post('/', ...trainingWrite, C.createCoupon);
router.patch('/:id', ...trainingWrite, C.updateCoupon);
router.delete('/:id', ...trainingWrite, C.deleteCoupon);

export const CourseCouponRoutes = router;
