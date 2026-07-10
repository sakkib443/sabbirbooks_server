import { Types } from 'mongoose';

export type TLessonType = 'video' | 'text' | 'quiz' | 'assignment';

export interface ILesson {
  moduleId: Types.ObjectId;
  courseId: Types.ObjectId;
  title: string;
  titleBn?: string;
  description?: string;
  type: TLessonType;
  // Video
  videoUrl?: string;
  videoDuration?: number; // seconds
  videoPublicId?: string; // cloudinary public id
  // Text
  textContent?: string;
  // Material files
  materials?: {
    title: string;
    fileUrl: string;
    fileType: string; // pdf, ppt, doc, zip
    fileSize?: number;
  }[];
  // Settings
  order: number;
  isFree: boolean; // Free preview lesson
  isLocked: boolean; // Sequential access control
  isPublished: boolean;
  isDeleted: boolean;
}

export interface ILessonProgress {
  lessonId: Types.ObjectId;
  studentId: Types.ObjectId;
  courseId: Types.ObjectId;
  watchedPercent: number; // 0-100
  isCompleted: boolean;
  completedAt?: Date;
  lastWatchedAt?: Date;
  lastPosition?: number; // seconds — resume feature
}
