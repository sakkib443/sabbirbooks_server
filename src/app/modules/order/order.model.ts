import { Schema, model } from 'mongoose';
import { IOrder } from './order.interface';

// Embedded payment sub-doc — same shape as enrollment.model's paymentSchema so
// the two purchase records stay consistent. `method` is left optional: the order
// is born pending and the buyer chooses bkash/sslcommerz later at the pay step.
const orderPaymentSchema = new Schema(
  {
    method: {
      type: String,
      enum: ['bkash', 'sslcommerz', 'manual', 'cod', 'free'],
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    transactionId: { type: String },
    paidAt: { type: Date },

    // Manual payment (bKash/Rocket/Nagad Send Money) — buyer-submitted, admin-verified
    channel: { type: String, enum: ['bkash', 'rocket', 'nagad'] },
    senderNumber: { type: String },
    sentAt: { type: Date },
    note: { type: String },
    submittedAt: { type: Date },
  },
  { _id: false }
);

const orderItemSchema = new Schema(
  {
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    title: { type: String, required: true },
    // Effective UNIT price (offerPrice ?? price) snapshotted at checkout.
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    format: { type: String, enum: ['printed', 'digital'], required: true },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    area: {
      type: String,
      enum: ['inside-dhaka', 'outside-dhaka'],
      default: 'outside-dhaka',
    },
    note: { type: String },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    // Auto human-readable reference, e.g. ORD-1720598400000-A1B2C3.
    orderNumber: {
      type: String,
      unique: true,
      default: () =>
        `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    deliveryType: {
      type: String,
      enum: ['printed', 'digital', 'mixed'],
      required: true,
    },
    // Required at the service layer whenever any item is printed.
    shippingAddress: { type: shippingAddressSchema, required: false },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, uppercase: true, trim: true },
    // Snapshot of the courier fee quoted at checkout. Old orders predate this
    // field, so default 0 keeps their totals reading correctly.
    deliveryCharge: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    payment: { type: orderPaymentSchema, required: true, default: () => ({ status: 'pending' }) },
    status: {
      type: String,
      enum: [
        'pending',
        'paid',
        'processing',
        'shipped',
        'delivered',
        'access-granted',
        'cancelled',
      ],
      default: 'pending',
    },

    // Set the first time stock is taken off the shelf for this order. Payment
    // status alone can no longer answer "have we already decremented?" — a COD
    // order reserves stock at confirmation and only becomes 'paid' days later at
    // delivery, which would otherwise decrement the same copies twice.
    stockAdjusted: { type: Boolean, default: false },

    // Fulfillment trail — stamped by the admin actions, read by the order
    // timeline on both the admin page and the buyer's "my orders" list.
    confirmedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    courierName: { type: String, trim: true },
    trackingCode: { type: String, trim: true },
    adminNote: { type: String, trim: true },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// The admin orders page filters by payment method (COD queue vs. wallet queue).
orderSchema.index({ 'payment.method': 1, 'payment.status': 1 });

export const Order = model<IOrder>('Order', orderSchema);
