#!/usr/bin/env python3
"""Trace one of Ced's black-on-white icon marks into a single 24-unit SVG path.

Ced: "just use the logo is sent no need to replicate it." Redrawing a mark by eye gets the
idea and loses the drawing — the camera's corner radii, the exact gap in the bracket frame,
how thick the folder's back plate is. This takes the artwork itself.

Like `tracelogo.py` these marks are GEOMETRY, not photographs: every edge is a straight run
or a circular arc, so the contour is simplified with Douglas-Peucker at a tolerance just wide
enough to swallow the antialiased staircase. Holes are kept as their own subpaths and the whole
thing is emitted with `fill-rule:evenodd`, which is what the rest of `MA_ICONS` uses.

  python3 tools/traceicon.py <png> [--box 24] [--pad 0]

Prints the path data on one line, already scaled and centred in the box.
"""
import argparse
import sys

import numpy as np
from PIL import Image


def dp(points, eps):
    """Douglas-Peucker on a closed ring."""
    if len(points) < 3:
        return points
    first, last = 0, len(points) - 1
    keep = np.zeros(len(points), dtype=bool)
    keep[first] = keep[last] = True
    stack = [(first, last)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p0, p1 = points[a], points[b]
        seg = p1 - p0
        L = np.hypot(*seg)
        if L < 1e-9:
            d = np.hypot(*(points[a + 1:b] - p0).T)
        else:
            d = np.abs(np.cross(seg, points[a + 1:b] - p0)) / L
        if len(d) == 0:
            continue
        k = int(np.argmax(d))
        if d[k] > eps:
            keep[a + 1 + k] = True
            stack.append((a, a + 1 + k))
            stack.append((a + 1 + k, b))
    return points[keep]


def rings(mask):
    """Every closed contour in a boolean mask, outer and holes alike, via marching squares."""
    try:
        from skimage import measure
    except Exception:
        print("needs scikit-image", file=sys.stderr)
        raise
    # pad so a shape touching the edge still closes
    m = np.pad(mask.astype(float), 1)
    out = []
    for c in measure.find_contours(m, 0.5):
        pts = np.column_stack([c[:, 1] - 1, c[:, 0] - 1])      # (x, y)
        if len(pts) < 4:
            continue
        # drop the duplicated closing point, DP, then close again
        out.append(pts[:-1] if np.allclose(pts[0], pts[-1]) else pts)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--box", type=float, default=24.0)
    ap.add_argument("--pad", type=float, default=0.0)
    ap.add_argument("--eps", type=float, default=0.9, help="DP tolerance, in artwork pixels")
    ap.add_argument("--thresh", type=int, default=128)
    a = ap.parse_args()

    im = Image.open(a.png).convert("RGBA")
    arr = np.asarray(im).astype(np.int16)
    alpha = arr[..., 3]
    lum = (0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2])
    # ink = dark where the image is opaque; a transparent ground is not ink either
    ink = (lum < a.thresh) & (alpha > 32)
    if not ink.any():
        print("no ink found", file=sys.stderr)
        return 1

    ys, xs = np.nonzero(ink)
    x0, x1 = xs.min(), xs.max() + 1
    y0, y1 = ys.min(), ys.max() + 1
    sub = ink[y0:y1, x0:x1]

    inner = a.box - 2 * a.pad
    k = inner / max(sub.shape[1], sub.shape[0])
    offx = a.pad + (inner - sub.shape[1] * k) / 2
    offy = a.pad + (inner - sub.shape[0] * k) / 2

    parts = []
    for ring in rings(sub):
        r = dp(ring, a.eps)
        if len(r) < 3:
            continue
        # area in artwork pixels: drop specks the antialiasing left behind
        ar = abs(np.cross(r - r.mean(0), np.roll(r, -1, 0) - r.mean(0)).sum()) / 2
        if ar < 1.5:
            continue
        d = []
        for i, (px, py) in enumerate(r):
            X = offx + px * k
            Y = offy + py * k
            d.append(("M" if i == 0 else "L") + f"{X:.2f} {Y:.2f}")
        parts.append("".join(d) + "Z")

    print("".join(parts))
    return 0


sys.exit(main())
