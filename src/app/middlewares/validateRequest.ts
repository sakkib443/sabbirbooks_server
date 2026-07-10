/* eslint-disable @typescript-eslint/no-explicit-any */
// middlewares/validateRequest.ts

import { NextFunction, Request, Response } from 'express';
import { ZodSchema, ZodError } from 'zod';

const validateRequest = (schema: ZodSchema<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map(e => ({
          field: e.path.filter(p => p !== 'body').join('.'),
          message: e.message,
        }));
        return res.status(400).json({
          success: false,
          message: 'Validation error: ' + errors.map(e => `${e.field}: ${e.message}`).join(', '),
          errors,
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Something went wrong during validation',
      });
    }
  };
};

export default validateRequest;
