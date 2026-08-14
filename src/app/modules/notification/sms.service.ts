/**
 * SMS Service — BulkSMSBD Integration
 *
 * Demo mode is DERIVED from configuration, not hard-coded. Set BULKSMS_API_KEY
 * in .env and real SMS starts going out; leave it blank and every send logs to
 * the console instead. Same pattern as payment/bkash.service.ts.
 *
 * It used to be `const DEMO_MODE = true` as a source literal, which meant SMS
 * could not be switched on by deploying configuration — you had to edit and
 * redeploy this file, and anyone reading .env would have concluded, wrongly,
 * that filling in the key was enough.
 */
import config from '../../config';

const API_URL = 'https://bulksmsbd.net/api/smsapi';
const SENDER_ID = config.sms.sender_id;

/** Read per call, not captured at import, so it can be flipped in a test. */
const isDemo = (): boolean => !config.sms.api_key;

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
  if (isDemo()) {
    console.log(`📱 [DEMO SMS — BULKSMS_API_KEY unset] To: ${phoneNumber} | Message: ${message}`);
    return { success: true, demo: true };
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.sms.api_key,
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
  isDemo,
  sendSMS, sendBulkSMS,
  sendWelcomeSMS, sendPaymentSMS, sendClassReminderSMS,
  sendCertificateSMS,
  templates,
};
