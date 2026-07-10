import { Schema, model, Types } from 'mongoose';
import { ICourseModule } from './courseModule.interface';

const courseModuleSchema = new Schema<ICourseModule>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, required: true, trim: true },
    titleBn: { type: String, trim: true },
    description: { type: String },
    order: { type: Number, required: true, default: 1 },
    isPublished: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Ensure order is unique within a course
courseModuleSchema.index({ courseId: 1, order: 1 });

export const CourseModule = model<ICourseModule>('CourseModule', courseModuleSchema);
