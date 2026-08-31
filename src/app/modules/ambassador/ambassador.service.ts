/* eslint-disable @typescript-eslint/no-explicit-any */
import { Types, isValidObjectId } from 'mongoose';
import {
  AmbassadorApplication,
  AMBASSADOR_DISCOUNT_TK,
  AMBASSADOR_PAYOUT_TK,
} from './ambassador.model';
import { IAmbassadorApplication, TAmbassadorStatus } from './ambassador.interface';
import { uniqueCouponCode } from './couponCode';
import { BookCoupon } from '../bookCoupon/bookCoupon.model';
import { MedicalCollege } from '../medicalCollege/medicalCollege.model';
import { User } from '../user/user.model';
import { Order } from '../order/order.model';
import { getNextSequence } from '../order/counter.model';

/** The counter the MVA-AMB-#### numbers come from. */
export const AMBASSADOR_SEQ = 'ambassador';

const pad = (n: number) => String(n).padStart(4, '0');

// ─── Applying ────────────────────────────────────────────────

/**
 * Take an application from the public form.
 *
 * Everything money-related is decided here, not accepted from the request: the
 * discount, the payout and the status are constants and a default. A form that
 * could name its own commission would be a form worth forging.
 */
const apply = async (payload: Partial<IAmbassadorApplication>) => {
  const email = String(payload.email || '').trim().toLowerCase();

  // A pending or approved application already exists for this person. Told
  // plainly rather than as a duplicate-key error, because the commonest cause is
  // someone pressing submit twice and then wondering whether it worked.
  const live = await AmbassadorApplication.findOne({
    email,
    status: { $in: ['pending', 'approved', 'suspended'] },
  })
    .select('applicationId status')
    .lean();
  if (live) {
    throw new Error(
      live.status === 'pending'
        ? `এই ইমেইলে ইতিমধ্যে একটি আবেদন জমা আছে (${live.applicationId}) — সেটি যাচাই করা হচ্ছে। (An application for this email is already under review.)`
        : `এই ইমেইলটি ইতিমধ্যে একজন অ্যাম্বাসেডরের (${live.applicationId})। (This email already belongs to an ambassador.)`
    );
  }

  // Snapshot the college's name and abbreviation. The directory can be renamed
  // or an abbreviation corrected later; an application must still read the way
  // it was submitted, and a live coupon code must not change under anyone.
  let collegeName = String(payload.medicalCollegeName || '').trim();
  let abbreviation = '';
  let collegeId: Types.ObjectId | undefined;
  if (payload.medicalCollege && isValidObjectId(String(payload.medicalCollege))) {
    const college = await MedicalCollege.findById(payload.medicalCollege)
      .select('name abbreviation')
      .lean();
    if (college) {
      collegeId = college._id as Types.ObjectId;
      collegeName = college.name;
      abbreviation = college.abbreviation || '';
    }
  }
  if (!collegeName) throw new Error('Medical college is required');

  const seq = await getNextSequence(AMBASSADOR_SEQ);

  return AmbassadorApplication.create({
    ...payload,
    email,
    applicationSeq: seq,
    applicationId: `MVA-AMB-${pad(seq)}`,
    medicalCollege: collegeId,
    medicalCollegeName: collegeName,
    collegeAbbreviation: abbreviation,
    agreedAt: new Date(),
    // Never from the request.
    status: 'pending',
    coupon: null,
    couponCode: '',
    user: null,
    reviewedBy: undefined,
    reviewedAt: undefined,
  });
};

// ─── Approval ────────────────────────────────────────────────

/**
 * The ambassador's login.
 *
 * Email is the id and their phone number is the first password, as the shop
 * asked — an ambassador is handed credentials they already know rather than
 * waiting on an email that may never arrive. `isPasswordChanged: false` is what
 * the app reads to nag them into setting a real one.
 *
 * An existing account with that email is reused, not overwritten: someone who
 * already bought the book and then becomes an ambassador keeps their orders,
 * their password and their history. Only their role is widened.
 */
const ensureAmbassadorUser = async (app: any): Promise<Types.ObjectId> => {
  const existing: any = await User.findOne({ email: app.email });
  if (existing) {
    // Never demote: an admin who applies stays an admin.
    if (existing.role === 'student' || existing.role === 'affiliate') {
      existing.role = 'affiliate';
      await existing.save();
    }
    return existing._id;
  }

  const [firstName, ...rest] = String(app.fullName || '').trim().split(/\s+/);
  const created: any = await User.create({
    id: app.applicationId,
    email: app.email,
    firstName: firstName || 'Ambassador',
    lastName: rest.join(' '),
    phoneNumber: app.phone,
    whatsappNumber: app.whatsapp || app.phone,
    // The phone number as the opening password. Stored hashed by the User
    // model's own pre-save hook, exactly like any other password.
    password: String(app.phone || '').trim(),
    isPasswordChanged: false,
    role: 'affiliate',
    status: 'active',
    medicalCollege: app.medicalCollege,
    medicalCollegeName: app.medicalCollegeName,
  });
  return created._id;
};

/**
 * Approve an application: the ambassador gets a login and a live coupon.
 *
 * Idempotent in the way that matters — an application approved, suspended and
 * approved again keeps the SAME code. Issuing a second one would silently
 * orphan every order already placed under the first, because orders snapshot
 * the code they were bought with.
 */
const approve = async (id: string, reviewerId?: string) => {
  const app: any = await AmbassadorApplication.findById(id);
  if (!app) throw new Error('Application not found');

  const userId = await ensureAmbassadorUser(app);

  let coupon: any = app.coupon ? await BookCoupon.findById(app.coupon) : null;
  if (!coupon) {
    const code = await uniqueCouponCode(
      app.collegeAbbreviation || '',
      app.fullName,
      app.phone
    );
    coupon = await BookCoupon.create({
      code,
      name: `${app.fullName} — ${app.medicalCollegeName}`,
      ownerName: app.fullName,
      ownerPhone: app.phone,
      ownerUser: userId,
      // The programme's fixed terms — see the constants' note.
      discountType: 'fixed',
      discountValue: AMBASSADOR_DISCOUNT_TK,
      payoutPerSale: AMBASSADOR_PAYOUT_TK,
      isActive: true,
      createdBy: reviewerId && isValidObjectId(reviewerId) ? reviewerId : undefined,
    });
  } else {
    // Re-approval: the code stays, it just goes live again.
    coupon.isActive = true;
    coupon.ownerUser = userId;
    await coupon.save();
  }

  app.status = 'approved';
  app.user = userId;
  app.coupon = coupon._id;
  app.couponCode = coupon.code;
  app.reviewedBy = reviewerId && isValidObjectId(reviewerId) ? reviewerId : undefined;
  app.reviewedAt = new Date();
  await app.save();

  return app;
};

/**
 * Reject or suspend: the coupon goes dark, everything else is kept.
 *
 * The coupon is deactivated rather than deleted. Orders already placed under it
 * reference it, the payout report still owes the ambassador for those sales, and
 * deleting the row would take that money off the books.
 */
const setStatus = async (
  id: string,
  status: TAmbassadorStatus,
  opts: { reviewerId?: string; adminNote?: string } = {}
) => {
  if (status === 'approved') return approve(id, opts.reviewerId);

  const app: any = await AmbassadorApplication.findById(id);
  if (!app) throw new Error('Application not found');

  if (app.coupon) {
    await BookCoupon.updateOne({ _id: app.coupon }, { $set: { isActive: false } });
  }

  app.status = status;
  if (typeof opts.adminNote === 'string') app.adminNote = opts.adminNote;
  app.reviewedBy =
    opts.reviewerId && isValidObjectId(opts.reviewerId) ? opts.reviewerId : app.reviewedBy;
  app.reviewedAt = new Date();
  await app.save();

  return app;
};

const setAdminNote = async (id: string, adminNote: string) => {
  const app = await AmbassadorApplication.findByIdAndUpdate(
    id,
    { $set: { adminNote: String(adminNote || '').trim() } },
    { new: true }
  );
  if (!app) throw new Error('Application not found');
  return app;
};

// ─── Reading ─────────────────────────────────────────────────

/**
 * The admin table.
 *
 * Sales and commission come from the orders themselves, not from the coupon's
 * `usedCount` tally: an order that was cancelled or never paid must not count
 * towards what the shop owes anybody. Same rule the payouts report uses.
 */
const list = async (query: { status?: string; q?: string; college?: string } = {}) => {
  const filter: Record<string, unknown> = {};
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.college) filter.medicalCollegeName = query.college;
  if (query.q) {
    const rx = { $regex: String(query.q).trim(), $options: 'i' };
    filter.$or = [
      { fullName: rx },
      { email: rx },
      { phone: rx },
      { applicationId: rx },
      { couponCode: rx },
      { batch: rx },
    ];
  }

  const apps = await AmbassadorApplication.find(filter)
    .sort({ createdAt: -1 })
    .populate('coupon', 'code isActive discountValue payoutPerSale')
    .lean();

  const stats = await earningsByCode(apps.map((a: any) => a.couponCode).filter(Boolean));

  return apps.map((a: any) => ({
    ...a,
    stats: stats.get(String(a.couponCode || '').toUpperCase()) || {
      orders: 0,
      sales: 0,
      commission: 0,
    },
  }));
};

/**
 * Orders, revenue and commission per coupon code.
 *
 * 'delivered' or paid is the same "this sale is real" test the revenue figures
 * use, so an ambassador's earnings and the shop's earned total agree. Cancelled
 * orders are excluded by that test rather than by a separate rule that could
 * drift from it.
 */
const earningsByCode = async (codes: string[]) => {
  const map = new Map<string, { orders: number; sales: number; commission: number }>();
  if (!codes.length) return map;

  const rows = await Order.aggregate([
    {
      $match: {
        couponCode: { $in: codes.map((c) => String(c).toUpperCase()) },
        status: { $ne: 'cancelled' },
        $or: [{ status: 'delivered' }, { 'payment.status': 'paid' }],
      },
    },
    {
      $group: {
        _id: '$couponCode',
        orders: { $sum: 1 },
        sales: { $sum: '$total' },
        commission: { $sum: { $ifNull: ['$couponPayout', 0] } },
      },
    },
  ]);

  for (const r of rows) {
    map.set(String(r._id).toUpperCase(), {
      orders: r.orders,
      sales: r.sales,
      commission: r.commission,
    });
  }
  return map;
};

const getById = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Invalid application id');
  const app: any = await AmbassadorApplication.findById(id)
    .populate('coupon', 'code isActive discountType discountValue payoutPerSale usedCount')
    .populate('reviewedBy', 'firstName lastName email')
    .lean();
  if (!app) throw new Error('Application not found');

  const stats = await earningsByCode(app.couponCode ? [app.couponCode] : []);
  return {
    ...app,
    stats: stats.get(String(app.couponCode || '').toUpperCase()) || {
      orders: 0,
      sales: 0,
      commission: 0,
    },
  };
};

/** The application belonging to the signed-in ambassador, for their dashboard. */
const getMine = async (userId: string) => {
  if (!isValidObjectId(userId)) return null;
  return AmbassadorApplication.findOne({ user: userId })
    .populate('coupon', 'code isActive discountValue payoutPerSale')
    .lean();
};

/** Counts for the admin queue's filter chips. */
const getCounts = async () => {
  const rows = await AmbassadorApplication.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const out: Record<string, number> = {
    all: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    suspended: 0,
  };
  for (const r of rows) {
    out[r._id] = r.n;
    out.all += r.n;
  }
  return out;
};

export const AmbassadorService = {
  apply,
  approve,
  setStatus,
  setAdminNote,
  list,
  getById,
  getMine,
  getCounts,
};
