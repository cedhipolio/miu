#!/usr/bin/env python3
"""Does the tool behave, when it is driven the way a person drives it?

Ced, after a version in which every one of these had an audit case passing: "these must be made
functioning well."

That is the whole reason this file exists. `tools.py` asks the page questions — it calls functions,
reads state, and checks the answers. A question answered correctly by a function that no gesture ever
reaches is a test that passes while the tool is broken, and that is exactly what happened: Escape had
a case, text resizing had a case, the hotkeys had a case, and Ced still could not use any of them.

Everything here goes through REAL INPUT. `page.mouse`, `page.keyboard`, and nothing else — no
`evaluate` that calls a handler directly, no synthetic events, no reaching into closures. Setup and
measurement may read state; the action under test never may. If a gesture cannot be performed with a
mouse and a keyboard, it is not tested here, because a user cannot perform it either.

Usage: python3 behave.py <packed.html> <some.pdf> [--only NAME] [--shots DIR]
"""
import argparse, asyncio, json, pathlib, sys, traceback

from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
WRAP = HERE / "_behave.html"

CASES = []


def case(name):
    def deco(fn):
        CASES.append((name, fn))
        return fn
    return deco


class Tool:
    """The page, and the handful of gestures every case is written out of."""

    def __init__(self, page, box):
        self.page = page
        self.box = box          # the page element's rect, in client coordinates

    # ---- where things are -----------------------------------------------------------------
    def at(self, fx, fy):
        """A point on the sheet, in client coordinates, from a fraction of the page."""
        return (self.box["x"] + self.box["w"] * fx, self.box["y"] + self.box["h"] * fy)

    async def rect(self, sel):
        return await self.page.evaluate(
            """(s)=>{const e=document.querySelector(s); if(!e)return null;
                     const r=e.getBoundingClientRect();
                     return {x:r.x,y:r.y,w:r.width,h:r.height,
                             cx:r.x+r.width/2, cy:r.y+r.height/2};}""", sel)

    async def mark_rect(self, mid):
        return await self.rect(f'.anno[data-id="{mid}"]')

    # ---- doing things ---------------------------------------------------------------------
    async def drag(self, a, b, steps=10, mods=()):
        for m in mods:
            await self.page.keyboard.down(m)
        await self.page.mouse.move(*a)
        await self.page.mouse.down()
        for i in range(1, steps + 1):
            await self.page.mouse.move(a[0] + (b[0] - a[0]) * i / steps,
                                       a[1] + (b[1] - a[1]) * i / steps)
            await self.page.wait_for_timeout(10)
        await self.page.mouse.up()
        for m in reversed(mods):
            await self.page.keyboard.up(m)
        await self.page.wait_for_timeout(260)

    async def click(self, p, mods=()):
        for m in mods:
            await self.page.keyboard.down(m)
        await self.page.mouse.click(*p)
        for m in reversed(mods):
            await self.page.keyboard.up(m)
        await self.page.wait_for_timeout(260)

    async def dblclick(self, p):
        await self.page.mouse.dblclick(*p)
        await self.page.wait_for_timeout(300)

    async def key(self, k, times=1):
        for _ in range(times):
            await self.page.keyboard.press(k)
            await self.page.wait_for_timeout(180)

    async def type(self, s):
        await self.page.keyboard.type(s, delay=22)
        await self.page.wait_for_timeout(220)

    async def show_ribbon(self):
        """Bring the ribbon back if a scroll has hidden it (6gc).

        A person does this without thinking — the pointer goes up and the ribbon is there. A script
        has to do it on purpose, and not doing it is how the first run of this file reported five
        broken behaviours that were really one hidden button.
        """
        if await self.page.evaluate("()=>document.body.classList.contains('ribbonhidden')"):
            await self.page.mouse.move(self.box["x"] + 240, 4)
            await self.page.wait_for_timeout(420)

    async def pick(self, mode):
        """Pick a tool BY CLICKING ITS BUTTON, which is how a tool is picked."""
        await self.show_ribbon()
        r = await self.rect(f'#tools .tool[data-mode="{mode}"]')
        assert r, f"no tool button for {mode}"
        await self.page.mouse.click(r["cx"], r["cy"])
        await self.page.wait_for_timeout(220)
        return await self.mode()

    async def handle(self, pos):
        """A resize grip of the selected mark.

        The grips are not children of the mark: `layoutAnnos` builds a second element over it that
        carries the selection furniture (`.anno.sel.selui`), which is what keeps a mark's own box
        free of eight spans it does not need. Asking the mark for them finds nothing, which is a
        thing worth writing down once rather than rediscovering.
        """
        return await self.rect(f'.anno.selui .rz.{pos}')

    async def select(self, mid):
        """Click a mark's middle to select it, with no tool in hand."""
        await self.key("Escape", 2)
        r = await self.mark_rect(mid)
        await self.click((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
        return await self.page.evaluate("()=>S.sel")

    # ---- reading the result ---------------------------------------------------------------
    async def mode(self):
        return await self.page.evaluate("()=>S.mode")

    async def state(self):
        return await self.page.evaluate(
            """()=>({mode:S.mode, sel:S.sel, selLine:S.selLine,
                     multi:[...S.selMulti].length, nA:S.annos.length, nL:S.lines.length})""")

    async def annos(self):
        return await self.page.evaluate(
            """()=>S.annos.map(a=>({id:a.id,nx:+a.nx.toFixed(5),ny:+a.ny.toFixed(5),
                 nw:+(a.nw||0).toFixed(5),nh:+(a.nh||0).toFixed(5),size:+(a.size||0).toFixed(3),
                 text:a.text,lines:a.lines,wrap:!!a.wrap,nowrap:!!a.nowrap,
                 userSized:!!a.userSized,maKind:a.maKind,shape:a.shape||null,
                 fill:a.fill||null,fillOp:(a.fillOp==null?1:a.fillOp)}))""")

    async def reset(self):
        """Clear the sheet and put the tool down. State only — this is setup, not the test."""
        await self.page.evaluate(
            """()=>{ try{document.activeElement.blur();}catch(e){}
                     S.annos=[]; S.lines=[]; S.history=[]; S.future=[];
                     clearMulti(); selectAnno(null); selectLine(null);
                     setMode("select"); layoutAnnos(); drawAllLines(); }""")
        await self.page.keyboard.press("Escape")
        await self.page.wait_for_timeout(260)


# =========================================================================================
#  THE CASES
# =========================================================================================

@case("A text box keeps the size the hand gave it")
async def t_usersized(T):
    """Ced: "if the user is adjusting the text, do not change its properties and text box size
    after the fact. always retain what the user intends." """
    await T.reset()
    await T.pick("text")
    await T.drag(T.at(0.16, 0.22), T.at(0.46, 0.30))
    await T.type("ONE")
    await T.click(T.at(0.80, 0.80))                 # commit by clicking away
    a = (await T.annos())[0]
    drawn = {"nw": a["nw"], "nh": a["nh"], "size": a["size"]}

    # drag the SE handle in, by hand
    await T.select(a["id"])
    h = await T.handle("se")
    if not h:
        return False, {"why": "no resize handle on a selected text box"}
    await T.drag((h["cx"], h["cy"]), (h["cx"] - 60, h["cy"] - 18))
    a = (await T.annos())[0]
    sized = {"nw": a["nw"], "nh": a["nh"], "size": a["size"], "userSized": a["userSized"]}

    # now TYPE into it — the size the hand gave it must survive every keystroke
    r = await T.mark_rect(a["id"])
    await T.dblclick((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
    await T.type(" AND SOME MORE WORDS AFTER IT")
    await T.key("Escape")
    a = (await T.annos())[0]
    after = {"nw": a["nw"], "nh": a["nh"], "size": a["size"]}

    ok = (sized["userSized"]
          and abs(sized["nw"] - drawn["nw"]) > 0.004          # the drag really did something
          and abs(after["nw"] - sized["nw"]) < 0.0015         # and typing did not undo it
          and abs(after["nh"] - sized["nh"]) < 0.0015
          and abs(after["size"] - sized["size"]) < 0.01)      # nor change the point size
    return ok, {"drawn": drawn, "after the drag": sized, "after typing": after}


@case("Narrowing a text box re-wraps its words")
async def t_rewrap(T):
    """Ced: "wrapping is not working properly in texts. if the user adjusts the text within the
    left and right size, it should adjust the wrapping." """
    await T.reset()
    await T.pick("text")
    await T.drag(T.at(0.14, 0.22), T.at(0.62, 0.28))
    await T.type("WRAPPING FOLLOWS THE WIDTH OF THE BOX")
    await T.click(T.at(0.85, 0.85))
    mid = (await T.annos())[0]["id"]

    async def painted_lines():
        """How many lines the BROWSER actually drew — not what the mark says it has."""
        return await T.page.evaluate(
            """(id)=>{ const ed=document.querySelector('.anno[data-id="'+id+'"] .ed');
                       const tn=ed&&ed.firstChild; if(!tn||tn.nodeType!==3)return null;
                       const r=document.createRange(); const tops=new Set();
                       for(let i=0;i<tn.length;i++){ r.setStart(tn,i); r.setEnd(tn,i+1);
                         const q=r.getBoundingClientRect();
                         if(q.width||q.height)tops.add(Math.round(q.top)); }
                       return tops.size; }""", mid)

    wide = await painted_lines()
    r = await T.mark_rect(mid)
    await T.select(mid)
    # drag the EAST grip left, which is "adjusting the text within the left and right size"
    h = await T.handle("e")
    if not h:
        return False, {"why": "no east grip on a selected text box"}
    await T.drag((h["cx"], h["cy"]), (h["cx"] - r["w"] * 0.45, h["cy"]))
    narrow = await painted_lines()
    a = (await T.annos())[0]
    ok = (wide is not None and narrow is not None and narrow > wide
          and a["text"] == "WRAPPING FOLLOWS THE WIDTH OF THE BOX")
    return ok, {"lines drawn when wide": wide, "after narrowing": narrow, "text kept": a["text"]}


@case("A text box has no inset, at any size")
async def t_noinset(T):
    """Ced: "no minimum indentation on texts whether horizontal or vertical. making the text small
    should not compensate for its size. please be consistent." """
    await T.reset()
    out = {}
    for n, pt in enumerate((4, 10, 30)):
        await T.page.evaluate("(v)=>{$('#c_pt').value=String(v);}", pt)
        await T.pick("text")
        await T.drag(T.at(0.14, 0.18 + n * 0.14), T.at(0.52, 0.24 + n * 0.14))
        await T.type("ABC")
        await T.click(T.at(0.88, 0.88))
        mid = (await T.annos())[-1]["id"]
        out[f"{pt}pt"] = await T.page.evaluate(
            """(id)=>{ const ed=document.querySelector('.anno[data-id="'+id+'"] .ed');
                       const c=getComputedStyle(ed);
                       return {pad:[c.paddingTop,c.paddingRight,c.paddingBottom,c.paddingLeft]
                                 .map(v=>Math.round(parseFloat(v)*100)/100),
                               box:c.boxSizing}; }""", mid)
    ok = all(v["pad"] == [0, 0, 0, 0] and v["box"] == "border-box" for v in out.values())
    return ok, out


@case("A shape is picked up by its fill")
async def t_fill_hit(T):
    """Ced: "shapes and redlines should be selected if you select it even with just the fill or the
    text." A hollow shape is caught by its rule; a FILLED one must be caught anywhere inside it."""
    await T.reset()
    await T.page.evaluate("""()=>{ $("#c_fill").value="#ffe066"; $("#c_fop").value="60";
                                   $("#c_sw").value="1"; }""")
    await T.pick("box")
    await T.drag(T.at(0.20, 0.20), T.at(0.52, 0.36))
    await T.key("Escape", 2)                          # put the tool down, keep the mark
    made = (await T.annos())[0]
    r = await T.mark_rect(made["id"])
    # a click in the MIDDLE of it — nowhere near the rule
    await T.click((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
    by_fill = await T.state()
    # and the same for an ellipse, whose middle is further from its outline still
    await T.page.evaluate("()=>{clearMulti();selectAnno(null);}")
    await T.pick("circle")
    await T.drag(T.at(0.20, 0.46), T.at(0.52, 0.62))
    await T.key("Escape", 2)
    el = (await T.annos())[1]
    r2 = await T.mark_rect(el["id"])
    await T.click((r2["x"] + r2["w"] / 2, r2["y"] + r2["h"] / 2))
    by_fill2 = await T.state()
    ok = (by_fill["sel"] == made["id"] and by_fill["mode"] == "select"
          and by_fill2["sel"] == el["id"])
    return ok, {"box: clicked its middle": by_fill["sel"], "expected": made["id"],
                "ellipse: clicked its middle": by_fill2["sel"], "expected2": el["id"]}


@case("A shape is picked up by its text")
async def t_text_hit(T):
    """The other half of the same sentence: a shape with words in it is caught by the words."""
    await T.reset()
    await T.page.evaluate("""()=>{ $("#c_fill").value="#ffffff"; $("#c_fop").value="0";
                                   $("#c_sw").value="1"; }""")
    await T.pick("box")
    await T.drag(T.at(0.20, 0.22), T.at(0.56, 0.34))
    mid = (await T.annos())[0]["id"]
    # a double-click puts the caret in a shape (6jz/6gs); that is how words get into one
    await T.key("Escape", 2)
    r0 = await T.mark_rect(mid)
    await T.dblclick((r0["x"] + r0["w"] / 2, r0["y"] + r0["h"] / 2))
    await T.type("INSIDE")
    await T.key("Escape", 2)
    # click exactly on a glyph of the text, which is nowhere near the outline
    g = await T.page.evaluate(
        """(id)=>{ const ed=document.querySelector('.anno[data-id="'+id+'"] .ed');
                   const tn=ed&&ed.firstChild; if(!tn||tn.nodeType!==3)return null;
                   const r=document.createRange(); r.setStart(tn,0); r.setEnd(tn,1);
                   const q=r.getBoundingClientRect();
                   return {x:q.x+q.width/2, y:q.y+q.height/2}; }""", mid)
    if not g:
        return False, {"why": "the shape has no text node to click"}
    await T.click((g["x"], g["y"]))
    st = await T.state()
    return st["sel"] == mid, {"clicked a glyph, selected": st["sel"], "expected": mid}


@case("The shortcuts are live the moment a document opens")
async def t_boot_keys(T):
    """Ced: "hot keys and shortcuts are still not working well. kindly ensure they work even in
    boot up of the pdf." No click anywhere first — the keys must work on a page nobody has
    touched."""
    # this case runs on a FRESH page, loaded by the runner, with nothing clicked
    got = {}
    for k, want in (("b", "box"), ("o", "circle"), ("l", "line"), ("e", "text"), ("s", "select")):
        await T.page.keyboard.press(k)
        await T.page.wait_for_timeout(170)
        got[k] = await T.mode()
    ok = (got["b"] == "box" and got["o"] == "circle" and got["l"] == "line"
          and got["e"] == "text" and got["s"] == "select")
    return ok, got


@case("Escape reaches Select when the tool drew nothing")
async def t_esc(T):
    """Ced: "the esc click (once) should always put the tool on select if it was not from a tool
    and just selecting other redlines." """
    await T.reset()
    out = {}
    # (a) drew something: one Escape drops the selection and KEEPS the tool
    await T.pick("box")
    await T.drag(T.at(0.18, 0.20), T.at(0.38, 0.30))
    await T.key("Escape")
    out["after drawing, one Escape"] = await T.state()
    await T.key("Escape")
    out["and a second"] = (await T.state())["mode"]

    # (b) picked a tool, drew nothing, clicked an existing mark: ONE Escape reaches Select
    await T.pick("circle")
    r = await T.mark_rect((await T.annos())[0]["id"])
    await T.click((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
    out["tool in hand, clicked a mark"] = await T.state()
    await T.key("Escape")
    out["then one Escape"] = await T.state()

    # (c) picked a tool, clicked blank paper, drew nothing: ONE Escape reaches Select
    await T.pick("arrow")
    await T.click(T.at(0.80, 0.78))
    await T.key("Escape")
    out["clicked blank paper, one Escape"] = (await T.state())["mode"]

    ok = (out["after drawing, one Escape"]["mode"] == "box"
          and out["after drawing, one Escape"]["sel"] is None
          and out["and a second"] == "select"
          and out["then one Escape"]["mode"] == "select"
          and out["clicked blank paper, one Escape"] == "select")
    return ok, out


@case("What you drew is the size that comes out")
async def t_preview_size(T):
    """Ced: "make sure the preview when putting the markup in the pdf is the same size on the
    actual output itself - not fully fixed." The mark's own box, in points, measured from the
    element on screen and from what the mark says — they must be the same number."""
    await T.reset()
    out = {}
    worst = 0.0
    for mode, a, b in (("box", (0.16, 0.18), (0.46, 0.28)),
                       ("circle", (0.16, 0.34), (0.46, 0.44)),
                       ("text", (0.16, 0.50), (0.46, 0.57))):
        await T.pick(mode)
        await T.drag(T.at(*a), T.at(*b))
        if mode == "text":
            await T.type("SIZE")
            await T.click(T.at(0.88, 0.88))
        await T.key("Escape", 2)
        m = (await T.annos())[-1]
        got = await T.page.evaluate(
            """(id)=>{ const d=document.querySelector('.anno[data-id="'+id+'"]');
                       const pg=document.querySelector('.page[data-idx="0"]');
                       const a=S.annos.find(z=>z.id===id);
                       const P=S.pages[0];
                       const r=d.getBoundingClientRect(), pr=pg.getBoundingClientRect();
                       /* what the SCREEN shows, in points of the sheet */
                       return {screenW:+(r.width/pr.width*P.w1).toFixed(2),
                               screenH:+(r.height/pr.height*P.h1).toFixed(2),
                               /* what the mark SAYS, which is what the export writes */
                               markW:+(a.nw*P.w1).toFixed(2),
                               markH:+(a.nh*P.h1).toFixed(2)}; }""", m["id"])
        got["outW"] = round(got["screenW"] - got["markW"], 2)
        got["outH"] = round(got["screenH"] - got["markH"], 2)
        worst = max(worst, abs(got["outW"]), abs(got["outH"]))
        out[mode] = got
    # a point is the finest thing either side can express; two is a real difference
    return worst <= 1.0, out


@case("A markup lands at the size its preview showed")
async def t_ghost_size(T):
    """Ced: "make sure the preview when putting the markup in the pdf is the same size on the actual
    output itself - not fully fixed."

    The mark's own box agreeing with its element is one question and `wysiwyg.py` answers it. This
    is the other one: the GHOST that follows the pointer while a saved markup is being placed, and
    the mark that lands when the pointer comes down. Those are two different pieces of drawing code,
    and the only way to know they agree is to measure both on screen, in points of the sheet.
    """
    await T.reset()
    # a mark worth saving: a filled box with words in it, so the ghost has something to get wrong
    await T.page.evaluate("""()=>{ $("#c_fill").value="#ffd43b"; $("#c_fop").value="45";
                                   $("#c_sw").value="2"; }""")
    await T.pick("box")
    await T.drag(T.at(0.18, 0.20), T.at(0.50, 0.32))
    mid = (await T.annos())[0]["id"]
    await T.select(mid)
    b = await T.rect('#selbar .sb-b[title="Add to markup library"]')
    if not b:
        return False, {"why": "no 'Add to markup library' button on the selection bar"}
    await T.page.mouse.click(b["cx"], b["cy"])
    await T.page.wait_for_timeout(900)
    # the library may ask for a name; answer whatever dialog is up by pressing Enter
    await T.page.keyboard.press("Enter")
    await T.page.wait_for_timeout(700)
    saved = await T.page.evaluate("()=>(typeof MA_MARKUPS!=='undefined'&&MA_MARKUPS)?MA_MARKUPS.length:0")
    if not saved:
        return False, {"why": "nothing reached the markup library"}

    await T.page.evaluate("()=>{S.annos=[];S.lines=[];clearMulti();selectAnno(null);layoutAnnos();}")
    await T.key("Escape", 2)
    # start placing it, through the panel, the way a person does
    await T.show_ribbon()
    mk = await T.rect("#markupsBtn")
    await T.page.mouse.click(mk["cx"], mk["cy"])
    await T.page.wait_for_timeout(800)
    # the library's own cell — `.ma-mk` in the `.ma-grid` the Markups card builds
    item = await T.page.evaluate(
        """()=>{ const b=document.querySelector("#maBody .ma-grid .ma-mk");
                 if(!b)return null; const r=b.getBoundingClientRect();
                 return {cx:r.x+r.width/2, cy:r.y+r.height/2}; }""")
    if not item:
        return False, {"why": "the markup library shows nothing to place"}
    await T.page.mouse.click(item["cx"], item["cy"])
    await T.page.wait_for_timeout(700)
    # move over the sheet so the ghost appears and settles, then measure it
    tgt = T.at(0.55, 0.55)
    await T.page.mouse.move(*tgt)
    await T.page.wait_for_timeout(450)
    ghost = await T.page.evaluate(
        """()=>{ const g=document.querySelector(".maghost"); if(!g)return null;
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const r=g.getBoundingClientRect(), pr=pg.getBoundingClientRect();
                 const P=S.pages[0];
                 return {w:+(r.width/pr.width*P.w1).toFixed(2),
                         h:+(r.height/pr.height*P.h1).toFixed(2)}; }""")
    if not ghost:
        return False, {"why": "no preview followed the pointer"}
    await T.page.mouse.click(*tgt)
    await T.page.wait_for_timeout(900)
    placed = await T.page.evaluate(
        """()=>{ const P=S.pages[0];
                 const xs=S.annos.map(a=>a.nx), ys=S.annos.map(a=>a.ny);
                 const xe=S.annos.map(a=>a.nx+(a.nw||0)), ye=S.annos.map(a=>a.ny+(a.nh||0));
                 if(!xs.length)return null;
                 return {n:S.annos.length,
                         w:+((Math.max(...xe)-Math.min(...xs))*P.w1).toFixed(2),
                         h:+((Math.max(...ye)-Math.min(...ys))*P.h1).toFixed(2)}; }""")
    if not placed:
        return False, {"why": "nothing was placed", "ghost": ghost}
    out = {"one mark": {"preview (pt)": ghost, "placed (pt)": placed,
                        "out by": {"w": round(placed["w"] - ghost["w"], 2),
                                   "h": round(placed["h"] - ghost["h"], 2)}}}

    # ---- and again for a GROUP, which is the path that has gone wrong before -------------------
    # A single picture is an <img> the ghost can simply scale. A group is REDRAWN for the preview
    # (`maGroupSvg`, 6k8) and then placed mark by mark, so the preview and the result come out of
    # two different pieces of code — which is how a stamp came to preview at one size and land at
    # another. v36 (`maKeepSize`) and v38 both touched this; it earns its own half of the case.
    await T.page.evaluate("()=>{S.annos=[];S.lines=[];clearMulti();selectAnno(null);layoutAnnos();}")
    await T.key("Escape", 2)
    await T.page.evaluate(
        """()=>new Promise(async r=>{ const f=copFields();
             f.status="REDLINED"; f.gc="TSC CONSTRUCTION LLC"; f.poc="CODY HUBBARD";
             f.date="10/6/2026"; f.place="tl";
             await copPlaceOn(0,f); layoutAnnos();
             clearMulti(); S.annos.forEach(a=>{ if(a.copRole)S.selMulti.add(a.id); });
             S.sel=S.annos[0].id; selectAnno(S.annos[0].id); r(1); })""")
    await T.page.wait_for_timeout(700)
    b2 = await T.rect('#selbar .sb-b[title="Add to markup library"]')
    if not b2:
        return False, dict(out, why="no library button for the grouped stamp")
    await T.page.mouse.click(b2["cx"], b2["cy"])
    await T.page.wait_for_timeout(900)
    await T.page.keyboard.press("Enter")
    await T.page.wait_for_timeout(700)
    await T.page.evaluate("()=>{S.annos=[];S.lines=[];clearMulti();selectAnno(null);layoutAnnos();}")
    await T.key("Escape", 2)
    await T.show_ribbon()
    mk2 = await T.rect("#markupsBtn")
    await T.page.mouse.click(mk2["cx"], mk2["cy"])
    await T.page.wait_for_timeout(800)
    cell = await T.page.evaluate(
        """()=>{ const g=[...document.querySelectorAll("#maBody .ma-grid .ma-mk")];
                 const b=g.find(c=>c.querySelector(".ma-mkgrp"))||g[g.length-1];
                 if(!b)return null; const r=b.getBoundingClientRect();
                 return {cx:r.x+r.width/2, cy:r.y+r.height/2, grouped:!!b.querySelector(".ma-mkgrp")}; }""")
    if not cell:
        return False, dict(out, why="the grouped markup did not reach the library")
    await T.page.mouse.click(cell["cx"], cell["cy"])
    await T.page.wait_for_timeout(700)
    tgt2 = T.at(0.52, 0.60)
    await T.page.mouse.move(*tgt2)
    await T.page.wait_for_timeout(450)
    g2 = await T.page.evaluate(
        """()=>{ const g=document.querySelector(".maghost"); if(!g)return null;
                 const pg=document.querySelector('.page[data-idx="0"]');
                 const r=g.getBoundingClientRect(), pr=pg.getBoundingClientRect();
                 const P=S.pages[0];
                 return {w:+(r.width/pr.width*P.w1).toFixed(2),
                         h:+(r.height/pr.height*P.h1).toFixed(2)}; }""")
    if not g2:
        return False, dict(out, why="no preview for the grouped markup", grouped=cell["grouped"])
    await T.page.mouse.click(*tgt2)
    await T.page.wait_for_timeout(1000)
    p2 = await T.page.evaluate(
        """()=>{ const P=S.pages[0]; if(!S.annos.length)return null;
                 const xs=S.annos.map(a=>a.nx), ys=S.annos.map(a=>a.ny);
                 const xe=S.annos.map(a=>a.nx+(a.nw||0)), ye=S.annos.map(a=>a.ny+(a.nh||0));
                 return {n:S.annos.length,
                         w:+((Math.max(...xe)-Math.min(...xs))*P.w1).toFixed(2),
                         h:+((Math.max(...ye)-Math.min(...ys))*P.h1).toFixed(2)}; }""")
    if not p2:
        return False, dict(out, why="the grouped markup placed nothing", preview=g2)
    out["a group"] = {"preview (pt)": g2, "placed (pt)": p2, "marks": p2["n"],
                      "out by": {"w": round(p2["w"] - g2["w"], 2),
                                 "h": round(p2["h"] - g2["h"], 2)}}
    # a point of difference is the rounding either side does; two is something a person can see
    ok = all(abs(v["out by"]["w"]) <= 1.5 and abs(v["out by"]["h"]) <= 1.5 for v in out.values())
    return ok, out


@case("A tool still draws over a mark when you DRAG")
async def t_draw_over(T):
    """The other side of 6l7. Ced asked for a click on a mark to pick it up; he asked earlier (6hq)
    for a tool in the hand to draw OVER a mark rather than shove it aside. A drag must still draw,
    or the first request has broken the second."""
    await T.reset()
    await T.pick("box")
    await T.drag(T.at(0.18, 0.20), T.at(0.52, 0.34))
    first = await T.annos()
    # the box it just drew comes up SELECTED, and 6ju says a press on a mark you have deliberately
    # selected moves it. That is a different rule and it is not the one under test, so the selection
    # goes first — one Escape, which keeps the tool in hand.
    await T.key("Escape")
    # a DRAG that starts inside the first box must make a second box, not move the first
    r = await T.mark_rect(first[0]["id"])
    await T.drag((r["x"] + r["w"] * 0.3, r["y"] + r["h"] * 0.3),
                 (r["x"] + r["w"] * 0.3 + 90, r["y"] + r["h"] * 0.3 + 60))
    after = await T.annos()
    moved = abs(after[0]["nx"] - first[0]["nx"]) > 0.002
    ok = len(after) == 2 and not moved
    return ok, {"marks after the second drag": len(after), "the first one moved": moved,
                "nx before": first[0]["nx"], "nx after": after[0]["nx"]}


@case("The picture editor opens, draws and fills")
async def t_picture(T):
    """Ced: "add lines and shapes tool in edit picture with corresponding editing tools - add fills
    on the shapes." Driven through the editor's own buttons and canvas."""
    await T.reset()
    # a snapshot to edit: drag the snapshot tool over a region of the sheet
    await T.pick("snapshot")
    await T.drag(T.at(0.14, 0.16), T.at(0.54, 0.40))
    await T.page.wait_for_timeout(1200)
    anns = await T.annos()
    pic = next((a for a in anns if a["maKind"] == "snapshot"), None)
    if not pic:
        return False, {"why": "the snapshot tool produced no picture", "marks": anns}
    await T.key("Escape", 2)
    r = await T.mark_rect(pic["id"])
    await T.click((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
    # open the editor from the selection bar's own button
    b = await T.rect('#selbar .sb-b[title="Edit picture"]')
    if not b:
        return False, {"why": "no Edit picture button on the selection bar"}
    await T.page.mouse.click(b["cx"], b["cy"])
    await T.page.wait_for_timeout(2500)
    names = await T.page.evaluate(
        """()=>[...document.querySelectorAll(".sk-edbar button")].map(b=>b.textContent.trim())""")
    out = {"tools": [n for n in names if any(n.endswith(w) for w in
                     ("Pen", "Line", "Arrow", "Box", "Ellipse"))]}

    async def ed_btn(label):
        return await T.page.evaluate(
            """(t)=>{const b=[...document.querySelectorAll(".sk-edbar button")]
                       .find(z=>z.textContent.trim().endsWith(t));
                     if(!b)return null; const r=b.getBoundingClientRect();
                     return {cx:r.x+r.width/2, cy:r.y+r.height/2};}""", label)

    async def ink():
        return await T.page.evaluate(
            """()=>{const cv=document.querySelector(".sk-edcanvas");
                    const g=cv.getContext("2d",{willReadFrequently:true});
                    const d=g.getImageData(0,0,cv.width,cv.height).data;
                    let n=0; for(let i=0;i<d.length;i+=4)
                      if(d[i+3]>8 && d[i]>140 && d[i+1]<120 && d[i+2]<120)n++;
                    return n;}""")

    cv = await T.rect(".sk-edcanvas")
    if not cv:
        return False, {"why": "the picture editor did not open"}
    before = await ink()

    # a hollow box, then a filled one, by clicking the chip the same way a person would
    bb = await ed_btn("Box")
    await T.page.mouse.click(bb["cx"], bb["cy"]); await T.page.wait_for_timeout(200)
    await T.drag((cv["x"] + cv["w"] * 0.10, cv["y"] + cv["h"] * 0.15),
                 (cv["x"] + cv["w"] * 0.45, cv["y"] + cv["h"] * 0.45))
    hollow = await ink()
    fchip = await T.page.evaluate(
        """()=>{const b=[...document.querySelectorAll(".sk-edsize button")]
                  .find(z=>/filled/i.test(z.textContent));
                if(!b)return null; const r=b.getBoundingClientRect();
                return {cx:r.x+r.width/2, cy:r.y+r.height/2, shown:getComputedStyle(b).display};}""")
    out["fill chip"] = bool(fchip) and fchip.get("shown") != "none"
    if fchip:
        await T.page.mouse.click(fchip["cx"], fchip["cy"]); await T.page.wait_for_timeout(200)
    await T.drag((cv["x"] + cv["w"] * 0.52, cv["y"] + cv["h"] * 0.15),
                 (cv["x"] + cv["w"] * 0.88, cv["y"] + cv["h"] * 0.45))
    filled = await ink()
    out["red px: before"] = before
    out["after a hollow box"] = hollow
    out["after a filled one"] = filled
    # the two boxes are the same size, so a filled one must lay down far more ink than a hollow one
    out["fill multiplier"] = round((filled - hollow) / max(1, hollow - before), 2)
    await T.page.keyboard.press("Escape")
    await T.page.wait_for_timeout(500)
    ok = (len(out["tools"]) == 5 and out["fill chip"]
          and hollow > before and out["fill multiplier"] > 3)
    return ok, out


@case("The picture editor keeps up with the hand")
async def t_picture_speed(T):
    """Ced: "delay in edit picture is bad." Frame times during a real sweep of the brush."""
    await T.reset()
    await T.pick("snapshot")
    await T.drag(T.at(0.10, 0.12), T.at(0.64, 0.48))
    await T.page.wait_for_timeout(1400)
    pic = next((a for a in await T.annos() if a["maKind"] == "snapshot"), None)
    if not pic:
        return False, {"why": "no snapshot"}
    await T.key("Escape", 2)
    r = await T.mark_rect(pic["id"])
    await T.click((r["x"] + r["w"] / 2, r["y"] + r["h"] / 2))
    b = await T.rect('#selbar .sb-b[title="Edit picture"]')
    await T.page.mouse.click(b["cx"], b["cy"])
    await T.page.wait_for_timeout(2500)
    cv = await T.rect(".sk-edcanvas")
    if not cv:
        return False, {"why": "the editor did not open"}
    await T.page.evaluate(
        "()=>{window.__f=[];window.__go=1;(function f(){if(!window.__go)return;"
        "window.__f.push(performance.now());requestAnimationFrame(f);})();}")
    y = cv["y"] + cv["h"] / 2
    await T.page.mouse.move(cv["x"] + 30, y)
    await T.page.mouse.down()
    for i in range(1, 41):
        await T.page.mouse.move(cv["x"] + 30 + (cv["w"] - 60) * i / 40, y + (i % 6) * 3)
    await T.page.mouse.up()
    fr = await T.page.evaluate(
        """()=>{window.__go=0; const f=window.__f, d=[];
                for(let i=1;i<f.length;i++)d.push(f[i]-f[i-1]);
                d.sort((a,b)=>a-b);
                return d.length?{frames:d.length, median:+d[Math.floor(d.length/2)].toFixed(1),
                                 p95:+d[Math.floor(d.length*0.95)].toFixed(1)}:null;}""")
    await T.page.keyboard.press("Escape")
    await T.page.wait_for_timeout(400)
    # 33ms is 30fps. Below that a brush feels like it is keeping up; above it, it drags.
    ok = bool(fr) and fr["median"] <= 33
    return ok, fr


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("packed")
    ap.add_argument("pdf")
    ap.add_argument("--only")
    ap.add_argument("--shots")
    a = ap.parse_args()

    WRAP.write_text("<!doctype html><html><head></head><body>\n"
                    + pathlib.Path(a.packed).read_text(encoding="utf-8") + "\n</body></html>",
                    encoding="utf-8")
    cases = [c for c in CASES if not a.only or a.only.lower() in c[0].lower()]
    results = []

    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        for name, fn in cases:
            # EVERY case gets a fresh page. A tool that only works on the second document is a tool
            # that does not work, and sharing one page between cases is how that hides.
            ctx = await b.new_context(viewport={"width": 1600, "height": 1050},
                                      device_scale_factor=1, accept_downloads=True)
            page = await ctx.new_page()
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)[:220]))
            await page.goto(WRAP.as_uri())
            await page.wait_for_timeout(2300)
            await page.set_input_files("#file", a.pdf)
            await page.wait_for_timeout(8000)
            await page.evaluate("()=>{ try{maPanelOpen(false);}catch(e){} gotoPageInstant(0); }")
            await page.wait_for_timeout(600)
            box = await page.evaluate(
                """()=>{const p=document.querySelector('.page[data-idx="0"]');
                        const r=p.getBoundingClientRect();
                        return {x:r.x,y:r.y,w:r.width,h:r.height};}""")
            T = Tool(page, box)
            try:
                ok, why = await fn(T)
            except Exception as e:
                ok, why = False, {"threw": f"{type(e).__name__}: {e}",
                                  "at": traceback.format_exc().strip().splitlines()[-3:]}
            if errs:
                ok = False
                why = dict(why or {}, page_errors=errs[:3])
            results.append({"case": name, "ok": bool(ok), "why": why})
            print(f"[{'ok  ' if ok else 'FAIL'}] {name}")
            if not ok:
                print("        " + json.dumps(why, default=str)[:1400])
            if a.shots:
                pathlib.Path(a.shots).mkdir(parents=True, exist_ok=True)
                safe = "".join(ch if ch.isalnum() else "_" for ch in name)[:50]
                await page.screenshot(path=str(pathlib.Path(a.shots) / f"{safe}.png"))
            await ctx.close()
        await b.close()

    bad = [r for r in results if not r["ok"]]
    print(f"\n{len(bad)} of {len(results)} behaviours are broken")
    sys.exit(1 if bad else 0)


asyncio.run(main())
