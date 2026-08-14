import express from 'express';
import { OrderController } from './order.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createOrderValidationSchema,
  updateOrderStatusValidationSchema,
  submitManualPaymentValidationSchema,
  updateOrderPaymentValidationSchema,
} from './order.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// ─── Checkout options (public) ───────────────────────────────
// Which payment methods are on + what delivery costs. Declared before '/:id'
// so the wildcard route below never swallows it.
router.get('/checkout-options', OrderController.getCheckoutOptions);

// ─── Create + list own orders (any logged-in user) ───────────
router.post(
  '/',
  authMiddleware,
  validateRequest(createOrderValidationSchema),
  OrderController.createOrder
);

router.get('/my', authMiddleware, OrderController.getMyOrders);

// ─── Admin: list all orders (paginated + ?status filter) ─────
// This is the "who is buying / how many sold" endpoint. `orders.read` is the
// capability an admin switches off for a content-only manager.
router.get('/', authMiddleware, authorize('admin'), requireCapability('orders.read'), OrderController.getAllOrders);

// ─── Payment (owner) — placed before '/:id' plain GET is fine ─
router.post('/:id/pay/bkash', authMiddleware, OrderController.payWithBkash);
router.post('/:id/pay/sslcommerz', authMiddleware, OrderController.payWithSslcommerz);

// REMOVED 2026-08-14 — POST /:id/pay/complete was a free-book hole.
//
// It marked an order paid with no gateway verification of any kind: find the
// order by id, apply the paid side-effects, save. Any logged-in buyer could
// place an order, call this, and get `status: 'processing'` — which is in
// bookAccess's PAID_ORDER_STATUSES, so the book's whole QR content opened
// without a taka changing hands. Printed stock decremented too. That is
// precisely the thing order.interface.ts:23 warns about: "anyone could type a
// fake address and read the whole book for free."
//
// Settlement now has exactly two legitimate entrances, both of which verify
// something the buyer cannot forge:
//   - a gateway callback, checked server-side in payment/orderSettlement.ts
//   - an admin approving a manual payment (POST /:id/approve below)
// OrderService.completePayment survives because the callback path calls it;
// what is gone is the buyer's ability to call it directly.
//
// The only client caller was checkoutBook()'s demo branch, which is
// unreachable whenever no gateway is configured (getAvailability never offers
// gateway mode then). src/scripts/e2e-purchase.ts also used it and will need
// updating before it is run again.

// Manual payment: buyer submits Send-Money details → order stays pending.
router.post(
  '/:id/pay/manual',
  authMiddleware,
  validateRequest(submitManualPaymentValidationSchema),
  OrderController.submitManualPayment
);

// ─── Admin: verify manual payments ───────────────────────────
router.post('/:id/approve', authMiddleware, authorize('admin'), requireCapability('orders.write'), OrderController.approveOrderPayment);
router.post('/:id/reject', authMiddleware, authorize('admin'), requireCapability('orders.write'), OrderController.rejectOrderPayment);
router.patch(
  '/:id/payment',
  authMiddleware,
  authorize('admin'),
  requireCapability('orders.write'),
  validateRequest(updateOrderPaymentValidationSchema),
  OrderController.updateOrderPayment
);

// ─── Download a purchased digital book (owner or admin) ──────
router.get('/:id/download/:bookId', authMiddleware, OrderController.downloadBook);

// ─── Admin: update fulfillment status ────────────────────────
router.patch(
  '/:id/status',
  authMiddleware,
  authorize('admin'),
  requireCapability('orders.write'),
  validateRequest(updateOrderStatusValidationSchema),
  OrderController.updateOrderStatus
);

// ─── Single order (owner or admin) — keep last so specific
// paths above win over the ':id' wildcard ────────────────────
router.get('/:id', authMiddleware, OrderController.getOrderById);

export const OrderRoutes = router;
