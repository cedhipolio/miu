import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1500,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type=='error' and errs.append(m.text[:200]))
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        async def frameOf(tid):
            for f in pg.frames:
                if f==pg.main_frame: continue
                if await (await f.frame_element()).get_attribute('data-tab')==tid: return f
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4000)
        r=await frameOf('t2'); await r.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2500)
        print('adapter', await r.evaluate('!!window.__miuStamp'), await r.evaluate('document.getElementById("wsMiuPanelCss")?.textContent.length'))
        await r.click('#stampBtn'); await pg.wait_for_timeout(800); await pg.screenshot(path='v81/stamp-rfds2.png')
        await r.click('.ma-stampgo'); await pg.wait_for_timeout(2500)
        print('stamps',await r.evaluate('allStamps().map(a=>[a.page,a.st.gc,a.st.poc,a.st.status])'))
        await r.select_option('#copStatus','AS-BUILT'); await pg.wait_for_timeout(400)
        print('live',await r.evaluate('allStamps().map(a=>a.st.status)'))
        await r.click('.ma-stampgo'); await pg.wait_for_timeout(1500)
        print('after update',await r.evaluate('allStamps().length'))
        await r.click('.ma-go'); await pg.wait_for_timeout(300)
        print('switch',await r.evaluate('allStamps().map(a=>a.st.status)'))
        await r.click('.cop-calbtn'); await pg.wait_for_timeout(300); await pg.screenshot(path='v81/stamp-rfds3.png')
        await r.click('#maClose') if await r.locator('.cop-cal').count()==0 else None
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200); await r.click('#maClose'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='v81/stamp-rfds4.png')
        print('stamp red',await r.evaluate('STAMP_RED_HEX'))
        print(errs); await b.close()
asyncio.run(main())
