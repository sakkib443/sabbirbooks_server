/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Releasing codes in batches.
 *
 * 3,000 codes exist; 500 books are printed. A code from an unprinted batch is
 * genuine and unused and must still open nothing — a photo of the sheet or a
 * printer's proof cannot be worth a book. This checks the line holds, on both
 * sides, and that moving it later works.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the live database, and a test that redeemed codes
 * there would spend real ones.
 *
 * Run: npx ts-node src/__tests__/code-release.e2e.ts
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
  await mongoose.connect(mongod.getUri(), { dbName: 'code-release-test' });

  const { BookCopy } = await import('../app/modules/bookCopy/bookCopy.model');
  const { BookCopyService } = await import('../app/modules/bookCopy/bookCopy.service');
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
  const buyer = async () => {
    const u: any = await User.create({
      id: `T${++n}`,
      email: `reader${n}@test.com`,
      firstName: 'Reader',
      password: 'x',
      role: 'student',
      status: 'active',
    });
    return String(u._id);
  };

  // Three copies standing for the three states the sheet can be in.
  await BookCopy.create({ code: 'AAAA-BBBB-CCCC-DDD1', book: book._id, serial: 1, released: true });
  await BookCopy.create({ code: 'AAAA-BBBB-CCCC-DDD2', book: book._id, serial: 501, released: false });
  // No `released` at all — the state every code was in before the field existed.
  await BookCopy.collection.insertOne({
    code: 'AAAA-BBBB-CCCC-DDD3',
    book: book._id,
    status: 'available',
  } as never);

  console.log('\n── A released code ─────────────────────────────────────');
  {
    const r = await BookCopyService.redeem({
      code: 'AAAA-BBBB-CCCC-DDD1',
      userId: await buyer(),
      fullName: 'A',
    } as any);
    check('opens the book', r.bookTitle === 'MAGIC VIVA ANATOMY', r);
  }

  console.log('\n── A code from an unprinted batch ──────────────────────');
  {
    const who = await buyer();
    const r = await rejects(
      () =>
        BookCopyService.redeem({
          code: 'AAAA-BBBB-CCCC-DDD2',
          userId: who,
          fullName: 'B',
        } as any),
      'চালু করা হয়নি'
    );
    check('is refused', r.matched, r.message);

    // Refusing must not consume it. The batch ships next month and this code
    // has to be as good then as it was printed.
    const after = await BookCopy.findOne({ code: 'AAAA-BBBB-CCCC-DDD2' }).lean();
    check('and is left unused', after?.status === 'available', after?.status);
  }

  console.log('\n── A code that predates the field ──────────────────────');
  {
    // The 1,000 older codes have no `released` value. They must keep working:
    // a migration that silently switched off live codes would be worse than
    // anything this feature prevents.
    const r = await BookCopyService.redeem({
      code: 'AAAA-BBBB-CCCC-DDD3',
      userId: await buyer(),
      fullName: 'C',
    } as any);
    check('still works', r.bookTitle === 'MAGIC VIVA ANATOMY', r);
  }

  console.log('\n── Moving the line ─────────────────────────────────────');
  {
    await BookCopy.updateMany({ serial: { $lte: 1000 } }, { $set: { released: true } });
    const r = await BookCopyService.redeem({
      code: 'AAAA-BBBB-CCCC-DDD2',
      userId: await buyer(),
      fullName: 'D',
    } as any);
    check('the held-back code opens once released', r.bookTitle === 'MAGIC VIVA ANATOMY', r);
  }

  console.log('\n── Pulling a batch back ────────────────────────────────');
  {
    await BookCopy.create({
      code: 'AAAA-BBBB-CCCC-DDD4',
      book: book._id,
      serial: 600,
      released: true,
    });
    await BookCopy.updateOne({ code: 'AAAA-BBBB-CCCC-DDD4' }, { $set: { released: false } });
    const who = await buyer();
    const r = await rejects(
      () =>
        BookCopyService.redeem({
          code: 'AAAA-BBBB-CCCC-DDD4',
          userId: who,
          fullName: 'E',
        } as any),
      'চালু করা হয়নি'
    );
    check('a code turned off again stops working', r.matched, r.message);
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
