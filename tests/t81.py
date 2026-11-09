import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1500,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: m.type in('error','warning') and errs.append(m.type+':'+m.text[:200]))
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(5000)
        print('tabs',await pg.evaluate('MIU_WS.tabs()'))
        await pg.screenshot(path='v81/a1.png')
        fr=lambda i: pg.frames[i]
        def tabframe(tid): return [f for f in pg.frames if f.frame_element and f!=pg.main_frame]
        async def frameOf(tid):
            for f in pg.frames:
                if f==pg.main_frame: continue
                el=await f.frame_element()
                if await el.get_attribute('data-tab')==tid: return f
        f1=await frameOf('t1'); await f1.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        # + menu -> new MiU tab
        await f1.locator('#modeTabs .mplus').click(); await pg.wait_for_timeout(300)
        await pg.screenshot(path='v81/a2.png')
        await f1.locator('#modeMenu button[data-tool=miu]').click(); await pg.wait_for_timeout(5000)
        print('tabs',await pg.evaluate('MIU_WS.tabs()'))
        f2=await frameOf('t2'); await f2.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(1500)
        # new rfds via toggle
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(5000)
        f3=await frameOf('t3'); await f3.set_input_files('#file','t.pdf'); await pg.wait_for_timeout(2000)
        await pg.evaluate('MIU_WS.open("rfds")'); await pg.wait_for_timeout(5000)
        print('tabs',await pg.evaluate('MIU_WS.tabs()'))
        await pg.screenshot(path='v81/a3.png')
        f4=await frameOf('t4')
        # click tab t1 from within t4
        await f4.locator('#modeTabs .mtab[data-tab=t1]').click(); await pg.wait_for_timeout(800)
        print('active',await pg.evaluate('MIU_WS.active()'))
        await pg.screenshot(path='v81/a4.png')
        # close t4 (empty) from t1
        await f1.locator('#modeTabs .mtab[data-tab=t4] .mx').click(); await pg.wait_for_timeout(800)
        print('after close',await pg.evaluate('MIU_WS.tabs()'))
        # close t2 (has doc) -> confirm dialog
        await f1.locator('#modeTabs .mtab[data-tab=t2] .mx').click(); await pg.wait_for_timeout(500)
        await pg.screenshot(path='v81/a5.png')
        btn=f1.locator('#dlg button', has_text='Close tab')
        print('confirm visible', await btn.count())
        if await btn.count(): await btn.first.click(); await pg.wait_for_timeout(800)
        print('after close2',await pg.evaluate('MIU_WS.tabs()'))
        print('errors',errs[:20]); await b.close()
asyncio.run(main())
