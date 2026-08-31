import { Schema, model } from 'mongoose';
import { IAmbassadorApplication } from './ambassador.interface';

/**
 * What every approved ambassador's coupon is worth.
 *
 * Constants, not settings: the shop set one figure for the whole programme, and
 * a per-application discount box is a way for a typo to give somebody's coupon
 * ৳2000 off. If these ever need to vary, they belong in Settings with an admin
 * screen — not in the form the applicant fills in.
 *
 * The ৳20 is also why every code ends in "20" (DMCSAKIB20). Change one and the
 * naming stops meaning anything, so they live next to each other.
 */
export const AMBASSADOR_DISCOUNT_TK = 20;
export const AMBASSADOR_PAYOUT_TK = 30;

const ambassadorSchema = new Schema<IAmbassadorApplication>(
  {
    applicationId: { type: String, required: true, unique: true, trim: true },
    applicationSeq: { type: Number, required: true },

    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, trim: true, default: '' },
    // Lower-cased so "Sakib@Gmail.com" and "sakib@gmail.com" cannot both apply.
    email: { type: String, required: true, trim: true, lowercase: true },
    facebookUrl: { type: String, required: true, trim: true },
    instagramUrl: { type: String, trim: true, default: '' },

    medicalCollege: { type: Schema.Types.ObjectId, ref: 'MedicalCollege' },
    medicalCollegeName: { type: String, required: true, trim: true },
    collegeAbbreviation: { type: String, trim: true, uppercase: true, default: '' },
    batch: { type: String, required: true, trim: true },
    academicYear: {
      type: String,
      enum: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year', 'Intern'],
      required: true,
    },
    city: { type: String, required: true, trim: true },
    idCardUrl: { type: String, trim: true, default: '' },

    reach: {
      type: String,
      enum: ['<25', '25-50', '50-100', '100-200', '200-300', '300+'],
      required: true,
    },
    promoteChannels: {
      type: [String],
      enum: [
        'facebook-profile',
        'facebook-groups',
        'batch-groups',
        'messenger-groups',
        'whatsapp-groups',
        'instagram',
        'classmates',
        'campus-community',
        'other',
      ],
      default: [],
    },
    promoteChannelOther: { type: String, trim: true, default: '' },
    isGroupAdmin: { type: Boolean, default: false },

    hasPriorExperience: { type: Boolean, default: false },
    experienceNote: { type: String, trim: true, default: '' },

    comfortableSharingContent: { type: Boolean, default: true },
    suggestions: { type: String, trim: true, default: '' },

    agreedAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
    },
    adminNote: { type: String, trim: true, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },

    coupon: { type: Schema.Types.ObjectId, ref: 'BookCoupon', default: null },
    couponCode: { type: String, trim: true, uppercase: true, default: '' },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One live application per person. A rejected one is kept — the shop wants to
// see a reapplication — so the guard is on the email plus a status that is still
// in play, not on the email alone.
ambassadorSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['pending', 'approved', 'suspended'] } } }
);

// The admin queue is "newest first, optionally filtered by status".
ambassadorSchema.index({ status: 1, createdAt: -1 });
// The college filter on the admin list.
ambassadorSchema.index({ medicalCollegeName: 1 });

export const AmbassadorApplication = model<IAmbassadorApplication>(
  'AmbassadorApplication',
  ambassadorSchema
);
