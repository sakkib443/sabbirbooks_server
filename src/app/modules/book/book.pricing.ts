// ─── Book offers & pricing — one place that prices a book line ───────────────
//
// A book carries up to three named, admin-editable percentage offers:
//
//   normal   — an everyday discount, always in force; the headline price on the
//              storefront and at checkout.
//   preorder — sold before the print run exists; its percent is the headline
//              while the book is a pre-order (and stock is not checked).
//   online   — an EXTRA reduction applied only when the buyer pays online instead
//              of cash on delivery. It stacks on top of the headline.
//
// Each offer has { enabled, label, percent }. `label` is the offer's own name so
// the shop can call it whatever a campaign needs ("নতুন সংস্করণে ছাড়", "আগে পেমেন্টে ছাড়")
// and the storefront shows that name.
//
// resolveOffers() also reads the LEGACY fields (isPreOrder / preOrderDiscountPercent
// / offerPrice) so a book saved before this system still prices and displays
// correctly. The order service only routes a line through priceBookUnit() when the
// admin has actually configured `offers`; a legacy book keeps its exact old price.

export interface ResolvedOffer {
  enabled: boolean;
  label: string;
  /** How the cut is measured: a percentage of the price, or a flat taka amount. */
  type: 'percent' | 'fixed';
  percent: number;
  amount: number;
}

export interface ResolvedOffers {
  normal: ResolvedOffer;
  preorder: ResolvedOffer;
  online: ResolvedOffer;
}

export interface BookOfferInput {
  enabled?: boolean;
  label?: string;
  type?: 'percent' | 'fixed';
  percent?: number;
  amount?: number;
}

export interface BookLike {
  price?: number;
  offerPrice?: number | null;
  isPreOrder?: boolean;
  preOrderDiscountPercent?: number;
  offers?: {
    normal?: BookOfferInput | null;
    preorder?: BookOfferInput | null;
    online?: BookOfferInput | null;
  } | null;
}

// The names shown when the admin enabled an offer but left its label blank.
export const OFFER_DEFAULT_LABELS = {
  normal: 'ছাড়',
  preorder: 'প্রি-অর্ডার',
  online: 'অনলাইন পেমেন্টে ছাড়',
} as const;

// Applied to real money, so a typo'd 100/900 must not hand the book away — 90 is
// the ceiling everywhere (schema, form, and here, on a value read back off a
// stored document that may predate those guards).
const clampPct = (n: unknown): number => {
  const v = Math.round(Number(n) || 0);
  if (!Number.isFinite(v)) return 0;
  return Math.min(90, Math.max(0, v));
};

// A fixed-taka discount: whole taka, never negative. The upper bound is the price
// it is taken off, applied at pricing time (a "৳100 off" on a ৳80 book is ৳80 off,
// not −৳20), so it is not clamped to a ceiling here.
const clampMoney = (n: unknown): number => Math.max(0, Math.round(Number(n) || 0));

const offerType = (v: unknown): 'percent' | 'fixed' => (v === 'fixed' ? 'fixed' : 'percent');

const label = (v: unknown, fallback: string): string => {
  const s = (v ?? '').toString().trim();
  return s || fallback;
};

/** True once the admin has configured the new offers object on this book. */
export const hasOffers = (book?: BookLike | null): boolean => {
  const o = book?.offers;
  return !!o && (!!o.normal || !!o.preorder || !!o.online);
};

/**
 * The three offers as effective values, with the legacy fields as the fallback
 * source. Used for DISPLAY (labels + percents) on every surface, and as the
 * input to priceBookUnit().
 */
export const resolveOffers = (book?: BookLike | null): ResolvedOffers => {
  const o = book?.offers || {};
  const price = Number(book?.price) || 0;
  const offerPrice = book?.offerPrice != null ? Number(book.offerPrice) : null;
  const legacyNormal = offerPrice != null && price > 0 && offerPrice < price;

  const preorder: ResolvedOffer = {
    enabled: o.preorder?.enabled != null ? !!o.preorder.enabled : book?.isPreOrder === true,
    label: label(o.preorder?.label, OFFER_DEFAULT_LABELS.preorder),
    type: offerType(o.preorder?.type),
    percent: clampPct(o.preorder?.percent ?? book?.preOrderDiscountPercent ?? 0),
    amount: clampMoney(o.preorder?.amount),
  };

  const normal: ResolvedOffer = {
    enabled: o.normal?.enabled != null ? !!o.normal.enabled : legacyNormal,
    label: label(o.normal?.label, OFFER_DEFAULT_LABELS.normal),
    type: offerType(o.normal?.type),
    percent: clampPct(
      o.normal?.percent ?? (legacyNormal ? ((price - (offerPrice as number)) / price) * 100 : 0)
    ),
    amount: clampMoney(o.normal?.amount),
  };

  const online: ResolvedOffer = {
    enabled: !!o.online?.enabled,
    label: label(o.online?.label, OFFER_DEFAULT_LABELS.online),
    type: offerType(o.online?.type),
    percent: clampPct(o.online?.percent ?? 0),
    amount: clampMoney(o.online?.amount),
  };

  return { normal, preorder, online };
};

// The taka an offer takes off a given base price. A fixed offer never takes off
// more than the base (a ৳100 offer on a ৳80 line is ৳80, not −৳20).
export const offerDiscount = (base: number, offer: ResolvedOffer): number =>
  offer.type === 'fixed'
    ? Math.min(offer.amount, Math.max(0, base))
    : (base * offer.percent) / 100;

export type HeadlineMode = 'preorder' | 'normal' | 'none';

export interface UnitPricing {
  /** Catalogue unit price (before any offer). */
  list: number;
  /** The offer that sets the headline price, if any. */
  headline: { mode: HeadlineMode; label: string; percent: number };
  /** Unit price after the headline discount — what a COD buyer pays per copy. */
  unit: number;
  /** The extra online-payment percent in force for this call (0 when COD / off). */
  onlinePercent: number;
  /** Unit price after headline + online — what an online buyer pays per copy. */
  unitOnline: number;
}

/**
 * Price a single copy. `online` says the buyer is paying online (not COD), which
 * is the only case the online-payment offer applies.
 *
 * Precedence for the headline: a live pre-order wins over a normal discount — a
 * book is sold as one or the other, they do not stack. The online offer is the
 * one thing that stacks, on top of whichever headline is in force.
 *
 * Rounding is deliberately NOT done here: the order service accumulates unrounded
 * across the whole order and rounds once, so N copies never drift a taka per line
 * against what the buyer was shown.
 */
export const priceBookUnit = (book: BookLike, opts: { online?: boolean } = {}): UnitPricing => {
  const offers = resolveOffers(book);
  const list = Number(book?.price) || 0;

  const headlineOffer = offers.preorder.enabled
    ? offers.preorder
    : offers.normal.enabled
      ? offers.normal
      : null;
  const mode: HeadlineMode = offers.preorder.enabled ? 'preorder' : offers.normal.enabled ? 'normal' : 'none';

  const headlineOff = headlineOffer ? offerDiscount(list, headlineOffer) : 0;
  const unit = list - headlineOff;

  const onlineOff = opts.online && offers.online.enabled ? offerDiscount(unit, offers.online) : 0;
  const unitOnline = unit - onlineOff;

  return {
    list,
    // percent fields are the EFFECTIVE percent off, so a fixed offer still reads
    // as a rate where a rate is expected; `unit`/`unitOnline` carry the real money.
    headline: { mode, label: headlineOffer?.label ?? '', percent: list > 0 ? Math.round((headlineOff / list) * 100) : 0 },
    unit,
    onlinePercent: unit > 0 ? Math.round((onlineOff / unit) * 100) : 0,
    unitOnline,
  };
};
