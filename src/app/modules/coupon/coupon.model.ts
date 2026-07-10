import { Schema, model } from 'mongoose';

// ─────────────────────────────────────────────────────────────
// Course Coupon (discount code) — applies to COURSE checkout.
// Site-wide: one coupon works on every course. Model: CourseCoupon.
// (IELTS mock has its own separate IeltsCoupon.)
// ─────────────────────────────────────────────────────────────
const courseCouponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true },
    maxUses: { type: Number, required: true, default: 100 },
    usedCount: { type: Number, default: 0 },
    validFrom: { type: Date, required: true, default: Date.now },
    validUntil: { type: Date, required: true },
    minPurchase: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

courseCouponSchema.index({ code: 1 });

export const CourseCoupon = model('CourseCoupon', courseCouponSchema);
