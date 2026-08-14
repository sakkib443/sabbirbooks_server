import express from 'express';
import { PaymentController } from './payment.controller';
import { authMiddleware, authorize } from '../../middlewares/auth';
import { warnIfPartiallyConfigured } from './gateway.config';

const router = express.Router();

// Shout at boot if a .env is half-filled, rather than at a buyer mid-checkout.
warnIfPartiallyConfigured();

// SSLCommerz delivers its callbacks as `application/x-www-form-urlencoded`, and
// app.ts registers only `express.json()` — so without this every field of every
// SSLCommerz callback arrives as undefined and no payment is ever settled.
// Mounted on this router rather than globally in app.ts: that file belongs to
// another agent, and the parser is only needed on these few routes anyway.
router.use(express.urlencoded({ extended: false }));

// ═══════ Gateway availability (public) ══════════════════════
// Read by the checkout UI to decide whether to offer a hosted-checkout button.
// Public on purpose: it exposes only two booleans per gateway, never a key.
router.get('/gateways', PaymentController.gateways);

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

// bKash redirects the BUYER'S BROWSER here after the hosted checkout, so there is
// no Authorization header to require — bKash is the caller, not our app. The
// paymentID in the query is the capability, and the handler re-fetches the real
// outcome from bKash rather than believing anything else in the URL.
// GET and POST are both registered because bKash's redirect method differs
// between the sandbox and live consoles depending on integration settings.
router.get('/bkash/callback', PaymentController.bkashCallback);
router.post('/bkash/callback', PaymentController.bkashCallback);

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

// Success/Fail/Cancel — SSLCommerz form-POSTs the buyer's browser to these, so
// each one settles what it can and then redirects to the storefront. GET is
// registered alongside POST because a buyer who reloads the return page issues a
// GET, and a 404 at that moment reads as a lost payment.
router.post('/sslcommerz/success', PaymentController.sslSuccess);
router.get('/sslcommerz/success', PaymentController.sslSuccess);
router.post('/sslcommerz/fail', PaymentController.sslFail);
router.get('/sslcommerz/fail', PaymentController.sslFail);
router.post('/sslcommerz/cancel', PaymentController.sslCancel);
router.get('/sslcommerz/cancel', PaymentController.sslCancel);

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
