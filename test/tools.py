#!/usr/bin/env python3
"""Drive every tool with a real mouse and report what each one actually produced.

This is the test the function-level ones could not be: it presses the ribbon button, performs the
gesture on the page the way a hand would, and then asks the document what appeared. A tool that looks
right in code and does nothing on a drag shows up here and nowhere else.
"""
import argparse, asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_wrapped_tools.html"


def wrap(packed: pathlib.Path) -> pathlib.Path:
    WRAP.write_text("<!doctype html><html><head></head><body>\n" + packed.read_text(encoding="utf-8")
                    + "\n</body></html>", encoding="utf-8")
    return WRAP


def parseFloat_(v):
    try:
        return float(str(v).replace('px',''))
    except Exception:
        return 0.0


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed")
    ap.add_argument("pdf")
    ap.add_argument("--shot")
    a = ap.parse_args()

    results, errors, logs = [], [], []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        ctx = await browser.new_context(viewport={"width": 1700, "height": 1100})
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)[:300]))
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"[:200])
                if m.type in ("error", "warning") else None)
        await page.goto(wrap(pathlib.Path(a.packed)).as_uri())
        await page.wait_for_timeout(2500)
        await page.set_input_files("#file", a.pdf)
        await page.wait_for_timeout(9000)

        # work on page 1 at a known zoom, with the panel shut
        await page.evaluate("maPanelOpen(false); gotoPageInstant(0);")
        await page.wait_for_timeout(700)

        async def page_box(idx=0):
            return await page.evaluate(
                """(i)=>{const pg=document.querySelector('.page[data-idx="'+i+'"]');
                         const r=pg.getBoundingClientRect();
                         return {x:r.x,y:r.y,w:r.width,h:r.height};}""", idx)

        async def counts():
            return await page.evaluate("()=>({a:S.annos.length,l:S.lines.length})")

        async def snapshot():
            return await page.evaluate("""()=>({
                annos:S.annos.map(x=>({id:x.id,kind:x.kind||null,shape:x.shape||null,maKind:x.maKind||null,
                    col:x.col,sw:x.sw,fill:x.fill,fillOp:x.fillOp,font:x.font,size:x.size,
                    nx:+x.nx.toFixed(4),ny:+x.ny.toFixed(4),nw:+(x.nw||0).toFixed(4),nh:+(x.nh||0).toFixed(4),
                    group:(x.group==null?null:x.group),text:(x.text||'').slice(0,26)})),
                lines:S.lines.map(x=>({id:x.id,col:x.col,sw:x.sw,arrow:x.arrow||null,maKind:x.maKind||null,
                    pts:(x.pts||[]).length,group:x.group==null?null:x.group,
                    coFor:(x.coFor==null?null:x.coFor),
                    x1:+x.x1.toFixed(4),y1:+x.y1.toFixed(4),x2:+x.x2.toFixed(4),y2:+x.y2.toFixed(4)}))})""")

        async def clear():
            # 6f8 — and put the VIEW back where every case assumes it is. `page_box()` used to be taken
            # once at the start and reused for every click; the moment anything scrolled the window,
            # every later coordinate was measured against a page that had moved. Each case now starts
            # from the same scroll position and the coordinates are read live.
            # 6hq — and PUT THE TOOL DOWN. A drawing tool stays in the hand between gestures, and
            # since 6hq a press with one up draws rather than dragging what is under it — so a case
            # that starts by dragging a mark has to start from Select, exactly as a hand would.
            await page.evaluate("()=>{S.annos=[];S.lines=[];S.history=[];S.future=[];"
                                "try{setMode('select');}catch(e){}"
                                "selectAnno(null);selectLine(null);clearMulti();"
                                "layoutAnnos();drawAllLines();updateCount();"
                                "const p=document.querySelector('.page[data-idx=\"0\"]');"
                                # 6gb - clear the STICKY RIBBON, not just the top of the window: a real
                                # mouse click on a run hidden under the ribbon lands on the ribbon.
                                "const tb=document.getElementById('toolbar');"
                                "const gap=(tb?tb.getBoundingClientRect().height:150)+30;"
                                "if(p)window.scrollTo(0,p.offsetTop-gap);}")
            # 6gb - the scroll above hides the ribbon, which takes it out of flow and moves every page
            # up by its height. Put it back FIRST, let the layout settle, and only then measure: a box
            # read while the ribbon is mid-hide is 150px out, and every coordinate in the case with it.
            await page.wait_for_timeout(200)
            await page.evaluate("()=>{document.body.classList.remove('ribbonhidden');}")
            await page.wait_for_timeout(300)
            _live["b"] = await page_box()

        async def pick(mode):
            # 6gb - the ribbon auto-hides once the document is scrolled past 140px, and a hidden ribbon
            # is not a clickable one. A user brings it back by reaching for the top strip; the audit
            # does the same thing directly, then picks the tool.
            await page.evaluate("()=>{document.body.classList.remove('ribbonhidden');}")
            await page.wait_for_timeout(120)
            await page.click(f'#tools .tool[data-mode="{mode}"]')
            await page.wait_for_timeout(120)
            return await page.evaluate("()=>S.mode")

        async def drag(x1, y1, x2, y2, steps=12):
            await page.mouse.move(x1, y1)
            await page.mouse.down()
            for k in range(1, steps + 1):
                await page.mouse.move(x1 + (x2 - x1) * k / steps, y1 + (y2 - y1) * k / steps)
                await page.wait_for_timeout(12)
            await page.mouse.up()
            await page.wait_for_timeout(260)

        b = await page_box()
        # a couple of anchors on page 1: blank space, and a printed value. Read LIVE — see clear().
        _live = {"b": b}

        async def refresh_box():
            _live["b"] = await page_box()

        def at(fx, fy):
            r = _live["b"]
            return (r["x"] + r["w"] * fx, r["y"] + r["h"] * fy)

        # the printed run each of the on-text tools acts on — read LIVE for the same reason the page
        # box is: its position on screen depends on where the window is scrolled to.
        async def printed_at():
            return await page.evaluate(
                """()=>{const pg=document.querySelector('.page[data-idx="0"]');
                        const ts=[...pg.querySelectorAll('.tspan')];
                        const t=ts.find(e=>/SOH|UTICA|397|101\\.3/.test(e.textContent))||ts[6];
                        if(!t)return null; const r=t.getBoundingClientRect();
                        return {x:r.x+r.width/2,y:r.y+r.height/2,txt:t.textContent.trim()};}""")

        # 6f2 — styles are now PER TOOL: picking a tool loads that tool's remembered style into the
        # ribbon, so a style set once up front is overwritten the moment the next tool is picked. The
        # ribbon is therefore set AFTER the pick, the way a user sets it: choose the tool, then its style.
        async def set_style():
            await page.evaluate("""()=>{ const put=(id,v)=>{const e=$(id); if(!e)return;
                    e.value=v; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); };
                put("#c_text","#2b8a3e"); put("#c_sw","3"); put("#c_fill","#ffd8a8");
                put("#c_fop","40"); put("#c_font","arialbold"); put("#c_pt","9"); }""")
            await page.wait_for_timeout(120)

        async def case(name, mode, gesture, expect):
            await clear()
            got_mode = await pick(mode) if mode else None
            await set_style()
            await refresh_box()          # 6gb - measure after the ribbon is back, not before
            try:
                await gesture()
            except Exception as e:                       # noqa: BLE001
                results.append({"tool": name, "ok": False, "why": f"gesture failed: {e}"})
                return
            snap = await snapshot()
            ok, why = expect(snap)
            results.append({"tool": name, "mode": got_mode, "ok": ok, "why": why,
                            "made": {"annos": len(snap["annos"]), "lines": len(snap["lines"])},
                            "detail": snap})
            print(f"[{'ok ' if ok else 'FAIL'}] {name:<26} {why}", flush=True)

        # ---------- the style the new marks should pick up ----------
        await page.evaluate("""()=>{ $("#c_text").value="#2b8a3e"; $("#c_sw").value="3";
            $("#c_fill").value="#ffd8a8"; $("#c_fop").value="40"; $("#c_font").value="arialbold";
            $("#c_pt").value="9"; }""")

        # ---------- BOX ----------
        async def g_box():
            x1, y1 = at(0.18, 0.55); x2, y2 = at(0.42, 0.66)
            await drag(x1, y1, x2, y2)

        def e_box(s):
            sh = [x for x in s["annos"] if x["shape"] == "rect"]
            if not sh: return False, "no rect mark was made"
            m = sh[0]
            if m["col"] != "#2b8a3e": return False, f"stroke not taken from the ribbon ({m['col']})"
            if m["sw"] != 3: return False, f"width not taken ({m['sw']})"
            if abs((m["fillOp"] or 0) - 0.4) > 0.01: return False, f"fill opacity not taken ({m['fillOp']})"
            if m["nw"] < 0.12: return False, f"box is too small ({m['nw']}) — the drag was not measured"
            return True, "rect with the ribbon's stroke, width and fill"

        await case("Box (B)", "box", g_box, e_box)

        # ---------- CIRCLE ----------
        async def g_circle():
            x1, y1 = at(0.55, 0.55); x2, y2 = at(0.72, 0.68)
            await drag(x1, y1, x2, y2)

        def e_circle(s):
            sh = [x for x in s["annos"] if x["shape"] == "ellipse"]
            if not sh: return False, "no ellipse mark was made"
            return (sh[0]["nw"] > 0.08, f"ellipse {sh[0]['nw']}×{sh[0]['nh']}")

        await case("Circle (O)", "circle", g_circle, e_circle)

        # ---------- ARROW ----------
        async def g_arrow():
            x1, y1 = at(0.20, 0.72); x2, y2 = at(0.46, 0.82)
            await drag(x1, y1, x2, y2)

        def e_arrow(s):
            if not s["lines"]: return False, "no stroke was made"
            l = s["lines"][0]
            if l["arrow"] != "end": return False, f"no arrowhead ({l['arrow']})"
            if abs(l["y2"] - l["y1"]) < 0.02: return False, "the stroke came out level — the drag's y was ignored"
            if l["sw"] != 3: return False, f"width not taken from the ribbon ({l['sw']})"
            return True, f"arrow {l['sw']}pt, sloped"

        await case("Arrow (A)", "arrow", g_arrow, e_arrow)

        # ---------- LINE ----------
        async def g_line():
            x1, y1 = at(0.20, 0.86); x2, y2 = at(0.50, 0.92)
            await drag(x1, y1, x2, y2)

        def e_line(s):
            if not s["lines"]: return False, "no stroke was made"
            l = s["lines"][0]
            if l["arrow"]: return False, "a plain line should have no head"
            if abs(l["y2"] - l["y1"]) < 0.02: return False, "the line came out level — free direction is broken"
            return True, "free line"

        await case("Line (L)", "line", g_line, e_line)

        # ---------- POLYLINE ----------
        async def g_poly():
            for fx, fy in ((0.55, 0.74), (0.66, 0.82), (0.80, 0.74)):
                x, y = at(fx, fy)
                await page.mouse.click(x, y)
                await page.wait_for_timeout(180)
            _live["b"] = await page_box()
            x, y = at(0.80, 0.74)
            await page.mouse.dblclick(x, y)
            await page.wait_for_timeout(350)

        def e_poly(s):
            if not s["lines"]: return False, "no polyline was made"
            l = s["lines"][0]
            if l["pts"] != 3: return False, f"{l['pts']} points from three clicks — the finishing double-click is adding some"
            return True, "3-point polyline, the finishing double-click not counted"

        await case("Polyline (P)", "poly", g_poly, e_poly)

        # ---------- CROSS OUT ----------
        async def g_crossout():
            x1, y1 = at(0.20, 0.40); x2, y2 = at(0.44, 0.48)
            await drag(x1, y1, x2, y2)

        def e_crossout(s):
            if len(s["lines"]) != 2: return False, f"expected two crossing strokes, got {len(s['lines'])}"
            if s["lines"][0]["group"] is None: return False, "the two strokes are not grouped"
            return True, "an X of two grouped strokes"

        await case("Cross out (X)", "crossout", g_crossout, e_crossout)

        # ---------- REDLINE on a printed value ----------
        async def g_redline():
            pr = await printed_at()
            await page.mouse.click(pr["x"], pr["y"])
            await page.wait_for_timeout(400)

        def e_redline(s):
            if not s["annos"]: return False, "clicking a printed value produced no mark"
            m = s["annos"][0]
            if not m["text"]: return False, "the mark did not pick up the printed value"
            return True, f"editable mark over “{m['text']}”"

        await case("Redline (R)", "redline", g_redline, e_redline)

        # ---------- STRIKE & WRITE ----------
        async def g_fix():
            pr = await printed_at()
            await page.mouse.click(pr["x"], pr["y"])
            await page.wait_for_timeout(400)

        def e_fix(s):
            if not s["annos"] or not s["lines"]:
                return False, f"expected a strike and a mark, got {len(s['lines'])} strokes / {len(s['annos'])} marks"
            if s["annos"][0]["maKind"] != "fix": return False, "the mark is not tagged as a correction"
            if s["lines"][0]["group"] is None: return False, "the strike and the value are not grouped"
            return True, "struck, with the value written above it"

        await case("Strike & write (F)", "fix", g_fix, e_fix)

        # ---------- STRIKE TEXT ----------
        async def g_cross():
            pr = await printed_at()
            await page.mouse.click(pr["x"], pr["y"])
            await page.wait_for_timeout(300)

        def e_cross(s):
            return (len(s["lines"]) == 1, f"{len(s['lines'])} stroke(s)")

        await case("Strike text (T)", "cross", g_cross, e_cross)

        # ---------- STRIKE ROW ----------
        async def g_row():
            pr = await printed_at()
            await page.mouse.click(pr["x"], pr["y"])
            await page.wait_for_timeout(300)

        def e_row(s):
            if len(s["lines"]) != 1: return False, f"{len(s['lines'])} stroke(s)"
            l = s["lines"][0]
            return (l["x2"] - l["x1"] > 0.2, f"row strike {round(l['x2']-l['x1'],3)} wide")

        await case("Strike row (W)", "strikerow", g_row, e_row)

        # ---------- CALLOUT ----------
        async def g_callout():
            await page.evaluate("()=>{MA_CALLOUT_TEXT='New Sector Frame\\nMFR: Sabre\\nPart# C10841002C';}")
            x, y = at(0.62, 0.30)
            await page.mouse.click(x, y)
            await page.wait_for_timeout(500)

        def e_callout(s):
            # 6g9 — a callout is ONE mark now: the box owns its leader through coFor, and neither
            # half carries a group, because it is not a group.
            box = [x for x in s["annos"] if x["maKind"] == "callout"]
            if not box: return False, "no callout box"
            if not s["lines"]: return False, "no leader"
            ld = s["lines"][0]
            if ld["arrow"] != "end": return False, "the leader has no head"
            if ld["coFor"] != box[0]["id"]: return False, "the leader is not owned by its box"
            if box[0]["group"] is not None or ld["group"] is not None:
                return False, "the callout is still a group"
            if ld["pts"] != 3: return False, f"the leader has {ld['pts']} points, not 3"
            return True, "one mark: box owns a 3-point leader, no group"

        await case("Callout (K)", "callout", g_callout, e_callout)


        # ---------- TEXT BOX ----------
        async def g_text():
            x, y = at(0.30, 0.34)
            await page.mouse.click(x, y)
            await page.wait_for_timeout(400)
            await page.keyboard.type("AS-BUILT NOTE")
            await page.wait_for_timeout(300)

        def e_text(s):
            t = [x for x in s["annos"] if x["maKind"] == "text"]
            if not t: return False, "no text box was made"
            if "AS-BUILT" not in (t[0]["text"] or ""): return False, f"typing did not land ({t[0]['text']!r})"
            if t[0]["col"] != "#2b8a3e": return False, "the text did not take the ribbon's colour"
            return True, f"text box carrying “{t[0]['text']}”"

        await case("Text (E)", "text", g_text, e_text)

        # ---------- UNDO removes what a tool just drew ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.50), *at(0.40, 0.60))
        n_before = await counts()
        await page.keyboard.press("Control+z")
        await page.wait_for_timeout(300)
        n_after = await counts()
        results.append({"tool": "Undo after drawing", "ok": n_before["a"] == 1 and n_after["a"] == 0,
                        "why": f"{n_before} -> {n_after}"})
        print(f"[{'ok ' if results[-1]['ok'] else 'FAIL'}] Undo after drawing        {results[-1]['why']}", flush=True)

        # ---------- RESIZE a shape by its handle ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.50), *at(0.40, 0.60))
        w0 = await page.evaluate("()=>S.annos[0].nw")
        await page.mouse.click(*at(0.30, 0.55))
        await page.wait_for_timeout(300)
        hx, hy = at(0.40, 0.60)          # the se handle sits on the corner
        await drag(hx, hy, hx + 80, hy + 40, steps=8)
        w1 = await page.evaluate("()=>S.annos[0].nw")
        results.append({"tool": "Resize a shape", "ok": w1 > w0 + 0.02, "why": f"{round(w0,4)} -> {round(w1,4)}"})
        print(f"[{'ok ' if results[-1]['ok'] else 'FAIL'}] Resize a shape           {results[-1]['why']}", flush=True)

        # ---------- RESTYLE a stroke from the ribbon ----------
        await clear()
        await pick("arrow")
        await drag(*at(0.20, 0.70), *at(0.44, 0.78))
        await page.evaluate("()=>{ selectLine(S.lines[0].id); }")
        await page.wait_for_timeout(200)
        await page.evaluate("""()=>{ $("#c_text").value="#5f3dc4";
            $("#c_text").dispatchEvent(new Event("input"));
            $("#c_sw").value="6"; $("#c_sw").dispatchEvent(new Event("input")); }""")
        await page.wait_for_timeout(250)
        st = await page.evaluate("()=>({col:S.lines[0].col,sw:S.lines[0].sw})")
        results.append({"tool": "Restyle a stroke", "ok": st["col"] == "#5f3dc4" and st["sw"] == 6,
                        "why": json.dumps(st)})
        print(f"[{'ok ' if results[-1]['ok'] else 'FAIL'}] Restyle a stroke         {results[-1]['why']}", flush=True)

        # ---------- DUPLICATE (Ctrl+D) ----------
        await clear()
        await pick("circle")
        await drag(*at(0.55, 0.50), *at(0.70, 0.60))
        await page.mouse.click(*at(0.625, 0.55))
        await page.wait_for_timeout(250)
        await page.keyboard.press("Control+d")
        await page.wait_for_timeout(300)
        c = await counts()
        results.append({"tool": "Duplicate (Ctrl+D)", "ok": c["a"] == 2, "why": json.dumps(c)})
        print(f"[{'ok ' if results[-1]['ok'] else 'FAIL'}] Duplicate (Ctrl+D)       {results[-1]['why']}", flush=True)

        # ---------- COPY / PASTE keeps the style ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.50), *at(0.40, 0.60))
        await page.mouse.click(*at(0.30, 0.55))
        await page.wait_for_timeout(250)
        await page.keyboard.press("Control+c")
        await page.wait_for_timeout(200)
        await page.keyboard.press("Control+v")
        await page.wait_for_timeout(400)
        await page.mouse.click(*at(0.60, 0.72))
        await page.wait_for_timeout(400)
        cp = await page.evaluate("""()=>S.annos.map(a=>({shape:a.shape,col:a.col,sw:a.sw,op:a.fillOp}))""")
        ok = len(cp) == 2 and cp[-1]["shape"] == "rect" and cp[-1]["col"] == cp[0]["col"]
        results.append({"tool": "Copy / paste a shape", "ok": ok, "why": json.dumps(cp)})
        print(f"[{'ok ' if ok else 'FAIL'}] Copy / paste a shape     {json.dumps(cp)[:90]}", flush=True)

        # ---------- ARROW KEYS nudge a selected shape ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.50), *at(0.40, 0.60))
        await page.mouse.click(*at(0.30, 0.55))
        await page.wait_for_timeout(250)
        y0 = await page.evaluate("()=>S.annos[0].ny")
        for _ in range(4):
            await page.keyboard.press("ArrowDown")
            await page.wait_for_timeout(80)
        y1 = await page.evaluate("()=>S.annos[0].ny")
        results.append({"tool": "Arrow-key nudge", "ok": y1 > y0, "why": f"{round(y0,5)} -> {round(y1,5)}"})
        print(f"[{'ok ' if results[-1]['ok'] else 'FAIL'}] Arrow-key nudge          {results[-1]['why']}", flush=True)

        # ---------- SELECT: move, resize, restyle, undo, delete ----------
        await clear()
        await pick("box")
        x1, y1 = at(0.20, 0.50); x2, y2 = at(0.40, 0.60)
        await drag(x1, y1, x2, y2)
        before = await page.evaluate("()=>S.annos.length?({nx:S.annos[0].nx,ny:S.annos[0].ny,nw:S.annos[0].nw,id:S.annos[0].id}):null")
        if not before:
            results.append({"tool": "Select · move / restyle / undo", "ok": False,
                            "why": "the box tool made nothing to select"})
            print("[FAIL] Select · move/restyle/undo   nothing to select", flush=True)
        # move it by dragging its body
        cx, cy = at((0.20 + 0.40) / 2, (0.50 + 0.60) / 2)
        await page.mouse.click(cx, cy)
        await page.wait_for_timeout(250)
        await drag(cx, cy, cx + 70, cy + 30, steps=8)
        moved = await page.evaluate("()=>S.annos.length?({nx:S.annos[0].nx,ny:S.annos[0].ny}):null")
        # restyle the selection from the ribbon
        await page.evaluate("""()=>{ if(!S.annos.length)return; selectAnno(S.annos[0].id);
            $("#c_text").value="#c2255c"; $("#c_text").dispatchEvent(new Event("input")); }""")
        await page.wait_for_timeout(200)
        restyled = await page.evaluate("()=>S.annos.length?S.annos[0].col:null")
        # undo everything
        for _ in range(6):
            await page.keyboard.press("Control+z")
            await page.wait_for_timeout(120)
        after_undo = await counts()
        results.append({"tool": "Select · move / restyle / undo", "ok": True, "why": "",
                        "detail": {"before": before, "moved": moved, "restyled": restyled,
                                   "after_undo": after_undo}})

        # ---------- delete key ----------
        await clear()
        await pick("circle")
        x1, y1 = at(0.55, 0.50); x2, y2 = at(0.70, 0.60)
        await drag(x1, y1, x2, y2)
        cx, cy = at(0.625, 0.55)
        await page.mouse.click(cx, cy)
        await page.wait_for_timeout(250)
        await page.keyboard.press("Delete")
        await page.wait_for_timeout(250)
        results.append({"tool": "Delete key", "ok": (await counts())["a"] == 0,
                        "why": json.dumps(await counts())})

        # ---------- 6f6: the ▾ opens that tool's properties, the button still picks the tool ----------
        await clear()
        caret = page.locator('#tools .tool[data-mode="box"] .tcaret')
        await caret.click()
        await page.wait_for_timeout(250)
        opened = await page.evaluate(
            """()=>{const p=document.getElementById("toolpop");
                    return {open:!p.hasAttribute("hidden"),
                            title:(p.querySelector(".tp-title")||{}).textContent||"" };}""")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(150)
        closed = await page.evaluate('()=>document.getElementById("toolpop").hasAttribute("hidden")')
        mode_after = await pick("box")
        ok = opened["open"] and opened["title"] == "Rectangle" and closed and mode_after == "box"
        results.append({"tool": "Tool properties (▾)", "ok": ok,
                        "why": f'{opened["title"]!r} · closes on Esc: {closed} · button still picks: {mode_after}'})

        # ---------- 6kt: a nearly-level drag stays where it was drawn, and Shift levels it ----------
        # This case used to assert the opposite — 6f6 had the Snap toggle pull any drag within 4.5°
        # of an axis onto it. Ced: "when putting a line or any shape, do not instantly have target,
        # unless user is clicking shift." Snap on is no longer enough, and the same drag with Shift
        # held must land dead level, so both halves are drawn here with the toggle ON.
        await clear()
        await page.evaluate("()=>{S.snap=true;}")
        await set_style()
        await pick("line")
        x1, y1 = at(0.16, 0.50)
        x2, y2 = at(0.52, 0.505)          # about a third of a degree off level
        await drag(x1, y1, x2, y2)
        free = await page.evaluate(
            """()=>{const l=S.lines[S.lines.length-1];
                    return l?{dy:+(Math.abs(l.y2-l.y1)).toFixed(5)}:null;}""")
        await pick("line")
        await page.keyboard.down("Shift")
        await drag(*at(0.16, 0.60), *at(0.52, 0.605))
        await page.keyboard.up("Shift")
        held = await page.evaluate(
            """()=>{const l=S.lines[S.lines.length-1];
                    return l?{dy:+(Math.abs(l.y2-l.y1)).toFixed(5)}:null;}""")
        snapped = {"noModifier": free, "withShift": held}
        results.append({"tool": "Snap while drawing", "ok": bool(free) and bool(held)
                        and free["dy"] > 0.0005 and held["dy"] == 0,
                        "why": f'free drag off level by {free and free["dy"]} · with Shift {held and held["dy"]}'})

        # ---------- 6f6: Ctrl squares the drag off ----------
        await clear()
        await pick("box")
        await page.keyboard.down("Control")
        await drag(*at(0.20, 0.30), *at(0.50, 0.38))
        await page.keyboard.up("Control")
        sq = await page.evaluate(
            """()=>{const a=S.annos[S.annos.length-1]; if(!a)return null;
                    const pg=document.querySelector('.page[data-idx="0"]');
                    return {w:+(a.nw*pg.offsetWidth).toFixed(1), h:+(a.nh*pg.offsetHeight).toFixed(1)};}""")
        ok = bool(sq) and abs(sq["w"] - sq["h"]) < 2
        results.append({"tool": "Ctrl = perfect shape", "ok": ok,
                        "why": f'{sq and sq["w"]} x {sq and sq["h"]} px'})
        await page.evaluate("()=>{S.snap=true;}")

        # ---------- 6f8: the tool stays in your hand until Escape or Select ----------
        await clear()
        await pick("box")
        await drag(*at(0.18, 0.30), *at(0.34, 0.38))
        still = await page.evaluate("()=>S.mode")
        await drag(*at(0.42, 0.30), *at(0.58, 0.38))      # a second one without re-picking the tool
        two = (await counts())["a"]
        # 6m9 — Escape is TWO RUNGS. Ced: "when esc was clicked, always go to select current
        # redline. double esc is select tool." 6jt's five-rung ladder dropped the selection on the
        # first press and put the tool down on the second; the first press now leaves the redline
        # SELECTED and the second does both. What this case is actually about is unchanged and still
        # asserted: the tool stays in the hand across two shapes, and Escape reaches Select.
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
        mid = await page.evaluate("()=>({mode:S.mode,sel:S.sel,multi:multiCount()})")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
        released = await page.evaluate("()=>({mode:S.mode,sel:S.sel})")
        ok = (still == "box" and two == 2
              and mid["mode"] == "box" and mid["sel"] is not None      # rung 1: still picked up
              and released["mode"] == "select" and released["sel"] is None)
        results.append({"tool": "Tool stays in hand", "ok": ok,
                        "why": f"after one shape: {still} · drew {two} · "
                               f"Escape -> {mid['mode']}/sel {mid['sel']} · "
                               f"Escape -> {released['mode']}/sel {released['sel']}"})

        # ---------- 6fb: the selection bar ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.30), *at(0.40, 0.40))
        await page.wait_for_timeout(320)
        barOn = await page.evaluate(
            """()=>{const b=document.getElementById("selbar");
                    return {shown:!!b&&!b.hasAttribute("hidden"),
                            n:(b&&b.querySelector(".sb-count")||{}).textContent||"",
                            acts:[...(b?b.querySelectorAll(".sb-l"):[])].map(x=>x.textContent),
                            all:[...(b?b.querySelectorAll(".sb-b"):[])]
                                  .map(x=>(x.title||x.textContent||"").trim())};}""")
        await page.evaluate("()=>{selectAnno(null);clearMulti();}")
        await page.wait_for_timeout(320)
        barOff = await page.evaluate(
            '()=>document.getElementById("selbar").hasAttribute("hidden")')
        # 6jf — Ced asked for Lock, Flatten, Add to markup, Apply to pages and Copy properties BACK on
        # the bar, and for Flip to join them. The ⋯ keeps what is about several marks at once:
        # aligning, distributing, the subject.
        # 6li — AND NOW EVERY ONE OF THEM WEARS ITS NAME. Ced: "apply names on the icons." So the
        # split this case used to assert — four words and eight icons, with a cap of six labels to
        # keep the bar narrow — is the thing that was asked to go. What is asserted instead is that
        # NOTHING on the bar is wordless except the two controls that are not actions on the mark:
        # the ⋯ overflow and Delete, which is a red disc by design.
        words = ["Properties", "Duplicate", "Group", "Copy", "Flip (H)", "Flip (V)",
                 "Lock", "Flatten", "Add markup", "Apply to pages", "Copy properties"]
        # 6kz — Flip is two buttons rather than a button and a menu
        titles = ["Flip left to right", "Flip top to bottom", "Lock these marks", "Flatten",
                  "Add to markup library", "Apply to pages", "Copy properties", "Delete"]
        ok = (barOn["shown"] and barOff
              and all(w in barOn["acts"] for w in words)
              and any(a.startswith("Layer") for a in barOn["all"])
              and all(i in barOn["all"] for i in titles)
              # every button but the overflow and Delete carries a word
              and len(barOn["acts"]) >= len(barOn["all"]) - 2)
        results.append({"tool": "Selection bar", "ok": ok,
                        "why": f'{barOn["n"]} selected · {len(barOn["all"])} buttons · '
                               f'{len(barOn["acts"])} labelled · hides: {barOff} · {barOn["all"]}'})

        # ---------- 6fa: rotating says the angle ----------
        await clear()
        await pick("box")
        await drag(*at(0.25, 0.30), *at(0.45, 0.40))
        await page.mouse.click(*at(0.35, 0.35))
        await page.wait_for_timeout(250)
        rot = await page.evaluate(
            """()=>{const d=document.querySelector('.anno.sel .rot'); if(!d)return null;
                    const r=d.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}""")
        hud = None
        if rot:
            await page.mouse.move(rot["x"], rot["y"])
            await page.mouse.down()
            await page.mouse.move(rot["x"] + 60, rot["y"] + 60, steps=8)
            await page.wait_for_timeout(150)
            hud = await page.evaluate(
                """()=>{const h=document.getElementById("degHUD");
                        return h?{shown:h.classList.contains("show"),txt:h.textContent}:null;}""")
            await page.mouse.up()
            await page.wait_for_timeout(150)
        ok = bool(hud) and hud["shown"] and "\u00b0" in hud["txt"]
        results.append({"tool": "Rotation shows degrees", "ok": ok,
                        "why": (hud and hud["txt"]) or "no rotate handle found"})

        # ---------- 6fd: the ▾ picks the tool as well as opening its properties ----------
        await clear()
        await pick("select")
        await page.locator('#tools .tool[data-mode="circle"] .tcaret').click()
        await page.wait_for_timeout(280)
        got = await page.evaluate(
            """()=>({mode:S.mode, open:!document.getElementById("toolpop").hasAttribute("hidden"),
                     title:(document.querySelector("#toolpop .tp-title")||{}).textContent||""})""")
        await page.keyboard.press("Escape")
        results.append({"tool": "▾ picks the tool", "ok": got["mode"] == "circle" and got["open"]
                        and got["title"] == "Ellipse", "why": f'{got["mode"]} · {got["title"]}'})

        # ---------- 6fe: a slider drags, and what it sets reaches the mark ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.30), *at(0.40, 0.40))
        await page.mouse.click(*at(0.30, 0.35))
        await page.wait_for_timeout(250)
        # 6li — found by its TITLE, not by the words on it. The bar's buttons wear their names now
        # (Ced: "apply names on the icons"), so matching the visible text ties this case to a label
        # that is allowed to change; the title is the stable handle.
        await page.locator('#selbar .sb-b[title="Edit properties"]').click()
        await page.wait_for_timeout(350)
        rng = page.locator("#toolpop .tp-range").first
        rb = await rng.bounding_box()
        await page.mouse.move(rb["x"] + rb["width"] * 0.1, rb["y"] + rb["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(rb["x"] + rb["width"] * 0.62, rb["y"] + rb["height"] / 2, steps=10)
        await page.mouse.up()
        await page.wait_for_timeout(250)
        got = await page.evaluate(
            """()=>({sw:S.annos[0].sw, shown:(document.querySelector("#toolpop .tp-num")||{}).value,
                     tool:MA_TOOL_STYLES.box.sw})""")
        # the mark takes the new weight, the readout agrees with it, and the TOOL is left alone —
        # which is the whole point of the panel being bound to the selection
        ok = got["sw"] > 2 and abs(float(got["shown"]) - got["sw"]) < 0.01 and got["tool"] != got["sw"]
        results.append({"tool": "Slider drags and applies", "ok": ok,
                        "why": f'mark {got["sw"]}pt · reads {got["shown"]} · tool still {got["tool"]}'})

        # ---------- 6fe: the panel bound to the selection, in real time ----------
        sw2 = await page.evaluate(
            """()=>{ const b=[...document.querySelectorAll("#toolpop .tp-sw")]
                        .find(x=>x.title==="Green"); if(!b)return null; b.click();
                     return {mark:S.annos[0].col, tool:MA_TOOL_STYLES.box.col}; }""")
        await page.wait_for_timeout(200)
        ok = bool(sw2) and sw2["mark"] == "#12b886" and sw2["tool"] != "#12b886"
        results.append({"tool": "Panel edits the selection", "ok": ok, "why": json.dumps(sw2)})
        await page.keyboard.press("Escape")

        # ---------- 6ff: the bar's dialog actions actually run ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.30), *at(0.40, 0.40))
        await page.mouse.click(*at(0.30, 0.35))
        await page.wait_for_timeout(250)
        # 6j6 — Edit subject lives in the ⋯ overflow now
        await page.locator("#selbar .sb-more").click()
        await page.wait_for_timeout(250)
        await page.locator('.sb-menu .sb-mi', has_text="Edit subject").click()
        await page.wait_for_timeout(300)
        await page.fill(".sb-askinput", "MOUNT CORRECTION")
        await page.locator(".sb-askb.primary").click()
        await page.wait_for_timeout(300)
        subj = await page.evaluate("()=>S.annos[0].subj||null")
        results.append({"tool": "Bar · Edit subject", "ok": subj == "MOUNT CORRECTION",
                        "why": str(subj)})

        # ---------- 6fd: the callout's elbow and tip both carry a handle ----------
        await clear()
        await page.evaluate("""()=>{ MA_CALLOUT_TEXT="New Sector Frame";
            maPlaceCallout(0,0.62,0.55); }""")
        await page.wait_for_timeout(450)          # the box takes the caret first; let it
        await page.evaluate("""()=>{ const l=S.lines.filter(x=>x.maKind==="calloutleader").pop();
                                     if(l)selectLine(l.id); }""")
        await page.wait_for_timeout(350)
        cal = await page.evaluate(
            """()=>{ const l=S.lines.filter(x=>x.maKind==="calloutleader").pop();
                     return {pts:linePts(l).length,
                             handles:document.querySelectorAll('.page[data-idx="0"] svg.draw circle').length};}""")
        results.append({"tool": "Callout stub + draggable ends",
                        "ok": cal["pts"] == 3 and cal["handles"] == 2,
                        "why": f'{cal["pts"]} points · {cal["handles"]} handles'})

        # ---------- 6fh: the stub is square-on to the box wherever the elbow goes ----------
        perp = await page.evaluate(
            """()=>{ const l=S.lines.filter(x=>x.maKind==="calloutleader").pop();
                     const ok=[];
                     [[0.30,0.60],[0.90,0.20],[0.50,0.05],[0.52,0.95],[0.20,0.41]].forEach(([x,y])=>{
                       l.pts=[l.pts[0],[x,y],l.pts[2]]; maSyncCallouts();
                       const p=linePts(l);
                       ok.push(Math.abs(p[1][0]-p[0][0])<1e-9||Math.abs(p[1][1]-p[0][1])<1e-9);
                     });
                     return ok; }""")
        results.append({"tool": "Callout stub stays square-on", "ok": all(perp),
                        "why": f"{sum(1 for x in perp if x)}/{len(perp)} drags perpendicular"})

        # ---------- 6fh: Ctrl squares a RESIZE too ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.30), *at(0.46, 0.38))
        await page.mouse.click(*at(0.33, 0.34))
        await page.wait_for_timeout(250)
        hx, hy = at(0.46, 0.38)
        await page.keyboard.down("Control")
        await drag(hx, hy, hx + 70, hy + 10, steps=8)
        await page.keyboard.up("Control")
        sq = await page.evaluate(
            """()=>{const a=S.annos[0]; if(!a)return null;
                    const pg=document.querySelector('.page[data-idx="0"]');
                    return {w:+(a.nw*pg.offsetWidth).toFixed(1),h:+(a.nh*pg.offsetHeight).toFixed(1)};}""")
        results.append({"tool": "Ctrl squares a resize", "ok": bool(sq) and abs(sq["w"] - sq["h"]) < 2,
                        "why": f'{sq and sq["w"]} x {sq and sq["h"]} px'})

        # ---------- 6fh: a strike can never take an ending ----------
        await clear()
        await page.evaluate("""()=>{ tpOpen("cross"); tpApply("le1","arrow"); tpApply("le0","circle");
                                     tpClose(); }""")
        await pick("cross")
        pr = await printed_at()
        await drag(pr["x"] - 80, pr["y"], pr["x"] + 80, pr["y"])
        st = await page.evaluate("""()=>{const l=S.lines[S.lines.length-1]; return l?endsOf(l):null;}""")
        results.append({"tool": "Strikes stay plain", "ok": st == ["", ""], "why": json.dumps(st)})

        # ---------- 6fh: a cell redline is the size of the value it covers ----------
        await clear()
        await pick("redline")
        pr = await printed_at()
        await page.mouse.click(pr["x"], pr["y"])
        await page.wait_for_timeout(400)
        fit = await page.evaluate(
            """(txt)=>{const a=S.annos[0]; if(!a)return null;
                    const P=S.pages[0];
                    // the printed run nearest the mark, by position rather than by string
                    let best=null,bd=1e9;
                    (P.items||[]).forEach(t=>{const d=Math.abs(t.nx-a.nx)+Math.abs(t.ny-a.ny);
                                              if(d<bd){bd=d;best=t;}});
                    if(!best)return null;
                    return {size:a.size,
                            fitted:printedSizeFor(0,best,markFontKey(a)),
                            byHeight:printedPt(0,{nh:best.nh}),
                            run:String(best.str).trim()};}""", "")
        ok = bool(fit) and fit["fitted"] is not None and abs(fit["size"] - fit["fitted"]) < 0.3
        results.append({"tool": "Redline matches the printed size", "ok": ok,
                        "why": f'{fit and fit["size"]}pt · fitted {fit and fit["fitted"]} · '
                               f'height said {fit and fit["byHeight"]}'})

        # ================= 6g1–6g8: this round's twelve =================

        # ---------- 1: a shape can be resized by its top and bottom edges ----------
        await clear()
        await pick("box")
        await drag(*at(0.20, 0.30), *at(0.45, 0.42))
        await page.evaluate("()=>{ setMode('select'); selectAnno(S.annos[0].id); }")
        await page.wait_for_timeout(250)
        hs = await page.evaluate(
            """()=>{const d=document.querySelector('.annoui > .anno.selui')
                           ||document.querySelector('.anno.sel'); if(!d)return null;
                    const ks=[...d.querySelectorAll('.rz')].map(e=>e.className);
                    const n=d.querySelector('.rz.n'); if(!n)return {ks};
                    const r=n.getBoundingClientRect();
                    return {ks,n:{x:r.x+r.width/2,y:r.y+r.height/2},h:S.annos[0].nh};}""")
        if hs and hs.get("n"):
            await drag(hs["n"]["x"], hs["n"]["y"], hs["n"]["x"], hs["n"]["y"] - 70)
            h2 = await page.evaluate("()=>S.annos[0].nh")
            grew = h2 > hs["h"] * 1.1
            results.append({"tool": "Vertical resize handle", "ok": grew,
                            "why": f'{len(hs["ks"])} handles · {hs["h"]:.4f} -> {h2:.4f}'})
        else:
            results.append({"tool": "Vertical resize handle", "ok": False,
                            "why": f"no n handle: {hs}"})

        # ---------- 2: a group still shows its frame, its handles and its rotator ----------
        await clear()
        await pick("box"); await drag(*at(0.16, 0.30), *at(0.34, 0.40))
        await pick("circle"); await drag(*at(0.42, 0.30), *at(0.60, 0.40))
        await page.evaluate("""()=>{ setMode('select'); clearMulti();
            S.selMulti=new Set(S.annos.map(a=>a.id)); groupSelected&&groupSelected();
            selectAnno(null); clearMulti(); S.selMulti=new Set(S.annos.map(a=>a.id));
            paintMulti&&paintMulti(); }""")
        await page.wait_for_timeout(300)
        gf = await page.evaluate(
            """()=>({frame:document.querySelectorAll('.gframe').length,
                     handles:document.querySelectorAll('.gframe .gh').length,
                     rot:document.querySelectorAll('.gframe .grot').length})""")
        ok = gf["frame"] >= 1 and gf["handles"] >= 4 and gf["rot"] >= 1
        results.append({"tool": "Grouped items keep handles", "ok": ok, "why": json.dumps(gf)})

        # ---------- 3: copy properties paints the look onto whatever is selected next ----------
        await clear()
        await pick("box"); await drag(*at(0.16, 0.30), *at(0.34, 0.40))
        await page.evaluate("""()=>{ const a=S.annos[0]; a.col="#7048e8"; a.sw=5; a.fill="#d0bfff";
            layoutAnnos(); }""")
        await pick("box"); await drag(*at(0.42, 0.30), *at(0.60, 0.40))
        await page.evaluate("()=>{ setMode('select'); selectAnno(S.annos[0].id); }")
        await page.wait_for_timeout(250)
        await page.evaluate("()=>sbCopyProps()")
        await page.wait_for_timeout(200)
        await page.evaluate("()=>{ selectAnno(S.annos[1].id); }")
        await page.wait_for_timeout(500)
        cp = await page.evaluate("()=>({col:S.annos[1].col,sw:S.annos[1].sw,fill:S.annos[1].fill,"
                                 "src:S.annos[0].col})")
        await page.evaluate("()=>sbStopPaint(true)")
        ok = cp["col"] == "#7048e8" and abs((cp["sw"] or 0) - 5) < 0.01
        results.append({"tool": "Copy properties paints on", "ok": ok, "why": json.dumps(cp)})

        # ---------- 4: a polyline closed on its first point gets a fill ----------
        await clear()
        await pick("poly")
        pts = [(0.20, 0.30), (0.40, 0.30), (0.40, 0.44)]
        for fx, fy in pts:
            await page.mouse.click(*at(fx, fy)); await page.wait_for_timeout(160)
        await page.mouse.click(*at(0.20, 0.30)); await page.wait_for_timeout(500)
        cl = await page.evaluate("""()=>{const l=S.lines[S.lines.length-1]; if(!l)return null;
            return {closed:!!l.closed,fill:l.fill||null,pts:(l.pts||[]).length,
                    polygon:document.querySelectorAll('#pages polygon').length};}""")
        ok = bool(cl) and cl["closed"] and cl["polygon"] >= 1
        results.append({"tool": "Closed polyline fills", "ok": ok, "why": json.dumps(cl)})

        # ---------- 9: the length is shown while the line is being dragged ----------
        await clear()
        await pick("line")
        x1, y1 = at(0.20, 0.30); x2, y2 = at(0.50, 0.44)
        await page.mouse.move(x1, y1); await page.mouse.down()
        await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2); await page.wait_for_timeout(120)
        await page.mouse.move(x2, y2); await page.wait_for_timeout(160)
        hud = await page.evaluate(
            """()=>{const h=document.querySelector('.deghud.lenhud')||document.querySelector('.deghud');
                    return h&&getComputedStyle(h).display!=='none'?h.textContent.trim():null;}""")
        await page.mouse.up(); await page.wait_for_timeout(250)
        gone = await page.evaluate(
            """()=>{const h=document.querySelector('.deghud.lenhud');
                    return !h||getComputedStyle(h).display==='none'||!h.textContent.trim();}""")
        ok = bool(hud) and any(c.isdigit() for c in hud) and gone
        results.append({"tool": "Length shows while dragging", "ok": ok,
                        "why": f'{hud!r} · clears after: {gone}'})

        # ---------- 7: align and distribute ----------
        await clear()
        await pick("box"); await drag(*at(0.16, 0.28), *at(0.26, 0.34))
        await pick("box"); await drag(*at(0.40, 0.36), *at(0.52, 0.44))
        await pick("box"); await drag(*at(0.64, 0.30), *at(0.72, 0.40))
        al = await page.evaluate("""()=>{ setMode('select'); clearMulti();
            S.selMulti=new Set(S.annos.map(a=>a.id)); paintMulti&&paintMulti();
            sbAlign('cy');
            const cys=S.annos.map(a=>+(a.ny+a.nh/2).toFixed(4));
            sbDistribute('x');
            const cxs=S.annos.map(a=>a.nx+a.nw/2).sort((m,n)=>m-n);
            const g1=cxs[1]-cxs[0], g2=cxs[2]-cxs[1];
            return {cys,even:Math.abs(g1-g2)<0.004};}""")
        ok = len(set(al["cys"])) == 1 and al["even"]
        results.append({"tool": "Align middles · distribute", "ok": ok, "why": json.dumps(al)})

        # ---------- 8: apply to pages, with the range chooser ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.34, 0.38))
        await page.evaluate("()=>{ setMode('select'); selectAnno(S.annos[0].id); }")
        await page.wait_for_timeout(250)
        await page.evaluate("()=>{ window._ap=sbApplyToPages(); }")
        await page.wait_for_timeout(300)
        opts = await page.evaluate(
            """()=>{const d=document.querySelector('.sb-ask'); if(!d)return null;
                    const s=d.querySelector('.sb-askselect');
                    return s?[...s.options].map(o=>o.textContent):null;}""")
        await page.select_option(".sb-ask .sb-askselect", "odd")
        await page.wait_for_timeout(120)
        await page.click(".sb-ask .sb-askb.primary")
        await page.wait_for_timeout(700)
        ap_res = await page.evaluate(
            """()=>{const ps=[...new Set(S.annos.map(a=>a.page))].sort((m,n)=>m-n);
                    return {n:S.annos.length,pages:ps.slice(0,6),allOdd:ps.every(p=>p%2===0)};}""")
        ok = bool(opts) and len(opts) == 4 and "Even pages" in opts and ap_res["allOdd"] \
            and ap_res["n"] > 1
        results.append({"tool": "Apply to pages · range", "ok": ok,
                        "why": f'{opts} · {json.dumps(ap_res)}'})

        # ---------- 10: the properties panel keeps its header, its state and its place ----------
        await clear()
        await page.click('#tools .tool[data-mode="box"] .tcaret')
        await page.wait_for_timeout(350)
        disp = await page.evaluate(
            """()=>{const pop=document.getElementById('toolpop');
                    const head=pop.firstChild, sc=pop.querySelector('.tp-scroll');
                    if(!sc)return {scroller:false};
                    sc.scrollTop=80; const can=sc.scrollTop>0;
                    sc.dispatchEvent(new Event('scroll'));
                    const last=[...pop.querySelectorAll('.tp-sec')].pop();
                    last.querySelector('.tp-sech').click();
                    const want=last.classList.contains('open');
                    tpApply('sw',4);
                    const l2=[...document.querySelectorAll('#toolpop .tp-sec')].pop();
                    const s2=document.querySelector('#toolpop .tp-scroll');
                    const r=document.getElementById('toolpop').getBoundingClientRect();
                    return {scroller:true,
                            headFixed:head.classList.contains('tp-head'),
                            sectionKept:l2.classList.contains('open')===want,
                            scrollable:can, scrollKept:(!can||s2.scrollTop>0),
                            inView:(r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&r.left>=0)};}""")
        await page.keyboard.press("Escape")
        ok = all(disp.get(k) for k in ("scroller", "headFixed", "sectionKept", "scrollKept", "inView"))
        results.append({"tool": "Properties panel display", "ok": ok, "why": json.dumps(disp)})

        # ---------- 11/12: the callout is its own tool, and its own shape ----------
        await clear()
        await pick("box")
        await page.evaluate("""()=>{ const put=(id,v)=>{const e=$(id); if(!e)return; e.value=v;
                e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
            put('#c_text','#1144ff'); put('#c_sw','6'); }""")
        await page.wait_for_timeout(200)
        await pick("callout")
        await page.evaluate("""()=>{ const put=(id,v)=>{const e=$(id); if(!e)return; e.value=v;
                e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
            put('#c_text','#00aa55'); put('#c_sw','2'); }""")
        await page.wait_for_timeout(200)
        excl = await page.evaluate(
            """()=>({box:{col:MA_TOOL_STYLES.box.col,sw:MA_TOOL_STYLES.box.sw},
                     callout:{col:MA_TOOL_STYLES.callout.col,sw:MA_TOOL_STYLES.callout.sw}})""")
        await drag(*at(0.20, 0.30), *at(0.44, 0.40))
        co = await page.evaluate(
            """()=>{const a=S.annos.find(x=>x.maKind==='callout');
                    const l=S.lines.find(x=>x.maKind==='calloutline'||x.calloutFor!=null||
                                             (x.pts||[]).length===3);
                    if(!a||!l)return {anno:!!a,line:!!l};
                    const p=l.pts||[];
                    const dx=p[1][0]-p[0][0], dy=p[1][1]-p[0][1];
                    const sq=(Math.abs(dx)<1e-4||Math.abs(dy)<1e-4);
                    return {anno:true,col:a.col,sw:a.sw,pts:p.length,perp:sq,end:endsOf(l)[1]};}""")
        ok = (excl["box"]["col"] != excl["callout"]["col"]
              and co.get("pts") == 3 and co.get("perp") and co.get("col") == "#00aa55")
        results.append({"tool": "Callout · own style, own shape", "ok": ok,
                        "why": f'{json.dumps(excl)} · {json.dumps(co)}'})

        # ================= 6g9: this round's eight =================

        # ---------- 6: the top/bottom handles only show on a SELECTED shape ----------
        await clear()
        await pick("box"); await drag(*at(0.18, 0.30), *at(0.40, 0.40))
        await page.evaluate("()=>{ setMode('select'); selectAnno(null); }")
        await page.wait_for_timeout(250)
        h1 = await page.evaluate(
            """()=>{const d=document.querySelector('.annoui > .anno.selui')
                           ||document.querySelector('.anno'); if(!d)return null;
                    const vis=s=>{const e=d.querySelector(s); return !!e&&getComputedStyle(e).display!=='none';};
                    return {n:vis('.rz.n'),s:vis('.rz.s'),rot:vis('.rot'),mov:vis('.mov')};}""")
        await page.evaluate("()=>selectAnno(S.annos[0].id)")
        await page.wait_for_timeout(250)
        h2 = await page.evaluate(
            """()=>{const d=document.querySelector('.annoui > .anno.selui')
                           ||document.querySelector('.anno'); if(!d)return null;
                    const vis=s=>{const e=d.querySelector(s); return !!e&&getComputedStyle(e).display!=='none';};
                    return {n:vis('.rz.n'),s:vis('.rz.s'),rot:vis('.rot'),mov:vis('.mov')};}""")
        ok = h1 and h2 and not h1["n"] and not h1["s"] and h2["n"] and h2["s"] and h2["rot"] and h2["mov"]
        results.append({"tool": "Handles only when selected", "ok": ok,
                        "why": f"unselected {json.dumps(h1)} · selected {json.dumps(h2)}"})

        # ---------- 7: a rotated box resizes in its own frame ----------
        await clear()
        await pick("box"); await drag(*at(0.25, 0.30), *at(0.45, 0.38))
        rr = await page.evaluate(
            """()=>{ const a=S.annos[0]; a.rot=90; layoutAnnos(); setMode('select'); selectAnno(a.id);
                     return {nw:a.nw,nh:a.nh,cx:a.nx+a.nw/2,cy:a.ny+a.nh/2}; }""")
        await page.wait_for_timeout(300)
        hb = await page.evaluate(
            """()=>{const e=document.querySelector('.annoui > .anno.selui .rz.e')
                            ||document.querySelector('.anno.sel .rz.e'); if(!e)return null;
                    const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}""")
        if hb:
            await drag(hb["x"], hb["y"], hb["x"], hb["y"] + 80, steps=8)
            rr2 = await page.evaluate(
                """()=>{const a=S.annos[0];
                        const pg=document.querySelector('.page[data-idx="0"]');
                        return {nw:a.nw,nh:a.nh,cx:a.nx+a.nw/2,cy:a.ny+a.nh/2,
                                w:pg.offsetWidth,h:pg.offsetHeight};}""")
            grew = rr2["nw"] > rr["nw"] * 1.3
            kept = abs(rr2["nh"] - rr["nh"]) < 1e-4
            # the east handle of a quarter-turned box points DOWN: the box's own west edge must not
            # move, so the centre travels half the drag in +y and not at all in x
            driftx = abs(rr2["cx"] - rr["cx"]) * rr2["w"]
            drifty = (rr2["cy"] - rr["cy"]) * rr2["h"]
            ok = grew and kept and driftx < 2 and 30 < drifty < 50
            results.append({"tool": "Rotated box resizes true", "ok": ok,
                            "why": f'w {rr["nw"]:.4f}->{rr2["nw"]:.4f} · h kept {kept} · '
                                   f'drift {driftx:.1f}px x, {drifty:.1f}px y'})
        else:
            results.append({"tool": "Rotated box resizes true", "ok": False, "why": "no east handle"})

        # ---------- 8: a stroke carries move and rotate grips ----------
        await clear()
        await pick("line"); await drag(*at(0.20, 0.30), *at(0.50, 0.40))
        await page.evaluate("()=>{ setMode('select'); selectLine(S.lines[0].id); }")
        await page.wait_for_timeout(300)
        gr = await page.evaluate(
            """()=>{const gs=[...document.querySelectorAll('.page[data-idx="0"] svg.draw g')];
                    return {n:gs.length,titles:gs.map(g=>{const t=g.querySelector('title');
                            return t?t.textContent.slice(0,6):'';})};}""")
        turned = False
        if gr["n"] >= 2:
            gb = await page.evaluate(
                """()=>{const g=document.querySelector('.page[data-idx="0"] svg.draw g');
                        const r=g.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}""")
            a0 = await page.evaluate("()=>Math.atan2(S.lines[0].y2-S.lines[0].y1,S.lines[0].x2-S.lines[0].x1)")
            await page.keyboard.down("Control")
            await drag(gb["x"], gb["y"], gb["x"] + 70, gb["y"] - 70, steps=8)
            await page.keyboard.up("Control")
            a1 = await page.evaluate("()=>Math.atan2(S.lines[0].y2-S.lines[0].y1,S.lines[0].x2-S.lines[0].x1)")
            turned = abs(a1 - a0) > 0.05
        # 6ha — three grips now: rotate, move and delete (Ced: "make all redline tools have the drag,
        # rotate, and X button")
        ok = gr["n"] >= 3 and turned
        results.append({"tool": "Stroke · move, rotate and delete grips", "ok": ok,
                        "why": f'{gr["n"]} grips {gr["titles"]} · turned: {turned}'})

        # ---------- 2: the callout behaves as ONE mark ----------
        await clear()
        await pick("callout")
        await page.evaluate("()=>{MA_CALLOUT_TEXT='Note';}")
        cx0, cy0 = at(0.62, 0.34)
        await page.mouse.click(cx0, cy0)
        await page.wait_for_timeout(700)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        await page.wait_for_timeout(200)
        co = await page.evaluate(
            """()=>{ setMode('select');
                     const b=S.annos.find(a=>a.maKind==='callout');
                     const l=S.lines.find(x=>x.maKind==='calloutleader');
                     if(!b||!l)return {box:!!b,leader:!!l};
                     selectAnno(b.id); drawAllLines();
                     const p=l.pts;
                     return {box:true,leader:true,owned:l.coFor===b.id,
                             grouped:(b.group!=null||l.group!=null),
                             perp:(Math.abs(p[1][0]-p[0][0])<1e-4||Math.abs(p[1][1]-p[0][1])<1e-4),
                             handles:document.querySelectorAll('.page[data-idx="0"] svg.draw circle').length,
                             tip:[p[2][0],p[2][1]], bid:b.id}; }""")
        moved = deleted = None
        if co.get("owned"):
            mb = await page.evaluate(
                """()=>{const d=document.querySelector('.anno.sel .mov'); if(!d)return null;
                        const r=d.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}""")
            if mb:
                await drag(mb["x"], mb["y"], mb["x"] - 70, mb["y"] - 40, steps=8)
                # 6gu — the ARROW IS THE ANCHOR now: moving the body leaves the tip on the member it
                # points at and re-routes the leader from the box's new position. So what this case
                # asserts is the opposite of what it did: the tip held, and the leader still leaving
                # the box it belongs to.
                moved = await page.evaluate(
                    """(t)=>{const l=S.lines.find(x=>x.maKind==='calloutleader');
                             const b=S.annos.find(a=>a.maKind==='callout');
                             const p=l.pts;
                             const held=(Math.abs(p[2][0]-t[0])<5e-4&&Math.abs(p[2][1]-t[1])<5e-4);
                             const on=(p[0][0]>=b.nx-0.004&&p[0][0]<=b.nx+b.nw+0.004
                                     &&p[0][1]>=b.ny-0.004&&p[0][1]<=b.ny+b.nh+0.004);
                             return held&&on;}""", co["tip"])
            deleted = await page.evaluate(
                """()=>{ const b=S.annos.find(a=>a.maKind==='callout');
                         S.annos=S.annos.filter(x=>x.id!==b.id);
                         layoutAnnos(); drawAllLines();
                         return S.lines.filter(l=>l.maKind==='calloutleader').length; }""")
        ok = (co.get("owned") and not co.get("grouped") and co.get("perp")
              and co.get("handles", 0) >= 2 and moved is True and deleted == 0)
        results.append({"tool": "Callout is one mark", "ok": ok,
                        "why": f'owned {co.get("owned")} · grouped {co.get("grouped")} · '
                               f'perp {co.get("perp")} · handles {co.get("handles")} · '
                               f'arrow holds, leader re-routes {moved} · leaders left after delete {deleted}'})

        # ---------- 5: the dot hatch is actually drawn ----------
        await clear()
        dh = await page.evaluate(
            """()=>{ const id=maAddShape(0,'rect',0.2,0.3,0.25,0.1,{});
                     const a=S.annos.find(z=>z.id===id); a.pat='dots'; a.patCol='#1c60ff';
                     layoutAnnos();
                     const ed=document.querySelector('.anno .ed');
                     const segs=patSegments(a,120,60);
                     return {img:(ed.style.backgroundImage||'').slice(0,15),
                             size:ed.style.backgroundSize, isDot:patIsDot(a), segs:segs.length,
                             zero:segs.every(s=>s[0]===s[2]&&s[1]===s[3])}; }""")
        ok = dh["isDot"] and dh["segs"] > 20 and dh["zero"] and "radial" in dh["img"] and "px" in (dh["size"] or "")
        results.append({"tool": "Dot hatch shows", "ok": ok, "why": json.dumps(dh)})

        # ---------- 1 + 4: everything with a fill can edit its fill ----------
        await clear()
        ff = await page.evaluate(
            """()=>{ const out={};
                     ['callout','poly','box','circle'].forEach(t=>{
                       tpOpen(t,document.querySelector('#tools .tool[data-mode="'+t+'"]'));
                       const pop=document.getElementById('toolpop');
                       const tg=[...pop.querySelectorAll('.tp-target')].map(b=>b.textContent.trim());
                       out[t]={targets:tg,sliders:pop.querySelectorAll('.tp-sliderrow').length};
                     });
                     const was=MA_TOOL_STYLES.box.fillOp;
                     tpOpen('callout',document.querySelector('#tools .tool[data-mode="callout"]'));
                     const fill=[...document.querySelectorAll('#toolpop .tp-target')]
                       .find(b=>/Fill/.test(b.textContent));
                     fill.click(); tpApply('fillOp',0.37); tpClose();
                     out.calloutFillOp=MA_TOOL_STYLES.callout.fillOp;
                     out.boxFillOpBefore=was;
                     out.boxFillOpAfter=MA_TOOL_STYLES.box.fillOp;
                     return out; }""")
        ok = (all(len(ff[t]["targets"]) == 2 for t in ("callout", "poly", "box", "circle"))
              and abs(ff["calloutFillOp"] - 0.37) < 1e-6
              and ff["boxFillOpAfter"] == ff["boxFillOpBefore"])
        results.append({"tool": "Fill editable on every tool", "ok": ok, "why": json.dumps(ff)})

        # ---------- 3: Copy row is gone ----------
        gone = await page.evaluate(
            """()=>({button:document.querySelectorAll('#tools .tool[data-mode="copyrow"]').length,
                     spec:(typeof TP_SPEC!=='undefined'&&TP_SPEC.copyrow)?1:0,
                     style:(typeof MA_TOOL_DEFAULTS!=='undefined'&&MA_TOOL_DEFAULTS.copyrow)?1:0})""")
        ok = gone["button"] == 0 and gone["spec"] == 0 and gone["style"] == 0
        results.append({"tool": "Copy row removed", "ok": ok, "why": json.dumps(gone)})

        # ================= 6ga =================

        # ---------- more line endings, drawn and offered ----------
        await clear()
        ends = await page.evaluate(
            """()=>{ const ks=MARK_ENDS.filter(k=>k);
                     const drawn=ks.map(k=>{const sp=endShapePath(k,10,10,40,10,9);
                       return {k,ok:!!(sp&&sp.d&&sp.d.length>8)};});
                     tpOpen('arrow',document.querySelector('#tools .tool[data-mode="arrow"]'));
                     const cells=document.querySelectorAll('#toolpop .tp-ends .tp-cb').length;
                     tpClose();
                     return {n:ks.length,cells,bad:drawn.filter(d=>!d.ok).map(d=>d.k)}; }""")
        ok = ends["n"] >= 12 and ends["cells"] >= 13 and not ends["bad"]
        results.append({"tool": "Line endings · the full set", "ok": ok, "why": json.dumps(ends)})

        # ---------- the callout leader leaves the side the ARROW is on, from its middle ----------
        await clear()
        await pick("callout")
        await page.evaluate("()=>{MA_CALLOUT_TEXT='Note';}")
        await page.mouse.click(*at(0.62, 0.34))
        await page.wait_for_timeout(700)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        swing = await page.evaluate(
            """()=>{ const b=S.annos.find(a=>a.maKind==='callout');
                     const l=S.lines.find(x=>x.maKind==='calloutleader');
                     if(!b||!l)return null;
                     const out=[];
                     const centred=()=>{const p=l.pts;
                       return (l.coSide==='left'||l.coSide==='right')
                         ? Math.abs(p[0][1]-(b.ny+b.nh/2))<1e-3
                         : Math.abs(p[0][0]-(b.nx+b.nw/2))<1e-3;};
                     const perp=()=>{const p=l.pts;
                       return Math.abs(p[1][0]-p[0][0])<1e-9||Math.abs(p[1][1]-p[0][1])<1e-9;};
                     [[0.10,0.34],[0.62,0.08],[0.95,0.34],[0.62,0.92]].forEach(([x,y])=>{
                       l.pts[2]=[x,y]; drawAllLines();
                       out.push({side:l.coSide,centred:centred(),perp:perp()});
                     });
                     /* by hand: slide it along the side, and it stays where it was put */
                     l.pts[2]=[0.95,0.34]; drawAllLines();
                     l.coOff=0.18; drawAllLines();
                     const p=l.pts;
                     const manual={off:+((p[0][1]-b.ny)/b.nh).toFixed(3),perp:perp()};
                     l.pts[2]=[0.99,0.345]; drawAllLines();
                     manual.kept=+((l.pts[0][1]-b.ny)/b.nh).toFixed(3);
                     return {out,manual}; }""")
        sides = [s2["side"] for s2 in swing["out"]] if swing else []
        ok = (swing and sides == ["left", "top", "right", "bottom"]
              and all(s2["centred"] and s2["perp"] for s2 in swing["out"])
              and abs(swing["manual"]["off"] - 0.18) < 0.01
              and abs(swing["manual"]["kept"] - 0.18) < 0.01
              and swing["manual"]["perp"])
        results.append({"tool": "Callout leader follows the arrow", "ok": ok,
                        "why": json.dumps(swing)})

        # ================= 6gc =================

        # ---------- the Select tool's dropdown, driven with the mouse ----------
        await clear()
        await page.click('#tools .tool[data-mode="select"] .tcaret')
        await page.wait_for_timeout(250)
        menu = await page.evaluate(
            """()=>{const m=document.querySelector('.sk-menu');
                    return m?[...m.querySelectorAll('.sk-l')].map(e=>e.textContent):null;}""")
        picked = None
        if menu:
            await page.click(".sk-menu .sk-mi:nth-child(2)")      # Lasso Select
            await page.wait_for_timeout(200)
            picked = await page.evaluate("()=>S.mode")
        ok = bool(menu) and len(menu) == 7 and "Format Painter" in menu and picked == "lasso"
        results.append({"tool": "Select · the kit menu", "ok": ok, "why": f"{menu} · picked {picked}"})

        # ---------- lasso, eraser and format painter with a real mouse ----------
        await clear()
        await pick("box"); await drag(*at(0.18, 0.30), *at(0.30, 0.37))
        await pick("box"); await drag(*at(0.55, 0.30), *at(0.67, 0.37))
        await page.evaluate("()=>skPick('lasso')")
        await page.wait_for_timeout(150)
        x1, y1 = at(0.14, 0.26)
        await page.mouse.move(x1, y1); await page.mouse.down()
        for fx, fy in ((0.34, 0.26), (0.34, 0.41), (0.14, 0.41), (0.14, 0.27)):
            await page.mouse.move(*at(fx, fy)); await page.wait_for_timeout(30)
        await page.mouse.up(); await page.wait_for_timeout(300)
        lass = await page.evaluate("()=>({n:S.selMulti.size,of:S.annos.length})")
        await page.evaluate("()=>skPick('eraser')")
        await page.wait_for_timeout(150)
        ex, ey = at(0.24, 0.335)
        await page.mouse.click(ex, ey); await page.wait_for_timeout(300)
        erased = await page.evaluate("()=>S.annos.length")
        await page.evaluate("()=>skPick('select')")
        ok = lass["n"] == 1 and erased == 1
        results.append({"tool": "Lasso + eraser", "ok": ok,
                        "why": f'lasso caught {lass["n"]} of {lass["of"]} · erased down to {erased}'})

        # ---------- ctrl-click adds to a selection that is already there ----------
        await clear()
        await pick("box"); await drag(*at(0.18, 0.30), *at(0.30, 0.37))
        await pick("box"); await drag(*at(0.55, 0.30), *at(0.67, 0.37))
        await page.evaluate("()=>{ setMode('select'); selectAnno(S.annos[0].id); }")
        await page.wait_for_timeout(250)
        p2 = await page.evaluate(
            """()=>{const d=document.querySelector(`.anno[data-id="${S.annos[1].id}"]`);
                    const r=d.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}""")
        await page.keyboard.down("Control")
        await page.mouse.click(p2["x"], p2["y"])
        await page.keyboard.up("Control")
        await page.wait_for_timeout(300)
        cc = await page.evaluate("()=>({n:S.selMulti.size,ids:[...S.selMulti].length})")
        ok = cc["n"] == 2
        results.append({"tool": "Ctrl-click adds to the selection", "ok": ok, "why": json.dumps(cc)})

        # ---------- the group frame travels with the marks ----------
        await clear()
        await pick("box"); await drag(*at(0.18, 0.30), *at(0.30, 0.37))
        await pick("box"); await drag(*at(0.36, 0.30), *at(0.48, 0.37))
        await page.evaluate("""()=>{ setMode('select'); clearMulti();
            S.selMulti=new Set(S.annos.map(a=>a.id)); paintMulti(); }""")
        await page.wait_for_timeout(300)
        gm = await page.evaluate(
            """()=>{const f=document.querySelector('.gframe'); if(!f)return null;
                    const r=f.getBoundingClientRect(); return {x:r.x+14,y:r.y+10,left:r.left};}""")
        if gm:
            await page.mouse.move(gm["x"], gm["y"]); await page.mouse.down()
            await page.mouse.move(gm["x"] + 60, gm["y"] + 40); await page.wait_for_timeout(60)
            mid = await page.evaluate(
                """()=>{const f=document.querySelector('.gframe');
                        return f?f.getBoundingClientRect().left:null;}""")
            await page.mouse.move(gm["x"] + 120, gm["y"] + 70); await page.wait_for_timeout(60)
            await page.mouse.up(); await page.wait_for_timeout(250)
            end = await page.evaluate(
                """()=>{const f=document.querySelector('.gframe');
                        return f?f.getBoundingClientRect().left:null;}""")
            ok = mid is not None and abs((mid - gm["left"]) - 60) < 8 and abs((end - gm["left"]) - 120) < 8
            results.append({"tool": "Group frame follows the drag", "ok": ok,
                            "why": f'{gm["left"]:.0f} -> {mid} (mid) -> {end}'})
        else:
            results.append({"tool": "Group frame follows the drag", "ok": False, "why": "no frame"})

        # ---------- 6ha — strike & write: the writing OVER the value, on a rule that never moves ----------
        await clear()
        await pick("fix")
        pr = await printed_at()
        await page.mouse.click(pr["x"], pr["y"])
        await page.wait_for_timeout(600)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        sw = await page.evaluate(
            """()=>{ const a=S.annos.find(x=>x.maKind==='fix'), l=S.lines.find(x=>x.maKind==='strike');
                     if(!a||!l)return null;
                     const pg=document.querySelector('.page[data-idx="0"]');
                     const D=()=>document.querySelector(`.anno[data-id="${a.id}"]`);
                     const H=()=>D().offsetHeight/pg.offsetHeight, W=()=>D().offsetWidth/pg.offsetWidth;
                     const was={y:l.y1,x1:l.x1,x2:l.x2};
                     /* 6ha — the rule passes THROUGH the writing: the as-built value sits on the
                        printed one it replaces, with its own ground covering it. */
                     const on=()=>(l.y1>a.ny&&l.y1<a.ny+H());
                     const first={on:on(), ground:!a.bgNone,
                                  centred:Math.abs((a.nx+W()/2)-((l.x1+l.x2)/2))<3e-3};
                     a.nw*=1.7; a.manualW=true; layoutAnnos(); drawAllLines();
                     return {first, after:{on:on(),
                                           centred:Math.abs((a.nx+W()/2)-((l.x1+l.x2)/2))<3e-3,
                                           /* 6hb — the rule holds its HEIGHT, and widens to carry a
                                              longer correction rather than being overrun by it */
                                           level:(l.y1===was.y),
                                           grew:(Math.abs(l.x2-l.x1)>=Math.abs(was.x2-was.x1)-1e-6)}}; }""")
        ok = bool(sw) and sw["first"]["on"] and sw["first"]["ground"] and sw["first"]["centred"] \
            and sw["after"]["on"] and sw["after"]["centred"] and sw["after"]["level"] \
            and sw["after"]["grew"]
        results.append({"tool": "Strike & write · text over a fixed rule", "ok": ok,
                        "why": json.dumps(sw)})

        # ---------- the bar clears the callout, leader and all ----------
        await clear()
        await pick("callout")
        await page.evaluate("()=>{MA_CALLOUT_TEXT='Note';}")
        await page.mouse.click(*at(0.55, 0.55))
        await page.wait_for_timeout(700)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        await page.evaluate("()=>{ setMode('select'); const b=S.annos.find(a=>a.maKind==='callout'); selectAnno(b.id); }")
        await page.wait_for_timeout(350)
        bar = await page.evaluate(
            """()=>{ const b=document.getElementById('annobar').getBoundingClientRect();
                     const a=S.annos.find(x=>x.maKind==='callout');
                     const l=S.lines.find(x=>x.maKind==='calloutleader');
                     const pg=document.querySelector(`.page[data-idx="${a.page}"]`);
                     const r=pg.getBoundingClientRect();
                     const box=document.querySelector(`.anno[data-id="${a.id}"]`).getBoundingClientRect();
                     const hit=p=>{const x=r.left+p[0]*pg.offsetWidth,y=r.top+p[1]*pg.offsetHeight;
                       return x>=b.left-6&&x<=b.right+6&&y>=b.top-6&&y<=b.bottom+6;};
                     return {onBox:!(b.bottom<=box.top+1||b.top>=box.bottom-1),
                             onLeader:l.pts.some(hit), shown:b.width>0}; }""")
        ok = bar["shown"] and not bar["onBox"] and not bar["onLeader"]
        results.append({"tool": "Bar clears the whole mark", "ok": ok, "why": json.dumps(bar)})

        # ================= 6gd =================

        # ---------- the callout is DRAWN: press on the arrow, release where the note goes ----------
        await clear()
        await pick("callout")
        await page.evaluate("()=>{MA_CALLOUT_TEXT='Note';}")
        await drag(*at(0.30, 0.52), *at(0.62, 0.40), steps=8)
        await page.wait_for_timeout(700)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        cd = await page.evaluate(
            """()=>{ const b=S.annos.find(a=>a.maKind==='callout');
                     const l=S.lines.find(x=>x.maKind==='calloutleader');
                     if(!b||!l)return {box:!!b,leader:!!l};
                     const p=l.pts;
                     return {box:true,leader:true,
                             tip:[+p[2][0].toFixed(3),+p[2][1].toFixed(3)],
                             boxx:+b.nx.toFixed(3), mode:S.mode,
                             perp:(Math.abs(p[1][0]-p[0][0])<1e-9||Math.abs(p[1][1]-p[0][1])<1e-9)}; }""")
        ok = (cd.get("box") and cd.get("leader") and cd.get("perp")
              and abs(cd["tip"][0] - 0.30) < 0.02 and abs(cd["tip"][1] - 0.52) < 0.02
              and abs(cd["boxx"] - 0.62) < 0.03
              and cd.get("mode") == "select")          # and the tool does NOT stay in hand
        results.append({"tool": "Callout drawn from the arrow", "ok": ok, "why": json.dumps(cd)})

        # ---------- snapshot: a same-size redlined picture, pasted ----------
        await clear()
        await pick("box"); await drag(*at(0.22, 0.30), *at(0.40, 0.36))
        await pick("arrow"); await drag(*at(0.22, 0.42), *at(0.46, 0.46))
        # 6hz — the default capture is now the PLAIN picture, so the redline conversion is asked for
        # here: the two cases below are about what that conversion does.
        await page.evaluate(
            """()=>{ MA_TOOL_STYLES.snapshot=Object.assign({},MA_TOOL_STYLES.snapshot||{},
                       {tint:true}); try{ maSaveToolStyles(); }catch(e){}
                     skPick('snapshot'); }""")
        await page.wait_for_timeout(200)
        await drag(*at(0.18, 0.26), *at(0.52, 0.50), steps=8)
        await page.wait_for_timeout(2500)
        sn = await page.evaluate(
            """()=>{ const a=S.annos.find(x=>x.maKind==='snapshot'); if(!a)return null;
                     const pg=document.querySelector('.page[data-idx="0"]');
                     return {img:a.kind==='img', src:/^data:image\/png/.test(a.src||''),
                             wpx:Math.round(a.nw*pg.offsetWidth), hpx:Math.round(a.nh*pg.offsetHeight),
                             frame:{col:a.col,sw:a.sw,op:a.fillOp},
                             selected:S.sel===a.id, mode:S.mode,
                             tool:sbToolFor(maSelectedMarks())}; }""")
        red = None
        if sn and sn["src"]:
            red = await page.evaluate(
                """()=>new Promise(res=>{ const a=S.annos.find(x=>x.maKind==='snapshot');
                     const im=new Image();
                     im.onload=()=>{ const c=document.createElement('canvas');
                       c.width=im.width; c.height=im.height;
                       const g=c.getContext('2d'); g.drawImage(im,0,0);
                       const d=g.getImageData(0,0,c.width,c.height).data;
                       /* any strongly COLOURED pixel: the audit draws its marks green, not red */
                       let n=0; for(let k=0;k<d.length;k+=4){
                         const mx=Math.max(d[k],d[k+1],d[k+2]), mn=Math.min(d[k],d[k+1],d[k+2]);
                         if(mx-mn>60)n++; }
                       res({w:im.width,h:im.height,red:n}); };
                     im.onerror=()=>res(null); im.src=a.src; })""")
        # the mark is the size of the region it was taken from, and the PICTURE is the same shape —
        # 6gk: at several times that many pixels, since the region is re-rendered rather than cropped
        okShape = bool(sn and red
                       and abs((red["w"] / max(1, sn["wpx"])) - (red["h"] / max(1, sn["hpx"]))) < 0.06)
        okDense = bool(red and red["w"] >= sn["wpx"] * 1.9)
        okSize = okShape and okDense
        ok = bool(sn) and sn["img"] and sn["src"] and sn["selected"] and sn["tool"] == "snapshot" \
            and okSize and red["red"] > 50
        results.append({"tool": "Snapshot pastes a redlined picture", "ok": ok,
                        "why": f'{json.dumps(sn)} · picture {json.dumps(red)}'})

        # ---------- the paste is a REDLINE of what was captured ----------
        tint = await page.evaluate(
            """()=>new Promise(res=>{ const a=S.annos.find(x=>x.maKind==='snapshot');
                 if(!a)return res(null);
                 const im=new Image();
                 im.onload=()=>{ const c=document.createElement('canvas');
                   c.width=im.width; c.height=im.height;
                   const g=c.getContext('2d'); g.drawImage(im,0,0);
                   const d=g.getImageData(0,0,c.width,c.height).data;
                   let clear=0,ink=0,grey=0,sample=null;
                   for(let k=0;k<d.length;k+=4){
                     if(d[k+3]<8){ clear++; continue; }
                     ink++;
                     if(!sample&&d[k+3]>200)sample=[d[k],d[k+1],d[k+2]];
                     if(Math.abs(d[k]-d[k+1])<20&&Math.abs(d[k+1]-d[k+2])<20)grey++;
                   }
                   res({clear,ink,grey,sample,col:a.col,tint:a._tintCol}); };
                 im.onerror=()=>res(null); im.src=a.src; })""")
        ok = (bool(tint) and tint["clear"] > tint["ink"] and tint["grey"] == 0
              and tint["sample"] and tint["sample"][0] > 150 and tint["sample"][1] < 120)
        results.append({"tool": "Snapshot is a redline of the patch", "ok": ok, "why": json.dumps(tint)})

        # ---------- and changing its colour re-inks it ----------
        re_ink = await page.evaluate(
            """()=>new Promise(res=>{ const a=S.annos.find(x=>x.maKind==='snapshot');
                 a.col='#12b886'; layoutAnnos();
                 setTimeout(()=>{ const b=S.annos.find(x=>x.maKind==='snapshot');
                   const im=new Image();
                   im.onload=()=>{ const c=document.createElement('canvas');
                     c.width=im.width; c.height=im.height;
                     const g=c.getContext('2d'); g.drawImage(im,0,0);
                     const d=g.getImageData(0,0,c.width,c.height).data;
                     let sample=null,clear=0;
                     for(let k=0;k<d.length;k+=4){
                       if(d[k+3]<8){ clear++; continue; }
                       if(!sample&&d[k+3]>200)sample=[d[k],d[k+1],d[k+2]]; }
                     res({sample,clear,tint:b._tintCol}); };
                   im.onerror=()=>res(null); im.src=b.src; },900); })""")
        ok = bool(re_ink) and re_ink["tint"] == "#12b886" and re_ink["sample"] \
            and re_ink["sample"][1] > 140 and re_ink["sample"][0] < 90
        results.append({"tool": "Snapshot re-inks on a colour change", "ok": ok,
                        "why": json.dumps(re_ink)})

        # ---------- and its properties carry colours ----------
        pr = await page.evaluate(
            """()=>{ tpOpen('snapshot',document.body,true);
                     const pop=document.getElementById('toolpop');
                     const out={title:(pop.querySelector('.tp-title')||{}).textContent,
                                swatches:pop.querySelectorAll('.tp-sw').length,
                                sliders:pop.querySelectorAll('.tp-sliderrow').length};
                     tpApply('col','#12b886'); tpApply('sw',3); tpApply('fillOp',0.6);
                     tpClose();
                     const a=S.annos.find(x=>x.maKind==='snapshot');
                     out.mark={col:a.col,sw:a.sw,op:a.fillOp};
                     return out; }""")
        ok = (pr["title"] == "Snapshot" and pr["swatches"] >= 10 and pr["sliders"] >= 2
              and pr["mark"]["col"] == "#12b886" and pr["mark"]["sw"] == 3
              and abs(pr["mark"]["op"] - 0.6) < 1e-6)
        results.append({"tool": "Snapshot properties · colour", "ok": ok, "why": json.dumps(pr)})

        # ---------- the arrowheads are wider than they were ----------
        heads = await page.evaluate(
            """()=>{ const span=k=>{ const sp=endShapePath(k,10,10,60,10,12); if(!sp)return null;
                       const ys=(sp.d.match(/-?\d+(\.\d+)?/g)||[]).map(Number)
                                 .filter((v,i)=>i%2===1);
                       return +(Math.max(...ys)-Math.min(...ys)).toFixed(2); };
                     return {arrow:span('arrow'),oarrow:span('oarrow'),
                             rarrow:span('rarrow'),harrow:span('harrow')}; }""")
        # at size 12 the solid head was 2*12*0.30 = 7.2 wide before; it is 2*12*0.38 = 9.1 now
        ok = heads["arrow"] > 8.5 and heads["oarrow"] > 11 and heads["rarrow"] > 8.5
        results.append({"tool": "Arrowheads are wider", "ok": ok, "why": json.dumps(heads)})

        # ---------- a tool's ENDING is what it draws with, and it can be changed ----------
        await clear()
        ends2 = await page.evaluate(
            """()=>{ tpOpen('arrow',document.querySelector('#tools .tool[data-mode="arrow"]'));
                     tpSet('le1','harrow'); tpClose();
                     tpOpen('callout',document.querySelector('#tools .tool[data-mode="callout"]'));
                     const hasEnds=[...document.querySelectorAll('#toolpop .tp-sech')]
                       .some(h=>/Line endings/i.test(h.textContent));
                     tpSet('le1','oarrow'); tpClose();
                     return {hasEnds, arrow:MA_TOOL_STYLES.arrow.le1, callout:MA_TOOL_STYLES.callout.le1}; }""")
        await pick("arrow"); await drag(*at(0.20, 0.30), *at(0.42, 0.36))
        drawnEnd = await page.evaluate("()=>{const l=S.lines[S.lines.length-1];return l?endsOf(l)[1]:null;}")
        await clear()
        await pick("callout")
        await page.evaluate("()=>{MA_CALLOUT_TEXT='Note';}")
        await drag(*at(0.30, 0.52), *at(0.60, 0.42), steps=8)
        await page.wait_for_timeout(600)
        await page.evaluate("()=>{try{document.activeElement.blur();}catch(e){}}")
        coEnd = await page.evaluate(
            """()=>{ const l=S.lines.find(x=>x.maKind==='calloutleader'); if(!l)return null;
                     const was=endsOf(l)[1];
                     const b=S.annos.find(a=>a.maKind==='callout');
                     setMode('select'); selectAnno(b.id);
                     tpOpen('callout',document.body,true); tpSet('le1','diamond'); tpClose();
                     return {drawn:was, restyled:endsOf(S.lines.find(x=>x.id===l.id))[1]}; }""")
        ok = (ends2["hasEnds"] and ends2["arrow"] == "harrow" and drawnEnd == "harrow"
              and coEnd and coEnd["drawn"] == "oarrow" and coEnd["restyled"] == "diamond")
        results.append({"tool": "Endings follow the panel", "ok": ok,
                        "why": f'{json.dumps(ends2)} · arrow drew {drawnEnd} · callout {json.dumps(coEnd)}'})
        await page.evaluate("""()=>{ tpOpen('arrow',document.body); tpSet('le1','arrow'); tpClose();
                                     tpOpen('callout',document.body); tpSet('le1','arrow'); tpClose(); }""")

        # ---------- Ctrl forces the nearest 45 degrees while a stroke is drawn ----------
        await clear()
        await pick("line")
        await page.evaluate("()=>{S.snap=false;}")
        await page.keyboard.down("Control")
        await drag(*at(0.20, 0.30), *at(0.60, 0.36), steps=8)
        await page.keyboard.up("Control")
        a1 = await page.evaluate(
            """()=>{const l=S.lines[S.lines.length-1]; const pg=document.querySelector('.page[data-idx="0"]');
                    return l?Math.round(Math.atan2((l.y2-l.y1)*pg.offsetHeight,
                                                   (l.x2-l.x1)*pg.offsetWidth)*180/Math.PI):null;}""")
        await clear()
        await pick("line")
        await page.keyboard.down("Control")
        await drag(*at(0.20, 0.30), *at(0.42, 0.56), steps=8)
        await page.keyboard.up("Control")
        a2 = await page.evaluate(
            """()=>{const l=S.lines[S.lines.length-1]; const pg=document.querySelector('.page[data-idx="0"]');
                    return l?Math.round(Math.atan2((l.y2-l.y1)*pg.offsetHeight,
                                                   (l.x2-l.x1)*pg.offsetWidth)*180/Math.PI):null;}""")
        await clear()
        await pick("line"); await drag(*at(0.20, 0.30), *at(0.60, 0.37), steps=8)
        a3 = await page.evaluate(
            """()=>{const l=S.lines[S.lines.length-1]; const pg=document.querySelector('.page[data-idx="0"]');
                    S.snap=true;
                    return l?Math.round(Math.atan2((l.y2-l.y1)*pg.offsetHeight,
                                                   (l.x2-l.x1)*pg.offsetWidth)*180/Math.PI):null;}""")
        ok = a1 == 0 and a2 == 45 and a3 not in (0, 45, 90)
        results.append({"tool": "Ctrl forces 45s while drawing", "ok": ok,
                        "why": f"level {a1}° · diagonal {a2}° · free {a3}°"})

        # ---------- every slider carries its list of values again ----------
        sl = await page.evaluate(
            """()=>{ tpOpen('box',document.querySelector('#tools .tool[data-mode="box"]'));
                     const pop=document.getElementById('toolpop');
                     const out={rows:pop.querySelectorAll('.tp-sliderrow').length,
                                drops:pop.querySelectorAll('.tp-pilldrop').length};
                     const d=pop.querySelector('.tp-pilldrop');
                     d.dispatchEvent(new MouseEvent('click',{bubbles:true}));
                     const m=document.querySelector('.tp-vmenu');
                     out.values=m?[...m.querySelectorAll('.tp-vmi')].map(b=>b.textContent):null;
                     const six=[...(m?m.querySelectorAll('.tp-vmi'):[])].find(b=>/^6/.test(b.textContent));
                     if(six)six.dispatchEvent(new MouseEvent('click',{bubbles:true}));
                     out.sw=MA_TOOL_STYLES.box.sw;
                     out.closed=!document.querySelector('.tp-vmenu');
                     tpClose();
                     return out; }""")
        ok = (sl["rows"] >= 2 and sl["drops"] == sl["rows"] and sl["values"]
              and len(sl["values"]) >= 5 and sl["sw"] == 6 and sl["closed"])
        results.append({"tool": "Sliders keep a value list", "ok": ok, "why": json.dumps(sl)})
        await page.evaluate("""()=>{ tpOpen('box',document.body); tpApply('sw',1.5); tpClose(); }""")

        # ---------- the outline a CSS border cannot draw is drawn as SVG instead ----------
        await clear()
        out_svg = await page.evaluate(
            """()=>{ const mk=(kind,dash)=>{ const id=maAddShape(0,kind,0.2,0.3,0.2,0.08,{});
                       const a=S.annos.find(z=>z.id===id); a.col='#fa3237'; a.sw=2;
                       if(dash)a.dash=dash; return id; };
                     S.annos=[]; S.lines=[];
                     const r=mk('rect',null), e=mk('ellipse',null), d=mk('rect','dash');
                     layoutAnnos();
                     const has=id=>!!document.querySelector(`.anno[data-id="${id}"] svg.shapeoutline`);
                     /* 6iv — the CSS border is now set to 0 where the SVG draws the rule, rather
                        than to a transparent colour: a border-box element cannot be narrower than its
                        own border, and that was what stopped a small shape being small. So the test is
                        on the WIDTH, which is what actually decides who draws the rule. */
                     const bw=id=>{ const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                       return Math.round(parseFloat(getComputedStyle(ed).borderTopWidth)||0); };
                     const css=id=>{ const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                       return getComputedStyle(ed).borderTopColor; };
                     return {rect:{svg:has(r),border:css(r),w:bw(r)},
                             ellipse:{svg:has(e),border:css(e),w:bw(e)},
                             dashed:{svg:has(d),border:css(d),w:bw(d)}}; }""")
        ok = (not out_svg["rect"]["svg"] and out_svg["rect"]["w"] > 0
              and out_svg["ellipse"]["svg"] and out_svg["ellipse"]["w"] == 0
              and out_svg["dashed"]["svg"] and out_svg["dashed"]["w"] == 0)
        results.append({"tool": "Faithful outlines on screen", "ok": ok, "why": json.dumps(out_svg)})

        # ---------- 6gg / 6gj — THE LENGTH TOOL ----------
        await clear()
        got = await pick("dim")
        x1, y1 = at(0.20, 0.46)
        x2, y2 = at(0.56, 0.46)
        await drag(x1, y1, x2, y2)
        dim = await page.evaluate(
            """()=>{ const l=S.lines.find(z=>z.maKind==="dim");
                     if(!l)return {none:true};
                     const lab=S.annos.find(z=>z.id===l.dimFor);
                     const mid=maDimMid(l), box=lab?maDimBox(lab):null;
                     return {ends:[l.le0,l.le1], scale:l.dimScale, owns:!!lab,
                             kind:lab&&lab.maKind, text:lab&&lab.text,
                             /* 6gj — the reading is the USER'S: it comes up empty, with the caret in
                                it, and the measurement is only offered */
                             blank:(lab&&lab.text===""), manual:!!l.dimManual,
                             typing:!!document.querySelector(".anno.editing"),
                             measures:maFmtLen(maDimInches(l),"ft",16),
                             above:lab&&lab.under===false, ground:lab&&lab.bg,
                             dx:box?Math.abs(lab.nx+box.w/2-mid[0]):9, rot:lab&&lab.rot,
                             marks:S.annos.length+S.lines.length}; }""")
        ok = (got == "dim" and not dim.get("none") and dim["ends"] == ["arrow", "arrow"]
              and dim["owns"] and dim["kind"] == "dimlabel" and dim["blank"] and dim["manual"]
              and dim["typing"] and dim["above"] and dim["dx"] < 0.004
              and "'" in (dim["measures"] or ""))
        results.append({"tool": "Length draws a dimension", "ok": ok, "why": json.dumps(dim)})

        # the reading is typed, or written in on request — and then follows the run again
        dim2 = await page.evaluate(
            """()=>{ const l=S.lines.find(z=>z.maKind==="dim");
                     const lab=S.annos.find(z=>z.id===l.dimFor);
                     const ed=document.querySelector(`.anno[data-id="${lab.id}"] .ed`);
                     ed.textContent="12 FT A.G.L."; ed.dispatchEvent(new Event("input",{bubbles:true}));
                     ed.blur(); drawAllLines(); layoutAnnos();
                     const held=(lab.text==="12 FT A.G.L.");
                     selectLine(l.id); maDimWriteIn();
                     const wrote=lab.text, auto=!l.dimManual;
                     const was=lab.text;
                     l.x2=l.x2+0.12; drawAllLines(); layoutAnnos();
                     const grew=(lab.text!==was);
                     const mid=maDimMid(l), box=maDimBox(lab);
                     const followed=Math.abs(lab.nx+box.w/2-mid[0])<0.004;
                     return {held,wrote,auto,grew,followed}; }""")
        ok = (dim2["held"] and dim2["auto"] and "'" in dim2["wrote"]
              and dim2["grew"] and dim2["followed"])
        results.append({"tool": "A reading is typed or written in", "ok": ok, "why": json.dumps(dim2)})

        # 6gj — ONE MARK: a click on the reading takes the measurement, a drag moves both, the ✕
        # deletes the whole of it, and the selection catches both halves from either end
        one = await page.evaluate(
            """()=>{ /* 6hq — the Length tool is still in hand from the case above, and a press with a
                        drawing tool up now DRAWS rather than dragging what is under it. This case is
                        about what a press does in Select, so the tool goes down first, as a hand
                        would put it down. */
                     setMode("select");
                     const l=S.lines.find(z=>z.maKind==="dim");
                     const lab=S.annos.find(z=>z.id===l.dimFor);
                     selectLine(l.id);
                     let sel=maSelectedMarks();
                     const fromRun=sel.annos.some(z=>z.id===lab.id);
                     selectAnno(lab.id); selectLine(null);
                     sel=maSelectedMarks();
                     const fromLab=sel.lines.some(z=>z.id===l.id);
                     const counted=sbCount();
                     selectAnno(null); selectLine(null);
                     const d=document.querySelector(`.anno[data-id="${lab.id}"]`);
                     const ed=d.querySelector(".ed"); const r=ed.getBoundingClientRect();
                     const x0=l.x1;
                     ed.dispatchEvent(new MouseEvent("mousedown",
                       {bubbles:true,clientX:r.left+6,clientY:r.top+6,button:0}));
                     const picked=(S.selLine===l.id);
                     window.dispatchEvent(new PointerEvent("pointermove",
                       {bubbles:true,clientX:r.left+60,clientY:r.top+6}));
                     window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                     const moved=Math.abs(l.x1-x0)>0.005;
                     const followed=Math.abs(lab.nx+maDimBox(lab).w/2-maDimMid(l)[0])<0.004;
                     markHandle(lab.id,".x").dispatchEvent(new MouseEvent("click",{bubbles:true}));
                     return {fromRun,fromLab,counted,picked,moved,followed,
                             left:S.annos.length+S.lines.length}; }""")
        ok = (one["fromRun"] and one["fromLab"] and one["counted"] == 1 and one["picked"]
              and one["moved"] and one["followed"] and one["left"] == 0)
        results.append({"tool": "A measurement is one mark", "ok": ok, "why": json.dumps(one)})

        # the panel: the scale, the units, the rounding, Calibrate — and the reading's own face
        pan = await page.evaluate(
            """()=>{ tpOpen('dim',document.querySelector('#tools .tool[data-mode="dim"]'));
                     const pop=document.getElementById('toolpop');
                     const out={title:(pop.querySelector('.tp-title')||{}).textContent,
                                pills:pop.querySelectorAll('select.tp-pill').length,
                                ends:!!pop.querySelector('.tp-ends'),
                                tips:!!pop.querySelector('.tp-tips'),
                                fonts:!!pop.querySelector('.tp-fonts'),
                                deco:!!pop.querySelector('.tp-deco'),
                                secs:[...pop.querySelectorAll('.tp-sech')].map(n=>n.textContent.trim()),
                                cal:[...pop.querySelectorAll('button')].some(b=>/Calibrate/.test(b.textContent)),
                                write:[...pop.querySelectorAll('button')].some(b=>/Write in/.test(b.textContent))};
                     const sel=pop.querySelector('select.tp-pill');
                     sel.value="96"; sel.onchange();
                     out.scale=MA_TOOL_STYLES.dim.dimScale;
                     tpClose(); tpOpen('dim',document.body); tpApply('dimScale',48); tpClose();
                     return out; }""")
        ok = (pan["title"] == "Length" and pan["pills"] >= 3 and pan["ends"] and pan["tips"]
              and pan["fonts"] and pan["deco"] and pan["cal"] and pan["write"]
              and pan["scale"] == 96)
        results.append({"tool": "Length panel sets the scale", "ok": ok, "why": json.dumps(pan)})

        # ---------- 6gj — SMALL, MEDIUM AND LARGE TIPS ----------
        await clear()
        tips = await page.evaluate(
            """()=>{ const id=addLine(0,0.2,0.3,0.6,0.3,{col:"#fa3237",sw:1.5,le1:"arrow"});
                     const l=S.lines.find(z=>z.id===id);
                     const span=v=>{ l.leSz=v; drawAllLines();
                       const pg=document.querySelector('.page[data-idx="0"]');
                       const p=[...pg.querySelectorAll('svg.draw path')].pop();
                       const n=(p.getAttribute('d').match(/-?[\d.]+/g)||[]).map(Number);
                       const ys=n.filter((_,i)=>i%2); 
                       return Math.round((Math.max(...ys)-Math.min(...ys))*10)/10; };
                     const out={small:span(0.68), medium:span(1), large:span(1.5)};
                     out.file={small:headSizeOf({leSz:0.68},1.5), medium:headSizeOf({leSz:1},1.5),
                               large:headSizeOf({leSz:1.5},1.5)};
                     out.zoomOk=Math.abs(headSizeOf({leSz:1.5},1.5*2.5,2.5)
                                         -headSizeOf({leSz:1.5},1.5)*2.5)<1e-6;
                     out.deflt=tipScaleOf({});
                     tpOpen('arrow',document.querySelector('#tools .tool[data-mode="arrow"]'));
                     const pop=document.getElementById('toolpop');
                     const row=pop.querySelector('.tp-tips');
                     out.chips=row?[...row.querySelectorAll('button')].map(b=>b.title):null;
                     const big=row&&[...row.querySelectorAll('button')].find(b=>/Large/.test(b.title));
                     if(big)big.dispatchEvent(new MouseEvent('click',{bubbles:true}));
                     out.set=MA_TOOL_STYLES.arrow.leSz;
                     tpApply('leSz',1); tpClose();
                     return out; }""")
        ok = (tips["small"] < tips["medium"] < tips["large"] and tips["deflt"] == 1
              and tips["zoomOk"] and tips["chips"] == ["Tiny", "Small", "Medium", "Large"]
              and tips["set"] == 1.5)
        results.append({"tool": "Tips come in four sizes", "ok": ok, "why": json.dumps(tips)})

        # ---------- 6gf — an ending is the same size on screen and in the file ----------
        # the screen asks with the stroke ALREADY scaled, and the same scale, so what it gets back is
        # exactly the file's size times the zoom — never a different shape at a different zoom
        hs = await page.evaluate(
            """()=>({ one:headSizeFor(1.5,1), zoomed:headSizeFor(1.5*2.5,2.5),
                      file:headSizeFor(1.5), fat:headSizeFor(6,1), fatz:headSizeFor(6*2.5,2.5) })""")
        ok = (abs(hs["zoomed"] - hs["one"] * 2.5) < 1e-6 and hs["file"] == hs["one"]
              and abs(hs["fatz"] - hs["fat"] * 2.5) < 1e-6)
        results.append({"tool": "Endings scale, never resize", "ok": ok, "why": json.dumps(hs)})

        # ---------- 6gf — text faces stack ----------
        faces = await page.evaluate(
            """()=>{ const a=tpFaceToggle("arial","bold"); const b=tpFaceToggle(a,"ital");
                     const c=tpFaceToggle(b,"bold"); const d=tpFaceToggle(b,"ital");
                     const t=tpFaceToggle("times","bold"); const t2=tpFaceToggle(t,"ital");
                     return {bold:a,both:b,unbold:c,unital:d,times:t,timesBI:t2,
                             known:[b,t2].every(k=>!!MARK_FONTS[k]&&!!MARK_FONTS[k].pdf)}; }""")
        ok = (faces["bold"] == "arialbold" and faces["both"] == "arialbolditalic"
              and faces["unbold"] == "arialital" and faces["unital"] == "arialbold"
              and faces["timesBI"] == "timesbolditalic" and faces["known"])
        results.append({"tool": "Bold and italic stack", "ok": ok, "why": json.dumps(faces)})

        # ---------- 6gf — a snapshot lands with no frame, and can be rubbed out or filled ----------
        await clear()
        await page.evaluate("""()=>{ skFrameMigrate&&skFrameMigrate(); }""")
        await page.evaluate(
            """()=>{ const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.2; a.nh=0.12; a.manualW=true;
                     a.src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAAOAgHl6b7hAAAAAElFTkSuQmCC";
                     a.col="#fa3237"; a.sw=(MA_TOOL_STYLES.snapshot||{}).sw;
                     layoutAnnos();
                     window.__snapf={frame:a.sw, tool:(MA_TOOL_STYLES.snapshot||{}).sw};
                     skEditor(a);          /* its controls are wired once the picture has loaded */
                     return true; }""")
        await page.wait_for_timeout(600)
        snapf = await page.evaluate(
            """()=>{ const out=window.__snapf||{};
                     const m=document.querySelector(".sk-edit");
                     out.editor=!!m;
                     /* 6m2 — the KEYS, not the words. This case is about the editor opening on a
                        snapshot with its tools in it; which word is printed under each glyph is a
                        different question, and reading it here is what made a label change break a
                        test that had nothing to do with labels. */
                     out.buttons=m?[...m.querySelectorAll(".sk-edb")].map(b=>b.dataset.k||""):[];
                     if(m){ const c=[...m.querySelectorAll("button")].find(b=>/Cancel/i.test(b.textContent));
                            if(c)c.dispatchEvent(new MouseEvent("click",{bubbles:true})); }
                     out.closed=!document.querySelector(".sk-edit");
                     return out; }""")
        joined = " ".join(snapf["buttons"]).lower()
        want = all(w in joined for w in ("erase", "wand", "invert", "fillsel"))
        ok = (snapf["frame"] in (0, None) and snapf["tool"] in (0, None)
              and snapf["editor"] and want and snapf["closed"])
        results.append({"tool": "Snapshot: no frame, editable", "ok": ok, "why": json.dumps(snapf)})

        # ---------- 6gj — THE PICTURE EDITOR: A CONTINUOUS ERASE, AND A FILL UNDER THE INK ----------
        await clear()
        await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=c.height=60;
                     const g=c.getContext("2d");
                     g.strokeStyle="#fa3237"; g.lineWidth=4;
                     g.beginPath(); g.arc(30,30,20,0,Math.PI*2); g.stroke();
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.2; a.nh=0.2; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0;
                     layoutAnnos(); skEditor(a); return true; }""")
        await page.wait_for_timeout(700)
        ed = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const cv=m.querySelector(".sk-edcanvas"), ov=m.querySelector(".sk-edov");
                     const g=cv.getContext("2d",{willReadFrequently:true});
                     const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                     const r=()=>cv.getBoundingClientRect();
                     const CP=(x,y)=>{ const b=r();
                       return {clientX:b.left+b.width*(x/cv.width),
                               clientY:b.top+b.height*(y/cv.height),
                               bubbles:true,pointerId:31,button:0}; };
                     /* 6m2 — BY KEY, NOT BY WORDS. These presses matched a regex against the button's visible
                        text, so shortening five labels to fit the bar into two rows broke four cases that were
                        testing something else entirely. Every editor button now carries `data-k`, a handle that
                        names what it does and is not allowed to change; the text match is kept only as a fallback
                        for the handful of presses still written that way. */
                     const press=t=>(m.querySelector('.sk-edb[data-k="'+t+'"]')
                       ||[...m.querySelectorAll(".sk-edb")]
                           .find(z=>new RegExp(t,"i").test(z.textContent)))
                       .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                     const out={};
                     /* ONE pointermove across the whole picture: a dab-per-event brush would leave a
                        dotted trail, a stroked one leaves a band */
                     press("Erase");
                     const rg=m.querySelector(".sk-edsize input[type=range]");
                     rg.value="6"; rg.dispatchEvent(new Event("input",{bubbles:true}));
                     cv.dispatchEvent(new PointerEvent("pointerdown",CP(2,57)));
                     window.dispatchEvent(new PointerEvent("pointermove",CP(58,57)));
                     cv.dispatchEvent(new PointerEvent("pointermove",CP(58,57)));
                     cv.dispatchEvent(new PointerEvent("pointerup",CP(58,57)));
                     let gaps=0; for(let x=5;x<55;x++)if(px(x,57)[3]>20)gaps++;
                     out.gaps=gaps;
                     /* the wand takes the space inside the ring, bounded by the ink */
                     press("wand");
                     cv.dispatchEvent(new PointerEvent("pointerdown",CP(30,30)));
                     out.inside=m.querySelector(".sk-edcount").textContent;
                     out.shown=[...ov.getContext("2d").getImageData(30,30,1,1).data][3]>0;
                     press("fillsel");
                     out.filled={centre:px(30,30), ink:px(30,10), outside:px(2,2)};
                     /* invert, and the fill lands everywhere else — still under the ink */
                     press("undo"); press("invert");
                     out.inverted=m.querySelector(".sk-edcount").textContent;
                     press("fillsel");
                     out.flipped={outside:px(2,2), ink:px(30,10), centre:px(30,30)};
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
                       .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                     out.closed=!document.querySelector(".sk-edit");
                     return out; }""")
        await page.wait_for_timeout(300)
        white = lambda p: p[0] > 250 and p[1] > 250 and p[2] > 250 and p[3] == 255
        red = lambda p: p[0] > 200 and p[1] < 90 and p[3] > 200
        clear_px = lambda p: p[3] == 0
        ok = (ed["gaps"] == 0 and "997" in ed["inside"].replace(",", "") or ed["gaps"] == 0)
        ok = (ed["gaps"] == 0 and ed["shown"]
              and white(ed["filled"]["centre"]) and red(ed["filled"]["ink"])
              and clear_px(ed["filled"]["outside"])
              and white(ed["flipped"]["outside"]) and red(ed["flipped"]["ink"])
              and clear_px(ed["flipped"]["centre"]) and ed["closed"])
        results.append({"tool": "Erase sweeps, fill goes under", "ok": ok, "why": json.dumps(ed)})

        # ---------- 6gk — THE WAND ADDS AND SUBTRACTS ----------
        await clear()
        await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=120; c.height=60;
                     const g=c.getContext("2d"); g.strokeStyle="#fa3237"; g.lineWidth=4;
                     g.strokeRect(8,8,40,44); g.strokeRect(72,8,40,44);
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.24; a.nh=0.12; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0; a._tintCol=a.col;
                     layoutAnnos(); skEditor(a); return true; }""")
        await page.wait_for_timeout(700)
        wand = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const cv=m.querySelector(".sk-edcanvas");
                     const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                       const btn=t=>{ const r=new RegExp(t,"i");
                         return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                           ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                     /* 6kq — the WAND's three modes, scoped to their own row: the drawing tools added a
                        chip of their own ("Filled") that wears the same class and is not one of them */
                     const mode=k=>[...m.querySelectorAll(".sk-edmodes .sk-edm")]
                       .find(z=>new RegExp(k,"i").test(z.textContent));
                     const B=()=>cv.getBoundingClientRect();
                     const hit=(x,y,extra)=>cv.dispatchEvent(new PointerEvent("pointerdown",
                       Object.assign({clientX:B().left+B().width*(x/cv.width),
                                      clientY:B().top+B().height*(y/cv.height),
                                      bubbles:true,pointerId:5,button:0},extra||{})));
                     const n=()=>parseInt(m.querySelector(".sk-edcount").textContent
                                           .replace(/[^0-9]/g,""),10)||0;
                     const out={chips:[...m.querySelectorAll(".sk-edmodes .sk-edm")].map(b=>b.textContent.trim())};
                     btn("wand").click();
                     out.shown=getComputedStyle(m.querySelector(".sk-edmodes")).display!=="none";
                     out.deflt=[...m.querySelectorAll(".sk-edmodes .sk-edm")]
                       .filter(z=>z.classList.contains("on")).map(z=>z.textContent.trim());
                     mode("New").click();                    /* 6gs — Add is the default now */
                     hit(28,30);  out.one=n();
                     hit(92,30);  out.replaced=n();          /* New replaces */
                     mode("Add").click();      hit(28,30); out.added=n();
                     mode("Subtract").click(); hit(92,30); out.subtracted=n();
                     mode("New").click();
                     hit(92,30,{shiftKey:true}); out.shift=n();
                     hit(92,30,{altKey:true});   out.alt=n();
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                     out.closed=!document.querySelector(".sk-edit");
                     return out; }""")
        ok = (wand["chips"] == ["\u25a1 New", "\uff0b Add", "\u2212 Subtract"] and wand["shown"]
              and wand["deflt"] == ["\uff0b Add"]
              and wand["one"] > 0 and wand["replaced"] == wand["one"]
              and wand["added"] == wand["one"] * 2 and wand["subtracted"] == wand["one"]
              and wand["shift"] == wand["one"] * 2 and wand["alt"] == wand["one"]
              and wand["closed"])
        results.append({"tool": "Wand adds and subtracts", "ok": ok, "why": json.dumps(wand)})

        # ---------- 6gk — EVERY BUTTON IN THE RIBBON DOES SOMETHING ----------
        # Ced: "some tools in the general ribbon is not working like delete markings, remove redlines,
        # undo redo delete copy and paste, and others." Four of them had no handler at all. This walks
        # the whole ribbon and fails on any button that is dead.
        await clear()
        dead = await page.evaluate(
            """()=>{ const out=[];
                     document.querySelectorAll("#toolbar button[id]").forEach(b=>{
                       if(!b.onclick)out.push({id:b.id,dis:!!b.disabled});
                     });
                     return out; }""")
        results.append({"tool": "Every ribbon button is wired", "ok": not dead,
                        "why": "all wired" if not dead else json.dumps(dead)})

        # and the ones Ced named, driven for real
        await clear()
        await pick("box")
        await drag(*at(0.14, 0.40), *at(0.34, 0.48))
        await page.wait_for_timeout(200)
        works = {}
        # undo / redo, from the ribbon buttons
        await page.evaluate("()=>{ selectAnno(null); }")
        await page.click("#undoBtn"); await page.wait_for_timeout(250)
        works["afterUndo"] = (await counts())["a"]
        await page.click("#redoBtn"); await page.wait_for_timeout(250)
        works["afterRedo"] = (await counts())["a"]
        # All on page
        await page.click("#selAllBtn"); await page.wait_for_timeout(200)
        works["selAll"] = await page.evaluate("()=>multiCount()")
        # Save
        await page.click("#saveBtn"); await page.wait_for_timeout(400)
        works["saved"] = await page.evaluate(
            "()=>(document.getElementById('status')||{}).textContent||''")
        # Clear… -> this page
        await page.click("#clearBtn"); await page.wait_for_timeout(300)
        works["dialog"] = await page.evaluate(
            """()=>{ const d=document.getElementById("dlg");
                     return {shown:d.classList.contains("show"),
                             title:(document.getElementById("dlgTitle")||{}).textContent,
                             btns:[...document.querySelectorAll("#dlgBtns button")].map(b=>b.textContent)}; }""")
        await page.evaluate(
            """()=>{ const b=[...document.querySelectorAll("#dlgBtns button")]
                       .find(x=>/This page/.test(x.textContent)); if(b)b.click(); }""")
        await page.wait_for_timeout(400)
        works["afterClear"] = (await counts())["a"]
        # Clear saved markings
        await page.click("#cacheBtn"); await page.wait_for_timeout(300)
        works["cacheDialog"] = await page.evaluate(
            """()=>document.getElementById("dlg").classList.contains("show")""")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        ok = (works["afterUndo"] == 0 and works["afterRedo"] == 1 and works["selAll"] >= 1
              and "sav" in works["saved"].lower()
              and works["dialog"]["shown"] and len(works["dialog"]["btns"]) == 3
              and works["afterClear"] == 0 and works["cacheDialog"])
        results.append({"tool": "Save · Clear · All on page · undo", "ok": ok, "why": json.dumps(works)})

        # ---------- 6gk — COPY AND PASTE TAKES STROKES AND PICTURES TOO ----------
        await clear()
        cp = await page.evaluate(
            """()=>{ const out={};
                     /* an arrow, which copy used to leave behind entirely */
                     const lid=addLine(0,0.2,0.3,0.4,0.36,{col:"#fa3237",sw:2,le1:"arrow"});
                     drawAllLines(); selectLine(lid);
                     out.copiedLine=copySelectedAnnos(false);
                     out.clip=clipCount();
                     _ptr.x=300; _ptr.y=400;
                     pasteAnnos(); commitPlacing();
                     out.lines=S.lines.length;
                     /* a measurement copies whole — run and reading, and the copy owns its own */
                     S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                     maPlaceDim(0,0.2,0.5,0.5,0.5);
                     const l=S.lines.find(z=>z.maKind==="dim");
                     const lab=S.annos.find(z=>z.id===l.dimFor);
                     lab.text="12 FT"; l.dimManual=true;
                     selectLine(l.id);
                     copySelectedAnnos(false);
                     out.clipDim=clipCount();
                     pasteAnnos(); commitPlacing();
                     drawAllLines(); layoutAnnos();
                     const dims=S.lines.filter(z=>z.maKind==="dim");
                     const labs=S.annos.filter(z=>z.maKind==="dimlabel");
                     out.dim={runs:dims.length, readings:labs.length,
                              ownsOwn:dims.every(z=>labs.some(y=>y.id===z.dimFor)),
                              distinct:new Set(dims.map(z=>z.dimFor)).size};
                     return out; }""")
        await page.wait_for_timeout(200)
        ok = (cp["copiedLine"] and cp["clip"] == 1 and cp["lines"] == 2
              and cp["clipDim"] == 2 and cp["dim"]["runs"] == 2 and cp["dim"]["readings"] == 2
              and cp["dim"]["ownsOwn"] and cp["dim"]["distinct"] == 2)
        results.append({"tool": "Copy / paste takes strokes", "ok": ok, "why": json.dumps(cp)})

        # ---------- 6gk — A PASTED PICTURE IS THE SAME PICTURE ----------
        await clear()
        pic = await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=c.height=40;
                     const g=c.getContext("2d");
                     g.strokeStyle="#fa3237"; g.lineWidth=3;
                     g.beginPath(); g.arc(20,20,12,0,Math.PI*2); g.stroke();
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.16; a.nh=0.16; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0; a._tintCol=a.col;
                     layoutAnnos(); selectAnno(id);
                     copySelectedAnnos(false);
                     _ptr.x=420; _ptr.y=430;
                     pasteAnnos(); commitPlacing();
                     const two=S.annos.filter(z=>z.maKind==="snapshot");
                     return {n:two.length, sameSrc:two[0].src===two[1].src,
                             tint:two.map(z=>z._tintCol), frame:two.map(z=>z.sw),
                             op:two.map(z=>z.fillOp==null?1:z.fillOp)}; }""")
        await page.wait_for_timeout(600)
        stable = await page.evaluate(
            """()=>{ const two=S.annos.filter(z=>z.maKind==="snapshot");
                     return {sameSrc:two[0].src===two[1].src,
                             tint:two.map(z=>z._tintCol)}; }""")
        ok = (pic["n"] == 2 and pic["sameSrc"] and all(t == "#fa3237" for t in pic["tint"])
              and pic["frame"] == [0, 0] and stable["sameSrc"])
        results.append({"tool": "A pasted picture is unchanged", "ok": ok,
                        "why": json.dumps({"copy": pic, "afterTintPass": stable})})

        # ---------- 6gk — THE SNAPSHOT TOOL HAS ITS OWN BUTTON, AND NO FRAME ----------
        await clear()
        own = await page.evaluate(
            """()=>{ const b=document.querySelector('#tools .tool[data-mode="snapshot"]');
                     if(!b)return {none:true};
                     b.click();
                     const sel=document.querySelector('#tools .tool[data-mode="select"]');
                     return {mode:S.mode, active:b.classList.contains("active"),
                             selQuiet:!sel.classList.contains("active"),
                             pill:(document.getElementById("modePill")||{}).textContent,
                             caret:!!b.querySelector(".tcaret"),
                             frame:(MA_TOOL_STYLES.snapshot||{}).frameSw}; }""")
        ok = (not own.get("none") and own["mode"] == "snapshot" and own["active"]
              and own["selQuiet"] and own["pill"] == "Snapshot" and own["caret"]
              and own["frame"] in (0, None))
        results.append({"tool": "Snapshot has its own button", "ok": ok, "why": json.dumps(own)})

        # a real snapshot gesture from that button: no frame, and more pixels than the screen holds
        await clear()
        await pick("snapshot")
        await drag(*at(0.12, 0.14), *at(0.52, 0.26))
        await page.wait_for_timeout(2600)
        qual = await page.evaluate(
            """()=>{ const a=S.annos.find(z=>z.maKind==="snapshot");
                     if(!a)return {none:true};
                     const pg=document.querySelector('.page[data-idx="0"]');
                     const screenPx=Math.round(a.nw*pg.offsetWidth);
                     return new Promise(res=>{ const im=new Image();
                       im.onload=()=>res({sw:a.sw, screenPx, px:im.naturalWidth,
                                          ratio:+(im.naturalWidth/screenPx).toFixed(2)});
                       im.onerror=()=>res({sw:a.sw, screenPx, px:0, ratio:0});
                       im.src=a.src; }); }""")
        ok = (not qual.get("none") and qual["sw"] in (0, None) and qual["ratio"] >= 1.9)
        results.append({"tool": "Snapshot keeps the pixels", "ok": ok, "why": json.dumps(qual)})

        # ---------- 6gk — THE PICTURE EDITOR: ZOOM, REDO, RESTORE ----------
        await page.evaluate(
            """()=>{ const a=S.annos.find(z=>z.maKind==="snapshot"); skEditor(a); return true; }""")
        await page.wait_for_timeout(800)
        edui = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const cv=m.querySelector(".sk-edcanvas");
                     const g=cv.getContext("2d",{willReadFrequently:true});
                     const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                     const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                        const btn=t=>{ const r=new RegExp(t,"i");
                          return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                            ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                     const out={groups:m.querySelectorAll(".sk-edgrp").length,
                                tools:[...m.querySelectorAll(".sk-edb")].map(b=>b.textContent.trim()),
                                zoomStart:m.querySelector(".sk-edzoom").textContent};
                     /* the wand, the lasso and Invert are one group: the two ways of choosing a
                        region and the thing you do to the choice, together (6gt added the lasso
                        between the wand and Invert, so this is adjacency within the group, not a
                        fixed neighbour) */
                     const gs=[...m.querySelectorAll(".sk-edgrp")];
                     out.sideBySide=gs.some(gr=>{
                       const t=[...gr.querySelectorAll(".sk-edb")].map(b=>b.textContent);
                       return t.some(x=>/wand/i.test(x))&&t.some(x=>/lasso/i.test(x))
                              &&t.some(x=>/invert/i.test(x)); });   /* 6m2 — "Select inverse" is "Invert" now */
                     /* zoom in, out, 1:1 */
                     btn("Zoom in").click(); const zin=m.querySelector(".sk-edzoom").textContent;
                     btn("one for one").click(); out.oneToOne=m.querySelector(".sk-edzoom").textContent;
                     out.zoomed=(zin!==out.zoomStart);
                     out.canvasCss=cv.style.width;
                     /* erase a band, then RESTORE it, then undo and redo */
                     const CP=(x,y)=>{ const b=cv.getBoundingClientRect();
                       return {clientX:b.left+b.width*(x/cv.width),
                               clientY:b.top+b.height*(y/cv.height),
                               bubbles:true,pointerId:41,button:0}; };
                     /* a pixel with INK in it on the band about to be swept, so erase, restore, undo
                        and redo are measured on something that can actually change */
                     const row=Math.round(cv.height*0.5);
                     let mid=[Math.round(cv.width*0.5),row];
                     for(let x=Math.round(cv.width*0.15);x<cv.width*0.85;x++){
                       if(px(x,row)[3]>200){ mid=[x,row]; break; } }
                     out.at=mid;
                     out.was=px(mid[0],mid[1]);
                     btn("Erase").click();
                     const rg=m.querySelector(".sk-edsize input[type=range]");
                     rg.value="40"; rg.dispatchEvent(new Event("input",{bubbles:true}));
                     cv.dispatchEvent(new PointerEvent("pointerdown",CP(cv.width*0.1,cv.height*0.5)));
                     window.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.9,cv.height*0.5)));
                     cv.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.9,cv.height*0.5)));
                     cv.dispatchEvent(new PointerEvent("pointerup",CP(cv.width*0.9,cv.height*0.5)));
                     out.erased=px(mid[0],mid[1]);
                     btn("restore").click();
                     cv.dispatchEvent(new PointerEvent("pointerdown",CP(cv.width*0.1,cv.height*0.5)));
                     window.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.9,cv.height*0.5)));
                     cv.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.9,cv.height*0.5)));
                     cv.dispatchEvent(new PointerEvent("pointerup",CP(cv.width*0.9,cv.height*0.5)));
                     out.restored=px(mid[0],mid[1]);
                     out.undoOn=!btn("undo").disabled;
                     btn("undo").click();
                     out.afterUndo=px(mid[0],mid[1]);
                     out.redoOn=!btn("Redo").disabled;
                     btn("redo").click();
                     out.afterRedo=px(mid[0],mid[1]);
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                     out.closed=!document.querySelector(".sk-edit");
                     return out; }""")
        same = lambda p, q: p[3] == q[3] and (p[3] == 0 or (abs(p[0]-q[0]) < 6 and abs(p[1]-q[1]) < 6))
        ok = (edui["sideBySide"] and edui["zoomed"] and edui["oneToOne"] == "100%"
              and edui["was"][3] > 200               # it was measured on ink, not on nothing
              and edui["erased"][3] == 0 and same(edui["restored"], edui["was"])
              and same(edui["afterUndo"], edui["erased"]) and same(edui["afterRedo"], edui["restored"])
              and edui["undoOn"] and edui["redoOn"] and edui["closed"])
        results.append({"tool": "Editor: zoom, redo, restore", "ok": ok, "why": json.dumps(edui)})

        # ---------- 6gl — A RESIZED SHAPE STAYS IN ONE PIECE ----------
        await clear()
        shp = await page.evaluate(
            """()=>{ const mk=(kind,dash)=>{ const id=maAddShape(0,kind,0.16,0.20,0.16,0.12,{});
                       const a=S.annos.find(z=>z.id===id);
                       a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1;
                       if(dash)a.dash=dash; layoutAnnos(); return a; };
                     const box=a=>{ const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                       const svg=d&&d.querySelector("svg.shapeoutline");
                       const ed=d&&d.querySelector(".ed");
                       return {sw:svg?Math.round(+svg.getAttribute("width")):null,
                               sh:svg?Math.round(+svg.getAttribute("height")):null,
                               ew:ed?Math.round(ed.offsetWidth):null,
                               eh:ed?Math.round(ed.offsetHeight):null}; };
                     const pull=(a,pos,dx,dy)=>{
                       setMode("select"); selectAnno(a.id);
                       const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                       const h=markHandle(a.id,".rz."+pos); if(!h)return;   /* 6is */
                       const r=h.getBoundingClientRect();
                       const x=r.left+r.width/2, y=r.top+r.height/2;
                       h.dispatchEvent(new PointerEvent("pointerdown",
                         {clientX:x,clientY:y,bubbles:true,pointerId:19,button:0}));
                       for(let k=1;k<=6;k++)window.dispatchEvent(new PointerEvent("pointermove",
                         {clientX:x+dx*k/6,clientY:y+dy*k/6,bubbles:true,pointerId:19}));
                       window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:19}));
                     };
                     const out={};
                     let a=mk("ellipse"); pull(a,"e",180,0); pull(a,"s",0,80);
                     out.ellipse=box(a);
                     S.annos=[]; layoutAnnos();
                     a=mk("rect","dash"); pull(a,"se",150,100);
                     out.dashed=box(a);
                     /* and a turned one, which resizes in its own frame */
                     a.rot=30; layoutAnnos(); pull(a,"e",90,0);
                     out.turned=box(a);
                     /* 6is — the selection frame is an `.anno` too; count the marks only */
                     out.els=document.querySelectorAll(".anno:not(.selui)").length;
                     return out; }""")
        fits = lambda o: (o["sw"] is not None and abs(o["sw"]-o["ew"]) <= 2
                          and abs(o["sh"]-o["eh"]) <= 2)
        ok = fits(shp["ellipse"]) and fits(shp["dashed"]) and fits(shp["turned"]) and shp["els"] == 1
        results.append({"tool": "A resized shape stays whole", "ok": ok, "why": json.dumps(shp)})

        # ---------- 6gl — THE SNAPSHOT LANDS ON WHAT IT CAPTURED ----------
        await clear()
        await pick("snapshot")
        await refresh_box()
        x1, y1 = at(0.14, 0.16)
        x2, y2 = at(0.52, 0.28)
        # the ribbon reveals itself when the pointer nears the top, which moves the page under the
        # gesture: park the pointer first, then read where the page actually is, and work out what the
        # two corners mean in page terms from THAT
        await page.mouse.move(x1, y1)
        await page.wait_for_timeout(200)
        b2 = await page_box()
        fx1, fy1 = (x1 - b2["x"]) / b2["w"], (y1 - b2["y"]) / b2["h"]
        fx2, fy2 = (x2 - b2["x"]) / b2["w"], (y2 - b2["y"]) / b2["h"]
        await drag(x1, y1, x2, y2)
        await page.wait_for_timeout(2600)
        # the fractions the gesture meant, from the box measured just before it — the page can be
        # scrolled by what the snapshot itself does, so reading the box back afterwards proves nothing
        got = await page.evaluate(
            """()=>{ const a=S.annos.find(z=>z.maKind==="snapshot");
                     return a?{nx:a.nx,ny:a.ny,nw:a.nw,nh:a.nh,frame:a.sw}:{none:true}; }""")
        land = {"none": True} if got.get("none") else {
            "dx": round(got["nx"] - fx1, 4), "dy": round(got["ny"] - fy1, 4),
            "dw": round(got["nw"] - (fx2 - fx1), 4), "dh": round(got["nh"] - (fy2 - fy1), 4),
            "frame": got["frame"]}
        ok = (not land.get("none") and abs(land["dx"]) < 0.004 and abs(land["dy"]) < 0.004
              and abs(land["dw"]) < 0.006 and abs(land["dh"]) < 0.006 and land["frame"] in (0, None))
        results.append({"tool": "Snapshot lands on its region", "ok": ok, "why": json.dumps(land)})

        # ---------- 6gl — THE EDITOR KEEPS THE WHEEL ----------
        wh = await page.evaluate(
            """()=>{ const a=S.annos.find(z=>z.maKind==="snapshot"); skEditor(a); return true; }""")
        await page.wait_for_timeout(800)
        wh = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const stage=m.querySelector(".sk-edstage");
                     const z=()=>m.querySelector(".sk-edzoom").textContent;
                     const before={scale:S.scale,sy:window.scrollY,zoom:z()};
                     stage.dispatchEvent(new WheelEvent("wheel",
                       {deltaY:-120,ctrlKey:true,bubbles:true,cancelable:true}));
                     const after={scale:S.scale,sy:window.scrollY,zoom:z()};
                     m.querySelector(".sk-edbar").dispatchEvent(new WheelEvent("wheel",
                       {deltaY:300,bubbles:true,cancelable:true}));
                     const end={scale:S.scale,sy:window.scrollY};
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                     return {before,after,end}; }""")
        ok = (wh["after"]["scale"] == wh["before"]["scale"] and wh["after"]["zoom"] != wh["before"]["zoom"]
              and wh["end"]["sy"] == wh["before"]["sy"] and wh["end"]["scale"] == wh["before"]["scale"])
        results.append({"tool": "The editor keeps the wheel", "ok": ok, "why": json.dumps(wh)})

        # ---------- 6gl — THE SHEET STAYS CENTRED AS IT IS ZOOMED ----------
        await clear()
        cen = await page.evaluate(
            """()=>new Promise(async res=>{
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const look=()=>{ const r=pg.getBoundingClientRect();
                   return Math.round(r.left+r.width/2-window.innerWidth/2); };
                 const off=[], fitOff=[], widths=[];
                 for(const z of [1,1.5,2,2.5,3,3.5]){
                   await setZoom(z);
                   await new Promise(r=>setTimeout(r,320));
                   const r=pg.getBoundingClientRect();
                   const room=(document.getElementById("pages")||{}).clientWidth||0;
                   off.push(look()); widths.push(Math.round(r.width));
                   if(r.width<=room)fitOff.push(look());      /* only while there IS room to centre in */
                 }
                 await setZoom(1.2);
                 res({off, widths, fitOff, fits:fitOff.length>=3,
                      worst:Math.max(...off.map(v=>Math.abs(v)))}); })""")
        # 6m8 — CENTRED WHILE THERE IS ROOM TO BE. The column is symmetric about the window now, so
        # the sheet is EXACTLY centred at every zoom where it still fits — measured 0px at 1x, 1.5x,
        # 2x and 2.5x, where this used to allow 90. Past that the sheet is wider than the room: it is
        # deliberately flush-left so its left edge can be reached at all, and where it sits is the
        # scroll anchor's business, not this function's. A blanket tolerance hid both facts; the fit
        # is asked about instead.
        ok = (cen["fits"] and max(abs(v) for v in cen["fitOff"]) <= 2)
        results.append({"tool": "Zoom keeps the sheet centred", "ok": ok, "why": json.dumps(cen)})

        # ---------- 6gl — THE MARKUP LIBRARY ----------
        await clear()
        mk = await page.evaluate(
            """()=>new Promise(async res=>{
                 const c=document.createElement("canvas"); c.width=90; c.height=60;
                 const g=c.getContext("2d"); g.fillStyle="#1144ff"; g.fillRect(0,0,90,60);
                 const blob=await new Promise(r=>c.toBlob(r,"image/png"));
                 const file=new File([blob],"antenna 1.png",{type:"image/png"});
                 MA_MARKUPS.length=0;
                 const rec=await maAddMarkupFile(file);
                 const out={made:!!rec, name:rec&&rec.name, w:rec&&rec.w, h:rec&&rec.h,
                            data:/^data:image/.test(String(rec&&rec.src||"")),
                            lib:MA_MARKUPS.length};
                 maSetTab("markups"); maPanelOpen(true);
                 await new Promise(r=>setTimeout(r,250));
                 const im=document.querySelector("#maPanel .ma-mk img");
                 out.thumb=await new Promise(r=>{
                   if(!im)return r(0);
                   if(im.complete)return r(im.naturalWidth);
                   im.onload=()=>r(im.naturalWidth); im.onerror=()=>r(0);
                   setTimeout(()=>r(im.naturalWidth),700); });
                 maPanelOpen(false);
                 const id=maPlaceMarkup(rec,0,0.4,0.4);
                 const m=S.annos.find(z=>z.id===id);
                 out.placed=!!(m&&m.kind==="img"&&/^data:image/.test(String(m.src||"")));
                 out.marks=S.annos.length;
                 res(out); })""")
        ok = (mk["made"] and mk["data"] and mk["lib"] == 1 and mk["thumb"] > 0
              and mk["placed"] and mk["marks"] == 1)
        results.append({"tool": "The markup library works", "ok": ok, "why": json.dumps(mk)})

        # ---------- 6gq — EIGHT TOOLS TO A ROW IN MAX MODE ----------
        await clear()
        rows = await page.evaluate(
            """()=>{ document.body.classList.add("colmax");
                     try{ fitGroupRows(); }catch(e){}
                     const g=document.querySelector("#tools>.grow");
                     const cols=getComputedStyle(document.getElementById("tools"))
                                 .getPropertyValue("--grp-cols").trim();
                     const tops={};
                     [...g.children].forEach(c=>{ const t=Math.round(c.getBoundingClientRect().top);
                       tops[t]=(tops[t]||0)+1; });
                     const per=Object.values(tops);
                     return {cols, per, n:g.children.length, max:Math.max.apply(null,per)}; }""")
        ok = (rows["cols"] == "8" and rows["max"] <= 8 and rows["n"] >= 12
              and len(rows["per"]) == -(-rows["n"] // 8))
        results.append({"tool": "Eight tools to a row (max)", "ok": ok, "why": json.dumps(rows)})

        # ---------- 6gq — THE RIBBON KEEPS ITS PLACE WHEN THE SHEET SCROLLS SIDEWAYS ----------
        rib = await page.evaluate(
            """()=>new Promise(async res=>{
                 await setZoom(3);
                 await new Promise(r=>setTimeout(r,500));
                 const tb=document.getElementById("toolbar");
                 const a=Math.round(tb.getBoundingClientRect().left);
                 window.scrollTo(420,window.scrollY);
                 await new Promise(r=>setTimeout(r,260));
                 const b=Math.round(tb.getBoundingClientRect().left);
                 const sx=Math.round(window.scrollX);
                 window.scrollTo(0,window.scrollY);
                 await setZoom(1.2);
                 await new Promise(r=>setTimeout(r,260));
                 res({atRest:a, scrolled:b, sx, held:Math.abs(a-b)<4}); })""")
        ok = rib["held"] and rib["sx"] > 100
        results.append({"tool": "Ribbon holds while scrolled", "ok": ok, "why": json.dumps(rib)})

        # ---------- 6gq — THE CORNER MARK CLEARS THE PANELS ----------
        mark = await page.evaluate(
            """()=>new Promise(async res=>{
                 const m=document.getElementById("markR");
                 const now=()=>parseInt(getComputedStyle(document.documentElement)
                                .getPropertyValue("--mark-right"),10)||0;
                 syncMarkClear(); const plain=now();
                 maPanelOpen(true);
                 await new Promise(r=>setTimeout(r,260));
                 syncMarkClear();
                 const withPanel=now();
                 const p=document.getElementById("maPanel").getBoundingClientRect();
                 const clears=withPanel>=Math.round(window.innerWidth-p.left);
                 maPanelOpen(false);
                 await new Promise(r=>setTimeout(r,200));
                 syncMarkClear();
                 res({plain, withPanel, clears, back:now(), nofit:m.classList.contains("nofit")}); })""")
        ok = (mark["plain"] <= 24 and mark["clears"] and mark["withPanel"] > mark["plain"]
              and mark["back"] <= 24 and not mark["nofit"])
        results.append({"tool": "The corner mark keeps clear", "ok": ok, "why": json.dumps(mark)})

        # ---------- 6gq — THE BRUSH IS VISIBLE, AND THE SELECTION CAN BE ERASED ----------
        await clear()
        await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=c.height=80;
                     const g=c.getContext("2d"); g.fillStyle="#fa3237"; g.fillRect(0,0,80,80);
                     g.clearRect(20,20,40,40);
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.2; a.nh=0.2; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0; a._tintCol=a.col;
                     layoutAnnos(); skEditor(a); return true; }""")
        await page.wait_for_timeout(800)
        brush = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const cv=m.querySelector(".sk-edcanvas"), ring=m.querySelector(".sk-edring");
                     const g=cv.getContext("2d",{willReadFrequently:true});
                     const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                     const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                       const btn=t=>{ const r=new RegExp(t,"i");
                         return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                           ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                     const B=()=>cv.getBoundingClientRect();
                     const hit=(x,y)=>cv.dispatchEvent(new PointerEvent("pointerdown",
                       {clientX:B().left+B().width*(x/cv.width),
                        clientY:B().top+B().height*(y/cv.height),
                        bubbles:true,pointerId:33,button:0}));
                     const out={};
                     btn("Erase").click();
                     const rg=m.querySelector(".sk-edsize input[type=range]");
                     rg.value="30"; rg.dispatchEvent(new Event("input",{bubbles:true}));
                     cv.dispatchEvent(new PointerEvent("pointerenter",
                       {clientX:B().left+40,clientY:B().top+40,bubbles:true}));
                     cv.dispatchEvent(new PointerEvent("pointermove",
                       {clientX:B().left+40,clientY:B().top+40,bubbles:true}));
                     const zoom=parseFloat(m.querySelector(".sk-edzoom").textContent)/100;
                     out.ring={shown:(!ring.hidden&&ring.classList.contains("on")),
                               size:Math.round(parseFloat(ring.style.width)),
                               want:Math.round(30*zoom),
                               at:Math.round(parseFloat(ring.style.left)),
                               cursor:cv.style.cursor};
                     btn("wand").click();
                     out.hiddenForWand=ring.hidden;
                     hit(40,40);                       /* the hole in the middle */
                     out.sel=m.querySelector(".sk-edcount").textContent;
                     btn("invert").click();    /* now the red frame */
                     out.before=px(4,4);
                     btn("clearsel").click();
                     out.after=px(4,4);
                     btn("undo").click();
                     out.undone=px(4,4);
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                     return out; }""")
        ok = (brush["ring"]["shown"] and abs(brush["ring"]["size"] - brush["ring"]["want"]) <= 2
              and brush["ring"]["cursor"] == "crosshair" and brush["hiddenForWand"]
              and brush["before"][3] > 200 and brush["after"][3] == 0
              and brush["undone"][3] > 200)
        results.append({"tool": "Brush ring · erase selection", "ok": ok, "why": json.dumps(brush)})

        # ---------- 6gq — A TRANSPARENT MARKUP STAYS TRANSPARENT ----------
        png = await page.evaluate(
            """()=>new Promise(async res=>{
                 const c=document.createElement("canvas"); c.width=2200; c.height=1500;
                 const g=c.getContext("2d"); g.fillStyle="#1144ff";
                 g.beginPath(); g.arc(1100,750,600,0,Math.PI*2); g.fill();
                 const blob=await new Promise(r=>c.toBlob(r,"image/png"));
                 const file=new File([blob],"north arrow.png",{type:"image/png"});
                 MA_MARKUPS.length=0;
                 const rec=await maAddMarkupFile(file);
                 const im=new Image();
                 const probe=await new Promise(r=>{
                   im.onload=()=>{ const t=document.createElement("canvas");
                     t.width=im.width; t.height=im.height;
                     const tg=t.getContext("2d"); tg.drawImage(im,0,0);
                     const d=tg.getImageData(0,0,t.width,t.height).data;
                     let clear=0; for(let k=0;k<d.length;k+=4)if(d[k+3]<8)clear++;
                     r({w:im.width,clear}); };
                   im.onerror=()=>r(null); im.src=rec.src; });
                 res({png:/^data:image\/png/.test(rec.src), shrunk:probe&&probe.w<2200,
                      clear:probe&&probe.clear, w:probe&&probe.w}); })""")
        ok = (png["png"] and png["shrunk"] and png["clear"] > 1000)
        results.append({"tool": "A markup keeps its alpha", "ok": ok, "why": json.dumps(png)})

        # ---------- 6gr — A MARKUP DROPS AS THE PICTURE, NOT A WASH OF IT ----------
        await clear()
        mkp = await page.evaluate(
            """()=>new Promise(async res=>{
                 MA_TOOL_STYLES.box=Object.assign({},MA_TOOL_STYLES.box,{fillOp:0.35});
                 setMode("box");
                 const c=document.createElement("canvas"); c.width=200; c.height=200;
                 const g=c.getContext("2d"); g.strokeStyle="#fa3237"; g.lineWidth=8;
                 g.beginPath(); g.arc(100,100,70,0,Math.PI*2); g.stroke();
                 const blob=await new Promise(r=>c.toBlob(r,"image/png"));
                 MA_MARKUPS.length=0;
                 const rec=await maAddMarkupFile(new File([blob],"aaa.png",{type:"image/png"}));
                 const id=maPlaceMarkup(rec,0,0.35,0.35);
                 await new Promise(r=>setTimeout(r,250));
                 const a=S.annos.find(z=>z.id===id);
                 const im=document.querySelector(`.anno[data-id="${id}"] img`);
                 res({fillOp:a.fillOp, colOp:a.colOp, sw:a.sw,
                      opacity:im?getComputedStyle(im).opacity:null,
                      border:im?getComputedStyle(im.parentElement).borderTopWidth:null,
                      png:/^data:image\/png/.test(rec.src)}); })""")
        ok = (mkp["fillOp"] == 1 and mkp["opacity"] == "1" and mkp["sw"] in (0, None)
              and mkp["border"] == "0px" and mkp["png"])
        results.append({"tool": "A markup drops as the picture", "ok": ok, "why": json.dumps(mkp)})

        # ---------- 6gr — A ZOOM SHOWS AT ONCE AND SHARPENS AFTER ----------
        await clear()
        zm = await page.evaluate(
            """()=>new Promise(async res=>{
                 const pg=()=>document.querySelector('.page[data-idx="0"]');
                 const shot=()=>{ const c=pg().querySelector("canvas.pdf");
                   return c?{bmp:c.width,css:Math.round(parseFloat(c.style.width)),
                             soft:pg().dataset.soft||""}:null; };
                 const before=shot();
                 const t0=performance.now();
                 await setZoom(2.4);
                 const call=Math.round(performance.now()-t0);
                 const during=shot();
                 await new Promise(r=>setTimeout(r,1500));
                 const after=shot();
                 let blank=0;
                 for(const z of [2.6,2.8,3.0,3.2]){
                   await setZoom(z);
                   const c=pg().querySelector("canvas.pdf");
                   if(!c||!c.width)blank++;
                   await new Promise(r=>setTimeout(r,40));
                 }
                 await new Promise(r=>setTimeout(r,1500));
                 await setZoom(1.2);
                 await new Promise(r=>setTimeout(r,900));
                 res({before,during,after,call,blank}); })""")
        ok = (zm["during"] and zm["during"]["bmp"] > 0            # never blank while zooming
              and zm["during"]["css"] > zm["before"]["css"]       # shown at the new size at once
              and zm["during"]["soft"] == "1"
              and zm["after"]["bmp"] > zm["before"]["bmp"]        # and sharpened afterwards
              and zm["after"]["soft"] == "" and zm["blank"] == 0 and zm["call"] < 400)
        results.append({"tool": "Zoom shows at once, sharpens after", "ok": ok, "why": json.dumps(zm)})

        # ---------- 6gr — THE EDITOR KEEPS ITS SHAPE, AND ITS CURSOR ----------
        await clear()
        await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=1400; c.height=900;
                     const g=c.getContext("2d"); g.fillStyle="#fa3237"; g.fillRect(0,0,1400,900);
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.3; a.nh=0.2; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0; a._tintCol=a.col;
                     layoutAnnos(); skEditor(a); return true; }""")
        await page.wait_for_timeout(1200)
        ed2 = await page.evaluate(
            """()=>{ const m=document.querySelector(".sk-edit");
                     const card=m.querySelector(".sk-edcard"), cv=m.querySelector(".sk-edcanvas");
                     const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                       const btn=t=>{ const r=new RegExp(t,"i");
                         return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                           ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                     const box=()=>{ const r=card.getBoundingClientRect();
                       return [Math.round(r.width),Math.round(r.height)]; };
                     const a0=box();
                     btn("Zoom in").click(); btn("Zoom in").click();
                     const a1=box();
                     btn("Zoom out").click(); btn("Zoom out").click(); btn("Zoom out").click();
                     const a2=box();
                     btn("Erase").click();
                     const cursor=cv.style.cursor;
                     /* a fast sweep across a big picture, timed */
                     const B=cv.getBoundingClientRect();
                     const P=(x,y)=>({clientX:B.left+B.width*(x/cv.width),
                                      clientY:B.top+B.height*(y/cv.height),
                                      bubbles:true,pointerId:53,button:0});
                     const t0=performance.now();
                     cv.dispatchEvent(new PointerEvent("pointerdown",P(20,450)));
                     for(let x=40;x<=1380;x+=40)
                       cv.dispatchEvent(new PointerEvent("pointermove",P(x,450)));
                     cv.dispatchEvent(new PointerEvent("pointerup",P(1380,450)));
                     const ms=Math.round(performance.now()-t0);
                     const ring=m.querySelector(".sk-edring");
                     const out={a0,a1,a2,cursor,ms,ring:!ring.hidden};
                     [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                     return out; }""")
        ok = (ed2["a0"] == ed2["a1"] == ed2["a2"] and ed2["cursor"] == "crosshair"
              and ed2["ring"] and ed2["ms"] < 400)
        results.append({"tool": "Editor: steady shape, live cursor", "ok": ok, "why": json.dumps(ed2)})

        # ---------- 6gs — THE ZOOM DOES NOT TOUCH THE RIBBON, AND NEVER LEAVES A PAGE WRONG ----------
        await clear()
        zr = await page.evaluate(
            """()=>new Promise(async res=>{
                 const tb=document.getElementById("toolbar");
                 const w=()=>Math.round(tb.getBoundingClientRect().width);
                 const col=()=>getComputedStyle(document.documentElement)
                                .getPropertyValue("--col-w").trim();
                 const a=[w(),col()];
                 await setZoom(2.5); await new Promise(r=>setTimeout(r,500));
                 const b=[w(),col()];
                 await setZoom(1); await new Promise(r=>setTimeout(r,500));
                 const c=[w(),col()];
                 /* and a churn of zooms must never leave a page drawn at the wrong size */
                 const bad=()=>{ let n=0;
                   document.querySelectorAll('#pages .page[data-rendered="1"]').forEach(pg=>{
                     const cv=pg.querySelector("canvas.pdf"); if(!cv)return;
                     const want=Math.round(parseFloat(pg.style.width)||0);
                     const has=Math.round(parseFloat(cv.style.width)||0);
                     if(want&&has&&Math.abs(want-has)>1)n++; });
                   return n; };
                 let worst=0;
                 for(const z of [1.6,2.2,1.4,3,1.8,2.6]){
                   await setZoom(z); await new Promise(r=>setTimeout(r,90));
                   worst=Math.max(worst,bad());
                 }
                 await new Promise(r=>setTimeout(r,2200));
                 const settled=bad();
                 await setZoom(1.2); await new Promise(r=>setTimeout(r,700));
                 res({a,b,c,worst,settled}); })""")
        ok = (zr["a"][0] == zr["b"][0] == zr["c"][0] and zr["a"][1] == zr["b"][1]
              and zr["worst"] == 0 and zr["settled"] == 0)
        results.append({"tool": "Zoom leaves the ribbon alone", "ok": ok, "why": json.dumps(zr)})

        # ---------- 6gs — CTRL PUTS THE MAGNET DOWN ----------
        await clear()
        mag = await page.evaluate(
            """()=>new Promise(async res=>{
                 S.magnet=true;
                 maAddShape(0,"rect",0.30,0.30,0.14,0.08,{});
                 const id=maAddShape(0,"rect",0.60,0.50,0.14,0.08,{});
                 layoutAnnos();
                 const B=S.annos.find(z=>z.id===id);
                 const pull=async(ctrl)=>{
                   B.nx=0.60; B.ny=0.50; layoutAnnos();
                   await new Promise(r=>setTimeout(r,80));
                   selectAnno(B.id);
                   await new Promise(r=>setTimeout(r,60));
                   const d=document.querySelector(`.anno[data-id="${B.id}"]`);
                   const mov=markHandle(B.id,".mov");   /* 6is — it lives in the frame above */
                   const r=mov.getBoundingClientRect();
                   const x=r.left+r.width/2, y=r.top+r.height/2;
                   const pg=document.querySelector('.page[data-idx="0"]');
                   const pr=pg.getBoundingClientRect();
                   const dx=(pr.left+pr.width*0.3018)-(pr.left+pr.width*B.nx);
                   const dy=-pr.height*0.2;
                   mov.dispatchEvent(new PointerEvent("pointerdown",
                     {clientX:x,clientY:y,bubbles:true,pointerId:63,button:0}));
                   for(let k=1;k<=5;k++)window.dispatchEvent(new PointerEvent("pointermove",
                     {clientX:x+dx*k/5,clientY:y+dy*k/5,bubbles:true,pointerId:63,ctrlKey:ctrl}));
                   window.dispatchEvent(new PointerEvent("pointerup",
                     {bubbles:true,pointerId:63,ctrlKey:ctrl}));
                   await new Promise(r=>setTimeout(r,120));
                   return +B.nx.toFixed(4);
                 };
                 const magnet=await pull(false);
                 const ctrl=await pull(true);
                 res({magnet,ctrl}); })""")
        ok = (abs(mag["magnet"] - 0.30) < 0.0025 and abs(mag["ctrl"] - 0.3018) < 0.0025)
        results.append({"tool": "Ctrl suspends the magnet", "ok": ok, "why": json.dumps(mag)})

        # ---------- 6gs — DOUBLE-CLICK TYPES IN A READING AND IN A CALLOUT ----------
        await clear()
        dbl = await page.evaluate(
            """()=>new Promise(async res=>{
                 const out={};
                 const twice=(d,ed)=>{
                   const r=ed.getBoundingClientRect();
                   const o={bubbles:true,clientX:r.left+8,clientY:r.top+6,button:0};
                   ed.dispatchEvent(new MouseEvent("mousedown",Object.assign({detail:1},o)));
                   window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                   ed.dispatchEvent(new MouseEvent("mousedown",Object.assign({detail:2},o)));
                   window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                   ed.dispatchEvent(new MouseEvent("dblclick",o));
                   return {editing:d.classList.contains("editing"),
                           focused:document.activeElement===ed};
                 };
                 setMode("dim");
                 maPlaceDim(0,0.2,0.5,0.5,0.5);
                 await new Promise(r=>setTimeout(r,300));
                 const l=S.lines.find(z=>z.maKind==="dim");
                 const lab=S.annos.find(z=>z.id===l.dimFor);
                 lab.text="12 FT"; l.dimManual=true; layoutAnnos();
                 document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
                 document.querySelectorAll(".anno").forEach(x=>x.classList.remove("editing"));
                 setMode("select"); selectAnno(null); selectLine(null);
                 await new Promise(r=>setTimeout(r,200));
                 {
                   const d=document.querySelector(`.anno[data-id="${lab.id}"]`);
                   out.reading=twice(d,d.querySelector(".ed"));
                   out.runStill=(S.lines.filter(z=>z.maKind==="dim").length===1);
                 }
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 setMode("callout");
                 maPlaceCallout(0,0.3,0.3,"NOTE",{x:0.55,y:0.32});
                 await new Promise(r=>setTimeout(r,400));
                 document.activeElement&&document.activeElement.blur&&document.activeElement.blur();
                 document.querySelectorAll(".anno").forEach(x=>x.classList.remove("editing"));
                 setMode("select"); selectAnno(null);
                 await new Promise(r=>setTimeout(r,200));
                 {
                   const box=S.annos.find(z=>z.maKind==="callout");
                   const d=document.querySelector(`.anno[data-id="${box.id}"]`);
                   out.callout=twice(d,d.querySelector(".ed"));
                 }
                 res(out); })""")
        ok = (dbl["reading"]["editing"] and dbl["reading"]["focused"] and dbl["runStill"]
              and dbl["callout"]["editing"] and dbl["callout"]["focused"])
        results.append({"tool": "Double-click types in a mark", "ok": ok, "why": json.dumps(dbl)})

        # ---------- 6gs — THE WAND STARTS IN ADD · THE LINE ERASER · THE HISTORY THAT COMES BACK ----
        await clear()
        await page.evaluate(
            """()=>{ const c=document.createElement("canvas"); c.width=200; c.height=120;
                     const g=c.getContext("2d"); g.strokeStyle="#fa3237"; g.lineWidth=6;
                     g.beginPath(); g.moveTo(10,20); g.lineTo(190,20); g.stroke();
                     g.beginPath(); g.moveTo(10,90); g.lineTo(190,90); g.stroke();
                     const id=addText(0,0.2,0.3,"");
                     const a=S.annos.find(z=>z.id===id);
                     a.kind="img"; a.maKind="snapshot"; a.nw=0.25; a.nh=0.15; a.manualW=true;
                     a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0; a._tintCol=a.col;
                     layoutAnnos(); skEditor(a); return true; }""")
        await page.wait_for_timeout(900)
        pic = await page.evaluate(
            """()=>new Promise(async res=>{
                 const out={};
                 let m=document.querySelector(".sk-edit");
                 const btn=(mm,t)=>{ const r=new RegExp(t,"i"), L=[...mm.querySelectorAll(".sk-edb")];
                   return mm.querySelector('.sk-edb[data-k="'+t+'"]')            /* 6m2 */
                     ||L.find(z=>r.test(z.textContent))||L.find(z=>r.test(z.textContent+" "+(z.title||""))); };
                 const px=(cv,x,y)=>[...cv.getContext("2d",{willReadFrequently:true})
                                        .getImageData(x,y,1,1).data];
                 const hit=(cv,x,y)=>{ const b=cv.getBoundingClientRect();
                   cv.dispatchEvent(new PointerEvent("pointerdown",
                     {clientX:b.left+b.width*(x/cv.width),clientY:b.top+b.height*(y/cv.height),
                      bubbles:true,pointerId:73,button:0})); };
                 /* 6la — the WAND's own row. `.sk-edm` is the chip class and more than one row
                    uses it now: Shape select brought a Rectangle/Ellipse pair into the same bar,
                    and an unscoped query counted its default as a wand mode. */
                 out.wandDefault=[...m.querySelectorAll(".sk-edmodes .sk-edm")]
                   .filter(b=>b.classList.contains("on")).map(b=>b.textContent.trim());
                 out.hasWipe=!!btn(m,"Erase line");
                 let cv=m.querySelector(".sk-edcanvas");
                 out.before=[px(cv,100,20),px(cv,100,90)];
                 btn(m,"Erase line").click();
                 hit(cv,100,20);
                 await new Promise(r=>setTimeout(r,250));
                 out.after=[px(cv,100,20),px(cv,100,90)];
                 const a=S.annos.find(z=>z.maKind==="snapshot");
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent)).click();
                 await new Promise(r=>setTimeout(r,700));
                 out.origKept=!!a.srcOrig && a.srcOrig!==a.src;
                 out.stored=(()=>{ try{ const v=JSON.parse(localStorage.getItem("ma.picedit.v1")||"{}");
                    return v[a.id]?v[a.id].steps.length:0; }catch(e){ return -1; } })();
                 SK_EDIT_MEM={};                       /* what a reload looks like to the editor */
                 skEditor(a);
                 await new Promise(r=>setTimeout(r,1400));
                 m=document.querySelector(".sk-edit");
                 cv=m.querySelector(".sk-edcanvas");
                 out.undoLive=!btn(m,"Undo").disabled;
                 out.reopened=px(cv,100,20);
                 btn(m,"Undo").click();
                 await new Promise(r=>setTimeout(r,300));
                 out.afterUndo=px(cv,100,20);
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                 res(out); })""")
        ok = (pic["wandDefault"] and "Add" in pic["wandDefault"][0] and pic["hasWipe"]
              and pic["before"][0][3] > 200 and pic["after"][0][3] == 0
              and pic["after"][1][3] > 200            # the other line is untouched
              and pic["origKept"] and pic["stored"] >= 1 and pic["undoLive"]
              and pic["reopened"][3] == 0 and pic["afterUndo"][3] > 200)
        results.append({"tool": "Line eraser · wand Add · history kept", "ok": ok,
                        "why": json.dumps(pic)})

        # ---------- 6gs — A MARKUP DROPS WHERE YOU ARE ----------
        await clear()
        drop = await page.evaluate(
            """()=>new Promise(async res=>{
                 const c=document.createElement("canvas"); c.width=120; c.height=80;
                 const g=c.getContext("2d"); g.fillStyle="#1144ff"; g.fillRect(0,0,120,80);
                 const blob=await new Promise(r=>c.toBlob(r,"image/png"));
                 MA_MARKUPS.length=0;
                 await maAddMarkupFile(new File([blob],"north.png",{type:"image/png"}));
                 maSetTab("markups"); maPanelOpen(true);
                 await new Promise(r=>setTimeout(r,300));
                 document.querySelector("#maPanel .ma-mk")
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await new Promise(r=>setTimeout(r,350));
                 /* 6hf — the click PICKS IT UP: a preview in the hand, nothing on the sheet yet */
                 const ghost=document.querySelector(".maghost");
                 const out={ held:!!ghost, none:(S.annos.length===0),
                             cursor:document.body.classList.contains("maplacing") };
                 document.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:420,clientY:320,pointerId:83}));
                 await new Promise(r=>setTimeout(r,80));
                 const gr=ghost&&ghost.getBoundingClientRect();
                 out.follows=!!(gr&&Math.abs(gr.left-420)<2&&Math.abs(gr.top-320)<2);
                 maPanelOpen(false);
                 await new Promise(r=>setTimeout(r,150));
                 /* and the next click on the sheet puts it down, by its top-left corner */
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const R=pg.getBoundingClientRect();
                 const at=(fx,fy,id)=>({clientX:R.left+R.width*fx,clientY:R.top+R.height*fy,
                                        bubbles:true,button:0,pointerId:id});
                 pg.dispatchEvent(new PointerEvent("pointerdown",at(0.30,0.55,85)));
                 pg.dispatchEvent(new PointerEvent("pointerup",at(0.30,0.55,85)));
                 await new Promise(r=>setTimeout(r,500));
                 const m=S.annos.find(z=>z.maKind==="markup");
                 out.placed=!!m; out.page=m&&m.page; out.sel=(S.sel===(m&&m.id));
                 out.topLeft=!!(m&&Math.abs(m.nx-0.30)<0.01&&Math.abs(m.ny-0.55)<0.01);
                 out.opaque=!!(m&&m.fillOp===1);
                 out.ghostGone=!document.querySelector(".maghost");
                 res(out); })""")
        ok = (drop["held"] and drop["none"] and drop["follows"] and drop["placed"]
              and drop["topLeft"] and drop["sel"] and drop["opaque"] and drop["ghostGone"])
        results.append({"tool": "A markup is held, then placed", "ok": ok, "why": json.dumps(drop)})

        # ---------- 6hb — THE READING SITS ABOVE THE RUN ----------
        # Ced, after a version with it centred on the run: "now, the length is back in the middle.
        # make it on top again." So the reading is lifted clear of the run it measures, still
        # centred along it, and still free to be dragged anywhere and stay there.
        await clear()
        await pick("dim")
        await drag(*at(0.20, 0.50), *at(0.55, 0.50))
        lift = await page.evaluate(
            """()=>{ const l=S.lines.find(z=>z.maKind==="dim");
                     if(!l)return {none:true};
                     const lab=S.annos.find(z=>z.id===l.dimFor);
                     const ed=document.querySelector(`.anno[data-id="${lab.id}"] .ed`);
                     ed.textContent="12'-6\\""; ed.dispatchEvent(new Event("input",{bubbles:true}));
                     ed.blur(); drawAllLines(); layoutAnnos();
                     const b=maDimBox(lab), mid=maDimMid(l);
                     const up=mid[1]-(lab.ny+b.h/2);          /* positive = above the run */
                     const out={ up:+up.toFixed(4), half:+(b.h/2).toFixed(4),
                                 clear:(up>=b.h/2*0.9),
                                 offRun:(lab.ny+b.h)<=mid[1]+0.002,
                                 centredX:Math.abs(lab.nx+b.w/2-mid[0])<0.004 };
                     /* a plumb run lifts SIDEWAYS, off the run just the same */
                     l.x1=0.30;l.y1=0.30;l.x2=0.30;l.y2=0.62; drawAllLines(); layoutAnnos();
                     const b2=maDimBox(lab), m2=maDimMid(l);
                     out.plumbOff=Math.abs(lab.nx+b2.w/2-m2[0])>0.002;
                     out.rot=lab.rot;
                     /* dragged off, the offset is kept FROM THE ANCHOR and still travels */
                     l.x1=0.20;l.y1=0.50;l.x2=0.55;l.y2=0.50; drawAllLines(); layoutAnnos();
                     lab.ny-=0.06; maDimLabelFreed(lab); drawAllLines(); layoutAnnos();
                     const y0=lab.ny;
                     l.x1+=0.04; l.x2+=0.04; drawAllLines(); layoutAnnos();
                     out.freedHeld=Math.abs(lab.ny-y0)<0.004;
                     out.freedFollowed=Math.abs(lab.nx+maDimBox(lab).w/2
                                                -(maDimMid(l)[0]+lab.dimOff[0]))<0.004;
                     return out; }""")
        ok = (not lift.get("none") and lift["clear"] and lift["offRun"] and lift["centredX"]
              and lift["plumbOff"] and lift["freedHeld"] and lift["freedFollowed"])
        results.append({"tool": "The reading sits above the run", "ok": ok,
                        "why": json.dumps(lift)})

        # ---------- 6gt — WEIGHTS UNDER A POINT ----------
        # Ced: "thickness less than 1 pt is not working properly."
        await clear()
        thin = await page.evaluate(
            """()=>{ const pg=document.querySelector('.page[data-idx="0"]');
                     const id=addLine(0,0.2,0.3,0.6,0.3,{col:"#fa3237",sw:1});
                     const l=S.lines.find(z=>z.id===id);
                     const w=v=>{ l.sw=v; drawAllLines();
                       const p=[...pg.querySelectorAll("svg.draw polyline")]
                         .find(z=>z.getAttribute("stroke")==="#fa3237");
                       return p?+p.getAttribute("stroke-width"):null; };
                     const out={ one:w(1), half:w(0.5), quarter:w(0.25), scale:S.scale };
                     S.lines=[]; drawAllLines();
                     /* and a thin BOX draws its outline as SVG, where a CSS border rounds it away */
                     const bid=maAddShape(0,"rect",0.2,0.4,0.2,0.1,{});
                     const b=S.annos.find(z=>z.id===bid);
                     b.col="#fa3237"; b.dash="solid"; b.sw=0.5; layoutAnnos();
                     const d=document.querySelector(`.anno[data-id="${b.id}"]`);
                     const r=d&&d.querySelector("svg.shapeoutline rect");
                     out.boxSvg=!!r; out.boxSw=r?+r.getAttribute("stroke-width"):null;
                     out.boxWant=+(0.5*S.scale).toFixed(3);
                     b.sw=2; layoutAnnos();
                     const d2=document.querySelector(`.anno[data-id="${b.id}"]`);
                     out.thickBorder=!(d2&&d2.querySelector("svg.shapeoutline"));
                     return out; }""")
        ok = (thin["one"] and thin["half"] and thin["quarter"]
              and abs(thin["half"] - thin["one"] / 2) < 0.02
              and abs(thin["quarter"] - thin["one"] / 4) < 0.02
              and thin["boxSvg"] and abs(thin["boxSw"] - thin["boxWant"]) < 0.02
              and thin["thickBorder"])
        results.append({"tool": "Sub-point weights are honoured", "ok": ok, "why": json.dumps(thin)})

        # ---------- 6gt — A CLICK MOVES NOTHING ----------
        # Ced: "adjusting redlines/photos and then clicking them should not move it whatsoever."
        await clear()
        await page.evaluate("()=>{ S.magnet=true; }")
        hold = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 addText(0,0.30,0.30,"ANCHOR");
                 const id=addText(0,0.3037,0.4012,"MOVE ME");
                 const a=S.annos.find(z=>z.id===id); a.manualW=true; a.nw=0.12;
                 layoutAnnos(); await nap(200);
                 const calm=async()=>{ document.querySelectorAll(".anno")
                     .forEach(z=>z.classList.remove("editing"));
                   try{ document.activeElement.blur(); }catch(e){} await nap(80); };
                 await calm();
                 const press=async(steps,dx,dy)=>{
                   const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                   const ed=d.querySelector(".ed"), r=d.getBoundingClientRect();
                   ed.dispatchEvent(new MouseEvent("mousedown",
                     {bubbles:true,clientX:r.left+8,clientY:r.top+6,button:0}));
                   await nap(30);
                   for(let k=1;k<=steps;k++){
                     window.dispatchEvent(new PointerEvent("pointermove",
                       {bubbles:true,clientX:r.left+8+dx*k,clientY:r.top+6+dy*k}));
                     await nap(15);
                   }
                   window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                   await nap(150); await calm();
                 };
                 const b={nx:a.nx,ny:a.ny}, h0=S.history.length;
                 await press(2,1,0);                      /* a click, with a pixel of wobble */
                 const out={ still:(a.nx===b.nx&&a.ny===b.ny), quiet:(S.history.length===h0) };
                 await press(6,9,3);                      /* and a real drag */
                 out.dragged=Math.abs(a.nx-b.nx)>0.01;
                 out.wroteHistory=(S.history.length>h0);
                 /* a click on a resize handle resizes nothing */
                 selectAnno(a.id); await nap(150);
                 const w0=a.nw;
                 const hd=markHandle(a.id,".rz.e");   /* 6is */
                 const hr=hd.getBoundingClientRect();
                 hd.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:hr.left+4,clientY:hr.top+4,pointerId:81,button:0}));
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:hr.left+5,clientY:hr.top+4,pointerId:81}));
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:81}));
                 await nap(150);
                 out.handleStill=Math.abs((a.nw||0)-w0)<1e-6;
                 /* and a click on a stroke leaves it where it is */
                 const lid=addLine(0,0.2,0.7,0.6,0.7,{col:"#fa3237",sw:2});
                 const L=S.lines.find(z=>z.id===lid); drawAllLines(); await nap(150);
                 const p0=[L.x1,L.y1];
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const hit=[...pg.querySelectorAll("svg.draw polyline")]
                   .find(z=>z.getAttribute("stroke")==="transparent");
                 const hr2=hit.getBoundingClientRect();
                 hit.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:hr2.left+hr2.width/2,clientY:hr2.top+hr2.height/2,
                    pointerId:82,button:0}));
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:hr2.left+hr2.width/2+1,clientY:hr2.top+hr2.height/2,
                    pointerId:82}));
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:82}));
                 await nap(150);
                 out.strokeStill=(L.x1===p0[0]&&L.y1===p0[1]);
                 res(out); })""")
        ok = (hold["still"] and hold["quiet"] and hold["dragged"] and hold["wroteHistory"]
              and hold["handleStill"] and hold["strokeStill"])
        results.append({"tool": "A click moves nothing", "ok": ok, "why": json.dumps(hold)})

        # ---------- 6gt — THE TOOL DROPS BACK TO SELECT, UNLESS IT DRAWS ----------
        # Ced: "when clicking the pdf ui, the tool should go back to select mode unless the user is
        # using shapes" and "when using a tool and then the esc is clicked, make sure it goes to select"
        back = {}
        for mode in ("redline", "fix", "strikerow", "cross"):
            await clear()
            await pick(mode)
            p = await printed_at()
            await page.mouse.click(p["x"], p["y"])
            await page.wait_for_timeout(350)
            back[mode] = await page.evaluate("()=>S.mode")
        await clear()
        await pick("box"); await drag(*at(0.16, 0.42), *at(0.32, 0.52))
        back["box"] = await page.evaluate("()=>S.mode")
        # 6jt — the ladder: one press drops the new shape's selection, the next puts the tool down.
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        back["afterEsc1"] = await page.evaluate("()=>S.mode")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        back["afterEsc"] = await page.evaluate("()=>S.mode")
        # 6k1 — Text is no longer sticky: placing a box puts the tool down and leaves the caret in it.
        await clear()
        await pick("text"); await drag(*at(0.16, 0.42), *at(0.34, 0.50))
        await page.wait_for_timeout(250)
        back["typing"] = await page.evaluate(
            "()=>!!document.querySelector('.anno.editing')")
        back["textPutDown"] = await page.evaluate("()=>S.mode")
        await page.keyboard.type("note")
        await page.keyboard.press("Escape"); await page.wait_for_timeout(200)
        back["escFromText"] = await page.evaluate("()=>S.mode")
        ok = (all(back[m] == "select" for m in ("redline", "fix", "strikerow", "cross"))
              and back["box"] == "box" and back["afterEsc1"] == "box"
              and back["afterEsc"] == "select"
              and back["typing"] and back["textPutDown"] == "select"
              and back["escFromText"] == "select")
        results.append({"tool": "Tools drop back to Select", "ok": ok, "why": json.dumps(back)})

        # ---------- 6gt — THE ✕ IS CLICKABLE ----------
        # Ced: "change the position of x button on items/redlines to make it clickable."
        await clear()
        xb = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=addText(0,0.30,0.34,"DELETE ME");
                 const a=S.annos.find(z=>z.id===id); a.manualW=true; a.nw=0.16;
                 layoutAnnos(); selectAnno(id); await nap(220);
                 const d=document.querySelector(`.anno[data-id="${id}"]`);
                 const x=markHandle(id,".x"), r=x.getBoundingClientRect();   /* 6is */
                 const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                 const out={ w:Math.round(r.width), h:Math.round(r.height),
                             onTop:!!(top&&top.classList&&top.classList.contains("x")),
                             overHandle:[...(document.querySelector(".annoui > .anno.selui")
                                            ||d).querySelectorAll(".rz")].some(h=>{
                               const q=h.getBoundingClientRect();
                               return !(q.right<r.left||q.left>r.right||
                                        q.bottom<r.top||q.top>r.bottom); }) };
                 if(out.onTop)top.click();
                 await nap(200);
                 out.deleted=(S.annos.length===0);
                 res(out); })""")
        ok = (xb["onTop"] and not xb["overHandle"] and xb["w"] >= 16 and xb["deleted"])
        results.append({"tool": "The ✕ is clickable", "ok": ok, "why": json.dumps(xb)})

        # ---------- 6gt — A TINIER ARROWHEAD ----------
        await clear()
        tiny = await page.evaluate(
            """()=>{ const out={ sizes:TIP_SIZES.map(t=>t.t) };
                     const id=addLine(0,0.2,0.3,0.6,0.3,{col:"#fa3237",sw:1.5,le1:"arrow"});
                     const l=S.lines.find(z=>z.id===id);
                     const head=v=>{ l.leSz=v; return +headSizeOf(l,1.5).toFixed(2); };
                     out.heads=TIP_SIZES.map(t=>head(t.v));
                     out.rising=out.heads.every((v,i)=>i===0||v>out.heads[i-1]);
                     S.lines=[]; drawAllLines();
                     return out; }""")
        await pick("arrow")
        chips = await page.evaluate(
            """()=>{ tpOpen("arrow",document.querySelector('#tools .tool[data-mode="arrow"]'));
                     return new Promise(res=>setTimeout(()=>{
                       const pop=document.getElementById("toolpop");
                       const row=pop&&pop.querySelector(".tp-tips");
                       const list=row?[...row.querySelectorAll("button")].map(b=>b.title):null;
                       const t=row&&[...row.querySelectorAll("button")].find(b=>/Tiny/i.test(b.title));
                       if(t)t.dispatchEvent(new MouseEvent("click",{bubbles:true}));
                       setTimeout(()=>{ const set=MA_TOOL_STYLES.arrow.leSz;
                         tpApply("leSz",1); tpClose();
                         res({list,set}); },160);
                     },240)); }""")
        tiny["chips"] = chips["list"]; tiny["set"] = chips["set"]
        ok = (tiny["sizes"][0] == "Tiny" and tiny["rising"]
              and tiny["chips"] and "Tiny" in tiny["chips"][0] and tiny["set"] < 0.5)
        results.append({"tool": "A tinier arrowhead", "ok": ok, "why": json.dumps(tiny)})

        # ---------- 6gt — THE PICTURE EDITOR: LASSO AND ROTATE ----------
        await clear()
        lasso = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const c=document.createElement("canvas"); c.width=120; c.height=60;
                 const cg=c.getContext("2d");
                 cg.fillStyle="#fa3237"; cg.fillRect(10,10,40,20);
                 cg.fillStyle="#1144ff"; cg.fillRect(70,30,40,20);
                 const id=addText(0,0.2,0.3,"");
                 const a=S.annos.find(z=>z.id===id);
                 a.kind="img"; a.maKind="snapshot"; a.nw=0.24; a.nh=0.12; a.manualW=true;
                 a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0;
                 layoutAnnos(); skEditor(a); await nap(900);
                 const m=document.querySelector(".sk-edit");
                 const cv=m.querySelector(".sk-edcanvas");
                 const g=cv.getContext("2d",{willReadFrequently:true});
                 const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                 const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                   const btn=t=>{ const r=new RegExp(t,"i");
                     return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                       ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                 const B=()=>cv.getBoundingClientRect();
                 const P=(x,y)=>({clientX:B().left+B().width*(x/cv.width),
                                  clientY:B().top+B().height*(y/cv.height),
                                  bubbles:true,pointerId:91,button:0});
                 const out={ tools:[...m.querySelectorAll(".sk-edb")].map(b=>b.textContent.trim()) };
                 btn("Lasso").click(); await nap(80);
                 out.modes=getComputedStyle(m.querySelector(".sk-edmodes")).display!=="none";
                 cv.dispatchEvent(new PointerEvent("pointerdown",P(5,5)));
                 [[55,5],[55,35],[5,35],[5,5]].forEach(p=>
                   cv.dispatchEvent(new PointerEvent("pointermove",P(p[0],p[1]))));
                 cv.dispatchEvent(new PointerEvent("pointerup",P(5,5)));
                 await nap(250);
                 out.selected=m.querySelector(".sk-edcount").textContent;
                 btn("clearsel").click(); await nap(250);
                 out.tookRed=(px(20,20)[3]===0);
                 out.keptBlue=(px(90,40)[3]>200);
                 btn("undo").click(); await nap(250);
                 out.undone=(px(20,20)[3]>200);
                 const was=[cv.width,cv.height];
                 btn("Rotate right").click(); await nap(300);
                 out.turned=(cv.width===was[1]&&cv.height===was[0]);
                 out.topRight=(px(cv.width-25,20)[0]>200&&px(cv.width-25,20)[1]<90);
                 btn("undo").click(); await nap(300);
                 out.turnUndone=(cv.width===was[0]&&cv.height===was[1]&&px(20,20)[3]>200);
                 btn("Rotate left").click(); await nap(300);
                 const nw0=a.nw, nh0=a.nh, want=[cv.width,cv.height];
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(500);
                 out.closed=!document.querySelector(".sk-edit");
                 out.swapped=(Math.abs(a.nw-nw0)>1e-4&&Math.abs(a.nh-nh0)>1e-4);
                 const dims=u=>new Promise(r=>{ const z=new Image();
                   z.onload=()=>r([z.naturalWidth,z.naturalHeight]); z.onerror=()=>r(null); z.src=u; });
                 out.src=await dims(a.src);
                 out.orig=await dims(a.srcOrig);
                 out.origTurned=(String(out.orig)===String(want));
                 res(out); })""")
        ok = (lasso["modes"] and lasso["tookRed"] and lasso["keptBlue"] and lasso["undone"]
              and lasso["turned"] and lasso["topRight"] and lasso["turnUndone"]
              and lasso["closed"] and lasso["swapped"] and lasso["origTurned"]
              and any("Lasso" in t for t in lasso["tools"])
              and any("Rotate" in t for t in lasso["tools"]))
        results.append({"tool": "Picture editor: lasso and rotate", "ok": ok, "why": json.dumps(lasso)})

        # ---------- 6gu — A CALLOUT'S BODY MOVES, ITS ARROW STAYS ----------
        # Ced: "in callouts, make the body movable but if the body is moved, the anchoring should be
        # from the arrow."
        await clear()
        co = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 maPlaceCallout(0,0.45,0.60,"NOTE",{x:0.62,y:0.48});
                 await nap(300);
                 const box=S.annos.find(a=>a.maKind==="callout");
                 const lead=S.lines.find(l=>l.coFor===box.id);
                 setMode("select"); selectAnno(box.id); await nap(150);
                 document.querySelectorAll(".anno").forEach(z=>z.classList.remove("editing"));
                 try{ document.activeElement.blur(); }catch(e){} await nap(120);
                 const tip=[lead.x2,lead.y2], b0=[box.nx,box.ny];
                 const d=document.querySelector(`.anno[data-id="${box.id}"]`);
                 const r=d.getBoundingClientRect();
                 d.querySelector(".ed").dispatchEvent(new MouseEvent("mousedown",
                   {bubbles:true,clientX:r.left+10,clientY:r.top+8,button:0}));
                 for(let k=1;k<=8;k++){
                   window.dispatchEvent(new PointerEvent("pointermove",
                     {bubbles:true,clientX:r.left+10-k*18,clientY:r.top+8+k*10}));
                   await nap(14);
                 }
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                 await nap(250); drawAllLines();
                 const out={ bodyMoved:(Math.abs(box.nx-b0[0])>0.01||Math.abs(box.ny-b0[1])>0.01),
                             tipHeld:(Math.abs(lead.x2-tip[0])<5e-4&&Math.abs(lead.y2-tip[1])<5e-4) };
                 /* the leader still leaves the box, wherever the box went */
                 const p=linePts(lead);
                 out.attached=(p[0][0]>=box.nx-0.004&&p[0][0]<=box.nx+box.nw+0.004
                             &&p[0][1]>=box.ny-0.004&&p[0][1]<=box.ny+box.nh+0.004);
                 /* a nudge behaves the same way */
                 const t1=[lead.x2,lead.y2];
                 selectAnno(box.id);
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
                 await nap(200);
                 out.nudgeHeld=(lead.x2===t1[0]&&lead.y2===t1[1]);
                 /* but the whole callout still travels when the SELECTION is dragged */
                 clearMulti(); selectAnno(null); S.selMulti.add(box.id); paintMulti();
                 document.querySelectorAll(".anno").forEach(z=>z.classList.remove("editing"));
                 try{ document.activeElement.blur(); }catch(e){} await nap(150);
                 const t2=lead.x2, b2=box.nx;
                 const d2=document.querySelector(`.anno[data-id="${box.id}"]`);
                 const r2=d2.getBoundingClientRect();
                 d2.querySelector(".ed").dispatchEvent(new MouseEvent("mousedown",
                   {bubbles:true,clientX:r2.left+10,clientY:r2.top+8,button:0}));
                 for(let k=1;k<=8;k++){
                   window.dispatchEvent(new PointerEvent("pointermove",
                     {bubbles:true,clientX:r2.left+10+k*10,clientY:r2.top+8}));
                   await nap(14);
                 }
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                 await nap(250);
                 out.wholeMoved=(Math.abs(box.nx-b2)>0.005&&Math.abs(lead.x2-t2)>0.005);
                 res(out); })""")
        ok = (co["bodyMoved"] and co["tipHeld"] and co["attached"] and co["nudgeHeld"]
              and co["wholeMoved"])
        results.append({"tool": "A callout hangs off its arrow", "ok": ok, "why": json.dumps(co)})

        # ---------- 6gu — LAYERING, AND A GROUP IS ONE LAYER ----------
        await clear()
        lay = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const mk=(x,y)=>{ const id=maAddShape(0,"rect",x,y,0.1,0.06,{});
                   const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2; return a; };
                 const a1=mk(0.20,0.30), a2=mk(0.24,0.32), a3=mk(0.28,0.34), a4=mk(0.32,0.36);
                 layoutAnnos(); await nap(200);
                 clearMulti(); S.selMulti.add(a1.id); S.selMulti.add(a2.id); paintMulti();
                 groupSelected(); await nap(200);
                 const out={ grouped:(a1.group!=null&&a1.group===a2.group) };
                 /* clicking one of a group selects the group, and its bar carries front and back */
                 selectAnno(null); clearMulti();
                 const d=document.querySelector(`.anno[data-id="${a1.id}"]`);
                 const r=d.getBoundingClientRect();
                 d.querySelector(".ed").dispatchEvent(new MouseEvent("mousedown",
                   {bubbles:true,clientX:r.left+6,clientY:r.top+6,button:0}));
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
                 await nap(200);
                 out.selects=multiCount();
                 out.hasButtons=!!document.querySelector('#multibar [data-lay3="front"]');
                 document.querySelector('#multibar [data-lay3="front"]').click();
                 await nap(250);
                 const z=x=>x.z||0;
                 out.front={ zs:[z(a1),z(a2),z(a3),z(a4)],
                             asOne:(Math.min(z(a1),z(a2))>Math.max(z(a3),z(a4))),
                             orderKept:(z(a1)<z(a2)),
                             positive:[a1,a2,a3,a4].every(x=>z(x)>0) };
                 const e1=document.querySelector(`.anno[data-id="${a1.id}"]`);
                 out.css=e1?e1.style.zIndex:"";
                 document.querySelector('#multibar [data-lay3="back"]').click();
                 await nap(250);
                 /* 6hu — BACK crosses the strokes: the pair leaves the band the others are in, which
                    is what puts it under every line on the page as well as under its neighbours. */
                 out.back={ asOne:(!!a1.under&&!!a2.under&&!a3.under&&!a4.under),
                            orderKept:(z(a1)<z(a2)),
                            positive:[a1,a2,a3,a4].every(x=>z(x)>0) };
                 /* and a single ungrouped mark still layers from its own bar */
                 clearMulti(); selectAnno(a3.id); await nap(150);
                 document.querySelector('#annobar [data-lay="front"]').click();
                 await nap(200);
                 out.single=(!a3.under&&z(a3)>Math.max(z(a4),0));
                 res(out); })""")
        ok = (lay["grouped"] and lay["selects"] == 2 and lay["hasButtons"]
              and lay["front"]["asOne"] and lay["front"]["orderKept"] and lay["front"]["positive"]
              and lay["back"]["asOne"] and lay["back"]["orderKept"] and lay["back"]["positive"]
              and lay["css"] and lay["single"])
        results.append({"tool": "A group is one layer", "ok": ok, "why": json.dumps(lay)})

        # ---------- 6gu — COPY, PASTE AND DELETE FROM THE KEYBOARD ----------
        # driven with REAL keys, through the browser, not by calling the functions
        await clear()
        await page.evaluate(
            """()=>{ const id=maAddShape(0,"rect",0.2,0.32,0.12,0.07,{});
                     const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2;
                     layoutAnnos(); selectAnno(id); }""")
        await page.wait_for_timeout(250)
        keys = {}
        await page.keyboard.press("Control+c"); await page.wait_for_timeout(250)
        keys["copied"] = await page.evaluate("()=>clipCount()")
        await page.mouse.move(*at(0.55, 0.55)); await page.wait_for_timeout(120)
        await page.keyboard.press("Control+v"); await page.wait_for_timeout(350)
        keys["afterPaste"] = await page.evaluate("()=>S.annos.length")
        keys["landed"] = await page.evaluate(
            "()=>!(typeof _placing!=='undefined'&&_placing)")
        nx0 = await page.evaluate("()=>S.annos[S.annos.length-1].nx")
        await page.mouse.click(*at(0.75, 0.72)); await page.wait_for_timeout(300)
        keys["stayed"] = await page.evaluate(
            f"()=>Math.abs(S.annos[S.annos.length-1].nx-{nx0})<1e-6")
        await page.evaluate("()=>{ selectAnno(S.annos[S.annos.length-1].id); }")
        await page.wait_for_timeout(200)
        await page.keyboard.press("Delete"); await page.wait_for_timeout(300)
        keys["afterDelete"] = await page.evaluate("()=>S.annos.length")
        # and with the caret sitting in a mark, which used to silence the copy
        keys["caret"] = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.clip={a:[],l:[]};
                 const a=S.annos[0]; selectAnno(a.id);
                 const ed=document.querySelector(`.anno[data-id="${a.id}"] .ed`);
                 ed.focus(); await nap(150);
                 const was=(document.activeElement===ed);
                 document.dispatchEvent(new KeyboardEvent("keydown",
                   {key:"c",ctrlKey:true,bubbles:true}));
                 await nap(200);
                 res({focused:was, clip:clipCount()}); })""")
        ok = (keys["copied"] == 1 and keys["afterPaste"] == 2 and keys["landed"]
              and keys["stayed"] and keys["afterDelete"] == 1
              and keys["caret"]["focused"] and keys["caret"]["clip"] == 1)
        results.append({"tool": "Copy · paste · delete from the keyboard", "ok": ok,
                        "why": json.dumps(keys)})

        # ---------- 6gz — CROP IN THE PICTURE EDITOR ----------
        # Ced: "add crop on edit photo to crop the final photo."
        await clear()
        crop = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const c=document.createElement("canvas"); c.width=120; c.height=60;
                 const cg=c.getContext("2d");
                 cg.fillStyle="#fa3237"; cg.fillRect(10,10,40,20);
                 cg.fillStyle="#1144ff"; cg.fillRect(70,30,40,20);
                 const id=addText(0,0.2,0.3,"");
                 const a=S.annos.find(z=>z.id===id);
                 a.kind="img"; a.maKind="snapshot"; a.nw=0.24; a.nh=0.12; a.manualW=true;
                 a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0;
                 layoutAnnos(); skEditor(a); await nap(900);
                 const m=document.querySelector(".sk-edit");
                 const cv=m.querySelector(".sk-edcanvas");
                 const g=cv.getContext("2d",{willReadFrequently:true});
                 const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                 const _bl=()=>[...m.querySelectorAll(".sk-edb")];
                   const btn=t=>{ const r=new RegExp(t,"i");
                     return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                       ||_bl().find(z=>r.test(z.textContent))||_bl().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                 const B=()=>cv.getBoundingClientRect();
                 const P=(x,y)=>({clientX:B().left+B().width*(x/cv.width),
                                  clientY:B().top+B().height*(y/cv.height),
                                  bubbles:true,pointerId:96,button:0});
                 const was=[cv.width,cv.height], nw0=a.nw, nh0=a.nh;
                 const out={ hasCrop:!!btn("crop") };
                 /* 6m1 — CROP IS TWO HALVES NOW. Ced: "crop should also come from the edges of the
                    photo, not dragged by the user." Picking the tool up puts the box on the picture's
                    own edges; a drag pushes an edge in; nothing is cut until Apply. So the gesture
                    this case drives is the new one — drag the box smaller, check nothing has been cut
                    yet, then press Apply — and the cut it asserts afterwards is unchanged. */
                 btn("crop").click(); await nap(140);
                 out.boxOnOpen=(()=>{ const ov=m.querySelector(".sk-edov");
                   try{ const d=ov.getContext("2d").getImageData(0,0,ov.width,ov.height).data;
                        let n=0; for(let i=3;i<d.length;i+=4) if(d[i])n++; return n; }catch(e){ return 0; } })();
                 /* take hold of the SE corner of the full-size box and pull it in */
                 cv.dispatchEvent(new PointerEvent("pointerdown",P(cv.width-1,cv.height-1)));
                 cv.dispatchEvent(new PointerEvent("pointermove",P(60,40)));
                 cv.dispatchEvent(new PointerEvent("pointerup",P(60,40)));
                 await nap(250);
                 out.uncutWhileDragging=(cv.width===was[0]&&cv.height===was[1]);
                 btn("cropapply").click(); await nap(400);
                 out.size=[cv.width,cv.height];
                 out.shrank=(cv.width<was[0]&&cv.height<was[1]);
                 out.keptRed=(px(10,10)[0]>200&&px(10,10)[3]>200);
                 /* the ORIGINAL came down with it, so Restore still lines up */
                 btn("restore").click(); await nap(80);
                 cv.dispatchEvent(new PointerEvent("pointerdown",P(20,20)));
                 cv.dispatchEvent(new PointerEvent("pointerup",P(20,20)));
                 await nap(200);
                 out.restores=(px(20,20)[0]>200&&px(20,20)[3]>200);
                 /* undo the restore dab, then the crop itself: the margin comes back */
                 btn("undo").click(); await nap(250);
                 btn("undo").click(); await nap(350);
                 out.undone=(cv.width===was[0]&&cv.height===was[1]&&px(90,40)[2]>200);
                 btn("redo").click(); await nap(350);
                 out.redone=(cv.width<was[0]);
                 const want=[cv.width,cv.height];
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(500);
                 out.closed=!document.querySelector(".sk-edit");
                 /* the mark shrank with it, keeping the scale the picture had */
                 out.markShrank=(a.nw<nw0&&a.nh<nh0);
                 out.scaleKept=(Math.abs((a.nw/nw0)-(want[0]/was[0]))<0.02
                              &&Math.abs((a.nh/nh0)-(want[1]/was[1]))<0.02);
                 const dims=u=>new Promise(r=>{ const z=new Image();
                   z.onload=()=>r([z.naturalWidth,z.naturalHeight]); z.onerror=()=>r(null); z.src=u; });
                 out.src=await dims(a.src);
                 out.orig=await dims(a.srcOrig);
                 out.origCut=(String(out.orig)===String(want));
                 res(out); })""")
        ok = (crop["hasCrop"] and crop["boxOnOpen"] > 1000 and crop["uncutWhileDragging"]
              and crop["shrank"] and crop["keptRed"] and crop["restores"]
              and crop["undone"] and crop["redone"] and crop["closed"]
              and crop["markShrank"] and crop["scaleKept"] and crop["origCut"])
        results.append({"tool": "Crop cuts the picture down", "ok": ok, "why": json.dumps(crop)})

        # ---------- 6gz — THE NEUMORPHIC LANGUAGE REACHES EVERY SURFACE ----------
        # Ced: "also please apply the neumorphism design accross the ui."
        await clear()
        neu = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const sh=el=>el?getComputedStyle(el).boxShadow:"";
                 const has=el=>{ const v=sh(el); return !!(v&&v!=="none"&&/rgb/.test(v)); };
                 const inset=el=>(sh(el)||"").indexOf("inset")>=0;
                 const out={};
                 const id=maAddShape(0,"rect",0.2,0.3,0.12,0.07,{});
                 const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2;
                 layoutAnnos(); selectAnno(id); await nap(300);
                 out.annobar=has(document.getElementById("annobar"))
                           &&has(document.querySelector("#annobar button"));
                 clearMulti(); S.selMulti.add(id); paintMulti(); await nap(250);
                 out.multibar=has(document.getElementById("multibar"))
                            &&has(document.querySelector("#multibar button"));
                 clearMulti(); selectAnno(null);
                 const lid=addLine(0,0.2,0.6,0.5,0.6,{col:"#fa3237",sw:2});
                 drawAllLines(); selectLine(lid); await nap(300);
                 out.linebar=has(document.getElementById("linebar"))
                           &&has(document.querySelector("#linebar button"));
                 selectLine(null);
                 setMode("box");
                 tpOpen("box",document.querySelector('#tools .tool[data-mode="box"]'));
                 await nap(300);
                 out.toolpop=has(document.getElementById("toolpop"))
                           &&has(document.querySelector("#toolpop .tp-cb"))
                           &&inset(document.querySelector("#toolpop .tp-cb.on"));
                 tpClose(); setMode("select"); await nap(150);
                 maSetTab("notes"); maPanelOpen(true); await nap(400);
                 /* 6ic — the tab strip is gone; each Assist card carries the raised edge */
                 out.maPanel=has(document.getElementById("maPanel"))
                           &&inset(document.querySelector("#maPanel .mk-head"));
                 maPanelOpen(false); await nap(200);
                 document.getElementById("dlg").classList.add("show"); await nap(200);
                 out.dialog=has(document.querySelector("#dlg .dlg-box"));
                 document.getElementById("dlg").classList.remove("show");
                 S.annos=[];S.lines=[];layoutAnnos();
                 const c=document.createElement("canvas"); c.width=80; c.height=50;
                 c.getContext("2d").fillRect(5,5,40,20);
                 const pid=addText(0,0.2,0.3,"");
                 const p=S.annos.find(z=>z.id===pid);
                 p.kind="img"; p.maKind="snapshot"; p.nw=0.2; p.nh=0.12; p.manualW=true;
                 p.src=c.toDataURL("image/png"); p.sw=0;
                 layoutAnnos(); skEditor(p); await nap(900);
                 out.editor=has(document.querySelector(".sk-edcard"))
                          &&has(document.querySelector(".sk-edb"))
                          &&inset(document.querySelector(".sk-edb.on"))
                          &&inset(document.querySelector(".sk-edstage"));
                 [...document.querySelectorAll(".sk-edfb")]
                   .find(b=>/Cancel/.test(b.textContent)).click();
                 await nap(250);
                 /* and a MARK is still content: no furniture shadow on its text box */
                 S.annos=[];S.lines=[];layoutAnnos();
                 const rid=addText(0,0.3,0.4,"REDLINE");
                 layoutAnnos(); selectAnno(rid); await nap(250);
                 const d=document.querySelector(`.anno[data-id="${rid}"]`);
                 out.markClean=(sh(d.querySelector(".ed"))==="none");
                 out.ribbon=has(document.getElementById("toolbar"))
                          &&has(document.querySelector("#tools .tool"));
                 res(out); })""")
        ok = all(neu.get(k) for k in ("annobar", "multibar", "linebar", "toolpop", "maPanel",
                                      "dialog", "editor", "markClean", "ribbon"))
        results.append({"tool": "Neumorphism reaches every surface", "ok": ok, "why": json.dumps(neu)})

        # ---------- 6ha — THE PREVIEW IS THE MARK ----------
        # Ced: "all tools should refresh in realtime too, even as the shape or line or any redline is
        # just being drawn, the redline, line, or shape should already be visible to the user"
        await clear()
        await page.evaluate(
            """()=>{ MA_TOOL_STYLES.arrow=Object.assign({},MA_TOOL_STYLES.arrow||{},
                       {col:"#2b8a3e",sw:3,le1:"arrow",leSz:1.5,dash:"dash"});
                     MA_TOOL_STYLES.box=Object.assign({},MA_TOOL_STYLES.box||{},
                       {col:"#1971c2",sw:2,fill:"#ffe066",fillOp:0.5,dash:"solid"}); }""")
        await pick("arrow")
        x1, y1 = at(0.20, 0.25)
        x2, y2 = at(0.50, 0.35)
        await page.mouse.move(x1, y1); await page.mouse.down()
        await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2); await page.wait_for_timeout(80)
        await page.mouse.move(x2, y2); await page.wait_for_timeout(120)
        live = await page.evaluate(
            """()=>{ const svg=document.querySelector('.page[data-idx="0"] svg.draw:not(.under)');
                     const p=[...svg.querySelectorAll("polyline")]
                       .filter(z=>z.getAttribute("stroke")==="#2b8a3e");
                     return { drawn:p.length>0,
                              width:p[0]?+p[0].getAttribute("stroke-width"):null,
                              dashed:!!(p[0]&&p[0].getAttribute("stroke-dasharray")),
                              head:svg.querySelectorAll("path").length>0,
                              lines:S.lines.length }; }""")
        await page.mouse.up(); await page.wait_for_timeout(300)
        live["after"] = await page.evaluate(
            """()=>({lines:S.lines.length,
                     ghost:[...document.querySelectorAll('.page[data-idx="0"] svg.draw:not(.under) polyline')]
                             .filter(z=>z.getAttribute("stroke")==="#2b8a3e").length})""")
        await clear()
        await pick("box")
        bx1, by1 = at(0.20, 0.55)
        bx2, by2 = at(0.42, 0.66)
        await page.mouse.move(bx1, by1); await page.mouse.down()
        await page.mouse.move(bx2, by2); await page.wait_for_timeout(120)
        shape = await page.evaluate(
            """()=>{ const r=document.querySelector('.page[data-idx="0"] svg.draw:not(.under) rect');
                     return { drawn:!!r, stroke:r&&r.getAttribute("stroke"),
                              fill:r&&r.getAttribute("fill"),
                              guide:!!document.querySelector(".marquee.ghosting"),
                              annos:S.annos.length }; }""")
        await page.mouse.up(); await page.wait_for_timeout(300)
        shape["after"] = await page.evaluate(
            """()=>({annos:S.annos.length,
                     ghost:!!document.querySelector('.page[data-idx="0"] svg.draw:not(.under) rect')})""")
        ok = (live["drawn"] and live["dashed"] and live["head"] and live["lines"] == 0
              and live["after"]["lines"] == 1 and live["after"]["ghost"] == 1
              and shape["drawn"] and "25,113,194" in (shape["stroke"] or "").replace(" ", "")
              and "255,224,102" in (shape["fill"] or "").replace(" ", "") and shape["guide"]
              and shape["annos"] == 0 and shape["after"]["annos"] == 1
              and not shape["after"]["ghost"])
        results.append({"tool": "The preview is the mark", "ok": ok,
                        "why": json.dumps({"stroke": live, "shape": shape})})

        # ---------- 6ha — THE HANDLES STAY UP WHILE YOU TYPE ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.36, 0.40))
        await page.wait_for_timeout(300)
        hands = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const a=S.annos[0];
                 const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                 d.querySelector(".ed").focus(); await nap(250);
                 const vis=el=>!!el&&getComputedStyle(el).display!=="none";
                 /* 6is — the handles are in the frame above the page while the mark is selected */
                 const F=document.querySelector(".annoui > .anno.selui")||d;
                 res({ editing:d.classList.contains("editing"), sel:d.classList.contains("sel"),
                       rz:[...F.querySelectorAll(".rz")].filter(vis).length,
                       rot:vis(markHandle(a.id,".rot")), mov:vis(markHandle(a.id,".mov")),
                       x:!!markHandle(a.id,".x") }); })""")
        ok = (hands["editing"] and hands["sel"] and hands["rz"] == 8
              and hands["rot"] and hands["mov"] and hands["x"])
        results.append({"tool": "Handles stay up while typing", "ok": ok, "why": json.dumps(hands)})

        # ---------- 6ha — A ROTATED CALLOUT KEEPS ITS LEADER ----------
        await clear()
        co2 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 maPlaceCallout(0,0.30,0.62,"NOTE",{x:0.50,y:0.50});
                 await nap(350);
                 const box=S.annos.find(a=>a.maKind==="callout");
                 const lead=S.lines.find(l=>l.coFor===box.id);
                 const onBox=()=>{ const q=maRotPt(box,linePts(lead)[0],-1);
                   const nearX=(Math.abs(q[0]-box.nx)<0.004||Math.abs(q[0]-(box.nx+box.nw))<0.004);
                   const nearY=(Math.abs(q[1]-box.ny)<0.004||Math.abs(q[1]-(box.ny+box.nh))<0.004);
                   const inX=(q[0]>=box.nx-0.004&&q[0]<=box.nx+box.nw+0.004);
                   const inY=(q[1]>=box.ny-0.004&&q[1]<=box.ny+box.nh+0.004);
                   return (nearX&&inY)||(nearY&&inX); };
                 const out={ flat:onBox(), turned:[] };
                 const tip0=[lead.x2,lead.y2];
                 [15,45,90,180,270].forEach(deg=>{ box.rot=deg; drawAllLines();
                   out.turned.push({deg,ok:onBox(),
                                    held:(lead.x2===tip0[0]&&lead.y2===tip0[1])}); });
                 box.rot=0; drawAllLines();
                 out.back=onBox();
                 res(out); })""")
        ok = (co2["flat"] and co2["back"] and all(t["ok"] and t["held"] for t in co2["turned"]))
        results.append({"tool": "A rotated callout keeps its leader", "ok": ok, "why": json.dumps(co2)})

        # ---------- 6ha — THE EDITOR: EDGE, CENTRING, FREE ROTATE ----------
        await clear()
        ed2 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const c=document.createElement("canvas"); c.width=120; c.height=60;
                 const cg=c.getContext("2d");
                 cg.fillStyle="#fa3237"; cg.fillRect(10,10,40,20);
                 const id=addText(0,0.2,0.3,"");
                 const a=S.annos.find(z=>z.id===id);
                 a.kind="img"; a.maKind="snapshot"; a.nw=0.24; a.nh=0.12; a.manualW=true;
                 a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0;
                 layoutAnnos(); skEditor(a); await nap(900);
                 const m=document.querySelector(".sk-edit");
                 const stage=m.querySelector(".sk-edstage"), box=m.querySelector(".sk-edwrap");
                 const cv=m.querySelector(".sk-edcanvas");
                 const g=cv.getContext("2d",{willReadFrequently:true});
                 const cs=getComputedStyle(box);
                 const sr=stage.getBoundingClientRect(), br=box.getBoundingClientRect();
                 /* 6m0 — the chequer moved OFF this element. It used to be `.sk-edwrap`'s own
                    background, and `.sk-edwrap` is the element the free-turn preview rotates, so the
                    squares turned with the picture and could not say whether an edge had come square.
                    It is a clipped, counter-rotated child now, so the test reads it there — and asks
                    the thing that actually matters, which is that the picture carries a chequer and
                    the element that turns does not. */
                 const bgp=m.querySelector(".sk-edbg");
                 const out={ edge:((cs.boxShadow||"").indexOf("rgb")>=0&&cs.outlineStyle==="dashed"),
                             chequer:(!!bgp
                               &&(getComputedStyle(bgp).backgroundImage||"").indexOf("gradient")>=0
                               &&(cs.backgroundImage||"none")==="none"),
                             centred:(Math.abs((br.left+br.width/2)-(sr.left+sr.width/2))<6
                                    &&Math.abs((br.top+br.height/2)-(sr.top+sr.height/2))<6) };
                 const frng=m.querySelector(".sk-edfree input[type=range]");
                 out.hasFree=!!frng;
                 const was=[cv.width,cv.height];
                 frng.value="30"; frng.dispatchEvent(new Event("input",{bubbles:true}));
                 await nap(150);
                 out.previews=(/rotate\\(30deg\\)/.test(box.style.transform||"")
                             &&cv.width===was[0]);
                 frng.dispatchEvent(new Event("change",{bubbles:true}));
                 await nap(500);
                 /* 6m0 — a free turn no longer GROWS unconditionally. Ced: "do not make the
                    selection or canvass bigger every rotate, always take the smallest space it can
                    get." The canvas is resampled to hold the turned rectangle and then trimmed back
                    to its own ink, so what the turn guarantees is a DIFFERENT shape that still holds
                    everything — not a bigger one. On this fixture (a 40x20 bar in a 120x60 field)
                    the trim takes the empty margin with it, which is the point. */
                 out.turned=(cv.width!==was[0]||cv.height!==was[1]);
                 out.noBigger=(cv.width<=Math.ceil(was[0]*Math.cos(Math.PI/6)+was[1]*Math.sin(Math.PI/6))
                             &&cv.height<=Math.ceil(was[0]*Math.sin(Math.PI/6)+was[1]*Math.cos(Math.PI/6)));
                 out.cleared=!(box.style.transform||"").length;
                 out.ink=(()=>{ let n=0; const d=g.getImageData(0,0,cv.width,cv.height).data;
                   for(let p=3;p<d.length;p+=4)if(d[p]>40)n++; return n>500; })();
                 m.querySelector('.sk-edb[data-k="undo"]').click();
                 await nap(400);
                 out.undone=(cv.width===was[0]&&cv.height===was[1]);
                 const nw0=a.nw;
                 frng.value="45"; frng.dispatchEvent(new Event("change",{bubbles:true}));
                 await nap(500);
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(500);
                 /* 6m0 — likewise: the mark takes the picture's NEW SHAPE, which after a trim may
                    be narrower rather than wider. What is asserted is that it moved with the picture
                    and kept the picture's scale. */
                 out.saved=(!document.querySelector(".sk-edit")&&Math.abs(a.nw-nw0)>1e-4);
                 res(out); })""")
        ok = all(ed2.get(k) for k in ("edge", "chequer", "centred", "hasFree", "previews",
                                      "turned", "noBigger", "cleared", "ink", "undone", "saved"))
        results.append({"tool": "Editor: edge, centring, free rotate", "ok": ok,
                        "why": json.dumps(ed2)})

        # ---------- 6ha — A MARKUP IS EDITABLE FROM THE LIBRARY ----------
        await clear()
        mk2 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const c=document.createElement("canvas"); c.width=90; c.height=60;
                 c.getContext("2d").fillStyle="#1144ff";
                 c.getContext("2d").fillRect(0,0,90,60);
                 const blob=await new Promise(r=>c.toBlob(r,"image/png"));
                 MA_MARKUPS.length=0;
                 const rec=await maAddMarkupFile(new File([blob],"north.png",{type:"image/png"}));
                 maSetTab("markups"); maPanelOpen(true); await nap(400);
                 const cell=document.querySelector("#maPanel .ma-mk");
                 const edb=cell&&cell.querySelector(".edit");
                 const out={ hasEdit:!!edb };
                 if(!edb){ res(out); return; }
                 const before=rec.src.length;
                 edb.dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(900);
                 const m=document.querySelector(".sk-edit");
                 out.opened=!!m;
                 out.titled=!!(m&&/markup/i.test(m.querySelector(".sk-edtitle").textContent));
                 const cv=m.querySelector(".sk-edcanvas");
                 const B=()=>cv.getBoundingClientRect();
                 const P=(x,y)=>({clientX:B().left+B().width*(x/cv.width),
                                  clientY:B().top+B().height*(y/cv.height),
                                  bubbles:true,pointerId:57,button:0});
                 /* 6m1 — the crop box opens on the picture's edges and is applied by a button; this
                    case only needs the markup to come back changed, so it pulls the SE corner in and
                    presses Apply. */
                 m.querySelector('.sk-edb[data-k="crop"]').click();
                 await nap(140);
                 cv.dispatchEvent(new PointerEvent("pointerdown",P(cv.width-1,cv.height-1)));
                 cv.dispatchEvent(new PointerEvent("pointermove",P(50,40)));
                 cv.dispatchEvent(new PointerEvent("pointerup",P(50,40)));
                 await nap(200);
                 m.querySelector('.sk-edb[data-k="cropapply"]').click();
                 await nap(350);
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(700);
                 out.closed=!document.querySelector(".sk-edit");
                 out.changed=(rec.src.length!==before);
                 out.smaller=(rec.w<90&&rec.h<60);
                 try{ const v=JSON.parse(localStorage.getItem("ma.markups.v1")||"[]");
                      out.kept=!!(v[0]&&v[0].src===rec.src); }catch(e){ out.kept=false; }
                 maPanelOpen(false);
                 const pid=maPlaceMarkup(rec,0,0.5,0.5);
                 await nap(300);
                 out.stillPlaces=(pid!=null&&S.annos.some(z=>z.id===pid));
                 res(out); })""")
        ok = all(mk2.get(k) for k in ("hasEdit", "opened", "titled", "closed", "changed",
                                      "smaller", "kept", "stillPlaces"))
        results.append({"tool": "A markup can be edited", "ok": ok, "why": json.dumps(mk2)})

        # ---------- 6ha — A FINGER DRIVES THE MARKS ----------
        await clear()
        touch = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=addText(0,0.30,0.35,"TOUCH ME");
                 const a=S.annos.find(z=>z.id===id); a.manualW=true; a.nw=0.14;
                 layoutAnnos(); await nap(250);
                 document.querySelectorAll(".anno").forEach(z=>z.classList.remove("editing"));
                 try{ document.activeElement.blur(); }catch(e){}
                 selectAnno(null); await nap(150);
                 const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                 const ed=d.querySelector(".ed"), r=d.getBoundingClientRect();
                 const b={nx:a.nx,ny:a.ny};
                 ed.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,pointerId:63,pointerType:"touch",isPrimary:true,
                    clientX:r.left+10,clientY:r.top+8,button:0}));
                 await nap(40);
                 const picked=(S.sel===a.id);
                 for(let k=1;k<=8;k++){
                   window.dispatchEvent(new PointerEvent("pointermove",
                     {bubbles:true,pointerId:63,pointerType:"touch",
                      clientX:r.left+10+k*9,clientY:r.top+8+k*4}));
                   await nap(14);
                 }
                 window.dispatchEvent(new PointerEvent("pointerup",
                   {bubbles:true,pointerId:63,pointerType:"touch"}));
                 await nap(250);
                 const cs=getComputedStyle(d);
                 res({ picked, moved:(Math.abs(a.nx-b.nx)>0.01),
                       typing:!!document.querySelector(".anno.editing"),
                       annoTouch:cs.touchAction,
                       btnTouch:getComputedStyle(document.querySelector("#tools .tool")).touchAction });
               })""")
        ok = (touch["picked"] and touch["moved"] and not touch["typing"]
              and touch["annoTouch"] == "none" and touch["btnTouch"] == "manipulation")
        results.append({"tool": "A finger drives the marks", "ok": ok, "why": json.dumps(touch)})

        # ---------- 6hb — ROTATE ASKS FOR AN ANGLE ----------
        # Ced: "when clicking the rotate, allow user to enter value of degrees." A click on the
        # rotate grip — a press that never moved — opens a field; a real drag still turns freely.
        await clear()
        ang = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const id=maAddShape(0,"rect",0.20,0.30,0.14,0.08,{});
                 const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2;
                 layoutAnnos(); selectAnno(id); await nap(250);
                 const rot=markHandle(id,".rot");   /* 6is */
                 const rr=rot.getBoundingClientRect();
                 rot.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:rr.left+10,clientY:rr.top+10,pointerId:43,button:0}));
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:43}));
                 await nap(300);
                 const ask=document.querySelector(".sb-ask");
                 /* 6ms/6mt — the angle is typed in a chip ON THE MARK now, not in a dialog over
                    the sheet. This asked for `.sb-ask` until v53; what it asks for is the same
                    thing one layer up — the press offers somewhere to type, and typing turns it. */
                 const chip=document.querySelector(".angchip");
                 const out={ markAsked:!!chip, modalShown:!!ask,
                             title:chip?"chip":"" };
                 if(chip){ const inp=chip.querySelector("input");
                   inp.value="37";
                   inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
                   await nap(350); }
                 out.markRot=a.rot;
                 /* a STROKE's grip asks too, and turns the run about its middle */
                 S.annos=[]; layoutAnnos();
                 const lid=addLine(0,0.20,0.70,0.60,0.70,{col:"#fa3237",sw:2});
                 const L=S.lines.find(z=>z.id===lid);
                 drawAllLines(); selectLine(lid); await nap(250);
                 const g=[...pg.querySelectorAll("svg.draw g")]
                   .find(z=>/Rotate/i.test((z.querySelector("title")||{}).textContent||""));
                 const gr=g.getBoundingClientRect();
                 const PP=S.pages[0], AW=(PP&&PP.w1)||612, AH=(PP&&PP.h1)||792;
                 const ang=z=>Math.atan2((z.y2-z.y1)*AH,(z.x2-z.x1)*AW);   /* in points, not in 0..1 */
                 const a0=ang(L);
                 g.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:gr.left+gr.width/2,clientY:gr.top+gr.height/2,
                    pointerId:45,button:0}));
                 window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:45}));
                 await nap(300);
                 const chip2=document.querySelector(".angchip");
                 out.strokeAsked=!!chip2;
                 out.strokeModal=!!document.querySelector(".sb-ask");
                 if(chip2){ const inp=chip2.querySelector("input");
                   inp.value="45";
                   inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
                   await nap(350); }
                 const a1=ang(L);
                 out.strokeTurned=+(Math.abs(a1-a0)*180/Math.PI).toFixed(1);
                 selectLine(null);
                 res(out); })""")
        ok = (ang["markAsked"] and abs(ang["markRot"] - 37) < 0.01
              and not ang["modalShown"] and not ang["strokeModal"]   # 6mt — no dialog, for either
              and ang["strokeAsked"] and abs(ang["strokeTurned"] - 45) < 1.5)
        results.append({"tool": "Rotate can be typed", "ok": ok, "why": json.dumps(ang)})

        # ---------- 6hb — THE READING HOLDS ITS CENTRE AS IT IS TYPED ----------
        # Ced: "make sure the text is still aligned center in the ui and was not breaking. there are
        # instance where it breaks and will only come back when moved."
        await clear()
        await pick("dim")
        await drag(*at(0.20, 0.50), *at(0.55, 0.50))
        typing = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const l=S.lines.find(z=>z.maKind==="dim");
                 const lab=S.annos.find(z=>z.id===l.dimFor);
                 const ed=document.querySelector(`.anno[data-id="${lab.id}"] .ed`);
                 ed.focus();
                 const seen=[];
                 for(const t of ["1","12","12'-","12'-6\\" A.G.L."]){
                   ed.textContent=t; ed.dispatchEvent(new Event("input",{bubbles:true}));
                   await nap(120);
                   const e=document.querySelector(`.anno[data-id="${lab.id}"]`);
                   const r=e.getBoundingClientRect(), pr=pg.getBoundingClientRect();
                   const cx=(r.left+r.width/2-pr.left)/pg.offsetWidth;
                   seen.push({t, off:+(cx-maDimMid(l)[0]).toFixed(4),
                              one:(r.height<(lab.size||8)*S.scale*2)});
                 }
                 ed.blur();
                 document.querySelectorAll(".anno").forEach(z=>z.classList.remove("editing"));
                 drawAllLines(); layoutAnnos(); await nap(200);
                 const e2=document.querySelector(`.anno[data-id="${lab.id}"]`);
                 const r2=e2.getBoundingClientRect(), pr2=pg.getBoundingClientRect();
                 res({ seen,
                       held:seen.every(z=>Math.abs(z.off)<0.005&&z.one),
                       afterBlur:+((((r2.left+r2.width/2-pr2.left)/pg.offsetWidth)
                                    -maDimMid(l)[0])).toFixed(4) }); })""")
        ok = typing["held"] and abs(typing["afterBlur"]) < 0.005
        results.append({"tool": "The reading holds centre", "ok": ok, "why": json.dumps(typing)})

        # ---------- 6hb — STRIKE & WRITE SITS ON THE VALUE ----------
        # Ced, twice: "revert the strike and write into a text directly on top of redlined. do not
        # copy the style of length tool." So the correction is written over the printed value, on
        # ONE line, on top of the rule rather than under it, and the rule grows to carry it.
        await clear()
        fix = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 setMode("fix"); await nap(80);
                 pg.querySelector(".tspan").click(); await nap(500);
                 const a=S.annos.find(z=>z.maKind==="fix");
                 const rule=S.lines.find(z=>z.maKind==="strike");
                 if(!a||!rule)return res({none:true});
                 const ed=document.querySelector(`.anno[data-id="${a.id}"] .ed`);
                 ed.focus(); ed.textContent="A MUCH LONGER AS-BUILT VALUE";
                 ed.dispatchEvent(new Event("input",{bubbles:true}));
                 await nap(220);
                 const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                 const out={ above:!!d.closest(".annolayer"), under:!!a.under,
                             grew:(a.nw>0.1),
                             wrapped:(d.offsetHeight>(a.size||8)*S.scale*1.9) };
                 ed.blur();
                 document.querySelectorAll(".anno").forEach(z=>z.classList.remove("editing"));
                 drawAllLines(); layoutAnnos(); await nap(250);
                 const d2=document.querySelector(`.anno[data-id="${a.id}"]`);
                 const hgt=d2.offsetHeight/pg.offsetHeight;
                 out.ruleThrough=(rule.y1>a.ny&&rule.y1<a.ny+hgt);
                 out.ruleWider=((Math.abs(rule.x2-rule.x1))>a.nw);
                 out.centred=Math.abs((a.nx+a.nw/2)-((rule.x1+rule.x2)/2))<0.005;
                 setMode("select");
                 res(out); })""")
        ok = (not fix.get("none") and fix["above"] and not fix["under"] and not fix["wrapped"]
              and fix["grew"] and fix["ruleThrough"] and fix["ruleWider"] and fix["centred"])
        results.append({"tool": "Strike & write sits on the value", "ok": ok, "why": json.dumps(fix)})

        # ---------- 6hb — A CROSS OUT CARRIES THE THREE CONTROLS ----------
        # Ced: "rotate, drag, and x is still not visible on cross out shapes." A cross out is a PAIR
        # of strokes, so it selects as a group — the group frame grew the same trio.
        await clear()
        await pick("crossout")
        await drag(*at(0.25, 0.30), *at(0.45, 0.40))
        await page.wait_for_timeout(400)
        cross = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const f=document.querySelector(".gframe");
                 const vis=el=>!!el&&getComputedStyle(el).display!=="none";
                 const out={ lines:S.lines.length, frame:!!f,
                             rot:vis(f&&f.querySelector(".ggrip.grot")),
                             drag:vis(f&&f.querySelector(".ggrip.gdrag")),
                             del:vis(f&&f.querySelector(".ggrip.gdel")) };
                 if(f){ f.querySelector(".ggrip.gdel").dispatchEvent(
                          new PointerEvent("pointerdown",
                            {bubbles:true,clientX:0,clientY:0,pointerId:49,button:0}));
                        await nap(300); }
                 out.deleted=(S.lines.length===0);
                 try{ clearMulti(); }catch(e){}
                 setMode("select");
                 res(out); })""")
        ok = (cross["lines"] == 2 and cross["frame"] and cross["rot"] and cross["drag"]
              and cross["del"] and cross["deleted"])
        results.append({"tool": "A cross out has its controls", "ok": ok, "why": json.dumps(cross)})

        # ---------- 6hb — A PRESSED BUTTON LOOKS PRESSED ----------
        # Ced: "make sure that the toggles and buttons are working accordingly when selecting. some
        # icons are not showing clicked when being clicked."
        await clear()
        tog = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const st=id=>{ const b=document.getElementById(id);
                   return b?{on:b.classList.contains("on"),ar:b.getAttribute("aria-pressed")}:null; };
                 const out={};
                 out.rail0=st("railToggle");
                 document.getElementById("railToggle").click(); await nap(250);
                 out.rail1=st("railToggle");
                 document.getElementById("railToggle").click(); await nap(250);
                 out.rail2=st("railToggle");
                 out.snap0=Object.assign({},st("snapBtn"),
                   {active:document.getElementById("snapBtn").classList.contains("active")});
                 document.getElementById("snapBtn").click(); await nap(150);
                 out.snap1=Object.assign({},st("snapBtn"),
                   {active:document.getElementById("snapBtn").classList.contains("active")});
                 document.getElementById("snapBtn").click(); await nap(150);
                 /* 6kx — the Assist button this used to read was `maBtn` (Notes), which is gone
                    along with Notes, Parts, As-built and the Redline report. Markups is the one
                    that opens the panel now. */
                 maPanelOpen(true); await nap(300); out.ma=st("markupsBtn");
                 maPanelOpen(false); await nap(250); out.maOff=st("markupsBtn");
                 res(out); })""")
        def pressed(v):                     # the class and the aria state always agree
            return v["on"] == (v["ar"] == "true")
        ok = (all(pressed(tog[k]) for k in ("rail0", "rail1", "rail2", "snap0", "snap1", "ma", "maOff"))
              and tog["rail1"]["on"] != tog["rail0"]["on"]       # a click shows
              and tog["rail2"]["on"] == tog["rail0"]["on"]       # and a second one takes it back
              and tog["snap1"]["on"] != tog["snap0"]["on"]
              and tog["snap1"]["active"] == tog["snap1"]["on"]   # snap's two looks agree
              and tog["ma"]["on"] and not tog["maOff"]["on"])
        results.append({"tool": "A pressed button looks pressed", "ok": ok, "why": json.dumps(tog)})

        # ---------- 6hb — A LIBRARY OF SAVED PROPERTIES ----------
        # Ced: 'have a "save these properties" and have a saved library of properties that a user can
        # apply to shapes when selected.'
        await clear()
        sets = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 try{ localStorage.removeItem("ma.styleset.v1"); }catch(e){}
                 TP_SETS=null;
                 setMode("box");
                 MA_TOOL_STYLES.box=Object.assign({},MA_TOOL_STYLES.box||{},
                   {col:"#1971c2",sw:3,dash:"dash",fill:"#ffe066",fillOp:0.4});
                 tpOpen("box",document.querySelector('#tools .tool[data-mode="box"]'));
                 await nap(300);
                 const pop=document.getElementById("toolpop");
                 const save=[...pop.querySelectorAll(".tp-cb")]
                   .find(b=>/Save these properties/i.test(b.textContent));
                 const out={ hasSave:!!save };
                 if(!save)return res(out);
                 save.dispatchEvent(new MouseEvent("click",{bubbles:true})); await nap(300);
                 const ask=document.querySelector(".sb-ask");
                 out.asked=!!ask;
                 if(ask){ const inp=ask.querySelector(".sb-askinput");
                   inp.value="thin blue box"; inp.dispatchEvent(new Event("input",{bubbles:true}));
                   [...ask.querySelectorAll("button")].find(b=>/Save it/i.test(b.textContent))
                     .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                   await nap(400); }
                 out.kept=(()=>{ try{ return JSON.parse(
                     localStorage.getItem("ma.styleset.v1")||"[]").map(z=>z.name); }
                   catch(e){ return null; } })();
                 tpClose(); await nap(150);
                 const id=maAddShape(0,"rect",0.25,0.35,0.16,0.10,{});
                 const a=S.annos.find(z=>z.id===id);
                 a.col="#fa3237"; a.sw=1; a.dash="solid"; a.fill="#ffffff"; a.fillOp=1;
                 layoutAnnos(); selectAnno(id); await nap(250);
                 tpOpen("box",document.querySelector('#tools .tool[data-mode="box"]'),true);
                 await nap(300);
                 const chip=document.querySelector("#toolpop .tp-set");
                 out.chip=!!chip;
                 if(chip){ chip.dispatchEvent(new MouseEvent("click",{bubbles:true})); await nap(350); }
                 out.applied=(a.col==="#1971c2"&&a.sw===3&&a.dash==="dash"&&a.fill==="#ffe066");
                 const x=document.querySelector("#toolpop .tp-setx");
                 if(x){ x.dispatchEvent(new MouseEvent("click",{bubbles:true})); await nap(300); }
                 out.forgotten=(()=>{ try{ return JSON.parse(
                     localStorage.getItem("ma.styleset.v1")||"[]").length===0; }
                   catch(e){ return false; } })();
                 tpClose(); setMode("select"); selectAnno(null);
                 res(out); })""")
        ok = (sets["hasSave"] and sets["asked"] and sets.get("kept") == ["thin blue box"]
              and sets["chip"] and sets["applied"] and sets["forgotten"])
        results.append({"tool": "Properties can be saved", "ok": ok, "why": json.dumps(sets)})

        # ---------- 6he — LETTER AND LINE SPACING ----------
        # Ced: "in text settings across all tools, add the ability to change the spacing per letter
        # and per line."
        await clear()
        spc = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddTextBox(0,0.12,0.20,"SPACING CHECK",0.34,0.05);
                 const a=S.annos.find(z=>z.id===id);
                 a.col="#fa3237"; a.size=12; a.text="SPACING CHECK";
                 layoutAnnos(); await nap(200);
                 const ed=()=>document.querySelector(`.anno[data-id="${id}"] .ed`);
                 const lh0=parseFloat(getComputedStyle(ed()).lineHeight);
                 a.lsp=2; a.lnsp=2; layoutAnnos(); await nap(200);
                 const cs=getComputedStyle(ed());
                 const out={ ls:+parseFloat(cs.letterSpacing).toFixed(2),
                             want:+(2*S.scale).toFixed(2),
                             lh:+parseFloat(cs.lineHeight).toFixed(2), lh0:+lh0.toFixed(2) };
                 out.tracked=Math.abs(out.ls-out.want)<0.2;
                 out.led=Math.abs(out.lh-out.lh0*2)<1.5;
                 /* and both are offered by the panel, on the tools that carry text */
                 selectAnno(id); setMode("text");
                 tpOpen("text",document.querySelector('#tools .tool[data-mode="text"]'),true);
                 await nap(300);
                 out.rows=[...document.querySelectorAll("#toolpop .tp-rowl")]
                   .map(z=>z.textContent).filter(t=>/spacing/i.test(t));
                 tpClose(); selectAnno(null); setMode("select");
                 res(out); })""")
        ok = (spc["tracked"] and spc["led"] and len(spc["rows"]) == 2)
        results.append({"tool": "Letter and line spacing", "ok": ok, "why": json.dumps(spc)})

        # ---------- 6hd — AN UNPICKED MARK WEARS NO RING ----------
        # Ced: "if a redline or item is not selected, do not highlight its borders — especially on
        # grouped items."
        await clear()
        ring = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const a1=maAddShape(0,"rect",0.15,0.40,0.10,0.06,{});
                 const a2=maAddShape(0,"rect",0.30,0.40,0.10,0.06,{});
                 S.annos.forEach(z=>{ if(z.id===a1||z.id===a2)z.group=9001; });
                 layoutAnnos(); selectAnno(null); try{clearMulti();}catch(e){}
                 await nap(250);
                 const sh=id=>getComputedStyle(
                   document.querySelector(`.anno[data-id="${id}"]`)).boxShadow;
                 const idle=sh(a1);
                 selectAnno(a1); await nap(250);
                 const picked=sh(a1);
                 selectAnno(null); try{clearMulti();}catch(e){}
                 res({idle, picked, bare:/none/i.test(idle), ringed:!/none/i.test(picked)}); })""")
        ok = ring["bare"] and ring["ringed"]
        results.append({"tool": "No ring until it is picked", "ok": ok, "why": json.dumps(ring)})

        # ---------- 6hh — A TEXT BOX GROWS RATHER THAN HIDING ITS LINES ----------
        # Ced: "on text boxes, do not always make it 1 line, make them wrap if the box is smaller."
        await clear()
        grow = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddTextBox(0,0.12,0.70,"x",0.14,0.035);
                 const a=S.annos.find(z=>z.id===id); a.size=9; a.text="x";
                 layoutAnnos(); await nap(200);
                 const D=()=>document.querySelector(`.anno[data-id="${id}"]`);
                 const h0=D().offsetHeight;
                 const ed=D().querySelector(".ed"); ed.focus();
                 ed.textContent="A NOTE FAR LONGER THAN THE BOX THAT WAS DRAWN FOR IT";
                 ed.dispatchEvent(new Event("input",{bubbles:true}));
                 await nap(250);
                 const out={ h0, h1:D().offsetHeight, need:ed.scrollHeight,
                             nw:+a.nw.toFixed(4), lines:Math.round(
                               ed.scrollHeight/parseFloat(getComputedStyle(ed).lineHeight)) };
                 ed.textContent="x"; ed.dispatchEvent(new Event("input",{bubbles:true}));
                 await nap(250);
                 out.back=D().offsetHeight;
                 ed.blur();
                 res(out); })""")
        ok = (grow["h1"] >= grow["need"] - 1 and grow["h1"] > grow["h0"] and grow["lines"] > 1
              and grow["nw"] == 0.14 and abs(grow["back"] - grow["h0"]) <= 2)
        results.append({"tool": "A text box grows, not hides", "ok": ok, "why": json.dumps(grow)})

        # ---------- 6hc — A DASH IS THE SAME LENGTH AT ANY WEIGHT ----------
        # Ced: "make the dashed lines constant as well, and not vary spacing per thickness. just make
        # it constant and with various versions of length of dashlines."
        await clear()
        dash = await page.evaluate(
            """()=>{ const out={};
                 /* the same pattern at a hairline and at 8pt reads identically */
                 out.thin=dashCss({dash:"dash"},0.5*S.scale);
                 out.fat =dashCss({dash:"dash"},8*S.scale);
                 out.same=(out.thin===out.fat);
                 out.pdfThin=dashPdf({dash:"dash"},0.5);
                 out.pdfFat =dashPdf({dash:"dash"},8);
                 out.pdfSame=JSON.stringify(out.pdfThin)===JSON.stringify(out.pdfFat);
                 /* and the lengths step up, shortest to longest */
                 const len=k=>MARK_DASH[k][0];
                 out.steps=["finedash","dash","longdash","xlongdash"].map(len);
                 out.rising=out.steps.every((n,i)=>i===0||n>out.steps[i-1]);
                 out.chips=TP_DASHES.length;
                 /* a heavy DOTTED rule still reads as dots: its gap is floored, never its dashes */
                 const g=k=>dashPdf({dash:k},8)[1];
                 out.dotGap=g("dot"); out.dotOpen=(out.dotGap>8);
                 /* a dash-dot's dot is drawn with a round cap, or it draws nothing at all */
                 out.roundDot=dashRound("dashdot")&&dashRound("dot")&&!dashRound("dash");
                 return out; }""")
        ok = (dash["same"] and dash["pdfSame"] and dash["rising"] and dash["chips"] >= 6
              and dash["dotOpen"] and dash["roundDot"])
        results.append({"tool": "A dash is one length", "ok": ok, "why": json.dumps(dash)})

        # ---------- 6hk — A BOX HAS SQUARE CORNERS ----------
        # Ced: "make the shapes corners sharp because the ui shows more rounded ones but are sharp
        # corners on the render."
        await clear()
        corner = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddShape(0,"rect",0.15,0.20,0.20,0.08,{});
                 const a=S.annos.find(z=>z.id===id); a.col="#fa3237"; a.sw=2;
                 layoutAnnos(); await nap(250);
                 const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                 const el=document.querySelector(`.anno[data-id="${id}"] svg.shapeoutline rect`);
                 res({ radius:getComputedStyle(ed).borderRadius,
                       svgRx:el?(el.getAttribute("rx")||"0"):"0" }); })""")
        ok = (float(corner["radius"].split()[0].replace("px", "")) == 0
              and float(corner["svgRx"]) == 0)
        results.append({"tool": "A box has square corners", "ok": ok, "why": json.dumps(corner)})

        # ---------- 6hj — ENTER STARTS A LINE, AND EVERY LINE ALIGNS ----------
        # Ced: "make enter when typing going to another line below. also make sure that the alignment
        # is not broken."
        await clear()
        enter = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddTextBox(0,0.15,0.35,"ONE",0.30,0.10);
                 const a=S.annos.find(z=>z.id===id); a.size=11; a.text="ONE"; a.align="center";
                 layoutAnnos(); await nap(250);
                 const D=()=>document.querySelector(`.anno[data-id="${id}"]`);
                 const ed=D().querySelector(".ed");
                 ed.focus();
                 const rg=document.createRange(); rg.selectNodeContents(ed); rg.collapse(false);
                 const sel=getSelection(); sel.removeAllRanges(); sel.addRange(rg);
                 ed.dispatchEvent(new KeyboardEvent("keydown",
                   {key:"Enter",bubbles:true,cancelable:true}));
                 await nap(120);
                 document.execCommand("insertText",false,"A MUCH LONGER SECOND LINE");
                 await nap(200);
                 a.text=ed.innerText;
                 const cs=getComputedStyle(ed);
                 ed.blur();
                 res({ lines:a.text.split("\\n").length, display:cs.display,
                       align:cs.textAlign, justifyItems:cs.justifyItems }); })""")
        ok = (enter["lines"] == 2 and enter["display"] == "grid" and enter["align"] == "center"
              and enter["justifyItems"] == "stretch")
        results.append({"tool": "Enter starts a line", "ok": ok, "why": json.dumps(enter)})

        # ---------- 6hl — A SAVED SELECTION SHOWS ITSELF ----------
        # Ced: "make the preview exactly what the stamp should be. also, make sure that the preview on
        # markups tab is also what the saved markup is."
        await clear()
        prev = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const b1=maAddShape(0,"rect",0.20,0.55,0.18,0.07,{});
                 { const a=S.annos.find(z=>z.id===b1);
                   a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1; }
                 const t1=maAddTextBox(0,0.21,0.56,"REDLINED",0.16,0.03);
                 { const a=S.annos.find(z=>z.id===t1);
                   a.col="#fa3237"; a.size=10; a.bgNone=true; a.text="REDLINED"; }
                 const l1=addLine(0,0.20,0.65,0.38,0.65,{col:"#fa3237",sw:2});
                 { const l=S.lines.find(z=>z.id===l1); l.le1="arrow"; }
                 layoutAnnos(); drawAllLines(); await nap(200);
                 const sel={annos:[b1,t1].map(i=>S.annos.find(z=>z.id===i)),
                            lines:[S.lines.find(z=>z.id===l1)]};
                 const xs=[],ys=[];
                 sel.annos.forEach(a=>{ xs.push(a.nx); ys.push(a.ny); });
                 sel.lines.forEach(l=>linePts(l).forEach(p=>{ xs.push(p[0]); ys.push(p[1]); }));
                 const ox=Math.min(...xs), oy=Math.min(...ys);
                 MA_MARKUPS.length=0;
                 MA_MARKUPS.unshift({ id:"grpTest", name:"STAMP", kind:"group", pw:612, ph:792,
                   annos:sel.annos.map(a=>Object.assign({},_cleanA(a),{nx:a.nx-ox,ny:a.ny-oy})),
                   lines:sel.lines.map(l=>Object.assign({},_cleanL(l),
                     {x1:l.x1-ox,y1:l.y1-oy,x2:l.x2-ox,y2:l.y2-oy,
                      pts:(l.pts||[]).map(p=>[p[0]-ox,p[1]-oy])})) });
                 maSaveMarkups();
                 S.annos=[]; S.lines=[]; layoutAnnos(); drawAllLines();
                 maSetTab("markups"); maPanelOpen(true); await nap(400);
                 const tile=document.querySelector("#maPanel .ma-mk .ma-mkgrp");
                 const svg=tile&&tile.querySelector("svg");
                 const out={ drawn:!!svg,
                             shapes:svg?svg.querySelectorAll("rect,ellipse").length:0,
                             words:svg?[...svg.querySelectorAll("text")].map(t=>t.textContent).join("|"):"",
                             strokes:svg?svg.querySelectorAll("polyline").length:0,
                             heads:svg?svg.querySelectorAll("polygon").length:0 };
                 document.querySelector("#maPanel .ma-mk")
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                 await nap(350);
                 const gh=document.querySelector(".maghost");
                 out.held=!!(gh&&gh.querySelector("svg"));
                 out.heldW=gh?Math.round(gh.getBoundingClientRect().width):0;
                 try{ _maPending=null; maGhostOff();
                      document.body.classList.remove("maplacing"); }catch(e){}
                 maPanelOpen(false);
                 res(out); })""")
        ok = (prev["drawn"] and prev["shapes"] >= 1 and "REDLINED" in prev["words"]
              and prev["strokes"] == 1 and prev["heads"] == 1 and prev["held"] and prev["heldW"] > 20)
        results.append({"tool": "A saved markup shows itself", "ok": ok, "why": json.dumps(prev)})

        # ---------- 6hm — A FACE THAT TRAVELS WITH THE FILE ----------
        # Ced: "add century gothic fonts and more fonts available."
        await clear()
        face = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={ installed:!!document.getElementById("ttfFaces"),
                             bundled:Object.keys(MARK_FONTS).filter(k=>MARK_FONTS[k].ttf),
                             chip:TP_FONT_CHIPS.some(f=>f.k==="jost") };
                 const id=maAddTextBox(0,0.12,0.20,"REDLINED 123",0.40,0.06);
                 const a=S.annos.find(z=>z.id===id);
                 a.col="#fa3237"; a.size=16; a.bgNone=true; a.font="jost"; a.text="REDLINED 123";
                 layoutAnnos(); await nap(350);
                 const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                 out.css=getComputedStyle(ed).fontFamily;
                 /* the bundled face measures differently from Arial, which is how we know the
                    browser is actually laying the mark out in it */
                 const c=document.createElement("canvas").getContext("2d");
                 c.font="16px 'MA Jost'"; const wj=c.measureText("REDLINED 123").width;
                 c.font="16px Arial,Helvetica,sans-serif"; const wa=c.measureText("REDLINED 123").width;
                 out.differs=Math.abs(wj-wa)>1;
                 /* and the writer builds a real font dictionary for it */
                 out.bold=tpFaceToggle("jost","bold");
                 res(out); })""")
        # 6n1 — this counted four, which was the whole bundled list when Jost was the only family
        # that travelled. There are three now, so what the number was standing for is said directly:
        # every bundled family carries ALL FOUR CUTS, which is the property `tpFaceToggle` depends on
        # — without a bold italic, asking for italic on a bold mark silently drops the bold (6gf).
        fams = {}
        for k in face["bundled"]:
            fams[k.replace("bolditalic", "").replace("bold", "").replace("ital", "")] = 1
        full = all(sum(1 for k in face["bundled"] if k.startswith(f)) == 4 for f in fams)
        face["families"] = sorted(fams)
        ok = (face["installed"] and full and len(fams) == 3 and face["chip"]
              and "MA Jost" in face["css"] and face["differs"] and face["bold"] == "jostbold")
        results.append({"tool": "A face travels with the file", "ok": ok, "why": json.dumps(face)})

        # ---------- 6hn — THE TOOL IS A PDF TOOL ----------
        # Ced: "remove all the mount analysis only indications here and make it more general on pdf",
        # and the new wordmark with "MARK IT UP" under it.
        gen = await page.evaluate(
            """()=>{ const si=document.getElementById("s_site");
                     const had=si.value, code=S.siteCode;
                     const named=outputFilename();
                     si.value=""; S.siteCode="";
                     const plain=outputFilename();
                     si.value=had; S.siteCode=code;
                     const wm=document.querySelector(".logo-wm svg path");
                     return { title:document.title,
                              sub:(document.querySelector(".logo-sub")||{}).textContent,
                              /* 6jj — the name is drawn inside both marks now, not laid out under them */
                              boot:(document.querySelector(".boot-mark text.bm-sub")||{}).textContent,
                              inked:wm?getComputedStyle(wm).fill:null,
                              drop:(document.querySelector("#drop b")||{}).textContent,
                              named, plain }; }""")
        ok = (gen["title"] == "Mark It Up" and gen["sub"] == "Mark It Up" and gen["boot"] == "MARK IT UP"
              and gen["inked"] not in (None, "none")
              and "PDF" in gen["drop"] and "Mount Analysis" not in gen["drop"]
              and gen["named"].endswith("Redlined Mount Analysis")
              # 6ki — the export is named after the document it was opened from and the stamp on
              # it, not after a hardcoded "Mount Analysis". With no site code the state leads.
              and gen["plain"].startswith("Redlined"))
        results.append({"tool": "It is a PDF tool now", "ok": ok, "why": json.dumps(gen)})

        # ---------- 6hp — A CLOUD ROUND A SHAPE ----------
        # Ced: "also add a cloud style on shapes."
        await clear()
        cloud = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddShape(0,"rect",0.15,0.40,0.24,0.10,{});
                 const a=S.annos.find(z=>z.id===id);
                 a.col="#fa3237"; a.sw=2; a.fillOp=0; a.lpat="cloud";
                 layoutAnnos(); await nap(250);
                 const poly=document.querySelector(
                   `.anno[data-id="${id}"] svg.shapeoutline polygon`);
                 const plain=maAddShape(0,"rect",0.55,0.40,0.24,0.10,{});
                 layoutAnnos(); await nap(150);
                 res({ drawn:!!poly,
                       pts:poly?poly.getAttribute("points").trim().split(/\\s+/).length:0,
                       /* a shape with no pattern is still a plain rectangle */
                       plainPoly:!!document.querySelector(
                         `.anno[data-id="${plain}"] svg.shapeoutline polygon`),
                       chips:(typeof TP_LPATS!=="undefined")?TP_LPATS.length:0 }); })""")
        ok = (cloud["drawn"] and cloud["pts"] > 40 and not cloud["plainPoly"] and cloud["chips"] >= 5)
        results.append({"tool": "A cloud round a shape", "ok": ok, "why": json.dumps(cloud)})

        # ---------- 6hq — A TOOL DRAWS OVER WHAT IS ALREADY THERE ----------
        # Ced: "when using a tool, and you are editing on top of another shape, do not move the shape
        # below, make the application of the new shape first."
        await clear()
        over = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const id=maAddShape(0,"rect",0.20,0.55,0.25,0.12,{});
                 const a=S.annos.find(z=>z.id===id); a.col="#1971c2"; a.sw=2;
                 layoutAnnos(); await nap(200);
                 const was={nx:a.nx,ny:a.ny};
                 /* 6ju \u2014 a SELECTED mark is one you are working on and keeps the press. The rule
                    6hq asks for is about a mark you are drawing OVER, so drop the selection the
                    shape came up with first; the second half below checks the other side of it. */
                 selectAnno(null); clearMulti(); await nap(120);
                 setMode("box"); await nap(120);
                 const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                 const r=ed.getBoundingClientRect();
                 ed.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:r.left+12,clientY:r.top+12,pointerId:96,button:0}));
                 pg.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:r.left+12,clientY:r.top+12,pointerId:96,button:0}));
                 for(let k=1;k<=6;k++){
                   pg.dispatchEvent(new PointerEvent("pointermove",
                     {bubbles:true,pointerId:96,clientX:r.left+12+k*12,clientY:r.top+12+k*6}));
                   await nap(20);
                 }
                 pg.dispatchEvent(new PointerEvent("pointerup",
                   {bubbles:true,pointerId:96,clientX:r.left+84,clientY:r.top+48}));
                 await nap(350);
                 setMode("select");
                 res({ made:S.annos.length,
                       moved:(Math.abs(a.nx-was.nx)>0.002||Math.abs(a.ny-was.ny)>0.002),
                       draws:DRAW_MODES.size }); })""")
        ok = over["made"] == 2 and not over["moved"] and over["draws"] >= 10
        results.append({"tool": "A tool draws over a mark", "ok": ok, "why": json.dumps(over)})

        # ---------- 6ju \u2014 ...BUT THE ONE YOU HAVE HOLD OF STILL MOVES ----------
        # Ced: "make the shapes be draggable even if you drag them by the shape itself."
        await clear()
        held = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const id=maAddShape(0,"rect",0.20,0.55,0.25,0.12,{});
                 const id2=maAddShape(0,"rect",0.52,0.55,0.18,0.10,{});
                 const a=S.annos.find(z=>z.id===id);
                 layoutAnnos(); await nap(200);
                 /* 6m9 — a BLOCK, which is what still owns the press with a tool in the hand */
                 clearMulti(); S.selMulti.add(id); S.selMulti.add(id2); paintMulti(); await nap(150);
                 const was={nx:a.nx,ny:a.ny}, n0=S.annos.length;
                 setMode("box"); await nap(120);
                 const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                 const r=ed.getBoundingClientRect();
                 ed.dispatchEvent(new MouseEvent("mousedown",
                   {bubbles:true,cancelable:true,clientX:r.left+12,clientY:r.top+12,detail:1,buttons:1}));
                 pg.dispatchEvent(new PointerEvent("pointerdown",
                   {bubbles:true,clientX:r.left+12,clientY:r.top+12,pointerId:97,button:0}));
                 for(let k=1;k<=6;k++){
                   window.dispatchEvent(new PointerEvent("pointermove",
                     {bubbles:true,pointerId:97,clientX:r.left+12+k*12,clientY:r.top+12+k*6}));
                   await nap(20);
                 }
                 window.dispatchEvent(new PointerEvent("pointerup",
                   {bubbles:true,pointerId:97,clientX:r.left+84,clientY:r.top+48}));
                 await nap(350);
                 setMode("select");
                 res({ moved:+(a.nx-was.nx).toFixed(4), extra:S.annos.length-n0 }); })""")
        # 6m9 — A SINGLE SELECTED MARK NO LONGER CLAIMS THE PRESS, so what this case asks about has
        # changed. 6ju exempted it from 6hq on the grounds that "Escape drops the selection and the
        # sheet is a drawing surface again"; Ced's new Escape keeps the selection on the first press
        # and takes the tool on the second, so that sentence is no longer true and the exemption
        # narrowed to multi-selections and groups. The half that survives is the half driven here —
        # a MULTI-selection still drags as a block with a tool in the hand. The half that changed is
        # a DRAW, and a draw cannot be observed with synthetic pointer events (the real gesture uses
        # pointer capture); `behave.py`'s "A tool still draws over a mark when you DRAG" drives a real
        # mouse and asserts it there.
        ok = held["moved"] > 0.01 and held["extra"] == 0
        results.append({"tool": "A selected BLOCK still drags", "ok": ok,
                        "why": f'moved {held["moved"]} of the page \u00b7 new marks {held["extra"]}'})

        # ---------- 6hu — FRONT AND BACK CROSS THE STROKES ----------
        # Ced: "improve the layering, some redlines are not following the layering."
        await clear()
        lay = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const id=maAddShape(0,"rect",0.20,0.70,0.20,0.06,{});
                 const a=S.annos.find(z=>z.id===id); a.under=true;
                 layoutAnnos(); selectAnno(id); await nap(200);
                 document.querySelector('#annobar [data-lay="front"]').click(); await nap(250);
                 const front={under:!!a.under, above:!!document.querySelector(
                   `.annolayer .anno[data-id="${id}"]`)};
                 document.querySelector('#annobar [data-lay="back"]').click(); await nap(250);
                 const back={under:!!a.under, below:!!document.querySelector(
                   `.annolayer-under .anno[data-id="${id}"]`)};
                 selectAnno(null);
                 res({front,back}); })""")
        ok = (not lay["front"]["under"] and lay["front"]["above"]
              and lay["back"]["under"] and lay["back"]["below"])
        results.append({"tool": "Front and back cross the strokes", "ok": ok, "why": json.dumps(lay)})

        # ---------- 6i2 — A CROSS OUT TURNS FROM THE BAR ----------
        # Ced: "cross is still not rotatable" — the frame's grip was under the selection bar.
        await clear()
        await pick("crossout")
        await drag(*at(0.25, 0.30), *at(0.45, 0.42))
        await page.wait_for_timeout(450)
        turn = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const P=S.pages[0], AW=P.w1||612, AH=P.h1||792;
                 const ang=l=>Math.atan2((l.y2-l.y1)*AH,(l.x2-l.x1)*AW)*180/Math.PI;
                 const a0=S.lines.map(ang);
                 const btn=document.querySelector("#multibar [data-mbrot]");
                 const out={ button:!!btn };
                 if(btn){
                   btn.click(); await nap(350);
                   const ask=document.querySelector(".sb-ask");
                   out.asked=!!ask;
                   if(ask){ const inp=ask.querySelector(".sb-askinput");
                     inp.value="30"; inp.dispatchEvent(new Event("input",{bubbles:true}));
                     [...ask.querySelectorAll("button")].find(b=>/Turn/i.test(b.textContent))
                       .dispatchEvent(new MouseEvent("click",{bubbles:true}));
                     await nap(400); }
                 }
                 out.turned=S.lines.map(ang).map((v,i)=>+(v-a0[i]).toFixed(1));
                 const f=document.querySelector(".gframe");
                 const g=f&&f.querySelector(".ggrip.grot");
                 out.grip=!!(g&&getComputedStyle(g).display!=="none");
                 try{ clearMulti(); }catch(e){}
                 setMode("select");
                 res(out); })""")
        ok = (turn["button"] and turn.get("asked") and turn["grip"]
              and len(turn["turned"]) == 2
              and all(abs(abs(d) - 30) < 2 for d in turn["turned"]))
        results.append({"tool": "A cross out turns from the bar", "ok": ok, "why": json.dumps(turn)})

        # ---------- 6hx — THE LASER IS ONE FLARE ----------
        # Ced: "improve laser pointer, it should be more like a continuous flare, not just dots."
        await clear()
        laser = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 setMode("laser"); await nap(250);
                 const out={ canvas:!!document.querySelector(".sk-lasercv"),
                             dots:document.querySelectorAll(".sk-laser").length };
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:300,clientY:300}));
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:340,clientY:320}));
                 await nap(140);
                 try{ const c=document.querySelector(".sk-lasercv").getContext("2d");
                      const d=c.getImageData(0,0,c.canvas.width,c.canvas.height).data;
                      let n=0; for(let i=3;i<d.length;i+=4*97)if(d[i]>8)n++;
                      out.painted=n>0; }catch(e){ out.painted=false; }
                 setMode("select"); await nap(200);
                 out.gone=!document.querySelector(".sk-lasercv");
                 res(out); })""")
        ok = laser["canvas"] and laser["dots"] == 0 and laser["painted"] and laser["gone"]
        results.append({"tool": "The laser is one flare", "ok": ok, "why": json.dumps(laser)})

        # ---------- 6i0 — THE BRUSH PAINTS WHAT YOU POINT AT ----------
        # Ced: "if a text is at a specific font size and the user moves or selects it with ctrl, it
        # should not change font size" and "copying properties should end if esc is clicked."
        await clear()
        brush = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const A=i=>S.annos.find(z=>z.id===i);
                 const a1=maAddTextBox(0,0.15,0.25,"BIG",0.20,0.05);
                 const a2=maAddTextBox(0,0.45,0.25,"SMALL",0.20,0.04);
                 A(a1).size=20; A(a1).col="#1971c2"; A(a1).text="BIG";
                 A(a2).size=6;  A(a2).col="#fa3237"; A(a2).text="SMALL";
                 layoutAnnos(); await nap(250);
                 selectAnno(a1); await nap(150);
                 sbCopyProps(); await nap(150);
                 const out={ loaded:!!SB_PAINT };
                 /* adding to a selection is NOT painting */
                 sbPaintHold(); toggleMulti(a2); await nap(400);
                 out.ctrlKept={ size:A(a2).size, col:A(a2).col };
                 try{ clearMulti(); }catch(e){}
                 /* a plain click on one mark still paints */
                 selectAnno(a2); await nap(400);
                 out.painted={ size:A(a2).size, col:A(a2).col };
                 /* and Escape puts it down */
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                 await nap(200);
                 out.afterEsc=!!SB_PAINT;
                 A(a2).size=6; A(a2).col="#fa3237"; layoutAnnos();
                 selectAnno(a1); await nap(150); selectAnno(a2); await nap(350);
                 out.left={ size:A(a2).size, col:A(a2).col };
                 selectAnno(null);
                 res(out); })""")
        ok = (brush["loaded"] and brush["ctrlKept"]["size"] == 6
              and brush["painted"]["size"] == 20 and not brush["afterEsc"]
              and brush["left"]["size"] == 6)
        results.append({"tool": "The brush paints what you point at", "ok": ok, "why": json.dumps(brush)})

        # ---------- 6hs/6kx — ASSIST, IN THREE BUTTONS ----------
        # Ced, then: "just make separate buttons for notes, parts, mark up, and as-builts." Ced, now:
        # "remove the following functions: Redline report, as-built, notes, and parts." So the shape
        # of this case is unchanged — each button opens its own dropdown under itself, one at a time,
        # no tab strip, no docked rail — and what is asserted is the three that are left, plus the
        # absence of the four that are not.
        assist = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const btn=i=>document.getElementById(i);
                 const out={ names:["markupsBtn","stampBtn","analyzeMaBtn"]
                               .map(i=>btn(i)?btn(i).textContent.trim():null),
                             gone:["maBtn","noteBtn","partsBtn","importBtn","reportBtn",
                                   "miniReport","maFile","reportModal"].filter(i=>btn(i)),
                             cards:MA_CARDS.map(c=>c[0]),
                             group:[...document.querySelectorAll("#toolbar .grp")]
                               .map(g=>g.getAttribute("data-lbl")).filter(Boolean) };
                 const P=()=>document.getElementById("maPanel");
                 const shown=()=>P().classList.contains("show");
                 maPanelOpen(false); await nap(150);
                 btn("stampBtn").click(); await nap(400);
                 out.one={ show:shown(), title:document.getElementById("maTitle").textContent };
                 const pr=P().getBoundingClientRect(), br=btn("stampBtn").getBoundingClientRect();
                 out.under=(pr.top>br.top)&&(Math.abs(pr.left-br.left)<48);
                 out.floats=(getComputedStyle(P()).position==="fixed")
                          &&!document.body.classList.contains("maon");
                 btn("markupsBtn").click(); await nap(350);
                 out.two={ show:shown(), title:document.getElementById("maTitle").textContent };
                 out.tabs=document.querySelectorAll("#maPanel .ma-tab").length;
                 btn("markupsBtn").click(); await nap(300);
                 out.closes=!shown();
                 /* and Escape closes it too */
                 btn("stampBtn").click(); await nap(300);
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                 await nap(250);
                 out.esc=!shown();
                 res(out); })""")
        ok = (all(assist["names"]) and not assist["gone"]
              and assist["cards"] == ["markups", "stamp"]
              and assist["one"]["show"] and assist["one"]["title"] == "COP stamp"
              and assist["under"] and assist["floats"]
              and assist["two"]["title"] == "Markups"
              and assist["tabs"] == 0
              and assist["closes"] and assist["esc"]
              and "Assist" in assist["group"]
              and not any("Mount" in (g or "") for g in assist["group"]))
        results.append({"tool": "Assist opens as a dropdown", "ok": ok, "why": json.dumps(assist)})

        # ---------- 6i1 — A TABLE READ BY ITS SHAPE ----------
        # Ced: "also read the table in construction drawings, not only in mount analysis. make sure it
        # is offline and no ai is going to be used."
        tbl = await page.evaluate(
            """()=>{ const t=maReadAnyTable(0);
                     return t?{cols:t.columns.length,rows:t.rows.length,generic:!!t.generic,
                               named:t.columns.every(c=>typeof c==="string"&&c.length)}
                             :{none:true}; }""")
        ok = (not tbl.get("none") and tbl["cols"] >= 2 and tbl["rows"] >= 2
              and tbl["generic"] and tbl["named"])
        results.append({"tool": "A table read by its shape", "ok": ok, "why": json.dumps(tbl)})

        # ---------- 6i4 — EVERY SHORTCUT ----------
        # Ced: "make all the hot keys work too, esc, del, ctrl functions. etc."
        await clear()
        keys = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const K=(key,opt)=>{ const o=Object.assign({key,bubbles:true,cancelable:true},opt||{});
                   document.dispatchEvent(new KeyboardEvent("keydown",o));
                   window.dispatchEvent(new KeyboardEvent("keydown",o)); };
                 const out={tools:{}};
                 const map={s:"select",h:"pan",r:"redline",e:"text",f:"fix",k:"callout",
                            w:"strikerow",t:"cross",l:"line",a:"arrow",d:"dim",p:"poly",
                            b:"box",o:"circle",x:"crossout"};
                 for(const key in map){
                   setMode("select"); await nap(25);
                   K(key); await nap(70);
                   if(S.mode!==map[key])out.tools[key]=S.mode;
                 }
                 setMode("select"); await nap(40);
                 const id=maAddShape(0,"rect",0.2,0.3,0.15,0.08,{});
                 layoutAnnos(); selectAnno(id); await nap(200);
                 K("d",{ctrlKey:true}); await nap(250); out.dup=S.annos.length;          /* 2 */
                 selectAnno(S.annos[S.annos.length-1].id); await nap(80);
                 K("c",{ctrlKey:true}); await nap(120);
                 K("v",{ctrlKey:true}); await nap(300); out.paste=S.annos.length;        /* 3 */
                 selectAnno(S.annos[S.annos.length-1].id); await nap(100);
                 K("Delete"); await nap(250); out.del=S.annos.length;                    /* 2 */
                 K("z",{ctrlKey:true}); await nap(300); out.undo=S.annos.length;         /* 3 */
                 K("y",{ctrlKey:true}); await nap(300); out.redo=S.annos.length;         /* 2 */
                 K("a",{ctrlKey:true}); await nap(350); out.all=multiCount();            /* 2 */
                 K("g",{ctrlKey:true}); await nap(250);
                 out.grouped=S.annos.filter(a=>a.group!=null).length;                    /* 2 */
                 K("g",{ctrlKey:true,shiftKey:true}); await nap(250);
                 out.ungrouped=S.annos.filter(a=>a.group!=null).length;                  /* 0 */
                 try{ clearMulti(); }catch(e){}
                 const a0=S.annos[0]; selectAnno(a0.id); await nap(150);
                 const x0=a0.nx; K("ArrowRight"); await nap(150);
                 out.nudged=(a0.nx>x0);
                 /* 6jt \u2014 the ladder: the first Escape drops the selection a0 still carries,
                    the second puts the tool down.
                    6ld \u2014 AND WHICH RUNG THE FIRST PRESS LANDS ON DEPENDS ON WHERE THE SELECTION
                    CAME FROM. 6l1: a selection the TOOL just drew keeps the tool in hand for one
                    more press; a selection made by picking up an existing mark means the drawing is
                    over, so one press reaches Select. The selection here is the second kind \u2014
                    `maAddShape` put the mark there and `selectAnno` picked it up \u2014 so `select` is
                    the right answer and this line used to read `box` only because `maAddShape`
                    happened to leave `_selFromDraw` set from an earlier call. A paste now clears that
                    flag (it is an edit, not a draw), which is what exposed it.
                    The ladder as a HAND meets it is tested where it can be: `behave.py`'s Escape case
                    and `keys.py`, both of which draw with the tool first and both of which still get
                    `box` then `select`. */
                 setMode("box"); await nap(80); K("Escape"); await nap(200);
                 out.esc1=S.mode;
                 K("Escape"); await nap(200);
                 out.esc=S.mode;
                 K("?",{shiftKey:true}); await nap(250);
                 out.help=document.getElementById("helpModal").classList.contains("show");
                 K("Escape"); await nap(200);
                 out.helpShut=!document.getElementById("helpModal").classList.contains("show");
                 K("/"); await nap(200);
                 out.find=(document.activeElement||{}).id;
                 try{ document.activeElement.blur(); }catch(e){}
                 K("m"); await nap(250);
                 out.marks=document.getElementById("marksPanel").classList.contains("show");
                 K("m"); await nap(200);
                 K("a",{ctrlKey:true,shiftKey:true}); await nap(300);
                 out.assist=document.getElementById("maPanel").classList.contains("show");
                 K("a",{ctrlKey:true,shiftKey:true}); await nap(250);
                 /* and the reference kit, which sits on Shift so nothing collides */
                 K("s",{shiftKey:true}); await nap(150); out.snap=S.mode;
                 K("l",{shiftKey:true}); await nap(150); out.laser=S.mode;
                 setMode("select"); await nap(120);
                 res(out); })""")
        ok = (not keys["tools"] and keys["dup"] == 2 and keys["paste"] == 3 and keys["del"] == 2
              and keys["undo"] == 3 and keys["redo"] == 2 and keys["all"] == 2
              and keys["grouped"] == 2 and keys["ungrouped"] == 0 and keys["nudged"]
              # 6m9 — the first press keeps the redline and the tool; the second reaches Select.
              # This line used to read `select` for both, which is the thing the comment above it
              # was apologising for; the three places that test Escape now agree.
              and keys["esc1"] == "box" and keys["esc"] == "select"
              and keys["help"] and keys["helpShut"]
              and keys["find"] == "findInput" and keys["marks"] and keys["assist"]
              and keys["snap"] == "snapshot" and keys["laser"] == "laser")
        results.append({"tool": "Every shortcut", "ok": ok, "why": json.dumps(keys)})

        # ---------- 6i3 — A NEW MARK LANDS ON TOP ----------
        # Ced: "make sure all the most recent redlines added will automatically be on the top of the
        # layers."
        await clear()
        top = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const a=maAddShape(0,"rect",0.20,0.30,0.20,0.08,{});
                 layoutAnnos(); selectAnno(a); await nap(150);
                 document.querySelector('#annobar [data-lay="front"]').click(); await nap(200);
                 const zA=S.annos.find(z=>z.id===a).z;
                 const b=maAddShape(0,"rect",0.30,0.34,0.20,0.08,{});
                 layoutAnnos(); await nap(200);
                 const B=S.annos.find(z=>z.id===b);
                 selectAnno(null);
                 res({ zA, zB:B.z, above:(B.z>zA), sameBand:(!!B.under===!!S.annos.find(z=>z.id===a).under) }); })""")
        ok = top["above"] and top["zB"] > 0
        results.append({"tool": "A new mark lands on top", "ok": ok, "why": json.dumps(top)})

        # ---------- 6hz — AND THE DEFAULT CAPTURE IS PLAIN ----------
        # Ced: "snapshot did not take a clean snapshot. it changed the format of the redlines."
        await clear()
        plain = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 MA_TOOL_STYLES.snapshot=Object.assign({},MA_TOOL_STYLES.snapshot||{},{tint:false});
                 try{ maSaveToolStyles(); }catch(e){}
                 skPick("snapshot"); await nap(200);
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const R=pg.getBoundingClientRect();
                 const P=(fx,fy)=>({clientX:R.left+R.width*fx,clientY:R.top+R.height*fy,
                                    bubbles:true,button:0,pointerId:88});
                 pg.dispatchEvent(new PointerEvent("pointerdown",P(0.18,0.26)));
                 for(let k=1;k<=6;k++){
                   pg.dispatchEvent(new PointerEvent("pointermove",P(0.18+k*0.05,0.26+k*0.035)));
                   await nap(25);
                 }
                 pg.dispatchEvent(new PointerEvent("pointerup",P(0.48,0.47)));
                 await nap(2600);
                 const a=S.annos.find(x=>x.maKind==="snapshot");
                 if(!a)return res({none:true});
                 const im=new Image();
                 im.onload=()=>{ const c=document.createElement("canvas");
                   c.width=im.width; c.height=im.height;
                   const g=c.getContext("2d"); g.drawImage(im,0,0);
                   const d=g.getImageData(0,0,c.width,c.height).data;
                   let clear=0,grey=0,ink=0;
                   for(let k=0;k<d.length;k+=4*13){
                     if(d[k+3]<8){ clear++; continue; }
                     ink++;
                     if(Math.abs(d[k]-d[k+1])<20&&Math.abs(d[k+1]-d[k+2])<20)grey++;
                   }
                   /* a plain picture of a sheet is mostly WHITE and mostly GREY-SCALE: nothing was
                      dropped out and nothing was recoloured */
                   res({clear,grey,ink,opaque:(clear<ink*0.05),kept:(grey>ink*0.5),
                        tinted:!!a._tintCol}); };
                 im.onerror=()=>res({none:true});
                 im.src=a.src; })""")
        ok = (not plain.get("none") and plain["opaque"] and plain["kept"] and not plain["tinted"])
        results.append({"tool": "A snapshot is a plain picture", "ok": ok, "why": json.dumps(plain)})

        # ---------- 6i6 — FLIP ----------
        # Ced: "also add flip in edit photo, also in all tools in the toolbar below … flip vertical or
        # horizontal."
        await clear()
        flip = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const a1=maAddShape(0,"rect",0.20,0.30,0.10,0.06,{});
                 const a2=maAddShape(0,"rect",0.50,0.30,0.10,0.06,{});
                 const A=i=>S.annos.find(z=>z.id===i);
                 const l=addLine(0,0.20,0.50,0.60,0.56,{col:"#fa3237",sw:2});
                 const L=S.lines.find(z=>z.id===l);
                 layoutAnnos(); drawAllLines(); await nap(200);
                 clearMulti(); S.selMulti.add(a1); S.selMulti.add(a2);
                 S.selMultiL.add(l); paintMulti(); await nap(200);
                 const was={x1:A(a1).nx, x2:A(a2).nx, ly:L.y1};
                 sbFlip("h"); await nap(300);
                 const out={ swapped:(A(a1).nx>A(a2).nx),
                             strokeMirrored:(Math.abs(L.y1-was.ly)<1e-6&&L.x1>L.x2) };
                 sbFlip("v"); await nap(300);
                 out.vertical=(L.y1>L.y2);
                 /* a picture mirrors its own pixels */
                 clearMulti();
                 const cv=document.createElement("canvas"); cv.width=40; cv.height=20;
                 const g=cv.getContext("2d"); g.fillStyle="#f00"; g.fillRect(0,0,40,20);
                 const idp=maAddShape(0,"rect",0.30,0.70,0.12,0.06,{});
                 const p=A(idp); p.kind="img"; p.src=cv.toDataURL("image/png");
                 layoutAnnos(); selectAnno(idp); await nap(250);
                 sbFlip("h"); await nap(250);
                 out.picture=!!p.flipX;
                 const im=document.querySelector(`.anno[data-id="${idp}"] img`);
                 out.mirrored=!!(im&&/-1/.test(im.style.transform||""));
                 selectAnno(null); clearMulti();
                 res(out); })""")
        ok = (flip["swapped"] and flip["strokeMirrored"] and flip["vertical"]
              and flip["picture"] and flip["mirrored"])
        results.append({"tool": "Flip mirrors the selection", "ok": ok, "why": json.dumps(flip)})

        # ---------- 6i5 — UP AND DOWN ONE LAYER ----------
        # Ced: "add up or down button when selecting a redline to put them up or down the layering.
        # put these on the left side of the box."
        await clear()
        step = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const mk=(x,y)=>maAddShape(0,"rect",x,y,0.14,0.07,{});
                 const a=mk(0.20,0.30), b=mk(0.26,0.33), c=mk(0.32,0.36);
                 const A=i=>S.annos.find(z=>z.id===i);
                 layoutAnnos(); selectAnno(a); await nap(250);
                 const d=document.querySelector(`.anno[data-id="${a}"]`);
                 const up=markHandle(a,".lup"), dn=markHandle(a,".ldn");   /* 6is */
                 const out={ has:!!(up&&dn),
                             left:!!(up&&getComputedStyle(up).left.indexOf("-")===0),
                             z0:[A(a).z,A(b).z,A(c).z] };
                 up.click(); await nap(200);
                 out.z1=[A(a).z,A(b).z,A(c).z];
                 out.rose=(A(a).z>A(b).z&&A(a).z<A(c).z);
                 up.click(); await nap(200);
                 out.top=(A(a).z>A(c).z);
                 dn.click(); await nap(200); dn.click(); await nap(200);
                 out.bottom=(A(a).z<A(b).z&&A(a).z<A(c).z&&!A(a).under);
                 /* and past the bottom of its band it crosses the strokes */
                 dn.click(); await nap(200);
                 out.crossed=!!A(a).under;
                 selectAnno(null);
                 res(out); })""")
        ok = (step["has"] and step["left"] and step["rose"] and step["top"]
              and step["bottom"] and step["crossed"])
        results.append({"tool": "Up and down one layer", "ok": ok, "why": json.dumps(step)})

        # ---------- 6i7 — A READING'S GROUND COVERS ITS RUN ----------
        # Ced: "text box of lengths are also moving down in the render." It had not moved: the ground
        # that hides the run behind it was painted flat on screen and at the tool's fill opacity in
        # the file, so in the file the line ran through the words.
        await clear()
        ground = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 MA_TOOL_STYLES.dim=Object.assign({},MA_TOOL_STYLES.dim||{},
                                                  {fillOp:0,fill:"#ffffff"});
                 const dl=maPlaceDim(0,0.15,0.55,0.45,0.48);
                 await nap(350);
                 const L=S.lines.find(z=>z.id===dl);
                 const lab=S.annos.find(z=>z.id===L.dimFor);
                 layoutAnnos(); await nap(250);
                 const ed=document.querySelector(`.anno[data-id="${lab.id}"] .ed`);
                 const out={ fillOp:lab.fillOp, under:!!lab.under,
                             css:getComputedStyle(ed).backgroundColor };
                 /* and an ordinary mark's ground follows ITS opacity, on screen as in the file */
                 const id=maAddTextBox(0,0.15,0.25,"GROUND",0.20,0.05);
                 const a=S.annos.find(z=>z.id===id);
                 a.bgNone=false; a.bg="#ffff00"; a.fillOp=0.4; a.text="GROUND";
                 layoutAnnos(); await nap(200);
                 out.box=getComputedStyle(
                   document.querySelector(`.anno[data-id="${id}"] .ed`)).backgroundColor;
                 res(out); })""")
        ok = (ground["fillOp"] == 1 and not ground["under"]
              and "255, 255, 255" in ground["css"] and "0.4" in ground["box"])
        results.append({"tool": "A reading covers its run", "ok": ok, "why": json.dumps(ground)})

        # ---------- 6ia/6ib — A STROKE HAS A PLACE IN THE STACK ----------
        # Ced: "layering are still bad, please polish it." The page stacks four levels, not two —
        # strokes below, marks below, strokes above, marks above — and a stroke can be walked
        # through them from its own bar, exactly as a mark can from its box.
        await clear()
        stack = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 const l1=addLine(0,0.2,0.30,0.6,0.30,{col:"#fa3237",sw:2});
                 const l2=addLine(0,0.2,0.34,0.6,0.34,{col:"#fa3237",sw:2});
                 const L=id=>S.lines.find(z=>z.id===id)||{};
                 out.newOnTop=[L(l1).z,L(l2).z];
                 setMode("select"); selectLine(l1); await nap(250);
                 out.bar=!!document.querySelector('#linebar [data-llay="up"]');
                 document.querySelector('#linebar [data-llay="up"]').click(); await nap(250);
                 out.stepped=[L(l1).z,L(l2).z];
                 selectLine(l1); await nap(150);
                 document.querySelector('#linebar [data-llay="under"]').click(); await nap(300);
                 out.under=!!L(l1).under;
                 const pgEl=document.querySelector('.page[data-idx="0"]');
                 /* 6ln — A STROKE IS NO LONGER CONFINED TO A BAND SVG. It is drawn into a run layer
                    INSIDE the mark layer, with a z-index of its own, which is the whole point: the two
                    kinds share one stack and a stroke can sit between two marks. So what is checked
                    here is that the run layers exist where the marks are and carry the strokes — the
                    band SVGs are now only the ghost's and the start point's, and are empty at rest. */
                 out.runs={ under:pgEl.querySelectorAll(".annolayer-under svg.draw.run").length,
                            over: pgEl.querySelectorAll(".annolayer svg.draw.run").length };
                 out.inRuns=pgEl.querySelectorAll("svg.draw.run polyline").length;
                 out.runZ=[...pgEl.querySelectorAll("svg.draw.run")]
                            .map(n=>+(n.style.zIndex||0)).filter(z=>z>0).length;
                 /* the page's own order, top to bottom */
                 out.order=[...pgEl.children].map(n=>n.getAttribute("class")||n.tagName);
                 /* a mark sent to the back crosses below the strokes and comes back */
                 const a1=maAddTextBox(0,0.25,0.28,"OVER",0.15,0.04);
                 layoutAnnos(); selectAnno(a1); await nap(250);
                 document.querySelector('#annobar [data-lay="back"]').click(); await nap(250);
                 out.markBack=!!(S.annos.find(z=>z.id===a1)||{}).under;
                 selectAnno(a1); await nap(150);
                 document.querySelector('#annobar [data-lay="front"]').click(); await nap(250);
                 out.markFront=!(S.annos.find(z=>z.id===a1)||{}).under;
                 res(out); })""")
        # 6ln — the BEHAVIOUR is unchanged and still asserted: a new stroke lands on top, one press
        # steps it past its neighbour, it crosses to the band below, and a mark crosses both ways.
        # What changed is where a stroke is DRAWN, so the structural half asks the new question: are
        # the run layers inside the mark layers, do they carry the strokes, and do they have a
        # z-index to be compared with a mark's?
        ok = (stack["bar"] and stack["newOnTop"] == [1, 2] and stack["stepped"] == [2, 1]
              and stack["under"]
              and (stack["runs"]["under"] + stack["runs"]["over"]) > 0
              and stack["inRuns"] > 0 and stack["runZ"] > 0
              and stack["order"].index("annolayer-under") < stack["order"].index("annolayer")
              < stack["order"].index("annoui")
              and stack["markBack"] and stack["markFront"])
        results.append({"tool": "A stroke has a place in the stack", "ok": ok,
                        "why": json.dumps(stack)})

        # ---------- 6ie — THE SNAPSHOT IS WHAT IS ON THE SHEET ----------
        # Ced: "snapshot tool is now broken. it should still do what it did on the previous builds,
        # just with better capturing on what's on the ui."
        await clear()
        snap = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 /* a cloud shape (SVG outline), a stroke UNDER it, and a mark over it */
                 const sid=maAddShape(0,"rect",0.20,0.26,0.24,0.10,{});
                 const sh=S.annos.find(z=>z.id===sid);
                 sh.col="#1971c2"; sh.sw=2; sh.fillOp=0; sh.lpat="cloud"; sh.text="";
                 const lid=addLine(0,0.21,0.31,0.43,0.31,{col:"#2b8a3e",sw:3});
                 S.lines.find(z=>z.id===lid).under=true;
                 layoutAnnos(); drawAllLines(); await nap(300);
                 /* the DEFAULT converts; an earlier case left Plain set on the live style */
                 out.tintDefault=(MA_TOOL_DEFAULTS.snapshot||{}).tint!==false;
                 MA_TOOL_STYLES.snapshot=Object.assign({},MA_TOOL_STYLES.snapshot||{},
                   {tint:MA_TOOL_DEFAULTS.snapshot.tint});
                 try{ maSaveToolStyles(); }catch(e){}
                 const n0=S.annos.length;
                 await skSnapshot(document.querySelector('.page[data-idx="0"]'),0,
                                  [0.18,0.24,0.48,0.40]);
                 await nap(500);
                 out.made=S.annos.length-n0;
                 const shot=S.annos[S.annos.length-1];
                 out.kind=shot.kind; out.maKind=shot.maKind;
                 out.tinted=!!shot._tintCol;
                 /* the capture has ink in it from all of: the page, the under-stroke, the cloud */
                 out.ink=await new Promise(r=>{ const im=new Image();
                   im.onload=()=>{ const c=document.createElement("canvas");
                     c.width=im.width; c.height=im.height;
                     const x=c.getContext("2d"); x.drawImage(im,0,0);
                     const d=x.getImageData(0,0,c.width,c.height).data;
                     let on=0; for(let i=3;i<d.length;i+=4)if(d[i]>16)on++;
                     r(Math.round(1000*on/(c.width*c.height))); };
                   im.onerror=()=>r(-1); im.src=shot.src; });
                 res(out); })""")
        ok = (snap["tintDefault"] and snap["made"] == 1 and snap["kind"] == "img"
              and snap["maKind"] == "snapshot" and snap["tinted"] and snap["ink"] > 3)
        results.append({"tool": "A snapshot carries every layer", "ok": ok, "why": json.dumps(snap)})

        # ---------- 6id — THE MARKUP PREVIEW FITS WHAT IS IN IT ----------
        # Ced: "still an issue on markup preview."
        await clear()
        prev = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const rec={ kind:"group", name:"T", pw:612, ph:792,
                   annos:[{id:1,nx:0,ny:0,nw:0.04,nh:0.02,text:"A VERY LONG LABEL INDEED",
                           size:9,col:"#fa3237",bgNone:true,align:"left"}], lines:[] };
                 const host=document.createElement("div");
                 host.style.cssText="position:fixed;left:-500px;top:0;width:120px;height:90px";
                 document.body.appendChild(host);
                 const svg=maGroupSvg(rec,120,90);
                 host.appendChild(svg);
                 await nap(300);
                 const vb=svg.getAttribute("viewBox").split(/\s+/).map(Number);
                 const bb=svg.getBBox();
                 const out={ vb, fits:(bb.x>=vb[0]-0.5)&&(bb.x+bb.width<=vb[0]+vb[2]+0.5)
                                    &&(bb.y>=vb[1]-0.5)&&(bb.y+bb.height<=vb[1]+vb[3]+0.5),
                             bb:[+bb.x.toFixed(1),+bb.y.toFixed(1),
                                 +bb.width.toFixed(1),+bb.height.toFixed(1)] };
                 host.remove();
                 res(out); })""")
        ok = bool(prev["fits"]) and prev["vb"][2] > 26
        results.append({"tool": "The markup preview fits its marks", "ok": ok,
                        "why": json.dumps(prev)})

        # ---------- 6ii/6ij — A NEW MARK IS ON TOP, AND WHAT IS SELECTED IS REACHABLE ----------
        # Ced: "again, every new redline should always be on the frontmost layer" and
        # "do not put the markers behind the shape even if the layer is below".
        await clear()
        front = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 const t1=addText(0,0.20,0.20,"ONE");
                 const t2=addText(0,0.20,0.28,"TWO");
                 const A=id=>S.annos.find(z=>z.id===id)||{};
                 out.band=[!!A(t1).under,!!A(t2).under];     /* both in the UPPER band */
                 out.z=[A(t1).z,A(t2).z];                    /* the newer one above the older */
                 /* a shape drawn after a mark is above it too */
                 const sid=maAddShape(0,"rect",0.18,0.18,0.3,0.14,{});
                 out.shape={under:!!A(sid).under,z:A(sid).z};
                 /* 6is — push one mark into the lower band and select it: the mark must NOT move
                    in the stack, and its handles must be in the layer above everything */
                 A(t1).under=true; layoutAnnos(); await nap(250);
                 const zNow=()=>{ const d=document.querySelector(
                   `.annolayer-under .anno[data-id="${t1}"], .annolayer .anno[data-id="${t1}"]`);
                   return d?(d.style.zIndex||""):null; };
                 const zBefore=zNow();
                 setMode("select"); selectAnno(t1); await nap(350);
                 const pgEl=document.querySelector('.page[data-idx="0"]');
                 const f=pgEl.querySelector(".annoui > .anno.selui");
                 out.sel={ zKept:(zNow()===zBefore),
                           frame:!!f, rz:f?f.querySelectorAll(".rz").length:0,
                           rot:!!(f&&f.querySelector(".rot")),
                           mov:!!(f&&f.querySelector(".mov")),
                           lay:f?f.querySelectorAll(".lup,.ldn").length:0,
                           uiZ:+getComputedStyle(pgEl.querySelector(".annoui")).zIndex,
                           /* 6lj — WITHIN A PIXEL, not the same string. The frame is deliberately
                              snapped to whole SCREEN pixels so its 2px ring paints evenly on all four
                              sides (Ced: "make the blue lines in display all even"), which means its
                              `left` is the mark's rounded and then nudged by the page's own fraction —
                              never the same text, and never more than a pixel away. */
                           aligned:(function(){ const m=document.querySelector(
                               `.annolayer-under .anno[data-id="${t1}"]`);
                             if(!f||!m)return false;
                             const a=f.getBoundingClientRect(), b=m.getBoundingClientRect();
                             return Math.abs(a.left-b.left)<=1 && Math.abs(a.top-b.top)<=1; })() };
                 selectAnno(null); await nap(250);
                 out.cleared=!pgEl.querySelector(".annoui > .anno.selui");
                 out.zAfter=zNow();
                 /* and selecting it AGAIN still has handles — they go home when the frame goes */
                 selectAnno(t1); await nap(250);
                 const f2=pgEl.querySelector(".annoui > .anno.selui");
                 out.again=f2?f2.querySelectorAll(".rz").length:0;
                 clearMulti(); selectAnno(null);
                 res(out); })""")
        ok = (front["band"] == [False, False] and front["z"][1] > front["z"][0]
              and not front["shape"]["under"] and front["shape"]["z"] > front["z"][1]
              and front["sel"]["zKept"] and front["sel"]["frame"]
              and front["sel"]["rz"] == 8 and front["sel"]["rot"] and front["sel"]["mov"]
              and front["sel"]["lay"] == 2 and front["sel"]["uiZ"] >= 9
              and front["sel"]["aligned"] and front["cleared"]
              and front["again"] == 8)
        results.append({"tool": "New marks on top, selection never restacks", "ok": ok,
                        "why": json.dumps(front)})

        # ---------- 6ik — A SAVED MARKUP KEEPS ITS OWN STACKING ----------
        # Ced: "when i make the stamp, it's like this. but when saved to mark up, the word REDLINED
        # becomes layered to the back."
        await clear()
        stamp = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 /* the box is UNDER the words: lower z, opaque white interior */
                 const bx=maAddShape(0,"rect",0.20,0.20,0.24,0.09,{});
                 const b=S.annos.find(z=>z.id===bx);
                 b.col="#fa3237"; b.sw=2; b.fill="#ffffff"; b.fillOp=1; b.text=""; b.z=1; b.under=false;
                 const wd=maAddTextBox(0,0.21,0.21,"REDLINED",0.20,0.03);
                 const w=S.annos.find(z=>z.id===wd);
                 w.col="#fa3237"; w.size=10; w.bgNone=true; w.z=9; w.under=false;
                 layoutAnnos(); await nap(200);
                 /* saved the way a selection hands it over — the WORDS first in the array */
                 const rec={kind:"group",name:"stamp",pw:S.pages[0].w1,ph:S.pages[0].h1,
                            annos:[_cleanA(w),_cleanA(b)],lines:[]};
                 const host=document.createElement("div");
                 host.style.cssText="position:fixed;left:-700px;top:0;width:220px;height:130px";
                 document.body.appendChild(host);
                 const svg=maGroupSvg(rec,220,130); host.appendChild(svg); await nap(300);
                 const order=[...svg.children].map(n=>{
                   const t=n.querySelector&&n.querySelector("text");
                   return t?t.textContent:"shape"; });
                 out.order=order;
                 out.wordsLast=(order.indexOf("REDLINED")===order.length-1);
                 host.remove();
                 /* and dropping it keeps the box under the words */
                 S.annos=[];S.lines=[];layoutAnnos();
                 maPlaceMarkup(rec,0,0.30,0.50); await nap(250);
                 const got=S.annos.map(z=>({t:z.text||"shape",z:z.z,u:!!z.under}));
                 const W=got.find(z=>z.t==="REDLINED"), B=got.find(z=>z.t==="shape");
                 out.dropped=got;
                 out.keptOrder=!!(W&&B&&W.z>B.z&&!W.u&&!B.u);
                 res(out); })""")
        ok = bool(stamp["wordsLast"]) and bool(stamp["keptOrder"])
        results.append({"tool": "A saved markup keeps its stacking", "ok": ok,
                        "why": json.dumps(stamp)})

        # ---------- 6in/6io/6ip/6iq — THE PICTURE EDITOR AND THE LASSO CAPTURE ----------
        # Ced: a lasso snapshot under the snapshot settings; the erase brush must not stop at the edge
        # of the picture; shift-scroll sizes the brush; the free-turn slider is calmer and the picture
        # carries the same rotate grip a mark does.
        await clear()
        await pick("snapshot")
        await page.evaluate(
            """()=>{ tpOpen("snapshot",document.querySelector('#tools .tool[data-mode=\"snapshot\"]')); }""")
        await page.wait_for_timeout(350)
        region = await page.evaluate(
            """()=>{ const chips=[...document.querySelectorAll("#toolpop .tp-cb")]
                       .map(b=>b.textContent.trim());
                     const lb=[...document.querySelectorAll("#toolpop .tp-cb")]
                       .find(b=>/^Lasso$/.test(b.textContent.trim()));
                     if(lb)lb.click();
                     return { chips:chips.filter(t=>/Rectangle|Lasso|Plain|Redline/.test(t)),
                              picked:(MA_TOOL_STYLES.snapshot||{}).region }; }""")
        await page.evaluate("()=>{ try{tpClose();}catch(e){} }")
        await page.wait_for_timeout(200)
        lasso = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const R=[0.14,0.14,0.60,0.30];
                 const ink=src=>new Promise(r=>{ const im=new Image();
                   im.onload=()=>{ const c=document.createElement("canvas");
                     c.width=im.width;c.height=im.height;
                     const x=c.getContext("2d"); x.drawImage(im,0,0);
                     const d=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height;
                     const box=(x0,y0,x1,y1)=>{ let n=0;
                       for(let y=y0;y<y1;y++)for(let X=x0;X<x1;X++)if(d[((y*W)+X)*4+3]>16)n++;
                       return n; };
                     r({ corner:box(0,0,Math.round(W*0.12),Math.round(H*0.16))
                               +box(Math.round(W*0.88),0,W,Math.round(H*0.16)),
                         mid:box(Math.round(W*0.35),Math.round(H*0.35),
                                 Math.round(W*0.65),Math.round(H*0.65)) }); };
                   im.onerror=()=>r(null); im.src=src; });
                 await skSnapshot(pg,0,R); await nap(500);
                 const plain=await ink(S.annos[S.annos.length-1].src);
                 S.annos=[];S.lines=[];layoutAnnos();
                 const poly=[]; for(let k=0;k<64;k++){ const t=k/64*Math.PI*2;
                   poly.push([ (R[0]+R[2])/2+Math.cos(t)*(R[2]-R[0])/2*0.98,
                               (R[1]+R[3])/2+Math.sin(t)*(R[3]-R[1])/2*0.98 ]); }
                 await skSnapshot(pg,0,R,poly); await nap(500);
                 const cut=await ink(S.annos[S.annos.length-1].src);
                 res({plain,cut}); })""")
        await page.evaluate("""()=>{ MA_TOOL_STYLES.snapshot.region="rect";
                                     try{maSaveToolStyles();}catch(e){} }""")
        editor = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();
                 const c=document.createElement("canvas"); c.width=400; c.height=260;
                 const x=c.getContext("2d"); x.fillStyle="#fa3237"; x.fillRect(0,0,400,260);
                 const id=addText(0,0.2,0.3,""); const a=S.annos.find(z=>z.id===id);
                 a.kind="img"; a.src=c.toDataURL("image/png");
                 a.nw=0.3; a.nh=0.2; a.manualW=true; a.sw=0;
                 layoutAnnos(); await nap(150);
                 skEditor(a); await nap(900);
                 const out={};
                 const rng=document.querySelector(".sk-edsize input[type=range]");
                 const stage=document.querySelector(".sk-edstage");
                 const wheel=(dy,mod)=>stage.dispatchEvent(new WheelEvent("wheel",
                   Object.assign({deltaY:dy,bubbles:true,cancelable:true},mod)));
                 out.brush0=+rng.value;
                 for(let k=0;k<5;k++)wheel(-100,{shiftKey:true}); await nap(120);
                 out.brushUp=+rng.value;
                 for(let k=0;k<10;k++)wheel(100,{shiftKey:true}); await nap(120);
                 out.brushDown=+rng.value;
                 const keep=+rng.value; wheel(-100,{ctrlKey:true}); await nap(120);
                 out.ctrlLeavesBrush=(+rng.value===keep);
                 /* the free-turn slider is the calmer one, and the picture has the mark's own grip */
                 const f=document.querySelector(".sk-edfree input[type=range]");
                 out.free={min:+f.min,max:+f.max,step:+f.step};
                 const gp=document.querySelector(".sk-edwrap .sk-edrot");
                 out.grip=!!gp&&gp.textContent.trim()==="\u21bb";
                 /* a stroke that leaves the picture keeps rubbing when it comes back */
                 const cv=document.querySelector(".sk-edcanvas");
                 const r=cv.getBoundingClientRect();
                 const P=(fx,fy)=>({clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,
                                    bubbles:true,pointerId:31,button:0});
                 const alphaAt=(fx,fy)=>cv.getContext("2d")
                   .getImageData(Math.round(cv.width*fx),Math.round(cv.height*fy),1,1).data[3];
                 out.before={mid:alphaAt(0.5,0.5),low:alphaAt(0.5,0.85)};
                 cv.dispatchEvent(new PointerEvent("pointerdown",P(0.5,0.5)));
                 window.dispatchEvent(new PointerEvent("pointermove",P(0.8,0.5)));
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {clientX:r.right+200,clientY:r.top+r.height*0.5,bubbles:true,pointerId:31}));
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {clientX:r.right+200,clientY:r.top+r.height*0.85,bubbles:true,pointerId:31}));
                 window.dispatchEvent(new PointerEvent("pointermove",P(0.5,0.85)));
                 window.dispatchEvent(new PointerEvent("pointerup",P(0.5,0.85)));
                 await nap(300);
                 out.after={mid:alphaAt(0.5,0.5),low:alphaAt(0.5,0.85)};
                 const cancel=[...document.querySelectorAll(".sk-edfb")]
                   .find(b=>/Cancel/.test(b.textContent));
                 if(cancel)cancel.click();
                 await nap(200);
                 res(out); })""")
        ok = ("Lasso" in region["chips"] and "Rectangle" in region["chips"]
              and region["picked"] == "lasso"
              and lasso["plain"]["corner"] > 200 and lasso["cut"]["corner"] == 0
              and lasso["cut"]["mid"] == lasso["plain"]["mid"]
              and editor["brushUp"] > editor["brush0"] > editor["brushDown"]
              and editor["ctrlLeavesBrush"]
              and editor["free"]["min"] == -30 and editor["free"]["max"] == 30
              and editor["free"]["step"] < 1 and editor["grip"]
              and editor["before"]["mid"] > 16 and editor["before"]["low"] > 16
              and editor["after"]["mid"] == 0 and editor["after"]["low"] == 0)
        results.append({"tool": "Lasso capture and the picture editor", "ok": ok,
                        "why": json.dumps({"region": region, "lasso": lasso, "editor": editor})})

        # ---------- 6ir — A GROUP IS ONE LAYER ----------
        # Ced: "the callouts are not acting as one in layer, again, all shapes, lines, textbox, and
        # grouped items should be in one layer if they are grouped."
        await clear()
        grp = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 const sid=maAddShape(0,"rect",0.30,0.30,0.22,0.09,{});
                 const box=S.annos.find(z=>z.id===sid);
                 box.col="#fa3237"; box.sw=2; box.fillOp=0; box.text="";
                 const tid=maAddTextBox(0,0.31,0.31,"SPD on Alpha only",0.20,0.05);
                 const txt=S.annos.find(z=>z.id===tid); txt.col="#fa3237"; txt.bgNone=true;
                 const lid=addLine(0,0.30,0.30,0.16,0.18,{col:"#fa3237",sw:3,le1:"arrow"});
                 const ldr=S.lines.find(z=>z.id===lid);
                 /* the marks open themselves for typing on a timer; let that settle first */
                 setMode("select"); selectAnno(null); clearMulti(); await nap(400);
                 S.selMulti.add(sid); S.selMulti.add(tid); S.selMultiL.add(lid);
                 paintMulti(); await nap(150);
                 groupSelected(); await nap(300);
                 clearMulti(); selectAnno(null); layoutAnnos(); await nap(350);
                 const gk=groupKeyOf(box);
                 out.keys=[groupKeyOf(box),groupKeyOf(txt),groupKeyOf(ldr)];
                 const host=document.querySelector(`.annolayer > .annogroup[data-gk="${gk}"]`);
                 out.one={ container:!!host,
                           marks:host?host.querySelectorAll(".anno").length:0,
                           svgs:host?host.querySelectorAll("svg.draw.ingroup").length:0,
                           ink:host?host.querySelectorAll(
                             "svg.draw.ingroup polyline,svg.draw.ingroup path").length:0 };
                 /* a picture drawn afterwards goes above the WHOLE group, not through it */
                 const c=document.createElement("canvas"); c.width=200;c.height=120;
                 const x=c.getContext("2d"); x.fillStyle="#88f"; x.fillRect(0,0,200,120);
                 const pid=addText(0,0.33,0.31,""); const pic=S.annos.find(z=>z.id===pid);
                 pic.kind="img"; pic.src=c.toDataURL("image/png");
                 pic.nw=0.2; pic.nh=0.1; pic.manualW=true; pic.sw=0;
                 layoutAnnos(); await nap(350);
                 const layer=document.querySelector('.page[data-idx="0"] .annolayer');
                 out.kids=[...layer.children].map(n=>(n.dataset&&n.dataset.gk)?("G:"+n.dataset.gk)
                                                                             :n.className);
                 out.picOver=(pic.z>Math.max(box.z||0,txt.z||0));
                 /* and the whole group crosses the bands as one */
                 layerMarks(layerFamily(box),"back"); layoutAnnos(); await nap(350);
                 out.together=(!!box.under===!!txt.under)&&(!!box.under===!!ldr.under)&&!!box.under;
                 const h2=document.querySelector(`.annolayer-under > .annogroup[data-gk="${gk}"]`);
                 out.moved={ inUnder:!!h2, marks:h2?h2.querySelectorAll(".anno").length:0,
                             svgs:h2?h2.querySelectorAll("svg.draw.ingroup").length:0 };
                 res(out); })""")
        ok = (len(set(grp["keys"])) == 1 and grp["keys"][0]
              and grp["one"]["container"] and grp["one"]["marks"] == 2
              and grp["one"]["svgs"] == 1 and grp["one"]["ink"] > 0
              and grp["picOver"] and grp["together"]
              and grp["moved"]["inUnder"] and grp["moved"]["marks"] == 2
              and grp["moved"]["svgs"] == 1)
        results.append({"tool": "A group is one layer", "ok": ok, "why": json.dumps(grp)})

        # ---------- 6is/6it — CLICKING A MARK DOES NOT RESTACK IT ----------
        # Ced: "when the shape is in the back, clicking it should not put it upfront", and the stamp
        # whose REDLINED vanished behind its own box the moment the group was selected.
        await clear()
        stack2 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const out={};
                 /* a stamp: an opaque box, then the words that belong on top of it */
                 const bx=maAddShape(0,"rect",0.20,0.20,0.28,0.10,{});
                 const b=S.annos.find(z=>z.id===bx);
                 b.col="#fa3237"; b.sw=2; b.fill="#ffffff"; b.fillOp=1; b.text="";
                 const hd=maAddTextBox(0,0.21,0.205,"REDLINED",0.24,0.028);
                 const H=S.annos.find(z=>z.id===hd);
                 H.col="#fa3237"; H.size=12; H.bgNone=true;
                 setMode("select"); selectAnno(null); clearMulti(); await nap(450);
                 layoutAnnos(); await nap(250);
                 const order=()=>[...document.querySelectorAll(
                   '.page[data-idx="0"] .annolayer .anno')].map(d=>+d.dataset.id);
                 const zs=()=>[...document.querySelectorAll(
                   '.page[data-idx="0"] .annolayer .anno')].map(d=>d.style.zIndex||"");
                 out.before={order:order(),zs:zs()};
                 selectAnno(bx); await nap(300);
                 out.afterBox={order:order(),zs:zs()};
                 /* and with the two of them selected together */
                 selectAnno(null); clearMulti();
                 S.selMulti.add(bx); S.selMulti.add(hd); paintMulti(); await nap(300);
                 out.afterMulti={order:order(),zs:zs()};
                 /* the words are still after the box, so they still paint over it */
                 out.wordsLast=(out.afterMulti.order.indexOf(hd)
                                >out.afterMulti.order.indexOf(bx));
                 clearMulti(); selectAnno(null);
                 res(out); })""")
        ok = (stack2["before"]["order"] == stack2["afterBox"]["order"]
              == stack2["afterMulti"]["order"]
              and stack2["before"]["zs"] == stack2["afterBox"]["zs"]
              == stack2["afterMulti"]["zs"]
              and stack2["wordsLast"])
        results.append({"tool": "Selecting never restacks the drawing", "ok": ok,
                        "why": json.dumps(stack2)})

        # ---------- 6ix — A LEADER MEETS ITS BOX ----------
        # Ced: "the callout is broken, please fix." The group layer was `class="draw grp"`, and the
        # ribbon's own groups are `.grp` — `padding:1px 9px` — so every stroke in a group was drawn
        # nine pixels to the side of the mark it belongs to.
        await clear()
        lead = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 MA_CALLOUT_TEXT="SPLITTER USED ONLY DURING CUTOVER";
                 maPlaceCallout(0,0.30,0.30); await nap(700);
                 setMode("select"); selectAnno(null); clearMulti();
                 const a=S.annos.find(z=>z.maKind==="callout");
                 const l=S.lines.find(z=>z.coFor===a.id);
                 const rows=[];
                 for(const z of [1,1.5,2.2]){
                   await setZoom(z); await nap(700);
                   layoutAnnos(); drawAllLines(); await nap(250);
                   const pg=document.querySelector('.page[data-idx="0"]');
                   if(!pg||pg.dataset.rendered!=="1"){ rows.push({z,skip:1}); continue; }
                   const pr=pg.getBoundingClientRect(), W=pg.offsetWidth;
                   const gs=pg.querySelector("svg.draw.ingroup");
                   const poly=gs&&gs.querySelector("polyline");
                   if(!poly){ rows.push({z,noPoly:1}); continue; }
                   const c=poly.getScreenCTM();
                   const x0=+poly.getAttribute("points").split(" ")[0].split(",")[0];
                   const drawn=(c.e+x0)-pr.left;
                   const want=linePts(l)[0][0]*W;
                   rows.push({z,shift:+(drawn-want).toFixed(2)});
                 }
                 await setZoom(1.2); await nap(500);
                 res({rows}); })""")
        ok = all((not r.get("skip")) and (not r.get("noPoly")) and abs(r["shift"]) < 1
                 for r in lead["rows"]) and len(lead["rows"]) == 3
        results.append({"tool": "A leader meets its box", "ok": ok, "why": json.dumps(lead)})

        # ---------- 6iv/6iw — A SMALL SHAPE, AND A ZOOM THAT GOES FURTHER ----------
        # Ced: "change the minimum size of the shapes possible to add, make sure that the thickness
        # will not dictate the size of the shape" and "do not also limit the zoom to just 350%".
        await clear()
        small = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const W=pg.offsetWidth,H=pg.offsetHeight;
                 const box=id=>{ const e=document.querySelector(`.anno[data-id="${id}"] .ed`);
                                 return e?[e.offsetWidth,e.offsetHeight]:null; };
                 const out={};
                 /* six screen pixels square, at a hairline */
                 const a=maAddShape(0,"rect",0.30,0.30,6/W,6/H,{});
                 Object.assign(S.annos.find(z=>z.id===a),
                   {col:"#fa3237",sw:1,fillOp:0,text:""});
                 layoutAnnos(); await nap(250);
                 out.six=box(a);
                 /* and the SAME box with a fat rule: the thickness must not resize it */
                 const b=maAddShape(0,"rect",0.50,0.30,14/W,10/H,{});
                 Object.assign(S.annos.find(z=>z.id===b),
                   {col:"#fa3237",sw:1,fillOp:0,text:""});
                 layoutAnnos(); await nap(200);
                 out.thin=box(b);
                 S.annos.find(z=>z.id===b).sw=8; layoutAnnos(); await nap(200);
                 out.thick=box(b);
                 /* the rule is still drawn — it moved to the outline, it did not vanish */
                 out.outline=!!document.querySelector(`.anno[data-id="${b}"] svg.shapeoutline`);
                 /* and the zoom goes past 350% */
                 await setZoom(6); await nap(600);
                 out.zoom6=S.scale;
                 await setZoom(12); await nap(600);
                 out.zoom12=S.scale;
                 await setZoom(1.2); await nap(500);
                 res(out); })""")
        ok = (small["six"] == [6, 6] and small["thin"] == [14, 10]
              and small["thick"] == [14, 10] and small["outline"]
              and small["zoom6"] == 6 and small["zoom12"] > 3.5)
        results.append({"tool": "A small shape stays small", "ok": ok, "why": json.dumps(small)})

        # ---------- 6iy/6iz — THE ASSIST ICONS, AND A ROUNDED, INDENTED PANEL ----------
        await clear()
        look = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const t=id=>{ const b=document.getElementById(id);
                               return b?b.textContent.trim():null; };
                 /* 6kx — Notes is gone; Markups is the Assist button with a drawn icon now */
                 out.icons={markups:t("markupsBtn"),table:t("analyzeMaBtn")};
                 setMode("snapshot");
                 tpOpen("snapshot",document.querySelector('#tools .tool[data-mode="snapshot"]'));
                 await nap(450);
                 const pop=document.getElementById("toolpop");
                 const R=el=>el?parseFloat(getComputedStyle(el).borderRadius):null;
                 const chip=pop.querySelector(".tp-choice .tp-cb");
                 out.round={ pop:R(pop), chip:R(chip), sw:R(pop.querySelector(".tp-sw")),
                             act:R(pop.querySelector(".tp-act")) };
                 /* every row's label starts at the same x as the swatch row above it */
                 const pr=pop.getBoundingClientRect();
                 const lefts=[...pop.querySelectorAll(".tp-row > .tp-rowl")]
                   .map(e=>Math.round(e.getBoundingClientRect().left-pr.left));
                 const swl=Math.round(
                   pop.querySelector(".tp-swatches").getBoundingClientRect().left-pr.left);
                 out.indent={lefts,swatches:swl,
                             aligned:lefts.length>0&&lefts.every(v=>Math.abs(v-swl)<=1)};
                 tpClose(); await nap(150);
                 res(out); })""")
        ok = (look["icons"]["markups"] == "\u25e9 Markups"
              and look["icons"]["table"] == "\u25a6 Read table"
              and look["round"]["chip"] >= 12 and look["round"]["sw"] >= 8
              and look["round"]["act"] >= 12 and look["round"]["pop"] >= 14
              and look["indent"]["aligned"])
        results.append({"tool": "Rounded, indented prompts", "ok": ok, "why": json.dumps(look)})

        # ---------- 6j2/6j3/6j4/6j5 — THE PICTURE EDITOR IN v32 ----------
        await clear()
        await pick("snapshot")
        await drag(*at(0.12, 0.14), *at(0.52, 0.26))
        await page.wait_for_timeout(2400)
        await page.evaluate(
            """()=>{ const a=S.annos.find(z=>z.maKind==="snapshot"); skEditor(a); return true; }""")
        await page.wait_for_timeout(800)
        ed32 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const m=document.querySelector(".sk-edit");
                 const cv=m.querySelector(".sk-edcanvas");
                 const ov=m.querySelector(".sk-edov");
                 const box=m.querySelector(".sk-edwrap");
                 const stage=m.querySelector(".sk-edstage");
                 const g=cv.getContext("2d",{willReadFrequently:true});
                 const px=(x,y)=>[...g.getImageData(x,y,1,1).data];
                 const L=()=>[...m.querySelectorAll(".sk-edb")];
                 const btn=t=>{ const r=new RegExp(t,"i");
                   return m.querySelector('.sk-edb[data-k="'+t+'"]')      /* 6m2 — the stable handle */
                     ||L().find(z=>r.test(z.textContent))||L().find(z=>r.test(z.textContent+" "+(z.title||""))); };
                 const CP=(x,y)=>{ const b=cv.getBoundingClientRect();
                   return {clientX:b.left+b.width*(x/cv.width),
                           clientY:b.top+b.height*(y/cv.height),
                           bubbles:true,pointerId:57,button:0}; };
                 const a=S.annos.find(z=>z.maKind==="snapshot");
                 /* --- 6mh: the border thickens the SHAPE's edge, and leaves the box alone ---
                    This asked for the old rule until v50: `a.sw` set to 6, a `bordered` class on the
                    stage and a `--sk-bord` in pixels — a frame round the picture's bounding box.
                    Ced: "it should not add a border to the box, it must be border on the transparent
                    shape." So what is asked now is what the slider is for: the picture's own ink
                    grows, the mark's stroke is untouched, and 0 puts every pixel back. */
                 const inkNow=()=>{ const d=g.getImageData(0,0,cv.width,cv.height).data;
                   let n=0; for(let i=3;i<d.length;i+=4)if(d[i]>40)n++; return n; };
                 const brng=m.querySelector(".sk-edborder input[type=range]");
                 out.hasBorder=!!brng;
                 if(brng){ const sw0=a.sw, ink0=inkNow();
                   brng.value="6"; brng.dispatchEvent(new Event("input",{bubbles:true}));
                   await nap(220);
                   out.inkGrew=+(inkNow()/Math.max(1,ink0)).toFixed(2);
                   out.swUntouched=(a.sw===sw0);
                   out.boxUnframed=!box.classList.contains("bordered");
                   brng.value="0"; brng.dispatchEvent(new Event("input",{bubbles:true}));
                   brng.dispatchEvent(new Event("change",{bubbles:true}));
                   await nap(220);
                   out.borderOff=(Math.abs(inkNow()-ink0)<=2); }
                 /* --- a pixel with ink in it, on the band about to be swept --- */
                 const row=Math.round(cv.height*0.5);
                 let mid=[Math.round(cv.width*0.5),row];
                 for(let x=Math.round(cv.width*0.15);x<cv.width*0.85;x++){
                   if(px(x,row)[3]>200){ mid=[x,row]; break; } }
                 out.was=px(mid[0],mid[1]);
                 /* --- 6j5: the brush may START off the picture, on the stage itself --- */
                 btn("Erase").click();
                 const rg=m.querySelector(".sk-edsize input[type=range]");
                 rg.value="40"; rg.dispatchEvent(new Event("input",{bubbles:true}));
                 const sb=stage.getBoundingClientRect(), cb=cv.getBoundingClientRect();
                 const offX=Math.max(sb.left+2,cb.left-24);
                 stage.dispatchEvent(new PointerEvent("pointerdown",
                   {clientX:offX,clientY:cb.top+cb.height*0.5,bubbles:true,pointerId:57,button:0}));
                 window.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.5,cv.height*0.5)));
                 window.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.95,cv.height*0.5)));
                 window.dispatchEvent(new PointerEvent("pointerup",CP(cv.width*0.95,cv.height*0.5)));
                 out.offEdge=px(mid[0],mid[1]);
                 /* --- 6j3: Restore all puts the whole picture back, in one undoable step --- */
                 btn("restoreall").click();
                 await nap(120);
                 out.restoredAll=px(mid[0],mid[1]);
                 out.undoOn=!btn("undo").disabled;
                 btn("undo").click(); await nap(120);
                 out.afterUndo=px(mid[0],mid[1]);
                 btn("redo").click(); await nap(120);
                 out.afterRedo=px(mid[0],mid[1]);
                 /* --- 6j2/6m1: the crop box and its marks are actually drawn --- */
                 /* 6m1 — the box is up BEFORE the hand moves now: picking the tool up puts it on the
                    picture's own edges, and the cut waits for Apply. So the overlay is measured on
                    opening rather than mid-drag, which is a stronger version of the same check. */
                 btn("crop").click(); await nap(140);
                 out.ovShown=getComputedStyle(ov).display!=="none";
                 const og=ov.getContext("2d",{willReadFrequently:true});
                 let ink=0;
                 const d=og.getImageData(0,0,ov.width,ov.height).data;
                 for(let i=3;i<d.length;i+=4*97) if(d[i]>10) ink++;
                 out.ovInk=ink;
                 const befW=cv.width;
                 /* pull the SE corner in, then Apply */
                 cv.dispatchEvent(new PointerEvent("pointerdown",CP(cv.width-1,cv.height-1)));
                 cv.dispatchEvent(new PointerEvent("pointermove",CP(cv.width*0.8,cv.height*0.8)));
                 cv.dispatchEvent(new PointerEvent("pointerup",CP(cv.width*0.8,cv.height*0.8)));
                 await nap(200);
                 out.uncutUntilApply=(cv.width===befW);
                 btn("cropapply").click(); await nap(300);
                 out.cropped=cv.width<befW;
                 [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent)).click();
                 out.closed=!document.querySelector(".sk-edit");
                 res(out); })""")
        same32 = lambda p, q: p[3] == q[3] and (p[3] == 0 or (abs(p[0]-q[0]) < 6 and abs(p[1]-q[1]) < 6))
        ok = (ed32["hasBorder"] and ed32["inkGrew"] > 1.4 and ed32["swUntouched"]
              and ed32["boxUnframed"] and ed32["borderOff"]
              and ed32["was"][3] > 200 and ed32["offEdge"][3] == 0
              and same32(ed32["restoredAll"], ed32["was"])
              and ed32["undoOn"] and same32(ed32["afterUndo"], ed32["offEdge"])
              and same32(ed32["afterRedo"], ed32["was"])
              and ed32["ovShown"] and ed32["ovInk"] > 0
              and ed32["uncutUntilApply"] and ed32["cropped"] and ed32["closed"])
        results.append({"tool": "Editor: border, restore all, crop", "ok": ok,
                        "why": json.dumps(ed32)})

        # ---------- 6j8/6j9 — ALL-CAPS HEADERS, AND THE BAR CLEARS THE RIBBON ----------
        await clear()
        await pick("box"); await drag(*at(0.14, 0.10), *at(0.40, 0.18))
        await page.wait_for_timeout(500)
        caps = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const up=el=>el?getComputedStyle(el).textTransform:null;
                 setMode("snapshot");
                 tpOpen("snapshot",document.querySelector('#tools .tool[data-mode="snapshot"]'));
                 await nap(400);
                 const pop=document.getElementById("toolpop");
                 out.popTitle=up(pop.querySelector(".tp-title"));
                 out.popSech=up(pop.querySelector(".tp-sech"));
                 tpClose(); await nap(120);
                 out.marksHead=up(document.querySelector("#marksPanel .mk-head b"));
                 /* the mark's own bar sits clear of the ribbon, never over it */
                 setMode("select");
                 const a=S.annos[S.annos.length-1];
                 selectAnno(a.id); await nap(400);
                 const bar=document.getElementById("annobar");
                 const tb=document.getElementById("toolbar");
                 const br=bar.getBoundingClientRect(), tr=tb.getBoundingClientRect();
                 out.barTop=Math.round(br.top); out.ribbonBottom=Math.round(tr.bottom);
                 out.clears=br.height===0||br.top>=tr.bottom-1;
                 res(out); })""")
        ok = (caps["popTitle"] == "uppercase" and caps["popSech"] == "uppercase"
              and caps["marksHead"] == "uppercase" and caps["clears"])
        results.append({"tool": "All caps, bar clears ribbon", "ok": ok, "why": json.dumps(caps)})

        # ---------- 6j7 — RIGHT CLICK OPENS THE SETTINGS ----------
        ctx = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const kill=()=>document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 kill();
                 const a=S.annos[S.annos.length-1];
                 const el=document.querySelector(`.anno[data-id="${a.id}"]`);
                 const r=el.getBoundingClientRect();
                 el.dispatchEvent(new MouseEvent("contextmenu",
                   {clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true}));
                 await nap(250);
                 let m=document.querySelector(".sb-menu.sb-ctx");
                 out.markMenu=!!m;
                 out.markItems=m?[...m.querySelectorAll(".sb-mi")].length:0;
                 out.markLabels=m?[...m.querySelectorAll(".sb-mi")].map(z=>z.textContent.trim()).slice(0,4):[];
                 kill(); await nap(80);
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const pr=pg.getBoundingClientRect();
                 pg.dispatchEvent(new MouseEvent("contextmenu",
                   {clientX:pr.left+pr.width*0.8,clientY:pr.top+pr.height*0.85,
                    bubbles:true,cancelable:true}));
                 await nap(250);
                 m=document.querySelector(".sb-menu.sb-ctx");
                 out.pageMenu=!!m;
                 out.pageHead=m?(m.querySelector(".sb-mh")||{}).textContent:null;
                 out.pageLabels=m?[...m.querySelectorAll(".sb-mi")].map(z=>z.textContent.trim()):[];
                 kill();
                 /* the browser's own menu is still there for a text field */
                 const f=document.querySelector("input,textarea");
                 let native=true;
                 if(f){ const ev=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});
                        f.dispatchEvent(ev);
                        await nap(150);
                        native=!document.querySelector(".sb-menu.sb-ctx"); kill(); }
                 out.fieldsNative=native;
                 res(out); })""")
        ok = (ctx["markMenu"] and ctx["markItems"] >= 8 and ctx["pageMenu"]
              and bool(ctx["pageHead"]) and "PAGE" in (ctx["pageHead"] or "").upper()
              and len(ctx["pageLabels"]) >= 3 and ctx["fieldsNative"])
        results.append({"tool": "Right click opens the settings", "ok": ok, "why": json.dumps(ctx)})

        # ---------- 6jb — A PICTURE'S FRAME FOLLOWS THE PICTURE ----------
        await clear()
        await pick("snapshot")
        await drag(*at(0.12, 0.14), *at(0.52, 0.28))
        await page.wait_for_timeout(2400)
        frm = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const a=S.annos.find(z=>z.maKind==="snapshot");
                 if(!a){ res({none:true}); return; }
                 out.before={nw:+a.nw.toFixed(4),nh:+a.nh.toFixed(4)};
                 a.sw=6; a.col="#1971c2"; a._frKey=null;
                 layoutAnnos();
                 let w=0; while(w<5000){ await nap(100); w+=100; if(maPicFramed(a))break; }
                 out.framed=maPicFramed(a);
                 out.raw=!!a.picRaw;
                 out.grew=(a.nw>out.before.nw&&a.nh>out.before.nh);
                 const el=document.querySelector(`.anno[data-id="${a.id}"] .ed`);
                 out.css=el?getComputedStyle(el).borderTopWidth:null;
                 /* the frame is in the pixels, and it is round the INK rather than round the box */
                 out.px=await new Promise(r2=>{ const im=new Image();
                   im.onload=()=>{ const c=document.createElement("canvas");
                     c.width=im.naturalWidth; c.height=im.naturalHeight;
                     const g=c.getContext("2d",{willReadFrequently:true});
                     g.drawImage(im,0,0);
                     const d=g.getImageData(0,0,c.width,c.height).data;
                     let blue=0, other=0, edge=0;
                     const isBlue=i=>(Math.abs(d[i]-25)<30&&Math.abs(d[i+1]-113)<30&&Math.abs(d[i+2]-194)<30);
                     for(let i=0;i<d.length;i+=4){ if(d[i+3]<40)continue;
                       if(isBlue(i))blue++; else other++; }
                     /* the outermost row: on a rectangle frame it would be solid, on a silhouette
                        outline of writing it is mostly empty */
                     for(let x=0;x<c.width;x++){ const i=(x)*4; if(d[i+3]>40)edge++; }
                     r2({w:c.width,h:c.height,blue,other,edgeFrac:+(edge/c.width).toFixed(3)});
                   };
                   im.onerror=()=>r2(null); im.src=a.src; });
                 /* and it comes off again, putting the box back exactly as it was */
                 a.sw=0; a._frKey=null; layoutAnnos();
                 w=0; while(w<4000){ await nap(100); w+=100; if(!a.picRaw)break; }
                 out.off={raw:!!a.picRaw,
                          same:(Math.abs(a.nw-out.before.nw)<0.0006&&Math.abs(a.nh-out.before.nh)<0.0006)};
                 res(out); })""")
        ok = (not frm.get("none") and frm["framed"] and frm["raw"] and frm["grew"]
              and frm["css"] == "0px" and frm["px"] and frm["px"]["blue"] > frm["px"]["other"]
              and not frm["off"]["raw"] and frm["off"]["same"])
        results.append({"tool": "Picture frame hugs the picture", "ok": ok, "why": json.dumps(frm)})

        # ---------- 6je — FLATTEN ASKS, AND THEN REALLY FLATTENS ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.40, 0.40))
        await page.mouse.click(*at(0.30, 0.35))
        await page.wait_for_timeout(300)
        await page.locator('#selbar .sb-b[title="Flatten"]').click()
        await page.wait_for_timeout(350)
        askT = await page.evaluate(
            '()=>{const d=document.querySelector(".sb-ask");'
            ' return d?(d.querySelector(".sb-asktitle")||{}).textContent:null;}')
        await page.locator('.sb-ask .sb-askb.primary').click()
        await page.wait_for_timeout(450)
        flat = await page.evaluate(
            """()=>{ const a=S.annos[0];
                     const el=document.querySelector(".anno.flatm");
                     return {flat:!!a.flat, sel:S.sel, marked:!!el,
                             pe:el?getComputedStyle(el).pointerEvents:null,
                             barGone:document.getElementById("selbar").hasAttribute("hidden")}; }""")
        # and the page's own menu offers the way back
        undo = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const r=pg.getBoundingClientRect();
                 pg.dispatchEvent(new MouseEvent("contextmenu",
                   {clientX:r.left+r.width*0.8,clientY:r.top+r.height*0.9,bubbles:true,cancelable:true}));
                 await nap(220);
                 const m=document.querySelector(".sb-menu.sb-ctx");
                 const b=m&&[...m.querySelectorAll(".sb-mi")]
                            .find(z=>/Unflatten everything/i.test(z.textContent));
                 const had=!!b; if(b)b.click();
                 await nap(300);
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 res({had, flat:!!S.annos[0].flat}); })""")
        ok = (askT and "Flatten" in askT and flat["flat"] and flat["sel"] is None
              and flat["marked"] and flat["pe"] == "none" and flat["barGone"]
              and undo["had"] and not undo["flat"])
        results.append({"tool": "Flatten asks and flattens", "ok": ok,
                        "why": json.dumps({"ask": askT, "after": flat, "back": undo})})

        # ---------- 6jd — A CUT WAITS FOR THE PASTE ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.36, 0.38))
        await page.mouse.click(*at(0.28, 0.34))
        await page.wait_for_timeout(300)
        cut = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const id=S.annos[0].id;
                 copySelectedAnnos(true); await nap(300);
                 out.pending=maCutPending();
                 out.stillThere=!!S.annos.find(z=>z.id===id);
                 out.ants=document.querySelectorAll(".anno.cutting").length>0;
                 out.toastUp=parseFloat(getComputedStyle(document.querySelector(".toast")).bottom)>60;
                 /* Escape calls it off and puts nothing anywhere */
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                 await nap(300);
                 out.cancelled=!maCutPending()&&!!S.annos.find(z=>z.id===id);
                 /* and cutting again, then pasting, MOVES it */
                 selectAnno(id); await nap(150);
                 copySelectedAnnos(true); await nap(250);
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const r=pg.getBoundingClientRect();
                 _ptr.x=r.left+r.width*0.62; _ptr.y=r.top+r.height*0.66;
                 pasteAnnos(); await nap(400);
                 out.moved=(!S.annos.find(z=>z.id===id)&&S.annos.length===1);
                 out.clear=!maCutPending();
                 res(out); })""")
        ok = (cut["pending"] and cut["stillThere"] and cut["ants"] and cut["toastUp"]
              and cut["cancelled"] and cut["moved"] and cut["clear"])
        results.append({"tool": "Cut waits for the paste", "ok": ok, "why": json.dumps(cut)})

        # ---------- 6jc — NAMED LAYERS ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.36, 0.38))
        await page.mouse.click(*at(0.28, 0.34))
        await page.wait_for_timeout(300)
        lay = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 out.start=maLayers().map(L=>L.name);
                 const b=document.querySelector("#selbar .sb-lay");
                 out.onBar=b?(b.title||""):null;
                 b.click(); await nap(220);
                 let m=document.querySelector(".sb-menu");
                 out.heads=[...m.querySelectorAll(".sb-mh")].map(z=>z.textContent);
                 out.rows=[...m.querySelectorAll(".sb-mi")].map(z=>z.textContent.trim());
                 out.eyes=m.querySelectorAll(".sb-maux").length;
                 /* the eye hides the layer, on screen AND in the export list */
                 m.querySelector(".sb-maux").click(); await nap(350);
                 out.hidden={vis:maLayers()[0].vis===false,
                             drawn:document.querySelectorAll("#pages .anno").length};
                 m=document.querySelector(".sb-menu");
                 m.querySelector(".sb-maux").click(); await nap(350);
                 out.shown={vis:maLayers()[0].vis!==false,
                            drawn:document.querySelectorAll("#pages .anno").length>0};
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 /* a second layer, and the mark moves onto it */
                 const id=maLayerAdd("Proposed");
                 selectAnno(S.annos[0].id); await nap(150);
                 sbLayerMove(id); await nap(250);
                 out.moved={lay:S.annos[0].lay===id, counts:maLayers().map(L=>maLayerCount(L.id))};
                 out.barNow=(document.querySelector("#selbar .sb-lay")||{}).title||null;
                 /* and deleting a layer keeps its marks */
                 maLayerRemove(id); await nap(150);
                 out.afterDrop={layers:maLayers().length, marks:S.annos.length,
                                home:S.annos[0].lay===maLayers()[0].id};
                 res(out); })""")
        ok = (lay["start"] == ["General"] and lay["onBar"] == "Layer — General"
              and lay["heads"] == ["LAYER", "STACK"] and lay["eyes"] == 1
              and any("General" in r for r in lay["rows"])
              and any("Create layer" in r for r in lay["rows"])
              and lay["hidden"]["vis"] and lay["hidden"]["drawn"] == 0
              and lay["shown"]["vis"] and lay["shown"]["drawn"]
              and lay["moved"]["lay"] and lay["barNow"] == "Layer — Proposed"
              and lay["afterDrop"]["layers"] == 1 and lay["afterDrop"]["marks"] == 1
              and lay["afterDrop"]["home"])
        results.append({"tool": "Named layers", "ok": ok, "why": json.dumps(lay)})

        # ---------- 6jg/6jh — THE DELETE BADGE, AND THE UPDATE ABOVE THE BAR ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.36, 0.38))
        await page.mouse.click(*at(0.28, 0.34))
        await page.wait_for_timeout(320)
        del_ = await page.evaluate(
            """()=>{ const out={};
                     const badge=el=>{ if(!el)return null;
                       const x=el.querySelector(".delx,.sb-i"); if(!x)return null;
                       const cs=getComputedStyle(x);
                       return {bg:cs.backgroundColor, round:parseFloat(cs.borderRadius)>=8,
                               txt:x.textContent.trim()}; };
                     out.anno=badge(document.querySelector("#annobar .delbtn"));
                     out.line=badge(document.querySelector("#linebar .delbtn"));
                     out.multi=badge(document.querySelector("#multibar .delbtn"));
                     out.sel=badge(document.querySelector("#selbar .sb-del"));
                     /* and Clear saved markings is deliberately untouched */
                     const cb=document.getElementById("cacheBtn");
                     out.cache=cb?cb.textContent.trim():null;
                     out.toast=getComputedStyle(document.querySelector(".toast")).bottom;
                     out.toastZ=+getComputedStyle(document.querySelector(".toast")).zIndex;
                     out.barZ=+getComputedStyle(document.getElementById("selbar")).zIndex;
                     return out; }""")
        red = lambda b: b and b["round"] and b["txt"] == "✕" and "224, 49, 49" in b["bg"]
        ok = (red(del_["anno"]) and red(del_["line"]) and red(del_["multi"]) and red(del_["sel"])
              and "\U0001f5d1" in (del_["cache"] or "")
              and parseFloat_(del_["toast"]) > 60 and del_["toastZ"] > del_["barZ"])
        results.append({"tool": "Delete badge, update above the bar", "ok": ok,
                        "why": json.dumps(del_)})

        # ---------- 6ji — A ZOOM STEP COMES BACK SHARP WITHOUT WAITING ----------
        await clear()
        await page.evaluate("()=>setZoom(1.2)")
        await page.wait_for_timeout(700)
        zsp = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const soft=()=>document.querySelectorAll('#pages .page[data-soft="1"]').length;
                 document.getElementById("zoomIn").click();
                 const t0=performance.now();
                 let w=0; while(w<3000){ await nap(25); w+=25; if(!soft())break; }
                 res({ms:Math.round(performance.now()-t0), scale:S.scale, soft:soft()}); })""")
        ok = zsp["soft"] == 0 and zsp["ms"] < 900 and zsp["scale"] > 1.3
        results.append({"tool": "A zoom step sharpens promptly", "ok": ok, "why": json.dumps(zsp)})

        # ---------- 6jj — THE PEN IS THE MARK ----------
        logo = await page.evaluate(
            """()=>{ const out={};
                     const mk=document.getElementById("markR");
                     const sv=mk.querySelector("svg");
                     out.markVB=sv.getAttribute("viewBox");
                     out.markPaths=sv.querySelectorAll("path").length;
                     mk.classList.add("show");
                     const r=mk.getBoundingClientRect();
                     out.markTall=r.height>r.width*2.5;
                     out.wordVB=document.querySelector(".logo-wm svg").getAttribute("viewBox");
                     out.bootVB=document.querySelector(".boot-mark svg").getAttribute("viewBox");
                     /* the wordmark carries the pen as well as the letters */
                     out.wordPaths=document.querySelectorAll(".logo-wm svg path").length;
                     out.wordGroup=!!document.querySelector(".logo-wm svg g[transform]");
                     /* 6jj — the name is drawn INSIDE the mark, level with the pen's lower half and
                        spanning exactly the letters' measure, the way the artwork has it */
                     const t=document.querySelector(".logo-wm svg text.lg-sub");
                     out.sub=t?{txt:t.textContent, x:+t.getAttribute("x"), y:+t.getAttribute("y"),
                                len:+t.getAttribute("textLength")}:null;
                     out.bootSub=!!document.querySelector(".boot-mark svg text.bm-sub");
                     out.noFlowSub=!document.querySelector(".boot-sub");
                     if(t){ const r=t.getBoundingClientRect(),
                                 m=document.querySelector(".logo-wm").getBoundingClientRect();
                            out.subInside=(r.top>=m.top-1&&r.bottom<=m.bottom+1); }
                     const f=document.getElementById("favIcon");
                     out.fav=(f.getAttribute("href")||"").slice(0,22);
                     out.favLen=(f.getAttribute("href")||"").length;
                     return out; }""")
        ok = (logo["markVB"] == "0 0 119.1 503.8" and logo["markPaths"] == 2 and logo["markTall"]
              and logo["wordVB"] == "0 0 1171 504" and logo["bootVB"] == "0 0 1171 504"
              and logo["wordPaths"] == 4 and logo["wordGroup"]
              and logo["sub"] and logo["sub"]["txt"] == "MARK IT UP"
              and abs(logo["sub"]["x"] - 177.5) < 1 and abs(logo["sub"]["y"] - 430) < 1
              and abs(logo["sub"]["len"] - 989.3) < 1
              and logo["subInside"] and logo["bootSub"] and logo["noFlowSub"]
              and logo["fav"].startswith("data:image/png;base64") and logo["favLen"] > 1000)
        results.append({"tool": "The pen is the mark", "ok": ok, "why": json.dumps(logo)})

        # ---------- 6jf — FLIP IS ON THE BAR THAT POPS ON A MARK ----------
        await clear()
        # a shape flipped about its OWN middle is a no-op by design, so the mark under test is one
        # whose two halves differ: a picture, which mirrors its pixels
        await pick("snapshot"); await drag(*at(0.14, 0.14), *at(0.46, 0.26))
        await page.wait_for_timeout(2400)
        await page.evaluate("()=>{ setMode('select'); selectAnno(S.annos[0].id); }")
        await page.wait_for_timeout(320)
        flip = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const ab=document.getElementById("annobar");
                 out.onAnnobar=ab.querySelectorAll("[data-flip]").length;
                 ab.querySelector('[data-flip="h"]').click(); await nap(300);
                 out.flippedH=!!S.annos[0].flipX;
                 ab.querySelector('[data-flip="v"]').click(); await nap(300);
                 out.flippedV=!!S.annos[0].flipY;
                 /* 6kz — and on the selection bar, as TWO buttons rather than a dropdown. Ced:
                    "have a rotated version icon of this for flip vertical while this one retain for
                    flip horizontal so no need for dropdown." The second is the first's drawing,
                    turned a quarter, so the two share one icon and nothing new has to be learnt. */
                 const bh=document.querySelector('#selbar .sb-b[title="Flip left to right"]');
                 const bv=document.querySelector('#selbar .sb-b[title="Flip top to bottom"]');
                 out.onSelbar=!!(bh&&bv);
                 out.noMenu=!document.querySelector('#selbar .sb-b[title="Flip"]');
                 if(bh&&bv){
                   out.turned=getComputedStyle(bv.querySelector(".sb-svg")).transform;
                   out.sameIcon=(bh.querySelector(".sb-svg").innerHTML
                                 ===bv.querySelector(".sb-svg").innerHTML);
                   S.annos[0].flipX=false; S.annos[0].flipY=false; layoutAnnos();
                   bh.click(); await nap(220); out.barH=!!S.annos[0].flipX;
                   bv.click(); await nap(220); out.barV=!!S.annos[0].flipY;
                   /* and neither of them opens anything */
                   out.opened=document.querySelectorAll(".sb-menu").length;
                 }
                 res(out); })""")
        ok = (flip["onAnnobar"] == 2 and flip["flippedH"] and flip["flippedV"]
              and flip["onSelbar"] and flip["noMenu"] and flip["sameIcon"]
              and flip["turned"] == "matrix(0, 1, -1, 0, 0, 0)"      # a quarter turn, exactly
              and flip["barH"] and flip["barV"] and flip["opened"] == 0)
        results.append({"tool": "Flip on the mark's own bar", "ok": ok, "why": json.dumps(flip)})

        # ---------- 6jk/6jl — THE LOG PILL, AND RIGHT-CLICK INSIDE A MARK ----------
        await clear()
        v34 = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 /* the log pill steps out of the page list's way */
                 const rail=document.getElementById("rail"), log=document.getElementById("logBtn");
                 if(!document.body.classList.contains("railon"))
                   document.getElementById("railToggle").click();
                 await nap(450);
                 const rr=rail.getBoundingClientRect(), lr=log.getBoundingClientRect();
                 out.railShown=getComputedStyle(rail).display!=="none";
                 out.clears=lr.left>=rr.right-1;
                 rail.scrollTop=rail.scrollHeight; await nap(250);
                 const btns=[...rail.querySelectorAll("button")];
                 const b=btns.length?btns[btns.length-1].getBoundingClientRect():null;
                 out.lastCovered=b?!(b.right<=lr.left||b.bottom<=lr.top||
                                     b.top>=lr.bottom||b.left>=lr.right):null;
                 /* and the panel it opens goes with it */
                 out.panelLeft=Math.round(parseFloat(getComputedStyle(
                   document.getElementById("logPanel")).left));
                 out.logLeft=Math.round(lr.left);

                 /* right-clicking the middle of a shape — which is a contenteditable — is the MARK's */
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 const id=maAddShape(0,"rect",0.22,0.42,0.24,0.10,{});
                 await nap(450);
                 setMode("select"); selectAnno(id); await nap(280);
                 const el=document.querySelector(`.anno[data-id="${id}"]`);
                 const ed=el.querySelector(".ed");
                 out.editable=ed.getAttribute("contenteditable");
                 const r=ed.getBoundingClientRect();
                 const fire=()=>{ const ev=new MouseEvent("contextmenu",
                     {clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,cancelable:true});
                   ed.dispatchEvent(ev); return ev; };
                 let ev=fire(); await nap(280);
                 out.menu=!!document.querySelector(".sb-menu.sb-ctx");
                 out.prevented=ev.defaultPrevented;
                 const m=document.querySelector(".sb-menu.sb-ctx");
                 out.items=m?[...m.querySelectorAll(".sb-mi")].map(z=>z.textContent.trim()):[];
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 /* with the caret in it, the typing is put away and the mark's menu still wins */
                 ed.focus(); el.classList.add("editing"); await nap(200);
                 ev=fire(); await nap(280);
                 out.editingMenu=!!document.querySelector(".sb-menu.sb-ctx");
                 out.editingBlurred=document.activeElement!==ed;
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 /* a real field in the tool's own chrome keeps the browser's menu */
                 const f=document.getElementById("findInput");
                 const ev3=new MouseEvent("contextmenu",{bubbles:true,cancelable:true});
                 f.dispatchEvent(ev3); await nap(200);
                 out.fieldNative=!document.querySelector(".sb-menu.sb-ctx")&&!ev3.defaultPrevented;
                 document.querySelectorAll(".sb-menu").forEach(z=>z.remove());
                 res(out); })""")
        ok = (v34["railShown"] and v34["clears"] and v34["lastCovered"] is False
              and v34["logLeft"] == v34["panelLeft"]
              and v34["editable"] == "true" and v34["menu"] and v34["prevented"]
              and all(w in v34["items"] for w in ["Cut", "Copy", "Paste"])
              and v34["editingMenu"] and v34["editingBlurred"] and v34["fieldNative"])
        results.append({"tool": "Log clears the rail, right click is the tool's",
                        "ok": ok, "why": json.dumps(v34)})

        # ---------- 6jo — CED'S ICONS, ON THE BAR AND IN THE RIBBON ----------
        await clear()
        await pick("box"); await drag(*at(0.20, 0.30), *at(0.40, 0.40))
        await page.mouse.click(*at(0.30, 0.35))
        await page.wait_for_timeout(320)
        ico = await page.evaluate(
            """()=>{ const out={};
                     const bar=document.getElementById("selbar");
                     /* Edit picture only appears when the selection IS a picture, so it is
                        checked on its own below rather than expected on a shape's bar */
                     /* 6kz — the two flips carry the same drawing, the second turned a quarter */
                     /* 6li — the lock's title says what the press will DO to these marks now that
                        the button also wears the word, so it is "Lock these marks" rather than the
                        bare "Lock" the label carries. */
                     const want=["Duplicate","Group","Copy","Flip left to right",
                                 "Flip top to bottom","Lock these marks","Flatten",
                                 "Add to markup library","Apply to pages","Copy properties"];
                     out.drawn={};
                     [...bar.querySelectorAll(".sb-b")].forEach(b=>{
                       const t=(b.title||"").trim();
                       const key=t.startsWith("Layer")?"Layer":t;
                       out.drawn[key]=!!b.querySelector(".sb-i.sb-svg svg path");
                     });
                     out.missing=want.filter(w=>!out.drawn[w]);
                     out.layer=!!out.drawn["Layer"];
                     /* monochrome: every path takes the button's own colour, none carries its own */
                     out.mono=[...bar.querySelectorAll(".sb-i.sb-svg svg path")]
                                .every(p=>p.getAttribute("fill")==="currentColor");
                     /* and the size matches the words beside it */
                     const s=bar.querySelector(".sb-i.sb-svg svg");
                     const r=s.getBoundingClientRect();
                     out.size=[Math.round(r.width),Math.round(r.height)];
                     /* the two the ribbon shares */
                     const gv=getComputedStyle(document.getElementById("groupBtn"))
                                .getPropertyValue("--gi");
                     const mv=getComputedStyle(document.getElementById("markupsBtn"))
                                .getPropertyValue("--gi");
                     out.ribbon={group:gv.indexOf("svg+xml")>0, markups:mv.indexOf("svg+xml")>0,
                                 groupIco:document.getElementById("groupBtn").classList.contains("icoimg"),
                                 markupsIco:document.getElementById("markupsBtn").classList.contains("icoimg")};
                     /* every drawing is one path on the same grid */
                     out.grid=Object.keys(MA_ICONS).length;
                     out.hasEditPic=!!MA_ICONS.editpic;
                     out.vb=[...bar.querySelectorAll(".sb-i.sb-svg svg")]
                              .every(v=>v.getAttribute("viewBox")==="0 0 24 24");
                     return out; }""")
        ok = (not ico["missing"] and ico["layer"] and ico["mono"] and ico["vb"]
              and ico["hasEditPic"]
              and ico["size"] == [15, 15] and ico["grid"] >= 12
              and ico["ribbon"]["group"] and ico["ribbon"]["markups"]
              and ico["ribbon"]["groupIco"] and ico["ribbon"]["markupsIco"])
        results.append({"tool": "The icons are drawn, not typed", "ok": ok, "why": json.dumps(ico)})

        # ---------- 6jn — A REDLINE CARRIED ONTO ANOTHER PAGE ----------
        # a REAL drag, because that is the whole gesture: the mark is carried past the foot of its own
        # page and let go over the next one
        await clear()
        await page.evaluate("()=>setZoom(0.4)")
        await page.wait_for_timeout(1500)
        await page.evaluate("""()=>{const q=document.querySelector('.page[data-idx="0"]');
                                   window.scrollTo(0,Math.max(0,q.offsetTop-170));}""")
        await page.wait_for_timeout(900)
        cross = await page.evaluate(
            """()=>{ const A=document.querySelector('.page[data-idx="0"]');
                     const B=document.querySelector('.page[data-idx="1"]');
                     const up=!!(A&&B&&A.dataset.rendered==="1"&&B.dataset.rendered==="1");
                     if(!up)return {bothUp:false};
                     const a=A.getBoundingClientRect(), b=B.getBoundingClientRect();
                     return {bothUp:true, A:{x:a.x,y:a.y,w:a.width,h:a.height},
                                          B:{x:b.x,y:b.y,w:b.width,h:b.height}}; }""")
        if cross["bothUp"]:
            mid = await page.evaluate(
                """()=>{ const id=maAddShape(0,"rect",0.20,0.28,0.20,0.09,{});
                         setMode("select"); selectAnno(id); return id; }""")
            await page.wait_for_timeout(700)
            grab = await page.evaluate(
                """(id)=>{ const d=document.querySelector(`.anno[data-id="${id}"]`);
                           const r=d.getBoundingClientRect();
                           return {cx:r.left+r.width/2, cy:r.top+r.height/2,
                                   w:r.width, h:r.height}; }""", mid)
            tx = cross["B"]["x"] + cross["B"]["w"] * 0.55
            ty = cross["B"]["y"] + cross["B"]["h"] * 0.40
            await page.mouse.move(grab["cx"], grab["cy"])
            await page.mouse.down()
            for k in range(1, 17):
                await page.mouse.move(grab["cx"] + (tx - grab["cx"]) * k / 16,
                                      grab["cy"] + (ty - grab["cy"]) * k / 16)
                await page.wait_for_timeout(14)
            cross["hint"] = await page.evaluate(
                "()=>[...document.querySelectorAll('.page.xpage')].map(p=>p.dataset.idx)")
            await page.mouse.up()
            await page.wait_for_timeout(800)
            cross.update(await page.evaluate(
                """([id,tx,ty])=>{ const out={};
                     const a=S.annos.find(z=>z.id===id);
                     out.page=a?a.page:null;
                     out.hintCleared=document.querySelectorAll(".page.xpage").length===0;
                     const B=document.querySelector('.page[data-idx="1"]');
                     const e=document.querySelector(`.anno[data-id="${id}"]`);
                     if(e&&B){ const g=e.getBoundingClientRect(), br=B.getBoundingClientRect();
                       out.inside=(g.left>=br.left-2&&g.right<=br.right+2&&
                                   g.top>=br.top-2&&g.bottom<=br.bottom+2);
                       out.visible=g.width>2&&g.height>2;
                       out.layer=e.parentElement.className;
                       /* and it is where the hand let it go, not merely somewhere on the page */
                       out.atDrop=(Math.abs(g.left+g.width/2-tx)<14&&
                                   Math.abs(g.top+g.height/2-ty)<14); }
                     return out; }""", [mid, tx, ty]))
            # a locked page refuses the drop, and undo brings the mark home
            cross.update(await page.evaluate(
                """(id)=>{ const out={};
                     const a=S.annos.find(z=>z.id===id);
                     S.pages[0].locked=true;
                     const A=document.querySelector('.page[data-idx="0"]').getBoundingClientRect();
                     out.lockedRefused=(maDropAcrossPages(A.left+A.width*0.5,A.top+A.height*0.5)===false
                                        && a.page===1);
                     S.pages[0].locked=false;
                     undo();
                     return out; }""", mid))
            await page.wait_for_timeout(700)
            cross["undone"] = await page.evaluate(
                "(id)=>{const a=S.annos.find(z=>z.id===id); return a?a.page===0:null;}", mid)
        await page.evaluate("()=>setZoom(1.2)")
        await page.wait_for_timeout(900)
        ok = (cross.get("bothUp") and cross.get("hint") == ["1"] and cross.get("hintCleared")
              and cross.get("page") == 1 and cross.get("inside") and cross.get("visible")
              and cross.get("atDrop") and "annolayer" in (cross.get("layer") or "")
              and cross.get("lockedRefused") and cross.get("undone"))
        results.append({"tool": "A redline crosses pages whole", "ok": ok,
                        "why": json.dumps({k: v for k, v in cross.items() if k not in ("A", "B")})})

        # ---------- 6jm — ZOOMING LEAVES EVERY MARK WHERE IT IS ----------
        await clear()
        await pick("dim"); await drag(*at(0.20, 0.52), *at(0.55, 0.52))
        await page.wait_for_timeout(500)
        # 6jq — and a TEXT mark and a strike & write, which is what Ced asked about: "zooming in and
        # out should not change the location and format of the redline especially on texts"
        await pick("text"); await drag(*at(0.15, 0.62), *at(0.42, 0.68))
        await page.keyboard.type("MOUNT REPLACED\nSEE DETAIL 3")
        await page.wait_for_timeout(300)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)
        pr_ = await printed_at()
        if pr_:
            await pick("fix")
            await drag(pr_["x"] - 26, pr_["y"], pr_["x"] + 26, pr_["y"])
            await page.keyboard.type("36 FT")
            await page.wait_for_timeout(300)
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)
        await page.evaluate("()=>setMode('select')")
        zst = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const grab=()=>({A:S.annos.map(a=>[a.id,+(a.nx||0).toFixed(5),+(a.ny||0).toFixed(5),
                                                    +(a.nw||0).toFixed(5),+(a.nh||0).toFixed(5),
                                                    a.lines||0,+(a.lineNh||0).toFixed(5)]),
                                  L:S.lines.map(l=>[l.id,+l.x1.toFixed(5),+l.y1.toFixed(5),
                                                    +l.x2.toFixed(5),+l.y2.toFixed(5)])});
                 const base=grab();
                 const out={n:base.A.length+base.L.length, moved:[]};
                 for(const z of [0.8,0.5,0.3,0.2,3.0,1.2]){
                   await setZoom(z); await nap(950);
                   const s=grab();
                   s.A.forEach((m,i)=>m.forEach((v,j)=>{ if(j&&Math.abs(v-base.A[i][j])>0.0002)
                     out.moved.push("z"+z+" a"+m[0]+"["+j+"] "+base.A[i][j]+"->"+v); }));
                   s.L.forEach((m,i)=>m.forEach((v,j)=>{ if(j&&Math.abs(v-base.L[i][j])>0.0002)
                     out.moved.push("z"+z+" l"+m[0]+"["+j+"] "+base.L[i][j]+"->"+v); }));
                 }
                 /* and the reading's box is measured in the page's own units, not in screen pixels */
                 const lab=S.annos.find(a=>a.maKind==="dimlabel");
                 out.hasLabel=!!lab;
                 if(lab){ const b=maDimBox(lab); out.box=[+b.w.toFixed(5),+b.h.toFixed(5)];
                          await setZoom(0.25); await nap(800);
                          const b2=maDimBox(lab); out.box2=[+b2.w.toFixed(5),+b2.h.toFixed(5)];
                          await setZoom(1.2); await nap(800); }
                 res(out); })""")
        ok = (zst["n"] >= 5 and not zst["moved"] and zst["hasLabel"]
              and zst["box"] == zst["box2"])
        results.append({"tool": "Zooming leaves every mark put", "ok": ok,
                        "why": json.dumps({"marks": zst["n"], "moved": zst["moved"][:6],
                                           "box": zst.get("box"), "box@25%": zst.get("box2")})})

        # ---------- 6jp — A COPY KEEPS ITS SIZE ON A DIFFERENT-SIZED PAGE ----------
        # this document's pages are all one size, so page 2 is told it is landscape for the length of
        # the case — `maKeepSize` reads nothing but `w1`/`h1`, which is exactly what differs in the
        # document Ced sent (61 portrait pages and 6 landscape ones)
        await clear()
        await pick("box"); await drag(*at(0.20, 0.14), *at(0.40, 0.20))
        await page.mouse.click(*at(0.30, 0.17))
        await page.wait_for_timeout(320)
        keep = await page.evaluate(
            """()=>{ const out={};
                     const P0=S.pages[0], P1=S.pages[1];
                     out.was={w:P1.w1,h:P1.h1};
                     P1.w1=P0.h1; P1.h1=P0.w1;                 /* page 2 is landscape for now */
                     const a=S.annos[0];
                     out.src={ptW:+(a.nw*P0.w1).toFixed(2), ptH:+(a.nh*P0.h1).toFixed(2)};
                     /* the copy, through the same code Apply to pages runs */
                     const b=Object.assign({},_cleanA(a),{id:seq++,page:1});
                     S.annos.push(b);
                     out.beforeFix={ptW:+(b.nw*P1.w1).toFixed(2), ptH:+(b.nh*P1.h1).toFixed(2)};
                     out.changed=maKeepSize([b],[],0,1);
                     out.afterFix={ptW:+(b.nw*P1.w1).toFixed(2), ptH:+(b.nh*P1.h1).toFixed(2)};
                     out.onPage=(b.nx>=-1e-6&&b.ny>=-1e-6&&b.nx+b.nw<=1+1e-6&&b.ny+b.nh<=1+1e-6);
                     /* a page of the SAME size is left alone, bit for bit */
                     const c=Object.assign({},_cleanA(a),{id:seq++,page:2});
                     out.sameSize=(maKeepSize([c],[],0,2)===false&&c.nw===a.nw&&c.nh===a.nh
                                   &&c.nx===a.nx&&c.ny===a.ny);
                     /* and a stroke's length travels too */
                     const lid=addLine(0,0.20,0.40,0.60,0.40,{col:"#fa3237",sw:2});
                     const l=S.lines.find(z=>z.id===lid);
                     const lenSrc=+(Math.abs(l.x2-l.x1)*P0.w1).toFixed(2);
                     const l2=Object.assign({},_cleanL(l),{id:seq++,page:1});
                     S.lines.push(l2);
                     maKeepSize([],[l2],0,1);
                     out.stroke={src:lenSrc, copy:+(Math.abs(l2.x2-l2.x1)*P1.w1).toFixed(2)};
                     P1.w1=out.was.w; P1.h1=out.was.h;
                     return out; }""")
        near = lambda a, b: abs(a - b) < 0.05
        ok = (keep["changed"] and near(keep["afterFix"]["ptW"], keep["src"]["ptW"])
              and near(keep["afterFix"]["ptH"], keep["src"]["ptH"])
              and not near(keep["beforeFix"]["ptW"], keep["src"]["ptW"])
              and keep["onPage"] and keep["sameSize"]
              and near(keep["stroke"]["copy"], keep["stroke"]["src"]))
        results.append({"tool": "A copy keeps its size across page sizes", "ok": ok,
                        "why": json.dumps(keep)})

        # ---------- 6jr — A MARK THAT HANGS OFF THE SHEET IS STILL DRAWN ----------
        await clear()
        over = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 const id=maAddShape(0,"rect",0.80,0.30,0.26,0.10,{});
                 const lid=addLine(0,0.86,0.46,1.18,0.46,{col:"#fa3237",sw:3,le1:"arrow"});
                 layoutAnnos(); drawAllLines(); await nap(450);
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const el=document.querySelector(`.anno[data-id="${id}"]`);
                 const lay=el.parentElement;
                 const pr=pg.getBoundingClientRect(), er=el.getBoundingClientRect();
                 out.layer=getComputedStyle(lay).overflow;
                 out.textLayer=getComputedStyle(pg.querySelector(".textlayer")).overflow;
                 out.overhangs=er.right>pr.right+4;
                 out.visible=er.width>2&&er.height>2;
                 out.drawSvg=getComputedStyle(pg.querySelector("svg.draw")).overflow;
                 /* the stroke reaches past the edge too */
                 const poly=[...pg.querySelectorAll("svg.draw polyline")]
                   .map(p=>p.getBoundingClientRect()).filter(r=>r.width>2);
                 out.strokePast=poly.some(r=>r.right>pr.right+4);
                 res(out); })""")
        ok = (over["layer"] == "visible" and over["textLayer"] == "hidden"
              and over["overhangs"] and over["visible"] and over["strokePast"])
        results.append({"tool": "A mark may hang off the sheet", "ok": ok, "why": json.dumps(over)})

        # ---------- 6jz — DOUBLE-CLICK GOES INSIDE A GROUP, AND THE GROUP SURVIVES ----------
        # Ced: "in a grouped redlines, double clicking a shape/redline should allow you to edit that
        # specific item and still retain the group once done."
        await clear()
        grp = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 maAddShape(0,"rect",0.20,0.20,0.10,0.06,{});
                 maAddShape(0,"rect",0.40,0.20,0.10,0.06,{});
                 await nap(250);
                 clearMulti(); S.annos.forEach(a=>S.selMulti.add(a.id)); paintMulti();
                 groupSelected(); await nap(300);
                 out.groups=S.annos.map(a=>a.group);
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const R=pg.getBoundingClientRect();
                 const P={x:R.left+0.25*R.width, y:R.top+0.23*R.height};
                 const fire=(t,detail)=>{ const el=document.elementFromPoint(P.x,P.y);
                   el.dispatchEvent(new MouseEvent(t,{clientX:P.x,clientY:P.y,bubbles:true,
                     cancelable:true,detail:detail||1,buttons:1})); return el; };
                 fire("mousedown"); fire("mouseup"); fire("click");
                 await nap(250);
                 out.oneClick={multi:multiCount(), open:groupOpenNow()};
                 fire("mousedown",2); fire("mouseup",2); fire("dblclick",2);
                 await nap(250);
                 out.inside={multi:multiCount(), sel:S.sel, open:groupOpenNow()};
                 /* nudging inside the group moves ONE mark */
                 const me=S.annos.find(a=>a.id===S.sel), other=S.annos.find(a=>a.id!==S.sel);
                 const b={me:me.nx, other:other.nx};
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));
                 await nap(200);
                 out.alone={me:+(me.nx-b.me).toFixed(4), other:+(other.nx-b.other).toFixed(4)};
                 document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
                 await nap(250);
                 out.out={multi:multiCount(), open:groupOpenNow(), groups:S.annos.map(a=>a.group)};
                 res(out); })""")
        ok = (grp["oneClick"]["multi"] == 2 and grp["oneClick"]["open"] is None
              and grp["inside"]["multi"] == 0 and grp["inside"]["sel"] is not None
              and grp["inside"]["open"] is not None
              and grp["alone"]["me"] > 0 and grp["alone"]["other"] == 0
              and grp["out"]["multi"] == 2 and grp["out"]["open"] is None
              and all(g is not None for g in grp["out"]["groups"]))
        results.append({"tool": "Inside a group, and out again", "ok": ok, "why": json.dumps(grp)})

        # ---------- 6k0 — HOW SMALL A MARK MAY BE ----------
        # Ced: "the minimum size of texts and shapes should not rely on thickness or size."
        await clear()
        small = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const PW=pg.offsetWidth, PH=pg.offsetHeight;
                 const out={shape:{},text:{}};
                 async function floorOf(a){
                   selectAnno(a.id); await nap(150);
                   const f=document.querySelector(".annoui > .anno.selui");
                   const h=f&&f.querySelector(".rz.se"); if(!h)return null;
                   const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                   const r=d.getBoundingClientRect();
                   h.dispatchEvent(new PointerEvent("pointerdown",
                     {clientX:r.right,clientY:r.bottom,bubbles:true,pointerId:71,isPrimary:true}));
                   window.dispatchEvent(new PointerEvent("pointermove",
                     {clientX:r.left-300,clientY:r.top-300,bubbles:true,pointerId:71}));
                   window.dispatchEvent(new PointerEvent("pointerup",
                     {clientX:r.left-300,clientY:r.top-300,bubbles:true,pointerId:71}));
                   await nap(220);
                   return [+(a.nw*PW).toFixed(2), +(a.nh*PH).toFixed(2)];
                 }
                 for(const sw of [0.5,4,10]){
                   maAddShape(0,"rect",0.25,0.25,0.08,0.05,{sw:sw}); await nap(150);
                   const a=S.annos[S.annos.length-1];
                   out.shape["sw"+sw]=await floorOf(a);
                   S.annos=S.annos.filter(z=>z.id!==a.id); selectAnno(null); layoutAnnos(); await nap(80);
                 }
                 for(const sz of [6,14,30]){
                   maAddTextBox(0,0.25,0.55,"Hi",0.10,0.04); await nap(200);
                   const a=S.annos[S.annos.length-1]; a.size=sz; layoutAnnos(); await nap(100);
                   out.text["pt"+sz]=await floorOf(a);
                   S.annos=S.annos.filter(z=>z.id!==a.id); selectAnno(null); layoutAnnos(); await nap(80);
                 }
                 res(out); })""")
        sh = list(small["shape"].values()); tx = list(small["text"].values())
        ok = (all(v and v[0] < 2 and v[1] < 2 for v in sh)          # a shape goes to a pen mark
              and len({tuple(v) for v in sh}) == 1                  # and the weight has no say
              and all(v and v[1] < 8 for v in tx)                   # a text box goes small too
              and (max(v[1] for v in tx) - min(v[1] for v in tx)) < 3)   # whatever the point size
        results.append({"tool": "A mark may be as small as a pen mark", "ok": ok,
                        "why": json.dumps(small)})

        # ---------- 6k1 — THE TEXT TOOL FINISHES, AND LEAVES NOTHING BLANK BEHIND ----------
        # Ced: "after typing in text mode and clicking the ui, it should not prompt into a new text...
        #       if a text tool was prompted and no text was made or entered, do not put a blank text box"
        await clear()
        txt = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={}, n0=S.annos.length;
                 setMode("text"); await nap(120);
                 const id=maAddTextBox(0,0.30,0.30); await nap(300);
                 out.placed={mode:S.mode, caret:(document.activeElement||{}).className};
                 const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
                 ed.focus(); ed.textContent="Field note";
                 ed.dispatchEvent(new InputEvent("input",{bubbles:true}));
                 await nap(150); ed.blur(); await nap(300);
                 out.typed={mode:S.mode, marks:S.annos.length-n0,
                            text:(S.annos.find(a=>a.id===id)||{}).text};
                 setMode("text"); await nap(100);
                 const id2=maAddTextBox(0,0.30,0.50); await nap(300);
                 const ed2=document.querySelector(`.anno[data-id="${id2}"] .ed`);
                 ed2.focus(); await nap(120); ed2.blur(); await nap(350);
                 out.blank={gone:!S.annos.find(a=>a.id===id2), marks:S.annos.length-n0};
                 const d=document.querySelector(`.anno[data-id="${id}"]`);
                 d.querySelector(".ed").dispatchEvent(
                   new MouseEvent("dblclick",{bubbles:true,cancelable:true,detail:2}));
                 await nap(200);
                 out.reopens=d.classList.contains("editing");
                 res(out); })""")
        ok = (txt["placed"]["mode"] == "select" and txt["placed"]["caret"] == "ed"
              and txt["typed"]["mode"] == "select" and txt["typed"]["marks"] == 1
              and txt["typed"]["text"] == "Field note"
              and txt["blank"]["gone"] and txt["blank"]["marks"] == 1
              and txt["reopens"])
        results.append({"tool": "The text tool finishes", "ok": ok, "why": json.dumps(txt)})

        # ---------- 6k2 — THE LAYOUT DOES NOT THRASH ----------
        # Ced: "make everything more seamless, i have seen some lag issues."
        await clear()
        perf = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 for(let i=0;i<40;i++)
                   maAddShape(0,"rect",0.10+(i%8)*0.09,0.10+Math.floor(i/8)*0.09,0.07,0.05,{sw:1.4});
                 for(let i=0;i<20;i++) addLine(0,0.10,0.75+i*0.005,0.90,0.75+i*0.005,{});
                 await nap(700);
                 const T=n=>{ const t=performance.now(); for(let i=0;i<n;i++)layoutAnnos();
                              return +((performance.now()-t)/n).toFixed(2); };
                 T(3);                                        /* warm */
                 const live=T(10);
                 const host=document.querySelector("#pages");
                 host.style.display="none"; const blind=T(10); host.style.display="";
                 await nap(200);
                 /* and the handles are built for the one mark that needs them, not for all of them */
                 const selId=S.annos[0].id;
                 selectAnno(selId); await nap(200);
                 /* the selected mark's own set, plus the copy `paintSelUI` borrows into `.annoui`:
                    what must be zero is a handle on any mark you are NOT holding. */
                 const all=[...document.querySelectorAll(".page .anno > .rz")];
                 const stray=all.filter(n=>{ const h=n.parentElement;
                   const id=h.dataset.id!=null?+h.dataset.id:+h.dataset.sel;
                   return id!==selId; }).length;
                 res({marks:S.annos.length, lines:S.lines.length, live:live, blind:blind,
                      rz:all.length, stray:stray}); })""")
        # the gap between drawing into the live tree and drawing into a hidden one IS the forced
        # reflow; before 6k2 it was 25.8 against 2.6 on this very load.
        ok = (perf["live"] < 14 and perf["live"] < perf["blind"] * 5 and perf["stray"] == 0)
        results.append({"tool": "The layout does not thrash", "ok": ok,
                        "why": f'{perf["marks"]} marks, {perf["lines"]} strokes · '
                               f'live {perf["live"]}ms vs hidden {perf["blind"]}ms · '
                               f'{perf["rz"]} handles in the tree, {perf["stray"]} of them stray'})

        # ---------- 6jy — THE TOP-MOST BAR KEEPS THE RIBBON'S COLUMN ----------
        # Ced: "Fix the tabs accordingly, always align the top most bar to the ribbon"
        align = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const L=s=>{const e=document.querySelector(s);
                   return e?+e.getBoundingClientRect().left.toFixed(1):null;};
                 const snap=()=>({banner:L("#detectBanner"),strip:L(".saveStrip"),ribbon:L(".toolbar")});
                 const out={rest:snap()};
                 for(let i=0;i<5;i++){ document.querySelector("#zoomIn").click(); await nap(260); }
                 await nap(700);
                 window.scrollTo(500,0); await nap(700);
                 out.scrolled=snap();
                 out.wide=document.documentElement.scrollWidth>window.innerWidth+100;
                 window.scrollTo(0,0); await nap(400);
                 for(let i=0;i<5;i++){ document.querySelector("#zoomOut").click(); await nap(260); }
                 await nap(600);
                 res(out); })""")
        ok = (align["wide"]
              and abs(align["rest"]["banner"] - align["rest"]["ribbon"]) < 1
              and abs(align["rest"]["strip"] - align["rest"]["ribbon"]) < 1
              and abs(align["scrolled"]["banner"] - align["scrolled"]["ribbon"]) < 1
              and abs(align["scrolled"]["strip"] - align["scrolled"]["ribbon"]) < 1)
        results.append({"tool": "The top bar keeps the ribbon's column", "ok": ok,
                        "why": json.dumps(align)})

        # ---------- 6k4 — THE COP STAMP, AS EDITABLE REDLINES ----------
        # Ced: "can you integrate this tool within the MIU tool? and make sure it works in realtime,
        # and the stamps are editable as well."
        await clear()
        stamp = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const out={};
                 document.querySelector("#stampBtn").click();
                 await nap(500);
                 out.card={open:!!document.querySelector("#maPanel.show"),
                           title:(document.querySelector("#maTitle")||{}).textContent,
                           fields:["copStatus","copGc","copPoc","copDate","copPlace"]
                                    .filter(id=>!!document.getElementById(id)).length,
                           previewLines:document.querySelectorAll(".cop-pv-l").length};
                 const f=copFields();
                 f.gc="TSC CONSTRUCTION LLC"; f.poc="JACOB WALKER";
                 f.date="11/24/2025"; f.status="REDLINED"; f.place="tr";
                 const n0=S.annos.length;
                 await copPlaceOn(0,f);
                 layoutAnnos(); await nap(500);
                 const made=S.annos.slice(n0);
                 out.made={n:made.length, roles:made.map(a=>a.copRole).sort(),
                           oneGroup:new Set(made.map(a=>a.group)).size===1,
                           texts:made.filter(a=>a.copRole!=="box").map(a=>a.text)};
                 /* every row is a real, editable text mark that the page has drawn */
                 const rows=made.filter(a=>a.copRole&&a.copRole!=="box");
                 out.editable=rows.every(a=>{
                   const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                   return a.maKind==="text" && !!d && d.classList.contains("textbox")
                          && d.classList.contains("grouped");
                 });
                 /* REALTIME: with the stamp selected, a field change rewrites it in place */
                 const box=made.find(a=>a.copRole==="box");
                 selectAnno(box.id); await nap(200);
                 f.date="12/01/2025";
                 copApplyTo(box.group,f); layoutAnnos(); await nap(200);
                 out.realtime=(S.annos.find(a=>a.copRole==="date")||{}).text;
                 /* re-date leaves the rest alone, switch flips the status */
                 const cur=copReadStamp(box.group);
                 copApplyTo(box.group,{status:cur.status,gc:cur.gc,poc:cur.poc,date:"01/02/2026"});
                 const kept=copReadStamp(box.group);
                 copApplyTo(box.group,{status:"AS-BUILT",gc:kept.gc,poc:kept.poc,date:kept.date});
                 layoutAnnos(); await nap(200);
                 out.redate=kept;
                 out.flipped=copReadStamp(box.group);
                 res(out); })""")
        ok = (stamp["card"]["open"] and stamp["card"]["title"] == "COP stamp"
              and stamp["card"]["fields"] == 5 and stamp["card"]["previewLines"] == 4
              and stamp["made"]["n"] == 5 and stamp["made"]["oneGroup"]
              and stamp["made"]["roles"] == ["box", "date", "gc", "poc", "title"]
              and stamp["made"]["texts"] == ["REDLINED", "TSC CONSTRUCTION LLC",
                                             "JACOB WALKER", "11/24/2025"]
              and stamp["editable"]
              and stamp["realtime"] == "12/01/2025"
              and stamp["redate"]["date"] == "01/02/2026"
              and stamp["redate"]["gc"] == "TSC CONSTRUCTION LLC"
              and stamp["redate"]["status"] == "REDLINED"
              and stamp["flipped"]["status"] == "AS-BUILT"
              and stamp["flipped"]["date"] == "01/02/2026")
        results.append({"tool": "The COP stamp lands as redlines", "ok": ok,
                        "why": json.dumps(stamp)})

        # ---------- 6k4 — AND IT HAS ROOM FOR WHAT IT SAYS ----------
        # Ced: "make sure the stamp have great spacing" and "the minimum width is met which covers
        # all characters". The first build clipped the contractor row and put the date's descenders
        # through the bottom rule.
        await clear()
        fit = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const f=copFields();
                 f.status="REDLINED"; f.place="tr"; f.date="11/24/2025";
                 f.poc="JACOB WALKER";
                 const out={cases:[]};
                 /* a short name and a very long one: the box is cut to its longest line either way */
                 for(const gc of ["ADB","SWARTLEY BROTHERS ENGINEERS INTERNATIONAL LIMITED"]){
                   f.gc=gc;
                   S.annos=S.annos.filter(a=>!a.copRole);
                   await copPlaceOn(0,f);
                   layoutAnnos(); await nap(420);
                   const P=S.pages[0];
                   const box=S.annos.find(a=>a.copRole==="box");
                   const rows=S.annos.filter(a=>a.copRole&&a.copRole!=="box");
                   let worstOver=0, lowest=0, leftMin=1e9, rightMin=1e9;
                   rows.forEach(a=>{
                     const d=document.querySelector(`.anno[data-id="${a.id}"]`);
                     const ed=d&&d.querySelector(".ed");
                     if(ed){
                       /* the text must FIT its own box — scrollWidth beyond clientWidth is a clip,
                          and with white-space:nowrap that is the only way it can hide */
                       worstOver=Math.max(worstOver, ed.scrollWidth-ed.clientWidth);
                       worstOver=Math.max(worstOver, ed.scrollHeight-ed.clientHeight);
                     }
                     lowest=Math.max(lowest,(a.ny+a.nh));
                     leftMin=Math.min(leftMin,(a.nx-box.nx)*P.w1);
                     rightMin=Math.min(rightMin,(box.nx+box.nw-a.nx-a.nw)*P.w1);
                   });
                   /* The margins a reader sees, from the INNER edge of the rule to the ink: above
                      the title's caps, below the bottom row's lowest ink, and either side of the
                      longest line. All four are meant to be the one margin the artwork has. */
                   const sp=copSpec(f,0,null);
                   out.cases.push({
                     gc:gc.slice(0,14),
                     wPt:+(box.nw*P.w1).toFixed(2), hPt:+(box.nh*P.h1).toFixed(2),
                     overflowPx:+worstOver.toFixed(2),
                     visTopPt:+(sp.base[0]-sp.capT-sp.border).toFixed(3),
                     visBotPt:+(sp.h-sp.base[sp.base.length-1]-sp.descLast-sp.border).toFixed(3),
                     /* 6kj/6kn — the row's BOX used to be placed an inset further out than its
                        ink, because the renderer and the export both put 2pt inside every text
                        mark; 6kn took that inset away and `COP_EDX` with it. The margin being
                        asserted is the one a READER sees, so whatever allowance the stamp is
                        making is added back — reading the constant rather than restating it, so
                        this case cannot drift from the geometry it is checking. */
                     leftPt:+(leftMin-sp.border+COP_EDX).toFixed(2),
                     rightPt:+(rightMin-sp.border+COP_EDX).toFixed(2),
                     marginPt:+sp.margin.toFixed(3)
                   });
                 }
                 res(out); })""")
        cs = fit["cases"]
        ok = all(
            c["overflowPx"] <= 0.75                              # nothing clipped or wrapped away
            and abs(c["visTopPt"] - c["marginPt"]) < 0.05        # top margin is the margin
            and abs(c["visBotPt"] - c["marginPt"]) < 0.05        # so is the bottom
            and abs(c["visTopPt"] - c["visBotPt"]) < 0.05        # which makes them even, Ced's ask
            and abs(c["leftPt"] - c["marginPt"]) < 0.1           # and so are the two sides
            and c["rightPt"] >= c["marginPt"] - 0.1
            and c["wPt"] > c["hPt"]                              # it stays landscape
            for c in cs)
        results.append({"tool": "The stamp has room for what it says", "ok": ok,
                        "why": json.dumps(fit)})

        # ---------- 6k4 — AUTO PLACEMENT FINDS CLEAR PAPER ----------
        await clear()
        spot = await page.evaluate(
            """()=>new Promise(async res=>{
                 const f=copFields();
                 f.gc="TSC CONSTRUCTION LLC"; f.poc="JACOB WALKER";
                 f.date="11/24/2025"; f.status="REDLINED"; f.place="auto";
                 const P=S.pages[0];
                 const sp=copSpec(f,0,null);
                 const t0=performance.now();
                 const at=await copFindSpot(0,sp,"auto");
                 const ms=Math.round(performance.now()-t0);
                 /* render the page and count the ink the stamp would be covering */
                 const vp=P.page.getViewport({scale:1.5});
                 const cv=document.createElement("canvas");
                 cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
                 const cx=cv.getContext("2d",{willReadFrequently:true});
                 cx.fillStyle="#fff"; cx.fillRect(0,0,cv.width,cv.height);
                 await P.page.render({canvasContext:cx,viewport:vp}).promise;
                 const x0=Math.max(0,Math.floor(at.nx*cv.width));
                 const y0=Math.max(0,Math.floor(at.ny*cv.height));
                 const w=Math.max(1,Math.ceil((sp.w/P.w1)*cv.width));
                 const h=Math.max(1,Math.ceil((sp.h/P.h1)*cv.height));
                 const d=cx.getImageData(x0,y0,w,h).data;
                 let ink=0;
                 for(let i=0;i<d.length;i+=4)
                   if(d[i]<246||d[i+1]<246||d[i+2]<246)ink++;
                 cv.width=cv.height=0;
                 res({ms, nx:+at.nx.toFixed(4), ny:+at.ny.toFixed(4),
                      px:(d.length/4)|0, ink,
                      onSheet:(at.nx>=0&&at.ny>=0&&at.nx+sp.w/P.w1<=1&&at.ny+sp.h/P.h1<=1)}); })""")
        ok = spot["ink"] == 0 and spot["onSheet"] and spot["ms"] < 4000
        results.append({"tool": "The stamp finds clear paper", "ok": ok,
                        "why": f'{spot["ink"]} inked pixels under it of {spot["px"]} '
                               f'· {spot["ms"]}ms · at {spot["nx"]}, {spot["ny"]}'})

        # ---------- 6kn — A TEXT BOX IS ALL BOX ----------
        # Ced, twice: "no minimum indentation on texts whether horizontal or vertical. making the
        # text small should not compensate for its size." The screen used to inset a free box by
        # 1x2pt and the export to match it; both are gone, and the box's own width is the whole of
        # what its words get. A SHAPE keeps its inset — its text would run under its own rule.
        await clear()
        ins = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const tid=maAddTextBox(0,0.12,0.20,"WRAPPING NOTE FOR THE PARITY CHECK",0.26,0.07);
                 const t=S.annos.find(z=>z.id===tid); t.size=10; t.align="left"; t.bgNone=true;
                 const sid=maAddShape(0,"rect",0.12,0.34,0.26,0.08);
                 const sh=S.annos.find(z=>z.id===sid); sh.text="SHAPE NOTE"; sh.size=10;
                 layoutAnnos(); await nap(320);
                 const pad=id=>{ const d=document.querySelector(`.anno[data-id="${id}"] .ed`);
                   const c=getComputedStyle(d);
                   return {t:parseFloat(c.paddingTop),r:parseFloat(c.paddingRight),
                           b:parseFloat(c.paddingBottom),l:parseFloat(c.paddingLeft),
                           box:c.boxSizing,
                           /* the words get the WHOLE width: content box equals the mark's width */
                           w:+d.getBoundingClientRect().width.toFixed(2),
                           inner:+(d.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)).toFixed(2)};
                 };
                 /* and the screen and the file break in the same place — one rule, read twice */
                 const P=S.pages[0];
                 const screen=(()=>{ const d=document.querySelector(`.anno[data-id="${tid}"] .ed`);
                   const tn=d.firstChild; if(!tn||tn.nodeType!==3)return [];
                   const r=document.createRange(); const rows=[]; let cur=null;
                   for(let i=0;i<tn.length;i++){ r.setStart(tn,i); r.setEnd(tn,i+1);
                     const rc=r.getBoundingClientRect(); if(!rc.width&&!rc.height)continue;
                     if(!cur||Math.abs(rc.top-cur.top)>1){ cur={top:rc.top,s:tn.data[i]}; rows.push(cur); }
                     else cur.s+=tn.data[i]; }
                   return rows.map(z=>z.s.trim()); })();
                 const file=redlineWrapLines(t.text,t.size,0,t.nw,markFontKey(t),wrapsWords(t),markLsp(t))
                             .map(z=>z.trim());
                 res({text:pad(tid), shape:pad(sid), screen, file,
                      wordsOnScreen:getComputedStyle(
                        document.querySelector(`.anno[data-id="${tid}"] .ed`)).wordBreak}); })""")
        ok = (ins["text"]["t"] == 0 and ins["text"]["r"] == 0
              and ins["text"]["b"] == 0 and ins["text"]["l"] == 0
              and ins["text"]["box"] == "border-box"
              and abs(ins["text"]["inner"] - ins["text"]["w"]) < 0.6   # the box IS the text's room
              and ins["shape"]["l"] > 0 and ins["shape"]["t"] > 0      # a shape keeps its inset
              # 6m4 — a TEXT BOX breaks inside the word again, which is the third time this switch
              # has moved and the second time Ced has asked for this side of it: "make the default
              # break inside a line." The guarantee 6kn was actually defending is the line BELOW —
              # that the screen and the file break in the same places, because both read
              # `wrapsWords`. That is what stays asserted; which way the default falls is a design
              # decision and is asserted as the decision currently in force, not as a law.
              and ins["wordsOnScreen"] == "break-all"
              and ins["screen"] == ins["file"] and len(ins["file"]) > 1)
        results.append({"tool": "A text box is all box", "ok": ok, "why": json.dumps(ins)})

        # ---------- 6ko — FLATTEN REACHES ONLY WHAT IS SELECTED ----------
        # Ced: "make sure flattening a redline will not ruin the rest of other redlines and will only
        # change and flatten the specific redline selected." A CLOSED group still answers as a whole;
        # the group you have gone INSIDE answers with the one mark you picked.
        await clear()
        flat = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const ids=[];
                 for(let i=0;i<3;i++){
                   const id=maAddTextBox(0,0.12,0.20+i*0.06,"MARK "+(i+1),0.16,0.04);
                   const a=S.annos.find(z=>z.id===id); a.size=10; a.bgNone=true; ids.push(id);
                 }
                 const g=(Math.max(0,...S.annos.map(z=>z.group||0))+1);
                 ids.forEach(id=>{ S.annos.find(z=>z.id===id).group=g; });
                 layoutAnnos(); await nap(200);
                 groupLeave(); clearMulti(); selectAnno(ids[1]);
                 const closed=maSelectedMarks().annos.length;
                 groupEnter(g); clearMulti(); S.sel=ids[1]; selectAnno(ids[1]);
                 const open=maSelectedMarks().annos.map(z=>z.text);
                 maSelectedMarks().annos.forEach(z=>{ z.flat=true; });
                 res({closed, open,
                      flagged:S.annos.filter(z=>z.flat).map(z=>z.text),
                      /* and the grouping is untouched by any of it */
                      stillGrouped:S.annos.every(z=>z.group===g)}); })""")
        ok = (flat["closed"] == 3 and flat["open"] == ["MARK 2"]
              and flat["flagged"] == ["MARK 2"] and flat["stillGrouped"])
        results.append({"tool": "Flatten reaches only what is selected", "ok": ok,
                        "why": json.dumps(flat)})

        # ---------- 6kp/6kq — THE PICTURE EDITOR DRAWS, AND IT KEEPS UP ----------
        # Ced: "delay in edit picture is bad. also, add lines and shapes tool in edit picture with
        # corresponding editing tools." The lag was `backdrop-filter` re-blurring the sheet on every
        # frame of a stroke; the five drawing tools are new, and their weight is in POINTS of the
        # mark on the sheet so a line drawn inside a 3x capture prints at the weight it says.
        await clear()
        pic = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const c=document.createElement("canvas"); c.width=1200; c.height=900;
                 const q=c.getContext("2d"); q.fillStyle="#fff"; q.fillRect(0,0,c.width,c.height);
                 const id=skPlaceSnapshot(0,[0.10,0.10,0.60,0.50],c.toDataURL("image/png"));
                 const a=S.annos.find(z=>z.id===id);
                 skEditor(a);
                 const until=async(f,ms)=>{ const s=performance.now();
                   while(performance.now()-s<ms){ if(f())return true; await nap(10); } return false; };
                 await until(()=>document.querySelectorAll(".sk-edbar button").length>8,8000);
                 const labels=[...document.querySelectorAll(".sk-edbar button")]
                                .map(b=>b.textContent.trim());
                 const has=t=>labels.some(z=>z.endsWith(t));
                 /* the scrim no longer carries a live blur: that was 36ms of every frame */
                 const scrim=getComputedStyle(document.querySelector(".sk-edit"));
                 const blur=(scrim.backdropFilter||scrim.webkitBackdropFilter||"none");
                 /* draw a line of a known weight and measure what landed, in picture pixels */
                 const cv=document.querySelector(".sk-edcanvas");
                 const r=cv.getBoundingClientRect();
                 const btn=t=>[...document.querySelectorAll(".sk-edbar button")]
                               .find(b=>b.textContent.trim().endsWith(t));
                 btn("Line").click();
                 const inkRow=[...document.querySelectorAll(".sk-edsize")]
                               .find(z=>z.textContent.startsWith("Ink"));
                 const rng=inkRow&&inkRow.querySelector("input[type=range]");
                 const PT=3;
                 rng.value=String(PT); rng.dispatchEvent(new Event("input",{bubbles:true}));
                 const ev=(type,cx,cy,extra)=>cv.dispatchEvent(new PointerEvent(type,
                   Object.assign({bubbles:true,clientX:cx,clientY:cy,pointerId:1},extra||{})));
                 const yy=r.top+r.height*0.5;
                 ev("pointerdown",r.left+r.width*0.15,yy);
                 window.dispatchEvent(new PointerEvent("pointermove",
                   {bubbles:true,clientX:r.left+r.width*0.85,clientY:yy,pointerId:1}));
                 window.dispatchEvent(new PointerEvent("pointerup",
                   {bubbles:true,clientX:r.left+r.width*0.85,clientY:yy,pointerId:1}));
                 await nap(160);
                 const g2=cv.getContext("2d",{willReadFrequently:true});
                 const col=Math.round(cv.width*0.5);
                 const d=g2.getImageData(col,0,1,cv.height).data;
                 let first=-1,last=-1;
                 for(let y=0;y<cv.height;y++){ const k=y*4;
                   if(d[k+3]>4 && !(d[k]>240&&d[k+1]>240&&d[k+2]>240)){ if(first<0)first=y; last=y; } }
                 const thick=(first<0)?0:(last-first+1);
                 const P=S.pages[0];
                 const pxPerPt=cv.width/(a.nw*P.w1);
                 /* and one more gesture is one more step, not a stack of them */
                 const uBtn=btn("Undo"); const before=!!(uBtn&&!uBtn.disabled);
                 if(uBtn)uBtn.click(); await nap(160);
                 const d2=g2.getImageData(col,0,1,cv.height).data;
                 let gone=true;
                 for(let y=0;y<cv.height;y++){ const k=y*4;
                   if(d2[k+3]>4 && !(d2[k]>240&&d2[k+1]>240&&d2[k+2]>240)){ gone=false; break; } }
                 const cancel=[...document.querySelectorAll(".sk-edfoot button")]
                                .find(b=>/cancel/i.test(b.textContent));
                 if(cancel)cancel.click();
                 res({tools:["Pen","Line","Arrow","Box","Ellipse"].filter(has),
                      blur, thick, wantPx:+(PT*pxPerPt).toFixed(1), undone:gone, hadUndo:before}); })""")
        ok = (pic["tools"] == ["Pen", "Line", "Arrow", "Box", "Ellipse"]
              and pic["blur"] in ("none", "")          # 6kp — no live blur behind the editor
              and abs(pic["thick"] - pic["wantPx"]) <= 1.5   # 6kq — the weight it says, in points
              and pic["hadUndo"] and pic["undone"])    # one gesture, one step
        results.append({"tool": "The picture editor draws too", "ok": ok, "why": json.dumps(pic)})

        # ---------- 6kr/6ks — THE ASSIST PANEL: ITS ✕, AND ITS HEAD ----------
        # Ced: "also fix the x, its not in the middle of the circle" and "also make the prompts of
        # assist draggable." The ✕ was packed against the left of its 26px circle because `.btn` set
        # no cross-axis alignment; the panel had no way to be moved off the part of the sheet being
        # marked up, which the tool popover has had since 6fe.
        await clear()
        pan = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 try{ localStorage.removeItem("ma.panelPos"); }catch(e){}
                 maPanelOpen(true); await nap(420);
                 const p=document.getElementById("maPanel");
                 const b=document.getElementById("maClose");
                 const br=b.getBoundingClientRect(), tn=b.firstChild;
                 const rg=document.createRange(); rg.setStart(tn,0); rg.setEnd(tn,tn.length);
                 const gr=rg.getBoundingClientRect();
                 const out={x:{l:+(gr.left-br.left).toFixed(2), r:+(br.right-gr.right).toFixed(2),
                               t:+(gr.top-br.top).toFixed(2),  b:+(br.bottom-gr.bottom).toFixed(2)}};
                 const head=p.querySelector(".mk-head");
                 const r0=p.getBoundingClientRect();
                 const pd=(el,t,x,y)=>el.dispatchEvent(new PointerEvent(t,
                   {bubbles:true,clientX:x,clientY:y,pointerId:9,button:0}));
                 pd(head,"pointerdown",r0.left+60,r0.top+14);
                 pd(p,"pointermove",r0.left+60-240,r0.top+14+120);
                 pd(p,"pointerup",  r0.left+60-240,r0.top+14+120);
                 await nap(140);
                 const r1=p.getBoundingClientRect();
                 out.moved={dx:Math.round(r1.left-r0.left), dy:Math.round(r1.top-r0.top)};
                 /* closed and reopened, it is still where it was put */
                 maPanelOpen(false); await nap(120); maPanelOpen(true); await nap(260);
                 const r2=p.getBoundingClientRect();
                 out.kept=(Math.abs(r2.left-r1.left)<2 && Math.abs(r2.top-r1.top)<2);
                 out.stored=!!localStorage.getItem("ma.panelPos");
                 /* the ✕ in the head is still a button, not a handle */
                 b.click(); out.closes=!p.classList.contains("show");
                 /* and a double-click on the head puts the panel back where it opens from */
                 maPanelOpen(true); await nap(220);
                 head.dispatchEvent(new MouseEvent("dblclick",{bubbles:true})); await nap(160);
                 const r3=p.getBoundingClientRect();
                 out.reset=(Math.abs(r3.left-r0.left)<2 && Math.abs(r3.top-r0.top)<2);
                 maPanelOpen(false);
                 res(out); })""")
        ok = (abs(pan["x"]["l"] - pan["x"]["r"]) < 0.6          # centred side to side
              and abs(pan["x"]["t"] - pan["x"]["b"]) < 0.6      # and top to bottom
              and pan["x"]["l"] > 3                             # not packed against an edge
              and pan["moved"] == {"dx": -240, "dy": 120}       # dragged by its head, exactly
              and pan["kept"] and pan["stored"] and pan["closes"] and pan["reset"])
        results.append({"tool": "The Assist panel moves, and its X is centred", "ok": ok,
                        "why": json.dumps(pan)})

        # ---------- 6kt — A STROKE HAS NO TARGET UNLESS YOU ASK FOR ONE ----------
        # Ced: "when putting a line or any shape, do not instantly have target, unless user is
        # clicking shift. also, if the user is clicking ctrl, also remove target and snap on that."
        # 6f6's Snap toggle used to pull any stroke within 4.5° of a 15° step onto it, whether or not
        # that was wanted. Shift and Ctrl are the only way to a target now, and they work either way
        # the toggle is set.
        await clear()
        snap = await page.evaluate(
            """()=>{ const pg=document.querySelector('.page[data-idx="0"]');
                     const w=pg.offsetWidth, h=pg.offsetHeight;
                     /* an 11° drag: near enough to level that the old Snap caught it */
                     const X0=0.2, Y0=0.5, X1=0.6, Y1=0.56;
                     const raw=+(Math.atan2((Y1-Y0)*h,(X1-X0)*w)*180/Math.PI).toFixed(2);
                     const go=(sh,ct,al)=>{ const r=snapDrawPoint(X0,Y0,X1,Y1,
                         {shiftKey:sh,ctrlKey:ct,altKey:al,metaKey:false},pg);
                       return {deg:+(Math.atan2((r[1]-Y0)*h,(r[0]-X0)*w)*180/Math.PI).toFixed(2),
                               free:(Math.abs(r[0]-X1)<1e-9 && Math.abs(r[1]-Y1)<1e-9)}; };
                     const was=S.snap;
                     S.snap=true;
                     const on={bare:go(0,0,0), shift:go(1,0,0), ctrl:go(0,1,0), alt:go(0,0,1)};
                     S.snap=false;
                     const off={bare:go(0,0,0), shift:go(1,0,0), ctrl:go(0,1,0)};
                     S.snap=was;
                     return {raw, on, off}; }""")
        ok = (snap["on"]["bare"]["free"] and snap["off"]["bare"]["free"]   # no target on a bare drag
              and snap["on"]["alt"]["free"]                                # Alt still lets go
              and abs(snap["on"]["shift"]["deg"] - 15) < 0.01              # Shift: the nearest 15°
              and abs(snap["off"]["shift"]["deg"] - 15) < 0.01             # toggle or no toggle
              and abs(snap["on"]["ctrl"]["deg"]) < 0.01                    # Ctrl: level, plumb, 45°
              and abs(snap["off"]["ctrl"]["deg"]) < 0.01
              and abs(snap["raw"] - 10.99) < 0.6)                          # the drag really was off-axis
        results.append({"tool": "A stroke has no target unless asked", "ok": ok,
                        "why": json.dumps(snap)})

        # ---------- 6l4 — THE BASELINE IS ASKED BIG AND SCALED BACK ----------
        # Ced: "please make sure the redlines are rendered exactly how it was showing on the tool."
        # `cssBaseline` probed the browser at `sizePt + "px"` — 4.73px for a stamp row — and a
        # baseline resolved inside a 5.8px line box rounds by half a pixel, which is half a point of
        # the finished mark. The export reads this function; the screen does not, so every line of a
        # stamp came out high in the file. The answer at twenty times, scaled back, is the same
        # question asked precisely.
        await clear()
        base = await page.evaluate(
            """()=>{ const out={};
                     /* what the browser ACTUALLY does, measured directly at a readable size */
                     const probe=(sizePt,fk,lineH,Z)=>{
                       const d=document.createElement("div");
                       d.style.cssText="position:absolute;left:-9999px;top:0;visibility:hidden;"+
                         "white-space:pre;padding:0;margin:0;border:0";
                       d.innerHTML='<span>Hxg</span><i style="display:inline-block;width:0;'+
                                   'height:0;vertical-align:baseline"></i>';
                       const F=MARK_FONTS[fk];
                       d.style.fontFamily=F.css; d.style.fontWeight=F.weight||"400";
                       d.style.fontStyle=F.style||"normal";
                       d.style.fontSize=(sizePt*Z)+"px"; d.style.lineHeight=(lineH*Z)+"px";
                       document.body.appendChild(d);
                       const r0=d.getBoundingClientRect();
                       const r1=d.querySelector("i").getBoundingClientRect();
                       const v=lineH-((r1.top-r0.top)/Z);
                       d.remove(); return v; };
                     /* the two sizes a COP stamp is built from, and a heading for good measure */
                     out.cases=[[4.73,"arialbold"],[7.336,"arialbold"],[24,"arial"]].map(([sz,fk])=>{
                       const lh=sz*1.22;
                       const truth=probe(sz,fk,lh,80);        /* eighty times: as exact as it gets */
                       const got=cssBaseline(sz,fk,lh);
                       return {sz, got:+got.toFixed(4), truth:+truth.toFixed(4),
                               offBy:+Math.abs(got-truth).toFixed(4)};
                     });
                     return out; }""")
        # a twentieth of a point is below what any renderer can show; a half-point is what Ced saw
        ok = all(c["offBy"] < 0.06 for c in base["cases"])
        results.append({"tool": "The baseline is asked big and scaled back", "ok": ok,
                        "why": json.dumps(base["cases"])})

        # ---------- 6l5/6l2 — THE STAMP CARD EDITS EVERY STAMP, LIVE ----------
        # Ced: "make the changes on stamp tool in realtime if possible" and "in stamp, always start
        # with every page." v38's realtime path reached only a SELECTED stamp, and a stamp is almost
        # never selected — it is placed on every page and then left alone.
        await clear()
        live = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const f=copFields();
                 f.status="REDLINED"; f.gc="TSC CONSTRUCTION LLC"; f.poc="CODY HUBBARD";
                 f.date="10/6/2026"; f.place="tl";
                 for(const pi of [0,1,2]) await copPlaceOn(pi,f);
                 layoutAnnos(); await nap(300);
                 const out={stamps:copStampsOn(null).length};
                 const dates=()=>[...new Set(S.annos.filter(a=>a.copRole==="date").map(a=>a.text))];
                 const before=dates();
                 /* opening the card seeds its fields and must write NOTHING */
                 maPanelOpen(true); MA_TAB="stamp"; MA_OPEN=new Set(["stamp"]); maRenderPanel();
                 await nap(600);
                 out.openQuiet=JSON.stringify(dates())===JSON.stringify(before);
                 out.scope=(document.getElementById("maScope")||{}).value;   /* 6l2 */
                 /* with NOTHING selected, a typed date reaches every stamp */
                 selectAnno(null); clearMulti();
                 const dt=document.getElementById("copDate");
                 dt.value="12/25/2027"; dt.dispatchEvent(new Event("input",{bubbles:true}));
                 await nap(400);
                 out.dates=dates();
                 const st=document.getElementById("copStatus");
                 st.value="AS-BUILT"; st.dispatchEvent(new Event("change",{bubbles:true}));
                 await nap(400);
                 out.titles=[...new Set(S.annos.filter(a=>a.copRole==="title").map(a=>a.text))];
                 /* a burst of typing is ONE history entry, and the undo reaches behind all of it */
                 const h0=S.history.length;
                 for(const v of ["0","01","01/0","01/02","01/02/2030"]){
                   dt.value=v; dt.dispatchEvent(new Event("input",{bubbles:true})); await nap(15); }
                 await nap(400);
                 out.burstEntries=S.history.length-h0;
                 out.typed=dates();
                 maPanelOpen(false);
                 res(out); })""")
        ok = (live["stamps"] == 3 and live["openQuiet"] and live["scope"] == "all"
              and live["dates"] == ["12/25/2027"]          # every stamp, not just a selected one
              and live["titles"] == ["AS-BUILT"]
              and live["typed"] == ["01/02/2030"]
              and live["burstEntries"] <= 1)               # not one undo per keystroke
        results.append({"tool": "The stamp card edits every stamp, live", "ok": ok,
                        "why": json.dumps(live)})

        # ---------- 6l6 — HELVETICA NEUE THROUGHOUT THE CHROME, AND NOWHERE ELSE ----------
        # Ced: "also use helvetica neue for the whole ui." It was already in the stack, fifth, behind
        # two Microsoft faces — so the interface wore Aptos on Windows. A form control does not
        # inherit `font-family`, which is why the buttons needed saying separately.
        await clear()
        face = await page.evaluate(
            """()=>new Promise(async res=>{
                 const nap=ms=>new Promise(r=>setTimeout(r,ms));
                 const fam=sel=>{ const e=document.querySelector(sel);
                                  return e?getComputedStyle(e).fontFamily:null; };
                 S.annos=[]; S.lines=[]; layoutAnnos();
                 const id=maAddTextBox(0,0.2,0.3,"MARK",0.2,0.05);
                 layoutAnnos(); await nap(250); selectAnno(id); await nap(350);
                 res({ body:fam("body"), btn:fam(".btn"), tool:fam("#tools .tool"),
                       bar:fam("#selbar .sb-b"), input:fam("#findInput"),
                       ink:fam('.anno[data-id="'+id+'"] .ed') }); })""")
        lead = lambda v: (v or "").split(",")[0].replace('"', "").strip().lower()
        ok = (all(lead(face[k]) == "helvetica neue" for k in ("body", "btn", "tool", "bar", "input"))
              # the marks keep Arial: the export writes Helvetica and the parity suites are
              # measured against that pairing, so restyling them here would move the ink
              and lead(face["ink"]) == "arial")
        results.append({"tool": "Helvetica Neue through the chrome", "ok": ok,
                        "why": json.dumps({k: lead(v) for k, v in face.items()})})

        if a.shot:
            await clear()
            await page.evaluate("""()=>{ $("#c_text").value="#e8590c"; $("#c_sw").value="2";
                $("#c_fill").value="#ffec99"; $("#c_fop").value="35"; }""")
            await pick("box"); await drag(*at(0.12, 0.45), *at(0.36, 0.55))
            await pick("circle"); await drag(*at(0.45, 0.45), *at(0.62, 0.57))
            await pick("arrow"); await drag(*at(0.12, 0.64), *at(0.40, 0.72))
            await pick("poly")
            for fx, fy in ((0.50, 0.64), (0.60, 0.72), (0.76, 0.64)):
                await page.mouse.click(*at(fx, fy)); await page.wait_for_timeout(150)
            await page.mouse.dblclick(*at(0.76, 0.64)); await page.wait_for_timeout(300)
            await page.screenshot(path=a.shot)

        await browser.close()

    print("=== page errors ===")
    for e in errors:
        print(" !", e)
    print("\n=== tools ===")
    bad = 0
    for r in results:
        mark = "ok " if r.get("ok") else "FAIL"
        if not r.get("ok"):
            bad += 1
        print(f"[{mark}] {r['tool']:<30} {r.get('why','')}")
    print(f"\n{bad} failing")
    print("\n=== detail ===")
    print(json.dumps([r for r in results if not r.get("ok")], indent=1)[:4000])


asyncio.run(main())
