/* eslint-disable no-console */
/**
 * The small copies of a figure — that they are made, that they are much
 * lighter, that the original is left alone, and that asking for one does not
 * get anybody past the access check.
 *
 * Real Express app on an in-memory Mongo, real images made with sharp; never
 * the live DB and never the live uploads folder.
 *
 * Run:  npx ts-node --transpile-only src/__tests__/media-variants.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

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
const kb = (n: number) => `${Math.round(n / 102.4) / 10} KB`;

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
  const { signMediaToken } = await import('../app/modules/bookContent/mediaToken');
  const { PROTECTED_MEDIA_DIR, MATERIALS_DIR } = await import('../app/config/localUpload');

  // A figure the size a phone camera produces: 2400×1800, detailed enough that
  // it does not compress away to nothing.
  const FIGURE = `test-${Date.now()}-figure.jpg`;
  const figurePath = path.join(PROTECTED_MEDIA_DIR, FIGURE);
  fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });
  await sharp({
    create: { width: 2400, height: 1800, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } },
  })
    .jpeg({ quality: 90 })
    .toFile(figurePath);
  const originalBytes = fs.readFileSync(figurePath);
  const originalHash = crypto.createHash('sha1').update(originalBytes).digest('hex');
  console.log(`\nfigure on disk: ${kb(originalBytes.length)}`);

  const book = await Book.create({
    id: 1, title: 'Anatomy', slug: 'anatomy', price: 500, author: 'S', category: 'medical', description: 'x',
  });
  const part = await BookPart.create({ bookId: book._id, title: 'Board II', order: 1 });
  const chapter = await BookChapter.create({
    bookId: book._id, partId: part._id, title: 'Paid Chapter', order: 1, isFree: false,
  });
  const topic = await BookTopic.create({
    bookId: book._id, partId: part._id, chapterId: chapter._id, title: 'T', order: 1, qrCode: 'VARIANT1',
  });
  await BookQuestion.create({
    bookId: book._id,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '1',
    order: 1,
    images: [`https://x.test/api/book-content/media/${FIGURE}`],
  });

  const buyer = new mongoose.Types.ObjectId();
  await BookAccess.create({ userId: buyer, bookId: book._id, source: 'manual' });
  const stranger = new mongoose.Types.ObjectId();
  const asBuyer = `?t=${signMediaToken(String(buyer))}`;

  const media = (name: string) => `/api/book-content/media/${name}`;

  console.log('\n── The copies are made on first request ──');
  let thumbLength = 0;
  let viewLength = 0;
  {
    const res = await request(app).get(media(`${FIGURE}.thumb.webp`) + asBuyer);
    thumbLength = res.body.length;
    check(res.status === 200, 'thumbnail → 200');
    check(res.headers['content-type'] === 'image/webp', 'served as image/webp');
    check(
      fs.existsSync(`${figurePath}.thumb.webp`),
      'the copy is now on disk, so the next reader pays nothing'
    );
    check(
      thumbLength > 0 && thumbLength < originalBytes.length / 10,
      `thumbnail is at least ten times lighter (${kb(thumbLength)} vs ${kb(originalBytes.length)})`,
      { thumbLength }
    );
  }
  {
    const res = await request(app).get(media(`${FIGURE}.view.webp`) + asBuyer);
    viewLength = res.body.length;
    check(res.status === 200, 'view copy → 200');
    check(
      viewLength > thumbLength && viewLength < originalBytes.length / 2,
      `view copy sits between the two (${kb(viewLength)})`,
      { viewLength }
    );
  }

  console.log('\n── The original is untouched ──');
  {
    const again = fs.readFileSync(figurePath);
    check(
      crypto.createHash('sha1').update(again).digest('hex') === originalHash,
      'the uploaded file is byte-for-byte what it was'
    );
    const res = await request(app).get(media(FIGURE) + asBuyer);
    check(res.status === 200 && res.headers['content-type'] === 'image/jpeg', 'and still serves itself');
  }

  console.log('\n── A copy is no way around the access check ──');
  {
    const res = await request(app).get(media(`${FIGURE}.thumb.webp`) + `?t=${signMediaToken(String(stranger))}`);
    check(res.status === 403, 'someone without the book → 403 for the copy too');
  }
  {
    const res = await request(app).get(media(`${FIGURE}.thumb.webp`));
    check(res.status === 401, 'no token → 401');
  }
  {
    // The name is checked against the file it was made from, so a copy of
    // something that is not in any answer is refused like the thing itself.
    const res = await request(app).get(media('never-uploaded.jpg.thumb.webp') + asBuyer);
    check(res.status === 403, 'a copy of a file no answer holds → 403');
  }

  console.log('\n── Asked twice, sent once ──');
  {
    const first = await request(app).get(media(`${FIGURE}.thumb.webp`) + asBuyer);
    const etag = first.headers.etag;
    check(!!etag, 'the response carries an ETag');
    const second = await request(app)
      .get(media(`${FIGURE}.thumb.webp`) + asBuyer)
      .set('If-None-Match', etag);
    check(second.status === 304, 'the browser asking "still the same?" gets 304, not the bytes again');
  }

  console.log('\n── Range still works on a copy ──');
  {
    const res = await request(app)
      .get(media(`${FIGURE}.view.webp`) + asBuyer)
      .set('Range', 'bytes=0-99');
    check(res.status === 206 && res.body.length === 100, 'Range request → 206 with the 100 bytes asked for');
  }

  console.log('\n── Public pictures get copies too, with no token ──');
  {
    const COVER = `test-${Date.now()}-cover.png`;
    fs.mkdirSync(MATERIALS_DIR, { recursive: true });
    await sharp({ create: { width: 2000, height: 2600, channels: 3, background: '#2b6cb0' } })
      .png()
      .toFile(path.join(MATERIALS_DIR, COVER));
    const originalCover = fs.statSync(path.join(MATERIALS_DIR, COVER)).size;
    const res = await request(app).get(`/uploads/materials/${COVER}.view.webp`);
    check(res.status === 200, 'cover copy → 200 without any token');
    check(
      res.body.length < originalCover,
      `and it is lighter (${kb(res.body.length)} vs ${kb(originalCover)})`
    );
    fs.rmSync(path.join(MATERIALS_DIR, COVER), { force: true });
    fs.rmSync(path.join(MATERIALS_DIR, `${COVER}.view.webp`), { force: true });
    fs.rmSync(path.join(MATERIALS_DIR, `${COVER}.thumb.webp`), { force: true });
  }

  // Tidy up the files this test wrote.
  for (const name of [FIGURE, `${FIGURE}.thumb.webp`, `${FIGURE}.view.webp`]) {
    fs.rmSync(path.join(PROTECTED_MEDIA_DIR, name), { force: true });
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
