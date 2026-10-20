/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Campus orders and the seniors' phone book — see campus.model for the story.
 *
 * The money is worked out here, never taken from the browser:
 *   per copy  = book price − extra discount
 *   total     = per copy × copies ordered + delivery (0 when free)
 * Free copies for the senior cost the batch nothing but still leave the shelf.
 *
 * "Make the order" turns a deal into a real Order through the same path as the
 * Add-order form (ManualOrderService, source 'campus'), so stock, the courier,
 * the packing list and the sales figures all treat it like any other order.
 */
import { isValidObjectId } from 'mongoose';
import { CampusContact, CampusOrder, CONTACT_ROLES, CAMPUS_STATUSES } from './campus.model';
import { MedicalCollege } from '../medicalCollege/medicalCollege.model';
import { Book } from '../book/book.model';
import { Order } from '../order/order.model';
import { ManualOrderService } from '../order/manualOrder.service';
import { OrderService } from '../order/order.service';
import { dayWindow } from '../../utils/shopDay';

const clean = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown, field: string): number => {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c))));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${field} ঠিক নেই`);
  return Math.round(n);
};
const day = (v: unknown): string => {
  const s = clean(v);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`তারিখ ঠিক নেই (${s})`);
  return s;
};

export const priceOf = (d: any) => {
  const perCopy = Math.max(0, (Number(d.unitPrice) || 0) - (Number(d.extraDiscount) || 0));
  const books = perCopy * (Number(d.quantity) || 0);
  const delivery = d.freeDelivery ? 0 : Number(d.deliveryCharge) || 0;
  return { perCopy, books, delivery, total: books + delivery };
};

// ── Phone book ────────────────────────────────────────────────────────────

/** Every active college, each with its contacts — the "all colleges" list. */
const directory = async () => {
  const [colleges, contacts] = await Promise.all([
    MedicalCollege.find({ isActive: true }).select('name abbreviation district upazila type deliveryCharge').sort({ name: 1 }).lean(),
    CampusContact.find().sort({ role: 1, createdAt: 1 }).lean(),
  ]);
  const byCollege = new Map<string, any[]>();
  for (const c of contacts as any[]) {
    const k = String(c.college);
    if (!byCollege.has(k)) byCollege.set(k, []);
    byCollege.get(k)!.push(c);
  }
  return (colleges as any[]).map((c) => ({ ...c, contacts: byCollege.get(String(c._id)) || [] }));
};

const contactFields = (b: any, partial: boolean) => {
  const out: any = {};
  if (!partial || b.name !== undefined) {
    out.name = clean(b.name);
    if (!out.name) throw new Error('নাম লিখুন');
  }
  if (b.phone !== undefined) out.phone = clean(b.phone);
  if (b.role !== undefined) {
    if (!CONTACT_ROLES.includes(b.role)) throw new Error('ভূমিকা ঠিক নেই');
    out.role = b.role;
  }
  if (b.batch !== undefined) out.batch = clean(b.batch);
  if (b.note !== undefined) out.note = clean(b.note);
  return out;
};

const addContact = async (b: any) => {
  if (!isValidObjectId(b?.college) || !(await MedicalCollege.exists({ _id: b.college }))) throw new Error('কলেজ বেছে নিন');
  return CampusContact.create({ college: b.college, ...contactFields(b || {}, false) });
};

const updateContact = async (id: string, b: any) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const doc = await CampusContact.findByIdAndUpdate(id, { $set: contactFields(b || {}, true) }, { new: true });
  if (!doc) throw new Error('Not found');
  return doc;
};

const removeContact = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  await CampusContact.deleteOne({ _id: id });
  return { removed: true };
};

// ── Deals ─────────────────────────────────────────────────────────────────

const ORDER_FIELDS = 'orderSeq orderNumber status total trackingUrl dispatchDate courier.trackingCode courier.consignmentId courier.status payment.status';

const list = async (q: any = {}) => {
  const filter: any = {};
  if (q.status && CAMPUS_STATUSES.includes(q.status)) filter.status = q.status;
  if (isValidObjectId(q.college)) filter.college = q.college;
  const rows = await CampusOrder.find(filter).sort({ createdAt: -1 }).limit(1000).populate('order', ORDER_FIELDS).lean();
  return rows;
};

/** The fields an admin types; money fields are left out once the order exists. */
const dealFields = async (b: any, existing: any | null) => {
  const out: any = {};
  const has = (k: string) => b[k] !== undefined;
  const placed = !!existing?.order;

  if (!existing || has('college') || has('collegeName')) {
    if (isValidObjectId(b.college)) {
      const c: any = await MedicalCollege.findById(b.college).select('name district upazila').lean();
      if (!c) throw new Error('কলেজ পাওয়া যায়নি');
      Object.assign(out, { college: c._id, collegeName: c.name, district: c.district || '', upazila: c.upazila || '' });
    } else {
      const name = clean(b.collegeName);
      if (!name) throw new Error('মেডিকেল কলেজ বেছে নিন');
      Object.assign(out, { college: null, collegeName: name });
    }
  }
  if (!existing || has('contact')) {
    const c = b.contact || {};
    const name = clean(c.name);
    if (!name) throw new Error('সিনিয়রের (বা যার কাছে যাবে তার) নাম লিখুন');
    const role = CONTACT_ROLES.includes(c.role) ? c.role : 'senior';
    out.contact = { name, phone: clean(c.phone), role };
  }
  for (const k of ['batch', 'address', 'note']) if (has(k)) out[k] = clean(b[k]);
  for (const k of ['contactedOn', 'deadline', 'shipOn']) if (has(k)) out[k] = day(b[k]);
  if (has('status')) {
    if (!CAMPUS_STATUSES.includes(b.status)) throw new Error('স্ট্যাটাস ঠিক নেই');
    out.status = b.status;
  }

  const money = ['book', 'quantity', 'unitPrice', 'extraDiscount', 'giftAbove', 'freeBooks', 'freeDelivery', 'deliveryCharge', 'payment'];
  if (placed && money.some((k) => has(k) && String(b[k]) !== String(existing[k]))) {
    throw new Error('অর্ডার হয়ে গেছে — বই, সংখ্যা বা টাকা এখন আর বদলানো যায় না (Book Orders থেকে অর্ডারটা এডিট করুন)');
  }
  if (!placed) {
    if (!existing || has('book')) {
      let book: any = null;
      if (isValidObjectId(b.book)) book = await Book.findById(b.book).select('title price offerPrice format').lean();
      if (!book && !existing) {
        const printed: any[] = await Book.find({ format: 'printed' }).select('title price offerPrice format').lean();
        if (printed.length === 1) book = printed[0];
      }
      if (!book && !existing) throw new Error('বই বেছে নিন');
      if (book) {
        out.book = book._id;
        out.bookTitle = book.title;
        // The book's price unless the admin typed one.
        if (!has('unitPrice') || b.unitPrice === '' || b.unitPrice == null) {
          out.unitPrice = Number(book.offerPrice ?? book.price) || 0;
        }
      }
    }
    if (has('quantity')) out.quantity = num(b.quantity, 'বইয়ের সংখ্যা');
    if (has('unitPrice') && b.unitPrice !== '' && b.unitPrice != null) out.unitPrice = num(b.unitPrice, 'বইয়ের দাম');
    if (has('extraDiscount')) out.extraDiscount = num(b.extraDiscount, 'ছাড়');
    if (has('giftAbove')) out.giftAbove = num(b.giftAbove, 'ফ্রি বইয়ের শর্ত');
    if (has('freeBooks')) out.freeBooks = num(b.freeBooks, 'ফ্রি বই');
    if (has('freeDelivery')) out.freeDelivery = b.freeDelivery === true;
    if (has('deliveryCharge')) out.deliveryCharge = num(b.deliveryCharge, 'ডেলিভারি চার্জ');
    if (has('payment')) out.payment = b.payment === 'paid' ? 'paid' : 'cod';
  }
  if (out.quantity > 500 || out.freeBooks > 50) throw new Error('সংখ্যা অনেক বেশি');
  const merged = { ...(existing || {}), ...out };
  if ((Number(merged.extraDiscount) || 0) > (Number(merged.unitPrice) || 0)) throw new Error('ছাড় বইয়ের দামের চেয়ে বেশি');
  if (!placed) out.total = priceOf(merged).total;
  return out;
};

const create = async (b: any, uid: string | null) => {
  const fields = await dealFields(b || {}, null);
  return CampusOrder.create({ ...fields, createdBy: uid || null });
};

const update = async (id: string, b: any) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const existing: any = await CampusOrder.findById(id).lean();
  if (!existing) throw new Error('Not found');
  const fields = await dealFields(b || {}, existing);
  const doc: any = await CampusOrder.findByIdAndUpdate(id, { $set: fields }, { new: true }).populate('order', ORDER_FIELDS);
  // A new ship day moves the order onto that day's packing list.
  if (existing.order && fields.shipOn !== undefined && fields.shipOn !== existing.shipOn) {
    await OrderService.setOrdersDispatchDate([String(existing.order)], fields.shipOn ? dayWindow(fields.shipOn).$gte : null);
  }
  return doc;
};

/** Delete a deal that never became an order (the order itself is never deleted here). */
const remove = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const d: any = await CampusOrder.findById(id).lean();
  if (!d) throw new Error('Not found');
  if (d.order) throw new Error('অর্ডার হয়ে গেছে — মোছা যাবে না। দরকার হলে Book Orders থেকে অর্ডারটা বাতিল করুন।');
  await CampusOrder.deleteOne({ _id: id });
  return { removed: true };
};

/**
 * Make the real order: the paid copies plus the senior's free ones, for the
 * worked-out total, confirmed (so the stock comes off), on the ship day's list.
 */
const placeOrder = async (id: string, opts: { sms?: boolean } = {}) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const d: any = await CampusOrder.findById(id);
  if (!d) throw new Error('Not found');
  if (d.order && (await Order.exists({ _id: d.order }))) throw new Error('এই ক্যাম্পাসের অর্ডার আগেই তৈরি হয়েছে');
  if (d.status === 'cancelled') throw new Error('বাতিল করা — আগে স্ট্যাটাস বদলান');
  const copies = (d.quantity || 0) + (d.freeBooks || 0);
  if (copies < 1) throw new Error('কয়টা বই অর্ডার হয়েছে লিখুন');
  const p = priceOf(d);

  const note = [
    `ক্যাম্পাস: ${d.collegeName}${d.batch ? ` (${d.batch})` : ''}`,
    d.contact.role === 'senior' ? 'সিনিয়রের কাছে' : d.contact.role === 'student' ? 'সাধারণ স্টুডেন্টের কাছে' : '',
    d.freeBooks ? `${d.freeBooks}টা ফ্রি বই (সিনিয়রের)` : '',
    d.extraDiscount ? `প্রতি বইয়ে ৳${d.extraDiscount} ছাড়` : '',
    d.freeDelivery ? 'ডেলিভারি ফ্রি' : '',
  ].filter(Boolean).join(' · ');

  const res = await ManualOrderService.addOrders(
    [{
      ref: `CAMPUS-${String(d._id).slice(-8).toUpperCase()}`,
      name: d.contact.name,
      phone: d.contact.phone,
      college: d.college ? d.collegeName : '',
      district: d.district,
      upazila: d.upazila,
      address: d.address || d.collegeName,
      book: String(d.book),
      quantity: String(copies),
      amount: String(p.total),
      deliveryCharge: String(p.delivery),
      payment: d.payment,
      status: 'confirmed',
      note,
    }],
    { source: 'campus', sms: opts.sms === true }
  );
  const r = res.results[0];
  if (!r?.ok || !r.orderId) throw new Error(r?.error || 'অর্ডার তৈরি করা যায়নি');

  if (d.shipOn) await OrderService.setOrdersDispatchDate([r.orderId], dayWindow(d.shipOn).$gte);
  d.order = r.orderId;
  d.status = 'ready';
  await d.save();
  return CampusOrder.findById(id).populate('order', ORDER_FIELDS).lean();
};

export const CampusService = { directory, addContact, updateContact, removeContact, list, create, update, remove, placeOrder, priceOf };
