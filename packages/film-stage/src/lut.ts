import { LookupTexture } from "postprocessing";
import { FloatType } from "three";
import { LUT3dlLoader } from "three/addons/loaders/LUT3dlLoader.js";
import { LUTCubeLoader } from "three/addons/loaders/LUTCubeLoader.js";

export function readLUT(source: string, format: "cube" | "3dl" = "cube") {
  const input = source
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[\t ]+/g, " "))
    .join("\n");
  const grid = format === "3dl" ? input.match(/^\d+(?: +\d+)+$/m)?.[0] : null;
  const size =
    format === "cube" ? Number(input.match(/^LUT_3D_SIZE +(\d+)$/m)?.[1]) : grid?.split(" ").length;
  if (!size || size < 2 || size > 65)
    throw new Error("Use a 3D LUT with 2–65 samples per color channel");
  if (format === "3dl" && size === 3)
    throw new Error("Three-sample 3DL grids are unsupported; export this LUT as .cube");
  const points = [...input.matchAll(/^([\d.e+-]+) +([\d.e+-]+) +([\d.e+-]+) *$/gm)];
  const count = points.length;
  if (
    count !== size ** 3 ||
    points.some((p) => p.slice(1).some((v) => !Number.isFinite(Number(v))))
  )
    throw new Error(`The LUT needs ${size ** 3} complete RGB entries`);
  const cube = format === "cube" ? new LUTCubeLoader().setType(FloatType).parse(input) : null;
  const parsed = cube ?? new LUT3dlLoader().setType(FloatType).parse(input);
  const texture = new LookupTexture(parsed.texture3D.image.data as Float32Array, size);
  if (cube) {
    if (
      cube.domainMin
        .toArray()
        .some((v, i) => !Number.isFinite(v) || v >= cube.domainMax.toArray()[i])
    )
      throw new Error("The LUT input domain must increase on every channel");
    texture.domainMin.copy(cube.domainMin);
    texture.domainMax.copy(cube.domainMax);
  }
  texture.name = cube?.title ?? "";
  return texture;
}
