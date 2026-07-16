import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Backpack,
  CircleCheck,
  Cog,
  Cylinder,
  OctagonAlert,
  Package,
  TriangleAlert,
  VenetianMask,
} from 'lucide-react';
import { useDashboardAlerts } from '../api/dashboard';
import { CounterChip } from '../components/CounterChip';
import { ListRow } from '../components/ListRow';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, SkeletonRows } from '../components/states';
import { conditionToUi } from '../lib/status';
import { formatDate } from '../lib/formatters';
import type { AlertEntityType, ConditionStatus, DashboardAlertItem } from '../api/types';

const ENTITY_ROUTE: Record<AlertEntityType, string> = {
  apparatus: '/apparatus',
  cylinder: '/cylinders',
  backplate: '/backplates',
  mask: '/masks',
  compressor: '/compressors',
};

const ENTITY_ICON: Record<AlertEntityType, typeof Package> = {
  apparatus: Package,
  cylinder: Cylinder,
  backplate: Backpack,
  mask: VenetianMask,
  compressor: Cog,
};

function AlertRow({ item }: { item: DashboardAlertItem }) {
  const navigate = useNavigate();
  const Icon = ENTITY_ICON[item.entity_type];
  const meta = item.due_at ? `${item.subtitle} · ${formatDate(item.due_at)}` : item.subtitle;
  return (
    <ListRow
      status={conditionToUi(item.status)}
      icon={<Icon size={24} />}
      title={item.title}
      meta={meta}
      badge={<StatusBadge status={conditionToUi(item.status)} label={item.reason} />}
      onClick={() => navigate(`${ENTITY_ROUTE[item.entity_type]}/${item.entity_id}`)}
    />
  );
}

export function MainBoardPage() {
  const [selected, setSelected] = useState<ConditionStatus[]>(['overdue', 'warning']);
  const query = useDashboardAlerts(selected);

  const toggle = (s: ConditionStatus) => {
    setSelected((prev) => {
      if (prev.includes(s)) {
        if (prev.length === 1) return prev; // хоч один фільтр активний
        return prev.filter((x) => x !== s);
      }
      return [...prev, s];
    });
  };

  const counters = query.data?.counters;
  const items = query.data?.data ?? [];
  const overdueItems = items.filter((i) => i.status === 'overdue');
  const warningItems = items.filter((i) => i.status === 'warning');
  const okItems = items.filter((i) => i.status === 'ok');
  const allClear = counters && counters.overdue === 0 && counters.warning === 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Потребує уваги</h1>
      </div>

      {query.isLoading ? (
        <SkeletonRows count={3} chip />
      ) : (
        <div className="chips-row">
          <CounterChip
            kind="danger"
            count={counters?.overdue}
            active={selected.includes('overdue')}
            onClick={() => toggle('overdue')}
          />
          <CounterChip
            kind="warning"
            count={counters?.warning}
            active={selected.includes('warning')}
            onClick={() => toggle('warning')}
          />
          <CounterChip
            kind="ok"
            count={counters?.ok}
            active={selected.includes('ok')}
            onClick={() => toggle('ok')}
          />
        </div>
      )}

      {query.isLoading && <SkeletonRows count={6} />}
      {query.isError && <ErrorState onRetry={() => query.refetch()} />}

      {query.isSuccess && allClear && !selected.includes('ok') && (
        <EmptyState
          icon={<CircleCheck size={64} color="var(--status-ok-accent)" />}
          title="Все обладнання в нормі"
        />
      )}

      {query.isSuccess && overdueItems.length > 0 && (
        <>
          <h2 className="section-title section-title--danger">
            <OctagonAlert size={22} aria-hidden="true" />
            ПРОСТРОЧЕНО ({overdueItems.length})
          </h2>
          <div className="list">
            {overdueItems.map((i) => (
              <AlertRow key={`${i.entity_type}-${i.entity_id}`} item={i} />
            ))}
          </div>
        </>
      )}

      {query.isSuccess && warningItems.length > 0 && (
        <>
          <h2 className="section-title section-title--warning">
            <TriangleAlert size={22} aria-hidden="true" />
            УВАГА ({warningItems.length})
          </h2>
          <div className="list">
            {warningItems.map((i) => (
              <AlertRow key={`${i.entity_type}-${i.entity_id}`} item={i} />
            ))}
          </div>
        </>
      )}

      {query.isSuccess && selected.includes('ok') && okItems.length > 0 && (
        <>
          <h2 className="section-title">
            <CircleCheck size={22} aria-hidden="true" />
            У НОРМІ ({okItems.length})
          </h2>
          <div className="list">
            {okItems.map((i) => (
              <AlertRow key={`${i.entity_type}-${i.entity_id}`} item={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
