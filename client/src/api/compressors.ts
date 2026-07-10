import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type {
  Compressor,
  CompressorCreateBody,
  CompressorHistoryEvent,
  CompressorHistoryType,
  CompressorPatchBody,
  ListResponse,
  MaintenanceCreateBody,
  MaintenanceEvent,
} from './types';

export function useCompressors(includeArchived = false) {
  const { stationParam, stationKey, stationReady } = useAuth();
  return useQuery({
    queryKey: ['compressors', stationKey, includeArchived],
    queryFn: () =>
      api<ListResponse<Compressor>>('/compressors', {
        query: { limit: 100, include_archived: includeArchived || undefined, ...stationParam },
      }),
    enabled: stationReady,
    placeholderData: keepPreviousData,
  });
}

export function useCompressor(id: string | undefined) {
  return useQuery({
    queryKey: ['compressor', id],
    queryFn: () => api<Compressor>(`/compressors/${id}`),
    enabled: Boolean(id),
  });
}

export function useCompressorHistory(id: string | undefined, type: CompressorHistoryType) {
  return useQuery({
    queryKey: ['compressor-history', id, type],
    queryFn: () =>
      api<ListResponse<CompressorHistoryEvent>>(`/compressors/${id}/history`, {
        query: { type, limit: 100 },
      }),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateCompressors() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['compressors'] });
    qc.invalidateQueries({ queryKey: ['compressor'] });
    qc.invalidateQueries({ queryKey: ['compressor-history'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateCompressor() {
  const invalidate = useInvalidateCompressors();
  const { stationParam } = useAuth();
  return useMutation({
    mutationFn: (body: CompressorCreateBody) =>
      api<Compressor>('/compressors', { method: 'POST', body, query: stationParam }),
    onSuccess: invalidate,
  });
}

export function useUpdateCompressor(id: string) {
  const invalidate = useInvalidateCompressors();
  return useMutation({
    mutationFn: (body: CompressorPatchBody) =>
      api<Compressor>(`/compressors/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useCreateMaintenance(compressorId: string) {
  const invalidate = useInvalidateCompressors();
  return useMutation({
    mutationFn: (body: MaintenanceCreateBody) =>
      api<MaintenanceEvent>(`/compressors/${compressorId}/maintenance`, { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useArchiveCompressor(id: string) {
  const invalidate = useInvalidateCompressors();
  return useMutation({
    mutationFn: () => api<Compressor>(`/compressors/${id}/archive`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRestoreCompressor(id: string) {
  const invalidate = useInvalidateCompressors();
  return useMutation({
    mutationFn: () => api<Compressor>(`/compressors/${id}/restore`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
