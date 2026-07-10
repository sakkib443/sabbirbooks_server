/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { StudentService } from './student.service';

// CREATE Controller → নতুন student তৈরি
export const createStudentController = async (req: Request, res: Response) => {
  try {
    const student = await StudentService.createStudentServices(req.body);
    res.status(201).json({
      success: true,
      message: 'Student created successfully',
      data: student,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// READ ALL Controller → সব student দেখানো
export const getAllStudentsController = async (req: Request, res: Response) => {
  try {
    const students = await StudentService.getAllStudentsServices();
    res.status(200).json({
      success: true,
      message: 'Students fetched successfully',
      data: students,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// READ SINGLE Controller → একটি student দেখানো by ID
export const getSingleStudentController = async (req: Request, res: Response) => {
  try {
    const student = await StudentService.getSingleStudentServices(req.params.id);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Student fetched successfully',
      data: student,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// UPDATE Controller → student এর তথ্য আপডেট
export const updateStudentController = async (req: Request, res: Response) => {
  try {
    const updatedStudent = await StudentService.updateStudentServices(req.params.id, req.body);
    if (!updatedStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Student updated successfully',
      data: updatedStudent,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// DELETE Controller → একটি student ডিলিট করা
export const deleteStudentController = async (req: Request, res: Response) => {
  try {
    const deletedStudent = await StudentService.deleteStudentServices(req.params.id);
    if (!deletedStudent) {
      return res.status(404).json({
        success: false,
        message: 'Student not found',
      });
    }
    res.status(200).json({
      success: true,
      message: 'Student deleted successfully',
      data: deletedStudent,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const StudentController = {
  createStudentController,
  getAllStudentsController,
  getSingleStudentController,
  updateStudentController,
  deleteStudentController,
};
