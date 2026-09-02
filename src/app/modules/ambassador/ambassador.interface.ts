import { Types } from 'mongoose';

/**
 * A Campus Ambassador application.
 *
 * The shop recruits medical students to introduce the book to their classmates.
 * Each approved ambassador gets a coupon code in their own name; buyers who use
 * it pay less, and the ambassador earns a commission on every sale under it.
 *
 * The application is the record of that arrangement being asked for and granted.
 * It is deliberately a separate document from the coupon it produces:
 *
 *   • an application exists before there is any coupon, and while it is being
 *     reviewed there must be nothing live for anyone to use;
 *   • a rejected application still has to be kept and searchable — the same
 *     person reapplying is a thing the shop wants to see;
 *   • the coupon carries money rules that must not depend on a form field
 *     someone typed.
 */
export type TAmbassadorStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

/** Where the applicant is in their course. Matches the form's dropdown. */
export type TAcademicYear =
  | '1st Year'
  | '2nd Year'
  | '3rd Year'
  | '4th Year'
  | '5th Year'
  | 'Intern';

/** How many students they say they can reach. Bands, as the form asks. */
export type TReachBand =
  | '<25'
  | '25-50'
  | '50-100'
  | '100-200'
  | '200-300'
  | '300+';

/** Where they can promote. Free-form 'other' is carried separately. */
export type TPromoChannel =
  | 'facebook-profile'
  | 'facebook-groups'
  | 'batch-groups'
  | 'messenger-groups'
  | 'whatsapp-groups'
  | 'instagram'
  | 'classmates'
  | 'campus-community'
  | 'other';

export interface IAmbassadorApplication {
  _id?: Types.ObjectId;

  /** MVA-AMB-0001. Human-facing, quoted in messages, never reused. */
  applicationId: string;
  /** The raw counter behind applicationId, for sorting without string maths. */
  applicationSeq: number;
  /** Public form, or added by an admin. See the note on the schema field. */
  source?: 'application' | 'manual';

  // ── Section 1 — who they are ──────────────────────────────────
  fullName: string;
  /** Call-name the coupon code is built from. See the model note. */
  nickname?: string;
  phone: string;
  whatsapp?: string;
  email: string;
  facebookUrl?: string;
  instagramUrl?: string;

  // ── Section 2 — where they study ──────────────────────────────
  /** The directory row. The name is snapshotted beside it so an application
   *  still reads correctly if a college is later renamed or retired. */
  medicalCollege?: Types.ObjectId;
  medicalCollegeName?: string;
  /** The college abbreviation used to build the coupon code, snapshotted at
   *  approval so a later edit to the directory cannot change a live code. */
  collegeAbbreviation?: string;
  /** As the student writes it: "KMC-33". */
  batch?: string;
  academicYear?: TAcademicYear | '';
  city?: string;
  /** Their college ID card. Stored in the protected upload directory and served
   *  through an access check — it is a personal document, not a public file. */
  idCardUrl?: string;

  // ── Section 3 — reach ─────────────────────────────────────────
  reach?: TReachBand | '';
  promoteChannels: TPromoChannel[];
  promoteChannelOther?: string;
  isGroupAdmin: boolean;

  // ── Section 4 — experience ────────────────────────────────────
  hasPriorExperience: boolean;
  experienceNote?: string;

  // ── Section 6 — promotion ─────────────────────────────────────
  comfortableSharingContent: boolean;
  suggestions?: string;

  // ── Section 7 — agreement ─────────────────────────────────────
  /** All six boxes, as one acceptance. The form refuses to submit without every
   *  one of them, and the timestamp is what the shop can point at later. */
  agreedAt?: Date;

  // ── Review ────────────────────────────────────────────────────
  status: TAmbassadorStatus;
  adminNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;

  /** Filled on approval. The coupon is the ambassador's earning instrument and
   *  the user is their login; both are created once and then reused if the
   *  application is suspended and approved again. */
  coupon?: Types.ObjectId;
  couponCode?: string;
  user?: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}
