import { Student } from './student.model';
import { IStudent } from './student.interface';

// CREATE → নতুন student তৈরি
const createStudentServices = async (payload: IStudent): Promise<IStudent> => {
  const student = await Student.create(payload);
  return student;
};

// READ → সব student data নেওয়া
const getAllStudentsServices = async (): Promise<IStudent[]> => {
  const students = await Student.find();
  return students;
};

// READ (single) → একটি student খোঁজা by ID
const getSingleStudentServices = async (id: string): Promise<IStudent | null> => {
  const student = await Student.findOne({ id });
  return student;
};

// UPDATE → student এর তথ্য আপডেট করা
const updateStudentServices = async (id: string, payload: Partial<IStudent>): Promise<IStudent | null> => {
  const updatedStudent = await Student.findOneAndUpdate({ id }, payload, { new: true });
  return updatedStudent;
};

// DELETE → একটি student ডিলিট করা
const deleteStudentServices = async (id: string): Promise<IStudent | null> => {
  const deletedStudent = await Student.findOneAndDelete({ id });
  return deletedStudent;
};

export const StudentService = {
  createStudentServices,
  getAllStudentsServices,
  getSingleStudentServices,
  updateStudentServices,
  deleteStudentServices,
};
