/**
 * WhatsApp — Meta Cloud API (graph.facebook.com). Outbound only.
 *
 * THE TEMPLATE RULE, up front, because it shapes everything below:
 *   A business may only send FREE-TEXT WhatsApp messages inside a 24-hour
 *   customer service window, which opens when that person messages the business
 *   first. A buyer placing an order on the website has not messaged us, so the
 *   window is shut and free text is rejected (error 131047). The only thing we
 *   may send is a message TEMPLATE that Meta reviewed and approved in advance,
 *   with the variable parts passed as parameters.
 *
 * So the buyer's order confirmation is NOT arbitrary text — it is a fixed
 * approved sentence with seven blanks filled in. See orderAlert.message.ts's
 * buildWhatsAppParams for the blanks, and .env.example for the exact body text
 * to register at
 *   business.facebook.com → WhatsApp Manager → Message templates.
 *
 * Nothing here throws. Every function resolves with a result object.
 */
import config from '../../config';

export interface WhatsAppSendResult {
  ok: boolean;
  /** True when we deliberately did nothing (credentials or recipient missing). */
  skipped?: boolean;
  reason?: string;
  status?: number;
  to?: string;
  messageId?: string;
}

const TIMEOUT_MS = 10_000;

const timeoutSignal = (): AbortSignal | undefined => {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(TIMEOUT_MS)
      : undefined;
  } catch {
    return undefined;
  }
};

const isConfigured = (): boolean =>
  !!(config.alerts.whatsapp.phone_number_id && config.alerts.whatsapp.access_token);

/**
 * Bangladeshi phone → E.164 digits, the form the Cloud API expects (no '+').
 *
 *   01712345678    → 8801712345678
 *   +8801712345678 → 8801712345678
 *   8801712345678  → 8801712345678
 *   1712345678     → 8801712345678
 *   017-1234 5678  → 8801712345678
 *
 * Returns '' for anything too short to be a real number, which the caller treats
 * as "skip" rather than firing a doomed request.
 */
const normalizePhone = (raw?: string | null): string => {
  const cc = String(config.alerts.whatsapp.default_country_code || '880');
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';

  // 00-prefixed international dialling → drop the 00.
  if (d.startsWith('00')) d = d.slice(2);

  if (d.startsWith(cc)) {
    // Already international. Guard the ambiguous BD case: 880 + a local number
    // that itself still carries its leading 0 (8801712345678 is right at 13
    // digits; 88001712345678 at 14 is the double-prefixed mistake).
    const rest = d.slice(cc.length);
    if (rest.startsWith('0')) d = cc + rest.replace(/^0+/, '');
  } else if (d.startsWith('0')) {
    d = cc + d.replace(/^0+/, '');
  } else if (cc === '880' && d.length === 10 && d.startsWith('1')) {
    // Bare local mobile without the leading zero.
    d = cc + d;
  }

  // A BD mobile is 880 + 10 digits = 13. Anything under 10 total is not a phone
  // number at all; let other country codes through on length alone.
  return d.length >= 10 ? d : '';
};

/**
 * Send an approved template message. Resolves — never rejects.
 *
 * @param to          recipient phone, any local or international format
 * @param templateName name as registered in WhatsApp Manager
 * @param params      body parameters, in {{1}}..{{n}} order
 */
const sendTemplate = async (
  to: string,
  templateName: string,
  params: string[],
  languageCode?: string
): Promise<WhatsAppSendResult> => {
  const { phone_number_id, access_token, api_version, template_lang } = config.alerts.whatsapp;

  if (!phone_number_id || !access_token) {
    console.warn(
      '[whatsapp] WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN not set — skipping send.'
    );
    return { ok: false, skipped: true, reason: 'not-configured', to };
  }
  if (!templateName) {
    console.warn('[whatsapp] no template name configured — skipping send.');
    return { ok: false, skipped: true, reason: 'no-template', to };
  }

  const msisdn = normalizePhone(to);
  if (!msisdn) {
    console.warn(`[whatsapp] unusable recipient number "${to}" — skipping send.`);
    return { ok: false, skipped: true, reason: 'bad-phone', to };
  }

  const url = `https://graph.facebook.com/${api_version}/${phone_number_id}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: msisdn,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || template_lang || 'bn' },
      components: [
        {
          type: 'body',
          parameters: params.map((text) => ({ type: 'text', text })),
        },
      ],
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      // Meta's error body names the actual problem — template not found, param
      // count mismatch, number not on WhatsApp, expired token. Log it; the
      // status alone is useless for fixing any of those.
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        /* unreadable body — status still tells us something */
      }
      console.error(
        `[whatsapp] send failed (HTTP ${res.status}) to=${msisdn} template=${templateName}: ${detail}`
      );
      return { ok: false, status: res.status, reason: detail || `http-${res.status}`, to: msisdn };
    }

    let messageId: string | undefined;
    try {
      const data = (await res.json()) as { messages?: { id?: string }[] };
      messageId = data?.messages?.[0]?.id;
    } catch {
      /* a 200 with an unparseable body still means it was accepted */
    }
    return { ok: true, status: res.status, to: msisdn, messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] send threw for to=${msisdn}: ${msg}`);
    return { ok: false, reason: msg, to: msisdn };
  }
};

/**
 * Free-text message. ONLY valid inside the 24-hour customer service window —
 * i.e. as a reply to someone who just messaged the business. Useless for order
 * confirmations; kept because a future "reply to a customer enquiry" feature
 * needs exactly this and would otherwise reimplement it wrongly.
 */
const sendText = async (to: string, text: string): Promise<WhatsAppSendResult> => {
  const { phone_number_id, access_token, api_version } = config.alerts.whatsapp;

  if (!phone_number_id || !access_token) {
    console.warn('[whatsapp] not configured — skipping text send.');
    return { ok: false, skipped: true, reason: 'not-configured', to };
  }

  const msisdn = normalizePhone(to);
  if (!msisdn) {
    console.warn(`[whatsapp] unusable recipient number "${to}" — skipping text send.`);
    return { ok: false, skipped: true, reason: 'bad-phone', to };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${api_version}/${phone_number_id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: msisdn,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        /* unreadable body */
      }
      console.error(`[whatsapp] text send failed (HTTP ${res.status}) to=${msisdn}: ${detail}`);
      return { ok: false, status: res.status, reason: detail || `http-${res.status}`, to: msisdn };
    }
    return { ok: true, status: res.status, to: msisdn };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] text send threw for to=${msisdn}: ${msg}`);
    return { ok: false, reason: msg, to: msisdn };
  }
};

export const WhatsAppService = {
  isConfigured,
  normalizePhone,
  sendTemplate,
  sendText,
};
