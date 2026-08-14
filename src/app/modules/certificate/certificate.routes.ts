import express from 'express';
import { CertificateController } from './certificate.controller';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// Certificates are a training operation. Role list unchanged; `training.manage`
// added on top so an admin can revoke it from a manager in the matrix.
const trainingWrite = [
  authMiddleware,
  authorize('admin', 'trainingManager'),
  requireCapability('training.manage'),
];

// Public: Verify certificate (NO auth needed)
router.get('/verify/:certId', CertificateController.verify);
router.get('/search', CertificateController.search);

// Student: My certificates
router.get('/my', authMiddleware, CertificateController.myCertificates);

// Batch-based certification (Admin + Training Manager)
router.get('/batches', ...trainingWrite, CertificateController.getCertBatches);
router.get('/batch-students/:batchId', ...trainingWrite, CertificateController.getBatchStudents);
router.post('/toggle-eligibility', ...trainingWrite, CertificateController.toggleEligibility);
router.post('/bulk-grant', ...trainingWrite, CertificateController.bulkGrant);

// Admin
router.post('/', ...trainingWrite, CertificateController.create);
router.get('/', ...trainingWrite, CertificateController.getAll);
router.get('/pending', ...trainingWrite, CertificateController.getPending);
router.get('/stats', ...trainingWrite, CertificateController.stats);
router.get('/:certId', authMiddleware, CertificateController.getById);
router.patch('/:certId', ...trainingWrite, CertificateController.update);
router.patch('/:certId/activate', ...trainingWrite, CertificateController.activate);
router.patch('/:certId/revoke', ...trainingWrite, CertificateController.revoke);
router.delete('/:certId', ...trainingWrite, CertificateController.remove);

export const CertificateRoutes = router;
