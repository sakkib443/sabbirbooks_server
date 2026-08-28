/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { BookCoupon } from './bookCoupon.model';
import { Order } from '../order/order.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

// Shared evaluation — the ONE place a coupon turns into taka. `amount` is the
// product total AFTER the book's own offers (pre-order / online / normal), so the
// coupon stacks on top of whatever discount is already live. Never discounts more
// than the amount it is applied to. Throws a buyer-friendly Error when unusable.
export const evaluateBookCoupon = async (code: string, amount: number) => {
  const coupon: any = await BookCoupon.findOne({ code: String(code || '').toUpperCase().trim() });
  if (!coupon) throw new Error('Invalid coupon code');
  if (!coupon.isActive) throw new Error('This coupon is not active');

  const price = Math.max(0, Number(amount) || 0);
  let discountAmount = 0;
  if (coupon.discountType === 'percent') {
    const pct = Math.min(90, Math.max(0, Number(coupon.discountValue) || 0));
    discountAmount = Math.round((price * pct) / 100);
  } else {
    discountAmount = Math.max(0, Number(coupon.discountValue) || 0);
  }
  discountAmount = Math.min(discountAmount, price); // never below zero
  return { coupon, discountAmount, finalPrice: Math.max(0, price - discountAmount) };
};

// ═══════════════ Checkout (any logged-in buyer) ═══════════════
// POST /validate { code, amount } → the discount for a preview. The order service
// re-evaluates on create, so this is display only and cannot be tampered into a
// real price.
export const validateCoupon = async (req: Request, res: Response) => {
  try {
    const { code, amount } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });
    const { coupon, discountAmount, finalPrice } = await evaluateBookCoupon(code, amount);
    res.json({
      success: true,
      data: {
        valid: true,
        code: coupon.code,
        name: coupon.name || '',
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        finalPrice,
        originalPrice: Math.max(0, Number(amount) || 0),
      },
    });
  } catch (e: any) {
    res.status(400).json({ success: false, valid: false, message: e.message });
  }
};

// ═══════════════ Admin ═══════════════
export const getAllCoupons = async (_req: Request, res: Response) => {
  try {
    const list = await BookCoupon.find().sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getCouponById = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const coupon = await BookCoupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const createCoupon = async (req: Request, res: Response) => {
  try {
    const code = String(req.body.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });
    const existing = await BookCoupon.findOne({ code });
    if (existing) return res.status(409).json({ success: false, message: 'A coupon with this code already exists' });
    const coupon = await BookCoupon.create({ ...req.body, code, createdBy: uid(req) });
    res.status(201).json({ success: true, data: coupon });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const updateCoupon = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const data: any = { ...req.body };
    delete data.usedCount; // never client-set — bumped by the order service
    if (data.code) {
      data.code = String(data.code).toUpperCase().trim();
      const clash = await BookCoupon.findOne({ code: data.code, _id: { $ne: req.params.id } });
      if (clash) return res.status(409).json({ success: false, message: 'A coupon with this code already exists' });
    }
    const coupon = await BookCoupon.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteCoupon = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const coupon = await BookCoupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// GET /payouts — per-coupon: how many sales, how much discount was given, and how
// much is owed to the owner. Counts every non-cancelled order that used the code
// and sums the payout SNAPSHOT stored on each order, so a later change to
// payoutPerSale does not silently restate what past sales already earned.
export const getPayouts = async (_req: Request, res: Response) => {
  try {
    const coupons: any[] = await BookCoupon.find().sort({ createdAt: -1 }).lean();
    const agg: any[] = await Order.aggregate([
      { $match: { couponCode: { $nin: [null, ''] }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$couponCode',
          sales: { $sum: 1 },
          totalDiscount: { $sum: { $ifNull: ['$couponDiscount', 0] } },
          totalPayout: { $sum: { $ifNull: ['$couponPayout', 0] } },
        },
      },
    ]);
    const byCode: Record<string, any> = {};
    for (const a of agg) byCode[String(a._id).toUpperCase()] = a;

    const rows = coupons.map((c) => {
      const a = byCode[String(c.code).toUpperCase()] || { sales: 0, totalDiscount: 0, totalPayout: 0 };
      // Fall back to sales × the coupon's current rate for orders placed before the
      // snapshot field existed (totalPayout would be 0 for those).
      const owed = a.totalPayout || a.sales * (Number(c.payoutPerSale) || 0);
      return {
        _id: c._id,
        code: c.code,
        name: c.name || '',
        ownerName: c.ownerName || '',
        ownerPhone: c.ownerPhone || '',
        discountType: c.discountType,
        discountValue: c.discountValue,
        payoutPerSale: c.payoutPerSale || 0,
        isActive: c.isActive,
        sales: a.sales,
        totalDiscount: a.totalDiscount,
        totalPayout: owed,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({
        sales: t.sales + r.sales,
        discount: t.discount + r.totalDiscount,
        payout: t.payout + r.totalPayout,
      }),
      { sales: 0, discount: 0, payout: 0 }
    );

    res.json({ success: true, data: { rows, totals } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
