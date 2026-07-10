import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Backpack, Cylinder as CylinderIcon, Package, Plus, RefreshCw } from 'lucide-react';
import {
  useApparatus,
  useApparatusCylinderHistory,
  useArchiveApparatus,
  useDisassembleApparatus,
  useInstallCylinder,
  useRemoveCylinder,
  useRestoreApparatus,
} from '../../api/apparatus';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListRow } from '../../components/ListRow';
import { HistoryTimeline } from '../../components/HistoryTimeline';
import { ErrorState, SkeletonRows } from '../../components/states';
import { CylinderPicker } from './ComponentPicker';
import { apparatusBadge, conditionBadge } from '../../lib/status';
import { formatDate } from '../../lib/formatters';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';
import type { ApparatusCylinderSlot } from '../../api/types';

const POSITIONS = [1, 2] as const;

export function ApparatusDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const query = useApparatus(id);
  const history = useApparatusCylinderHistory(id);
  const installMut = useInstallCylinder(id ?? '');
  const removeMut = useRemoveCylinder(id ?? '');
  const disassembleMut = useDisassembleApparatus(id ?? '');
  const archiveMut = useArchiveApparatus(id ?? '');
  const restoreMut = useRestoreApparatus(id ?? '');

  const [pickerPosition, setPickerPosition] = useState<number | null>(null);
  const [disassembleOpen, setDisassembleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const a = query.data;
  const badge = apparatusBadge(a);
  const archived = Boolean(a.archived_at);
  const slotByPosition = new Map<number, ApparatusCylinderSlot>(
    a.cylinders.map((s) => [s.position, s]),
  );

  const removeCylinder = (slot: ApparatusCylinderSlot) => {
    removeMut.mutate(slot.position, {
      onSuccess: () => toast.show(`Балон №${slot.cylinder.number} знято`),
      onError: (err) => toast.show(errorMessage(err), 'error'),
    });
  };

  const installCylinder = (cylinderId: string, cylinderNumber: string, position: number) => {
    installMut.mutate(
      { cylinder_id: cylinderId, position },
      {
        onSuccess: () => toast.show(`Балон №${cylinderNumber} встановлено (позиція ${position})`),
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  const backplateBadgeProps = conditionBadge(a.backplate.condition);
  const cylinderNumbers = a.cylinders.map((s) => `№${s.cylinder.number}`).join(', ');

  return (
    <div className="page">
      <Link to="/apparatus" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Апарати
      </Link>

      <div className="detail-head">
        <span className="detail-head__title">
          <Package size={28} aria-hidden="true" />
          {a.name}
        </span>
        <StatusBadge status={badge.status} label={badge.label} size="md" />
      </div>

      <div className="card">
        <div className="card__title">Компоненти</div>
        <div className="list">
          <ListRow
            status={backplateBadgeProps.status}
            icon={<Backpack size={24} />}
            title={`Ложамент ${a.backplate.name}`}
            meta={a.backplate.model ?? undefined}
            badge={<StatusBadge status={backplateBadgeProps.status} label={backplateBadgeProps.label} />}
            to={`/backplates/${a.backplate.id}`}
          />
          {POSITIONS.map((position) => {
            const slot = slotByPosition.get(position);
            if (!slot) return null;
            const cylBadge = conditionBadge(slot.cylinder.condition);
            return (
              <ListRow
                key={position}
                status={cylBadge.status}
                icon={<CylinderIcon size={24} />}
                title={`Балон №${slot.cylinder.number}`}
                meta={`позиція ${position} · встановлено ${formatDate(slot.installed_at)}`}
                badge={<StatusBadge status={cylBadge.status} label={cylBadge.label} />}
                to={`/cylinders/${slot.cylinder.id}`}
                trailing={
                  canEdit && !archived ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={removeMut.isPending}
                      onClick={() => removeCylinder(slot)}
                    >
                      Зняти
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
        {a.cylinders_installed === 0 && (
          <p className="field__hint">Апарат розібраний — балони не встановлені.</p>
        )}
        {canEdit && !archived && (
          <div className="btn-row">
            {POSITIONS.filter((p) => !slotByPosition.has(p)).map((position) => (
              <Button
                key={position}
                variant="secondary"
                onClick={() => setPickerPosition(position)}
              >
                <Plus size={20} aria-hidden="true" />
                Встановити балон (позиція {position})
              </Button>
            ))}
            {a.cylinders_installed > 0 && (
              <Button variant="danger" onClick={() => setDisassembleOpen(true)}>
                Розібрати апарат
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__title">Дані</div>
        <dl className="kv">
          <dt>Місце зберігання</dt>
          <dd>{a.storage_location?.name ?? '—'}</dd>
        </dl>
        <dl className="kv">
          <dt>Створено</dt>
          <dd className="tnum">{formatDate(a.created_at)}</dd>
        </dl>
        {a.notes && (
          <dl className="kv">
            <dt>Примітки</dt>
            <dd>{a.notes}</dd>
          </dl>
        )}
      </div>

      <div className="card">
        <div className="card__title">
          <RefreshCw size={18} aria-hidden="true" style={{ verticalAlign: '-3px' }} /> Історія замін
          балонів
        </div>
        <HistoryTimeline
          loading={history.isLoading}
          emptyText="Замін поки не було"
          items={history.data?.data.map((h) => ({
            id: h.id,
            date: formatDate(h.installed_at),
            icon: <CylinderIcon size={20} />,
            title: `Встановлено №${h.cylinder.number} (позиція ${h.position})`,
            details:
              [
                h.installed_by?.full_name,
                h.removed_at
                  ? `знято ${formatDate(h.removed_at)}${h.removed_by ? ` · ${h.removed_by.full_name}` : ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined,
          }))}
        />
      </div>

      {canEdit && (
        <div className="btn-row">
          {!archived && (
            <>
              <Button variant="secondary" onClick={() => navigate(`/apparatus/${a.id}/edit`)}>
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
                  onSuccess: () => toast.show(`Апарат ${a.name} відновлено`),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
        </div>
      )}

      {pickerPosition !== null && (
        <CylinderPicker
          title={`Балон на позицію ${pickerPosition}`}
          excludeIds={a.cylinders.map((s) => s.cylinder.id)}
          onSelect={(c) => {
            installCylinder(c.id, c.number, pickerPosition);
            setPickerPosition(null);
          }}
          onClose={() => setPickerPosition(null)}
        />
      )}

      {disassembleOpen && (
        <ConfirmDialog
          title={`Розібрати апарат ${a.name}?`}
          confirmLabel="Розібрати"
          danger
          loading={disassembleMut.isPending}
          onConfirm={() =>
            disassembleMut.mutate(undefined, {
              onSuccess: () => {
                toast.show(`Апарат ${a.name} розібрано`);
                setDisassembleOpen(false);
              },
              onError: (err) => {
                toast.show(errorMessage(err), 'error');
                setDisassembleOpen(false);
              },
            })
          }
          onCancel={() => setDisassembleOpen(false)}
        >
          <p>
            {cylinderNumbers ? `Балони ${cylinderNumbers} стануть вільними. ` : ''}
            Апарат залишиться в списку зі статусом «Розібраний».
          </p>
        </ConfirmDialog>
      )}

      {archiveOpen && (
        <ConfirmDialog
          title={`Списати апарат ${a.name}?`}
          confirmLabel="Списати"
          danger
          loading={archiveMut.isPending}
          onConfirm={() =>
            archiveMut.mutate(undefined, {
              onSuccess: () => {
                toast.show(`Апарат ${a.name} списано`);
                setArchiveOpen(false);
              },
              onError: (err) => {
                toast.show(errorMessage(err), 'error');
                setArchiveOpen(false);
              },
            })
          }
          onCancel={() => setArchiveOpen(false)}
        >
          <p>
            Апарат буде переміщено в архів зі збереженням історії. Ложамент стане вільним. Якщо в
            апараті стоять балони — спочатку зніміть їх.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
