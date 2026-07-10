// Admin: створення/редагування станції (+ архівація)
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  useArchiveStation,
  useCreateStation,
  useRestoreStation,
  useStation,
  useUpdateStation,
} from '../../api/stations';
import { Button } from '../../components/Button';
import { Field, TextInput } from '../../components/Field';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, SkeletonRows } from '../../components/states';
import { useToast } from '../../components/Toast';
import { errorMessage, fieldErrors } from '../../api/http';

export function StationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useStation(isEdit ? id : undefined);
  const createMut = useCreateStation();
  const updateMut = useUpdateStation(id ?? '');
  const archiveMut = useArchiveStation(id ?? '');
  const restoreMut = useRestoreStation(id ?? '');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (isEdit && existing.data) {
      setName(existing.data.name);
      setAddress(existing.data.address ?? '');
    }
  }, [isEdit, existing.data]);

  if (isEdit && existing.isLoading) return <div className="page"><SkeletonRows count={3} /></div>;
  if (isEdit && (existing.isError || !existing.data)) {
    return <div className="page"><ErrorState onRetry={() => existing.refetch()} /></div>;
  }

  const archived = Boolean(existing.data?.archived_at);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Вкажіть назву станції';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const body = { name: name.trim(), address: address.trim() || null };

    const onError = (err: unknown) => {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.show(errorMessage(err), 'error');
    };

    if (isEdit && id) {
      updateMut.mutate(body, {
        onSuccess: () => {
          toast.show('Станцію оновлено');
          navigate('/admin/stations');
        },
        onError,
      });
    } else {
      createMut.mutate(body, {
        onSuccess: (s) => {
          toast.show(`Станцію ${s.name} створено`);
          navigate('/admin/stations');
        },
        onError,
      });
    }
  };

  const pending = createMut.isPending || updateMut.isPending;

  return (
    <div className="page">
      <Link to="/admin/stations" className="back-link">
        <ArrowLeft size={20} aria-hidden="true" />
        Станції
      </Link>
      <div className="page-header">
        <h1>{isEdit ? `Станція: ${existing.data?.name}` : 'Нова станція'}</h1>
      </div>

      <form className="form" onSubmit={submit} noValidate>
        <Field label="Назва" required error={errors.name} hint="Напр., «ДПРЧ-12»">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(errors.name)}
          />
        </Field>

        <Field label="Адреса">
          <TextInput value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="form__footer">
          <Button variant="secondary" onClick={() => navigate('/admin/stations')}>
            Скасувати
          </Button>
          <Button type="submit" loading={pending}>
            Зберегти
          </Button>
        </div>
      </form>

      {isEdit && (
        <div className="btn-row">
          {!archived ? (
            <Button variant="danger" onClick={() => setArchiveOpen(true)}>
              Архівувати
            </Button>
          ) : (
            <Button
              variant="secondary"
              loading={restoreMut.isPending}
              onClick={() =>
                restoreMut.mutate(undefined, {
                  onSuccess: () => toast.show('Станцію відновлено'),
                  onError: (err) => toast.show(errorMessage(err), 'error'),
                })
              }
            >
              Відновити
            </Button>
          )}
        </div>
      )}

      {archiveOpen && (
        <ConfirmDialog
          title={`Архівувати станцію ${existing.data?.name}?`}
          confirmLabel="Архівувати"
          danger
          loading={archiveMut.isPending}
          onConfirm={() =>
            archiveMut.mutate(undefined, {
              onSuccess: () => {
                toast.show('Станцію архівовано');
                setArchiveOpen(false);
                navigate('/admin/stations');
              },
              onError: (err) => {
                toast.show(errorMessage(err), 'error');
                setArchiveOpen(false);
              },
            })
          }
          onCancel={() => setArchiveOpen(false)}
        >
          <p>Станція зникне з перемикача. Обладнання та користувачі станції збережуться в архіві.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
