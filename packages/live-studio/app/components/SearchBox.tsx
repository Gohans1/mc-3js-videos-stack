import { Search } from "lucide-react";
import { useId } from "react";

// The search box over a library (sounds, objects, animations). What is typed stays in the box: the studio's shortcuts never see it
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function SearchBox({
  name,
  value,
  onChange,
  onEscape,
  label,
  placeholder,
  className,
}: {
  name: string;
  value: string;
  onChange: (q: string) => void;
  onEscape?: () => void;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("relative flex flex-none items-center", className)}>
      <Search
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute start-2.5 size-4"
      />
      <Input
        id={id}
        size="search"
        type="search"
        name={name}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !value && onEscape) onEscape();
        }}
      />
    </label>
  );
}
