import { Capability, Role } from '../../config/permissions';

export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName?: string;
  phoneNumber?: string;
  /** Required of students, enforced at signup rather than in the schema. */
  whatsappNumber?: string;
  /** ObjectId of a MedicalCollege; the three fields below snapshot it. */
  medicalCollege?: string;
  medicalCollegeName?: string;
  district?: string;
  division?: string;
  upazila?: string;
  location?: string;
  gender?: 'male' | 'female' | 'other';
  password?: string;
  isPasswordChanged?: boolean;
  /** When the password last changed — by its owner, a reset link or an admin. */
  passwordChangedAt?: Date;
  /**
   * A pending "forgot password" link. Only the SHA-256 of the emailed token is
   * stored; the token itself exists nowhere but the owner's inbox. Not selected
   * by default — see user.model.ts.
   */
  passwordReset?: {
    tokenHash: string;
    expiresAt: Date;
    requestedAt: Date;
  };
  role: Role;
  /**
   * Capability overrides. ABSENT (undefined) means "fall back to the role's
   * defaults" — that is how every pre-existing account behaves. An explicit []
   * means an admin has switched everything off.
   */
  permissions?: Capability[];
  status?: 'active' | 'blocked' | 'pending';
  isDeleted?: boolean;
  image?: string;
  googleId?: string;
  authProvider?: 'local' | 'google';
  _id?: string;
}
