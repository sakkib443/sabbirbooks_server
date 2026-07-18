import { Types } from 'mongoose';

// Simplified medical-course shape — only `title` is required in practice.
// IT-bootcamp fields (technology, totalProject, softwareYoullLearn, jobPositions)
// were removed.
export interface ICourse {
  id: number;
  title: string;
  slug?: string;

  // শুধু category এর রেফারেন্স (ObjectId)
  category?: Types.ObjectId;

  type?: 'Online' | 'Offline' | 'Recorded';
  status?: 'draft' | 'published' | 'archived';
  image?: string;
  fee?: string;
  offerPrice?: string;
  // ভর্তি নিশ্চিত করার minimum টাকা — student এর কম দিলে enroll হবে না, বাকিটা installment-এ
  admissionFee?: number;
  rating?: number;
  totalRating?: number;
  totalStudentsEnroll?: number;

  // শুধু Mentor এর রেফারেন্স (ObjectId)
  mentor?: Types.ObjectId;

  // Live (Online/Offline) কোর্সের জন্য — Recorded কোর্সে লাগে না
  courseStart?: string;
  durationMonth?: number;
  curriculum?: string[];

  lectures?: number;
  totalExam?: number;
  details?: string;
  courseOverview?: string;
  courseIncludes?: { icon: string; text: string }[];

  createdAt?: Date;
  updatedAt?: Date;
}
