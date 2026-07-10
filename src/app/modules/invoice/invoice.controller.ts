/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Enrollment } from '../enrollment/enrollment.model';
import { Installment } from '../installment/installment.model';
import { InvoiceService } from './invoice.service';

// fee/offerPrice are stored as strings ("৳6,000"); extract the numeric value.
const parsePrice = (v: any): number => {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (!v) return 0;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
};

// ─── Download Invoice / Money-Receipt PDF ────────────────────
const downloadInvoice = async (req: Request, res: Response) => {
  try {
    const { enrollmentId } = req.params;
    const user = (req as any).user;

    const enrollment = await Enrollment.findById(enrollmentId)
      .populate('courseId', 'title type fee offerPrice')
      .populate('studentId', 'firstName lastName email phoneNumber')
      .populate('batchId', 'name');

    if (!enrollment) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    // Security: Only the student or admin can download
    const studentData = enrollment.studentId as any;
    if (user.role !== 'superAdmin' && user.role !== 'admin' && user._id !== String(studentData._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const courseData = enrollment.courseId as any;
    const batchData = enrollment.batchId as any;

    // ── Account statement: agreed total, total paid so far, remaining due ──
    // Agreed total = customFee || offer price || base fee (matches markPaidIfSettled).
    const fee = Number((enrollment as any).customFee)
      || parsePrice(courseData?.offerPrice) || parsePrice(courseData?.fee);
    const admission = enrollment.payment?.amount || 0;
    const installments = await Installment.find({ enrollmentId: enrollment._id, isDeleted: false });
    const paidInst = installments.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount || 0), 0);
    const totalPaid = admission + paidInst;
    const due = fee ? Math.max(0, fee - totalPaid) : 0;
    const fullyPaid = fee > 0 ? due <= 0 : enrollment.payment?.status === 'paid';

    const pdfBuffer = await InvoiceService.generateInvoicePDF({
      invoiceNumber: `INV-${enrollment._id.toString().slice(-8).toUpperCase()}`,
      date: new Date(enrollment.enrolledAt).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
      studentName: `${studentData.firstName || ''} ${studentData.lastName || ''}`.trim(),
      studentEmail: studentData.email,
      studentPhone: studentData.phoneNumber,
      courseName: courseData?.title || 'Course',
      courseType: courseData?.type || 'Online',
      batchName: batchData?.name,
      // Money-receipt statement: line amount = total paid so far, plus fee/due breakdown
      receiptType: fullyPaid ? 'full' : 'admission',
      amount: totalPaid,
      totalFee: fee || undefined,
      dueAmount: fee ? due : undefined,
      paymentMethod: enrollment.payment.method,
      transactionId: enrollment.payment.transactionId,
      paidAt: enrollment.payment.paidAt
        ? new Date(enrollment.payment.paidAt).toLocaleDateString('en-GB')
        : undefined,
      status: fullyPaid ? 'Paid' : (enrollment.payment.status === 'paid' ? 'Paid' : enrollment.payment.status),
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${enrollment._id}.pdf"`);
    res.send(pdfBuffer);
  } catch (error: any) {
    console.error('Invoice generation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate invoice',
    });
  }
};

export const InvoiceController = {
  downloadInvoice,
};
