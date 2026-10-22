/**
 * The delivery part of an order's money, as the shop counts it (22 Oct 2026).
 *
 * Every printed parcel costs the shop the courier's charge, whether the buyer
 * paid delivery or got it free with a discount. So "without delivery" figures
 * always take at least COURIER_COST (৳120) off a printed order's total — the
 * order's own delivery charge when it is more (extra books), never more than
 * the total itself. A digital order ships nothing.
 */
export const COURIER_COST = 120;

/** The Mongo expression for an order's delivery money ($-paths of an Order). */
export const deliveryOfExpr = {
  $cond: [
    { $eq: ['$deliveryType', 'digital'] },
    { $ifNull: ['$deliveryCharge', 0] },
    { $min: [{ $ifNull: ['$total', 0] }, { $max: [{ $ifNull: ['$deliveryCharge', 0] }, COURIER_COST] }] },
  ],
};
