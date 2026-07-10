import express from 'express';
import { StudentController } from './student.controller';
import validateRequest from '../../middlewares/validateRequest';
import { studentValidationSchema } from './student.validation';

const router = express.Router();

router.post('/create-student',validateRequest(studentValidationSchema), StudentController.createStudentController);
router.get('/', StudentController.getAllStudentsController);
router.get('/:id', StudentController.getSingleStudentController);
router.patch('/:id', StudentController.updateStudentController);
router.delete('/:id', StudentController.deleteStudentController);

export const StudentRoutes = router;
