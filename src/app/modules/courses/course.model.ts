import { Schema, model } from 'mongoose';
import { ICourse } from './course.interface';

const courseSchema = new Schema<ICourse>({
  id: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  slug: { type: String, required: true },

  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },

  type: { type: String, enum: ['Online', 'Offline', 'Recorded'], required: true },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
  image: { type: String, required: true },
  fee: { type: String, required: true },
  offerPrice: { type: String, required: false },
  // ভর্তি নিশ্চিত করার minimum টাকা (0 = পুরো টাকা দিতে হবে)
  admissionFee: { type: Number, required: false, default: 0 },
  rating: { type: Number, default: 4.7 },
  totalRating: { type: Number, default: 28 },
  totalStudentsEnroll: { type: Number, default: 260 },

  mentor: { type: Schema.Types.ObjectId, ref: 'Mentor', required: true },

  technology: { type: String, required: true },
  // Live (Online/Offline) কোর্সের জন্য — Recorded কোর্সে থাকে না
  courseStart: { type: String, required: false },
  durationMonth: { type: Number, required: false },
  curriculum: { type: [String], default: [] },

  lectures: { type: Number, required: true },
  totalExam: { type: Number, default: 0 },
  totalProject: { type: Number, default: 0 },
  details: { type: String, required: true },
  courseOverview: { type: String, required: true },
  courseIncludes: [
    {
      icon: { type: String, required: true },
      text: { type: String, required: true },
    },
  ],
  softwareYoullLearn: [{ type: String, required: true }],
  jobPositions: [{ type: String, required: true }],
}, { timestamps: true });

export const Course = model<ICourse>('Course', courseSchema);
