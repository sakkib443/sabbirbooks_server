/**
 * The two emails a password change sends.
 *
 *   resetLink  "forgot password" — the only way a reset starts. The link is the
 *              proof that whoever asked can read this inbox, which is the whole
 *              verification: no inbox, no new password.
 *   changed    after any change that the owner did not type in themselves —
 *              a reset link used, or an admin setting one. It is the owner's one
 *              chance to notice a change they did not make.
 *
 * Both go through EmailService.sendEmail, so without SMTP credentials they land
 * in the console instead of an inbox, like every other email on the site.
 */
import config from '../../config';
import { EmailService } from './email.service';

const BRAND = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e6eaf0',
  soft: '#f6f8fb',
  primary: '#0d9488',
  amber: '#f59e0b',
};

const shopName = () => config.email.from_name || 'Magic Viva';
const clientUrl = () => (config.client_url || 'https://magicviva.com').replace(/\/+$/, '');
const supportPhone = () => config.alerts?.whatsapp?.admin_to || '';

/** A name typed at signup goes into HTML here; it must not become HTML. */
const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const nameOf = (user: any) =>
  esc([user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || 'শিক্ষার্থী');

const shell = (opts: { accent: string; eyebrow: string; heading: string; body: string }) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;margin:0;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08);font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;">
      <tr><td style="height:5px;background:${opts.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:26px 32px 0;">
        <div style="font-size:17px;font-weight:800;color:${BRAND.ink};letter-spacing:-.01em;">${esc(shopName())}</div>
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${opts.accent};margin-top:14px;">${opts.eyebrow}</div>
        <div style="font-size:23px;font-weight:800;color:${BRAND.ink};line-height:1.3;margin-top:4px;">${opts.heading}</div>
      </td></tr>
      <tr><td style="padding:18px 32px 30px;font-size:15px;line-height:1.7;color:${BRAND.ink};">${opts.body}</td></tr>
      <tr><td style="padding:20px 32px 26px;border-top:1px solid ${BRAND.line};background:${BRAND.soft};">
        <div style="font-size:12px;color:${BRAND.muted};line-height:1.7;">
          কোনো প্রশ্ন থাকলে এই মেইলের উত্তর দিন${
            supportPhone()
              ? ` অথবা কল করুন <span style="color:${BRAND.ink};font-weight:600;">${esc(supportPhone())}</span>`
              : ''
          }।<br>
          <span style="color:#94a3b8;">© ${new Date().getFullYear()} ${esc(shopName())}</span>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>`;

const button = (href: string, label: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
  <tr><td style="border-radius:10px;background:${BRAND.primary};">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
  </td></tr>
</table>`;

/** The page the emailed link opens — see sabbirbooks/src/app/reset-password. */
const resetUrl = (email: string, token: string) =>
  `${clientUrl()}/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;

const sendResetLink = async (user: any, token: string, minutes: number) => {
  const email = String(user?.email || '');
  if (!email) return { success: false, error: 'no email' };
  const href = resetUrl(email, token);
  const html = shell({
    accent: BRAND.primary,
    eyebrow: 'পাসওয়ার্ড রিসেট',
    heading: 'নতুন পাসওয়ার্ড সেট করুন',
    body: `
      <p style="margin:0 0 10px;">আসসালামু আলাইকুম ${nameOf(user)},</p>
      <p style="margin:0;">আপনার অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ পেয়েছি। নিচের বাটনে চাপ দিয়ে নতুন পাসওয়ার্ড দিন।</p>
      ${button(href, 'পাসওয়ার্ড রিসেট করুন')}
      <p style="margin:0 0 10px;font-size:13px;color:${BRAND.muted};">
        লিংকটি <b>${minutes} মিনিট</b> কাজ করবে, আর একবারই ব্যবহার করা যাবে।
        বাটন কাজ না করলে এই ঠিকানাটি ব্রাউজারে কপি করুন:<br>
        <span style="word-break:break-all;color:${BRAND.ink};">${esc(href)}</span>
      </p>
      <p style="margin:14px 0 0;font-size:13px;color:${BRAND.muted};">
        আপনি অনুরোধ না করে থাকলে এই মেইলটি উপেক্ষা করুন — আপনার পাসওয়ার্ড যেমন ছিল তেমনই থাকবে।
      </p>`,
  });
  return EmailService.sendEmail(email, `পাসওয়ার্ড রিসেট — ${shopName()}`, html);
};

const sendChanged = async (user: any, by: 'reset' | 'admin') => {
  const email = String(user?.email || '');
  if (!email) return { success: false, error: 'no email' };
  const how =
    by === 'admin'
      ? 'আমাদের অ্যাডমিন আপনার অ্যাকাউন্টের পাসওয়ার্ড বদলে দিয়েছেন। নতুন পাসওয়ার্ডটি তাঁদের কাছ থেকে জেনে নিন, আর লগইন করার পর নিজের একটি পাসওয়ার্ড দিয়ে দিন।'
      : 'রিসেট লিংক ব্যবহার করে আপনার অ্যাকাউন্টের পাসওয়ার্ড বদলানো হয়েছে।';
  const html = shell({
    accent: BRAND.amber,
    eyebrow: 'নিরাপত্তা',
    heading: 'আপনার পাসওয়ার্ড বদলানো হয়েছে',
    body: `
      <p style="margin:0 0 10px;">আসসালামু আলাইকুম ${nameOf(user)},</p>
      <p style="margin:0 0 10px;">${how}</p>
      <p style="margin:0 0 10px;">নিরাপত্তার জন্য আপনার সব ডিভাইস থেকে লগআউট করে দেওয়া হয়েছে — নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন।</p>
      <p style="margin:0;font-size:13px;color:${BRAND.muted};">
        এটা আপনি না করে থাকলে এখনই এই মেইলের উত্তর দিন বা আমাদের ফোন করুন।
      </p>
      ${button(`${clientUrl()}/login`, 'লগইন করুন')}`,
  });
  return EmailService.sendEmail(email, `পাসওয়ার্ড বদলানো হয়েছে — ${shopName()}`, html);
};

export const PasswordEmailService = { sendResetLink, sendChanged, resetUrl };
