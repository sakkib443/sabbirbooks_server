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
    // Where the parcel goes, as opposed to `area` above, which is only the
    // billing zone the courier fee is looked up by. Kept as free text (not an
    // enum) because the buyer may type a district the college directory has
    // never heard of, and refusing their address over a spelling is not worth it.
    district: { type: String, trim: true, default: '' },
    division: { type: String, trim: true, default: '' },
    // Set alongside `city` (which holds the same value) — see IShippingAddress.
    upazila: { type: String, trim: true, default: '' },
    // Optional second number and this order's email — see IShippingAddress.
    altPhone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    note: { type: String },
  },
  { _id: false }
);

const orderCollegeSchema = new Schema(
  {
    college: { type: Schema.Types.ObjectId, ref: 'MedicalCollege' },
    name: { type: String, trim: true, required: true },
    district: { type: String, trim: true, default: '' },
    upazila: { type: String, trim: true, default: '' },
  },
  { _id: false }
);

/**
 * The parcel at the courier (Steadfast), once the order has been handed over
 * through the API. Absent on every order sent by hand or not sent at all.
 *
 * `status` is the courier's own word (in_review, pending, delivered,
 * partial_delivered, cancelled, hold, …), kept verbatim so nothing is lost in
 * translation; the courier pages group it. The money fields are what the
 * courier reports: `codAmount` asked of the buyer, `deliveryCharge` the courier
 * keeps, and `paymentId` once the courier has paid it out to the shop.
 */
const orderCourierSchema = new Schema(
  {
    provider: { type: String, default: 'steadfast' },
    consignmentId: { type: String, trim: true },
    trackingCode: { type: String, trim: true },
    status: { type: String, trim: true, default: 'in_review' },
    statusUpdatedAt: { type: Date },
    lastMessage: { type: String, trim: true, default: '' },
    codAmount: { type: Number, default: 0 },
    // What the courier actually took from the buyer — the COD amount on a
    // full delivery, the reported figure on a partial one, 0 on a return.
    collectedAmount: { type: Number, default: 0 },
    deliveryCharge: { type: Number, default: null },
    sentAt: { type: Date },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paymentId: { type: String, default: null },
    paidOutAt: { type: Date, default: null },
    // Every update the courier sent for this parcel, newest last (18 Oct 2026):
    // the buyer's tracking page (/t/CODE) is built from it, because Steadfast's
    // public tracking needs a token its API never hands out.
    history: {
      type: [
        new Schema(
          { status: { type: String, default: '' }, message: { type: String, default: '' }, at: { type: Date, default: Date.now } },
          { _id: false }
        ),
      ],
      default: [],
    },
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
    // Human-friendly running number (#1, #2, …). Assigned from an atomic counter
    // at create time (order.service). Not `required`/`unique` at the schema level:
    // rows created before this field existed have none until the backfill runs.
    orderSeq: { type: Number, index: true },
    // Not required: a guest order has no account. See IOrder.user.
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    college: { type: orderCollegeSchema, required: false },
    deliveryRule: { type: String, enum: ['digital', 'free-above', 'college', 'standard'] },
    accessKeyHash: { type: String, select: false },
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
    // Coupon breakdown, snapshotted at checkout (see order.interface). Payout is
    // what the shop owes the coupon owner for this sale; the report sums it.
    couponDiscount: { type: Number, default: 0, min: 0 },
    couponPayout: { type: Number, default: 0, min: 0 },
    // Bulk discount snapshot — see order.interface.
    quantityDiscount: { type: Number, default: 0, min: 0 },
    quantityDiscountLabel: { type: String, default: '', trim: true },
    // What a free-delivery coupon took off the delivery row. Recorded so the
    // admin can see WHY an order shows ৳0 delivery — otherwise it is
    // indistinguishable from a college that qualifies for free local delivery.
    deliveryWaived: { type: Number, default: 0, min: 0 },
    // Snapshot of the courier fee quoted at checkout. Old orders predate this
    // field, so default 0 keeps their totals reading correctly.
    deliveryCharge: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    payment: { type: orderPaymentSchema, required: true, default: () => ({ status: 'pending' }) },
    // When the parcel came back (status 'returned').
    returnedAt: { type: Date },
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
        // The courier brought the parcel back (22 Oct 2026). Set by itself when
        // Steadfast reports the parcel cancelled/returned, or by an admin.
        'returned',
      ],
      default: 'pending',
    },

    // Set when any line was a pre-order at checkout. Drives the "pre-order" badge
    // on the admin queue and the buyer's order list; default false means every
    // order written before this feature reads back as an ordinary order.
    isPreOrder: { type: Boolean, default: false },

    // Set the first time stock is taken off the shelf for this order. Payment
    // status alone can no longer answer "have we already decremented?" — a COD
    // order reserves stock at confirmation and only becomes 'paid' days later at
    // delivery, which would otherwise decrement the same copies twice.
    stockAdjusted: { type: Boolean, default: false },

    // When the "new order" alerts went out (admin Telegram/WhatsApp + the
    // buyer's own email). A COD order raises them the moment it is placed; an
    // order paid at a hosted gateway raises them when the money actually
    // arrives, because until then there may be no order at all. One stamp so
    // that whichever moment comes first, the second one stays quiet.
    alertsSentAt: { type: Date },

    // Which SMS this order has already sent: 'placed' | 'paid' | 'confirmed' |
    // 'delivered'. Stored on the order rather than held in memory because the
    // events are days apart, an admin can walk a status backwards and forwards,
    // and the shop runs more than one replica — none of which an in-process
    // guard survives. See notification/orderSms.service.ts.
    smsSent: { type: [String], default: [] },

    // Fulfillment trail — stamped by the admin actions, read by the order
    // timeline on both the admin page and the buyer's "my orders" list.
    confirmedAt: { type: Date },
    shippedAt: { type: Date },
    deliveredAt: { type: Date },
    cancelledAt: { type: Date },
    courierName: { type: String, trim: true },
    trackingCode: { type: String, trim: true },
    // The courier's own tracking page for this parcel. Kept apart from
    // `trackingCode` because it is the thing a buyer can actually press: the
    // shipped SMS carries it, and a code without a link is a code nobody looks
    // up. Stored exactly as the courier hands it over.
    trackingUrl: { type: String, trim: true },
    adminNote: { type: String, trim: true },
    // Where the order came from: the website, the Add order form, or a sheet
    // upload (manualOrder.service). externalRef is the sheet's own order
    // number, so uploading the same sheet twice adds nothing twice.
    source: { type: String, enum: ['web', 'manual', 'import', 'campus'], default: 'web' },
    externalRef: { type: String, trim: true, index: true, sparse: true },

    // The day this order counts as going out, when that is NOT the day it was
    // placed.
    //
    // The shop batches a college's orders: three days of Cumilla orders leave
    // together on the 21st. Those orders were placed on the 19th and 20th, so
    // the packing list for the 21st has to contain them and the lists for the
    // 19th and 20th must not — which is exactly what the admin means by
    // "change the delivery date". Null (and missing, on every order that
    // predates this field) means the order still counts on the day it was
    // placed.
    //
    // A date-time rather than a "2026-09-21" string: the shop's day runs noon
    // → noon Bangladesh time, so a bare date would have to be re-interpreted
    // on every read. The API stores the chosen day's window start, and the
    // list filter compares it exactly as it compares createdAt.
    dispatchDate: { type: Date, default: null },

    // The parcel at the courier — see orderCourierSchema.
    courier: { type: orderCourierSchema, default: undefined },
  },
  { timestamps: true }
);

orderSchema.index({ 'courier.consignmentId': 1 }, { sparse: true });
orderSchema.index({ 'courier.sentAt': -1 }, { sparse: true });

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
// The admin orders page filters by payment method (COD queue vs. wallet queue).
orderSchema.index({ 'payment.method': 1, 'payment.status': 1 });
// The day filter reads dispatchDate first and falls back to createdAt, so both
// halves of that OR need an index or a date-filtered page scans the collection.
orderSchema.index({ dispatchDate: 1, createdAt: -1 });

export const Order = model<IOrder>('Order', orderSchema);
