import { Types } from 'mongoose';
import { BookPart, BookChapter, BookTopic, BookQuestion, generateQrCode } from './bookContent.model';
import { BookAccessService } from '../bookAccess/bookAccess.service';
import { Book } from '../book/book.model';
import { withMediaTokens } from './mediaToken';
import { sanitizeQuestionPayload } from './sanitizeAnswer';

// ─── Scan ───────────────────────────────────────────────────

export type ScanResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: 'not_found' }
  // 'awaiting_delivery' is still a refusal — it carries exactly the same
  // (zero) content as 'no_access'. It exists only so the reader is told
  // "your book is on the way" instead of "buy this book", which a customer
  // who already paid would reasonably act on by paying again.
  | { ok: false; reason: 'no_access' | 'awaiting_delivery'; book: Record<string, unknown> | null };

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

  // Owning the book is the only way in. There is no free-chapter bypass and no
  // anonymous path: what a QR opens is the thing the book is sold for, so a
  // visitor who has not bought it sees the "buy this book" card instead — even
  // for a chapter an admin has flagged isFree. That flag no longer grants
  // anything; the free sample the shop offers is the preview PDF, which is a
  // separate file served from the public uploads mount.
  //
  // The id is validated before it is used: hasBookAccess queries by userId, and
  // mongoose answers a malformed one with a CastError — a 500 where a refusal
  // belongs. The route's authMiddleware means that should never happen, but
  // "the gate throws instead of saying no" is the wrong failure for the one
  // function standing between a stranger and the paid content.
  const identified = Boolean(userId) && Types.ObjectId.isValid(String(userId));
  const allowed = identified && (await BookAccessService.hasBookAccess(userId, topic.bookId));
  if (!allowed) {
    // Enough to render a "buy this book" card, and nothing from inside it.
    const [book, awaitingDelivery] = await Promise.all([
      Book.findById(topic.bookId).select('title slug author coverImage price offerPrice').lean(),
      identified ? BookAccessService.hasPendingDelivery(userId, topic.bookId) : Promise.resolve(false),
    ]);
    return {
      ok: false,
      reason: awaitingDelivery ? 'awaiting_delivery' : 'no_access',
      book: book as Record<string, unknown> | null,
    };
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
      // Media URLs point at the access-checked media route, which an <img> tag
      // cannot authenticate against — so they are stamped with a short-lived
      // token here, on a response that has already passed the access check.
      questions: withMediaTokens(questions, String(userId)),
      // Total is fine to expose ("this topic has 7 questions"). answeredCount
      // is deliberately absent: a reader shouldn't be able to see how much of
      // the book is still unfinished — that is an internal admin metric.
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

  const question = new BookQuestion({ ...sanitizeQuestionPayload(payload), order: index + 1 });
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

/**
 * What may still be written on a board, chapter or topic once the book is in
 * print — which is to say: almost nothing.
 *
 * The structure IS the printed book. A reader holds a paper page, points a
 * camera at the QR beside a topic, and expects the site to show that topic
 * under that chapter of that board. Rename or renumber any of the three and the
 * paper and the site stop agreeing, on a print run that has already shipped and
 * cannot be recalled. So titles, numbers and order are immutable here, and
 * qrCode is not writable at any level — it is assigned once and never reissued.
 *
 * One flag stays open because it is printed nowhere: isPublished, the ability
 * to withdraw a chapter that should not be live. isFree is still accepted so a
 * stored value can be cleared, but it no longer grants anyone access — the free
 * chapter preview was withdrawn, and the only sample the shop offers is the
 * preview PDF.
 *
 * Anything else in the payload is dropped silently rather than refused: the
 * admin form posts whole objects, and rejecting the request outright would also
 * block the flags that are legitimately being changed. The guarantee that
 * matters is that the write cannot touch structure, and stripping gives that
 * whatever the client sends.
 */
const STRUCTURE_MUTABLE: Record<'part' | 'chapter' | 'topic', readonly string[]> = {
  part: ['isPublished'],
  chapter: ['isFree', 'isPublished'],
  topic: ['isPublished'],
};

const onlyMutable = (level: 'part' | 'chapter' | 'topic', payload: Record<string, unknown>) => {
  const allowed = STRUCTURE_MUTABLE[level];
  return Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
};

/** Throws rather than reporting a silent success on a payload that changes nothing. */
const assertSomethingToWrite = (level: string, safe: Record<string, unknown>) => {
  if (Object.keys(safe).length === 0) {
    throw new Error(
      `A ${level}'s title, number and order are permanent once the book is printed — the QR codes on paper point at them. Only questions inside a topic can be edited.`
    );
  }
};

const updatePart = async (id: string, payload: Record<string, unknown>) => {
  const safe = onlyMutable('part', payload);
  assertSomethingToWrite('board', safe);
  return BookPart.findByIdAndUpdate(id, safe, { new: true });
};

const updateChapter = async (id: string, payload: Record<string, unknown>) => {
  const safe = onlyMutable('chapter', payload);
  assertSomethingToWrite('chapter', safe);
  return BookChapter.findByIdAndUpdate(id, safe, { new: true });
};

const updateTopic = async (id: string, payload: Record<string, unknown>) => {
  const safe = onlyMutable('topic', payload);
  assertSomethingToWrite('topic', safe);
  return BookTopic.findByIdAndUpdate(id, safe, { new: true });
};

const updateQuestion = async (id: string, payload: Record<string, unknown>) =>
  BookQuestion.findByIdAndUpdate(id, sanitizeQuestionPayload(payload), { new: true });

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

/**
 * Undo a question delete.
 *
 * Questions are the one level with a delete, so they are the one level with an
 * undo. It flips `isDeleted` and touches nothing else — the answer, images,
 * videos and attachments were never removed by the soft delete, so they come
 * back exactly as they were, still at the same `order` and `questionNo`.
 *
 * Idempotent on purpose: an admin who taps undo twice gets the same question
 * back, not an error.
 */
const restoreQuestion = async (id: string) =>
  BookQuestion.findByIdAndUpdate(id, { isDeleted: false }, { new: true });

const getQuestionsByTopic = async (topicId: string) =>
  BookQuestion.find({ topicId, isDeleted: false }).sort({ order: 1 }).lean();

const getTopicById = async (id: string) => BookTopic.findById(id).lean();

// ─── Reorder ────────────────────────────────────────────────

type ReorderLevel = 'parts' | 'chapters' | 'topics' | 'questions';

/**
 * The parent each level is ordered WITHIN.
 *
 * `order` is never global: chapter numbering restarts inside every part and
 * question numbering inside every topic. A payload mixing two parents is
 * therefore not merely odd, it is meaningless — which is what makes "every id
 * must share one parent" a rule the route can enforce rather than a guess.
 */
const REORDER_PARENT = {
  parts: 'bookId',
  chapters: 'partId',
  topics: 'chapterId',
  questions: 'topicId',
} as const;

const isReorderLevel = (value: string): value is ReorderLevel =>
  Object.prototype.hasOwnProperty.call(REORDER_PARENT, value);

/**
 * Reordering is for questions and nothing else.
 *
 * `order` decides the sequence a reader is shown, and for boards, chapters and
 * topics that sequence is printed — moving one silently disagrees with every
 * copy already in a student's hands. Questions are the one level below the QR
 * code, so rearranging them changes nothing on paper.
 *
 * Enforced here rather than by dropping the other three from REORDER_PARENT,
 * because that table is also what tells `reorder` which parent to scope its
 * writes to; the levels must stay described even though three are refused.
 */
const REORDERABLE: readonly ReorderLevel[] = ['questions'];

/**
 * The requested rows with the parent each one actually belongs to.
 *
 * Deleted rows are left out, so a payload naming one is short and gets
 * rejected below rather than quietly resurrecting an `order` on it.
 */
const findReorderTargets = async (
  level: ReorderLevel,
  ids: string[]
): Promise<{ _id: string; parent: string }[]> => {
  const filter = { _id: { $in: ids }, isDeleted: false };
  switch (level) {
    case 'parts':
      return (await BookPart.find(filter).select('bookId').lean()).map(d => ({
        _id: String(d._id),
        parent: String(d.bookId),
      }));
    case 'chapters':
      return (await BookChapter.find(filter).select('partId').lean()).map(d => ({
        _id: String(d._id),
        parent: String(d.partId),
      }));
    case 'topics':
      return (await BookTopic.find(filter).select('chapterId').lean()).map(d => ({
        _id: String(d._id),
        parent: String(d.chapterId),
      }));
    case 'questions':
      return (await BookQuestion.find(filter).select('topicId').lean()).map(d => ({
        _id: String(d._id),
        parent: String(d.topicId),
      }));
  }
};

/**
 * Write a new `order` across one parent's children.
 *
 * Everything before the bulkWrite is validation, and it is not decoration: the
 * route used to take any ids at all and set `order` on whatever they matched,
 * so a payload naming questions from three different books scrambled all three
 * — silently, and with no way to tell afterwards what the old order had been.
 * A reorder now names one parent's rows or it does not happen.
 *
 * `scopeId` is the caller stating which parent it believes it is reordering.
 * It is optional, but when given it must agree: that is what turns a client
 * bug (stale topic in hand, ids from the topic it just left) into a 400
 * instead of a silent rewrite of the wrong topic.
 */
const reorder = async (level: string, items: unknown, scopeId?: unknown) => {
  if (!isReorderLevel(level)) throw new Error(`Unknown reorder level: ${level}`);
  if (!REORDERABLE.includes(level)) {
    throw new Error(
      `${level} cannot be reordered — their order is printed in the book and the QR codes on paper depend on it. Only questions inside a topic can be rearranged.`
    );
  }
  const parentKey = REORDER_PARENT[level];

  // bulkWrite([]) throws a raw driver error ("Invalid BulkOperation, Batch
  // cannot be empty"), so an absent or empty list has to be caught here to come
  // back as a sentence rather than as mongo internals.
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array of { _id, order }');
  }

  const requested = items.map(raw => {
    const { _id, order } = (raw ?? {}) as { _id?: unknown; order?: unknown };
    const id = String(_id ?? '');
    if (!Types.ObjectId.isValid(id)) {
      throw new Error(`items contains an invalid _id: ${id || '(missing)'}`);
    }
    const position = Number(order);
    if (!Number.isFinite(position)) {
      throw new Error(`items contains a non-numeric order for ${id}`);
    }
    return { _id: id, order: position };
  });

  const ids = requested.map(i => i._id);
  // Two entries for one row would leave the winner decided by write order.
  if (new Set(ids).size !== ids.length) throw new Error('items names the same _id twice');

  const targets = await findReorderTargets(level, ids);
  if (targets.length !== ids.length) {
    const found = new Set(targets.map(t => t._id));
    const missing = ids.filter(id => !found.has(id));
    throw new Error(`items names ${level} that do not exist: ${missing.join(', ')}`);
  }

  const parents = new Set(targets.map(t => t.parent));
  if (parents.size !== 1) {
    throw new Error(`every one of the ${level} must belong to the same ${parentKey}`);
  }
  const [parent] = parents;
  if (scopeId !== undefined && scopeId !== null && String(scopeId) !== parent) {
    throw new Error(`those ${level} do not belong to ${parentKey} ${String(scopeId)}`);
  }

  // The parent is part of every filter, not just a precondition checked above:
  // the write itself is then incapable of reaching outside the one parent, so
  // a document that moved between the check and the write cannot be caught by
  // it either.
  const writes = requested.map(i => ({
    updateOne: {
      filter: { _id: i._id, [parentKey]: parent },
      update: { $set: { order: i.order } },
    },
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
  }

  return { updated: requested.length, [parentKey]: parent };
};

/**
 * Next topic in book order after the given one.
 *
 * Ordering is: same chapter → same part → same book. The reader hits this at
 * the last question of a topic and follows the returned QR code to the next
 * scannable page.
 *
 * Two separate access checks, and both matter:
 *
 *   • the CURRENT topic — otherwise any signed-in user holding one topic id
 *     could walk the whole book, harvesting every topic title and printed QR
 *     code. Topic ids are sequential-ish ObjectIds, so one id is enough to
 *     start guessing. Returns null rather than an error: to a caller with no
 *     business here, the book simply has no next topic.
 *   • the NEXT topic — reported as `allowed` so a reader who finishes the free
 *     chapter is shown a padlock instead of a working link.
 */
const getNextTopicForReader = async (topicId: string, userId: string) => {
  const current = await BookTopic.findById(topicId)
    .select('bookId partId chapterId order')
    .lean();
  if (!current) return null;

  const mayReadCurrent = await BookAccessService.hasBookAccess(userId, current.bookId);
  if (!mayReadCurrent) return null;

  // Same chapter, next in order.
  let next = await BookTopic.findOne({
    chapterId: current.chapterId,
    order: { $gt: current.order },
    isDeleted: false,
    isPublished: true,
  })
    .sort({ order: 1 })
    .lean();

  // Overflow into the next chapter of the same part.
  if (!next) {
    const currentChapter = await BookChapter.findById(current.chapterId).select('order').lean();
    const nextChapter = await BookChapter.findOne({
      partId: current.partId,
      order: { $gt: currentChapter?.order ?? 0 },
      isDeleted: false,
    })
      .sort({ order: 1 })
      .lean();

    if (nextChapter) {
      next = await BookTopic.findOne({
        chapterId: nextChapter._id,
        isDeleted: false,
        isPublished: true,
      })
        .sort({ order: 1 })
        .lean();
    }
  }

  // Overflow into the next part.
  if (!next) {
    const currentPart = await BookPart.findById(current.partId).select('order').lean();
    const nextPart = await BookPart.findOne({
      bookId: current.bookId,
      order: { $gt: currentPart?.order ?? 0 },
      isDeleted: false,
    })
      .sort({ order: 1 })
      .lean();

    if (nextPart) {
      const firstChapterInNextPart = await BookChapter.findOne({
        partId: nextPart._id,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean();
      if (firstChapterInNextPart) {
        next = await BookTopic.findOne({
          chapterId: firstChapterInNextPart._id,
          isDeleted: false,
          isPublished: true,
        })
          .sort({ order: 1 })
          .lean();
      }
    }
  }

  if (!next) return null;

  const nextChapter = await BookChapter.findById(next.chapterId)
    .select('title chapterNo')
    .lean();
  const allowed = await BookAccessService.hasBookAccess(userId, next.bookId);

  return {
    qrCode: next.qrCode,
    topicTitle: next.title,
    topicNo: next.topicNo,
    chapterTitle: nextChapter?.title,
    chapterNo: nextChapter?.chapterNo,
    // The client uses this to decide whether to lead the user with the button
    // (allowed) or with a padlock + "buy to continue" (not allowed).
    allowed,
  };
};

/**
 * May this user fetch this protected media file?
 *
 * Answer figures, videos and PDFs used to sit under the world-readable
 * /uploads mount, so anyone holding (or guessing) a filename could pull paid
 * artwork without an account. They now live outside it and come through here.
 *
 * The file is located by finding the question that references it, which gives
 * the owning book; access is then the same rule as a scan — ownership of the
 * book, and nothing else. Unreferenced files are refused outright, so an
 * orphaned upload is not a public bucket.
 */
const canReadProtectedMedia = async (fileName: string, userId: string): Promise<boolean> => {
  // Anchored to the end of the stored URL so "12-a.jpg" cannot match a request
  // for "…/912-a.jpg". The filename itself is already sanitised by multer and
  // re-validated by the controller before it reaches here.
  const suffix = new RegExp(`/${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

  const question = await BookQuestion.findOne({
    isDeleted: false,
    $or: [{ 'videos.url': suffix }, { 'attachments.fileUrl': suffix }, { images: suffix }],
  })
    .select('bookId chapterId')
    .lean();

  if (!question) return false;


  return BookAccessService.hasBookAccess(userId, question.bookId);
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

// ─── Outline ────────────────────────────────────────────────

export interface OutlineChapter {
  chapterNo?: string;
  title: string;
  titleBn?: string;
  topicCount: number;
  questionCount: number;
}

export interface BookOutline {
  totals: {
    parts: number;
    chapters: number;
    topics: number;
    questions: number;
  };
  parts: { title: string; titleBn?: string; chapters: OutlineChapter[] }[];
}

/**
 * The book's table of contents, for the public shop page.
 *
 * Structure only — titles and counts. No questions, no answers, no media and no
 * QR code, at any level: this endpoint needs no token, so anything it returns is
 * public, and a code that reaches a browser is a code that can be typed into
 * /b/. The counts are worth publishing because they are facts about the book
 * rather than marketing copy; the codes are the product.
 *
 * Returns null for an unknown book so the caller can render nothing instead of
 * a page of zeroes.
 */
const getOutline = async (bookIdOrSlug: string): Promise<BookOutline | null> => {
  const book = await Book.findOne({
    ...(Types.ObjectId.isValid(bookIdOrSlug)
      ? { _id: new Types.ObjectId(bookIdOrSlug) }
      : { slug: bookIdOrSlug }),
  })
    .select('_id')
    .lean();

  if (!book) return null;

  const bookId = book._id;
  const live = { bookId, isDeleted: false, isPublished: true };

  const [parts, chapters, topics] = await Promise.all([
    BookPart.find(live).select('title titleBn order').sort({ order: 1 }).lean(),
    BookChapter.find(live).select('partId chapterNo title titleBn order').sort({ order: 1 }).lean(),
    BookTopic.find(live).select('chapterId qrCode order').sort({ order: 1 }).lean(),
  ]);

  // One grouped count instead of a query per chapter — a book with 60 topics
  // would otherwise mean 60 round trips on every render of the landing page.
  const questionCounts = await BookQuestion.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { bookId, isDeleted: false, isPublished: true } },
    { $group: { _id: '$topicId', n: { $sum: 1 } } },
  ]);
  const questionsByTopic = new Map(questionCounts.map((r) => [String(r._id), r.n]));

  const topicsByChapter = new Map<string, typeof topics>();
  for (const t of topics) {
    const key = String(t.chapterId);
    const list = topicsByChapter.get(key);
    if (list) list.push(t);
    else topicsByChapter.set(key, [t]);
  }

  let totalTopics = 0;
  let totalQuestions = 0;

  const chaptersByPart = new Map<string, OutlineChapter[]>();

  for (const ch of chapters) {
    const chTopics = topicsByChapter.get(String(ch._id)) ?? [];
    const questionCount = chTopics.reduce(
      (sum, t) => sum + (questionsByTopic.get(String(t._id)) ?? 0),
      0
    );

    totalTopics += chTopics.length;
    totalQuestions += questionCount;

    const entry: OutlineChapter = {
      chapterNo: ch.chapterNo,
      title: ch.title,
      titleBn: ch.titleBn,
      topicCount: chTopics.length,
      questionCount,
    };

    const key = String(ch.partId);
    const list = chaptersByPart.get(key);
    if (list) list.push(entry);
    else chaptersByPart.set(key, [entry]);
  }

  // A part with no published chapters is dropped — an empty accordion row on
  // the shop page reads as a missing chapter list, not as an empty section.
  const outlineParts = parts
    .map((p) => ({
      title: p.title,
      titleBn: p.titleBn,
      chapters: chaptersByPart.get(String(p._id)) ?? [],
    }))
    .filter((p) => p.chapters.length > 0);

  return {
    totals: {
      parts: outlineParts.length,
      chapters: chapters.length,
      topics: totalTopics,
      questions: totalQuestions,
    },
    parts: outlineParts,
  };
};

export const BookContentService = {
  scanTopic,
  getOutline,
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
  restoreQuestion,
  getQuestionsByTopic,
  getTopicById,
  reorder,
  getNextUnanswered,
  getNextTopicForReader,
  canReadProtectedMedia,
};
