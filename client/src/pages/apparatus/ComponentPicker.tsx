// SelectSheet-обгортки вибору вільних ложаментів/балонів (screens.md §5.4)
import { Backpack, Cylinder as CylinderIcon } from 'lucide-react';
import { useBackplates } from '../../api/backplates';
import { useCylinders } from '../../api/cylinders';
import { SelectSheet } from '../../components/SelectSheet';
import type { SheetRow } from '../../components/SelectSheet';
import { backplateBadge, cylinderBadge, BACKPLATE_STATUS_LABEL } from '../../lib/status';
import { MATERIAL_LABEL } from '../../lib/formatters';
import type { Backplate, Cylinder } from '../../api/types';

export interface BackplatePickerProps {
  onSelect: (backplate: Backplate) => void;
  onClose: () => void;
}

/** Лише «вільні» доступні; зайняті/у ремонті видно сірими з поясненням (ДС §6.2) */
export function BackplatePicker({ onSelect, onClose }: BackplatePickerProps) {
  const query = useBackplates();
  const items = (query.data?.data ?? []).filter(
    (b) => !b.archived_at && b.status !== 'decommissioned',
  );

  const rows: SheetRow[] = items.map((b) => {
    const badge = backplateBadge(b);
    const disabled = b.status !== 'free';
    return {
      id: b.id,
      title: b.name,
      meta: [b.manufacturer, b.model].filter(Boolean).join(' ') || undefined,
      badge,
      status: badge.status,
      icon: <Backpack size={24} />,
      disabled,
      disabledReason: disabled
        ? b.status === 'in_apparatus' && b.apparatus
          ? `В апараті ${b.apparatus.name}`
          : BACKPLATE_STATUS_LABEL[b.status]
        : undefined,
    };
  });

  return (
    <SelectSheet
      title="Оберіть ложамент"
      rows={rows}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => query.refetch()}
      emptyText="Вільних ложаментів немає"
      searchPlaceholder="Пошук за назвою/номером"
      onSelect={(id) => {
        const b = items.find((x) => x.id === id);
        if (b) onSelect(b);
      }}
      onClose={onClose}
    />
  );
}

export interface CylinderPickerProps {
  /** id балонів, що вже додані (не показуємо повторно) */
  excludeIds?: string[];
  title?: string;
  onSelect: (cylinder: Cylinder) => void;
  onClose: () => void;
}

function cylinderMeta(c: Cylinder): string {
  return `${c.volume_l} л ${MATERIAL_LABEL[c.material] ?? c.material} · ${c.working_pressure_bar} бар`;
}

/** Лише вільні (не в апараті) живі балони */
export function CylinderPicker({ excludeIds = [], title, onSelect, onClose }: CylinderPickerProps) {
  const query = useCylinders({ installed: false });
  const items = (query.data?.data ?? []).filter(
    (c) => !c.archived_at && !excludeIds.includes(c.id),
  );

  const rows: SheetRow[] = items.map((c) => {
    const badge = cylinderBadge(c);
    return {
      id: c.id,
      title: `№${c.number}`,
      meta: cylinderMeta(c),
      badge,
      status: badge.status,
      icon: <CylinderIcon size={24} />,
    };
  });

  return (
    <SelectSheet
      title={title ?? 'Оберіть балон'}
      rows={rows}
      loading={query.isLoading}
      error={query.isError}
      onRetry={() => query.refetch()}
      emptyText="Вільних балонів немає"
      searchPlaceholder="Пошук за номером"
      onSelect={(id) => {
        const c = items.find((x) => x.id === id);
        if (c) onSelect(c);
      }}
      onClose={onClose}
    />
  );
}
