// Модалка «Провести ТО» (screens.md §4.4)
import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DateInput, Field, TextInput } from '../../components/Field';
import { SegmentControl } from '../../components/SegmentControl';
import { NumberStepper } from '../../components/NumberStepper';
import { useCreateMaintenance } from '../../api/compressors';
import { useAuth } from '../../auth/AuthContext';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../api/http';
import { formatEngineHours, todayISO } from '../../lib/formatters';
import type { Compressor } from '../../api/types';

const LEVELS = [25, 125, 500, 1000, 2000];

export function MaintenanceDialog({
  compressor,
  onClose,
}: {
  compressor: Compressor;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const mutation = useCreateMaintenance(compressor.id);

  const suggested = compressor.maintenance.suggested_level;
  const [level, setLevel] = useState<number | null>(suggested);
  const [performedAt, setPerformedAt] = useState(todayISO());
  const [engineHours, setEngineHours] = useState<number | null>(compressor.engine_hours);
  const [performer, setPerformer] = useState(user?.full_name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!level) e.level = 'Оберіть рівень ТО';
    if (!performedAt) e.performed_at = 'Вкажіть дату';
    else if (performedAt > todayISO()) e.performed_at = 'Дата не може бути в майбутньому';
    if (engineHours === null || engineHours < 0) {
      e.engine_hours_at = 'Наробіток має бути ≥ 0';
    } else if (engineHours > compressor.engine_hours) {
      e.engine_hours_at = `Не більше поточного наробітку (${formatEngineHours(compressor.engine_hours)} мг)`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = () => {
    mutation.mutate(
      {
        level: level ?? 0,
        performed_at: performedAt,
        engine_hours_at: engineHours ?? undefined,
        notes: performer.trim() ? `Виконав: ${performer.trim()}` : null,
      },
      {
        onSuccess: () => {
          toast.show(`ТО-${level} зафіксовано`);
          setConfirmOpen(false);
          onClose();
        },
        onError: (err) => {
          toast.show(errorMessage(err), 'error');
          setConfirmOpen(false);
        },
      },
    );
  };

  if (confirmOpen) {
    return (
      <ConfirmDialog
        title={`Зафіксувати ТО-${level}?`}
        confirmLabel="Зафіксувати ТО"
        loading={mutation.isPending}
        onConfirm={save}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>
          Подія буде додана в історію компресора {compressor.name}. Прогрес до наступного ТО буде
          перераховано.
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Modal
      title={`Провести ТО · ${compressor.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            onClick={() => {
              if (validate()) setConfirmOpen(true);
            }}
          >
            Зафіксувати ТО
          </Button>
        </>
      }
    >
      <Field
        label="Рівень ТО"
        required
        error={errors.level}
        hint={suggested ? `Рекомендовано: ТО-${suggested}` : undefined}
      >
        <SegmentControl<number>
          options={LEVELS.map((l) => ({ value: l, label: String(l) }))}
          value={level}
          onChange={setLevel}
          ariaLabel="Рівень ТО"
        />
      </Field>

      <Field label="Дата проведення" required error={errors.performed_at}>
        <DateInput
          value={performedAt}
          max={todayISO()}
          onChange={(e) => setPerformedAt(e.target.value)}
          invalid={Boolean(errors.performed_at)}
        />
      </Field>

      <Field
        label="Наробіток на момент ТО, мг"
        required
        error={errors.engine_hours_at}
        hint={`Поточний наробіток: ${formatEngineHours(compressor.engine_hours)} мг`}
      >
        <NumberStepper
          value={engineHours}
          onChange={setEngineHours}
          step={0.1}
          min={0}
          allowDecimal
          ariaLabel="Наробіток на момент ТО"
          invalid={Boolean(errors.engine_hours_at)}
        />
      </Field>

      <Field label="Виконавець">
        <TextInput value={performer} onChange={(e) => setPerformer(e.target.value)} />
      </Field>
    </Modal>
  );
}
