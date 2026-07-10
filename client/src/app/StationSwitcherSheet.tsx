import { Building2 } from 'lucide-react';
import { useStations } from '../api/stations';
import { useAuth } from '../auth/AuthContext';
import { SelectSheet } from '../components/SelectSheet';
import { ListRow } from '../components/ListRow';
import { EmptyState, ErrorState, SkeletonRows } from '../components/states';
import type { SheetRow } from '../components/SelectSheet';

function stationMeta(overdue: number, warning: number): string {
  return `Прострочено: ${overdue} · Увага: ${warning}`;
}

/** Перемикач станції (admin): модалка зі списком станцій + міні-лічильники */
export function StationSwitcherSheet({ onClose }: { onClose: () => void }) {
  const { setActiveStation } = useAuth();
  const query = useStations();

  const rows: SheetRow[] = (query.data?.data ?? [])
    .filter((s) => !s.archived_at)
    .map((s) => ({
      id: s.id,
      title: s.name,
      meta: stationMeta(s.alert_counters.overdue, s.alert_counters.warning),
      status: s.alert_counters.overdue > 0 ? 'danger' : s.alert_counters.warning > 0 ? 'warning' : 'ok',
      icon: <Building2 size={24} />,
    }));

  return (
    <SelectSheet
      title="Оберіть станцію"
      rows={rows}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => query.refetch()}
      emptyText="Станцій поки немає"
      searchPlaceholder="Пошук станції"
      onSelect={(id) => {
        const station = query.data?.data.find((s) => s.id === id);
        if (station) setActiveStation({ id: station.id, name: station.name });
        onClose();
      }}
      onClose={onClose}
    />
  );
}

/** Повноекранний вибір станції — коли admin ще не обрав активну */
export function StationPickInline() {
  const { setActiveStation } = useAuth();
  const query = useStations();

  if (query.isLoading) return <SkeletonRows count={4} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const stations = (query.data?.data ?? []).filter((s) => !s.archived_at);
  if (stations.length === 0) return <EmptyState title="Станцій поки немає" />;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Оберіть станцію</h1>
      </div>
      <div className="list">
        {stations.map((s) => (
          <ListRow
            key={s.id}
            status={s.alert_counters.overdue > 0 ? 'danger' : s.alert_counters.warning > 0 ? 'warning' : 'ok'}
            icon={<Building2 size={24} />}
            title={s.name}
            meta={stationMeta(s.alert_counters.overdue, s.alert_counters.warning)}
            onClick={() => setActiveStation({ id: s.id, name: s.name })}
          />
        ))}
      </div>
    </div>
  );
}
