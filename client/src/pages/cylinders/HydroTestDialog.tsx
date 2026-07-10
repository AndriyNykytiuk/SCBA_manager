import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea } from '../../components/Field';
import { useCreateHydroTest } from '../../api/cylinders';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../api/http';
import { addMonths, formatDate, todayISO } from '../../lib/formatters';
import type { Cylinder } from '../../api/types';

/** «Зафіксувати гідротест»: дата (дефолт сьогодні) → прев'ю наступної дати → Зберегти */
export function HydroTestDialog({ cylinder, onClose }: { cylinder: Cylinder; onClose: () => void }) {
  const [testedAt, setTestedAt] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateHydroTest(cylinder.id);
  const toast = useToast();

  const preview = testedAt ? addMonths(testedAt, cylinder.hydro_interval_months) : '';

  const submit = () => {
    if (!testedAt) {
      setError('Вкажіть дату гідротесту');
      return;
    }
    if (testedAt > todayISO()) {
      setError('Дата не може бути в майбутньому');
      return;
    }
    setError(null);
    mutation.mutate(
      { tested_at: testedAt, notes: notes.trim() || null },
      {
        onSuccess: () => {
          toast.show('Гідротест зафіксовано');
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Modal
      title={`Гідротест балона №${cylinder.number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Скасувати
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Зберегти
          </Button>
        </>
      }
    >
      <Field label="Дата гідротесту" required error={error ?? undefined}>
        <DateInput
          value={testedAt}
          max={todayISO()}
          onChange={(e) => setTestedAt(e.target.value)}
          invalid={Boolean(error)}
        />
      </Field>
      <Field label="Примітки" hint="Напр., лабораторія та номер протоколу">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      {preview && (
        <p className="field__hint">
          Наступний гідротест: <strong>{formatDate(preview)}</strong> (інтервал{' '}
          {cylinder.hydro_interval_months} міс). Ручне коригування дати скидається — за потреби
          встановіть нове з картки балона.
        </p>
      )}
    </Modal>
  );
}
