/**
 * SMS — MiMSMS gateway (sms.mimsms.com).
 *
 * Demo mode is DERIVED from configuration, never hard-coded: with SMS_API_KEY
 * unset every send logs to the console and reports success, and the moment the
 * key is set in Coolify real messages start going out. No redeploy, no source
 * edit — which is what "switch SMS on" should mean.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: sending a text must never break the
 * thing that triggered it. The order is already paid for and the row is already
 * written; an order that 500s because the gateway had a bad minute is far worse
 * than a text nobody got. Every function here resolves, none of them throw.
 *
 * Two failure modes are expected in production rather than exceptional, and
 * both are logged plainly instead of thrown:
 *   - the API key exists but was never activated in the panel's Developer menu
 *   - the server's IP is not on the panel's whitelist (Coolify redeploys can
 *     move it), which MiMSMS answers with a rejection, not a network error
 */
import config from '../../config';

export interface SmsResult {
  success: boolean;
  demo?: boolean;
  /** MiMSMS's own id for the message, for chasing delivery in the panel. */
  trxnId?: string;
  error?: string;
}

/** Read per call, not captured at import, so it can be flipped in a test. */
const isDemo = (): boolean => !config.sms.api_key || !config.sms.username;

/**
 * A Bangladeshi mobile number as the gateway wants it: 8801XXXXXXXXX.
 *
 * Buyers type their number every way there is — 01712345678, +8801712345678,
 * 0171-234-5678, with spaces. All of those are the same person, and a text that
 * silently goes nowhere because of a dash is the worst kind of bug: nothing
 * fails, the shop just quietly stops reaching people.
 *
 * Returns '' for anything that is not a Bangladeshi mobile number, which the
 * caller treats as "no phone" rather than sending garbage to the gateway.
 */
const normalizePhone = (raw: string): string => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';

  // 8801XXXXXXXXX — already right.
  if (/^8801[3-9]\d{8}$/.test(digits)) return digits;
  // 01XXXXXXXXX — the way it is written locally.
  if (/^01[3-9]\d{8}$/.test(digits)) return `88${digits}`;
  // 1XXXXXXXXX — the leading zero dropped, as happens in spreadsheets.
  if (/^1[3-9]\d{8}$/.test(digits)) return `880${digits}`;
  // 008801XXXXXXXXX — the international prefix typed out.
  if (/^008801[3-9]\d{8}$/.test(digits)) return digits.slice(2);

  return '';
};

/**
 * Send one message. Always resolves.
 *
 * Call it without awaiting when the caller is a request handler:
 *   void SmsService.send(phone, text);
 */
const send = async (phone: string, message: string): Promise<SmsResult> => {
  const to = normalizePhone(phone);
  if (!to) {
    console.warn(`[sms] not a Bangladeshi mobile number, skipped: ${JSON.stringify(phone)}`);
    return { success: false, error: 'invalid phone' };
  }
  if (!message.trim()) return { success: false, error: 'empty message' };

  if (isDemo()) {
    console.log(`📱 [DEMO SMS — SMS_API_KEY unset] To: ${to}\n${message}`);
    return { success: true, demo: true };
  }

  try {
    const res = await fetch(config.sms.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        UserName: config.sms.username,
        Apikey: config.sms.api_key,
        MobileNumber: to,
        CampaignId: 'null',
        SenderName: config.sms.sender_id,
        TransactionType: config.sms.transaction_type,
        Message: message,
      }),
    });

    // The gateway answers 200 with a failure body as readily as it answers an
    // HTTP error, so the body is what decides — not res.ok.
    const body: any = await res.json().catch(() => ({}));
    const ok = String(body?.statusCode) === '200' || String(body?.status).toLowerCase() === 'success';

    if (!ok) {
      console.error(
        `[sms] gateway refused (${res.status}) → ${to}:`,
        body?.responseResult || body?.status || JSON.stringify(body)
      );
      return { success: false, error: body?.responseResult || `HTTP ${res.status}` };
    }

    return { success: true, trxnId: body?.trxnId };
  } catch (err: any) {
    console.error(`[sms] send failed → ${to}:`, err?.message || err);
    return { success: false, error: err?.message || 'send failed' };
  }
};

/**
 * Log what SMS can and cannot do, once per process.
 *
 * "Why did nobody get a text?" should be answerable from the boot log rather
 * than by reading this file.
 */
let configLogged = false;
const logConfigOnce = (): void => {
  if (configLogged) return;
  configLogged = true;
  if (isDemo()) {
    console.log('[sms] DEMO — SMS_USERNAME / SMS_API_KEY unset; messages are logged, not sent.');
  } else {
    console.log(
      `[sms] live — sender "${config.sms.sender_id || '(unset!)'}", type ${config.sms.transaction_type}. ` +
        "If nothing arrives, check the key is activated and this server's IP is whitelisted in the panel."
    );
  }
};

export const SmsService = { isDemo, normalizePhone, send, logConfigOnce };
