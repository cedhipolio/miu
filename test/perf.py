#!/usr/bin/env python3
"""v64 — how it FEELS, measured: open, a 6-notch wheel zoom until sharp, a scroll through, a 30-move
mark drag and five clicks, each with the long tasks (frames the hand waits on) it caused.

    python3 test/perf.py <some.pdf> <build.html>[?noworker] [<another build> ...]

Compare builds on the same file; add ?noworker to a build to measure the main-thread fallback the
claude.ai frame may use. Not a pass/fail suite — numbers to compare before and after a change."""
import asyncio, sys, time, json
from playwright.async_api import async_playwright
PDF=sys.argv[1]; BUILDS=sys.argv[2:]
LT="""window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({entryTypes:['longtask']});"""
async def run(b, build):
    pg=await b.new_page(viewport={"width":1600,"height":1000})
    await pg.add_init_script(LT)
    await pg.goto("file://"+build); await pg.wait_for_timeout(1500)
    res={}
    t=time.time(); await pg.set_input_files("#file", PDF)
    await pg.wait_for_function("()=>S.doc&&document.querySelector('.page[data-rendered=\"1\"]')", timeout=60000)
    res['open']=round(time.time()-t,2)
    await pg.wait_for_timeout(4000)
    async def lt(): v=await pg.evaluate("()=>window.__lt.splice(0)"); return [sum(v), max(v) if v else 0]
    res['open_lt']=await lt()
    # zoom gesture
    t=time.time()
    await pg.mouse.move(800,600); await pg.keyboard.down("Control")
    for i in range(6): await pg.mouse.wheel(0,-100); await pg.wait_for_timeout(40)
    await pg.keyboard.up("Control")
    await pg.wait_for_function("()=>!document.querySelector('#pages .page[data-soft=\"1\"]')", timeout=60000)
    res['zoom']=round(time.time()-t,2); res['zoom_lt']=await lt()
    # scroll through
    t=time.time()
    for i in range(20): await pg.mouse.wheel(0,600); await pg.wait_for_timeout(30)
    await pg.wait_for_timeout(300)
    res['scroll']=round(time.time()-t,2); res['scroll_lt']=await lt()
    # drag a mark
    await pg.evaluate("()=>{setZoom(1.2); gotoPageInstant(0);}"); await pg.wait_for_timeout(2500); await lt()
    rr=await pg.evaluate("()=>{const a=S.annos.find(z=>z.page===0&&z.kind!=='img'); const e=document.querySelector(`.anno[data-id=\"${a.id}\"]`); e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]}")
    await pg.wait_for_timeout(300)
    t=time.time(); await pg.mouse.move(*rr); await pg.mouse.down()
    for i in range(30): await pg.mouse.move(rr[0]+i*3, rr[1]+i*2)
    await pg.mouse.up(); res['drag']=round(time.time()-t,2); res['drag_lt']=await lt()
    # click-select latency x5
    t=time.time()
    for i in range(5):
        await pg.mouse.click(rr[0]+90,rr[1]+60); await pg.wait_for_timeout(50)
    res['clicks']=round(time.time()-t,2); res['click_lt']=await lt()
    await pg.close(); return res
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=["--no-sandbox"])
        for bl in BUILDS:
            print(bl.split('/')[-3] if 'b_' in bl else bl[-40:], json.dumps(await run(b, bl)))
        await b.close()
asyncio.run(main())
