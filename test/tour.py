#!/usr/bin/env python3
"""Visual tour: screenshot every surface of the UI, in both modes, for design review.

    python3 test/tour.py dist/mark-it-up.artifact.html <pdf> [outdir]

Not a pass/fail suite — it fails only on a page error. The pictures are for a human to look at.
"""
import asyncio, pathlib, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
PACKED = pathlib.Path(sys.argv[1]); PDF = sys.argv[2]
OUT = pathlib.Path(sys.argv[3] if len(sys.argv) > 3 else HERE / "_shots"); OUT.mkdir(exist_ok=True, parents=True)
WRAP = HERE / "_wrapped_tour.html"

async def main():
    WRAP.write_text("<!doctype html><html><head></head><body>\n" + PACKED.read_text(encoding="utf-8") + "\n</body></html>", encoding="utf-8")
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        for mode in (sys.argv[4].split(",") if len(sys.argv) > 4 else ["dark", "light"]):
            ctx = await b.new_context(viewport={"width": 1600, "height": 960}, color_scheme=mode)
            pg = await ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
            await pg.goto(WRAP.as_uri()); await pg.wait_for_timeout(2500)
            await pg.evaluate(f"applyTheme && applyTheme('{mode}')")
            if len(sys.argv) > 5: await pg.evaluate(f"setPaletteById('{sys.argv[5]}')")
            await pg.wait_for_timeout(300)
            async def shot(name):
                await pg.wait_for_timeout(350)
                await pg.screenshot(path=str(OUT / f"{(sys.argv[5]+"-") if len(sys.argv)>5 else ""}{mode}-{name}.png"))
            async def ev(js):
                try: await pg.evaluate(js)
                except Exception as e: errors.append(f"{name_}: {e}"[:300])
            name_ = "open"; await shot("01-open")
            await pg.set_input_files("#file", PDF); await pg.wait_for_timeout(6000)
            name_ = "doc"; await ev("maPanelOpen(false)"); await shot("02-doc")
            for i, t in enumerate(["notes", "markups", "import"]):
                name_ = t; await ev(f"maPanelOpen(true); maSetTab('{t}')"); await shot(f"03-ma-{t}")
            await ev("maPanelOpen(false)")
            name_ = "pal"; await ev("togglePalMenu(document.getElementById('palBtn'))"); await shot("04-palette")
            await pg.keyboard.press("Escape"); await ev("document.getElementById('palMenu').classList.remove('show')")
            name_ = "help"; await ev("openHelp()"); await shot("05-help")
            await ev("document.getElementById('helpModal').classList.remove('show')")
            name_ = "org"; await ev("openPageOrg()"); await shot("06-pageorg")
            await ev("document.getElementById('pageOrg').classList.remove('show')")
            for m in ["text", "box", "line", "callout", "dim"]:
                name_ = m
                btn = pg.locator(f'[data-mode="{m}"]').first
                try:
                    await btn.click(); await pg.wait_for_timeout(200)
                    await ev(f"tpOpen('{m}', document.querySelector('[data-mode=\"{m}\"]'))")
                    await shot(f"07-tool-{m}")
                except Exception as e: errors.append(f"{m}: {e}"[:200])
                await pg.keyboard.press("Escape")
            # draw a box and select it, to show the selection bar
            name_ = "sel"
            box = await pg.evaluate("(()=>{const r=document.querySelector('.page[data-idx=\"0\"]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            await pg.locator('[data-mode="box"]').first.click()
            x, y = box[0] + box[2]*0.3, box[1] + 300
            await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x+160, y+90, steps=6); await pg.mouse.up()
            await pg.locator('[data-mode="select"]').first.click()
            await pg.mouse.click(x+80, y+1); await shot("08-selected")
            await pg.mouse.click(x+80, y+1, button="right"); await shot("09-context")
            await pg.keyboard.press("Escape")
            name_ = "dlg"; await ev("void uiConfirm({title:'Clear all redlines?',msg:'This removes every mark on every page.',ok:'Clear',cancel:'Cancel'})"); await shot("10-dialog")
            await pg.keyboard.press("Escape")
            name_ = "editor"
            await ev("""(()=>{ const c=document.createElement('canvas'); c.width=300;c.height=200; const g=c.getContext('2d');
                g.fillStyle='#fff';g.fillRect(0,0,300,200);g.strokeStyle='#fa3237';g.lineWidth=4;g.strokeRect(30,30,240,140);
                const id=addText(0,0.2,0.3,''); const a=S.annos.find(z=>z.id===id);
                a.kind='img';a.maKind='snapshot';a.nw=0.3;a.nh=0.2;a.manualW=true;a.src=c.toDataURL('image/png');a.sw=0;
                layoutAnnos(); skEditor(a); })()""")
            await pg.wait_for_timeout(800); await shot("11-editor")
            await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
            name_ = "find"; await pg.keyboard.press("Control+f"); await pg.keyboard.type("Sector"); await pg.keyboard.press("Enter"); await shot("12-find")
            await ctx.close()
        await b.close()
    print("\n".join(errors) or "no page errors")
    sys.exit(1 if errors else 0)

asyncio.run(main())
