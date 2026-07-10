import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useCreateCylinder, useCylinder, useUpdateCylinder } from '../../api/cylinders';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/Button';
import { DateInput, Field, TextArea, TextInput } from '../../components/Field';
import { NumberStepper } from '../../components/NumberStepper';
import { SegmentControl } from '../../components/SegmentControl';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';
import { addMonths, formatDate } from '../../lib/formatters';
import type { CylinderMaterial } from '../../api/types';

export function CylinderFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const toast = useToast();
  const existing = useCylinder(isEdit ? id : undefined);
  const createMut = useCreateCylinder();
  const updateMut = useUpdateCylinder(id ?? '');

  const [number, setNumber] = useState('');
  const [volume, setVolume] = useState<number | null>(6.8);
  const [material, setMaterial] = useState<CylinderMaterial | null>(null);
  const [pressure, setPressure] = useState<number | null>(300);
  const [manufacturer, setManufacturer] = useState('');
  const [manufacturedAt, setManufacturedAt] = useState('');
  const [endOfLifeAt, setEndOfLifeAt] = useState('');
  const [lastHydroAt, setLastHydroAt] = useState('');
  const [intervalMonths, setIntervalMonths] = useState<number | null>(60);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isEdit && existing.data) {
      const c = existing.data;
      setNumber(c.number);
      setVolume(c.volume_l);
      setMaterial(c.material);
      setPressure(c.working_pressure_bar);
      setManufacturer(c.manufacturer ?? '');
      setManufacturedAt(c.manufactured_at);
      setEndOfLifeAt(c.end_of_life_at);
      setLastHydroAt(c.last_hydro_test_at ?? '');
      setIntervalMonths(c.hydro_interval_months);
      setNotes(c.notes ?? '');
    }
  }, [isEdit, existing.data]);

  if (!canEdit) return <Navigate to="/cylinders" replace />;
  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={4} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const hydroPreview =
    lastHydroAt && intervalMonths ? addMonths(lastHydroAt, intervalMonths) : '';

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!number.trim()) e.number = 'Вкажіть номер балона';
    if (!isEdit) {
      if (!material) e.material = 'Оберіть матеріал';
      if (!manufacturedAt) e.manufactured_at = 'Вкажіть дату виготовлення';
      if (!lastHydroAt) e.last_hydro_test_at = 'Вкажіть дату останнього гідротесту';
    }
    if (!endOfLifeAt) e.end_of_life_at = 'Вкажіть кінець строку служби';
    if (manufacturedAt && endOfLifeAt && endOfLifeAt <= manufacturedAt) {
      e.end_of_life_at = 'Кінець строку служби має бути пізніше дати виготовлення';
    }
    if (!pressure || pressure <= 0 || pressure > 450) e.working_pressure_bar = 'Тиск: 1–450 бар';
    if (!intervalMonths || intervalMonths <= 0) e.hydro_interval_months = 'Інтервал має бути > 0';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    const onError = (err: unknown) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.show(errorMessage(err), 'error');
    };

    if (isEdit && id) {
      // Контракт: PATCH дозволяє номер, тиск, EOL, інтервал, нотатки
      updateMut.mutate(
        {
          number: number.trim(),
          working_pressure_bar: pressure ?? 0,
          end_of_life_at: endOfLifeAt,
          hydro_interval_months: intervalMonths ?? 0,
          notes: notes.trim() || null,
        },
        {
          onSuccess: () => {
            toast.show('Балон оновлено');
            navigate(`/cylinders/${id}`);
          },
          onError,
        },
      );
    } else {
      createMut.mutate(
        {
          number: number.trim(),
          volume_l: volume ?? 6.8,
          material: material as CylinderMaterial,
          working_pressure_bar: pressure ?? 0,
          manufacturer: manufacturer.trim() || null,
          manufactured_at: manufacturedAt,
          end_of_life_at: endOfLifeAt,
          hydro_interval_months: intervalMonths ?? 0,
          last_hydro_test_at: lastHydroAt,
          notes: notes.trim() || null,
        },
        {
          onSuccess: (c) => {
            toast.show(`Балон №${c.number} створено`);
            navigate(`/cylinders/${c.id}`);
          },
          onError,
        },
      );
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="page">
      <Link to={isEdit ? `/cylinders/${id}` : '/cylinders'} className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        {isEdit ? `Балон №${existing.data?.number}` : 'Балони'}
      </Link>
      <div className="page-header">
        <h1>{isEdit ? 'Редагувати балон' : 'Новий балон'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <Field label="Номер балона" required error={errors.number}>
          <TextInput
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            invalid={Boolean(errors.number)}
          />
        </Field>

        <Field label="Об’єм" required>
          <SegmentControl
            options={[
              { value: 6, label: '6 л' },
              { value: 6.8, label: '6.8 л' },
              { value: 7, label: '7 л' },
            ]}
            value={volume}
            onChange={setVolume}
            ariaLabel="Об’єм балона"
          />
        </Field>

        <Field
          label="Матеріал"
          required
          error={errors.material}
          hint="Для металу й композиту інтервали гідротесту різні"
        >
          <SegmentControl<CylinderMaterial>
            options={[
              { value: 'metal', label: 'Метал', disabled: isEdit },
              { value: 'composite', label: 'Композит', disabled: isEdit },
            ]}
            value={material}
            onChange={setMaterial}
            ariaLabel="Матеріал балона"
          />
        </Field>

        <Field label="Робочий тиск, бар" required error={errors.working_pressure_bar}>
          <NumberStepper
            value={pressure}
            onChange={setPressure}
            step={5}
            min={0}
            max={450}
            presets={[200, 300]}
            ariaLabel="Робочий тиск"
            invalid={Boolean(errors.working_pressure_bar)}
          />
        </Field>

        <Field label="Виробник">
          <TextInput
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            disabled={isEdit}
          />
        </Field>

        <Field label="Дата виготовлення" required error={errors.manufactured_at}>
          <DateInput
            value={manufacturedAt}
            onChange={(e) => setManufacturedAt(e.target.value)}
            invalid={Boolean(errors.manufactured_at)}
            disabled={isEdit}
          />
        </Field>

        <Field label="Кінець строку служби" required error={errors.end_of_life_at}>
          <DateInput
            value={endOfLifeAt}
            onChange={(e) => setEndOfLifeAt(e.target.value)}
            invalid={Boolean(errors.end_of_life_at)}
          />
        </Field>

        <Field label="Дата останнього гідротесту" required error={errors.last_hydro_test_at}>
          <DateInput
            value={lastHydroAt}
            onChange={(e) => setLastHydroAt(e.target.value)}
            invalid={Boolean(errors.last_hydro_test_at)}
            disabled={isEdit}
          />
        </Field>

        <Field
          label="Інтервал гідротесту, місяців"
          required
          error={errors.hydro_interval_months}
          hint={
            hydroPreview ? (
              <>
                Наступний гідротест: <strong>{formatDate(hydroPreview)}</strong>
              </>
            ) : undefined
          }
        >
          <NumberStepper
            value={intervalMonths}
            onChange={setIntervalMonths}
            step={12}
            min={0}
            ariaLabel="Інтервал гідротесту"
            invalid={Boolean(errors.hydro_interval_months)}
          />
        </Field>

        <Field label="Примітки">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        <div className="form__footer">
          <Button
            variant="secondary"
            onClick={() => navigate(isEdit ? `/cylinders/${id}` : '/cylinders')}
          >
            Скасувати
          </Button>
          <Button type="submit" loading={pending}>
            Зберегти
          </Button>
        </div>
      </form>
    </div>
  );
}
