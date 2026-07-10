import type { ReactNode } from 'react';
import { CloudOff } from 'lucide-react';
import { Button } from './Button';

export function SkeletonRows({ count = 6, chip = false }: { count?: number; chip?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: chip ? 'row' : 'column', gap: 12 }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton-row${chip ? ' skeleton-row--chip' : ''}`} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, action }: EmptyStateProps) {
  return (
    <div className="state-block">
      {icon}
      <div className="state-block__title">{title}</div>
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state-block">
      <CloudOff size={48} aria-hidden="true" />
      <div className="state-block__title">
        {message ?? 'Не вдалося завантажити. Перевірте з’єднання'}
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Повторити
        </Button>
      )}
    </div>
  );
}
