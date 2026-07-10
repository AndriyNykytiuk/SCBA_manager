import { z } from 'zod';
import { errors } from './errors';

/** Спільні query-параметри списків (api-contract.md §1.3). */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().min(1).optional(),
  status: z.enum(['ok', 'warning', 'overdue']).optional(),
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  sort: z.string().trim().min(1).optional(),
  station_id: z.string().uuid().optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
}

export function listEnvelope<T>(data: T[], meta: ListMeta): { data: T[]; meta: ListMeta } {
  return { data, meta };
}

/**
 * parseSort: 'name' | '-created_at' → SQL ORDER BY за whitelist-ом колонок.
 * allowed: мапа api-поле → SQL-вираз.
 */
export function parseSort(
  sort: string | undefined,
  allowed: Record<string, string>,
  fallback: string,
): string {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const expr = allowed[field];
  if (!expr) {
    throw errors.validation(`Невідоме поле сортування: ${field}`, [
      { field: 'sort', rule: 'invalid_sort_field' },
    ]);
  }
  return `${expr} ${desc ? 'DESC' : 'ASC'} NULLS LAST`;
}

export function offsetOf(q: { page: number; limit: number }): number {
  return (q.page - 1) * q.limit;
}
