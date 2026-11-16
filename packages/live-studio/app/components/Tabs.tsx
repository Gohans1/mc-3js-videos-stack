import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface TabsContextValue {
  baseId: string;
  value: string | null;
  fallbackValue: string | null;
  onValueChange?: (value: string) => void;
  registerTab: (value: string, el: HTMLButtonElement | null) => void;
  setListEl: (el: HTMLDivElement | null) => void;
  setIndicatorEl: (el: HTMLSpanElement | null) => void;
  syncIndicator: () => void;
  syncTabStop: () => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

const useTabs = () => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used inside <Tabs.Root>");
  return ctx;
};

function assignRef<T>(ref: Ref<T> | undefined, val: T | null) {
  if (typeof ref === "function") ref(val);
  else if (ref && "current" in ref) (ref as { current: T | null }).current = val;
}

function measureRelative(el: HTMLElement, ancestor: HTMLElement) {
  let left = 0,
    top = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== ancestor) {
    left += cur.offsetLeft;
    top += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight };
}

function Root({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string | null;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const baseId = useId();
  const tabsRef = useRef(new Map<string, HTMLButtonElement>());
  const listElRef = useRef<HTMLDivElement | null>(null);
  const indicatorElRef = useRef<HTMLSpanElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onValueChange);
  const wasHiddenRef = useRef(true);
  const rafRef = useRef(0);
  const [fallback, setFallback] = useState<{ forValue: string | null; tab: string | null }>({
    forValue: null,
    tab: null,
  });

  useLayoutEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onValueChange;
  }, [value, onValueChange]);

  const syncTabStop = useCallback(() => {
    const cur = valueRef.current;
    const activeEl = cur !== null ? tabsRef.current.get(cur) : undefined;
    if (activeEl && !activeEl.disabled && activeEl.getAttribute("aria-disabled") !== "true") {
      setFallback((prev) => (prev.tab === null ? prev : { forValue: cur, tab: null }));
      return;
    }
    const first = listElRef.current?.querySelector<HTMLButtonElement>(
      '[role="tab"]:not([disabled]):not([aria-disabled="true"])',
    );
    const tab = first?.dataset.tabValue ?? null;
    setFallback((prev) =>
      prev.forValue === cur && prev.tab === tab ? prev : { forValue: cur, tab },
    );
  }, []);

  const syncIndicator = useCallback(() => {
    const ind = indicatorElRef.current;
    const list = listElRef.current;
    if (!ind || !list) return;
    const curVal = valueRef.current;
    const active = curVal !== null ? tabsRef.current.get(curVal) : undefined;
    if (!active) {
      ind.hidden = true;
      wasHiddenRef.current = true;
      return;
    }
    const { left, top, width, height } = measureRelative(active, list);
    if (width <= 0 || height <= 0) {
      ind.hidden = true;
      wasHiddenRef.current = true;
      return;
    }
    const firstReveal = wasHiddenRef.current;
    if (firstReveal) {
      ind.style.transition = "none";
      wasHiddenRef.current = false;
    }
    ind.hidden = false;
    ind.style.setProperty("--active-tab-left", `${left}px`);
    ind.style.setProperty("--active-tab-top", `${top}px`);
    ind.style.setProperty("--active-tab-width", `${width}px`);
    ind.style.setProperty("--active-tab-height", `${height}px`);
    if (firstReveal) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (indicatorElRef.current) indicatorElRef.current.style.transition = "";
      });
    }
  }, []);

  const prevValueRef = useRef<string | null>(value);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    syncTabStop();
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (typeof ResizeObserver !== "undefined") return;
    }
    syncIndicator();
  }, [value, syncIndicator, syncTabStop]);

  useEffect(() => {
    if (prevValueRef.current !== value && value !== null) {
      const list = listElRef.current;
      const active = tabsRef.current.get(value);
      if (list && active && list.scrollWidth > list.clientWidth) {
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    prevValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      syncIndicator();
    });
    roRef.current = ro;
    if (listElRef.current) ro.observe(listElRef.current);
    for (const el of tabsRef.current.values()) ro.observe(el);
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [syncIndicator]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const registerTab = useCallback(
    (v: string, el: HTMLButtonElement | null) => {
      const prev = tabsRef.current.get(v);
      if (prev && prev !== el) roRef.current?.unobserve(prev);
      if (el) {
        tabsRef.current.set(v, el);
        if (prev !== el) {
          roRef.current?.observe(el);
          if (mountedRef.current) {
            syncTabStop();
            syncIndicator();
          }
        }
      } else if (prev) {
        tabsRef.current.delete(v);
        if (mountedRef.current) {
          syncTabStop();
          syncIndicator();
        }
      }
    },
    [syncIndicator, syncTabStop],
  );

  const setListEl = useCallback((el: HTMLDivElement | null) => {
    if (listElRef.current && listElRef.current !== el) roRef.current?.unobserve(listElRef.current);
    listElRef.current = el;
    if (el) roRef.current?.observe(el);
  }, []);

  const setIndicatorEl = useCallback((el: HTMLSpanElement | null) => {
    indicatorElRef.current = el;
    if (!el) wasHiddenRef.current = true;
  }, []);

  const stableOnChange = useCallback((v: string) => {
    onChangeRef.current?.(v);
  }, []);

  const fallbackValue = fallback.forValue === value ? fallback.tab : null;

  const ctx = useMemo<TabsContextValue>(
    () => ({
      baseId,
      value,
      fallbackValue,
      onValueChange: stableOnChange,
      registerTab,
      setListEl,
      setIndicatorEl,
      syncIndicator,
      syncTabStop,
    }),
    [
      baseId,
      value,
      fallbackValue,
      stableOnChange,
      registerTab,
      setListEl,
      setIndicatorEl,
      syncIndicator,
      syncTabStop,
    ],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div data-slot="tabs" className={className}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function List({ className, children, onKeyDown, ref, ...props }: ComponentPropsWithRef<"div">) {
  const { setListEl } = useTabs();
  const listRef = useRef<HTMLDivElement | null>(null);

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      setListEl(el);
      assignRef(ref, el);
    },
    [setListEl, ref],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const list = listRef.current;
    if (!list) return;
    const key = e.key;
    if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
    const items = Array.from(
      list.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not([disabled]):not([aria-disabled="true"])',
      ),
    );
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = idx;
    if (key === "ArrowRight") next = idx < 0 ? 0 : (idx + 1) % items.length;
    else if (key === "ArrowLeft")
      next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = items.length - 1;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div
      ref={attach}
      role="tablist"
      tabIndex={-1}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}

function Tab({
  value,
  disabled,
  className,
  children,
  onClick,
  ref: forwardedRef,
  ...props
}: ComponentPropsWithRef<"button"> & { value: string }) {
  const {
    baseId,
    value: current,
    fallbackValue,
    onValueChange,
    registerTab,
    syncTabStop,
  } = useTabs();
  const active = current === value;
  const tabStop = !disabled && (active || fallbackValue === value);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    syncTabStop();
  }, [disabled, syncTabStop]);
  const attach = useCallback(
    (el: HTMLButtonElement | null) => {
      registerTab(value, el);
      assignRef(forwardedRef, el);
    },
    [value, registerTab, forwardedRef],
  );
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!e.defaultPrevented && !disabled) onValueChange?.(value);
  };
  return (
    <button
      ref={attach}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      data-tab-value={value}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={tabStop ? 0 : -1}
      disabled={disabled}
      data-active={active ? "" : undefined}
      onClick={handleClick}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

function Indicator({ className, children, ...props }: ComponentPropsWithoutRef<"span">) {
  const { setIndicatorEl } = useTabs();
  return (
    <span
      ref={setIndicatorEl}
      role="presentation"
      aria-hidden
      hidden
      className={className}
      {...props}
    >
      {children}
    </span>
  );
}

function Panel({
  value,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div"> & { value: string }) {
  const { baseId } = useTabs();
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={className}
      {...props}
    >
      {children}
    </div>
  );
}

export const Tabs = { Root, List, Tab, Indicator, Panel };
