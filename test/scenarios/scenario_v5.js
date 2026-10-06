/* v5 — per-tool properties panels, snap while drawing, Ctrl for a perfect shape. */
const out={};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- 1. the ▾ opens a panel per tool, and the panel differs per tool ---------- */
out.carets=document.querySelectorAll("#tools .tool .tcaret").length;
out.styleGroupGone=!!document.querySelector("#toolbar .grp-style.hidden");
const panels={};
for(const m of ["box","circle","line","arrow","callout","text","poly"]){
  document.querySelector(`#tools .tool[data-mode="${m}"] .tcaret`).click();
  await sleep(120);
  const pop=document.getElementById("toolpop");
  panels[m]={title:pop.querySelector(".tp-title").textContent,
             secs:[...pop.querySelectorAll(".tp-sech span:first-child")].map(s=>s.textContent)};
}
out.panels=panels;

/* ---------- 2. a panel edits ITS tool only ---------- */
tpOpen("box"); tpSet("dash","dash"); tpPut("c_sw",4);
tpOpen("arrow"); tpSet("le1","oarrow");
tpOpen("line"); tpSet("lpat","wave");
out.styles={box:{dash:MA_TOOL_STYLES.box.dash,sw:MA_TOOL_STYLES.box.sw},
            arrow:{le1:MA_TOOL_STYLES.arrow.le1,dash:MA_TOOL_STYLES.arrow.dash||"solid"},
            line:{lpat:MA_TOOL_STYLES.line.lpat,sw:MA_TOOL_STYLES.line.sw}};
tpClose();

/* ---------- 3. those properties reach the marks ---------- */
setMode("box");  maAddShape(0,"rect",0.10,0.30,0.16,0.08);
setMode("arrow");addLine(0,0.40,0.30,0.62,0.36,{});
setMode("line"); addLine(0,0.40,0.42,0.62,0.42,{});
const shp=S.annos.filter(a=>isShape(a)).pop();
out.mark={dash:shp.dash,sw:shp.sw};
out.strokes=S.lines.slice(-2).map(l=>({le:endsOf(l),lpat:l.lpat||"straight",arrow:l.arrow||null}));

/* ---------- 4. snap: a nearly-level drag comes out exactly level ---------- */
S.snap=true;
const pg=document.querySelector('.page[data-idx="0"]');
const near=snapDrawPoint(0.20,0.50,0.60,0.503,{},pg);         // ~0.3° off level
const plumb=snapDrawPoint(0.20,0.50,0.203,0.80,{},pg);        // nearly vertical
const slant=snapDrawPoint(0.20,0.50,0.60,0.72,{},pg);         // a real angle, left alone
const held=snapDrawPoint(0.20,0.50,0.60,0.503,{ctrlKey:true},pg);
out.snap={level:near[1]===0.5, plumb:plumb[0]===0.20, slantKept:slant[1]===0.72, ctrlSuspends:held[1]===0.503};
S.snap=false;
out.snapOff=snapDrawPoint(0.20,0.50,0.60,0.503,{},pg)[1];
S.snap=true;

/* ---------- 5. Ctrl squares the drag ---------- */
const sq=squareDrag(0.20,0.20,0.50,0.28,pg);
const W=pg.offsetWidth,H=pg.offsetHeight;
out.square={wpx:+(((sq[0]-0.20)*W).toFixed(1)), hpx:+(((sq[1]-0.20)*H).toFixed(1))};
const sqBack=squareDrag(0.50,0.50,0.30,0.47,pg);              // dragged up and to the left
out.squareBack={dx:+((sqBack[0]-0.50).toFixed(4)<0), dy:+((sqBack[1]-0.50).toFixed(4)<0)};

/* ---------- 6. the look survives an export ---------- */
await exportPdf();
await sleep(1500);
return JSON.stringify(out);
