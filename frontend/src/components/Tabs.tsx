import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly TabOption<T>[];
}

export function Tabs<T extends string>({ value, onChange, options }: TabsProps<T>) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 pt-4">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
            }}
            aria-pressed={active}
            className={`relative rounded-xl px-3 py-2 text-sm font-medium transition ${
              active ? 'bg-primary-soft text-primary-soft-fg' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {active && (
              <motion.span
                layoutId="tab-indicator"
                className="absolute inset-0 rounded-xl bg-primary-soft"
                transition={{ duration: 0.2 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
