#!/usr/bin/env python3
"""Export a document with photo redlines on it, open the exported file again, and ask whether the
photos came back.

Ced: "the photo redlines are not being kept when a pdf was reopened on the tool."

This suite exists because the fault it catches has now happened TWICE for the same reason, and both
times it was invisible until a real file came back empty. A photo's pixels live in its annotation's
own appearance stream; carrying a second copy in the re-edit payload or in the mark's tag pushes
those strings past what pdf-lib's `decodeText()` can read back — it spreads a string's code units
through `String.fromCharCode` and throws `RangeError` somewhere past a million and a half — and an
unreadable payload loses every mark in it. 6fg found it through `src`; 6le found `srcOrig` and
`picRaw` doing the same thing afterwards.

So this measures the two numbers that matter — how long the payload is and how long each photo's tag
is — and then proves the round trip with the pictures themselves. A fourth field holding pixels will
fail this on the length alone, before anybody has to notice a missing photo.

Usage: python3 reopen.py <packed.html> <some.pdf>
"""
import asyncio, json, pathlib, re, sys, tempfile

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_reopen.html"
PACKED = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else (HERE.parent / "mount-analysis-redlining-tool.html")
PDF = sys.argv[2] if len(sys.argv) > 2 else str(HERE.parent / "SOH3361 - Redlined Mount Analysis.pdf")

N_PHOTOS = 3
# Measured in 6le: pdf-lib stopped being able to read a 1,035,409-character tag. A million is under
# that and far over anything a legitimate tag holds — with the pictures left out, three photos came
# to 1,226 characters of payload in total.
TAG_CEILING = 1_000_000
PAYLOAD_CEILING = 1_000_000


def make_photo(path):
    """An incompressible picture, so the test cannot be passed by PNG happening to squash it."""
    try:
        import numpy as np
        from PIL import Image
        rng = np.random.default_rng(11)
        Image.fromarray(rng.integers(0, 256, (900, 1300, 3), dtype=np.uint8)).save(path)
        return True
    except Exception as e:
        print("  ! could not build a test photo:", e)
        return False


def tag_lengths(pdf_bytes):
    """Every /MAPhoto string's length, straight out of the file."""
    out = []
    for m in re.finditer(rb"/MAPhoto\s*\(", pdf_bytes):
        i = m.end(); depth = 1
        while i < len(pdf_bytes) and depth:
            c = pdf_bytes[i]
            if c == 0x5C:
                i += 2; continue
            if c == 0x28: depth += 1
            elif c == 0x29: depth -= 1
            i += 1
        out.append(i - m.end())
    return out


async def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="miu-reopen-"))
    photo = tmp / "photo.png"
    if not make_photo(photo):
        sys.exit(2)
    WRAP.write_text("<!doctype html><html><head><script>window.__MIU_SINGLE=1</script></head><body>\n"
                    + PACKED.read_text(encoding="utf-8") + "\n</body></html>", encoding="utf-8")
    fails = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        await pg.add_init_script("try{localStorage.setItem('ma.echoConsole','1');}catch(e){}")
        logs = []
        pg.on("console", lambda m: logs.append(m.text[:400]))
        pg.on("pageerror", lambda e: fails.append("page error: " + str(e)[:200]))
        saved = []

        async def grab(dl):
            d = tmp / dl.suggested_filename
            await dl.save_as(str(d)); saved.append(d)
        pg.on("download", lambda dl: asyncio.create_task(grab(dl)))

        await pg.goto(WRAP.as_uri()); await pg.wait_for_timeout(2500)
        await pg.set_input_files("#file", PDF); await pg.wait_for_timeout(8000)
        await pg.evaluate("""()=>{S.annos=[];S.lines=[];S.history=[];S.future=[];clearMulti();
            selectAnno(null);selectLine(null);setMode("select");layoutAnnos();drawAllLines();}""")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)

        for _ in range(N_PHOTOS):
            await pg.set_input_files("#photoFile", str(photo))
            await pg.wait_for_timeout(3500)
        # the picture editor leaves `srcOrig` on every photo it has touched (6gs) — one line of setup
        # rather than driving the editor, because what is under test is the SAVING, not the editing.
        await pg.evaluate("""()=>{S.annos.filter(a=>a.kind==='img').forEach((a,i)=>{
              a.srcOrig=a.src; a.ny=0.05+i*0.24; a.nx=0.05+i*0.02; }); layoutAnnos();}""")
        await pg.wait_for_timeout(600)
        before = await pg.evaluate("""()=>S.annos.filter(a=>a.kind==='img')
            .map(a=>({id:a.id, srcLen:(a.src||'').length, origLen:(a.srcOrig||'').length}))""")
        print("before export:", json.dumps(before))
        if len(before) != N_PHOTOS:
            fails.append(f"only {len(before)} photos were added")

        await pg.evaluate("()=>{const b=document.querySelector('#dlPdf'); if(b)b.click();}")
        for _ in range(40):
            await pg.wait_for_timeout(1000)
            if saved: break
        if not saved:
            print("no export came out; last log lines:")
            for l in logs[-12:]: print("   ", l)
            fails.append("the export produced no file")
        else:
            out = saved[0]
            data = out.read_bytes()
            print(f"exported {out.name}: {len(data)} bytes")
            pay = 0
            for l in logs:
                m = re.search(r"re-edit payload is (\d+) chars", l)
                if m: pay = int(m.group(1))
            tags = tag_lengths(data)
            print(f"  payload {pay} chars · MAPhoto tags {tags}")
            if pay >= PAYLOAD_CEILING:
                fails.append(f"the re-edit payload is {pay} chars — past what pdf-lib can read back "
                             f"(6le); a picture is riding in it")
            for t in tags:
                if t >= TAG_CEILING:
                    fails.append(f"a photo's tag is {t} chars — past what pdf-lib can read back "
                                 f"(6le); a picture is riding in it")
                    break

            pg2 = await ctx.new_page()
            logs2 = []
            pg2.on("console", lambda m: logs2.append(m.text[:400]))
            pg2.on("pageerror", lambda e: fails.append("page error on reopen: " + str(e)[:200]))
            await pg2.goto(WRAP.as_uri()); await pg2.wait_for_timeout(2500)
            await pg2.set_input_files("#file", str(out)); await pg2.wait_for_timeout(20000)
            after = await pg2.evaluate("""()=>S.annos.filter(a=>a.kind==='img')
                .map(a=>({id:a.id, srcLen:(a.src||'').length}))""")
            shown = await pg2.evaluate(
                """()=>[...document.querySelectorAll('.anno .ed.imgwrap img')]
                       .filter(i=>i.naturalWidth>0).length""")
            print("after reopen:", json.dumps(after), "· img elements drawn:", shown)
            if len(after) != N_PHOTOS:
                fails.append(f"{len(after)} of {N_PHOTOS} photos came back")
            if any(a["srcLen"] < 1000 for a in after):
                fails.append("a photo came back without its picture")
            if shown != N_PHOTOS:
                fails.append(f"{shown} of {N_PHOTOS} photos actually drew on the page")
        await b.close()

    print("\n" + ("PHOTOS SURVIVE A REOPEN" if not fails
                  else f"{len(fails)} FAILING:\n  - " + "\n  - ".join(fails)))
    sys.exit(1 if fails else 0)


asyncio.run(main())
