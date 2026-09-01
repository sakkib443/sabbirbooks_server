/* eslint-disable no-console */
/**
 * Which offer shows, in every combination the shop can set.
 *
 * The shop asked for one thing plainly: whatever offer is running is the one
 * whose details appear. Two cases were getting that wrong, and both cost money
 * rather than pixels:
 *
 *   • a pre-order with NO discount became the headline anyway, and swallowed a
 *     normal discount running underneath it — the buyer paid full price while an
 *     everyday offer sat enabled and ignored;
 *   • "pre-order" and "pre-order discount" were the same switch, so a shop could
 *     not sell a book before printing without also promising money off.
 *
 * Every row below is a state an admin can actually save from the book form. The
 * client mirrors this file's logic in src/lib/bookOffers.ts; a difference here
 * is a page quoting a price the invoice refuses.
 *
 * Run:  npx ts-node src/__tests__/offer-cases.e2e.ts
 */
import { priceBookUnit, OFFER_DEFAULT_LABELS } from '../app/modules/book/book.pricing';

let passed = 0;
let failed = 0;
const check = (cond: boolean, msg: string, extra?: unknown) => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
};

const off = (over: Record<string, unknown> = {}) => ({
  enabled: false,
  label: '',
  type: 'percent',
  percent: 0,
  amount: 0,
  ...over,
});

/** A book at ৳600 with whichever offers the case needs. */
const book = (offers: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  price: 600,
  offers: { normal: off(), preorder: off(), online: off(), ...offers },
  ...extra,
});

const show = (b: unknown, online = false) => priceBookUnit(b as never, { online });

console.log('\n── Nothing running ──');
{
  const p = show(book({}));
  check(p.headline.mode === 'none', `no offer → mode 'none' (got '${p.headline.mode}')`);
  check(p.unit === 600, `full price (৳${p.unit})`);
  check(p.headline.percent === 0, 'no percentage to show');
}

console.log('\n── A normal discount only ──');
{
  const p = show(book({ normal: off({ enabled: true, type: 'fixed', amount: 100, label: 'নতুন সংস্করণে ছাড়' }) }));
  check(p.headline.mode === 'normal', `headline is the normal offer (got '${p.headline.mode}')`);
  check(p.unit === 500, `৳500 (got ৳${p.unit})`);
  check(p.headline.label === 'নতুন সংস্করণে ছাড়', 'and its name is carried through');
}

console.log('\n── A pre-order discount only ──');
{
  const p = show(book({ preorder: off({ enabled: true, type: 'fixed', amount: 80 }) }));
  check(p.headline.mode === 'preorder', `headline is the pre-order offer (got '${p.headline.mode}')`);
  check(p.unit === 520, `৳520 (got ৳${p.unit})`);
  // An unnamed offer still gets a name HERE, because the order summary itemises
  // discounts and a line with no name reads as a mystery deduction. The
  // storefront is the opposite — it shows the struck-through price and no label
  // — which is why the client's resolveOffers leaves a blank label blank.
  check(
    p.headline.label === OFFER_DEFAULT_LABELS.preorder,
    `unnamed → a default name for the invoice line (got ${JSON.stringify(p.headline.label)})`
  );
}

console.log('\n── THE CASE THAT WAS BROKEN: pre-order on, but no pre-order discount ──');
{
  // The shop wants the book sold before printing, and is running an everyday
  // discount. The pre-order switch must not eat it.
  const p = show(
    book({
      preorder: off({ enabled: true, type: 'fixed', amount: 0 }),
      normal: off({ enabled: true, type: 'fixed', amount: 100, label: 'ঈদের আগে ছাড়' }),
    })
  );
  check(p.headline.mode === 'normal', `the NORMAL discount is the headline (got '${p.headline.mode}')`);
  check(p.unit === 500, `and the buyer actually gets it: ৳500 (got ৳${p.unit})`);
  check(p.headline.label === 'ঈদের আগে ছাড়', 'shown under its own name');
}

console.log('\n── Pre-order on, no discount anywhere ──');
{
  const p = show(book({ preorder: off({ enabled: true, percent: 0 }) }));
  check(p.headline.mode === 'none', `no discount claimed (got '${p.headline.mode}')`);
  check(p.unit === 600, `full price (৳${p.unit})`);
}

console.log('\n── Both discount: pre-order wins ──');
{
  const p = show(
    book({
      preorder: off({ enabled: true, type: 'fixed', amount: 80 }),
      normal: off({ enabled: true, type: 'fixed', amount: 50 }),
    })
  );
  check(p.headline.mode === 'preorder', `pre-order is the more specific campaign (got '${p.headline.mode}')`);
  check(p.unit === 520, `৳520, not ৳550 (got ৳${p.unit})`);
}

console.log('\n── The online extra stacks on whatever the headline is ──');
{
  const withNormal = book({
    preorder: off({ enabled: true, amount: 0 }),
    normal: off({ enabled: true, type: 'fixed', amount: 100 }),
    online: off({ enabled: true, type: 'fixed', amount: 20 }),
  });
  check(show(withNormal).unit === 500, 'paying on delivery: ৳500');
  check(show(withNormal, true).unitOnline === 480, `paying online: ৳480 (got ৳${show(withNormal, true).unitOnline})`);

  const noHeadline = book({ online: off({ enabled: true, type: 'fixed', amount: 20 }) });
  check(show(noHeadline).unit === 600, 'with no headline at all: ৳600 on delivery');
  check(show(noHeadline, true).unitOnline === 580, `and ৳580 online (got ৳${show(noHeadline, true).unitOnline})`);
}

console.log('\n── Percent offers read as a rate, fixed offers as taka ──');
{
  const pct = show(book({ normal: off({ enabled: true, type: 'percent', percent: 25 }) }));
  check(pct.unit === 450, `25% of ৳600 → ৳450 (got ৳${pct.unit})`);
  check(pct.headline.percent === 25, `and reads as 25% (got ${pct.headline.percent}%)`);

  const fixed = show(book({ normal: off({ enabled: true, type: 'fixed', amount: 100 }) }));
  check(fixed.unit === 500, `৳100 off → ৳500 (got ৳${fixed.unit})`);
  // A fixed offer still reports an EFFECTIVE percent, for screens that show a rate.
  check(fixed.headline.percent === 17, `৳100 of ৳600 reads as 17% (got ${fixed.headline.percent}%)`);
}

console.log('\n── A discount can never make the book free or negative ──');
{
  const huge = show(book({ normal: off({ enabled: true, type: 'fixed', amount: 5000 }) }));
  check(huge.unit >= 0, `clamped at or above zero (got ৳${huge.unit})`);
}

console.log(
  failed === 0
    ? `\n✅ ALL PASS — ${passed} passed, 0 failed`
    : `\n❌ FAILURES — ${passed} passed, ${failed} failed`
);
process.exit(failed === 0 ? 0 : 1);
