export const SPRINT = 2;
const SPRINT_TAP = 0.35;
const EASE = 0.08;

const AXES: Record<string, [axis: number, sign: number]> = {
  KeyW: [0, 1],
  KeyS: [0, -1],
  KeyD: [1, 1],
  KeyA: [1, -1],
  Space: [2, 1],
  ShiftLeft: [2, -1],
  ShiftRight: [2, -1],
};
const shift = (code: string) => code.startsWith("Shift");
const CHORD_WINDOW = 0.25;

export const createFlight = (onWake?: () => void) => {
  const held = new Set<string>(),
    v = [0, 0, 0];
  let lastW = -Infinity,
    sprint = false,
    dropped = 0,
    shiftElapsed = 0,
    shiftUsed = false;
  return {
    press(code: string, at: number) {
      if (!AXES[code]) return false;
      if (held.has(code)) return true;
      held.add(code);
      if (code === "KeyW") {
        sprint = at - lastW < SPRINT_TAP;
        lastW = at;
      }
      if (shift(code) && ![...held].some((c) => c !== code && shift(c))) {
        dropped = 0;
        shiftElapsed = 0;
        shiftUsed = false;
      }
      onWake?.();
      return true;
    },
    release(code: string) {
      held.delete(code);
      if (code === "KeyW") sprint = false;
    },
    clear(immediate = false) {
      held.clear();
      sprint = false;
      shiftElapsed = 0;
      if (immediate) v.fill(0);
    },
    flying: () => held.size > 0,
    active: () => held.size > 0 || v[0] !== 0 || v[1] !== 0 || v[2] !== 0,
    chord() {
      if (shiftUsed || ![...held].some(shift)) return 0;
      shiftUsed = true;
      v[2] = 0;
      const back = shiftElapsed <= CHORD_WINDOW ? -dropped : 0;
      dropped = 0;
      return back;
    },
    step(dt: number, speed: number): [number, number, number] | null {
      const want = [0, 0, 0];
      for (const code of held) {
        if (shiftUsed && shift(code)) continue;
        const [axis, sign] = AXES[code];
        want[axis] += sign * speed * (sprint && axis < 2 ? SPRINT : 1);
      }
      const k = 1 - Math.exp(-dt / EASE);
      for (let i = 0; i < 3; i++) {
        v[i] += (want[i] - v[i]) * k;
        if (!want[i] && Math.abs(v[i]) < 0.01) v[i] = 0;
      }
      if ([...held].some(shift) && !shiftUsed) {
        shiftElapsed += dt;
        dropped += v[2] * dt;
      }
      if (!v[0] && !v[1] && !v[2]) return null;
      return [v[0] * dt, v[1] * dt, v[2] * dt];
    },
  };
};
