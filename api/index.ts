/**
 * Vercel serverless entry point.
 * Wraps the Express app as a single serverless function so the whole API
 * (all /api/* routes + health check) runs on Vercel. `dbConnect` uses a cached
 * global Mongoose connection (reused across warm invocations).
 *
 * NOTE: PDF invoice generation (puppeteer/Chromium) does not run on Vercel's
 * serverless runtime — that feature needs a long-running host (e.g. Render).
 * Everything else works normally.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import app from '../src/app';
import { dbConnect } from '../src/app/utils/dbConnect';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await dbConnect();
  } catch (err) {
    // Non-fatal: log and let the request proceed (routes will surface DB errors).
    console.error('Database connection error:', (err as Error)?.message);
  }
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
