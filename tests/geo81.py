import asyncio,sys
from playwright.async_api import async_playwright
SEL=["header.app","h1.logo","#toolbar","aside#rail","#logBtn","#drop",".tabs,#tabs,.statusbar","#miniBar","#pages","#modeTabs"]
JS=open('geo2.py').read().split('JS="""')[1].split('"""')[0]
async def main(withdoc,side,w):
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':w,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        async def frameOf(tid):
            for f in pg.frames:
                if f==pg.main_frame: continue
                if await (await f.frame_element()).get_attribute('data-tab')==tid: return f
        m=await frameOf('t1'); await m.evaluate(f'setRibbonSide("{side}",true)')
        if withdoc: await m.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4000)
        r=await frameOf('t2')
        if withdoc: await r.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2500); await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(600); await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(800)
        c=await r.evaluate(JS,SEL)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(700)
        a=await m.evaluate(JS,SEL)
        bad=0
        for k in sorted(set(a)|set(c)):
            if k.startswith('B:') and (k not in a or k not in c): continue
            if k in('G:My tools','G:Text','G:WIP 🔒','G:spacer*','h1.logo','#logBtn'): continue
            if a.get(k)!=c.get(k): bad+=1; print(f'  {k:22} miu={a.get(k)} rfds={c.get(k)}')
        print(f'doc={withdoc} side={side} w={w}: {bad} differences; errors={errs}')
        await b.close()
asyncio.run(main(sys.argv[1]=='1',sys.argv[2],int(sys.argv[3])))
