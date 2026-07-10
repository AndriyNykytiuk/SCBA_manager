// Формати дат/чисел (design-system.md §7): дд.мм.рррр, мг з одним знаком, бар цілі

/** '2026-06-12' або ISO-datetime → '12.06.2026' */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = iso.slice(0, 10);
  const parts = s.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}.${m}.${y}`;
}

/** ISO-datetime → 'HH:MM' (локальний час) */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (iso.length <= 10) return formatDate(iso);
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/** Мотогодини: один знак після коми */
export function formatEngineHours(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(1);
}

/** Секунди → 'ГГ:ХХ:СС' */
export function formatDurationSec(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/** Години (десяткові) → 'N хв' / 'N год N хв' */
export function formatDurationHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  const totalMin = Math.round(hours * 60);
  if (totalMin < 60) return `${totalMin} хв`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}

/** 'YYYY-MM-DD' + N місяців → 'YYYY-MM-DD' (UTC-безпечно) */
export function addMonths(dateISO: string, months: number): string {
  const parts = dateISO.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return '';
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export function todayISO(): string {
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function elapsedSeconds(startedAtISO: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(startedAtISO).getTime()) / 1000));
}

export const MATERIAL_LABEL: Record<string, string> = {
  metal: 'метал',
  composite: 'композит',
};

export function formatVolume(v: number | undefined): string {
  if (v === undefined) return '';
  return `${v} л`;
}
