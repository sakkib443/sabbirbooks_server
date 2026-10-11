/**
 * How much of the order book a manager may see: three days, and no more.
 *
 * The shop's manager is the person packing parcels today. They confirm, ship
 * and annotate the orders going out now — and that is all they have business
 * seeing. Yesterday's list is still open because a parcel can come back or a
 * buyer can ring about one; tomorrow's is open because orders taken after
 * noon are already on it. Everything older is the owner's: the sales history,
 * the money, the customers.
 *
 * Enforced HERE, on the server, and not by hiding buttons: a window the
 * browser merely asks for is a window anyone can widen with a URL. The screens
 * narrow themselves to match (the Book Orders date shortcuts, the dashboard),
 * but this is what actually decides.
 *
 * Days are the shop's own — noon to noon, named by the day that ends at that
 * noon. See utils/shopDay.
 */
import { addDays, bdDate, cutoffOf } from '../../utils/shopDay';

/** How far either side of today a manager may look. */
export const MANAGER_DAYS_BACK = 1;
export const MANAGER_DAYS_FORWARD = 1;

export type DayRange = { fromDay: string; toDay: string };

/** True when this user's view of the orders has to be narrowed. */
export const isDayScoped = (user: { role?: unknown } | null | undefined): boolean =>
  user?.role === 'manager';

/** Yesterday, today and tomorrow, as shop-day names. */
export const managerDayRange = (now: Date = new Date()): DayRange => {
  const today = bdDate(now);
  return { fromDay: addDays(today, -MANAGER_DAYS_BACK), toDay: addDays(today, MANAGER_DAYS_FORWARD) };
};

/** The two days a scoped dashboard covers: yesterday and today. */
export const managerDashboardRange = (now: Date = new Date()): DayRange => {
  const today = bdDate(now);
  return { fromDay: addDays(today, -MANAGER_DAYS_BACK), toDay: today };
};

/** The instants a day range opens and closes. */
export const rangeInstants = (range: DayRange) => ({
  from: cutoffOf(addDays(range.fromDay, -1)),
  to: cutoffOf(range.toDay),
});

/**
 * The window a request may actually have, as ISO instants.
 *
 * What the caller asked for, narrowed into what they are allowed — never
 * widened. A manager asking for everything gets their three days; a manager
 * asking for one day inside the window gets that day; a manager asking for
 * last March gets a window that is empty, which is the honest answer.
 */
export const clampWindow = (
  allowed: DayRange,
  requestedFrom?: string,
  requestedTo?: string
): { from: string; to: string } => {
  const bounds = rangeInstants(allowed);
  const asked = {
    from: requestedFrom ? new Date(requestedFrom) : null,
    to: requestedTo ? new Date(requestedTo) : null,
  };
  const valid = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d : null);

  const from = valid(asked.from);
  const to = valid(asked.to);

  const start = from && from > bounds.from ? from : bounds.from;
  const end = to && to < bounds.to ? to : bounds.to;

  // An asked-for window entirely outside the allowed one collapses to nothing
  // rather than quietly becoming the allowed one.
  return {
    from: start.toISOString(),
    to: (end > start ? end : start).toISOString(),
  };
};

/** Clamp a YYYY-MM-DD day range into the allowed one. */
export const clampDays = (allowed: DayRange, fromDay?: string, toDay?: string): DayRange => ({
  fromDay: fromDay && fromDay > allowed.fromDay ? fromDay : allowed.fromDay,
  toDay: toDay && toDay < allowed.toDay ? toDay : allowed.toDay,
});

/**
 * Accounts that may not see money — not one taka of it.
 *
 * The shop's manager packs parcels and moves orders along; what the shop
 * takes is not their business. So every figure in taka is blanked before it
 * leaves the server, rather than merely hidden by the screen: a number the
 * API sends is a number anyone can read out of the network tab, and "they
 * cannot see it" has to mean they cannot get at it.
 *
 * The one amount that survives is an order's TOTAL, and only because the
 * courier sheet is built from it — the rider has to be told what to collect
 * at the door. It is never drawn on any screen a manager looks at.
 */
export const isMoneyBlind = (user: { role?: unknown } | null | undefined): boolean =>
  user?.role === 'manager';

/** The money fields on an order document, blanked. */
export const stripOrderMoney = <T extends Record<string, any>>(order: T): T => {
  const o: any = typeof (order as any)?.toJSON === 'function' ? (order as any).toJSON() : { ...order };
  o.subtotal = undefined;
  o.discount = undefined;
  o.deliveryCharge = undefined;
  o.couponDiscount = undefined;
  o.couponPayout = undefined;
  if (Array.isArray(o.items)) {
    o.items = o.items.map((it: any) => ({ ...it, price: undefined }));
  }
  if (o.payment && typeof o.payment === 'object') {
    o.payment = { ...o.payment, amount: undefined };
  }
  return o;
};

/** Every taka in the dashboard payload, zeroed; the counts left alone. */
export const stripStatsMoney = (stats: any) => {
  const bucket = (b: any) =>
    b && {
      ...b,
      value: 0,
      earned: 0,
      upcoming: 0,
      delivery: { value: 0, earned: 0, upcoming: 0 },
      books: { value: 0, earned: 0, upcoming: 0 },
    };
  const split = (rows: any) =>
    Object.fromEntries(
      Object.entries(rows || {}).map(([k, v]: [string, any]) => [k, { ...v, value: 0, delivery: 0 }])
    );

  return {
    ...stats,
    today: bucket(stats.today),
    totals: bucket(stats.totals),
    range: {
      ...bucket(stats.range),
      daily: (stats.range?.daily || []).map((d: any) => ({
        ...d,
        value: 0,
        earned: 0,
        delivery: 0,
        earnedDelivery: 0,
      })),
    },
    byStatus: split(stats.byStatus),
    byMethod: split(stats.byMethod),
    byBook: (stats.byBook || []).map((b: any) => ({ ...b, sales: 0 })),
    coupons: { ...(stats.coupons || {}), discount: 0, payout: 0 },
  };
};
