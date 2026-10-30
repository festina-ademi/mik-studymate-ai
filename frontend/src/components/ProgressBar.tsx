export type ProgressBarTone = 'primary' | 'success' | 'warning' | 'error';

const TONE_CLASSES: Record<ProgressBarTone, string> = {
  primary: 'bg-gradient-to-r from-primary to-primary-hover',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
};

interface ProgressBarProps {
  value: number;
  label?: string;
  tone?: ProgressBarTone;
}

export function ProgressBar({ value, label, tone = 'primary' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  const width = `${String(clamped)}%`;

  return (
    <div className="w-full space-y-2">
      {label ? (
        <div className="text-xs font-medium uppercase tracking-[0.08em] text-fg-muted">{label}</div>
      ) : null}
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-muted ring-1 ring-border">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${TONE_CLASSES[tone]}`}
          style={{ width }}
        />
      </div>
    </div>
  );
}
