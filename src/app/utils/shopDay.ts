/**
 * The shop's day: by default noon to noon, Bangladesh time.
 *
 * A date NAMES THE DAY THAT ENDS AT ITS CUTOFF — with the default noon, "16
 * Sep" is every order placed from 15 Sep 12:00 up to (not including) 16 Sep
 * 12:00. The packing list closes at noon because the courier comes in the
 * afternoon, so that is the unit the shop works in: one list, one day, one
 * courier handover.
 *
 * The cutoff hour is the shop's to set (18 Oct 2026): Settings
 * `shopDayCutoffHour`, 0–23, changed from the Book Orders screen. It is loaded
 * at boot and whenever settings are saved (setShopDayCutoffHour). Midnight (0)
 * means plain calendar days: the day named 16 Sep is 16 Sep 00:00 → 17 Sep
 * 00:00.
 *
 * The browser has the same rules in sabbirbooks/src/lib/shopDay.js and the two
 * must stay in step. Bangladesh is UTC+6 all year with no daylight saving, so
 * every boundary here is built with a fixed +06:00 offset rather than the
 * server's own clock — the same order lands on the same day whether this runs
 * in Dhaka, in Frankfurt or in a container that thinks it is UTC.
 */

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The hour a shop day closes, 1–24 (24 = midnight at the end of that date). */
let cutoffHour = 12;

/** Set the cutoff from Settings (0–23; 0 = midnight). Anything else is ignored. */
export const setShopDayCutoffHour = (h: unknown): void => {
  const n = Number(h);
  if (!Number.isInteger(n) || n < 0 || n > 23) return;
  cutoffHour = n === 0 ? 24 : n;
};

/** The cutoff as Settings stores it (0–23). */
export const shopDayCutoffHour = (): number => (cutoffHour === 24 ? 0 : cutoffHour);

/** Shifting an instant by this and reading its BD date gives its shop day. */
export const shopDayShiftMs = (): number => (24 - cutoffHour) * HOUR_MS;

/** YYYY-MM-DD in Bangladesh for an instant. */
export const bdDate = (instant: Date = new Date()): string =>
  new Date(instant.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10);

/** A YYYY-MM-DD moved by n days. */
export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The instant a shop day closes: the cutoff hour, Bangladesh time, on that date. */
export const cutoffOf = (day: string): Date =>
  new Date(new Date(`${day}T00:00:00+06:00`).getTime() + cutoffHour * HOUR_MS);

/**
 * Which shop day an instant belongs to — the inverse of cutoffOf.
 *
 * With noon: 11 AM on the 15th is the 15th (before that noon); 1 PM is the 16th.
 */
export const shopDayOf = (instant: Date = new Date()): string =>
  bdDate(new Date(instant.getTime() + shopDayShiftMs()));

/** A mongo range matching orders placed in the shop days fromDay…toDay. */
export const dayWindow = (fromDay: string, toDay: string = fromDay) => ({
  $gte: cutoffOf(addDays(fromDay, -1)),
  $lt: cutoffOf(toDay),
});

/** The last date of a month, as a YYYY-MM-DD. */
export const lastDateOfMonth = (y: number, m: number): string =>
  new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

export { BD_OFFSET_MS };
