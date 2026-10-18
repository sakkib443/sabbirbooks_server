/**
 * The shop's side of the courier: hand orders over, keep their status in step,
 * and keep the books on what the courier owes and has paid.
 *
 * Money words used throughout (and on the admin pages):
 *   codAmount        what the courier is asked to collect from the buyer
 *   collectedAmount  what it reports collecting (0 on a return)
 *   deliveryCharge   what the courier keeps for the parcel (it reports this)
 *   paid out         a Steadfast payout that has settled the parcel
 *   receivable       collected − charge, on delivered parcels not yet paid out
 */

import { Types } from 'mongoose';
import { Order } from '../order/order.model';
import { OrderService } from '../order/order.service';
import { CourierPayment } from './courierPayment.model';
import { addDays, bdDate } from '../../utils/shopDay';
import {
  createBulk,
  getBalance,
  getPayment,
  listPayments,
  statusByConsignment,
  steadfastConfigured,
  SteadfastParcel,
  trackingPage,
} from './steadfast.client';

// ─── Status groups ──────────────────────────────────────────

export type CourierGroup = 'transit' | 'delivered' | 'partial' | 'returned';

/** Steadfast's word → the four groups the pages filter by. */
export const groupOf = (status?: string | null): CourierGroup => {
  const s = String(status || '').toLowerCase();
  if (s.startsWith('partial_delivered')) return 'partial';
  if (s.startsWith('delivered')) return 'delivered';
  if (s.startsWith('cancelled')) return 'returned';
  return 'transit';
};

/** Raw statuses in each group, for queries. */
export const STATUSES_BY_GROUP: Record<CourierGroup, string[]> = {
  transit: ['in_review', 'pending', 'hold', 'unknown', 'unknown_approval_pending'],
  delivered: ['delivered', 'delivered_approval_pending'],
  partial: ['partial_delivered', 'partial_delivered_approval_pending'],
  returned: ['cancelled', 'cancelled_approval_pending'],
};

/** Settled for good — no need to ask the courier again. */
const FINAL = new Set(['delivered', 'partial_delivered', 'cancelled']);

// ─── Helpers ────────────────────────────────────────────────

/** 01XXXXXXXXX — the 11 digits Steadfast accepts, or '' if it is not a BD mobile. */
const phone11 = (raw?: string): string => {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.startsWith('0088')) d = d.slice(3);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return /^01[3-9]\d{8}$/.test(d) ? d : '';
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

const addressOf = (o: any): string => {
  const a = o.shippingAddress || {};
  const parts = [a.address, a.upazila || a.city, a.district].map((p) => String(p || '').trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p.toLowerCase()) ? false : (seen.add(p.toLowerCase()), true)));
  return clip(unique.join(', '), 250);
};

/** What the courier should collect: the whole total on an unpaid COD order, nothing on a prepaid one. */
const codFor = (o: any): number =>
  String(o.payment?.method || '') === 'cod' && o.payment?.status !== 'paid' ? Math.round(Number(o.total) || 0) : 0;

const itemsText = (o: any) =>
  clip((o.items || []).map((i: any) => `${i.title} x${i.quantity || 1}`).join(', '), 200);

/**
 * Orders that may be handed to the courier now: confirmed (or paid online).
 * Not pending — that is an order the admin is holding back, or a manual
 * payment nobody has checked yet.
 */
const READY_FILTER = {
  status: { $in: ['paid', 'processing'] },
  deliveryType: { $in: ['printed', 'mixed'] },
  'courier.consignmentId': { $exists: false },
};

// ─── Send ───────────────────────────────────────────────────

export interface SendResult {
  orderId: string;
  orderNumber: string;
  ok: boolean;
  consignmentId?: string;
  trackingCode?: string;
  error?: string;
}

/**
 * Hand orders to Steadfast in one bulk request (chunks of 500).
 *
 * Each order is checked first and refused with a reason rather than sent with
 * bad data: no phone, already sent, cancelled, digital. A parcel the courier
 * accepted is stamped on the order and the order moves to "shipped" through
 * the same path as the admin's Shipped button — so the buyer gets the shipped
 * SMS carrying the courier's tracking link.
 */
const sendOrders = async (ids: string[], userId?: string | null): Promise<SendResult[]> => {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  const orders: any[] = await Order.find({ _id: { $in: valid } }).lean();
  const results: SendResult[] = [];
  const parcels: { order: any; parcel: SteadfastParcel }[] = [];

  for (const o of orders) {
    const base = { orderId: String(o._id), orderNumber: o.orderNumber };
    const reason =
      o.courier?.consignmentId ? 'Already sent to the courier'
      : o.status === 'cancelled' ? 'Order is cancelled'
      : o.status === 'delivered' ? 'Order is already delivered'
      : o.status === 'pending' ? 'Order is pending — confirm it first'
      : o.deliveryType === 'digital' ? 'Digital order — nothing to ship'
      : !o.shippingAddress ? 'No delivery address'
      : !phone11(o.shippingAddress.phone) ? 'Phone number is not a valid BD mobile'
      : !addressOf(o) ? 'No delivery address'
      : null;
    if (reason) {
      results.push({ ...base, ok: false, error: reason });
      continue;
    }
    const alt = phone11(o.shippingAddress.altPhone);
    parcels.push({
      order: o,
      parcel: {
        invoice: o.orderNumber,
        recipient_name: clip(String(o.shippingAddress.name || 'Customer').trim(), 100),
        recipient_phone: phone11(o.shippingAddress.phone),
        ...(alt && alt !== phone11(o.shippingAddress.phone) ? { alternative_phone: alt } : {}),
        recipient_address: addressOf(o),
        cod_amount: codFor(o),
        item_description: itemsText(o),
        ...(o.shippingAddress.note ? { note: clip(String(o.shippingAddress.note), 200) } : {}),
      },
    });
  }

  for (let i = 0; i < parcels.length; i += 500) {
    const chunk = parcels.slice(i, i + 500);
    let rows;
    try {
      rows = await createBulk(chunk.map((c) => c.parcel));
    } catch (e: any) {
      for (const c of chunk) results.push({ orderId: String(c.order._id), orderNumber: c.order.orderNumber, ok: false, error: e.message });
      continue;
    }
    const byInvoice = new Map(rows.map((r) => [String(r.invoice), r]));
    for (const c of chunk) {
      const r = byInvoice.get(c.order.orderNumber);
      const base = { orderId: String(c.order._id), orderNumber: c.order.orderNumber };
      if (!r || r.status !== 'success' || !r.consignment_id) {
        results.push({ ...base, ok: false, error: r?.error || r?.message || 'Courier did not accept this parcel' });
        continue;
      }
      const consignmentId = String(r.consignment_id);
      const trackingCode = String(r.tracking_code || '');
      const now = new Date();
      await Order.updateOne(
        { _id: c.order._id },
        {
          $set: {
            courier: {
              provider: 'steadfast',
              consignmentId,
              trackingCode,
              status: 'in_review',
              statusUpdatedAt: now,
              lastMessage: '',
              codAmount: c.parcel.cod_amount,
              collectedAmount: 0,
              deliveryCharge: null,
              sentAt: now,
              sentBy: userId && Types.ObjectId.isValid(userId) ? userId : undefined,
              paymentId: null,
              paidOutAt: null,
              history: [{ status: 'in_review', message: 'পার্সেল Steadfast কুরিয়ারে দেওয়া হয়েছে', at: now }],
            },
            courierName: 'Steadfast',
            trackingCode,
            ...(trackingCode ? { trackingUrl: trackingPage(trackingCode) } : {}),
          },
        }
      );
      // Stamps shippedAt, takes stock if not yet taken, sends the shipped SMS.
      try {
        await OrderService.updateOrderStatus(String(c.order._id), 'shipped');
      } catch (e) {
        console.error('[courier] sent, but could not mark shipped:', c.order.orderNumber, e);
      }
      results.push({ ...base, ok: true, consignmentId, trackingCode });
    }
  }
  return results;
};

// ─── Status ─────────────────────────────────────────────────

/**
 * Record a courier status on an order, and follow it through.
 *
 * Delivered (fully or partly) moves the order to delivered — on a COD order
 * that is also when the money is recorded as paid, exactly as the admin's
 * Delivered button does. A return is recorded but NOT turned into a
 * cancellation on its own: the books come back to the shop, and whether the
 * order is cancelled, re-sent or kept is the admin's call.
 */
const applyStatus = async (
  orderId: string,
  status: string,
  extra: { collected?: number; charge?: number; message?: string } = {}
) => {
  const order: any = await Order.findById(orderId).lean();
  if (!order?.courier) return;
  const s = String(status || '').toLowerCase();
  if (!s) return;
  const set: Record<string, unknown> = { 'courier.status': s, 'courier.statusUpdatedAt': new Date() };
  if (extra.message) set['courier.lastMessage'] = clip(extra.message, 300);
  if (typeof extra.charge === 'number' && extra.charge >= 0) set['courier.deliveryCharge'] = extra.charge;
  const g = groupOf(s);
  if (g === 'delivered') set['courier.collectedAmount'] = typeof extra.collected === 'number' ? extra.collected : order.courier.codAmount || 0;
  if (g === 'partial' && typeof extra.collected === 'number') set['courier.collectedAmount'] = extra.collected;
  if (g === 'returned') set['courier.collectedAmount'] = 0;
  // Each change of status — and each message the courier attaches — is kept,
  // newest last, so the buyer's tracking page can show the whole journey.
  const changed = s !== String(order.courier.status || '');
  const line = changed || extra.message
    ? { status: s, message: extra.message ? clip(extra.message, 300) : '', at: new Date() }
    : null;
  await Order.updateOne(
    { _id: order._id },
    line ? { $set: set, $push: { 'courier.history': { $each: [line], $slice: -80 } } } : { $set: set }
  );

  // Delivered on the courier's side is delivered on ours — including
  // "delivered_approval_pending" (the rider has handed it over; Steadfast's
  // own approval is paperwork). Until 18 Oct 2026 only the bare word counted,
  // so parcels showing "Delivered (approval)" left their orders on Shipped.
  if ((g === 'delivered' || g === 'partial') && order.status !== 'delivered' && order.status !== 'cancelled') {
    try {
      await OrderService.updateOrderStatus(String(order._id), 'delivered');
    } catch (e) {
      console.error('[courier] could not mark delivered:', order.orderNumber, e);
    }
  }
};

/**
 * Bring every order in line with its parcel, whatever was missed:
 *   • a parcel delivered (or partly) → the order is Delivered;
 *   • a parcel with the courier but the order still Pending/Paid/Confirmed
 *     → the order is Shipped (sending normally does this; a failure there
 *     must not leave the two disagreeing).
 * A cancelled order is left alone — that was somebody's decision. Returned
 * parcels are recorded on the parcel only; cancelling the order stays the
 * admin's call. Idempotent; runs after every status sync, on the courier
 * tick and at boot.
 */
const reconcileOrders = async () => {
  const deliveredStatuses = [...STATUSES_BY_GROUP.delivered, ...STATUSES_BY_GROUP.partial];
  const toDeliver: any[] = await Order.find({
    'courier.status': { $in: deliveredStatuses },
    status: { $nin: ['delivered', 'cancelled'] },
  })
    .select('_id orderNumber')
    .limit(1000)
    .lean();
  let delivered = 0;
  for (const o of toDeliver) {
    try {
      await OrderService.updateOrderStatus(String(o._id), 'delivered');
      delivered++;
    } catch (e) {
      console.error('[courier] reconcile: could not mark delivered:', o.orderNumber, e);
    }
  }

  const toShip: any[] = await Order.find({
    'courier.consignmentId': { $exists: true, $nin: [null, ''] },
    'courier.status': { $nin: [...deliveredStatuses, ...STATUSES_BY_GROUP.returned] },
    status: { $in: ['pending', 'paid', 'processing'] },
  })
    .select('_id orderNumber')
    .limit(1000)
    .lean();
  let shipped = 0;
  for (const o of toShip) {
    try {
      await OrderService.updateOrderStatus(String(o._id), 'shipped');
      shipped++;
    } catch (e) {
      console.error('[courier] reconcile: could not mark shipped:', o.orderNumber, e);
    }
  }
  return { delivered, shipped };
};

/** Ask the courier about parcels still on the way. */
const syncStatuses = async (opts: { ids?: string[]; limit?: number } = {}) => {
  const filter: Record<string, unknown> = {
    'courier.consignmentId': { $exists: true, $ne: null },
    'courier.status': { $nin: [...FINAL] },
  };
  if (opts.ids?.length) filter._id = { $in: opts.ids.filter((id) => Types.ObjectId.isValid(id)) };
  const orders: any[] = await Order.find(filter)
    .select('courier orderNumber status')
    .sort({ 'courier.statusUpdatedAt': 1 })
    .limit(Math.min(opts.limit || 300, 1000))
    .lean();

  let checked = 0;
  let changed = 0;
  let failed = 0;
  // Five at a time: fast enough, gentle on the courier's API.
  for (let i = 0; i < orders.length; i += 5) {
    await Promise.all(
      orders.slice(i, i + 5).map(async (o) => {
        try {
          const st = await statusByConsignment(o.courier.consignmentId);
          checked++;
          if (st && st !== o.courier.status) {
            await applyStatus(String(o._id), st);
            changed++;
          } else {
            await Order.updateOne({ _id: o._id }, { $set: { 'courier.statusUpdatedAt': new Date() } });
          }
        } catch {
          failed++;
        }
      })
    );
  }
  const reconciled = await reconcileOrders();
  return { checked, changed, failed, remaining: orders.length - checked - failed, reconciled };
};

/** Steadfast's webhook: a delivery status or a tracking message for one parcel. */
const handleWebhook = async (payload: any) => {
  const cid = payload?.consignment_id != null ? String(payload.consignment_id) : '';
  const invoice = String(payload?.invoice || '');
  const order: any = await Order.findOne(
    cid ? { 'courier.consignmentId': cid } : { orderNumber: invoice }
  )
    .select('_id')
    .lean();
  if (!order) return { found: false };
  const type = String(payload?.notification_type || '');
  if (type === 'tracking_update') {
    const message = clip(String(payload.tracking_message || ''), 300);
    const when = payload?.updated_at ? new Date(String(payload.updated_at).replace(' ', 'T') + '+06:00') : new Date();
    const at = Number.isNaN(when.getTime()) ? new Date() : when;
    await Order.updateOne(
      { _id: order._id },
      {
        $set: { 'courier.lastMessage': message, 'courier.statusUpdatedAt': new Date() },
        ...(message ? { $push: { 'courier.history': { $each: [{ status: '', message, at }], $slice: -80 } } } : {}),
      }
    );
    return { found: true };
  }
  await applyStatus(String(order._id), String(payload?.status || ''), {
    collected: payload?.cod_amount != null ? Number(payload.cod_amount) : undefined,
    charge: payload?.delivery_charge != null ? Number(payload.delivery_charge) : undefined,
    message: payload?.tracking_message ? String(payload.tracking_message) : undefined,
  });
  return { found: true };
};

// ─── Payouts ────────────────────────────────────────────────

/**
 * Copy the courier's payouts, and mark the parcels each one settled.
 * A payout already copied is only re-read if its amount or status changed.
 */
const syncPayments = async () => {
  const list = await listPayments();
  let added = 0;
  let updated = 0;
  for (const p of list) {
    const paymentId = String(p.id);
    const existing: any = await CourierPayment.findOne({ provider: 'steadfast', paymentId }).lean();
    if (existing && existing.amount === Number(p.amount) && existing.status === String(p.status || '')) continue;
    const full = await getPayment(paymentId);
    const consignments = (full.consignments || []).map((c) => ({
      consignmentId: String(c.consignment_id),
      invoice: String(c.invoice || ''),
      trackingCode: String(c.tracking_code || ''),
      codAmount: Number(c.cod_amount) || 0,
      deliveryCharge: Number(c.delivery_charge) || 0,
      status: String(c.status || ''),
    }));
    const paidAt = p.created_at ? new Date(p.created_at) : new Date();
    await CourierPayment.updateOne(
      { provider: 'steadfast', paymentId },
      {
        $set: {
          amount: Number(p.amount) || 0,
          status: String(p.status || ''),
          paidAt,
          consignments,
          codTotal: consignments.reduce((a, c) => a + c.codAmount, 0),
          chargeTotal: consignments.reduce((a, c) => a + c.deliveryCharge, 0),
        },
      },
      { upsert: true }
    );
    if (existing) updated++;
    else added++;
    for (const c of consignments) {
      await Order.updateOne(
        { $or: [{ 'courier.consignmentId': c.consignmentId }, { orderNumber: c.invoice }], courier: { $exists: true } },
        {
          $set: {
            'courier.paymentId': paymentId,
            'courier.paidOutAt': paidAt,
            'courier.deliveryCharge': c.deliveryCharge,
            'courier.collectedAmount': c.codAmount,
          },
        }
      );
    }
  }
  return { payments: list.length, added, updated };
};

// ─── Lists and money ────────────────────────────────────────

export interface CourierListQuery {
  group?: string;
  from?: string;
  to?: string;
  college?: string;
  district?: string;
  settled?: string; // 'yes' | 'no'
  payment?: string; // 'cod' | 'prepaid'
  q?: string;
  page?: string | number;
  limit?: string | number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Everything but the status tab — shared by the list and its tab counts. */
const baseFilter = (q: CourierListQuery, dateField: string) => {
  const f: Record<string, unknown> = {};
  const range: Record<string, Date> = {};
  if (q.from) range.$gte = new Date(q.from);
  if (q.to) range.$lt = new Date(q.to);
  if (Object.keys(range).length) f[dateField] = range;
  if (q.college) f['college.name'] = q.college;
  if (q.district) f.$or = [{ 'college.district': q.district }, { 'shippingAddress.district': q.district }];
  if (q.payment === 'cod') f['payment.method'] = 'cod';
  if (q.payment === 'prepaid') f['payment.method'] = { $ne: 'cod' };
  if (q.settled === 'yes') f['courier.paymentId'] = { $nin: [null, ''] };
  if (q.settled === 'no') f['courier.paymentId'] = { $in: [null, ''] };
  const text = String(q.q || '').trim();
  if (text) {
    const re = new RegExp(escapeRe(text), 'i');
    const digits = text.replace(/\D/g, '');
    const or: Record<string, unknown>[] = [
      { orderNumber: re },
      { 'shippingAddress.name': re },
      { 'courier.consignmentId': text },
      { 'courier.trackingCode': re },
      { 'college.name': re },
    ];
    if (digits.length >= 4) or.push({ 'shippingAddress.phone': new RegExp(escapeRe(digits.slice(-10))) });
    f.$and = [...((f.$and as unknown[]) || []), { $or: or }];
  }
  return f;
};

const LIST_FIELDS =
  'orderNumber orderSeq status total deliveryCharge payment.method payment.status shippingAddress college items.title items.quantity courier createdAt dispatchDate';

const listConsignments = async (q: CourierListQuery) => {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
  const page = Math.max(Number(q.page) || 1, 1);
  const base = { ...baseFilter(q, 'courier.sentAt'), 'courier.consignmentId': { $exists: true, $ne: null } };
  const group = String(q.group || 'all') as CourierGroup | 'all';
  const filter = group !== 'all' && STATUSES_BY_GROUP[group] ? { ...base, 'courier.status': { $in: STATUSES_BY_GROUP[group] } } : base;

  const [rows, total, counts] = await Promise.all([
    Order.find(filter).select(LIST_FIELDS).sort({ 'courier.sentAt': -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
    Order.aggregate([{ $match: base }, { $group: { _id: '$courier.status', n: { $sum: 1 } } }]),
  ]);
  const tabs: Record<string, number> = { all: 0, transit: 0, delivered: 0, partial: 0, returned: 0 };
  for (const c of counts as { _id: string; n: number }[]) {
    tabs.all += c.n;
    tabs[groupOf(c._id)] += c.n;
  }
  return { rows: rows.map((r: any) => ({ ...r, courierGroup: groupOf(r.courier?.status) })), total, page, limit, tabs };
};

/** Confirmed orders not yet with the courier — the "send" page. */
const listReady = async (q: CourierListQuery) => {
  const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 1000);
  const f = baseFilter({ ...q, settled: undefined }, 'createdAt');
  // The day an order goes out is its dispatch date when the shop moved it.
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = new Date(q.from);
    if (q.to) range.$lt = new Date(q.to);
    delete f.createdAt;
    f.$and = [...((f.$and as unknown[]) || []), { $or: [{ dispatchDate: range }, { dispatchDate: null, createdAt: range }] }];
  }
  const filter = { ...f, ...READY_FILTER };
  const [rows, total] = await Promise.all([
    Order.find(filter).select(LIST_FIELDS).sort({ createdAt: 1 }).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { rows: rows.map((r: any) => ({ ...r, codAmount: codFor(r) })), total };
};

/** The money, over parcels sent in the window (or all time). */
const summary = async (q: CourierListQuery) => {
  const match = { ...baseFilter(q, 'courier.sentAt'), 'courier.consignmentId': { $exists: true, $ne: null } };
  const rows: any[] = await Order.find(match)
    .select('courier deliveryCharge payment.method total')
    .lean();

  const s = {
    parcels: rows.length,
    transit: 0,
    delivered: 0,
    partial: 0,
    returned: 0,
    codAsked: 0, // asked of buyers, all parcels
    codCollected: 0, // collected on delivered + partial
    codInTransit: 0, // still out with the courier
    courierCharges: 0, // charges the courier reported (delivered + returned)
    chargesUnknown: 0, // delivered/returned parcels whose charge is not reported yet
    buyerDeliveryFees: 0, // what buyers paid the shop for delivery
    paidOut: 0, // collected − charge on parcels the courier has paid out
    receivable: 0, // collected − charge on delivered parcels not yet paid out
    returnCharges: 0,
  };
  for (const r of rows) {
    const c = r.courier || {};
    const g = groupOf(c.status);
    s[g]++;
    const asked = Number(c.codAmount) || 0;
    const got = Number(c.collectedAmount) || 0;
    const charge = c.deliveryCharge == null ? null : Number(c.deliveryCharge) || 0;
    s.codAsked += asked;
    s.buyerDeliveryFees += Number(r.deliveryCharge) || 0;
    if (g === 'transit') s.codInTransit += asked;
    if (g === 'delivered' || g === 'partial') s.codCollected += got;
    if (g !== 'transit') {
      if (charge == null) s.chargesUnknown++;
      else s.courierCharges += charge;
      if (g === 'returned' && charge != null) s.returnCharges += charge;
    }
    const net = got - (charge || 0);
    if (c.paymentId) s.paidOut += net;
    else if (g === 'delivered' || g === 'partial') s.receivable += net;
  }

  const payRange: Record<string, Date> = {};
  if (q.from) payRange.$gte = new Date(q.from);
  if (q.to) payRange.$lt = new Date(q.to);
  const payAgg = await CourierPayment.aggregate([
    ...(Object.keys(payRange).length ? [{ $match: { paidAt: payRange } }] : []),
    { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  return {
    ...s,
    payoutsReceived: payAgg[0]?.amount || 0,
    payoutCount: payAgg[0]?.count || 0,
  };
};

/**
 * The courier money page as one dashboard (18 Oct 2026, modelled on
 * Steadfast's own merchant dashboard): what is with the courier right now,
 * the last 30 days, parcels booked each day by how they ended up, the latest
 * parcels, the last payout and what the courier still owes. Calendar days in
 * Bangladesh time. Super Admin only (the route).
 */
const dashboard = async () => {
  const today = bdDate();
  const firstDay = addDays(today, -29);
  const rows: any[] = await Order.find({ 'courier.consignmentId': { $exists: true, $nin: [null, ''] } })
    .select('orderSeq orderNumber shippingAddress.name courier.status courier.sentAt courier.codAmount courier.collectedAmount courier.deliveryCharge courier.paymentId courier.consignmentId')
    .lean();

  const days = Array.from({ length: 30 }, (_, i) => addDays(firstDay, i));
  const daily = new Map(days.map((d) => [d, { day: d, delivered: 0, transit: 0, partial: 0, returned: 0 }]));
  const s = {
    inReview: 0,
    processing: 0,
    codProcessing: 0,
    codProcessingAmount: 0,
    returns30: 0,
    bookedToday: 0,
    bookedYesterday: 0,
    booked30: 0,
    finished30: 0,
    delivered30: 0,
    receivable: 0,
    receivableParcels: 0,
    ended: { delivered: 0, transit: 0, partial: 0, returned: 0 },
  };
  const yesterday = addDays(today, -1);

  for (const r of rows) {
    const c = r.courier || {};
    const g = groupOf(c.status);
    const day = c.sentAt ? bdDate(new Date(c.sentAt)) : '';
    if (c.status === 'in_review') s.inReview++;
    else if (g === 'transit') s.processing++;
    const net = (Number(c.collectedAmount) || 0) - (Number(c.deliveryCharge) || 0);
    if ((g === 'delivered' || g === 'partial') && !c.paymentId) {
      s.receivable += net;
      s.receivableParcels++;
      s.codProcessing++;
      s.codProcessingAmount += Number(c.collectedAmount) || 0;
    }
    if (day === today) s.bookedToday++;
    if (day === yesterday) s.bookedYesterday++;
    const bucket = daily.get(day);
    if (bucket) {
      bucket[g]++;
      s.booked30++;
      s.ended[g]++;
      if (g !== 'transit') s.finished30++;
      if (g === 'delivered' || g === 'partial') s.delivered30++;
      if (g === 'returned') s.returns30++;
    }
  }

  const latest = [...rows]
    .filter((r) => r.courier?.sentAt)
    .sort((a, b) => new Date(b.courier.sentAt).getTime() - new Date(a.courier.sentAt).getTime())
    .slice(0, 8)
    .map((r) => ({
      _id: String(r._id),
      orderSeq: r.orderSeq ?? null,
      orderNumber: r.orderNumber,
      name: r.shippingAddress?.name || '',
      consignmentId: r.courier.consignmentId,
      sentAt: r.courier.sentAt,
      cod: Number(r.courier.codAmount) || 0,
      status: r.courier.status,
      group: groupOf(r.courier.status),
    }));

  const payments: any[] = await CourierPayment.find().sort({ paidAt: -1 }).limit(8).lean();
  const paidAgg = await CourierPayment.aggregate([{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]);

  let balance: number | null = null;
  if (steadfastConfigured()) {
    try {
      balance = await getBalance();
    } catch {
      balance = null;
    }
  }

  return {
    ...s,
    successRate: s.finished30 ? Math.round((s.delivered30 / s.finished30) * 1000) / 10 : null,
    daily: [...daily.values()],
    latest,
    lastPayment: payments[0]
      ? { paymentId: payments[0].paymentId, amount: payments[0].amount, paidAt: payments[0].paidAt, status: payments[0].status, parcels: payments[0].consignments?.length || 0 }
      : null,
    payments: payments.map((p) => ({ paymentId: p.paymentId, amount: p.amount, paidAt: p.paidAt, status: p.status, parcels: p.consignments?.length || 0 })),
    paidOutAllTime: paidAgg[0]?.amount || 0,
    payoutCount: paidAgg[0]?.count || 0,
    balance,
  };
};

const listPaymentsLocal = async (q: { from?: string; to?: string }) => {
  const f: Record<string, unknown> = {};
  const range: Record<string, Date> = {};
  if (q.from) range.$gte = new Date(q.from);
  if (q.to) range.$lt = new Date(q.to);
  if (Object.keys(range).length) f.paidAt = range;
  return CourierPayment.find(f).sort({ paidAt: -1 }).limit(500).lean();
};

/** Is the courier set up, and what is the merchant balance right now? */
// The balance is money, so only the Super Admin is told it; everyone else
// still learns whether the connection works.
const status = async (withBalance = false) => {
  if (!steadfastConfigured()) return { configured: false, balance: null, error: null };
  try {
    const balance = await getBalance();
    return { configured: true, balance: withBalance ? balance : null, error: null };
  } catch (e: any) {
    return { configured: true, balance: null, error: e.message };
  }
};

/** College and district choices for the filters, from parcels and ready orders. */
const filterChoices = async () => {
  const [colleges, districts] = await Promise.all([
    Order.distinct('college.name', { status: { $ne: 'cancelled' } }),
    Order.distinct('shippingAddress.district', { status: { $ne: 'cancelled' } }),
  ]);
  const clean = (a: unknown[]) => (a.filter(Boolean) as string[]).sort((x, y) => x.localeCompare(y));
  return { colleges: clean(colleges), districts: clean(districts) };
};

/**
 * The buyer's tracking page (/t/CODE on the site), by the courier's tracking
 * code. Public, so it answers only "where is my parcel": order serial, books,
 * status and the courier's timeline — no name, phone, address or money. The
 * status is refreshed from Steadfast at most every five minutes per parcel,
 * so reloading the page cannot hammer the courier's API.
 */
const publicTrack = async (code: string) => {
  const trackingCode = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(trackingCode)) return null;
  const find = () =>
    Order.findOne({ 'courier.trackingCode': trackingCode })
      .select('orderSeq orderNumber status items.title items.quantity courier.status courier.statusUpdatedAt courier.lastMessage courier.sentAt courier.consignmentId courier.trackingCode courier.history createdAt')
      .lean();
  let order: any = await find();
  if (!order) return null;

  const c = order.courier || {};
  const stale = !c.statusUpdatedAt || Date.now() - new Date(c.statusUpdatedAt).getTime() > 5 * 60_000;
  if (stale && !FINAL.has(String(c.status)) && c.consignmentId && steadfastConfigured()) {
    try {
      const s = await statusByConsignment(String(c.consignmentId));
      if (s) await applyStatus(String(order._id), s);
      else await Order.updateOne({ _id: order._id }, { $set: { 'courier.statusUpdatedAt': new Date() } });
      order = (await find()) || order;
    } catch (e) {
      console.error('[courier] tracking refresh failed:', (e as Error)?.message);
    }
  }

  const oc = order.courier || {};
  // The journey, newest first: every update the courier sent us (send, status
  // changes, its own tracking messages). Steadfast's public page cannot be
  // linked to — it needs a token the API does not give — so this is the page.
  const timeline = [...(oc.history || [])]
    .filter((h: any) => h && (h.message || h.status))
    .sort((a: any, b: any) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((h: any) => ({ text: String(h.message || ''), status: String(h.status || ''), at: h.at || null }));
  return {
    orderSeq: order.orderSeq ?? null,
    orderNumber: order.orderNumber,
    orderStatus: order.status,
    items: (order.items || []).map((i: any) => ({ title: i.title, quantity: i.quantity })),
    orderedAt: order.createdAt,
    courier: {
      status: oc.status || 'in_review',
      group: groupOf(oc.status),
      updatedAt: oc.statusUpdatedAt || null,
      message: oc.lastMessage || '',
      sentAt: oc.sentAt || null,
      consignmentId: oc.consignmentId || '',
      trackingCode: oc.trackingCode || trackingCode,
    },
    timeline,
  };
};

export const CourierService = {
  dashboard,
  reconcileOrders,
  publicTrack,
  sendOrders,
  syncStatuses,
  handleWebhook,
  syncPayments,
  listConsignments,
  listReady,
  summary,
  listPayments: listPaymentsLocal,
  status,
  filterChoices,
  applyStatus,
};
