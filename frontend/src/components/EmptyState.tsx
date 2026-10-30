import type { ReactNode } from 'react';

import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

export function EmptyState({ title, description, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface-muted px-6 py-8 text-center shadow-soft">
      {icon ? (
        <div className="mb-4 rounded-xl bg-primary-soft p-3 text-primary-soft-fg">{icon}</div>
      ) : null}
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{description}</p>
      {actionLabel && onAction ? (
        <div className="mt-5">
          <Button variant="primary" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
