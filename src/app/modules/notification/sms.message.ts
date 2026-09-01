/**
 * Every text the shop sends, in one file.
 *
 * English, and short. Two reasons, both practical rather than stylistic:
 *
 *   Length is money. A GSM-7 text is 160 characters; go one over and it is
 *   billed as two, and a concatenated message is 153 characters per part. The
 *   shop bought a 5,000-message pack, so a template that quietly runs to 170
 *   characters costs twice what it looks like it costs. Every template below
 *   fits one part, and there is a test that fails if one stops fitting.
 *
 *   Bengali is not GSM-7. A single Bengali character forces UCS-2 encoding,
 *   where the limit drops from 160 to 70 — a three-line Bengali message is
 *   three or four SMS credits. That is why these are in English even though
 *   the site is bilingual: the same three lines cost a quarter as much.
 *
 * Amounts are written as "BDT 610" rather than "৳610" for the same reason —
 * one taka sign would push the whole message into UCS-2.
 */

/** The GSM-7 single-part limit. Over this, the gateway bills two messages. */
export const SMS_SINGLE_PART = 160;

const tk = (n: number) => `BDT ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** Trim each line and drop empties, so a blank field cannot leave a ragged gap. */
const lines = (...xs: (string | false | null | undefined)[]) =>
  xs.filter(Boolean).map((x) => String(x).trim()).join('\n');

export interface OrderSmsInput {
  shopName: string;
  orderNumber: string;
  total: number;
  /** 'cod' | 'bkash' | 'sslcommerz' | … — decides which of the two paths ran. */
  paymentMethod?: string | null;
}

export interface AffiliateSmsInput {
  shopName: string;
  couponCode: string;
  discountTk: number;
  payoutTk: number;
  siteUrl: string;
}

export const SmsMessage = {
  /**
   * 1. The moment an order is placed. Everybody gets this one.
   *
   * Deliberately says "received", not "confirmed" — for a COD order nothing is
   * confirmed until the shop has looked at it, and a text that says otherwise
   * is the one that generates the "where is my book" call.
   */
  orderPlaced: (i: OrderSmsInput) =>
    lines(
      `${i.shopName}`,
      `Order ${i.orderNumber} received. Amount ${tk(i.total)}.`,
      'We will confirm it shortly. Thank you!'
    ),

  /**
   * 2. Prepaid only — the money actually arrived.
   *
   * Paying online confirms the order by itself, so this doubles as the
   * confirmation and a COD-style confirm text is never sent to these buyers.
   */
  paymentReceived: (i: OrderSmsInput) =>
    lines(
      `${i.shopName}`,
      `Payment of ${tk(i.total)} received for order ${i.orderNumber}.`,
      'Your order is confirmed. We are packing it now.'
    ),

  /**
   * 3. Cash on delivery only — a person at the shop confirmed it.
   *
   * Says the amount to keep ready, which is the single most useful thing a COD
   * buyer can be told before the rider knocks.
   */
  orderConfirmed: (i: OrderSmsInput) =>
    lines(
      `${i.shopName}`,
      `Order ${i.orderNumber} is confirmed. Cash on delivery ${tk(i.total)}.`,
      'Please keep the amount ready. Thank you!'
    ),

  /** 4. Delivered — and a nudge towards the thing that makes the book work. */
  orderDelivered: (i: OrderSmsInput) =>
    lines(
      `${i.shopName}`,
      `Order ${i.orderNumber} delivered. Thank you for your purchase!`,
      'Scan the QR codes in the book to open the answers.'
    ),

  /**
   * 5. An affiliate was approved. The only text an affiliate ever gets.
   *
   * It carries the code, because that is the thing they need in hand to start,
   * and where to sign in. It does not carry the password: it is their own phone
   * number — the number this text just arrived on — so naming it is enough, and
   * a password written into an SMS is a password sitting in someone's inbox.
   *
   * Their email is their username, and it is not in here: with a long code the
   * message would run past 160 and cost double for the one line most of them
   * do not need, since it is the email they applied with. The admin who adds
   * someone by hand is shown their login on screen at that moment, which covers
   * the only case where the person might not know it.
   */
  affiliateApproved: (i: AffiliateSmsInput) =>
    lines(
      `${i.shopName}: you are now an affiliate!`,
      `Code ${i.couponCode} - buyers save ${tk(i.discountTk)}, you get ${tk(i.payoutTk)}/sale.`,
      `Sign in at ${i.siteUrl}, password is this number.`
    ),
};
