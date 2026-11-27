#!/usr/bin/env python3
"""Pixel-accurate frame metrics (box RGB/luma/contrast & Before/After diff/montage)."""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _load_font(size: int = 16) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
  try:
    return ImageFont.load_default(size=size)
  except TypeError:
    return ImageFont.load_default()


def _parse_rect(raw: str) -> tuple[float, float, float, float]:
  parts = [p.strip() for p in raw.split(",")]
  if len(parts) != 4:
    raise ValueError(f"Expected 4 comma-separated numbers x,y,w,h, got {raw!r}")
  try:
    vals = [float(p) for p in parts]
  except ValueError as exc:
    raise ValueError(f"Invalid number in rect {raw!r}") from exc
  if any(not math.isfinite(v) for v in vals):
    raise ValueError(f"Non-finite value in rect {raw!r}")
  return vals[0], vals[1], vals[2], vals[3]


def _srgb_to_linear(arr01: np.ndarray) -> np.ndarray:
  return np.where(arr01 <= 0.04045, arr01 / 12.92, ((arr01 + 0.055) / 1.055) ** 2.4)


def _stats(arr: np.ndarray) -> dict[str, float]:
  return {
    "mean": float(arr.mean()),
    "min": float(arr.min()),
    "max": float(arr.max()),
    "std": float(arr.std()),
    "p5": float(np.percentile(arr, 5)),
    "p95": float(np.percentile(arr, 95)),
  }


def cmd_box(image_path: str, rect_raw: str, normalized: bool) -> dict:
  p = Path(image_path)
  if not p.is_file():
    raise FileNotFoundError(f"Image not found: {image_path}")

  with Image.open(p) as im:
    rgb_im = im.convert("RGB")
    img_w, img_h = rgb_im.size
    rx, ry, rw, rh = _parse_rect(rect_raw)

    if normalized:
      if rx < 0 or ry < 0 or rw <= 0 or rh <= 0 or rx + rw > 1 + 1e-6 or ry + rh > 1 + 1e-6:
        raise ValueError(f"Normalized box x,y,w,h must fit inside 0..1: {rect_raw!r}")
      x = max(0, min(img_w - 1, int(round(rx * img_w))))
      y = max(0, min(img_h - 1, int(round(ry * img_h))))
      w = max(1, min(img_w - x, int(round(rw * img_w))))
      h = max(1, min(img_h - y, int(round(rh * img_h))))
    else:
      if not all(abs(v - round(v)) < 1e-6 for v in (rx, ry, rw, rh)):
        raise ValueError(f"Pixel box requires integers (pass --norm for 0..1): {rect_raw!r}")
      x, y, w, h = int(round(rx)), int(round(ry)), int(round(rw)), int(round(rh))
      if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > img_w or y + h > img_h:
        raise ValueError(
          f"Pixel box {x},{y},{w},{h} falls outside {img_w}x{img_h} image"
        )

    patch = np.asarray(rgb_im.crop((x, y, x + w, y + h)), dtype=np.float64)

  srgb = patch / 255.0
  lin = _srgb_to_linear(srgb)
  y_srgb = 0.2126 * srgb[:, :, 0] + 0.7152 * srgb[:, :, 1] + 0.0722 * srgb[:, :, 2]
  y_lin = 0.2126 * lin[:, :, 0] + 0.7152 * lin[:, :, 1] + 0.0722 * lin[:, :, 2]

  min_lin = float(y_lin.min())
  max_lin = float(y_lin.max())
  p5_lin = float(np.percentile(y_lin, 5))
  p95_lin = float(np.percentile(y_lin, 95))

  return {
    "image": str(p),
    "size": {"width": img_w, "height": img_h},
    "normalized": normalized,
    "box": {"x": x, "y": y, "w": w, "h": h},
    "pixelCount": w * h,
    "meanRgb": [
      float(patch[:, :, 0].mean()),
      float(patch[:, :, 1].mean()),
      float(patch[:, :, 2].mean()),
    ],
    "srgbLuma": _stats(y_srgb),
    "linearLuma": _stats(y_lin),
    "dynamicRange": {
      "wcagContrastRatio": (max_lin + 0.05) / (min_lin + 0.05),
      "p95ToP5Ratio": (p95_lin + 0.05) / (p5_lin + 0.05),
      "stops": math.log2(max(max_lin, 1e-6) / max(min_lin, 1e-6)),
      "lumaSpan": float(y_srgb.max() - y_srgb.min()),
    },
  }


def cmd_compare(
  before_path: str,
  after_path: str,
  out_path: str | None,
  threshold: float,
) -> dict:
  if not math.isfinite(threshold) or threshold < 0 or threshold > 255:
    raise ValueError(f"Threshold must be in 0..255, got {threshold}")

  pb = Path(before_path)
  pa = Path(after_path)
  if not pb.is_file():
    raise FileNotFoundError(f"Before image not found: {before_path}")
  if not pa.is_file():
    raise FileNotFoundError(f"After image not found: {after_path}")

  with Image.open(pb) as im_b, Image.open(pa) as im_a:
    before_rgb = im_b.convert("RGB")
    after_rgb = im_a.convert("RGB")
    size_mismatch = before_rgb.size != after_rgb.size
    if size_mismatch:
      before_rgb = before_rgb.resize(after_rgb.size, Image.Resampling.BILINEAR)

    w, h = after_rgb.size
    arr_b = np.asarray(before_rgb, dtype=np.float64)
    arr_a = np.asarray(after_rgb, dtype=np.float64)

    abs_diff = np.abs(arr_a - arr_b)
    changed_mask = np.max(abs_diff, axis=2) > threshold
    changed_pixels = int(np.count_nonzero(changed_mask))
    total_pixels = int(w * h)
    changed_pct = (changed_pixels / total_pixels) * 100.0 if total_pixels else 0.0
    mean_abs_delta = float(abs_diff.mean())
    max_delta = float(abs_diff.max())

    written: str | None = None
    if out_path:
      header_h = 36
      gap = 12
      sheet = Image.new("RGB", (w * 2 + gap, h + header_h), (24, 24, 28))
      sheet.paste(before_rgb, (0, header_h))
      sheet.paste(after_rgb, (w + gap, header_h))
      draw = ImageDraw.Draw(sheet)
      draw.rectangle([w, header_h, w + gap - 1, h + header_h - 1], fill=(45, 45, 52))
      font = _load_font(15)
      draw.text((8, 9), "BEFORE", fill=(210, 214, 224), font=font)
      draw.text(
        (w + gap + 8, 9),
        f"AFTER ({changed_pct:.2f}% changed, mean delta {mean_abs_delta:.2f})",
        fill=(255, 224, 130),
        font=font,
      )
      dest = Path(out_path)
      dest.parent.mkdir(parents=True, exist_ok=True)
      save_kwargs = {"quality": 92} if dest.suffix.lower() in {".jpg", ".jpeg"} else {}
      sheet.save(dest, **save_kwargs)
      written = str(dest)

  return {
    "before": str(pb),
    "after": str(pa),
    "size": {"width": w, "height": h},
    "sizeMismatchResizedBefore": size_mismatch,
    "threshold": float(threshold),
    "changedPixels": changed_pixels,
    "totalPixels": total_pixels,
    "changedPct": changed_pct,
    "meanAbsDelta": mean_abs_delta,
    "maxDelta": max_delta,
    "out": written,
  }


def _luma(arr: np.ndarray) -> np.ndarray:
  return arr[..., 0] * 0.2126 + arr[..., 1] * 0.7152 + arr[..., 2] * 0.0722


def _sharpness(luma: np.ndarray) -> float:
  """Variance of the 4-neighbour Laplacian (Pech-Pacheco 2000): it falls as an image blurs. Only comparable between
  pictures of the same content at the same size."""
  if luma.shape[0] < 3 or luma.shape[1] < 3:
    return 0.0
  lap = (
    luma[:-2, 1:-1] + luma[2:, 1:-1] + luma[1:-1, :-2] + luma[1:-1, 2:] - 4 * luma[1:-1, 1:-1]
  )
  return float(lap.var())


def _tones(arr: np.ndarray) -> dict[str, float]:
  luma = _luma(arr)
  hi = arr.max(axis=2)
  sat = np.where(hi > 0, (hi - arr.min(axis=2)) / np.maximum(hi, 1e-9), 0.0)
  p = lambda a, q: round(float(np.percentile(a, q)), 2)  # noqa: E731
  return {
    "lumaP5": p(luma, 5),
    "lumaP50": p(luma, 50),
    "lumaP95": p(luma, 95),
    "satP50": p(sat, 50),
    "satP95": p(sat, 95),
    "sharpness": round(_sharpness(luma), 2),
  }


def _ratio(ours: float, ref: float) -> float | None:
  return round(ours / ref, 3) if ref > 1e-9 else None


def cmd_vs(
  ref_path: str,
  ours_path: str,
  out_path: str | None,
  picture_height: int | None,
  region_raw: str | None,
) -> dict:
  """The reference frame beside ours at the size of ours (the picture alone, without a draft's strip): tones, and
  sharpness to tell a blur from a lower resolution."""
  with Image.open(ref_path) as im_r, Image.open(ours_path) as im_o:
    ours = im_o.convert("RGB")
    if picture_height:
      if picture_height > ours.height:
        raise ValueError(f"--picture-height {picture_height} is taller than {ours_path} ({ours.height})")
      ours = ours.crop((0, 0, ours.width, picture_height))
    ref = im_r.convert("RGB").resize(ours.size, Image.Resampling.LANCZOS)
  w, h = ours.size
  arr_r = np.asarray(ref, dtype=np.float64)
  arr_o = np.asarray(ours, dtype=np.float64)
  tr, to = _tones(arr_r), _tones(arr_o)
  out: dict = {
    "size": {"width": w, "height": h},
    "reference": {"metrics": tr},
    "ours": {"metrics": to},
    "sharpnessRatio": _ratio(to["sharpness"], tr["sharpness"]),
    "meanAbsDelta": round(float(np.abs(arr_o - arr_r).mean()), 2),
  }
  box = None
  if region_raw:
    x, y, rw, rh = _parse_rect(region_raw)
    if not (0 <= x < 1 and 0 <= y < 1 and 0 < rw <= 1 - x + 1e-9 and 0 < rh <= 1 - y + 1e-9):
      raise ValueError(f"--region {region_raw}: x,y,w,h in 0..1 inside the frame")
    box = (round(x * w), round(y * h), max(round(x * w) + 3, round((x + rw) * w)), max(round(y * h) + 3, round((y + rh) * h)))
    part_r, part_o = arr_r[box[1]:box[3], box[0]:box[2]], arr_o[box[1]:box[3], box[0]:box[2]]
    sr, so = _sharpness(_luma(part_r)), _sharpness(_luma(part_o))
    rgb = lambda a: [round(float(v), 1) for v in a.reshape(-1, 3).mean(axis=0)]  # noqa: E731
    lr, lo = float(_luma(part_r).mean()), float(_luma(part_o).mean())
    out["region"] = {
      "rect": region_raw, "reference": round(sr, 2), "ours": round(so, 2), "sharpnessRatio": _ratio(so, sr),
      "rgb": {"reference": rgb(part_r), "ours": rgb(part_o)},
      "luma": {"reference": round(lr, 1), "ours": round(lo, 1)}, "lumaRatio": _ratio(lo, lr),
    }
  if out_path:
    header_h, gap = 36, 12
    diff = Image.fromarray(np.clip(np.abs(arr_o - arr_r) * 3, 0, 255).astype(np.uint8))
    sheet = Image.new("RGB", (w * 3 + gap * 2, h + header_h), (24, 24, 28))
    font = _load_font(15)
    draw = ImageDraw.Draw(sheet)
    for i, (im, label) in enumerate([(ref, "REFERENCE"), (ours, "OURS"), (diff, "DIFF x3")]):
      sheet.paste(im, (i * (w + gap), header_h))
      draw.text((i * (w + gap) + 8, 9), label, fill=(210, 214, 224), font=font)
      if box:
        draw.rectangle([i * (w + gap) + box[0], header_h + box[1], i * (w + gap) + box[2] - 1, header_h + box[3] - 1], outline=(255, 224, 130))
    dest = Path(out_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, **({"quality": 92} if dest.suffix.lower() in {".jpg", ".jpeg"} else {}))
    out["out"] = str(dest)
  return out


def main() -> int:
  parser = argparse.ArgumentParser(
    prog="frame_metrics.py",
    description="Pixel-accurate frame inspection and before/after comparison.",
  )
  sub = parser.add_subparsers(dest="cmd", required=True)

  p_box = sub.add_parser("box", help="Measure RGB, luma and contrast in an image rectangle")
  p_box.add_argument("image", help="Path to image")
  p_box.add_argument("rect", help="x,y,w,h (pixels, or 0..1 with --norm)")
  p_box.add_argument("--norm", action="store_true", help="Interpret rect as normalized 0..1")

  p_cmp = sub.add_parser("compare", help="Compare two images and optionally write Before/After sheet")
  p_cmp.add_argument("before", help="Before image path")
  p_cmp.add_argument("after", help="After image path")
  p_cmp.add_argument("--out", help="Output path for labelled side-by-side comparison")
  p_cmp.add_argument("--threshold", type=float, default=4.0, help="Changed-pixel threshold (0..255)")

  p_vs = sub.add_parser("vs", help="A reference frame beside ours: tones, sharpness, diff sheet")
  p_vs.add_argument("reference", help="The reference frame (PNG)")
  p_vs.add_argument("ours", help="Our still or poster")
  p_vs.add_argument("--out", help="Output path for the reference | ours | diff sheet")
  p_vs.add_argument("--picture-height", type=int, help="Lines of picture in ours, above a draft's strip")
  p_vs.add_argument("--region", help="x,y,w,h in 0..1: sharpness, mean colour and brightness there too")

  p_vs_batch = sub.add_parser("vs-batch", help="Run multiple vs comparisons from a JSON manifest in one Python process")
  p_vs_batch.add_argument("manifest", help="Path to JSON array of {reference, ours, out?, pictureHeight?, region?}")

  args = parser.parse_args()
  try:
    if args.cmd == "box":
      out = cmd_box(args.image, args.rect, args.norm)
    elif args.cmd == "vs":
      out = cmd_vs(args.reference, args.ours, args.out, args.picture_height, args.region)
    elif args.cmd == "vs-batch":
      jobs = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
      out = [
        cmd_vs(
          j["reference"],
          j["ours"],
          j.get("out"),
          j.get("pictureHeight"),
          j.get("region"),
        )
        for j in jobs
      ]
    else:
      out = cmd_compare(args.before, args.after, args.out, args.threshold)
  except (FileNotFoundError, ValueError, OSError, KeyError, TypeError) as exc:
    print(f"error: {exc}", file=sys.stderr)
    return 2

  print(json.dumps(out))
  return 0


if __name__ == "__main__":
  sys.exit(main())
