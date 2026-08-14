import { Types } from 'mongoose';
import { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } from './bookContent.model';
import { BookAccessService } from '../bookAccess/bookAccess.service';
import { Book } from '../book/book.model';

// ─── Scan ───────────────────────────────────────────────────

export type ScanResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'no_access'; book: Record<string, unknown> | null };

/**
 * Resolve a printed QR code into that topic's questions.
 *
 * The response carries ONE topic. Sibling topics are never queried, let alone
 * serialised — "only the scanned topic is visible" is a property of this
 * function, not of the page that renders it.
 */
const scanTopic = async (qrCode: string, userId: string): Promise<ScanResult> => {
  const topic = await BookTopic.findOne({
    qrCode: qrCode.toUpperCase().trim(),
    isDeleted: false,
    isPublished: true,
  }).lean();

  if (!topic) return { ok: false, reason: 'not_found' };

  const allowed = await BookAccessService.hasBookAccess(userId, topic.bookId);
  if (!allowed) {
    // Enough to render a "buy this book" card, and nothing from inside it.
    const book = await Book.findById(topic.bookId)
      .select('title slug author coverImage price offerPrice')
      .lean();
    return { ok: false, reason: 'no_access', book: book as Record<string, unknown> | null };
  }

  const [chapter, part, questions] = await Promise.all([
    BookChapter.findById(topic.chapterId).select('title titleBn chapterNo').lean(),
    BookPart.findById(topic.partId).select('title titleBn').lean(),
    BookQuestion.find({ topicId: topic._id, isDeleted: false, isPublished: true })
      .sort({ order: 1 })
      .select('questionNo questionText questionTextBn answerHtml videos attachments images order')
      .lean(),
  ]);

  await Promise.all([
    BookAccessService.recordScan(userId, topic.bookId, topic._id),
    BookTopic.updateOne({ _id: topic._id }, { $inc: { scanCount: 1 } }),
  ]);

  const book = await Book.findById(topic.bookId).select('title slug coverImage').lean();

  return {
    ok: true,
    data: {
      book,
      part: part ? { title: part.title, titleBn: part.titleBn } : null,
      chapter: chapter
        ? { chapterNo: chapter.chapterNo, title: chapter.title, titleBn: chapter.titleBn }
        : null,
      topic: {
        _id: topic._id,
        topicNo: topic.topicNo,
        title: topic.title,
        titleBn: topic.titleBn,
        isImplicit: topic.isImplicit,
        qrCode: topic.qrCode,
      },
      questions,
      // Lets the viewer say "answers coming soon" instead of looking broken
      // while the admin works through the backlog.
      answeredCount: questions.filter(q => Boolean(q.answerHtml?.trim())).length,
      totalCount: questions.length,
    },
  };
};

// ─── Admin tree ─────────────────────────────────────────────

/** Whole hierarchy for the admin editor, with per-topic answer progress. */
const getTree = async (bookId: string) => {
  const [book, parts, chapters, topics, counts] = await Promise.all([
    Book.findById(bookId).select('title slug coverImage').lean(),
    BookPart.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
    BookChapter.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
    BookTopic.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
    BookQuestion.aggregate([
      { $match: { bookId: new Types.ObjectId(bookId), isDeleted: false } },
      {
        $group: {
          _id: '$topicId',
          total: { $sum: 1 },
          answered: {
            $sum: {
              $cond: [
                { $gt: [{ $strLenCP: { $ifNull: ['$answerHtml', ''] } }, 0] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const countByTopic = new Map(counts.map(c => [String(c._id), c]));

  return {
    book,
    parts: parts.map(part => ({
      ...part,
      chapters: chapters
        .filter(c => String(c.partId) === String(part._id))
        .map(chapter => ({
          ...chapter,
          topics: topics
            .filter(t => String(t.chapterId) === String(chapter._id))
            .map(topic => {
              const c = countByTopic.get(String(topic._id));
              return { ...topic, totalQuestions: c?.total ?? 0, answeredQuestions: c?.answered ?? 0 };
            }),
        })),
    })),
  };
};

/** Headline numbers for the admin dashboard card. */
const getStats = async (bookId: string) => {
  const [parts, chapters, topics, total, answered] = await Promise.all([
    BookPart.countDocuments({ bookId, isDeleted: false }),
    BookChapter.countDocuments({ bookId, isDeleted: false }),
    BookTopic.countDocuments({ bookId, isDeleted: false }),
    BookQuestion.countDocuments({ bookId, isDeleted: false }),
    BookQuestion.countDocuments({
      bookId,
      isDeleted: false,
      answerHtml: { $exists: true, $nin: [null, ''] },
    }),
  ]);

  return { parts, chapters, topics, qrCodes: topics, questions: total, answered, pending: total - answered };
};

/** Every topic code for the printable QR sheet, in book order. */
const getQrSheet = async (bookId: string) => {
  const [parts, chapters, topics] = await Promise.all([
    BookPart.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
    BookChapter.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
    BookTopic.find({ bookId, isDeleted: false }).sort({ order: 1 }).lean(),
  ]);

  const partById = new Map(parts.map(p => [String(p._id), p]));
  const chapterById = new Map(chapters.map(c => [String(c._id), c]));

  return topics.map(t => {
    const chapter = chapterById.get(String(t.chapterId));
    const part = partById.get(String(t.partId));
    return {
      _id: t._id,
      qrCode: t.qrCode,
      topicNo: t.topicNo,
      topicTitle: t.title,
      chapterNo: chapter?.chapterNo,
      chapterTitle: chapter?.title,
      partTitle: part?.title,
      partId: t.partId,
      chapterId: t.chapterId,
    };
  });
};

// ─── CRUD ───────────────────────────────────────────────────

const createPart = async (payload: Record<string, unknown>) => BookPart.create(payload);

const createChapter = async (payload: Record<string, unknown>) => BookChapter.create(payload);

const createTopic = async (payload: Record<string, unknown>) =>
  BookTopic.create({ ...payload, qrCode: generateQrCode() });

// ─── Question serials ───────────────────────────────────────
//
// `questionNo` is free text — the serial as printed in the book, which may be
// "12", "১২" or "১২ক". `order` is the number the list is actually sorted by.
// Holding the two together is the whole job of createQuestion below.

const BN_ZERO = 0x09e6;

/** Bengali digits folded to ASCII so "১২" and "12" compare as one serial. */
const asciiDigits = (value: unknown): string =>
  String(value ?? '').replace(/[০-৯]/g, d => String(d.charCodeAt(0) - BN_ZERO));

const sameSerial = (a: unknown, b: unknown) =>
  asciiDigits(a).trim().toLowerCase() === asciiDigits(b).trim().toLowerCase();

/**
 * Leading integer of a serial, or null when it does not start with a digit.
 *
 * "১২ক" → 12. A suffixed serial still has a place in the run — it belongs right
 * after 12 — so the leading number is what decides where it goes.
 */
const serialValue = (value: unknown): number | null => {
  const match = /^\s*(\d+)/.exec(asciiDigits(value));
  return match ? Number(match[1]) : null;
};

/** Bare number, no suffix — the only shape safe to renumber. */
const isPlainSerial = (value: unknown) => /^\s*\d+\s*$/.test(asciiDigits(value));

/** Renumbered serial, written back in the script the admin was already using. */
const formatSerial = (n: number, source: string) =>
  /[০-৯]/.test(source)
    ? String(n).replace(/\d/g, d => String.fromCharCode(BN_ZERO + Number(d)))
    : String(n);

/**
 * Create a question at the serial the admin typed.
 *
 * `questionNo` decides the position and `order` is derived from it; an `order`
 * sent by the caller is ignored. Those two fields drifting apart is exactly why
 * a re-added question used to reappear at the bottom of the topic.
 *
 *   serial already in use   → that question and every later one move down one,
 *                             serials included, and the new one takes the slot
 *   serial free but below   → drops into the gap and nothing else is renumbered,
 *   an existing one           so re-adding a deleted question leaves the rest alone
 *   serial past the end, or → appended
 *   no leading digit ("ক")
 *
 * Suffixed serials ("১২ক") are positioned by their leading number but never
 * renumbered by a shift: bumping it to "১৩ক" would invent a serial the printed
 * book does not have.
 */
const createQuestion = async (payload: Record<string, unknown>) => {
  const { topicId } = payload;
  if (!topicId) throw new Error('topicId is required');

  // createdAt breaks ties: the import left topics holding duplicate orders, and
  // a shift computed from an unstable sort would move the wrong rows.
  const siblings = await BookQuestion.find({ topicId, isDeleted: false })
    .sort({ order: 1, createdAt: 1 })
    .select('_id order questionNo')
    .lean();

  const questionNo = String(payload.questionNo ?? '').trim();
  const taken = questionNo ? siblings.findIndex(s => sameSerial(s.questionNo, questionNo)) : -1;

  let index = siblings.length;
  if (taken !== -1) {
    index = taken;
  } else {
    const value = serialValue(questionNo);
    if (value !== null) {
      const next = siblings.findIndex(s => {
        const v = serialValue(s.questionNo);
        return v !== null && v > value;
      });
      if (next !== -1) index = next;
    }
  }

  const question = new BookQuestion({ ...payload, order: index + 1 });
  // Validated before anything moves: a payload the model rejects would leave
  // the topic renumbered around a question that never came into existence.
  await question.validate();

  // Positions are rewritten as absolute values rather than $inc-ed, so topics
  // that came out of the import with sparse or duplicated `order` end up dense.
  const writes = siblings.flatMap((s, i) => {
    const order = (i < index ? i : i + 1) + 1;
    const set: { order?: number; questionNo?: string } = {};
    if (s.order !== order) set.order = order;

    // Only a collision renumbers what the reader sees. Slotting into a gap left
    // by a delete must leave the serials around it untouched.
    const plain = isPlainSerial(s.questionNo) ? serialValue(s.questionNo) : null;
    if (taken !== -1 && i >= index && plain !== null) {
      const bumped = formatSerial(plain + 1, s.questionNo);
      if (bumped !== s.questionNo) set.questionNo = bumped;
    }

    return Object.keys(set).length
      ? [{ updateOne: { filter: { _id: s._id }, update: { $set: set } } }]
      : [];
  });

  // One bulkWrite: a half-applied shift would leave two questions sitting on the
  // same slot with nothing left to say which of them came first.
  if (writes.length) await BookQuestion.bulkWrite(writes);

  return question.save();
};

const updatePart = async (id: string, payload: Record<string, unknown>) =>
  BookPart.findByIdAndUpdate(id, payload, { new: true });

const updateChapter = async (id: string, payload: Record<string, unknown>) =>
  BookChapter.findByIdAndUpdate(id, payload, { new: true });

/** qrCode is stripped: once printed, a topic's code can never change. */
const updateTopic = async (id: string, payload: Record<string, unknown>) => {
  const { qrCode: _ignored, ...safe } = payload;
  return BookTopic.findByIdAndUpdate(id, safe, { new: true });
};

const updateQuestion = async (id: string, payload: Record<string, unknown>) =>
  BookQuestion.findByIdAndUpdate(id, payload, { new: true });

// Soft delete everywhere — a printed QR pointing at a hard-deleted topic would
// be unrecoverable.
const deletePart = async (id: string) => BookPart.findByIdAndUpdate(id, { isDeleted: true });
const deleteChapter = async (id: string) => BookChapter.findByIdAndUpdate(id, { isDeleted: true });
const deleteTopic = async (id: string) => BookTopic.findByIdAndUpdate(id, { isDeleted: true });
// Deliberately leaves the serial gap behind: createQuestion drops a re-added
// question straight back into it. Whether a delete should instead close the gap
// and renumber the rest is still an open question with the admin.
const deleteQuestion = async (id: string) =>
  BookQuestion.findByIdAndUpdate(id, { isDeleted: true });

const getQuestionsByTopic = async (topicId: string) =>
  BookQuestion.find({ topicId, isDeleted: false }).sort({ order: 1 }).lean();

const getTopicById = async (id: string) => BookTopic.findById(id).lean();

type ReorderLevel = 'parts' | 'chapters' | 'topics' | 'questions';

const reorder = async (level: ReorderLevel, items: { _id: string; order: number }[]) => {
  const writes = items.map(i => ({
    updateOne: { filter: { _id: i._id }, update: { $set: { order: i.order } } },
  }));

  // Dispatched per level rather than through a lookup table: the four models
  // have different document types, so a shared reference collapses to a union
  // whose bulkWrite overloads no longer line up.
  switch (level) {
    case 'parts':
      await BookPart.bulkWrite(writes);
      break;
    case 'chapters':
      await BookChapter.bulkWrite(writes);
      break;
    case 'topics':
      await BookTopic.bulkWrite(writes);
      break;
    case 'questions':
      await BookQuestion.bulkWrite(writes);
      break;
    default:
      throw new Error(`Unknown reorder level: ${level}`);
  }

  return { updated: items.length };
};

/** Next question still missing an answer — powers the admin "keep going" button. */
const getNextUnanswered = async (bookId: string, afterOrder?: number) => {
  return BookQuestion.findOne({
    bookId,
    isDeleted: false,
    $or: [{ answerHtml: { $exists: false } }, { answerHtml: '' }],
    ...(afterOrder !== undefined ? { order: { $gt: afterOrder } } : {}),
  })
    .sort({ order: 1 })
    .lean();
};

export const BookContentService = {
  scanTopic,
  getTree,
  getStats,
  getQrSheet,
  createPart,
  createChapter,
  createTopic,
  createQuestion,
  updatePart,
  updateChapter,
  updateTopic,
  updateQuestion,
  deletePart,
  deleteChapter,
  deleteTopic,
  deleteQuestion,
  getQuestionsByTopic,
  getTopicById,
  reorder,
  getNextUnanswered,
};
