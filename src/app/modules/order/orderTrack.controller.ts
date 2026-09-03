/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Where is my book?" — answered from the home page, without signing in.
 *
 * WHY NO LOGIN
 *
 * The shop's buyers order on a phone, often without ever setting a password,
 * and then want one thing: is it coming. Making them find the account they may
 * not remember creating, to read a delivery status, is the friction the shop
 * asked to remove.
 *
 * WHAT THAT COSTS, AND WHAT IS DONE ABOUT IT
 *
 * A phone number is not a secret. Anyone who has one can look it up here, and
 * a determined person could walk a range of numbers. So this endpoint returns
 * the LEAST that answers the question and nothing that would be worth
 * harvesting:
 *
 *   returned   order number, when it was placed, what was bought, how much,
 *              and where it has got to
 *   withheld   the buyer's name, their address, their email, the coupon they
 *              used, and any note they left
 *
 * Knowing that 01712345678 ordered a book on Tuesday is close to worthless.
 * Knowing where they live is not, so that never leaves the server.
 *
 * The rate limit is per phone number rather than per IP, for the same reason
 * the code redemption is per account: a medical college hostel is one IP, and
 * locking it out because one person mistyped would be worse than the scraping
 * it prevents.
 */
import { Request, Response } from 'express';
import { Order } from './order.model';

/** How many lookups one number may drive before it has to wait. */
const LOOKUP_LIMIT = 20;
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const lookups = new Map<string, { n: number; until: number }>();

const rateLimited = (key: string): boolean => {
  const now = Date.now();
  const rec = lookups.get(key);
  if (!rec || rec.until < now) {
    lookups.set(key, { n: 1, until: now + LOOKUP_WINDOW_MS });
    if (lookups.size > 5000) for (const [k, v] of lookups) if (v.until < now) lookups.delete(k);
    return false;
  }
  rec.n += 1;
  return rec.n > LOOKUP_LIMIT;
};

/**
 * Every way a Bangladeshi number gets typed, as one comparable string.
 *
 * The same person is 01712345678 at checkout and +8801712345678 in their
 * contacts. Matching the raw string would tell half of them their order does
 * not exist, so both sides are reduced to the last ten digits — which is the
 * part that identifies the subscriber.
 */
const last10 = (raw: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
};

/**
 * How far along the parcel is, as a step number the page can draw.
 *
 * Read from the STATUS first and the timestamps second, and that order matters.
 * The fulfilment timestamps (confirmedAt, shippedAt, deliveredAt) were added
 * after the shop had been taking orders for a while, so an order can be
 * genuinely delivered and carry none of them. Drawing the line from timestamps
 * alone tells that buyer their delivered parcel is still "placed", which is the
 * single most alarming thing this page could say.
 *
 *   0 placed   1 confirmed   2 shipped   3 delivered   -1 cancelled
 */
const STATUS_STAGE: Record<string, number> = {
  pending: 0,
  paid: 1,
  processing: 1,
  'access-granted': 1,
  shipped: 2,
  delivered: 3,
};

const stageOf = (order: any): number => {
  if (order?.status === 'cancelled') return -1;
  const byStatus = STATUS_STAGE[order?.status] ?? 0;
  const byStamp = order?.deliveredAt ? 3 : order?.shippedAt ? 2 : order?.confirmedAt ? 1 : 0;
  // Whichever says "further along" wins: a status of delivered on an order
  // with no stamps, and a shippedAt on an order whose status was never moved
  // past processing, are both real situations in this data.
  return Math.max(byStatus, byStamp);
};

/**
 * POST /api/orders/track  { phone }
 *
 * POST rather than GET on purpose: a phone number in a query string ends up in
 * the browser's history, the server's access log and any proxy in between.
 */
export const trackByPhone = async (req: Request, res: Response) => {
  try {
    const tail = last10(req.body?.phone);
    if (!tail) {
      return res.status(400).json({
        success: false,
        message: 'সঠিক মোবাইল নম্বর দিন। (Enter a valid mobile number.)',
      });
    }

    if (rateLimited(tail)) {
      return res.status(429).json({
        success: false,
        message: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার দেখুন। (Too many lookups — try again shortly.)',
      });
    }

    // Anchored at the end, so 01712345678 and +8801712345678 both match, and a
    // short number cannot match everyone by being a prefix of them.
    const rx = new RegExp(`${tail}$`);
    const orders = await Order.find({ 'shippingAddress.phone': { $regex: rx } })
      .select(
        'orderNumber createdAt status deliveryType total items.title items.quantity ' +
          'payment.method payment.status confirmedAt shippedAt deliveredAt cancelledAt courierName trackingCode'
      )
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      data: orders.map((o: any) => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        total: o.total,
        paymentMethod: o.payment?.method || null,
        paymentStatus: o.payment?.status || null,
        items: (o.items || []).map((i: any) => ({ title: i.title, quantity: i.quantity })),
        // How far along, as a number — computed here so the page only draws.
        // -1 cancelled, 0 placed, 1 confirmed, 2 shipped, 3 delivered.
        stage: stageOf(o),
        // The dates behind it, for the ones that have them. A null here means
        // "we did not record when", not "it has not happened" — `stage` is the
        // authority on what has happened.
        timeline: {
          placed: o.createdAt,
          confirmed: o.confirmedAt || null,
          shipped: o.shippedAt || null,
          delivered: o.deliveredAt || null,
          cancelled: o.cancelledAt || null,
        },
        courierName: o.courierName || '',
        trackingCode: o.trackingCode || '',
      })),
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
