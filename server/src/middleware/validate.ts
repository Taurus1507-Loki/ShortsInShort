import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

type WithQuery = Request & { validatedQuery?: unknown };

/**
 * Validates and replaces req.body / req.params with the parsed (typed, stripped) value; the parsed
 * query is stored on `validatedQuery` (Express 4's req.query is a getter). Body schemas should be
 * `.strict()` so unknown fields (e.g. `role`, `creditBalance`) are rejected — no mass-assignment.
 */
export const validate =
  (schemas: { body?: ZodType; query?: ZodType; params?: ZodType }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.params) req.params = schemas.params.parse(req.params) as Request['params'];
      if (schemas.query) (req as WithQuery).validatedQuery = schemas.query.parse(req.query);
      next();
    } catch (err) {
      next(err);
    }
  };

export const validatedQuery = <T>(req: Request): T => (req as WithQuery).validatedQuery as T;
