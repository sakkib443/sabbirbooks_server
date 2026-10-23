/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Orders that did not come through the website (19 Oct 2026) — a college rep
 * sending ten names at once, a phone order, a sheet the shop kept by hand.
 *
 * One path for both ways in: the "Add order" form sends one row, the sheet
 * upload sends many. Every row is checked first (`dryRun`), so the screen can
 * show what is wrong row by row before anything is saved; then the good rows
 * become ordinary orders the rest of the panel already understands — the
 * courier can take them, the PDFs list them, the counts include them.
 *
 * What is different from a website order, on purpose:
 *   • nobody is texted unless the admin ticks "send SMS" — then each buyer
 *     gets the text for their order's status (confirmed / shipped /
 *     delivered); never an email;
 *   • the price is what the sheet says (the shop agreed it elsewhere); without
 *     an amount, the book's listed price × copies + the delivery given;
 *   • the status is what the sheet says (confirmed / shipped / delivered …),
 *     with stock taken the same way a confirmed website order takes it;
 *   • `source` is 'manual' (the form) or 'import' (a sheet), and the sheet's
 *     own order number is kept as `externalRef` — the same sheet uploaded
 *     twice does not make the same orders twice.
 */
import { isValidObjectId } from 'mongoose';
import { Order } from './order.model';
import { getNextSequence, ORDER_SEQ } from './counter.model';
import { Book } from '../book/book.model';
import { MedicalCollege } from '../medicalCollege/medicalCollege.model';
import { OrderService } from './order.service';
import { OrderSmsService } from '../notification/orderSms.service';

export interface ManualOrderRow {
  ref?: string;
  date?: string;
  name?: string;
  phone?: string;
  altPhone?: string;
  college?: string;
  district?: string;
  upazila?: string;
  address?: string;
  book?: string;
  quantity?: string | number;
  amount?: string | number;
  deliveryCharge?: string | number;
  payment?: string;
  status?: string;
  note?: string;
  // Academic session, e.g. "24-25" (1st year).
  session?: string;
}

export interface ManualRowResult {
  row: number;
  ok: boolean;
  error?: string;
  orderSeq?: number;
  orderNumber?: string;
  orderId?: string;
  preview?: { name: string; phone: string; college: string; book: string; quantity: number; total: number; status: string; payment: string };
}

const clean = (v: unknown) => String(v ?? '').trim();

/** 01XXXXXXXXX, or '' when it is not a Bangladeshi mobile number. */
const phone11 = (raw?: unknown): string => {
  let d = clean(raw).replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/\D/g, '');
  if (d.startsWith('880')) d = d.slice(2);
  else if (d.startsWith('0088')) d = d.slice(3);
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;
  return /^01[3-9]\d{8}$/.test(d) ? d : '';
};

const money = (v: unknown): number | null => {
  const s = clean(v).replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/[৳,\s]|tk|taka/gi, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
};

const STATUS_WORDS: Record<string, string> = {
  pending: 'pending', new: 'pending', 'নতুন': 'pending', 'পেন্ডিং': 'pending',
  confirmed: 'processing', confirm: 'processing', processing: 'processing', 'কনফার্ম': 'processing',
  shipped: 'shipped', ship: 'shipped', sent: 'shipped', 'শিপড': 'shipped', 'পাঠানো': 'shipped',
  delivered: 'delivered', 'ডেলিভারড': 'delivered', 'ডেলিভারি': 'delivered',
  cancelled: 'cancelled', canceled: 'cancelled', cancel: 'cancelled', 'বাতিল': 'cancelled',
};
const PAYMENT_WORDS: Record<string, 'cod' | 'paid'> = {
  cod: 'cod', cash: 'cod', 'cash on delivery': 'cod', 'ক্যাশ': 'cod', 'ক্যাশ অন ডেলিভারি': 'cod',
  paid: 'paid', prepaid: 'paid', bkash: 'paid', nagad: 'paid', rocket: 'paid', 'পেইড': 'paid', 'পরিশোধিত': 'paid',
};

/** "2026-10-18", "18/10/2026", "18-10-2026", "18.10.2026" → a Date at 10 AM Dhaka, or null / NaN-date. */
const parseDate = (raw?: unknown): Date | null => {
  const s = clean(raw);
  if (!s) return null;
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return new Date(NaN);
  if (m < 1 || m > 12 || d < 1 || d > 31) return new Date(NaN);
  return new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T10:00:00+06:00`);
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending', processing: 'Confirmed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
};

/**
 * Check every row and, unless `dryRun`, save the good ones. Rows are numbered
 * from 1 (the first data row of the sheet) so errors point at the sheet.
 */
const addOrders = async (
  rows: ManualOrderRow[],
  opts: { dryRun?: boolean; source?: 'manual' | 'import' | 'campus'; sms?: boolean } = {}
): Promise<{ results: ManualRowResult[]; created: number; failed: number }> => {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No orders to add');
  if (rows.length > 1000) throw new Error('Too many rows at once (max 1000)');

  const books: any[] = await Book.find({ isDeleted: { $ne: true } })
    .select('title slug id format price offerPrice offers isPreOrder')
    .lean();
  const printedBooks = books.filter((b) => b.format === 'printed');
  const colleges: any[] = await MedicalCollege.find({ isActive: true })
    .select('name abbreviation district upazila')
    .lean();

  const findBook = (raw: string) => {
    const q = raw.toLowerCase();
    if (!q) return printedBooks.length === 1 ? printedBooks[0] : null;
    return (
      books.find((b) => b.slug === raw || String(b.id) === raw || (isValidObjectId(raw) && String(b._id) === raw)) ||
      books.find((b) => String(b.title || '').toLowerCase() === q) ||
      books.find((b) => String(b.title || '').toLowerCase().includes(q)) ||
      null
    );
  };
  const findCollege = (raw: string) => {
    const q = raw.toLowerCase();
    if (!q) return null;
    return (
      colleges.find((c) => String(c.name).toLowerCase() === q) ||
      colleges.find((c) => c.abbreviation && String(c.abbreviation).toLowerCase() === q) ||
      colleges.find((c) => String(c.name).toLowerCase().includes(q)) ||
      null
    );
  };

  // Refs already in the database, and refs repeated inside this sheet.
  const refs = rows.map((r) => clean(r.ref)).filter(Boolean);
  const taken = new Set(
    refs.length ? (await Order.distinct('externalRef', { externalRef: { $in: refs } })).map(String) : []
  );
  const seenInSheet = new Set<string>();

  const results: ManualRowResult[] = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const row = i + 1;
    const fail = (error: string) => results.push({ row, ok: false, error });

    const name = clean(r.name);
    const phone = phone11(r.phone);
    const ref = clean(r.ref);
    if (!name) { fail('নাম নেই'); continue; }
    if (!phone) { fail(`মোবাইল নম্বর ঠিক নেই (${clean(r.phone) || 'খালি'})`); continue; }
    if (ref && (taken.has(ref) || seenInSheet.has(ref))) { fail(`অর্ডার নম্বর ${ref} আগেই যোগ করা হয়েছে`); continue; }

    const book = findBook(clean(r.book));
    if (!book) { fail(clean(r.book) ? `বই পাওয়া যায়নি: ${clean(r.book)}` : 'কোন বই লিখুন'); continue; }

    const qtyRaw = clean(r.quantity);
    const quantity = qtyRaw ? Number(qtyRaw.replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)))) : 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) { fail(`কয়টা বই ঠিক নেই (${qtyRaw})`); continue; }

    const collegeText = clean(r.college);
    const college = findCollege(collegeText);
    const district = clean(r.district) || college?.district || '';
    const upazila = clean(r.upazila) || college?.upazila || '';
    const address = clean(r.address) || college?.name || collegeText;
    if (!address) { fail('ঠিকানা বা মেডিকেল কলেজ — অন্তত একটা লিখুন'); continue; }

    const statusWord = clean(r.status).toLowerCase();
    const status = statusWord ? STATUS_WORDS[statusWord] : 'processing';
    if (!status) { fail(`স্ট্যাটাস বোঝা যায়নি (${clean(r.status)}) — pending / confirmed / shipped / delivered / cancelled`); continue; }

    const payWord = clean(r.payment).toLowerCase();
    const pay = payWord ? PAYMENT_WORDS[payWord] : 'cod';
    if (!pay) { fail(`পেমেন্ট বোঝা যায়নি (${clean(r.payment)}) — cod / paid`); continue; }

    const date = parseDate(r.date);
    if (date && Number.isNaN(date.getTime())) { fail(`তারিখ বোঝা যায়নি (${clean(r.date)}) — 2026-10-18 বা 18/10/2026`); continue; }

    const amount = money(r.amount);
    const delivery = money(r.deliveryCharge);
    if (Number.isNaN(amount as number)) { fail(`টাকা ঠিক নেই (${clean(r.amount)})`); continue; }
    if (Number.isNaN(delivery as number)) { fail(`ডেলিভারি চার্জ ঠিক নেই (${clean(r.deliveryCharge)})`); continue; }

    // The book's listed unit price; the sheet's amount, when given, is the truth.
    const unit = Number(book.offerPrice != null ? book.offerPrice : book.price) || 0;
    const deliveryCharge = delivery ?? 0;
    const listSubtotal = unit * quantity;
    const total = amount != null ? amount : listSubtotal + deliveryCharge;
    const booksPart = Math.max(0, total - deliveryCharge);
    const discount = Math.max(0, listSubtotal - booksPart);
    const subtotal = Math.max(listSubtotal, booksPart);

    if (ref) seenInSheet.add(ref);
    const preview = {
      name, phone, college: college?.name || collegeText, book: book.title, quantity, total,
      status: STATUS_LABEL[status], payment: pay === 'cod' ? 'COD' : 'Paid',
    };
    if (opts.dryRun) { results.push({ row, ok: true, preview }); continue; }

    try {
      const now = new Date();
      const placedAt = date || now;
      const delivered = status === 'delivered';
      const paid = pay === 'paid' || delivered;
      const orderSeq = await getNextSequence(ORDER_SEQ, () => Order.countDocuments());
      const order: any = await Order.create({
        orderSeq,
        items: [{ book: book._id, title: book.title, price: unit, quantity, format: book.format }],
        deliveryType: book.format === 'printed' ? 'printed' : 'digital',
        shippingAddress: {
          name, phone, address, city: upazila || district || address,
          district, upazila, altPhone: phone11(r.altPhone), note: clean(r.note),
        },
        ...(college || collegeText
          ? { college: { college: college?._id, name: college?.name || collegeText, district: college?.district || '', upazila: college?.upazila || '' } }
          : {}),
        subtotal,
        discount,
        deliveryCharge,
        total,
        isPreOrder: book.isPreOrder === true || book.offers?.preorder?.enabled === true,
        payment: {
          method: pay === 'cod' ? 'cod' : 'manual',
          status: paid ? 'paid' : 'pending',
          ...(paid ? { paidAt: placedAt } : {}),
        },
        status,
        ...(status !== 'pending' && status !== 'cancelled' ? { confirmedAt: placedAt } : {}),
        ...(status === 'shipped' || delivered ? { shippedAt: placedAt } : {}),
        ...(delivered ? { deliveredAt: placedAt } : {}),
        ...(status === 'cancelled' ? { cancelledAt: placedAt } : {}),
        adminNote: [clean(r.note), opts.source === 'import' ? 'শিট থেকে যোগ করা' : opts.source === 'campus' ? 'ক্যাম্পাস অর্ডার' : 'হাতে যোগ করা'].filter(Boolean).join(' · '),
        source: opts.source || 'manual',
        ...(/^\d{2}-\d{2}$/.test(clean(r.session)) ? { session: clean(r.session) } : {}),
        ...(ref ? { externalRef: ref } : {}),
        // Nothing is sent to these buyers — they did not order on the site.
        alertsSentAt: now,
      });
      // The day it was ordered, when the sheet says so (timestamps would stamp today).
      if (date) await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: placedAt } });
      // Copies leave the shelf the same way a confirmed website order takes them.
      if (status === 'processing' || status === 'shipped' || delivered) {
        await OrderService.applyStockOnce(order);
        await order.save();
      }
      // The admin's "send SMS" tick: the text that matches the status.
      if (opts.sms === true) {
        if (status === 'processing') void OrderSmsService.send(order, pay === 'cod' ? 'placed' : 'paid');
        else if (status === 'shipped') void OrderSmsService.send(order, 'shipped');
        else if (delivered) void OrderSmsService.send(order, 'delivered', { force: true });
      }
      created++;
      results.push({ row, ok: true, orderId: String(order._id), orderSeq: order.orderSeq, orderNumber: order.orderNumber, preview });
    } catch (e: any) {
      fail(e?.message || 'Could not save');
    }
  }

  return { results, created, failed: results.filter((x) => !x.ok).length };
};

export const ManualOrderService = { addOrders, phone11, parseDate };
