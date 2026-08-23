import { Course } from '../courses/course.model';
import { evaluateCourseCoupon } from '../coupon/coupon.controller';

/**
 * What a course actually costs, decided by the server.
 *
 * Checkout used to take `amount` straight from the request body and bill that,
 * so a buyer could initiate a 5,000৳ course for 1৳ — or 0৳ — simply by editing
 * the JSON. The browser is free to compute a price for display; it is not
 * allowed to be the one that decides it.
 *
 * Mirrors effectiveCoursePrice() in the client's checkout/types.ts: an offer
 * price counts only when it is set and genuinely lower than the fee. The two
 * must agree, or the buyer is quoted one number and charged another.
 */

const toNumber = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export const effectiveCoursePrice = (course: { fee?: unknown; offerPrice?: unknown }): number => {
  const fee = toNumber(course.fee);
  const offer = toNumber(course.offerPrice);
  return offer > 0 && offer < fee ? offer : fee;
};

export type ResolvedPrice = {
  /** What to charge, after any coupon the server itself validated. */
  amount: number;
  /** Undiscounted price, for the enrollment's customFee record. */
  listPrice: number;
  couponCode?: string;
  couponDiscount: number;
};

/**
 * Resolve the price for a course + optional coupon, from the database only.
 *
 * The coupon is re-evaluated here rather than trusting `couponDiscount` from
 * the body — otherwise "discount: 4999" is just a cheaper way of asking for the
 * course free. An invalid or expired code is ignored rather than fatal: the
 * buyer pays full price instead of hitting an error mid-checkout.
 */
export const resolveCoursePrice = async (
  courseId: string,
  couponCode?: string
): Promise<ResolvedPrice> => {
  const course = await Course.findById(courseId).select('fee offerPrice').lean();
  if (!course) throw new Error('Course not found');

  const listPrice = effectiveCoursePrice(course);
  if (!couponCode) return { amount: listPrice, listPrice, couponDiscount: 0 };

  try {
    const { discountAmount, finalPrice } = await evaluateCourseCoupon(couponCode, listPrice);
    return {
      amount: Math.max(0, finalPrice),
      listPrice,
      couponCode,
      couponDiscount: discountAmount,
    };
  } catch {
    return { amount: listPrice, listPrice, couponDiscount: 0 };
  }
};
