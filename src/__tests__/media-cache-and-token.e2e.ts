/* eslint-disable no-console */
/**
 * Two things that decide how much a reader downloads twice:
 *
 *   1. The media token is the same all day, so an image URL is the same URL on
 *      the next visit and the browser's cache can match it.
 *   2. The access check behind each image is remembered for a few minutes, so
 *      six figures on a page do not ask the database the same questions six
 *      times over.
 *
 * Real Express app on an in-memory Mongo; never the live DB.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/media-cache-and-token.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

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

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  const { default: app } = await import('../app');
  const { dbConnect } = await import('../app/utils/dbConnect');
  await dbConnect();

  const { Book } = await import('../app/modules/book/book.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookAccess } = await import('../app/modules/bookAccess/bookAccess.model');
  const { signMediaToken, verifyMediaToken } = await import('../app/modules/bookContent/mediaToken');
  const { PROTECTED_MEDIA_DIR } = await import('../app/config/localUpload');

  const FILE = `cache-${Date.now()}-figure.png`;
  fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROTECTED_MEDIA_DIR, FILE), Buffer.from('PNG'.repeat(40)));

  const book = await Book.create({
    id: 1, title: 'Anatomy', slug: 'anatomy', price: 500, author: 'S', category: 'medical', description: 'x',
  });
  const part = await BookPart.create({ bookId: book._id, title: 'Board I', order: 1 });
  const chapter = await BookChapter.create({
    bookId: book._id, partId: part._id, title: 'Paid', order: 1, isFree: false,
  });
  const topic = await BookTopic.create({
    bookId: book._id, partId: part._id, chapterId: chapter._id, title: 'T', order: 1, qrCode: 'CACHE001',
  });
  await BookQuestion.create({
    bookId: book._id, chapterId: chapter._id, topicId: topic._id, questionNo: '1', order: 1,
    images: [`https://x.test/api/book-content/media/${FILE}`],
  });

  const buyer = new mongoose.Types.ObjectId();
  await BookAccess.create({ userId: buyer, bookId: book._id, source: 'manual' });
  const stranger = new mongoose.Types.ObjectId();
  const url = `/api/book-content/media/${FILE}`;

  console.log('\n── The same reader gets the same URL ──');
  {
    const first = signMediaToken(String(buyer));
    await new Promise((r) => setTimeout(r, 1100)); // a second later, on purpose
    const second = signMediaToken(String(buyer));
    check(first === second, 'a token minted a second apart is the same string');
    check(verifyMediaToken(first) === String(buyer), 'and it still verifies to its reader');
    check(signMediaToken(String(stranger)) !== first, "another reader's token is different");
  }

  console.log('\n── A second scan hands back the identical image URL ──');
  {
    const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');
    const scan = async () => {
      const result = await BookContentService.scanTopic('CACHE001', String(buyer));
      return (result as { data: { questions: { images: string[] }[] } }).data.questions[0].images[0];
    };
    const urlA = await scan();
    await new Promise((r) => setTimeout(r, 1100));
    const urlB = await scan();
    check(!!urlA && urlA === urlB, 'the image URL is byte-for-byte the same', { urlA, urlB });
    check(/\?t=/.test(urlA || ''), 'and it still carries its media token');
    // The whole point: the browser may keep it, and the URL it kept still works.
    const res = await request(app).get(urlB.replace(/^https?:\/\/[^/]+/, ''));
    check(res.status === 200, 'and the URL a browser cached yesterday still serves the file');
  }

  console.log('\n── The check behind each picture is asked once, not per picture ──');
  {
    // Start cold: the requests above have already warmed the memory.
    const { fileOwnerCache, readerAccessCache } = await import(
      '../app/modules/bookContent/mediaAccessCache'
    );
    fileOwnerCache.clear();
    readerAccessCache.clear();

    // Count what the database is actually asked, per request.
    const ops: string[] = [];
    mongoose.set('debug', (collection: string, method: string) => {
      ops.push(`${collection}.${method}`);
    });

    const token = signMediaToken(String(buyer));
    ops.length = 0;
    const first = await request(app).get(`${url}?t=${token}`);
    const firstOps = [...ops];

    ops.length = 0;
    const second = await request(app).get(`${url}?t=${token}`);
    const secondOps = [...ops];

    mongoose.set('debug', false);

    check(first.status === 200 && second.status === 200, 'both requests serve the file');
    check(firstOps.length > 0, `the first asks the database (${firstOps.length}: ${firstOps.join(', ')})`);
    check(
      secondOps.length === 0,
      `the second asks it nothing (${secondOps.length}: ${secondOps.join(', ') || 'none'})`,
      secondOps
    );
  }

  console.log('\n── Remembering one reader is not remembering everybody ──');
  {
    const res = await request(app).get(`${url}?t=${signMediaToken(String(stranger))}`);
    check(res.status === 403, "someone else is still refused after the buyer's yes was remembered");
    const none = await request(app).get(url);
    check(none.status === 401, 'and no token is still 401');
  }

  console.log('\n── A file no answer references is still refused ──');
  {
    const res = await request(app).get(
      `/api/book-content/media/not-in-any-answer.png?t=${signMediaToken(String(buyer))}`
    );
    check(res.status === 403, 'unreferenced file → 403 (refusals are never remembered)');
  }

  fs.rmSync(path.join(PROTECTED_MEDIA_DIR, FILE), { force: true });

  console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
