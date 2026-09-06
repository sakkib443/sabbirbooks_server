/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { BookCoupon } from './bookCoupon.model';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import { AmbassadorApplication } from '../ambassador/ambassador.model';

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

/**
 * What the checkout knows about the order a coupon is being applied to.
 *
 * All optional, and every rule that depends on a missing field is SKIPPED
 * rather than failed. The preview endpoint knows the amount but not always the
 * payment method; the order service knows everything. A rule the preview
 * cannot check is simply checked again on create, where it counts — so the
 * worst case is a code that previews as valid and is refused at the last step,
 * never one that slips through.
 */
export interface CouponContext {
  /** Buyer's account id — needed for the per-buyer limit. */
  userId?: unknown;
  /** 'cod' | 'manual' | 'sslcommerz' | … — anything not 'cod' is prepaid. */
  paymentMethod?: string | null;
  /** The delivery charge this order would otherwise pay, for freeDelivery. */
  deliveryCharge?: number;
}

export interface CouponEvaluation {
  coupon: any;
  /** Taka off the products. */
  discountAmount: number;
  /** Taka off the delivery charge — 0 unless the coupon waives it. */
  deliveryDiscount: number;
  finalPrice: number;
}

/**
 * Turn a coupon code into taka, or explain why it cannot be used.
 *
 * THE ORDER OF THE CHECKS IS THE POINT. A buyer who is told "this coupon needs
 * a ৳500 order" can act on it; one told "invalid coupon" retypes the code and
 * gives up. So each rule fails with its own sentence, and the rules run
 * cheapest-and-most-certain first: existence, then the switch, then the
 * calendar, then the counters that cost a query.
 *
 * Every limit is opt-in. 0 and null mean "no limit", which is the state of
 * every coupon written before these fields existed — a code that worked
 * yesterday still works today.
 */
export const evaluateBookCoupon = async (
  code: string,
  amount: number,
  ctx: CouponContext = {}
): Promise<CouponEvaluation> => {
  const coupon: any = await BookCoupon.findOne({ code: String(code || '').toUpperCase().trim() });
  if (!coupon) throw new Error('Invalid coupon code');
  if (!coupon.isActive) throw new Error('This coupon is not active');

  const price = Math.max(0, Number(amount) || 0);
  const now = new Date();

  // ── The calendar ───────────────────────────────────────────────────────
  // Dates are stored as instants, so "starts on the 5th" is midnight on the
  // 5th in the server's zone. Saying WHEN it opens beats "not valid": a buyer
  // who sees a date comes back, one who sees a refusal does not.
  if (coupon.validFrom && now < new Date(coupon.validFrom)) {
    throw new Error(
      `This coupon starts on ${new Date(coupon.validFrom).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`
    );
  }
  if (coupon.validUntil && now > new Date(coupon.validUntil)) {
    throw new Error('This coupon has expired');
  }

  // ── The counters ───────────────────────────────────────────────────────
  const maxUses = Math.max(0, Number(coupon.maxUses) || 0);
  if (maxUses > 0 && Number(coupon.usedCount || 0) >= maxUses) {
    throw new Error('This coupon has reached its usage limit');
  }

  const perBuyer = Math.max(0, Number(coupon.maxUsesPerBuyer) || 0);
  if (perBuyer > 0 && ctx.userId) {
    // Counted from the orders, not from a tally on the coupon. A cancelled
    // order should not burn somebody's one use, and the order collection is
    // the only thing that knows which orders those are.
    const used = await Order.countDocuments({
      user: ctx.userId,
      couponCode: coupon.code,
      status: { $ne: 'cancelled' },
    });
    if (used >= perBuyer) {
      throw new Error(
        perBuyer === 1
          ? 'You have already used this coupon'
          : `You have already used this coupon ${perBuyer} times`
      );
    }
  }

  // ── The conditions ─────────────────────────────────────────────────────
  const minPurchase = Math.max(0, Number(coupon.minPurchase) || 0);
  if (minPurchase > 0 && price < minPurchase) {
    // Says the gap, not just the rule — this is the one refusal a buyer can
    // fix from the same screen, by adding another book.
    throw new Error(`This coupon needs an order of at least BDT ${minPurchase}`);
  }

  const appliesTo = String(coupon.appliesTo || 'all');
  if (appliesTo !== 'all' && ctx.paymentMethod) {
    const isCod = String(ctx.paymentMethod).toLowerCase() === 'cod';
    if (appliesTo === 'cod' && !isCod) {
      throw new Error('This coupon only works with cash on delivery');
    }
    if (appliesTo === 'online' && isCod) {
      throw new Error('This coupon only works when you pay online');
    }
  }

  // ── The money ──────────────────────────────────────────────────────────
  let discountAmount = 0;
  if (coupon.discountType === 'percent') {
    const pct = Math.min(90, Math.max(0, Number(coupon.discountValue) || 0));
    discountAmount = Math.round((price * pct) / 100);
    // "20% off, up to ৳100" — the shape most real campaigns take. Without the
    // ceiling a percentage code is an open cheque against the largest basket
    // anyone assembles.
    const cap = Math.max(0, Number(coupon.maxDiscount) || 0);
    if (cap > 0) discountAmount = Math.min(discountAmount, cap);
  } else {
    discountAmount = Math.max(0, Number(coupon.discountValue) || 0);
  }
  discountAmount = Math.min(discountAmount, price); // never below zero

  // Waiving delivery is capped at the delivery actually charged, so a free-
  // delivery code on an order with free delivery already is worth nothing
  // rather than negative.
  const deliveryDiscount = coupon.freeDelivery
    ? Math.max(0, Number(ctx.deliveryCharge) || 0)
    : 0;

  return {
    coupon,
    discountAmount,
    deliveryDiscount,
    finalPrice: Math.max(0, price - discountAmount),
  };
};

// ═══════════════ Checkout (any logged-in buyer) ═══════════════
// POST /validate { code, amount } → the discount for a preview. The order service
// re-evaluates on create, so this is display only and cannot be tampered into a
// real price.
export const validateCoupon = async (req: Request, res: Response) => {
  try {
    const { code, amount, paymentMethod, deliveryCharge } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Coupon code required' });

    // The buyer's own id, so the per-buyer limit is enforced in the preview
    // too. Without it a code capped at one use per person previews as valid
    // every time and only fails at the last click, which reads as a broken
    // checkout rather than a rule.
    const { coupon, discountAmount, deliveryDiscount, finalPrice } = await evaluateBookCoupon(
      code,
      amount,
      { userId: uid(req), paymentMethod, deliveryCharge }
    );

    res.json({
      success: true,
      data: {
        valid: true,
        code: coupon.code,
        name: coupon.name || '',
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountAmount,
        // Sent separately from the product discount: the checkout shows them on
        // two different lines, and a free-delivery code with no discount would
        // otherwise look like it did nothing.
        freeDelivery: Boolean(coupon.freeDelivery),
        deliveryDiscount,
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

/**
 * Every coupon, each one saying whether it belongs to an affiliate.
 *
 * There are two kinds of code in this collection and they are managed on two
 * different screens. A plain coupon is a discount the shop is running — a
 * launch offer, a book fair — and the coupon screen owns it end to end. An
 * affiliate's code is the instrument of somebody's earnings, and the affiliate
 * screen owns it, because that is where the person, their sales and what they
 * are owed all live together.
 *
 * The link is read from the affiliate side rather than stored twice, so it can
 * never go stale: the affiliate record already points at its coupon.
 */
export const getAllCoupons = async (_req: Request, res: Response) => {
  try {
    const list = await BookCoupon.find()
      .populate('ownerUser', OWNER_FIELDS)
      .sort({ createdAt: -1 })
      .lean();

    const affiliates = await AmbassadorApplication.find({ coupon: { $ne: null } })
      .select('coupon applicationId fullName status')
      .lean();
    const byCoupon = new Map(affiliates.map((a: any) => [String(a.coupon), a]));

    res.json({
      success: true,
      data: list.map((c: any) => {
        const a = byCoupon.get(String(c._id));
        return {
          ...c,
          affiliate: a
            ? { _id: a._id, applicationId: a.applicationId, fullName: a.fullName, status: a.status }
            : null,
        };
      }),
    });
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

/**
 * Make the limit fields safe to hand to Mongoose.
 *
 * An HTML date input that has never been touched submits '', and '' cast to a
 * Date is a CastError that 500s the whole save — so the admin gets "something
 * went wrong" for the ordinary act of not setting an end date. Empty means
 * "no bound", which is null.
 *
 * The numbers get the same treatment for the same reason, and are floored at
 * zero because a negative maxUses would read as "unlimited" through the
 * `> 0` checks in evaluateBookCoupon while looking like a limit in the form.
 *
 * Mutates in place and returns the object; only touches keys that were sent,
 * so a PATCH of one field cannot blank the rest.
 */
const normalizeCouponLimits = (data: any) => {
  for (const key of ['validFrom', 'validUntil']) {
    if (data[key] !== undefined) {
      const v = data[key];
      data[key] = v === '' || v === null ? null : new Date(v);
      if (data[key] && Number.isNaN(data[key].getTime())) data[key] = null;
    }
  }
  for (const key of ['maxUses', 'maxUsesPerBuyer', 'minPurchase', 'maxDiscount', 'discountValue', 'payoutPerSale']) {
    if (data[key] !== undefined) data[key] = Math.max(0, Number(data[key]) || 0);
  }
  if (data.freeDelivery !== undefined) data.freeDelivery = Boolean(data.freeDelivery);

  // A window that closes before it opens accepts nothing, and would be found
  // out by a buyer rather than by the admin who typed it.
  if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
    throw new Error('The end date is before the start date');
  }
  return data;
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

    const coupon = await BookCoupon.create(
      normalizeCouponLimits({ ...rest, code, ownerUser, createdBy: uid(req) })
    );
    res.status(201).json({ success: true, data: coupon });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const updateCoupon = async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(404).json({ success: false, message: 'Coupon not found' });
    const data: any = normalizeCouponLimits({ ...req.body });
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

    // An affiliate's code is not the shop's to throw away from here: their
    // earnings are counted from orders that carry it, so deleting it would
    // quietly erase what they are owed. Removing the person removes the code —
    // that path switches it off and keeps the history.
    const owner = await AmbassadorApplication.findOne({ coupon: req.params.id })
      .select('fullName applicationId')
      .lean();
    if (owner) {
      return res.status(409).json({
        success: false,
        message: `This code belongs to ${(owner as any).fullName} (${(owner as any).applicationId}). Manage it from Affiliates — deleting it here would erase their earnings history.`,
      });
    }

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
