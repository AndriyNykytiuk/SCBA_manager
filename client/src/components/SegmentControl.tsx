export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  ariaLabel: string;
}

export function SegmentControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentControlProps<T>) {
  return (
    <div className="segment" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`segment__opt${o.value === value ? ' active' : ''}`}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
