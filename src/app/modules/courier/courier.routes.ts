import express, { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { CourierService } from './courier.service';
import { steadfastWebhookToken } from './steadfast.client';
import { clampForUser, dayRangeFor, rangeInstants } from '../order/managerScope';
import { OrderService } from '../order/order.service';

const router = express.Router();

// The courier pages are the owner's: they move parcels and they show money.
const read = [authMiddleware, authorize('admin'), requireCapability('orders.read')];
const write = [authMiddleware, authorize('admin'), requireCapability('orders.write')];

const uid = (req: Request) => {
  const u: any = (req as any).user;
  return u?._id ? String(u._id) : u?.id ? String(u.id) : null;
};

const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e?.message || 'Courier request failed' });
  }
};

/**
 * The query, narrowed to what this account may see: an admin's last fifteen
 * days (by when the parcel was sent, or the order placed on the send page);
 * a superAdmin's request goes through as asked.
 */
const scoped = (req: Request) => {
  const q: any = { ...(req.query as any) };
  const c = clampForUser((req as any).user, q.from, q.to);
  q.from = c.from;
  q.to = c.to;
  return q;
};

router.get('/status', ...read, wrap(() => CourierService.status()));
router.get('/filters', ...read, wrap(() => CourierService.filterChoices()));
router.get('/ready', ...read, wrap((req) => CourierService.listReady(scoped(req))));
router.get('/consignments', ...read, wrap((req) => CourierService.listConsignments(scoped(req))));
router.get('/summary', ...read, wrap((req) => CourierService.summary(scoped(req))));
router.get('/payments', ...read, wrap((req) => CourierService.listPayments(scoped(req))));

router.post(
  '/send',
  ...write,
  wrap(async (req) => {
    const ids = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : [];
    if (!ids.length) throw new Error('No orders selected');
    if (ids.length > 2000) throw new Error('Too many orders at once (max 2000)');
    const range = dayRangeFor((req as any).user);
    if (range && !(await OrderService.ordersWithinWindow(ids, rangeInstants(range)))) {
      throw new Error('Some of these orders are older than the last 15 days you can work on');
    }
    return CourierService.sendOrders(ids, uid(req));
  })
);

router.post(
  '/sync',
  ...write,
  wrap((req) =>
    CourierService.syncStatuses({
      ids: Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(String) : undefined,
      limit: 1000,
    })
  )
);

router.post('/payments/sync', ...write, wrap(() => CourierService.syncPayments()));

/**
 * Steadfast's webhook. Public, so it is guarded by the Bearer token set in the
 * Steadfast panel and in STEADFAST_WEBHOOK_TOKEN. No token configured = the
 * webhook is off (refused), never open.
 */
router.post('/webhook/steadfast', async (req: Request, res: Response) => {
  const expected = steadfastWebhookToken();
  const auth = String(req.headers.authorization || '');
  const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const ok =
    Boolean(expected) &&
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  try {
    await CourierService.handleWebhook(req.body);
    res.json({ status: 'success', message: 'Webhook received' });
  } catch (e: any) {
    console.error('[courier] webhook failed:', e);
    res.status(500).json({ status: 'error', message: 'Could not process' });
  }
});

export const CourierRoutes = router;
