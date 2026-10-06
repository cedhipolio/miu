#!/usr/bin/env python3
"""Does the page on screen match the page in the file?

Ced: "make sure the shapes on the UI are exactly the shape on what's being exported."

The tool draws every mark twice — once in the browser (CSS boxes and an SVG overlay) and once in the
exported PDF (appearance streams written by hand) — so the two can drift apart in a dozen small ways:
a border drawn inside its box on screen and centred on the path in the file, a corner radius on one
side only, a text inset, a hatch at a different step.

This measures it. The same marks are drawn at known places on page 1; the page element is
screenshotted at 1:1 and the exported PDF is rendered at 72 dpi, which is the same pixel grid. Every
mark's own ink is then found in BOTH images and its bounding box compared, in pixels.
"""
import argparse, asyncio, json, pathlib, subprocess, sys
from PIL import Image
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_wysiwyg.html"

# the marks, in normalised page coordinates, each in its own band so their ink cannot overlap
MARKS = """
  S.annos=[]; S.lines=[]; layoutAnnos(); drawAllLines();
  const mk=(fn)=>{ const id=fn(); return id; };
  const out=[];
  const put=(name,id)=>{ const a=S.annos.find(z=>z.id===id); out.push({name,id,
      nx:a.nx,ny:a.ny,nw:a.nw,nh:a.nh}); };
  let id;
  id=maAddShape(0,"rect",0.10,0.10,0.30,0.08,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=3; a.fill="#ffffff"; a.fillOp=1; }
  put("rect3pt",id);
  id=maAddShape(0,"rect",0.55,0.10,0.30,0.08,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=1; a.fill="#ffffff"; a.fillOp=1; }
  put("rect1pt",id);
  id=maAddShape(0,"ellipse",0.10,0.24,0.30,0.10,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=3; a.fill="#ffffff"; a.fillOp=1; }
  put("ellipse",id);
  id=maAddShape(0,"rect",0.55,0.24,0.30,0.10,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1;
    a.pat="diag"; a.patCol="#fa3237"; }
  put("hatched",id);
  id=maAddTextBox(0,0.10,0.40,"MOUNT NOTE",0.30,0.05);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=12; a.bgNone=true; }
  put("textbox",id);
  const lid=addLine(0,0.55,0.42,0.85,0.42,{col:"#fa3237",sw:3});
  { const l=S.lines.find(z=>z.id===lid); l.le0=""; l.le1="arrow"; }
  /* 6gf — the ENDINGS, at a thin width, which is where the screen and the file drifted apart */
  const heads=["arrow","oarrow","square","diamond","circle","harrow"];
  heads.forEach((k,n)=>{
    const y=0.78+n*0.024;
    const q=addLine(0,0.12,y,0.44,y,{col:"#fa3237",sw:1.5});
    const l=S.lines.find(z=>z.id===q); l.le0=k; l.le1=k;
    out.push({name:"end_"+k,id:q,nx:0.12,ny:y-0.012,nw:0.32,nh:0.024});
  });
  /* 6gj — and the three TIP SIZES, which multiply that size in both renderers */
  [[0.68,"small"],[1.5,"large"]].forEach((t,n)=>{
    const y=0.78+n*0.030;
    const q=addLine(0,0.55,y,0.86,y,{col:"#fa3237",sw:1.5});
    const l=S.lines.find(z=>z.id===q); l.le0="arrow"; l.le1="arrow"; l.leSz=t[0];
    out.push({name:"tip_"+t[1],id:q,nx:0.53,ny:y-0.015,nw:0.35,nh:0.030});
  });
  /* the ones most likely to drift: a turned box, a dashed one, and a box with text in it */
  id=maAddShape(0,"rect",0.12,0.52,0.22,0.09,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=3; a.fill="#ffffff"; a.fillOp=1;
    a.rot=25; }
  put("rotated",id);
  id=maAddShape(0,"rect",0.55,0.52,0.28,0.09,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1;
    a.dash="dash"; }
  put("dashed",id);
  id=maAddShape(0,"rect",0.12,0.66,0.32,0.08,{text:"AS-BUILT"});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1;
    a.text="AS-BUILT"; a.size=12; a.align="center"; }
  put("shapetext",id);
  id=maAddShape(0,"ellipse",0.55,0.66,0.30,0.06,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=1.5; a.fill="#ffffff"; a.fillOp=1; }
  put("ellipseflat",id);
  /* 6gg — a LENGTH: a run with an arrow at each end and its reading written on it, which is a stroke
     and a text mark that have to agree with the file together */
  /* 6ir — ON ITS OWN ROW. The length was placed at y=0.90, which is exactly where `end_harrow` is
     drawn: two different marks on the same line, so what the comparison measured was whichever of
     them happened to be on top, in each renderer, and it agreed only by luck. */
  { const dl=maPlaceDim(0,0.55,0.90,0.86,0.90);
    out.push({name:"length",id:dl,nx:0.53,ny:0.874,nw:0.37,nh:0.052});
    selectLine(null); selectAnno(null); }
  layoutAnnos(); drawAllLines();
  return out;
"""


def ink_box(im, box):
    """Where the red ink is inside `box`, and how much of it there is.

    The edges come from pixels that are unambiguously our ink. The AMOUNT is measured as coverage —
    the sum of each pixel's redness — rather than a count of pixels over a threshold: a browser and
    poppler antialias a 1.5pt line quite differently, and counting thresholded pixels makes the
    thinner-looking renderer look like it drew 40% less ink when both drew the same line.
    """
    x0, y0, x1, y1 = [int(v) for v in box]
    crop = im.crop((x0, y0, x1, y1)).convert("RGB")
    px = crop.load()
    w, h = crop.size
    minx, miny, maxx, maxy, cover = w, h, -1, -1, 0.0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            red = (r - max(g, b)) / 255.0
            if red > 0.05:
                cover += red
            if r > 120 and r - g > 55 and r - b > 55:        # our red ink, not the printed page
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
    if maxx < 0:
        return None
    return {"l": x0 + minx, "t": y0 + miny, "r": x0 + maxx, "b": y0 + maxy, "n": round(cover, 1)}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed")
    ap.add_argument("pdf")
    ap.add_argument("--out", default="/tmp/claude-0/wys")
    ap.add_argument("--zoom", type=float, default=1.0)
    a = ap.parse_args()
    outdir = pathlib.Path(a.out); outdir.mkdir(parents=True, exist_ok=True)

    body = pathlib.Path(a.packed).read_text(encoding="utf-8")
    WRAP.write_text("<!doctype html><html><head></head><body>\n" + body + "\n</body></html>",
                    encoding="utf-8")
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1500, "height": 1100},
                                  device_scale_factor=1, accept_downloads=True)
        page = await ctx.new_page()
        saved = []

        async def grab(dl):
            dest = outdir / "export.pdf"
            await dl.save_as(str(dest)); saved.append(str(dest))

        page.on("download", lambda dl: asyncio.create_task(grab(dl)))
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await page.goto(WRAP.as_uri()); await page.wait_for_timeout(2500)
        await page.set_input_files("#file", a.pdf); await page.wait_for_timeout(9000)
        await page.evaluate("maPanelOpen(false); gotoPageInstant(0);")
        await page.evaluate("(z)=>setZoom(z)", a.zoom)
        await page.wait_for_timeout(800)
        marks = await page.evaluate("()=>{" + MARKS + "}")
        await page.wait_for_timeout(600)
        box = await page.evaluate(
            """()=>{const p=document.querySelector('.page[data-idx="0"]');
                    return {w:p.offsetWidth,h:p.offsetHeight};}""")
        # the new text box is focused and its text selected, which the browser paints blue over the
        # ink — blur it, drop the selection, and only then take the picture
        await page.evaluate("""()=>{ try{document.activeElement.blur();}catch(e){}
                                     try{getSelection().removeAllRanges();}catch(e){}
                                     selectAnno(null); selectLine(null); clearMulti(); }""")
        # the sticky ribbon and the floating bars are drawn OVER the page element, and an element
        # screenshot captures whatever is painted on top of it — so they have to go away first or the
        # top of the sheet is measured through the chrome
        await page.evaluate("""()=>{ ["toolbar","miniBar","annobar","linebar","multibar","saveStrip",
                                      "ribbonPeek","markR"].forEach(id=>{
                                       const e=document.getElementById(id); if(e)e.style.display="none"; });
                                     document.querySelectorAll("header.app,.selbar,.toolpop")
                                       .forEach(e=>e.style.display="none"); }""")
        await page.wait_for_timeout(300)
        el = await page.query_selector('.page[data-idx="0"]')
        await el.screenshot(path=str(outdir / "screen.png"))
        await page.evaluate("()=>exportPdf()")
        await page.wait_for_timeout(6000)
        await b.close()

    if not saved:
        print("no export came back"); sys.exit(1)
    # 72 dpi = 1pt per pixel = the page element's own pixel grid at zoom 1
    subprocess.run(["pdftoppm", "-f", "1", "-l", "1", "-r", "72", "-png",
                    str(outdir / "export.pdf"), str(outdir / "pdf")], check=True)
    pdfpng = sorted(outdir.glob("pdf-*.png"))[0]
    scr = Image.open(outdir / "screen.png")
    pdf = Image.open(pdfpng)
    print("screen", scr.size, "pdf", pdf.size)

    W, H = box["w"], box["h"]
    rows = []
    for m in marks:
        pad = 26
        b0 = (max(0, m["nx"] * W - pad), max(0, m["ny"] * H - pad),
              min(W, (m["nx"] + (m["nw"] or 0)) * W + pad),
              min(H, (m["ny"] + (m["nh"] or 0)) * H + pad))
        s = ink_box(scr, b0)
        # the pdf render can differ by a pixel in size; scale the window to it
        kx, ky = pdf.size[0] / scr.size[0], pdf.size[1] / scr.size[1]
        b1 = (b0[0] * kx, b0[1] * ky, b0[2] * kx, b0[3] * ky)
        d = ink_box(pdf, b1)
        if not s or not d:
            rows.append({"mark": m["name"], "screen": s, "pdf": d, "ok": False}); continue
        # both boxes in POINTS: the screen is `zoom` pixels per point, the pdf render is one
        # points per screen pixel: the pdf render is 1px per point, the screen is `zoom` px per point
        zs = scr.size[0] / pdf.size[0]
        diff = {k: round((d[k] / (kx if k in "lr" else ky)) / zs - s[k] / zs, 1)
                for k in ("l", "t", "r", "b")}
        worst = max(abs(v) for v in diff.values())
        # ink area, per point², so the two are comparable whatever the zoom
        ink = {"screen": round(s["n"] / (zs * zs)), "pdf": round(d["n"])}
        rows.append({"mark": m["name"], "diff_pt": diff, "worst_pt": worst,
                     # GEOMETRY is the test: every edge within a point. Coverage is reported beside
                     # it and only fails on a gross mismatch — a missing head, a dropped fill — because
                     # a browser and poppler antialias a thin stroke differently enough to move the
                     # measured coverage by half either way with the same geometry.
                     "ok": worst <= 1.5 and (ink["pdf"] == 0 or
                           abs(ink["screen"] - ink["pdf"]) <= max(60, 0.6 * ink["pdf"])),
                     "ink_pt2": ink})
    print(json.dumps(rows, indent=1))
    bad = [r for r in rows if not r["ok"]]
    print(f"\n{len(bad)} of {len(rows)} marks differ by more than 1.5pt of edge, or grossly in ink")
    if errs:
        print("page errors:", errs[:3])
    sys.exit(1 if bad else 0)


asyncio.run(main())
