#!/usr/bin/env python3
"""Build the Insert-photo mark out of the two Ced sent.

Ced: "make this icon the insert photo icon but replace the camera as the a file icon as this
one" — the bracketed frame from the Snapshot mark, with his folder where the camera was. Both
halves are his drawing; nothing here is redrawn.

The work is done on the ARTWORK's own pixels rather than on two traced paths, so the frame and
the folder are rasterised together and traced once: one consistent contour, one tolerance, and
no seam where two separately-fitted outlines meet.

  python3 tools/composeicon.py <camera.png> <folder.png>

The camera is found as the largest connected blob that does not touch the border; the brackets
are everything else. The folder is scaled to that blob's box, keeping its aspect, and centred in
it. Prints the path data, ready for MA_ICONS.
"""
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage


def ink_of(path, thresh=128):
    arr = np.asarray(Image.open(path).convert("RGBA")).astype(np.int16)
    lum = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    return (lum < thresh) & (arr[..., 3] > 32)


def main():
    cam_png, fol_png = sys.argv[1], sys.argv[2]
    cam = ink_of(cam_png)
    fol = ink_of(fol_png)

    lab, n = ndimage.label(cam)
    H, W = cam.shape
    best, best_n = None, 0
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        touches = xs.min() <= 1 or ys.min() <= 1 or xs.max() >= W - 2 or ys.max() >= H - 2
        if touches:
            continue                      # a bracket, not the subject
        if len(xs) > best_n:
            best_n, best = len(xs), (k, xs.min(), xs.max() + 1, ys.min(), ys.max() + 1)
    if best is None:
        print("could not find the camera", file=sys.stderr)
        return 1
    k, cx0, cx1, cy0, cy1 = best

    # everything that is NOT the camera's own blob is the frame — including the lens hole's blob,
    # which is inside it, so drop any blob whose box sits inside the camera's.
    frame = np.zeros_like(cam)
    for j in range(1, n + 1):
        if j == k:
            continue
        ys, xs = np.nonzero(lab == j)
        if xs.min() >= cx0 and xs.max() < cx1 and ys.min() >= cy0 and ys.max() < cy1:
            continue                      # part of the camera (the lens)
        frame[lab == j] = True

    # the folder, scaled into the camera's box, aspect kept, centred
    ys, xs = np.nonzero(fol)
    fx0, fx1, fy0, fy1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    sub = Image.fromarray((fol[fy0:fy1, fx0:fx1] * 255).astype(np.uint8))
    bw, bh = cx1 - cx0, cy1 - cy0
    s = min(bw / sub.width, bh / sub.height)
    nw, nh = max(1, int(round(sub.width * s))), max(1, int(round(sub.height * s)))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    put = np.asarray(sub) > 128
    ox = cx0 + (bw - nw) // 2
    oy = cy0 + (bh - nh) // 2
    out = frame.copy()
    out[oy:oy + nh, ox:ox + nw] |= put

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
        Image.fromarray(np.where(out, 0, 255).astype(np.uint8)).convert("RGBA").save(t.name)
        tmp = t.name
    r = subprocess.run([sys.executable, "tools/traceicon.py", tmp, "--eps", "1.1"],
                       capture_output=True, text=True)
    sys.stderr.write(r.stderr)
    sys.stdout.write(r.stdout)
    return r.returncode


sys.exit(main())
