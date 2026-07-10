import { Attendance } from './attendance.model';

// ─── Take/Update Attendance ────────────────────────────────
const takeAttendance = async (payload: {
  batchId: string;
  mentorId: string;
  date: string;
  classTitle?: string;
  records: { studentId: string; status: string; note?: string }[];
}) => {
  const dateObj = new Date(payload.date);
  dateObj.setHours(0, 0, 0, 0);

  // Upsert: if attendance for this batch+date exists, update it
  const existing = await Attendance.findOne({
    batchId: payload.batchId,
    date: dateObj,
    isDeleted: false,
  });

  if (existing) {
    existing.records = payload.records as any;
    existing.classTitle = payload.classTitle;
    existing.mentorId = payload.mentorId as any;
    await existing.save();
    return existing;
  }

  return Attendance.create({
    batchId: payload.batchId,
    mentorId: payload.mentorId,
    date: dateObj,
    classTitle: payload.classTitle,
    records: payload.records,
  });
};

// ─── Get Attendance for a batch on a date ──────────────────
const getAttendanceByDate = async (batchId: string, date: string) => {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  return Attendance.findOne({
    batchId,
    date: dateObj,
    isDeleted: false,
  }).populate('records.studentId', 'firstName lastName name email phoneNumber');
};

// ─── Get all attendance records for a batch ────────────────
const getBatchAttendanceHistory = async (batchId: string) => {
  return Attendance.find({ batchId, isDeleted: false })
    .populate('records.studentId', 'firstName lastName name email')
    .sort({ date: -1 });
};

// ─── Get attendance stats for a batch ──────────────────────
const getBatchAttendanceStats = async (batchId: string) => {
  const records = await Attendance.find({ batchId, isDeleted: false }).lean();
  const totalClasses = records.length;

  // Student-wise stats
  const studentStats: Record<string, { present: number; absent: number; late: number; excused: number; total: number }> = {};

  records.forEach(r => {
    r.records.forEach(rec => {
      const sid = rec.studentId.toString();
      if (!studentStats[sid]) {
        studentStats[sid] = { present: 0, absent: 0, late: 0, excused: 0, total: 0 };
      }
      studentStats[sid][rec.status]++;
      studentStats[sid].total++;
    });
  });

  return { totalClasses, studentStats };
};

// ─── Delete attendance ─────────────────────────────────────
const deleteAttendance = async (attendanceId: string) => {
  return Attendance.findByIdAndUpdate(attendanceId, { isDeleted: true });
};

// ─── Student: MY attendance (self-scoped) ──────────────────
// Attendance is stored per batch+date with a records[] array. For a student we
// flatten to one row per session where THEY have a record. Same "present+late =
// attended" convention as the admin/certificate views.
const buildMyAttendance = (docs: any[], studentId: string) => {
  const records: any[] = [];
  let present = 0, late = 0, absent = 0, excused = 0;
  for (const doc of docs) {
    const rec = (doc.records || []).find((r: any) => String(r.studentId) === String(studentId));
    if (!rec) continue;
    records.push({
      _id: doc._id,
      status: rec.status,
      note: rec.note || '',
      // Shape the student attendance page expects (classId.{title,topic,date,startTime})
      classId: { title: doc.classTitle || 'Class', topic: '', date: doc.date, startTime: '' },
    });
    if (rec.status === 'present') present++;
    else if (rec.status === 'late') late++;
    else if (rec.status === 'excused') excused++;
    else absent++;
  }
  const total = records.length;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return { records, summary: { rate, total, present, late, absent, excused } };
};

const getMyAttendance = async (studentId: string) => {
  const docs = await Attendance.find({ 'records.studentId': studentId, isDeleted: false })
    .sort({ date: -1 }).lean();
  return buildMyAttendance(docs, studentId);
};

const getMyBatchAttendance = async (studentId: string, batchId: string) => {
  const docs = await Attendance.find({ batchId, 'records.studentId': studentId, isDeleted: false })
    .sort({ date: -1 }).lean();
  return buildMyAttendance(docs, studentId);
};

export const AttendanceService = {
  takeAttendance,
  getAttendanceByDate,
  getBatchAttendanceHistory,
  getBatchAttendanceStats,
  deleteAttendance,
  getMyAttendance,
  getMyBatchAttendance,
};
