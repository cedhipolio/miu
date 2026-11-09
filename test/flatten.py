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


def paint_flatten(src, dst, passes=2):
    """v63 — what Ced's NOH5197 / SOH1350 had been through, which is the other half of a flatten:
    every annotation's appearance stream is PAINTED into the page (`q 1 0 0 1 x y cm /FxoN Do Q`)
    and the annotations are then taken off. SOH1350 went through it twice, so `passes=2` paints
    every mark twice, exactly as that file came back."""
    import pypdf
    from pypdf.generic import NameObject, DictionaryObject, DecodedStreamObject, ArrayObject
    r = pypdf.PdfReader(str(src))
    w = pypdf.PdfWriter(clone_from=r)
    n = 0
    for pg in w.pages:
        annots = pg.get("/Annots")
        if not annots:
            continue
        res = pg["/Resources"]
        if "/XObject" not in res:
            res[NameObject("/XObject")] = DictionaryObject()
        xd = res["/XObject"]
        # like the real site: numbering carries on past forms an earlier round left in the page
        n = max([n] + [int(k[4:]) for k in xd.keys() if k.startswith("/Fxo") and k[4:].isdigit()])
        ops = []
        for _ in range(passes):
            for a in annots:
                a = a.get_object()
                ap = a.get("/AP")
                if not ap or "/N" not in ap.get_object():
                    continue
                n += 1
                nm = f"/Fxo{n}"
                xd[NameObject(nm)] = ap.get_object()["/N"]
                x, y = float(a["/Rect"][0]), float(a["/Rect"][1])
                ops.append(f"q 1 0 0 1 {x:.5f} {y:.5f} cm {nm} Do Q")
        st = DecodedStreamObject()
        st.set_data(("\n" + "\n".join(ops) + "\n").encode("latin1"))
        ref = w._add_object(st)
        cont = pg.get("/Contents")
        arr = ArrayObject()
        if isinstance(cont.get_object(), ArrayObject):
            arr.extend(cont.get_object())
        else:
            arr.append(cont)
        arr.append(ref)
        pg[NameObject("/Contents")] = arr
        del pg["/Annots"]
    with open(dst, "wb") as f:
        w.write(f)
    return n


def painted_left(path):
    """how many `/FxoN Do` are still in the pages' own content"""
    import pypdf
    r = pypdf.PdfReader(str(path))
    k = 0
    for pg in r.pages:
        c = pg.get_contents()
        if c is not None:
            k += len(re.findall(rb"/Fxo\d+\s+Do", c.get_data()))
    return k


async def main():
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="miu-flatten-"))
    photos = []
    for i in range(N_PHOTOS):
        p = tmp / f"photo{i}.png"
        make_photo(p, 17 + i)
        photos.append(p)
    WRAP.write_text("<!doctype html><html><head><script>window.__MIU_SINGLE=1</script></head><body>\n"
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
        # v64 — each picture is EDITED: the original kept as srcOrig (what Restore goes back to) and
        # a hole cut in the middle of the one on the sheet. Ced's SOH1350 came back with every edit
        # undone because the recovery copy was made from srcOrig. A hole is transparency, which the
        # recovery keeps (PNG), so "did the edit survive" is one alpha read in the middle.
        await pg.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map((a,i)=>new Promise(res=>{
              a.ny=0.05+i*0.17; a.nx=0.05+i*0.02;
              const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                g.drawImage(im,0,0); g.clearRect(c.width*0.4,c.height*0.4,c.width*0.2,c.height*0.2);
                a.srcOrig=a.src; a.src=c.toDataURL('image/png'); res(); };
              im.src=a.src; }))).then(()=>layoutAnnos())""")
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
        holes = await pg2.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map(a=>new Promise(res=>{
              const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                g.drawImage(im,0,0); res(g.getImageData(c.width>>1,c.height>>1,1,1).data[3]); };
              im.onerror=()=>res(-1); im.src=a.src; })))""")
        print(f"  the edit (a hole in the middle) survived on {sum(1 for h in holes if h==0)} of {len(holes)}")
        if any(h != 0 for h in holes):
            fails.append(f"pictures came back UNEDITED (alpha in the hole: {holes}) — the recovery "
                         f"copy is the picture before editing")
        if "flattened" not in after["said"].lower():
            fails.append("the tool did not say the file had been flattened")

        # ---- v63: the platform that PAINTS the marks in before taking the annotations off ----
        painted = tmp / "painted.pdf"
        npaint = paint_flatten(out, painted, passes=2)
        print(f"painted-in flatten: {npaint} appearance(s) painted, {painted_left(painted)} Do in the pages")
        pg3 = await ctx.new_page()
        logs3 = []
        pg3.on("console", lambda m: logs3.append(m.text[:500]))
        pg3.on("pageerror", lambda e: fails.append("page error on painted reopen: " + str(e)[:200]))
        saved.clear()
        pg3.on("download", lambda dl: asyncio.create_task(grab(dl)))
        await pg3.goto(WRAP.as_uri()); await pg3.wait_for_timeout(2500)
        await pg3.set_input_files("#file", str(painted)); await pg3.wait_for_timeout(22000)
        a3 = await pg3.evaluate("""()=>({marks:S.annos.length, lines:S.lines.length,
                     said:((document.getElementById('status')||{}).textContent||'')})""")
        holes3 = await pg3.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map(a=>new Promise(res=>{
              const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                g.drawImage(im,0,0); res([c.width, g.getImageData(c.width>>1,c.height>>1,1,1).data[3]]); };
              im.onerror=()=>res([-1,-1]); im.src=a.src; })))""")
        print(f"  painted file pictures (width, alpha in the hole): {holes3}")
        if any(h[1] != 0 for h in holes3):
            fails.append(f"painted file: pictures came back unedited {holes3}")
        if any(h[0] < 1000 for h in holes3):
            fails.append(f"painted file: pictures came back at recovery size, not the painted full size {holes3}")
        print(f"after reopening the painted file: {a3['marks']} marks, {a3['lines']} strokes")
        print(f"  it said: {a3['said'][:200]}")
        if a3["marks"] != before["marks"] or a3["lines"] != before["lines"]:
            fails.append(f"painted file: {a3['marks']}/{a3['lines']} came back, wanted "
                         f"{before['marks']}/{before['lines']}")
        # v70 — the site flattened it, so the tool offers the editable copy right there, and that one
        # button is the export: real annotations back, nothing left painted.
        offer = await pg3.evaluate("()=>{const n=document.getElementById('miuEditNote');"
                                   "return n?{txt:n.textContent, btn:!!n.querySelector('.miu-ok')}:null}")
        print(f"  editable-copy offer: {offer and offer['txt'][:90]}")
        if not offer or not offer["btn"]:
            fails.append("a site-flattened file opened without the 'Save editable copy' offer")
            await pg3.evaluate("()=>{const b=document.querySelector('#dlPdf'); if(b)b.click();}")
        else:
            await pg3.click("#miuEditNote .miu-ok")
        for _ in range(40):
            await pg3.wait_for_timeout(1000)
            if saved: break
        if saved:
            import pypdf as _pp
            _r = _pp.PdfReader(saved[0])
            _n = sum(len(pg_.get('/Annots') or []) for pg_ in _r.pages)
            print(f"  editable copy: {_n} annotation(s) other viewers can edit")
            if _n < before["marks"]:
                fails.append(f"the editable copy carries {_n} annotations, wanted at least {before['marks']}")
        if not saved:
            fails.append("the painted file would not re-export")
        else:
            left_do = painted_left(saved[0])
            print(f"re-exported: {left_do} painted copies left in the pages")
            if left_do:
                fails.append(f"{left_do} painted-in copies of our marks are still burned into the "
                             f"re-export — the redlines would show twice and could not all be edited")
        if "painted-in" not in a3["said"]:
            fails.append("the tool did not say it took the painted copies off")

        # ---- v69: round the loop twice — the newest paint of each picture is the one that counts ----
        # Ced's Mount Analysis (3): exported, flattened, reopened, edited, exported, flattened again. The
        # file carries BOTH generations of each picture's form (the old ones left in the page's
        # resources, the new ones drawn); v68 took the first of the right size it met and brought the
        # OLD picture back. Second round here: a second hole is cut in each picture, so the newest
        # generation is the one with two holes.
        await pg3.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map(a=>new Promise(res=>{
              const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                g.drawImage(im,0,0); g.clearRect(c.width*0.1,c.height*0.1,c.width*0.12,c.height*0.12);
                a.src=c.toDataURL('image/png'); res(); }; im.src=a.src; }))).then(()=>layoutAnnos())""")
        saved.clear()
        await pg3.evaluate("()=>{const b=document.querySelector('#dlPdf'); if(b)b.click();}")
        for _ in range(40):
            await pg3.wait_for_timeout(1000)
            if saved: break
        if not saved:
            fails.append("the second-round export produced no file")
        else:
            round2 = tmp / "round2.pdf"
            paint_flatten(saved[0], round2, passes=1)
            pg5 = await ctx.new_page()
            await pg5.goto(WRAP.as_uri()); await pg5.wait_for_timeout(2500)
            await pg5.set_input_files("#file", str(round2)); await pg5.wait_for_timeout(22000)
            h5 = await pg5.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map(a=>new Promise(res=>{
                  const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                    c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                    g.drawImage(im,0,0);
                    res([g.getImageData(c.width>>1,c.height>>1,1,1).data[3],
                         g.getImageData(Math.round(c.width*0.16),Math.round(c.height*0.16),1,1).data[3]]); };
                  im.onerror=()=>res([-1,-1]); im.src=a.src; })))""")
            print(f"  second round (both holes must be clear): {h5}")
            if not h5 or any(h != [0, 0] for h in h5):
                fails.append(f"after a second round the OLD pictures came back {h5}")
            await pg5.close()
        saved.clear()

        # ---- v67: the BROWSER'S copy of the document holds the unedited pictures ----
        # Ced's SOH1350 kept coming back "unfinished" after the file itself was fixed: a reopen under
        # v63 had put the payload's recovery copies (the pictures before editing) into this browser's
        # autosave, and every later reopen offered that copy as the highlighted choice. Seed exactly
        # that — the recovery copies as the pictures, one mark moved so the two sets differ, a newer
        # time — reopen, take the highlighted answer, and the pictures must be the edited ones.
        await pg3.evaluate("""async()=>{ const rec=[...(S._recoverySrcs||[])];
              const d=savePayload(); let i=0;
              d.annos.forEach(a=>{ if(a.kind==='img'&&rec.length)a.src=rec[(i++)%rec.length]; });
              const t=d.annos.find(a=>a.kind!=='img'); if(t)t.nx+=0.02;
              d.ts=Date.now()+60000;
              await saveObj(saveKey(), d); }""")
        pg4 = await ctx.new_page()
        pg4.on("pageerror", lambda e: fails.append("page error on cached reopen: " + str(e)[:200]))
        await pg4.goto(WRAP.as_uri()); await pg4.wait_for_timeout(2500)
        await pg4.set_input_files("#file", str(painted)); await pg4.wait_for_timeout(22000)
        asked = await pg4.evaluate("()=>{const d=document.getElementById('dlg'); const on=d&&d.classList.contains('show'); if(on){ const b=d.querySelector('button.primary'); if(b)b.click(); } return on;}")
        await pg4.wait_for_timeout(1500)
        holes4 = await pg4.evaluate("""()=>Promise.all(S.annos.filter(a=>a.kind==='img').map(a=>new Promise(res=>{
              const rec=S._recoverySrcs; if(rec&&rec.has(a.src))return res([-2,-2]);
              const im=new Image(); im.onload=()=>{ const c=document.createElement('canvas');
                c.width=im.naturalWidth; c.height=im.naturalHeight; const g=c.getContext('2d');
                g.drawImage(im,0,0); res([c.width, g.getImageData(c.width>>1,c.height>>1,1,1).data[3]]); };
              im.onerror=()=>res([-1,-1]); im.src=a.src; })))""")
        print(f"  reopened with this browser's stale copy (asked: {asked}): {holes4}")
        # v68 — and it is not even asked: a PDF that carries our redlines opens as it is
        if asked:
            fails.append("a PDF carrying our redlines still asked which set to use — it should open as it is")
        if not holes4 or any(h[1] != 0 or h[0] < 1000 for h in holes4):
            fails.append(f"the browser's stale copy brought the unedited pictures back {holes4}")

        await b.close()

    print("\n" + ("MARKS AND PICTURES SURVIVE ANOTHER PLATFORM'S FLATTEN" if not fails
                  else f"{len(fails)} FAILING:\n  - " + "\n  - ".join(fails)))
    sys.exit(1 if fails else 0)


asyncio.run(main())
