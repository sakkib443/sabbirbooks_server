/* eslint-disable no-console */
/**
 * A throwaway API on port 5000, backed by an in-memory MongoDB seeded with the
 * real book outline.
 *
 * For looking at the shop's landing page locally. The alternative — pointing a
 * local server at DATABASE_URL — aims a write-capable API at the LIVE database
 * this project's .env configures, so a stray request from a dev build lands on
 * a customer's data. This never touches it: the URI is replaced before the app
 * is imported, and everything disappears when the process exits.
 *
 * Run: npx ts-node --transpile-only src/scripts/demoServer.ts
 */
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

interface OutlineTopic {
  no: string;
  title: string;
  questionCount: number | null;
}
interface OutlineChapter {
  no: string;
  title: string;
  topics: OutlineTopic[];
}
interface OutlineFile {
  parts: { order: number; title: string; chapters: OutlineChapter[] }[];
}

// The chapter the live database has flagged isFree. The bundled outline JSON is
// an older, shorter cut of the book and does not always contain it, so the
// seeder falls back to the first chapter that actually has topics — the demo is
// pointless without one free chapter to open.
const FREE_CHAPTER_TITLE = 'Inferior Extremity';

/** The live shop's public uploads mount — cover art, preview pages, sample PDF. */
const LIVE_UPLOADS =
  'https://sxygeronwx1p799pbax4t4lv.164.68.126.31.sslip.io/uploads/materials';

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'demo' });

  const { Book } = await import('../app/modules/book/book.model');
  const { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } = await import(
    '../app/modules/bookContent/bookContent.model'
  );

  const outline: OutlineFile = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'anatomy-viva-outline.json'), 'utf8')
  );

  const book = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    author: 'Dr. Sabbir',
    description: 'Medical viva preparation — QR-linked question bank.',
    price: 600,
    format: 'printed',
    stock: 500,
    status: 'published',
    isFeatured: true,
    // Named offers, to exercise the new system: a 25% headline "ঈদ অফার" everyone
    // gets, plus 10% more for paying online instead of cash on delivery.
    offers: {
      normal: { enabled: true, label: 'ঈদ অফার', type: 'fixed', amount: 100 },
      preorder: { enabled: false, label: '', type: 'percent', percent: 25 },
      online: { enabled: true, label: 'অনলাইন পেমেন্টে ছাড়', type: 'fixed', amount: 50 },
    },
    // The real public assets from the live shop, so the landing page can be
    // looked at as a customer actually sees it. These are served from the
    // world-readable uploads mount, so no token is involved.
    //
    // coverImage is the actual book COVER — the branded "MAGIC VIVA ANATOMY"
    // artwork. The earlier demo pointed this at 1786737752647-1.png, which is a
    // preview PAGE from inside the book, not its cover; that is what put a book
    // page on the left of the hero. The preview pages belong in previewImages,
    // where the "inside pages" fallback uses them.
    coverImage: `${LIVE_UPLOADS}/1787724655555-magic_viva_final.jpeg`,
    previewImages: [`${LIVE_UPLOADS}/1786737752647-1.png`, `${LIVE_UPLOADS}/1786737752892-2.png`],
    previewPdfUrl: `${LIVE_UPLOADS}/1787732330496-MAGIC_VIVA_Inferior_Extremity.pdf`,
    promoVideoUrl: 'https://www.youtube.com/watch?v=O_DVYk1WvuE',
  });

  let topicsMade = 0;
  let questionsMade = 0;

  const allChapters = outline.parts.flatMap((p) => p.chapters);
  const freeTitle =
    allChapters.find((c) => c.title === FREE_CHAPTER_TITLE)?.title ??
    allChapters.find((c) => c.topics.length > 0)?.title;

  for (const p of outline.parts) {
    const part = await BookPart.create({ bookId: book._id, title: p.title, order: p.order });

    for (const [ci, ch] of p.chapters.entries()) {
      const chapter = await BookChapter.create({
        bookId: book._id,
        partId: part._id,
        chapterNo: ch.no,
        title: ch.title,
        order: ci + 1,
        isFree: ch.title === freeTitle,
      });

      for (const [ti, t] of ch.topics.entries()) {
        const topic = await BookTopic.create({
          bookId: book._id,
          partId: part._id,
          chapterId: chapter._id,
          topicNo: t.no,
          title: t.title,
          qrCode: generateQrCode(),
          order: ti + 1,
        });
        topicsMade++;

        const n = t.questionCount ?? 0;
        const rows = Array.from({ length: n }, (_, i) => ({
          bookId: book._id,
          chapterId: chapter._id,
          topicId: topic._id,
          questionNo: String(i + 1),
          questionText: `${t.title} — প্রশ্ন ${i + 1}`,
          answerHtml: `<p>${t.title} সম্পর্কিত উত্তর।</p>`,
          order: i + 1,
        }));
        if (rows.length) {
          await BookQuestion.insertMany(rows);
          questionsMade += rows.length;
        }
      }
    }
  }

  // An admin, so the dashboard can be driven against this data too — the
  // content editor is where most of the reported bugs live, and it cannot be
  // reached without one.
  const { User } = await import('../app/modules/user/user.model');
  await User.create({
    id: 'ADM-demo',
    email: 'admin@demo.local',
    firstName: 'Demo',
    lastName: 'Admin',
    password: 'demo1234',
    role: 'admin',
    status: 'active',
  });

  // A student whose medical college snapshotted a district + division, so the
  // checkout address prefill can be seen filling the cascade.
  const student = await User.create({
    id: 'STU-demo',
    email: 'student@demo.local',
    firstName: 'Demo',
    lastName: 'Student',
    password: 'demo1234',
    role: 'student',
    status: 'active',
    whatsappNumber: '01711000000',
    medicalCollegeName: 'Khulna Medical College',
    district: 'খুলনা',
    division: 'খুলনা',
    upazila: 'খুলনা সদর',
  });

  // Seed book orders across the current month so the admin dashboard shows real
  // counts, a today figure, and a revenue curve. Dates are set explicitly, so
  // insertMany runs with timestamps off.
  const { Order } = await import('../app/modules/order/order.model');
  const nowDate = new Date();
  const yr = nowDate.getFullYear();
  const mo = nowDate.getMonth();
  const today = nowDate.getDate();
  const UNIT = 450;
  const DELIVERY = 60;
  const spread = ['delivered', 'paid', 'processing', 'shipped', 'delivered', 'delivered'];

  const makeOrder = (idx: number, created: Date, status: string) => {
    const qty = 1 + (idx % 3 === 0 ? 1 : 0);
    const subtotal = UNIT * qty;
    return {
      orderNumber: `ORD-DEMO-${idx}`,
      orderSeq: idx,
      user: student._id,
      items: [{ book: book._id, title: book.title, price: UNIT, quantity: qty, format: 'printed' }],
      deliveryType: 'printed',
      shippingAddress: {
        name: 'Demo Buyer',
        phone: '01700000000',
        address: 'House 1, Road 2',
        city: 'সিলেট সদর',
        upazila: 'সিলেট সদর',
        district: 'সিলেট',
        division: 'সিলেট',
        area: 'outside-dhaka',
      },
      subtotal,
      discount: 0,
      deliveryCharge: DELIVERY,
      total: subtotal + DELIVERY,
      payment: { status: status === 'pending' ? 'pending' : 'paid' },
      status,
      createdAt: created,
      updatedAt: created,
    };
  };

  const orders: ReturnType<typeof makeOrder>[] = [];
  let seq = 1;
  // Spread ~20 confirmed orders over days already passed this month.
  for (let i = 0; i < 20; i++) {
    const day = 1 + Math.floor((i / 20) * Math.max(today - 1, 1));
    const created = new Date(yr, mo, day, 9 + (i % 9), (i * 7) % 60);
    orders.push(makeOrder(seq++, created, spread[i % spread.length]));
  }
  // A handful placed today — some new (pending), some confirmed.
  for (let i = 0; i < 5; i++) {
    const created = new Date(yr, mo, today, 8 + i * 2, (i * 13) % 60);
    orders.push(makeOrder(seq++, created, i < 3 ? 'pending' : 'delivered'));
  }
  // A couple more pending from earlier this week, so "new orders" isn't just today.
  for (let i = 0; i < 2; i++) {
    const created = new Date(yr, mo, Math.max(today - 2 - i, 1), 12, 0);
    orders.push(makeOrder(seq++, created, 'pending'));
  }
  await Order.insertMany(orders, { timestamps: false } as never);

  const { default: app } = await import('../app');

  // One code from each side of the paywall, printed so the open/closed pair can
  // be checked by hand — the free one must answer 200 without a token and the
  // paid one must answer 401.
  const [freeSample, paidSample] = await Promise.all([
    BookTopic.findOne({ chapterId: { $in: await BookChapter.find({ isFree: true }).distinct('_id') } })
      .select('qrCode title')
      .lean(),
    BookTopic.findOne({ chapterId: { $in: await BookChapter.find({ isFree: false }).distinct('_id') } })
      .select('qrCode title')
      .lean(),
  ]);

  app.listen(5000, () => {
    console.log(`\nDemo API on http://localhost:5000`);
    console.log(`  ${outline.parts.length} parts · ${topicsMade} topics · ${questionsMade} questions`);
    console.log(`  free chapter: ${freeTitle}`);
    console.log(`  free topic code: ${freeSample?.qrCode} (${freeSample?.title})`);
    console.log(`  paid topic code: ${paidSample?.qrCode} (${paidSample?.title})`);
    console.log(`  in-memory only — the live database was never opened\n`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
