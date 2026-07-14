import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  ConditionStatus,
  Cylinder,
  CylinderCreateBody,
  CylinderMaterial,
  CylinderPatchBody,
  HydroTest,
  HydroTestCreateBody,
  ListResponse,
} from './types';

export interface CylinderListFilters {
  q?: string;
  status?: ConditionStatus;
  material?: CylinderMaterial;
  volume_l?: number;
  installed?: boolean;
  include_archived?: boolean;
}

export function useCylinders(filters: CylinderListFilters = {}) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['cylinders', stationKey, filters],
    queryFn: () =>
      api<ListResponse<Cylinder>>('/cylinders', {
        query: { limit: 100, ...stationParam, ...filters },
      }),
    enabled: stationReady,
    placeholderData: keepPreviousData,
  });
}

export function useCylinder(id: string | undefined) {
  return useQuery({
    queryKey: ['cylinder', id],
    queryFn: () => api<Cylinder>(`/cylinders/${id}`),
    enabled: Boolean(id),
  });
}

export function useHydroTests(cylinderId: string | undefined) {
  return useQuery({
    queryKey: ['hydro-tests', cylinderId],
    queryFn: () =>
      api<ListResponse<HydroTest>>(`/cylinders/${cylinderId}/hydro-tests`, {
        query: { sort: '-tested_at', limit: 100 },
      }),
    enabled: Boolean(cylinderId),
  });
}

function useInvalidateCylinders() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['cylinders'] });
    qc.invalidateQueries({ queryKey: ['cylinder'] });
    qc.invalidateQueries({ queryKey: ['hydro-tests'] });
    qc.invalidateQueries({ queryKey: ['apparatus'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateCylinder() {
  const invalidate = useInvalidateCylinders();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: CylinderCreateBody) =>
      api<Cylinder>('/cylinders', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useUpdateCylinder(id: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: (body: CylinderPatchBody) =>
      api<Cylinder>(`/cylinders/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useCreateHydroTest(cylinderId: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: (body: HydroTestCreateBody) =>
      api<HydroTest>(`/cylinders/${cylinderId}/hydro-tests`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useSetHydroOverride(cylinderId: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: (date: string | null) =>
      api<Cylinder>(`/cylinders/${cylinderId}/next-hydro-test-override`, {
        method: 'PUT',
        body: { date },
      }),
    onSuccess: invalidate,
  });
}

export function useArchiveCylinder(id: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: () => api<Cylinder>(`/cylinders/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreCylinder(id: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: () => api<Cylinder>(`/cylinders/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** Справжнє видалення з бази — лише для балонів без історії використання (MVP). */
export function useDeleteCylinder(id: string) {
  const invalidate = useInvalidateCylinders();
  return useMutation({
    mutationFn: () => api<void>(`/cylinders/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
