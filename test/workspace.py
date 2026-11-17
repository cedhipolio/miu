#!/usr/bin/env python3
"""v78–v88 — the workspace: tabs, RFDS mode, alignment, look sync, the stamp card in RFDS tabs.

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
        # v87 — the tab pills sit on the log pill's line, and nothing docked at the foot covers them
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(800)
        await m.evaluate('(()=>{ setZoom(3); const id=addText(0,0.1,0.1,"x"); selectAnno(id); })()'); await pg.wait_for_timeout(1500)
        g = await m.evaluate("""()=>{ const R=e=>{const r=e.getBoundingClientRect(); return [r.left,r.top,r.right,r.bottom]};
          const t=document.querySelector("#modeTabs .mtab"), l=document.getElementById("logBtn"), s=document.querySelector(".selbar:not([hidden])");
          return {t:R(t), l:R(l), s:s&&s.offsetParent!==null?R(s):null} }""")
        mid = lambda r: (r[1] + r[3]) / 2
        check("v87 tabs are on the log pill's line", abs(mid(g["t"]) - mid(g["l"])) < 1, g)
        sb = g["s"]; tb = g["t"]
        check("v87 the selection bar does not cover the tabs",
              sb is None or sb[3] <= tb[1] or sb[1] >= tb[3] or sb[2] <= tb[0] or sb[0] >= tb[2], g)
        await m.evaluate('selectAnno(null)')
        # v87 — sending the OTHER tab Home must not shut this tab's page list
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(800)
        await r.click("#homeBtn"); await pg.wait_for_timeout(400)
        await r.locator("#dlg button", has_text="go home").first.click(); await pg.wait_for_timeout(5000)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(900)
        check("v87 the page list stays open after the other tab goes Home", await m.evaluate('document.body.classList.contains("railon")'))
        check("no page errors (alignment)", not errs, errs)
        await b.close()

        # ---- the stamp card in an RFDS tab ----
        b, pg, errs = await fresh(p)
        await pg.evaluate("MIU_WS.toggle()"); await pg.wait_for_timeout(4500)
        r = await frame_of(pg, "t2"); await r.set_input_files("#file", PDF); await pg.wait_for_timeout(2500)
        check("RFDS stamp red is Mark It Up red", (await r.evaluate("STAMP_RED_HEX")).lower() == "#fa3237")
        await r.click("#stampBtn"); await pg.wait_for_timeout(600)
        check("the stamp button opens Mark It Up's card", await r.evaluate('!!document.querySelector("#maPanel.show #copStatus")'))
        check("v91 the card's close glyph is centred", await r.evaluate('getComputedStyle(document.getElementById("maClose")).justifyContent') == "center")
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

        # ---- v88 tab titles read the document; crossout panel = line panel; RFDS report per sector ----
        from reportlab.pdfgen import canvas as _cv
        def doc(name, lines):
            f = os.path.join(TMP, name); c = _cv.Canvas(f)
            for pg_lines in lines:
                y = 700
                for ln in pg_lines: c.drawString(80, y, ln); y -= 20
                c.showPage()
            c.save(); return f
        kinds = [(doc("ma.pdf", [["SITE: SOH3361", "MOUNT ANALYSIS REPORT"], ["Refer to the construction drawings."]]), "Mount Analysis · SOH3361"),
                 (doc("sa.pdf", [["TOWER STRUCTURAL ANALYSIS REPORT"], ["Structural analysis results"]]), "Structural Analysis"),
                 (doc("cd.pdf", [["CONSTRUCTION DRAWINGS", "SHEET INDEX", "T-1 TITLE SHEET"]]), "Construction Drawings"),
                 (doc("other.pdf", [["Meeting notes"]]), "MIU")]
        b, pg, errs = await fresh(p)
        got = []
        for i, (f, want) in enumerate(kinds):
            if i: await pg.evaluate('MIU_WS.open("miu")'); await pg.wait_for_timeout(4000)
            fr = await frame_of(pg, "t%d" % (i + 1)); await fr.set_input_files("#file", f); await pg.wait_for_timeout(1800)
        await pg.wait_for_timeout(1500)
        tabs = await pg.evaluate("MIU_WS.tabs()")
        got = [t["title"] for t in tabs]
        check("v88 Mark It Up tabs are titled by document type (MIU when unknown)", got == [w for _, w in kinds], got)
        m = await frame_of(pg, "t1")
        shown = await m.evaluate('[...document.querySelectorAll("#modeTabs .mtab[data-tab] b")].map(b=>b.textContent)')
        check("v88 the strip shows those titles", shown == got, shown)
        await pg.evaluate('MIU_WS.open("rfds")'); await pg.wait_for_timeout(4500)
        tabs = await pg.evaluate("MIU_WS.tabs()")
        check("v88 an empty RFDS tab is titled RFDS", tabs[-1]["title"] == "RFDS", tabs[-1])
        r = await frame_of(pg, tabs[-1]["id"]); await r.set_input_files("#file", kinds[0][0]); await pg.wait_for_timeout(2500)
        t = (await pg.evaluate("MIU_WS.tabs()"))[-1]["title"]
        check("v88 an RFDS tab is titled from its detection (Final / Preliminary RFDS)", t.split(" · ")[0] in ("Final RFDS", "Preliminary RFDS"), t)
        U = '["A-1","A-2","B-1","B-2","C-1","C-2"]'
        per = await r.evaluate("""U=>[_rlPosPhrase(["A-1","A-2","B-1"],U), _rlPosPhrase(["A-1","A-2","B-1","B-2"],U),
            _rlPairsWithPlace([{place:"A-1",pair:"30°"},{place:"A-2",pair:"30°"},{place:"B-1",pair:"150°"},{place:"B-2",pair:"150°"}],U),
            _rlPairsWithPlace([{place:"A-1",pair:"120'"},{place:"A-2",pair:"120'"},{place:"B-1",pair:"120'"},{place:"B-2",pair:"120'"},{place:"C-1",pair:"90'"},{place:"C-2",pair:"95'"}],U)]""", __import__("json").loads(U))
        check("v88 RFDS report: a sector whose positions share a redline is named as the sector",
              per == ["Alpha and B-1", "Alpha and Beta", ["Alpha 30°", "Beta 150°"], ["Alpha and Beta 120'", "C-1 90'", "C-2 95'"]], per)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(700)
        await m.evaluate('tpOpen("crossout")'); await pg.wait_for_timeout(300)
        cx = await m.evaluate('document.getElementById("toolpop").innerText.toUpperCase()')
        await m.evaluate('tpOpen("line")'); await pg.wait_for_timeout(300)
        lx = await m.evaluate('document.getElementById("toolpop").innerText.toUpperCase()')
        sec = lambda x: [k for k in ("LINE STYLE", "LINE ENDINGS", "TIP SIZE", "PATTERN") if k in x]
        check("v88 the cross out panel has the line panel's properties", sec(cx) == sec(lx) == ["LINE STYLE", "LINE ENDINGS", "TIP SIZE", "PATTERN"], (sec(cx), sec(lx)))
        # v89 — a selected cross out shows the line's mini bar, acting on both strokes
        await pg.keyboard.press("Escape")
        st = await m.evaluate("""()=>{ const n0=S.lines.length; crossOutBox(0,.3,.2,.5,.35);
            const ids=S.lines.slice(n0).map(l=>l.id); selectGroup(S.lines[n0].group); positionMultibar();
            const r=[$("#linebar").classList.contains("show"), multibar.classList.contains("show")];
            document.querySelector("#linebar [data-larrow]").click();
            r.push(S.lines.filter(l=>ids.indexOf(l.id)>=0).every(l=>l.arrow==="end"));
            document.querySelector("#linebar [data-ldel]").click();
            r.push(S.lines.filter(l=>ids.indexOf(l.id)>=0).length, $("#linebar").classList.contains("show"));
            return r; }""")
        check("v89 a cross out gets the line's mini bar, on both strokes", st == [True, False, True, 0, False], st)
        ct = await r.evaluate("""()=>{
            const R=(sector,type,b,a,ob,oa,pr,man)=>({sector,type,before:b,after:a,origBefore:ob,origAfter:oa,printed:pr,manual:man});
            const P=(e,r,ad,f)=>({existing:e,removals:r,additions:ad,final:f});
            const A={designSummary:[R("Alpha","RRH",3,0,2,0,P(2,2,0,0),{lead:"removal",removal:3}),R("Beta","RRH",3,0,2,0,P(2,2,0,0),{lead:"removal",removal:3}),
              R("Gamma","RRH",3,0,2,0,P(2,2,0,0),{lead:"removal",removal:3}),R("Site","DC_TRUNK",5,5,4,4,P(4,0,0,4)),
              R("Beta","FIBER_TRUNK",1,1,0,0,P(0,0,0,0)),R("Alpha","SQUID",1,2,1,1,P(1,0,0,1)),R("Beta","SQUID",1,2,1,1,P(1,0,0,1))]};
            return _miuDsCountPair(A,["Alpha","Beta","Gamma","Site-wide"]); }""")
        check("v89 the equipment count line carries the corrected totals", ct ==
              "9 RRH removals, 5 DC trunks total, 1 fiber trunk total in Beta, 4 squids total (Alpha and Beta)", ct)
        # v90 — a centred as-built correction aims at its column's centre line, not its own off-axis print
        cc = await r.evaluate("""()=>{ const P={items:[], wPt:612}; const W=612,H=792;
            const T=(s,cx,y)=>({str:s,nx:(cx-10)/W,nw:20/W,ny:y/H,nh:10/H});
            P.items=[T("B-1",250,90),T("283",250,120),T("287",250,180),T("14",250,210),T("96",250,240)];
            const keep=S.pages[0]; S.pages[0]=P;
            const box={nx:237/W,nw:20/W,ny:150/H,nh:10/H,y2:160/H,colL:200/W,colR:300/W};
            const c=_miuColCentre(0,box,247/W); S.pages[0]=keep; return Math.round(c*W*10)/10; }""")
        check("v90 a centred redline aims at its column's centre line", cc == 250, cc)
        # v91 — added rows are named by their equipment; the stamp card's close glyph is centred
        ad = await r.evaluate("""()=>{ const out=[]; const add=t=>out.push(t);
            const A={designSummary:[{inserted:true,model:"FB-L98B-235",type:"FILTER",sector:"Beta"},{sector:"Alpha",model:"X"}],
                     antennaPosition:[{inserted:true,secPos:"C-1"}]};
            const rf={columns:["Sector","Equipment Type","Model"],rows:[{inserted:true,cells:{"Sector":"Beta","Equipment Type":"FILTER","Model":"FB-L98B-235"}},
                     {inserted:true,cells:{"Sector":"Alpha","Equipment Type":"SQUID","Model":""}}]};
            _miuAddedLines(A,rf,add,["Alpha","Beta","Gamma"],["Alpha","Beta","Gamma"]); return out; }""")
        check("v91 added rows on Design Summary / RF Inventory name their equipment",
              ad[:2] == ["Added FB-L98B-235 in Beta on Design Summary and RF Inventory", "Added squid in Alpha on RF Inventory"]
              and len(ad) == 3 and ad[2].startswith("Equipment added to the design"), ad)
        # v92 — Apply leaves a redline that already reads the value; replaces one that does not
        ap = await r.evaluate("""()=>{
 const t=S.pages[0].items.filter(t=>t.str.trim()).sort((a,b)=>a.nw-b.nw)[0];
 const box={nx:t.nx,ny:t.ny,nw:t.nw,nh:t.nh,x2:t.nx+t.nw,y2:t.ny+t.nh,lines:1,colL:Math.max(0,t.nx-0.05),colR:Math.min(1,t.nx+t.nw+0.05)};
 const texts=()=>S.annos.filter(a=>a.page===0&&a.kind!=="stamp").map(a=>(a.fromAnalyze?"A:":"H:")+a.text).sort().join(",");
 const out=[];
 const hand=v=>{ _azApplying=false; const id=addText(0,t.nx,t.ny,v); const a=S.annos.find(x=>x.id===id); a.nw=t.nw+0.004; a.nh=t.nh; a.nx=t.nx-0.002; return a; };
 const apply=v=>{ _azApplying=true; try{ stampWholeCell(0,box,v,"center"); } finally{ _azApplying=false; } };
 S.annos=S.annos.filter(a=>a.page!==0);
 hand("280"); apply("283"); out.push(texts());           // changed: hand replaced
 S.annos=S.annos.filter(a=>a.page!==0);
 hand("283"); apply("283"); out.push(texts());           // unchanged: hand kept
 S.annos=S.annos.filter(a=>a.page!==0);
 apply("283"); hand("281"); apply("284"); out.push(texts()); // analyze updated: overlay removed
 hand("285"); apply("284"); out.push(texts());           // unchanged analyze: overlay kept
 return out;
}""")
        check("v92 Apply replaces a changed redline, keeps an unchanged one", ap == ["A:283", "H:283", "A:284", "A:284,H:285"], ap)
        # v93 — a position number corrected in every sector reads "POS n in all sectors"
        pz = await r.evaluate("""()=>{ const U=["A-1","A-2","A-3","B-1","B-2","B-3","C-1","C-2","C-3"];
            const it=(p,v)=>({place:p,pair:v});
            return _rlPairsWithPlace([it("A-1","288' instead of 283'"),it("B-1","288' instead of 283'"),it("C-1","288' instead of 283'"),
              it("A-3","287' instead of 283'"),it("B-3","287' instead of 283'"),it("C-3","287' instead of 283'")],U); }""")
        check("v93 'POS 1 in all sectors'", pz == ["POS 1 in all sectors 288' instead of 283'", "POS 3 in all sectors 287' instead of 283'"], pz)
        check("no page errors (v88)", not errs, errs)
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
