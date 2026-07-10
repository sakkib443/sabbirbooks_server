import { Assignment, AssignmentSubmission } from './assignment.model';

// ═══ ASSIGNMENT CRUD ════════════════════════════════════════

const create = async (payload: any) => Assignment.create(payload);

const getAll = async (query: { courseId?: string; moduleId?: string; batchId?: string }) => {
  const filter: any = { isDeleted: false };
  if (query.courseId) filter.courseId = query.courseId;
  if (query.moduleId) filter.moduleId = query.moduleId;
  if (query.batchId) filter.batchId = query.batchId;
  return Assignment.find(filter)
    .populate('courseId', 'title')
    .populate('createdBy', 'firstName lastName')
    .sort({ createdAt: -1 });
};

const getOne = async (id: string) => Assignment.findById(id).populate('courseId', 'title');
const update = async (id: string, payload: any) => Assignment.findByIdAndUpdate(id, payload, { new: true });
const remove = async (id: string) => Assignment.findByIdAndUpdate(id, { isDeleted: true });

// ═══ SUBMISSION ═════════════════════════════════════════════

const submit = async (payload: { assignmentId: string; studentId: string; text?: string; fileUrl?: string; fileName?: string }) => {
  // Check deadline
  const assignment = await Assignment.findById(payload.assignmentId);
  if (!assignment) throw new Error('Assignment not found');
  if (assignment.deadline && new Date() > new Date(assignment.deadline)) throw new Error('Deadline passed');

  // Check existing
  const existing = await AssignmentSubmission.findOne({
    assignmentId: payload.assignmentId, studentId: payload.studentId, isDeleted: false,
  });
  if (existing) {
    existing.text = payload.text;
    existing.fileUrl = payload.fileUrl;
    existing.fileName = payload.fileName;
    existing.submittedAt = new Date();
    existing.status = 'submitted';
    return existing.save();
  }

  return AssignmentSubmission.create({ ...payload, submittedAt: new Date() });
};

// ═══ GET SUBMISSIONS ════════════════════════════════════════

const getSubmissions = async (assignmentId: string) => {
  return AssignmentSubmission.find({ assignmentId, isDeleted: false })
    .populate('studentId', 'firstName lastName email phoneNumber')
    .sort({ submittedAt: -1 });
};

const getStudentSubmissions = async (studentId: string) => {
  return AssignmentSubmission.find({ studentId, isDeleted: false })
    .populate({ path: 'assignmentId', select: 'title courseId deadline totalMarks', populate: { path: 'courseId', select: 'title' } })
    .sort({ submittedAt: -1 });
};

// ═══ GRADING ════════════════════════════════════════════════

const grade = async (submissionId: string, marks: number, feedback: string, gradedBy: string) => {
  const submission = await AssignmentSubmission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');

  submission.marks = marks;
  submission.feedback = feedback;
  submission.status = 'graded';
  submission.gradedAt = new Date();
  submission.gradedBy = gradedBy as any;
  return submission.save();
};

// ═══ STUDENT ASSIGNMENTS (with status) ══════════════════════

const getStudentAssignments = async (studentId: string, courseId: string) => {
  const assignments = await Assignment.find({ courseId, isDeleted: false, isPublished: true }).sort({ createdAt: -1 });

  const result = await Promise.all(assignments.map(async (a) => {
    const submission = await AssignmentSubmission.findOne({ assignmentId: a._id, studentId, isDeleted: false });
    return {
      ...a.toObject(),
      submission: submission ? submission.toObject() : null,
      isOverdue: !!a.deadline && new Date() > new Date(a.deadline) && !submission,
    };
  }));

  return result;
};

// ═══ BULK MARKS ENTRY (mentor's offline gradebook) ══════════
// Upsert a graded submission per student — no online submission required.
const setMarks = async (
  assignmentId: string,
  marks: Array<{ studentId: string; marks?: number | string | null; feedback?: string }>,
  gradedBy: string,
) => {
  await Promise.all((marks || []).map((m) => {
    if (!m.studentId) return Promise.resolve();
    const hasMark = m.marks !== undefined && m.marks !== null && String(m.marks).trim() !== '';
    return AssignmentSubmission.findOneAndUpdate(
      { assignmentId, studentId: m.studentId, isDeleted: false },
      {
        assignmentId,
        studentId: m.studentId,
        marks: hasMark ? Number(m.marks) : undefined,
        feedback: m.feedback || '',
        status: hasMark ? 'graded' : 'submitted',
        gradedAt: hasMark ? new Date() : undefined,
        gradedBy,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }));
  return getSubmissions(assignmentId);
};

// ═══ BATCH PROGRESS (assignment marks matrix + overall) ═════
// Per student: their mark for each of the batch's assignments + an overall %.
// Used by the mentor + admin student-progress views.
const getBatchProgress = async (batchId: string) => {
  const assignments = await Assignment.find({ batchId, isDeleted: false }).sort({ createdAt: 1 }).lean();
  const aIds = assignments.map((a) => a._id);

  const { Enrollment } = await import('../enrollment/enrollment.model');
  const enrollments = await Enrollment.find({ batchId, isDeleted: false, status: { $ne: 'deleted' } })
    .populate('studentId', 'firstName lastName name email phoneNumber')
    .lean();

  const subs = aIds.length
    ? await AssignmentSubmission.find({ assignmentId: { $in: aIds }, isDeleted: false }).lean()
    : [];

  const nm = (st: any) => st?.name || [st?.firstName, st?.lastName].filter(Boolean).join(' ').trim() || st?.email || 'Student';
  const byStudent: Record<string, any> = {};
  enrollments.forEach((e: any) => {
    const st = e.studentId;
    const sid = String(st?._id || e.studentId);
    if (!byStudent[sid]) byStudent[sid] = { studentId: sid, name: nm(st), email: st?.email || '', phone: st?.phoneNumber || '', studentStatus: e.studentStatus || 'active', marks: {} as Record<string, number> };
  });
  subs.forEach((s: any) => {
    const sid = String(s.studentId);
    if (byStudent[sid] && s.marks !== undefined && s.marks !== null) {
      byStudent[sid].marks[String(s.assignmentId)] = s.marks;
    }
  });

  const students = Object.values(byStudent).map((st: any) => {
    let obtained = 0, max = 0, graded = 0;
    assignments.forEach((a: any) => {
      const m = st.marks[String(a._id)];
      if (m !== undefined) { obtained += m; max += a.totalMarks; graded++; }
    });
    return { ...st, totalObtained: obtained, totalMax: max, overallPct: max ? Math.round((obtained / max) * 100) : 0, gradedCount: graded };
  });

  return {
    assignments: assignments.map((a: any) => ({ _id: a._id, title: a.title, totalMarks: a.totalMarks })),
    students,
  };
};

export const AssignmentService = {
  create, getAll, getOne, update, remove,
  submit, getSubmissions, getStudentSubmissions,
  grade, getStudentAssignments, setMarks, getBatchProgress,
};
