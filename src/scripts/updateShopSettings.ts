/* eslint-disable no-console */
/**
 * Correct the shop's contact number and delivery charge in Settings.
 *
 * Two of the client's sixteen feedback items are not code at all — they are
 * values saved in the Settings document, which overrides whatever the schema
 * defaults to:
 *
 *   phoneNumber      "+880 1711-946614"  → 01799075202   (item 6)
 *   whatsappNumber   "8801711946614"     → 8801799075202 (same number, wa.me form)
 *   deliveryCharge   absent → schema default 130 → 120   (item 4)
 *
 * The delivery one is subtler than it looks. `deliveryCharge` is MISSING from
 * the stored document, and mongoose fills a missing path with its schema default
 * when it hydrates — so the API answered 130 even though both legacy zone fields
 * already said 120. Writing the field explicitly is what makes the flat rate
 * actually 120 rather than depending on which field the pricing code reads first.
 *
 * Dry run by default; nothing is written without --apply:
 *   npx ts-node src/scripts/updateShopSettings.ts
 *   npx ts-node src/scripts/updateShopSettings.ts --apply
 */
import mongoose from 'mongoose';

const TARGET = {
  phoneNumber: '01799075202',
  whatsappNumber: '8801799075202',
  deliveryCharge: 120,
  // Kept in step with the flat rate. The pricing code falls back to the
  // inside-Dhaka field for documents written before `deliveryCharge` existed,
  // so leaving these behind would make the answer depend on which document a
  // given deploy happens to read.
  deliveryChargeInsideDhaka: 120,
  deliveryChargeOutsideDhaka: 120,
};

(async () => {
  const apply = process.argv.includes('--apply');

  await import('../app/config');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const col = mongoose.connection.db!.collection('settings');
  const doc = await col.findOne({});
  if (!doc) {
    console.error('No settings document found — nothing to update.');
    process.exit(1);
  }

  console.log(apply ? '── APPLYING ──\n' : '── DRY RUN ──\n');
  console.log('field                       before                    after');
  console.log('─'.repeat(72));
  for (const [key, next] of Object.entries(TARGET)) {
    const before = (doc as Record<string, unknown>)[key];
    const shown = before === undefined ? '(field absent)' : JSON.stringify(before);
    const changed = String(before) !== String(next);
    console.log(
      `${key.padEnd(28)}${String(shown).padEnd(26)}${JSON.stringify(next)}${changed ? '' : '   (no change)'}`
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const res = await col.updateOne({ _id: doc._id }, { $set: TARGET });
  console.log(`\n✅ ${res.modifiedCount} settings document updated.`);

  const after = await col.findOne({ _id: doc._id });
  console.log('\nRead back:');
  for (const key of Object.keys(TARGET)) {
    console.log(`  ${key.padEnd(28)}${JSON.stringify((after as Record<string, unknown>)[key])}`);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
