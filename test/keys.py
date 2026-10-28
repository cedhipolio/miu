#!/usr/bin/env python3
"""Every shortcut, pressed on a real keyboard, with nothing focused but the document.

Ced, four versions running: "make sure all shortcuts work again for the nth time."

It keeps coming back because nothing was watching it. `tools.py` can ask whether the handler exists
and `behave.py` had one case for "the hotkeys are live at boot"; neither of those notices when ONE
letter stops reaching its tool. So every shortcut the tool has is pressed here, on a real keyboard,
with the document focused and nothing else — and the suite fails if any one of them does nothing.

Two things learned writing it, both of which cost a false failure first and are worth keeping:
  · The page SCROLLS as the cases run, so a page rectangle measured at the start is wrong by the
    time a later case drags on it. Ask again, each time.
  · Escape returns early while the Markups panel or the loading table is open — by design, they
    handle their own Escape — so a case that leaves one open silently breaks every case after it.

Usage: python3 keys.py <packed.html> <some.pdf>
"""
import asyncio, pathlib, json
from playwright.async_api import async_playwright

import sys
HERE=pathlib.Path(__file__).resolve().parent
WRAP=HERE/"_keys.html"
PACKED=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else (HERE.parent/"mount-analysis-redlining-tool.html")
PDF=sys.argv[2] if len(sys.argv)>2 else str(HERE.parent/"SOH3361 - Redlined Mount Analysis.pdf")

TOOLS=[("s","select"),("h","pan"),("r","redline"),("e","text"),("f","fix"),("k","callout"),
       ("w","strikerow"),("t","cross"),("l","line"),("x","crossout"),("b","box"),("o","circle"),
       ("a","arrow"),("p","poly"),("d","dim")]

async def main():
    body=PACKED.read_text(encoding="utf-8")
    WRAP.write_text("<!doctype html><html><head></head><body>\n"+body+"\n</body></html>",encoding="utf-8")
    fails=[]
    async with async_playwright() as p:
        b=await p.chromium.launch(args=["--no-sandbox"])
        ctx=await b.new_context(viewport={"width":1600,"height":1000})
        pg=await ctx.new_page(); pg.on("pageerror",lambda e:print(" ! ERR",str(e)[:220]))
        await pg.goto(WRAP.as_uri()); await pg.wait_for_timeout(2500)
        await pg.set_input_files("#file",PDF); await pg.wait_for_timeout(7000)
        box=await pg.evaluate("()=>{const p=document.querySelector('#pages .page');const r=p.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}")
        at=lambda fx,fy:(box["x"]+box["w"]*fx, min(box["y"]+box["h"]*fy, 700))

        async def clean():
            await pg.evaluate("""()=>{try{document.activeElement.blur();}catch(e){}
              S.annos=[];S.lines=[];S.history=[];S.future=[];clearMulti();selectAnno(null);
              selectLine(null);setMode("select");layoutAnnos();drawAllLines();}""")
            await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)

        await clean()
        # the document must own the keyboard — click a blank part of the sheet first
        await pg.mouse.click(*at(0.92,0.06)); await pg.wait_for_timeout(300)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)

        print("=== tool letters (at boot, nothing focused) ===")
        for key,mode in TOOLS:
            await pg.keyboard.press("Escape"); await pg.wait_for_timeout(80)
            await pg.keyboard.press(key); await pg.wait_for_timeout(190)
            got=await pg.evaluate("()=>S.mode")
            ok = (got==mode)
            print(f"  {key.upper():<3} -> {mode:<11} got {got:<11} {'ok' if ok else 'FAIL'}")
            if not ok: fails.append(f"{key} -> {mode} (got {got})")

        print("=== the rest ===")
        async def check(label, keys, probe, want, setup=None):
            if setup: await setup()
            for k in (keys if isinstance(keys,list) else [keys]):
                await pg.keyboard.press(k); await pg.wait_for_timeout(420)
            got=await pg.evaluate(probe)
            ok = (got==want) if not callable(want) else want(got)
            print(f"  {label:<34} got {str(got):<28} {'ok' if ok else 'FAIL'}")
            if not ok: fails.append(f"{label} (got {got})")
            return got

        await clean(); await pg.keyboard.press("s"); await pg.wait_for_timeout(150)
        t1=await pg.evaluate("()=>String(S.theme)")
        await pg.keyboard.press("Shift+D"); await pg.wait_for_timeout(450)
        t2=await pg.evaluate("()=>String(S.theme)")
        print(f"  Shift+D toggles                    {t1!=t2 and 'ok' or 'FAIL'}  ({t1} / {t2})")
        if t1==t2: fails.append("Shift+D theme toggle")

        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        await check("/  focuses find", "/",
                    "()=>document.activeElement&&document.activeElement.id", "findInput")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)

        m0=await pg.evaluate("()=>document.body.classList.contains('markson')")
        await pg.keyboard.press("m"); await pg.wait_for_timeout(450)
        m1=await pg.evaluate("()=>document.body.classList.contains('markson')")
        print(f"  M  toggles the marks list          {m0} -> {m1}  {'ok' if m0!=m1 else 'FAIL'}")
        if m0==m1: fails.append("M marks list")
        if m1: await pg.keyboard.press("m"); await pg.wait_for_timeout(400)

        # make three marks to work on
        async def three():
            await clean()
            for i in range(3):
                await pg.keyboard.press("e"); await pg.wait_for_timeout(150)
                a=at(0.10+i*0.20,0.14); c=at(0.26+i*0.20,0.20)
                await pg.mouse.move(*a); await pg.mouse.down()
                for s in range(1,9):
                    await pg.mouse.move(a[0]+(c[0]-a[0])*s/8, a[1]+(c[1]-a[1])*s/8); await pg.wait_for_timeout(10)
                await pg.mouse.up(); await pg.wait_for_timeout(220)
                await pg.keyboard.type(f"M{i}", delay=25); await pg.wait_for_timeout(200)
                await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150)
                await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150)

        await three()
        n=await pg.evaluate("()=>S.annos.length")
        print(f"  (made {n} marks for the rest)")

        await check("Ctrl+A  select all on page", "Control+a",
                    "()=>[...S.selMulti].length", 3)
        await check("Ctrl+D  duplicate", "Control+d", "()=>S.annos.length", 6)
        await check("Ctrl+Z  undo", "Control+z", "()=>S.annos.length", 3)
        await check("Ctrl+Y  redo", "Control+y", "()=>S.annos.length", 6)
        await check("Ctrl+Z  undo again", "Control+z", "()=>S.annos.length", 3)

        # copy / paste
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        mid=(await pg.evaluate("()=>S.annos.map(a=>a.id)"))[0]
        r=await pg.evaluate("(id)=>{const e=document.querySelector('.anno[data-id=\"'+id+'\"]');const q=e.getBoundingClientRect();return{cx:q.x+q.width/2,cy:q.y+q.height/2};}",mid)
        await pg.mouse.click(r["cx"],r["cy"]); await pg.wait_for_timeout(300)
        await check("Ctrl+C then Ctrl+V  paste", ["Control+c","Control+v"], "()=>S.annos.length", 4)

        # nudge
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150)
        await pg.mouse.click(r["cx"],r["cy"]); await pg.wait_for_timeout(300)
        p0=await pg.evaluate("()=>{const a=S.annos.find(x=>x.id===S.sel);return a?+a.nx.toFixed(5):null;}")
        await pg.keyboard.press("ArrowRight"); await pg.wait_for_timeout(250)
        p1=await pg.evaluate("()=>{const a=S.annos.find(x=>x.id===S.sel);return a?+a.nx.toFixed(5):null;}")
        okn = (p0 is not None and p1 is not None and p1>p0)
        print(f"  Arrow nudges                       {p0} -> {p1}  {'ok' if okn else 'FAIL'}")
        if not okn: fails.append("arrow nudge")

        # delete
        n0=await pg.evaluate("()=>S.annos.length")
        await pg.keyboard.press("Delete"); await pg.wait_for_timeout(350)
        n1=await pg.evaluate("()=>S.annos.length")
        print(f"  Delete removes the selection       {n0} -> {n1}  {'ok' if n1==n0-1 else 'FAIL'}")
        if n1!=n0-1: fails.append("Delete")

        # Ctrl+Shift+A / Ctrl+Shift+L
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        await check("Ctrl+Shift+A  opens Markups", "Control+Shift+a",
                    "()=>!!(document.querySelector('#maPanel')&&document.querySelector('#maPanel').classList.contains('show'))", True)
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(400)
        await pg.evaluate("()=>{try{maPanelOpen(false);}catch(e){}}"); await pg.wait_for_timeout(300)
        await check("Ctrl+Shift+L  opens the table", "Control+Shift+l",
                    "()=>!!(document.querySelector('#maAnalyze')&&document.querySelector('#maAnalyze').classList.contains('show'))||!!(document.querySelector('#maPanel')&&document.querySelector('#maPanel').classList.contains('show'))", True)
        await pg.evaluate("()=>{try{maPanelOpen(false);}catch(e){}}"); await pg.wait_for_timeout(500)
        await pg.evaluate("""()=>{ ['#maAnalyze','#maPanel','#dlg'].forEach(q=>{const n=document.querySelector(q);
            if(n)n.classList.remove('show');}); }""")
        await pg.wait_for_timeout(400)
        shown=await pg.evaluate("""()=>['#maAnalyze','#maPanel','#dlg'].filter(q=>{const n=document.querySelector(q);
            return n&&n.classList.contains('show');})""")
        print(f"  (panels still open: {shown or 'none'})")

        # Ctrl+S
        await check("Ctrl+S  saves", "Control+s",
                    "()=>document.querySelector('#status')?document.querySelector('#status').textContent.slice(0,60):''",
                    lambda g: "save" in str(g).lower() or "Saved" in str(g))

        # the Escape ladder, with a tool in hand
        await clean()
        # the sheet has been scrolled by everything above, so ask where it is NOW
        box=await pg.evaluate("()=>{const p=document.querySelector('#pages .page');const r=p.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}")
        at=lambda fx,fy:(box["x"]+box["w"]*fx, min(box["y"]+box["h"]*fy, 700))
        await pg.keyboard.press("b"); await pg.wait_for_timeout(200)
        a=at(0.12,0.30); c=at(0.30,0.40)
        await pg.mouse.move(*a); await pg.mouse.down()
        for s in range(1,9):
            await pg.mouse.move(a[0]+(c[0]-a[0])*s/8, a[1]+(c[1]-a[1])*s/8); await pg.wait_for_timeout(10)
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        st0=await pg.evaluate("()=>({mode:S.mode,sel:S.sel})")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        st1=await pg.evaluate("()=>({mode:S.mode,sel:S.sel})")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
        st2=await pg.evaluate("()=>({mode:S.mode,sel:S.sel})")
        # 6m9 — TWO RUNGS. Ced: "when esc was clicked, always go to select current redline. double
        # esc is select tool." The first press used to drop the selection and keep the tool; it now
        # leaves the redline SELECTED, and the second press does both at once. Same count from every
        # state, which is the point — the five-rung ladder took four presses from inside a text.
        lad = (st0["sel"] is not None
               and st1["sel"] is not None and st1["mode"] == "box"      # 1: still picked up
               and st2["sel"] is None and st2["mode"] == "select")      # 2: tool down, selection gone
        print(f"  Escape ladder (drew a box)         {st0} / {st1} / {st2}  {'ok' if lad else 'FAIL'}")
        if not lad: fails.append("Escape ladder")

        # ---------- v63 — the ways the keyboard was still being lost ----------
        # Ced: "please reinforce the shortcuts and make sure they work 100% all the time."
        print("=== v63: shortcuts after the hand has been somewhere else ===")
        await clean()
        async def mode_after(setup, key):
            await pg.evaluate("()=>{setMode('select');}")
            await setup()
            await pg.keyboard.press(key); await pg.wait_for_timeout(250)
            return await pg.evaluate("()=>S.mode")
        # a. a SLIDER in a tool's panel was counted as "being typed in"
        async def slider():
            await pg.evaluate("()=>tpOpen('box',document.querySelector('#tools .tool[data-mode=\"box\"]'))")
            await pg.wait_for_timeout(300)
            r=await pg.evaluate("""()=>{const s=document.querySelector('#toolpop input[type=range]');
                const q=s.getBoundingClientRect(); return [q.x+q.width*0.3,q.y+q.height/2];}""")
            await pg.mouse.click(*r); await pg.wait_for_timeout(150)
            # where the slider is left holding the focus (a panel that did not rebuild under it)
            await pg.evaluate("()=>{const s=document.querySelector('#toolpop input[type=range]'); if(s)s.focus();}")
        got=await mode_after(slider,"l")
        await pg.evaluate("()=>tpClose()")
        print(f"  L after dragging a panel slider    got {got:<11} {'ok' if got=='line' else 'FAIL'}")
        if got!="line": fails.append(f"L after a slider (got {got})")
        # b. a field focused and then hidden kept the keys with nothing visible to click out of
        async def hidden_field():
            await pg.evaluate("""()=>{const i=document.createElement('input'); i.id='__ghost';
                document.body.appendChild(i); i.focus(); i.style.display='none';}""")
        got=await mode_after(hidden_field,"o")
        await pg.evaluate("()=>{const g=document.getElementById('__ghost'); if(g)g.remove();}")
        print(f"  O with a hidden field focused      got {got:<11} {'ok' if got=='circle' else 'FAIL'}")
        if got!="circle": fails.append(f"O with a hidden field focused (got {got})")
        # c. a ribbon button kept the focus, so Space (pan) pressed it again
        await pg.evaluate("()=>setMode('select')")
        bb=await pg.evaluate("""()=>{const b=document.querySelector('#tools .tool[data-mode="box"]');
            const r=b.getBoundingClientRect(); return [r.x+r.width*0.35,r.y+r.height*0.35];}""")
        await pg.mouse.click(*bb); await pg.wait_for_timeout(200)
        await pg.evaluate("()=>{window.__clicks=0; document.querySelector('#tools .tool[data-mode=\"box\"]').addEventListener('click',()=>window.__clicks++);}")
        await pg.keyboard.down("Space"); await pg.wait_for_timeout(120); await pg.keyboard.up("Space")
        await pg.wait_for_timeout(200)
        sp=await pg.evaluate("()=>({clicks:window.__clicks, focus:document.activeElement&&document.activeElement.tagName, mode:S.mode})")
        okc=sp["clicks"]==0
        print(f"  Space after clicking a tool        {sp}  {'ok' if okc else 'FAIL'}")
        if not okc: fails.append(f"Space re-pressed the last button ({sp})")
        # d. a keyboard whose layout has no Latin letter on the key still reaches the tool (e.code)
        await pg.evaluate("()=>setMode('select')")
        await pg.evaluate("""()=>document.dispatchEvent(new KeyboardEvent('keydown',
            {key:'\u0438', code:'KeyB', bubbles:true, cancelable:true}))""")
        await pg.wait_for_timeout(150)
        got=await pg.evaluate("()=>S.mode")
        print(f"  B on a Cyrillic layout (KeyB)      got {got:<11} {'ok' if got=='box' else 'FAIL'}")
        if got!="box": fails.append(f"B on another layout (got {got})")

        print("\n" + ("ALL SHORTCUTS OK" if not fails else f"{len(fails)} FAILING: "+ "; ".join(fails)))
        await b.close()
    sys.exit(1 if fails else 0)
asyncio.run(main())
