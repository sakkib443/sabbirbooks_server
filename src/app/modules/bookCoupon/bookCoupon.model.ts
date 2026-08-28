import { Schema, model } from 'mongoose';

// ─────────────────────────────────────────────────────────────
// Book Coupon — a discount code for the BOOK checkout, separate from the
// course-side CourseCoupon. Two jobs in one document:
//
//   1. Discount   — percent or fixed taka off, applied on top of whatever
//                   per-book offer (pre-order / online / normal) is already live.
//   2. Affiliate  — every code belongs to a person ("owner") who brings buyers.
//                   `payoutPerSale` is what the shop pays that owner for each sale
//                   made under the code, so 20 sales at ৳50 = ৳1000 owed to them.
//
// Both numbers are snapshotted onto the order at checkout (order.couponDiscount /
// couponPayout), so editing the coupon later never rewrites past orders — the
// payout report sums those snapshots.
// ─────────────────────────────────────────────────────────────
const bookCouponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // A human name for the campaign, e.g. "রাকিবের রেফারেল". Optional.
    name: { type: String, default: '' },

    // Who the code belongs to and how to reach them to hand over the payout.
    ownerName: { type: String, default: '' },
    ownerPhone: { type: String, default: '' },
    // Optional login for that owner — an 'affiliate' User created alongside the
    // coupon. When set, they can sign in and see their own sales and earnings.
    // The coupon still works exactly the same without one.
    ownerUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // The buyer-facing discount. Capped at 90% like the book offers so a typo
    // cannot zero a price; a fixed amount is clamped to the price at checkout.
    discountType: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    discountValue: { type: Number, default: 0, min: 0 },

    // What the shop pays the owner for each sale under this code. 0 = a plain
    // discount coupon with no affiliate payout.
    payoutPerSale: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
    // Bumped on every order that uses the code (the payout report is the accurate
    // count — it filters out cancelled orders — but this is a cheap live tally).
    usedCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// `code` already has unique:true above, which creates its index — no separate
// schema.index() (that is the "Duplicate schema index" Mongoose warns about).

export const BookCoupon = model('BookCoupon', bookCouponSchema);
