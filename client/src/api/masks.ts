import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  ConditionStatus,
  ListResponse,
  Mask,
  MaskCreateBody,
  MaskPatchBody,
} from './types';

export interface MaskListFilters {
  q?: string;
  status?: ConditionStatus;
  assigned_to?: string;
  include_archived?: boolean;
}

export function useMasks(filters: MaskListFilters = {}) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['masks', stationKey, filters],
    queryFn: () =>
      api<ListResponse<Mask>>('/masks', {
        query: { limit: 100, ...stationParam, ...filters },
      }),
    enabled: stationReady,
    placeholderData: keepPreviousData,
  });
}

export function useMask(id: string | undefined) {
  return useQuery({
    queryKey: ['mask', id],
    queryFn: () => api<Mask>(`/masks/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateMasks() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['masks'] });
    qc.invalidateQueries({ queryKey: ['mask'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateMask() {
  const invalidate = useInvalidateMasks();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: MaskCreateBody) =>
      api<Mask>('/masks', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

/** Масове створення: number — базовий номер, реальні номери — <база>-1..<база>-N. */
export function useBulkCreateMasks() {
  const invalidate = useInvalidateMasks();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: MaskCreateBody & { quantity: number }) =>
      api<ListResponse<Mask>>('/masks/bulk', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useUpdateMask(id: string) {
  const invalidate = useInvalidateMasks();
  return useMutation({
    mutationFn: (body: MaskPatchBody) => api<Mask>(`/masks/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useArchiveMask(id: string) {
  const invalidate = useInvalidateMasks();
  return useMutation({
    mutationFn: () => api<Mask>(`/masks/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreMask(id: string) {
  const invalidate = useInvalidateMasks();
  return useMutation({
    mutationFn: () => api<Mask>(`/masks/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** Справжнє видалення з бази — лише для масок без закріпленої особи (MVP). */
export function useDeleteMask(id: string) {
  const invalidate = useInvalidateMasks();
  return useMutation({
    mutationFn: () => api<void>(`/masks/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
