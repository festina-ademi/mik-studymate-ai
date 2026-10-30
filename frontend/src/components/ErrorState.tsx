import { AlertCircle, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';

interface ErrorStateProps {
  title: string;
  description: string;
  onRetry?: () => void;
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-error/40 bg-error/5 px-6 py-8 text-center shadow-soft">
      <div className="mb-4 rounded-xl bg-error/10 p-3 text-error">
        <AlertCircle className="size-5" />
      </div>
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-fg-muted">{description}</p>
      {onRetry ? (
        <div className="mt-5">
          <Button variant="secondary" onClick={onRetry}>
            <RotateCcw className="size-4" />
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
