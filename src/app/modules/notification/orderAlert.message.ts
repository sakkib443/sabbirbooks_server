/**
 * Order-alert message builders — PURE. No I/O, no config, no mongoose.
 *
 * Everything here is a plain function over a plain object so the wording can be
 * unit-tested without a database, a network, or an env file. The services that
 * actually send (telegram.service / whatsapp.service) import from here; nothing
 * here imports them.
 *
 * Digits stay ASCII on purpose. Bengali numerals read nicer, but the buyer has
 * to be able to copy the order number into a chat and the admin has to be able
 * to tap the phone number to dial it — ৳১,১৫০ and ০১৭১২... break both.
 */

export interface IOrderAlertBuyer {
  name: string;
  phone: string;
  address?: string;
  city?: string;
  area?: string;
  note?: string;
}

export interface IOrderAlertItem {
  title: string;
  quantity: number;
  price: number;
}

export interface IOrderAlertInput {
  orderNumber: string;
  items: IOrderAlertItem[];
  subtotal: number;
  deliveryCharge: number;
  total: number;
  /** Order payment method as stored: 'cod' | 'manual' | 'bkash' | ... */
  paymentMethod?: string | null;
  deliveryType?: string | null;
  /** Null for a digital order with no shipping address and no user phone on file. */
  buyer: IOrderAlertBuyer | null;
  shopName: string;
  /** Absolute link to the buyer's order list; optional. */
  orderUrl?: string;
}

// ─── Small formatters ────────────────────────────────────────

const money = (n: number): string => {
  const safe = Number.isFinite(n) ? n : 0;
  return `৳${Math.round(safe).toLocaleString('en-US')}`;
};

/** Just the grouped number, no ৳ — WhatsApp template params read better bare. */
const amount = (n: number): string => {
  const safe = Number.isFinite(n) ? n : 0;
  return Math.round(safe).toLocaleString('en-US');
};

const paymentLabel = (method?: string | null): string => {
  switch (method) {
    case 'cod':
      return 'ক্যাশ অন ডেলিভারি';
    case 'manual':
      return 'মোবাইল ব্যাংকিং (Send Money — যাচাই বাকি)';
    case 'bkash':
      return 'বিকাশ';
    case 'sslcommerz':
      return 'অনলাইন পেমেন্ট (কার্ড/মোবাইল ব্যাংকিং)';
    case 'free':
      return 'ফ্রি';
    default:
      return 'অনলাইন পেমেন্ট';
  }
};

const areaLabel = (area?: string): string =>
  area === 'inside-dhaka' ? 'ঢাকার ভিতরে' : area === 'outside-dhaka' ? 'ঢাকার বাইরে' : '';

const deliveryTypeLabel = (t?: string | null): string =>
  t === 'digital' ? 'ডিজিটাল (ডাউনলোড)' : t === 'mixed' ? 'ছাপা + ডিজিটাল' : 'ছাপা বই (কুরিয়ার)';

/** "মিরপুর ১০, ঢাকা (ঢাকার ভিতরে)" — the parts that exist, joined sanely. */
const fullAddress = (buyer: IOrderAlertBuyer | null): string => {
  if (!buyer) return '';
  const parts = [buyer.address, buyer.city].filter((p) => !!p && String(p).trim());
  const base = parts.join(', ');
  const zone = areaLabel(buyer.area);
  return zone ? (base ? `${base} (${zone})` : zone) : base;
};

// ─── Item lists ──────────────────────────────────────────────

/** Multi-line, one book per line — for Telegram / in-app, where newlines are free. */
const itemLines = (items: IOrderAlertItem[]): string =>
  (items || [])
    .map((it, i) => `${i + 1}. ${it.title} × ${it.quantity} — ${money(it.price * it.quantity)}`)
    .join('\n');

/** Single line — WhatsApp template parameters may not contain a newline. */
const itemsOneLine = (items: IOrderAlertItem[]): string =>
  (items || []).map((it) => `${it.title} × ${it.quantity}`).join(', ');

// ─── Telegram / in-app text ──────────────────────────────────

/**
 * The admin's message. Sent as PLAIN TEXT deliberately — no Markdown, no HTML.
 * A book title containing `<`, `*` or `_` would make Telegram reject a parsed
 * message with 400 "can't parse entities", and the admin would get nothing at
 * all. Emoji carry the structure instead; they can never fail to parse.
 */
const buildAdminTelegramText = (o: IOrderAlertInput): string => {
  const lines: string[] = [];
  lines.push('🛒 নতুন অর্ডার এসেছে!');
  lines.push('');
  lines.push(`অর্ডার নম্বর: ${o.orderNumber}`);
  lines.push(`ধরন: ${deliveryTypeLabel(o.deliveryType)}`);
  lines.push('');
  lines.push('📚 বই:');
  lines.push(itemLines(o.items) || '(কোনো আইটেম নেই)');
  lines.push('');
  lines.push(`সাবটোটাল: ${money(o.subtotal)}`);
  lines.push(`ডেলিভারি চার্জ: ${money(o.deliveryCharge)}`);
  lines.push(`সর্বমোট: ${money(o.total)}`);
  lines.push(`পেমেন্ট: ${paymentLabel(o.paymentMethod)}`);

  if (o.buyer) {
    lines.push('');
    lines.push('👤 ক্রেতা:');
    lines.push(`নাম: ${o.buyer.name}`);
    lines.push(`ফোন: ${o.buyer.phone}`);
    const addr = fullAddress(o.buyer);
    if (addr) lines.push(`ঠিকানা: ${addr}`);
    if (o.buyer.note) lines.push(`নোট: ${o.buyer.note}`);
  }

  return lines.join('\n');
};

/** Buyer-facing plain text. Used for the in-app bell; WhatsApp needs the template form. */
const buildBuyerText = (o: IOrderAlertInput): string => {
  const lines: string[] = [];
  const name = o.buyer?.name ? ` ${o.buyer.name}` : '';
  lines.push(`আসসালামু আলাইকুম${name}, আপনার অর্ডারটি আমরা পেয়েছি ✅`);
  lines.push('');
  lines.push(`অর্ডার নম্বর: ${o.orderNumber}`);
  lines.push('');
  lines.push('📚 বই:');
  lines.push(itemLines(o.items) || '(কোনো আইটেম নেই)');
  lines.push('');
  lines.push(`ডেলিভারি চার্জ: ${money(o.deliveryCharge)}`);
  lines.push(`সর্বমোট: ${money(o.total)}`);
  lines.push(`পেমেন্ট: ${paymentLabel(o.paymentMethod)}`);
  if (o.buyer) {
    const addr = fullAddress(o.buyer);
    if (addr) lines.push(`ঠিকানা: ${addr}`);
    lines.push(`ফোন: ${o.buyer.phone}`);
  }
  lines.push('');
  lines.push(`আমরা শীঘ্রই আপনার সাথে যোগাযোগ করব। ধন্যবাদ — ${o.shopName}`);
  return lines.join('\n');
};

/** One-liner for the notification bell, where there is no room for a receipt. */
const buildAdminInAppMessage = (o: IOrderAlertInput): string => {
  const who = o.buyer?.name || 'একজন ক্রেতা';
  const phone = o.buyer?.phone ? ` (${o.buyer.phone})` : '';
  return `${who}${phone} ${o.orderNumber} অর্ডারে ${itemsOneLine(o.items) || 'বই'} নিয়েছেন — ${money(
    o.total
  )}, ${paymentLabel(o.paymentMethod)}।`;
};

const buildBuyerInAppMessage = (o: IOrderAlertInput): string =>
  `আপনার অর্ডার ${o.orderNumber} গ্রহণ করা হয়েছে। ${itemsOneLine(o.items) || 'বই'} — সর্বমোট ${money(
    o.total
  )} (ডেলিভারি চার্জ ${money(o.deliveryCharge)})। পেমেন্ট: ${paymentLabel(o.paymentMethod)}।`;

// ─── WhatsApp template parameters ────────────────────────────

/**
 * Meta rejects a template parameter that contains a newline, a tab, or four or
 * more consecutive spaces (error 132000 / 131008). Squash all of it, and cap the
 * length so one absurd book title cannot blow the whole send.
 */
const sanitizeParam = (v: unknown, max = 900): string => {
  const s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const out = s.length > max ? `${s.slice(0, max - 1)}…` : s;
  // An empty parameter is also a 400 from Meta — send a dash instead.
  return out || '-';
};

/**
 * The seven body parameters, in order, shared by both order templates:
 *   {{1}} ক্রেতার নাম   {{2}} অর্ডার নম্বর   {{3}} বইয়ের তালিকা
 *   {{4}} ডেলিভারি চার্জ  {{5}} সর্বমোট       {{6}} পেমেন্ট পদ্ধতি
 *   {{7}} ঠিকানা ও ফোন
 * Both templates take the same seven so one builder serves both.
 */
const buildWhatsAppParams = (o: IOrderAlertInput): string[] => {
  const addr = fullAddress(o.buyer);
  const contact = [addr, o.buyer?.phone].filter(Boolean).join(' — ');
  return [
    sanitizeParam(o.buyer?.name || 'ক্রেতা', 60),
    sanitizeParam(o.orderNumber, 60),
    sanitizeParam(itemsOneLine(o.items), 300),
    sanitizeParam(amount(o.deliveryCharge), 20),
    sanitizeParam(amount(o.total), 20),
    sanitizeParam(paymentLabel(o.paymentMethod), 80),
    sanitizeParam(contact, 300),
  ];
};

export const OrderAlertMessage = {
  money,
  amount,
  paymentLabel,
  areaLabel,
  deliveryTypeLabel,
  fullAddress,
  itemLines,
  itemsOneLine,
  sanitizeParam,
  buildAdminTelegramText,
  buildBuyerText,
  buildAdminInAppMessage,
  buildBuyerInAppMessage,
  buildWhatsAppParams,
};
