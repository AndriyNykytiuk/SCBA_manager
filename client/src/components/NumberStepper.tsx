export interface NumberStepperProps {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  presets?: number[];
  ariaLabel: string;
  invalid?: boolean;
  allowDecimal?: boolean;
}

/** Поле + кнопки −/+ по 48px — зручно в рукавицях (design-system.md §6.6) */
export function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  presets,
  ariaLabel,
  invalid,
  allowDecimal = false,
}: NumberStepperProps) {
  const clamp = (n: number): number => {
    let out = n;
    if (max !== undefined) out = Math.min(out, max);
    out = Math.max(out, min);
    return out;
  };

  const bump = (dir: 1 | -1) => {
    const base = value ?? 0;
    const next = clamp(Math.round((base + dir * step) * 100) / 100);
    onChange(next);
  };

  return (
    <div>
      <div className="stepper">
        <button
          type="button"
          className="stepper__btn"
          onClick={() => bump(-1)}
          aria-label={`${ariaLabel}: зменшити`}
        >
          −
        </button>
        <input
          className={`input${invalid ? ' input--error' : ''}`}
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          value={value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.');
            if (raw === '') {
              onChange(null);
              return;
            }
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
          aria-label={ariaLabel}
        />
        <button
          type="button"
          className="stepper__btn"
          onClick={() => bump(1)}
          aria-label={`${ariaLabel}: збільшити`}
        >
          +
        </button>
      </div>
      {presets && presets.length > 0 && (
        <div className="stepper-presets">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={`chip${value === p ? ' chip--active' : ''}`}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
