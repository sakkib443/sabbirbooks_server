import { Schema, model, Types } from 'mongoose';

/**
 * One printed copy of a book, and the code hidden on it.
 *
 * WHY THIS EXISTS
 *
 * Access used to come from the order: you bought it, you can read the QR
 * content. That breaks in the two ways the shop actually sells books. Somebody
 * orders six copies on one account so the delivery charge is paid once, then
 * hands five to classmates — five readers with a book and no access, one
 * account with access to all six. And a student buys a copy for a friend, so
 * the access lands on the wrong person entirely.
 *
 * The book in someone's hands is the thing that was paid for, so the book
 * itself carries the proof: a code under a scratch panel, redeemed once, onto
 * whichever account is holding it.
 *
 * THE ONE PROPERTY THAT MATTERS
 *
 * A code must tell you nothing about any other code. Sequential numbers, a
 * date, an order id, a checksum over the title — anything with structure means
 * one buyer can work out a thousand codes and hand them round. So the code is
 * random bytes from the OS, not derived from anything at all, and the only
 * place to check whether one is real is this collection.
 *
 * WHAT REDEEMING DOES NOT DO
 *
 * It does not take the buyer's access away. Someone who ordered and had the
 * parcel delivered keeps reading on the account they ordered with, whether or
 * not anybody ever redeems a code — most buyers will never type one in, and a
 * system that silently switched their access off the day a friend registered
 * would be worse than the problem it fixes. Redeeming ADDS an account; it
 * never removes one.
 */
export type TBookCopyStatus = 'available' | 'redeemed' | 'void';

export interface IBookCopy {
  code: string;
  book: Types.ObjectId;
  /** Which print run this came from — the shop's own bookkeeping. */
  batch: string;
  status: TBookCopyStatus;

  redeemedBy?: Types.ObjectId;
  redeemedAt?: Date;
  /** Who the shop now knows is holding this copy. */
  holder?: {
    fullName?: string;
    medicalCollege?: Types.ObjectId;
    medicalCollegeName?: string;
    classRoll?: string;
  };

  /** Set when a code is taken out of circulation — a misprint, a lost carton. */
  voidedAt?: Date;
  voidReason?: string;

  createdBy?: Types.ObjectId;
}

const bookCopySchema = new Schema<IBookCopy>(
  {
    // Stored exactly as printed. Uppercase and unique so "mv-7k3p" and
    // "MV-7K3P" cannot be two different copies, and so a second attempt to
    // insert the same code fails loudly rather than creating a twin.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    book: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
    batch: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['available', 'redeemed', 'void'],
      default: 'available',
      index: true,
    },

    redeemedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    redeemedAt: { type: Date },
    holder: {
      fullName: { type: String, trim: true },
      medicalCollege: { type: Schema.Types.ObjectId, ref: 'MedicalCollege' },
      medicalCollegeName: { type: String, trim: true },
      classRoll: { type: String, trim: true },
    },

    voidedAt: { type: Date },
    voidReason: { type: String, trim: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// `code` already has unique:true above, which builds its index — no separate
// schema.index() for it (that is the "Duplicate schema index" Mongoose warns
// about). These two are for the admin list: "this book's codes, newest first"
// and "who redeemed what".
bookCopySchema.index({ book: 1, status: 1, createdAt: -1 });
bookCopySchema.index({ redeemedBy: 1 });

export const BookCopy = model<IBookCopy>('BookCopy', bookCopySchema);
