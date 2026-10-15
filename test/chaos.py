#!/usr/bin/env python3
"""A long, seeded, random session driven by a real mouse and keyboard — and the invariants it must keep.

    python3 test/chaos.py dist/mark-it-up.artifact.html <pdf> [--seeds 1,2,3] [--steps 350]

Every other suite asks one question at a time, in the order its author thought of. People do not use
the tool in that order. They pick a tool, change their mind mid-drag, right-click, press Escape twice,
undo something that was not theirs, open a panel on top of a menu. This drives that kind of session —
hundreds of actions chosen by a seeded generator, so any failure replays exactly — and after EVERY
action checks that:

  · nothing threw (no pageerror, no console error);
  · the document model is sane: every mark has finite coordinates near its page, ids are unique,
    every mark and stroke points at a page that exists, the undo stack is bounded;
  · the UI is not wedged: at most one modal is up, and a modal never sits under a menu.

On a failure it prints the seed, the step and the last 15 actions, which is a reproduction.
"""
import argparse, asyncio, json, pathlib, random, sys
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_wrapped_chaos.html"

# ribbon controls a session may press. Excluded: the ones that leave the page for the OS (file
# pickers), Home (closes the document, which ends the session), and Clear saved markings.
SKIP = {"openBtn", "photoBtn", "homeBtn", "cacheBtn", "file", "photoFile", "helpBtn"}

KEYS = ["Escape", "Escape", "Delete", "Backspace", "Control+z", "Control+y", "Control+Shift+z",
        "Control+c", "Control+v", "Control+x", "Control+d", "Control+a", "ArrowLeft", "ArrowRight",
        "ArrowUp", "ArrowDown", "Shift+ArrowRight", "v", "t", "b", "l", "a", "e", "c", "h", "s",
        "+", "-", "Control+0", "Enter", "Tab", "g", "Control+g", "Control+Shift+g", "[", "]"]

INVARIANTS = r"""() => {
  const bad = [];
  const np = (S.pages || []).length;
  if (!S.doc || !np) bad.push("document went away");
  const ids = new Set();
  for (const a of S.annos || []) {
    for (const k of ["nx", "ny"]) if (!Number.isFinite(a[k])) bad.push(`anno ${a.id} ${k}=${a[k]}`);
    if (a.nw != null && !Number.isFinite(a.nw)) bad.push(`anno ${a.id} nw=${a.nw}`);
    if (a.nh != null && !Number.isFinite(a.nh)) bad.push(`anno ${a.id} nh=${a.nh}`);
    if (Number.isFinite(a.nx) && (a.nx < -2 || a.nx > 3)) bad.push(`anno ${a.id} nx far off page ${a.nx}`);
    if (Number.isFinite(a.ny) && (a.ny < -2 || a.ny > 3)) bad.push(`anno ${a.id} ny far off page ${a.ny}`);
    if (!(a.page >= 0 && a.page < np)) bad.push(`anno ${a.id} on page ${a.page} of ${np}`);
    if (ids.has("a" + a.id)) bad.push(`duplicate anno id ${a.id}`); ids.add("a" + a.id);
  }
  for (const l of S.lines || []) {
    for (const k of ["x1", "y1", "x2", "y2"]) if (!Number.isFinite(l[k])) bad.push(`line ${l.id} ${k}=${l[k]}`);
    for (const p of l.pts || []) if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { bad.push(`line ${l.id} has a NaN point`); break; }
    if (!(l.page >= 0 && l.page < np)) bad.push(`line ${l.id} on page ${l.page} of ${np}`);
    if (ids.has("l" + l.id)) bad.push(`duplicate line id ${l.id}`); ids.add("l" + l.id);
  }
  if ((S.history || []).length > 200) bad.push(`undo stack ${S.history.length}`);
  const vis = e => e && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden";
  const modals = ["#dlg", ".sb-ask", ".sk-edit", "#helpModal.show", "#pageOrg.show"]
    .flatMap(q => [...document.querySelectorAll(q)]).filter(vis);
  if (modals.length > 1) bad.push("two modals up: " + modals.map(m => m.id || m.className).join(" + "));
  if (modals.length) {
    const z = e => +getComputedStyle(e).zIndex || 0;
    const mz = Math.max(...modals.map(z));
    for (const m of document.querySelectorAll(".sb-menu")) if (vis(m) && z(m) > mz) bad.push("a menu sits above a modal");
  }
  return bad;
}"""


async def run_seed(browser, packed_uri, pdf, seed, steps, verbose):
    rnd = random.Random(seed)
    ctx = await browser.new_context(viewport={"width": 1500, "height": 950}, accept_downloads=True)
    page = await ctx.new_page()
    errors, trail = [], []
    page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:300]))
    page.on("console", lambda m: errors.append("console: " + m.text[:300]) if m.type == "error" else None)
    page.on("dialog", lambda d: asyncio.create_task(d.dismiss()))
    page.on("download", lambda d: None)
    await page.goto(packed_uri)
    await page.wait_for_timeout(2000)
    await page.set_input_files("#file", pdf)
    await page.wait_for_timeout(5000)

    async def page_rect():
        return await page.evaluate("""()=>{const ps=[...document.querySelectorAll('.page')].map(p=>p.getBoundingClientRect())
            .filter(r=>r.bottom>60&&r.top<innerHeight-40&&r.width>50);
            if(!ps.length)return null; const r=ps[0]; return [r.x,Math.max(r.y,60),r.width,Math.min(r.bottom,innerHeight-40)-Math.max(r.y,60)];}""")

    async def pt():
        r = await page_rect()
        if not r:
            return 700, 500
        return r[0] + rnd.uniform(0.05, 0.95) * r[2], r[1] + rnd.uniform(0.05, 0.95) * r[3]

    async def visible_buttons(sel):
        return await page.evaluate("""(sel)=>[...document.querySelectorAll(sel)].filter(b=>{
            const r=b.getBoundingClientRect(); if(r.width<4||r.height<4)return false;
            if(b.disabled)return false; const cs=getComputedStyle(b); if(cs.visibility==='hidden'||cs.pointerEvents==='none')return false;
            const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return e&&(e===b||b.contains(e));
        }).map(b=>{const r=b.getBoundingClientRect(); return {id:b.id||'',t:(b.title||b.textContent||'').trim().slice(0,30),
            x:r.x+r.width/2,y:r.y+r.height/2};})""", sel)

    async def act():
        kind = rnd.choices(
            ["draw", "tool", "drag", "click", "dbl", "key", "ctx", "selbar", "menuitem", "type", "wheel", "zoomwheel",
             "panel", "rail", "modal"],
            weights=[16, 10, 14, 12, 3, 16, 5, 6, 6, 4, 4, 2, 4, 3, 3])[0]
        if kind == "draw":
            # pick a drawing tool off the ribbon and use it at once — the commonest real gesture
            bs = await visible_buttons("#tools .tool[data-mode]")
            bs = [b for b in bs if b["t"]]
            if bs:
                b = rnd.choice(bs); trail.append(f"draw with {b['t'][:16]}")
                await page.mouse.click(b["x"], b["y"])
                x, y = await pt(); dx, dy = rnd.uniform(40, 200), rnd.uniform(20, 140)
                await page.mouse.move(x, y); await page.mouse.down()
                for i in range(1, 7):
                    await page.mouse.move(x + dx * i / 6, y + dy * i / 6)
                await page.mouse.up()
                if rnd.random() < .3:
                    await page.keyboard.type(rnd.choice(["A1", "12.5 ft", "Remove"]))
        elif kind == "tool":
            bs = [b for b in await visible_buttons("#toolbar button, #tools .tool") if b["id"] not in SKIP]
            if bs:
                b = rnd.choice(bs); trail.append(f"press {b['id'] or b['t']}")
                await page.mouse.click(b["x"], b["y"])
        elif kind == "drag":
            x, y = await pt(); dx, dy = rnd.uniform(-220, 220), rnd.uniform(-160, 160)
            trail.append(f"drag {x:.0f},{y:.0f} by {dx:.0f},{dy:.0f}")
            await page.mouse.move(x, y); await page.mouse.down()
            for i in range(1, 6):
                await page.mouse.move(x + dx * i / 5, y + dy * i / 5)
            await page.mouse.up()
        elif kind == "click":
            x, y = await pt(); trail.append(f"click {x:.0f},{y:.0f}")
            sh = rnd.random() < .15
            if sh: await page.keyboard.down("Shift")
            await page.mouse.click(x, y)
            if sh: await page.keyboard.up("Shift")
        elif kind == "dbl":
            x, y = await pt(); trail.append(f"dblclick {x:.0f},{y:.0f}")
            await page.mouse.dblclick(x, y)
        elif kind == "key":
            k = rnd.choice(KEYS); trail.append(f"key {k}")
            await page.keyboard.press(k)
        elif kind == "ctx":
            x, y = await pt(); trail.append(f"rightclick {x:.0f},{y:.0f}")
            await page.mouse.click(x, y, button="right")
        elif kind == "selbar":
            bs = await visible_buttons(".sb-bar button, #annobar button, #linebar button, #multibar button")
            bs = [b for b in bs if "Delete" not in b["t"] or rnd.random() < .3]
            if bs:
                b = rnd.choice(bs); trail.append(f"selbar {b['t']}")
                await page.mouse.click(b["x"], b["y"])
        elif kind == "menuitem":
            bs = await visible_buttons(".sb-menu button, .tp-vmenu button, #palMenu button")
            if bs:
                b = rnd.choice(bs); trail.append(f"menu {b['t']}")
                await page.mouse.click(b["x"], b["y"])
        elif kind == "type":
            s = rnd.choice(["12.5", "OK", "New pipe", "(3) per sector", "§±°"]); trail.append(f"type {s!r}")
            await page.keyboard.type(s)
        elif kind == "wheel":
            trail.append("wheel"); x, y = await pt()
            await page.mouse.move(x, y); await page.mouse.wheel(0, rnd.choice([-400, 300, 700]))
        elif kind == "zoomwheel":
            trail.append("ctrl+wheel"); x, y = await pt()
            await page.mouse.move(x, y); await page.keyboard.down("Control")
            await page.mouse.wheel(0, rnd.choice([-240, 240])); await page.keyboard.up("Control")
        elif kind == "panel":
            bs = await visible_buttons("#marksBtn, #markupsBtn, #analyzeMaBtn, #palBtn, #stampBtn, #maClose, #marksClose, .ma-tab, #maPanel button")
            if bs:
                b = rnd.choice(bs); trail.append(f"panel {b['id'] or b['t']}")
                await page.mouse.click(b["x"], b["y"])
        elif kind == "rail":
            bs = await visible_buttons("#rail .rt")
            if bs:
                b = rnd.choice(bs); trail.append(f"rail {b['t']}")
                await page.mouse.click(b["x"], b["y"])
        elif kind == "modal":
            bs = await visible_buttons("#dlg button, .sb-ask button, .sk-edit button, #pageOrg button, #helpModal button")
            if bs:
                b = rnd.choice(bs); trail.append(f"modal {b['t']}")
                await page.mouse.click(b["x"], b["y"])
            else:
                trail.append("key Escape"); await page.keyboard.press("Escape")
        await page.wait_for_timeout(rnd.choice([30, 60, 120]))

    failure = None
    for i in range(steps):
        try:
            await act()
        except Exception as e:                       # a Playwright hiccup is not the tool's fault
            trail.append(f"(driver: {str(e)[:80]})")
        bad = await page.evaluate(INVARIANTS)
        if verbose and i % 25 == 0:
            st = await page.evaluate("()=>({a:S.annos.length,l:S.lines.length,h:S.history.length,mode:S.mode})")
            print(f"  seed {seed} step {i}: {st}  last: {trail[-3:]}")
        if errors or bad:
            failure = {"seed": seed, "step": i, "errors": errors[:5], "invariants": bad[:8], "last": trail[-15:]}
            break
    marks = await page.evaluate("()=>({annos:S.annos.length,lines:S.lines.length,hist:S.history.length})")
    await ctx.close()
    return failure, marks, trail


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed"); ap.add_argument("pdf")
    ap.add_argument("--seeds", default="1,2,3"); ap.add_argument("--steps", type=int, default=350)
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    WRAP.write_text("<!doctype html><html><head></head><body>\n" + pathlib.Path(a.packed).read_text(encoding="utf-8")
                    + "\n</body></html>", encoding="utf-8")
    fails = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        for seed in [int(s) for s in a.seeds.split(",")]:
            failure, marks, trail = await run_seed(browser, WRAP.as_uri(), a.pdf, seed, a.steps, a.v)
            if failure:
                fails += 1
                print(f"[FAIL] seed {seed}: step {failure['step']}")
                print(json.dumps(failure, indent=1, ensure_ascii=False))
            else:
                print(f"[ok  ] seed {seed}: {a.steps} actions, ended with {marks}")
        await browser.close()
    print(f"\n{fails} of {len(a.seeds.split(','))} sessions broke an invariant" if fails else "\nALL SESSIONS HELD")
    sys.exit(1 if fails else 0)

asyncio.run(main())
