import express from 'express';
import { InvoiceController } from './invoice.controller';
import { authMiddleware } from '../../middlewares/auth';

const router = express.Router();

// Download invoice PDF for an enrollment
router.get(
  '/download/:enrollmentId',
  authMiddleware,
  InvoiceController.downloadInvoice
);

export const InvoiceRoutes = router;
