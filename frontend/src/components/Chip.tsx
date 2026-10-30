import { motion } from 'framer-motion';

interface ChipProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
}

/** A single click-to-select pill, used inside a {@link ChipGroup}. */
export function Chip({ label, selected, onSelect }: ChipProps) {
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      whileTap={{ scale: 0.96 }}
      animate={{ scale: selected ? 1.03 : 1 }}
      transition={{ duration: 0.15 }}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        selected
          ? 'border-primary bg-primary-soft text-primary-soft-fg shadow-soft'
          : 'border-border bg-surface text-fg hover:border-primary/40 hover:bg-surface-muted'
      }`}
    >
      {label}
    </motion.button>
  );
}
