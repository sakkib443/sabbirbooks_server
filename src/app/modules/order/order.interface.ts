import { Types } from 'mongoose';

// Order payment methods — mirrors the enrollment payment sub-doc, minus 'cash'
// (books are bought online, not at a counter).
export type TOrderPaymentMethod = 'bkash' | 'sslcommerz' | 'manual' | 'free';
export type TOrderPaymentStatus = 'pending' | 'paid' | 'failed';

// For manual payments, which mobile-wallet the buyer used to Send Money.
export type TOrderPaymentChannel = 'bkash' | 'rocket' | 'nagad';

// printed → needs shipping; digital → instant download; mixed → at least one of each.
export type TDeliveryType = 'printed' | 'digital' | 'mixed';

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
  note?: string;
}

export interface IOrder {
  orderNumber: string;
  user: Types.ObjectId;
  items: IOrderItem[];
  deliveryType: TDeliveryType;
  shippingAddress?: IShippingAddress;
  subtotal: number;
  discount: number;
  couponCode?: string;
  total: number;
  payment: IOrderPayment;
  status: TOrderStatus;
  createdAt?: Date;
  updatedAt?: Date;
}
