/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/modules/auth/auth.controller.ts
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { SessionService } from '../session/session.service';

// Pull the device context off the request headers.
// Client MUST send a stable per-device UUID as the `x-device-id` header.
const getDeviceContext = (req: Request) => {
  const raw = req.headers['x-device-id'];
  const deviceId = Array.isArray(raw) ? raw[0] : raw;
  const uaRaw = req.headers['user-agent'];
  const userAgent = Array.isArray(uaRaw) ? uaRaw[0] : uaRaw;
  return {
    deviceId: (deviceId || '').trim() || undefined,
    userAgent: userAgent || '',
    ip: (req.ip || (req.socket && req.socket.remoteAddress) || '') as string,
  };
};

// ─── Register (public student signup) ───────────────────────
export const registerController = async (req: Request, res: Response) => {
  try {
    const result = await UserService.createUserServices(req.body);
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: result.user,
      token: result.token,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0] || 'field';
      return res.status(409).json({ success: false, message: `This ${field} is already registered` });
    }
    res.status(error?.status || 500).json({ success: false, message: error.message || 'Registration failed' });
  }
};

// ─── Get current user (token verify) ────────────────────────
export const getMeController = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    res.status(200).json({
      success: true,
      data: {
        _id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
      },
    });
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

export const loginController = async (req: Request, res: Response) => {
  try {
    const result = await AuthService.loginUser(req.body, getDeviceContext(req));
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: result,
    });
  } catch (error: any) {
    res.status(401).json({
      success: false,
      message: error.message || 'Login failed',
    });
  }
};

export const refreshTokenController = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }
    const { deviceId } = getDeviceContext(req);
    const result = await AuthService.refreshAccessToken(refreshToken, deviceId || '');
    res.status(200).json({
      success: true,
      message: 'Token refreshed',
      data: result,
    });
  } catch (error: any) {
    res.status(error?.status || 401).json({
      success: false,
      message: error.message || 'Token refresh failed',
    });
  }
};

export const changePasswordController = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both current and new passwords are required' });
    }
    await AuthService.changePassword(userId, currentPassword, newPassword);
    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message || 'Failed to change password' });
  }
};

// ─── Device-limit: logout THIS device ───────────────────────
export const logoutController = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { deviceId } = getDeviceContext(req);
    if (!deviceId) {
      return res.status(400).json({ success: false, message: 'x-device-id header is required to log out this device' });
    }
    const removed = await SessionService.removeSession(userId, deviceId);
    res.status(200).json({ success: true, message: removed ? 'Logged out on this device' : 'No active session for this device' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Logout failed' });
  }
};

// ─── Device-limit: logout ALL my devices ────────────────────
export const logoutAllController = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const count = await SessionService.removeAllSessions(userId);
    res.status(200).json({ success: true, message: `Logged out from ${count} device(s)`, data: { removed: count } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Logout failed' });
  }
};

// ─── Device-limit: list my active sessions ──────────────────
export const sessionsController = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const sessions = await SessionService.listSessions(userId);
    res.status(200).json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to list sessions' });
  }
};
