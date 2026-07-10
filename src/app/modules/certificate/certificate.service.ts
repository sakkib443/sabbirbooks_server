import { Certificate } from './certificate.model';
import { ICertificate } from './certificate.interface';
import { Batch } from '../batch/batch.model';
import { Enrollment } from '../enrollment/enrollment.model';
import { User } from '../user/user.model';
// PORT NOTE: notification module DROPPED — import commented out.
// import { NotificationService } from '../notification/notification.service';
// PORT NOTE: attendance module NOT ported yet — import commented out.
// import { Attendance } from '../attendance/attendance.model';
// PORT NOTE: exam module NOT ported yet — import commented out.
// import { Exam, ExamSubmission } from '../exam/exam.model';
import { Installment } from '../installment/installment.model';

/** Generate unique certificate ID: BAC-CERT-XXXX */
async function generateCertificateId(): Promise<string> {
    const prefix = 'BAC-CERT-';
    const lastCert = await Certificate.findOne({ id: { $regex: /^BAC-CERT-\d+$/ } }).sort({ id: -1 }).lean();
    let nextNum = 1;
    if (lastCert?.id) {
        const match = lastCert.id.match(/BAC-CERT-(\d+)/);
        if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    const totalCount = await Certificate.countDocuments({});
    if (totalCount >= nextNum) nextNum = totalCount + 1;
    return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

/** Generate QR code data (verification URL) */
function generateQRData(certId: string): { qrCode: string; verificationUrl: string } {
    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const verificationUrl = `${base}/verify-certificate?id=${certId}`;
    return { qrCode: verificationUrl, verificationUrl };
}

// ─── Create Certificate (manual or auto) ────────────────────
const createCertificate = async (payload: Partial<ICertificate>): Promise<ICertificate> => {
    const id = await generateCertificateId();
    const qr = generateQRData(id);
    const certificateData = {
        ...payload,
        id,
        issueDate: new Date(),
        status: 'pending' as const,
        qrCode: qr.qrCode,
        verificationUrl: qr.verificationUrl,
        isDeleted: false,
    };
    return Certificate.create(certificateData);
};

// ─── Auto-Generate (when course progress = 100%) ────────────
const autoGenerate = async (studentId: string, studentName: string, courseName: string, batchId: string, batchNumber: string, startDate: Date, endDate: Date) => {
    // Check if already exists
    const existing = await Certificate.findOne({ studentId, courseName, isDeleted: false });
    if (existing) return existing;

    return createCertificate({ studentId, studentName, courseName, batchId, batchNumber, startDate, endDate });
};

// ─── Get All (Admin) ────────────────────────────────────────
const getAllCertificates = async (statusFilter?: string) => {
    const filter: any = { isDeleted: false };
    if (statusFilter && statusFilter !== 'all') filter.status = statusFilter;
    return Certificate.find(filter).sort({ createdAt: -1 });
};

// ─── Get Pending (Admin workflow) ───────────────────────────
const getPending = async () => {
    return Certificate.find({ status: 'pending', isDeleted: false }).sort({ createdAt: -1 });
};

// ─── Activate Certificate (Admin) ───────────────────────────
const activate = async (certId: string, adminId: string) => {
    return Certificate.findOneAndUpdate(
        { id: certId, isDeleted: false },
        { status: 'active', activatedBy: adminId, activatedAt: new Date() },
        { new: true }
    );
};

// ─── Revoke Certificate ─────────────────────────────────────
const revoke = async (certId: string) => {
    return Certificate.findOneAndUpdate(
        { id: certId, isDeleted: false },
        { status: 'revoked' },
        { new: true }
    );
};

// ─── Search ─────────────────────────────────────────────────
const searchCertificates = async (query: { studentId?: string; studentName?: string; courseName?: string }) => {
    const conditions: any[] = [];
    if (query.studentId) conditions.push({ studentId: { $regex: query.studentId, $options: 'i' } });
    if (query.studentName) conditions.push({ studentName: { $regex: query.studentName, $options: 'i' } });
    if (query.courseName) conditions.push({ courseName: { $regex: query.courseName, $options: 'i' } });
    if (conditions.length === 0) return [];
    return Certificate.find({ $or: conditions, isDeleted: false, status: 'active' });
};

// ─── Get by ID (public verify) ──────────────────────────────
const getCertificateById = async (id: string) => {
    return Certificate.findOne({ id, isDeleted: false });
};

// ─── Verify (public) ────────────────────────────────────────
const verify = async (certId: string) => {
    const cert = await Certificate.findOne({ id: certId, isDeleted: false });
    if (!cert) return { valid: false, message: 'Certificate not found' };
    if (cert.status === 'revoked') return { valid: false, message: 'Certificate has been revoked', certificate: cert };
    if (cert.status === 'pending') return { valid: false, message: 'Certificate is pending activation', certificate: cert };
    return { valid: true, message: 'Certificate is valid', certificate: cert };
};

// ─── Student's Certificates ─────────────────────────────────
const getStudentCertificates = async (studentId: string) => {
    return Certificate.find({ studentId, isDeleted: false }).sort({ createdAt: -1 });
};

// ─── Stats ──────────────────────────────────────────────────
const getStats = async () => {
    const [total, pending, active, revoked] = await Promise.all([
        Certificate.countDocuments({ isDeleted: false }),
        Certificate.countDocuments({ status: 'pending', isDeleted: false }),
        Certificate.countDocuments({ status: 'active', isDeleted: false }),
        Certificate.countDocuments({ status: 'revoked', isDeleted: false }),
    ]);
    return { total, pending, active, revoked };
};

// ─── Delete / Update ────────────────────────────────────────
const deleteCertificate = async (id: string) => Certificate.findOneAndUpdate({ id, isDeleted: false }, { isDeleted: true }, { new: true });
const updateCertificate = async (id: string, payload: Partial<ICertificate>) => Certificate.findOneAndUpdate({ id, isDeleted: false }, payload, { new: true });

// ═══════════════════════════════════════════════════════════════
// ─── BATCH-BASED CERTIFICATION MANAGEMENT ───────────────────
// ═══════════════════════════════════════════════════════════════

/** Get all batches grouped by running (active) and old (completed) with student/cert counts */
const getBatchesForCertification = async () => {
    // Get all non-deleted batches
    const allBatches = await Batch.find({ isDeleted: false })
        .populate('courseId', 'title image type')
        .populate('mentorId', 'name image designation')
        .sort({ startDate: -1 })
        .lean();

    // Auto-detect status based on dates
    const now = new Date();
    const enrichedBatches = await Promise.all(
        allBatches.map(async (batch: any) => {
            const startDate = new Date(batch.startDate);
            const endDate = new Date(batch.endDate);
            let computedStatus = batch.status;
            if (now < startDate) computedStatus = 'upcoming';
            else if (now >= startDate && now <= endDate) computedStatus = 'active';
            else if (now > endDate) computedStatus = 'completed';

            // Count students enrolled in this batch
            const studentCount = await Enrollment.countDocuments({
                batchId: batch._id,
                status: { $in: ['active', 'completed'] },
                isDeleted: false,
            });

            // Count certificates for this batch
            const certCount = await Certificate.countDocuments({
                batchId: batch.id || batch._id.toString(),
                status: 'active',
                isDeleted: false,
            });

            return {
                ...batch,
                computedStatus,
                studentCount,
                certifiedCount: certCount,
            };
        })
    );

    const running = enrichedBatches.filter(b => b.computedStatus === 'active' || b.computedStatus === 'upcoming');
    const old = enrichedBatches.filter(b => b.computedStatus === 'completed');

    return { running, old };
};

/** Get all students in a batch with their certificate eligibility/status + payment, exam, attendance */
const getStudentsInBatch = async (batchId: string) => {
    // First find the batch (by custom id or _id)
    let batch: any = await Batch.findOne({ id: batchId, isDeleted: false })
        .populate('courseId', 'title image type')
        .populate('mentorId', 'name image designation')
        .lean();
    if (!batch) {
        batch = await Batch.findById(batchId)
            .populate('courseId', 'title image type')
            .populate('mentorId', 'name image designation')
            .lean();
    }
    if (!batch) throw new Error('Batch not found');

    const batchObjectId = batch._id;
    const courseObjectId = batch.courseId?._id || batch.courseId;

    // Get all active enrollments in this batch
    const enrollments = await Enrollment.find({
        batchId: batchObjectId,
        status: { $in: ['active', 'completed'] },
        isDeleted: false,
    })
        .populate('studentId', 'firstName lastName name email phoneNumber avatar')
        .populate('courseId', 'title image')
        .lean();

    // Pre-fetch batch-level data for efficiency
    // 1. All attendance records for this batch
    // PORT NOTE: attendance module NOT ported yet — call-site stubbed to []. Original:
    // const allAttendance = await Attendance.find({ batchId: batchObjectId, isDeleted: false }).lean();
    const allAttendance: any[] = [];
    const totalAttendanceSessions = allAttendance.length;

    // 2. All exams for this course
    // PORT NOTE: exam module NOT ported yet — call-site stubbed to []. Original:
    // const courseExams = await Exam.find({ courseId: courseObjectId, isDeleted: false }).lean();
    const courseExams: any[] = [];
    const examIds = courseExams.map((e: any) => e._id);

    // 3. All exam submissions for students in this batch
    const studentIds = enrollments.map((e: any) => e.studentId?._id).filter(Boolean);
    // PORT NOTE: exam module NOT ported yet — ExamSubmission call-site stubbed to []. Original:
    // const allSubmissions = examIds.length > 0
    //     ? await ExamSubmission.find({ examId: { $in: examIds }, studentId: { $in: studentIds }, isDeleted: false }).lean()
    //     : [];
    const allSubmissions: any[] = [];

    // 4. All installments for students in this course
    const enrollmentIds = enrollments.map((e: any) => e._id);
    const allInstallments = enrollmentIds.length > 0
        ? await Installment.find({ enrollmentId: { $in: enrollmentIds }, isDeleted: false }).lean()
        : [];

    // For each student, aggregate all data
    const students = await Promise.all(
        enrollments.map(async (enrollment: any) => {
            const student = enrollment.studentId;
            if (!student) return null;

            const studentIdStr = student._id.toString();

            // Certificate
            const certificate = await Certificate.findOne({
                studentId: studentIdStr,
                batchId: batch.id || batch._id.toString(),
                isDeleted: false,
            }).lean();

            // Attendance for this student
            let presentCount = 0, absentCount = 0, lateCount = 0;
            allAttendance.forEach((att: any) => {
                const rec = att.records?.find((r: any) => r.studentId?.toString() === studentIdStr);
                if (rec) {
                    if (rec.status === 'present') presentCount++;
                    else if (rec.status === 'absent') absentCount++;
                    else if (rec.status === 'late') lateCount++;
                }
            });
            const attendancePct = totalAttendanceSessions > 0
                ? Math.round(((presentCount + lateCount) / totalAttendanceSessions) * 100)
                : 0;

            // Exam submissions for this student
            const studentSubmissions = allSubmissions.filter(
                (s: any) => s.studentId?.toString() === studentIdStr
            );
            const totalExamMarks = studentSubmissions.reduce((sum: number, s: any) => sum + (s.totalMarks || 0), 0);
            const obtainedExamMarks = studentSubmissions.reduce((sum: number, s: any) => sum + (s.obtainedMarks || 0), 0);
            const examAvgPct = totalExamMarks > 0 ? Math.round((obtainedExamMarks / totalExamMarks) * 100) : 0;

            // Payment info from enrollment
            const payment = enrollment.payment || {};
            const paymentStatus = payment.status || 'pending';
            const paymentAmount = payment.amount || 0;
            const paymentMethod = payment.method || '—';

            // Installments for this enrollment
            const studentInstallments = allInstallments.filter(
                (inst: any) => inst.enrollmentId?.toString() === enrollment._id.toString()
            );
            const paidInstallments = studentInstallments.filter((i: any) => i.status === 'paid').length;
            const dueInstallments = studentInstallments.filter((i: any) => i.status === 'due' || i.status === 'overdue').length;
            const totalInstallments = studentInstallments.length;

            return {
                _id: enrollment._id,
                studentId: studentIdStr,
                studentName: `${student.firstName || student.name || ''} ${student.lastName || ''}`.trim(),
                email: student.email,
                phone: student.phoneNumber || '—',
                avatar: student.avatar,
                enrollmentStatus: enrollment.status,
                studentStatus: enrollment.studentStatus || 'active',
                completionPercent: enrollment.completionPercent || 0,
                // Certificate
                hasCertificate: !!certificate,
                certificateStatus: certificate?.status || null,
                certificateId: certificate?.id || null,
                // Attendance
                attendance: {
                    present: presentCount,
                    absent: absentCount,
                    late: lateCount,
                    totalSessions: totalAttendanceSessions,
                    percentage: attendancePct,
                },
                // Exam
                exam: {
                    totalExams: courseExams.length,
                    submitted: studentSubmissions.length,
                    totalMarks: totalExamMarks,
                    obtainedMarks: obtainedExamMarks,
                    averagePct: examAvgPct,
                    submissions: studentSubmissions.map((s: any) => ({
                        examId: s.examId,
                        obtainedMarks: s.obtainedMarks,
                        totalMarks: s.totalMarks,
                        percentage: s.percentage,
                        grade: s.grade,
                        status: s.status,
                    })),
                },
                // Payment
                payment: {
                    status: paymentStatus,
                    amount: paymentAmount,
                    method: paymentMethod,
                    installments: {
                        total: totalInstallments,
                        paid: paidInstallments,
                        due: dueInstallments,
                    },
                },
            };
        })
    );

    return {
        batch: {
            ...batch,
            batchId: batch.id,
        },
        students: students.filter(Boolean),
    };
};

/** Toggle certificate eligibility — create+activate or revoke */
const toggleCertificateEligibility = async (
    studentId: string,
    batchId: string,
    eligible: boolean,
    adminId: string
) => {
    // Find batch
    let batch: any = await Batch.findOne({ id: batchId, isDeleted: false }).lean();
    if (!batch) batch = await Batch.findById(batchId).lean();
    if (!batch) throw new Error('Batch not found');

    // Find student
    const student = await User.findById(studentId).select('firstName lastName name email').lean();
    if (!student) throw new Error('Student not found');

    const studentName = `${(student as any).firstName || (student as any).name || ''} ${(student as any).lastName || ''}`.trim();
    const courseName = batch.courseName || 'Unknown Course';
    const batchIdStr = batch.id || batch._id.toString();

    if (eligible) {
        // Check if certificate already exists
        const existing = await Certificate.findOne({
            studentId,
            batchId: batchIdStr,
            isDeleted: false,
        });

        if (existing) {
            // If it was revoked, reactivate it
            if (existing.status === 'revoked' || existing.status === 'pending') {
                existing.status = 'active';
                existing.activatedBy = adminId;
                existing.activatedAt = new Date();
                await existing.save();

                // Send notification
                // PORT NOTE: notification module DROPPED — notification call commented out.
                // try {
                //     await NotificationService.triggerCertificateReady(studentId, courseName);
                // } catch (e) {
                //     console.error('Certificate notification failed:', e);
                // }
                return existing;
            }
            return existing; // Already active
        }

        // Create new certificate and auto-activate
        const certId = await generateCertificateId();
        const qr = generateQRData(certId);
        const cert = await Certificate.create({
            id: certId,
            studentId,
            studentName,
            batchId: batchIdStr,
            courseName,
            batchNumber: batch.id || '',
            startDate: batch.startDate,
            endDate: batch.endDate,
            issueDate: new Date(),
            status: 'active',
            qrCode: qr.qrCode,
            verificationUrl: qr.verificationUrl,
            activatedBy: adminId,
            activatedAt: new Date(),
            isDeleted: false,
        });

        // Send notification to student
        // PORT NOTE: notification module DROPPED — notification call commented out.
        // try {
        //     await NotificationService.triggerCertificateReady(studentId, courseName);
        // } catch (e) {
        //     console.error('Certificate notification failed:', e);
        // }

        return cert;
    } else {
        // Revoke certificate
        const cert = await Certificate.findOneAndUpdate(
            { studentId, batchId: batchIdStr, isDeleted: false },
            { status: 'revoked' },
            { new: true }
        );
        return cert;
    }
};

/** Bulk grant certificates to multiple students */
const bulkGrantCertificates = async (studentIds: string[], batchId: string, adminId: string) => {
    const results = [];
    for (const sid of studentIds) {
        try {
            const cert = await toggleCertificateEligibility(sid, batchId, true, adminId);
            results.push({ studentId: sid, success: true, certificate: cert });
        } catch (e: any) {
            results.push({ studentId: sid, success: false, error: e.message });
        }
    }
    return results;
};

export const CertificateService = {
    createCertificate, autoGenerate,
    getAllCertificates, getPending,
    activate, revoke,
    searchCertificates, getCertificateById, verify,
    getStudentCertificates, getStats,
    deleteCertificate, updateCertificate,
    // Batch-based certification
    getBatchesForCertification,
    getStudentsInBatch,
    toggleCertificateEligibility,
    bulkGrantCertificates,
};
