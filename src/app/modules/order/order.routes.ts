import express from 'express';
import { OrderController } from './order.controller';
import validateRequest from '../../middlewares/validateRequest';
import {
  createOrderValidationSchema,
  updateOrderStatusValidationSchema,
} from './order.validation';
import { authMiddleware, authorize } from '../../middlewares/auth';

const router = express.Router();

// ─── Create + list own orders (any logged-in user) ───────────
router.post(
  '/',
  authMiddleware,
  validateRequest(createOrderValidationSchema),
  OrderController.createOrder
);

router.get('/my', authMiddleware, OrderController.getMyOrders);

// ─── Admin: list all orders (paginated + ?status filter) ─────
router.get('/', authMiddleware, authorize('admin'), OrderController.getAllOrders);

// ─── Payment (owner) — placed before '/:id' plain GET is fine ─
router.post('/:id/pay/bkash', authMiddleware, OrderController.payWithBkash);
router.post('/:id/pay/sslcommerz', authMiddleware, OrderController.payWithSslcommerz);
router.post('/:id/pay/complete', authMiddleware, OrderController.completePayment);

// ─── Download a purchased digital book (owner or admin) ──────
router.get('/:id/download/:bookId', authMiddleware, OrderController.downloadBook);

// ─── Admin: update fulfillment status ────────────────────────
router.patch(
  '/:id/status',
  authMiddleware,
  authorize('admin'),
  validateRequest(updateOrderStatusValidationSchema),
  OrderController.updateOrderStatus
);

// ─── Single order (owner or admin) — keep last so specific
// paths above win over the ':id' wildcard ────────────────────
router.get('/:id', authMiddleware, OrderController.getOrderById);

export const OrderRoutes = router;
