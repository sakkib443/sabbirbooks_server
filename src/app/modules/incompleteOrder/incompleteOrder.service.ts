/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Incomplete orders — see incompleteOrder.model for the idea.
 *
 * track()       the checkout's autosave (public, rate-limited): any field is
 *               enough to be kept; a phone or email makes it a contact the
 *               shop can call, and joins every visit by that contact into one
 *               row with a count.
 * markOrdered() called when an order is created: the contact's open row is
 *               marked ordered, with the order number.
 * list()        the admin page, with filters and counts.
 */
import { isValidObjectId } from 'mongoose';
import { IncompleteOrder } from './incompleteOrder.model';

const MAX_SESSIONS = 100;
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

/** A Bangladeshi mobile as 01XXXXXXXXX, from any common spelling; '' if it is not one. */
export const phone11 = (v: unknown): string => {
  const digits = String(v ?? '')
    .replace(/[০-৯]/g, (c) => String('০১২৩৪৫৬৭৮৯'.indexOf(c)))
    .replace(/\D/g, '');
  const local = digits.startsWith('8801') ? digits.slice(2) : digits.startsWith('008801') ? digits.slice(4) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? local : '';
};

const emailOf = (v: unknown): string => {
  const e = clean(v, 120).toLowerCase();
  return EMAIL.test(e) ? e : '';
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The checkout's autosave. Returns { saved } and never throws for an empty form. */
const track = async (body: any) => {
  const sid = clean(body?.sessionId, 64);
  if (!SESSION_ID.test(sid)) throw new Error('Bad session');

  const phone = phone11(body?.phone);
  const email = emailOf(body?.email);
  const fields: Record<string, any> = {
    name: clean(body?.name, 120),
    address: clean(body?.address, 300),
    collegeName: clean(body?.collegeName, 160),
    bookSlug: clean(body?.bookSlug, 120),
    couponCode: clean(body?.couponCode, 40).toUpperCase(),
    payMode: ['cod', 'gateway'].includes(body?.payMode) ? body.payMode : '',
  };
  const qty = Math.round(Number(body?.quantity));
  if (qty >= 1 && qty <= 500) fields.quantity = qty;
  if (isValidObjectId(body?.college)) fields.college = body.college;
  // A partly typed number is still worth keeping as text.
  const typedPhone = clean(body?.phone, 20);

  const anything = phone || email || typedPhone || fields.name || fields.address || fields.collegeName;
  if (!anything) return { saved: false };

  const now = new Date();
  let doc: any = null;
  if (phone) doc = await IncompleteOrder.findOne({ phone });
  else if (email) doc = await IncompleteOrder.findOne({ email });
  const bySession: any = await IncompleteOrder.findOne({ sessions: sid });

  // This visit started a row before the contact was typed: fold it into the
  // contact's own row, unless it already belongs to a different contact.
  if (doc && bySession && !doc._id.equals(bySession._id)) {
    const sameContact = (!bySession.phone || bySession.phone === phone) && (!bySession.email || bySession.email === email);
    if (sameContact) {
      for (const s of bySession.sessions) if (!doc.sessions.includes(s)) doc.sessions.push(s);
      doc.firstSeenAt = doc.firstSeenAt < bySession.firstSeenAt ? doc.firstSeenAt : bySession.firstSeenAt;
      await IncompleteOrder.deleteOne({ _id: bySession._id });
    }
  }
  if (!doc) doc = bySession;
  if (!doc) doc = new IncompleteOrder({ sessions: [], attempts: 0, firstSeenAt: now });

  if (!doc.sessions.includes(sid)) {
    doc.sessions.push(sid);
    // Back at the checkout after ordering: an open attempt again.
    if (doc.status === 'ordered') doc.status = 'open';
  }
  if (doc.sessions.length > MAX_SESSIONS) doc.sessions = doc.sessions.slice(-MAX_SESSIONS);
  doc.attempts = Math.max(doc.attempts || 0, Math.min(doc.sessions.length, MAX_SESSIONS));

  if (phone) doc.phone = phone;
  else if (!doc.phone && typedPhone) doc.typedPhone = typedPhone;
  if (email) doc.email = email;
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) doc[k] = v;
  doc.lastSeenAt = now;
  await doc.save();
  return { saved: true };
};

/** An order was placed: close that contact's open row. Never throws. */
const markOrdered = async (order: any) => {
  try {
    const phone = phone11(order?.shippingAddress?.phone);
    const email = emailOf(order?.shippingAddress?.email);
    const or: any[] = [];
    if (phone) or.push({ phone });
    if (email) or.push({ email });
    if (!or.length) return;
    await IncompleteOrder.updateMany(
      { $or: or, status: 'open' },
      { $set: { status: 'ordered', order: order._id, orderNumber: order.orderNumber || '', orderedAt: new Date() } }
    );
  } catch (e) {
    console.error('[incomplete-orders] could not mark ordered:', e);
  }
};

/**
 * The admin list. `from`/`to` are instants (the page sends shop-day bounds);
 * the caller has already narrowed them for a manager.
 */
const list = async (q: any = {}) => {
  const filter: any = {};
  const range: any = {};
  if (q.from && !Number.isNaN(new Date(q.from).getTime())) range.$gte = new Date(q.from);
  if (q.to && !Number.isNaN(new Date(q.to).getTime())) range.$lt = new Date(q.to);
  if (Object.keys(range).length) filter.lastSeenAt = range;
  if (q.college) filter.collegeName = clean(q.college, 160);
  if (q.contact === 'yes') filter.$or = [{ phone: { $ne: null } }, { email: { $ne: null } }];
  if (q.contact === 'no') Object.assign(filter, { phone: null, email: null });
  const search = clean(q.q, 80);
  if (search) {
    const re = new RegExp(escapeRegex(search), 'i');
    const digits = phone11(search) || search.replace(/\D/g, '');
    filter.$and = [{ $or: [{ name: re }, { email: re }, { collegeName: re }, { address: re }, { typedPhone: re }, ...(digits.length >= 3 ? [{ phone: new RegExp(escapeRegex(digits)) }] : [])] }];
  }

  const counts = {
    total: await IncompleteOrder.countDocuments(filter),
    open: await IncompleteOrder.countDocuments({ ...filter, status: 'open' }),
    ordered: await IncompleteOrder.countDocuments({ ...filter, status: 'ordered' }),
    contacted: await IncompleteOrder.countDocuments({ ...filter, status: 'open', contacted: true }),
  };

  const view: any = { ...filter };
  if (q.status === 'open') Object.assign(view, { status: 'open' });
  if (q.status === 'ordered') view.status = 'ordered';
  if (q.status === 'todo') Object.assign(view, { status: 'open', contacted: false });
  if (q.status === 'contacted') Object.assign(view, { status: 'open', contacted: true });

  const rows = await IncompleteOrder.find(view)
    .select('-sessions')
    .sort({ lastSeenAt: -1 })
    .limit(1000)
    .populate('order', 'orderNumber orderSeq status')
    .lean();
  const colleges = (await IncompleteOrder.distinct('collegeName', { collegeName: { $ne: '' } })).sort();
  return { rows, counts, colleges };
};

const update = async (id: string, body: any) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  const set: any = {};
  if (typeof body?.contacted === 'boolean') {
    set.contacted = body.contacted;
    set.contactedAt = body.contacted ? new Date() : null;
  }
  if (body?.note !== undefined) set.note = clean(body.note, 500);
  const doc = await IncompleteOrder.findByIdAndUpdate(id, { $set: set }, { new: true })
    .select('-sessions')
    .populate('order', 'orderNumber orderSeq status');
  if (!doc) throw new Error('Not found');
  return doc;
};

const remove = async (id: string) => {
  if (!isValidObjectId(id)) throw new Error('Not found');
  await IncompleteOrder.deleteOne({ _id: id });
  return { removed: true };
};

export const IncompleteOrderService = { track, markOrdered, list, update, remove };
