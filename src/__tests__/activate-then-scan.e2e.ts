/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The complaint, end to end: "I activate with the book code and scanning still
 * shows locked."
 *
 * Every piece of this has its own test and they all pass, which is exactly why
 * this file exists — the pieces are not what the reader touches. This drives
 * the REAL HTTP routes in the order a buyer does: sign up, redeem the code,
 * scan the QR, read the answers. If the complaint is real it fails here.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the live database, and a test that redeemed codes
 * there would spend real ones.
 *
 * Run: npx ts-node src/__tests__/activate-then-scan.e2e.ts
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

let passed = 0;
let failed = 0;

const check = (ok: boolean, label: string, detail?: unknown) => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test-secret';
  await mongoose.connect(mongod.getUri(), { dbName: 'activate-scan-test' });

  const appMod = await import('../app');
  const app = (appMod as any).default || appMod;
  const api = () => request(app);

  const { Book } = await import('../app/modules/book/book.model');
  const { BookCopy } = await import('../app/modules/bookCopy/bookCopy.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );

  // ── The shop's side: a book, its printed structure, and a code ──────────
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

  const part: any = await BookPart.create({ bookId: book._id, title: 'Board I', order: 1 });
  const chapter: any = await BookChapter.create({
    bookId: book._id,
    partId: part._id,
    chapterNo: '1',
    title: 'Upper Limb',
    // NOT free: a free chapter opens for anyone and would hide the very bug
    // this file is looking for.
    isFree: false,
    order: 1,
  });
  const topic: any = await BookTopic.create({
    bookId: book._id,
    partId: part._id,
    chapterId: chapter._id,
    topicNo: '1.1',
    title: 'Cubital Fossa',
    qrCode: 'DEMOSCAN',
    order: 1,
    isPublished: true,
  });
  await BookQuestion.create({
    bookId: book._id,
    partId: part._id,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '1',
    questionText: 'What are the boundaries of the cubital fossa?',
    answerHtml: '<p>Brachioradialis laterally, pronator teres medially.</p>',
    isPublished: true,
    isDeleted: false,
  });

  // The real thing: a code in the printed format, released like serials 1–500.
  await BookCopy.create({
    code: '00N2-EB6V-05VX-9XM1',
    book: book._id,
    serial: 1,
    batch: 'PRINT-2026-09-PDF',
    released: true,
  });

  // ── The buyer's side ───────────────────────────────────────────────────
  console.log('\n── 1. A reader signs up ───────────────────────────────');
  await api().post('/api/auth/register').send({
    firstName: 'Rahim',
    lastName: 'Sarkar',
    email: 'rahim@test.com',
    password: 'pass1234',
    whatsappNumber: '01712345678',
  });
  const login = await api()
    .post('/api/auth/login')
    .send({ email: 'rahim@test.com', password: 'pass1234' });
  const token = login.body?.data?.accessToken || login.body?.accessToken;
  check(Boolean(token), 'signed in', login.status);

  console.log('\n── 2. Scanning BEFORE the code — must be locked ───────');
  {
    const res = await api().get('/api/book-content/scan/DEMOSCAN').set('Authorization', `Bearer ${token}`);
    check(res.status === 403, 'locked before activation', res.status);
    check(res.body?.code === 'BOOK_NOT_PURCHASED', 'and says why', res.body?.code);
  }

  console.log('\n── 3. Activating with the book code ───────────────────');
  {
    const res = await api()
      .post('/api/book-copies/redeem')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '00N2-EB6V-05VX-9XM1', fullName: 'Rahim Sarkar', classRoll: '45' });
    check(res.status === 200 && res.body?.success, 'the code is accepted', res.body);
    check(res.body?.data?.bookTitle === 'MAGIC VIVA ANATOMY', 'and names the book', res.body?.data);
  }

  console.log('\n── 4. Scanning AFTER — the complaint ──────────────────');
  {
    const res = await api().get('/api/book-content/scan/DEMOSCAN').set('Authorization', `Bearer ${token}`);
    check(res.status === 200, 'the QR opens', { status: res.status, body: res.body?.message });
    check(res.body?.success === true, 'with content, not a lock screen', res.body?.code);
    check(
      res.body?.data?.questions?.length === 1,
      'and the question is there',
      res.body?.data?.questions?.length
    );
    check(
      String(res.body?.data?.questions?.[0]?.answerHtml || '').includes('Brachioradialis'),
      'with its answer',
      res.body?.data?.questions?.[0]
    );
  }

  console.log('\n── 5. The typed-in variations a reader actually uses ──');
  {
    // Lower case, no dashes, spaces: all the same code, and all had to work or
    // the reader is told their own code is wrong.
    // One code each, because a code redeems once — and one reader each, so a
    // second redemption cannot be waved through by the account already having
    // the book.
    const forms: [string, string][] = [
      ['aaaa-bbbb-cccc-ddd1', 'lower case'],
      ['AAAABBBBCCCCDDD2', 'no dashes'],
      ['AAAA BBBB CCCC DDD3', 'spaces'],
      ['  AAAA-BBBB-CCCC-DDD4  ', 'stray spaces around it'],
    ];

    for (let i = 0; i < forms.length; i++) {
      const [typed, label] = forms[i];
      const stored = `AAAA-BBBB-CCCC-DDD${i + 1}`;
      await BookCopy.create({ code: stored, book: book._id, serial: 10 + i, released: true });

      const e = `reader${i}@test.com`;
      await api().post('/api/auth/register').send({
        firstName: 'T', lastName: 'U', email: e, password: 'pass1234', whatsappNumber: '01712345678',
      });
      const lg = await api().post('/api/auth/login').send({ email: e, password: 'pass1234' });
      const tk = lg.body?.data?.accessToken || lg.body?.accessToken;

      const res = await api()
        .post('/api/book-copies/redeem')
        .set('Authorization', `Bearer ${tk}`)
        .send({ code: typed, fullName: 'T' });
      check(res.status === 200, `typed ${label}`, res.body?.message);

      // Redeeming is only half of it. The reader's next move is the scan, and
      // that is where the complaint lands.
      const scan = await api()
        .get('/api/book-content/scan/DEMOSCAN')
        .set('Authorization', `Bearer ${tk}`);
      check(scan.status === 200, `  …and the QR then opens (${label})`, scan.status);
    }
  }

  console.log('\n── 6. Signed OUT, the same QR ─────────────────────────');
  {
    // What a phone camera does. Must be refused — and this is the screen the
    // shop was reading as "activation is broken".
    const res = await api().get('/api/book-content/scan/DEMOSCAN');
    check(res.status === 403, 'a signed-out scan is locked', res.status);
  }

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
