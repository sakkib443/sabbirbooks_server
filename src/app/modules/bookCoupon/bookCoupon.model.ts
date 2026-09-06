import { Schema, model } from 'mongoose';

// ─────────────────────────────────────────────────────────────
// Book Coupon — a discount code for the BOOK checkout, separate from the
// course-side CourseCoupon. Two jobs in one document:
//
//   1. Discount   — percent or fixed taka off, and/or the delivery charge
//                   waived, applied on top of whatever per-book offer
//                   (pre-order / online / normal) is already live.
//   2. Affiliate  — every code belongs to a person ("owner") who brings buyers.
//                   `payoutPerSale` is what the shop pays that owner for each sale
//                   made under the code, so 20 sales at ৳50 = ৳1000 owed to them.
//
// Both numbers are snapshotted onto the order at checkout (order.couponDiscount /
// couponPayout), so editing the coupon later never rewrites past orders — the
// payout report sums those snapshots.
//
// EVERY LIMIT BELOW IS OFF BY DEFAULT. A coupon written before these fields
// existed has no window, no cap and no restriction, and must keep behaving
// exactly as it did — so 0 and null mean "no limit" rather than "limit of
// zero", and the checks in bookCoupon.controller.ts read them that way. A
// migration that silently expired live codes would be a worse bug than any
// this file prevents.
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

    // ── What the buyer gets ────────────────────────────────────────────────
    // The buyer-facing discount. Capped at 90% like the book offers so a typo
    // cannot zero a price; a fixed amount is clamped to the price at checkout.
    discountType: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
    discountValue: { type: Number, default: 0, min: 0 },

    /**
     * Ceiling on a percentage discount, in taka. 0 = uncapped.
     *
     * "20% off, up to ৳100" is the shape almost every real campaign takes, and
     * without it a percentage code is an open cheque against the most expensive
     * basket anyone assembles. Meaningless for a fixed-amount coupon, and
     * ignored there rather than enforced, so switching type cannot strand a
     * value the admin cannot see.
     */
    maxDiscount: { type: Number, default: 0, min: 0 },

    /**
     * Waive the delivery charge.
     *
     * Its own flag rather than a third discountType, because the shop asked for
     * codes that do BOTH — 10% off AND free delivery — and a type field can
     * only ever be one thing. A pure free-delivery coupon is this flag with
     * discountValue 0, which is also the cheapest kind of promotion to run.
     */
    freeDelivery: { type: Boolean, default: false },

    // ── When it works ──────────────────────────────────────────────────────
    // null on either side means "no bound that way": null validFrom works from
    // the moment it is created, null validUntil never expires. Both null is the
    // state every pre-existing coupon is in.
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },

    // ── How many times ─────────────────────────────────────────────────────
    /** Total redemptions allowed across all buyers. 0 = unlimited. */
    maxUses: { type: Number, default: 0, min: 0 },
    /**
     * Redemptions allowed per buyer account. 0 = unlimited.
     *
     * Counted from the orders themselves rather than a tally on the coupon —
     * cancelled orders should not burn someone's one use, and only the order
     * collection knows which those are.
     */
    maxUsesPerBuyer: { type: Number, default: 0, min: 0 },

    // ── When it applies ────────────────────────────────────────────────────
    /** Minimum product total (after the book's own offers) in taka. 0 = none. */
    minPurchase: { type: Number, default: 0, min: 0 },
    /**
     * Restrict to one payment path.
     *
     * 'cod' pairs naturally with freeDelivery — "order by cash on delivery this
     * week and we pay the courier" — while 'online' is how a shop pushes
     * prepayment. 'all' is the default and the state of every existing coupon.
     */
    appliesTo: { type: String, enum: ['all', 'cod', 'online'], default: 'all' },

    // What the shop pays the owner for each sale under this code. 0 = a plain
    // discount coupon with no affiliate payout.
    payoutPerSale: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true },
    // Bumped on every order that uses the code (the payout report is the accurate
    // count — it filters out cancelled orders — but this is a cheap live tally,
    // and it is what maxUses is measured against).
    usedCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// `code` already has unique:true above, which creates its index — no separate
// schema.index() (that is the "Duplicate schema index" Mongoose warns about).

export const BookCoupon = model('BookCoupon', bookCouponSchema);
