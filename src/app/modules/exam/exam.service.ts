import { Exam, Question, ExamSubmission } from './exam.model';

// ─── Helper: Calculate Grade ────────────────────────────────
const calcGrade = (pct: number): string => {
  if (pct >= 80) return 'A+';
  if (pct >= 70) return 'A';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
};

// ═══ EXAM CRUD ══════════════════════════════════════════════

const createExam = async (payload: any) => Exam.create(payload);

const getAllExams = async (query: { courseId?: string; moduleId?: string; isPublished?: string }) => {
  const filter: any = { isDeleted: false };
  if (query.courseId) filter.courseId = query.courseId;
  if (query.moduleId) filter.moduleId = query.moduleId;
  if (query.isPublished === 'true') filter.isPublished = true;
  return Exam.find(filter)
    .populate('courseId', 'title')
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 });
};

const getExam = async (id: string) => Exam.findById(id).populate('courseId', 'title');
const updateExam = async (id: string, payload: any) => Exam.findByIdAndUpdate(id, payload, { new: true });
const deleteExam = async (id: string) => Exam.findByIdAndUpdate(id, { isDeleted: true });

// ═══ QUESTION CRUD ══════════════════════════════════════════

const addQuestion = async (payload: any) => Question.create(payload);

const getQuestions = async (examId: string, includeAnswers = false) => {
  const questions = await Question.find({ examId, isDeleted: false }).sort({ order: 1 });
  if (!includeAnswers) {
    return questions.map(q => {
      const obj = q.toObject();
      if (obj.questionType === 'mcq' && obj.options) {
        obj.options = obj.options.map((o: any) => ({ text: o.text, isCorrect: false }));
      }
      delete obj.correctAnswer;
      delete obj.explanation;
      return obj;
    });
  }
  return questions;
};

const updateQuestion = async (id: string, payload: any) => Question.findByIdAndUpdate(id, payload, { new: true });
const deleteQuestion = async (id: string) => Question.findByIdAndUpdate(id, { isDeleted: true });

const reorderQuestions = async (examId: string, questionIds: string[]) => {
  const ops = questionIds.map((id, i) => ({
    updateOne: { filter: { _id: id, examId } as any, update: { order: i } },
  }));
  return Question.bulkWrite(ops as any);
};

// ═══ EXAM TAKING ════════════════════════════════════════════

const startExam = async (examId: string, studentId: string) => {
  const exam = await Exam.findById(examId);
  if (!exam) throw new Error('Exam not found');
  if (!exam.isPublished) throw new Error('Exam not published');

  // Check attempt limit
  const attempts = await ExamSubmission.countDocuments({ examId, studentId, isDeleted: false });
  if (attempts >= exam.maxAttempts) throw new Error('Maximum attempts reached');

  // Check for in-progress
  const inProgress = await ExamSubmission.findOne({ examId, studentId, status: 'in_progress', isDeleted: false });
  if (inProgress) return inProgress;

  const submission = await ExamSubmission.create({
    examId, studentId,
    totalMarks: exam.totalMarks,
    status: 'in_progress',
    startedAt: new Date(),
  });
  return submission;
};

const submitExam = async (submissionId: string, answers: { questionId: string; selectedOption?: number; writtenAnswer?: string }[]) => {
  const submission = await ExamSubmission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');
  if (submission.status !== 'in_progress') throw new Error('Already submitted');

  const questions = await Question.find({ examId: submission.examId, isDeleted: false });
  let obtained = 0;
  let hasWritten = false;

  const gradedAnswers = answers.map(ans => {
    const question = questions.find(q => q._id.toString() === ans.questionId);
    if (!question) return { ...ans, marks: 0, isCorrect: false };

    if (question.questionType === 'mcq' && question.options) {
      const correct = question.options.findIndex((o: any) => o.isCorrect);
      const isCorrect = correct === ans.selectedOption;
      const marks = isCorrect ? question.marks : 0;
      obtained += marks;
      return { questionId: ans.questionId, selectedOption: ans.selectedOption, marks, isCorrect };
    } else {
      // Written — needs manual grading
      hasWritten = true;
      return { questionId: ans.questionId, writtenAnswer: ans.writtenAnswer, marks: 0, isCorrect: undefined };
    }
  });

  const pct = submission.totalMarks > 0 ? Math.round((obtained / submission.totalMarks) * 100) : 0;

  submission.answers = gradedAnswers as any;
  submission.obtainedMarks = obtained;
  submission.percentage = pct;
  submission.grade = hasWritten ? undefined : calcGrade(pct);
  submission.status = hasWritten ? 'submitted' : 'graded';
  submission.submittedAt = new Date();
  if (!hasWritten) submission.gradedAt = new Date();

  await submission.save();
  return submission;
};

// ═══ GRADING (Mentor) ═══════════════════════════════════════

const getSubmissions = async (examId: string) => {
  return ExamSubmission.find({ examId, isDeleted: false })
    .populate('studentId', 'firstName lastName email')
    .sort({ submittedAt: -1 });
};

const gradeWrittenAnswer = async (submissionId: string, answerId: string, marks: number, feedback: string, gradedBy: string) => {
  const submission = await ExamSubmission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');

  const answer = submission.answers.find((a: any) => a._id?.toString() === answerId || a.questionId?.toString() === answerId);
  if (!answer) throw new Error('Answer not found');

  answer.marks = marks;
  answer.feedback = feedback;

  // Recalculate total
  const total = submission.answers.reduce((sum, a) => sum + (a.marks || 0), 0);
  submission.obtainedMarks = total;
  submission.percentage = submission.totalMarks > 0 ? Math.round((total / submission.totalMarks) * 100) : 0;
  submission.grade = calcGrade(submission.percentage);

  // Check if all answers graded
  const allGraded = submission.answers.every((a: any) => a.marks !== undefined && a.marks !== null);
  if (allGraded) {
    submission.status = 'graded';
    submission.gradedAt = new Date();
    submission.gradedBy = gradedBy as any;
  }

  await submission.save();
  return submission;
};

// ═══ STUDENT RESULTS ════════════════════════════════════════

const getStudentResults = async (studentId: string) => {
  return ExamSubmission.find({ studentId, isDeleted: false, status: { $in: ['submitted', 'graded'] } })
    .populate({ path: 'examId', select: 'title courseId type totalMarks', populate: { path: 'courseId', select: 'title' } })
    .sort({ submittedAt: -1 });
};

const getSubmission = async (id: string) => {
  return ExamSubmission.findById(id)
    .populate('examId')
    .populate('studentId', 'firstName lastName email')
    .populate('gradedBy', 'firstName lastName');
};

// ═══ MARKS SHEET ════════════════════════════════════════════

const getMarksSheet = async (studentId: string, courseId: string) => {
  const exams = await Exam.find({ courseId, isDeleted: false });
  const examIds = exams.map(e => e._id);

  const submissions = await ExamSubmission.find({
    studentId, examId: { $in: examIds }, isDeleted: false, status: 'graded',
  }).populate('examId', 'title type totalMarks moduleId');

  const totalPossible = submissions.reduce((s, sub) => s + sub.totalMarks, 0);
  const totalObtained = submissions.reduce((s, sub) => s + sub.obtainedMarks, 0);
  const avgPct = totalPossible > 0 ? Math.round((totalObtained / totalPossible) * 100) : 0;

  return {
    exams: submissions,
    summary: { totalExams: submissions.length, totalPossible, totalObtained, percentage: avgPct, grade: calcGrade(avgPct) },
  };
};

export const ExamService = {
  createExam, getAllExams, getExam, updateExam, deleteExam,
  addQuestion, getQuestions, updateQuestion, deleteQuestion, reorderQuestions,
  startExam, submitExam,
  getSubmissions, gradeWrittenAnswer, getSubmission,
  getStudentResults, getMarksSheet,
};
