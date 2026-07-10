// Admin: станції — список з міні-лічильниками ⬣/⚠ (screens.md §7)
import { Link } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { useStations } from '../../api/stations';
import { ListRow } from '../../components/ListRow';
import { Button } from '../../components/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import type { Station } from '../../api/types';
import type { UiStatus } from '../../lib/status';

function stationStatus(s: Station): UiStatus {
  if (s.archived_at) return 'archived';
  if (s.alert_counters.overdue > 0) return 'danger';
  if (s.alert_counters.warning > 0) return 'warning';
  return 'ok';
}

function stationMeta(s: Station): string {
  const parts = [
    s.address,
    `Прострочено: ${s.alert_counters.overdue} · Увага: ${s.alert_counters.warning}`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function StationsPage() {
  const query = useStations();
  const items = query.data?.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Станції{query.data ? ` (${query.data.meta.total})` : ''}</h1>
        <Link to="/admin/stations/new" className="btn btn--primary">
          <Plus size={20} aria-hidden="true" />
          Станція
        </Link>
      </div>

      {query.isLoading && <SkeletonRows />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Building2 size={48} />}
          title="Станцій поки немає"
          action={
            <Link to="/admin/stations/new" className="btn btn--primary">
              <Plus size={20} aria-hidden="true" />
              Додати станцію
            </Link>
          }
        />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="list">
          {items.map((s) => (
            <ListRow
              key={s.id}
              status={stationStatus(s)}
              icon={<Building2 size={24} />}
              title={s.name}
              meta={stationMeta(s)}
              strike={Boolean(s.archived_at)}
              to={`/admin/stations/${s.id}`}
            />
          ))}
        </div>
      )}

      {query.isSuccess && (
        <p className="field__hint">
          Перемикання активної станції — через селектор у хедері.{' '}
          <Button variant="ghost" size="sm" onClick={() => query.refetch()}>
            Оновити лічильники
          </Button>
        </p>
      )}
    </div>
  );
}
