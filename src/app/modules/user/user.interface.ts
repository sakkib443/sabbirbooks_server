export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName?: string;
  phoneNumber?: string;
  location?: string;
  gender?: 'male' | 'female' | 'other';
  password?: string;
  isPasswordChanged?: boolean;
  role: 'superAdmin' | 'admin' | 'trainingManager' | 'mentor' | 'student';
  status?: 'active' | 'blocked' | 'pending';
  isDeleted?: boolean;
  image?: string;
  googleId?: string;
  authProvider?: 'local' | 'google';
  _id?: string;
}
