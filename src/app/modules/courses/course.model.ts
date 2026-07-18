import { Schema, model } from 'mongoose';
import { ICourse } from './course.interface';

// Simplified for the medical-course platform: only `title` is truly required —
// the service fills in id/slug/type when omitted. IT-bootcamp fields
// (technology, totalProject, softwareYoullLearn, jobPositions) were removed.
const courseSchema = new Schema<ICourse>({
  id: { type: Number, required: true, unique: true },
  title: { type: String, required: true },
  slug: { type: String, required: false },

  category: { type: Schema.Types.ObjectId, ref: 'Category', required: false },

  type: { type: String, enum: ['Online', 'Offline', 'Recorded'], default: 'Online' },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'published' },
  image: { type: String, required: false },
  fee: { type: String, required: false },
  offerPrice: { type: String, required: false },
  // ভর্তি নিশ্চিত করার minimum টাকা (0 = পুরো টাকা দিতে হবে)
  admissionFee: { type: Number, required: false, default: 0 },
  rating: { type: Number, default: 4.7 },
  totalRating: { type: Number, default: 28 },
  totalStudentsEnroll: { type: Number, default: 260 },

  mentor: { type: Schema.Types.ObjectId, ref: 'Mentor', required: false },

  // Live (Online/Offline) কোর্সের জন্য — Recorded কোর্সে থাকে না
  courseStart: { type: String, required: false },
  durationMonth: { type: Number, required: false },
  curriculum: { type: [String], default: [] },

  lectures: { type: Number, required: false, default: 0 },
  totalExam: { type: Number, default: 0 },
  details: { type: String, required: false },
  courseOverview: { type: String, required: false },
  courseIncludes: [
    {
      icon: { type: String, required: false },
      text: { type: String, required: false },
    },
  ],
}, { timestamps: true });

export const Course = model<ICourse>('Course', courseSchema);
