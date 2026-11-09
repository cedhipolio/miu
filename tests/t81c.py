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
        cls='[...document.documentElement.classList].filter(x=>x.startsWith("pal-")||x=="light").join(" ")+" side="+document.body.classList.contains("ribbonright")'
        m=await frameOf('t1'); await m.evaluate('setPaletteById("pal-teal"); applyThemeMode("light"); setRibbonSide("right",true)')
        await pg.evaluate('MIU_WS.open("miu")'); await pg.wait_for_timeout(4000)
        m2=await frameOf('t2'); print('new miu tab',await m2.evaluate(cls))
        await pg.evaluate('MIU_WS.toggle()'); await pg.wait_for_timeout(4000)
        r=await frameOf('t3'); print('new rfds tab',await r.evaluate(cls))
        await r.evaluate('setPaletteById("pal-plum"); applyThemeMode("dark"); setRibbonSide("top",true)')
        await pg.evaluate('MIU_WS.activate("t1")'); await pg.wait_for_timeout(800)
        print('back to t1',await m.evaluate(cls))
        await pg.evaluate('MIU_WS.activate("t2")'); await pg.wait_for_timeout(800)
        print('then t2',await m2.evaluate(cls))
        # shift+M from t2 -> most recent rfds (t3)
        await m2.click('body',position={'x':700,'y':700}); await pg.keyboard.press('Shift+M'); await pg.wait_for_timeout(800)
        print('shift+M ->',await pg.evaluate('MIU_WS.active()'))
        # logo click in rfds -> most recent miu (t2)
        lb=await r.locator('h1.logo .logo-wm').bounding_box(); await pg.mouse.click(lb['x']+lb['width']/2,lb['y']+lb['height']/2); await pg.wait_for_timeout(800)
        print('logo ->',await pg.evaluate('MIU_WS.active()'))
        print('errors',errs); await b.close()
asyncio.run(main())
