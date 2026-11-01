import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/User.js';
import { sendError } from '../utils/response.js';

export const requireRoles = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required.', 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      sendError(
        res,
        `Access denied. Role '${req.user.role}' does not have sufficient permissions for this resource.`,
        403
      );
      return;
    }

    next();
  };
};

export const requireAdmin = requireRoles('super_admin', 'admin');
export const requireSuperAdmin = requireRoles('super_admin');

