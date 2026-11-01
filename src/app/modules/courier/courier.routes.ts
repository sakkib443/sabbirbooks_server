import express, { Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';
import { CourierService } from './courier.service';
import { steadfastWebhookToken } from './steadfast.client';
import { pathaoWebhookSecret } from './pathao.client';
import { clampForUser, dayRangeFor, rangeInstants } from '../order/managerScope';
import { OrderService } from '../order/order.service';
import { moneyBlindResponses } from '../order/managerScope';

const router = express.Router();
// Money blanked for accounts not shown money (admin, manager) — managerScope.
router.use(moneyBlindResponses());

// The courier pages are the owner's: they move parcels and they show money.
// courier.manage (18 Oct 2026): the Super Admin decides who runs the courier —
// an admin by default, a manager only if given it. Money stays blanked for a
// manager (moneyBlindResponses) and the totals are the Super Admin's.
const read = [authMiddleware, authorize('admin', 'manager'), requireCapability('courier.manage')];
const write = [authMiddleware, authorize('admin', 'manager'), requireCapability('courier.manage')];
// The courier's money, all time — the Super Admin's alone (authorize() with a
// role nobody else holds; superAdmin always passes).
const owner = [authMiddleware, authorize('superAdmin')];

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

// The buyer's tracking page — public, by tracking code, nothing personal.
router.get('/track/:code', async (req: Request, res: Response) => {
  try {
    const data = await CourierService.publicTrack(String(req.params.code));
    if (!data) return res.status(404).json({ success: false, message: 'Parcel not found' });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Could not load tracking' });
  }
});

router.get('/status', ...read, wrap((req) => CourierService.status((req as any).user?.role === 'superAdmin')));
router.get('/filters', ...read, wrap(() => CourierService.filterChoices()));
router.get('/ready', ...read, wrap((req) => CourierService.listReady(scoped(req))));
router.get('/consignments', ...read, wrap((req) => CourierService.listConsignments(scoped(req))));
router.get('/summary', ...owner, wrap((req) => CourierService.summary(scoped(req))));
// The courier money dashboard — Super Admin only (owner).
router.get('/dashboard', ...owner, wrap(() => CourierService.dashboard()));
router.get('/payments', ...owner, wrap((req) => CourierService.listPayments(scoped(req))));

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
    // Which courier (1 Nov 2026): Steadfast unless Pathao is asked for.
    const provider = req.body?.provider === 'pathao' ? 'pathao' : 'steadfast';
    return CourierService.sendOrders(ids, uid(req), provider);
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

router.post('/payments/sync', ...owner, wrap(() => CourierService.syncPayments()));

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

/**
 * Pathao's webhook (1 Nov 2026). Set in the Pathao panel → Developer API →
 * Webhook Integration: URL https://magicviva.com/api/courier/webhook/pathao
 * and a secret, the same as PATHAO_WEBHOOK_SECRET on the server.
 *
 * Pathao checks the URL first with an "webhook_integration" event and wants
 * 202 back carrying the X-Pathao-Merchant-Webhook-Integration-Secret header —
 * the value it sent, or the one set in PATHAO_WEBHOOK_INTEGRATION_SECRET.
 * Real events must carry X-PATHAO-Signature equal to our secret; with no
 * secret set the events are refused (the webhook is off, never open).
 */
const PATHAO_INTEGRATION_HEADER = 'X-Pathao-Merchant-Webhook-Integration-Secret';
router.post('/webhook/pathao', async (req: Request, res: Response) => {
  const integration =
    String(req.headers[PATHAO_INTEGRATION_HEADER.toLowerCase()] || '') ||
    String(process.env.PATHAO_WEBHOOK_INTEGRATION_SECRET || '') ||
    'f3992ecc-59da-4cbe-a049-a13da2018d51';
  res.set(PATHAO_INTEGRATION_HEADER, integration);
  if (String(req.body?.event || '') === 'webhook_integration') {
    return res.status(202).json({ status: 202, message: 'Webhook integration successful' });
  }
  const expected = pathaoWebhookSecret();
  const got = String(req.headers['x-pathao-signature'] || '');
  const ok =
    Boolean(expected) &&
    got.length === expected.length &&
    timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (!ok) return res.status(401).json({ status: 401, message: 'Invalid webhook signature' });
  try {
    await CourierService.handlePathaoWebhook(req.body);
    res.status(202).json({ status: 202, message: 'Webhook received' });
  } catch (e: any) {
    console.error('[courier] pathao webhook failed:', e);
    res.status(500).json({ status: 500, message: 'Could not process' });
  }
});

export const CourierRoutes = router;
