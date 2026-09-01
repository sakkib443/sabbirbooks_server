/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The single text an affiliate gets: "you are approved, here is your code."
 *
 * Deliberately the only one. An affiliate is not a mailing list — no text when
 * a sale lands, none when they are suspended, none when an admin edits their
 * batch. The shop said one message, and the reasoning holds up: everything else
 * they might want is on the dashboard this text tells them how to reach, and a
 * per-sale text would be the shop paying to interrupt somebody several times a
 * week with a number they can already see.
 *
 * Suspension in particular is silent on purpose. It is a decision the shop
 * makes about a person, and it belongs in a conversation, not in a two-line
 * automated text with no way to reply.
 *
 * Always resolves. Approving somebody must never fail because a gateway did.
 */
import config from '../../config';
import { SmsService } from './sms.service';
import { SmsMessage } from './sms.message';
import { AMBASSADOR_DISCOUNT_TK, AMBASSADOR_PAYOUT_TK } from '../ambassador/ambassador.model';

/**
 * The site as it should appear in a text — no scheme, no trailing slash.
 *
 * "https://magicviva.com/" costs eight characters that say nothing; a phone
 * turns "magicviva.com" into a link on its own.
 */
const siteForSms = (): string =>
  String(config.client_url || 'magicviva.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

const sendApproved = async (app: any): Promise<boolean> => {
  try {
    const phone = String(app?.phone || app?.whatsapp || '');
    if (!phone) {
      console.warn(`[affiliate-sms] no phone on ${app?.applicationId} — skipped.`);
      return false;
    }
    if (!app?.couponCode) {
      // Approval mints the code before this is called, so an empty one means
      // something went wrong upstream — worth saying rather than texting a
      // message with a hole where the code should be.
      console.warn(`[affiliate-sms] ${app?.applicationId} has no coupon code — skipped.`);
      return false;
    }

    SmsService.logConfigOnce();
    const r = await SmsService.send(
      phone,
      SmsMessage.affiliateApproved({
        shopName: config.alerts.shop_name,
        couponCode: app.couponCode,
        // From the programme's constants, not from the coupon row: what the
        // text promises and what checkout actually does come from one place.
        discountTk: AMBASSADOR_DISCOUNT_TK,
        payoutTk: AMBASSADOR_PAYOUT_TK,
        siteUrl: siteForSms(),
      })
    );
    console.log(
      `[affiliate-sms] approved → ${app.applicationId}: ${r.success ? (r.demo ? 'demo' : 'sent') : 'FAILED'}` +
        (r.error ? ` (${r.error})` : '')
    );
    return r.success;
  } catch (e) {
    console.error('[affiliate-sms] threw (approval unaffected):', e);
    return false;
  }
};

export const AffiliateSmsService = { sendApproved, siteForSms };
