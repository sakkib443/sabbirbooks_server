/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { CourseCoupon } from './coupon.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

// Shared validation: returns { valid, coupon, discountAmount, finalPrice } or throws Error.
// Used by the /validate endpoint (checkout). Site-wide — works on any course.
export const evaluateCourseCoupon = async (code: string, amount: number) => {
  const coupon: any = await CourseCoupon.findOne({ code: String(code || '').toUpperCase().trim() });
  if (!coupon) throw new Error('Invalid coupon code');
  if (!coupon.isActive) throw new Error('This coupon is not active');

  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) throw new Error('This coupon is not valid yet');
  if (coupon.validUntil && now > coupon.validUntil) throw new Error('This coupon has expired');
  if (coupon.usedCount >= coupon.maxUses) throw new Error('This coupon has reached its usage limit');

  const price = Number(amount) || 0;
  if (price < (coupon.minPurchase || 0)) {
    throw new Error(`Minimum purchase amount is ৳${coupon.minPurchase}`);
  }

  let discountAmount = 0;
  if (coupon.discountType === 'percentage') {
    discountAmount = Math.round((price * coupon.discountValue) / 100);
  } else {
    discountAmount = Math.min(coupon.discountValue, price);
  }
  const finalPrice = Math.max(0, price - discountAmount);

  return { valid: true, coupon, discountAmount, finalPrice };
};

// ═══════════════ STUDENT (checkout) ═══════════════
// POST /validate { code, amount } → { valid, discountAmount, finalPrice }
export const validateCoupon = async (req: Request, res: Response) => {
  try {
    const { code, amount } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });
    const { coupon, discountAmount, finalPrice } = await evaluateCourseCoupon(code, amount);
    res.json({
      success: true,
      data: {
        valid: true,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        finalPrice,
        originalPrice: Number(amount) || 0,
      },
    });
  } catch (e: any) { res.status(400).json({ success: false, valid: false, message: e.message }); }
};

// ═══════════════ ADMIN ═══════════════
export const getAllCoupons = async (_req: Request, res: Response) => {
  try {
    const list = await CourseCoupon.find().sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const createCoupon = async (req: Request, res: Response) => {
  try {
    const code = String(req.body.code || '').toUpperCase().trim();
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });
    const existing = await CourseCoupon.findOne({ code });
    if (existing) return res.status(409).json({ success: false, message: 'A coupon with this code already exists' });
    const coupon = await CourseCoupon.create({ ...req.body, code, createdBy: uid(req) });
    res.status(201).json({ success: true, data: coupon });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const updateCoupon = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const data: any = { ...req.body };
    if (data.code) {
      data.code = String(data.code).toUpperCase().trim();
      // Prevent renaming onto another coupon's code
      const clash = await CourseCoupon.findOne({ code: data.code, _id: { $ne: req.params.id } });
      if (clash) return res.status(409).json({ success: false, message: 'A coupon with this code already exists' });
    }
    const coupon = await CourseCoupon.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, data: coupon });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};

export const deleteCoupon = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const coupon = await CourseCoupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ success: false, message: 'Coupon not found' });
    res.json({ success: true, message: 'Deleted' });
  } catch (e: any) { res.status(500).json({ success: false, message: e.message }); }
};
