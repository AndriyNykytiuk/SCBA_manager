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

/**
 * Ложамент: два незалежні компоненти техобслуговування — редуктор і мембрана
 * (поріг warning = 60 дн, DB-1). Причина статусу — той, що «гірший» (менше днів у запасі),
 * той самий принцип, що й cylinderCondition (гідротест vs строк служби).
 */
export function backplateCondition(input: {
  status: ConditionStatus | null;
  nextReducerReplacementAt: string | null;
  reducerDaysLeft: number | null;
  nextMembraneReplacementAt: string | null;
  membraneDaysLeft: number | null;
}): Condition {
  const status = input.status ?? 'ok';
  if (status === 'ok') {
    const dueCandidates = [input.nextReducerReplacementAt, input.nextMembraneReplacementAt].filter(
      (d): d is string => d !== null,
    );
    dueCandidates.sort();
    return { status, reason: null, due_at: dueCandidates[0] ?? null };
  }
  const reducer = input.reducerDaysLeft;
  const membrane = input.membraneDaysLeft;
  const reducerWins = reducer !== null && (membrane === null || reducer <= membrane);
  if (reducerWins) {
    const reason =
      status === 'overdue'
        ? `Заміна редуктора прострочена ${Math.abs(reducer!)} дн`
        : `Заміна редуктора через ${reducer} дн`;
    return { status, reason, due_at: input.nextReducerReplacementAt };
  }
  const reason =
    status === 'overdue'
      ? `Заміна мембрани прострочена ${Math.abs(membrane!)} дн`
      : `Заміна мембрани через ${membrane} дн`;
  return { status, reason, due_at: input.nextMembraneReplacementAt };
}

/**
 * Маска: три незалежні компоненти техобслуговування — клапан вдиху, переговорна мембрана,
 * технічний огляд (поріг warning = 60 дн, як у ложамента). Причина — «винний» компонент
 * (найменше днів у запасі).
 */
export function maskCondition(input: {
  status: ConditionStatus | null;
  nextInhaleValveAt: string | null;
  inhaleValveDaysLeft: number | null;
  nextVoiceMembraneAt: string | null;
  voiceMembraneDaysLeft: number | null;
  nextInspectionAt: string | null;
  inspectionDaysLeft: number | null;
}): Condition {
  const status = input.status ?? 'ok';
  const items = [
    { label: 'Заміна клапану вдиху', daysLeft: input.inhaleValveDaysLeft, dueAt: input.nextInhaleValveAt },
    {
      label: 'Заміна переговорної мембрани',
      daysLeft: input.voiceMembraneDaysLeft,
      dueAt: input.nextVoiceMembraneAt,
    },
    { label: 'Технічний огляд', daysLeft: input.inspectionDaysLeft, dueAt: input.nextInspectionAt },
  ];
  if (status === 'ok') {
    const dueCandidates = items.map((i) => i.dueAt).filter((d): d is string => d !== null);
    dueCandidates.sort();
    return { status, reason: null, due_at: dueCandidates[0] ?? null };
  }
  const known = items.filter((i): i is typeof i & { daysLeft: number } => i.daysLeft !== null);
  const worst = known.reduce((a, b) => (b.daysLeft < a.daysLeft ? b : a));
  const reason =
    status === 'overdue'
      ? `${worst.label} прострочено ${Math.abs(worst.daysLeft)} дн`
      : `${worst.label} через ${worst.daysLeft} дн`;
  return { status, reason, due_at: worst.dueAt };
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
