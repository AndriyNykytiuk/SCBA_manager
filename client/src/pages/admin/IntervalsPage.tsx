// Admin: глобальні інтервали перевірок — єдине місце для всього проекту (усі станції).
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useIntervals, useUpdateIntervals } from '../../api/intervals';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { NumberStepper } from '../../components/NumberStepper';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage } from '../../api/http';
import type { IntervalKey } from '../../api/types';
import { formatDateTime } from '../../lib/formatters';

const ORDER: IntervalKey[] = [
  'hydro_metal',
  'hydro_composite',
  'reducer',
  'membrane',
  'mask_inhale_valve',
  'mask_voice_membrane',
  'mask_inspection',
];

const EMPTY_VALUES: Record<IntervalKey, number | null> = {
  hydro_metal: null,
  hydro_composite: null,
  reducer: null,
  membrane: null,
  mask_inhale_valve: null,
  mask_voice_membrane: null,
  mask_inspection: null,
};

export function IntervalsPage() {
  const toast = useToast();
  const query = useIntervals();
  const updateMut = useUpdateIntervals();

  const [values, setValues] = useState<Record<IntervalKey, number | null>>(EMPTY_VALUES);

  useEffect(() => {
    if (query.data) {
      const next: Record<IntervalKey, number | null> = { ...EMPTY_VALUES };
      for (const item of query.data.data) next[item.key] = item.months;
      setValues(next);
    }
  }, [query.data]);

  if (query.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (query.isError || !query.data) {
    return <div className="page"><ErrorState onRetry={() => query.refetch()} /></div>;
  }

  const byKey = Object.fromEntries(query.data.data.map((i) => [i.key, i]));

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const body: Partial<Record<IntervalKey, number>> = {};
    for (const key of ORDER) {
      const v = values[key];
      if (v && v > 0) body[key] = v;
    }
    updateMut.mutate(body, {
      onSuccess: () => toast.show('Інтервали оновлено — статуси перераховано для всіх одиниць'),
      onError: (err) => toast.show(errorMessage(err), 'error'),
    });
  };

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Головна
      </Link>
      <div className="page-header">
        <h1>Інтервали випробувань</h1>
      </div>
      <p className="field__hint">
        Єдині значення для всього проекту (усіх станцій). Зміна одразу перераховує статуси всіх
        існуючих балонів, ложаментів і масок — окреме поле інтервалу на картці одиниці більше не існує.
      </p>

      <form className="form" onSubmit={submit} noValidate>
        {ORDER.map((key) => (
          <Field
            key={key}
            label={byKey[key]?.label ?? key}
            hint={
              byKey[key]?.updated_at
                ? `Востаннє змінено: ${formatDateTime(byKey[key].updated_at)}`
                : undefined
            }
          >
            <NumberStepper
              value={values[key]}
              onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
              step={1}
              min={1}
              ariaLabel={byKey[key]?.label ?? key}
            />
          </Field>
        ))}

        <div className="form__footer">
          <Button type="submit" loading={updateMut.isPending}>
            Зберегти
          </Button>
        </div>
      </form>
    </div>
  );
}
