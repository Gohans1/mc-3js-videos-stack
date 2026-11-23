import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { EASE_OUT, prefersReduced } from "../components/Motion";
import type { NoteState } from "./slice";

export const NoteExitingContext = createContext(false);

export const useNoteExiting = () => useContext(NoteExitingContext);

export type NoteMotionKind =
  "approve" | "delete" | "done" | "reopen" | "reply" | "save" | "restore";

export const NOTE_MOTION_EXIT_MS = 190;
export const NOTE_MOTION_ENTER_MS = 220;
export const NOTE_MOTION_REDUCED_MS = 110;
const SIGNAL_TTL_MS = 450;

interface PendingSignal {
  kind: NoteMotionKind;
  at: number;
}

const pending = new Map<string, PendingSignal>();

const pruneExpired = (now: number) => {
  for (const [id, s] of pending) {
    if (now - s.at > SIGNAL_TTL_MS) pending.delete(id);
  }
};

export const signalNoteAction = (id: string, kind: NoteMotionKind) => {
  const now = performance.now();
  pruneExpired(now);
  pending.set(id, { kind, at: now });
};

export const peekNoteAction = (id: string): PendingSignal | null => {
  const now = performance.now();
  const s = pending.get(id);
  if (!s) return null;
  if (now - s.at > SIGNAL_TTL_MS) {
    pending.delete(id);
    return null;
  }
  return s;
};

export const clearAllNoteActions = () => {
  pending.clear();
};

export interface ExitedEntry<T> {
  id: string;
  item: T;
  kind: NoteMotionKind;
  afterId: string | null;
}

export type AnimatedEntry<T> =
  | { exiting: false; item: T; key: string }
  | { exiting: true; id: string; item: T; kind: NoteMotionKind; key: string };

export function useExitedNotes<T>(
  items: readonly T[],
  getId: (item: T) => string,
  scopeKey: string,
  enabled = true,
): AnimatedEntry<T>[] {
  const [exiting, setExiting] = useState<ExitedEntry<T>[]>([]);
  const prevRef = useRef<{ scopeKey: string; items: readonly T[] }>({ scopeKey, items });
  const consumedAtRef = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { scopeKey, items };
    if (!enabled || prev.scopeKey !== scopeKey) {
      setExiting((cur) => (cur.length ? [] : cur));
      return;
    }
    const nextIds = new Set(items.map(getId));
    const reentered = new Set<string>();
    const newlyGone: ExitedEntry<T>[] = [];
    for (let i = 0; i < prev.items.length; i++) {
      const it = prev.items[i];
      const id = getId(it);
      if (nextIds.has(id)) continue;
      const sig = peekNoteAction(id);
      if (!sig || consumedAtRef.current.get(id) === sig.at) continue;
      consumedAtRef.current.set(id, sig.at);
      const prevId = i > 0 ? getId(prev.items[i - 1]) : null;
      newlyGone.push({ id, item: it, kind: sig.kind, afterId: prevId });
    }
    setExiting((cur) => {
      for (const e of cur) {
        if (nextIds.has(e.id)) reentered.add(e.id);
      }
      if (!newlyGone.length && reentered.size === 0) return cur;
      const kept = cur.filter((e) => !nextIds.has(e.id) && !newlyGone.some((n) => n.id === e.id));
      return [...kept, ...newlyGone];
    });
  }, [items, getId, scopeKey, enabled]);

  useEffect(() => {
    if (!exiting.length) return;
    const ms = (prefersReduced() ? NOTE_MOTION_REDUCED_MS : NOTE_MOTION_EXIT_MS) + 25;
    const ids = new Set(exiting.map((e) => e.id));
    const timer = setTimeout(() => {
      setExiting((cur) => cur.filter((e) => !ids.has(e.id)));
    }, ms);
    return () => clearTimeout(timer);
  }, [exiting]);

  return useMemo(() => {
    const liveIds = new Set(items.map(getId));
    const activeExits = enabled ? exiting.filter((e) => !liveIds.has(e.id)) : [];
    const out: AnimatedEntry<T>[] = items.map((item) => ({
      exiting: false,
      item,
      key: getId(item),
    }));
    if (!activeExits.length) return out;
    for (const ex of activeExits) {
      const entry: AnimatedEntry<T> = {
        exiting: true,
        id: ex.id,
        item: ex.item,
        kind: ex.kind,
        key: `exit:${ex.id}`,
      };
      const anchorIdx = ex.afterId
        ? out.findIndex((o) => (!o.exiting ? getId(o.item) === ex.afterId : o.id === ex.afterId))
        : -1;
      if (anchorIdx >= 0) out.splice(anchorIdx + 1, 0, entry);
      else out.unshift(entry);
    }
    return out;
  }, [items, getId, exiting, enabled]);
}

export function usePlayNoteExit(
  wrapRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  kind: NoteMotionKind,
  collapseHeight = true,
) {
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const card = cardRef.current ?? wrap;
    if (!card || typeof card.animate !== "function") return;
    const reduced = prefersReduced();
    const anims: Animation[] = [];
    if (reduced) {
      anims.push(
        card.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: NOTE_MOTION_REDUCED_MS,
          easing: EASE_OUT,
          fill: "forwards",
        }),
      );
    } else {
      const approveLike = kind === "approve" || kind === "done";
      const deleteLike = kind === "delete";
      const endTransform = approveLike
        ? "translate3d(18px, 0, 0) scale(0.965)"
        : deleteLike
          ? "translate3d(0, -4px, 0) scale(0.945)"
          : "translate3d(-14px, 0, 0) scale(0.97)";
      const ringShadow = approveLike
        ? "inset 0 0 0 1.5px var(--ok)"
        : deleteLike
          ? "inset 0 0 0 1px var(--destructive)"
          : "none";
      anims.push(
        card.animate(
          [
            {
              opacity: 1,
              transform: "translate3d(0, 0, 0) scale(1)",
              filter: "blur(0px)",
              boxShadow: ringShadow,
            },
            {
              opacity: 0,
              transform: endTransform,
              filter: "blur(1.5px)",
              boxShadow: "none",
            },
          ],
          { duration: NOTE_MOTION_EXIT_MS, easing: EASE_OUT, fill: "forwards" },
        ),
      );
      if (collapseHeight && wrap && wrap !== card && wrap.offsetHeight > 0) {
        const h = wrap.getBoundingClientRect().height;
        wrap.style.overflow = "hidden";
        anims.push(
          wrap.animate([{ height: `${h}px` }, { height: "0px" }], {
            duration: NOTE_MOTION_EXIT_MS,
            easing: EASE_OUT,
            fill: "forwards",
          }),
        );
      }
    }
    return () => {
      for (const a of anims) a.cancel();
      if (wrap) wrap.style.overflow = "";
    };
  }, [wrapRef, cardRef, kind, collapseHeight]);
}

export function useNoteSettleMotion(
  ref: RefObject<HTMLElement | null>,
  id: string,
  state: NoteState,
  enabled = true,
) {
  const prevState = useRef<NoteState>(state);
  const seenAtRef = useRef<number>(-1);

  useLayoutEffect(() => {
    const changed = prevState.current !== state;
    prevState.current = state;
    if (!enabled) return;
    const sig = peekNoteAction(id);
    const freshSig = sig && seenAtRef.current !== sig.at ? sig : null;
    if (!freshSig && !changed) return;
    if (freshSig) seenAtRef.current = freshSig.at;
    const kind: NoteMotionKind =
      freshSig?.kind ?? (state === "done" ? "done" : state === "open" ? "reopen" : "reply");
    if (kind === "delete") return;
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const reduced = prefersReduced();
    if (reduced) {
      const a = el.animate([{ opacity: 0.45 }, { opacity: 1 }], {
        duration: NOTE_MOTION_REDUCED_MS,
        easing: EASE_OUT,
      });
      return () => a.cancel();
    }
    const approveLike = kind === "approve" || kind === "done";
    const fromTransform = approveLike
      ? "translate3d(0, 5px, 0) scale(0.978)"
      : kind === "reopen" || kind === "reply"
        ? "translate3d(-10px, 0, 0) scale(0.982)"
        : "translate3d(0, 8px, 0) scale(0.97)";
    const anims: Animation[] = [
      el.animate(
        [
          { opacity: 0.25, transform: fromTransform },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        ],
        { duration: NOTE_MOTION_ENTER_MS, easing: EASE_OUT },
      ),
    ];
    if (approveLike) {
      anims.push(
        el.animate(
          [
            {
              boxShadow:
                "inset 0 0 0 1.5px var(--ok), 0 0 0 1px color-mix(in oklab, var(--ok) 32%, transparent)",
            },
            { boxShadow: "inset 0 0 0 0px transparent, 0 0 0 0px transparent" },
          ],
          { duration: 420, easing: EASE_OUT },
        ),
      );
    }
    return () => {
      for (const a of anims) a.cancel();
    };
  }, [ref, id, state, enabled]);
}

export function useNoteMotion<T extends HTMLElement = HTMLElement>(id: string, state: NoteState) {
  const ref = useRef<T>(null);
  const exiting = useContext(NoteExitingContext);
  useNoteSettleMotion(ref, id, state, !exiting);
  return { ref, exiting, noteAttr: exiting ? undefined : id };
}
