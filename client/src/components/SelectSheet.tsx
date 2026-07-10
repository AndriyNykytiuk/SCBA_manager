import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { SearchInput } from './SearchInput';
import { ListRow } from './ListRow';
import { StatusBadge } from './StatusBadge';
import { EmptyState, ErrorState, SkeletonRows } from './states';
import type { UiStatus } from '../lib/status';

export interface SheetRow {
  id: string;
  title: string;
  meta?: string;
  status?: UiStatus;
  badge?: { status: UiStatus; label: string };
  icon?: ReactNode;
  disabled?: boolean;
  /** Причину «зайнятості» не приховуємо — пояснюємо (design-system.md §6.2) */
  disabledReason?: string;
}

export interface SelectSheetProps {
  title: string;
  rows: SheetRow[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  emptyText?: string;
  searchPlaceholder?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Вибір із довгого списку: bottom sheet на мобільному / модалка 560px на ПК */
export function SelectSheet({
  title,
  rows,
  loading,
  error,
  onRetry,
  emptyText,
  searchPlaceholder,
  onSelect,
  onClose,
}: SelectSheetProps) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        (r.meta ?? '').toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <Modal title={title} onClose={onClose}>
      <SearchInput value={q} onChange={setQ} placeholder={searchPlaceholder ?? 'Пошук за номером'} />
      {loading && <SkeletonRows count={4} />}
      {!loading && error && <ErrorState onRetry={onRetry} />}
      {!loading && !error && filtered.length === 0 && (
        <EmptyState title={emptyText ?? 'Нічого не знайдено'} />
      )}
      {!loading && !error && filtered.length > 0 && (
        <div className="list">
          {filtered.map((r) => (
            <ListRow
              key={r.id}
              status={r.status ?? r.badge?.status ?? 'neutral'}
              icon={r.icon}
              title={r.title}
              meta={r.disabled && r.disabledReason ? `${r.meta ? `${r.meta} · ` : ''}${r.disabledReason}` : r.meta}
              badge={r.badge ? <StatusBadge status={r.badge.status} label={r.badge.label} /> : undefined}
              disabled={r.disabled}
              onClick={r.disabled ? undefined : () => onSelect(r.id)}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
