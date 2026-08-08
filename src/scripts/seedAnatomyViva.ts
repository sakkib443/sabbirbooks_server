/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * seedAnatomyViva.ts — imports the "Anatomy MAGIC VIVA" structure
 * (parts → chapters → topics → placeholder questions) straight into MongoDB.
 *
 * Run:
 *   npx ts-node --transpile-only src/scripts/seedAnatomyViva.ts
 *
 * Unlike seed-medical.ts this talks to the database directly rather than the
 * HTTP API — it is a one-off structural import, not an endpoint test, and it
 * needs no running server or admin login.
 *
 * IDEMPOTENT. Re-running matches on structural keys — (bookId, part order),
 * (partId, chapterNo), (chapterId, topicNo), (topicId, questionNo) — never on
 * titles, so fixing a typo in the outline updates a row instead of duplicating
 * it. Existing answers are never overwritten.
 *
 * QR CODES ARE NEVER REGENERATED. Once a code is printed in a book it is
 * permanent; this script only ever assigns one to a topic that has none.
 */
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../app/config';
import { dbConnect } from '../app/utils/dbConnect';
import { Book } from '../app/modules/book/book.model';
import {
  BookPart,
  BookChapter,
  BookTopic,
  BookQuestion,
  generateQrCode,
} from '../app/modules/bookContent/bookContent.model';

const BOOK_TITLE = 'Anatomy MAGIC VIVA';
const OUTLINE_PATH = path.join(__dirname, 'anatomy-viva-outline.json');

type OutlineTopic = { no: string; title: string; questionCount: number | null };
type OutlineChapter = { no: string; title: string; topics: OutlineTopic[] };
type OutlinePart = { order: number; title: string; chapters: OutlineChapter[] };
type Outline = { book: string; parts: OutlinePart[] };

const stats = {
  partsCreated: 0,
  partsFound: 0,
  chaptersCreated: 0,
  chaptersFound: 0,
  topicsCreated: 0,
  topicsFound: 0,
  implicitTopics: 0,
  questionsCreated: 0,
  questionsFound: 0,
  qrAssigned: 0,
};

/** Unique across the collection, so retry on the (vanishingly rare) collision. */
async function uniqueQrCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateQrCode();
    const clash = await BookTopic.exists({ qrCode: code });
    if (!clash) return code;
  }
  throw new Error('Could not generate a unique QR code after 10 attempts');
}

async function seed() {
  const outline: Outline = JSON.parse(fs.readFileSync(OUTLINE_PATH, 'utf8'));

  // ─── Book ───────────────────────────────────────────────
  let book = await Book.findOne({ title: BOOK_TITLE });
  if (!book) {
    // `id` is a required unique number and is not auto-generated.
    const last = await Book.findOne().sort({ id: -1 }).select('id').lean();
    book = await Book.create({
      id: (last?.id ?? 0) + 1,
      title: BOOK_TITLE,
      slug: 'anatomy-magic-viva',
      description: 'Medical viva preparation — QR-linked question bank.',
      language: 'both',
      format: 'printed',
      status: 'draft',
    });
    console.log(`📕 Book created: ${BOOK_TITLE} (id ${book.id})`);
  } else {
    console.log(`📕 Book found: ${BOOK_TITLE}`);
  }

  const bookId = book._id;

  for (const [partIndex, oPart] of outline.parts.entries()) {
    // ─── Part ─────────────────────────────────────────────
    const partOrder = oPart.order ?? partIndex + 1;
    let part = await BookPart.findOne({ bookId, order: partOrder, isDeleted: false });
    if (!part) {
      part = await BookPart.create({ bookId, title: oPart.title, order: partOrder });
      stats.partsCreated++;
    } else {
      if (part.title !== oPart.title) await BookPart.updateOne({ _id: part._id }, { title: oPart.title });
      stats.partsFound++;
    }

    for (const [chapterIndex, oChapter] of oPart.chapters.entries()) {
      // ─── Chapter ────────────────────────────────────────
      // Keyed on partId, not bookId: "General Histology" is chapter 5 of
      // Board I and chapter 3 of Board II, and both restart numbering at 1.
      let chapter = await BookChapter.findOne({
        partId: part._id,
        chapterNo: oChapter.no,
        isDeleted: false,
      });
      if (!chapter) {
        chapter = await BookChapter.create({
          bookId,
          partId: part._id,
          chapterNo: oChapter.no,
          title: oChapter.title,
          order: chapterIndex + 1,
        });
        stats.chaptersCreated++;
      } else {
        if (chapter.title !== oChapter.title) {
          await BookChapter.updateOne({ _id: chapter._id }, { title: oChapter.title });
        }
        stats.chaptersFound++;
      }

      // A chapter with no sub-topics still needs somewhere to hang its QR, so
      // it gets one topic named after the chapter, flagged isImplicit.
      const topicsToImport: (OutlineTopic & { implicit?: boolean })[] =
        oChapter.topics.length > 0
          ? oChapter.topics
          : [{ no: oChapter.no, title: oChapter.title, questionCount: null, implicit: true }];

      for (const [topicIndex, oTopic] of topicsToImport.entries()) {
        // ─── Topic ────────────────────────────────────────
        let topic = await BookTopic.findOne({
          chapterId: chapter._id,
          topicNo: oTopic.no,
          isDeleted: false,
        });

        if (!topic) {
          topic = await BookTopic.create({
            bookId,
            partId: part._id,
            chapterId: chapter._id,
            topicNo: oTopic.no,
            title: oTopic.title,
            isImplicit: Boolean(oTopic.implicit),
            qrCode: await uniqueQrCode(),
            order: topicIndex + 1,
          });
          stats.topicsCreated++;
          stats.qrAssigned++;
          if (oTopic.implicit) stats.implicitTopics++;
        } else {
          if (topic.title !== oTopic.title) {
            await BookTopic.updateOne({ _id: topic._id }, { title: oTopic.title });
          }
          // Backfill only — an existing code is never touched.
          if (!topic.qrCode) {
            await BookTopic.updateOne({ _id: topic._id }, { qrCode: await uniqueQrCode() });
            stats.qrAssigned++;
          }
          stats.topicsFound++;
          if (topic.isImplicit) stats.implicitTopics++;
        }

        // ─── Placeholder questions ────────────────────────
        // The outline gives counts, not text. These are numbered shells the
        // admin fills in; topics with an unknown count get none.
        const count = oTopic.questionCount ?? 0;
        for (let n = 1; n <= count; n++) {
          const questionNo = String(n);
          const existing = await BookQuestion.findOne({
            topicId: topic._id,
            questionNo,
            isDeleted: false,
          }).select('_id');

          if (existing) {
            stats.questionsFound++;
            continue;
          }

          await BookQuestion.create({
            bookId,
            chapterId: chapter._id,
            topicId: topic._id,
            questionNo,
            order: n,
          });
          stats.questionsCreated++;
        }
      }
    }
  }

  console.log('\n─── Import summary ───');
  console.log(`parts     : ${stats.partsCreated} created, ${stats.partsFound} already present`);
  console.log(`chapters  : ${stats.chaptersCreated} created, ${stats.chaptersFound} already present`);
  console.log(
    `topics    : ${stats.topicsCreated} created, ${stats.topicsFound} already present ` +
      `(${stats.implicitTopics} implicit)`
  );
  console.log(`questions : ${stats.questionsCreated} created, ${stats.questionsFound} already present`);
  console.log(`QR codes  : ${stats.qrAssigned} newly assigned`);

  const totals = {
    parts: await BookPart.countDocuments({ bookId, isDeleted: false }),
    chapters: await BookChapter.countDocuments({ bookId, isDeleted: false }),
    topics: await BookTopic.countDocuments({ bookId, isDeleted: false }),
    questions: await BookQuestion.countDocuments({ bookId, isDeleted: false }),
  };
  console.log('\n─── Now in the database ───');
  console.log(`${totals.parts} parts · ${totals.chapters} chapters · ${totals.topics} topics ` +
    `(= ${totals.topics} QR codes) · ${totals.questions} questions`);
}

(async () => {
  if (!config.database_url) {
    console.error('❌ DATABASE_URL is not set. Add it to .env before running this script.');
    process.exit(1);
  }
  try {
    await dbConnect();
    await seed();
  } catch (error) {
    console.error('❌ Import failed:', (error as Error)?.message);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
})();
