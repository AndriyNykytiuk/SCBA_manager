import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL обовʼязковий'),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET має бути ≥ 16 символів'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(3600), // U-2: 1 година
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Некоректна конфігурація середовища (.env):', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
