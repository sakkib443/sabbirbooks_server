/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BkashService } from './bkash.service';
import { SslcommerzService } from './sslcommerz.service';
import { EnrollmentService } from '../enrollment/enrollment.service';

// ═══════════════════════════════════════════════════════════════
// bKash Payment
// ═══════════════════════════════════════════════════════════════

// ─── Initiate bKash Payment ─────────────────────────────────
const initiate = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { courseId, amount, totalFee, couponCode, couponDiscount } = req.body;

    if (!courseId || !amount) {
      return res.status(400).json({ success: false, message: 'courseId and amount are required' });
    }

    const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const result = await BkashService.createPayment({
      amount: Number(amount),
      courseId,
      studentId: user._id,
      invoiceNumber,
    });

    // Create pending enrollment
    try {
      await EnrollmentService.createEnrollment({
        studentId: user._id,
        courseId,
        customFee: totalFee ? Number(totalFee) : undefined,
        couponCode: couponCode || undefined,
        couponDiscount: couponDiscount != null ? Number(couponDiscount) : undefined,
        payment: {
          amount: Number(amount),
          method: 'bkash',
          transactionId: result.paymentID,
        },
      });
    } catch (enrollErr: any) {
      if (!enrollErr.message.includes('Already enrolled')) {
        console.error('Enrollment create error:', enrollErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment initiated',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Payment initiation failed',
    });
  }
};

// ─── Execute bKash Payment (callback) ────────────────────────
const execute = async (req: Request, res: Response) => {
  try {
    const { paymentID } = req.body;

    if (!paymentID) {
      return res.status(400).json({ success: false, message: 'paymentID is required' });
    }

    const result = await BkashService.executePayment(paymentID);

    if (result.statusCode === '0000' || result.transactionStatus === 'Completed') {
      const trxId = result.trxID || result.paymentID;
      await EnrollmentService.verifyPayment(paymentID, trxId);

      return res.status(200).json({
        success: true,
        message: 'Payment successful! Course access activated.',
        data: result,
      });
    }

    res.status(400).json({
      success: false,
      message: result.statusMessage || 'Payment execution failed',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Payment execution failed',
    });
  }
};

// ─── Check bKash Payment Status ──────────────────────────────
const status = async (req: Request, res: Response) => {
  try {
    const { paymentID } = req.params;
    const result = await BkashService.queryPayment(paymentID);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Status check failed',
    });
  }
};

// ─── Demo: Simulate successful payment ───────────────────────
const demoComplete = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { paymentID, courseId, amount, totalFee } = req.body;

    const trxId = `DEMO_TRX_${Date.now()}`;

    try {
      await EnrollmentService.verifyPayment(paymentID, trxId);
    } catch {
      await EnrollmentService.createEnrollment({
        studentId: user._id,
        courseId,
        customFee: totalFee ? Number(totalFee) : undefined,
        payment: {
          amount: Number(amount || 0),
          method: 'bkash',
          transactionId: trxId,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Demo payment completed! Course access activated.',
      data: { paymentID, trxID: trxId, transactionStatus: 'Completed' },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Demo payment failed',
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// SSLCommerz Payment
// ═══════════════════════════════════════════════════════════════

// ─── Initiate SSLCommerz Payment ─────────────────────────────
const sslInit = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { courseId, amount, courseName, totalFee, couponCode, couponDiscount } = req.body;

    if (!courseId || !amount) {
      return res.status(400).json({ success: false, message: 'courseId and amount are required' });
    }

    const invoiceNumber = `SSL-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const result = await SslcommerzService.initSession({
      amount: Number(amount),
      courseId,
      courseName: courseName || 'Course',
      studentId: user._id,
      studentName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Student',
      studentEmail: user.email,
      studentPhone: user.phoneNumber,
      invoiceNumber,
    });

    // Create pending enrollment
    try {
      await EnrollmentService.createEnrollment({
        studentId: user._id,
        courseId,
        customFee: totalFee ? Number(totalFee) : undefined,
        couponCode: couponCode || undefined,
        couponDiscount: couponDiscount != null ? Number(couponDiscount) : undefined,
        payment: {
          amount: Number(amount),
          method: 'sslcommerz',
          transactionId: result.tran_id || invoiceNumber,
        },
      });
    } catch (enrollErr: any) {
      if (!enrollErr.message.includes('Already enrolled')) {
        console.error('SSL enrollment error:', enrollErr.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'SSLCommerz session initiated',
      data: result,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'SSLCommerz initiation failed',
    });
  }
};

// ─── SSLCommerz IPN (Instant Payment Notification) ───────────
const sslIPN = async (req: Request, res: Response) => {
  try {
    const { tran_id, val_id, status: payStatus } = req.body;

    if (payStatus === 'VALID' && val_id) {
      const validation = await SslcommerzService.validateTransaction(val_id);
      if (validation.status === 'VALID') {
        await EnrollmentService.verifyPayment(tran_id, val_id);
      }
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('SSL IPN error:', error);
    res.status(200).json({ success: true }); // Always return 200 for IPN
  }
};

// ─── SSLCommerz Success Callback ─────────────────────────────
const sslSuccess = async (req: Request, res: Response) => {
  try {
    const { tran_id, val_id } = req.body;

    if (val_id) {
      const validation = await SslcommerzService.validateTransaction(val_id);
      if (validation.status === 'VALID') {
        await EnrollmentService.verifyPayment(tran_id, val_id);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Payment successful!',
      data: { tran_id, val_id },
    });
  } catch (error: any) {
    res.status(200).json({
      success: false,
      message: error.message || 'Payment processing issue',
      data: req.body,
    });
  }
};

// ─── SSLCommerz Demo Complete ────────────────────────────────
const sslDemoComplete = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { tran_id, courseId, amount, totalFee } = req.body;

    const valId = `DEMO_VAL_${Date.now()}`;

    try {
      await EnrollmentService.verifyPayment(tran_id, valId);
    } catch {
      await EnrollmentService.createEnrollment({
        studentId: user._id,
        courseId,
        customFee: totalFee ? Number(totalFee) : undefined,
        payment: {
          amount: Number(amount || 0),
          method: 'sslcommerz',
          transactionId: valId,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Demo SSL payment completed!',
      data: { tran_id, val_id: valId, status: 'VALID' },
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Demo SSL payment failed',
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// Manual Payment (Bank Transfer)
// ═══════════════════════════════════════════════════════════════

// ─── Submit Manual Payment ───────────────────────────────────
const submitManualPayment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    // `paymentType` is the wallet channel (bkash/rocket/nagad); older callers sent
    // it as `bankName`, so accept either. `sentAt` = when the buyer sent the money.
    const {
      courseId, amount, totalFee, transactionId, senderNumber, notes, sentAt,
      couponCode, couponDiscount,
    } = req.body;
    const paymentType = req.body.paymentType || req.body.bankName;

    if (!courseId || !amount || !transactionId) {
      return res.status(400).json({
        success: false,
        message: 'courseId, amount, and transactionId are required',
      });
    }

    const enrollment = await EnrollmentService.createEnrollment({
      studentId: user._id,
      courseId,
      // partial checkout: student এখন `amount` দিচ্ছে, চূড়ান্ত মোট ফি = totalFee
      customFee: totalFee ? Number(totalFee) : undefined,
      couponCode: couponCode || undefined,
      couponDiscount: couponDiscount != null ? Number(couponDiscount) : undefined,
      payment: {
        amount: Number(amount),
        method: 'manual',
        transactionId: transactionId,
      },
    });

    // Store extra info in gatewayData
    if (enrollment) {
      const { Enrollment } = await import('../enrollment/enrollment.model');
      await Enrollment.findByIdAndUpdate(enrollment._id, {
        'payment.gatewayData': {
          paymentType,
          senderNumber,
          notes,
          sentAt: sentAt ? new Date(sentAt) : undefined,
          submittedAt: new Date(),
        },
      });
    }

    res.status(200).json({
      success: true,
      message: 'Manual payment submitted. Awaiting admin verification.',
      data: enrollment,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Manual payment submission failed',
    });
  }
};

// ─── Free Course Enrollment ──────────────────────────────────
const enrollFree = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ success: false, message: 'courseId is required' });
    }

    const enrollment = await EnrollmentService.createEnrollment({
      studentId: user._id,
      courseId,
      payment: {
        amount: 0,
        method: 'free',
      },
    });

    res.status(200).json({
      success: true,
      message: 'Successfully enrolled in free course!',
      data: enrollment,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Free enrollment failed',
    });
  }
};

export const PaymentController = {
  // bKash
  initiate,
  execute,
  status,
  demoComplete,
  // SSLCommerz
  sslInit,
  sslIPN,
  sslSuccess,
  sslDemoComplete,
  // Manual
  submitManualPayment,
  // Free
  enrollFree,
};
