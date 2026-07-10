/**
 * Email Service — Gmail SMTP (nodemailer).
 * Set SMTP_USER + SMTP_PASS (Gmail App Password) in .env to send real emails.
 * Without those env vars it stays in DEMO mode (logs to console, never throws).
 */
import nodemailer from 'nodemailer';
import config from '../../config';
import { InvoiceService } from '../invoice/invoice.service';

const FROM = `${config.email.from_name} <${config.email.from_email}>`;
const isConfigured = () => !!(config.email.smtp_user && config.email.smtp_pass);

let _transporter: nodemailer.Transporter | null = null;
const getTransporter = () => {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.email.smtp_user, pass: config.email.smtp_pass },
    });
  }
  return _transporter;
};

// ─── Email Templates ────────────────────────────────────────

const templates = {
  welcome: (name: string) => ({
    subject: 'Welcome to Aptech Learning! 🎉',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#41bfb8,#38a89d);padding:30px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;">🎓 Aptech Learning</h1>
        </div>
        <div style="background:#fff;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
          <h2 style="color:#1e293b;">Welcome, ${name}!</h2>
          <p style="color:#64748b;">You have successfully registered. Start exploring courses and begin your learning journey.</p>
          <a href="http://localhost:3000/courses" style="display:inline-block;padding:12px 24px;background:#41bfb8;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Browse Courses</a>
        </div>
      </div>
    `,
  }),

  paymentConfirmation: (name: string, courseName: string, amount: number, transactionId: string) => ({
    subject: `Payment Confirmed — ${courseName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#41bfb8,#38a89d);padding:30px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;">💳 Payment Confirmed</h1>
        </div>
        <div style="background:#fff;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
          <h2 style="color:#1e293b;">Hi ${name},</h2>
          <p style="color:#64748b;">Your payment has been confirmed.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;">Course</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">${courseName}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b;">Amount</td><td style="padding:8px;border-bottom:1px solid #e2e8f0;font-weight:bold;">৳${amount}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Transaction ID</td><td style="padding:8px;font-weight:bold;">${transactionId}</td></tr>
          </table>
          <a href="http://localhost:3000/dashboard/user/courses" style="display:inline-block;padding:12px 24px;background:#41bfb8;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Start Learning</a>
        </div>
      </div>
    `,
  }),

  classReminder: (name: string, className: string, time: string, meetingLink?: string) => ({
    subject: `Class Reminder — ${className}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:30px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;">📅 Class Reminder</h1>
        </div>
        <div style="background:#fff;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
          <h2 style="color:#1e293b;">Hi ${name},</h2>
          <p style="color:#64748b;">Your class <strong>${className}</strong> starts at <strong>${time}</strong>.</p>
          ${meetingLink ? `<a href="${meetingLink}" style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">Join Class</a>` : ''}
        </div>
      </div>
    `,
  }),

  certificateReady: (name: string, courseName: string, certId: string) => ({
    subject: `Your Certificate is Ready — ${courseName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#10b981,#059669);padding:30px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;">🎓 Certificate Ready!</h1>
        </div>
        <div style="background:#fff;padding:30px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
          <h2 style="color:#1e293b;">Congratulations, ${name}!</h2>
          <p style="color:#64748b;">Your certificate for <strong>${courseName}</strong> is ready.</p>
          <p style="color:#64748b;">Certificate ID: <strong>${certId}</strong></p>
          <a href="http://localhost:3000/dashboard/user/certificates" style="display:inline-block;padding:12px 24px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">View Certificate</a>
        </div>
      </div>
    `,
  }),

};

// ─── Send Email ─────────────────────────────────────────────

const sendEmail = async (to: string, subject: string, html: string, attachments?: any[]) => {
  if (!to) return { success: false, error: 'no recipient' };
  if (!isConfigured()) {
    console.log(`📧 [DEMO EMAIL] To: ${to} | Subject: ${subject}${attachments?.length ? ` | +${attachments.length} attachment(s)` : ''}`);
    return { success: true, demo: true };
  }
  try {
    await getTransporter().sendMail({ from: FROM, to, subject, html, attachments });
    return { success: true };
  } catch (err: any) {
    console.error('Email send error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── High-level Email Functions ─────────────────────────────

const sendWelcome = async (email: string, name: string) => {
  const t = templates.welcome(name);
  return sendEmail(email, t.subject, t.html);
};

const sendPaymentConfirmation = async (email: string, name: string, courseName: string, amount: number, txnId: string) => {
  const t = templates.paymentConfirmation(name, courseName, amount, txnId);
  return sendEmail(email, t.subject, t.html);
};

const sendClassReminder = async (email: string, name: string, className: string, time: string, meetingLink?: string) => {
  const t = templates.classReminder(name, className, time, meetingLink);
  return sendEmail(email, t.subject, t.html);
};

const sendCertificateReady = async (email: string, name: string, courseName: string, certId: string) => {
  const t = templates.certificateReady(name, courseName, certId);
  return sendEmail(email, t.subject, t.html);
};

// ─── Money Receipt (admission / installment / full / mock) ───
const money = (n: number) => `৳${Number(n || 0).toLocaleString('en-IN')}`;
const RECEIPT_META: Record<string, { badge: string; color: string; line: string }> = {
  admission: { badge: '🎓 Admission Receipt', color: '#F3A522', line: 'আপনার ভর্তির পেমেন্ট গৃহীত হয়েছে।' },
  installment: { badge: '💳 Installment Receipt', color: '#0ea5e9', line: 'আপনার কিস্তির পেমেন্ট গৃহীত হয়েছে।' },
  full: { badge: '✅ Full Payment Receipt', color: '#10b981', line: 'আপনার সম্পূর্ণ পেমেন্ট সম্পন্ন হয়েছে। ধন্যবাদ!' },
  mock: { badge: '📝 Mock Test Receipt', color: '#8B5CF6', line: 'আপনার IELTS Mock Test ক্রয় সম্পন্ন হয়েছে।' },
};

interface ReceiptData {
  to: string; name: string;
  receiptType?: 'admission' | 'installment' | 'full' | 'mock';
  itemName: string;          // course / package title
  amount: number;            // amount paid in THIS transaction
  method?: string;
  transactionId?: string;
  invoiceNumber?: string;
  date?: string;
  batchName?: string;
  studentPhone?: string;
  totalFee?: number;         // agreed total (for course installments)
  totalPaid?: number;        // paid so far (incl. this)
  dueAmount?: number;        // remaining
  installmentNumber?: number;
}

const sendReceipt = async (data: ReceiptData) => {
  const type = data.receiptType || 'admission';
  const meta = RECEIPT_META[type] || RECEIPT_META.admission;
  const inv = data.invoiceNumber || `RCPT-${Date.now()}`;
  const date = data.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const row = (label: string, val: string, strong = false) =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eef2f7;color:#64748b;">${label}</td><td style="padding:8px;border-bottom:1px solid #eef2f7;text-align:right;${strong ? 'font-weight:800;color:#0f172a;' : 'font-weight:600;'}">${val}</td></tr>`;

  let rows = row('Item', data.itemName);
  if (type === 'installment' && data.installmentNumber) rows += row('Installment', `#${data.installmentNumber}`);
  rows += row(type === 'installment' ? 'Paid now' : 'Amount', money(data.amount), true);
  if (data.method) rows += row('Method', String(data.method).toUpperCase());
  if (data.transactionId) rows += row('Transaction ID', data.transactionId);
  // due breakdown for course installments / partial
  if (type === 'installment' || (typeof data.dueAmount === 'number' && data.dueAmount > 0)) {
    if (typeof data.totalFee === 'number') rows += row('Total Fee', money(data.totalFee));
    if (typeof data.totalPaid === 'number') rows += row('Total Paid', money(data.totalPaid));
    if (typeof data.dueAmount === 'number') rows += row('Remaining Due', money(data.dueAmount), true);
  }

  const subject = `${meta.badge.replace(/^[^ ]+ /, '')} — ${data.itemName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:${meta.color};padding:26px;border-radius:12px 12px 0 0;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:20px;">${meta.badge}</h1>
        <p style="color:#fff;opacity:.9;margin:6px 0 0;font-size:12px;">${config.email.from_name}</p>
      </div>
      <div style="background:#fff;padding:26px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;">
        <p style="color:#1e293b;margin:0 0 4px;">Hi ${data.name},</p>
        <p style="color:#64748b;margin:0 0 16px;">${meta.line}</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;">${rows}</table>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">
          <span>Receipt: ${inv}</span><span>${date}</span>
        </div>
        <p style="color:#94a3b8;font-size:11px;margin:16px 0 0;">এই receipt-টি PDF আকারে সংযুক্ত করা হলো। কোনো প্রশ্ন থাকলে যোগাযোগ করুন।</p>
      </div>
    </div>`;

  // Attach a PDF receipt (best-effort — email still sends if PDF generation fails)
  let attachments: any[] = [];
  try {
    const pdf = await InvoiceService.generateInvoicePDF({
      invoiceNumber: inv, date, studentName: data.name, studentEmail: data.to, studentPhone: data.studentPhone,
      courseName: data.itemName, batchName: data.batchName, amount: data.amount,
      paymentMethod: data.method || 'manual', transactionId: data.transactionId, status: 'Paid',
      receiptType: type, totalFee: data.totalFee, totalPaid: data.totalPaid, dueAmount: data.dueAmount,
      installmentNumber: data.installmentNumber,
    } as any);
    attachments = [{ filename: `receipt-${inv}.pdf`, content: pdf }];
  } catch (e: any) {
    console.error('Receipt PDF generation failed (email still sent):', e?.message);
  }

  return sendEmail(data.to, subject, html, attachments);
};

export const EmailService = {
  sendEmail, sendWelcome, sendPaymentConfirmation,
  sendClassReminder, sendCertificateReady, sendReceipt,
  isConfigured, templates,
};
