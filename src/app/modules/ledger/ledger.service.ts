/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Income and expense, day by day (the Super Admin's "Accounts" page).
 *
 * Each shop day shows:
 *   sales     the orders placed that day (not cancelled) — the same rule and
 *             the same noon-to-noon day as the dashboard (getBookOrderStats);
 *             `delivery` is the delivery charge inside them, so the page can
 *             show sales with or without it
 *   earned    of those, money already in hand (delivered or paid)
 *   income    other money in, typed by hand (LedgerEntry)
 *   expense   money out, typed by hand
 */
import { isValidObjectId } from 'mongoose';
import { LedgerEntry } from './ledger.model';
import { Order } from '../order/order.model';
import { addDays, dayWindow, shopDayOf, shopDayShiftMs } from '../../utils/shopDay';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['cash', 'bkash', 'nagad', 'bank', 'other'];

export const DEFAULT_CATEGORIES = {
  expense: ['ছাপা', 'কাগজ', 'বাইন্ডিং', 'কুরিয়ার', 'প্যাকেজিং', 'বিজ্ঞাপন', 'বেতন', 'ভাড়া', 'যাতায়াত', 'ক্যাম্পাস গিফট', 'অন্যান্য'],
  income: ['বাইরের বিক্রি', 'কুরিয়ার পেমেন্ট', 'অন্যান্য'],
};

const range = (q: any) => {
  let to = DAY.test(String(q?.to || '')) ? String(q.to) : shopDayOf(new Date());
  let from = DAY.test(String(q?.from || '')) ? String(q.from) : `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  // A year at most in one go.
  if (addDays(from, 366) < to) from = addDays(to, -366);
  return { from, to };
};

const report = async (q: any = {}) => {
  const { from, to } = range(q);
  const isEarned = { $or: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$payment.status', 'paid'] }] };
  const deliveryOf = { $ifNull: ['$deliveryCharge', 0] };
  const [orderDays, entries, used] = await Promise.all([
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' }, createdAt: dayWindow(from, to) } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: { $add: ['$createdAt', shopDayShiftMs()] }, timezone: 'Asia/Dhaka' } },
          orders: { $sum: 1 },
          sales: { $sum: '$total' },
          delivery: { $sum: deliveryOf },
          earned: { $sum: { $cond: [isEarned, '$total', 0] } },
          earnedDelivery: { $sum: { $cond: [isEarned, deliveryOf, 0] } },
        },
      },
    ]),
    LedgerEntry.find({ day: { $gte: from, $lte: to } }).sort({ day: -1, createdAt: -1 }).lean(),
    LedgerEntry.aggregate([{ $group: { _id: { type: '$type', category: '$category' } } }]),
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

  const categories = { expense: [...DEFAULT_CATEGORIES.expense], income: [...DEFAULT_CATEGORIES.income] };
  for (const u of used as any[]) {
    const list = (categories as any)[u._id.type];
    if (list && u._id.category && !list.includes(u._id.category)) list.push(u._id.category);
  }
  return { from, to, today: shopDayOf(new Date()), days, entries, categories };
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

const add = async (b: any, uid: string | null) => LedgerEntry.create({ ...fields(b || {}, false), createdBy: uid });

const update = async (id: string, b: any) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const doc = await LedgerEntry.findByIdAndUpdate(id, { $set: fields(b || {}, true) }, { new: true });
  if (!doc) throw new Error('Not found');
  return doc;
};

const remove = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  await LedgerEntry.deleteOne({ _id: id });
  return { removed: true };
};

export const LedgerService = { report, add, update, remove };
