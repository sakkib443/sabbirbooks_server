import express from 'express';
import { StudentController } from './student.controller';
import validateRequest from '../../middlewares/validateRequest';
import { studentValidationSchema } from './student.validation';
import { authMiddleware, authorize, requireCapability } from '../../middlewares/auth';

const router = express.Router();

// SECURITY FIX — this whole module had NO auth. `GET /api/students` returned
// every student record to anyone who asked, and PATCH/DELETE were open too.
// Same reasoning as contact.routes.ts: personal data cannot be withheld from a
// content-only manager while it is served to the open internet.
//
// The only caller in the client is the admin student-detail page
// (dashboard/admin/user/[id]), which already sends a bearer token, so gating
// these on the user capabilities breaks nothing.
const readStudents = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager'),
  requireCapability('users.read'),
];
const writeStudents = [
  authMiddleware,
  authorize('admin', 'superAdmin', 'trainingManager'),
  requireCapability('users.write'),
];

router.post('/create-student', ...writeStudents, validateRequest(studentValidationSchema), StudentController.createStudentController);
router.get('/', ...readStudents, StudentController.getAllStudentsController);
router.get('/:id', ...readStudents, StudentController.getSingleStudentController);
router.patch('/:id', ...writeStudents, StudentController.updateStudentController);
router.delete('/:id', ...writeStudents, StudentController.deleteStudentController);

export const StudentRoutes = router;
