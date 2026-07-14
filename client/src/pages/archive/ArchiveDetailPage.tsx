import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Backpack, Cylinder as CylinderIcon, Droplets, Wind } from 'lucide-react';
import { useArchiveDetail } from '../../api/archive';
import type {
  ArchivedBackplateSnapshot,
  ArchivedCylinderSnapshot,
} from '../../api/types';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { ErrorState, SkeletonRows } from '../../components/states';
import { formatDate, formatDateTime, MATERIAL_LABEL } from '../../lib/formatters';

function isCylinderSnapshot(
  s: ArchivedCylinderSnapshot | ArchivedBackplateSnapshot,
): s is ArchivedCylinderSnapshot {
  return 'cylinder' in s;
}

export function ArchiveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useArchiveDetail(id);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const entry = query.data;
  const { snapshot } = entry;

  return (
    <div className="page">
      <Link to="/archive" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Архів
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          {entry.entity_type === 'cylinder' ? (
            <CylinderIcon size={28} aria-hidden="true" />
          ) : (
            <Backpack size={28} aria-hidden="true" />
          )}
          {entry.label}
        </span>
        <span className="badge badge--md badge--archived">Видалено</span>
      </div>

      <div className="card">
        <div className="card__title">Видалення</div>
        <dl className="kv">
          <dt>Коли</dt>
          <dd className="tnum">{formatDateTime(entry.deleted_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Ким</dt>
          <dd>{entry.deleted_by?.full_name ?? '—'}</dd>
        </dl>
      </div>

      {isCylinderSnapshot(snapshot) ? (
        <CylinderSnapshotView snapshot={snapshot} />
      ) : (
        <BackplateSnapshotView snapshot={snapshot} />
      )}
    </div>
  );
}

function CylinderSnapshotView({ snapshot }: { snapshot: ArchivedCylinderSnapshot }) {
  const c = snapshot.cylinder;
  return (
    <>
      <div className="card">
        <div className="card__title">Дані на момент видалення</div>
        <dl className="kv">
          <dt>Об’єм / матеріал</dt>
          <dd>
            {c.volume_l} л · {MATERIAL_LABEL[c.material] ?? c.material} · {c.working_pressure_bar} бар
          </dd>
        </dl>
        <dl className="kv">
          <dt>Виробник</dt>
          <dd>{c.manufacturer ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Виготовлено</dt>
          <dd className="tnum">{formatDate(c.manufactured_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Строк служби до</dt>
          <dd className="tnum">{formatDate(c.end_of_life_at)}</dd>
        </dl>
        {c.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{c.notes}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <Droplets size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Гідротести
        </div>
        <HistoryTimeline
          emptyText="Гідротестів не було"
          items={snapshot.hydro_tests.map((t) => ({
            id: t.id,
            date: formatDate(t.tested_at),
            icon: <Droplets size={20} />,
            title: 'Гідротест',
            details: [t.performed_by?.full_name, t.notes].filter(Boolean).join(' · ') || undefined,
          }))}
        />
      </div>

      <div className="card">
        <div className="card__title">Установки в апарати</div>
        <HistoryTimeline
          emptyText="Не встановлювався в апарати"
          items={snapshot.installations.map((i) => ({
            id: i.id,
            date: formatDate(i.installed_at),
            title: i.apparatus ? `Апарат ${i.apparatus.name} · позиція ${i.position}` : `Апарат видалено · позиція ${i.position}`,
            details:
              [
                `встановив ${i.installed_by ?? '—'}`,
                i.removed_at
                  ? `знято ${formatDate(i.removed_at)} (${i.removed_by ?? '—'})`
                  : 'досі встановлено на момент видалення',
              ].join(' · '),
          }))}
        />
      </div>

      <div className="card">
        <div className="card__title">
          <Wind size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Сесії заправки
        </div>
        <HistoryTimeline
          emptyText="Участі в заправках не було"
          items={snapshot.fill_sessions.map((s) => ({
            id: s.fill_session_id,
            date: formatDate(s.started_at),
            title: `Компресор ${s.compressor_name}`,
            details: `${s.pressure_before_bar}→${s.pressure_target_bar} бар${s.ended_at ? '' : ' · сесія не була завершена'}`,
          }))}
        />
      </div>
    </>
  );
}

function BackplateSnapshotView({ snapshot }: { snapshot: ArchivedBackplateSnapshot }) {
  const b = snapshot.backplate;
  return (
    <>
      <div className="card">
        <div className="card__title">Дані на момент видалення</div>
        <dl className="kv">
          <dt>Виробник / модель</dt>
          <dd>{[b.manufacturer, b.model].filter(Boolean).join(' ') || '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Серійний номер</dt>
          <dd>{b.serial_number ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Введено в експлуатацію</dt>
          <dd className="tnum">{formatDate(b.commissioned_at)}</dd>
        </dl>
        {b.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{b.notes}</dd>
          </dl>
        )}
      </div>

      {snapshot.apparatuses.length === 0 && (
        <div className="card">
          <div className="card__title">Апарати</div>
          <p className="field__hint">Цей ложамент ніколи не входив до складу апарата.</p>
        </div>
      )}

      {snapshot.apparatuses.map((a) => (
        <div className="card" key={a.id}>
          <div className="card__title">
            Апарат {formatDate(a.created_at)}
            {a.archived_at ? ' · списаний' : ''}
          </div>
          {a.storage_location && (
            <dl className="kv">
              <dt>Місце зберігання</dt>
              <dd>{a.storage_location}</dd>
            </dl>
          )}
          {a.notes && (
            <dl className="kv">
              <dt>Примітки</dt>
              <dd>{a.notes}</dd>
            </dl>
          )}

          <div className="card__title" style={{ marginTop: 12 }}>Склад балонів</div>
          <HistoryTimeline
            emptyText="Балони не встановлювались"
            items={a.cylinder_installations.map((i) => ({
              id: i.id,
              date: formatDate(i.installed_at),
              title: i.cylinder
                ? `Балон №${i.cylinder.number} · позиція ${i.position}`
                : `Балон видалено · позиція ${i.position}`,
              details:
                [
                  `встановив ${i.installed_by ?? '—'}`,
                  i.removed_at
                    ? `знято ${formatDate(i.removed_at)} (${i.removed_by ?? '—'})`
                    : 'досі встановлено на момент видалення',
                ].join(' · '),
            }))}
          />

          <div className="card__title" style={{ marginTop: 12 }}>Сесії заправки</div>
          <HistoryTimeline
            emptyText="Участі в заправках не було"
            items={a.fill_sessions.map((s) => ({
              id: s.fill_session_id,
              date: formatDate(s.started_at),
              title: `Компресор ${s.compressor_name}`,
              details: `${s.pressure_before_bar}→${s.pressure_target_bar} бар${s.ended_at ? '' : ' · сесія не була завершена'}`,
            }))}
          />
        </div>
      ))}
    </>
  );
}
