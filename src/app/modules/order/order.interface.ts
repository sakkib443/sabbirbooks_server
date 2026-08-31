import { Types } from 'mongoose';

// Order payment methods.
//   manual → buyer Send-Money'd to our wallet and submitted a TrxID
//   cod    → pays the courier in cash when the parcel arrives
// 'cod' only ever applies to printed items; there is nothing to hand over for a
// digital download, so the service rejects that combination.
export type TOrderPaymentMethod = 'bkash' | 'sslcommerz' | 'manual' | 'cod' | 'free';
export type TOrderPaymentStatus = 'pending' | 'paid' | 'failed';

// Which courier zone the parcel goes to — drives the delivery charge.
export type TDeliveryArea = 'inside-dhaka' | 'outside-dhaka';

// For manual payments, which mobile-wallet the buyer used to Send Money.
export type TOrderPaymentChannel = 'bkash' | 'rocket' | 'nagad';

// printed → needs shipping; digital → instant download; mixed → at least one of each.
export type TDeliveryType = 'printed' | 'digital' | 'mixed';

// The fulfillment ladder. A cash-on-delivery order sits at 'pending' until an
// admin confirms it — that confirmation, not the order being placed, is what
// starts fulfillment and opens the book's QR content (see bookAccess's
// PAID_ORDER_STATUSES). Otherwise anyone could type a fake address and read the
// whole book for free.
export type TOrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'access-granted'
  | 'cancelled';

// Embedded payment record — mirrors enrollment's IPayment shape. `method` is
// optional because an order is created pending, before the buyer picks a gateway.
export interface IOrderPayment {
  method?: TOrderPaymentMethod;
  status: TOrderPaymentStatus;
  transactionId?: string;
  paidAt?: Date;

  // ── Manual payment (bKash/Rocket/Nagad Send Money) fields ──
  // Present when method === 'manual'. The buyer submits these; the admin verifies
  // against the wallet statement and approves (→ status 'paid') or rejects.
  channel?: TOrderPaymentChannel; // which wallet the money was sent from
  senderNumber?: string; // the number the buyer sent from
  sentAt?: Date; // when the buyer says they sent it
  note?: string; // optional buyer note
  submittedAt?: Date; // when the manual details were submitted
}

// One purchased line. `price` is the effective UNIT price (offerPrice ?? price)
// captured at checkout time, so later catalog price changes don't rewrite history.
export interface IOrderItem {
  book: Types.ObjectId;
  title: string;
  price: number;
  quantity: number;
  format: 'printed' | 'digital';
}

// Required only when the order contains any printed item.
export interface IShippingAddress {
  name: string;
  phone: string;
  address: string;
  city: string;
  // Courier zone; defaults to outside-dhaka (the more expensive of the two) so a
  // client that forgets to send it can never under-charge us.
  area?: TDeliveryArea;
  // Geography, NOT the courier zone. `area` is one of two billing buckets;
  // `district`/`division` are where the parcel actually goes, prefilled from the
  // buyer's medical college. The zone is derived from the district at checkout,
  // but the two stay separate fields — merging them would lose the address the
  // courier needs the moment a third zone is priced.
  district?: string;
  division?: string;
  // The upazila/thana — the most local of the three geo levels the buyer picks
  // (division → district → upazila). `city` is set to this too, so the required
  // city field and the notification address line stay populated without a
  // separate free-text town; this holds the same value under its real name.
  upazila?: string;
  note?: string;
}

export interface IOrder {
  orderNumber: string;
  // Human-friendly running number (#1, #2, …) shown to admin and buyer. Assigned
  // from an atomic counter at create time; existing rows are numbered by a
  // one-time backfill (createdAt order). Optional so pre-backfill rows still type.
  orderSeq?: number;
  user: Types.ObjectId;
  items: IOrderItem[];
  deliveryType: TDeliveryType;
  shippingAddress?: IShippingAddress;
  subtotal: number;
  // Every taka off the product price — the book's own offers PLUS any coupon.
  discount: number;
  // Coupon breakdown, snapshotted at checkout so a later edit to the coupon never
  // rewrites this order. `couponDiscount` is the buyer's saving from the code;
  // `couponPayout` is what the shop owes the coupon's owner for this one sale.
  couponCode?: string;
  couponDiscount?: number;
  couponPayout?: number;
  // Snapshotted at checkout from the site settings, so changing the rate later
  // never rewrites what an existing customer was quoted.
  deliveryCharge: number;
  total: number;
  payment: IOrderPayment;
  status: TOrderStatus;
  // True when any line was a pre-order at checkout time. Snapshotted rather than
  // re-derived from the books, because the book stops being a pre-order the day
  // it is printed and this order's discount must still be explicable afterwards.
  // Optional: orders placed before pre-ordering existed carry no flag.
  isPreOrder?: boolean;
  // True once this order's copies have been taken out of stock. Guards the
  // decrement against running twice on the COD confirm → deliver path.
  stockAdjusted?: boolean;
  // When the "new order" alerts went out — see the note on the schema field.
  alertsSentAt?: Date;
  // Admin bookkeeping for the fulfillment timeline shown on the orders page.
  confirmedAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  courierName?: string;
  trackingCode?: string;
  adminNote?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
