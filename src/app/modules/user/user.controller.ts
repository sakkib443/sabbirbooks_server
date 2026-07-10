/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { UserService } from './user.service';

/**
 * Map service/DB errors to sensible HTTP status codes.
 * - duplicate key (E11000, e.g. email/id already taken) → 400 friendly message
 * - mongoose validation / cast errors → 400
 * - everything else → 500
 */
const sendError = (res: Response, error: any) => {
  if (error?.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'field';
    return res.status(400).json({
      success: false,
      message: `This ${field} is already registered`,
    });
  }
  if (error?.name === 'ValidationError' || error?.name === 'CastError') {
    return res.status(400).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message });
};

export const createUserController = async (req: Request, res: Response) => {
  try {
    const data = req.body
    const result = await UserService.createUserServices(data);
    res.status(200).json({
      success: true,
      message: 'Registration successful! You are now logged in.',
      data: result.user,
      token: result.token,
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

// Create a staff account (admin / trainingManager) — admin-only; admin role requires superAdmin
export const createStaffController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    const result = await UserService.createStaffServices(req.body, requesterRole);
    res.status(201).json({
      success: true,
      message: 'Staff account created',
      data: result.user,
      credentials: result.credentials, // { email, password, role } — show once
    });
  } catch (error: any) {
    if (error?.statusCode === 403) return res.status(403).json({ success: false, message: error.message });
    if (error?.statusCode === 409) return res.status(409).json({ success: false, message: error.message });
    sendError(res, error);
  }
};

// Create a student account — admin / superAdmin / trainingManager (role forced to student in the service)
export const createStudentController = async (req: Request, res: Response) => {
  try {
    const result = await UserService.createStudentServices(req.body);
    res.status(201).json({
      success: true,
      message: 'Student account created',
      data: result.user,
      credentials: result.credentials, // { email, password, role } — show once
    });
  } catch (error: any) {
    if (error?.statusCode === 409) return res.status(409).json({ success: false, message: error.message });
    sendError(res, error);
  }
};

export const googleLoginController = async (req: Request, res: Response) => {
  try {
    const result = await UserService.googleLoginServices(req.body);
    res.status(200).json({
      success: true,
      message: 'Google login successful!',
      data: result.user,
      token: result.token,
    });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const getAllUsersController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    let users = await UserService.getAllUsersServices();
    // A trainingManager (Manager) may only see student/user accounts — never staff.
    if (requesterRole === 'trainingManager') {
      users = (users as any[]).filter(u => ['student', 'user'].includes(u.role));
    }
    res.status(200).json({ success: true, data: users });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const getSingleUserController = async (req: Request, res: Response) => {
  try {
    const user = await UserService.getSingleUserServices(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, data: user });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const updateUserController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    const target = await UserService.getSingleUserServices(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    // Protect the master account: only a superAdmin may modify a superAdmin
    if ((target as any).role === 'superAdmin' && requesterRole !== 'superAdmin') {
      return res.status(403).json({ success: false, message: 'Only a Super Admin can modify a Super Admin account' });
    }
    // Only a superAdmin can promote anyone to admin / superAdmin
    const newRole = req.body?.role;
    if (newRole && ['admin', 'superAdmin'].includes(newRole) && requesterRole !== 'superAdmin') {
      return res.status(403).json({ success: false, message: 'Only a Super Admin can assign the admin role' });
    }

    // A trainingManager (Manager) may ONLY manage student accounts — never staff, never role changes.
    if (requesterRole === 'trainingManager') {
      if (!['student', 'user'].includes((target as any).role)) {
        return res.status(403).json({ success: false, message: 'Managers can only manage student accounts' });
      }
      if (newRole && !['student', 'user'].includes(newRole)) {
        return res.status(403).json({ success: false, message: "Managers cannot change a user's role" });
      }
    }

    const updatedUser = await UserService.updateUserServices(req.params.id, req.body);
    if (!updatedUser)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, data: updatedUser });
  } catch (error: any) {
    sendError(res, error);
  }
};

// Any authenticated user updates their OWN basic profile (safe fields only — no role/status/password/email)
export const updateOwnProfileController = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const allowed = ['firstName', 'lastName', 'phoneNumber', 'location', 'image'] as const;
    const payload: any = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });
    const updated = await UserService.updateUserServices(String(userId), payload);
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const deleteUserController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    const target = await UserService.getSingleUserServices(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    // A superAdmin (master) account can never be deleted
    if ((target as any).role === 'superAdmin') {
      return res.status(403).json({ success: false, message: 'A Super Admin account cannot be deleted' });
    }
    // A trainingManager (Manager) may only delete student accounts.
    if (requesterRole === 'trainingManager' && !['student', 'user'].includes((target as any).role)) {
      return res.status(403).json({ success: false, message: 'Managers can only delete student accounts' });
    }

    const deletedUser = await UserService.deleteUserServices(req.params.id);
    if (!deletedUser)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({ success: true, data: deletedUser });
  } catch (error: any) {
    sendError(res, error);
  }
};

export const UserController = {
  createUserController,
  createStaffController,
  createStudentController,
  googleLoginController,
  deleteUserController,
  updateUserController,
  updateOwnProfileController,
  getAllUsersController,
  getSingleUserController,
};
