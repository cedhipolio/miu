#!/usr/bin/env python3
"""6nc — THE COLOUR ON THE SHEET IS THE COLOUR IN THE FILE.

Ced: "the colors rendered are sometimes different to the one showed in ui", with a 34% red fill
reading #fdb9bb on screen and #c5aeae in his render.

The other parity suites measure GEOMETRY — where an edge lands, to a fraction of a point. None of
them looks at colour, so a fill that came out the wrong shade would have passed all of them. This
one takes the mode colour of each mark's interior on screen and in the rendered export and demands
they be the same string.

The cases are the ones that could plausibly differ: four opacities of the same red; then at 0.34,
a dashed rule, a dashed rule on a turned box, a hatch, the multiply blend, and ink at half
opacity; then a translucent PNG at four combinations of image alpha and mark opacity.

  python3 colparity.py <packed.html> <some.pdf>
"""
import asyncio, pathlib, subprocess, sys
from playwright.async_api import async_playwright
from PIL import Image
from collections import Counter
HERE=pathlib.Path(__file__).resolve().parent
PACKED=sys.argv[1]; SRCPDF=sys.argv[2]
OUT=pathlib.Path("/tmp/claude-0/colparity")
OUT.mkdir(parents=True, exist_ok=True)
W=HERE/"_colparity.html"
W.write_text("<!doctype html><html><head></head><body>\n"+
  pathlib.Path(PACKED).read_text(encoding="utf-8")+
  "\n</body></html>",encoding="utf-8")
MARKS = """
  S.annos=[]; S.lines=[]; layoutAnnos(); drawAllLines();
  const out=[];
  const cases=[
    ["plain .34",      a=>{}],
    ["dashed .34",     a=>{ a.dash="dash"; }],
    ["dashed+rot 20",  a=>{ a.dash="dash"; a.rot=20; }],
    ["hatch .34",      a=>{ a.hatch="dots"; }],
    ["multiply .34",   a=>{ a.hl=true; }],
    ["colOp .5",       a=>{ a.colOp=0.5; }],
    ["colOp .25",      a=>{ a.colOp=0.25; }]
  ];
  cases.forEach(([name,tweak],i)=>{
    const id=maAddShape(0,"rect",0.10,0.04+i*0.135,0.26,0.095,{});
    const a=S.annos.find(z=>z.id===id);
    a.col="#fa3237"; a.sw=2; a.fill="#fa3237"; a.fillOp=0.34; tweak(a);
    out.push({name, nx:a.nx, ny:a.ny, nw:a.nw, nh:a.nh});
  });
  /* and a translucent PNG, at four combinations of image alpha and mark opacity */
  const mkpng=(op)=>{ const c=document.createElement('canvas'); c.width=300; c.height=150;
    const q=c.getContext('2d');
    q.globalAlpha=op; q.fillStyle='#fa3237'; q.fillRect(0,0,300,150);
    q.globalAlpha=1; q.strokeStyle='#fa3237'; q.lineWidth=4; q.strokeRect(2,2,296,146);
    return c.toDataURL('image/png'); };
  [[1.0,1],[0.34,1],[1.0,0.34],[0.34,0.34]].forEach(([pa,mo],i)=>{
    const id=(S.seq=(S.seq||0)+1);
    const a={id, kind:'img', maKind:'markup', page:0, nx:0.55, ny:0.05+i*0.21,
             nw:0.26, nh:0.13, src:mkpng(pa), col:'#fa3237', sw:0, op:mo};
    S.annos.push(a);
    out.push({name:'png '+pa+' mark '+mo, nx:a.nx, ny:a.ny, nw:a.nw, nh:a.nh});
  });
  layoutAnnos();
  return out;
"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=["--no-sandbox"])
        ctx=await b.new_context(viewport={"width":1500,"height":1100},device_scale_factor=1,accept_downloads=True)
        pg=await ctx.new_page(); saved=[]
        async def grab(dl):
            d=OUT/"export.pdf"; await dl.save_as(str(d)); saved.append(str(d))
        pg.on("download", lambda dl: asyncio.create_task(grab(dl)))
        await pg.goto(W.as_uri()); await pg.wait_for_timeout(2500)
        await pg.set_input_files("#file",SRCPDF); await pg.wait_for_timeout(9000)
        await pg.evaluate("maPanelOpen(false); gotoPageInstant(0);")
        await pg.wait_for_timeout(800)
        marks=await pg.evaluate("()=>{"+MARKS+"}")
        await pg.evaluate("""()=>{ try{document.activeElement.blur();}catch(e){}
            selectAnno(null); selectLine(null); clearMulti();
            ["toolbar","miniBar","annobar","linebar","multibar","saveStrip","ribbonPeek","markR"]
              .forEach(id=>{const e=document.getElementById(id); if(e)e.style.display="none";});
            document.querySelectorAll("header.app,.selbar,.toolpop").forEach(e=>e.style.display="none"); }""")
        await pg.wait_for_timeout(400)
        box=await pg.evaluate("""()=>{const p=document.querySelector('.page[data-idx="0"]');
                                      return {w:p.offsetWidth,h:p.offsetHeight};}""")
        elh=await pg.query_selector('.page[data-idx="0"]')
        await elh.screenshot(path=str(OUT/"screen.png"))
        await pg.evaluate("()=>exportPdf()"); await pg.wait_for_timeout(7000)
        await b.close()
    if not saved: print("no export"); sys.exit(1)
    subprocess.run(["pdftoppm","-f","1","-l","1","-r","72","-png",str(OUT/"export.pdf"),str(OUT/"pdf")],check=True)
    scr=Image.open(OUT/"screen.png").convert("RGB")
    pdf=Image.open(sorted(OUT.glob("pdf-*.png"))[0]).convert("RGB")
    Wp,Hp=box["w"],box["h"]
    kx,ky=pdf.size[0]/scr.size[0], pdf.size[1]/scr.size[1]
    def mode(im,bx):
        c=Counter(list(im.crop(tuple(int(v) for v in bx)).getdata()))
        return c.most_common(1)[0][0]
    def hx(t): return "#%02x%02x%02x"%t
    # two renderers round the same arithmetic differently; three levels out of 255 is the most a
    # rounding difference can be, and a colour that is actually WRONG is out by tens (Ced's report
    # was 56 levels of red and 11 of green).
    TOL=3
    print("screen",scr.size,"pdf",pdf.size)
    bad=0
    for m in marks:
        x0=m["nx"]*Wp+34; y0=m["ny"]*Hp+22; x1=(m["nx"]+m["nw"])*Wp-34; y1=(m["ny"]+m["nh"])*Hp-22
        s=mode(scr,(x0,y0,x1,y1))
        d=mode(pdf,(x0*kx,y0*ky,x1*kx,y1*ky))
        off=max(abs(a-b) for a,b in zip(s,d))
        same=off<=TOL
        if not same: bad+=1
        print(f'  {m["name"]:<18} screen {hx(s)}   file {hx(d)}   off by {off:<3} {"ok" if same else "DIFFERENT"}')
    print(f"\n{bad} of {len(marks)} marks come out of the file more than {TOL} levels from the screen")
    if bad: sys.exit(1)
asyncio.run(main())
