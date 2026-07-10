import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Cylinder as CylinderIcon, Droplets } from 'lucide-react';
import {
  useArchiveCylinder,
  useCylinder,
  useHydroTests,
  useRestoreCylinder,
  useSetHydroOverride,
} from '../../api/cylinders';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { DateInput, Field } from '../../components/Field';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { ErrorState, SkeletonRows } from '../../components/states';
import { HydroTestDialog } from './HydroTestDialog';
import { cylinderBadge } from '../../lib/status';
import { formatDate, MATERIAL_LABEL } from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';

export function CylinderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useCylinder(id);
  const tests = useHydroTests(id);
  const archiveMut = useArchiveCylinder(id ?? '');
  const restoreMut = useRestoreCylinder(id ?? '');
  const overrideMut = useSetHydroOverride(id ?? '');

  const [hydroOpen, setHydroOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState('');

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const c = query.data;
  const badge = cylinderBadge(c);
  const archived = Boolean(c.archived_at);

  const doArchive = () => {
    archiveMut.mutate(undefined, {
      onSuccess: () => {
        toast.show(`Балон №${c.number} списано`);
        setArchiveOpen(false);
      },
      onError: (err) => {
        toast.show(errorMessage(err), 'error');
        setArchiveOpen(false);
      },
    });
  };

  const saveOverride = (date: string | null) => {
    overrideMut.mutate(date, {
      onSuccess: () => {
        toast.show(date ? 'Дату наступного гідротесту змінено' : 'Повернено авторозрахунок');
        setOverrideOpen(false);
      },
      onError: (err) => toast.show(errorMessage(err), 'error'),
    });
  };

  return (
    <div className="page">
      <Link to="/cylinders" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Балони
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          <CylinderIcon size={28} aria-hidden="true" />
          №{c.number}
        </span>
        <StatusBadge status={badge.status} label={badge.label} size="md" />
      </div>

      <div className="card">
        <div className="card__title">
          <Droplets size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Гідротест
        </div>
        <dl className="kv">
          <dt>Останній</dt>
          <dd className="tnum">{formatDate(c.last_hydro_test_at)}</dd>
        </dl>
        <dl className="kv">
          <dt>Наступний</dt>
          <dd className="tnum">
            {formatDate(c.next_hydro_test_at)}
            {c.next_hydro_test_override ? ' (вручну)' : ''}
          </dd>
        </dl>
        <dl className="kv">
          <dt>Інтервал</dt>
          <dd>
            {c.hydro_interval_months} міс ({MATERIAL_LABEL[c.material] ?? c.material})
          </dd>
        </dl>
        {canEdit && !archived && (
          <div className="btn-row">
            <Button onClick={() => setHydroOpen(true)}>Зафіксувати гідротест</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOverrideDate(c.next_hydro_test_override ?? c.next_hydro_test_at ?? '');
                setOverrideOpen(true);
              }}
            >
              Змінити дату вручну
            </Button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__title">Дані</div>
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
        <dl className="kv">
          <dt>Розташування</dt>
          <dd>
            {c.installation ? (
              <Link to={`/apparatus/${c.installation.apparatus_id}`}>
                в апараті {c.installation.apparatus_name}
              </Link>
            ) : (
              'вільний'
            )}
          </dd>
        </dl>
        {c.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{c.notes}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__title">Історія гідротестів</div>
        <HistoryTimeline
          loading={tests.isLoading}
          emptyText="Історія порожня"
          items={tests.data?.data.map((t) => ({
            id: t.id,
            date: formatDate(t.tested_at),
            icon: <Droplets size={20} />,
            title: 'Гідротест',
            details: [t.performed_by?.full_name, t.notes].filter(Boolean).join(' · ') || undefined,
          }))}
        />
      </div>

      {canEdit && (
        <div className="btn-row">
          {!archived && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/cylinders/${c.id}/edit`)}>
                Редагувати
              </Button>
              <Button variant="danger" onClick={() => setArchiveOpen(true)}>
                Списати
              </Button>
            </>
          )}
          {archived && (
            <Button
              variant="secondary"
              loading={restoreMut.isPending}
              onClick={() =>
                restoreMut.mutate(undefined, {
                  onSuccess: () => toast.show(`Балон №${c.number} відновлено`),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
        </div>
      )}

      {hydroOpen && <HydroTestDialog cylinder={c} onClose={() => setHydroOpen(false)} />}

      {archiveOpen && (
        <ConfirmDialog
          title={`Списати балон №${c.number}?`}
          confirmLabel="Списати"
          danger
          loading={archiveMut.isPending}
          onConfirm={doArchive}
          onCancel={() => setArchiveOpen(false)}
        >
          <p>
            Балон буде переміщено в архів зі збереженням історії. Якщо балон стоїть в апараті —
            спочатку зніміть його.
          </p>
        </ConfirmDialog>
      )}

      {overrideOpen && (
        <Modal
          title="Наступний гідротест — вручну"
          onClose={() => setOverrideOpen(false)}
          footer={
            <>
              {c.next_hydro_test_override && (
                <Button
                  variant="secondary"
                  onClick={() => saveOverride(null)}
                  loading={overrideMut.isPending}
                >
                  Повернути авторозрахунок
                </Button>
              )}
              <Button
                onClick={() => overrideDate && saveOverride(overrideDate)}
                loading={overrideMut.isPending}
                disabled={!overrideDate}
              >
                Зберегти
              </Button>
            </>
          }
        >
          <Field label="Дата наступного гідротесту" required>
            <DateInput value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
