/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { Order } from './order.model';
import { IOrder, IShippingAddress, TDeliveryType, TDeliveryArea } from './order.interface';
import { Book } from '../book/book.model';
import { User } from '../user/user.model';
import { BkashService } from '../payment/bkash.service';
import { SslcommerzService } from '../payment/sslcommerz.service';
import { SettingsService } from '../settings/settings.services';
import { OrderAlertService } from '../notification/orderAlert.service';

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
  area: TDeliveryArea;
  subtotal: number;
  isCod: boolean;
}): Promise<number> => {
  if (!opts.hasPrinted) return 0;

  const s: any = await SettingsService.getSettingsService();

  const freeAbove = Number(s?.freeDeliveryAbove) || 0;
  if (freeAbove > 0 && opts.subtotal >= freeAbove) return 0;

  const base =
    opts.area === 'inside-dhaka'
      ? Number(s?.deliveryChargeInsideDhaka)
      : Number(s?.deliveryChargeOutsideDhaka);

  // Number(undefined) is NaN, and NaN would poison the order total — fall back
  // to the documented default rather than writing a broken number.
  const charge = Number.isFinite(base) ? base : 120;
  const codExtra = opts.isCod ? Number(s?.codExtraCharge) || 0 : 0;

  return Math.max(0, Math.round(charge + codExtra));
};

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
// The order is born `pending` either way. What differs is what happens next:
//   manual → buyer submits a TrxID, admin verifies it
//   cod    → admin confirms the order, then the courier collects the cash
const createOrder = async (
  userId: string,
  payload: {
    items: { bookSlugOrId: string; quantity: number }[];
    shippingAddress?: IShippingAddress;
    paymentMethod?: 'manual' | 'cod';
  }
): Promise<IOrder> => {
  const items: IOrder['items'] = [];
  let hasPrinted = false;
  let hasDigital = false;

  for (const line of payload.items) {
    const qty = line.quantity && line.quantity > 0 ? line.quantity : 1;
    const book = await resolveBook(line.bookSlugOrId);
    if (!book) {
      throw new Error(`Book not found: ${line.bookSlugOrId}`);
    }

    if (book.format === 'printed') {
      hasPrinted = true;
      if ((book.stock ?? 0) < qty) {
        throw new Error(`Insufficient stock for "${book.title}" (available: ${book.stock ?? 0})`);
      }
    } else {
      hasDigital = true;
    }

    // Effective unit price = offer price if set, else base price (0 when unset).
    const unitPrice = book.offerPrice != null ? book.offerPrice : (book.price ?? 0);

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

  const area: TDeliveryArea =
    payload.shippingAddress?.area === 'inside-dhaka' ? 'inside-dhaka' : 'outside-dhaka';

  const subtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const discount = 0;
  const deliveryCharge = await quoteDeliveryCharge({
    hasPrinted,
    area,
    subtotal: subtotal - discount,
    isCod: method === 'cod',
  });
  const total = subtotal - discount + deliveryCharge;

  const order = await Order.create({
    user: userId,
    items,
    deliveryType,
    shippingAddress: hasPrinted ? { ...payload.shippingAddress, area } : undefined,
    subtotal,
    discount,
    deliveryCharge,
    total,
    // COD records its method up front — there is no later "pay" step to set it,
    // and the admin queue filters on it.
    payment: method === 'cod' ? { method: 'cod', status: 'pending' } : { status: 'pending' },
    status: 'pending',
  });

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

  return order;
};

/**
 * What checkout needs before the buyer picks anything: which methods are on,
 * and what delivery would cost each way. Public — no order exists yet.
 */
const getCheckoutOptions = async (subtotal = 0) => {
  const s: any = await SettingsService.getSettingsService();
  const enabled = await getEnabledPaymentMethods();

  const quote = (area: TDeliveryArea) =>
    quoteDeliveryCharge({ hasPrinted: true, area, subtotal, isCod: false });

  const [insideDhaka, outsideDhaka] = await Promise.all([
    quote('inside-dhaka'),
    quote('outside-dhaka'),
  ]);

  return {
    codEnabled: enabled.cod,
    onlinePaymentEnabled: enabled.online,
    deliveryCharge: { 'inside-dhaka': insideDhaka, 'outside-dhaka': outsideDhaka },
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
    .populate('user', 'firstName lastName email phoneNumber')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return { orders, total, page, totalPages: Math.ceil(total / limit) };
};

// ─── PATCH status (admin fulfillment) ────────────────────────
//
// More than a field write. Moving an order along the ladder has consequences:
//   processing → the order is confirmed; stock is reserved and (via
//                bookAccess's PAID_ORDER_STATUSES) the buyer's QR content opens
//   delivered  → a cash-on-delivery order is now actually paid
//   cancelled  → reserved stock goes back on the shelf
const updateOrderStatus = async (
  id: string,
  status: string,
  extra?: { courierName?: string; trackingCode?: string; adminNote?: string }
): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order: any = await Order.findById(id);
  if (!order) throw new Error('Order not found');

  const now = new Date();

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
  return order;
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
  await applyStockOnce(order);
  order.payment.status = 'paid';
  order.payment.paidAt = new Date();
  // Delivered parcels stay delivered — settling the cash must not walk the
  // status backwards to 'processing'.
  if (order.status !== 'delivered' && order.status !== 'shipped') {
    order.status = order.deliveryType === 'digital' ? 'access-granted' : 'processing';
  }
  if (!order.confirmedAt) order.confirmedAt = new Date();
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

export const OrderService = {
  createOrder,
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
};
