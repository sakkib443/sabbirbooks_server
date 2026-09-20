import express from 'express';
import rateLimit from 'express-rate-limit';
import { trackByPhone } from './orderTrack.controller';
import { OrderController } from './order.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createOrderValidationSchema,
  updateOrderStatusValidationSchema,
  submitManualPaymentValidationSchema,
  updateOrderPaymentValidationSchema,
} from './order.validation';
import { authMiddleware, authorize, requireCapability, optionalAuth } from '../../middlewares/auth';

const router = express.Router();

// Placing an order no longer needs an account, so this is the one public route
// that writes a document AND sends an SMS and an admin alert every time it is
// hit. The limit is per IP and generous on purpose: students order from the
// same hostel Wi-Fi and from mobile networks that put thousands of phones
// behind one address, and a limit tight enough to stop a flood from there
// would also stop a class ordering together. It exists to cap a script, not a
// busy evening. (app.ts trusts one proxy hop, so req.ip is the visitor.)
//
// A signed-in buyer is not counted: an account is already a thing the signup
// limiter rations. That is decided on req.user, which optionalAuth only sets
// for a token that verifies — so a forged Authorization header buys nothing —
// and it is why optionalAuth runs BEFORE this limiter on the route below.
// ORDER_CREATE_LIMIT exists for the e2e suites, which place dozens of orders
// from 127.0.0.1 in a few seconds.
const orderCreateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.ORDER_CREATE_LIMIT) || 20,
  skip: (req) => Boolean((req as any).user),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      'অল্প সময়ে অনেকগুলো অর্ডার এসেছে। কয়েক মিনিট পর আবার চেষ্টা করুন। (Too many orders from this connection — try again in a few minutes.)',
  },
});

// ─── Checkout options (public) ───────────────────────────────
// Which payment methods are on + what delivery costs. Declared before '/:id'
// so the wildcard route below never swallows it.
router.get('/checkout-options', OrderController.getCheckoutOptions);

// Track a parcel from the home page, no account needed. POST so the phone
// number stays out of history and access logs — see the controller's note on
// what it deliberately does not return.
router.post('/track', trackByPhone);

// ─── Create (anyone) + list own orders (logged-in user) ──────
// optionalAuth: a signed-in buyer's order is linked to their account; a guest's
// is not, and carries an access key instead (see OrderService.createOrder).
router.post(
  '/',
  optionalAuth,
  orderCreateLimiter,
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

// ─── Payment (owner, or the order's access key) ──────────────
// A guest has no token; they send the access key their order was created with
// in an x-order-key header. Anyone with neither gets "order not found".
router.post('/:id/pay/bkash', optionalAuth, OrderController.payWithBkash);
router.post('/:id/pay/sslcommerz', optionalAuth, OrderController.payWithSslcommerz);

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

// ─── Bulk delivery-date change ───────────────────────────────
// Moving a batch to the day it actually goes out. Same gate as the other bulk
// fulfilment action: it changes which packing list an order appears on, not the
// record of the sale. Declared before '/:id' so it is not read as an order id.
router.patch(
  '/bulk-dispatch-date',
  authMiddleware,
  authorize('admin'),
  requireCapability('orders.write'),
  OrderController.setOrdersDispatchDate
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

// ─── Single order (owner, admin, or access key) — keep last so
// specific paths above win over the ':id' wildcard ───────────
router.get('/:id', optionalAuth, OrderController.getOrderById);

export const OrderRoutes = router;
