// Admin: користувачі (screens.md §7)
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, UserRound } from 'lucide-react';
import { useUsers } from '../../api/users';
import type { UserListFilters } from '../../api/users';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import type { Role, User } from '../../api/types';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  master: 'Майстер',
  duty: 'Черговий',
};

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'admin', label: 'Admin' },
  { key: 'master', label: 'Майстри' },
  { key: 'duty', label: 'Чергові' },
  { key: 'inactive', label: 'Деактивовані' },
];

function chipToFilters(chip: string): UserListFilters {
  switch (chip) {
    case 'admin':
    case 'master':
    case 'duty':
      return { role: chip };
    case 'inactive':
      return { is_active: false };
    default:
      return {};
  }
}

function userMeta(u: User): string {
  return [u.login, u.station?.name ?? 'всі станції'].join(' · ');
}

export function UsersPage() {
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(
    () => ({ ...chipToFilters(chip), q: q.trim() || undefined }),
    [chip, q],
  );
  const query = useUsers(filters);

  const items = query.data?.data ?? [];
  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Користувачі{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        <Link to="/admin/users/new" className="btn btn--primary">
          <Plus size={20} aria-hidden="true" />
          Користувач
        </Link>
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за ПІБ або логіном" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<UserRound size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Користувачів поки немає'}
          action={
            hasFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setChip('all');
                  setQ('');
                }}
              >
                Скинути фільтри
              </Button>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((u) => (
            <ListRow
              key={u.id}
              status={u.is_active ? 'neutral' : 'archived'}
              icon={<UserRound size={24} />}
              title={u.full_name}
              meta={userMeta(u)}
              badge={
                u.is_active ? (
                  <span className="badge badge--neutral">{ROLE_LABEL[u.role]}</span>
                ) : (
                  <StatusBadge status="archived" label={`${ROLE_LABEL[u.role]} · деактивований`} />
                )
              }
              strike={!u.is_active}
              to={`/admin/users/${u.id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
