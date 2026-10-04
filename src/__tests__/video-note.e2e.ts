/* eslint-disable no-console */
/**
 * What a question says where its video would be.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the LIVE production database, and a test that wrote
 * notes there would put words in front of real readers.
 *
 * What is being pinned down:
 *   • a question with no note falls back to the built-in line (the field is
 *     empty, and the reader page supplies the default) — every question that
 *     existed before this feature must be untouched
 *   • a note the admin wrote reaches the reader through scanTopic, which
 *     selects an explicit field list and would otherwise silently drop it
 *   • getVideoNotes offers back what the book already uses, once each, and
 *     forgets a message as soon as the last question using it stops
 *   • one question's note is its own: picking the same text elsewhere copies
 *     it rather than linking to it
 *
 * Run: npx ts-node src/__tests__/video-note.e2e.ts
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

const SOON = 'এই প্রশ্নের ভিডিও শীঘ্রই যোগ করা হবে ইনশাআল্লাহ।';
const RECORDING = 'ক্লাস রেকর্ডিং চলছে, কয়েক দিনের মধ্যে পাওয়া যাবে।';

async function main() {
  const mongod = await MongoMemoryServer.create();
  // Before the first import that reaches config: nothing here may open the
  // live connection string sitting in .env.
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'video-note-test' });

  const { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');

  const bookId = new mongoose.Types.ObjectId();
  const part = await BookPart.create({ bookId, title: 'Board I', order: 1 });
  // isFree so scanTopic answers without a purchase — this suite is about the
  // note, not about who may read it.
  const chapter = await BookChapter.create({
    bookId,
    partId: part._id,
    chapterNo: '1',
    title: 'CNS and Eyeball',
    order: 1,
    isFree: true,
  });
  const qrCode = generateQrCode();
  const topic = await BookTopic.create({
    bookId,
    partId: part._id,
    chapterId: chapter._id,
    topicNo: '1.1',
    title: 'Cerebrum',
    qrCode,
    order: 1,
  });

  const makeQuestion = (no: string, order: number) =>
    BookQuestion.create({
      bookId,
      chapterId: chapter._id,
      topicId: topic._id,
      questionNo: no,
      questionText: `Cerebrum — ${no}`,
      order,
    });

  const q1 = await makeQuestion('1', 1);
  const q2 = await makeQuestion('2', 2);
  const q3 = await makeQuestion('3', 3);

  check('a question starts with no note of its own', (q1.videoNote ?? '') === '', {
    videoNote: q1.videoNote,
  });

  // ── A written note reaches the reader ───────────────────────────────────
  await BookContentService.updateQuestion(String(q1._id), { videoNote: `  ${SOON}  ` });
  const saved = await BookQuestion.findById(q1._id).lean();
  check('the note is stored trimmed', saved?.videoNote === SOON, { stored: saved?.videoNote });

  const scan = await BookContentService.scanTopic(qrCode, null);
  check('a free topic still scans', scan.ok === true, scan.ok ? undefined : scan);
  const questions = (scan.ok ? (scan.data.questions as Array<Record<string, unknown>>) : []) ?? [];
  check(
    'and the reader is handed the note — scanTopic selects fields by name',
    questions[0]?.videoNote === SOON,
    { got: questions[0]?.videoNote }
  );
  check(
    'questions nobody wrote a note for carry an empty one, not someone elseʼs',
    questions[1]?.videoNote === '' && questions[2]?.videoNote === '',
    { second: questions[1]?.videoNote, third: questions[2]?.videoNote }
  );

  // ── The list the editor offers back ─────────────────────────────────────
  let notes = await BookContentService.getVideoNotes(String(bookId));
  check('the book offers back the one note it uses', notes.join('|') === SOON, { notes });

  // Picking the same message for another question copies the text; there is no
  // shared row to point at.
  await BookContentService.updateQuestion(String(q2._id), { videoNote: SOON });
  notes = await BookContentService.getVideoNotes(String(bookId));
  check('two questions using it list it once', notes.length === 1, { notes });

  await BookContentService.updateQuestion(String(q3._id), { videoNote: RECORDING });
  notes = await BookContentService.getVideoNotes(String(bookId));
  check('a second message joins the list', notes.length === 2 && notes.includes(RECORDING), {
    notes,
  });

  // ── Independence, and forgetting ────────────────────────────────────────
  await BookContentService.updateQuestion(String(q1._id), { videoNote: 'অন্য কিছু।' });
  const untouched = await BookQuestion.findById(q2._id).lean();
  check(
    'editing one question leaves the other saying what it said',
    untouched?.videoNote === SOON,
    { other: untouched?.videoNote }
  );

  await BookContentService.updateQuestion(String(q3._id), { videoNote: '' });
  notes = await BookContentService.getVideoNotes(String(bookId));
  check(
    'a message stops being offered once nothing uses it',
    !notes.includes(RECORDING),
    { notes }
  );

  await BookContentService.deleteQuestion(String(q1._id));
  notes = await BookContentService.getVideoNotes(String(bookId));
  check(
    'and a deleted questionʼs message goes with it',
    !notes.includes('অন্য কিছু।') && notes.includes(SOON),
    { notes }
  );

  // A note belonging to another book is none of this bookʼs business.
  const otherBook = new mongoose.Types.ObjectId();
  await BookQuestion.create({
    bookId: otherBook,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '1',
    order: 1,
    videoNote: 'অন্য বইয়ের বার্তা।',
  });
  notes = await BookContentService.getVideoNotes(String(bookId));
  check('another bookʼs message is not offered here', !notes.includes('অন্য বইয়ের বার্তা।'), {
    notes,
  });

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
