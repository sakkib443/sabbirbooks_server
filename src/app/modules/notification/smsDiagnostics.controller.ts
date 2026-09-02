/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Why is no SMS arriving?" — answerable from a browser, by an admin.
 *
 * There is a script that answers this on the command line, but the person who
 * needs the answer is usually the shop owner, not somebody with a terminal on
 * the production box. When texts stop, the useful facts are all on the server:
 * which settings it actually read, what the gateway said last time, and what it
 * says right now. This puts those behind two admin-only endpoints.
 *
 * It never returns the API key. It returns whether one is set and how long it
 * is, which is enough to catch the common mistakes — an empty variable, or one
 * pasted with a stray space — without putting the secret in a browser tab, a
 * screenshot, or a support chat.
 */
import { Request, Response } from 'express';
import config from '../../config';
import { SmsService } from './sms.service';
import { SmsMessage } from './sms.message';
import { Order } from '../order/order.model';

/** Enough to spot an empty or mistyped value; never enough to use. */
const fingerprint = (s: string) => {
  const v = String(s || '');
  if (!v) return { set: false, length: 0 };
  return {
    set: true,
    length: v.length,
    starts: v.slice(0, 3),
    ends: v.slice(-2),
    // The commonest paste error, and invisible in every UI that shows the value.
    hasWhitespace: /\s/.test(v),
  };
};

/**
 * GET /api/notifications/sms-status
 *
 * What the server read, and what it has been doing with it. No gateway call —
 * safe to hit as often as you like.
 */
export const smsStatus = async (_req: Request, res: Response) => {
  try {
    // How many orders are sitting there with a text still owed. After the
    // retry fix, a failed send releases its claim, so this counts real gaps.
    const [placedOwed, recent] = await Promise.all([
      Order.countDocuments({
        'payment.method': 'cod',
        status: { $ne: 'cancelled' },
        smsSent: { $ne: 'placed' },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
      Order.find({ smsSent: { $exists: true } })
        .select('orderNumber createdAt status smsSent payment.method')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        demoMode: SmsService.isDemo(),
        config: {
          username: config.sms.username || null,
          apiKey: fingerprint(config.sms.api_key),
          senderId: config.sms.sender_id || null,
          transactionType: config.sms.transaction_type,
          endpoint: config.sms.endpoint,
          shopName: config.alerts.shop_name,
        },
        // The three things that break this, in the order they usually break.
        checklist: {
          credentialsSet: Boolean(config.sms.username && config.sms.api_key),
          senderIdSet: Boolean(config.sms.sender_id),
          note:
            'A refusal saying "IP Black List" means this server\'s outgoing IP is not ' +
            'whitelisted in the MiMSMS panel. Run the test below to see what the ' +
            'gateway says right now.',
        },
        codBacklogLast7Days: placedOwed,
        recentOrders: recent,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * POST /api/notifications/sms-test  { phone }
 *
 * Send one real text and repeat the gateway's own answer back, verbatim. This
 * is the endpoint that actually settles the question — everything else is
 * inference.
 */
export const smsTest = async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ success: false, message: 'phone is required' });
    }
    const to = SmsService.normalizePhone(phone);
    if (!to) {
      return res
        .status(400)
        .json({ success: false, message: `"${phone}" is not a Bangladeshi mobile number` });
    }

    const message = `${config.alerts.shop_name}\nSMS test message.\nIf you got this, the gateway is working.`;
    const result = await SmsService.send(to, message);

    res.json({
      success: result.success,
      data: {
        to,
        message,
        demoMode: Boolean(result.demo),
        trxnId: result.trxnId || null,
        gatewaySaid: result.error || (result.success ? 'accepted' : 'refused, no reason given'),
        // Turn the gateway's terse phrase into the action it implies.
        whatToDo: result.success
          ? 'Nothing — check the phone. If it does not arrive, look up this trxnId in the MiMSMS sent-log.'
          : /black\s*list|whitelist|ip/i.test(result.error || '')
            ? "This server's outgoing IP is not whitelisted. Send MiMSMS support the IP shown by `curl ifconfig.me` on this server and ask them to whitelist it."
            : /sender/i.test(result.error || '')
              ? 'SMS_SENDER_ID does not match a sender registered to the account. Copy it exactly from the panel.'
              : /unauthor|invalid|key|user/i.test(result.error || '')
                ? 'The username or API key is wrong, or the key was never activated in the panel\'s Developer Option.'
                : 'Unrecognised refusal — send this exact wording to MiMSMS support.',
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * GET /api/notifications/sms-preview
 *
 * The five messages exactly as they would arrive, with their lengths. Sends
 * nothing. Useful for checking the shop name and the wording before a campaign.
 */
export const smsPreview = async (_req: Request, res: Response) => {
  const order = {
    shopName: config.alerts.shop_name,
    orderNumber: 'ORD-1788284255628-LKB6BR',
    total: 610,
  };
  const site = String(config.client_url || 'magicviva.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  const samples = {
    orderPlaced: SmsMessage.orderPlaced(order),
    paymentReceived: SmsMessage.paymentReceived(order),
    orderConfirmed: SmsMessage.orderConfirmed(order),
    orderDelivered: SmsMessage.orderDelivered(order),
    affiliateApproved: SmsMessage.affiliateApproved({
      shopName: config.alerts.shop_name,
      couponCode: 'DMCSAKIB20',
      discountTk: 20,
      payoutTk: 30,
      siteUrl: site,
    }),
  };

  res.json({
    success: true,
    data: Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [
        k,
        { text: v, characters: v.length, messages: v.length > 160 ? 2 : 1 },
      ])
    ),
  });
};
