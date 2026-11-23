type V = number[];
const DEFAULT_BEND: V = [0, 0, 1];

export function arcInto(
  out: V,
  pivot: V,
  a: V,
  b: V,
  k: number,
  { bend = DEFAULT_BEND }: { bend?: V } = {},
): V {
  const px = pivot[0],
    py = pivot[1],
    pz = pivot[2];
  const ax = a[0],
    ay = a[1],
    az = a[2];
  const bx = b[0],
    by = b[1],
    bz = b[2];
  const dax = ax - px,
    day = ay - py,
    daz = az - pz;
  const dbx = bx - px,
    dby = by - py,
    dbz = bz - pz;
  const ra = Math.sqrt(dax * dax + day * day + daz * daz);
  const rb = Math.sqrt(dbx * dbx + dby * dby + dbz * dbz);
  if (ra < 1e-6 || rb < 1e-6) {
    out[0] = ax + (bx - ax) * k;
    out[1] = ay + (by - ay) * k;
    out[2] = az + (bz - az) * k;
    return out;
  }
  const invA = 1 / ra,
    invB = 1 / rb;
  const ux = dax * invA,
    uy = day * invA,
    uz = daz * invA;
  const vx = dbx * invB,
    vy = dby * invB,
    vz = dbz * invB;
  const uv = ux * vx + uy * vy + uz * vz;
  const angle = Math.acos(uv < -1 ? -1 : uv > 1 ? 1 : uv);
  if (angle < 1e-4) {
    out[0] = ax + (bx - ax) * k;
    out[1] = ay + (by - ay) * k;
    out[2] = az + (bz - az) * k;
    return out;
  }
  let ex = uy * vz - uz * vy;
  let ey = uz * vx - ux * vz;
  let ez = ux * vy - uy * vx;
  let axisLen = Math.sqrt(ex * ex + ey * ey + ez * ez);
  if (axisLen < 1e-6) {
    const bnx = bend[0],
      bny = bend[1],
      bnz = bend[2];
    ex = uy * bnz - uz * bny;
    ey = uz * bnx - ux * bnz;
    ez = ux * bny - uy * bnx;
    axisLen = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (axisLen < 1e-6) {
      out[0] = ax + (bx - ax) * k;
      out[1] = ay + (by - ay) * k;
      out[2] = az + (bz - az) * k;
      return out;
    }
  }
  const invAxis = 1 / axisLen;
  ex *= invAxis;
  ey *= invAxis;
  ez *= invAxis;
  const th = k * angle,
    c = Math.cos(th),
    s = Math.sin(th),
    omc = 1 - c;
  const cxx = ey * uz - ez * uy;
  const cyy = ez * ux - ex * uz;
  const czz = ex * uy - ey * ux;
  const d = (ex * ux + ey * uy + ez * uz) * omc;
  const r = ra + (rb - ra) * k;
  out[0] = px + (ux * c + cxx * s + ex * d) * r;
  out[1] = py + (uy * c + cyy * s + ey * d) * r;
  out[2] = pz + (uz * c + czz * s + ez * d) * r;
  return out;
}

export function arc(pivot: V, a: V, b: V, k: number, opts?: { bend?: V }): V {
  return arcInto([0, 0, 0], pivot, a, b, k, opts);
}
