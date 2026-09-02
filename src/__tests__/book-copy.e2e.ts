/* eslint-disable no-console */
/**
 * Book copy codes — the code on the book, and the access it grants (isolated
 * in-memory MongoDB, real Express app via supertest — never the live DB).
 *
 * This is the only place in the shop where typing a string at a public URL
 * grants paid access, so the rules are pinned down hard:
 *
 *   unguessable  → codes share no structure, use no confusable characters,
 *                  and come from the OS CSPRNG rather than a counter
 *   once only    → a redeemed code is dead, for everybody, forever
 *   race-safe    → two people submitting the same code produce ONE winner
 *   additive     → redeeming never takes the buyer's own access away
 *   quiet        → a used code does not reveal who used it
 *   forgiving    → lower case, spaces and missing dashes are the same code
 *
 * Run:  npx ts-node src/__tests__/book-copy.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

let passed = 0;
let failed = 0;
function check(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';
  process.env.JWT_ACCESS_EXPIRES_IN = '15m';
  process.env.JWT_REFRESH_EXPIRES_IN = '7d';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');
  const { BookCopy } = await import('../app/modules/bookCopy/bookCopy.model');
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { BookAccessService } = await import('../app/modules/bookAccess/bookAccess.service');
  const { MedicalCollege } = await import('../app/modules/medicalCollege/medicalCollege.model');
  const { generateCode, normalizeCode } = await import('../app/modules/bookCopy/copyCode');

  const api = () => request(app);

  const dmc = await MedicalCollege.create({
    name: 'Dhaka Medical College',
    searchKey: 'dhaka medical college',
    type: 'government',
    division: 'ঢাকা',
    district: 'ঢাকা',
  });

  const book: any = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    price: 500,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
    format: 'printed',
    stock: 100,
  });

  const registerLogin = async (email: string, device: string, role?: string) => {
    await api().post('/api/auth/register').send({
      firstName: 'T', lastName: 'U', email, password: 'pass1234', whatsappNumber: '01712345678',
    });
    if (role) await User.updateOne({ email }, { role });
    const r = await api().post('/api/auth/login').set('x-device-id', device)
      .send({ email, password: 'pass1234' });
    return r.body?.data?.accessToken as string;
  };

  const admin = await registerLogin('copy-admin@test.com', 'ad1', 'superAdmin');

  // ───────────────────────────────────────────────────────────
  console.log('\n── A code tells you nothing about any other code ──');
  {
    const codes = Array.from({ length: 500 }, () => generateCode());
    check(new Set(codes).size === 500, `500 codes, 500 distinct (${new Set(codes).size})`);
    check(codes.every((c) => /^MV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c)), 'all in the printed shape');

    // No confusable character is ever printed, in either direction: not 0/O,
    // 1/I/L, 5/S, 8/B or 2/Z. A student reading a scratch panel in bad light
    // cannot turn one valid code into another by misreading.
    const body = codes.join('').replace(/MV|-/g, '');
    check(!/[01258BILOSZ]/.test(body), 'never a character that gets misread for another');

    // Sequential generation is the failure this design exists to avoid: if the
    // Nth code told you anything about the N+1th, one buyer would post a
    // thousand of them. Adjacent codes must share no prefix beyond chance.
    const sharedPrefix = codes
      .slice(1)
      .filter((c, i) => c.slice(3, 7) === codes[i].slice(3, 7)).length;
    check(sharedPrefix === 0, `no two adjacent codes share a first group (${sharedPrefix})`);

    // Every position uses the whole alphabet — a biased position is a smaller
    // keyspace than the length suggests.
    const firstChars = new Set(codes.map((c) => c[3]));
    check(firstChars.size >= 15, `the first character varies widely (${firstChars.size} distinct)`);
  }

  console.log('\n── What the reader typed is what we look up ──');
  {
    const n = normalizeCode;
    check(n('MV-7K3P-9QXR-4M6T') === 'MV-7K3P-9QXR-4M6T', 'the canonical form is unchanged');
    check(n('mv-7k3p-9qxr-4m6t') === 'MV-7K3P-9QXR-4M6T', 'lower case works');
    check(n('MV7K3P9QXR4M6T') === 'MV-7K3P-9QXR-4M6T', 'dashes are optional');
    check(n('7K3P 9QXR 4M6T') === 'MV-7K3P-9QXR-4M6T', 'so is the prefix, and spaces are fine');
    check(n('  MV-7K3P-9QXR-4M6T  ') === 'MV-7K3P-9QXR-4M6T', 'and surrounding space');
    check(n('') === '', 'nothing is not a code');
    check(n('ABC') === '', 'too short is not a code');
    // A typed O is a misread of something — and since neither O nor 0 is ever
    // printed, there is no way to know what. Rejected rather than invented.
    check(n('MV-7K3P-9QXO-4M6T') === '', 'a character we never print is refused, not guessed at');
  }

  console.log('\n── Minting a print run ──');
  let codes: string[] = [];
  {
    const r = await api()
      .post('/api/book-copies/generate')
      .set('Authorization', `Bearer ${admin}`)
      .send({ bookId: String(book._id), count: 25, batch: 'PRINT-01' });
    check(r.status === 201, `25 codes created (${r.status})`, r.body?.message);
    codes = r.body?.data?.codes || [];
    check(codes.length === 25, `and handed back (${codes.length})`);

    const stored = await BookCopy.countDocuments({ book: book._id, status: 'available' });
    check(stored === 25, `all available (${stored})`);

    const one: any = await BookCopy.findOne({ code: codes[0] }).lean();
    check(one.batch === 'PRINT-01', 'stamped with the print run');
    check(!one.redeemedBy, 'and nobody holds it yet');
  }

  console.log('\n── Only an admin may mint or read them ──');
  {
    const outsider = await registerLogin('nosy@test.com', 'no1');
    const gen = await api()
      .post('/api/book-copies/generate')
      .set('Authorization', `Bearer ${outsider}`)
      .send({ bookId: String(book._id), count: 5 });
    check(gen.status === 403, `a student cannot mint codes (${gen.status})`);

    // The list IS the codes — reading it must be the same gate as making them.
    const list = await api().get('/api/book-copies').set('Authorization', `Bearer ${outsider}`);
    check(list.status === 403, `nor read the list (${list.status})`);

    const anon = await api().get('/api/book-copies');
    check(anon.status === 401, `and signed out gets nowhere (${anon.status})`);
  }

  console.log('\n── A friend with the book gets access ──');
  {
    // The case the shop described: one account orders six, five go to
    // classmates who never ordered anything.
    const friend = await registerLogin('friend@test.com', 'fr1');
    const friendUser: any = await User.findOne({ email: 'friend@test.com' }).lean();

    check(
      (await BookAccessService.hasBookAccess(friendUser._id, book._id)) === false,
      'before: no order, no access'
    );

    const r = await api()
      .post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${friend}`)
      .send({
        code: codes[0],
        fullName: 'Rifat Karim',
        medicalCollege: String(dmc._id),
        classRoll: 'K-75/112',
      });
    check(r.status === 200, `the code is accepted (${r.status})`, r.body?.message);
    check(
      (await BookAccessService.hasBookAccess(friendUser._id, book._id)) === true,
      'after: the book is open to them'
    );

    const copy: any = await BookCopy.findOne({ code: codes[0] }).lean();
    check(copy.status === 'redeemed', 'the copy is marked redeemed');
    check(String(copy.redeemedBy) === String(friendUser._id), 'to that account');
    check(copy.holder.classRoll === 'K-75/112', `with their roll number (${copy.holder.classRoll})`);
    check(
      copy.holder.medicalCollegeName === 'Dhaka Medical College',
      'and the college name snapshotted, not just its id'
    );
  }

  console.log('\n── A code works exactly once ──');
  {
    const second = await registerLogin('second@test.com', 'se1');
    const r = await api()
      .post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${second}`)
      .send({ code: codes[0], fullName: 'Someone Else', classRoll: '1' });
    check(r.status === 400, `refused (${r.status})`);
    check(/আগেই ব্যবহার|already been used/i.test(r.body?.message || ''), 'and says it is already used');

    // Whoever holds a second-hand book must not learn the last owner's email
    // by typing the code in.
    const msg = String(r.body?.message || '');
    check(!msg.includes('friend@test.com'), 'without naming who used it');
    check(!/Rifat/i.test(msg), 'or who they are');

    const user: any = await User.findOne({ email: 'second@test.com' }).lean();
    check(
      (await BookAccessService.hasBookAccess(user._id, book._id)) === false,
      'and they get no access from it'
    );
  }

  console.log('\n── Two people racing the same code: exactly one wins ──');
  {
    const a = await registerLogin('race-a@test.com', 'ra1');
    const b = await registerLogin('race-b@test.com', 'rb1');
    const target = codes[1];

    const [ra, rb] = await Promise.all([
      api().post('/api/book-copies/redeem').set('Authorization', `Bearer ${a}`)
        .send({ code: target, fullName: 'A', classRoll: '1' }),
      api().post('/api/book-copies/redeem').set('Authorization', `Bearer ${b}`)
        .send({ code: target, fullName: 'B', classRoll: '2' }),
    ]);

    const wins = [ra, rb].filter((r) => r.status === 200).length;
    check(wins === 1, `one winner, not two (${wins})`, [ra.status, rb.status]);

    const ua: any = await User.findOne({ email: 'race-a@test.com' }).lean();
    const ub: any = await User.findOne({ email: 'race-b@test.com' }).lean();
    const granted = [
      await BookAccessService.hasBookAccess(ua._id, book._id),
      await BookAccessService.hasBookAccess(ub._id, book._id),
    ].filter(Boolean).length;
    check(granted === 1, `and only one of them can read the book (${granted})`);
  }

  console.log('\n── Redeeming never takes the buyer\'s own access away ──');
  {
    // The shop was explicit: whoever ordered keeps reading on the account they
    // ordered with, whether or not anybody redeems a code.
    const buyer = await registerLogin('buyer@test.com', 'bu1');
    const buyerUser: any = await User.findOne({ email: 'buyer@test.com' }).lean();
    await BookAccess.create({ userId: buyerUser._id, bookId: book._id, source: 'order' });
    check(
      (await BookAccessService.hasBookAccess(buyerUser._id, book._id)) === true,
      'the buyer has access from their order'
    );

    const other = await registerLogin('classmate@test.com', 'cl1');
    await api().post('/api/book-copies/redeem').set('Authorization', `Bearer ${other}`)
      .send({ code: codes[2], fullName: 'Classmate', classRoll: '9' });

    check(
      (await BookAccessService.hasBookAccess(buyerUser._id, book._id)) === true,
      'and still has it after a classmate redeems a code'
    );
    const otherUser: any = await User.findOne({ email: 'classmate@test.com' }).lean();
    check(
      (await BookAccessService.hasBookAccess(otherUser._id, book._id)) === true,
      'while the classmate has it too — both, never one instead of the other'
    );
  }

  console.log('\n── The buyer redeeming their own copy is not an error ──');
  {
    // Their account already has a grant, and the unique index would otherwise
    // throw. The code is spent, which is right: that copy is now claimed.
    const buyerUser: any = await User.findOne({ email: 'buyer@test.com' }).lean();
    const token = (await api().post('/api/auth/login').set('x-device-id', 'bu2')
      .send({ email: 'buyer@test.com', password: 'pass1234' })).body?.data?.accessToken;

    const r = await api().post('/api/book-copies/redeem').set('Authorization', `Bearer ${token}`)
      .send({ code: codes[3], fullName: 'Buyer', classRoll: '5' });
    check(r.status === 200, `accepted rather than a duplicate-key crash (${r.status})`, r.body?.message);
    check(
      (await BookAccessService.hasBookAccess(buyerUser._id, book._id)) === true,
      'they keep their access'
    );
    const copy: any = await BookCopy.findOne({ code: codes[3] }).lean();
    check(copy.status === 'redeemed', 'and the copy is claimed');
  }

  console.log('\n── A code nobody printed, and one that was cancelled ──');
  {
    const someone = await registerLogin('nope@test.com', 'np1');

    const fake = await api().post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${someone}`)
      .send({ code: 'MV-3333-4444-6666', fullName: 'X', classRoll: '1' });
    check(fake.status === 400, `an invented code is refused (${fake.status})`);
    check(/তালিকায় নেই|not one of ours/i.test(fake.body?.message || ''), 'as not ours');

    // Voiding: a misprint, or a code sheet photographed before it shipped.
    const spare: any = await BookCopy.findOne({ code: codes[10] }).lean();
    const v = await api().patch(`/api/book-copies/${String(spare._id)}/void`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'misprinted sheet' });
    check(v.status === 200, `an admin can void one (${v.status})`);

    const dead = await api().post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${someone}`)
      .send({ code: codes[10], fullName: 'X', classRoll: '1' });
    check(dead.status === 400, `a voided code is refused (${dead.status})`);
    check(
      /বাতিল|cancelled/i.test(dead.body?.message || ''),
      'and says cancelled, not "not ours" — the shop must be able to tell those apart'
    );
  }

  console.log('\n── A redeemed code cannot be quietly voided ──');
  {
    const used: any = await BookCopy.findOne({ code: codes[0] }).lean();
    const r = await api().patch(`/api/book-copies/${String(used._id)}/void`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ reason: 'changed my mind' });
    check(r.status === 400, `refused (${r.status})`);
    check(
      /already been redeemed/i.test(r.body?.message || ''),
      'because voiding it would not take the reader\'s access away — which would look like it had'
    );
  }

  console.log('\n── Guessing is rate limited ──');
  {
    const guesser = await registerLogin('guess@test.com', 'gu1');
    let blockedAt = 0;
    for (let i = 1; i <= 14; i++) {
      const r = await api().post('/api/book-copies/redeem')
        .set('Authorization', `Bearer ${guesser}`)
        .send({ code: `MV-3333-4444-${String(6666 + i).slice(0, 4)}`, fullName: 'X', classRoll: '1' });
      if (r.status === 429) { blockedAt = i; break; }
    }
    check(blockedAt > 0 && blockedAt <= 12, `blocked after ${blockedAt} wrong tries`);

    // The limit is per account, so one guesser cannot lock out a whole hostel
    // sharing an IP.
    const innocent = await registerLogin('innocent@test.com', 'in1');
    const r = await api().post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${innocent}`)
      .send({ code: codes[4], fullName: 'Innocent', classRoll: '3' });
    check(r.status === 200, `someone else on the same IP is unaffected (${r.status})`);
  }

  console.log('\n── The admin list, and the file the printer gets ──');
  {
    const list = await api()
      .get('/api/book-copies?status=available&limit=5')
      .set('Authorization', `Bearer ${admin}`);
    check(list.status === 200, `the list loads (${list.status})`);
    check(list.body.rows.length === 5, `paged (${list.body.rows.length} of ${list.body.total})`);
    check(
      list.body.rows.every((r: any) => r.status === 'available'),
      'filtered to available only'
    );
    check(typeof list.body.counts?.redeemed === 'number', `with counts per status (${JSON.stringify(list.body.counts)})`);

    const byHolder = await api()
      .get('/api/book-copies?q=Rifat')
      .set('Authorization', `Bearer ${admin}`);
    check(byHolder.body.rows.length === 1, `searchable by who redeemed it (${byHolder.body.rows.length})`);

    const csv = await api()
      .get('/api/book-copies/export?batch=PRINT-01')
      .set('Authorization', `Bearer ${admin}`);
    check(csv.status === 200, `the CSV downloads (${csv.status})`);
    check(csv.headers['content-type']?.includes('text/csv'), 'as a CSV');
    const lines = String(csv.text).trim().split('\r\n');
    check(lines[0].includes('code'), 'with a header row');
    check(lines.length === 26, `and one line per code (${lines.length - 1})`);
  }

  console.log('\n── A reader can see what they redeemed ──');
  {
    const token = (await api().post('/api/auth/login').set('x-device-id', 'fr2')
      .send({ email: 'friend@test.com', password: 'pass1234' })).body?.data?.accessToken;
    const r = await api().get('/api/book-copies/mine').set('Authorization', `Bearer ${token}`);
    check(r.status === 200, `their own list loads (${r.status})`);
    check(r.body.data.length === 1, `showing the one they used (${r.body.data.length})`);
    check(r.body.data[0].book?.title === 'Anatomy MAGIC VIVA', 'named by the book it opened');
  }

  await mongoose.disconnect();
  await mongod.stop();

  console.log(
    failed === 0
      ? `\n✅ ALL PASS — ${passed} passed, 0 failed`
      : `\n❌ FAILURES — ${passed} passed, ${failed} failed`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Harness error:', e);
  process.exit(1);
});
