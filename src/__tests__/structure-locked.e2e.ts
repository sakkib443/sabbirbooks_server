/* eslint-disable no-console */
/**
 * Boards, chapters and topics are permanent once the book is printed.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the LIVE production database.
 *
 * Why this file exists as its own suite rather than a few extra checks
 * elsewhere: the printed book has already shipped. Every paper page carries a
 * QR code beside a topic, under a chapter, under a board, and a reader who
 * scans it expects the site to agree with the paper in their hand. A rename or
 * a renumber cannot be undone across thousands of printed copies, so the ban
 * has to hold at the service — not merely be absent from the admin UI, which
 * is one careless `fetch` away from being bypassed.
 *
 * What stays open, and must: `isFree` (the shop's free-sample switch, printed
 * nowhere) and `isPublished` (the ability to withdraw something that should not
 * be live). Questions inside a topic remain fully editable — they sit below the
 * QR code, so nothing about them is fixed by the paper.
 *
 * Run: npx ts-node src/__tests__/structure-locked.e2e.ts
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

/** The message a call threw, or null when it wrongly succeeded. */
const rejection = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'structure-locked-test' });

  const { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');

  const bookId = new mongoose.Types.ObjectId();

  const part = await BookPart.create({ bookId, title: 'Board I', titleBn: 'বোর্ড ১', order: 1 });
  const chapter = await BookChapter.create({
    bookId,
    partId: part._id,
    chapterNo: '3',
    title: 'Inferior Extremity',
    order: 3,
    isFree: false,
  });
  const topic = await BookTopic.create({
    bookId,
    partId: part._id,
    chapterId: chapter._id,
    topicNo: '3.1',
    title: 'Front of thigh',
    qrCode: generateQrCode(),
    order: 1,
  });
  const printedCode = topic.qrCode;

  const secondTopic = await BookTopic.create({
    bookId,
    partId: part._id,
    chapterId: chapter._id,
    topicNo: '3.2',
    title: 'Back of thigh',
    qrCode: generateQrCode(),
    order: 2,
  });

  console.log('\n── a board cannot be renamed or renumbered ────');

  const partRename = await rejection(() =>
    BookContentService.updatePart(String(part._id), { title: 'Board One' })
  );
  check('renaming a board is refused', partRename !== null, partRename);
  check(
    'and says why, naming the printed QR codes',
    Boolean(partRename?.includes('QR')),
    partRename
  );

  const partAfter = await BookPart.findById(part._id).lean();
  check('the title on disk is untouched', partAfter?.title === 'Board I', partAfter?.title);
  check('and so is its order', partAfter?.order === 1, partAfter?.order);

  console.log('\n── a chapter keeps its name and number ────────');

  for (const [label, payload] of [
    ['title', { title: 'Lower Limb' }],
    ['titleBn', { titleBn: 'নিম্নাঙ্গ' }],
    ['chapterNo', { chapterNo: '4' }],
    ['order', { order: 9 }],
  ] as const) {
    const err = await rejection(() =>
      BookContentService.updateChapter(String(chapter._id), payload as Record<string, unknown>)
    );
    check(`changing a chapter's ${label} is refused`, err !== null, err);
  }

  // The dangerous case: a real field smuggled in alongside a permitted one.
  // Refusing the whole request would also block the free switch, so the write
  // goes through with the structural fields stripped out.
  const mixed = await BookContentService.updateChapter(String(chapter._id), {
    isFree: true,
    title: 'Lower Limb',
    chapterNo: '4',
    order: 9,
  });
  check('a mixed payload still applies isFree', mixed?.isFree === true, mixed?.isFree);
  check('but drops the title in the same request', mixed?.title === 'Inferior Extremity', mixed?.title);
  check('and the chapter number', mixed?.chapterNo === '3', mixed?.chapterNo);
  check('and the order', mixed?.order === 3, mixed?.order);

  const unfreed = await BookContentService.updateChapter(String(chapter._id), { isFree: false });
  check('isFree can be turned back off', unfreed?.isFree === false);

  console.log('\n── a topic keeps its name, number and code ────');

  for (const [label, payload] of [
    ['title', { title: 'Anterior thigh' }],
    ['topicNo', { topicNo: '3.9' }],
    ['order', { order: 7 }],
  ] as const) {
    const err = await rejection(() =>
      BookContentService.updateTopic(String(topic._id), payload as Record<string, unknown>)
    );
    check(`changing a topic's ${label} is refused`, err !== null, err);
  }

  // The one that would break a printed page outright.
  const codeAttempt = await rejection(() =>
    BookContentService.updateTopic(String(topic._id), { qrCode: 'AAAAAAAA' })
  );
  check('rewriting a QR code is refused', codeAttempt !== null, codeAttempt);

  const codeSmuggled = await BookContentService.updateTopic(String(topic._id), {
    isPublished: true,
    qrCode: 'AAAAAAAA',
  });
  check('and cannot ride along with a permitted field', codeSmuggled?.qrCode === printedCode, {
    got: codeSmuggled?.qrCode,
    printed: printedCode,
  });

  const topicAfter = await BookTopic.findById(topic._id).lean();
  check('the topic on disk is unchanged', topicAfter?.title === 'Front of thigh', topicAfter?.title);
  check('including its printed code', topicAfter?.qrCode === printedCode);

  console.log('\n── withdrawing something stays possible ──────');

  const withdrawn = await BookContentService.updateChapter(String(chapter._id), {
    isPublished: false,
  });
  check('a chapter can still be unpublished', withdrawn?.isPublished === false);
  await BookContentService.updateChapter(String(chapter._id), { isPublished: true });

  console.log('\n── reordering is for questions only ──────────');

  for (const level of ['parts', 'chapters', 'topics'] as const) {
    const err = await rejection(() =>
      BookContentService.reorder(level, [{ _id: String(topic._id), order: 1 }])
    );
    check(`reorder("${level}") is refused`, err !== null, err);
    check(
      `and explains it is because the order is printed`,
      Boolean(err?.includes('printed')),
      err
    );
  }

  const topicsStill = await BookTopic.find({ chapterId: chapter._id }).sort({ order: 1 }).lean();
  check(
    'the topics kept their printed order',
    topicsStill.map((t) => t.topicNo).join(',') === '3.1,3.2',
    topicsStill.map((t) => t.topicNo)
  );

  console.log('\n── questions are still fully editable ────────');

  const q1 = await BookQuestion.create({
    bookId,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '1',
    questionText: 'First',
    order: 1,
  });
  const q2 = await BookQuestion.create({
    bookId,
    chapterId: chapter._id,
    topicId: topic._id,
    questionNo: '2',
    questionText: 'Second',
    order: 2,
  });

  const editedQ = await BookContentService.updateQuestion(String(q1._id), {
    questionText: 'First, rewritten',
    answerHtml: '<p>An answer</p>',
    images: ['https://x.test/a.png'],
  });
  check('a question can be rewritten', editedQ?.questionText === 'First, rewritten');
  check('its answer can be set', editedQ?.answerHtml?.includes('An answer') === true);
  check('and images attached', editedQ?.images?.length === 1, editedQ?.images);

  const reordered = await rejection(() =>
    BookContentService.reorder(
      'questions',
      [
        { _id: String(q2._id), order: 1 },
        { _id: String(q1._id), order: 2 },
      ],
      String(topic._id)
    )
  );
  check('questions can still be reordered', reordered === null, reordered);

  const order = await BookQuestion.find({ topicId: topic._id }).sort({ order: 1 }).lean();
  check(
    'and the new order stuck',
    order.map((q) => q.questionNo).join(',') === '2,1',
    order.map((q) => q.questionNo)
  );

  await BookContentService.deleteQuestion(String(q2._id));
  const deleted = await BookQuestion.findById(q2._id).lean();
  check('a question can still be deleted', deleted?.isDeleted === true);

  await BookContentService.restoreQuestion(String(q2._id));
  const restored = await BookQuestion.findById(q2._id).lean();
  check('and restored', restored?.isDeleted === false);

  // Nothing above may have disturbed the one thing printed on paper.
  const finalTopic = await BookTopic.findById(topic._id).lean();
  check('the printed QR code is still the same after everything', finalTopic?.qrCode === printedCode);
  check('and still resolves', (await BookContentService.scanTopic(printedCode)).ok !== undefined);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
