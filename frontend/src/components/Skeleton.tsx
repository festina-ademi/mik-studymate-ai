import { useTranslation } from 'react-i18next';

interface SkeletonProps {
  lines?: number;
}

export function Skeleton({ lines = 4 }: SkeletonProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" aria-label={t('common.loadingContent')}>
      {Array.from({ length: lines }).map((_, index) => {
        const width = `${String(Math.max(40, 100 - index * 8))}%`;
        return (
          <div
            key={index}
            className="h-4 animate-pulse rounded-full bg-surface-muted"
            style={{ width }}
          />
        );
      })}
    </div>
  );
}
