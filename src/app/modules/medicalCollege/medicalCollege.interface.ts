import { Types } from 'mongoose';

// Government / private / military. Kept as the PDF classifies them, because the
// admission seat counts and the way students describe themselves both follow
// that split.
export type TCollegeType = 'government' | 'private' | 'army';

export interface IMedicalCollege {
  _id?: Types.ObjectId;
  name: string;
  /** Lower-cased, punctuation-stripped name — what the search box matches on. */
  searchKey: string;
  /**
   * How students write the college: DMC, SSMC, RMC. It is the first part of a
   * Campus Ambassador's coupon code (DMC + SAKIB + 20), so it is short, upper
   * case and letters only.
   *
   * Derived from the name where the shop has not supplied one — see
   * deriveAbbreviation. A derived value is a guess, and `abbreviationSource`
   * says so, because the real ones are not always the initials (Sylhet MAG
   * Osmani is SOMC, not SMOMC).
   */
  abbreviation?: string;
  abbreviationSource?: 'official' | 'derived';
  type: TCollegeType;
  division: string;
  district: string;
  /** Upazila or neighbourhood, as printed in the source list. */
  area?: string;
  established?: number;
  seats?: number | null;
  /**
   * Rows whose data could not be fully recovered from the source PDF. Surfaced
   * in the admin list so they can be corrected, and never silently guessed.
   */
  needsReview?: boolean;
  /** Retired colleges stay in the collection so old signups still resolve. */
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
