// The search box over a library (sounds, objects, animations). What is typed stays in the box: the studio's shortcuts never see it
import { cn } from "cn";
import { Search } from "lucide-react";

export function SearchBox({ name, value, onChange, label, placeholder, className }: {
  name: string; value: string; onChange: (q: string) => void; label: string; placeholder: string; className?: string;
}) {
  return (
    <label className={cn("relative flex flex-none items-center", className)}>
      <Search aria-hidden className="pointer-events-none absolute start-2.5 size-4 text-muted-foreground" />
      <input
        type="search" name={name} autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
        className="h-8 w-full rounded-md border border-input bg-background ps-8.5 pe-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:h-10 pointer-coarse:text-base"
      />
    </label>
  );
}
