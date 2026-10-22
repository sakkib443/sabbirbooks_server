/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Income and expense, day by day — three views of one collection
 * (ledger.model has the two books):
 *
 *   Super Admin, shop       the website's sales per day beside every shop
 *                           entry (an admin's too, with their name)
 *   Super Admin, personal   their own money, nothing else
 *   admin                   only the shop entries they wrote themselves —
 *                           never the sales, never anyone else's entries
 *
 * An Accounts day starts at Settings.ledgerDayStartHour (5 AM by default,
 * 23 Oct 2026) and runs to the same hour the next day; it is named by the
 * date it starts on. (The order screens' noon-to-noon day is separate.)
 *
 * Sales are the orders placed that day that still stand — not cancelled, not
 * returned — with `delivery` at least ৳120 a printed parcel (utils/courierCost)
 * so the page can show them with or without it; `earned` is what is already in
 * hand (delivered or paid).
 */
import { isValidObjectId, Types } from 'mongoose';
import { deliveryOfExpr } from '../../utils/courierCost';
import { LedgerEntry } from './ledger.model';
import { Order } from '../order/order.model';
import { Settings } from '../settings/settings.model';
import { addDays, bdDate } from '../../utils/shopDay';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['cash', 'bkash', 'nagad', 'bank', 'other'];
const HOUR_MS = 3600 * 1000;

export const DEFAULT_CATEGORIES = {
  shop: {
    expense: ['ছাপা', 'কাগজ', 'বাইন্ডিং', 'কুরিয়ার', 'প্যাকেজিং', 'বিজ্ঞাপন', 'বেতন', 'ভাড়া', 'যাতায়াত', 'ক্যাম্পাস গিফট', 'অন্যান্য'],
    income: ['হাতে বই বিক্রি', 'বাইরের বিক্রি', 'কুরিয়ার পেমেন্ট', 'অন্যান্য'],
  },
  personal: {
    expense: ['বাজার', 'বাসা', 'যাতায়াত', 'পরিবার', 'অন্যান্য'],
    income: ['দোকান থেকে নেওয়া', 'বেতন', 'অন্যান্য'],
  },
};

export type Viewer = { id: string | null; role: string };

/** The hour an Accounts day starts (0–23). */
const startHour = async (): Promise<number> => {
  const s: any = await Settings.findOne({}).select('ledgerDayStartHour').lean();
  const h = Number(s?.ledgerDayStartHour);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 5;
};

/** The Accounts day an instant belongs to. */
const dayOf = (instant: Date, h: number) => bdDate(new Date(instant.getTime() - h * HOUR_MS));

/** Instants covering Accounts days from…to. */
const windowOf = (from: string, to: string, h: number) => ({
  $gte: new Date(new Date(`${from}T00:00:00+06:00`).getTime() + h * HOUR_MS),
  $lt: new Date(new Date(`${addDays(to, 1)}T00:00:00+06:00`).getTime() + h * HOUR_MS),
});

const range = (q: any, today: string) => {
  let to = DAY.test(String(q?.to || '')) ? String(q.to) : today;
  let from = DAY.test(String(q?.from || '')) ? String(q.from) : today;
  if (from > to) [from, to] = [to, from];
  // A year at most in one go.
  if (addDays(from, 366) < to) from = addDays(to, -366);
  return { from, to };
};

/** Which book and whose entries a viewer may see. */
const scopeOf = (viewer: Viewer, q: any) => {
  if (viewer.role === 'superAdmin') {
    const book = q?.book === 'personal' ? 'personal' : 'shop';
    // Entries written before the two books existed have no `book`: they are the shop's.
    const filter = book === 'personal' ? { book: 'personal' } : { book: { $ne: 'personal' } };
    return { book, filter, sales: book === 'shop', mine: false };
  }
  // An admin: the shop book, and only what they wrote.
  return { book: 'shop', filter: { book: { $ne: 'personal' }, createdBy: isValidObjectId(viewer.id) ? new Types.ObjectId(String(viewer.id)) : null }, sales: false, mine: true };
};

const report = async (q: any = {}, viewer: Viewer) => {
  const h = await startHour();
  const today = dayOf(new Date(), h);
  const { from, to } = range(q, today);
  const scope = scopeOf(viewer, q);

  const isEarned = { $or: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.status', 'paid'] }] };
  const deliveryOf = deliveryOfExpr;
  const [orderDays, entries, used] = await Promise.all([
    scope.sales
      ? Order.aggregate([
          { $match: { status: { $nin: ['cancelled', 'returned'] }, createdAt: windowOf(from, to, h) } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: { $subtract: ['$createdAt', h * HOUR_MS] }, timezone: 'Asia/Dhaka' } },
              orders: { $sum: 1 },
              sales: { $sum: '$total' },
              delivery: { $sum: deliveryOf },
              earned: { $sum: { $cond: [isEarned, '$total', 0] } },
              earnedDelivery: { $sum: { $cond: [isEarned, deliveryOf, 0] } },
            },
          },
        ])
      : Promise.resolve([]),
    LedgerEntry.find({ ...scope.filter, day: { $gte: from, $lte: to } })
      .sort({ day: -1, createdAt: -1 })
      .populate('createdBy', 'firstName lastName role')
      .lean(),
    LedgerEntry.aggregate([{ $match: scope.filter }, { $group: { _id: { type: '$type', category: '$category' } } }]),
  ]);

  const byDay = new Map<string, any>();
  const row = (d: string) => {
    if (!byDay.has(d)) byDay.set(d, { day: d, orders: 0, sales: 0, delivery: 0, earned: 0, earnedDelivery: 0, income: 0, expense: 0 });
    return byDay.get(d);
  };
  for (const o of orderDays as any[]) Object.assign(row(o._id), { ...o, day: o._id, _id: undefined });
  for (const e of entries as any[]) row(e.day)[e.type] += Number(e.amount) || 0;
  // Every day in the window, newest first, so an empty day still shows.
  const days: any[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) days.push(row(d));
  for (const r of days) delete r._id;

  const defaults = (DEFAULT_CATEGORIES as any)[scope.book];
  const categories = { expense: [...defaults.expense], income: [...defaults.income] };
  for (const u of used as any[]) {
    const list = (categories as any)[u._id.type];
    if (list && u._id.category && !list.includes(u._id.category)) list.push(u._id.category);
  }
  return { from, to, today, startHour: h, book: scope.book, mine: scope.mine, sales: scope.sales, days, entries, categories };
};

const fields = (b: any, partial: boolean) => {
  const out: any = {};
  if (!partial || b.day !== undefined) {
    if (!DAY.test(String(b.day || ''))) throw new Error('তারিখ দিন');
    out.day = String(b.day);
  }
  if (!partial || b.type !== undefined) {
    if (b.type !== 'income' && b.type !== 'expense') throw new Error('আয় না ব্যয় — বেছে নিন');
    out.type = b.type;
  }
  if (!partial || b.amount !== undefined) {
    const n = Number(String(b.amount ?? '').replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) throw new Error('টাকার পরিমাণ ঠিক নেই');
    out.amount = Math.round(n * 100) / 100;
  }
  if (b.category !== undefined) out.category = String(b.category || '').trim() || 'অন্যান্য';
  if (b.method !== undefined) out.method = METHODS.includes(b.method) ? b.method : 'other';
  if (b.note !== undefined) out.note = String(b.note || '').trim();
  return out;
};

const add = async (b: any, viewer: Viewer) => {
  // Only the Super Admin has a personal book; an admin always writes to the shop's.
  const book = viewer.role === 'superAdmin' && b?.book === 'personal' ? 'personal' : 'shop';
  return LedgerEntry.create({ ...fields(b || {}, false), book, createdBy: viewer.id });
};

const update = async (id: string, b: any, viewer: Viewer) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  // An admin may correct their own shop entries, nothing else.
  const filter: any = viewer.role === 'superAdmin' ? { _id: id } : { _id: id, book: { $ne: 'personal' }, createdBy: viewer.id };
  const doc = await LedgerEntry.findOneAndUpdate(filter, { $set: fields(b || {}, true) }, { new: true });
  if (!doc) throw new Error('Not found');
  return doc;
};

const remove = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  await LedgerEntry.deleteOne({ _id: id });
  return { removed: true };
};

export const LedgerService = { report, add, update, remove };
