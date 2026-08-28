import { Router } from 'express';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import * as C from './bookCoupon.controller';

const router = Router();

// Viewing coupons and the payout report is the same "who is buying / what do we
// owe" territory as the order screens, so it rides on orders.read; changing a
// coupon (which moves real money at checkout) needs orders.write.
const read = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.read')];
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.write')];

// ── Checkout (any logged-in buyer) ──
router.post('/validate', authMiddleware, C.validateCoupon);

// ── Coupon owner's own dashboard. Scoped to their coupons by ownerUser, so it
// needs no role or capability — being the owner is the whole gate. Declared
// before '/:id' so 'my' is not read as an id.
router.get('/my', authMiddleware, C.getMyCouponStats);

// ── Admin: report + list. `/payouts` before `/:id` so it is not read as an id. ──
router.get('/payouts', ...read, C.getPayouts);
router.get('/', ...read, C.getAllCoupons);
router.get('/:id', ...read, C.getCouponById);

// ── Admin: create / edit / delete ──
router.post('/', ...write, C.createCoupon);
router.patch('/:id', ...write, C.updateCoupon);
router.delete('/:id', ...write, C.deleteCoupon);

export const BookCouponRoutes = router;
