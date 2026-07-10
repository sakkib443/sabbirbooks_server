import { Schema, model, Types } from 'mongoose';

// ─── Exam Model ─────────────────────────────────────────────
export interface IExam {
  courseId: Types.ObjectId;
  moduleId?: Types.ObjectId;
  title: string;
  description?: string;
  type: 'mcq' | 'written' | 'mixed';
  duration: number;        // minutes
  totalMarks: number;
  passingMarks: number;
  scheduledDate?: Date;
  scheduledTime?: string;
  isPublished: boolean;
  allowReview: boolean;    // students can see correct answers after
  shuffleQuestions: boolean;
  maxAttempts: number;
  createdBy: Types.ObjectId;
  isDeleted: boolean;
}

const examSchema = new Schema<IExam>(
  {
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true },
    moduleId: { type: Schema.Types.ObjectId, ref: 'CourseModule' },
    title: { type: String, required: true },
    description: { type: String },
    type: { type: String, enum: ['mcq', 'written', 'mixed'], default: 'mcq' },
    duration: { type: Number, required: true, min: 1 },
    totalMarks: { type: Number, required: true, min: 1 },
    passingMarks: { type: Number, required: true, min: 0 },
    scheduledDate: { type: Date },
    scheduledTime: { type: String },
    isPublished: { type: Boolean, default: false },
    allowReview: { type: Boolean, default: true },
    shuffleQuestions: { type: Boolean, default: false },
    maxAttempts: { type: Number, default: 1 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

examSchema.index({ courseId: 1 });
examSchema.index({ moduleId: 1 });

export const Exam = model<IExam>('Exam', examSchema);

// ─── Question Model ─────────────────────────────────────────
export interface IQuestion {
  examId: Types.ObjectId;
  questionText: string;
  questionType: 'mcq' | 'written';
  options?: { text: string; isCorrect: boolean }[];
  correctAnswer?: string;  // for written questions (guide answer)
  marks: number;
  order: number;
  explanation?: string;
  isDeleted: boolean;
}

const questionSchema = new Schema<IQuestion>(
  {
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    questionText: { type: String, required: true },
    questionType: { type: String, enum: ['mcq', 'written'], default: 'mcq' },
    options: [{
      text: { type: String, required: true },
      isCorrect: { type: Boolean, default: false },
    }],
    correctAnswer: { type: String },
    marks: { type: Number, required: true, min: 0 },
    order: { type: Number, default: 0 },
    explanation: { type: String },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

questionSchema.index({ examId: 1, order: 1 });

export const Question = model<IQuestion>('Question', questionSchema);

// ─── ExamSubmission Model ───────────────────────────────────
export interface IExamSubmission {
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  answers: {
    questionId: Types.ObjectId;
    selectedOption?: number;
    writtenAnswer?: string;
    marks: number;
    isCorrect?: boolean;
    feedback?: string;
  }[];
  totalMarks: number;
  obtainedMarks: number;
  percentage: number;
  grade?: string;
  status: 'in_progress' | 'submitted' | 'graded';
  startedAt: Date;
  submittedAt?: Date;
  gradedAt?: Date;
  gradedBy?: Types.ObjectId;
  isDeleted: boolean;
}

const examSubmissionSchema = new Schema<IExamSubmission>(
  {
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    answers: [{
      questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
      selectedOption: { type: Number },
      writtenAnswer: { type: String },
      marks: { type: Number, default: 0 },
      isCorrect: { type: Boolean },
      feedback: { type: String },
    }],
    totalMarks: { type: Number, default: 0 },
    obtainedMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    grade: { type: String },
    status: { type: String, enum: ['in_progress', 'submitted', 'graded'], default: 'in_progress' },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    gradedAt: { type: Date },
    gradedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

examSubmissionSchema.index({ examId: 1, studentId: 1 });
examSubmissionSchema.index({ studentId: 1, status: 1 });

export const ExamSubmission = model<IExamSubmission>('ExamSubmission', examSubmissionSchema);
