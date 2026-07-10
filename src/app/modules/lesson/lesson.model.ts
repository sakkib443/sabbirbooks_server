import { Schema, model } from 'mongoose';
import { ILesson, ILessonProgress } from './lesson.interface';

const materialSchema = new Schema(
  {
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number },
  },
  { _id: true }
);

const lessonSchema = new Schema<ILesson>(
  {
    moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true },
    description: { type: String },
    type: {
      type: String,
      enum: ['video', 'text', 'quiz', 'assignment'],
      default: 'video',
    },
    videoUrl: { type: String },
    videoDuration: { type: Number },
    videoPublicId: { type: String },
    textContent: { type: String },
    materials: [materialSchema],
    order: { type: Number, required: true, default: 1 },
    isFree: { type: Boolean, default: false },
    isLocked: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

lessonSchema.index({ moduleId: 1, order: 1 });
lessonSchema.index({ courseId: 1 });

const lessonProgressSchema = new Schema<ILessonProgress>(
  {
    lessonId: { type: Schema.Types.ObjectId, ref: 'Lesson', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    watchedPercent: { type: Number, default: 0, min: 0, max: 100 },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date },
    lastWatchedAt: { type: Date },
    lastPosition: { type: Number, default: 0 },
  },
  { timestamps: true }
);

lessonProgressSchema.index({ lessonId: 1, studentId: 1 }, { unique: true });
lessonProgressSchema.index({ courseId: 1, studentId: 1 });

export const Lesson = model<ILesson>('Lesson', lessonSchema);
export const LessonProgress = model<ILessonProgress>('LessonProgress', lessonProgressSchema);
