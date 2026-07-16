import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  Backplate,
  BackplateCreateBody,
  BackplatePatchBody,
  BackplateStatus,
  ConditionStatus,
  ListResponse,
} from './types';

export interface BackplateListFilters {
  q?: string;
  status?: ConditionStatus;
  backplate_status?: BackplateStatus;
  include_archived?: boolean;
}

export function useBackplates(filters: BackplateListFilters = {}) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['backplates', stationKey, filters],
    queryFn: () =>
      api<ListResponse<Backplate>>('/backplates', {
        query: { limit: 100, ...stationParam, ...filters },
      }),
    enabled: stationReady,
    placeholderData: keepPreviousData,
  });
}

export function useBackplate(id: string | undefined) {
  return useQuery({
    queryKey: ['backplate', id],
    queryFn: () => api<Backplate>(`/backplates/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateBackplates() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['backplates'] });
    qc.invalidateQueries({ queryKey: ['backplate'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateBackplate() {
  const invalidate = useInvalidateBackplates();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: BackplateCreateBody) =>
      api<Backplate>('/backplates', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

/** Масове створення: name — базова назва, реальні назви — <база>-1..<база>-N. */
export function useBulkCreateBackplates() {
  const invalidate = useInvalidateBackplates();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: BackplateCreateBody & { quantity: number }) =>
      api<ListResponse<Backplate>>('/backplates/bulk', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useUpdateBackplate(id: string) {
  const invalidate = useInvalidateBackplates();
  return useMutation({
    mutationFn: (body: BackplatePatchBody) =>
      api<Backplate>(`/backplates/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useArchiveBackplate(id: string) {
  const invalidate = useInvalidateBackplates();
  return useMutation({
    mutationFn: () => api<Backplate>(`/backplates/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreBackplate(id: string) {
  const invalidate = useInvalidateBackplates();
  return useMutation({
    mutationFn: () => api<Backplate>(`/backplates/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** Справжнє видалення з бази — лише для ложаментів без історії використання (MVP). */
export function useDeleteBackplate(id: string) {
  const invalidate = useInvalidateBackplates();
  return useMutation({
    mutationFn: () => api<void>(`/backplates/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
