import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response.js';

export const enforceTenantScope = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    sendError(res, 'Authentication required for tenant operations.', 401);
    return;
  }

  // Super admins may inspect resources across tenants if explicitly requested
  if (req.user.role === 'super_admin' && req.headers['x-impersonate-tenant']) {
    return next();
  }

  // For regular queries, enforce workspace / user scoping
  req.query.workspaceId = req.user.workspaceId;
  next();
};

