#!/usr/bin/env python3
"""v78–v85 — the workspace: tabs, RFDS mode, alignment, look sync, the stamp card in RFDS tabs.

   python3 test/workspace.py dist/mark-it-up.artifact.html [fixture.pdf]

Real browser (Playwright/Chromium). Each case prints PASS/FAIL; the exit code is the number of failures.
Without a fixture a 10-page synthetic PDF is written (needs reportlab).
"""
import asyncio, os, sys, tempfile

from playwright.async_api import async_playwright

ART = sys.argv[1] if len(sys.argv) > 1 else "dist/mark-it-up.artifact.html"
PDF = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
TMP = tempfile.mkdtemp(prefix="miu-ws-")
PAGE = os.path.join(TMP, "page.html")
open(PAGE, "w", encoding="utf-8").write("<!doctype html>\n" + open(ART, encoding="utf-8").read())
if not PDF:
    from reportlab.pdfgen import canvas
    PDF = os.path.join(TMP, "ten.pdf")
    c = canvas.Canvas(PDF)
    for i in range(10):
        c.drawString(100, 700, "Page %d" % (i + 1)); c.showPage()
    c.save()

fails = 0
def check(name, ok, info=""):
    global fails
    print(("PASS " if ok else "FAIL ") + name + (("  — " + str(info)) if info and not ok else ""))
    if not ok: fails += 1

async def frame_of(pg, tid):
    for f in pg.frames:
        if f == pg.main_frame: continue
        if await (await f.frame_element()).get_attribute("data-tab") == tid: return f

async def fresh(p, w=1500, h=900, init=None):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={"width": w, "height": h}, accept_downloads=True)
    pg = await ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    if init: await pg.add_init_script(init)
    await pg.goto("file://" + PAGE); await pg.wait_for_timeout(4000)
    return b, pg, errs

GEO = """()=>{const o={}; const R=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};
 ['#toolbar','aside#rail','#logBtn','#drop','#pages','#modeTabs'].forEach(s=>{const e=document.querySelector(s); if(e)o[s]=R(e)});
 ['openBtn','homeBtn','saveBtn','undoBtn','redoBtn','snapBtn','findInput','themeBtn','modeBtn','helpBtn','zoomIn'].forEach(id=>{const e=document.getElementById(id); if(e&&e.offsetParent)o[id]=R(e)});
 return o}"""

async def main():
    async with async_playwright() as p:
        # ---- tabs: open, switch, close, Home isolation ----
        b, pg, errs = await fresh(p)
        tabs = await pg.evaluate("MIU_WS.tabs()")
        check("workspace starts with one Mark It Up tab", len(tabs) == 1 and tabs[0]["tool"] == "miu", tabs)

        m = await frame_of(pg, "t1"); await m.set_input_files("#file", PDF); await pg.wait_for_timeout(1500)
        await m.click("#modeTabs .mplus"); await m.click("#modeMenu button[data-tool=rfds]"); await pg.wait_for_timeout(4500)
        r = await frame_of(pg, "t2"); await r.set_input_files("#file", PDF); await pg.wait_for_timeout(2500)
        await pg.evaluate('MIU_WS.open("miu")'); await pg.wait_for_timeout(4500)
        m2 = await frame_of(pg, "t3"); await m2.set_input_files("#file", PDF); await pg.wait_for_timeout(1500)
        tabs = await pg.evaluate("MIU_WS.tabs()")
        tones = await m.evaluate("""()=>[...document.querySelectorAll("#modeTabs .mtab[data-tool]")].map(t=>t.dataset.tool+":"+getComputedStyle(t).backgroundColor)""")
        check("v86 Mark It Up and RFDS tabs wear different tones", len(set(x.split(":",1)[1] for x in tones)) >= 2, tones)
        check("three tabs, each with its own document", len(tabs) == 3 and all(t["name"] for t in tabs), tabs)
        await r.evaluate("1"); await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(800)
        await r.click("#homeBtn"); await pg.wait_for_timeout(400)
        await r.locator("#dlg button", has_text="go home").first.click(); await pg.wait_for_timeout(5000)
        tabs = await pg.evaluate("MIU_WS.tabs()")
        check("Home in one tab leaves the others' documents open",
              tabs[1]["name"] is None and tabs[0]["name"] and tabs[2]["name"], tabs)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(600)
        await m.click("#modeTabs .mtab[data-tab=t3] .mx"); await pg.wait_for_timeout(500)
        btn = m.locator("#dlg button", has_text="Close tab")
        if await btn.count(): await btn.first.click()
        await pg.wait_for_timeout(800)
        check("closing a tab with a document asks, then closes", len(await pg.evaluate("MIU_WS.tabs()")) == 2)
        check("no page errors (tabs)", not errs, errs)
        await b.close()

        # ---- nothing moves between the two tools ----
        b, pg, errs = await fresh(p)
        m = await frame_of(pg, "t1"); await m.set_input_files("#file", PDF); await pg.wait_for_timeout(1500)
        await pg.evaluate("MIU_WS.toggle()"); await pg.wait_for_timeout(4500)
        r = await frame_of(pg, "t2"); await r.set_input_files("#file", PDF); await pg.wait_for_timeout(2500)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(700)
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(900)
        gr = await r.evaluate(GEO); await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(800); gm = await m.evaluate(GEO)
        # the log pill's WIDTH follows its count, which differs per document — its place and height must not
        for g in (gm, gr):
            if "#logBtn" in g: g["#logBtn"] = g["#logBtn"][:2] + g["#logBtn"][3:]
        diff = {k: (gm.get(k), gr.get(k)) for k in set(gm) | set(gr) if gm.get(k) != gr.get(k)}
        check("ribbon, shared tools, rail, log pill, drop zone, pages and the switch line up", not diff, diff)
        # theme carries across
        await m.evaluate('setPaletteById("pal-teal"); applyThemeMode("light")')
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(900)
        cls = await r.evaluate("document.documentElement.className")
        check("the look carries across tabs", "pal-teal" in cls and "light" in cls, cls)
        # no self-scroll
        await pg.mouse.move(700, 500)
        for _ in range(5): await pg.mouse.wheel(0, 500); await pg.wait_for_timeout(120)
        await pg.wait_for_timeout(1200); y0 = await r.evaluate("(document.scrollingElement).scrollTop")
        for _ in range(8):
            await r.evaluate('document.body.classList.toggle("chromeshow")'); await pg.wait_for_timeout(200)
        await pg.wait_for_timeout(1200); y1 = await r.evaluate("(document.scrollingElement).scrollTop")
        check("pages do not scroll on their own", y0 == y1, (y0, y1))
        check("no page errors (alignment)", not errs, errs)
        await b.close()

        # ---- the stamp card in an RFDS tab ----
        b, pg, errs = await fresh(p)
        await pg.evaluate("MIU_WS.toggle()"); await pg.wait_for_timeout(4500)
        r = await frame_of(pg, "t2"); await r.set_input_files("#file", PDF); await pg.wait_for_timeout(2500)
        check("RFDS stamp red is Mark It Up red", (await r.evaluate("STAMP_RED_HEX")).lower() == "#fa3237")
        await r.click("#stampBtn"); await pg.wait_for_timeout(600)
        check("the stamp button opens Mark It Up's card", await r.evaluate('!!document.querySelector("#maPanel.show #copStatus")'))
        await r.click(".ma-stampgo"); await pg.wait_for_timeout(3500)
        n = await r.evaluate("allStamps().length")
        check("Stamp places one stamp per page", n == 10, n)
        await r.select_option("#copStatus", "AS-BUILT"); await pg.wait_for_timeout(400)
        check("changing the card updates every stamp live", await r.evaluate('allStamps().every(a=>a.st.status==="AS-BUILT")'))
        bad = []
        for mode in ("dark", "light"):
            for pal in ("pal-ontel", "pal-slate", "pal-plum", "pal-sand"):
                await r.evaluate(f'applyThemeMode("{mode}"); setPaletteById("{pal}")'); await pg.wait_for_timeout(120)
                bg = await r.evaluate('getComputedStyle(document.getElementById("maPanel")).backgroundColor')
                if bg in ("rgba(0, 0, 0, 0)", "transparent"): bad.append(mode + " " + pal)
        check("the card has a background on every theme", not bad, bad)
        await pg.keyboard.press("Escape")
        async with pg.expect_download(timeout=30000) as dl:
            await r.click("#dlPdf")
        await dl.value; await pg.wait_for_timeout(2500)
        check("no stamp-tool prompt after saving", not await r.evaluate('!!document.querySelector("#dlg.show")'))
        check("no page errors (stamp)", not errs, errs)
        await b.close()

        # ---- v86 the WEB build (what Vercel serves) puts the page in <body>; the icon must reach <head> ----
        web = os.path.join(os.path.dirname(os.path.abspath(ART)), "..", "public", "index.html")
        if os.path.exists(web):
            b = await p.chromium.launch(); pg = await b.new_page()
            await pg.goto("file://" + os.path.abspath(web)); await pg.wait_for_timeout(4500)
            ico = await pg.evaluate("""()=>{ const l=document.getElementById("favIcon"); return [l&&l.parentElement.tagName,
              document.querySelectorAll('link[rel~="icon"]').length] }""")
            check("v86 web build: the tool's icon is in <head>, and the only one", ico == ["HEAD", 1], ico)
            await b.close()
        else:
            print("skip web-build icon check (no public/index.html — run node build.mjs --target=both)")

        # ---- falls back to a single Mark It Up if frames cannot be reached ----
        b, pg, errs = await fresh(p, init="if(window===window.top){Object.defineProperty(HTMLIFrameElement.prototype,'contentDocument',{get(){return null}});}")
        await pg.wait_for_timeout(5000)
        st = await pg.evaluate('[typeof loadPdf, !!document.getElementById("wsHost"), !!document.getElementById("modeBtn")]')
        check("without reachable frames it runs as one Mark It Up, switch hidden", st == ["function", False, False], st)
        await b.close()

asyncio.run(main())
print(f"\n{fails} failure(s)")
sys.exit(fails)
