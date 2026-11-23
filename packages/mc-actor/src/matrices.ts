// @ts-nocheck
export function updaterTo(root, targets) {
  const want = new Set();
  for (const t of targets)
    for (let o = t; o; o = o.parent) {
      want.add(o);
      if (o === root) break;
    }
  const chain = [];
  root.traverse((o) => {
    if (want.has(o)) chain.push(o);
  });
  return () => {
    for (const o of chain) {
      if (o.matrixAutoUpdate) o.updateMatrix();
      if (o.matrixWorldAutoUpdate)
        if (o.parent === null) o.matrixWorld.copy(o.matrix);
        else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      o.matrixWorldNeedsUpdate = false;
    }
  };
}
