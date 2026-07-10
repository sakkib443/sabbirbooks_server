import { Types } from 'mongoose';

export interface ICourseModule {
  courseId: Types.ObjectId;
  title: string;
  titleBn?: string;
  description?: string;
  order: number;
  isPublished: boolean;
  isDeleted: boolean;
}
