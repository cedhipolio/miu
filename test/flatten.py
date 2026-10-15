#!/usr/bin/env python3
"""6nm — A FILE THAT CAME BACK FROM SOMEWHERE ELSE, FLATTENED.

Ced: "uploading a pdf into a different platform and editing it again seems to flatten the photos in
the pdf", with the file back from the site the package had been submitted to.

Measured on that file — 18 pages, 4.1MB, our own Producer still on it:

    /Annots on every page ........ 0            every annotation stripped
    MAData / MAPhoto / MARL ...... 0            so every per-mark tag went with them
    /Subject MAREDLINE payload ... 99,934 chars, intact
    marks in it .................. 139 marks, 41 strokes — all of them
    pictures in it ............... 8, every one of them with NO pixels

So the document payload is the channel that survives a flattener, and the pictures were the one
thing not riding in it: 6ff and 6le took a photo's bytes OUT of the payload because they were also
in the photo's own annotation tag, and the tag is exactly what a flattener destroys.

`reopen.py` could never have caught this. It exports and reopens OUR file, where the annotations are
still there and serve every picture — the payload is never asked. This suite asks it, by doing to
the export what that platform did: strip every `/Annots` and nothing else.

What it demands:

  * every mark and every stroke comes back from the payload alone
  * every picture comes back and actually draws, from the recovery copy the payload now carries
  * the payload stays inside the ceiling pdf-lib can read back
  * and the tool SAYS the file had been flattened, rather than quietly showing a lower-resolution
    picture as if nothing had happened

Usage: python3 flatten.py <packed.html> <some.pdf>
"""
import asyncio, json, pathlib, re, sys, tempfile

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_flatten.html"
PACKED = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (HERE.parent / "mount-analysis-redlining-tool.html")
PDF = sys.argv[2] if len(sys.argv) > 2 else str(HERE / "sample1.pdf")

N_PHOTOS = 3
N_MARKS = 6
N_LINES = 2
# 6le measured pdf-lib giving up on a 1,035,409-character string. The export's own ceiling is
# 900,000, so anything at or over that means the shedding loop did not run.
PAYLOAD_CEILING = 900_000


def make_photo(path, seed):
    """An incompressible picture, so a pass cannot come from PNG happening to squash it."""
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(seed)
    Image.fromarray(rng.integers(0, 256, (820, 1180, 3), dtype=np.uint8)).save(path)


def flatten(src, dst):
    """Do to the file exactly what the other platform did: take every annotation off every page and
    change nothing else. The /Info dictionary — and so the payload — is left alone, because that is
    what came back on Ced's file."""
    import pypdf
    r = pypdf.PdfReader(str(src))
    w = pypdf.PdfWriter()
    for pg in r.pages:
        if "/Annots" in pg:
            del pg["/Annots"]
        w.add_page(pg)
    if r.metadata:
        w.add_metadata({k: str(v) for k, v in r.metadata.items()})
    with open(dst, "wb") as f:
        w.write(f)
    # and prove the flatten actually happened
    r2 = pypdf.PdfReader(str(dst))
    left = sum(len(p.get("/Annots") or []) for p in r2.pages)
    subj = str((r2.metadata or {}).get("/Subject") or "")
    return left, len(subj)


async def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="miu-flatten-"))
    photos = []
    for i in range(N_PHOTOS):
        p = tmp / f"photo{i}.png"
        make_photo(p, 17 + i)
        photos.append(p)
    WRAP.write_text("<!doctype html><html><head></head><body>\n"
                    + PACKED.read_text(encoding="utf-8") + "\n</body></html>", encoding="utf-8")
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        await pg.add_init_script("try{localStorage.setItem('ma.echoConsole','1');}catch(e){}")
        logs = []
        pg.on("console", lambda m: logs.append(m.text[:500]))
        pg.on("pageerror", lambda e: fails.append("page error: " + str(e)[:200]))
        saved = []

        async def grab(dl):
            d = tmp / dl.suggested_filename
            await dl.save_as(str(d)); saved.append(d)
        pg.on("download", lambda dl: asyncio.create_task(grab(dl)))

        await pg.goto(WRAP.as_uri()); await pg.wait_for_timeout(2500)
        await pg.set_input_files("#file", PDF); await pg.wait_for_timeout(9000)
        await pg.evaluate("""()=>{S.annos=[];S.lines=[];S.history=[];S.future=[];clearMulti();
            selectAnno(null);selectLine(null);setMode("select");layoutAnnos();drawAllLines();}""")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)

        # a spread of marks, so the payload is asked for more than pictures
        await pg.evaluate("""([nm,nl])=>{
             for(let i=0;i<nm;i++){
               const id=(i%2)?maAddShape(0,"rect",0.06+i*0.03,0.62+ (i%3)*0.09,0.16,0.06,{})
                             :maAddTextBox(0,0.06+i*0.03,0.60+(i%3)*0.09,"NOTE "+i,0.18,0.04);
               const a=S.annos.find(z=>z.id===id); if(a){ a.col="#fa3237"; a.sw=2; }
             }
             for(let i=0;i<nl;i++) addLine(0,0.10,0.90-i*0.03,0.80,0.90-i*0.03,{});
             layoutAnnos(); drawAllLines(); }""", [N_MARKS, N_LINES])
        await pg.wait_for_timeout(500)
        for f in photos:
            await pg.set_input_files("#photoFile", str(f))
            await pg.wait_for_timeout(3200)
        await pg.evaluate("""()=>{S.annos.filter(a=>a.kind==='img').forEach((a,i)=>{
              a.srcOrig=a.src; a.ny=0.05+i*0.17; a.nx=0.05+i*0.02; }); layoutAnnos();}""")
        await pg.wait_for_timeout(600)

        before = await pg.evaluate(
            """()=>({marks:S.annos.length, lines:S.lines.length,
                     pics:S.annos.filter(a=>a.kind==='img')
                        .map(a=>({id:a.id, srcLen:(a.src||'').length}))})""")
        print(f"before export: {before['marks']} marks, {before['lines']} strokes, "
              f"{len(before['pics'])} pictures")
        if len(before["pics"]) != N_PHOTOS:
            fails.append(f"only {len(before['pics'])} of {N_PHOTOS} photos were added")

        await pg.evaluate("()=>{const b=document.querySelector('#dlPdf'); if(b)b.click();}")
        for _ in range(40):
            await pg.wait_for_timeout(1000)
            if saved: break
        if not saved:
            print("no export came out; last log lines:")
            for l in logs[-12:]: print("   ", l)
            fails.append("the export produced no file")
            await b.close()
            print(f"\n{len(fails)} FAILING:\n  - " + "\n  - ".join(fails)); sys.exit(1)

        out = saved[0]
        pay = 0
        for l in logs:
            m = re.search(r"re-edit payload is (\d+) chars", l)
            if m: pay = int(m.group(1))
        print(f"exported {out.name}: {len(out.read_bytes()):,} bytes · payload {pay:,} chars")
        if pay >= PAYLOAD_CEILING:
            fails.append(f"the payload is {pay} chars, at or past the {PAYLOAD_CEILING} ceiling — "
                         f"the shedding loop did not run")
        if pay < 2000:
            fails.append(f"the payload is only {pay} chars — the recovery copies are not in it")

        flat = tmp / "flattened.pdf"
        left, subjlen = flatten(out, flat)
        print(f"flattened: {left} annotation(s) left on the file, /Subject {subjlen:,} chars")
        if left:
            fails.append(f"the flatten left {left} annotations — the fixture is not what it claims")
        if subjlen < 100:
            fails.append("the flatten lost the payload too, so this proves nothing")

        pg2 = await ctx.new_page()
        logs2 = []
        pg2.on("console", lambda m: logs2.append(m.text[:500]))
        pg2.on("pageerror", lambda e: fails.append("page error on reopen: " + str(e)[:200]))
        await pg2.goto(WRAP.as_uri()); await pg2.wait_for_timeout(2500)
        await pg2.set_input_files("#file", str(flat)); await pg2.wait_for_timeout(22000)
        after = await pg2.evaluate(
            """()=>({marks:S.annos.length, lines:S.lines.length,
                     pics:S.annos.filter(a=>a.kind==='img')
                        .map(a=>({id:a.id, srcLen:(a.src||'').length})),
                     drawn:[...document.querySelectorAll('.anno .ed.imgwrap img')]
                             .filter(i=>i.naturalWidth>0).length,
                     said:((document.getElementById('status')||{}).textContent||'')})""")
        print(f"after reopening the flattened file: {after['marks']} marks, {after['lines']} strokes, "
              f"{len(after['pics'])} pictures, {after['drawn']} drawn")
        print(f"  it said: {after['said'][:200]}")

        if after["marks"] != before["marks"]:
            fails.append(f"{after['marks']} of {before['marks']} marks came back")
        if after["lines"] != before["lines"]:
            fails.append(f"{after['lines']} of {before['lines']} strokes came back")
        if len(after["pics"]) != N_PHOTOS:
            fails.append(f"{len(after['pics'])} of {N_PHOTOS} pictures came back")
        thin = [a for a in after["pics"] if a["srcLen"] < 1000]
        if thin:
            fails.append(f"{len(thin)} picture(s) came back with no pixels — the payload is not "
                         f"carrying a recovery copy")
        if after["drawn"] != N_PHOTOS:
            fails.append(f"{after['drawn']} of {N_PHOTOS} pictures actually drew on the page")
        if "flattened" not in after["said"].lower():
            fails.append("the tool did not say the file had been flattened")

        await b.close()

    print("\n" + ("MARKS AND PICTURES SURVIVE ANOTHER PLATFORM'S FLATTEN" if not fails
                  else f"{len(fails)} FAILING:\n  - " + "\n  - ".join(fails)))
    sys.exit(1 if fails else 0)


asyncio.run(main())
