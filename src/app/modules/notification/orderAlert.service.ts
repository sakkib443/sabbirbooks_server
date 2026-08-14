/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Someone ordered a book" → tell the admin and the buyer.
 *
 * Channels, and what each can actually do:
 *
 *   in-app bell   admin ✔   buyer ✔   always on, no credentials needed
 *   Telegram      admin ✔   buyer ✘   a bot cannot message a person who has
 *                                     never started it, and no API turns a
 *                                     phone number into a chat id. The buyer
 *                                     is unreachable on Telegram, full stop.
 *   WhatsApp      admin ✔   buyer ✔   both need a Meta-approved TEMPLATE,
 *                                     because neither has messaged us inside
 *                                     the last 24 hours.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: a notification failure must never
 * fail the order. The money is already taken and the row is already written; an
 * order that 500s because Telegram had a bad minute is a far worse outcome than
 * a message nobody got. So dispatch() catches everything, resolves always, and
 * the call site does not await it.
 */
import config from '../../config';
import { NotificationService } from './notification.service';
import { TelegramService } from './telegram.service';
import { WhatsAppService } from './whatsapp.service';
import { OrderAlertMessage, IOrderAlertInput } from './orderAlert.message';
import { User } from '../user/user.model';

export interface OrderAlertOutcome {
  orderNumber: string;
  duplicate: boolean;
  inAppAdmin: boolean;
  inAppBuyer: boolean;
  telegramAdmin: boolean;
  whatsappBuyer: boolean;
  whatsappAdmin: boolean;
}

// ─── Duplicate guard ─────────────────────────────────────────
//
// One order, one round of messages. The only call site is the end of
// createOrder, so a second dispatch means something went wrong — a client
// retry, a double-submitted checkout, a future caller added by mistake. The
// buyer should not get two "we received your order" texts because of it.
//
// In-process and deliberately so: it must be free and synchronous to be
// reliable at the top of dispatch. It does not survive a restart and does not
// span the two Coolify replicas, which is fine — the window it protects is
// seconds wide, and the real single-send guarantee is that only one code path
// calls this.
const sentOrders = new Set<string>();
const SENT_CACHE_MAX = 1000;

const markSent = (key: string): boolean => {
  if (sentOrders.has(key)) return false;
  if (sentOrders.size >= SENT_CACHE_MAX) {
    // Sets iterate in insertion order — drop the oldest.
    const oldest = sentOrders.values().next().value;
    if (oldest !== undefined) sentOrders.delete(oldest);
  }
  sentOrders.add(key);
  return true;
};

/** Test seam. Not exported through the public surface used by services. */
const _resetSentCache = () => {
  sentOrders.clear();
  configLogged = false;
};

// Emitted once, on the first order of a process lifetime, so "why did nobody
// get a message?" is answerable from the log rather than by reading code.
let configLogged = false;

// ─── Order document → message input ──────────────────────────

/**
 * Pull the buyer's contact details together.
 *
 * shippingAddress is the source of truth when it exists (the buyer typed it for
 * this parcel). A digital-only order has none, so fall back to the User record
 * — otherwise digital buyers would silently get nothing.
 */
const resolveBuyer = async (order: any): Promise<IOrderAlertInput['buyer']> => {
  const addr = order?.shippingAddress;
  if (addr?.phone) {
    return {
      name: addr.name || 'ক্রেতা',
      phone: String(addr.phone),
      address: addr.address,
      city: addr.city,
      area: addr.area,
      note: addr.note,
    };
  }

  try {
    const user: any = await User.findById(order?.user)
      .select('firstName lastName name phoneNumber')
      .lean();
    if (!user) return null;
    const name =
      `${user.firstName || user.name || ''} ${user.lastName || ''}`.trim() || 'ক্রেতা';
    if (!user.phoneNumber) {
      // Known and expected for digital orders placed by a Google sign-up.
      return { name, phone: '' };
    }
    return { name, phone: String(user.phoneNumber) };
  } catch (e) {
    console.error('[order-alert] buyer lookup failed:', e);
    return null;
  }
};

const buildInput = async (order: any): Promise<IOrderAlertInput> => ({
  orderNumber: order?.orderNumber || String(order?._id || 'unknown'),
  items: (order?.items || []).map((it: any) => ({
    title: it?.title || 'বই',
    quantity: Number(it?.quantity) || 1,
    price: Number(it?.price) || 0,
  })),
  subtotal: Number(order?.subtotal) || 0,
  deliveryCharge: Number(order?.deliveryCharge) || 0,
  total: Number(order?.total) || 0,
  paymentMethod: order?.payment?.method ?? null,
  deliveryType: order?.deliveryType ?? null,
  buyer: await resolveBuyer(order),
  shopName: config.alerts.shop_name,
});

// ─── Dispatch ────────────────────────────────────────────────

/**
 * Send every channel we can for this order. ALWAYS resolves; never rejects.
 *
 * Call it without awaiting:
 *   void OrderAlertService.dispatchNewOrderAlerts(order);
 */
const dispatchNewOrderAlerts = async (order: any): Promise<OrderAlertOutcome> => {
  const orderNumber: string = order?.orderNumber || String(order?._id || 'unknown');
  const outcome: OrderAlertOutcome = {
    orderNumber,
    duplicate: false,
    inAppAdmin: false,
    inAppBuyer: false,
    telegramAdmin: false,
    whatsappBuyer: false,
    whatsappAdmin: false,
  };

  // Claim the order before any await — two concurrent calls must not both pass.
  const key = String(order?._id || orderNumber);
  if (!markSent(key)) {
    console.warn(`[order-alert] ${orderNumber} already notified — skipping duplicate send.`);
    outcome.duplicate = true;
    return outcome;
  }

  if (!configLogged) {
    configLogged = true;
    logConfigOnBoot();
  }

  try {
    const input = await buildInput(order);
    const wa = config.alerts.whatsapp;

    const adminText = OrderAlertMessage.buildAdminTelegramText(input);
    const waParams = OrderAlertMessage.buildWhatsAppParams(input);

    // Every channel runs independently: allSettled, and each task swallows its
    // own errors, so a thrown model call cannot take the others with it.
    const tasks: Promise<void>[] = [];

    // 1. In-app for the admins (no credentials needed — this one always runs).
    tasks.push(
      (async () => {
        const r = await NotificationService.triggerNewBookOrderForAdmins(
          orderNumber,
          OrderAlertMessage.buildAdminInAppMessage(input)
        );
        outcome.inAppAdmin = (r?.created || 0) > 0;
      })().catch((e) => console.error('[order-alert] admin in-app failed:', e))
    );

    // 2. In-app for the buyer.
    if (order?.user) {
      tasks.push(
        (async () => {
          const r = await NotificationService.triggerOrderPlacedForBuyer(
            String(order.user),
            orderNumber,
            OrderAlertMessage.buildBuyerInAppMessage(input)
          );
          outcome.inAppBuyer = (r?.created || 0) > 0;
        })().catch((e) => console.error('[order-alert] buyer in-app failed:', e))
      );
    }

    // 3. Telegram → admin. Skips itself with a log when unconfigured.
    tasks.push(
      (async () => {
        const results = await TelegramService.sendToAdmins(adminText);
        outcome.telegramAdmin = results.some((r) => r.ok);
      })().catch((e) => console.error('[order-alert] telegram failed:', e))
    );

    // 4. WhatsApp → buyer, via the approved template.
    if (input.buyer?.phone) {
      tasks.push(
        (async () => {
          const r = await WhatsAppService.sendTemplate(
            input.buyer!.phone,
            wa.template_buyer,
            waParams
          );
          outcome.whatsappBuyer = r.ok;
        })().catch((e) => console.error('[order-alert] buyer whatsapp failed:', e))
      );
    } else {
      console.warn(
        `[order-alert] ${orderNumber} has no buyer phone — WhatsApp to buyer skipped.`
      );
    }

    // 5. WhatsApp → admin, only if the admin's own number is configured.
    if (wa.admin_to) {
      tasks.push(
        (async () => {
          const r = await WhatsAppService.sendTemplate(wa.admin_to, wa.template_admin, waParams);
          outcome.whatsappAdmin = r.ok;
        })().catch((e) => console.error('[order-alert] admin whatsapp failed:', e))
      );
    }

    await Promise.allSettled(tasks);

    console.log(
      `[order-alert] ${orderNumber} → in-app(admin=${outcome.inAppAdmin}, buyer=${outcome.inAppBuyer}) ` +
        `telegram(admin=${outcome.telegramAdmin}) whatsapp(buyer=${outcome.whatsappBuyer}, admin=${outcome.whatsappAdmin})`
    );
    return outcome;
  } catch (e) {
    // Unreachable in principle — every branch above is already guarded — but an
    // order must not be able to fail here under any circumstance.
    console.error(`[order-alert] dispatch failed for ${orderNumber} (order is unaffected):`, e);
    return outcome;
  }
};

/**
 * What is switched on right now. Logged once at boot so "why did nobody get a
 * message" is answerable from the startup output instead of by reading code.
 */
const describeConfig = () => ({
  telegramAdmin: TelegramService.isConfigured(),
  whatsapp: WhatsAppService.isConfigured(),
  whatsappAdminNumber: !!config.alerts.whatsapp.admin_to,
});

const logConfigOnBoot = () => {
  const c = describeConfig();
  if (!c.telegramAdmin && !c.whatsapp) {
    console.log(
      '[order-alert] Telegram and WhatsApp are both unconfigured — new orders will raise the ' +
        'in-app bell only. Set TELEGRAM_BOT_TOKEN + TELEGRAM_ADMIN_CHAT_ID (and the WHATSAPP_* ' +
        'keys) in .env to enable them; see .env.example.'
    );
    return;
  }
  console.log(
    `[order-alert] channels — telegram(admin)=${c.telegramAdmin ? 'on' : 'off'} ` +
      `whatsapp=${c.whatsapp ? 'on' : 'off'} whatsapp(admin number)=${
        c.whatsappAdminNumber ? 'on' : 'off'
      }`
  );
};

export const OrderAlertService = {
  dispatchNewOrderAlerts,
  describeConfig,
  logConfigOnBoot,
  buildInput,
  _resetSentCache,
};
