import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ToastProps {
  title: string;
  description?: string;
  onDismiss?: () => void;
  icon?: ReactNode;
}

export function Toast({ title, description, onDismiss, icon }: ToastProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-3 shadow-soft">
      {icon ? <div className="mt-0.5 text-primary">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="font-medium text-fg">{title}</div>
        {description ? <div className="mt-0.5 text-sm text-fg-muted">{description}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={t('common.dismissToast')}
          onClick={onDismiss}
          className="rounded-lg p-1 text-fg-muted hover:bg-surface-muted"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
