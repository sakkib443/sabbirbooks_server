// ─── Bulk discount — "buy N copies, get X off" ───────────────────────────────
//
// One ladder for the whole shop, set by the admin in Settings. It is matched on
// the TOTAL number of copies in the order rather than per title: a buyer taking
// three different books is buying in bulk just as much as one taking three of
// the same, and the shop ships one parcel either way.
//
// The cut is taken off the book total AFTER each book's own offer and BEFORE
// delivery — the same base a coupon uses. Keeping the two on one base is what
// makes "offer + bulk + coupon" add up to something the buyer can check, and
// what stops the three of them between them costing more than the books.

import { IQuantityDiscountTier } from '../settings/settings.interface';

export interface PickedTier {
  tier: IQuantityDiscountTier;
  /** Taka off, unrounded — the caller rounds the order once. */
  amount: number;
  /** What the buyer sees on the summary row. */
  label: string;
}

// Same ceiling as the book offers. These numbers come off a stored document
// that may predate the schema's guards (or was edited straight in the shell),
// and they are about to be subtracted from real money.
const clampPct = (n: unknown): number => Math.min(90, Math.max(0, Number(n) || 0));
const clampMoney = (n: unknown): number => Math.max(0, Number(n) || 0);

const defaultLabel = (t: IQuantityDiscountTier): string =>
  t.type === 'fixed'
    ? `${t.minQty}+ কপিতে ৳${clampMoney(t.value)} ছাড়`
    : `${t.minQty}+ কপিতে ${clampPct(t.value)}% ছাড়`;

/** Valid rungs, worst-first. Invalid rows are dropped rather than throwing. */
export const usableTiers = (tiers?: IQuantityDiscountTier[] | null): IQuantityDiscountTier[] =>
  (Array.isArray(tiers) ? tiers : [])
    .filter((t) => t && Number(t.minQty) >= 2 && Number(t.value) > 0)
    .sort((a, b) => Number(a.minQty) - Number(b.minQty));

/**
 * The best rung this order qualifies for, or null.
 *
 * Rungs do NOT add up — a 10-copy order on a 3/5/10 ladder gets the 10 rung
 * only. Stacking them would make a big order cheaper than the admin typed, and
 * the admin is writing each rung as the whole deal at that size.
 *
 * `base` is the book total after the books' own offers. A fixed rung never
 * takes off more than that base, so the books can never end up free (or
 * negative) because someone typed ৳5000 on a ৳650 order.
 */
export const pickQuantityTier = (
  tiers: IQuantityDiscountTier[] | null | undefined,
  totalQty: number,
  base: number
): PickedTier | null => {
  const qty = Math.max(0, Number(totalQty) || 0);
  const money = Math.max(0, Number(base) || 0);
  if (qty < 2 || money <= 0) return null;

  const eligible = usableTiers(tiers).filter((t) => qty >= Number(t.minQty));
  const tier = eligible[eligible.length - 1];
  if (!tier) return null;

  const amount =
    tier.type === 'fixed'
      ? Math.min(clampMoney(tier.value), money)
      : (money * clampPct(tier.value)) / 100;

  if (amount <= 0) return null;
  return { tier, amount, label: (tier.label || '').trim() || defaultLabel(tier) };
};
