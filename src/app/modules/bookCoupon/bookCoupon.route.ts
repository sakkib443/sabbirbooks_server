import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';
import * as C from './bookCoupon.controller';
import { clientIpKey } from '../../utils/clientIp';

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
  keyGenerator: clientIpKey, // the visitor, not our own proxy — see utils/clientIp
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
// Creating, editing or deleting a coupon needs coupons.write (18 Oct 2026):
// an admin has it by default, a manager only if the Super Admin gives it.
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('coupons.write')];

// ── Checkout (any buyer, signed in or not) ──
// optionalAuth: a signed-in buyer's per-buyer limit is checked on their account,
// a guest's on the phone number the checkout sends along.
router.post('/validate', optionalAuth, couponPreviewLimiter, C.validateCoupon);

// ── Landing page pop-up: the one coupon the shop is advertising. Public. ──
router.get('/popup', C.getPopupCoupon);

// ── Coupon owner's own dashboard. Scoped to their coupons by ownerUser, so it
// needs no role or capability — being the owner is the whole gate. Declared
// before '/:id' so 'my' is not read as an id.
router.get('/my', authMiddleware, C.getMyCouponStats);

// ── Admin: report + list. `/payouts` before `/:id` so it is not read as an id. ──
// What is owed to each coupon owner: the admin sees it per coupon, the grand
// totals are blanked for them (moneyTotals below); a manager never sees it.
router.get('/payouts', authMiddleware, authorize('admin'), requireCapability('orders.read'), C.getPayouts);
router.get('/', ...read, C.getAllCoupons);
router.get('/:id', ...read, C.getCouponById);

// ── Admin: create / edit / delete ──
router.post('/', ...write, C.createCoupon);
router.patch('/:id', ...write, C.updateCoupon);
// Deleting is never a manager's (records.delete), as everywhere else.
router.delete('/:id', ...write, requireCapability('records.delete'), C.deleteCoupon);

export const BookCouponRoutes = router;
