/* eslint-disable no-console */
/**
 * Question ordering, deletion and undo.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the LIVE production database, and a test that
 * reordered or soft-deleted rows there would rewrite a printed book's content.
 * DATABASE_URL is overwritten below before anything can read it.
 *
 * What is being pinned down:
 *   • a reorder rewrites `order` within ONE topic and leaves the printed
 *     `questionNo` alone — the serial is on paper and cannot move
 *   • a payload naming ids from two topics is refused outright, so a stale or
 *     malicious client cannot scramble a topic it is not looking at
 *   • an empty or absent `items` comes back as a sentence, not as the mongo
 *     driver's "Invalid BulkOperation, Batch cannot be empty"
 *   • delete → restore round-trips with the answer and every attached file
 *
 * Run: npx ts-node src/__tests__/question-order.e2e.ts
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
  // Before the first import that reaches config: nothing here may open the
  // live connection string sitting in .env.
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'question-order-test' });

  const { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');

  const bookId = new mongoose.Types.ObjectId();
  const part = await BookPart.create({ bookId, title: 'Board I', order: 1 });
  const chapter = await BookChapter.create({
    bookId,
    partId: part._id,
    chapterNo: '1',
    title: 'General Histology',
    order: 1,
  });

  const makeTopic = (title: string, order: number) =>
    BookTopic.create({
      bookId,
      partId: part._id,
      chapterId: chapter._id,
      topicNo: `1.${order}`,
      title,
      qrCode: generateQrCode(),
      order,
    });

  const topicA = await makeTopic('Epithelium', 1);
  const topicB = await makeTopic('Connective tissue', 2);

  const seedQuestions = async (topicId: mongoose.Types.ObjectId, serials: string[]) => {
    for (const [i, questionNo] of serials.entries()) {
      await BookQuestion.create({
        bookId,
        chapterId: chapter._id,
        topicId,
        questionNo,
        questionText: `Question ${questionNo}`,
        order: i + 1,
      });
    }
  };

  // Bengali serials on purpose: these are what the book actually prints.
  await seedQuestions(topicA._id, ['১', '২', '৩', '৪']);
  await seedQuestions(topicB._id, ['১', '২']);

  const serialsOf = async (topicId: mongoose.Types.ObjectId) =>
    (await BookContentService.getQuestionsByTopic(String(topicId))).map(q => q.questionNo).join(',');

  const idsOf = async (topicId: mongoose.Types.ObjectId) =>
    (await BookContentService.getQuestionsByTopic(String(topicId))).map(q => String(q._id));

  console.log('\n── reordering inside one topic ─────────────────');

  const original = await BookContentService.getQuestionsByTopic(String(topicA._id));
  check('topic starts in serial order', (await serialsOf(topicA._id)) === '১,২,৩,৪');

  // Drag the last question to the front.
  const dragged = [original[3], original[0], original[1], original[2]];
  const result = await BookContentService.reorder(
    'questions',
    dragged.map((q, i) => ({ _id: String(q._id), order: i + 1 })),
    String(topicA._id)
  );
  check('reorder reports the four rows it wrote', result.updated === 4, result);
  check('the topic now reads back in the dragged order', (await serialsOf(topicA._id)) === '৪,১,২,৩', {
    serials: await serialsOf(topicA._id),
  });

  // The whole point of separating `order` from `questionNo`: the serial is
  // printed on paper, so moving a question must never rewrite it.
  const afterDrag = await BookContentService.getQuestionsByTopic(String(topicA._id));
  check(
    'no printed serial was rewritten by the drag',
    afterDrag.every(q => String(original.find(o => String(o._id) === String(q._id))?.questionNo) === q.questionNo)
  );
  check('orders are dense 1..n afterwards', afterDrag.map(q => q.order).join(',') === '1,2,3,4', {
    orders: afterDrag.map(q => q.order),
  });

  console.log('\n── ids from another topic ─────────────────────');

  const bIds = await idsOf(topicB._id);
  const bOrderBefore = (await BookContentService.getQuestionsByTopic(String(topicB._id)))
    .map(q => q.order)
    .join(',');

  const mixed = await rejection(() =>
    BookContentService.reorder('questions', [
      { _id: String(afterDrag[0]._id), order: 1 },
      { _id: bIds[0], order: 2 },
    ])
  );
  check('a payload mixing two topics is refused', mixed !== null && /same topicId/.test(mixed), {
    mixed,
  });

  const wrongScope = await rejection(() =>
    BookContentService.reorder(
      'questions',
      afterDrag.map((q, i) => ({ _id: String(q._id), order: afterDrag.length - i })),
      String(topicB._id)
    )
  );
  check(
    "ids that do not belong to the caller's topic are refused",
    wrongScope !== null && /do not belong to topicId/.test(wrongScope),
    { wrongScope }
  );

  const unknown = await rejection(() =>
    BookContentService.reorder('questions', [
      { _id: String(new mongoose.Types.ObjectId()), order: 1 },
    ])
  );
  check('an id that matches no question is refused', unknown !== null && /do not exist/.test(unknown), {
    unknown,
  });

  const dupe = await rejection(() =>
    BookContentService.reorder('questions', [
      { _id: String(afterDrag[0]._id), order: 1 },
      { _id: String(afterDrag[0]._id), order: 2 },
    ])
  );
  check('the same id twice is refused', dupe !== null && /same _id twice/.test(dupe), { dupe });

  const badId = await rejection(() =>
    BookContentService.reorder('questions', [{ _id: 'not-an-objectid', order: 1 }])
  );
  check('a malformed id is refused before any write', badId !== null && /invalid _id/.test(badId), {
    badId,
  });

  const badOrder = await rejection(() =>
    BookContentService.reorder('questions', [{ _id: String(afterDrag[0]._id), order: 'first' }])
  );
  check(
    'a non-numeric order is refused before any write',
    badOrder !== null && /non-numeric order/.test(badOrder),
    { badOrder }
  );

  check(
    'none of the refusals touched the other topic',
    (await BookContentService.getQuestionsByTopic(String(topicB._id))).map(q => q.order).join(',') ===
      bOrderBefore
  );
  check(
    'nor the topic that was named',
    (await serialsOf(topicA._id)) === '৪,১,২,৩',
    { serials: await serialsOf(topicA._id) }
  );

  console.log('\n── an empty or absent items list ──────────────');

  // bulkWrite([]) throws "Invalid BulkOperation, Batch cannot be empty" from
  // the driver. Each of these must come back as our own sentence instead.
  const emptyCases: [string, unknown][] = [
    ['an empty array', []],
    ['an absent items', undefined],
    ['a null items', null],
    ['an object instead of an array', { _id: 'x', order: 1 }],
    ['a string', 'first,second'],
  ];
  for (const [label, value] of emptyCases) {
    const msg = await rejection(() => BookContentService.reorder('questions', value));
    check(`${label} is refused`, msg !== null && /non-empty array/.test(msg), { label, msg });
    check(`${label} never reaches the driver`, msg !== null && !/BulkOperation/i.test(msg), {
      label,
      msg,
    });
  }

  const badLevel = await rejection(() =>
    BookContentService.reorder('everything', [{ _id: String(afterDrag[0]._id), order: 1 }])
  );
  check('an unknown level is refused', badLevel !== null && /Unknown reorder level/.test(badLevel), {
    badLevel,
  });

  console.log('\n── delete, then undo ──────────────────────────');

  const victim = afterDrag.find(q => q.questionNo === '২')!;
  await BookQuestion.findByIdAndUpdate(victim._id, {
    answerHtml: '<p>Simple squamous epithelium</p>',
    images: ['https://api.test/api/book-content/media/fig-1.png'],
    videos: [
      {
        title: 'clip',
        url: 'https://api.test/api/book-content/media/clip.mp4',
        provider: 'upload',
        fileName: 'clip.mp4',
        fileSize: 2048,
      },
    ],
    attachments: [
      {
        title: 'notes',
        fileUrl: 'https://api.test/api/book-content/media/notes.pdf',
        fileType: 'pdf',
        fileSize: 4096,
      },
    ],
  });

  const beforeDelete = await BookQuestion.findById(victim._id).lean();
  await BookContentService.deleteQuestion(String(victim._id));

  const listAfterDelete = await BookContentService.getQuestionsByTopic(String(topicA._id));
  check(
    'a deleted question drops out of its topic',
    listAfterDelete.every(q => String(q._id) !== String(victim._id))
  );
  const softDeleted = await BookQuestion.findById(victim._id).lean();
  check('but the document survives — the delete is soft', softDeleted?.isDeleted === true);

  const deletedInReorder = await rejection(() =>
    BookContentService.reorder(
      'questions',
      listAfterDelete
        .map((q, i) => ({ _id: String(q._id), order: i + 1 }))
        .concat([{ _id: String(victim._id), order: 99 }])
    )
  );
  check(
    'a deleted question cannot be dragged back by a reorder',
    deletedInReorder !== null && /do not exist/.test(deletedInReorder),
    { deletedInReorder }
  );

  const restored = await BookContentService.restoreQuestion(String(victim._id));
  check('restore returns the question', Boolean(restored));
  check(
    'it is back in the topic',
    (await idsOf(topicA._id)).includes(String(victim._id)),
    { ids: await idsOf(topicA._id) }
  );
  check('the whole topic is whole again', (await serialsOf(topicA._id)) === '৪,১,২,৩', {
    serials: await serialsOf(topicA._id),
  });

  check('the answer came back', restored?.answerHtml === beforeDelete?.answerHtml, {
    answerHtml: restored?.answerHtml,
  });
  check('the image came back', restored?.images?.length === 1 && restored.images[0].endsWith('fig-1.png'), {
    images: restored?.images,
  });
  check(
    'the video came back, filename and size included',
    restored?.videos?.length === 1 &&
      restored.videos[0].fileName === 'clip.mp4' &&
      restored.videos[0].fileSize === 2048,
    { videos: restored?.videos }
  );
  check(
    'the attachment came back',
    restored?.attachments?.length === 1 && restored.attachments[0].fileType === 'pdf',
    { attachments: restored?.attachments }
  );
  check('the printed serial is unchanged', restored?.questionNo === '২');
  check('and so is its place in the topic', restored?.order === beforeDelete?.order, {
    order: restored?.order,
    was: beforeDelete?.order,
  });

  // An admin who taps undo twice must get the question, not an error.
  const again = await BookContentService.restoreQuestion(String(victim._id));
  check('undoing twice is harmless', again?.isDeleted === false);

  console.log('\n── the other levels are scoped the same way ───');

  const otherChapter = await BookChapter.create({
    bookId,
    partId: part._id,
    chapterNo: '2',
    title: 'Special Histology',
    order: 2,
  });
  const strayTopic = await BookTopic.create({
    bookId,
    partId: part._id,
    chapterId: otherChapter._id,
    topicNo: '2.1',
    title: 'Stray',
    qrCode: generateQrCode(),
    order: 1,
  });

  const crossChapter = await rejection(() =>
    BookContentService.reorder('topics', [
      { _id: String(topicA._id), order: 1 },
      { _id: String(strayTopic._id), order: 2 },
    ])
  );
  check(
    'topics from two chapters cannot be reordered together',
    crossChapter !== null && /same chapterId/.test(crossChapter),
    { crossChapter }
  );

  const topicSwap = await BookContentService.reorder(
    'topics',
    [
      { _id: String(topicB._id), order: 1 },
      { _id: String(topicA._id), order: 2 },
    ],
    String(chapter._id)
  );
  check('topics within one chapter still reorder', topicSwap.updated === 2, topicSwap);
  const reorderedTopics = await BookTopic.find({ chapterId: chapter._id }).sort({ order: 1 }).lean();
  check(
    'and the chapter reads back in the new order',
    reorderedTopics.map(t => t.title).join(',') === 'Connective tissue,Epithelium',
    { titles: reorderedTopics.map(t => t.title) }
  );

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
