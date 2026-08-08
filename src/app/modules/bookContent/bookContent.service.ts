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

const createQuestion = async (payload: Record<string, unknown>) => BookQuestion.create(payload);

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
