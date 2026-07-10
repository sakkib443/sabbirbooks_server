/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidObjectId } from 'mongoose';
import { Order } from './order.model';
import { IOrder, IShippingAddress, TDeliveryType } from './order.interface';
import { Book } from '../book/book.model';
import { User } from '../user/user.model';
import { BkashService } from '../payment/bkash.service';
import { SslcommerzService } from '../payment/sslcommerz.service';

// Resolve a book by slug / numeric id / Mongo _id — same tolerant lookup the
// book module exposes publicly (client may send either a slug or an _id).
const resolveBook = async (slugOrId: string) => {
  const or: Record<string, unknown>[] = [{ slug: slugOrId }];
  if (!isNaN(Number(slugOrId))) or.push({ id: Number(slugOrId) });
  if (isValidObjectId(slugOrId)) or.push({ _id: slugOrId });
  return Book.findOne({ $or: or });
};

// ─── CREATE ORDER ────────────────────────────────────────────
// Looks up each book, snapshots the effective unit price (offerPrice ?? price),
// computes subtotal/total server-side, and enforces shipping + stock for printed
// items. Returns a `pending` order awaiting payment.
const createOrder = async (
  userId: string,
  payload: {
    items: { bookSlugOrId: string; quantity: number }[];
    shippingAddress?: IShippingAddress;
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

    // Effective unit price = offer price if set, else base price.
    const unitPrice = book.offerPrice != null ? book.offerPrice : book.price;

    items.push({
      book: book._id as any,
      title: book.title,
      price: unitPrice,
      quantity: qty,
      format: book.format,
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

  const subtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const discount = 0;
  const total = subtotal - discount;

  const order = await Order.create({
    user: userId,
    items,
    deliveryType,
    shippingAddress: hasPrinted ? payload.shippingAddress : undefined,
    subtotal,
    discount,
    total,
    payment: { status: 'pending' },
    status: 'pending',
  });

  return order;
};

// ─── GET my orders ───────────────────────────────────────────
const getMyOrders = async (userId: string): Promise<IOrder[]> => {
  return Order.find({ user: userId }).sort({ createdAt: -1 });
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
  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return { orders, total, page, totalPages: Math.ceil(total / limit) };
};

// ─── PATCH status (admin fulfillment) ────────────────────────
const updateOrderStatus = async (id: string, status: string): Promise<IOrder> => {
  if (!isValidObjectId(id)) throw new Error('Invalid order id');
  const order = await Order.findByIdAndUpdate(id, { status }, { new: true });
  if (!order) throw new Error('Order not found');
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

// ─── COMPLETE payment (DEMO / gateway callback) ──────────────
// Marks paid, decrements printed stock, bumps totalSold, and moves the order to
// its post-payment state (printed/mixed → processing, digital → access-granted).
const completePayment = async (
  id: string,
  userId: string,
  body?: { method?: string; transactionId?: string }
): Promise<IOrder> => {
  const order = await Order.findOne({ _id: id, user: userId });
  if (!order) throw new Error('Order not found');

  if (order.payment.status !== 'paid') {
    // Decrement stock + record the sale only on the first successful completion.
    for (const item of order.items) {
      if (item.format === 'printed') {
        await Book.findByIdAndUpdate(item.book, {
          $inc: { stock: -item.quantity, totalSold: item.quantity },
        });
      } else {
        await Book.findByIdAndUpdate(item.book, { $inc: { totalSold: item.quantity } });
      }
    }
  }

  order.payment.status = 'paid';
  order.payment.paidAt = new Date();
  if (body?.method && ['bkash', 'sslcommerz', 'manual', 'free'].includes(body.method)) {
    order.payment.method = body.method as any;
  } else if (!order.payment.method) {
    order.payment.method = 'manual';
  }
  order.payment.transactionId =
    body?.transactionId || order.payment.transactionId || `TRX-${Date.now()}`;

  order.status = order.deliveryType === 'digital' ? 'access-granted' : 'processing';

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
  getMyOrders,
  getOrderById,
  getAllOrders,
  updateOrderStatus,
  payWithBkash,
  payWithSslcommerz,
  completePayment,
  getDownloadUrl,
};
