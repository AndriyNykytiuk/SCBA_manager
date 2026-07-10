import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors';

/** Єдиний формат помилок (api-contract.md §1.4). */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.http).json({
      error: { code: err.code, message: err.message, details: err.details ?? [] },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Некоректні дані запиту',
        details: err.issues.map((i) => ({
          field: i.path.join('.') || undefined,
          rule: i.code,
          message: i.message,
        })),
      },
    });
    return;
  }

  // Некоректний JSON у тілі (express.json)
  if (err instanceof SyntaxError && 'body' in (err as object)) {
    res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: 'Некоректний JSON у тілі запиту', details: [] },
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.error(`[${req.requestId ?? '-'}]`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Внутрішня помилка сервера',
      details: [{ rule: 'request_id', message: req.requestId }],
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ресурс не знайдено', details: [] } });
}
