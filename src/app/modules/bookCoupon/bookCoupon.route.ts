import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';
import * as C from './bookCoupon.controller';

const router = Router();

// The preview is public now that ordering does not need an account, which
// makes it a way to test whether a guessed code exists. Codes are not secret
// — they are handed out to be typed in — but a script walking DMCSAKIB20,
// DMCRAFI20… should hit a wall long before a buyer retyping a code ever would.
// Signed-in buyers are not counted (see the order limiter for why that is safe:
// req.user exists only for a token that verified, so optionalAuth runs first).
const couponPreviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.COUPON_PREVIEW_LIMIT) || 40,
  skip: (req) => Boolean((req as any).user),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    valid: false,
    message: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার দেখুন। (Too many tries — wait a few minutes.)',
  },
});

// Viewing coupons and the payout report is the same "who is buying / what do we
// owe" territory as the order screens, so it rides on orders.read; changing a
// coupon (which moves real money at checkout) needs orders.write.
const read = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.read')];
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.write')];

// ── Checkout (any buyer, signed in or not) ──
// optionalAuth: a signed-in buyer's per-buyer limit is checked on their account,
// a guest's on the phone number the checkout sends along.
router.post('/validate', optionalAuth, couponPreviewLimiter, C.validateCoupon);

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
