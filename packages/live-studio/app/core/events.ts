const listeners = new Map<(e: Event) => void, string>();
let source: EventSource;
const open = () => {
  source = new EventSource("/api/events");
  for (const [listener, event] of listeners) source.addEventListener(event, listener);
  source.addEventListener("error", () => {
    if (source.readyState === EventSource.CLOSED) setTimeout(open, 3000);
  });
};
open();
export const onEvent = (event: string, run: (data: string) => void) => {
  const listener = (e: Event) => run((e as MessageEvent<string>).data);
  listeners.set(listener, event);
  source.addEventListener(event, listener);
  return () => {
    listeners.delete(listener);
    source.removeEventListener(event, listener);
  };
};

const built = document.querySelector<HTMLMetaElement>('meta[name="live-build"]')?.content;
let hellos = 0,
  lastBuild = "";
onEvent("hello", (build) => {
  hellos++;
  lastBuild = build;
});
export const onHello = (run: (current: boolean, reconnect: boolean) => void) => {
  if (hellos) run(lastBuild === built, false);
  onEvent("hello", (build) => run(build === built, hellos > 1));
};
