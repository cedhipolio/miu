import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1500,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(4000)
        async def frameOf(tid):
            for f in pg.frames:
                if f==pg.main_frame: continue
                if await (await f.frame_element()).get_attribute('data-tab')==tid: return f
        m=await frameOf('t1'); await m.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4000)
        r=await frameOf('t2'); await r.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2500)
        await pg.evaluate('MIU_WS.open("miu")'); await pg.wait_for_timeout(4000)
        m2=await frameOf('t3'); await m2.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        print('before',await pg.evaluate('MIU_WS.tabs()'))
        # Home in RFDS tab
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(600)
        r=await frameOf('t2'); await r.click('#homeBtn'); await pg.wait_for_timeout(400)
        await r.locator('#dlg button',has_text='go home').first.click() if await r.locator('#dlg button',has_text='go home').count() else await r.locator('#dlg button').last.click()
        await pg.wait_for_timeout(5000)
        print('after RFDS home',await pg.evaluate('MIU_WS.tabs()'))
        r=await frameOf('t2'); print('rfds switch re-dressed', await r.locator('#modeBtn').count(), await r.locator('#modeTabs .mtab').count())
        # Home in MiU tab t1
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(600)
        m=await frameOf('t1'); await m.click('#homeBtn'); await pg.wait_for_timeout(400)
        await m.locator('#dlg button',has_text='go home').first.click()
        await pg.wait_for_timeout(5000)
        print('after MiU home',await pg.evaluate('MIU_WS.tabs()'))
        await pg.screenshot(path='v81/home.png')
        print('errors',errs); await b.close()
asyncio.run(main())
