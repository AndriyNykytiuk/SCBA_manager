import { STATUS_ICON } from '../lib/status';
import type { UiStatus } from '../lib/status';

export interface StatusBadgeProps {
  status: UiStatus;
  label: string;
  size?: 'sm' | 'md';
}

/** Статус = колір + іконка (форма) + текст. Ніколи не «тільки крапка». */
export function StatusBadge({ status, label, size = 'sm' }: StatusBadgeProps) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={`badge badge--${status}${size === 'md' ? ' badge--md' : ''}`}
      aria-label={label}
      title={label}
    >
      <Icon size={size === 'md' ? 22 : 18} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
