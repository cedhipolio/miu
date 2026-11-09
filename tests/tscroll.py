import asyncio
from playwright.async_api import async_playwright
SC="()=>[Math.round((document.scrollingElement||document.documentElement).scrollTop)]"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1400,'height':850})).new_page()
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        fs=lambda: [f for f in pg.frames if f!=pg.main_frame]
        m=fs()[0]; await m.set_input_files('#file','t10.pdf'); await pg.wait_for_timeout(2000)
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4500)
        r=fs()[1]; await r.set_input_files('#file','t10.pdf'); await pg.wait_for_timeout(3000)
        await pg.mouse.move(700,500)
        for i in range(6): await pg.mouse.wheel(0,500); await pg.wait_for_timeout(150)
        await pg.wait_for_timeout(1500); a=await r.evaluate(SC)
        # churn: hover ribbon, toggle transient classes in both tabs
        for i in range(10):
            await r.evaluate('document.body.classList.toggle("chromeshow")'); await m.evaluate('document.body.classList.toggle("xscrolling")')
            await pg.wait_for_timeout(250)
        await pg.wait_for_timeout(1500); c=await r.evaluate(SC)
        print('rfds scroll before/after churn',a,c)
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(800)
        for i in range(5): await pg.mouse.wheel(0,600); await pg.wait_for_timeout(150)
        await pg.wait_for_timeout(1200); a=await m.evaluate(SC)
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(800); await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(1500)
        c=await m.evaluate(SC); print('miu scroll across switches',a,c)
        await b.close()
asyncio.run(main())
