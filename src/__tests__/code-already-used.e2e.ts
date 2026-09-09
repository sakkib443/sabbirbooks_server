/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "This code has already been used" — told to the right person, the right way.
 *
 * Three different people reach that sentence and the shop was giving all three
 * the same one:
 *
 *   the owner, whose code is on this very account — nothing is wrong;
 *   the owner scanning from a browser they are not signed in to, whose code is
 *     on their OTHER account — they need to sign in, not a new code;
 *   somebody with a second-hand copy whose code the last owner spent.
 *
 * Only the second and third look alike, and the masked address is what lets a
 * reader tell them apart. This checks the server says which case it is, and
 * that the mask reveals enough to recognise and not enough to identify.
 *
 * Run: npx ts-node src/__tests__/code-already-used.e2e.ts
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

/** Run it and hand back the error itself, since the extra fields are the point. */
const failure = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e: any) {
    return e;
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'code-already-used-test' });

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

  const owner = await account('rahim.sarkar@gmail.com');
  const stranger = await account('other@gmail.com');

  await BookCopy.create({ code: 'AAAA-BBBB-CCCC-DDD1', book: book._id, serial: 1, released: true });
  await BookCopyService.redeem({
    code: 'AAAA-BBBB-CCCC-DDD1',
    userId: String(owner._id),
    fullName: 'Rahim',
  } as any);

  console.log('\n── The owner types their own code again ────────────────');
  {
    const e = await failure(() =>
      BookCopyService.redeem({ code: 'AAAA-BBBB-CCCC-DDD1', userId: String(owner._id) } as any)
    );
    check('it is refused', Boolean(e));
    check('named as their own', e?.reason === 'already-yours', e?.reason);
    check('no address is shown — it is theirs', !e?.maskedEmail, e?.maskedEmail);
    // The point of separating this case: the sentence must not read as a fault.
    check(
      'and the message says nothing is wrong',
      /আপনার এই অ্যাকাউন্টেই/.test(String(e?.message)),
      e?.message
    );
  }

  console.log('\n── Somebody else types it ─────────────────────────────');
  {
    const e = await failure(() =>
      BookCopyService.redeem({ code: 'AAAA-BBBB-CCCC-DDD1', userId: String(stranger._id) } as any)
    );
    check('it is refused', Boolean(e));
    check('named as another account', e?.reason === 'already-other', e?.reason);

    const masked = String(e?.maskedEmail || '');
    check('an address is offered to recognise', masked.length > 0, masked);
    check('the full address is NOT in it', !masked.includes('rahim.sarkar'), masked);
    check('the domain is kept, to recognise by', masked.endsWith('@gmail.com'), masked);
    check('only the last two characters survive', masked.includes('ar@'), masked);
    check('and the rest is dots', masked.startsWith('••••'), masked);
  }

  console.log('\n── A short address does not leak by being short ───────');
  {
    const shortOwner = await account('ab@gmail.com');
    await BookCopy.create({ code: 'AAAA-BBBB-CCCC-DDD2', book: book._id, serial: 2, released: true });
    await BookCopyService.redeem({
      code: 'AAAA-BBBB-CCCC-DDD2',
      userId: String(shortOwner._id),
    } as any);

    const e = await failure(() =>
      BookCopyService.redeem({ code: 'AAAA-BBBB-CCCC-DDD2', userId: String(stranger._id) } as any)
    );
    const masked = String(e?.maskedEmail || '');
    // Two characters of a two-character name is the whole name, so the mask
    // has to keep less of a short address, not the same amount.
    check('a 2-character address keeps only one character', masked === '•••b@gmail.com', masked);
  }

  console.log('\n── An unused code still refuses plainly ───────────────');
  {
    await BookCopy.create({ code: 'AAAA-BBBB-CCCC-DDD3', book: book._id, serial: 3, released: false });
    const e = await failure(() =>
      BookCopyService.redeem({ code: 'AAAA-BBBB-CCCC-DDD3', userId: String(stranger._id) } as any)
    );
    check('a held-back code carries no reason field', !e?.reason, e?.reason);
    check('and no address', !e?.maskedEmail, e?.maskedEmail);
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
