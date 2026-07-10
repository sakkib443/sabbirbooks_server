/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { InstallmentService } from './installment.service';

// ─── Create Installment Plan ──────────────────────────────
const createPlan = async (req: Request, res: Response) => {
  try {
    const { enrollmentId, studentId, courseId, totalAmount, numberOfInstallments, firstDueDate, intervalDays } = req.body;
    const result = await InstallmentService.createPlan({
      enrollmentId, studentId, courseId,
      totalAmount: Number(totalAmount),
      numberOfInstallments: Number(numberOfInstallments),
      firstDueDate: new Date(firstDueDate),
      intervalDays: intervalDays ? Number(intervalDays) : 30,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Get My Installments (Student) ────────────────────────
const getMyInstallments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const result = await InstallmentService.getStudentInstallments(user._id);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Get Installments by Enrollment ──────────────────────
const getByEnrollment = async (req: Request, res: Response) => {
  try {
    const result = await InstallmentService.getByEnrollment(req.params.enrollmentId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Pay Installment ─────────────────────────────────────
const pay = async (req: Request, res: Response) => {
  try {
    const { transactionId, method } = req.body;
    const result = await InstallmentService.payInstallment(req.params.id, { transactionId, method });
    res.status(200).json({ success: true, message: 'Installment paid!', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Student: Pay toward due ──────────────────────────────
const payDue = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { enrollmentId, amount, transactionId, method, notes } = req.body;
    const result = await InstallmentService.payDue(user._id, {
      enrollmentId, amount, transactionId, method, notes,
    });
    res.status(200).json({ success: true, message: 'Payment recorded!', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Admin Verify ─────────────────────────────────────────
const verify = async (req: Request, res: Response) => {
  try {
    const result = await InstallmentService.adminVerify(req.params.id);
    res.status(200).json({ success: true, message: 'Verified!', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Get All (Admin) ──────────────────────────────────────
const getAll = async (req: Request, res: Response) => {
  try {
    const result = await InstallmentService.getAllInstallments({ status: req.query.status as string });
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Stats (Admin) ────────────────────────────────────────
const getStats = async (req: Request, res: Response) => {
  try {
    const result = await InstallmentService.getStats();
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ─── Mark Overdue (Admin/Cron) ────────────────────────────
const markOverdue = async (req: Request, res: Response) => {
  try {
    const result = await InstallmentService.updateOverdueStatus();
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const InstallmentController = {
  createPlan, getMyInstallments, getByEnrollment,
  pay, payDue, verify, getAll, getStats, markOverdue,
};
