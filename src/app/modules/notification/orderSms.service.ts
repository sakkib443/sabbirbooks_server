/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The four texts an order can send, and the rule about not sending them twice.
 *
 * WHEN EACH ONE FIRES
 *
 *   placed     the order was written — cash-on-delivery only. A COD order is
 *              real the moment it is placed; nothing more is owed before it is
 *              packed. An order on its way to a hosted payment page is NOT
 *              real yet: the buyer may look at the page and close it, and
 *              texting "we got your order" to someone who then pays nothing
 *              costs a message and invites a reply we cannot answer. Those
 *              announce themselves below, when the money lands.
 *
 *   paid       the money actually arrived. Prepaid orders only, by definition.
 *              It doubles as the confirmation, which is why a prepaid buyer
 *              never gets the 'confirmed' text — paying IS the confirmation.
 *
 *   confirmed  a person at the shop confirmed the order. In practice this is
 *              the COD path, since a prepaid order was already confirmed by its
 *              payment and is filtered out.
 *
 *   delivered  the parcel arrived, and for COD that is also when the cash was
 *              taken.
 *
 * So: COD gets three (placed → confirmed → delivered), prepaid gets two
 * (paid → delivered). Nobody gets the same one twice.
 *
 * NOT SENDING IT TWICE
 *
 * The guard is a list of event names on the order document, not an in-process
 * Set. These events are days apart, an admin can walk a status backwards and
 * forwards, and the shop runs more than one replica — so the only guard that
 * actually holds is the one written next to the order itself.
 *
 * THE RULE THIS FILE SHARES WITH sms.service: a text must never break the
 * thing that triggered it. Everything here resolves; call it without awaiting.
 */
import config from '../../config';
import { Order } from '../order/order.model';
import { User } from '../user/user.model';
import { SmsService } from './sms.service';
import { SmsMessage, OrderSmsInput } from './sms.message';

export type OrderSmsEvent = 'placed' | 'paid' | 'confirmed' | 'delivered';

/**
 * The buyer's mobile number.
 *
 * The shipping address wins when it exists — the buyer typed it for THIS
 * parcel, and it is the number a rider would call. A digital-only order has no
 * address, so fall back to the account, or digital buyers would silently get
 * nothing. Same order of preference the in-app and WhatsApp alerts use.
 */
const resolvePhone = async (order: any): Promise<string> => {
  const fromAddress = order?.shippingAddress?.phone;
  if (fromAddress) return String(fromAddress);
  try {
    const user: any = await User.findById(order?.user).select('phoneNumber whatsappNumber').lean();
    return String(user?.phoneNumber || user?.whatsappNumber || '');
  } catch (e) {
    console.error('[order-sms] buyer lookup failed:', e);
    return '';
  }
};

const buildInput = (order: any): OrderSmsInput => ({
  shopName: config.alerts.shop_name,
  orderNumber: order?.orderNumber || String(order?._id || ''),
  total: Number(order?.total) || 0,
  paymentMethod: order?.payment?.method ?? null,
});

const TEXT: Record<OrderSmsEvent, (i: OrderSmsInput) => string> = {
  placed: SmsMessage.orderPlaced,
  paid: SmsMessage.paymentReceived,
  confirmed: SmsMessage.orderConfirmed,
  delivered: SmsMessage.orderDelivered,
};

/**
 * Should this order get this text at all?
 *
 * Kept separate from sending so the decision is readable on its own and can be
 * tested without a gateway.
 */
const shouldSend = (event: OrderSmsEvent, order: any): boolean => {
  // Cash on delivery is the one path where the order is real before any money
  // moves, so it is the one that gets told "received" and later "confirmed".
  // Everything else — a hosted gateway, a bank transfer an admin approves —
  // becomes real when the payment lands, and that moment is its confirmation.
  //
  // Asked as "is it COD?" rather than "is it one of these gateways?" on
  // purpose: an order can reach the settle path before its method has been
  // written (approveOrderPayment defaults it to 'manual' AFTER settling), and
  // a list of gateway names would silently drop that order's only receipt.
  // There is exactly one method that means "pay later", so test for it.
  const cod = String(order?.payment?.method || '').toLowerCase() === 'cod';

  // A cancelled order says nothing cheerful. If it was cancelled between the
  // trigger and here, stay quiet.
  if (order?.status === 'cancelled') return false;

  // The two paths are exclusive on purpose: a prepaid buyer's 'paid' text
  // already says "your order is confirmed", so sending them 'placed' and
  // 'confirmed' as well would be three texts saying one thing.
  if (event === 'placed') return cod;
  if (event === 'confirmed') return cod;
  if (event === 'paid') return !cod;
  return true; // delivered — everybody, however they paid
};

/**
 * Claim the event on the order, atomically.
 *
 * $addToSet with a "not already in the array" filter means two replicas racing
 * the same status change produce exactly one winner — the second one matches no
 * document and sends nothing.
 */
const claim = async (order: any, event: OrderSmsEvent): Promise<boolean> => {
  try {
    const res = await Order.updateOne(
      { _id: order._id, smsSent: { $ne: event } },
      { $addToSet: { smsSent: event } }
    );
    return (res.modifiedCount || 0) > 0;
  } catch (e) {
    // A guard that cannot be written is a guard we do not have. Send anyway:
    // a duplicate text is a smaller failure than a silent one.
    console.error('[order-sms] could not claim event, sending unguarded:', e);
    return true;
  }
};

/**
 * Send one order text. Always resolves.
 *
 *   void OrderSmsService.send(order, 'delivered');
 */
const send = async (order: any, event: OrderSmsEvent): Promise<boolean> => {
  try {
    if (!order?._id) return false;
    if (!shouldSend(event, order)) return false;
    if (!(await claim(order, event))) return false;

    const phone = await resolvePhone(order);
    if (!phone) {
      console.warn(`[order-sms] ${event}: no phone on ${order?.orderNumber} — skipped.`);
      return false;
    }

    SmsService.logConfigOnce();
    const r = await SmsService.send(phone, TEXT[event](buildInput(order)));
    console.log(
      `[order-sms] ${event} → ${order?.orderNumber}: ${r.success ? (r.demo ? 'demo' : 'sent') : 'FAILED'}` +
        (r.error ? ` (${r.error})` : '')
    );
    return r.success;
  } catch (e) {
    console.error(`[order-sms] ${event} threw (order unaffected):`, e);
    return false;
  }
};

export const OrderSmsService = { send, shouldSend, resolvePhone };
