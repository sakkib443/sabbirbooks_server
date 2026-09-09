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
import { User } from '../user/user.model';

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

  const existing = await BookCopy.findOne({ code }).select('status book released').lean();
  if (!existing) {
    throw new Error('এই কোডটি আমাদের তালিকায় নেই। (This code is not one of ours.)');
  }
  /*
   * A real code, from a print run that has not gone out yet.
   *
   * All 3,000 codes were generated at once; the books are printed in batches.
   * So a code can be genuine, unused, and still not something anyone should be
   * holding — a photo of the sheet, a printer's proof, a guess that happened to
   * land. Checked before 'void' and 'redeemed' because it is the earlier fact:
   * this code was never in circulation to be cancelled or spent.
   *
   * The message does not say "not released yet". Someone typing a code they
   * should not have does not need to be told they are early — and a buyer
   * seeing this genuinely has a problem the shop must look at, since it means
   * a book went out ahead of its batch.
   */
  if (existing.released === false) {
    throw new Error(
      'এই কোডটি এখনো চালু করা হয়নি। বইয়ের কোডটি আবার দেখে নিন, নাহলে সাপোর্টে যোগাযোগ করুন। ' +
        '(This code is not active yet — please check it again or contact support.)'
    );
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
    // `released` repeated here, not just checked above. The check above exists
    // to give a good message; THIS is the gate. Between the two lines an admin
    // can pull a batch back, and only a condition inside the write itself
    // catches that. `$ne: false` rather than `true` so the codes written before
    // the field existed — which have no value at all — still claim.
    { code, status: 'available', released: { $ne: false } },
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
      /*
       * source and note are set ON INSERT ONLY.
       *
       * They used to be in $set, which meant a buyer who had already been
       * granted the book by their ORDER and then redeemed the code from the
       * same parcel had that order grant rewritten into "manual, Book code X".
       * The record that they bought it was destroyed by the ordinary act of
       * using their own code — and an admin later resetting that code would
       * then revoke the access they had paid for.
       *
       * On insert these describe how the access came about. On a second grant
       * they describe nothing new, so they are left alone.
       */
      $setOnInsert: {
        userId: input.userId,
        bookId: claimed.book,
        source: 'manual',
        note: `Book code ${code}`,
      },
      // Un-revoking stays unconditional: whatever happened before, this person
      // is holding a valid unused code right now.
      $unset: { revokedAt: '' },
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
  released?: string;
  page?: string;
  limit?: string;
}) => {
  const filter: Record<string, unknown> = {};
  if (query.book && isValidObjectId(query.book)) filter.book = query.book;
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.batch) filter.batch = query.batch;

  // Which print batch is live. `$ne: true` rather than `false` because the
  // codes written before the field existed have no value at all, and they are
  // held back by nothing — they belong on the "live" side.
  if (query.released === 'true') filter.released = { $ne: false };
  if (query.released === 'false') filter.released = false;

  if (query.q) {
    const term = String(query.q).trim();
    // A code is looked up whole; everything else is a name or a roll number.
    const asCode = normalizeCode(term);

    // Email is the one thing an admin searches by that is NOT on this document
    // — it lives on the account that redeemed the code. And it is exactly what
    // they have in hand when a reader writes in saying the book opened on the
    // wrong address, so it is worth the extra lookup.
    const byEmail = term.includes('@')
      ? await User.find({ email: { $regex: term, $options: 'i' } }).select('_id').lean()
      : [];

    filter.$or = [
      ...(asCode ? [{ code: asCode }] : []),
      { code: { $regex: term.toUpperCase(), $options: 'i' } },
      { 'holder.fullName': { $regex: term, $options: 'i' } },
      { 'holder.classRoll': { $regex: term, $options: 'i' } },
      { 'holder.medicalCollegeName': { $regex: term, $options: 'i' } },
      ...(byEmail.length ? [{ redeemedBy: { $in: byEmail.map((u) => u._id) } }] : []),
    ];
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const page = Math.max(Number(query.page) || 1, 1);

  /*
   * Ordered by the sheet's own numbering, with the unnumbered codes last.
   *
   * All 3,000 imported codes share one createdAt to the second, so sorting by
   * time put a 3,000-row list in arbitrary order. Sorting by serial fixes that
   * — except Mongo sorts a MISSING field before every number, so the 1,000
   * older codes, which have no serial at all, took over the top of the list and
   * every visible row showed "—". An aggregation is used rather than find()
   * for exactly this: it can substitute a large value for the missing field so
   * those rows sort to the end, where a list numbered 1..3000 expects them.
   */
  const [rows, total, counts] = await Promise.all([
    BookCopy.aggregate([
      { $match: filter },
      { $addFields: { _order: { $ifNull: ['$serial', Number.MAX_SAFE_INTEGER] } } },
      { $sort: { _order: 1, createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _order: 0 } },
    ]).then((docs) =>
      // aggregate() returns plain objects, so populate is called on them
      // afterwards rather than chained — same two joins the screen needs.
      BookCopy.populate(docs, [
        { path: 'book', select: 'title slug' },
        { path: 'redeemedBy', select: 'firstName lastName email' },
      ])
    ),
    BookCopy.countDocuments(filter),
    /*
     * The counts the TABS need, which are not the counts `status` gives.
     *
     * "Ready to use" is not a status — it is available AND from a batch that
     * has shipped. A code sitting in an unprinted batch is also 'available'
     * and putting the two together in one number told the shop it had 3,998
     * usable codes when it had 500. Each tab counts its own condition.
     */
    BookCopy.aggregate([
      {
        $facet: {
          ready: [{ $match: { status: 'available', released: { $ne: false } } }, { $count: 'n' }],
          used: [{ $match: { status: 'redeemed' } }, { $count: 'n' }],
          // `status: 'available'` here too, so the tabs are a true partition:
          // a voided code from an unprinted batch belongs under "dead", and
          // counting it in both would make the four tabs add up to more than
          // the run.
          waiting: [{ $match: { status: 'available', released: false } }, { $count: 'n' }],
          dead: [{ $match: { status: 'void' } }, { $count: 'n' }],
          all: [{ $count: 'n' }],
        },
      },
    ]),
  ]);

  return {
    rows,
    total,
    page,
    limit,
    // $facet gives each bucket as an array that is empty when nothing matched,
    // so an absent bucket has to read as 0 rather than undefined — a tab
    // labelled "ব্যবহৃত undefined" is how that leaks to the screen.
    counts: Object.fromEntries(
      Object.entries((counts[0] || {}) as Record<string, { n?: number }[]>).map(([k, v]) => [
        k,
        v?.[0]?.n || 0,
      ])
    ),
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

/**
 * Where the released batch currently ends, and what is behind it.
 *
 * The shop's question is never "which rows have released:true" — it is "how
 * many books can be opened right now, and how many are waiting". So this
 * answers in those terms, and reports the highest live serial rather than the
 * count, because that is the number the admin types to move the line.
 */
const releaseState = async () => {
  const withSerial = { serial: { $exists: true, $ne: null } };
  const [total, live, held, redeemed, top] = await Promise.all([
    BookCopy.countDocuments(withSerial),
    BookCopy.countDocuments({ ...withSerial, released: true }),
    BookCopy.countDocuments({ ...withSerial, released: false }),
    BookCopy.countDocuments({ ...withSerial, status: 'redeemed' }),
    BookCopy.findOne({ ...withSerial, released: true }).sort({ serial: -1 }).select('serial').lean(),
  ]);
  return {
    total,
    live,
    held,
    redeemed,
    releasedUpTo: (top as { serial?: number } | null)?.serial ?? 0,
  };
};

/**
 * Move the line: serials 1..upTo work, everything above does not.
 *
 * Codes are generated in one run and printed in batches, so most of the sheet
 * is legitimate but not yet in anybody's hands. This is the switch that keeps
 * an unprinted code worth nothing.
 *
 * A redeemed code is never touched, on either side. One that has been used is
 * in a reader's hands by definition, and sweeping it back would take away a
 * book that was opened properly — the one outcome this feature must never
 * produce while trying to prevent a smaller one.
 */
const setReleasedUpTo = async (upTo: number) => {
  const n = Math.floor(Number(upTo));
  if (!Number.isFinite(n) || n < 0) throw new Error('Give a serial number to release up to.');

  const withSerial = { serial: { $exists: true, $ne: null } };
  const notRedeemed = { status: { $ne: 'redeemed' } };

  const [opened, heldBack] = await Promise.all([
    BookCopy.updateMany(
      { ...withSerial, ...notRedeemed, serial: { $lte: n } },
      { $set: { released: true } }
    ),
    BookCopy.updateMany(
      { ...withSerial, ...notRedeemed, serial: { $gt: n } },
      { $set: { released: false } }
    ),
  ]);

  // The measured state, not the number that was asked for. They can differ:
  // a redeemed code above the line keeps its release, so the highest live
  // serial may sit past `n`. Reporting the request as if it were the result
  // would put a figure on the admin's screen that no row actually agrees with.
  return {
    ...(await releaseState()),
    requestedUpTo: n,
    opened: opened.modifiedCount || 0,
    heldBack: heldBack.modifiedCount || 0,
  };
};

/**
 * Take a redeemed code back, or move it to the right account.
 *
 * The case this exists for is mundane and constant: a buyer types their code
 * while signed in to the wrong Google account, or a friend's phone, or an
 * address they no longer read. The code is spent, the book opens for somebody
 * who is not the reader, and until now nothing could undo it — the code stayed
 * spent forever and the shop's own list showed the wrong name against it.
 *
 * THE ACCESS IS ONLY REVOKED IF THIS CODE GRANTED IT. An account can hold the
 * same book through an order as well, and a reset that blindly removed access
 * would take away something the reader paid for separately. The grant records
 * which code opened it, and that note is what is checked.
 */
const codeGrantNote = (code: string) => `Book code ${code}`;

/**
 * Remove the access this specific code granted, if it is still the reason the
 * account has the book. Returns whether anything was actually revoked.
 */
const revokeGrantFromCode = async (
  userId: Types.ObjectId,
  bookId: Types.ObjectId,
  code: string
): Promise<boolean> => {
  const res = await BookAccess.updateOne(
    { userId, bookId, note: codeGrantNote(code), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }
  );
  return (res.modifiedCount || 0) > 0;
};

export interface ResetInput {
  id: string;
  reason?: string;
  adminId?: string;
}

/**
 * Put a redeemed code back into circulation.
 *
 * The code becomes available again and the holder's details are cleared, so
 * the next person to type it starts clean. What it does NOT do is delete the
 * record that it happened — see `history` on the model.
 */
const resetCode = async (input: ResetInput) => {
  if (!isValidObjectId(input.id)) throw new Error('Code not found');

  const copy: any = await BookCopy.findById(input.id);
  if (!copy) throw new Error('Code not found');
  if (copy.status !== 'redeemed') {
    // Resetting an unused code is a no-op dressed as an action, and a void one
    // needs un-voiding rather than resetting. Saying so beats pretending.
    throw new Error('Only a redeemed code can be reset.');
  }

  const previous = copy.redeemedBy;
  const holder: any = previous
    ? await User.findById(previous).select('email').lean()
    : null;

  const revoked = previous
    ? await revokeGrantFromCode(previous, copy.book, copy.code)
    : false;

  copy.status = 'available';
  copy.redeemedBy = undefined;
  copy.redeemedAt = undefined;
  copy.holder = undefined;
  copy.history = [
    ...(copy.history || []),
    {
      action: 'reset' as const,
      at: new Date(),
      by: input.adminId && isValidObjectId(input.adminId) ? new Types.ObjectId(input.adminId) : undefined,
      fromUser: previous,
      fromEmail: holder?.email,
      reason: String(input.reason || '').trim(),
    },
  ];
  await copy.save();

  return { copy, revokedAccess: revoked, previousEmail: holder?.email || null };
};

export interface EditHolderInput {
  id: string;
  fullName?: string;
  medicalCollegeName?: string;
  classRoll?: string;
}

/**
 * Correct the details typed alongside a code.
 *
 * A reader activating their book types their name, college and roll into a
 * form on a phone, once, quickly. Those three fields are how the shop later
 * recognises them — in the list, in a CSV, in a support thread — so a
 * misspelling is a person who cannot be found. This edits the record without
 * touching who holds the code or whether it works.
 *
 * Only the fields actually sent are changed, so correcting a roll number
 * cannot blank a college.
 */
const editHolder = async (input: EditHolderInput) => {
  if (!isValidObjectId(input.id)) throw new Error('Code not found');

  const copy: any = await BookCopy.findById(input.id);
  if (!copy) throw new Error('Code not found');
  if (copy.status !== 'redeemed') {
    throw new Error('Nobody has used this code yet, so there is nothing to correct.');
  }

  copy.holder = copy.holder || {};
  if (input.fullName !== undefined) copy.holder.fullName = String(input.fullName).trim();
  if (input.medicalCollegeName !== undefined) {
    copy.holder.medicalCollegeName = String(input.medicalCollegeName).trim();
  }
  if (input.classRoll !== undefined) copy.holder.classRoll = String(input.classRoll).trim();

  copy.markModified('holder');
  await copy.save();
  return copy;
};

export interface TransferInput {
  id: string;
  email: string;
  reason?: string;
  adminId?: string;
}

/**
 * Move a redeemed code to a different account.
 *
 * Reset-then-redeem would do the same thing in two steps, but leaves a window
 * where the code is loose — and the whole reason an admin is here is that a
 * code went somewhere it should not have. This moves it in one action, and the
 * code is never available to anyone else in between.
 *
 * The destination must already have an account. Creating one from an email
 * typed into an admin box would produce a passwordless account nobody can sign
 * in to, and the reader would be no better off than before.
 */
const transferCode = async (input: TransferInput) => {
  if (!isValidObjectId(input.id)) throw new Error('Code not found');
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) throw new Error('Which account should it go to? Give an email.');

  const copy: any = await BookCopy.findById(input.id);
  if (!copy) throw new Error('Code not found');
  if (copy.status !== 'redeemed') {
    throw new Error('Only a redeemed code can be transferred. Give this one to the reader instead.');
  }

  const target: any = await User.findOne({ email }).select('email firstName lastName');
  if (!target) {
    throw new Error(
      `No account with the email ${email}. Ask the reader to sign up first, then transfer.`
    );
  }
  if (String(target._id) === String(copy.redeemedBy)) {
    throw new Error('That account already holds this code.');
  }

  const previous = copy.redeemedBy;
  const from: any = previous ? await User.findById(previous).select('email').lean() : null;

  if (previous) await revokeGrantFromCode(previous, copy.book, copy.code);

  // Same upsert the redemption path uses: the target may already have access
  // from an order, and that is not an error — they end up with the book once,
  // which is the correct outcome.
  await BookAccess.updateOne(
    { userId: target._id, bookId: copy.book },
    {
      $set: { source: 'manual', note: codeGrantNote(copy.code) },
      $unset: { revokedAt: '' },
      $setOnInsert: { userId: target._id, bookId: copy.book },
    },
    { upsert: true }
  );

  copy.redeemedBy = target._id;
  copy.redeemedAt = new Date();
  copy.history = [
    ...(copy.history || []),
    {
      action: 'transfer' as const,
      at: new Date(),
      by: input.adminId && isValidObjectId(input.adminId) ? new Types.ObjectId(input.adminId) : undefined,
      fromUser: previous,
      fromEmail: from?.email,
      toUser: target._id,
      toEmail: target.email,
      reason: String(input.reason || '').trim(),
    },
  ];
  await copy.save();

  return { copy, fromEmail: from?.email || null, toEmail: target.email };
};

export const BookCopyService = {
  generate,
  redeem,
  list,
  voidCode,
  exportCsv,
  releaseState,
  setReleasedUpTo,
  resetCode,
  transferCode,
  editHolder,
  MAX_PER_BATCH,
};
