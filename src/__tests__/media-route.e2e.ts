/* eslint-disable no-console */
/**
 * HTTP-level check of the protected media route, against the real Express app
 * on an in-memory Mongo. The access RULES are covered in book-access.e2e.ts;
 * what this pins down is the wiring — that the route is mounted, that it does
 * its own auth (it deliberately has no authMiddleware, because an <img> tag
 * cannot send a header), that a real file streams, and that Range works so a
 * phone can seek inside an answer video.
 *
 * Run:  npx ts-node src/__tests__/media-route.e2e.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
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
  const { Order } = await import('../app/modules/order/order.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { signMediaToken } = await import('../app/modules/bookContent/mediaToken');
  const { PROTECTED_MEDIA_DIR } = await import('../app/config/localUpload');

  // A real file on disk, in the protected directory.
  const FILE = 'test-figure.png';
  const BODY = Buffer.from('PNGDATA'.repeat(20)); // 140 bytes
  fs.mkdirSync(PROTECTED_MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROTECTED_MEDIA_DIR, FILE), BODY);

  const book = await Book.create({
    id: 1,
    title: 'Anatomy',
    slug: 'anatomy',
    price: 500,
    author: 'S',
    category: 'medical',
    description: 'x',
  });
  const part = await BookPart.create({ bookId: book._id, title: 'Board II', order: 1 });
  const chapter = await BookChapter.create({
    bookId: book._id,
    partId: part._id,
    title: 'Paid Chapter',
    order: 1,
    isFree: false,
  });
  const topic = await BookTopic.create({
    bookId: book._id,
    partId: part._id,
    chapterId: chapter._id,
    title: 'T',
    order: 1,
    qrCode: 'PAIDMED1',
  });
  await BookQuestion.create({
    bookId: book._id,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '1',
    order: 1,
    images: [`https://x.test/api/book-content/media/${FILE}`],
  });

  const buyer = new mongoose.Types.ObjectId();
  await Order.create({
    user: buyer,
    items: [{ book: book._id, title: 'Anatomy', price: 500, quantity: 1, format: 'printed' }],
    deliveryType: 'printed',
    subtotal: 500,
    total: 500,
    shippingAddress: { name: 'x', phone: '01700000000', address: 'a', city: 'Dhaka' },
    payment: { status: 'paid', method: 'cod' },
    status: 'delivered',
  });
  const stranger = new mongoose.Types.ObjectId();

  const URL = `/api/book-content/media/${FILE}`;

  console.log('\n── The old public path must no longer serve answer media ──');
  {
    const res = await request(app).get(`/uploads/protected/${FILE}`);
    check(res.status === 404, `GET /uploads/protected/${FILE} → 404 (static mount is narrowed)`);
  }

  console.log('\n── Auth ──');
  check((await request(app).get(URL)).status === 401, 'no token → 401');
  check(
    (await request(app).get(`${URL}?t=garbage`)).status === 401,
    'garbage token → 401'
  );

  console.log('\n── Access ──');
  {
    const res = await request(app).get(`${URL}?t=${signMediaToken(String(stranger))}`);
    check(res.status === 403, 'valid token, no purchase → 403');
  }
  {
    const res = await request(app).get(`${URL}?t=${signMediaToken(String(buyer))}`);
    check(res.status === 200, 'delivered buyer → 200');
    check(res.headers['content-type'] === 'image/png', 'Content-Type is image/png');
    check(res.headers['cache-control']?.includes('private'), 'Cache-Control is private');
    check(res.headers['accept-ranges'] === 'bytes', 'Accept-Ranges advertised');
    check(Buffer.compare(res.body, BODY) === 0, 'bytes served are the bytes on disk');
  }

  console.log('\n── Range (video seeking) ──');
  {
    const res = await request(app)
      .get(`${URL}?t=${signMediaToken(String(buyer))}`)
      .set('Range', 'bytes=0-9');
    check(res.status === 206, 'Range request → 206 Partial Content');
    check(
      res.headers['content-range'] === `bytes 0-9/${BODY.length}`,
      'Content-Range header is correct'
    );
    check(res.body.length === 10, 'exactly the requested 10 bytes come back');
  }
  {
    const res = await request(app)
      .get(`${URL}?t=${signMediaToken(String(buyer))}`)
      .set('Range', `bytes=${BODY.length + 50}-`);
    check(res.status === 416, 'out-of-range request → 416');
  }

  console.log('\n── Path traversal ──');
  for (const attack of ['..%2F..%2Fpackage.json', '..%5C..%5Cpackage.json']) {
    const res = await request(app).get(
      `/api/book-content/media/${attack}?t=${signMediaToken(String(buyer))}`
    );
    check(res.status !== 200, `traversal "${attack}" refused (got ${res.status})`);
  }
  {
    const res = await request(app).get(
      `/api/book-content/media/nonexistent.png?t=${signMediaToken(String(buyer))}`
    );
    check(res.status === 403, 'unreferenced filename → 403 before touching disk');
  }

  console.log('\n── Scan stamps the URL so the <img> can authenticate ──');
  {
    const { BookContentService } = await import(
      '../app/modules/bookContent/bookContent.service'
    );
    const r = await BookContentService.scanTopic('PAIDMED1', String(buyer));
    const data = (r as { data: any }).data;
    const src: string = data.questions[0].images[0];
    check(src.includes('?t='), 'scan response stamps the image URL with a token');

    // The stamped URL must actually work — this is the whole contract.
    const res = await request(app).get(src.replace('https://x.test', ''));
    check(res.status === 200, 'the stamped URL from the scan response really serves the file');
  }

  fs.unlinkSync(path.join(PROTECTED_MEDIA_DIR, FILE));
  console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('Harness error:', e);
  process.exit(1);
});
