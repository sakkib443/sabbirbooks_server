import express from 'express';
import { trackByPhone } from './orderTrack.controller';
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

// Track a parcel from the home page, no account needed. POST so the phone
// number stays out of history and access logs — see the controller's note on
// what it deliberately does not return.
router.post('/track', trackByPhone);

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

// Book-order dashboard numbers — counts and revenue. Same capability as the
// list above. Declared before '/:id' so 'stats' is not read as an order id.
router.get('/stats', authMiddleware, authorize('admin'), requireCapability('orders.read'), OrderController.getStats);

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

// ─── Bulk status change ──────────────────────────────────────
// Same gate as the single-order status route (orders.write): confirming or
// cancelling many at once is the same decision, taken in bulk. Declared before
// '/:id' so 'bulk-status' is not read as an order id.
router.patch(
  '/bulk-status',
  authMiddleware,
  authorize('admin'),
  requireCapability('orders.write'),
  OrderController.updateOrdersStatus
);

// ─── Owner correction pass over one order ────────────────────
// Editing a buyer's email and address is a records change, not a fulfilment
// one, so it sits with delete on the owner-only gate rather than orders.write.
router.patch(
  '/:id/admin-edit',
  authMiddleware,
  authorize('superAdmin', 'admin'),
  OrderController.adminUpdateOrder
);

// ─── Delete orders — owner accounts only ─────────────────────
//
// Deleting an order destroys the record of a sale, so it is deliberately the
// narrowest gate in this file: superAdmin/admin, who alone bypass every
// capability check. A manager with orders.write can confirm and cancel, but
// never erase. The bulk route is declared before '/:id' so it is not read as an
// order id.
router.post(
  '/bulk-delete',
  authMiddleware,
  authorize('superAdmin', 'admin'),
  OrderController.deleteOrders
);
router.delete('/:id', authMiddleware, authorize('superAdmin', 'admin'), OrderController.deleteOrder);

// ─── Single order (owner or admin) — keep last so specific
// paths above win over the ':id' wildcard ────────────────────
router.get('/:id', authMiddleware, OrderController.getOrderById);

export const OrderRoutes = router;
