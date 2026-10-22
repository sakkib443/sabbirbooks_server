/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { clientIpKey } from '../../utils/clientIp';
import { clampForUser } from '../order/managerScope';
import { IncompleteOrderService } from './incompleteOrder.service';

const router = express.Router();

// The checkout saves as the buyer types (debounced), so a real buyer sends a
// handful of these; a script filling the collection with junk hits the wall.
const trackLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.INCOMPLETE_ORDER_LIMIT) || 120,
  keyGenerator: clientIpKey, // the visitor, not our own proxy — see utils/clientIp
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests' },
});

// Manager, admin and Super Admin all see the list (22 Oct 2026). There is no
// money on it; a manager still only gets their own days (managerScope).
const staff = [authMiddleware, authorize('admin', 'manager'), requireCapability('orders.read')];
const owner = [authMiddleware, authorize('superAdmin')];

const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'Request failed' });
  }
};

// The checkout's autosave — public, no account needed.
router.post('/', trackLimiter, wrap((req) => IncompleteOrderService.track(req.body)));

router.get(
  '/',
  ...staff,
  wrap((req) => {
    const q: any = { ...(req.query as any) };
    const c = clampForUser((req as any).user, q.from, q.to);
    q.from = c.from;
    q.to = c.to;
    return IncompleteOrderService.list(q);
  })
);
router.patch('/:id', ...staff, wrap((req) => IncompleteOrderService.update(req.params.id, req.body)));
router.delete('/:id', ...owner, wrap((req) => IncompleteOrderService.remove(req.params.id)));

export const IncompleteOrderRoutes = router;
