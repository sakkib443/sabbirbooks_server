/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/modules/auth/google.controller.ts
//
// POST /api/user/google-signin — the one entry point for "Sign in with Google".
//
// Mounted on the user router rather than the auth router only because that is
// where the retired /google-login lived and where the client already looks.
//
// The body is a single field: { credential } — the ID token string that Google
// Identity Services hands the browser. No name, no email, no id. If a future
// change adds fields to this body, they must not be trusted: everything the
// server believes about the user comes out of verifyGoogleIdToken().

import { NextFunction, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthError, isGoogleConfigured } from './google.verify';

// Same header contract as the password login — the device limit needs it.
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

/**
 * Answers before body validation runs, so an operator with GOOGLE_CLIENT_ID
 * unset gets a diagnosis instead of a complaint about the field they sent.
 *
 * This is the path that ships today. Nothing here throws at import time or at
 * boot when the variable is missing — the feature is simply off, and this
 * route is the only thing that notices.
 *
 * A browser never sees it: with no NEXT_PUBLIC_GOOGLE_CLIENT_ID the client
 * renders no button at all. It is for direct callers and for the half-
 * configured case where the id was set on one side only.
 */
export const requireGoogleConfigured = (_req: Request, res: Response, next: NextFunction) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({
      success: false,
      code: 'not_configured',
      message:
        'Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and restart.',
    });
  }
  return next();
};

export const googleSignInController = async (req: Request, res: Response) => {
  try {
    const credential = (req.body ?? {}).credential;
    const result = await AuthService.googleSignIn(credential, getDeviceContext(req));

    return res.status(200).json({
      success: true,
      message: result.isNewUser ? 'Account created with Google' : 'Login successful',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof GoogleAuthError) {
      // 400 missing token / 401 unverifiable or unverified email / 503.
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    // decideGoogleAccount rejections (403 blocked/deleted, 409 already linked)
    // carry a status. Anything else is a genuine server fault — a 500 with a
    // generic message, never the raw error text.
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      success: false,
      message: status === 500 ? 'Google sign-in failed' : error.message,
    });
  }
};
