/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

function globalErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // Log for debugging (replace with a proper logger if needed)
  // eslint-disable-next-line no-console
  console.error(err);

  const response: any = {
    success: false,
    message: 'Internal Server Error',
  };

  // Zod validation errors
  if (err instanceof ZodError) {
    response.message = 'Validation error';
    response.errors = err.errors.map((e: any) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    return res.status(400).json(response);
  }

  // Mongoose validation errors
  if (err && err.name === 'ValidationError' && err.errors) {
    response.message = 'Validation error';
    response.errors = Object.values(err.errors).map((e: any) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json(response);
  }

  // Mongoose cast error (e.g., invalid ObjectId)
  if (err && err.name === 'CastError') {
    response.message = 'Invalid parameter';
    response.errors = [{ field: err.path || 'id', message: err.message }];
    return res.status(400).json(response);
  }

  // Duplicate key error (MongoDB)
  if (err && (err.code === 11000 || err.code === 11001)) {
    response.message = 'Duplicate key error';
    response.errors = Object.keys(err.keyValue || {}).map((k: string) => ({
      field: k,
      message: `${k} already exists`,
    }));
    return res.status(409).json(response);
  }

  // Generic/errors thrown with status
  const status = err?.status || 500;
  response.message = err?.message || response.message;
  if (err?.errors) response.errors = err.errors;

  if (process.env.NODE_ENV === 'development') response.stack = err?.stack;

  return res.status(status).json(response);
}

export default globalErrorHandler;
