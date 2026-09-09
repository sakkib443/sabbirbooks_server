/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Undoing a redemption.
 *
 * The case is mundane and constant: a reader types their book code while
 * signed in to the wrong Google account. Before this the code was spent for
 * good and the shop's own list carried the wrong name against it forever.
 *
 * The risk in fixing that is taking away a book somebody is entitled to, so
 * that is what most of this checks: access granted by an ORDER must survive a
 * reset, and a transfer must not leave the code loose in between.
 *
 * Run: npx ts-node src/__tests__/code-admin-fix.e2e.ts
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let passed = 0;
let failed = 0;

const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

const rejects = async (fn: () => Promise<unknown>, needle: string) => {
  try {
    await fn();
    return { matched: false, message: '(no error)' };
  } catch (e: any) {
    const message = String(e?.message || e);
    return { matched: message.includes(needle), message };
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'code-admin-fix-test' });

  const { BookCopy } = await import('../app/modules/bookCopy/bookCopy.model');
  const { BookCopyService } = await import('../app/modules/bookCopy/bookCopy.service');
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { Book } = await import('../app/modules/book/book.model');
  const { User } = await import('../app/modules/user/user.model');

  const book: any = await Book.create({
    id: 1,
    title: 'MAGIC VIVA ANATOMY',
    slug: 'magic-viva-anatomy',
    price: 650,
    author: 'Sabbir',
    category: 'medical',
    description: 'test',
    format: 'printed',
    stock: 100,
  });

  let n = 0;
  const account = async (email: string) => {
    const u: any = await User.create({
      id: `T${++n}`,
      email,
      firstName: 'Reader',
      lastName: 'One',
      password: 'pass1234',
      whatsappNumber: '01712345678',
      role: 'student',
      status: 'active',
    });
    return u;
  };

  const wrong = await account('wrong@gmail.com');
  const right = await account('right@gmail.com');
  const admin = await account('admin@gmail.com');

  const makeCode = async (code: string) => {
    await BookCopy.create({ code, book: book._id, serial: ++n, released: true });
    return code;
  };

  const hasBook = async (user: any) => {
    const g = await BookAccess.findOne({ userId: user._id, bookId: book._id }).lean();
    return Boolean(g && !g.revokedAt);
  };

  console.log('\n── Reset: the code typed on the wrong account ──────────');
  {
    const code = await makeCode('AAAA-BBBB-CCCC-0001');
    await BookCopyService.redeem({ code, userId: String(wrong._id), fullName: 'Wrong' } as any);
    check('the wrong account has the book', await hasBook(wrong));

    const row: any = await BookCopy.findOne({ code }).lean();
    const out = await BookCopyService.resetCode({
      id: String(row._id),
      reason: 'typed on the wrong account',
      adminId: String(admin._id),
    });

    check('access is withdrawn', (await hasBook(wrong)) === false);
    check('the code is usable again', out.copy.status === 'available', out.copy.status);
    check('and carries no holder', !out.copy.redeemedBy);
    check('the reset is written down', (out.copy.history || []).length === 1, out.copy.history);
    check(
      'naming who lost it',
      out.copy.history?.[0]?.fromEmail === 'wrong@gmail.com',
      out.copy.history?.[0]
    );

    // The point of resetting rather than voiding: the reader can now use it.
    const again = await BookCopyService.redeem({
      code,
      userId: String(right._id),
      fullName: 'Right',
    } as any);
    check('the right account can now redeem it', again.bookTitle === 'MAGIC VIVA ANATOMY');
  }

  console.log('\n── Reset must not touch a book someone BOUGHT ─────────');
  {
    // The dangerous case. This account holds the book through an order as well,
    // and a reset that revoked access by (user, book) would take away what they
    // paid for while fixing an unrelated code.
    const buyer = await account('buyer@gmail.com');
    await BookAccess.create({ userId: buyer._id, bookId: book._id, source: 'order' });

    const code = await makeCode('AAAA-BBBB-CCCC-0002');
    await BookCopyService.redeem({ code, userId: String(buyer._id), fullName: 'Buyer' } as any);

    const row: any = await BookCopy.findOne({ code }).lean();
    await BookCopyService.resetCode({ id: String(row._id), adminId: String(admin._id) });

    check('the purchased access survives', await hasBook(buyer));
  }

  console.log('\n── Transfer: straight to the right account ────────────');
  {
    const code = await makeCode('AAAA-BBBB-CCCC-0003');
    const a = await account('a@gmail.com');
    const b = await account('b@gmail.com');
    await BookCopyService.redeem({ code, userId: String(a._id), fullName: 'A' } as any);

    const row: any = await BookCopy.findOne({ code }).lean();
    const out = await BookCopyService.transferCode({
      id: String(row._id),
      email: 'b@gmail.com',
      adminId: String(admin._id),
    });

    check('the old account loses it', (await hasBook(a)) === false);
    check('the new account gains it', await hasBook(b));
    check('the code stays redeemed throughout', out.copy.status === 'redeemed', out.copy.status);
    check('now held by the new account', String(out.copy.redeemedBy) === String(b._id));
    check(
      'and both sides are recorded',
      out.copy.history?.[0]?.fromEmail === 'a@gmail.com' &&
        out.copy.history?.[0]?.toEmail === 'b@gmail.com',
      out.copy.history?.[0]
    );
  }

  console.log('\n── What both refuse ───────────────────────────────────');
  {
    const code = await makeCode('AAAA-BBBB-CCCC-0004');
    const row: any = await BookCopy.findOne({ code }).lean();

    const r = await rejects(
      () => BookCopyService.resetCode({ id: String(row._id) }),
      'Only a redeemed code'
    );
    check('resetting an unused code is refused', r.matched, r.message);

    const t = await rejects(
      () => BookCopyService.transferCode({ id: String(row._id), email: 'b@gmail.com' }),
      'Only a redeemed code'
    );
    check('transferring an unused code is refused', t.matched, t.message);

    const code2 = await makeCode('AAAA-BBBB-CCCC-0005');
    const holder = await account('holder@gmail.com');
    await BookCopyService.redeem({ code: code2, userId: String(holder._id) } as any);
    const row2: any = await BookCopy.findOne({ code: code2 }).lean();

    const unknown = await rejects(
      () => BookCopyService.transferCode({ id: String(row2._id), email: 'nobody@gmail.com' }),
      'No account with the email'
    );
    check('transferring to an account that does not exist is refused', unknown.matched, unknown.message);

    const same = await rejects(
      () => BookCopyService.transferCode({ id: String(row2._id), email: 'holder@gmail.com' }),
      'already holds'
    );
    check('transferring to the current holder is refused', same.matched, same.message);
  }

  console.log('\n── Finding the code an admin is asked about ───────────');
  {
    // The admin is given an email, not a code — that is what the reader writes
    // in with. Searching by it has to reach the code.
    const found = await BookCopyService.list({ q: 'right@gmail.com' });
    check(
      'searching by email finds the redeemed code',
      found.rows.some((r: any) => r.code === 'AAAA-BBBB-CCCC-0001'),
      found.rows.map((r: any) => r.code)
    );

    const live = await BookCopyService.list({ released: 'false' });
    check('filtering by held-back returns none here', live.rows.length === 0, live.rows.length);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
