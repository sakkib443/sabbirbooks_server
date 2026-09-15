/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import config from '../../config';
import { Order } from './order.model';
import { getNextSequence, ORDER_SEQ } from './counter.model';
import {
  IOrder,
  IShippingAddress,
  TDeliveryType,
  TDeliveryArea,
  TDeliveryRule,
} from './order.interface';
import { Book } from '../book/book.model';
import { priceBookUnit, hasOffers } from '../book/book.pricing';
import { BookCoupon } from '../bookCoupon/bookCoupon.model';
import { evaluateBookCoupon } from '../bookCoupon/bookCoupon.controller';
import { User } from '../user/user.model';
import { BkashService } from '../payment/bkash.service';
import { SslcommerzService } from '../payment/sslcommerz.service';
import { SettingsService } from '../settings/settings.services';
import { MedicalCollege } from '../medicalCollege/medicalCollege.model';
import { OrderAlertService } from '../notification/orderAlert.service';
import { OrderEmailService } from '../notification/orderEmail.service';
import { OrderSmsService } from '../notification/orderSms.service';

// Resolve a book by slug / numeric id / Mongo _id — same tolerant lookup the
// book module exposes publicly (client may send either a slug or an _id).
const resolveBook = async (slugOrId: string) => {
  const or: Record<string, unknown>[] = [{ slug: slugOrId }];
  if (!isNaN(Number(slugOrId))) or.push({ id: Number(slugOrId) });
  if (isValidObjectId(slugOrId)) or.push({ _id: slugOrId });
  return Book.findOne({ $or: or });
};

/** The college fields a delivery quote needs. */
type CollegeRate = {
  _id?: unknown;
  name?: string;
  district?: string;
  upazila?: string;
  deliveryCharge?: number | null;
};

const sameGeo = (a?: string, b?: string): boolean => {
  const norm = (s?: string) => String(s || '').trim().replace(/\s+/g, ' ');
  return norm(a) !== '' && norm(a) === norm(b);
};

/**
 * Does this college's own delivery rate apply to a parcel going here?
 *
 * Only when the college HAS a rate, and the parcel goes to the college's own
 * district and its own upazila. The rate is the shop's price for delivering to
 * that campus — sometimes by hand — so a Rajshahi Medical College student whose
 * book is going home to Narail pays the ordinary charge.
 *
 * Both halves must match, not just the district: two upazilas of one district
 * can be a long way apart, and several upazila names exist in more than one
 * district (কালীগঞ্জ is in four), so the district alone or the upazila alone
 * would each match parcels the rate was never meant for.
 *
 * Exact on the spelling, after trimming. The college's upazila and the
 * checkout's are both drawn from the same list (bdGeoData in the storefront),
 * so an honest address always matches; anything else pays the normal charge,
 * which is the safe way round.
 */
export const collegeRateApplies = (
  college: CollegeRate | null | undefined,
  district?: string,
  upazila?: string
): boolean => {
  if (!college) return false;
  const rate = college.deliveryCharge;
  if (rate === null || rate === undefined || !Number.isFinite(Number(rate)) || Number(rate) < 0) {
    return false;
  }
  return sameGeo(college.district, district) && sameGeo(college.upazila, upazila);
};

/**
 * What the courier fee for this order is, in taka, and which rule set it.
 *
 * Read from site settings and the college directory rather than hard-coded so
 * the shop owner can change rates without a deploy, and snapshotted onto the
 * order so a later rate change never rewrites an existing customer's total.
 * Digital-only orders ship nothing and are always free.
 *
 * In order:
 *   1. nothing printed                            → 0
 *   2. the order crosses freeDeliveryAbove         → 0
 *   3. the college has a rate and the parcel goes to its district + upazila
 *                                                  → that rate (+ COD surcharge;
 *                                                    a rate of 0 is simply free)
 *   4. otherwise                                   → deliveryCharge (+ COD surcharge)
 *
 * The two Khulna rules that used to be settings (a free college, a cheaper
 * district) are college rates now — see migrateLegacyDeliveryRates.
 */
const quoteDeliveryCharge = async (opts: {
  hasPrinted: boolean;
  subtotal: number;
  isCod: boolean;
  college?: CollegeRate | null;
  district?: string;
  upazila?: string;
}): Promise<{ charge: number; rule: TDeliveryRule }> => {
  if (!opts.hasPrinted) return { charge: 0, rule: 'digital' };

  const s: any = await SettingsService.getSettingsService();

  const freeAbove = Number(s?.freeDeliveryAbove) || 0;
  if (freeAbove > 0 && opts.subtotal >= freeAbove) return { charge: 0, rule: 'free-above' };

  const codExtra = opts.isCod ? Number(s?.codExtraCharge) || 0 : 0;

  if (collegeRateApplies(opts.college, opts.district, opts.upazila)) {
    const rate = Math.max(0, Math.round(Number(opts.college!.deliveryCharge)));
    // Free means free: a campus the shop delivers to for nothing does not
    // start costing money because the buyer chose to pay in cash.
    return { charge: rate === 0 ? 0 : rate + codExtra, rule: 'college' };
  }

  // One flat rate everywhere else. deliveryCharge is the live field; the old
  // inside-Dhaka value is the fallback for a settings doc written before it
  // existed, then the documented default.
  const flat = Number(s?.deliveryCharge);
  const legacy = Number(s?.deliveryChargeInsideDhaka);
  const charge = Number.isFinite(flat) ? flat : Number.isFinite(legacy) ? legacy : 130;

  return { charge: Math.max(0, Math.round(charge + codExtra)), rule: 'standard' };
};

/**
 * A Bangladeshi mobile number as 01XXXXXXXXX, or '' when it is not one.
 *
 * Every way the same number gets typed — 01712-345678, +880 1712 345678,
 * 8801712345678 — comes out as the same eleven digits, which is what the SMS
 * gateway, the courier sheet and the order tracker all compare on.
 */
export const normalizeBdMobile = (raw?: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.length === 13 && digits.startsWith('88') ? digits.slice(2) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? local : '';
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The access key: how a buyer without an account proves an order is theirs.
 *
 * Neither the order's _id nor its orderNumber can do that job — both travel in
 * payment redirect URLs and emails, and the number is a timestamp plus a short
 * random tail. The key is 24 random bytes, handed to the browser once in the
 * create response and never again; only its sha256 is stored.
 */
const newAccessKey = (): string => crypto.randomBytes(24).toString('base64url');
const hashAccessKey = (key: string): string =>
  crypto.createHash('sha256').update(key).digest('hex');

export const accessKeyMatches = (storedHash?: string, key?: string): boolean => {
  if (!storedHash || !key) return false;
  const given = Buffer.from(hashAccessKey(String(key)), 'hex');
  const stored = Buffer.from(String(storedHash), 'hex');
  return given.length === stored.length && crypto.timingSafeEqual(given, stored);
};

/** Who is acting on an order: a signed-in account, an access key, or both. */
export type OrderBuyer = { userId?: string; accessKey?: string };
const toBuyer = (b?: string | OrderBuyer): OrderBuyer =>
  typeof b === 'string' ? { userId: b } : b || {};

/**
 * Load an order for the person who placed it — the signed-in owner, or anyone
 * holding its access key. Anyone else gets "not found", never "forbidden", so
 * an id cannot be probed to learn that an order exists.
 */
const findOrderForBuyer = async (id: string, who?: string | OrderBuyer): Promise<any> => {
  const buyer = toBuyer(who);
  if (!isValidObjectId(id)) throw new Error('Order not found');
  const order: any = await Order.findById(id).select('+accessKeyHash');
  if (!order) throw new Error('Order not found');
  const isOwner = !!buyer.userId && !!order.user && String(order.user) === String(buyer.userId);
  if (!isOwner && !accessKeyMatches(order.accessKeyHash, buyer.accessKey)) {
    throw new Error('Order not found');
  }
  return order;
};

/**
 * The college this order is for.
 *
 * A directory id wins (the buyer picked a listed college); then a typed name,
 * matched to the directory when it is spelt exactly like a listed college;
 * then, for a signed-in buyer who sent neither — an older checkout still
 * running in someone's tab — the college on their profile.
 */
const resolveOrderCollege = async (
  payload: { medicalCollege?: string; medicalCollegeName?: string },
  userId?: string
): Promise<CollegeRate | null> => {
  const fields = 'name district upazila deliveryCharge';

  const id = String(payload.medicalCollege || '').trim();
  if (id && isValidObjectId(id)) {
    const c = await MedicalCollege.findOne({ _id: id, isActive: true }).select(fields).lean();
    if (c) return c as CollegeRate;
  }

  const typed = String(payload.medicalCollegeName || '').trim();
  if (typed) {
    const c = await MedicalCollege.findOne({ name: typed, isActive: true }).select(fields).lean();
    return c ? (c as CollegeRate) : { name: typed };
  }

  if (userId) {
    const buyer: any = await User.findById(userId).select('medicalCollege medicalCollegeName').lean();
    if (buyer?.medicalCollege && isValidObjectId(String(buyer.medicalCollege))) {
      const c = await MedicalCollege.findById(buyer.medicalCollege).select(fields).lean();
      if (c) return c as CollegeRate;
    }
    const name = String(buyer?.medicalCollegeName || '').trim();
    if (name) {
      const c = await MedicalCollege.findOne({ name }).select(fields).lean();
      return c ? (c as CollegeRate) : { name };
    }
  }

  return null;
};

/** How long an identical COD order from the same number counts as a double tap. */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Which courier zone a district belongs to.
 *
 * Deliberately an exact match rather than a fuzzy "does it look like Dhaka"
 * test. Every district we fail to recognise lands on the DEARER zone, which is
 * the only safe direction to be wrong in: guessing the other way would silently
 * under-charge the shop on every order from a district spelt in a way we did
 * not anticipate, and nobody would notice until the courier bills arrived.
 */
const areaForDistrict = (district: string): TDeliveryArea =>
  district.trim() === 'ঢাকা' ? 'inside-dhaka' : 'outside-dhaka';

/** Which payment methods the shop currently accepts. */
const getEnabledPaymentMethods = async (): Promise<{ cod: boolean; online: boolean }> => {
  const s: any = await SettingsService.getSettingsService();
  const cod = s?.codEnabled !== false;
  const online = s?.onlinePaymentEnabled !== false;
  // Both off would leave the checkout with no button at all; COD needs no
  // credentials, so it is the safe fallback.
  return cod || online ? { cod, online } : { cod: true, online: false };
};

// ─── CREATE ORDER ────────────────────────────────────────────
// Looks up each book, snapshots the effective unit price (offerPrice ?? price),
// computes subtotal/delivery/total server-side, and enforces shipping + stock
// for printed items.
//
// Nothing about the money is read from `payload`. It carries book references,
// quantities, an address and a payment method — that is the whole of it. A body
// that also contains `discount`, `subtotal` or `total` is not rejected, it is
// simply never consulted, because every one of those is recomputed below and
// only the computed locals are written to the document.
//
// The order is born `pending` either way. What differs is what happens next:
//   manual → buyer submits a TrxID, admin verifies it
//   cod    → admin confirms the order, then the courier collects the cash
//
// `userId` is absent for a guest. Everything an order needs from a buyer — the
// name, the numbers, the address, the college — arrives in the payload, so the
// account is only a link for the buyer's own order list, never a requirement.
const createOrder = async (
  userId: string | undefined,
  payload: {
    items: { bookSlugOrId: string; quantity: number }[];
    shippingAddress?: IShippingAddress;
    paymentMethod?: 'manual' | 'cod';
    couponCode?: string;
    medicalCollege?: string;
    medicalCollegeName?: string;
  }
): Promise<IOrder> => {
  const items: IOrder['items'] = [];
  let hasPrinted = false;
  let hasDigital = false;
  let hasPreOrder = false;
  // Accumulated unrounded so the whole order rounds once at the end — rounding
  // each line and summing drifts by a taka per line against what the client
  // showed the buyer.
  let orderDiscount = 0;

  // The online-payment offer applies to any method that is not cash on delivery.
  // The gateway path creates the order with no paymentMethod (→ online), COD sends
  // 'cod'. Decided up front so it can price each line below.
  const payingOnline = payload.paymentMethod !== 'cod';

  for (const line of payload.items) {
    const qty = line.quantity && line.quantity > 0 ? line.quantity : 1;
    const book = await resolveBook(line.bookSlugOrId);
    if (!book) {
      throw new Error(`Book not found: ${line.bookSlugOrId}`);
    }

    // Pre-order MODE — the new offers.preorder toggle or the legacy flag. Both
    // skip the stock check and mark the order a pre-order.
    const isPreOrderLine = book.isPreOrder === true || book.offers?.preorder?.enabled === true;
    if (isPreOrderLine) hasPreOrder = true;

    if (book.format === 'printed') {
      hasPrinted = true;
      // A pre-order is sold before the print run exists, so there is no stock to
      // check — gating on it would reject every single pre-order, which is the
      // entire point of the feature. Ordinary titles keep the check.
      if (!isPreOrderLine && (book.stock ?? 0) < qty) {
        throw new Error(`Insufficient stock for "${book.title}" (available: ${book.stock ?? 0})`);
      }
    } else {
      hasDigital = true;
    }

    // Two pricing paths, so a book saved before the offers system keeps its exact
    // old price. A book the admin has configured `offers` on is priced by the
    // shared helper: the line's unit is the catalogue price and every discount
    // (headline + online) is carried in `orderDiscount`. A legacy book keeps the
    // old effective-price-then-pre-order-percent behaviour untouched.
    let unitPrice: number;
    if (hasOffers(book)) {
      const p = priceBookUnit(book, { online: payingOnline });
      unitPrice = p.list;
      orderDiscount += (p.list - p.unitOnline) * qty;
    } else {
      // Effective unit price = offer price if set, else base price (0 when unset).
      unitPrice = book.offerPrice != null ? book.offerPrice : (book.price ?? 0);
      if (isPreOrderLine) {
        // Clamped here as well as in the book schema. The schema's min/max only
        // guards writes that went through it; this number comes off a stored
        // document and is about to be subtracted from a real invoice, so a row
        // that predates the limits (or was patched straight in the shell) must
        // not be able to price the order.
        const pct = Math.min(90, Math.max(0, Number(book.preOrderDiscountPercent ?? 25) || 0));
        orderDiscount += (unitPrice * qty * pct) / 100;
      }
    }

    items.push({
      book: book._id as any,
      title: book.title,
      price: unitPrice,
      quantity: qty,
      format: book.format ?? 'printed',
    });
  }

  const deliveryType: TDeliveryType =
    hasPrinted && hasDigital ? 'mixed' : hasPrinted ? 'printed' : 'digital';

  // A digital book is opened from the buyer's account — the download link checks
  // who is signed in — so a guest could pay for one and have no way to open it.
  // Without an account, printed books only; nothing is saved before this point.
  if (!userId && hasDigital) {
    throw new Error('ডিজিটাল বই কিনতে আগে লগইন করুন। (Please sign in to buy a digital book.)');
  }

  // Printed items ship — a full address is mandatory, and the numbers have to
  // be numbers a courier can ring and an SMS can reach. Now that a stranger can
  // order without an account, the phone is the only way back to them.
  let shipping: IShippingAddress | undefined;
  if (hasPrinted) {
    const addr = payload.shippingAddress;
    if (!addr || !addr.name?.trim() || !addr.phone || !addr.address?.trim() || !addr.city) {
      throw new Error('Shipping address (name, phone, address, city) is required for printed items');
    }
    const phone = normalizeBdMobile(addr.phone);
    if (!phone) {
      throw new Error(
        'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678। (Enter a valid Bangladeshi mobile number.)'
      );
    }
    let altPhone = '';
    if (String(addr.altPhone || '').trim()) {
      altPhone = normalizeBdMobile(addr.altPhone);
      if (!altPhone) {
        throw new Error(
          'দ্বিতীয় মোবাইল নম্বরটি সঠিক নয়। (The second mobile number is not a valid number.)'
        );
      }
      if (altPhone === phone) altPhone = '';
    }
    const email = String(addr.email || '').trim().toLowerCase();
    if (email && !EMAIL_SHAPE.test(email)) {
      throw new Error('ইমেইল ঠিকানাটি সঠিক নয়। (The email address is not valid.)');
    }
    shipping = {
      ...addr,
      name: addr.name.trim(),
      phone,
      altPhone,
      email,
      address: addr.address.trim(),
    };
  }

  const method = payload.paymentMethod === 'cod' ? 'cod' : 'manual';

  // A guest's double tap, or the same order placed again by someone who did not
  // see the first one go through. Only for a guest — an account can see its own
  // orders, and a signed-in repeat is a decision, not an accident — and only on
  // COD: nothing is paid, so a repeat costs the shop a parcel nobody wants. A
  // gateway order is different — an abandoned payment page leaves a pending
  // order behind for a while, and a buyer retrying must not be told they
  // already ordered. "Same" means the same books in the same quantities.
  if (!userId && method === 'cod' && shipping) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const lines = (list: any[]) =>
      list.map((i) => `${String(i.book)}x${Number(i.quantity) || 1}`).sort().join(',');
    const thisOrder = lines(items);
    const recent = await Order.find({
      'payment.method': 'cod',
      status: { $ne: 'cancelled' },
      createdAt: { $gte: since },
      'shippingAddress.phone': { $regex: new RegExp(`${shipping.phone.slice(-10)}$`) },
    })
      .select('items.book items.quantity')
      .lean();
    const same = recent.some((o: any) => lines(o.items || []) === thisOrder);
    if (same) {
      throw new Error(
        'এই মোবাইল নম্বরে কয়েক মিনিট আগেই একই বইয়ের অর্ডার হয়েছে। হোমপেজের "অর্ডার ট্র্যাক করুন" থেকে দেখে নিন; ' +
          'আরেকটা অর্ডার সত্যিই দরকার হলে ১০ মিনিট পর আবার চেষ্টা করুন। ' +
          '(This number placed the same order a few minutes ago.)'
      );
    }
  }

  // There is no parcel for a digital book, so nobody can hand over cash for it.
  if (method === 'cod' && !hasPrinted) {
    throw new Error('Cash on delivery is only available for printed books');
  }

  const enabled = await getEnabledPaymentMethods();
  if (method === 'cod' && !enabled.cod) {
    throw new Error('Cash on delivery is currently unavailable');
  }
  if (method === 'manual' && !enabled.online) {
    throw new Error('Online payment is currently unavailable');
  }

  const subtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  // Whole taka: nobody hands a courier 62.5tk, and the client renders this row
  // verbatim.
  const offersDiscount = Math.round(orderDiscount);

  // ── Coupon — stacks on top of the book's own offers ─────────────────────────
  // Evaluated against the product total AFTER those offers, so the code discounts
  // the already-reduced price (the buyer keeps their pre-order / online / normal
  // saving AND the coupon). Everything is snapshotted onto the order; the coupon's
  // usage tally is bumped only after the order is safely written.
  let couponCode: string | undefined;
  let couponDiscount = 0;
  let couponPayout = 0;
  let couponDocId: unknown = null;
  // Whether this code also waives the delivery charge. Held aside rather than
  // folded into couponDiscount because the delivery charge is not quoted until
  // further down — it depends on the college, the division and the paid total,
  // and the paid total depends on this discount. So the products are settled
  // here and the delivery is settled once there is a number to waive.
  let couponFreeDelivery = false;
  const rawCoupon = (payload.couponCode || '').trim();
  if (rawCoupon) {
    const afterOffers = Math.max(0, subtotal - offersDiscount);
    // Throws a buyer-friendly Error (expired / used up / wrong payment method)
    // which fails the order — the buyer explicitly applied the code and expects
    // its price, so silently dropping it and charging more than shown would be
    // worse than refusing.
    const { coupon, discountAmount } = await evaluateBookCoupon(rawCoupon, afterOffers, {
      userId,
      // A guest's "one use per buyer" is counted by phone number.
      phone: shipping?.phone,
      paymentMethod: method,
    });
    couponCode = coupon.code;
    couponDiscount = discountAmount;
    couponPayout = Math.max(0, Number(coupon.payoutPerSale) || 0);
    couponFreeDelivery = Boolean(coupon.freeDelivery);
    couponDocId = coupon._id;
  }

  // Grand total discount = the book's offers plus the coupon.
  const discount = offersDiscount + couponDiscount;

  // The buyer's medical college — required on EVERY order. The shop sells to
  // medical students and the college is how orders are batched and delivered,
  // and it is what a college's own delivery rate is looked up on.
  const college = await resolveOrderCollege(payload, userId);
  if (!college?.name) {
    throw new Error('মেডিকেল কলেজ নির্বাচন করুন। (Please choose your medical college.)');
  }
  const { charge: quotedDelivery, rule: deliveryRule } = await quoteDeliveryCharge({
    hasPrinted,
    subtotal: subtotal - discount,
    isCod: method === 'cod',
    college,
    district: shipping?.district,
    upazila: shipping?.upazila,
  });

  // A free-delivery coupon zeroes the charge rather than discounting the order
  // by the same amount. The distinction is not cosmetic: the delivery row is
  // what the buyer compares against the rider's demand, and an order that says
  // "Delivery ৳120" while having quietly taken ৳120 off elsewhere is the one
  // that generates the phone call. It waives what was actually quoted, so a
  // code used where delivery is already free is worth nothing, never negative.
  const deliveryWaived = couponFreeDelivery ? quotedDelivery : 0;
  const deliveryCharge = quotedDelivery - deliveryWaived;
  const total = subtotal - discount + deliveryCharge;

  // Human-friendly running number. Seeded to the current order count on first use
  // so an order placed before the backfill runs still sorts above the existing
  // rows the backfill numbers 1..N.
  const orderSeq = await getNextSequence(ORDER_SEQ, () => Order.countDocuments());

  const accessKey = newAccessKey();

  const order = await Order.create({
    user: userId || undefined,
    orderSeq,
    items,
    deliveryType,
    shippingAddress: hasPrinted ? shipping : undefined,
    college: {
      college: college._id,
      name: college.name,
      district: college.district || '',
      upazila: college.upazila || '',
    },
    deliveryRule,
    accessKeyHash: hashAccessKey(accessKey),
    subtotal,
    discount,
    couponCode,
    couponDiscount,
    couponPayout,
    deliveryWaived,
    deliveryCharge,
    total,
    isPreOrder: hasPreOrder,
    // COD records its method up front — there is no later "pay" step to set it,
    // and the admin queue filters on it.
    payment: method === 'cod' ? { method: 'cod', status: 'pending' } : { status: 'pending' },
    status: 'pending',
  });

  // Bump the coupon's usage tally — after the order is safely written, and never
  // fatal: a failed counter must not 500 a completed order (the payout report
  // counts orders directly, so this tally is a convenience, not the source).
  if (couponDocId) {
    void BookCoupon.updateOne({ _id: couponDocId }, { $inc: { usedCount: 1 } }).catch((e) =>
      console.error('[coupon] usedCount bump failed (order unaffected):', e)
    );
  }

  // Tell the admin and the buyer — but only for an order that already exists as
  // far as everyone is concerned.
  //
  // A COD order is real the moment it is placed: nothing more is owed before it
  // gets packed. An order about to be sent to a hosted gateway is not — the
  // buyer may look at the payment page and close it, and announcing "your order
  // is placed" to someone who then pays nothing, and paging the shop about it,
  // is how the pending queue filled up with orders that were never orders. For
  // those, the alerts go out from applyPaidSideEffects when the money lands.
  if (method === 'cod') {
    void raiseNewOrderAlerts(order);
    // "We got your order" — the same reasoning as the alerts above decides who
    // gets it, so it rides in the same branch. A gateway order's first text
    // goes out from applyPaidSideEffects instead.
    void OrderSmsService.send(order, 'placed');
  }

  // Handed to the controller for the create response and nowhere else. $locals
  // is never persisted or serialised, so the plain key cannot leak into a save
  // or a later read of this document.
  (order as any).$locals.accessKey = accessKey;

  return order;
};

/**
 * The "there is a new order" fan-out: admin Telegram/WhatsApp, and the buyer's
 * own "order placed" email.
 *
 * Deliberately NOT awaited by its callers. The order is already written, and
 * making a buyer's checkout wait on graph.facebook.com — or worse, 500ing their
 * completed order because Telegram is down — would be a far worse failure than
 * a message that did not arrive. Every path inside resolves, so the .catch is
 * only here so a bug in one can never become an unhandled rejection.
 *
 * Stamps `alertsSentAt` so the COD path and the payment-settled path cannot
 * both announce the same order.
 */
const raiseNewOrderAlerts = async (order: any): Promise<void> => {
  if (order?.alertsSentAt) return;
  order.alertsSentAt = new Date();
  // Written straight to the collection rather than through the document: the
  // callers are mid-save at different points, and a second save() here would
  // race whatever they are about to write.
  await Order.updateOne({ _id: order._id }, { $set: { alertsSentAt: order.alertsSentAt } }).catch(
    (e: any) => console.error('[order-alert] could not stamp alertsSentAt:', e)
  );

  await OrderAlertService.dispatchNewOrderAlerts(order).catch((e) =>
    console.error('[order-alert] dispatch threw (order unaffected):', e)
  );
  // No-op until SMTP credentials are set.
  void OrderEmailService.sendOrderPlacedEmail(order);
};

/**
 * What checkout needs before the buyer picks anything: which methods are on,
 * and what delivery would cost each way. Public — no order exists yet.
 */
const getCheckoutOptions = async (subtotal = 0) => {
  const s: any = await SettingsService.getSettingsService();
  const enabled = await getEnabledPaymentMethods();

  // The standard charge. A college's own rate is published on the college list
  // (GET /medical-colleges) and applied on the client with the same rule as
  // collegeRateApplies above; the server re-prices it at order time either way.
  const { charge: deliveryCharge } = await quoteDeliveryCharge({
    hasPrinted: true,
    subtotal,
    isCod: false,
  });

  return {
    codEnabled: enabled.cod,
    onlinePaymentEnabled: enabled.online,
    deliveryCharge,
    codExtraCharge: Number(s?.codExtraCharge) || 0,
    freeDeliveryAbove: Number(s?.freeDeliveryAbove) || 0,
    deliveryNote: s?.deliveryNote || '',
    supportPhone: s?.orderSupportPhone || s?.phoneNumber || '',
    wallets: {
      bkash: s?.paymentBkashNumber || '',
      rocket: s?.paymentRocketNumber || '',
      nagad: s?.paymentNagadNumber || '',
      instructions: s?.paymentInstructions || '',
    },
  };
};

// ─── GET my orders ───────────────────────────────────────────
// items.book is populated with three fields only — the buyer's order list shows
// a cover thumbnail, and the line's title/price are already snapshotted on the
// item itself, so pulling the whole Book document would be waste. Nothing reads
// items[].book as a raw id off this endpoint (the download flow uses the order
// returned by POST /orders), so widening it to an object is safe.
const getMyOrders = async (userId: string): Promise<IOrder[]> => {
  return Order.find({ user: userId })
    .populate('items.book', 'title slug coverImage')
    .sort({ createdAt: -1 });
};

// ─── GET single (owner or admin) ─────────────────────────────
// The owner, an admin, or — for a guest order — whoever holds its access key
// (the payment-return page, right after the gateway sends the buyer back).
const getOrderById = async (
  id: string,
  requester?: { _id: string; role: string },
  accessKey?: string
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order: any = await Order.findById(id).select('+accessKeyHash');
  if (!order) throw new Error('Order not found');

  // `order.user` is optional now — a guest order has none — so it is never
  // dereferenced before it is known to be there.
  const isOwner = !!requester && !!order.user && String(order.user) === String(requester._id);
  const isAdmin = !!requester && ['admin', 'superAdmin'].includes(requester.role);
  if (!isOwner && !isAdmin && !accessKeyMatches(order.accessKeyHash, accessKey)) {
    throw new Error('You are not allowed to view this order');
  }
  const plain = order.toObject();
  delete plain.accessKeyHash;
  return plain;
};

// ─── GET all (admin, paginated + status filter) ──────────────
const getAllOrders = async (query?: {
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ orders: IOrder[]; total: number; page: number; totalPages: number }> => {
  const { status, page = 1, limit = 20 } = query || {};
  const filter: any = {};
  if (status && status !== 'all') filter.status = status;

  const total = await Order.countDocuments(filter);
  // Populate the buyer so the admin view can show who placed the order — needed
  // for digital orders which carry no shippingAddress contact details.
  const orders = await Order.find(filter)
    // The college and its geography ride along: the admin order screen shows the
    // full picture of who ordered, and a student's college is the one detail the
    // shipping address never carries.
    .populate(
      'user',
      'firstName lastName email phoneNumber whatsappNumber medicalCollegeName district division upazila'
    )
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return { orders, total, page, totalPages: Math.ceil(total / limit) };
};

// ─── PATCH status (admin fulfillment) ────────────────────────
//
// More than a field write. Moving an order along the ladder has consequences:
//   processing → the order is confirmed and stock is reserved
//   delivered  → a cash-on-delivery order is now actually paid, AND (via
//                bookAccess's PRINTED_ACCESS_STATUSES) the printed book's QR
//                content finally opens — the buyer has the paper in hand
//   cancelled  → reserved stock goes back on the shelf, and QR access closes
//                again even if the payment was already taken
const updateOrderStatus = async (
  id: string,
  status: string,
  extra?: { courierName?: string; trackingCode?: string; adminNote?: string }
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order: any = await Order.findById(id);
  if (!order) throw new Error('Order not found');

  const now = new Date();
  // Was this order already confirmed before this status change? Drives the
  // one-time "order confirmed" email below (a COD confirm is the first time).
  const wasConfirmed = !!order.confirmedAt;

  if (extra?.courierName !== undefined) order.courierName = extra.courierName;
  if (extra?.trackingCode !== undefined) order.trackingCode = extra.trackingCode;
  if (extra?.adminNote !== undefined) order.adminNote = extra.adminNote;

  switch (status) {
    case 'processing': {
      // Confirming the order — this is the gate that lets a COD buyer read the
      // book's QR content, so it is deliberately a human decision.
      await applyStockOnce(order);
      if (!order.confirmedAt) order.confirmedAt = now;
      order.status = 'processing';
      break;
    }

    case 'shipped': {
      await applyStockOnce(order);
      if (!order.confirmedAt) order.confirmedAt = now;
      order.shippedAt = now;
      order.status = 'shipped';
      break;
    }

    case 'delivered': {
      await applyStockOnce(order);
      if (!order.confirmedAt) order.confirmedAt = now;
      if (!order.shippedAt) order.shippedAt = now;
      order.deliveredAt = now;
      order.status = 'delivered';

      // Cash on delivery: handing over the parcel IS the payment. Prepaid
      // orders were already marked paid and are left alone.
      if (order.payment.status !== 'paid' && order.payment.method === 'cod') {
        order.payment.status = 'paid';
        order.payment.paidAt = now;
        if (!order.payment.transactionId) {
          order.payment.transactionId = `COD-${order.orderNumber}`;
        }
        order.markModified('payment');
      }
      break;
    }

    case 'cancelled': {
      // Put reserved copies back, but only if we actually took them.
      if (order.stockAdjusted === true) {
        for (const item of order.items) {
          if (item.format === 'printed') {
            await Book.findByIdAndUpdate(item.book, {
              $inc: { stock: item.quantity, totalSold: -item.quantity },
            });
          } else {
            await Book.findByIdAndUpdate(item.book, { $inc: { totalSold: -item.quantity } });
          }
        }
        order.stockAdjusted = false;
      }
      order.cancelledAt = now;
      order.status = 'cancelled';
      if (order.payment.status !== 'paid') {
        order.payment.status = 'failed';
        order.markModified('payment');
      }
      break;
    }

    default:
      throw new Error(`Unsupported status: ${status}`);
  }

  await order.save();

  // Confirmed for the first time (e.g. an admin confirming a pending COD order) →
  // the "order confirmed" email. Not on cancellation, and not again once already
  // confirmed. Fire-and-forget; a no-op until SMTP credentials are set.
  if (!wasConfirmed && order.confirmedAt && order.status !== 'cancelled') {
    void OrderEmailService.sendOrderConfirmedEmail(order);
    // The COD buyer's second text: what to have ready when the rider knocks.
    // A prepaid order was confirmed by its own payment, and shouldSend keeps
    // this quiet for it.
    void OrderSmsService.send(order, 'confirmed');
  }

  // Handed to the courier.
  //
  // Keyed on the STATUS, not on shippedAt. Marking an order delivered stamps
  // shippedAt too (an order that arrived was obviously shipped), so reading the
  // timestamp would fire this and the delivered text in the same second — two
  // messages, one of them telling a buyer holding the book to expect a call.
  // Only an order sitting AT 'shipped' has something to say.
  if (order.status === 'shipped') {
    void OrderSmsService.send(order, 'shipped');
  }

  // The parcel arrived. Sent on the transition, not on every save of a
  // delivered order — the guard on the order document is what makes that true
  // even for an admin who clicks through shipped and delivered twice.
  if (order.status === 'delivered') {
    void OrderSmsService.send(order, 'delivered');
  }

  return order;
};

// ─── DELETE orders (owner accounts only) ─────────────────────
//
// Permanent, and deliberately so — this is the "remove the test orders" button,
// not a cancellation (cancelling is a status change that keeps the record and
// restores stock). Deleting an order that had taken stock puts those copies
// back first, otherwise the shop's stock count would drift every time an admin
// tidied up.
const restoreStockIfTaken = async (order: any): Promise<void> => {
  if (order?.stockAdjusted !== true) return;
  for (const item of order.items || []) {
    if (item.format === 'printed') {
      await Book.findByIdAndUpdate(item.book, {
        $inc: { stock: item.quantity, totalSold: -item.quantity },
      });
    } else {
      await Book.findByIdAndUpdate(item.book, { $inc: { totalSold: -item.quantity } });
    }
  }
};

const deleteOrder = async (id: string): Promise<void> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order: any = await Order.findById(id);
  if (!order) throw new Error('Order not found');
  await restoreStockIfTaken(order);
  await Order.deleteOne({ _id: order._id });
};

/**
 * Move many orders to the same status in one request — what the order list's
 * multi-select posts. Each one goes through updateOrderStatus, so stock, the
 * confirm timestamps, the COD-paid rule and the "order confirmed" email all
 * behave exactly as they do for a single order. One failure does not stop the
 * rest; the count of each comes back.
 */
const updateOrdersStatus = async (
  ids: string[],
  status: string
): Promise<{ updated: number; failed: number }> => {
  let updated = 0;
  let failed = 0;
  for (const id of ids || []) {
    try {
      await updateOrderStatus(id, status);
      updated += 1;
    } catch {
      failed += 1;
    }
  }
  return { updated, failed };
};

/** Bulk version of the above — one pass, and it reports what actually went. */
const deleteOrders = async (ids: string[]): Promise<{ deleted: number; failed: number }> => {
  const valid = (ids || []).filter((id) => isValidObjectId(id));
  let deleted = 0;
  let failed = 0;
  for (const id of valid) {
    try {
      await deleteOrder(id);
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed: failed + ((ids?.length || 0) - valid.length) };
};

// ─── PAY via bKash ───────────────────────────────────────────
// Reuses the payment module's BkashService (DEMO mode when keys are blank).
// The order's _id is passed through the service's `courseId` slot as the generic
// reference, and the order number as the merchant invoice.
//
// `who` is the signed-in owner's id, or { userId?, accessKey? } — a guest pays
// with the access key their order was created with. See findOrderForBuyer.
const payWithBkash = async (id: string, who: string | OrderBuyer) => {
  const buyer = toBuyer(who);
  const order = await findOrderForBuyer(id, buyer);
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  const result = await BkashService.createPayment({
    amount: order.total,
    courseId: order._id.toString(),
    // bKash's payerReference. Settlement finds the order by its own reference,
    // so for a guest this only has to be something stable about the buyer.
    studentId: buyer.userId || order.shippingAddress?.phone || order.orderNumber,
    invoiceNumber: order.orderNumber,
  });

  order.payment.method = 'bkash';
  if (result.paymentID) order.payment.transactionId = result.paymentID;
  await order.save();

  return result; // { paymentID, bkashURL, ... }
};

// ─── PAY via SSLCommerz ──────────────────────────────────────
const payWithSslcommerz = async (id: string, who: string | OrderBuyer) => {
  const buyer = toBuyer(who);
  const order = await findOrderForBuyer(id, buyer);
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  // The gateway wants a name, an email and a phone. The order carries all three
  // for anyone who ordered through the current checkout; an account fills gaps
  // for older orders. SSLCommerz refuses a session without an email, and a
  // guest may not have given one, so the shop's own sender address stands in —
  // it is the shop the receipt matters to in that case.
  const user: any = buyer.userId ? await User.findById(buyer.userId).lean() : null;
  const ship: any = order.shippingAddress || {};

  const result = await SslcommerzService.initSession({
    amount: order.total,
    courseId: order._id.toString(),
    courseName: `Book Order ${order.orderNumber}`,
    studentId: buyer.userId || 'guest',
    studentName:
      String(ship.name || '').trim() ||
      `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
      'Customer',
    studentEmail: String(ship.email || '').trim() || user?.email || config.email.from_email,
    studentPhone: ship.phone || user?.phoneNumber,
    invoiceNumber: order.orderNumber,
  });

  order.payment.method = 'sslcommerz';
  if (result.tran_id) order.payment.transactionId = result.tran_id;
  await order.save();

  return result; // { GatewayPageURL, tran_id, ... }
};

/**
 * Take this order's copies off the shelf and count them as sold — exactly once.
 *
 * Guarded by the persisted `stockAdjusted` flag rather than by payment status,
 * because a COD order reserves stock when the admin confirms it and only turns
 * 'paid' at delivery; keying off payment status decremented the same copies on
 * both transitions. Old orders have no flag, so `!== true` is the right test.
 *
 * Pre-orders are decremented here exactly like anything else, and are allowed to
 * drive `stock` negative. That is deliberate: before the print run exists there
 * is no true stock figure to protect, and -80 is genuinely more useful than 0 —
 * it is the count of copies already sold that the run has to cover. Clamping it
 * at zero would throw that number away, and refusing the decrement would leave
 * `totalSold` lying about how many were shipped.
 */
const applyStockOnce = async (order: any): Promise<void> => {
  if (order.stockAdjusted === true) return;

  for (const item of order.items) {
    if (item.format === 'printed') {
      await Book.findByIdAndUpdate(item.book, {
        $inc: { stock: -item.quantity, totalSold: item.quantity },
      });
    } else {
      await Book.findByIdAndUpdate(item.book, { $inc: { totalSold: item.quantity } });
    }
  }
  order.stockAdjusted = true;
};

// Shared: mark an order paid, decrement printed stock (once), bump totalSold, and
// move it to its post-payment state (digital → access-granted, else → processing).
const applyPaidSideEffects = async (order: any): Promise<void> => {
  const wasConfirmed = !!order.confirmedAt;
  await applyStockOnce(order);
  order.payment.status = 'paid';
  order.payment.paidAt = new Date();
  // Delivered parcels stay delivered — settling the cash must not walk the
  // status backwards to 'processing'.
  if (order.status !== 'delivered' && order.status !== 'shipped') {
    order.status = order.deliveryType === 'digital' ? 'access-granted' : 'processing';
  }
  if (!order.confirmedAt) order.confirmedAt = new Date();
  // First confirmation (payment settled — gateway or manual approval) → the
  // "order confirmed" email. Fire-and-forget; the caller saves the order.
  if (!wasConfirmed) void OrderEmailService.sendOrderConfirmedEmail(order);
  // A gateway order held its "new order" alerts back until the money arrived —
  // this is that moment. Already-alerted orders (COD, manual) fall straight
  // through on the alertsSentAt stamp.
  void raiseNewOrderAlerts(order);

  // "We have your money, the order is confirmed." For a prepaid buyer this is
  // both the receipt and the confirmation, which is why they never get the
  // separate 'confirmed' text. A COD order reaching here has been marked paid
  // on delivery, and shouldSend keeps it quiet — its 'delivered' text says the
  // same thing better.
  void OrderSmsService.send(order, 'paid');
};

// ─── COMPLETE payment (DEMO / gateway callback) ──────────────
// Instant-paid path used by the demo bKash/SSLCommerz gateways.
//
// `userId` narrows the lookup to that account's order when there is one. A
// guest order has no account, and its settlement arrives here with no userId —
// the gateway callback has already proven the payment against the order's own
// reference and amount (payment/orderSettlement.ts), which is the check that
// matters. Filtering on a missing user used to turn "undefined" into a cast
// error, and a guest who had paid was told the payment failed.
const completePayment = async (
  id: string,
  userId?: string,
  body?: { method?: string; transactionId?: string }
): Promise<IOrder> => {
  const filter: Record<string, unknown> = { _id: id };
  if (userId) filter.user = userId;
  const order = await Order.findOne(filter);
  if (!order) throw new Error('Order not found');

  await applyPaidSideEffects(order);
  if (body?.method && ['bkash', 'sslcommerz', 'manual', 'free'].includes(body.method)) {
    order.payment.method = body.method as any;
  } else if (!order.payment.method) {
    order.payment.method = 'manual';
  }
  order.payment.transactionId =
    body?.transactionId || order.payment.transactionId || `TRX-${Date.now()}`;

  await order.save();
  return order;
};

// ─── SUBMIT manual payment (owner) ───────────────────────────
// Records the buyer's Send-Money details and leaves the order PENDING for an
// admin to verify against the wallet statement. Never auto-marks paid.
const submitManualPayment = async (
  id: string,
  userId: string,
  body: {
    channel: 'bkash' | 'rocket' | 'nagad';
    transactionId: string;
    senderNumber: string;
    sentAt?: string;
    note?: string;
  }
): Promise<IOrder> => {
  const order = await Order.findOne({ _id: id, user: userId });
  if (!order) throw new Error('Order not found');
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  order.payment.method = 'manual';
  order.payment.channel = body.channel;
  order.payment.transactionId = body.transactionId.trim();
  order.payment.senderNumber = body.senderNumber.trim();
  if (body.sentAt) order.payment.sentAt = new Date(body.sentAt);
  if (body.note) order.payment.note = body.note.trim();
  order.payment.status = 'pending';
  order.payment.submittedAt = new Date();
  order.status = 'pending'; // awaits admin approval
  await order.save();
  return order;
};

// ─── ADMIN: approve a payment → mark paid + grant access / start fulfillment ─
const approveOrderPayment = async (id: string): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order = await Order.findById(id);
  if (!order) throw new Error('Order not found');
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  // A COD order has no money to verify yet — the cash arrives with the courier.
  // Confirming it (status → processing) is the right action, and marking it paid
  // here would leave the books saying we were paid for a parcel still in a van.
  if (order.payment.method === 'cod') {
    throw new Error(
      'This is a cash-on-delivery order. Confirm it to start fulfillment; it is marked paid when you mark it delivered.'
    );
  }

  await applyPaidSideEffects(order);
  if (!order.payment.method) order.payment.method = 'manual';
  await order.save();
  return order;
};

// ─── ADMIN: reject a manual payment → mark failed + cancel the order ─────────
const rejectOrderPayment = async (id: string, reason?: string): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order = await Order.findById(id);
  if (!order) throw new Error('Order not found');
  if (order.payment.status === 'paid') throw new Error('Cannot reject an already-paid order');

  // Anything already reserved goes back on the shelf. Today no path reaches
  // here with stock taken (manual orders reserve on approval, and an approved
  // order cannot be rejected), but a rejection that silently ate inventory
  // would be a very quiet bug to carry.
  if ((order as any).stockAdjusted === true) {
    for (const item of order.items) {
      if (item.format === 'printed') {
        await Book.findByIdAndUpdate(item.book, {
          $inc: { stock: item.quantity, totalSold: -item.quantity },
        });
      } else {
        await Book.findByIdAndUpdate(item.book, { $inc: { totalSold: -item.quantity } });
      }
    }
    (order as any).stockAdjusted = false;
  }

  order.payment.status = 'failed';
  if (reason) order.payment.note = reason;
  order.status = 'cancelled';
  (order as any).cancelledAt = new Date();
  await order.save();
  return order;
};

// ─── A hosted-gateway checkout that never produced a payment ────────────────

/**
 * Payment methods where the buyer leaves the site to pay, and where an order
 * with no payment against it means nothing happened.
 *
 * NOT 'manual': that buyer sends money from their own wallet and types the
 * transaction id back in minutes later, so their order is *supposed* to sit
 * unpaid waiting for them and then for an admin. NOT 'cod': a COD order is a
 * real order from the moment it is placed. Sweeping either would delete work.
 */
const HOSTED_GATEWAYS = ['sslcommerz', 'bkash'];

/**
 * Close an order whose hosted-gateway payment never happened.
 *
 * An order is written before the buyer is sent to SSLCommerz — deliberately, so
 * that a buyer who closes the tab after paying still gets the order the IPN
 * settles. The cost of that design is this case: a buyer who reaches SSLCommerz
 * and comes back without paying leaves a fully-formed order sitting in the
 * admin's pending queue, indistinguishable from one that is genuinely waiting
 * to be confirmed.
 *
 * Marking only `payment.status = 'failed'` was not enough — the order's own
 * status stayed 'pending', which is what the queue filters on.
 *
 * Idempotent, and refuses anything that is not exactly this case: an order that
 * was paid (a decline racing a success must never cancel a banked payment), one
 * that has moved past pending, or one paid by a method where "unpaid" is a
 * normal resting state.
 */
const abandonUnpaidGatewayOrder = async (
  id: string,
  reason: string
): Promise<IOrder | null> => {
  const order: any = await Order.findById(id);
  if (!order) return null;
  if (order.payment?.status === 'paid') return null;
  if (order.status !== 'pending') return null;
  if (!HOSTED_GATEWAYS.includes(order.payment?.method)) return null;

  // Today nothing reaches here with stock taken — a gateway order only reserves
  // on payment — but a cancellation that silently ate inventory would be a very
  // quiet bug to carry, and this is the same guard rejectOrderPayment uses.
  await restoreStockIfTaken(order);
  if (order.stockAdjusted === true) order.stockAdjusted = false;

  order.payment.status = 'failed';
  order.payment.note = reason;
  order.status = 'cancelled';
  order.cancelledAt = new Date();
  await order.save();
  return order;
};

/**
 * The buyers who never came back at all.
 *
 * SSLCommerz calls fail_url or cancel_url when someone presses those buttons,
 * but the commonest abandonment presses nothing: the tab is closed, the phone
 * locks, the back button is used. No callback is ever sent, so without a sweep
 * those orders stay pending for ever.
 *
 * The window is generous on purpose. A gateway session is good for about half
 * an hour, and a buyer switching to their banking app to fetch an OTP can be
 * gone a long time — cancelling an order out from under someone mid-payment
 * would be far worse than showing a stale one for an extra hour.
 */
const expireAbandonedGatewayOrders = async (
  olderThanMinutes = 90
): Promise<number> => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stale = await Order.find({
    status: 'pending',
    'payment.status': 'pending',
    'payment.method': { $in: HOSTED_GATEWAYS },
    createdAt: { $lt: cutoff },
  })
    .select('_id')
    .lean();

  let closed = 0;
  for (const { _id } of stale) {
    // Through the same function the callbacks use, so there is one definition of
    // what closing an unpaid order means.
    const done = await abandonUnpaidGatewayOrder(
      String(_id),
      'Payment was never completed at the gateway'
    );
    if (done) closed++;
  }
  return closed;
};

// ─── ADMIN: edit payment details (correct a typo'd txn id, number, etc.) ─────
/**
 * The owner's correction pass over one order.
 *
 * Buyers mistype their own address and phone all the time, and a payment gets
 * recorded against the wrong method often enough that "delete and re-order" was
 * becoming the workaround. This lets an owner account fix the record in place:
 * the delivery details, the payment state, and — because the buyer's email and
 * phone live on the User, not the order — those two fields as well.
 *
 * What it deliberately does NOT touch: the money. Prices, discounts, delivery
 * charge and total are computed from the catalogue at checkout and are the
 * evidence of what was actually agreed; editing them here would leave an order
 * whose lines do not add up to its total. Cancel and re-place instead.
 *
 * Every field is optional — only what is sent is written, so a form that posts
 * one changed box cannot blank the rest.
 */
const adminUpdateOrder = async (
  id: string,
  body: {
    shippingAddress?: Partial<IShippingAddress>;
    payment?: {
      status?: 'pending' | 'paid' | 'failed';
      method?: 'bkash' | 'sslcommerz' | 'manual' | 'cod' | 'free';
      transactionId?: string;
    };
    buyer?: { email?: string; phoneNumber?: string; whatsappNumber?: string };
    adminNote?: string;
  }
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order: any = await Order.findById(id);
  if (!order) throw new Error('Order not found');

  // ── Delivery details ──
  if (body.shippingAddress) {
    const a = body.shippingAddress;
    order.shippingAddress = { ...(order.shippingAddress?.toObject?.() ?? order.shippingAddress ?? {}) };
    for (const k of [
      'name',
      'phone',
      'altPhone',
      'email',
      'address',
      'city',
      'district',
      'division',
      'upazila',
      'note',
    ] as const) {
      if (a[k] !== undefined) (order.shippingAddress as any)[k] = a[k];
    }
    // 'city' is the courier-facing line and mirrors the upazila (see
    // order.interface). Keep them in step when only the upazila is corrected.
    if (a.upazila !== undefined && a.city === undefined) {
      (order.shippingAddress as any).city = a.upazila;
    }
    order.markModified('shippingAddress');
  }

  // ── Payment state ──
  if (body.payment) {
    const p = body.payment;
    if (p.status !== undefined) {
      order.payment.status = p.status;
      // A payment marked paid by hand still needs a paidAt, or the reports read
      // it as money that arrived at no particular time.
      if (p.status === 'paid' && !order.payment.paidAt) order.payment.paidAt = new Date();
      if (p.status !== 'paid') order.payment.paidAt = undefined;
    }
    if (p.method !== undefined) order.payment.method = p.method;
    if (p.transactionId !== undefined) order.payment.transactionId = p.transactionId;
    order.markModified('payment');
  }

  if (body.adminNote !== undefined) order.adminNote = body.adminNote;

  // A guest order has no account for the buyer fields to land on, so the email
  // goes onto the order itself — where the order emails look first anyway.
  if (!order.user && body.buyer?.email !== undefined && order.shippingAddress) {
    order.shippingAddress.email = String(body.buyer.email).trim().toLowerCase();
    order.markModified('shippingAddress');
  }

  await order.save();

  // ── The buyer's own record ──
  // Separate document, so a failure here must not lose the order edit above.
  if (body.buyer && order.user) {
    const u = body.buyer;
    const patch: Record<string, string> = {};
    if (u.email !== undefined) {
      const email = String(u.email).trim().toLowerCase();
      if (email) {
        const clash = await User.findOne({ email, _id: { $ne: order.user } }).select('_id').lean();
        if (clash) throw new Error('Another account already uses that email');
        patch.email = email;
      }
    }
    if (u.phoneNumber !== undefined) patch.phoneNumber = String(u.phoneNumber).trim();
    if (u.whatsappNumber !== undefined) patch.whatsappNumber = String(u.whatsappNumber).trim();
    if (Object.keys(patch).length > 0) {
      await User.updateOne({ _id: order.user }, { $set: patch });
    }
  }

  // Hand back the order with the buyer populated, the shape the admin list uses.
  return (await Order.findById(id).populate(
    'user',
    'firstName lastName email phoneNumber whatsappNumber medicalCollegeName district division upazila'
  )) as IOrder;
};

const updateOrderPayment = async (
  id: string,
  body: {
    channel?: 'bkash' | 'rocket' | 'nagad';
    method?: 'bkash' | 'sslcommerz' | 'manual' | 'free';
    transactionId?: string;
    senderNumber?: string;
    sentAt?: string | null;
    note?: string;
  }
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order = await Order.findById(id);
  if (!order) throw new Error('Order not found');

  const p = order.payment;
  if (body.channel !== undefined) p.channel = body.channel;
  if (body.method !== undefined) p.method = body.method;
  if (body.transactionId !== undefined) p.transactionId = body.transactionId;
  if (body.senderNumber !== undefined) p.senderNumber = body.senderNumber;
  if (body.sentAt !== undefined) p.sentAt = body.sentAt ? new Date(body.sentAt) : undefined;
  if (body.note !== undefined) p.note = body.note;
  order.markModified('payment');
  await order.save();
  return order;
};

// ─── DOWNLOAD a purchased digital book ───────────────────────
// Owner (or admin) only, order must be paid, and the item must exist as a digital
// line. secureFileUrl is select:false on Book, so it's explicitly re-selected here.
const getDownloadUrl = async (
  orderId: string,
  bookId: string,
  requester: { _id: string; role: string }
): Promise<{ title: string; secureFileUrl: string }> => {
  if (!isValidObjectId(orderId)) throw new Error('Invalid order id');
  const order = await Order.findById(orderId);
  if (!order) throw new Error('Order not found');

  const isOwner = !!order.user && order.user.toString() === requester._id;
  const isAdmin = ['admin', 'superAdmin'].includes(requester.role);
  if (!isOwner && !isAdmin) throw new Error('You are not allowed to access this order');

  if (order.payment.status !== 'paid') throw new Error('Order is not paid yet');

  const item = order.items.find(
    (it) => it.book.toString() === bookId && it.format === 'digital'
  );
  if (!item) throw new Error('No digital book with this id in the order');

  const book = await Book.findById(bookId).select('+secureFileUrl');
  if (!book || !book.secureFileUrl) throw new Error('Secure file not available for this book');

  return { title: book.title, secureFileUrl: book.secureFileUrl };
};

// ─── Dashboard stats ────────────────────────────────────────
//
// Everything here is book-order data — orders ARE books; courses live in
// enrollments. "Revenue" is the `total` of orders that were not cancelled, by
// the day the order was placed (gross sales), which is the number the admin
// dashboard headlines. A cancelled order is not income and is excluded.
//
// Days are counted in Bangladesh time (UTC+6, no DST), so "today" and "this
// month" line up with the shop's own clock rather than the server's UTC.
const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

/** The UTC instant of Bangladesh-midnight for a given BD calendar date. */
const bdMidnightUtc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m, d) - BD_OFFSET_MS);

/**
 * The money behind the book orders, for the dashboard and the analytics page.
 *
 * Three numbers, and the rule that separates them — the shop's own accounting:
 *
 *   VALUE     every live order's total. What has been sold.
 *   EARNED    money actually in hand: the parcel was DELIVERED, or the buyer
 *             paid online up front. A cash-on-delivery order counts only once
 *             the courier hands it over (updateOrderStatus marks it paid then).
 *   UPCOMING  sold but not yet collected — value minus earned. What is still
 *             out with couriers and buyers.
 *
 * Each of those is also split in two, because an order's total carries the
 * delivery charge and the shop wants to see its book sales without it:
 * `delivery` is the charge on its own and `books` is the rest. `copies` counts
 * the books themselves, and `byBook` breaks the period down by title.
 *
 * Cancelled orders are excluded everywhere: they are not a sale.
 *
 * The caller may pass a date range (from/to, ISO days in BD time). Without one
 * the range defaults to the current BD month, which is what the dashboard shows.
 */
const getBookOrderStats = async (opts?: {
  year?: number;
  month?: number;
  from?: string;
  to?: string;
}) => {
  const now = new Date();
  const bdNow = new Date(now.getTime() + BD_OFFSET_MS);

  const todayStart = bdMidnightUtc(bdNow.getUTCFullYear(), bdNow.getUTCMonth(), bdNow.getUTCDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // The window the chart and the range totals cover.
  const parseDay = (s?: string): Date | null => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    return bdMidnightUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  let rangeStart = parseDay(opts?.from);
  let rangeEnd = parseDay(opts?.to);
  if (rangeEnd) rangeEnd = new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000); // inclusive day
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) {
    const y = Number.isFinite(opts?.year) ? (opts!.year as number) : bdNow.getUTCFullYear();
    const m = Number.isFinite(opts?.month) ? (opts!.month as number) : bdNow.getUTCMonth();
    rangeStart = bdMidnightUtc(y, m, 1);
    rangeEnd = bdMidnightUtc(y, m + 1, 1);
  }

  const live = { status: { $ne: 'cancelled' } };
  // Money in hand: delivered, or already paid (which is every successful
  // online payment, and a COD order once it was handed over).
  const isEarned = { $or: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.status', 'paid'] }] };
  // An order's total is what its books sold for (after offers and coupons) plus
  // the delivery charge, and the delivery charge is the courier's money passing
  // through — so every figure below is also kept with the delivery charge taken
  // out. Orders from before the field existed count as no delivery charge.
  const deliveryOf = { $ifNull: ['$deliveryCharge', 0] };
  // Copies, not lines: one line of three books is three books.
  const copiesOf = {
    $reduce: {
      input: { $ifNull: ['$items', []] },
      initialValue: 0,
      in: { $add: ['$$value', { $ifNull: ['$$this.quantity', 1] }] },
    },
  };
  const moneyGroup = {
    orders: { $sum: 1 },
    copies: { $sum: copiesOf },
    value: { $sum: '$total' },
    earned: { $sum: { $cond: [isEarned, '$total', 0] } },
    delivery: { $sum: deliveryOf },
    earnedDelivery: { $sum: { $cond: [isEarned, deliveryOf, 0] } },
  };

  const [totalsAgg, todayAgg, newOrders, dailyAgg, statusAgg, methodAgg, couponsAgg, bookAgg] =
    await Promise.all([
      Order.aggregate([{ $match: live }, { $group: { _id: null, ...moneyGroup } }]),
      Order.aggregate([
        { $match: { ...live, createdAt: { $gte: todayStart, $lt: todayEnd } } },
        { $group: { _id: null, ...moneyGroup } },
      ]),
      // "New" = still waiting for the admin to confirm it — the work queue.
      Order.countDocuments({ status: 'pending' }),
      Order.aggregate([
        { $match: { ...live, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Dhaka' } },
            ...moneyGroup,
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
        {
          $group: {
            _id: '$status',
            orders: { $sum: 1 },
            copies: { $sum: copiesOf },
            value: { $sum: '$total' },
            delivery: { $sum: deliveryOf },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...live, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
        {
          $group: {
            _id: { $ifNull: ['$payment.method', 'unpaid'] },
            orders: { $sum: 1 },
            copies: { $sum: copiesOf },
            value: { $sum: '$total' },
            delivery: { $sum: deliveryOf },
          },
        },
      ]),
      Order.aggregate([
        { $match: { ...live, couponCode: { $nin: [null, ''] } } },
        {
          $group: {
            _id: null,
            orders: { $sum: 1 },
            discount: { $sum: { $ifNull: ['$couponDiscount', 0] } },
            payout: { $sum: { $ifNull: ['$couponPayout', 0] } },
          },
        },
      ]),
      // Each title in the period: how many copies, and what they sold for. An
      // order's discount (offers + coupon) belongs to the whole order, so its
      // book money is shared across its lines by list price — with one title
      // per order, which is nearly every order, that is simply the order's.
      Order.aggregate([
        { $match: { ...live, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
        {
          $project: {
            createdAt: 1,
            items: 1,
            bookMoney: { $subtract: ['$total', deliveryOf] },
            lines: { $size: { $ifNull: ['$items', []] } },
            listTotal: {
              $reduce: {
                input: { $ifNull: ['$items', []] },
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.quantity', 1] }] },
                  ],
                },
              },
            },
          },
        },
        { $unwind: '$items' },
        { $sort: { createdAt: 1 } },
        {
          $group: {
            _id: '$items.book',
            // The title as the most recent order spelt it.
            title: { $last: '$items.title' },
            copies: { $sum: { $ifNull: ['$items.quantity', 1] } },
            orderIds: { $addToSet: '$_id' },
            sales: {
              $sum: {
                $cond: [
                  { $gt: ['$listTotal', 0] },
                  {
                    $multiply: [
                      '$bookMoney',
                      {
                        $divide: [
                          { $multiply: [{ $ifNull: ['$items.price', 0] }, { $ifNull: ['$items.quantity', 1] }] },
                          '$listTotal',
                        ],
                      },
                    ],
                  },
                  { $divide: ['$bookMoney', { $max: ['$lines', 1] }] },
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            book: '$_id',
            title: 1,
            copies: 1,
            orders: { $size: '$orderIds' },
            sales: { $round: ['$sales', 0] },
          },
        },
        { $sort: { copies: -1, sales: -1 } },
      ]),
    ]);

  type MoneyRow = {
    orders: number;
    copies: number;
    value: number;
    earned: number;
    delivery: number;
    earnedDelivery: number;
  };
  const ZERO: MoneyRow = { orders: 0, copies: 0, value: 0, earned: 0, delivery: 0, earnedDelivery: 0 };

  // Fill every day in the window, so the chart has no gaps to interpolate over.
  const byDay = new Map((dailyAgg as Array<MoneyRow & { _id: string }>).map((r) => [r._id, r]));
  const daily: Array<MoneyRow & { date: string; day: number }> = [];
  for (let t = rangeStart.getTime(); t < rangeEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    daily.push({
      date: key,
      day: d.getUTCDate(),
      orders: row?.orders ?? 0,
      copies: row?.copies ?? 0,
      value: row?.value ?? 0,
      earned: row?.earned ?? 0,
      delivery: row?.delivery ?? 0,
      earnedDelivery: row?.earnedDelivery ?? 0,
    });
  }

  /**
   * One bucket of money, three ways:
   *   value / earned / upcoming   with the delivery charge — what buyers pay
   *   delivery.{…}                the delivery charge on its own
   *   books.{…}                   the books on their own (value − delivery)
   * `copies` is how many books those orders hold.
   */
  const money = (a: MoneyRow = ZERO) => {
    const upcoming = Math.max(0, a.value - a.earned);
    const bookValue = a.value - a.delivery;
    const bookEarned = a.earned - a.earnedDelivery;
    return {
      orders: a.orders,
      copies: a.copies,
      value: a.value,
      earned: a.earned,
      upcoming,
      delivery: {
        value: a.delivery,
        earned: a.earnedDelivery,
        upcoming: Math.max(0, a.delivery - a.earnedDelivery),
      },
      books: {
        value: bookValue,
        earned: bookEarned,
        upcoming: Math.max(0, bookValue - bookEarned),
      },
    };
  };

  const rangeTotals = daily.reduce<MoneyRow>(
    (t, d) => ({
      orders: t.orders + d.orders,
      copies: t.copies + d.copies,
      value: t.value + d.value,
      earned: t.earned + d.earned,
      delivery: t.delivery + d.delivery,
      earnedDelivery: t.earnedDelivery + d.earnedDelivery,
    }),
    { ...ZERO }
  );

  type SplitRow = { _id: string; orders: number; copies: number; value: number; delivery: number };
  const splitRows = (rows: SplitRow[]) =>
    rows.reduce(
      (acc, r) => ({
        ...acc,
        [r._id]: { orders: r.orders, copies: r.copies, value: r.value, delivery: r.delivery },
      }),
      {} as Record<string, { orders: number; copies: number; value: number; delivery: number }>
    );

  const c = (couponsAgg as Array<{ orders: number; discount: number; payout: number }>)[0];

  return {
    newOrders,
    today: money((todayAgg as MoneyRow[])[0]),
    totals: money((totalsAgg as MoneyRow[])[0]),
    range: {
      from: rangeStart.toISOString().slice(0, 10),
      to: new Date(rangeEnd.getTime() - 1).toISOString().slice(0, 10),
      ...money(rangeTotals),
      daily,
    },
    byStatus: splitRows(statusAgg as SplitRow[]),
    byMethod: splitRows(methodAgg as SplitRow[]),
    byBook: bookAgg as Array<{ book: string; title: string; copies: number; orders: number; sales: number }>,
    coupons: { orders: c?.orders ?? 0, discount: c?.discount ?? 0, payout: c?.payout ?? 0 },
  };
};

export const OrderService = {
  createOrder,
  getBookOrderStats,
  getCheckoutOptions,
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  payWithBkash,
  payWithSslcommerz,
  completePayment,
  submitManualPayment,
  approveOrderPayment,
  rejectOrderPayment,
  abandonUnpaidGatewayOrder,
  expireAbandonedGatewayOrders,
  updateOrderPayment,
  getDownloadUrl,
  deleteOrder,
  deleteOrders,
  updateOrdersStatus,
  adminUpdateOrder,
};
