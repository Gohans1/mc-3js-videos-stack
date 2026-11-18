import { isIP } from "node:net";

const isNonGlobalIpv4 = (a: number, b: number, c: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && (c === 0 || c === 2)) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113) ||
  a >= 224;

const parseIpv6Groups = (raw: string): number[] | null => {
  let addr = raw;
  let v4Tail: number[] | null = null;
  if (addr.includes(".")) {
    const lastColon = addr.lastIndexOf(":");
    if (lastColon < 0) return null;
    const octs = addr
      .slice(lastColon + 1)
      .split(".")
      .map(Number);
    if (octs.length !== 4 || octs.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
      return null;
    v4Tail = [(octs[0] << 8) | octs[1], (octs[2] << 8) | octs[3]];
    addr = addr.slice(0, lastColon);
    if (addr.endsWith(":")) addr += "0";
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parseSide = (s: string) =>
    s ? s.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? Number.parseInt(h, 16) : -1)) : [];
  const left = parseSide(halves[0]);
  const right = halves.length === 2 ? parseSide(halves[1]) : [];
  if (left.includes(-1) || right.includes(-1)) return null;
  const targetGroups = v4Tail ? 6 : 8;
  let groups: number[];
  if (halves.length === 2) {
    const fill = targetGroups - left.length - right.length;
    if (fill < 1) return null;
    groups = [...left, ...Array(fill).fill(0), ...right];
  } else {
    if (left.length !== targetGroups) return null;
    groups = left;
  }
  return v4Tail ? [...groups, ...v4Tail] : groups;
};

export const isNonGlobalIp = (rawAddr: string): boolean => {
  const clean = rawAddr
    .replace(/^\[|\]$/g, "")
    .split("%")[0]
    .toLowerCase();
  const ver = isIP(clean);
  if (ver === 4) {
    const [a, b, c] = clean.split(".").map(Number);
    return isNonGlobalIpv4(a, b, c);
  }
  if (ver === 6) {
    const g = parseIpv6Groups(clean);
    if (!g || g.length !== 8) return true;
    const zeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
    if (zeroPrefix && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true;
    if (zeroPrefix && (g[5] === 0xffff || g[5] === 0)) {
      return isNonGlobalIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8);
    }
    if (g[0] === 0x0064 && g[1] === 0xff9b) {
      return isNonGlobalIpv4(g[6] >> 8, g[6] & 0xff, g[7] >> 8);
    }
    if (g[0] === 0x2002) {
      return isNonGlobalIpv4(g[1] >> 8, g[1] & 0xff, g[2] >> 8);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true;
    if ((g[0] & 0xffc0) === 0xfe80) return true;
    if ((g[0] & 0xff00) === 0xff00) return true;
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
    return false;
  }
  return true;
};
