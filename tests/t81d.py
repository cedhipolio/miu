import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await (await b.new_context(viewport={'width':1500,'height':900})).new_page()
        errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.add_init_script("if(window===window.top){Object.defineProperty(HTMLIFrameElement.prototype,'contentDocument',{get(){return null}});}")
        await pg.goto('file:///tmp/_t81.html'); await pg.wait_for_timeout(9000)
        print(await pg.evaluate('[typeof loadPdf, !!document.getElementById("wsHost"), document.querySelectorAll("iframe").length, getComputedStyle(document.getElementById("modeBtn")).display, document.documentElement.classList.contains("booting")]'))
        await pg.screenshot(path='v81/fallback.png'); print(errs); await b.close()
asyncio.run(main())
