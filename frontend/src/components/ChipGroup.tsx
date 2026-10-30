import { Chip } from './Chip';

export interface ChipOption {
  id: string;
  label: string;
}

interface ChipGroupProps {
  ariaLabel: string;
  options: ChipOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When this id is selected, a free-text fallback input is shown below the grid. */
  otherId?: string;
  otherValue?: string;
  onOtherValueChange?: (value: string) => void;
  otherInputLabel?: string;
}

const INPUT_CLASS =
  'w-full rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-fg outline-none focus:border-primary';

/** A single-select grid of click-to-choose chips, with an optional "other" text fallback. */
export function ChipGroup({
  ariaLabel,
  options,
  selectedId,
  onSelect,
  otherId,
  otherValue = '',
  onOtherValueChange,
  otherInputLabel,
}: ChipGroupProps) {
  const showOtherInput = otherId !== undefined && selectedId === otherId;

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            selected={selectedId === option.id}
            onSelect={() => {
              onSelect(option.id);
            }}
          />
        ))}
      </div>
      {showOtherInput ? (
        <label className="block space-y-1.5 text-left">
          <span className="text-sm font-medium text-fg">{otherInputLabel}</span>
          <input
            autoFocus
            className={INPUT_CLASS}
            value={otherValue}
            onChange={(event) => {
              onOtherValueChange?.(event.target.value);
            }}
          />
        </label>
      ) : null}
    </div>
  );
}
