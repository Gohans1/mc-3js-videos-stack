// The free camera's flying keys, Minecraft's creative flight: W A S D level with the floor, Space up, Shift down,
// W pressed twice quickly sprints. Held like a game's: moved every frame by the time that passed, so the speed doesn't depend
// on the keyboard's repeat rate (half a second of nothing, then ~30 small steps a second) or on the frame rate
export const SPRINT = 2; // Minecraft's sprint flying: 21.8 blocks a second against 10.9
const SPRINT_TAP = 0.35; // seconds between the two W presses: Minecraft's 7 ticks
const EASE = 0.08; // seconds to get most of the way to full speed, and to stop

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
const CHORD_WINDOW = 0.25; // past this, Shift is an intentional dive rather than a key chord

export const createFlight = (onWake?: () => void) => {
  const held = new Set<string>(),
    v = [0, 0, 0];
  let lastW = -Infinity,
    sprint = false,
    dropped = 0,
    shiftElapsed = 0,
    shiftUsed = false;
  return {
    // Takes the key (true) only if it flies. at: seconds, for the W double press; a held key's repeats change nothing
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
    clear() {
      held.clear();
      sprint = false;
      shiftElapsed = 0;
    },
    flying: () => held.size > 0,
    active: () => held.size > 0 || v[0] !== 0 || v[1] !== 0 || v[2] !== 0,
    // A shortcut started right as Shift went down (Shift+K): climbs back out of any brief dip within CHORD_WINDOW; never rubber-bands an intentional descent
    chord() {
      if (shiftUsed || ![...held].some(shift)) return 0;
      shiftUsed = true;
      v[2] = 0;
      const back = shiftElapsed <= CHORD_WINDOW ? -dropped : 0;
      dropped = 0;
      return back;
    },
    // How far to move this frame as [forward, right, up], or null once standing still
    step(dt: number, speed: number): [number, number, number] | null {
      const want = [0, 0, 0];
      for (const code of held) {
        if (shiftUsed && shift(code)) continue;
        const [axis, sign] = AXES[code];
        want[axis] += sign * speed * (sprint && axis < 2 ? SPRINT : 1); // like Minecraft's, the sprint is level only
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
