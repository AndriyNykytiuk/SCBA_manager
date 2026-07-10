import { formatDate, formatEngineHours } from '../lib/formatters';
import type { Compressor } from '../api/types';

/** Лінійний прогрес до наступного ТО (design-system.md §6.9) */
export function ProgressToMaintenance({ compressor }: { compressor: Compressor }) {
  const next = compressor.maintenance.next;
  if (!next) return null;

  const interval = next.level; // інтервал у мг = рівень ТО
  const remaining = next.due_hours - compressor.engine_hours;
  const done = interval - remaining;
  const ratio = interval > 0 ? done / interval : 0;
  const kind = remaining < 0 ? 'danger' : ratio >= 0.8 ? 'warning' : 'ok';

  const calendar = compressor.maintenance.levels.find(
    (l) => l.level === next.level && l.due_date,
  )?.due_date;

  const label =
    remaining >= 0
      ? `${formatEngineHours(Math.max(0, done))} / ${interval} мг до ТО-${next.level}${
          calendar ? ` · або до ${formatDate(calendar)}` : ''
        }`
      : `+${formatEngineHours(-remaining)} мг понад інтервал ТО-${next.level}`;

  return (
    <div className="progress-maint">
      <div
        className="progress-maint__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
        aria-label={label}
      >
        <div
          className={`progress-maint__fill progress-maint__fill--${kind}`}
          style={{ width: `${Math.min(Math.max(ratio, 0), 1) * 100}%` }}
        />
      </div>
      <div className="progress-maint__label">{label}</div>
    </div>
  );
}
