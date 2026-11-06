// @ts-nocheck
// The print on the paper (src/timeline/props.json pages and note): useless beginner pages, so what he throws away reads as
// worthless. A page is printed in the game's font (src/gamefont.ts), ink only (transparent elsewhere), on a plane a hair
// above the model's paper face; the folders carry the same titles on a cover label with their letters (A..Z, two a folder)
import * as THREE from "three";

// Prints onto the props as they stand at the origin unturned (their boxes are the models' own extents); returns one ink
// material per page, for props.ts to swap onto a sheet as it shows a different page
export function printProps(font, { sheets, scrap, folders, pages, note }) {
  const INK = font.tinted("#262626"), GREY = font.tinted("#5d5d5d"), { lineW, print } = font;
  const inkMaterial = (canvas) => {
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.anisotropy = 8;
    return new THREE.MeshLambertMaterial({ map, transparent: true, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2 });
  };
  // a printed page: big title fitted to the width, a rule under it, then the body lines
  const pageInk = ({ title, lines }) => {
    const c = document.createElement("canvas"); c.width = 152; c.height = 200;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    const sc = Math.max(1, Math.min(4, Math.floor(136 / lineW(title))));
    print(g, INK, title, (152 - lineW(title) * sc) / 2, 12, sc);
    g.fillStyle = "#4a4a4a"; g.fillRect(12, 20 + 8 * sc, 128, 2);
    lines.forEach((l, i) => print(g, GREY, l, 14, 34 + 8 * sc + i * 22, 2));
    return inkMaterial(c);
  };
  const labelInk = (title, letters) => {
    const c = document.createElement("canvas"); c.width = 96; c.height = 72;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    g.fillStyle = "#e9e4d4"; g.fillRect(8, 8, 80, 42); g.fillStyle = "#3b3b3b"; g.fillRect(8, 8, 80, 1); g.fillRect(8, 49, 80, 1);
    const sc = lineW(title) * 2 <= 72 ? 2 : 1;
    print(g, INK, title, (96 - lineW(title) * sc) / 2, 12, sc);
    print(g, INK, letters, (96 - lineW(letters) * 2) / 2, 32, 2);
    return inkMaterial(c);
  };
  const pageMats = pages.map(pageInk);
  if (!pages.length) return pageMats;
  const sb = new THREE.Box3().setFromObject(sheets[0]), ss = sb.getSize(new THREE.Vector3());
  sheets.forEach((h, i) => {
    const ink = new THREE.Mesh(new THREE.PlaneGeometry(ss.x * 0.94, ss.z * 0.94), pageMats[i % pageMats.length]);
    ink.position.set((sb.min.x + sb.max.x) / 2, sb.max.y + 0.0006, (sb.min.z + sb.max.z) / 2);
    ink.rotation.x = -Math.PI / 2;
    h.add(ink);
    h.userData.ink = ink;
  });
  // what the scrap says (props.note), small lines filling its face
  const nb = new THREE.Box3().setFromObject(scrap), ns = nb.getSize(new THREE.Vector3());
  const nc = document.createElement("canvas"); nc.width = 240; nc.height = 306;
  const ng = nc.getContext("2d"); ng.imageSmoothingEnabled = false;
  (note?.lines ?? []).forEach((l, i) => print(ng, INK, l, 12, 12 + i * 17, 2));
  const noteInk = new THREE.Mesh(new THREE.PlaneGeometry(ns.x * 0.9, ns.z * 0.9), inkMaterial(nc));
  noteInk.position.set((nb.min.x + nb.max.x) / 2, nb.max.y + 0.0006, (nb.min.z + nb.max.z) / 2);
  noteInk.rotation.x = -Math.PI / 2;
  scrap.add(noteInk);
  const fb = new THREE.Box3().setFromObject(folders[0]), fs = fb.getSize(new THREE.Vector3());
  const az = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  folders.forEach((h, j) => {
    const mat = labelInk(pages[j % pages.length].title, `${az[2 * j]}-${az[Math.min(2 * j + 1, 25)]}`);
    for (const side of [1, -1]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(fs.x * 0.8, fs.x * 0.6), mat);
      label.position.set((fb.min.x + fb.max.x) / 2, fb.min.y + fs.y * 0.55, side > 0 ? fb.max.z + 0.0006 : fb.min.z - 0.0006);
      if (side < 0) label.rotation.y = Math.PI;
      h.add(label);
    }
  });
  return pageMats;
}
