// Єдине джерело мапінгу статусів → токени/іконки/тексти (design-system.md §2.3, §3)
import {
  Archive,
  CircleCheck,
  OctagonAlert,
  TriangleAlert,
  Unlink,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  Apparatus,
  Backplate,
  BackplateStatus,
  Compressor,
  Condition,
  ConditionStatus,
  Cylinder,
  Mask,
} from '../api/types';

export type UiStatus = 'danger' | 'warning' | 'ok' | 'neutral' | 'archived';

/** Форма іконки дублює зміст для дальтоніків: восьмикутник / трикутник / коло */
export const STATUS_ICON: Record<UiStatus, LucideIcon> = {
  danger: OctagonAlert,
  warning: TriangleAlert,
  ok: CircleCheck,
  neutral: Wrench,
  archived: Archive,
};

export const DISASSEMBLED_ICON = Unlink;

export interface BadgeProps {
  status: UiStatus;
  label: string;
}

export function conditionToUi(s: ConditionStatus): UiStatus {
  if (s === 'overdue') return 'danger';
  if (s === 'warning') return 'warning';
  return 'ok';
}

export function conditionBadge(c: Condition | null | undefined, okLabel = 'У нормі'): BadgeProps {
  if (!c) return { status: 'neutral', label: '—' };
  return { status: conditionToUi(c.status), label: c.reason ?? okLabel };
}

export const BACKPLATE_STATUS_LABEL: Record<BackplateStatus, string> = {
  in_apparatus: 'В апараті',
  free: 'Вільний',
  in_repair: 'У ремонті',
  decommissioned: 'Списаний',
};

export function backplateBadge(b: Backplate): BadgeProps {
  if (b.archived_at) return { status: 'archived', label: 'Списаний' };
  if (b.status === 'in_repair' && b.condition.status === 'ok') {
    return { status: 'neutral', label: 'У ремонті' };
  }
  return conditionBadge(b.condition);
}

export function cylinderBadge(c: Cylinder): BadgeProps {
  if (c.archived_at) return { status: 'archived', label: 'Списаний' };
  return conditionBadge(c.condition);
}

export function maskBadge(m: Mask): BadgeProps {
  if (m.archived_at) return { status: 'archived', label: 'Списана' };
  return conditionBadge(m.condition);
}

export function apparatusBadge(a: Apparatus): BadgeProps {
  if (a.archived_at) return { status: 'archived', label: 'Списаний' };
  if (a.cylinders_installed === 0 && a.condition.status === 'ok') {
    return { status: 'neutral', label: 'Розібраний · без балонів' };
  }
  return conditionBadge(a.condition, 'Справний');
}

export function compressorBadge(c: Compressor): BadgeProps {
  if (c.archived_at) return { status: 'archived', label: 'Списаний' };
  if (c.condition.status === 'ok' && c.maintenance.next) {
    const left = c.maintenance.next.due_hours - c.engine_hours;
    return {
      status: 'ok',
      label: `ТО-${c.maintenance.next.level} через ${left.toFixed(1)} мг`,
    };
  }
  return conditionBadge(c.condition);
}
