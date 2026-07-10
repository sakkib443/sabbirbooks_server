/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/middlewares/chackRole.ts
import { Request, Response, NextFunction } from 'express';

/**
 * Middleware: Role-based access control.
 * Usage: checkRole('admin'), checkRole('mentor', 'student')
 *
 * Note: unlike `authorize` (in auth.ts) this does NOT auto-pass superAdmin —
 * only the exact roles listed are allowed. Kept for parity with the reference
 * server; `authorize` is preferred for most routes.
 */
export const checkRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    // No user or role not allowed
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have access to this route',
      });
    }

    // Role matched, proceed
    next();
  };
};
