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
    offerPrice: 450,
    format: 'printed',
    stock: 500,
    status: 'published',
    isFeatured: true,
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
