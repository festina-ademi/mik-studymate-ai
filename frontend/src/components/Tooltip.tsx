import { useEffect, useRef, useState, type ReactNode } from 'react';

const HOVER_DELAY_MS = 200;

interface TooltipProps {
  children: ReactNode;
  /** Body of the tooltip; a plain string for a one-line tip, or richer content (e.g. several
   * stacked descriptions) when `wide` is also set. */
  content: ReactNode;
  /** Optional bold heading above the body. */
  title?: string;
  /** Element id, so the described control can point at it with `aria-describedby`. */
  id?: string;
  placement?: 'top' | 'bottom';
  /** Which edge of the trigger the card lines up with; use `end` near the right edge of a page. */
  align?: 'center' | 'end';
  /** Lets the card wrap onto several lines and grow wider, for multi-paragraph content instead
   * of the default single-line tip. */
  wide?: boolean;
}

/**
 * Accessible tooltip: appears after a short hover delay or at once on keyboard focus, and goes
 * away on mouse leave, blur or Escape. The card is always in the DOM (visually hidden when
 * closed) so `aria-describedby` on the trigger can resolve to it.
 */
export function Tooltip({
  children,
  content,
  title,
  id,
  placement = 'top',
  align = 'center',
  wide = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const cancelTimer = (): void => {
    window.clearTimeout(timer.current);
  };
  const hide = (): void => {
    cancelTimer();
    setVisible(false);
  };

  useEffect(() => cancelTimer, []);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancelTimer();
        setVisible(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visible]);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => {
        cancelTimer();
        timer.current = window.setTimeout(() => {
          setVisible(true);
        }, HOVER_DELAY_MS);
      }}
      onMouseLeave={hide}
      onFocus={() => {
        cancelTimer();
        setVisible(true);
      }}
      onBlur={hide}
    >
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-20 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg-muted shadow-soft transition ${
          wide ? 'w-72 whitespace-normal' : 'whitespace-nowrap'
        } ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} ${
          align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'
        } ${visible ? 'visible opacity-100' : 'invisible opacity-0'}`}
      >
        {title ? <span className="block text-sm font-semibold text-fg">{title}</span> : null}
        {content}
      </span>
    </div>
  );
}
