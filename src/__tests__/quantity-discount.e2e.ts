/* eslint-disable no-console */
/**
 * The bulk-discount ladder ("buy N copies, get X off").
 *
 * Pure maths, no DB — this is the piece that decides real money, and the rules
 * worth pinning are the ones an admin can get wrong from the form: rungs that
 * must not stack, a fixed rung bigger than the order, and a percent typed as
 * 500.
 *
 * Run:  npx ts-node src/__tests__/quantity-discount.e2e.ts
 */
import { pickQuantityTier, usableTiers } from '../app/modules/order/quantityDiscount';

let passed = 0;
let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
};

// A three-rung ladder of the shape an admin would actually type.
const LADDER = [
  { minQty: 3, type: 'percent' as const, value: 5 },
  { minQty: 5, type: 'percent' as const, value: 10 },
  { minQty: 10, type: 'fixed' as const, value: 500 },
];

// 650tk a copy, the real book's price.
const base = (copies: number) => copies * 650;

console.log('\n── Which rung applies ──');
check(pickQuantityTier(LADDER, 1, base(1)) === null, '1 copy → no discount');
check(pickQuantityTier(LADDER, 2, base(2)) === null, '2 copies → below the first rung, no discount');
{
  const r = pickQuantityTier(LADDER, 3, base(3));
  check(r?.amount === base(3) * 0.05, '3 copies → the 5% rung (৳97.5 off ৳1950)');
}
{
  const r = pickQuantityTier(LADDER, 4, base(4));
  check(r?.tier.minQty === 3, '4 copies → still the 3 rung, not the 5 one');
}
{
  const r = pickQuantityTier(LADDER, 5, base(5));
  check(r?.amount === base(5) * 0.1, '5 copies → the 10% rung');
}
{
  // The one that would quietly cost the shop money: 5% + 10% + ৳500 = ৳825.
  const r = pickQuantityTier(LADDER, 12, base(12));
  check(r?.amount === 500, '12 copies → ONLY the ৳500 rung, rungs never add up');
}

console.log('\n── Admin typos must not give the shop away ──');
check(
  pickQuantityTier([{ minQty: 2, type: 'fixed', value: 5000 }], 2, base(2))?.amount === base(2),
  'a fixed rung larger than the order caps at the order (books free, never negative)'
);
check(
  pickQuantityTier([{ minQty: 2, type: 'percent', value: 500 }], 2, 1000)?.amount === 900,
  'a percent above 90 is clamped to 90'
);
check(pickQuantityTier([{ minQty: 2, type: 'percent', value: 0 }], 5, 1000) === null,
  'a zero rung is not a discount');
check(pickQuantityTier([{ minQty: 1, type: 'percent', value: 10 }], 5, 1000) === null,
  'a "1+ copies" rung is refused — that is the price, not a bulk discount');

console.log('\n── Feature off / bad data ──');
check(pickQuantityTier([], 10, 1000) === null, 'empty ladder → no discount (the default)');
check(pickQuantityTier(null, 10, 1000) === null, 'null ladder → no discount');
check(pickQuantityTier(undefined, 10, 1000) === null, 'undefined ladder → no discount');
check(pickQuantityTier(LADDER, 10, 0) === null, 'a zero-taka order gets nothing');
check(
  usableTiers([
    { minQty: 10, type: 'fixed', value: 500 },
    { minQty: 3, type: 'percent', value: 5 },
  ])[0].minQty === 3,
  'rungs are sorted regardless of the order they were saved in'
);

console.log('\n── The label the buyer sees ──');
check(
  pickQuantityTier([{ minQty: 3, type: 'percent', value: 5 }], 3, 1000)?.label === '3+ কপিতে 5% ছাড়',
  'a blank label falls back to a generated one'
);
check(
  pickQuantityTier([{ minQty: 3, type: 'fixed', value: 100, label: 'ঈদ অফার' }], 3, 1000)?.label ===
    'ঈদ অফার',
  "the admin's own label wins"
);

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
