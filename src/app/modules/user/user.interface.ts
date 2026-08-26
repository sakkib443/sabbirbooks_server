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
