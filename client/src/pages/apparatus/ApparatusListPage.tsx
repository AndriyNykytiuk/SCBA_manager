import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Plus } from 'lucide-react';
import { useApparatusList } from '../../api/apparatus';
import type { ApparatusListFilters } from '../../api/apparatus';
import { useAuth } from '../../auth/AuthContext';
import { ListRow } from '../../components/ListRow';
import { StatusBadge } from '../../components/StatusBadge';
import { FilterChips } from '../../components/FilterChips';
import { SearchInput } from '../../components/SearchInput';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { apparatusBadge } from '../../lib/status';
import type { Apparatus } from '../../api/types';

const CHIPS = [
  { key: 'all', label: 'Всі' },
  { key: 'overdue', label: 'Несправні' },
  { key: 'warning', label: 'Увага' },
  { key: 'ok', label: 'Справні' },
  { key: 'disassembled', label: 'Розібрані' },
  { key: 'archived', label: 'Списані' },
];

function chipToFilters(chip: string): ApparatusListFilters {
  switch (chip) {
    case 'overdue':
      return { status: 'overdue' };
    case 'warning':
      return { status: 'warning' };
    case 'ok':
      return { status: 'ok', assembled: true };
    case 'disassembled':
      return { assembled: false };
    case 'archived':
      return { include_archived: true };
    default:
      return {};
  }
}

function apparatusMeta(a: Apparatus): string {
  const parts = [
    a.backplate.model,
    `балонів: ${a.cylinders_installed}`,
    a.storage_location?.name ?? null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function ApparatusListPage() {
  const { canEdit } = useAuth();
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const filters = useMemo(
    () => ({ ...chipToFilters(chip), q: q.trim() || undefined }),
    [chip, q],
  );
  const query = useApparatusList(filters);

  let items = query.data?.data ?? [];
  if (chip === 'archived') items = items.filter((a) => a.archived_at !== null);

  const hasFilter = chip !== 'all' || q.trim() !== '';

  return (
    <div className="page">
      <div className="page-header">
        <h1>Апарати{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        {canEdit && (
          <Link to="/apparatus/new" className="btn btn--primary">
            <Plus size={20} aria-hidden="true" />
            Зібрати апарат
          </Link>
        )}
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Пошук за номером ложамента" />
      <FilterChips options={CHIPS} active={chip} onChange={setChip} />

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Package size={48} />}
          title={hasFilter ? 'Нічого не знайдено за фільтром' : 'Апаратів поки немає'}
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
            ) : canEdit ? (
              <Link to="/apparatus/new" className="btn btn--primary">
                <Plus size={20} aria-hidden="true" />
                Зібрати апарат
              </Link>
            ) : undefined
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((a) => {
            const badge = apparatusBadge(a);
            return (
              <ListRow
                key={a.id}
                status={badge.status}
                icon={<Package size={24} />}
                title={a.name}
                meta={apparatusMeta(a)}
                badge={<StatusBadge status={badge.status} label={badge.label} />}
                strike={Boolean(a.archived_at)}
                to={`/apparatus/${a.id}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
