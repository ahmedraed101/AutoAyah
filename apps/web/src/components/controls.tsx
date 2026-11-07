import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";
import { Icon } from "./Icon";

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="field" role="group" aria-label={typeof label === "string" ? label : undefined}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A titled group of related fields inside a tool panel. */
export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="tool-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...props} />
    </span>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="switch-row" title={title}>
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(clamp(value - 1))}>
          <Icon name="minus" size={18} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={label}
          min={min}
          max={max}
          value={value}
          onChange={(e) => e.target.value && onChange(Math.min(max, Number(e.target.value)))}
        />
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(clamp(value + 1))}>
          <Icon name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  display?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className={`field slider${disabled ? " is-disabled" : ""}`}>
      <span className="field-label slider-head">
        <span>{label}</span>
        <output>{display ?? value}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        style={{ "--fill": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
