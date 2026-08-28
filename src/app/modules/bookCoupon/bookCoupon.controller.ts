/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { BookCoupon } from './bookCoupon.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';

const uid = (req: Request) => (req as any).user?._id || (req as any).user?.id;

/**
 * Create (or reuse) the login for a coupon's owner.
 *
 * Role 'affiliate' — no admin capability at all; the account exists so the owner
 * can sign in and watch their own sales. Reusing an existing account by email is
 * deliberate: the same person can own several codes, and re-entering their email
 * on a second coupon should link them rather than fail on the unique index.
 * The password is hashed by the User model's pre-save hook.
 */
const upsertOwnerUser = async (input: {
  email?: string;
  password?: string;
  ownerName?: string;
  ownerPhone?: string;
}): Promise<unknown | null> => {
  const email = (input.email || '').trim().toLowerCase();
  if (!email) return null;

  const existing: any = await User.findOne({ email });
  if (existing) {
    // Only ever set a password when one was typed — an empty box means
    // "leave their current password alone".
    if (input.password) {
      existing.password = input.password;
      existing.isPasswordChanged = false;
      await existing.save();
    }
    return existing._id;
  }

  const name = (input.ownerName || '').trim() || email.split('@')[0];
  const [firstName, ...rest] = name.split(/\s+/);
  const created: any = await User.create({
    id: `AFF-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    email,
    firstName: firstName || 'Affiliate',
    lastName: rest.join(' '),
    phoneNumber: (input.ownerPhone || '').trim(),
    whatsappNumber: (input.ownerPhone || '').trim(),
    password: input.password || Math.random().toString(36).slice(2, 12),
    role: 'affiliate',
    status: 'active',
  });
  return created._id;
};

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
// The owner's login is populated (email only) so the admin screens can show who
// can sign in — never the password hash.
const OWNER_FIELDS = 'email firstName lastName';

export const getAllCoupons = async (_req: Request, res: Response) => {
  try {
    const list = await BookCoupon.find().populate('ownerUser', OWNER_FIELDS).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getCouponById = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const coupon = await BookCoupon.findById(req.params.id).populate('ownerUser', OWNER_FIELDS);
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

    // Optional: create the owner's login in the same submit.
    const { ownerEmail, ownerPassword, ...rest } = req.body || {};
    const ownerUser = await upsertOwnerUser({
      email: ownerEmail,
      password: ownerPassword,
      ownerName: req.body.ownerName,
      ownerPhone: req.body.ownerPhone,
    });

    const coupon = await BookCoupon.create({ ...rest, code, ownerUser, createdBy: uid(req) });
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

    // Owner login: create it, link an existing account by email, or (with the
    // email cleared) unlink. An empty password leaves the current one alone.
    const { ownerEmail, ownerPassword } = data;
    delete data.ownerEmail;
    delete data.ownerPassword;
    if (ownerEmail !== undefined) {
      data.ownerUser = await upsertOwnerUser({
        email: ownerEmail,
        password: ownerPassword,
        ownerName: data.ownerName,
        ownerPhone: data.ownerPhone,
      });
    }

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
    const coupons: any[] = await BookCoupon.find()
      .populate('ownerUser', OWNER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    const agg: any[] = await Order.aggregate([
      { $match: { couponCode: { $nin: [null, ''] }, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$couponCode',
          sales: { $sum: 1 },
          totalDiscount: { $sum: { $ifNull: ['$couponDiscount', 0] } },
          totalPayout: { $sum: { $ifNull: ['$couponPayout', 0] } },
          revenue: { $sum: { $ifNull: ['$total', 0] } },
        },
      },
    ]);
    const byCode: Record<string, any> = {};
    for (const a of agg) byCode[String(a._id).toUpperCase()] = a;

    const rows = coupons.map((c) => {
      const a = byCode[String(c.code).toUpperCase()] || { sales: 0, totalDiscount: 0, totalPayout: 0, revenue: 0 };
      // Fall back to sales × the coupon's current rate for orders placed before the
      // snapshot field existed (totalPayout would be 0 for those).
      const owed = a.totalPayout || a.sales * (Number(c.payoutPerSale) || 0);
      return {
        _id: c._id,
        code: c.code,
        name: c.name || '',
        ownerName: c.ownerName || '',
        ownerPhone: c.ownerPhone || '',
        ownerEmail: (c.ownerUser as any)?.email || '',
        hasLogin: !!c.ownerUser,
        discountType: c.discountType,
        discountValue: c.discountValue,
        payoutPerSale: c.payoutPerSale || 0,
        isActive: c.isActive,
        sales: a.sales,
        revenue: a.revenue || 0,
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

// GET /my — the coupon OWNER's own dashboard. Scoped to the coupons whose
// ownerUser is the caller, so an affiliate can only ever see their own numbers
// and never another owner's. No capability is involved: ownership IS the gate.
export const getMyCouponStats = async (req: Request, res: Response) => {
  try {
    const me = uid(req);
    if (!me) return res.status(401).json({ success: false, message: 'Not signed in' });

    const coupons: any[] = await BookCoupon.find({ ownerUser: me }).sort({ createdAt: -1 }).lean();
    if (coupons.length === 0) {
      return res.json({
        success: true,
        data: { rows: [], totals: { sales: 0, earned: 0, discount: 0 }, recent: [] },
      });
    }

    const codes = coupons.map((c) => String(c.code).toUpperCase());
    const match = { couponCode: { $in: codes }, status: { $ne: 'cancelled' } };

    const [agg, recent]: [any[], any[]] = await Promise.all([
      Order.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$couponCode',
            sales: { $sum: 1 },
            discount: { $sum: { $ifNull: ['$couponDiscount', 0] } },
            earned: { $sum: { $ifNull: ['$couponPayout', 0] } },
          },
        },
      ]),
      // A short activity list, so the owner can see the sales themselves. Only
      // the order number, date and money — never the buyer's contact details.
      Order.find(match)
        .select('orderNumber couponCode couponPayout total status createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    const byCode: Record<string, any> = {};
    for (const a of agg) byCode[String(a._id).toUpperCase()] = a;

    const rows = coupons.map((c) => {
      const a = byCode[String(c.code).toUpperCase()] || { sales: 0, discount: 0, earned: 0 };
      const earned = a.earned || a.sales * (Number(c.payoutPerSale) || 0);
      return {
        code: c.code,
        name: c.name || '',
        discountType: c.discountType,
        discountValue: c.discountValue,
        payoutPerSale: c.payoutPerSale || 0,
        isActive: c.isActive,
        sales: a.sales,
        discount: a.discount,
        earned,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({ sales: t.sales + r.sales, earned: t.earned + r.earned, discount: t.discount + r.discount }),
      { sales: 0, earned: 0, discount: 0 }
    );

    res.json({
      success: true,
      data: {
        rows,
        totals,
        recent: recent.map((o) => ({
          orderNumber: o.orderNumber,
          couponCode: o.couponCode,
          payout: o.couponPayout || 0,
          total: o.total || 0,
          status: o.status,
          createdAt: o.createdAt,
        })),
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
