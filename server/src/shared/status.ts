/**
 * Статуси придатності та готові тексти badge (condition.reason).
 * Тексти формуються ТІЛЬКИ тут — фронт їх лише рендерить (api-contract.md §13.2).
 */

export type ConditionStatus = 'ok' | 'warning' | 'overdue';

export interface Condition {
  status: ConditionStatus;
  reason: string | null;
  due_at: string | null;
}

const RANK: Record<ConditionStatus, number> = { ok: 0, warning: 1, overdue: 2 };

export function worstStatus(statuses: Array<ConditionStatus | null | undefined>): ConditionStatus {
  let worst: ConditionStatus = 'ok';
  for (const s of statuses) {
    if (s && RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

/** Балон: гідротест + кінець строку служби (пороги 30 дн). */
export function cylinderCondition(input: {
  status: ConditionStatus | null;
  nextHydroTestAt: string | null;
  hydroDaysLeft: number | null;
  endOfLifeAt: string | null;
  eolDaysLeft: number | null;
}): Condition {
  const status = input.status ?? 'ok';
  if (status === 'ok') {
    return { status, reason: null, due_at: input.nextHydroTestAt };
  }
  // обираємо причину: та, що «гірша» (менше днів у запасі)
  const hydro = input.hydroDaysLeft;
  const eol = input.eolDaysLeft;
  const hydroWins = hydro !== null && (eol === null || hydro <= eol);
  if (hydroWins) {
    const reason =
      status === 'overdue'
        ? `Гідротест прострочено ${Math.abs(hydro!)} дн`
        : `Гідротест через ${hydro} дн`;
    return { status, reason, due_at: input.nextHydroTestAt };
  }
  const reason =
    status === 'overdue'
      ? `Строк служби балона вичерпано ${Math.abs(eol!)} дн тому`
      : `Кінець строку служби через ${eol} дн`;
  return { status, reason, due_at: input.endOfLifeAt };
}

/** Ложамент: заміна редуктора (поріг 60 дн, DB-1). */
export function backplateCondition(input: {
  status: ConditionStatus | null;
  nextReducerReplacementAt: string | null;
  daysLeft: number | null;
}): Condition {
  const status = input.status ?? 'ok';
  if (status === 'ok' || input.daysLeft === null) {
    return { status, reason: null, due_at: input.nextReducerReplacementAt };
  }
  const reason =
    status === 'overdue'
      ? `Заміна редуктора прострочена ${Math.abs(input.daysLeft)} дн`
      : `Заміна редуктора через ${input.daysLeft} дн`;
  return { status, reason, due_at: input.nextReducerReplacementAt };
}

export interface MaintenanceLevelRow {
  level: number;
  due_hours: number;
  due_date: string | null;
  status: ConditionStatus;
  engine_hours: number;
}

/** Компресор: найгірший статус серед рівнів ТО; текст по «винному» рівню. */
export function compressorCondition(levels: MaintenanceLevelRow[]): Condition {
  const status = worstStatus(levels.map((l) => l.status));
  if (status === 'ok') return { status, reason: null, due_at: null };
  // «винний» рівень: серед рівнів зі статусом status — найвищий (він і проводиться на кратності)
  const culprits = levels.filter((l) => l.status === status);
  const culprit = culprits.reduce((a, b) => (b.level > a.level ? b : a));
  const overBy = round1(culprit.engine_hours - culprit.due_hours);
  const leftHours = round1(culprit.due_hours - culprit.engine_hours);
  const calendarOverdue =
    culprit.due_date !== null && culprit.due_date < todayIso() && culprit.engine_hours < culprit.due_hours;
  let reason: string;
  if (status === 'overdue') {
    reason = calendarOverdue
      ? `ТО-${culprit.level} прострочено (календар, до ${culprit.due_date})`
      : `ТО-${culprit.level} прострочено · +${overBy} мг`;
  } else {
    const calendarSoon =
      culprit.due_date !== null && culprit.engine_hours < culprit.due_hours - culprit.level * 0.1;
    reason = calendarSoon
      ? `ТО-${culprit.level} до ${culprit.due_date}`
      : `ТО-${culprit.level} через ${leftHours} мг`;
  }
  return { status, reason, due_at: culprit.due_date };
}

/** Апарат: несправний, якщо прострочений будь-який компонент. */
export function apparatusCondition(input: {
  status: ConditionStatus | null;
  backplate: Condition;
  cylinders: Array<{ number: string; condition: Condition }>;
}): Condition {
  const status = input.status ?? 'ok';
  if (status === 'ok') return { status, reason: null, due_at: null };
  const parts: string[] = [];
  let dueAt: string | null = null;
  for (const c of input.cylinders) {
    if (c.condition.status === status) {
      const kind = c.condition.reason?.startsWith('Строк служби') || c.condition.reason?.startsWith('Кінець')
        ? 'строк служби'
        : 'гідротест';
      parts.push(`${kind} бал. №${c.number}`);
      if (!dueAt) dueAt = c.condition.due_at;
    }
  }
  if (input.backplate.status === status) {
    parts.push('редуктор');
    if (!dueAt) dueAt = input.backplate.due_at;
  }
  const detail = parts.join(' · ') || 'компонент';
  const reason = status === 'overdue' ? `НЕСПРАВНИЙ · ${detail}` : `Увага · ${detail}`;
  return { status, reason, due_at: dueAt };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
