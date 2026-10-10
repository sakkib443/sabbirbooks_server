/**
 * The shop's day: noon to noon, Bangladesh time.
 *
 * A date NAMES THE DAY THAT ENDS AT ITS NOON — "16 Sep" is every order placed
 * from 15 Sep 12:00 up to (not including) 16 Sep 12:00. The packing list
 * closes at noon because the courier comes in the afternoon, so that is the
 * unit the shop works in: one list, one day, one courier handover.
 *
 * The browser has the same rules in sabbirbooks/src/lib/shopDay.js and the two
 * must stay in step. Bangladesh is UTC+6 all year with no daylight saving, so
 * every boundary here is built with a fixed +06:00 offset rather than the
 * server's own clock — the same order lands on the same day whether this runs
 * in Dhaka, in Frankfurt or in a container that thinks it is UTC.
 */

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
/** Noon. Shifting an instant by this and reading its date gives its shop day. */
const SHOP_DAY_SHIFT_MS = 12 * 60 * 60 * 1000;

/** YYYY-MM-DD in Bangladesh for an instant. */
export const bdDate = (instant: Date = new Date()): string =>
  new Date(instant.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10);

/** A YYYY-MM-DD moved by n days. */
export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The instant a shop day closes: noon, Bangladesh time, on that date. */
export const cutoffOf = (day: string): Date => new Date(`${day}T12:00:00+06:00`);

/**
 * Which shop day an instant belongs to — the inverse of cutoffOf.
 *
 * 11 AM on the 15th is the 15th (before that noon); 1 PM is the 16th.
 */
export const shopDayOf = (instant: Date = new Date()): string =>
  bdDate(new Date(instant.getTime() + SHOP_DAY_SHIFT_MS));

/** A mongo range matching orders placed in the shop days fromDay…toDay. */
export const dayWindow = (fromDay: string, toDay: string = fromDay) => ({
  $gte: cutoffOf(addDays(fromDay, -1)),
  $lt: cutoffOf(toDay),
});

/** The last date of a month, as a YYYY-MM-DD. */
export const lastDateOfMonth = (y: number, m: number): string =>
  new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

export { BD_OFFSET_MS, SHOP_DAY_SHIFT_MS };
