/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { UserService } from './user.service';
import {
  CAPABILITIES,
  GRANTABLE_CAPABILITIES,
  MANAGER_ROLES,
  ROLE_DEFAULT_CAPABILITIES,
  isManagerRole,
  resolveCapabilities,
} from '../../config/permissions';

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

// REMOVED 2026-08-14 — googleLoginController(). It forwarded an unverified
// request body to the equally unverified googleLoginServices(); both are gone.
// The replacement lives in modules/auth/google.controller.ts, which never reads
// an identity from the body — only a Google-signed ID token it then verifies.

export const getAllUsersController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    let users = await UserService.getAllUsersServices();
    // A manager may only see student/user accounts — never staff.
    if (MANAGER_ROLES.includes(requesterRole)) {
      users = (users as any[]).filter(u => ['student', 'user'].includes(u.role));
    }
    // Attach each account's RESOLVED capabilities so the admin permission
    // matrix shows what a manager can actually do, not just what was stored.
    const withCaps = (users as any[]).map((u) => {
      const plain = typeof u.toObject === 'function' ? u.toObject() : { ...u };
      return { ...plain, capabilities: resolveCapabilities(plain.role, plain.permissions) };
    });
    res.status(200).json({ success: true, data: withCaps });
  } catch (error: any) {
    sendError(res, error);
  }
};

// ── The capability vocabulary, served to the admin permission matrix ──
// The UI never hardcodes the list: it renders whatever the server declares, so
// the matrix cannot drift from what the server actually enforces.
export const getPermissionCatalogController = async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      capabilities: CAPABILITIES,
      grantable: GRANTABLE_CAPABILITIES,
      managerRoles: MANAGER_ROLES,
      roleDefaults: ROLE_DEFAULT_CAPABILITIES,
    },
  });
};

// ── Replace a manager's capability list ──
// Route is already behind authorize('admin','superAdmin') + staff.manage; these
// checks close the remaining escalation paths.
export const updateUserPermissionsController = async (req: Request, res: Response) => {
  try {
    const requesterRole = (req as any).user?.role;
    const requesterId = String((req as any).user?._id || '');

    const target = await UserService.getSingleUserServices(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    // 1. Nobody edits their own permissions — not even an admin. Removes the
    //    "grant myself more, then use it" loop entirely.
    if (String((target as any)._id) === requesterId) {
      return res
        .status(403)
        .json({ success: false, message: 'You cannot change your own permissions' });
    }

    // 2. Only the two manager roles have editable permissions. Admin and
    //    superAdmin are fixed at full access; students and mentors are governed
    //    by their own routes.
    if (!isManagerRole((target as any).role)) {
      return res.status(400).json({
        success: false,
        message: 'Permissions can only be set on a Training Manager or Content Manager account',
      });
    }

    // 3. An admin may not be edited by anyone but a superAdmin (defence in
    //    depth — an admin target is already rejected by check 2).
    if ((target as any).role === 'admin' && requesterRole !== 'superAdmin') {
      return res
        .status(403)
        .json({ success: false, message: 'Only a Super Admin can modify an admin account' });
    }

    const updated = await UserService.setUserPermissionsServices(
      req.params.id,
      req.body?.permissions,
    );
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });

    res.status(200).json({
      success: true,
      message: 'Permissions updated',
      data: {
        ...(updated as any).toObject?.() ?? updated,
        capabilities: UserService.capabilitiesFor(updated as any),
      },
    });
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

    // A manager may ONLY manage student accounts — never staff, never role changes.
    if (MANAGER_ROLES.includes(requesterRole)) {
      if (!['student', 'user'].includes((target as any).role)) {
        return res.status(403).json({ success: false, message: 'Managers can only manage student accounts' });
      }
      if (newRole && !['student', 'user'].includes(newRole)) {
        return res.status(403).json({ success: false, message: "Managers cannot change a user's role" });
      }
    }

    // `permissions` is stripped in the service too; rejecting it loudly here
    // makes the escalation attempt visible instead of silently ignored.
    if (req.body?.permissions !== undefined) {
      return res.status(400).json({
        success: false,
        message: 'Use PATCH /api/user/:id/permissions to change permissions',
      });
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
    // A manager may only delete student accounts.
    if (MANAGER_ROLES.includes(requesterRole) && !['student', 'user'].includes((target as any).role)) {
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
  deleteUserController,
  updateUserController,
  updateOwnProfileController,
  getAllUsersController,
  getSingleUserController,
  getPermissionCatalogController,
  updateUserPermissionsController,
};
