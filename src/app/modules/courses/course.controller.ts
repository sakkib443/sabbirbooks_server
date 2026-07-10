/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { CourseService } from './course.services';


// CREATE Course
export const createCourseController = async (req: Request, res: Response) => {
  try {
    const course = await CourseService.createCourseServices(req.body);
    res.status(201).json({ success: true, message: "Course created successfully", data: course });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET All Courses (supports ?search=&category=&type=&sort=&page=&limit=&status=)
export const getAllCoursesController = async (req: Request, res: Response) => {
  try {
    const { search, category, type, sort, page, limit, status } = req.query;
    const result = await CourseService.getAllCoursesServices({
      search: search as string,
      category: category as string,
      type: type as string,
      status: status as string,
      sort: sort as string,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      publicOnly: !status, // Public API shows only published unless admin specifies status
    });
    res.status(200).json({ success: true, data: result.courses, meta: { total: result.total, page: result.page, totalPages: result.totalPages } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// course.controller.ts
export const getSingleCourseController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // Number() করা যাবে না, কারণ এটি মঙ্গোডিবি ObjectId
    const course = await CourseService.getSingleCourseServices(id);
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });
    res.status(200).json({ success: true, data: course });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update Controller এও একই কাজ করুন
export const updateCourseController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // Number() সরিয়ে দিন
    const updatedCourse = await CourseService.updateCourseServices(id, req.body);
    res.status(200).json({ success: true, data: updatedCourse });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE Course
// CourseController.ts
export const deleteCourseController = async (req: Request, res: Response) => {
  try {
    const { id } = req.params; // Number(req.params.id) করার দরকার নেই
    const deletedCourse = await CourseService.deleteCourseServices(id);

    if (!deletedCourse) return res.status(404).json({ success: false, message: "Course not found" });

    res.status(200).json({ success: true, message: "Deleted successfully", data: deletedCourse });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const CourseController = {
  createCourseController,
  getAllCoursesController,
  getSingleCourseController,
  updateCourseController,
  deleteCourseController,
};
