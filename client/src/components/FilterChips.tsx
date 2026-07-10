export interface FilterChipOption {
  key: string;
  label: string;
}

export interface FilterChipsProps {
  options: FilterChipOption[];
  active: string;
  onChange: (key: string) => void;
}

export function FilterChips({ options, active, onChange }: FilterChipsProps) {
  return (
    <div className="filter-chips" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={o.key === active}
          className={`chip${o.key === active ? ' chip--active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
