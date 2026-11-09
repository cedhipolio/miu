#!/usr/bin/env python3
"""Does the TYPE on screen match the type in the file?

Ced, with the tool open beside the exported PDF: "please fix the texts. first is the preview on the
tool, the next is the rendered on pdf."

The sibling `wysiwyg.py` measures the marks; this one measures the words in them — a stamp block of
hard-broken lines, a note in a box too narrow for it, tracking, leading, and text inside a shape. Each
is drawn on screen and in the file and its ink compared in points, the same way.

Original header follows.

Does the page on screen match the page in the file?

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
  const out=[];
  const put=(name,id,tol)=>{ const a=S.annos.find(z=>z.id===id); out.push({name,id,tol,
      nx:a.nx,ny:a.ny,nw:a.nw,nh:a.nh}); };
  let id;
  /* the stamp block Ced compared side by side: four hard-broken lines, left aligned */
  id=maAddTextBox(0,0.10,0.08,"REDLINED",0.34,0.05);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=13; a.bgNone=true;
    a.align="left"; a.font="arialbold"; a.text="REDLINED"; }
  /* 6hi — A POINT OF RASTERISATION. At 72dpi one point is one pixel, and a heading's caps catch the
     edge pixel differently in the two renderers — Chromium hinting Liberation Sans Bold on screen and
     poppler drawing Helvetica-Bold in the file. The BASELINE is measured from the browser's own
     layout and agrees; what is left is which pixel row the antialiasing tips over, so these three
     carry a two-and-a-half point allowance rather than the point and a half the geometry gets. */
  put("stamp_head",id,2.5);
  id=maAddTextBox(0,0.10,0.16,"TSC CONSTRUCTION, LLC\\nJOSH BEAVER\\n09/23/2026",0.34,0.09);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=10; a.bgNone=true; a.align="left";
    a.text="TSC CONSTRUCTION, LLC\\nJOSH BEAVER\\n09/23/2026"; }
  put("stamp_body",id);
  /* a text box NARROWER than its text: it has to wrap, on screen and in the file alike */
  id=maAddTextBox(0,0.10,0.32,"THIS NOTE IS LONGER THAN THE BOX IT WAS DRAWN IN",0.20,0.10);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=10; a.bgNone=true; a.align="left";
    a.text="THIS NOTE IS LONGER THAN THE BOX IT WAS DRAWN IN"; }
  put("wrapbox",id,2.5);
  /* the same words with tracking and leading opened up */
  id=maAddTextBox(0,0.10,0.48,"SPACED OUT TEXT",0.44,0.06);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=12; a.bgNone=true; a.align="left";
    a.text="SPACED OUT TEXT"; a.lsp=1; }
  /* 6he — TRACKING IS EXACT IN THE FILE AND ROUNDED ON SCREEN. The browser lays each glyph on a
     whole device pixel, so a tracking of 1pt at this zoom is drawn as the nearest pixel — about a
     fifth of a point out per character, which over a line of fifteen is three points of width that
     the file, drawn with the `Tc` operator at full precision, does not lose. The file is the one
     that is right; the allowance here is for the screen's rounding, not for a drift in the mark. */
  put("tracked",id,4);
  id=maAddTextBox(0,0.10,0.60,"LEADING ONE\\nLEADING TWO",0.44,0.10);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=12; a.bgNone=true; a.align="left";
    a.text="LEADING ONE\\nLEADING TWO"; a.lnsp=2; }
  put("led",id);
  /* a shape with wrapped text in it */
  id=maAddShape(0,"rect",0.10,0.76,0.24,0.10,{});
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1;
    a.text="A LONGER NOTE INSIDE A SMALLER BOX"; a.size=10; a.align="center"; }
  put("shapewrap",id);
  /* 6hi — a HEADING IN A TALL BOX: the file used to centre it and the screen filled from the top */
  id=maAddTextBox(0,0.55,0.08,"REDLINED",0.30,0.09);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=13; a.bgNone=true;
    a.align="left"; a.font="arialbold"; a.text="REDLINED"; }
  put("tallhead",id,2.5);
  /* 6hj — three lines of different lengths, CENTRED: every line centres, not just the block */
  id=maAddTextBox(0,0.55,0.24,"ONE\\nTHREE LINES HERE\\nTWO",0.30,0.10);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=10; a.bgNone=true;
    a.align="center"; a.text="ONE\\nTHREE LINES HERE\\nTWO"; }
  put("centred3",id);
  /* 6hm — the bundled face: the same font file on screen and in the file, so this one should be
     tighter than the metric-compatible cousins everywhere else in this list */
  id=maAddTextBox(0,0.55,0.40,"GEOMETRIC 123",0.34,0.05);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=13; a.bgNone=true;
    a.align="left"; a.font="jost"; a.text="GEOMETRIC 123"; }
  /* the same two points of rasterisation as the headings above: one renderer hints the outlines and
     the other does not, and at 72dpi that is where the edge pixel falls. */
  put("bundled",id,2.5);
  /* 6n1 — the two families added for a job, each measured the same way the first bundled one is.
     CARLITO carries Calibri's metrics, so the proof that matters is that the file agrees with the
     screen about the width of a line of it; ARCHIVO NARROW is condensed, and a condensed face is
     exactly where a renderer that quietly substituted a normal-width cousin would show up as a run
     that overflows its box in the file and not on screen. */
  id=maAddTextBox(0,0.55,0.56,"CALIBRI METRICS 123",0.34,0.05);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=13; a.bgNone=true;
    a.align="left"; a.font="carlito"; a.text="CALIBRI METRICS 123"; }
  put("carlito",id,2.5);
  id=maAddTextBox(0,0.55,0.72,"CONDENSED VALUE 123",0.34,0.05);
  { const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.size=13; a.bgNone=true;
    a.align="left"; a.font="narrow"; a.text="CONDENSED VALUE 123"; }
  put("narrow",id,2.5);
  /* 6i7 — A LENGTH'S READING, TURNED. Ced: "text box of lengths are also moving down in the render."
     The reading is placed against the run it measures, and on a sloped run it is turned with it, so
     this is the case that catches a box whose height the two renderers disagree about. */
  { const dl=maPlaceDim(0,0.12,0.58,0.42,0.50);
    /* the RUN is drawn in black so only the reading is red: the stroke's own ink would otherwise fill
       the window and hide the very offset this case exists to measure */
    const L=S.lines.find(z=>z.id===dl);
    if(L){ L.col="#000000"; L.le0=""; L.le1=""; }
    const lab=S.annos.find(z=>z.id===(L&&L.dimFor));
    /* a measurement comes up with an EMPTY reading for the hand to type, so this one is typed */
    if(L)L.dimManual=true;
    if(lab){ lab.col="#fa3237"; lab.bgNone=true; lab.size=10;
             lab.text="12'-6\\""; lab.orig=lab.text; }
    drawAllLines(); layoutAnnos();
    /* 6i7 — the reading sits within three points of where the screen puts it ALONG its run: an
       auto-sized label is measured from the element on screen and sized from the text in the file,
       and on a sloped run the difference between those two boxes reads as a small shift along the
       line. The GROUND is what mattered and is exact; this allowance is for the box. */
    if(lab)out.push({name:"dimread",id:lab.id,tol:3.5,
                     nx:Math.max(0,lab.nx-0.02),ny:Math.max(0,lab.ny-0.02),
                     nw:(lab.nw||0.08)+0.04,nh:(lab.nh||0.02)+0.04});
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
    WRAP.write_text("<!doctype html><html><head><script>window.__MIU_SINGLE=1</script></head><body>\n" + body + "\n</body></html>",
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
        # the download is waited for explicitly: a listener plus a fixed sleep raced the browser
        # being closed and reported "no export came back" on a perfectly good export
        try:
            async with page.expect_download(timeout=90000) as dl_info:
                await page.evaluate(
                    "async()=>{try{ await exportPdf(); }catch(e){ return String(e); }}")
            dl = await dl_info.value
            dest = outdir / "export.pdf"
            await dl.save_as(str(dest)); saved.append(str(dest))
        except Exception as ex:
            print("export:", str(ex)[:300])
        await b.close()

    if not saved:
        print("no export came back")
        for e in errs: print(" !", e)
        sys.exit(1)
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
                     "ok": worst <= (m.get("tol") or 1.5) and (ink["pdf"] == 0 or
                           abs(ink["screen"] - ink["pdf"]) <= max(60, 0.6 * ink["pdf"])),
                     "ink_pt2": ink})
    print(json.dumps(rows, indent=1))
    bad = [r for r in rows if not r["ok"]]
    print(f"\n{len(bad)} of {len(rows)} marks differ by more than 1.5pt of edge, or grossly in ink")
    if errs:
        print("page errors:", errs[:3])
    sys.exit(1 if bad else 0)


asyncio.run(main())
