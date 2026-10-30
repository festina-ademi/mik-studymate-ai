import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-primary/20 bg-primary-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary-soft-fg ${className}`}
    >
      {children}
    </span>
  );
}
