import express from 'express';
import { PaymentController } from './payment.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ═══════ bKash Routes ═══════════════════════════════════════
router.post(
  '/bkash/initiate',
  authMiddleware,
  authorize('student'),
  PaymentController.initiate
);

router.post(
  '/bkash/execute',
  authMiddleware,
  PaymentController.execute
);

router.get(
  '/bkash/status/:paymentID',
  authMiddleware,
  PaymentController.status
);

router.post(
  '/bkash/demo-complete',
  authMiddleware,
  PaymentController.demoComplete
);

// ═══════ SSLCommerz Routes ══════════════════════════════════
router.post(
  '/sslcommerz/init',
  authMiddleware,
  authorize('student'),
  PaymentController.sslInit
);

// IPN (no auth — SSLCommerz server calls this)
router.post('/sslcommerz/ipn', PaymentController.sslIPN);

// Success/Fail callbacks (POST from SSLCommerz)
router.post('/sslcommerz/success', PaymentController.sslSuccess);
router.post('/sslcommerz/fail', (req, res) => {
  res.status(200).json({ success: false, message: 'Payment failed', data: req.body });
});
router.post('/sslcommerz/cancel', (req, res) => {
  res.status(200).json({ success: false, message: 'Payment cancelled', data: req.body });
});

router.post(
  '/sslcommerz/demo-complete',
  authMiddleware,
  PaymentController.sslDemoComplete
);

// ═══════ Manual Payment ═════════════════════════════════════
router.post(
  '/manual/submit',
  authMiddleware,
  authorize('student'),
  PaymentController.submitManualPayment
);

// ═══════ Free Enrollment ════════════════════════════════════
router.post(
  '/free/enroll',
  authMiddleware,
  authorize('student'),
  PaymentController.enrollFree
);

export const PaymentRoutes = router;
