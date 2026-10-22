/**
 * Incomplete orders (22 Oct 2026) — what a buyer typed on the checkout without
 * ordering, so the shop can call them.
 *
 * One record per contact: a phone number (or an email when there is no phone).
 * Before a contact is typed, the record is held by the visit's id and folded
 * into the contact's record once one is. Every new checkout visit by the same
 * contact adds one to `attempts` instead of making a second row. When that
 * contact places an order, the record is marked `ordered` (order.service).
 */
import { Schema, model, Types } from 'mongoose';

const incompleteOrderSchema = new Schema(
  {
    phone: { type: String, default: null, index: true, sparse: true },
    email: { type: String, default: null, index: true, sparse: true },
    // A number typed but not yet a full mobile — kept as text until it is.
    typedPhone: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    collegeName: { type: String, trim: true, default: '' },
    college: { type: Types.ObjectId, ref: 'MedicalCollege', default: null },
    bookSlug: { type: String, trim: true, default: '' },
    quantity: { type: Number, default: 1 },
    payMode: { type: String, default: '' },
    couponCode: { type: String, trim: true, default: '' },

    // Checkout visits this contact made (ids), and how many.
    sessions: { type: [String], default: [], index: true },
    attempts: { type: Number, default: 1 },
    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date(), index: true },

    status: { type: String, enum: ['open', 'ordered'], default: 'open', index: true },
    order: { type: Types.ObjectId, ref: 'Order', default: null },
    orderNumber: { type: String, default: '' },
    orderedAt: { type: Date, default: null },
    // Ordered AFTER being a real incomplete order (another visit, or long
    // after the first) — stays on the list with an "ordered" badge. A buyer
    // who simply filled the form and ordered in one go is not (23 Oct 2026).
    recovered: { type: Boolean, default: false },

    // The shop's follow-up.
    contacted: { type: Boolean, default: false },
    contactedAt: { type: Date, default: null },
    note: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export const IncompleteOrder = model('IncompleteOrder', incompleteOrderSchema);
