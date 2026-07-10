import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { asyncHandler, parse } from '../../shared/http';
import * as authService from './auth.service';

export const authRouter = Router();

const loginSchema = z.object({
  login: z.string().trim().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);
    res.json(await authService.login(body.login, body.password));
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = parse(refreshSchema, req.body);
    res.json(await authService.refresh(body.refresh_token));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = parse(refreshSchema, req.body);
    await authService.logout(body.refresh_token);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = req.user!;
    res.json({
      user: {
        id: u.id,
        login: u.login,
        full_name: u.fullName,
        role: u.role,
        station: u.stationId ? { id: u.stationId, name: u.stationName ?? '' } : null,
      },
    });
  }),
);
