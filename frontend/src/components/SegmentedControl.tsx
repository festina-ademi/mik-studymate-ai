import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name; should contain any visible text of the option. */
  ariaLabel: string;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name of the whole group. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A compact single-choice control made of toggle buttons. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const indicatorId = useId();

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-xl bg-surface-muted p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={active}
            onClick={() => {
              onChange(option.value);
            }}
            className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'text-fg' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {active && (
              <motion.span
                layoutId={indicatorId}
                className="absolute inset-0 rounded-lg bg-surface shadow-soft ring-1 ring-border"
                transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
