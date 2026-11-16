import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function NoteViewChoice<T extends string>({
  value,
  options,
  label,
  onChange,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("@container/note-choice w-full min-w-0", className)}>
      <div className="@xs/note-choice:hidden">
        <Select
          value={value}
          items={options}
          onValueChange={(next) => {
            if (next !== null) onChange(next);
          }}
        >
          <SelectTrigger aria-label={label} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" finalFocus>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <ToggleGroup
        value={[value]}
        onValueChange={(next) => {
          const option = options.find((option) => option.value === next[0]);
          if (option) onChange(option.value);
        }}
        aria-label={label}
        variant="segment"
        size="sm"
        spacing={0.5}
        className="hidden max-w-full @xs/note-choice:flex"
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
