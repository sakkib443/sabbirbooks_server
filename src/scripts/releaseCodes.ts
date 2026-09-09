/* eslint-disable no-console */
/**
 * Decide how far down the printed sheet the codes are allowed to work.
 *
 * 3,000 codes were generated at once; the books are printed in batches. The
 * first 500 are on the shelf, so serials 1–500 must open the content and
 * 501–3000 must not — a code that leaks from an unprinted batch (a photo of
 * the sheet, a printer's proof) has to be worth nothing until its books are
 * actually in people's hands.
 *
 * This sets that line. Run it again with a bigger number when the next batch
 * ships; it only ever moves the boundary, and it will not touch a code that
 * has already been redeemed — pulling one of those back would take the book
 * away from someone holding it.
 *
 * Dry run by default:
 *   npx ts-node --transpile-only src/scripts/releaseCodes.ts 500
 *   npx ts-node --transpile-only src/scripts/releaseCodes.ts 500 --apply
 */
import mongoose from 'mongoose';

(async () => {
  const upTo = Number(process.argv[2]);
  const apply = process.argv.includes('--apply');

  if (!Number.isInteger(upTo) || upTo < 0) {
    console.error('Pass the serial to release up to, e.g. 500.');
    process.exit(1);
  }

  await import('../app/config');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();
  const { BookCopy } = await import('../app/modules/bookCopy/bookCopy.model');

  const withSerial = { serial: { $exists: true, $ne: null } };
  const total = await BookCopy.countDocuments(withSerial);
  const noSerial = await BookCopy.countDocuments({ serial: { $in: [null, undefined] } });

  console.log(`\nCodes carrying a serial : ${total}`);
  console.log(`Codes without one       : ${noSerial}  (left alone — they predate the sheet)`);
  console.log(`\nReleasing 1–${upTo}, holding back ${upTo + 1}–${total}.`);

  // Redeemed codes are excluded from BOTH sides. One that has been used is in
  // someone's hands by definition, and un-releasing it would revoke a book
  // that was legitimately opened.
  const openFilter = { ...withSerial, serial: { $lte: upTo }, status: { $ne: 'redeemed' } };
  const holdFilter = { ...withSerial, serial: { $gt: upTo }, status: { $ne: 'redeemed' } };

  const willOpen = await BookCopy.countDocuments({ ...openFilter, released: { $ne: true } });
  const willHold = await BookCopy.countDocuments({ ...holdFilter, released: { $ne: false } });
  const redeemedInRange = await BookCopy.countDocuments({ ...withSerial, status: 'redeemed' });

  console.log(`\n  to turn ON  : ${willOpen}`);
  console.log(`  to turn OFF : ${willHold}`);
  console.log(`  already redeemed, untouched : ${redeemedInRange}`);

  if (!apply) {
    console.log('\n── DRY RUN — nothing written. Re-run with --apply to commit. ──\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('\n── APPLYING ──');
  const on = await BookCopy.updateMany(openFilter, { $set: { released: true } });
  const off = await BookCopy.updateMany(holdFilter, { $set: { released: false } });
  console.log(`  released : ${on.modifiedCount}`);
  console.log(`  held back: ${off.modifiedCount}`);

  // Read the state back rather than trusting the counters — the question the
  // shop is really asking is "what is live right now", and that is a count of
  // rows, not a sum of updates.
  const liveNow = await BookCopy.countDocuments({ ...withSerial, released: true });
  const darkNow = await BookCopy.countDocuments({ ...withSerial, released: false });
  console.log(`\n✅ Live: ${liveNow}   Held back: ${darkNow}`);

  const edge = await BookCopy.find({ serial: { $in: [upTo, upTo + 1] } })
    .select('serial code released')
    .sort({ serial: 1 })
    .lean();
  console.log('\nThe boundary:');
  edge.forEach((d) =>
    console.log(`  #${d.serial}  ${d.code}  ${d.released ? 'LIVE' : 'held back'}`)
  );

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
