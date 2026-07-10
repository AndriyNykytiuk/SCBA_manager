// Флоу сесії заправки (screens.md §6): 1 Компресор → 2 Що заправляємо → 3 Тиски → СТАРТ
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Cog,
  Cylinder as CylinderIcon,
  Keyboard,
  Package,
  Plus,
  QrCode,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCompressors } from '../../api/compressors';
import { useApparatusList } from '../../api/apparatus';
import { useStartFillSession } from '../../api/fillSessions';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { BigActionButton } from '../../components/BigActionButton';
import { Field } from '../../components/Field';
import { ListRow } from '../../components/ListRow';
import { NumberStepper } from '../../components/NumberStepper';
import { StatusBadge } from '../../components/StatusBadge';
import { SelectSheet } from '../../components/SelectSheet';
import type { SheetRow } from '../../components/SelectSheet';
import { ProgressToMaintenance } from '../../components/ProgressToMaintenance';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/states';
import { QrScannerSheet } from './QrScannerSheet';
import { CylinderPicker } from '../apparatus/ComponentPicker';
import { apparatusBadge, compressorBadge, cylinderBadge } from '../../lib/status';
import type { BadgeProps } from '../../lib/status';
import { errorMessage } from '../../api/http';
import { useToast } from '../../components/Toast';
import type { Apparatus, Compressor, Cylinder, FillSessionItemBody } from '../../api/types';

interface SessionUnit {
  type: 'apparatus' | 'cylinder';
  id: string;
  name: string;
  badge: BadgeProps;
}

const MAX_TARGET_BAR = 450;

export function FillSessionWizardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuth();
  const preselectedCompressorId = (location.state as { compressorId?: string } | null)
    ?.compressorId;

  const compressorsQuery = useCompressors();
  const apparatusQuery = useApparatusList();
  const startMut = useStartFillSession();

  const [step, setStep] = useState<1 | 2 | 3>(preselectedCompressorId ? 2 : 1);
  const [compressorId, setCompressorId] = useState<string | null>(preselectedCompressorId ?? null);
  const [units, setUnits] = useState<SessionUnit[]>([]);
  const [before, setBefore] = useState<number | null>(180);
  const [target, setTarget] = useState<number | null>(300);
  const [pressureError, setPressureError] = useState<string | null>(null);

  const [qrOpen, setQrOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [cylinderOpen, setCylinderOpen] = useState(false);

  const compressors = useMemo(
    () => (compressorsQuery.data?.data ?? []).filter((c) => !c.archived_at),
    [compressorsQuery.data],
  );
  const compressor: Compressor | undefined = compressors.find((c) => c.id === compressorId);

  const apparatusCount = units.filter((u) => u.type === 'apparatus').length;
  const cylinderCount = units.filter((u) => u.type === 'cylinder').length;

  const addApparatus = (a: Apparatus): boolean => {
    if (units.some((u) => u.type === 'apparatus' && u.id === a.id)) {
      toast.show(`${a.name} вже в сесії`);
      return false;
    }
    if (a.cylinders_installed === 0) {
      toast.show(`${a.name} розібраний — заправляти нічого`, 'error');
      return false;
    }
    const badge = apparatusBadge(a);
    setUnits((prev) => [...prev, { type: 'apparatus', id: a.id, name: a.name, badge }]);
    return true;
  };

  const addCylinder = (c: Cylinder) => {
    if (units.some((u) => u.type === 'cylinder' && u.id === c.id)) {
      toast.show(`Балон №${c.number} вже в сесії`);
      return;
    }
    setUnits((prev) => [
      ...prev,
      { type: 'cylinder', id: c.id, name: `№${c.number} (окремий балон)`, badge: cylinderBadge(c) },
    ]);
  };

  const start = () => {
    const b = before ?? 0;
    const t = target ?? 0;
    if (b <= 0 || t <= 0) {
      setPressureError('Обидва тиски мають бути > 0');
      return;
    }
    if (t <= b) {
      setPressureError('Цільовий тиск має бути більшим за тиск до заправки');
      return;
    }
    if (t > MAX_TARGET_BAR) {
      setPressureError(`Цільовий тиск не більше ${MAX_TARGET_BAR} бар`);
      return;
    }
    setPressureError(null);
    if (!compressorId) return;

    const items: FillSessionItemBody[] = units.map((u) =>
      u.type === 'apparatus' ? { apparatus_id: u.id } : { cylinder_id: u.id },
    );
    startMut.mutate(
      {
        compressor_id: compressorId,
        pressure_before_bar: b,
        pressure_target_bar: t,
        items,
      },
      {
        onSuccess: (session) => navigate(`/fill-session/${session.id}`, { replace: true }),
        onError: (err) => toast.show(errorMessage(err), 'error'),
      },
    );
  };

  const goBack = () => {
    if (step === 1 || (step === 2 && preselectedCompressorId)) navigate(-1);
    else setStep((s) => (s === 3 ? 2 : 1));
  };

  const manualRows: SheetRow[] = useMemo(
    () =>
      (apparatusQuery.data?.data ?? [])
        .filter((a) => !a.archived_at)
        .map((a) => {
          const badge = apparatusBadge(a);
          const inSession = units.some((u) => u.type === 'apparatus' && u.id === a.id);
          const empty = a.cylinders_installed === 0;
          return {
            id: a.id,
            title: a.name,
            meta: `балонів: ${a.cylinders_installed}`,
            badge,
            status: badge.status,
            icon: <Package size={24} />,
            disabled: inSession || empty,
            disabledReason: inSession ? 'Вже в сесії' : empty ? 'Розібраний' : undefined,
          };
        }),
    [apparatusQuery.data, units],
  );

  const stepTitle = step === 1 ? 'Компресор' : step === 2 ? 'Апарати та балони' : 'Тиски на групу';

  return (
    <div className="page">
      <button type="button" className="back-link" onClick={goBack}>
        <ArrowLeft size={20} aria-hidden="true" />
        Назад
      </button>

      <div className="page-header">
        <h1>Заправка</h1>
        <span className="wizard-progress">
          Крок {step} з 3 · {stepTitle}
        </span>
      </div>

      {/* ===== Крок 1: Компресор ===== */}
      {step === 1 && (
        <>
          {compressorsQuery.isLoading && <SkeletonRows count={3} />}
          {compressorsQuery.isError && (
            <ErrorState onRetry={() => compressorsQuery.refetch()} />
          )}
          {compressorsQuery.isSuccess && compressors.length === 0 && (
            <EmptyState
              icon={<Cog size={48} />}
              title="На станції немає компресорів"
              action={
                <Button variant="secondary" onClick={() => navigate('/compressors/new')}>
                  Додати компресор
                </Button>
              }
            />
          )}
          {compressors.map((c) => {
            const badge = compressorBadge(c);
            const busy = Boolean(c.active_fill_session_id);
            return (
              <div className="card" key={c.id}>
                <ListRow
                  status={badge.status}
                  icon={<Cog size={24} />}
                  title={c.name}
                  meta={busy ? 'Іде заправка — зайнятий' : undefined}
                  badge={<StatusBadge status={badge.status} label={badge.label} />}
                  disabled={busy}
                  onClick={
                    busy
                      ? undefined
                      : () => {
                          setCompressorId(c.id);
                          setStep(2);
                        }
                  }
                />
                <ProgressToMaintenance compressor={c} />
              </div>
            );
          })}
        </>
      )}

      {/* ===== Крок 2: Що заправляємо ===== */}
      {step === 2 && (
        <>
          {compressor && compressor.condition.status === 'overdue' && (
            <div className="banner banner--warning banner--rounded" role="alert">
              <TriangleAlert size={20} aria-hidden="true" />
              {`У компресора ${compressor.name}: ${compressor.condition.reason ?? 'прострочене ТО'}. Роботу не блокуємо.`}
            </div>
          )}

          <div className="btn-row">
            <Button size="xl" onClick={() => setQrOpen(true)}>
              <QrCode size={24} aria-hidden="true" />
              Сканувати QR
            </Button>
            <Button size="xl" variant="secondary" onClick={() => setManualOpen(true)}>
              <Keyboard size={24} aria-hidden="true" />
              Ввести номер
            </Button>
          </div>
          <Button variant="secondary" onClick={() => setCylinderOpen(true)}>
            <Plus size={20} aria-hidden="true" />
            Окремий балон (без апарата)
          </Button>

          <div className="card">
            <div className="card__title">Додано ({units.length})</div>
            {units.length === 0 && (
              <p className="field__hint">Відскануйте QR апарата або додайте вручну.</p>
            )}
            {units.length > 0 && (
              <div className="list">
                {units.map((u) => (
                  <ListRow
                    key={`${u.type}-${u.id}`}
                    status={u.badge.status}
                    icon={u.type === 'apparatus' ? <Package size={24} /> : <CylinderIcon size={24} />}
                    title={u.name}
                    badge={<StatusBadge status={u.badge.status} label={u.badge.label} />}
                    trailing={
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Прибрати ${u.name}`}
                        onClick={() =>
                          setUnits((prev) =>
                            prev.filter((x) => !(x.type === u.type && x.id === u.id)),
                          )
                        }
                      >
                        <X size={20} aria-hidden="true" />
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <Button size="xl" block disabled={units.length === 0} onClick={() => setStep(3)}>
            Далі: тиски →
          </Button>
        </>
      )}

      {/* ===== Крок 3: Тиски (один раз на сесію, U-5) ===== */}
      {step === 3 && compressor && (
        <>
          <Field label="Тиск до заправки, бар" error={pressureError ?? undefined}>
            <NumberStepper
              value={before}
              onChange={setBefore}
              step={5}
              min={0}
              max={MAX_TARGET_BAR}
              ariaLabel="Тиск до заправки"
              invalid={Boolean(pressureError)}
            />
          </Field>
          <Field label="Цільовий тиск, бар">
            <NumberStepper
              value={target}
              onChange={setTarget}
              step={5}
              min={0}
              max={MAX_TARGET_BAR}
              presets={[200, 300]}
              ariaLabel="Цільовий тиск"
              invalid={Boolean(pressureError)}
            />
          </Field>

          <p className="field__hint">
            Компресор: {compressor.name} · Апаратів: {apparatusCount}
            {cylinderCount > 0 ? ` · +${cylinderCount} бал.` : ''} · Майстер:{' '}
            {user?.full_name ?? '—'}
          </p>

          <BigActionButton
            variant="start"
            label="СТАРТ"
            loading={startMut.isPending}
            onAction={start}
          />
        </>
      )}

      {qrOpen && (
        <QrScannerSheet
          addedCount={units.length}
          onFound={addApparatus}
          onManual={() => {
            setQrOpen(false);
            setManualOpen(true);
          }}
          onClose={() => setQrOpen(false)}
        />
      )}

      {manualOpen && (
        <SelectSheet
          title="Оберіть апарат"
          rows={manualRows}
          loading={apparatusQuery.isLoading}
          error={apparatusQuery.isError}
          onRetry={() => apparatusQuery.refetch()}
          emptyText="Апаратів не знайдено"
          searchPlaceholder="Номер ложамента, напр. bS-118"
          onSelect={(id) => {
            const a = apparatusQuery.data?.data.find((x) => x.id === id);
            if (a) addApparatus(a);
            setManualOpen(false);
          }}
          onClose={() => setManualOpen(false)}
        />
      )}

      {cylinderOpen && (
        <CylinderPicker
          title="Окремий балон"
          excludeIds={units.filter((u) => u.type === 'cylinder').map((u) => u.id)}
          onSelect={(c) => {
            addCylinder(c);
            setCylinderOpen(false);
          }}
          onClose={() => setCylinderOpen(false)}
        />
      )}
    </div>
  );
}
