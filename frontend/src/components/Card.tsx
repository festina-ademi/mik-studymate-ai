import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-border bg-surface shadow-soft ${className}`}
    >
      {children}
    </div>
  );
}
