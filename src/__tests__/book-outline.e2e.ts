/* eslint-disable no-console */
/**
 * The public book outline, and the door it must not open.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the LIVE production database. DATABASE_URL is
 * overwritten below before anything can read it.
 *
 * Two things are pinned down here, and the second is a boundary that moved
 * twice. The QR page briefly served a free chapter to anyone, so the shop could
 * link a stranger into it; the client withdrew that. What a QR opens is what
 * the book is sold for, so ownership is now the only way in — the free sample
 * the shop offers is the preview PDF, a separate public file.
 *
 *   • getOutline returns structure and counts only. No answers, no media, and
 *     NO QR code at any level — the endpoint needs no token, so a code it
 *     returns is a code anyone can type into /b/.
 *   • scanTopic refuses a stranger and refuses a signed-in visitor with no
 *     order, including for a chapter still flagged isFree. That flag is inert.
 *
 * Run: npx ts-node src/__tests__/book-outline.e2e.ts
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

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.DATABASE_URL = mongod.getUri();
  await mongoose.connect(mongod.getUri(), { dbName: 'book-outline-test' });

  const { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } = await import(
    '../app/modules/bookContent/bookContent.model'
  );
  const { BookContentService } = await import('../app/modules/bookContent/bookContent.service');
  const { Book } = await import('../app/modules/book/book.model');

  const book = await Book.create({
    id: 1,
    title: 'Anatomy MAGIC VIVA',
    slug: 'anatomy-magic-viva',
    description: 'Test book',
    price: 600,
    offerPrice: 450,
    format: 'printed',
    stock: 100,
    status: 'published',
  });
  const bookId = book._id;

  const makePart = (title: string, order: number) => BookPart.create({ bookId, title, order });

  const makeChapter = (
    partId: mongoose.Types.ObjectId,
    chapterNo: string,
    title: string,
    order: number,
    extra: Record<string, unknown> = {}
  ) => BookChapter.create({ bookId, partId, chapterNo, title, order, ...extra });

  const makeTopic = (
    partId: mongoose.Types.ObjectId,
    chapterId: mongoose.Types.ObjectId,
    title: string,
    order: number,
    extra: Record<string, unknown> = {}
  ) =>
    BookTopic.create({
      bookId,
      partId,
      chapterId,
      title,
      qrCode: generateQrCode(),
      order,
      ...extra,
    });

  const seedQuestions = async (
    chapterId: mongoose.Types.ObjectId,
    topicId: mongoose.Types.ObjectId,
    n: number,
    extra: Record<string, unknown> = {}
  ) => {
    for (let i = 1; i <= n; i++) {
      await BookQuestion.create({
        bookId,
        chapterId,
        topicId,
        questionNo: String(i),
        questionText: `Question ${i}`,
        answerHtml: '<p>The answer nobody should see for free.</p>',
        order: i,
        ...extra,
      });
    }
  };

  // Board I: one chapter still carrying the isFree flag (2 topics, 3+2
  // questions) and one ordinary chapter (1 topic, 4). The flag is kept in the
  // fixture on purpose — the point of this suite is that it buys nothing.
  const boardI = await makePart('Board I', 1);
  const flaggedCh = await makeChapter(boardI._id, '1', 'General Histology', 1, { isFree: true });
  const paidCh = await makeChapter(boardI._id, '2', 'Upper Limb', 2);

  const flaggedTopicA = await makeTopic(boardI._id, flaggedCh._id, 'Epithelium', 1);
  const flaggedTopicB = await makeTopic(boardI._id, flaggedCh._id, 'Connective tissue', 2);
  const paidTopic = await makeTopic(boardI._id, paidCh._id, 'Brachial plexus', 1);

  await seedQuestions(flaggedCh._id, flaggedTopicA._id, 3);
  await seedQuestions(flaggedCh._id, flaggedTopicB._id, 2);
  await seedQuestions(paidCh._id, paidTopic._id, 4);

  // Board II: one chapter, one topic, one question.
  const boardII = await makePart('Board II', 2);
  const chII = await makeChapter(boardII._id, '1', 'Head & Neck', 1);
  const topicII = await makeTopic(boardII._id, chII._id, 'Triangles of the neck', 1);
  await seedQuestions(chII._id, topicII._id, 1);

  // Noise that must NOT be counted: a deleted chapter, an unpublished topic and
  // a soft-deleted question. These are exactly the rows an admin retires, and a
  // shop page that advertises them is advertising content nobody can open.
  const goneCh = await makeChapter(boardII._id, '9', 'Retired chapter', 9, { isDeleted: true });
  await makeTopic(boardII._id, goneCh._id, 'Retired topic', 1);
  await makeTopic(boardII._id, chII._id, 'Draft topic', 2, { isPublished: false });
  await seedQuestions(chII._id, topicII._id, 1, { isDeleted: true, questionNo: '99' });

  console.log('\n── outline: counts ────────────────────────────');

  const outline = await BookContentService.getOutline('anatomy-magic-viva');
  if (!outline) {
    console.log('  FAIL  outline is null for a real slug');
    process.exit(1);
  }

  check('resolves by slug', Boolean(outline), outline.totals);
  check('resolves by id too', Boolean(await BookContentService.getOutline(String(bookId))));
  check('unknown slug returns null', (await BookContentService.getOutline('no-such-book')) === null);

  check('counts parts', outline.totals.parts === 2, outline.totals);
  check('counts only live chapters', outline.totals.chapters === 3, outline.totals);
  check('counts only published topics', outline.totals.topics === 4, outline.totals);
  check('counts only live questions', outline.totals.questions === 10, outline.totals);

  const flatChapters = outline.parts.flatMap((p) => p.chapters);
  const first = flatChapters.find((c) => c.title === 'General Histology');
  const second = flatChapters.find((c) => c.title === 'Upper Limb');

  check(
    'a chapter carries its topic and question counts',
    first?.topicCount === 2 && first?.questionCount === 5,
    first
  );
  check('and so does the next one', second?.topicCount === 1 && second?.questionCount === 4, second);
  check('parts keep their order', outline.parts.map((p) => p.title).join(',') === 'Board I,Board II');
  check(
    'chapters keep their order inside a part',
    outline.parts[0].chapters.map((c) => c.title).join(',') === 'General Histology,Upper Limb'
  );
  check('deleted chapter is absent', !flatChapters.some((c) => c.title === 'Retired chapter'));

  console.log('\n── outline: what it must not leak ─────────────');

  // This endpoint needs no token, so everything it returns is public. A QR code
  // that reaches a browser is a code that can be typed into /b/, and there is no
  // longer any free path into that page — so no code may appear here at all,
  // not even for a chapter still flagged isFree.
  const serialised = JSON.stringify(outline);
  check('no answer html', !serialised.includes('nobody should see'));

  const codes: [string, string][] = [
    ['first topic of the flagged chapter', flaggedTopicA.qrCode],
    ['second topic of the flagged chapter', flaggedTopicB.qrCode],
    ['a paid topic', paidTopic.qrCode],
    ['a topic in the other board', topicII.qrCode],
  ];
  for (const [label, code] of codes) {
    check(`no QR code for ${label}`, !serialised.includes(code), code);
  }
  check('the isFree flag is not published either', !serialised.includes('isFree'));

  console.log('\n── the QR page itself stays shut ──────────────');

  // A stranger has no user id at all; a signed-in visitor who bought nothing has
  // one that grants nothing. Neither may read a topic, flagged or not.
  const strangerFlagged = await BookContentService.scanTopic(flaggedTopicA.qrCode, '');
  check('a stranger cannot open a flagged chapter', strangerFlagged.ok === false, strangerFlagged);

  const strangerPaid = await BookContentService.scanTopic(paidTopic.qrCode, '');
  check('nor an ordinary one', strangerPaid.ok === false, strangerPaid);

  const noOrder = await BookContentService.scanTopic(
    flaggedTopicA.qrCode,
    String(new mongoose.Types.ObjectId())
  );
  check(
    'a signed-in visitor with no order is refused too',
    noOrder.ok === false && noOrder.reason === 'no_access',
    noOrder
  );
  check(
    'and the refusal carries no answers',
    !JSON.stringify(noOrder).includes('nobody should see')
  );

  const secondFlagged = await BookContentService.scanTopic(flaggedTopicB.qrCode, '');
  check('every topic of the flagged chapter is shut, not just the first', secondFlagged.ok === false);

  const badCode = await BookContentService.scanTopic('ZZZZZZZZ', '');
  check(
    'an unknown code is still not_found',
    badCode.ok === false && badCode.reason === 'not_found'
  );

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
