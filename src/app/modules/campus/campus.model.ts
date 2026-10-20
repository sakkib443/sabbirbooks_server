/**
 * Campus orders (20 Oct 2026) — books sold through a batch's senior.
 *
 * The shop writes to a senior at a medical college; the senior posts the
 * shop's message in the batch group and collects orders until a last date,
 * with an extra discount per book (sometimes free delivery, sometimes a free
 * copy for the senior once enough are ordered). After the last date the senior
 * reports how many, the shop works out the money and sends the parcel.
 *
 * Two collections:
 *   CampusContact  the shop's phone book of seniors (and the ordinary students
 *                  it deals with where no senior takes the books), per college.
 *   CampusOrder    one such deal: who, how many, the price, the dates, and —
 *                  once the books go — the real Order it became (stock, courier
 *                  and the sales figures all run through that order).
 *
 * Days (contacted / last date / ship) are shop days as 'YYYY-MM-DD'.
 */
import { Schema, model, Types } from 'mongoose';

export const CONTACT_ROLES = ['senior', 'student', 'other'] as const;
export const CAMPUS_STATUSES = ['contacted', 'collecting', 'ready', 'cancelled'] as const;

const campusContactSchema = new Schema(
  {
    college: { type: Types.ObjectId, ref: 'MedicalCollege', required: true, index: true },
    name: { type: String, trim: true, required: true },
    phone: { type: String, trim: true, default: '' },
    // Who the books go to: the senior, or an ordinary student where the senior
    // does not take them.
    role: { type: String, enum: CONTACT_ROLES, default: 'senior' },
    batch: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

const campusOrderSchema = new Schema(
  {
    college: { type: Types.ObjectId, ref: 'MedicalCollege', default: null, index: true },
    collegeName: { type: String, trim: true, required: true },
    district: { type: String, trim: true, default: '' },
    upazila: { type: String, trim: true, default: '' },
    contact: {
      name: { type: String, trim: true, required: true },
      phone: { type: String, trim: true, default: '' },
      role: { type: String, enum: CONTACT_ROLES, default: 'senior' },
    },
    batch: { type: String, trim: true, default: '' },

    book: { type: Types.ObjectId, ref: 'Book', required: true },
    bookTitle: { type: String, trim: true, default: '' },
    // Copies the batch ordered (and pays for).
    quantity: { type: Number, min: 0, default: 0 },
    // The book's price when the deal was made, and the extra taken off each copy.
    unitPrice: { type: Number, min: 0, default: 0 },
    extraDiscount: { type: Number, min: 0, default: 0 },
    // "More than N copies → the senior gets a book free": the rule, and how
    // many free copies actually go (they leave the shelf, at no charge).
    giftAbove: { type: Number, min: 0, default: 0 },
    freeBooks: { type: Number, min: 0, default: 0 },
    freeDelivery: { type: Boolean, default: false },
    deliveryCharge: { type: Number, min: 0, default: 0 },
    // Worked out on every save (campus.service → priceOf); never typed.
    total: { type: Number, min: 0, default: 0 },
    payment: { type: String, enum: ['cod', 'paid'], default: 'cod' },

    contactedOn: { type: String, default: '' },
    deadline: { type: String, default: '' },
    shipOn: { type: String, default: '' },
    address: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '' },
    status: { type: String, enum: CAMPUS_STATUSES, default: 'contacted' },

    // The real order, once made. Its status and courier are the deal's from then on.
    order: { type: Types.ObjectId, ref: 'Order', default: null },
    createdBy: { type: Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);
campusOrderSchema.index({ createdAt: -1 });

export const CampusContact = model('CampusContact', campusContactSchema);
export const CampusOrder = model('CampusOrder', campusOrderSchema);
