/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { BkashService } from './bkash.service';
import { SslcommerzService } from './sslcommerz.service';
import { EnrollmentService } from '../enrollment/enrollment.service';
import { publicGatewayStatus, returnUrl } from './gateway.config';
import { mongoSettlementDeps } from './orderSettlement.deps';
import { settleGatewayPayment, type SettlementInput, type SettlementResult } from './orderSettlement';

// ═══════════════════════════════════════════════════════════════
// Shared: settle a BOOK order, or say it isn't one
// ═══════════════════════════════════════════════════════════════
//
// These endpoints are shared by two products. Course enrollments got here first
// and every path below still falls through to EnrollmentService untouched when
// the reference is not a book order — a gateway callback must never start
// failing enrollments because book orders learned to use the same door.
const trySettleOrder = async (input: SettlementInput): Promise<SettlementResult> => {
  try {
    return await settleGatewayPayment(mongoSettlementDeps, input);
  } catch (err: any) {
    console.error('[payment] order settlement error:', err?.message || err);
    return { outcome: 'rejected', reason: err?.message || 'settlement error' };
  }
};

// ═══════════════════════════════════════════════════════════════
// Gateway availability (public)
// ═══════════════════════════════════════════════════════════════
//
// The checkout UI asks this before it offers a "pay now with bKash" button. With
// no credentials in the environment every gateway reports `configured: false`,
// the button never renders, and the buyer sees exactly the manual Send-Money and
// cash-on-delivery choices they see today.
const gateways = async (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: publicGatewayStatus() });
};

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

      // Book order first; enrollments keep the old path when it isn't one.
      const settled = await trySettleOrder({
        gateway: 'bkash',
        reference: paymentID,
        transactionId: trxId,
        paidAmount: result.amount,
        succeeded: true,
      });

      if (settled.outcome === 'settled' || settled.outcome === 'already-paid') {
        return res.status(200).json({
          success: true,
          message: 'Payment successful!',
          data: { ...result, orderNumber: settled.orderNumber, replay: settled.outcome === 'already-paid' },
        });
      }
      if (settled.outcome === 'rejected') {
        return res.status(400).json({ success: false, message: settled.reason, data: result });
      }

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

// ─── bKash Callback (browser returns here from bKash) ────────
//
// bKash sends the buyer back with the payment only AUTHORIZED. The money is not
// ours until /execute is called, so that call happens here, server-side, before
// the browser is sent anywhere — if it lived in page JavaScript, a buyer who
// closed the tab on the redirect would have a hold on their balance and we would
// have no paid order.
//
// Unauthenticated by necessity: bKash does the redirect, not our app, so there is
// no Bearer token on it. The paymentID is the capability, and nothing is trusted
// from the query string beyond it — the amount and status that decide the outcome
// come from bKash's own execute response, not from the URL the buyer arrived on.
const bkashCallback = async (req: Request, res: Response) => {
  const paymentID = String(req.query.paymentID || req.body?.paymentID || '');
  const status = String(req.query.status || '').toLowerCase();

  try {
    if (!paymentID) {
      return res.redirect(returnUrl('failed', { reason: 'missing-payment-id' }));
    }

    // bKash reports the buyer's own choice in the query string.
    if (status === 'cancel' || status === 'cancelled') {
      const r = await trySettleOrder({
        gateway: 'bkash', reference: paymentID, succeeded: false, cancelled: true,
      });
      return res.redirect(returnUrl('cancelled', { ref: r.outcome !== 'not-an-order' ? (r as any).orderNumber : undefined }));
    }
    if (status === 'failure' || status === 'failed') {
      const r = await trySettleOrder({
        gateway: 'bkash', reference: paymentID, succeeded: false, reason: 'declined at bKash',
      });
      return res.redirect(returnUrl('failed', { ref: r.outcome !== 'not-an-order' ? (r as any).orderNumber : undefined }));
    }

    // Capture. The execute response — not the query string — is the source of truth.
    const result: any = await BkashService.executePayment(paymentID);
    const ok = result?.statusCode === '0000' || result?.transactionStatus === 'Completed';

    if (!ok) {
      await trySettleOrder({
        gateway: 'bkash', reference: paymentID, succeeded: false,
        reason: result?.statusMessage || 'execute failed',
      });
      return res.redirect(returnUrl('failed', { reason: result?.statusMessage || 'execute-failed' }));
    }

    const trxId = result.trxID || result.paymentID || paymentID;
    const settled = await trySettleOrder({
      gateway: 'bkash',
      reference: paymentID,
      transactionId: trxId,
      paidAmount: result.amount,
      succeeded: true,
    });

    switch (settled.outcome) {
      case 'settled':
      case 'already-paid':
        return res.redirect(
          returnUrl('success', { orderId: settled.orderId, ref: settled.orderNumber, trx: trxId })
        );
      case 'not-an-order':
        // A course enrollment came back through the hosted checkout.
        await EnrollmentService.verifyPayment(paymentID, trxId).catch(() => undefined);
        return res.redirect(returnUrl('success', { trx: trxId, kind: 'course' }));
      default:
        return res.redirect(returnUrl('failed', { reason: settled.reason || 'not-settled' }));
    }
  } catch (error: any) {
    console.error('[payment] bKash callback error:', error?.message || error);
    return res.redirect(returnUrl('failed', { reason: 'server-error' }));
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

// ─── Shared: verify an SSLCommerz result and settle it ───────
//
// Both the IPN and the browser-redirect success land here. Neither payload is
// trusted: `val_id` is re-validated against SSLCommerz's own validator API, and
// the AMOUNT that decides the outcome is the one the validator returns, not the
// one in the POST body. The browser-redirect body in particular is entirely
// attacker-controlled — a buyer can replay it with the amount edited.
const verifyAndSettleSsl = async (body: any): Promise<SettlementResult> => {
  const tranId = body?.tran_id ? String(body.tran_id) : undefined;
  const valId = body?.val_id ? String(body.val_id) : undefined;
  const declared = String(body?.status || '').toUpperCase();

  if (declared === 'FAILED') {
    return trySettleOrder({ gateway: 'sslcommerz', reference: tranId, orderNumber: tranId, succeeded: false, reason: 'declined at SSLCommerz' });
  }
  if (declared === 'CANCELLED') {
    return trySettleOrder({ gateway: 'sslcommerz', reference: tranId, orderNumber: tranId, succeeded: false, cancelled: true });
  }

  if (!valId) {
    return { outcome: 'rejected', reason: 'no val_id to validate against' };
  }

  const validation: any = await SslcommerzService.validateTransaction(valId);
  const valid = validation?.status === 'VALID' || validation?.status === 'VALIDATED';

  if (!valid) {
    return trySettleOrder({
      gateway: 'sslcommerz', reference: tranId, orderNumber: tranId,
      succeeded: false, reason: `validation returned ${validation?.status || 'no status'}`,
    });
  }

  return trySettleOrder({
    gateway: 'sslcommerz',
    reference: tranId,
    orderNumber: validation?.tran_id ? String(validation.tran_id) : tranId,
    transactionId: valId,
    // The validator's amount, deliberately — see the note above.
    paidAmount: validation?.amount,
    succeeded: true,
  });
};

// ─── SSLCommerz IPN (Instant Payment Notification) ───────────
//
// The authoritative notification: server-to-server, so it arrives even when the
// buyer closes the tab before being redirected back. SSLCommerz retries an IPN it
// does not get a 200 for, which is exactly why settlement is idempotent — the
// retry finds the order already paid and changes nothing.
const sslIPN = async (req: Request, res: Response) => {
  try {
    const result = await verifyAndSettleSsl(req.body);

    if (result.outcome === 'not-an-order') {
      const { tran_id, val_id, status: payStatus } = req.body;
      if (payStatus === 'VALID' && val_id) {
        const validation = await SslcommerzService.validateTransaction(val_id);
        if (validation.status === 'VALID') {
          await EnrollmentService.verifyPayment(tran_id, val_id);
        }
      }
    } else if (result.outcome === 'rejected') {
      console.warn('[payment] SSL IPN rejected:', result.reason);
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('SSL IPN error:', error);
    res.status(200).json({ success: true }); // Always return 200 for IPN
  }
};

// ─── SSLCommerz Success Callback (browser form POST) ─────────
// Settles too, rather than only redirecting: the IPN can be slow or blocked by a
// firewall, and the buyer should not be told "pending" for a payment that has
// already cleared. Whichever of the two arrives first settles; the other replays
// into the idempotency gate and is a no-op.
const sslSuccess = async (req: Request, res: Response) => {
  try {
    const result = await verifyAndSettleSsl(req.body);

    switch (result.outcome) {
      case 'settled':
      case 'already-paid':
        return res.redirect(
          returnUrl('success', { orderId: result.orderId, ref: result.orderNumber, trx: req.body?.val_id })
        );
      case 'not-an-order': {
        const { tran_id, val_id } = req.body;
        if (val_id) {
          const validation = await SslcommerzService.validateTransaction(val_id);
          if (validation.status === 'VALID') {
            await EnrollmentService.verifyPayment(tran_id, val_id);
          }
        }
        return res.redirect(returnUrl('success', { trx: val_id, kind: 'course' }));
      }
      default:
        console.warn('[payment] SSL success not settled:', (result as any).reason);
        return res.redirect(returnUrl('failed', { reason: 'verification-failed' }));
    }
  } catch (error: any) {
    console.error('SSL success error:', error?.message || error);
    return res.redirect(returnUrl('failed', { reason: 'server-error' }));
  }
};

// ─── SSLCommerz Fail / Cancel Callbacks ──────────────────────
// Previously inline in the routes file, answering JSON to a browser that had just
// been form-POSTed here — the buyer saw a raw JSON blob instead of the shop. Both
// now record the outcome and hand the browser back to the storefront.
const sslFail = async (req: Request, res: Response) => {
  try {
    const r = await trySettleOrder({
      gateway: 'sslcommerz',
      reference: req.body?.tran_id, orderNumber: req.body?.tran_id,
      succeeded: false, reason: req.body?.error || 'declined at SSLCommerz',
    });
    return res.redirect(returnUrl('failed', { ref: (r as any).orderNumber, orderId: (r as any).orderId }));
  } catch {
    return res.redirect(returnUrl('failed', {}));
  }
};

const sslCancel = async (req: Request, res: Response) => {
  try {
    const r = await trySettleOrder({
      gateway: 'sslcommerz',
      reference: req.body?.tran_id, orderNumber: req.body?.tran_id,
      succeeded: false, cancelled: true,
    });
    return res.redirect(returnUrl('cancelled', { ref: (r as any).orderNumber, orderId: (r as any).orderId }));
  } catch {
    return res.redirect(returnUrl('cancelled', {}));
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
  // Config
  gateways,
  // bKash
  initiate,
  execute,
  bkashCallback,
  status,
  demoComplete,
  // SSLCommerz
  sslInit,
  sslIPN,
  sslSuccess,
  sslFail,
  sslCancel,
  sslDemoComplete,
  // Manual
  submitManualPayment,
  // Free
  enrollFree,
};
