import type { ReactNode } from 'react';
import { EmptyState, SkeletonRows } from './states';

export interface TimelineItem {
  id: string;
  date: string;
  icon?: ReactNode;
  title: string;
  details?: string;
}

export interface HistoryTimelineProps {
  items: TimelineItem[] | undefined;
  loading?: boolean;
  emptyText?: string;
}

export function HistoryTimeline({ items, loading, emptyText }: HistoryTimelineProps) {
  if (loading) return <SkeletonRows count={3} />;
  if (!items || items.length === 0) {
    return <EmptyState title={emptyText ?? 'Історія порожня'} />;
  }
  return (
    <div className="timeline">
      {items.map((it) => (
        <div key={it.id} className="timeline__item">
          {it.icon && <span className="timeline__icon">{it.icon}</span>}
          <span className="timeline__date tnum">{it.date}</span>
          <span>
            <div>{it.title}</div>
            {it.details && <div className="timeline__details">{it.details}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}
