/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Book-order emails to the BUYER — two moments:
 *
 *   placed    → sent the instant the order is created (status pending). "We have
 *               your order, it's pending, we'll confirm shortly."
 *   confirmed → sent the first time the order is confirmed (COD admin confirm, or
 *               a gateway/manual payment settling). "Your order is confirmed."
 *
 * Same rule as the order alerts: an email failure must NEVER fail the order. Every
 * function catches everything and resolves; call them WITHOUT awaiting.
 *
 * Email delivery itself is gated on SMTP_USER + SMTP_PASS (a Gmail App Password);
 * without them EmailService stays in demo mode and just logs. So these are safe to
 * wire in now and light up the moment the credentials are set.
 */
import config from '../../config';
import { EmailService } from './email.service';
import { User } from '../user/user.model';

const brand = () => config.email.from_name || 'Magic Viva';
const clientUrl = () => (config.client_url || 'https://magicviva.com').replace(/\/+$/, '');
const tk = (n: any) => '৳' + Number(n || 0).toLocaleString('en-US');

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

const row = (label: string, val: string, strong = false) =>
  `<tr><td style="padding:7px 8px;border-bottom:1px solid #eef2f7;color:#64748b;">${label}</td>` +
  `<td style="padding:7px 8px;border-bottom:1px solid #eef2f7;text-align:right;${
    strong ? 'font-weight:800;color:#0f172a;' : 'font-weight:600;color:#0f172a;'
  }">${val}</td></tr>`;

const itemRows = (order: any): string =>
  (order?.items || [])
    .map((it: any) =>
      row(`${it?.title || 'বই'} × ${Number(it?.quantity) || 1}`, tk((Number(it?.price) || 0) * (Number(it?.quantity) || 1)))
    )
    .join('');

const summaryTable = (order: any): string => {
  const discount = Number(order?.discount) || 0;
  const delivery = Number(order?.deliveryCharge) || 0;
  let rows = itemRows(order);
  rows += row('সাবটোটাল', tk(order?.subtotal));
  if (discount > 0) rows += row('ছাড়', '−' + tk(discount));
  rows += row('ডেলিভারি চার্জ', delivery > 0 ? tk(delivery) : 'ফ্রি');
  rows += row('সর্বমোট', tk(order?.total), true);
  return `<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:14px;">${rows}</table>`;
};

const shippingBlock = (order: any): string => {
  const a = order?.shippingAddress;
  if (!a) return '';
  const parts = [a.address, a.upazila || a.city, a.district, a.division].filter(Boolean).join(', ');
  return (
    `<p style="color:#64748b;font-size:13px;margin:0 0 4px;"><b style="color:#0f172a;">ডেলিভারি ঠিকানা:</b> ${a.name || ''}</p>` +
    `<p style="color:#64748b;font-size:13px;margin:0 0 2px;">${parts}</p>` +
    (a.phone ? `<p style="color:#64748b;font-size:13px;margin:0;">ফোন: ${a.phone}</p>` : '')
  );
};

const shell = (headerColor: string, badge: string, bodyHtml: string): string => `
  <div style="font-family:Arial,'Hind Siliguri',sans-serif;max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:${headerColor};padding:26px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:20px;">${badge}</h1>
      <p style="color:#fff;opacity:.9;margin:6px 0 0;font-size:12px;">${brand()}</p>
    </div>
    <div style="background:#fff;padding:26px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">
      ${bodyHtml}
    </div>
  </div>`;

const isCod = (order: any) => order?.payment?.method === 'cod';

const placedTemplate = (name: string, order: any) => ({
  subject: `আপনার অর্ডার পেয়েছি — অর্ডার #${order?.orderNumber} (পেন্ডিং)`,
  html: shell(
    '#F3A522',
    '🧾 অর্ডার পেয়েছি',
    `<p style="color:#1e293b;margin:0 0 4px;">প্রিয় ${name},</p>
     <p style="color:#64748b;margin:0 0 12px;">ধন্যবাদ! আপনার অর্ডার <b>#${order?.orderNumber}</b> আমরা পেয়েছি। এটি এখন <b>পেন্ডিং</b> অবস্থায় আছে — আমরা শীঘ্রই কনফার্ম করে আপনাকে জানাব।</p>
     ${summaryTable(order)}
     ${
       isCod(order)
         ? `<p style="color:#0f766e;background:#ecfdf5;border-radius:8px;padding:10px 12px;font-size:13px;margin:0 0 12px;">💵 ক্যাশ অন ডেলিভারি — বই হাতে পাওয়ার সময় কুরিয়ারকে টাকা দেবেন।</p>`
         : ''
     }
     ${shippingBlock(order)}
     <a href="${clientUrl()}/dashboard/user" style="display:inline-block;margin-top:16px;padding:11px 22px;background:#F3A522;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">অর্ডার দেখুন</a>`
  ),
});

const confirmedTemplate = (name: string, order: any) => ({
  subject: `আপনার অর্ডার কনফার্ম হয়েছে — অর্ডার #${order?.orderNumber}`,
  html: shell(
    '#10b981',
    '✅ অর্ডার কনফার্ম হয়েছে',
    `<p style="color:#1e293b;margin:0 0 4px;">প্রিয় ${name},</p>
     <p style="color:#64748b;margin:0 0 12px;">সুখবর! আপনার অর্ডার <b>#${order?.orderNumber}</b> কনফার্ম হয়েছে এবং প্রসেসিং শুরু হয়েছে। বই পাঠানোর ব্যবস্থা করা হচ্ছে।</p>
     ${summaryTable(order)}
     ${shippingBlock(order)}
     <a href="${clientUrl()}/dashboard/user" style="display:inline-block;margin-top:16px;padding:11px 22px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">অর্ডার ট্র্যাক করুন</a>`
  ),
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
