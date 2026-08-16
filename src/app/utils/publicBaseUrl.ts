import { Request } from 'express';
import config from '../config';

/**
 * The public origin to prefix an uploaded file's URL with.
 *
 * Prefer CLIENT_URL — the site's own public domain — so a stored file URL sits
 * on a host every visitor can resolve and that the frontend's same-origin proxy
 * (next.config.ts /uploads rewrite) can serve. Using the *request* host instead
 * is wrong behind that proxy: the request arrives from the Next server, so the
 * host is the internal backend host (a *.sslip.io domain some networks block),
 * and that URL would then be baked into the DB and break for those visitors.
 *
 * Falls back to the request host when CLIENT_URL is unset (bare local dev).
 */
export const publicBaseUrl = (req: Request): string =>
  (config.client_url || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
