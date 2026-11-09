import asyncio
from playwright.async_api import async_playwright
pals=open('/tmp/pals.txt').read().split()
Q="""()=>{const p=document.getElementById('maPanel'), c=getComputedStyle(p), h=getComputedStyle(p.querySelector('.mk-head')), s=getComputedStyle(document.getElementById('copStatus')); return [c.backgroundColor,h.backgroundColor,s.backgroundColor,c.opacity].join(' | ')}"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1300,'height':800})).new_page()
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        m=[f for f in pg.frames if f!=pg.main_frame][0]
        await m.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1200); await m.click('#stampBtn'); await pg.wait_for_timeout(500)
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4500)
        r=[f for f in pg.frames if f!=pg.main_frame][1]
        await r.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2000)
        await r.evaluate('document.getElementById("stampBtn").click()'); await pg.wait_for_timeout(500)
        for mode in ('dark','light'):
            for pal in pals:
                for f in (m,r): await f.evaluate(f'applyThemeMode("{mode}"); setPaletteById("{pal}")')
                await pg.wait_for_timeout(150)
                a=await m.evaluate(Q); c=await r.evaluate(Q)
                print(mode,pal,'OK' if a==c else 'DIFF\n   M '+a+'\n   R '+c)
        await b.close()
asyncio.run(main())
