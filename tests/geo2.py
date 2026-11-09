import asyncio,sys
from playwright.async_api import async_playwright
SEL=["header.app","h1.logo","#toolbar","aside#rail","#logBtn","#drop",".tabs,#tabs,.statusbar","#miniBar","#pages","#modeTabs"]
JS="""(sel)=>{const R=e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};
 const out={}; sel.forEach(s=>{const e=document.querySelector(s); out[s]=e&&e.offsetParent!==null||e&&getComputedStyle(e).position=='fixed'?R(e):null});
 document.querySelectorAll('#toolbar .grp').forEach(g=>{ if(g.offsetParent) out['G:'+(g.dataset.lbl||'spacer')+(g.classList.contains('mode-spacer')?'*':'')]=R(g)});
 document.querySelectorAll("#toolbar button[id], #toolbar input[id], #miniBar button[id]").forEach(b=>{ if(b.offsetParent) out['B:'+b.id]=R(b)});
 return out}"""
async def main(withdoc,side,w):
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':w,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('file:///tmp/_t78.html'); await pg.wait_for_timeout(3000)
        await pg.evaluate(f'setRibbonSide("{side}",true)')
        if withdoc: await pg.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2000)
        await pg.evaluate('MIU_RFDS.set("rfds")'); await pg.wait_for_timeout(1500)
        f=[x for x in pg.frames if x!=pg.main_frame][0]
        if withdoc:
            await f.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2500)
            await pg.evaluate('MIU_RFDS.set("miu")'); await pg.wait_for_timeout(600); await pg.evaluate('MIU_RFDS.set("rfds")'); await pg.wait_for_timeout(900)
        c=await f.evaluate(JS,SEL)
        await pg.screenshot(path=f'v79/g-r-{withdoc}{side}{w}.png')
        await pg.evaluate('MIU_RFDS.set("miu")'); await pg.wait_for_timeout(700)
        a=await pg.evaluate(JS,SEL)
        await pg.screenshot(path=f'v79/g-m-{withdoc}{side}{w}.png')
        bad=0
        for k in sorted(set(a)|set(c)):
            if k.startswith('B:') and (k not in a or k not in c): continue
            if a.get(k)!=c.get(k): bad+=1; print(f'  {k:22} miu={a.get(k)} rfds={c.get(k)}')
        print(f'doc={withdoc} side={side} w={w}: {bad} differences; errors={errs}')
        await b.close()
asyncio.run(main(sys.argv[1]=='1',sys.argv[2],int(sys.argv[3])))
