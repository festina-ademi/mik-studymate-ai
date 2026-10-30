import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-fg hover:bg-surface-muted',
        primary: 'border-primary/20 bg-primary-soft text-primary-soft-fg hover:bg-primary/10',
      },
      size: {
        sm: 'size-8',
        md: 'size-10',
        lg: 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  children: ReactNode;
  ariaLabel: string;
}

export function IconButton({
  children,
  variant,
  size,
  className,
  ariaLabel,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      className={iconButtonVariants({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  );
}
