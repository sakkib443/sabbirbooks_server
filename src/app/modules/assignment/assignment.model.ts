import { Schema, model, Types } from 'mongoose';

// ─── Assignment Model ───────────────────────────────────────
export interface IAssignment {
  courseId: Types.ObjectId;
  batchId?: Types.ObjectId;
  moduleId?: Types.ObjectId;
  title: string;
  description?: string;
  instructions?: string;
  totalMarks: number;
  deadline?: Date;
  attachments?: { title: string; fileUrl: string; fileType: string }[];
  isPublished: boolean;
  createdBy: Types.ObjectId;
  isDeleted: boolean;
}

const assignmentSchema = new Schema<IAssignment>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    // Batch this assessment belongs to (mentor's offline-marks gradebook). Optional for legacy course-level assignments.
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch' },
    moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule' },
    title: { type: String, required: true },
    description: { type: String },
    instructions: { type: String },
    totalMarks: { type: Number, required: true, min: 1 },
    deadline: { type: Date },
    attachments: [{
      title: { type: String },
      fileUrl: { type: String },
      fileType: { type: String },
    }],
    isPublished: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

assignmentSchema.index({ courseId: 1 });

export const Assignment = model<IAssignment>('Assignment', assignmentSchema);

// ─── Assignment Submission Model ────────────────────────────
export interface IAssignmentSubmission {
  assignmentId: Types.ObjectId;
  studentId: Types.ObjectId;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  marks?: number;
  feedback?: string;
  status: 'submitted' | 'graded' | 'returned';
  submittedAt: Date;
  gradedAt?: Date;
  gradedBy?: Types.ObjectId;
  isDeleted: boolean;
}

const assignmentSubmissionSchema = new Schema<IAssignmentSubmission>(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String },
    fileUrl: { type: String },
    fileName: { type: String },
    marks: { type: Number },
    feedback: { type: String },
    status: { type: String, enum: ['submitted', 'graded', 'returned'], default: 'submitted' },
    submittedAt: { type: Date, default: Date.now },
    gradedAt: { type: Date },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

assignmentSubmissionSchema.index({ assignmentId: 1, studentId: 1 });
assignmentSubmissionSchema.index({ studentId: 1 });

export const AssignmentSubmission = model<IAssignmentSubmission>('AssignmentSubmission', assignmentSubmissionSchema);
