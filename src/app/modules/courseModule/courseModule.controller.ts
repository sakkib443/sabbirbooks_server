import { Request, Response } from 'express';
import { CourseModuleService } from './courseModule.service';

const createModule = async (req: Request, res: Response) => {
  try {
    const result = await CourseModuleService.createModule(req.body);
    res.status(201).json({ success: true, message: 'Module created successfully', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getModulesByCourse = async (req: Request, res: Response) => {
  try {
    const result = await CourseModuleService.getModulesByCourse(req.params.courseId);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const getSingleModule = async (req: Request, res: Response) => {
  try {
    const result = await CourseModuleService.getSingleModule(req.params.id);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(404).json({ success: false, message: error.message });
  }
};

const updateModule = async (req: Request, res: Response) => {
  try {
    const result = await CourseModuleService.updateModule(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Module updated successfully', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const deleteModule = async (req: Request, res: Response) => {
  try {
    await CourseModuleService.deleteModule(req.params.id);
    res.status(200).json({ success: true, message: 'Module deleted successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

const reorderModules = async (req: Request, res: Response) => {
  try {
    const result = await CourseModuleService.reorderModules(req.params.courseId, req.body.moduleOrders);
    res.status(200).json({ success: true, message: 'Modules reordered', data: result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const CourseModuleController = {
  createModule,
  getModulesByCourse,
  getSingleModule,
  updateModule,
  deleteModule,
  reorderModules,
};
