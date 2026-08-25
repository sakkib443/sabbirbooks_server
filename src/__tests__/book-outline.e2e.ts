/* eslint-disable no-console */
/**
 * The public book outline, and who may read a free chapter.
 *
 * Runs against an in-memory MongoDB, never the configured DATABASE_URL: this
 * project's .env points at the LIVE production database. DATABASE_URL is
 * overwritten below before anything can read it.
 *
 * Two things are being pinned down, and the second is a security boundary that
 * was deliberately moved — the shop's landing page now links straight into a
 * free chapter, so scanTopic serves an anonymous visitor:
 *
 *   • getOutline returns structure and counts only. No answers, no media, and
 *     no QR code for any chapter that is not flagged isFree — a paid chapter's
 *     code must not leak through the one endpoint that needs no token.
 *   • scanTopic(code) with NO userId returns a free chapter's questions, and
 *     refuses everything else with 'login_required' rather than serving it.
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

  // Board I: one free chapter (2 topics, 3+2 questions) and one paid (1 topic, 4).
  const boardI = await makePart('Board I', 1);
  const freeCh = await makeChapter(boardI._id, '1', 'General Histology', 1, { isFree: true });
  const paidCh = await makeChapter(boardI._id, '2', 'Upper Limb', 2);

  const freeTopicA = await makeTopic(boardI._id, freeCh._id, 'Epithelium', 1);
  const freeTopicB = await makeTopic(boardI._id, freeCh._id, 'Connective tissue', 2);
  const paidTopic = await makeTopic(boardI._id, paidCh._id, 'Brachial plexus', 1);

  await seedQuestions(freeCh._id, freeTopicA._id, 3);
  await seedQuestions(freeCh._id, freeTopicB._id, 2);
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

  check('resolves by slug', Boolean(outline), outline?.totals);
  check('resolves by id too', Boolean(await BookContentService.getOutline(String(bookId))));
  check('unknown slug returns null', (await BookContentService.getOutline('no-such-book')) === null);

  check('counts parts', outline.totals.parts === 2, outline.totals);
  check('counts only live chapters', outline.totals.chapters === 3, outline.totals);
  check('counts only published topics', outline.totals.topics === 4, outline.totals);
  check('counts only live questions', outline.totals.questions === 10, outline.totals);
  check('counts free chapters', outline.totals.freeChapters === 1, outline.totals);

  const flatChapters = outline.parts.flatMap((p) => p.chapters);
  const free = flatChapters.find((c) => c.isFree);
  const paid = flatChapters.find((c) => c.title === 'Upper Limb');

  check('free chapter carries its topic and question counts', free?.topicCount === 2 && free?.questionCount === 5, free);
  check('paid chapter carries its counts', paid?.topicCount === 1 && paid?.questionCount === 4, paid);
  check('parts keep their order', outline.parts.map((p) => p.title).join(',') === 'Board I,Board II');
  check(
    'chapters keep their order inside a part',
    outline.parts[0].chapters.map((c) => c.title).join(',') === 'General Histology,Upper Limb'
  );
  check('deleted chapter is absent', !flatChapters.some((c) => c.title === 'Retired chapter'));

  console.log('\n── outline: what it must not leak ─────────────');

  const serialised = JSON.stringify(outline);
  check('no answer html', !serialised.includes('nobody should see'));
  check('paid chapter has no qr code', paid?.freeQrCode === undefined, paid);
  check(
    "paid topic's code is nowhere in the payload",
    !serialised.includes(paidTopic.qrCode),
    paidTopic.qrCode
  );
  check(
    "board II topic's code is nowhere in the payload",
    !serialised.includes(topicII.qrCode),
    topicII.qrCode
  );
  check('free chapter exposes its first topic code', free?.freeQrCode === freeTopicA.qrCode, {
    got: free?.freeQrCode,
    want: freeTopicA.qrCode,
  });
  check('firstFreeQrCode points at the same topic', outline.firstFreeQrCode === freeTopicA.qrCode);

  console.log('\n── anonymous scan ─────────────────────────────');

  const anonFree = await BookContentService.scanTopic(freeTopicA.qrCode);
  check('a stranger may read a free topic', anonFree.ok === true, anonFree);
  if (anonFree.ok) {
    const questions = (anonFree.data as { questions?: unknown[] }).questions ?? [];
    check('and gets its questions', questions.length === 3, questions.length);
  }

  const anonSecondFree = await BookContentService.scanTopic(freeTopicB.qrCode);
  check('every topic of a free chapter is open, not just the first', anonSecondFree.ok === true);

  const anonPaid = await BookContentService.scanTopic(paidTopic.qrCode);
  check('a stranger is refused a paid topic', anonPaid.ok === false, anonPaid);
  check(
    'and is told to sign in rather than to buy',
    anonPaid.ok === false && anonPaid.reason === 'login_required',
    anonPaid.ok === false ? anonPaid.reason : null
  );
  check(
    'the refusal carries no questions',
    !JSON.stringify(anonPaid).includes('nobody should see')
  );

  const anonBadCode = await BookContentService.scanTopic('ZZZZZZZZ');
  check('an unknown code is still not_found', anonBadCode.ok === false && anonBadCode.reason === 'not_found');

  console.log('\n── a free chapter that was retired ────────────');

  // The isFree flag alone must not keep a withdrawn chapter open.
  await BookChapter.updateOne({ _id: freeCh._id }, { isPublished: false });
  const afterUnpublish = await BookContentService.scanTopic(freeTopicA.qrCode);
  check(
    'unpublishing a free chapter closes it to strangers',
    afterUnpublish.ok === false && afterUnpublish.reason === 'login_required',
    afterUnpublish.ok === false ? afterUnpublish.reason : null
  );

  const outlineAfter = await BookContentService.getOutline('anatomy-magic-viva');
  check('and drops it from the outline', outlineAfter?.totals.freeChapters === 0, outlineAfter?.totals);
  check('leaving no free link to offer', outlineAfter?.firstFreeQrCode === undefined);

  await mongoose.disconnect();
  await mongod.stop();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
