/**
 * SMS Service — BulkSMSBD Integration
 *
 * Currently in DEMO mode (logs to console).
 * To enable real SMS:
 * 1. Set BULKSMS_API_KEY in .env
 * 2. Set BULKSMS_SENDER_ID in .env
 * 3. Change DEMO_MODE to false
 */

const DEMO_MODE = true;
const API_URL = 'https://bulksmsbd.net/api/smsapi';
const API_KEY = process.env.BULKSMS_API_KEY || '';
const SENDER_ID = process.env.BULKSMS_SENDER_ID || 'AptechLearn';

// ─── SMS Templates ──────────────────────────────────────────

const templates = {
  welcome: (name: string) =>
    `Welcome to Aptech Learning, ${name}! Start your learning journey today. Visit: aptechlearning.com`,

  paymentConfirmed: (name: string, courseName: string, amount: number) =>
    `Hi ${name}, your payment of ৳${amount} for "${courseName}" is confirmed. Happy learning! - Aptech Learning`,

  classReminder: (name: string, className: string, time: string) =>
    `Hi ${name}, your class "${className}" starts at ${time}. Don't miss it! - Aptech Learning`,

  certificateReady: (name: string, courseName: string) =>
    `Congratulations ${name}! Your certificate for "${courseName}" is ready. Check your dashboard. - Aptech Learning`,

  examReminder: (name: string, examTitle: string, date: string) =>
    `Hi ${name}, your exam "${examTitle}" is scheduled on ${date}. Prepare well! - Aptech Learning`,

  otp: (otp: string) =>
    `Your Aptech Learning verification code is: ${otp}. Valid for 5 minutes. Do not share.`,
};

// ─── Send SMS ───────────────────────────────────────────────

const sendSMS = async (phoneNumber: string, message: string) => {
  if (DEMO_MODE) {
    console.log(`📱 [DEMO SMS] To: ${phoneNumber} | Message: ${message}`);
    return { success: true, demo: true };
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: API_KEY,
        senderid: SENDER_ID,
        number: phoneNumber,
        message,
        type: 'text',
      }),
    });
    const data = await response.json();
    return { success: data.response_code === 202, data };
  } catch (err: any) {
    console.error('SMS error:', err.message);
    return { success: false, error: err.message };
  }
};

// ─── High-level SMS Functions ───────────────────────────────

const sendBulkSMS = async (phoneNumbers: string[], message: string) => {
  const results = await Promise.allSettled(
    phoneNumbers.map(phone => sendSMS(phone, message))
  );
  return results;
};

const sendWelcomeSMS = (phone: string, name: string) => sendSMS(phone, templates.welcome(name));
const sendPaymentSMS = (phone: string, name: string, course: string, amount: number) => sendSMS(phone, templates.paymentConfirmed(name, course, amount));
const sendClassReminderSMS = (phone: string, name: string, className: string, time: string) => sendSMS(phone, templates.classReminder(name, className, time));
const sendCertificateSMS = (phone: string, name: string, course: string) => sendSMS(phone, templates.certificateReady(name, course));

export const SmsService = {
  sendSMS, sendBulkSMS,
  sendWelcomeSMS, sendPaymentSMS, sendClassReminderSMS,
  sendCertificateSMS,
  templates,
};
