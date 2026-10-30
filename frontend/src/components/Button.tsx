import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-contrast shadow-soft hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-fg hover:bg-surface-muted',
        ghost: 'text-fg-muted hover:bg-surface-muted hover:text-fg',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-sm',
        lg: 'h-12 px-5 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  children: ReactNode;
  ariaLabel?: string;
  /** Forwarded to the `<button>` (a plain prop in React 19), e.g. to focus it. */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  children,
  variant,
  size,
  className,
  ariaLabel,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-label={ariaLabel ?? undefined}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  );
}
