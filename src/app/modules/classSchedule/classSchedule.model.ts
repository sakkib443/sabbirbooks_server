import { Schema, model, Types } from 'mongoose';

export interface IClassSchedule {
  batchId: Types.ObjectId;
  courseId: Types.ObjectId;
  mentorId: Types.ObjectId;
  title: string;
  topic: string;
  date: Date;
  startTime: string;    // "20:00"
  endTime: string;      // "22:00"
  type: 'live' | 'offline' | 'recorded';
  meetingLink?: string;  // Zoom/Meet/Teams link
  meetingPlatform?: 'zoom' | 'meet' | 'teams' | 'other';
  venue?: string;        // For offline classes
  /** @deprecated Use `recordings[]` instead. Kept for backward compatibility. */
  recordingUrl?: string;
  recordings: {
    title: string;
    url: string;
    addedAt?: Date;
  }[];
  materials: {
    title: string;
    fileUrl: string;
    fileType: string;    // pdf, ppt, doc, zip
  }[];
  notes?: string;
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled';
  sentToStudents: boolean;
  sentAt?: Date;
  isDeleted: boolean;
}

const classScheduleSchema = new Schema<IClassSchedule>(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course' },
    mentorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    topic: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    type: { type: String, enum: ['live', 'offline', 'recorded'], default: 'live' },
    meetingLink: { type: String },
    meetingPlatform: { type: String, enum: ['zoom', 'meet', 'teams', 'other'] },
    venue: { type: String },
    recordingUrl: { type: String }, // legacy single-URL field (kept for back-compat)
    recordings: {
      type: [{
        title: { type: String, required: true },
        url: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
      }],
      default: [],
    },
    materials: [{
      title: { type: String, required: true },
      fileUrl: { type: String, required: true },
      fileType: { type: String, required: true },
    }],
    notes: { type: String },
    status: {
      type: String,
      enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    sentToStudents: { type: Boolean, default: false },
    sentAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

classScheduleSchema.index({ batchId: 1, date: 1 });
classScheduleSchema.index({ mentorId: 1, date: 1 });
classScheduleSchema.index({ courseId: 1, date: 1 });
classScheduleSchema.index({ date: 1, status: 1 });

export const ClassSchedule = model<IClassSchedule>('ClassSchedule', classScheduleSchema);
