import asyncio
from playwright.async_api import async_playwright
TB="""()=>Math.round(document.getElementById('toolbar').getBoundingClientRect().height)"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1905,'height':800})).new_page()
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        async def frameOf(tid):
            for f in pg.frames:
                if f==pg.main_frame: continue
                if await (await f.frame_element()).get_attribute('data-tab')==tid: return f
        m=await frameOf('t1'); await m.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4000)
        r=await frameOf('t2'); await r.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2500)
        print('start',await r.evaluate(TB),await m.evaluate(TB))
        # simulate a window drag: many quick resizes
        for w in list(range(1905,900,-60))+list(range(900,1905,60))+[1905]:
            await pg.set_viewport_size({'width':w,'height':800}); await pg.wait_for_timeout(25)
        await pg.wait_for_timeout(1600)
        print('after drag',await r.evaluate(TB),await m.evaluate(TB))
        await pg.screenshot(path='v81/after-drag.png')
        await b.close()
asyncio.run(main())
