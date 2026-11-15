import { X } from "lucide-react";

/** Removable filter pill shared between the Sound and Voice library headers. */
export function AudioFilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      aria-label={`Clear ${label} filter`}
      className="bg-tint border-primary/35 text-tag text-primary-text hover:bg-tint-hover focus-visible:ring-ring studio-press inline-flex h-6 flex-none items-center gap-1 rounded-full border px-2 font-medium transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none pointer-coarse:min-h-9"
    >
      <span>{label}</span>
      <X aria-hidden className="size-2.5" />
    </button>
  );
}
