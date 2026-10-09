#!/usr/bin/env python3
"""Does the COP stamp in the file read like the COP stamp on the sheet?

Ced, with the tool open beside the exported PDF: "please make sure the redlines are rendered exactly
how it was showing on the tool. look at before and after."

`wysiwyg.py` measures a mark by putting a window round it and comparing the ink inside. That is the
right instrument for a mark and the wrong one for a COP stamp, which is five marks stacked line box
against line box inside a ruled frame: a window with a pixel of padding reaches into the neighbouring
row, and a window with none lets a pixel of rounding swap two rows of very different widths. Measured
both ways, the same unmoved stamp reported 2.2pt and then 19pt.

So the stamp is measured the way a person reads it — as a block. The sheet and the file are rendered
onto ONE pixel grid at five times the size, the frame's two rules are found in each, and every band
of red ink between them is expressed as a fraction of the frame's inner height. That fraction needs
no shared resolution, only a shared frame, and the frame's own agreement is checked first.

This is the measurement Ced's two screenshots were put through. On the build he was looking at it
said:

    REDLINED    screen top 0.0720   file 0.0320    5px out, about 1.1pt
    contractor         0.3920        0.3760        2px
    contact            0.5760        0.5600        2px
    date               0.7520        0.7440        1px

every line high in the file, by more at the bigger size — the signature of a rounding error rather
than of a placement rule, and it was one: `cssBaseline` asked the browser to lay out a line at the
mark's point size read as a pixel count (4.73px for a row), where half a pixel of rounding is half a
point of the finished mark. 6l4 asks at twenty times and scales back.

Usage: python3 stampparity.py <packed.html> <some.pdf> [--zoom 5] [--tol 0.4]
"""
import argparse, asyncio, json, pathlib, subprocess, sys
from PIL import Image
import numpy as np
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_stampparity.html"
OUT = HERE / "_stampparity"

# the stamp this measures: the one Ced had on screen, with a date whose slash and digits are the
# hardest glyphs in it to place
FIELDS = {"status": "REDLINED", "gc": "TSC CONSTRUCTION LLC", "poc": "CODY HUBBARD",
          "date": "10/6/2026", "place": "tl"}


def _red(q):
    r, g, b = q[:3]
    return r > 110 and g < 120 and b < 120 and (r - max(g, b)) > 40


def frame_and_bands(im):
    """The stamp's frame, and every band of ink inside it as a fraction of its inner height.

    The frame's two rules are the widest runs of red in the picture — nothing else in a stamp spans
    it — so they are found by taking the longest run on each scanline and keeping the rows that are
    within 15% of the longest of those.
    """
    W, H = im.size
    p = im.load()
    runs = []
    for y in range(H):
        run = best = 0
        x0 = bx = None
        for x in range(W):
            if _red(p[x, y]):
                if run == 0:
                    x0 = x
                run += 1
                if run > best:
                    best, bx = run, x0
            else:
                run = 0
        runs.append((best, bx))
    mx = max(r[0] for r in runs)
    if mx < 8:
        return None
    rule = [y for y in range(H) if runs[y][0] > mx * 0.85]
    if len(rule) < 2:
        return None
    top, bot = rule[0], rule[-1]
    left = runs[top][1]
    right = left + runs[top][0]
    t = 0
    y = top
    while y < H and runs[y][0] > mx * 0.85:
        t += 1
        y += 1
    bt = 0
    y = bot
    while y >= 0 and runs[y][0] > mx * 0.85:
        bt += 1
        y -= 1
    itop, ibot = top + t, bot - bt + 1
    inner = ibot - itop
    if inner < 20:
        return None
    spans, cur = [], None
    for y in range(itop, ibot):
        n = sum(1 for x in range(left + t, right - t) if _red(p[x, y]))
        if n:
            cur = [y, y] if cur is None else [cur[0], y]
        elif cur:
            spans.append(cur)
            cur = None
    if cur:
        spans.append(cur)
    bands = []
    for a, b in spans:
        xs = [x for y in range(a, b + 1) for x in range(left + t, right - t) if _red(p[x, y])]
        bands.append({"top": (a - itop) / inner, "bot": (b + 1 - itop) / inner,
                      "left": (min(xs) - (left + t)) / inner,
                      "right": (max(xs) + 1 - (left + t)) / inner})
    return {"w": right - left, "h": bot - top, "rule": t, "inner": inner, "bands": bands}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed")
    ap.add_argument("pdf")
    ap.add_argument("--zoom", type=float, default=5.0)
    # 0.4pt: below half a point, which is where the rounding this was written for lived, and above
    # the one edge pixel that two different rasterisers will always disagree about
    ap.add_argument("--tol", type=float, default=0.4)
    # The TRAILING edge of a line is a different quantity from where the line sits. Where it starts
    # and how high it rides are placement, and placement is what this suite was written to catch.
    # Where it ENDS is the sum of every glyph's width, and the two renderers do not agree about those
    # to the last pixel: the export squeezes each line with `Tz` to the width the browser measured
    # (6ea), clamped to a few per cent, and what is left after the clamp lands on the last glyph's
    # right side bearing. Measured across the four lines of a stamp: 0.00, 0.00, +0.60 and -0.20pt —
    # one line out and no systematic lean, which is a rasteriser's arithmetic and not a bug to fix.
    ap.add_argument("--tol-right", type=float, default=1.0)
    a = ap.parse_args()

    OUT.mkdir(exist_ok=True)
    WRAP.write_text("<!doctype html><html><head></head><body>\n"
                    + pathlib.Path(a.packed).read_text(encoding="utf-8") + "\n</body></html>",
                    encoding="utf-8")

    saved, errs = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1500, "height": 1100},
                                  device_scale_factor=1, accept_downloads=True)
        page = await ctx.new_page()

        async def grab(dl):
            d = OUT / "export.pdf"
            await dl.save_as(str(d))
            saved.append(str(d))

        page.on("download", lambda dl: asyncio.create_task(grab(dl)))
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await page.goto(WRAP.as_uri())
        await page.wait_for_timeout(2500)
        await page.set_input_files("#file", a.pdf)
        await page.wait_for_timeout(9000)
        await page.evaluate("maPanelOpen(false); gotoPageInstant(0);")
        await page.evaluate("(z)=>setZoom(z)", a.zoom)
        await page.wait_for_timeout(700)
        info = await page.evaluate(
            """(F)=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const f=copFields();
                 Object.keys(F).forEach(k=>{ f[k]=F[k]; });
                 await copPlaceOn(0,f);
                 layoutAnnos(); await nap(500);
                 selectAnno(null); clearMulti();
                 const box=S.annos.find(z=>z.copRole==="box");
                 const P=S.pages[0];
                 res({nx:box.nx,ny:box.ny,nw:box.nw,nh:box.nh,w1:P.w1,
                      rows:S.annos.filter(z=>z.copRole&&z.copRole!=="box")
                            .map(z=>({role:z.copRole,text:z.text,size:+z.size.toFixed(3)}))});
               })""", FIELDS)
        # the chrome is painted over the page element; an element screenshot would capture it
        await page.evaluate(
            """()=>{ ["toolbar","miniBar","annobar","linebar","multibar","saveStrip","ribbonPeek",
                      "markR"].forEach(id=>{ const e=document.getElementById(id);
                                             if(e)e.style.display="none"; });
                     document.querySelectorAll("header.app,.selbar,.toolpop")
                       .forEach(e=>e.style.display="none"); }""")
        await page.wait_for_timeout(300)
        el = await page.query_selector('.page[data-idx="0"]')
        await el.screenshot(path=str(OUT / "screen.png"))
        pw = await page.evaluate("()=>document.querySelector('.page[data-idx=\"0\"]').offsetWidth")
        await page.evaluate("()=>exportPdf()")
        await page.wait_for_timeout(7000)
        await b.close()

    if errs:
        print("=== page errors ===")
        for e in errs:
            print(" !", e)
    if not saved:
        print("no export came back")
        sys.exit(1)

    # the file is rendered at whatever dpi puts it on the SAME pixel grid as the page element, so the
    # two pictures can be compared without either being resampled
    dpi = round(72.0 * pw / info["w1"])
    subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-r", str(dpi), "-png",
                    str(OUT / "export.pdf"), str(OUT / "pdf")], check=True)
    pdfpng = sorted(OUT.glob("pdf-*.png"))[0]
    scr = Image.open(OUT / "screen.png").convert("RGB")
    pdf = Image.open(pdfpng).convert("RGB")
    print(f"page element {pw}px for {info['w1']}pt -> the file rendered at {dpi} dpi")
    print(f"screen {scr.size}  pdf {pdf.size}")
    # ------------------------------------------------------------------------------------------
    # 6m8 — FIND THE STAMP, DO NOT ASSUME WHERE IT IS.
    # The crop used to be worked out from the stamp's `nx` on the assumption that the screenshot maps
    # one-to-one onto the page element. It does not always: an element wider than the window is
    # captured through its scrolling ancestor, and whatever is painted in the clipped margin — the
    # rail — comes with it. Measured when the reading column changed width by 62px, the screen image
    # carried 78px of rail on its left, the crop landed 78px to the left of the stamp, and a frame
    # that is demonstrably 330px wide in BOTH images was reported as 282 on screen and the whole
    # suite failed on a difference that was not there. The DOM and the file agreed throughout.
    # The frame is a red rule of known length, so it is found rather than predicted: the longest
    # horizontal red run in each image is the stamp's top edge, and the crop is taken from there.
    # `nx` is still printed, because a real move would show up as a gap between the two.
    def find_stamp(im):
        a = np.asarray(im)
        red = (a[..., 0] > 170) & (a[..., 1] < 100) & (a[..., 2] < 100)
        best = None
        for y in range(red.shape[0]):
            xs = np.nonzero(red[y])[0]
            if xs.size < 200:
                continue
            for r in np.split(xs, np.where(np.diff(xs) != 1)[0] + 1):
                if r.size >= 200 and (best is None or r.size > best[2]):
                    best = (y, int(r[0]), int(r.size))
        return best

    sfind, dfind = find_stamp(scr), find_stamp(pdf)
    print(f"stamp nx {info['nx']:.4f} -> predicted x {int(info['nx']*scr.size[0])} · "
          f"found screen {sfind and sfind[1]} pdf {dfind and dfind[1]}")
    if not sfind or not dfind:
        print("could not find the stamp's frame in one of the images")
        sys.exit(1)

    def crop_at(im, at, pad=0.01):
        W, H = im.size
        x0 = max(0, at[1] - int(pad * W))
        y0 = max(0, at[0] - int(pad * H))
        return im.crop((x0, y0,
                        min(W, x0 + at[2] + int(2 * pad * W)),
                        min(H, y0 + int((info["nh"] + 2 * pad) * H))))

    s = frame_and_bands(crop_at(scr, sfind))
    d = frame_and_bands(crop_at(pdf, dfind))
    if not s or not d:
        print(f"no stamp found: screen {bool(s)}, pdf {bool(d)}")
        sys.exit(1)

    # the frame has to agree first: it is the ruler everything else is given in
    frame_ok = abs(s["w"] - d["w"]) <= 1 and abs(s["h"] - d["h"]) <= 1
    print(f"\nframe: screen {s['w']}x{s['h']}px rule {s['rule']}  ·  "
          f"file {d['w']}x{d['h']}px rule {d['rule']}  ->  {'same' if frame_ok else 'DIFFERENT'}")

    # the inner height, in points, so the answer is in the unit every other suite reports
    inner_pt = s["inner"] / (pw / info["w1"])
    print(f"inner height {s['inner']}px = {inner_pt:.2f}pt; tolerance {a.tol}pt "
          f"({a.tol / inner_pt:.4f} of it)\n")

    names = [r["role"] for r in info["rows"]]
    bad = 0
    if len(s["bands"]) != len(d["bands"]):
        print(f"FAIL  the two do not even have the same number of lines: "
              f"screen {len(s['bands'])}, file {len(d['bands'])}")
        bad = max(len(s["bands"]), len(d["bands"]))
    else:
        print(f"  {'line':<12}{'edge':<7}{'screen':>9}{'file':>9}{'out by':>9}   pt")
        for i, (sb, db) in enumerate(zip(s["bands"], d["bands"])):
            nm = names[i] if i < len(names) else f"band {i}"
            worst = 0.0
            over = 0.0
            for k in ("top", "bot", "left", "right"):
                diff = db[k] - sb[k]
                lim = a.tol_right if k == "right" else a.tol
                worst = max(worst, abs(diff))
                over = max(over, abs(diff) * inner_pt - lim)
                print(f"  {nm if k == 'top' else '':<12}{k:<7}{sb[k]:>9.4f}{db[k]:>9.4f}"
                      f"{diff:>+9.4f}   {diff * inner_pt:+.2f}")
            if over > 0:
                bad += 1
                print(f"  {'':<12}-> FAIL, {worst * inner_pt:.2f}pt")

    print(f"\n{bad} of {len(s['bands'])} lines of the stamp are placed more than {a.tol}pt out"
          + ("" if frame_ok else ", and the frames differ too"))
    sys.exit(1 if (bad or not frame_ok) else 0)


asyncio.run(main())
