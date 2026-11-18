import { createRoot } from "react-dom/client";

import { Textarea } from "@/components/ui/textarea";

let closeActive: (() => void) | undefined;
export function openTextEditor(
  stage: HTMLElement,
  value: string,
  box: readonly number[],
  save: (value: string) => void,
) {
  closeActive?.();
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:${box[0] * 100}%;top:${box[1] * 100}%;width:${Math.max(0.15, box[2] - box[0]) * 100}%;z-index:6`;
  stage.append(host);
  const root = createRoot(host);
  let finished = false;
  const finish = (text?: string) => {
    if (finished) return;
    finished = true;
    root.unmount();
    host.remove();
    closeActive = undefined;
    if (text !== undefined && text !== value) save(text);
  };
  closeActive = () => finish();
  root.render(
    <Textarea
      aria-label="Edit text on picture"
      autoFocus
      defaultValue={value}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish();
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(e.currentTarget.value);
        }
      }}
    />,
  );
}
