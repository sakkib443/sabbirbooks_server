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

/**
 * How far either side of today a manager may look: the last seven shop days
 * (today and the six before it) plus tomorrow. The shop's decision, 17 Oct
 * 2026 (it was yesterday–tomorrow before).
 */
export const MANAGER_DAYS_BACK = 6;
export const MANAGER_DAYS_FORWARD = 1;

export type DayRange = { fromDay: string; toDay: string };

/**
 * How far back an `admin` sees: the last 15 shop days (today and the 14 before
 * it), plus tomorrow — after noon, new orders already count for tomorrow.
 *
 * The shop's decision (17 Oct 2026): an admin works the orders, the money,
 * the coupons and the courier, but only for the recent past; the whole
 * history is the superAdmin's. Everything below that narrows a manager to
 * three days narrows an admin to this, through dayRangeFor().
 */
export const ADMIN_DAYS_BACK = 14;
export const ADMIN_DAYS_FORWARD = 1;

/**
 * True when this user's view of the orders has to be narrowed. Only the
 * manager now: from 17 Oct 2026 an admin sees every order (but no money —
 * see isMoneyBlind). ADMIN_DAYS_* stay for the day this is wanted back.
 */
export const isDayScoped = (user: { role?: unknown } | null | undefined): boolean =>
  user?.role === 'manager';

/**
 * The shop days this user may see, or null for "everything" (superAdmin and
 * any role that is not narrowed).
 */
export const dayRangeFor = (
  user: { role?: unknown } | null | undefined,
  now: Date = new Date()
): DayRange | null => {
  if (user?.role === 'manager') return managerDayRange(now);
  return null;
};

/**
 * A Mongo filter on `createdAt` for this user's window — {} when they see
 * everything. For the screens outside the order list that add up orders
 * (coupon payouts, affiliate earnings).
 */
export const scopeCreatedAt = (user: { role?: unknown } | null | undefined): Record<string, unknown> => {
  const range = dayRangeFor(user);
  if (!range) return {};
  const w = rangeInstants(range);
  return { createdAt: { $gte: w.from, $lt: w.to } };
};

/** This user's window as ISO instants, or null for everything. */
export const scopeIso = (user: { role?: unknown } | null | undefined): { from: string; to: string } | null => {
  const range = dayRangeFor(user);
  if (!range) return null;
  const w = rangeInstants(range);
  return { from: w.from.toISOString(), to: w.to.toISOString() };
};

/** The days this user's dashboard covers, or null for all time. */
export const dashboardRangeFor = (
  user: { role?: unknown } | null | undefined,
  now: Date = new Date()
): DayRange | null => (user?.role === 'manager' ? managerDashboardRange(now) : dayRangeFor(user, now));

/**
 * Narrow a requested { from, to } (ISO instants, either may be missing) to
 * what this user may see. Unscoped users get their request back untouched.
 */
export const clampForUser = (
  user: { role?: unknown } | null | undefined,
  from?: string,
  to?: string
): { from?: string; to?: string } => {
  const range = dayRangeFor(user);
  return range ? clampWindow(range, from, to) : { from, to };
};

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
 * Not even an order's total any more (see moneyBlindResponses, which every
 * order, courier, book-access and affiliate route runs through).
 */
export const isMoneyBlind = (user: { role?: unknown } | null | undefined): boolean =>
  // 17 Oct 2026: the admin too — "sees every order, but no taka anywhere".
  // The Super Admin (and a Super Admin viewing as admin is role 'admin' here,
  // so they see what an admin sees) is the only one who sees money.
  user?.role === 'manager' || user?.role === 'admin';

/** The money fields on an order document, blanked. */
export const stripOrderMoney = <T extends Record<string, any>>(order: T): T => {
  const o: any = typeof (order as any)?.toJSON === 'function' ? (order as any).toJSON() : { ...order };
  o.subtotal = undefined;
  o.discount = undefined;
  o.deliveryCharge = undefined;
  o.couponDiscount = undefined;
  o.couponPayout = undefined;
  o.quantityDiscount = undefined;
  o.deliveryWaived = undefined;
  if (o.courier && typeof o.courier === 'object') {
    o.courier = { ...o.courier, collectedAmount: undefined, deliveryCharge: undefined };
  }
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

type BlindOpts = { total: boolean; keys: string[] };

/**
 * Every order-shaped object (anything carrying an orderNumber) in a response,
 * money blanked — for an account that may not see money. Walks a few levels
 * so { data: [...] }, { data: { rows: [...] } } and a single order all work.
 * `keys` blanks extra money fields wherever they appear (a screen's own
 * totals, e.g. an affiliate's sales and commission); `total` also blanks the
 * order total.
 */
export const stripMoneyDeep = (value: any, opts: BlindOpts, depth = 0): any => {
  if (depth > 6 || value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => stripMoneyDeep(v, opts, depth + 1));
  const plain: any = typeof value.toJSON === 'function' ? value.toJSON() : value;
  if (!plain || typeof plain !== 'object' || plain instanceof Date) return plain;
  let out: any;
  if ('orderNumber' in plain) {
    out = stripOrderMoney(plain);
    if ('codAmount' in out) out.codAmount = undefined;
    if (out.courier && typeof out.courier === 'object') out.courier = { ...out.courier, codAmount: undefined };
    if (opts.total) out.total = undefined;
  } else {
    out = {};
    for (const [k, v] of Object.entries(plain)) out[k] = stripMoneyDeep(v, opts, depth + 1);
  }
  for (const k of opts.keys) if (k in out) out[k] = undefined;
  return out;
};

/**
 * Router middleware: when the signed-in account may not see money, every
 * order in the JSON it is sent has its money blanked. Checked when the reply
 * is written, so it works whichever auth middleware ran on the route — and a
 * buyer looking at their own order (not money-blind) is untouched.
 *
 * The order total goes too, for both (17 Oct 2026: "no taka anywhere"). The
 * manager used to keep it for the packing sheet's "Collect Tk"; Steadfast now
 * gets the COD amount from the server, and the sheet simply leaves the line
 * out.
 */
export const moneyBlindResponses =
  (extraKeys: string[] = []) =>
  (req: any, res: any, next: any) => {
    const json = res.json.bind(res);
    res.json = (body: any) => {
      const user = req.user;
      if (!isMoneyBlind(user) || !body || typeof body !== 'object') return json(body);
      return json(stripMoneyDeep(body, { total: true, keys: extraKeys }));
    };
    next();
  };
