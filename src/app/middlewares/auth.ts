/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/middlewares/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { User } from '../modules/user/user.model';
import { Capability, resolveCapabilities } from '../config/permissions';

/**
 * JWT Authentication middleware.
 * Verifies the Bearer ACCESS token and attaches the decoded payload
 * ({ _id, role, email }) to req.user.
 */
export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized access' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.access_secret);
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * Role-based Authorization middleware.
 * Usage: authorize('admin', 'mentor') → only these roles + superAdmin can access.
 * superAdmin always has access.
 */
/**
 * Reads the token when one is sent, and lets the request through either way.
 *
 * For routes that serve BOTH a signed-in buyer and an anonymous visitor — today
 * that is the QR scan, where a chapter the shop has marked free opens for
 * anyone while every other chapter still needs a purchase. authMiddleware
 * cannot do this: it answers 401 and the stranger never reaches the handler
 * that would have decided the chapter is free.
 *
 * A bad or expired token is treated as "not signed in" rather than an error:
 * the visitor gets the anonymous answer, which is the safe direction.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      (req as any).user = jwt.verify(token, config.jwt.access_secret as string);
    } catch {
      // Ignored on purpose — see the note above.
    }
  }
  next();
};

export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user || !user.role) {
      return res.status(403).json({ success: false, message: 'Access denied: No role found' });
    }

    const userRole = user.role;

    // superAdmin always has access
    if (userRole === 'superAdmin') {
      return next();
    }

    // Check if user's role is in the allowed list
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Access denied: '${userRole}' role is not authorized for this action`,
    });
  };
};

/**
 * Capability-based Authorization middleware.
 *
 * Compose it AFTER authorize(): both must pass, so a capability can only ever
 * narrow a route, never widen it.
 *
 *   router.get('/', authMiddleware, authorize('admin'), requireCapability('orders.read'), ...)
 *
 * Why it reads the database instead of the JWT:
 *   - the access token carries only { _id, role, email }; adding capabilities to
 *     it would mean a manager keeps a revoked permission until their token
 *     expires, and re-signing tokens on every permission change is worse.
 *   - the role in the token can also be stale after a role change, so the
 *     DOCUMENT's role is the one that decides.
 * The lookup is one indexed findById on admin-panel traffic only.
 */
export const requireCapability = (...required: Capability[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tokenUser = (req as any).user;

    if (!tokenUser || !tokenUser._id) {
      return res.status(403).json({ success: false, message: 'Access denied: not authenticated' });
    }

    // superAdmin keeps its unconditional bypass — unchanged from authorize().
    if (tokenUser.role === 'superAdmin') return next();

    let account: { role?: string; permissions?: unknown; status?: string; isDeleted?: boolean } | null;
    try {
      account = await User.findById(tokenUser._id)
        .select('role permissions status isDeleted')
        .lean<{ role?: string; permissions?: unknown; status?: string; isDeleted?: boolean }>();
    } catch {
      return res.status(500).json({ success: false, message: 'Could not verify permissions' });
    }

    if (!account || account.isDeleted || (account.status && account.status !== 'active')) {
      return res.status(403).json({ success: false, message: 'Access denied: account is not active' });
    }

    // The master super admin is created on the fly by auth.service — honour the
    // bypass from the document too, in case the token was minted before that.
    if (account.role === 'superAdmin') return next();

    const owned = resolveCapabilities(account.role, account.permissions);
    const missing = required.filter((cap) => !owned.includes(cap));

    if (missing.length > 0) {
      return res.status(403).json({
        success: false,
        message: `Access denied: missing permission '${missing[0]}'`,
        missing,
      });
    }

    (req as any).capabilities = owned;
    return next();
  };
};
