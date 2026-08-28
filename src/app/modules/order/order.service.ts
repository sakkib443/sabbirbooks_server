/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { Order } from './order.model';
import { getNextSequence, ORDER_SEQ } from './counter.model';
import { IOrder, IShippingAddress, TDeliveryType, TDeliveryArea } from './order.interface';
import { Book } from '../book/book.model';
import { priceBookUnit, hasOffers } from '../book/book.pricing';
import { BookCoupon } from '../bookCoupon/bookCoupon.model';
import { evaluateBookCoupon } from '../bookCoupon/bookCoupon.controller';
import { User } from '../user/user.model';
import { BkashService } from '../payment/bkash.service';
import { SslcommerzService } from '../payment/sslcommerz.service';
import { SettingsService } from '../settings/settings.services';
import { OrderAlertService } from '../notification/orderAlert.service';
import { OrderEmailService } from '../notification/orderEmail.service';

// Resolve a book by slug / numeric id / Mongo _id — same tolerant lookup the
// book module exposes publicly (client may send either a slug or an _id).
const resolveBook = async (slugOrId: string) => {
  const or: Record<string, unknown>[] = [{ slug: slugOrId }];
  if (!isNaN(Number(slugOrId))) or.push({ id: Number(slugOrId) });
  if (isValidObjectId(slugOrId)) or.push({ _id: slugOrId });
  return Book.findOne({ $or: or });
};

/**
 * What the courier fee for this order is, in taka.
 *
 * Read from site settings rather than hard-coded so the shop owner can change
 * the rate without a deploy, and snapshotted onto the order so a later rate
 * change never rewrites an existing customer's total. Digital-only orders ship
 * nothing and are always free.
 */
const quoteDeliveryCharge = async (opts: {
  hasPrinted: boolean;
  subtotal: number;
  isCod: boolean;
  // The buyer's own division and college, when known — for the free-local rule.
  division?: string;
  college?: string;
}): Promise<number> => {
  if (!opts.hasPrinted) return 0;

  const s: any = await SettingsService.getSettingsService();

  const freeAbove = Number(s?.freeDeliveryAbove) || 0;
  if (freeAbove > 0 && opts.subtotal >= freeAbove) return 0;

  // Free local delivery: the configured college's students shipping within the
  // configured division pay nothing. The same student shipping to any other
  // division falls through to the flat charge.
  const freeCollege = String(s?.freeDeliveryCollege || '').trim();
  const freeDivision = String(s?.freeDeliveryDivision || '').trim();
  if (
    freeCollege &&
    freeDivision &&
    (opts.college || '').trim() === freeCollege &&
    (opts.division || '').trim() === freeDivision
  ) {
    return 0;
  }

  // One flat rate everywhere. deliveryCharge is the live field; the old
  // inside-Dhaka value is the fallback for a settings doc written before it
  // existed, then the documented default.
  const flat = Number(s?.deliveryCharge);
  const legacy = Number(s?.deliveryChargeInsideDhaka);
  const charge = Number.isFinite(flat) ? flat : Number.isFinite(legacy) ? legacy : 130;
  const codExtra = opts.isCod ? Number(s?.codExtraCharge) || 0 : 0;

  return Math.max(0, Math.round(charge + codExtra));
};

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
const createOrder = async (
  userId: string,
  payload: {
    items: { bookSlugOrId: string; quantity: number }[];
    shippingAddress?: IShippingAddress;
    paymentMethod?: 'manual' | 'cod';
    couponCode?: string;
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

  // Printed items ship — a full address is mandatory.
  if (hasPrinted) {
    const addr = payload.shippingAddress;
    if (!addr || !addr.name || !addr.phone || !addr.address || !addr.city) {
      throw new Error('Shipping address (name, phone, address, city) is required for printed items');
    }
  }

  const method = payload.paymentMethod === 'cod' ? 'cod' : 'manual';

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
  const rawCoupon = (payload.couponCode || '').trim();
  if (rawCoupon) {
    const afterOffers = Math.max(0, subtotal - offersDiscount);
    // Throws a buyer-friendly Error (invalid / inactive) which fails the order —
    // the buyer explicitly applied the code and expects its price, so silently
    // dropping it (and charging more than shown) would be worse.
    const { coupon, discountAmount } = await evaluateBookCoupon(rawCoupon, afterOffers);
    couponCode = coupon.code;
    couponDiscount = discountAmount;
    couponPayout = Math.max(0, Number(coupon.payoutPerSale) || 0);
    couponDocId = coupon._id;
  }

  // Grand total discount = the book's offers plus the coupon.
  const discount = offersDiscount + couponDiscount;

  // The buyer's medical college — required on EVERY order, and the input to the
  // free-local-delivery rule. Required because the shop is sold to medical
  // students and the college is how orders are batched and delivered; an account
  // that never picked one (an old signup, or a Google sign-in that skipped the
  // profile step) is asked to set it before it can order, rather than silently
  // producing an order nobody can route.
  const buyer = await User.findById(userId).select('medicalCollegeName').lean();
  const buyerCollege = (buyer?.medicalCollegeName || '').trim();
  if (!buyerCollege) {
    throw new Error(
      'আপনার মেডিকেল কলেজ নির্বাচন করা নেই। প্রোফাইল থেকে মেডিকেল কলেজ নির্বাচন করে আবার অর্ডার করুন। ' +
        '(Please select your medical college in your profile before ordering.)'
    );
  }
  const deliveryCharge = await quoteDeliveryCharge({
    hasPrinted,
    subtotal: subtotal - discount,
    isCod: method === 'cod',
    division: payload.shippingAddress?.division,
    college: buyerCollege,
  });
  const total = subtotal - discount + deliveryCharge;

  // Human-friendly running number. Seeded to the current order count on first use
  // so an order placed before the backfill runs still sorts above the existing
  // rows the backfill numbers 1..N.
  const orderSeq = await getNextSequence(ORDER_SEQ, () => Order.countDocuments());

  const order = await Order.create({
    user: userId,
    orderSeq,
    items,
    deliveryType,
    shippingAddress: hasPrinted ? { ...payload.shippingAddress } : undefined,
    subtotal,
    discount,
    couponCode,
    couponDiscount,
    couponPayout,
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

  // Tell the admin and the buyer — in-app, Telegram (admin), WhatsApp (both).
  //
  // Deliberately NOT awaited. The order is already written and this response is
  // what unblocks the buyer's checkout; making them wait on graph.facebook.com,
  // or worse, 500ing their completed order because Telegram is down, would be a
  // far worse failure than a message that did not arrive. dispatchNewOrderAlerts
  // resolves in every case, so the .catch is only here so that a bug inside it
  // can never become an unhandled rejection.
  void OrderAlertService.dispatchNewOrderAlerts(order).catch((e) =>
    console.error('[order-alert] dispatch threw (order unaffected):', e)
  );

  // "Order placed, pending" email to the buyer — same fire-and-forget rule, and a
  // no-op until SMTP credentials are set.
  void OrderEmailService.sendOrderPlacedEmail(order);

  return order;
};

/**
 * What checkout needs before the buyer picks anything: which methods are on,
 * and what delivery would cost each way. Public — no order exists yet.
 */
const getCheckoutOptions = async (subtotal = 0) => {
  const s: any = await SettingsService.getSettingsService();
  const enabled = await getEnabledPaymentMethods();

  // One flat charge everywhere. The buyer's own eligibility for free local
  // delivery is decided on the client from freeDeliveryCollege/Division below
  // (it knows the buyer's college); the server re-checks it at order time.
  const deliveryCharge = await quoteDeliveryCharge({ hasPrinted: true, subtotal, isCod: false });

  return {
    codEnabled: enabled.cod,
    onlinePaymentEnabled: enabled.online,
    deliveryCharge,
    freeDeliveryCollege: String(s?.freeDeliveryCollege || ''),
    freeDeliveryDivision: String(s?.freeDeliveryDivision || ''),
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
const getOrderById = async (
  id: string,
  requester: { _id: string; role: string }
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order = await Order.findById(id);
  if (!order) throw new Error('Order not found');

  const isOwner = order.user.toString() === requester._id;
  const isAdmin = ['admin', 'superAdmin'].includes(requester.role);
  if (!isOwner && !isAdmin) {
    throw new Error('You are not allowed to view this order');
  }
  return order;
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
const payWithBkash = async (id: string, userId: string) => {
  const order = await Order.findOne({ _id: id, user: userId });
  if (!order) throw new Error('Order not found');
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  const result = await BkashService.createPayment({
    amount: order.total,
    courseId: order._id.toString(),
    studentId: userId,
    invoiceNumber: order.orderNumber,
  });

  order.payment.method = 'bkash';
  if (result.paymentID) order.payment.transactionId = result.paymentID;
  await order.save();

  return result; // { paymentID, bkashURL, ... }
};

// ─── PAY via SSLCommerz ──────────────────────────────────────
const payWithSslcommerz = async (id: string, userId: string) => {
  const order = await Order.findOne({ _id: id, user: userId });
  if (!order) throw new Error('Order not found');
  if (order.payment.status === 'paid') throw new Error('Order is already paid');

  // Gateway needs buyer identity; the JWT payload may not carry name/phone, so
  // pull them from the User record.
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const result = await SslcommerzService.initSession({
    amount: order.total,
    courseId: order._id.toString(),
    courseName: `Book Order ${order.orderNumber}`,
    studentId: userId,
    studentName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer',
    studentEmail: user.email,
    studentPhone: user.phoneNumber,
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
};

// ─── COMPLETE payment (DEMO / gateway callback) ──────────────
// Instant-paid path used by the demo bKash/SSLCommerz gateways.
const completePayment = async (
  id: string,
  userId: string,
  body?: { method?: string; transactionId?: string }
): Promise<IOrder> => {
  const order = await Order.findOne({ _id: id, user: userId });
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

// ─── ADMIN: edit payment details (correct a typo'd txn id, number, etc.) ─────
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

  const isOwner = order.user.toString() === requester._id;
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
  const earnedWhen = {
    $cond: [
      { $or: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.status', 'paid'] }] },
      '$total',
      0,
    ],
  };
  const moneyGroup = {
    orders: { $sum: 1 },
    value: { $sum: '$total' },
    earned: { $sum: earnedWhen },
  };

  const [totalsAgg, todayAgg, newOrders, dailyAgg, statusAgg, methodAgg, couponsAgg] =
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
        { $group: { _id: '$status', orders: { $sum: 1 }, value: { $sum: '$total' } } },
      ]),
      Order.aggregate([
        { $match: { ...live, createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
        {
          $group: {
            _id: { $ifNull: ['$payment.method', 'unpaid'] },
            orders: { $sum: 1 },
            value: { $sum: '$total' },
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
    ]);

  // Fill every day in the window, so the chart has no gaps to interpolate over.
  const byDay = new Map(
    (dailyAgg as Array<{ _id: string; orders: number; value: number; earned: number }>).map((r) => [
      r._id,
      r,
    ])
  );
  const daily: Array<{ date: string; day: number; orders: number; value: number; earned: number }> = [];
  for (let t = rangeStart.getTime(); t < rangeEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    daily.push({
      date: key,
      day: d.getUTCDate(),
      orders: row?.orders ?? 0,
      value: row?.value ?? 0,
      earned: row?.earned ?? 0,
    });
  }

  const money = (agg: Array<{ orders: number; value: number; earned: number }>) => {
    const a = agg[0];
    const value = a?.value ?? 0;
    const earned = a?.earned ?? 0;
    return { orders: a?.orders ?? 0, value, earned, upcoming: Math.max(0, value - earned) };
  };

  const rangeTotals = daily.reduce(
    (t, d) => ({ orders: t.orders + d.orders, value: t.value + d.value, earned: t.earned + d.earned }),
    { orders: 0, value: 0, earned: 0 }
  );

  const c = (couponsAgg as Array<{ orders: number; discount: number; payout: number }>)[0];

  return {
    newOrders,
    today: money(todayAgg),
    totals: money(totalsAgg),
    range: {
      from: rangeStart.toISOString().slice(0, 10),
      to: new Date(rangeEnd.getTime() - 1).toISOString().slice(0, 10),
      ...rangeTotals,
      upcoming: Math.max(0, rangeTotals.value - rangeTotals.earned),
      daily,
    },
    byStatus: (statusAgg as Array<{ _id: string; orders: number; value: number }>).reduce(
      (acc, r) => ({ ...acc, [r._id]: { orders: r.orders, value: r.value } }),
      {} as Record<string, { orders: number; value: number }>
    ),
    byMethod: (methodAgg as Array<{ _id: string; orders: number; value: number }>).reduce(
      (acc, r) => ({ ...acc, [r._id]: { orders: r.orders, value: r.value } }),
      {} as Record<string, { orders: number; value: number }>
    ),
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
  updateOrderPayment,
  getDownloadUrl,
  deleteOrder,
  deleteOrders,
  updateOrdersStatus,
};
