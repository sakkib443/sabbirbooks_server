/* eslint-disable no-console */
/**
 * Give the Google-signup accounts a phone number.
 *
 * Google hands over a name, an email and a picture — never a number. So every
 * account created that way starts with phoneNumber '' and only later gets a
 * whatsappNumber, typed by the student. The code now mirrors that number into
 * an empty phone as it is saved (see user.service.ts), but the accounts made
 * before that change are still sitting there with no phone on them, which is
 * why checkout cannot prefill their number and the admin order list shows a
 * buyer with no way to reach them.
 *
 * This fills that gap once, for the accounts that already exist.
 *
 * THE RULE: only ever writes into an EMPTY phone. An account that already has
 * a number has answered the question deliberately, and a backfill that
 * overwrites a real number is far worse than one that skips a row.
 *
 * Dry run by default — nothing is written without --apply:
 *   npx ts-node --transpile-only src/scripts/backfillPhoneFromWhatsapp.ts
 *   npx ts-node --transpile-only src/scripts/backfillPhoneFromWhatsapp.ts --apply
 */
import mongoose from 'mongoose';

(async () => {
  const apply = process.argv.includes('--apply');

  await import('../app/config');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const users = mongoose.connection.db!.collection('users');

  // Empty, missing, or whitespace-only phone — with a WhatsApp number to use.
  const candidates = await users
    .find({
      $and: [
        { $or: [{ phoneNumber: '' }, { phoneNumber: null }, { phoneNumber: { $exists: false } }] },
        { whatsappNumber: { $exists: true, $nin: ['', null] } },
      ],
    })
    .project({ email: 1, firstName: 1, phoneNumber: 1, whatsappNumber: 1, googleId: 1 })
    .toArray();

  console.log(apply ? '── APPLYING ──\n' : '── DRY RUN ──\n');
  console.log(`${candidates.length} account(s) have a WhatsApp number and no phone.\n`);

  if (candidates.length === 0) {
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('email                                   signup   phone ← whatsapp');
  console.log('─'.repeat(78));
  for (const u of candidates) {
    console.log(
      `${String(u.email).slice(0, 38).padEnd(40)}${(u.googleId ? 'google' : 'local ').padEnd(9)}${u.whatsappNumber}`
    );
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    await mongoose.disconnect();
    process.exit(0);
  }

  let done = 0;
  for (const u of candidates) {
    const res = await users.updateOne({ _id: u._id }, { $set: { phoneNumber: u.whatsappNumber } });
    done += res.modifiedCount;
  }
  console.log(`\n✅ ${done} account(s) updated.`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
