import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** X-Request-Id → req.requestId → audit_log.request_id (api-contract.md §1.1). */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
