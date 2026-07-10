import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  Apparatus,
  ApparatusCreateBody,
  ApparatusCylinderHistoryEntry,
  ConditionStatus,
  ListResponse,
} from './types';

export interface ApparatusListFilters {
  q?: string;
  status?: ConditionStatus;
  assembled?: boolean;
  storage_location_id?: string;
  /** точний збіг — резолв QR-скану */
  backplate_name?: string;
  include_archived?: boolean;
}

export function useApparatusList(filters: ApparatusListFilters = {}, enabledExtra = true) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['apparatus', stationKey, filters],
    queryFn: () =>
      api<ListResponse<Apparatus>>('/apparatus', {
        query: { limit: 100, ...stationParam, ...filters },
      }),
    enabled: stationReady && enabledExtra,
    placeholderData: keepPreviousData,
  });
}

export function useApparatus(id: string | undefined) {
  return useQuery({
    queryKey: ['apparatus', 'detail', id],
    queryFn: () => api<Apparatus>(`/apparatus/${id}`),
    enabled: Boolean(id),
  });
}

export function useApparatusCylinderHistory(id: string | undefined) {
  return useQuery({
    queryKey: ['apparatus', 'cylinder-history', id],
    queryFn: () =>
      api<ListResponse<ApparatusCylinderHistoryEntry>>(`/apparatus/${id}/cylinder-history`, {
        query: { limit: 100 },
      }),
    enabled: Boolean(id),
  });
}

/** Резолв номера ложамента (QR / ручне введення) в апарат */
export function useResolveApparatusByName() {
  const { stationParam } = useAuth();
  return async (name: string): Promise<Apparatus | null> => {
    const res = await api<ListResponse<Apparatus>>('/apparatus', {
      query: { ...stationParam, backplate_name: name, limit: 1 },
    });
    return res.data[0] ?? null;
  };
}

function useInvalidateApparatus() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['apparatus'] });
    qc.invalidateQueries({ queryKey: ['backplates'] });
    qc.invalidateQueries({ queryKey: ['backplate'] });
    qc.invalidateQueries({ queryKey: ['cylinders'] });
    qc.invalidateQueries({ queryKey: ['cylinder'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateApparatus() {
  const invalidate = useInvalidateApparatus();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: ApparatusCreateBody) =>
      api<Apparatus>('/apparatus', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useUpdateApparatus(id: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: (body: { storage_location_id?: string | null; notes?: string | null }) =>
      api<Apparatus>(`/apparatus/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useInstallCylinder(apparatusId: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: (body: { cylinder_id: string; position: number }) =>
      api<Apparatus>(`/apparatus/${apparatusId}/cylinders`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useRemoveCylinder(apparatusId: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: (position: number) =>
      api<Apparatus>(`/apparatus/${apparatusId}/cylinders/${position}/remove`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useDisassembleApparatus(id: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: () => api<Apparatus>(`/apparatus/${id}/disassemble`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useArchiveApparatus(id: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: () => api<Apparatus>(`/apparatus/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreApparatus(id: string) {
  const invalidate = useInvalidateApparatus();
  return useMutation({
    mutationFn: () => api<Apparatus>(`/apparatus/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
