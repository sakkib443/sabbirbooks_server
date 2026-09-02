/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Making copy codes, and redeeming them.
 *
 * The redemption path is the one to read carefully: it is the only place in the
 * shop where typing a string at a public URL grants paid access, so it is
 * written to be boring under attack and forgiving under a typo.
 */
import { Types, isValidObjectId } from 'mongoose';
import { BookCopy, IBookCopy } from './bookCopy.model';
import { generateCode, normalizeCode } from './copyCode';
import { BookAccess } from '../bookAccess/bookAccess.model';
import { Book } from '../book/book.model';
import { MedicalCollege } from '../medicalCollege/medicalCollege.model';

export interface GenerateInput {
  bookId: string;
  count: number;
  batch?: string;
  createdBy?: string;
}

/** One print run's worth of codes, in one go. */
const MAX_PER_BATCH = 20000;

/**
 * Mint `count` codes for a book.
 *
 * insertMany with ordered:false so one unlucky collision does not throw away
 * the whole batch — the unique index rejects just that document and the rest
 * land. Whatever was rejected is minted again on the next pass, up to a bound.
 * At 59 bits a collision is a curiosity rather than an expectation, but "we
 * printed 4,981 of the 5,000 you asked for" is a bug the shop would find in a
 * warehouse, not in a log.
 */
const generate = async (input: GenerateInput): Promise<IBookCopy[]> => {
  const { bookId, batch = '', createdBy } = input;
  const count = Math.floor(Number(input.count) || 0);

  if (!isValidObjectId(bookId)) throw new Error('Invalid book id');
  if (count < 1) throw new Error('How many codes? Ask for at least one.');
  if (count > MAX_PER_BATCH) {
    throw new Error(`That is more than ${MAX_PER_BATCH.toLocaleString()} at once — split the run.`);
  }
  const book = await Book.findById(bookId).select('_id title').lean();
  if (!book) throw new Error('Book not found');

  const made: IBookCopy[] = [];
  for (let attempt = 0; attempt < 5 && made.length < count; attempt++) {
    const wanted = count - made.length;
    const docs = Array.from({ length: wanted }, () => ({
      code: generateCode(),
      book: new Types.ObjectId(bookId),
      batch: String(batch).trim(),
      status: 'available' as const,
      createdBy: createdBy && isValidObjectId(createdBy) ? new Types.ObjectId(createdBy) : undefined,
    }));

    const inserted = await BookCopy.insertMany(docs, { ordered: false }).catch((e: any) => {
      // A duplicate-key error still inserted everything that did not clash;
      // mongoose hands those back on the error.
      if (e?.insertedDocs) return e.insertedDocs;
      throw e;
    });
    made.push(...(inserted as IBookCopy[]));
  }

  if (made.length < count) {
    throw new Error(
      `Only ${made.length} of ${count} codes could be created — something is wrong with code generation.`
    );
  }
  return made;
};

export interface RedeemInput {
  code: string;
  userId: string;
  fullName?: string;
  medicalCollege?: string;
  medicalCollegeName?: string;
  classRoll?: string;
}

export interface RedeemResult {
  bookId: Types.ObjectId;
  bookTitle: string;
  code: string;
}

/**
 * Turn a code on a book into access for an account.
 *
 * Every refusal below says exactly one thing, and none of them say more than
 * the person in front of the form needs. "Already used" is deliberately not
 * "already used by rahim@gmail.com on 3 September" — the code is printed in a
 * book that may be second-hand, and whoever is holding it now does not get to
 * learn the previous owner's email by typing it in.
 *
 * The write is a conditional update, not a read-then-write. Two people racing
 * the same code — the buyer and the friend they gave the book to, both typing
 * it in the same minute — must produce one winner, and `status: 'available'`
 * inside the filter is what guarantees that. A findOne() followed by a save()
 * would hand the book to both.
 */
const redeem = async (input: RedeemInput): Promise<RedeemResult> => {
  const code = normalizeCode(input.code);
  if (!code) {
    throw new Error('এই কোডটি সঠিক নয়। বইয়ের কোডটি আবার দেখে লিখুন। (That is not a valid code.)');
  }
  if (!isValidObjectId(input.userId)) throw new Error('Sign in first');

  const existing = await BookCopy.findOne({ code }).select('status book').lean();
  if (!existing) {
    throw new Error('এই কোডটি আমাদের তালিকায় নেই। (This code is not one of ours.)');
  }
  if (existing.status === 'void') {
    throw new Error(
      'এই কোডটি বাতিল করা হয়েছে। সাপোর্টে যোগাযোগ করুন। (This code has been cancelled — please contact support.)'
    );
  }
  if (existing.status === 'redeemed') {
    throw new Error(
      'এই কোডটি আগেই ব্যবহার করা হয়েছে। একটি কোড একবারই চালু করা যায়। (This code has already been used — a code works once.)'
    );
  }

  // The college's name is snapshotted alongside its id for the same reason the
  // ambassador records do it: the directory can be renamed later, and a record
  // of who registered should not quietly change with it.
  let collegeId: Types.ObjectId | undefined;
  let collegeName = String(input.medicalCollegeName || '').trim();
  if (input.medicalCollege && isValidObjectId(input.medicalCollege)) {
    const college = await MedicalCollege.findById(input.medicalCollege).select('name').lean();
    if (college) {
      collegeId = college._id as Types.ObjectId;
      collegeName = college.name;
    }
  }

  const claimed = await BookCopy.findOneAndUpdate(
    { code, status: 'available' },
    {
      $set: {
        status: 'redeemed',
        redeemedBy: new Types.ObjectId(input.userId),
        redeemedAt: new Date(),
        holder: {
          fullName: String(input.fullName || '').trim(),
          medicalCollege: collegeId,
          medicalCollegeName: collegeName,
          classRoll: String(input.classRoll || '').trim(),
        },
      },
    },
    { new: true }
  );

  // Lost the race — somebody redeemed it between the check above and here.
  if (!claimed) {
    throw new Error(
      'এই কোডটি এইমাত্র ব্যবহার করা হয়েছে। (This code was redeemed a moment ago.)'
    );
  }

  const book: any = await Book.findById(claimed.book).select('title').lean();

  /**
   * The grant itself.
   *
   * upsert, because the account may already have access — the buyer redeeming
   * a code from their own parcel is the ordinary case, not an error, and the
   * unique index on (userId, bookId) would otherwise throw in their face. They
   * get the same access twice, which is no access at all, and the code is
   * spent. That is the correct outcome: the code is attached to a copy, and
   * that copy has now been claimed by somebody.
   */
  await BookAccess.updateOne(
    { userId: input.userId, bookId: claimed.book },
    {
      $set: { source: 'manual', note: `Book code ${code}` },
      $unset: { revokedAt: '' },
      $setOnInsert: { userId: input.userId, bookId: claimed.book },
    },
    { upsert: true }
  );

  return {
    bookId: claimed.book,
    bookTitle: book?.title || 'বই',
    code,
  };
};

/** Admin list, filtered the way the codes screen asks. */
const list = async (query: {
  book?: string;
  status?: string;
  batch?: string;
  q?: string;
  page?: string;
  limit?: string;
}) => {
  const filter: Record<string, unknown> = {};
  if (query.book && isValidObjectId(query.book)) filter.book = query.book;
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.batch) filter.batch = query.batch;
  if (query.q) {
    const term = String(query.q).trim();
    // A code is looked up whole; everything else is a name or a roll number.
    const asCode = normalizeCode(term);
    filter.$or = [
      ...(asCode ? [{ code: asCode }] : []),
      { code: { $regex: term.toUpperCase(), $options: 'i' } },
      { 'holder.fullName': { $regex: term, $options: 'i' } },
      { 'holder.classRoll': { $regex: term, $options: 'i' } },
      { 'holder.medicalCollegeName': { $regex: term, $options: 'i' } },
    ];
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);

  const [rows, total, counts] = await Promise.all([
    BookCopy.find(filter)
      .populate('book', 'title slug')
      .populate('redeemedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BookCopy.countDocuments(filter),
    BookCopy.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  return {
    rows,
    total,
    page,
    limit,
    counts: Object.fromEntries(counts.map((c: any) => [c._id, c.n])),
  };
};

/**
 * Take a code out of circulation.
 *
 * A misprint, a carton that never arrived, a sheet of codes photographed
 * before it shipped. Never deletes: a voided code has to keep answering "this
 * one was cancelled" rather than "not one of ours", or the shop cannot tell a
 * cancelled code from a forged one.
 */
const voidCode = async (id: string, reason: string) => {
  if (!isValidObjectId(id)) throw new Error('Invalid code id');
  const copy = await BookCopy.findById(id);
  if (!copy) throw new Error('Code not found');
  if (copy.status === 'redeemed') {
    throw new Error(
      'This code has already been redeemed. Voiding it would not take the reader\'s access away — remove that from the book-access screen instead.'
    );
  }
  copy.status = 'void';
  copy.voidedAt = new Date();
  copy.voidReason = String(reason || '').trim();
  await copy.save();
  return copy;
};

/** The batch as a CSV, which is what the printer actually needs. */
const exportCsv = async (query: { book?: string; batch?: string; status?: string }) => {
  const filter: Record<string, unknown> = {};
  if (query.book && isValidObjectId(query.book)) filter.book = query.book;
  if (query.batch) filter.batch = query.batch;
  if (query.status && query.status !== 'all') filter.status = query.status;

  const rows = await BookCopy.find(filter).select('code batch status createdAt').sort({ createdAt: 1 }).lean();
  const head = 'code,batch,status,created';
  const body = rows.map(
    (r: any) => `${r.code},${r.batch || ''},${r.status},${new Date(r.createdAt).toISOString().slice(0, 10)}`
  );
  return [head, ...body].join('\r\n');
};

export const BookCopyService = { generate, redeem, list, voidCode, exportCsv, MAX_PER_BATCH };
