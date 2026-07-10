import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';

export type CounterKind = 'danger' | 'warning' | 'ok';

const ICON = { danger: OctagonAlert, warning: TriangleAlert, ok: CircleCheck } as const;
const LABEL = { danger: 'Прострочено', warning: 'Увага', ok: 'У нормі' } as const;

export interface CounterChipProps {
  kind: CounterKind;
  count: number | undefined;
  active: boolean;
  onClick: () => void;
}

/** Лічильник-фільтр мейнборда (56px, суцільна заливка для «кричущих» статусів) */
export function CounterChip({ kind, count, active, onClick }: CounterChipProps) {
  const Icon = ICON[kind];
  return (
    <button
      type="button"
      className={`counter-chip counter-chip--${kind} ${active ? 'counter-chip--active' : 'counter-chip--inactive'}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${LABEL[kind]}: ${count ?? '…'}`}
    >
      <Icon size={24} aria-hidden="true" />
      <span>
        {LABEL[kind]}: {count ?? '…'}
      </span>
    </button>
  );
}
