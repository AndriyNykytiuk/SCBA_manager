import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { errors } from '../shared/errors';
import type { Role } from './auth';

/**
 * RBAC: список дозволених ролей. Мутації доменних ресурсів — requireRole('master','admin'):
 * duty отримує 403 ROLE_FORBIDDEN (api-contract.md §1.2, §12).
 */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(errors.unauthenticated());
    if (!roles.includes(user.role)) return next(errors.roleForbidden());
    next();
  };
}
