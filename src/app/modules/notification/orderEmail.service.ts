/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Book-order emails to the BUYER — two moments:
 *
 *   placed    → sent the instant the order is created (status pending). "We have
 *               your order, it's pending, we'll confirm shortly."
 *   confirmed → sent the first time the order is confirmed: an admin confirming a
 *               COD order, or a gateway/manual payment settling. Fires once,
 *               guarded on confirmedAt.
 *
 * Same rule as the order alerts: an email failure must NEVER fail the order. Every
 * function catches everything and resolves; call them WITHOUT awaiting.
 *
 * Delivery is gated on SMTP_USER + SMTP_PASS (a Gmail App Password); without them
 * EmailService stays in demo mode and just logs.
 *
 * ── About the HTML ─────────────────────────────────────────────────────────
 * Written for EMAIL CLIENTS, not browsers: tables for layout, inline styles only,
 * no flexbox/grid, no external CSS and no web fonts — Gmail strips <style> blocks
 * and Outlook renders with Word. Every colour is a literal hex for the same
 * reason. It is deliberately not the design system used on the site.
 */
import config from '../../config';
import { EmailService } from './email.service';
import { User } from '../user/user.model';

// ── Brand ──────────────────────────────────────────────────────────────────
const BRAND = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e6eaf0',
  soft: '#f6f8fb',
  primary: '#0d9488',
  amber: '#f59e0b',
  green: '#10b981',
};

const shopName = () => config.email.from_name || 'Magic Viva';
const clientUrl = () => (config.client_url || 'https://magicviva.com').replace(/\/+$/, '');
const supportPhone = () => config.alerts?.whatsapp?.admin_to || '';
const tk = (n: any) => '৳' + Number(n || 0).toLocaleString('en-US');

const bdDate = (d: any): string => {
  try {
    return new Date(d || Date.now()).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Dhaka',
    });
  } catch {
    return '';
  }
};

// The buyer's email + a name to greet. The shipping address carries the name they
// typed for this parcel; the email only ever lives on the User record.
const buyerContact = async (order: any): Promise<{ email: string; name: string }> => {
  const u: any = await User.findById(order?.user).select('email firstName lastName name').lean();
  const email = (u?.email || '').trim();
  const name =
    (order?.shippingAddress?.name || '').trim() ||
    `${u?.firstName || u?.name || ''} ${u?.lastName || ''}`.trim() ||
    'ক্রেতা';
  return { email, name };
};

// ── Building blocks ────────────────────────────────────────────────────────

/** One money row. `strong` is the grand total; `accent` the discount lines. */
const row = (label: string, value: string, opts: { strong?: boolean; accent?: boolean } = {}) => `
  <tr>
    <td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};color:${
      opts.strong ? BRAND.ink : BRAND.muted
    };font-size:14px;${opts.strong ? 'font-weight:700;' : ''}">${label}</td>
    <td align="right" style="padding:9px 0;border-bottom:1px solid ${BRAND.line};font-size:${
      opts.strong ? '17px' : '14px'
    };font-weight:${opts.strong ? '800' : '600'};color:${
      opts.accent ? BRAND.green : BRAND.ink
    };white-space:nowrap;">${value}</td>
  </tr>`;

const itemRows = (order: any): string =>
  (order?.items || [])
    .map((it: any) => {
      const qty = Number(it?.quantity) || 1;
      const line = (Number(it?.price) || 0) * qty;
      return `
      <tr>
        <td style="padding:9px 0;border-bottom:1px solid ${BRAND.line};color:${BRAND.ink};font-size:14px;">
          ${it?.title || 'বই'}
          <span style="color:${BRAND.muted};font-size:12px;">&nbsp;×&nbsp;${qty}</span>
        </td>
        <td align="right" style="padding:9px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;font-weight:600;color:${BRAND.ink};white-space:nowrap;">${tk(line)}</td>
      </tr>`;
    })
    .join('');

const summaryTable = (order: any): string => {
  const discount = Number(order?.discount) || 0;
  const delivery = Number(order?.deliveryCharge) || 0;
  const coupon = Number(order?.couponDiscount) || 0;
  let rows = itemRows(order);
  rows += row('সাবটোটাল', tk(order?.subtotal));
  if (discount > 0) {
    rows += row(
      order?.couponCode && coupon > 0 ? `ছাড় (কুপন ${order.couponCode} সহ)` : 'ছাড়',
      '− ' + tk(discount),
      { accent: true }
    );
  }
  rows += row('ডেলিভারি চার্জ', delivery > 0 ? tk(delivery) : 'ফ্রি');
  rows += row('সর্বমোট', tk(order?.total), { strong: true });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 0;">${rows}</table>`;
};

/** A labelled panel — used for the delivery address and the payment note. */
const panel = (title: string, bodyHtml: string, accent = BRAND.line): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:18px 0 0;">
    <tr>
      <td style="background:${BRAND.soft};border-left:3px solid ${accent};border-radius:6px;padding:14px 16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px;">${title}</div>
        ${bodyHtml}
      </td>
    </tr>
  </table>`;

const addressPanel = (order: any): string => {
  const a = order?.shippingAddress;
  if (!a) return '';
  const line2 = [a.address, a.upazila || a.city, a.district, a.division].filter(Boolean).join(', ');
  return panel(
    'ডেলিভারি ঠিকানা',
    `<div style="font-size:14px;font-weight:600;color:${BRAND.ink};">${a.name || ''}</div>
     <div style="font-size:13px;color:${BRAND.muted};line-height:1.55;margin-top:2px;">${line2}</div>
     ${a.phone ? `<div style="font-size:13px;color:${BRAND.muted};margin-top:2px;">ফোন: ${a.phone}</div>` : ''}`
  );
};

const button = (href: string, label: string, color: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
    <tr>
      <td style="background:${color};border-radius:8px;">
        <a href="${href}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${label}</a>
      </td>
    </tr>
  </table>`;

/**
 * The page frame: a centred 600px card on a tinted ground, with a coloured
 * status bar, the order number in the header, and a footer carrying the shop's
 * contact details.
 */
const shell = (opts: {
  accent: string;
  eyebrow: string;
  heading: string;
  orderNumber: string;
  date: string;
  body: string;
}): string => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;margin:0;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08);font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">

      <!-- status bar -->
      <tr><td style="height:5px;background:${opts.accent};font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- header -->
      <tr><td style="padding:26px 32px 0;">
        <div style="font-size:17px;font-weight:800;color:${BRAND.ink};letter-spacing:-.01em;">${shopName()}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${opts.accent};margin-top:14px;">${opts.eyebrow}</div>
        <div style="font-size:23px;font-weight:800;color:${BRAND.ink};line-height:1.3;margin-top:4px;">${opts.heading}</div>
        <div style="font-size:13px;color:${BRAND.muted};margin-top:8px;">
          অর্ডার <span style="font-weight:700;color:${BRAND.ink};">#${opts.orderNumber}</span>
          &nbsp;·&nbsp; ${opts.date}
        </div>
      </td></tr>

      <!-- body -->
      <tr><td style="padding:20px 32px 32px;">${opts.body}</td></tr>

      <!-- footer -->
      <tr><td style="padding:20px 32px 26px;border-top:1px solid ${BRAND.line};background:${BRAND.soft};">
        <div style="font-size:12px;color:${BRAND.muted};line-height:1.7;">
          কোনো প্রশ্ন থাকলে এই মেইলের উত্তর দিন${
            supportPhone() ? ` অথবা কল করুন <span style="color:${BRAND.ink};font-weight:600;">${supportPhone()}</span>` : ''
          }।<br>
          <span style="color:#94a3b8;">© ${new Date().getFullYear()} ${shopName()} — মেডিকেল শিক্ষার্থীদের জন্য।</span>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>`;

const isCod = (order: any) => order?.payment?.method === 'cod';
const isPaid = (order: any) => order?.payment?.status === 'paid';

// ── Templates ──────────────────────────────────────────────────────────────

const placedTemplate = (name: string, order: any) => ({
  subject: `অর্ডার পেয়েছি — #${order?.orderNumber} (পেন্ডিং)`,
  html: shell({
    accent: BRAND.amber,
    eyebrow: 'অর্ডার পেন্ডিং',
    heading: 'আপনার অর্ডার পেয়েছি 🧾',
    orderNumber: order?.orderNumber,
    date: bdDate(order?.createdAt),
    body: `
      <p style="margin:0 0 6px;font-size:15px;color:${BRAND.ink};">প্রিয় ${name},</p>
      <p style="margin:0 0 4px;font-size:14px;color:${BRAND.muted};line-height:1.65;">
        ধন্যবাদ! আপনার অর্ডারটি আমরা পেয়েছি এবং এটি এখন <b style="color:${BRAND.amber};">পেন্ডিং</b> অবস্থায় আছে।
        আমরা যাচাই করে শীঘ্রই কনফার্ম করব — কনফার্ম হলে আপনি আরেকটি মেইল পাবেন।
      </p>
      ${summaryTable(order)}
      ${
        isCod(order)
          ? panel(
              'পেমেন্ট',
              `<div style="font-size:14px;color:${BRAND.ink};font-weight:600;">💵 ক্যাশ অন ডেলিভারি</div>
               <div style="font-size:13px;color:${BRAND.muted};margin-top:2px;">বই হাতে পাওয়ার সময় কুরিয়ারকে <b style="color:${BRAND.ink};">${tk(order?.total)}</b> দেবেন। এখন কোনো টাকা লাগবে না।</div>`,
              BRAND.green
            )
          : isPaid(order)
            ? panel(
                'পেমেন্ট',
                `<div style="font-size:14px;color:${BRAND.ink};font-weight:600;">✅ পেমেন্ট সম্পন্ন</div>`,
                BRAND.green
              )
            : ''
      }
      ${addressPanel(order)}
      ${button(`${clientUrl()}/dashboard/user`, 'অর্ডার দেখুন', BRAND.amber)}
    `,
  }),
});

const confirmedTemplate = (name: string, order: any) => ({
  subject: `অর্ডার কনফার্ম হয়েছে — #${order?.orderNumber}`,
  html: shell({
    accent: BRAND.green,
    eyebrow: 'অর্ডার কনফার্মড',
    heading: 'আপনার অর্ডার কনফার্ম হয়েছে ✅',
    orderNumber: order?.orderNumber,
    date: bdDate(order?.confirmedAt || Date.now()),
    body: `
      <p style="margin:0 0 6px;font-size:15px;color:${BRAND.ink};">প্রিয় ${name},</p>
      <p style="margin:0 0 4px;font-size:14px;color:${BRAND.muted};line-height:1.65;">
        সুখবর! আপনার অর্ডারটি কনফার্ম হয়েছে এবং প্রসেসিং শুরু হয়ে গেছে।
        ${
          order?.deliveryType === 'digital'
            ? 'আপনার ডিজিটাল বইয়ের অ্যাক্সেস এখনই খুলে দেওয়া হয়েছে — ড্যাশবোর্ড থেকে পড়তে পারবেন।'
            : 'বই প্যাক করে কুরিয়ারে পাঠানোর ব্যবস্থা করা হচ্ছে।'
        }
      </p>
      ${summaryTable(order)}
      ${
        isPaid(order)
          ? panel(
              'পেমেন্ট',
              `<div style="font-size:14px;color:${BRAND.ink};font-weight:600;">✅ পেমেন্ট সম্পন্ন — ${tk(order?.total)}</div>
               ${
                 order?.payment?.transactionId
                   ? `<div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">ট্রানজেকশন: ${order.payment.transactionId}</div>`
                   : ''
               }`,
              BRAND.green
            )
          : isCod(order)
            ? panel(
                'পেমেন্ট',
                `<div style="font-size:14px;color:${BRAND.ink};font-weight:600;">💵 ক্যাশ অন ডেলিভারি</div>
                 <div style="font-size:13px;color:${BRAND.muted};margin-top:2px;">বই হাতে পাওয়ার সময় কুরিয়ারকে <b style="color:${BRAND.ink};">${tk(order?.total)}</b> দেবেন।</div>`,
                BRAND.green
              )
            : ''
      }
      ${addressPanel(order)}
      ${button(`${clientUrl()}/dashboard/user`, 'অর্ডার ট্র্যাক করুন', BRAND.green)}
    `,
  }),
});

// Books only — a course/enrollment order has its own emails. `deliveryType` is the
// cheapest tell that this is a book order.
const isBookOrder = (order: any) => !!order?.deliveryType;

const sendOrderPlacedEmail = async (order: any): Promise<void> => {
  try {
    if (!isBookOrder(order)) return;
    const { email, name } = await buyerContact(order);
    if (!email) return;
    const t = placedTemplate(name, order);
    await EmailService.sendEmail(email, t.subject, t.html);
  } catch (e: any) {
    console.error('[order-email] placed failed (order unaffected):', e?.message);
  }
};

const sendOrderConfirmedEmail = async (order: any): Promise<void> => {
  try {
    if (!isBookOrder(order)) return;
    const { email, name } = await buyerContact(order);
    if (!email) return;
    const t = confirmedTemplate(name, order);
    await EmailService.sendEmail(email, t.subject, t.html);
  } catch (e: any) {
    console.error('[order-email] confirmed failed (order unaffected):', e?.message);
  }
};

export const OrderEmailService = { sendOrderPlacedEmail, sendOrderConfirmedEmail };
