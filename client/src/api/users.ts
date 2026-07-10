import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './http';
import { useAuth } from '../auth/AuthContext';
import type { ListResponse, Role, User, UserCreateBody, UserPatchBody } from './types';

export interface UserListFilters {
  q?: string;
  role?: Role;
  station_id?: string;
  is_active?: boolean;
}

export function useUsers(filters: UserListFilters = {}) {
  const { isAdmin, status } = useAuth();
  return useQuery({
    queryKey: ['users', filters],
    queryFn: () => api<ListResponse<User>>('/users', { query: { limit: 100, ...filters } }),
    enabled: status === 'authed' && isAdmin,
    placeholderData: keepPreviousData,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => api<User>(`/users/${id}`),
    enabled: Boolean(id),
  });
}

function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['user'] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: UserCreateBody) => api<User>('/users', { method: 'POST', body }),
    onSuccess: invalidate,
  });
}

export function useUpdateUser(id: string) {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: (body: UserPatchBody) => api<User>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
  });
}

export function useResetPassword(id: string) {
  return useMutation({
    mutationFn: (newPassword: string) =>
      api<void>(`/users/${id}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword },
      }),
  });
}
