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
