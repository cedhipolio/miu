/* ==================================================================================================
   THE MOUNT ANALYSIS LAYER

   Everything above this line is the redlining engine: pages, marks, strokes, undo, autosave, export.
   Everything below is what a MOUNT ANALYSIS specifically needs, and it was written from the fourteen
   redlined reports Ced sent rather than from an idea of what one looks like. Four things account for
   almost every mark in those files:

     1. a printed value corrected: the mount model, a centreline, a quantity, an azimuth, a Raycap
        part number. Two patterns in the files — write over the value, or strike it and write the
        as-built one just above. The engine already does the first; `maStrikeAndWrite` does the second.
     2. a callout on a drawing sheet: a leader arrow to a member, and beside it the description, the
        manufacturer, the part number and how many per sector. The parts in them repeat from site to
        site, so they are a library.
     3. one note repeated down a run of pages — "ACTUAL INSTALL: TRIAD MOUNT WITH STEALTH SHROUD" on
        fifty of them in IN1187, "STRESS RATIO IS < 1 ..." on the result pages.
     4. the loading table, read off the page into a grid that can be edited and stamped back.

   The REDLINED stamp itself is deliberately NOT here: it goes on at the end, in the stamping tool,
   after this file has been exported.

   None of this replaces judgement about WHAT to redline. It removes the typing.
   ================================================================================================== */

/* The red in the sample files, measured off their annotations: 0.980 0.196 0.216 — a hair brighter
   than the #c00000 the engine starts on. It is the stamp's colour, not the theme's. */
const MA_RED="#fa3237";

/* ---- what the tool remembers between reports ---------------------------------------------------
   The contractor and the TA are the same for weeks at a time and the date is today's, so they are
   remembered and the date is offered fresh. Kept in this browser only. */
const MA_PREF_KEY="ma.prefs.v1";
const MA_DEFAULT_PREFS={ scope:"all" };
let MA_PREFS=Object.assign({},MA_DEFAULT_PREFS);
function maLoadPrefs(){
  try{ const raw=localStorage.getItem(MA_PREF_KEY);
    if(raw)MA_PREFS=Object.assign({},MA_DEFAULT_PREFS,JSON.parse(raw)||{});
  }catch(e){ LOG&&LOG("stamp settings could not be read back",e&&e.message); }
  if(!MA_PREFS.date)MA_PREFS.date=maToday();
  return MA_PREFS;
}
function maSavePrefs(){
  try{ localStorage.setItem(MA_PREF_KEY,JSON.stringify(MA_PREFS)); }
  catch(e){ LOG&&LOG("stamp settings could not be saved",e&&e.message); }
}
function maToday(){
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  return p(d.getMonth()+1)+"/"+p(d.getDate())+"/"+d.getFullYear();
}

/* ---- the geometry of one page ------------------------------------------------------------------
   Every measurement below is in POINTS and divided by the page's own size, because the pages in one
   report are not all the same size or the same way up. */
function maPageDims(pi){
  const P=S.pages[pi];
  return {w:(P&&P.w1)||612, h:(P&&P.h1)||792};
}
function maPt(pi){ const d=maPageDims(pi); return {x:v=>v/d.w, y:v=>v/d.h, w:d.w, h:d.h}; }

/* =================================================================================================
   1. PAGE RANGES
   -------------------------------------------------------------------------------------------------
   Several things here act on more than one page at a time, and they all ask the same question first.
   ================================================================================================= */
/* Which pages a bulk action runs on. */
function maScopePages(scope,rangeText){
  const n=S.pages.length;
  if(scope==="page"){ const i=currentPageIdx(); return i==null?[]:[i]; }
  if(scope==="range"){
    const out=maParseRange(rangeText,n);
    return out;
  }
  const all=[];
  for(let i=0;i<n;i++)all.push(i);
  return all;
}
/* "1-4, 9, 12-" — one-based on the way in, zero-based on the way out. */
function maParseRange(text,n){
  const out=[];
  String(text||"").split(/[,;]+/).forEach(part=>{
    const t=part.trim(); if(!t)return;
    const m=/^(\d+)\s*(?:[-–]\s*(\d+)?)?$/.exec(t);
    if(!m)return;
    const a=Math.max(1,parseInt(m[1],10));
    const b=m[2]?Math.min(n,parseInt(m[2],10)):(/[-–]/.test(t)?n:a);
    for(let i=a;i<=b;i++)if(i>=1&&i<=n&&out.indexOf(i-1)<0)out.push(i-1);
  });
  return out;
}


/* You dragged one stamp where you want it; put every other one in the same place.
   The position travels as an inset from the top-right corner, so it lands correctly on the


/* =================================================================================================
   2. CORRECTING A PRINTED VALUE — strike it, write the as-built one above it
   -------------------------------------------------------------------------------------------------
   The engine's Redline tool covers a printed value with an editable mark, which is one of the two
   patterns in the sample files. The other is the one below: a rule through the printed value and the
   replacement written just above it, which is what the reports do for centrelines and elevations
   where the original has to stay readable. The two are grouped so the pair moves together.
   ================================================================================================= */
function maStrikeAndWrite(pi,it){
  if(!it)return null;
  const pt=maPt(pi);
  const h=it.nh||pt.y(8);
  let id=null;
  historyBatch(()=>{
    const g=++seq;
    /* 6fc — THE AS-BUILT VALUE SITS ON THE PRINTED ONE, not on the line above it.
       Ced: "make the write in strike and write DIRECTLY on top or overlaid on text and strike instead
       of above it." Written above, a correction needs clear space that a drawing sheet rarely has and a
       dense table never has — on the loading tables it landed in the row above and read as a correction
       to THAT row. Over the printed run there is no ambiguity about which value it replaces.
       Pre-filled with what is printed, so it is edited rather than typed from nothing. */
    id=addText(pi,it.nx,it.ny,String(it.str||"").trim());
    const a=S.annos.find(z=>z.id===id);
    if(a){
      a.group=g; a.maKind="fix"; a.align="center"; a.alignSet=true;
      const size=printedSizeFor(pi,it,markFontKey(a)); if(size)a.size=size;   /* 6fh */
      a.nh=h; a.lineNh=h; a.lines=1; a.nowrap=true; a.manualW=true;
      a.nw=Math.max(it.nw||0,measureTextNorm(String(it.str||""),a.size,pi,markFontKey(a))+pt.x(4));
      a.nx=Math.max(0,it.nx+((it.nw||0)/2)-a.nw/2);
      /* 6ha — ON the printed value, not above it (see MA_WRITE_ON). `maSyncStrikes` settles the exact
         position on the next draw pass; this is where it starts, which is the printed run's own line. */
      a.ny=Math.max(0,it.ny);
      a.onCell=false; a.bgNone=false;
      /* 6hb — AND IT READS ON TOP OF THE RULE. Ced: "the number 11 was not followed. revert the strike
         and write into a text directly on top of redlined." It WAS over the printed value — and under
         the strike, because 6gn made a new mark start in the layer below the strokes, so the rule was
         drawn across the as-built value and the correction looked struck out itself. `under:false` is
         the layer above the strokes: the rule runs across the printed value it cancels, and the value
         you have written reads over the top of it. */
      a.under=false; try{ topZ(a); }catch(e){}   /* 6i3 */
      a.z=(a.z||0)+2;
    }
    /* and the strike, run END TO END of whichever is wider — the printed value or what was written
       over it — so the rule reads either side of the new value instead of vanishing under it. */
    const l0=Math.min(it.nx,(a?a.nx:it.nx))-pt.x(2);
    const l1=Math.max(it.nx+(it.nw||pt.x(20)),(a?a.nx+a.nw:0))+pt.x(2);
    const lid=addLine(pi,Math.max(0,l0),it.ny+h*0.55,l1,it.ny+h*0.55,{maKind:"strike"});
    const ln=S.lines.find(z=>z.id===lid); if(ln)ln.group=g;
  });
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  if(id!=null)setTimeout(()=>{
    const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
    if(ed){ selectAnno(id); ed.focus(); try{document.getSelection().selectAllChildren(ed);}catch(e){} }
  },0);
  toolDone();
  return id;
}


/* =================================================================================================
   3. CALLOUTS AND THE PARTS LIBRARY
   -------------------------------------------------------------------------------------------------
   A callout on a drawing sheet is a leader line to a member and, beside it, four lines: what it is,
   who makes it, its part number, and how many per sector —

       New Sector Frame
       MFR: Sabre
       Part# C10841002C
       (1) per sector

   The parts repeat from site to site, so the library below is seeded with the ones that appear in
   the sample reports and anything you add is kept in this browser.
   ================================================================================================= */
const MA_PARTS_KEY="ma.parts.v1";
const MA_SEED_PARTS=[
  {name:"New Sector Frame",       mfr:"Sabre",      part:"C10841002C",     qty:"(1) per sector"},
  {name:"New Sector Frame",       mfr:"Sabre",      part:"C10857001C",     qty:"(1) per sector"},
  {name:"New Crossover Plate",    mfr:"Site Pro 1", part:"SCX7-U",         qty:"(12) per sector"},
  {name:"New Pipe",               mfr:"Site Pro 1", part:"P30120",         qty:"(6) per sector"},
  {name:"New Pipe",               mfr:"Site Pro 1", part:"P4126",          qty:"(1) per sector"},
  {name:"New Mount Pipe",         mfr:"Site Pro 1", part:"P30174",         qty:"(1) per sector"},
  {name:"New Ring Mount",         mfr:"Site Pro 1", part:"LWRM",           qty:"(2) per sector"},
  {name:"New Ballast Mount",      mfr:"Site Pro 1", part:"RTP12-3RRU-NP",  qty:"(1) per sector"},
  {name:"New Mounting Pipe",      mfr:"CommScope",  part:"MT-547-126",     qty:"(1) per sector"},
  {name:"New RRH Bracket",        mfr:"Ericsson",   part:"SXK1255394/2",   qty:"(1) per RRH"},
  {name:"New Antenna",            mfr:"",           part:"",               qty:"(3) per sector"},
  {name:"New RRH Unit",           mfr:"",           part:"",               qty:"(4) per sector"},
  {name:"Existing Raycap",        mfr:"",           part:"",               qty:"(1) per sector"},
  {name:"Existing Antenna",       mfr:"",           part:"",               qty:"(1) per sector"}
];
let MA_PARTS=MA_SEED_PARTS.slice();
function maLoadParts(){
  try{ const raw=localStorage.getItem(MA_PARTS_KEY);
    if(raw){ const v=JSON.parse(raw); if(Array.isArray(v)&&v.length)MA_PARTS=v; }
  }catch(e){ LOG&&LOG("parts library could not be read back",e&&e.message); }
  return MA_PARTS;
}
function maSaveParts(){
  try{ localStorage.setItem(MA_PARTS_KEY,JSON.stringify(MA_PARTS)); }
  catch(e){ LOG&&LOG("parts library could not be saved",e&&e.message); }
}
function maPartText(p){
  return [p.name,p.mfr?("MFR: "+p.mfr):"",p.part?("Part# "+p.part):"",p.qty].map(s=>String(s||"").trim())
    .filter(Boolean).join("\n");
}

/* =================================================================================================
   THE DRAWING TOOLS
   -------------------------------------------------------------------------------------------------
   A mount analysis is redlined on two kinds of page. On a table page the marks sit on printed values
   and the engine's cell machinery is the whole story. On a DRAWING page — the elevations, the mount
   details, the manufacturer's assembly sheets — there is nothing to sit on: you ring the member that
   was actually installed, point at it, and write what it is. That is what these are for.

   Everything below produces an ordinary mark, so it selects, drags, resizes, groups, undoes and
   exports like everything else. What is new is that each one carries its own look.
   ================================================================================================= */

/* =================================================================================================
   A STYLE PER TOOL
   -------------------------------------------------------------------------------------------------
   One set of colours for the whole document is wrong the moment you have more than one kind of mark on
   a page. A correction over a printed value wants red text on white, so it hides what it replaces. A
   box round an installed member wants a red rule and a white interior — opaque, because the whole
   point is to cover what is underneath it and write the as-built value in. A note on a drawing wants
   text with no ground at all. Those are three different answers, and picking a tool should bring its
   own answer with it rather than making you set the ribbon again every time you switch.

   So each tool keeps its own: open the tool's ▾ and it shows what that tool draws with; change a
   control, and that tool remembers it. Everything is kept in this browser, per tool, for good.
   ================================================================================================= */
const MA_STYLE_KEY="ma.toolstyles.v1";

/* The red these reports are marked up in, measured off the sample annotations. */
const MA_TOOL_DEFAULTS={
  /* a correction over a printed value: red on white, at the size the form prints */
  redline:  {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8},
  fix:      {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8},
  /* a note on a sheet: bigger, and still on white so it reads over a busy drawing */
  text:     {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:10},
  /* shapes: a red rule and a WHITE interior, opaque — a box drawn on a drawing is there to cover
     something and be written in, which is how the mark-up tools everyone uses start too */
  box:      {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:9},
  circle:   {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:9},
  /* 6gd — the leader's endings belong to the callout tool as well, so its arrowhead can be changed
     in its own properties like every other stroke's */
  callout:  {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8,
             le0:"", le1:"arrow"},
  /* 6gd — a snapshot pasted back onto the sheet is a mark with a look: the frame's colour and weight,
     and the picture's own opacity. */
  /* 6gk — `frameSw` is the snapshot's OWN frame width. It is not the shared `sw` the ribbon writes,
     so nothing another tool does can put a border back on a snapshot: it starts at none and stays
     there until the Frame slider in its own panel says otherwise. */
  /* 6ie — and it converts by default: a snapshot is a redline of what it captured unless the
     Capture chip says Plain. */
  snapshot: {col:MA_RED, sw:0, frameSw:0, colOp:1, fill:"#ffffff", fillOp:1, bg:"#ffffff",
             font:"arial", size:8, tint:true, region:"rect"},
  /* strokes carry no interior; the fill is kept so switching to a shape does not lose it.
     `le0`/`le1` are the two ends: the Arrow tool is an arrow because its far end is one, and the
     Line tool is a line because neither end is. That is the whole difference between them. */
  arrow:    {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:"arrow"},
  line:     {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:""},
  /* 6gg — a LENGTH: an arrow at each end and the reading written on it, on white so the rule reads as
     broken by its own dimension. `dimScale` is real inches per inch of paper — 48 is 1/4" = 1'-0" —
     `dimUnit` how the reading is written, `dimPrec` what fraction of an inch it is rounded to. */
  dim:      {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:10,
             le0:"arrow", le1:"arrow", dimScale:48, dimUnit:"ft", dimPrec:16,
             /* 6gj — Ced: "it should not have a length as already populated, it should be up to the
                user." So a new measurement comes up with its reading EMPTY and the cursor in it. The
                measured length is still worked out and shown while you drag, and the panel will write
                it in for you on request — it is offered, not assumed. */
             dimAuto:false},
  poly:     {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:"arrow"},
  cross:    {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:""},
  strikerow:{col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:""},
  crossout: {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8, le0:"", le1:""},
  select:   {col:MA_RED, sw:1.5, fill:"#ffffff", fillOp:1, bg:"#ffffff", font:"arial", size:8}
};
let MA_TOOL_STYLES={};
function maLoadToolStyles(){
  MA_TOOL_STYLES={};
  Object.keys(MA_TOOL_DEFAULTS).forEach(k=>{ MA_TOOL_STYLES[k]=Object.assign({},MA_TOOL_DEFAULTS[k]); });
  try{
    const raw=localStorage.getItem(MA_STYLE_KEY);
    if(raw){ const v=JSON.parse(raw)||{};
      Object.keys(v).forEach(k=>{ if(MA_TOOL_STYLES[k])MA_TOOL_STYLES[k]=Object.assign(MA_TOOL_STYLES[k],v[k]); });
    }
  }catch(e){ LOG&&LOG("tool styles could not be read back",e&&e.message); }
  return MA_TOOL_STYLES;
}
function maSaveToolStyles(){
  try{ localStorage.setItem(MA_STYLE_KEY,JSON.stringify(MA_TOOL_STYLES)); }
  catch(e){ LOG&&LOG("tool styles could not be saved",e&&e.message); }
}
/* Which tool's style the ribbon is showing. Select has no marks of its own, so it keeps showing
   whatever was last drawn with — otherwise every trip through Select would reset the controls. */
let MA_STYLE_TOOL="redline";
/* 6f6 — while a tool's properties panel is doing the writing, the tool being EDITED is the one that
   answers, not the one that happens to be picked up. Without this, opening Box's panel while the Line
   tool was active wrote Box's changes onto Line. Set only for the duration of a panel's own write. */
let MA_TOOL_OVERRIDE=null;
function maToolOf(mode){
  if(!mode&&MA_TOOL_OVERRIDE)return MA_TOOL_OVERRIDE;
  const m=mode||S.mode||"redline";
  if(m==="select")return MA_STYLE_TOOL;
  return MA_TOOL_DEFAULTS[m]?m:"redline";
}
/* What the ribbon is set to right now, as a style object. */
function maStyleNow(){
  const num=(id,dflt)=>{ const f=$("#"+id); const v=f?parseFloat(f.value):NaN; return isNaN(v)?dflt:v; };
  const val=(id,dflt)=>{ const f=$("#"+id); return (f&&f.value)||dflt; };
  /* 6f6 — the seven fields below have an input each; everything else a tool's properties panel can
     set (endings, line style, hatch, decorations, opacity, highlight) has no ribbon control at all and
     lives only against the tool. Starting from the stored style and overlaying the inputs means a new
     property is picked up by every mark without another line here. */
  return Object.assign({}, MA_TOOL_STYLES[maToolOf()]||{}, {
    col:val("c_text",MA_RED),
    sw:num("c_sw",1.5),
    fill:val("c_fill","#ffffff"),
    fillOp:Math.max(0,Math.min(1,num("c_fop",100)/100)),
    bg:val("c_bg","#ffffff"),
    size:num("c_pt",8),
    font:val("c_font","arial")
  });
}
/* The style fields a MARK carries beyond the seven above, and the ones a STROKE carries. Stamped at
   creation so a mark keeps the look it was drawn with even after the tool is restyled. */
const MA_MARK_EXTRA=["colOp","dash","pat","patCol","patScale","patRot","patOp","hl","uline","strikeout","valign",
                     /* 6he — tracking and leading are per-tool like every other text property */
                     "lsp","lnsp",
                     /* 6hp — and the pattern a shape's rule carries */
                     "lpat",
                     /* 6jw — and whether its corners are sharp, round or bevelled */
                     "join",
                     /* 6ht — and how its lines break */
                     "wrapMode"];
const MA_LINE_EXTRA=["colOp","dash","lpat","hl","le0","le1","leSz","join"];   /* 6jw */
function maStampExtras(a,st,keys){
  if(!a||!st)return a;
  (keys||MA_MARK_EXTRA).forEach(k=>{ if(st[k]!=null&&st[k]!=="")a[k]=st[k]; });
  return a;
}
/* Put a tool's style into the ribbon. */
let _maStyleSyncing=false;
function maShowToolStyle(mode){
  const tool=maToolOf(mode);
  MA_STYLE_TOOL=tool;
  const st=MA_TOOL_STYLES[tool]||MA_TOOL_DEFAULTS.redline;
  _maStyleSyncing=true;
  try{
    const put=(id,v)=>{ const f=$("#"+id); if(f&&v!=null)f.value=v; };
    put("c_text",st.col); put("c_sw",st.sw); put("c_bg",st.bg);
    put("c_fill",st.fill); put("c_fop",Math.round((st.fillOp!=null?st.fillOp:1)*100));
    put("c_pt",st.size); put("c_font",st.font);
    const g=document.querySelector("#toolbar .grp-style");
    if(g)g.setAttribute("data-lbl","Style · "+((typeof MODE_NAMES!=="undefined"&&MODE_NAMES[tool])||tool));
  } finally { _maStyleSyncing=false; }
}
/* Take what the ribbon now says and keep it against the tool it belongs to. */
function maRememberToolStyle(){
  if(_maStyleSyncing)return;
  const tool=maToolOf();
  MA_TOOL_STYLES[tool]=Object.assign(MA_TOOL_STYLES[tool]||{},maStyleNow());
  maSaveToolStyles();
}

/* Draw a box or an ellipse. `nw`/`nh` may arrive negative when the drag went right-to-left or
   bottom-to-top, which is a perfectly ordinary way to draw one, so they are normalised here. */
function maAddShape(pi,shape,nx,ny,nw,nh,opts){
  const st=Object.assign(maStyleNow(),opts||{});
  if(nw<0){ nx+=nw; nw=-nw; }
  if(nh<0){ ny+=nh; nh=-nh; }
  let id=null;
  /* A shape is drawn to ring something on the page, not to be typed in — so it comes up SELECTED but
     without the caret. That leaves Delete, the arrow keys and the properties panel all pointing at it
     straight away; a double-click is what opens it for text. (A callout is the exception and asks for
     the caret itself, because the words are the point of it.) */
  const quiet=!(opts&&opts.focus);
  if(quiet)_maQuiet=true;
  try{
  historyBatch(()=>{
    id=addText(pi,nx,ny,(opts&&opts.text)||"");
    const a=S.annos.find(z=>z.id===id);
    if(a){
      a.shape=shape; a.maKind=(opts&&opts.maKind)||shape;
      /* 6iv — a shape may be as small as a pen mark: one point square. The old floor of 0.004 was
         about 2.4pt, which on a drawing sheet is a visible box you did not ask for. */
      a.nw=Math.max(0.0012,nw); a.nh=Math.max(0.0012,nh);
      a.col=st.col; a.sw=st.sw; a.fill=st.fill; a.fillOp=st.fillOp; a.size=st.size;
      maStampExtras(a,st);                       /* line style, hatch, opacity, highlight, decorations */
      a.align=(opts&&opts.align)||st.align||"center";
      a.manualW=true; a.nowrap=false; a.wrap=false; a.onCell=false; a.fullcell=false;
      a.under=false; a.lineNh=null; try{ topZ(a); }catch(e){}   /* 6i3 */
      a.lines=Math.max(1,String(a.text||"").split("\n").length);
    }
  });
  } finally { if(quiet)_maQuiet=false; }
  layoutAnnos(); updateRail(); updateCount();
  toolDone();
  if(id!=null&&quiet)selectAnno(id);
  return id;
}

/* A TEXT BOX placed on blank page. The Redline tool covers a printed value and takes its size and
   place from the print; this is the other half — somewhere on a drawing with nothing underneath it,
   sized by what you type, on whatever ground the Text tool's Fill colour is set to. White hides what
   is under it; set it to the page colour, or to nothing, and the drawing reads through. */
/* 6mr — how wide "Add text here" is, in points, at a given size. One canvas, measured once per
   size, because a new text box is a thing you make over and over. */
const MA_PROMPT="Add text here";
let _promptCv=null, _promptAt={};
function maPromptPt(size){
  const k=Math.round((+size||8)*4)/4;
  if(_promptAt[k]!=null)return _promptAt[k];
  let w=0;
  try{
    if(!_promptCv)_promptCv=document.createElement("canvas").getContext("2d");
    _promptCv.font=k+"px Arial, Helvetica, sans-serif";
    w=_promptCv.measureText(MA_PROMPT).width;         /* px at 1px=1pt, which is what pt.x wants */
  }catch(e){}
  if(!(w>0))w=k*6.6;                                  /* the same string, measured, if canvas fails */
  _promptAt[k]=Math.max(20,w+5);                      /* 5pt so the caret is not on the frame */
  return _promptAt[k];
}
function maAddTextBox(pi,x,y,text,wNorm,hNorm){
  const st=maStyleNow();
  const pt=maPt(pi);
  /* ==================================================================================================
     6mo — A NEW TEXT BOX IS ONE LINE, AND NARROW. Ced: "make text typing like this, and don't make
     the text box big, just one layer and small width first", with a picture of a slim single-line
     box carrying a caret.

     A click gave 150pt by TWO lines of leading plus 4 — a block, before a single character had been
     typed, and on a drawing that is a block sitting over whatever you were about to label. What a
     redline note actually is, nearly always, is one short line. So one line is what it is born as,
     and it grows down as it wraps, which `growTextBox` has done since 6m4. 100pt is about eight
     characters at the sizes this tool writes at — enough to aim at and to grab a handle on, and
     small enough that the sheet underneath is still visible while you type.

     A box DRAGGED out keeps exactly the size it was dragged; 6m5 made that promise and this does not
     touch it. This is the click. */
  /* 6mr — AND THE WIDTH IS THE PROMPT'S WIDTH. Ced, after v52's 100pt: "text box is again too big,
     make it one layer and just the width of 'Add text here'." 100pt was a guess at eight characters;
     the prompt is thirteen and the right answer is not a guess at all — it is what the prompt
     measures at the size this box is about to be written in. Measured rather than tabulated, so it
     stays right at 6pt and at 24pt and in whatever face the ribbon is set to. */
  let w=(wNorm!=null&&wNorm!==0)?wNorm:pt.x(maPromptPt(st.size));
  let h=(hNorm!=null&&hNorm!==0)?hNorm:pt.y(st.size*1.22+4);
  if(w<0){ x+=w; w=-w; }
  if(h<0){ y+=h; h=-h; }
  w=Math.max(pt.x(24),w); h=Math.max(pt.y(st.size*1.22+3),h);
  const lineNh=pt.y(st.size*1.22);
  let id=null;
  historyBatch(()=>{
    id=addText(pi,Math.max(0,x),Math.max(0,y),text||"");
    const a=S.annos.find(z=>z.id===id);
    if(a){
      /* ==========================================================================================
         6kc — A TEXT BOX STARTS CENTRED, BOTH WAYS.
         Ced: "make sure texts are always in the middle vertically and horizontally first."
         A new box filled from the top left, which is right for a paragraph and wrong for what this
         tool makes: a short note dropped beside a member, a value over a cell, a word in a callout —
         all of which read as labels and want to sit in the middle of the box they were drawn. FIRST
         is the operative word: this is the state a box is born in, and the alignment controls still
         move it anywhere the moment the user says so. A tool's own saved alignment still wins, so a
         text tool set to left-align keeps left-aligning. */
      a.maKind="text"; a.size=st.size;
      a.align=st.align||"center"; a.alignSet=true;
      a.valign=st.valign||"middle";
      a.under=false; a.onCell=false; a.fullcell=false; try{ topZ(a); }catch(e){}   /* 6i3 */
      maStampExtras(a,st);                     /* decorations, opacity, ground opacity, highlight */
      /* the box IS the mark: it has a width and a height from the moment it is drawn, it wraps
         inside them, and every handle resizes it */
      a.nw=w; a.nh=h; a.manualW=true; a.nowrap=false; a.wrap=true;
      a.lineNh=lineNh; a.lines=Math.max(1,Math.round(h/lineNh)); a.pLines=1;
    }
  });
  layoutAnnos(); updateRail(); updateCount();
  toolDone();
  return id;
}

/* ---- the polyline, one click at a time --------------------------------------------------------
   A leader across a drawing sheet rarely runs straight: it comes off the member, turns, and ends
   beside the note. So this collects a point per click and draws what it has so far, with the segment
   under the pointer shown live, until you finish it with a double-click, Enter, or the tool again. */
let _maPoly=null;
/* the corner a new segment is measured from — null before the first click */
function maPolyLast(){ return (_maPoly&&_maPoly.pts.length)?_maPoly.pts[_maPoly.pts.length-1]:null; }
function maPolyPoint(pi,x,y){
  if(_maPoly&&_maPoly.page!==pi)maPolyFinish();
  /* A double-click is a click, a click and then the double — so the gesture that FINISHES a polyline
     also lands two more points on top of the last one. A point that repeats the one before it is not a
     corner, so it is dropped rather than drawn. */
  if(_maPoly&&_maPoly.pts.length){
    /* 6gb — and the tolerance has to be a HAND's tolerance, not a pixel's. A double-click drifts a few
       pixels between its two clicks, and the page itself can move a little under it, so a 3px window
       let the finishing gesture leave a stub segment behind. 8px of the sheet is still far tighter
       than anyone aims, and nobody puts two corners of a leader that close together on purpose. */
    const last=_maPoly.pts[_maPoly.pts.length-1];
    if(Math.abs(last[0]-x)<0.010&&Math.abs(last[1]-y)<0.010)return;
  }
  /* 6g8 — CLICKING BACK ON THE FIRST CORNER CLOSES THE SHAPE.
     Ced asked for an enclosed polyline to take a fill; having to click the start point and THEN
     double-click to finish is not how anyone draws one. So a click that lands on the first corner
     lays that corner down exactly and finishes there — `maPolyFinish` then sees a run that ends
     where it began and closes and fills it. */
  if(_maPoly&&_maPoly.pts.length>=3){
    const P=S.pages[pi]||{}, ar=((P.w1||612)/(P.h1||792));
    const a=_maPoly.pts[0];
    if(Math.hypot(x-a[0],(y-a[1])*ar)<=MA_CLOSE_TOL){
      _maPoly.pts.push([a[0],a[1]]);
      maPolyFinish();
      return;
    }
  }
  if(!_maPoly){
    _maPoly={page:pi,pts:[[x,y]],hover:null};
    maPolyPaint();
    setStatus("Click the next corner · double-click or Enter to finish · Esc to cancel");
    return;
  }
  _maPoly.pts.push([x,y]);
  maPolyPaint();
}
function maPolyPaint(){
  document.querySelectorAll(".page svg.draw .polydraft").forEach(n=>n.remove());
  if(!_maPoly)return;
  const pg=document.querySelector(`.page[data-idx="${_maPoly.page}"]`); if(!pg)return;
  /* 6ia — the draft goes in the UPPER stroke layer, where you can see it */
  const svg=pg.querySelector("svg.draw:not(.under)"); if(!svg)return;
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const st=maStyleNow();
  const pts=_maPoly.pts.concat(_maPoly.hover?[_maPoly.hover]:[]);
  const mk=(tag,attrs)=>{ const n=document.createElementNS("http://www.w3.org/2000/svg",tag);
                          for(const k in attrs)n.setAttribute(k,attrs[k]); n.classList.add("polydraft");
                          n.style.pointerEvents="none"; return n; };
  if(pts.length>=2){
    svg.appendChild(mk("polyline",{points:pts.map(p=>(p[0]*w).toFixed(1)+","+(p[1]*h).toFixed(1)).join(" "),
      fill:"none",stroke:st.col,"stroke-width":Math.max(1,st.sw*S.scale),
      "stroke-linecap":"round","stroke-linejoin":"round","stroke-dasharray":"1 0",opacity:.85}));
  }
  _maPoly.pts.forEach(p=>svg.appendChild(mk("circle",{cx:p[0]*w,cy:p[1]*h,r:3.5,fill:st.col})));
}
/* 6g1 — A POLYLINE THAT COMES BACK TO ITS START IS A SHAPE.
   Ced: "when polylines were enclosed (last line touches the first point) it should have a fill."
   So the finish checks whether the last corner landed on the first one — within a few points of it,
   because nobody hits a pixel — and if it did, the stroke is CLOSED: the last point is snapped exactly
   onto the first, the run is drawn as a polygon, and it takes the tool's fill colour and opacity the
   way a box does. Everything else about it stays a stroke: the same points, the same handles, the same
   line style, the same export path. */
const MA_CLOSE_TOL=0.012;        /* of the page width — about 7pt, a comfortable click */
function maPolyFinish(){
  const d=_maPoly; _maPoly=null;
  document.querySelectorAll(".page svg.draw .polydraft").forEach(n=>n.remove());
  if(!d||d.pts.length<2){ setStatus("Polyline cancelled."); toolDone(); return null; }
  const st=maStyleNow();
  let pts=d.pts.map(p=>[p[0],p[1]]);
  let closed=false;
  if(pts.length>=3){
    const P=S.pages[d.page]||{}, ar=((P.w1||612)/(P.h1||792));
    const a=pts[0], b=pts[pts.length-1];
    const dx=b[0]-a[0], dy=(b[1]-a[1])*ar;              /* measured square, on the printed sheet */
    if(Math.hypot(dx,dy)<=MA_CLOSE_TOL){ pts[pts.length-1]=[a[0],a[1]]; closed=true; }
  }
  const id=addLine(d.page,pts[0][0],pts[0][1],pts[pts.length-1][0],pts[pts.length-1][1],
                   {pts:pts,col:st.col,sw:st.sw});   /* a head is added from the stroke's own bar */
  const l=S.lines.find(z=>z.id===id);
  if(l&&closed){
    l.closed=true; l.fill=st.fill; l.fillOp=(st.fillOp!=null?st.fillOp:1);
    l.le0=""; l.le1="";                                /* a closed run has no ends to decorate */
    syncArrowFlag(l);
    drawPageLines(d.page);
  }
  selectLine(id);
  setStatus(closed?`Closed shape with ${pts.length-1} sides — it takes the tool's fill.`
                  :`Polyline with ${pts.length} points.`);
  toolDone();
  return id;
}
function maPolyCancel(){
  if(!_maPoly)return false;
  _maPoly=null;
  document.querySelectorAll(".page svg.draw .polydraft").forEach(n=>n.remove());
  setStatus("Polyline cancelled.");
  return true;
}

/* ---- restyling what is already on the page ----------------------------------------------------
   A tool's ▾ properties are the same control for both jobs: with nothing selected they set what the next
   mark will look like, and with something selected it changes what is selected. Anything else means
   drawing a shape, not liking the colour, deleting it and drawing it again. */
function maSelectedMarks(){
  const ids=new Set();
  if(S.sel!=null)ids.add(S.sel);
  (S.selMulti||new Set()).forEach(id=>ids.add(id));
  const annos=(S.annos||[]).filter(a=>ids.has(a.id));
  const lids=new Set();
  if(S.selLine!=null)lids.add(S.selLine);
  (S.selMultiL||new Set()).forEach(id=>lids.add(id));
  const lines=(S.lines||[]).filter(l=>lids.has(l.id));
  /* 6g9 — a callout answers as a whole: its leader is part of it, so a restyle, a delete or a copy
     that catches the box catches the leader, and one that catches the leader catches the box. */
  annos.slice().forEach(a=>{ const l=maCalloutLeaderOf(a);
    if(l&&!lines.some(z=>z.id===l.id))lines.push(l); });
  lines.slice().forEach(l=>{ const b=maCalloutBoxOf(l);
    if(b&&!annos.some(z=>z.id===b.id))annos.push(b); });
  /* 6gj — and a MEASUREMENT the same way. Ced: "apply the same logic as callout to length where it is
     editable but is treated as one shape." The run and its reading are one mark: whichever half a
     gesture catches, both are in the selection, so a restyle, a move, a copy or a delete reaches the
     whole of it. The panels know to read the run for the stroke and the reading for the words. */
  annos.slice().forEach(a=>{ const l=maDimLineOf(a);
    if(l&&!lines.some(z=>z.id===l.id))lines.push(l); });
  lines.slice().forEach(l=>{ const lab=maDimLabelOf(l);
    if(lab&&!annos.some(z=>z.id===lab.id))annos.push(lab); });
  /* a group answers as a whole: restyling one half of a callout and not the other is never meant */
  /* =================================================================================================
     6ko — EXCEPT THE GROUP YOU ARE INSIDE. Ced: "make sure flattening a redline will not ruin the rest
     of other redlines and will only change and flatten the specific redline selected."

     6jz made a group ISOLATE on a double-click: the one member you picked gets its own handles, its
     own bar and its own restyle while the grouping survives. That reached the pointer and stopped
     here. Every action that asks this function what is selected — flatten, delete, restyle, copy,
     lock, apply-to-pages — expanded the one isolated mark back out to the whole group, so going
     inside a group bought you nothing but a different set of handles: flatten one arrow in a stamp
     and the whole stamp went into the page.

     An OPEN group is the user saying "this one, not the set". Closed groups still answer as a whole,
     which is what a group is for; `groupOpenIs` is the same question 6jz's pointer paths ask, so the
     two cannot drift. A member that was itself picked by hand is still in `ids`, so selecting two
     marks inside an open group reaches exactly those two.
     ================================================================================================= */
  const _open=(typeof groupOpenNow==="function")?groupOpenNow():null;
  const groups=new Set(annos.concat(lines).map(o=>o.group)
                        .filter(g=>g!=null&&!(_open!=null&&g===_open)));
  if(groups.size){
    (S.annos||[]).forEach(a=>{ if(a.group!=null&&groups.has(a.group)&&!ids.has(a.id))annos.push(a); });
    (S.lines||[]).forEach(l=>{ if(l.group!=null&&groups.has(l.group)&&!lids.has(l.id))lines.push(l); });
  }
  return {annos,lines};
}
/* 6gg — the marks a selection OWNS but does not itself show: a measurement's reading. Kept out of
   `maSelectedMarks` on purpose — the properties panels read the FIRST selected mark to decide what
   they are showing, and a reading is not what a measurement's panel is about — and folded in by the
   paths that copy or restyle a selection wholesale, where leaving it out would split the mark. */
function maOwnedReadings(sel){
  const out=[];
  (sel&&sel.lines||[]).forEach(l=>{ if(l.dimFor==null)return;
    const a=(S.annos||[]).find(z=>z.id===l.dimFor);
    if(a&&!((sel.annos||[]).some(z=>z.id===a.id))&&!out.some(z=>z.id===a.id))out.push(a); });
  return out;
}
function maRestyleSelection(what){
  const sel=maSelectedMarks();
  if(!sel.annos.length&&!sel.lines.length)return 0;
  /* 6ky — the fourth thing a lock promises: "cannot be moved, resized, RESTYLED or deleted". The
     move, the resize and the turn each refuse at their own gesture; this did not, so a locked mark
     quietly took whatever colour or weight the panel was showing. `lockedAmong` is the same
     predicate the Delete key and the bar's own Delete ask. */
  if(typeof lockedAmong==="function"&&lockedAmong(sel.annos,sel.lines)){
    try{ toast("Unlock these first"); }catch(e){}
    try{ setStatus("Locked \u2014 unlock these marks before restyling them.",true); }catch(e){}
    return 0;
  }
  /* a measurement restyles whole: the run and the reading written on it */
  try{ maOwnedReadings(sel).forEach(a=>sel.annos.push(a)); }catch(e){}
  const st=maStyleNow();
  historyBatch(()=>{
    sel.annos.forEach(a=>{
      if(what==="col")a.col=st.col;
      else if(what==="sw")a.sw=st.sw;
      else if(what==="fill")a.fill=st.fill;
      else if(what==="fillOp")a.fillOp=st.fillOp;
      else if(what==="bg")a.bg=st.bg;
      else if(what==="size"&&a.kind!=="img")a.size=st.size;
      else if(what==="font"&&a.kind!=="img")a.font=st.font;
      /* 6f6 — everything a properties panel can set that has no ribbon field of its own. Assigned by
         name, so a new property needs no new branch here. */
      else if(MA_MARK_EXTRA.indexOf(what)>=0)a[what]=st[what];
      else if(what==="align"&&st.align)a.align=st.align;
    });
    sel.lines.forEach(l=>{
      if(what==="col")l.col=st.col;
      else if(what==="sw")l.sw=st.sw;
      else if(MA_LINE_EXTRA.indexOf(what)>=0){ l[what]=st[what]; syncArrowFlag(l); }
    });
  });
  layoutAnnos(); drawAllLines();
  return sel.annos.length+sel.lines.length;
}

/* What the next callout will say. Set from the parts list or typed in the panel. */
let MA_CALLOUT_TEXT="";
/* A one-shot placement waiting for a click on a page: the note tool and the parts list both use it. */
let _maPending=null;

/* =================================================================================================
   THE CALLOUT
   -------------------------------------------------------------------------------------------------
   A box with the words in it, and a leader out of the box to the thing the words are about. The
   leader is the part that matters: it leaves the box square, runs a short shoulder, and then goes
   straight to the point with a head on it — which is the shape every mark-up tool draws and the shape
   the redlined reports use.

   The direction is not fixed. Drag the head anywhere and the leader re-leaves the box from whichever
   side now faces it: point at something to the left and the shoulder comes out of the left edge,
   point at something below and it comes out of the bottom. That is what `maSyncCallouts` does, and it
   runs on every redraw, so the leader also follows the box when the box is moved or resized.
   ================================================================================================= */
const MA_LEADER_SHOULDER=0.022;      /* of the page width — about 13pt on a letter page */

/* =================================================================================================
   6fd — THE CALLOUT LEADER
   Ced: "it should have a short line sticking from the box, and the line to arrow. the arrow and the
   ending of the line should be draggable."

   So the leader is three points and always has been — but only the tip could be moved, because the
   sync rebuilt the elbow from the box and the tip on every draw pass and threw away anything the hand
   had done to it. Now the sync owns ONE point: where the leader leaves the box. The elbow and the tip
   are the hand's, and both carry a handle.

     pts[0]  the attach — on the box edge that faces the elbow, derived, never dragged
     pts[1]  the elbow  — the end of the short stub off the box; drag it to swing or lengthen the stub
     pts[2]  the tip    — where the arrowhead is; drag it anywhere

   Dragging the elbow round the box moves the attach to whichever side now faces it, so the stub
   always leaves the box square-on rather than cutting across a corner.
   ================================================================================================= */
/* Where the leader leaves the box, and where the stub's far end must be so the stub leaves the box
   SQUARE-ON. Ced: "the line in between the box and the arrow line should always be perpendicular to
   the side of the box of callout."

   So the elbow is not free: it may be dragged anywhere, and what comes back is the nearest point on
   the perpendicular through the side it now faces. Off the left or right edge that means the stub is
   horizontal and the elbow keeps the attach's own y; off the top or bottom it is vertical and the
   elbow keeps the attach's x. The stub's LENGTH is still the hand's, which is the part worth having.
   Returns [attach, elbow]. */
/* =================================================================================================
   6ga — THE STUB LEAVES THE SIDE THE ARROW IS ON, FROM THE MIDDLE OF IT.
   Ced: "make the location of line adjust based on where the arrow is being located... make the lines
   anchored to center in this feature but can still be manually changed."

   So the geometry is decided by the ARROW, not by the elbow:

     side   the side of the box the arrow faces, measured against the box's own proportions so a wide
            box does not always answer "left or right"
     t      where along that side the leader leaves it, 0 at one corner and 1 at the other. It is 0.5
            — the middle of the side — until the elbow is dragged, and then it is whatever the hand
            put it at, kept on the leader as `coOff`
     len    how far the stub stands off the side, likewise the hand's (`coLen`), clamped between a
            half and two and a half times the default so it stays a stub rather than becoming the
            leader itself

   Dragging the ARROW therefore swings the whole leader round the box and it always leaves square-on
   from the middle of whichever side now faces it; dragging the ELBOW slides that point along the side
   and changes the stub's length, and nothing else moves.
   ================================================================================================= */
/* 6ha — A ROTATED BOX IS STILL A BOX, IN ITS OWN FRAME.
   Ced: "rotating the box in callout breaks the shape." Nothing about the box breaks — the leader does.
   Every number the leader is built from (`nx, ny, nw, nh`) describes the box AS IF IT WERE SQUARE ON,
   because that is what those numbers mean; the rotation is a transform the renderer applies afterwards.
   So the stub was being attached to the edge of a box that was no longer there: on a box turned 30° the
   leader left from a point in mid-air and the note looked torn off its arrow.

   Two conversions fix it and nothing else has to change. The arrow is brought INTO the box's frame to
   decide which side it faces, and the attach and elbow are taken back OUT of it to be drawn. The maths
   is a rotation about the box's centre, done in the page's own points so the page's aspect cannot skew
   it — the same care `maSyncDims` takes over a reading's angle. */
function maRotPt(box,p,dir){
  const deg=(box&&box.rot)||0;
  if(!deg||!p)return p;
  const r=deg*Math.PI/180*((dir<0)?-1:1);
  const P=(typeof S!=="undefined"&&S.pages&&S.pages[box.page])||{};
  const W=P.w1||612, H=P.h1||792;
  const cx=box.nx+(box.nw||0)/2, cy=box.ny+(box.nh||0)/2;
  const dx=(p[0]-cx)*W, dy=(p[1]-cy)*H;
  const c=Math.cos(r), s=Math.sin(r);
  return [cx+(dx*c-dy*s)/W, cy+(dx*s+dy*c)/H];
}
function maCalloutSide(box,px,py){
  const bx=box.nx, by=box.ny, bw=box.nw||0.1, bh=box.nh||0.05;
  const dx=px-(bx+bw/2), dy=py-(by+bh/2);
  const horiz=(Math.abs(dx)/Math.max(bw,1e-6))>=(Math.abs(dy)/Math.max(bh,1e-6));
  return horiz?(dx>0?"right":"left"):(dy>0?"bottom":"top");
}
function maStubLen(side){
  /* a page is taller than it is wide, so the vertical stub is shorter in normalised units */
  return (side==="left"||side==="right")?MA_LEADER_SHOULDER:MA_LEADER_SHOULDER*0.62;
}
/* [attach, elbow] for a side, a position along it and a stand-off. */
function maCalloutStub(box,side,t,len){
  const bx=box.nx, by=box.ny, bw=box.nw||0.1, bh=box.nh||0.05;
  const f=Math.max(0.06,Math.min(0.94,(t==null?0.5:t)));
  const d=maStubLen(side);
  const L=Math.max(d*0.5,Math.min(d*2.5,(len==null?d:len)));
  if(side==="left")  return [[bx,      by+bh*f],[bx-L,      by+bh*f]];
  if(side==="right") return [[bx+bw,   by+bh*f],[bx+bw+L,   by+bh*f]];
  if(side==="top")   return [[bx+bw*f, by      ],[bx+bw*f,   by-L    ]];
  return               [[bx+bw*f, by+bh   ],[bx+bw*f,   by+bh+L ]];
}
/* Turn a dragged elbow back into the two numbers the leader keeps: where along the side it leaves,
   and how far it stands off. The side is NOT taken from the elbow — the arrow owns that. */
function maCalloutFromElbow(box,side,ex,ey){
  const bx=box.nx, by=box.ny, bw=box.nw||0.1, bh=box.nh||0.05;
  if(side==="left"||side==="right"){
    const ax=(side==="right")?(bx+bw):bx;
    return {off:(ey-by)/Math.max(bh,1e-6), len:Math.abs(ex-ax)};
  }
  const ay=(side==="bottom")?(by+bh):by;
  return {off:(ex-bx)/Math.max(bw,1e-6), len:Math.abs(ey-ay)};
}
/* The whole leader, for a callout being placed: box → a short square-on stub → the point. */
function maCalloutLeader(box,tipX,tipY,off,len){
  const side=maCalloutSide(box,tipX,tipY);
  const [attach,elbow]=maCalloutStub(box,side,off,len);
  return [attach,elbow,[tipX,tipY]];
}
/* Keep every callout's leader attached to its box, and its stub square-on to the side it leaves.
   Cheap, idempotent, and called from the draw pass, so a move, a resize, a nudge and an undo all put
   the stub where it belongs. The TIP is never touched: that one is entirely the hand's. */
/* 6g9 — THE CALLOUT IS ONE MARK, NOT TWO IN A GROUP.
   Ced: "i investigated and it seems it's just a grouped rectangle and polyline. please change that,
   it should be a different function."

   It was exactly that: `maPlaceCallout` made a rectangle and a polyline and put a group id on both.
   Everything downstream then treated it as a group — the group bar, Ungroup, the group frame — and
   the leader was an ordinary stroke that happened to sit next to a box.

   Now the box OWNS its leader. The leader carries `coFor`, the box's id, and no group at all:
     · selecting either selects the CALLOUT — the box's handles and the leader's two corner handles
       are on screen together, and the leader shows no stroke bar of its own;
     · moving the box takes the whole leader with it, arrow and all;
     · resizing the box re-derives where the leader leaves it, still square-on;
     · deleting the box deletes its leader, wherever the delete came from;
     · Ungroup cannot take it apart, because there is no group to take apart.
   The elbow and the tip stay the hand's, which is what Ced asked for in v8 and still holds. */
function maCalloutLeaderOf(a){
  if(!a||a.maKind!=="callout"||!S.lines)return null;
  return S.lines.find(l=>l.coFor===a.id)||null;
}
function maCalloutBoxOf(l){
  if(!l||l.coFor==null||!S.annos)return null;
  return S.annos.find(a=>a.id===l.coFor)||null;
}
/* Move a callout's leader with its box. The attach is re-derived on the next draw; the elbow and the
   tip are carried by the same delta so the shape of the leader is preserved exactly. */
function maCalloutMove(a,dnx,dny){
  const l=maCalloutLeaderOf(a); if(!l)return;
  const p=linePts(l).map(q=>[q[0]+dnx,q[1]+dny]);
  l.pts=p; l.x1=p[0][0]; l.y1=p[0][1];
  l.x2=p[p.length-1][0]; l.y2=p[p.length-1][1];
}
/* A copy of a callout is a copy of both halves. `duplicateSelected`, paste and "Apply to pages" all
   copy ANNOTATIONS; this gives the copy its own leader, shifted by however far the box moved, so a
   duplicated callout still points at something. */
function maCalloutCopyFor(srcId,newAnno){
  const src=(S.annos||[]).find(a=>a.id===srcId); if(!src||!newAnno)return null;
  const l=maCalloutLeaderOf(src); if(!l)return null;
  const dnx=newAnno.nx-src.nx, dny=newAnno.ny-src.ny;
  const pts=linePts(l).map(q=>[q[0]+dnx,q[1]+dny]);
  const b=Object.assign({},_cleanL(l),{id:seq++,page:newAnno.page,pts:pts,coFor:newAnno.id,
    group:undefined,x1:pts[0][0],y1:pts[0][1],
    x2:pts[pts.length-1][0],y2:pts[pts.length-1][1]});
  S.lines.push(b);
  return b;
}
/* =================================================================================================
   6gb — STRIKE & WRITE KEEPS ITS RULE ON THE TEXT.
   Ced: "in strike and write, if it was ungrouped, the text should be above the line. also, if grouped,
   make sure the line is aligned center and middle of the text box even when the textbox was changed
   size."

   So while the two are still grouped — which is how the tool leaves them — the rule belongs to the
   box: it runs across the MIDDLE of it, centred on it, and a little way out either side, and it is
   re-derived on every draw pass so resizing the box, moving it or retyping it takes the rule with it.
   Ungroup them and they are two ordinary marks again: the text is lifted clear so it sits ABOVE the
   rule rather than on it, and from then on neither one follows the other.
   ================================================================================================= */
const MA_STRIKE_OVER=0.004;      /* how far the rule runs past the box, as a fraction of page width */
function maStrikeMateOf(l){
  if(!l||l.maKind!=="strike"||l.group==null||!S.annos)return null;
  return S.annos.find(a=>a.group===l.group&&a.maKind==="fix")||null;
}
/* 6gc — THE RULE STAYS PUT AND THE WRITING MOVES TO IT.
   Ced: "the text should be above the line. also, if grouped, make sure the line is aligned center and
   middle of the text box even when the textbox was changed size but do not change the position of
   line, the text must adjust."

   Which is the opposite of the way round v12 had it. The rule is through a PRINTED value — it marks
   what is being removed, so its place on the page is the whole point and nothing may move it. The
   as-built value is the thing that has to find its place: it sits directly ABOVE the rule, centred on
   the rule's own middle, and it re-centres itself whenever the box is resized or retyped. Drag the box
   yourself and it stays where you put it: the pairing is re-established from wherever it lands, so a
   deliberate move is never fought. */
/* 6ha — THE WRITING GOES BACK OVER THE PRINTED VALUE. Ced: "revert the strike and write into a text
   directly on top of redlined. do not copy the style of length tool." 6gc had lifted it clear of the
   rule, which reads well on a drawing sheet and badly everywhere else these reports are redlined: on a
   dense loading table there is no clear space above a row, so the writing landed in the row above and
   read as a correction to THAT row — the very fault 6fc had fixed by putting it over the value in the
   first place. Over the struck value there is never any question which value it replaces: the writing
   carries its own ground, so it covers the printed text, and the rule runs out either side of it. This
   is the fraction of the box's height that sits ABOVE the rule — a little over half, so the rule passes
   through the writing's lower third exactly as it does through the printed line. */
const MA_WRITE_ON=0.55;
function maSyncStrikes(){
  if(!S.lines||!S.lines.length)return;
  S.lines.forEach(l=>{
    const a=maStrikeMateOf(l); if(!a)return;
    if(a.fixFree)return;                       /* the hand has moved it: leave both alone */
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const pg=document.querySelector(`.page[data-idx="${a.page}"]`);
    /* 6jq — THE BOX IN THE PAGE'S OWN UNITS, and only off the screen when the mark has no size of its
       own yet. Ced: "zooming in and out should not change the location and format of the redline
       especially on texts." This was `offsetWidth / page.offsetWidth` — the same reading that moved a
       length's label in 6jm, and it feeds the same kind of loop: the rule's length and the writing's
       position are computed from it and written back, so at a zoom where the element hits a CSS
       minimum, or simply rounds differently, the rule grew and the writing slid along it, and stayed
       there when the zoom came back. `a.nw`/`a.nh` are the mark's own size, kept current by the resize
       handles and by the text as it is typed, and they mean the same thing at every zoom. */
    let w=a.nw||0, hgt=a.nh||0;
    if((!(w>0)||!(hgt>0))&&d&&pg&&pg.offsetWidth){
      if(!(w>0))w=d.offsetWidth/pg.offsetWidth;
      if(!(hgt>0))hgt=d.offsetHeight/pg.offsetHeight;
    }
    /* 6hb — THE RULE FIRST, THEN THE WRITING ON IT. The rule runs end to end of whichever is wider,
       as the writing is typed: the extent it was made with is the minimum, so a rule drawn across a
       long printed value never shrinks to a short correction, and a correction longer than the value
       pushes it out either side rather than disappearing under the writing's own ground. It is settled
       BEFORE the writing is centred, because near the edge of a sheet the rule has to be shifted to fit
       and the writing has to follow it there. */
    if(l.fixW==null)l.fixW=Math.abs(l.x2-l.x1);
    const pad=6/((S.pages[a.page]&&S.pages[a.page].w1)||612);
    const want=Math.min(1,Math.max(l.fixW,w+pad*2));
    if(Math.abs(Math.abs(l.x2-l.x1)-want)>1e-4){
      const left=(l.x1<=l.x2);
      let c=(l.x1+l.x2)/2;
      c=Math.max(want/2,Math.min(1-want/2,c));     /* keep the whole rule on the page */
      const nx1=c-want/2, nx2=c+want/2;
      l.x1=left?nx1:nx2; l.x2=left?nx2:nx1;
      if(l.pts&&l.pts.length===2){ l.pts[0][0]=l.x1; l.pts[1][0]=l.x2; }
    }
    const cx=(l.x1+l.x2)/2, y=Math.min(l.y1,l.y2);
    a.nx=Math.max(0,Math.min(1-w,cx-w/2));     /* centred on the rule */
    a.ny=Math.max(0,y-hgt*MA_WRITE_ON);        /* 6ha — and ON it, over the value it replaces */
  });
}
function maSyncCallouts(){
  if(!S.lines||!S.lines.length)return;
  /* a leader whose box has gone goes with it — this is what makes every delete path correct at once */
  const gone=S.lines.filter(l=>l.maKind==="calloutleader"&&l.coFor!=null&&
                               !(S.annos||[]).some(a=>a.id===l.coFor));
  if(gone.length){ const ids=new Set(gone.map(l=>l.id)); S.lines=S.lines.filter(l=>!ids.has(l.id)); }
  S.lines.forEach(l=>{
    if(l.maKind!=="calloutleader")return;
    /* a file written before 6g9 — or reopened from a PDF, where ids are new — is adopted here: the
       leader joins the callout box nearest the point it leaves from, on its own page, and the group
       that used to hold the two together is dropped. */
    if(l.coFor==null){
      const p0=linePts(l)[0]||[l.x1,l.y1];
      let best=null,bd=1e9;
      (S.annos||[]).forEach(a=>{
        if(a.maKind!=="callout"||a.page!==l.page)return;
        const cx=Math.max(a.nx,Math.min(a.nx+(a.nw||0),p0[0]));
        const cy=Math.max(a.ny,Math.min(a.ny+(a.nh||0),p0[1]));
        const d=Math.hypot(p0[0]-cx,p0[1]-cy);
        if(d<bd){ bd=d; best=a; }
      });
      if(!best)return;
      l.coFor=best.id; l.group=undefined; best.group=undefined;
    }
    const box=maCalloutBoxOf(l);
    if(!box)return;
    if(l.group!=null||box.group!=null){ l.group=undefined; box.group=undefined; }
    let p=linePts(l).map(q=>[q[0],q[1]]);
    const tip=p[p.length-1];
    if(p.length<3)p=[[0,0],[0,0],[tip[0],tip[1]]];    /* an older two-point leader gains its stub */
    /* 6ga — the side comes from the ARROW; the position along it and the stand-off are the leader's
       own two numbers, which start at the middle of the side and only move when the elbow is dragged */
    /* 6ha — decided in the box's own frame, drawn back in the page's */
    const tipB=maRotPt(box,tip,-1);
    const side=maCalloutSide(box,tipB[0],tipB[1]);
    const [attach0,elbow0]=maCalloutStub(box,side,l.coOff,l.coLen);
    const attach=maRotPt(box,attach0,1), elbow=maRotPt(box,elbow0,1);
    p[0]=attach; p[1]=elbow;
    l.coSide=side;
    l.pts=p;
    l.x1=p[0][0]; l.y1=p[0][1];
    l.x2=p[p.length-1][0]; l.y2=p[p.length-1][1];
  });
}

/* A CALLOUT: the box, the leader, and the two grouped so they travel together. Both halves take the
   callout tool's own style, and both can be restyled afterwards — which is why it is built out of
   ordinary marks rather than being a thing of its own. */
/* `boxAt` is where the drag ended — the far end of the leader, which is where the note goes. Without
   it (a bare click) the box falls on whichever side of the point has more room, as it always did. */
function maPlaceCallout(pi,x,y,text,boxAt){
  const pt=maPt(pi);
  const st=maStyleNow();
  const body=String(text!=null?text:MA_CALLOUT_TEXT||"").trim()||"Note";
  const lines=body.split("\n");
  const wNorm=Math.max(...lines.map(t=>measureTextNorm(t,st.size,pi,st.font)),pt.x(52))+pt.x(14);
  const hNorm=pt.y(st.size*1.22*lines.length+10);
  let bx,by;
  if(boxAt){
    /* 6gd — the box starts where the hand let go and runs AWAY from the arrow, so the leader never
       doubles back over it; vertically it is centred on the release, which is where the eye is. */
    const right=(boxAt.x>=x);
    bx=right?boxAt.x:(boxAt.x-wNorm);
    by=boxAt.y-hNorm/2;
    bx=Math.max(0,Math.min(1-wNorm,bx));
    by=Math.max(0,Math.min(1-hNorm,by));
  }else{
    /* the box sits clear of the point, on whichever side has more room */
    const leftSide=(x>0.5);
    const lead=pt.x(64);
    bx=leftSide?Math.max(0,x-lead-wNorm):Math.min(1-wNorm,x+lead);
    by=Math.max(0,y-hNorm/2);
  }
  let id=null;
  historyBatch(()=>{
    id=maAddShape(pi,"rect",bx,by,wNorm,hNorm,{text:body,maKind:"callout",focus:true});
    const pts=maCalloutLeader({nx:bx,ny:by,nw:wNorm,nh:hNorm},x,y);   /* centred on its side */
    /* 6gd — the endings come from the TOOL, not from a hard-coded arrow: passing `arrow:"end"` here
       overwrote whatever the panel had been set to, which is why changing the callout's arrowhead
       appeared to do nothing. */
    const lid=addLine(pi,pts[0][0],pts[0][1],x,y,
                      {pts:pts,col:st.col,sw:st.sw,maKind:"calloutleader",
                       le0:(st.le0!=null?st.le0:""), le1:(st.le1!=null?st.le1:"arrow")});
    /* 6g9 — owned by the box, not grouped with it */
    const ln=S.lines.find(z=>z.id===lid); if(ln){ ln.coFor=id; ln.group=undefined; }
  });
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  if(id!=null)setTimeout(()=>{
    const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
    if(ed){ selectAnno(id); ed.focus(); }
  },0);
  /* 6gd — Ced: "turn off the rule of continuous shapes to callout." Every other tool stays in your
     hand; a callout is placed and then TYPED INTO, and having the tool still armed meant the next
     click on the sheet started another one instead of working on the note just made. */
  try{ setMode("select"); }catch(_){ toolDone(); }
  setStatus("Callout placed — type the note, drag the arrow anywhere, drag the elbow along the box.");
  return id;
}

/* =================================================================================================
   6gg — THE LENGTH TOOL
   -------------------------------------------------------------------------------------------------
   Ced: "add a length tool, it should make a redline like this" — a red run with an arrow at each end
   and the length written on it, 1'-0".

   A measurement is TWO marks that answer to one gesture, the same arrangement the callout uses:
   a stroke with `maKind:"dim"`, and a text mark with `maKind:"dimlabel"` that the stroke owns through
   `dimFor` (the callout's `coFor`, the other way round). Ownership on the STROKE rather than the label
   is what lets Apply-to-pages and a saved group carry a measurement across: those paths already remap
   anno ids for `coFor`, and `dimFor` rides the same map.

   The reading is never stored as geometry. `maSyncDims` re-measures the run off its own two ends on
   every draw pass, so dragging an end, moving the mark, zooming, or changing the scale all re-read it
   — and the label stays at the middle of the run, turned with it and kept the right way up. Type over
   the label and the hand wins from then on; drag the label and it keeps the offset it was given,
   travelling with the run rather than snapping back.

   THE SCALE is the one thing a drawing cannot tell us: a sheet at 1/4" = 1'-0" and the same sheet at
   1/8" print identically. So it is a property of the tool — `dimScale`, real inches per inch of paper
   — set from a list of the architect's scales or measured off a known dimension with Calibrate, and
   stamped onto each measurement so a sheet redlined at one scale keeps its readings when the next
   sheet is set to another.
   ================================================================================================= */
/* real inches per printed inch. The list is the one on an architect's rule, plus the engineer's
   scales the tower drawings come at and 1:1 for a sheet that is already full size. */
const MA_DIM_SCALES=[
  {v:1,   t:"1:1 — paper size"},
  {v:4,   t:"3\" = 1'-0\""},
  {v:8,   t:"1 1/2\" = 1'-0\""},
  {v:12,  t:"1\" = 1'-0\""},
  {v:16,  t:"3/4\" = 1'-0\""},
  {v:24,  t:"1/2\" = 1'-0\""},
  {v:32,  t:"3/8\" = 1'-0\""},
  {v:48,  t:"1/4\" = 1'-0\""},
  {v:64,  t:"3/16\" = 1'-0\""},
  {v:96,  t:"1/8\" = 1'-0\""},
  {v:192, t:"1/16\" = 1'-0\""},
  {v:120, t:"1\" = 10'"},
  {v:240, t:"1\" = 20'"},
  {v:360, t:"1\" = 30'"},
  {v:600, t:"1\" = 50'"}
];
const MA_DIM_UNITS=[{k:"ft",t:"ft-in"},{k:"in",t:"inches"},{k:"ftd",t:"decimal ft"},
                    {k:"m",t:"metres"},{k:"mm",t:"mm"}];
const MA_DIM_PRECS=[{v:1,t:"1\""},{v:2,t:"1/2\""},{v:4,t:"1/4\""},{v:8,t:"1/8\""},{v:16,t:"1/16\""}];
/* What one measurement is set to: its own numbers where it carries them, the tool's otherwise. */
function maDimStyleOf(l){
  const st=(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.dim)||MA_TOOL_DEFAULTS.dim;
  const pick=(k,d)=>{ if(l&&l[k]!=null)return l[k]; return (st&&st[k]!=null)?st[k]:d; };
  return { scale:pick("dimScale",48), unit:pick("dimUnit","ft"), prec:pick("dimPrec",16),
           auto:!!pick("dimAuto",false) };
}
/* 1'-0", 4'-6 1/2", 7 1/2" — feet and inches the way a drawing writes them, rounded to the precision
   asked for and with the fraction reduced, because 6 8/16" is not how anyone writes it. */
function maFmtFeetIn(inches,prec){
  const p=Math.max(1,prec||16);
  const neg=inches<0; let units=Math.round(Math.abs(inches)*p);
  const perFoot=12*p;
  let ft=Math.floor(units/perFoot); units-=ft*perFoot;
  let inn=Math.floor(units/p); let fr=units-inn*p;
  let frs="";
  if(fr){ let n=fr,d=p; while(n%2===0&&d%2===0){ n/=2; d/=2; } frs=" "+n+"/"+d; }
  const s=ft?(ft+"'-"+inn+frs+"\""):(inn+frs+"\"");
  return (neg?"-":"")+s;
}
function maFmtLen(inches,unit,prec){
  const v=inches;
  switch(unit){
    case "in":  return maFmtInches(v,prec);
    case "ftd": return (Math.round(v/12*100)/100).toFixed(2)+"'";
    case "m":   return (Math.round(v*0.0254*1000)/1000).toFixed(3)+" m";
    case "mm":  return Math.round(v*25.4)+" mm";
    default:    return maFmtFeetIn(v,prec);
  }
}
function maFmtInches(inches,prec){
  const p=Math.max(1,prec||16);
  const neg=inches<0; let units=Math.round(Math.abs(inches)*p);
  let inn=Math.floor(units/p), fr=units-inn*p, frs="";
  if(fr){ let n=fr,d=p; while(n%2===0&&d%2===0){ n/=2; d/=2; } frs=" "+n+"/"+d; }
  return (neg?"-":"")+inn+frs+"\"";
}
/* How long this run is in the real world: paper inches off the page, times the scale. */
function maDimPaperInches(l){
  const p=linePts(l); if(!p||p.length<2)return 0;
  /* a measurement round a corner is the sum of its legs, which is what such a run should read */
  let paper=0;
  for(let i=1;i<p.length;i++)paper+=spanInches(l.page,p[i-1][0],p[i-1][1],p[i][0],p[i][1]);
  return paper;
}
function maDimInches(l){ return maDimPaperInches(l)*maDimStyleOf(l).scale; }
function maDimTextOf(l){
  const s=maDimStyleOf(l);
  return maFmtLen(maDimInches(l),s.unit,s.prec);
}
function maDimLabelOf(l){
  if(!l||l.dimFor==null||!S.annos)return null;
  return S.annos.find(a=>a.id===l.dimFor)||null;
}
function maDimLineOf(a){
  if(!a||a.maKind!=="dimlabel"||!S.lines)return null;
  return S.lines.find(l=>l.dimFor===a.id)||null;
}
/* The hand has moved a reading off the middle of its run: keep the offset it was given, measured from
   the middle, so the label still travels with the measurement instead of snapping back or being left
   behind when the run is moved. */
function maDimLabelFreed(a){
  const l=maDimLineOf(a); if(!l)return;
  const anch=maDimAnchor(l,a,a.rot);
  const w=maDimBox(a).w, h=maDimBox(a).h;
  a.dimFree=true;
  a.dimOff=[(a.nx+w/2)-anch[0],(a.ny+h/2)-anch[1]];
}
/* 6gt — WHERE THE READING SITS. Ced: "make the text in length tool above the line created instead of
   in the middle." A reading written ON the run breaks the rule in half, and on a mount analysis the
   rule is drawn along something you still want to see. So the reading is lifted clear of it:
   PERPENDICULAR to the run, by half its own height and a hair more, which puts it above a level run,
   outboard of a plumb one, and on the upper side of anything in between — the reading is kept upright,
   so there is only ever one "up" to lift towards. Everything else is unchanged: the anchor still
   travels with the run, and a reading dragged off it keeps its offset FROM THE ANCHOR, so a freed
   reading is not quietly shoved a line further up every time the run is touched. */
/* 6hb — AND BACK ABOVE THE RUN, which is where Ced wants it and where 6gt had put it: "now, the length
   is back in the middle. make it on top again." 6ha had read his "the text should always be in the
   middle" as "on the rule" when what it meant was "at the middle OF THE RUN, not wandering off along
   it" — the complaint was about the reading drifting as it was typed (fixed at 6hb by re-measuring the
   label on every keystroke), not about the lift. So: lifted clear of the rule, centred along it, and
   staying there while it is edited. The number is points of daylight between the rule and the reading;
   the half-height that carries the box clear is added to it in `maDimAnchor`. */
const MA_DIM_LIFT=2.4;
function maDimAnchor(l,a,deg){
  const mid=maDimMid(l);
  if(!a)return mid;
  const b=maDimBox(a);
  const P=(S.pages&&S.pages[l.page])||{};
  const W=P.w1||612, H=P.h1||792;
  const rad=((typeof deg==="number")?deg:0)*Math.PI/180;
  /* 6ha — ZERO MEANS ON THE RUN, not "just touching it": the half-height term is what lifts the box
     clear, so it belongs inside the same test as the gap. */
  const lift=MA_DIM_LIFT?((b.h*H)/2+MA_DIM_LIFT):0;   /* in points, off the page's own size */
  return [mid[0]+Math.sin(rad)*lift/W, mid[1]-Math.cos(rad)*lift/H];
}
function maDimMid(l){
  const p=linePts(l);
  if(!p||!p.length)return [l.x1||0,l.y1||0];
  if(p.length===2)return [(p[0][0]+p[1][0])/2,(p[0][1]+p[1][1])/2];
  /* the middle of the RUN, not of the bounding box: half the walked length along it */
  let total=0; const legs=[];
  for(let i=1;i<p.length;i++){ const d=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]); legs.push(d); total+=d; }
  let want=total/2;
  for(let i=0;i<legs.length;i++){
    if(want<=legs[i]||i===legs.length-1){
      const t=legs[i]?Math.max(0,Math.min(1,want/legs[i])):0;
      return [p[i][0]+(p[i+1][0]-p[i][0])*t, p[i][1]+(p[i+1][1]-p[i][1])*t];
    }
    want-=legs[i];
  }
  return [p[0][0],p[0][1]];
}
/* The label's size as it is ON SCREEN where we can have it, so a reading that grew a digit is still
   centred; the measured text is the fallback for a page that is not rendered. */
/* 6jm — A READING'S BOX IS MEASURED IN THE PAGE'S OWN UNITS, NOT IN SCREEN PIXELS.
   Ced: "zooming out should not move any redline whatsoever." Measured: everything held still except a
   length's reading, which crept — and, worse, kept the creep when the zoom came back. At 120% a label
   sat at nx 0.36566 and nw 0.01907; after one trip out to 20% and back it was nx 0.36294, nw 0.02452,
   and it stayed there.
   The cause was here. This box was read off the rendered element as `offsetWidth / page.offsetWidth`,
   which looks scale-free and is not: `.anno .ed` carries `min-width:14px`, so once the zoom takes the
   label below fourteen pixels the browser stops shrinking it — and fourteen pixels is a BIGGER
   fraction of a smaller page. `maSyncDims` writes the result back into `a.nw`, and the reading is
   centred on its box, so every pass at a low zoom made the reading permanently wider and moved it
   half that width along the run.
   It is measured in the page's own normalised units now, by the same function the wrap and the export
   measure with, so the answer is the same at 20% as at 300% and the same on paper as on screen. The
   element is only consulted if that measurement cannot be taken at all. */
function maDimBox(a){
  const pt=maPt(a.page);
  let w=null;
  try{ w=measureTextNorm(String(a.text||""),a.size||8,a.page,a.font||"arial"); }catch(e){ w=null; }
  /* an EMPTY reading — one whose run has no scale set yet — measures zero, and zero is the answer:
     the floor below is what gives it a box. Reading the element instead is what started the drift,
     because an empty box is pure `min-width`, which is a fixed count of SCREEN pixels. */
  if(w!=null&&isFinite(w))return {w:Math.max(w,pt.x(4)), h:pt.y((a.size||8)*1.22)};
  const d=document.querySelector(`.anno[data-id="${a.id}"]`);
  const pg=document.querySelector(`.page[data-idx="${a.page}"]`);
  if(d&&pg&&pg.offsetWidth)return {w:d.offsetWidth/pg.offsetWidth,h:d.offsetHeight/pg.offsetHeight};
  return {w:Math.max(0.06,pt.x(4)), h:pt.y((a.size||8)*1.22)};
}
function maSyncDims(){
  /* A reading whose run has gone goes with it — one sweep, and every delete path is right at once.
     BEFORE the "nothing to do" guard: deleting the last measurement on a document leaves no strokes
     at all, and that is exactly the case where its reading must not be left behind. */
  if(S.annos&&S.annos.length){
    const live=new Set((S.lines||[]).filter(l=>l.maKind==="dim"&&l.dimFor!=null).map(l=>l.dimFor));
    const drop=S.annos.filter(a=>a.maKind==="dimlabel"&&!live.has(a.id));
    if(drop.length){ const ids=new Set(drop.map(a=>a.id)); S.annos=S.annos.filter(a=>!ids.has(a.id)); }
  }
  if(!S.lines||!S.lines.length)return;
  S.lines.forEach(l=>{
    if(l.maKind!=="dim")return;
    const a=maDimLabelOf(l);
    if(!a){ if(l.dimFor!=null)l.dimFor=undefined; return; }
    /* THE READING. Re-measured every pass, so an end dragged to a new place reads the new length —
       unless the label has been typed over, and then the hand's words are the reading for good. A
       measurement drawn with the reading left to the user is manual from the moment it is made, so
       this writes nothing into it at all. */
    const txt=maDimTextOf(l);
    if(!l.dimManual){
      if(a._dimAuto!=null&&String(a.text||"")!==String(a._dimAuto)){ l.dimManual=true; }
      else { a.text=txt; a.orig=txt; a._dimAuto=txt; }
    }
    const mid=maDimMid(l);
    const p=linePts(l); const p0=p[0], p1=p[p.length-1];
    /* turned with the run, in SCREEN degrees — the page's own aspect is what makes a normalised
       gradient and a drawn angle two different numbers — and kept upright, so a reading is never
       read upside down on a run drawn right to left */
    const P=S.pages[l.page]||{};
    const dx=(p1[0]-p0[0])*(P.w1||612), dy=(p1[1]-p0[1])*(P.h1||792);
    let deg=(p.length>2)?0:Math.atan2(dy,dx)*180/Math.PI;
    if(deg>90)deg-=180; if(deg<-90)deg+=180;
    a.rot=Math.round(deg*10)/10;
    const b=maDimBox(a);
    /* 6gt — the anchor is the middle of the run lifted clear of it, not the middle itself */
    const anch=maDimAnchor(l,a,a.rot);
    const off=(a.dimFree&&a.dimOff)?a.dimOff:[0,0];
    a.nx=Math.max(0,Math.min(1-b.w,anch[0]-b.w/2+off[0]));
    a.ny=Math.max(0,Math.min(1-b.h,anch[1]-b.h/2+off[1]));
    /* 6i7 — AND THE BOX IT WAS PLACED BY IS THE BOX IT EXPORTS AT. The reading is positioned from a
       box measured on screen, and the file, having no width of its own to go on, sized the mark from
       the text plus a few points of padding — a wider box, centred on the same left edge, which on a
       turned reading put the words a couple of points off the run they belong to. Writing the measured
       size back means both renderers place the same rectangle. */
    if(b.w>0)a.nw=b.w;
    if(b.h>0)a.nh=b.h;
  });
}
/* A MEASUREMENT, drawn like a line: press at one end, drag to the other. */
function maPlaceDim(pi,x1,y1,x2,y2){
  /* the LENGTH tool's own style, whatever is in the hand: the ribbon speaks for it only while it IS
     the tool in the hand, so a measurement placed from a script, a stamp or a replayed gesture still
     comes out with arrows, at the scale the tool is set to, rather than borrowing the redline's */
  const dst=(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.dim)||MA_TOOL_DEFAULTS.dim;
  let st=Object.assign({},dst);
  try{ if(maToolOf()==="dim")st=Object.assign(st,maStyleNow()); }catch(e){}
  const dsv=maDimStyleOf(null);
  let lid=null, aid=null;
  historyBatch(()=>{
    lid=addLine(pi,x1,y1,x2,y2,{col:st.col,sw:st.sw,maKind:"dim",
                                le0:(st.le0!=null?st.le0:"arrow"),
                                le1:(st.le1!=null?st.le1:"arrow")});
    const l=S.lines.find(z=>z.id===lid);
    /* stamped with the scale it was measured at, so the sheet keeps its readings when the tool is
       set to another scale for the next one */
    if(l){ l.dimScale=dsv.scale; l.dimUnit=dsv.unit; l.dimPrec=dsv.prec; }
    /* 6gj — the reading is the user's: empty unless the tool is set to write the measurement in */
    const auto=dsv.auto;
    if(l&&!auto)l.dimManual=true;
    const quiet=!_maQuiet; if(quiet)_maQuiet=true;
    try{
      aid=addText(pi,x1,y1,(l&&auto)?maDimTextOf(l):"");
      const a=S.annos.find(z=>z.id===aid);
      /* centred in its own little box, with an opaque ground and sitting ABOVE the strokes, so the
         rule reads as broken by its own reading — the way a dimension is drawn, on screen and in the
         file alike. `maDimDressLabel` is the one place that says so. */
      if(a){ maDimDressLabel(a,st); a._dimAuto=a.text; }
    } finally { if(quiet)_maQuiet=false; }
    if(l&&aid!=null)l.dimFor=aid;
  });
  try{ maSyncDims(); }catch(e){}
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  if(lid!=null)selectLine(lid);
  const l=S.lines.find(z=>z.id===lid);
  /* 6gj — and the cursor goes into the reading, so the dimension is typed the moment it is drawn.
     The MEASUREMENT stays the selected mark: the two are one, and the run is the one with handles. */
  if(aid!=null&&!dsv.auto)setTimeout(()=>{
    const ed=document.querySelector(`.anno[data-id="${aid}"] .ed`);
    if(ed){ const d=ed.closest(".anno"); if(d)d.classList.add("editing");
            ed.focus(); try{ document.getSelection().selectAllChildren(ed); }catch(e){} }
  },0);
  setStatus(dsv.auto
    ? ("Measured "+(l?maDimTextOf(l):"")+" \u2014 drag either end to re-measure, or type over the reading.")
    : ("That run measures "+(l?maDimTextOf(l):"")+" at "+maDimScaleLabel(dsv.scale)+
       " \u2014 type the dimension, or use \u201cWrite in the measured length\u201d in its \u25be."));
  return lid;
}
/* The scale, as it is written on a drawing, for the status line and the panel. */
function maDimScaleLabel(v){
  const hit=MA_DIM_SCALES.find(s=>Math.abs(s.v-v)<1e-6);
  return hit?hit.t:("1\u2033 = "+(Math.round(v/12*100)/100)+"\u2032");
}
/* 6gj — WRITE THE MEASURED LENGTH IN. The reading is the user's to type, so the measurement is
   offered rather than imposed: this fills the selected measurement's reading with what it measures,
   and from then on that reading follows the run again until it is typed over. */
function maDimWriteIn(){
  const l=(S.selLine!=null)?S.lines.find(z=>z.id===S.selLine):null;
  if(!l||l.maKind!=="dim"){ setStatus("Select a measurement first.",true); return false; }
  let a=maDimLabelOf(l);
  pushHistory();
  if(!a){
    /* its reading was deleted, or never typed: give it one back */
    const quiet=!_maQuiet; if(quiet)_maQuiet=true;
    try{
      const st=(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.dim)||MA_TOOL_DEFAULTS.dim;
      const id=addText(l.page,l.x1,l.y1,"");
      a=S.annos.find(z=>z.id===id);
      if(a){ maDimDressLabel(a,st); l.dimFor=id; }
    } finally { if(quiet)_maQuiet=false; }
  }
  if(!a)return false;
  l.dimManual=false; a._dimAuto=null;
  try{ maSyncDims(); }catch(e){}
  layoutAnnos(); drawAllLines(); autosave&&autosave();
  setStatus("Reading written in: "+(a.text||"")+" \u2014 it follows the run until you type over it.");
  return true;
}
/* Everything that makes a text mark a READING rather than a note, in one place so that one made
   later looks exactly like one made with the gesture. */
function maDimDressLabel(a,st){
  a.maKind="dimlabel"; a.size=st.size; a.font=st.font||"arial"; a.col=st.col;
  a.align="center"; a.alignSet=true; a.nowrap=true; a.wrap=false; a.manualW=false;
  a.valign="middle";
  a.onCell=false; a.fullcell=false; a.nw=null; a.lines=1; a.pLines=1;
  a.under=false; a.bgNone=false; try{ topZ(a); }catch(e){}   /* 6i3 */
  /* 6i7 — the reading is written ON the run it measures, so its ground is OPAQUE: it takes the
     tool's fill COLOUR but not the tool's fill opacity, which on a stroke tool is routinely zero and
     would leave the line running through the words in the exported file. */
  a.bg=st.fill||"#ffffff"; a.fillOp=1;
  if(st.uline!=null)a.uline=st.uline;
  if(st.strikeout!=null)a.strikeout=st.strikeout;
}
/* CALIBRATE. The only honest way to set a scale on a sheet whose title block lies, or has been
   photocopied: measure something you know the length of and say what it is. */
async function maDimCalibrate(){
  const l=(S.selLine!=null)?S.lines.find(z=>z.id===S.selLine):null;
  if(!l||l.maKind!=="dim"){
    setStatus("Draw a measurement along something you know the length of first, then calibrate from it.",true);
    return false;
  }
  const paper=maDimPaperInches(l);
  if(!(paper>0.001)){ setStatus("That measurement is too short to calibrate from.",true); return false; }
  const said=await sbAsk({title:"Calibrate the scale",
    hint:"How long is the measurement you have selected, really? Write it as 12' 6\", 12'-6 1/2\", 150\" or 12.5'.",
    placeholder:"12' 6\"", ok:"Set the scale"});
  if(said==null)return false;
  const real=maParseLen(said);
  if(!(real>0)){ setStatus("“"+said+"” could not be read as a length.",true); return false; }
  const scale=real/paper;
  MA_TOOL_STYLES.dim=Object.assign({},MA_TOOL_STYLES.dim||{},{dimScale:scale});
  maSaveToolStyles();
  l.dimScale=scale;
  try{ maSyncDims(); }catch(e){}
  layoutAnnos(); drawAllLines();
  setStatus("Scale set from that run: 1\" of paper = "+(Math.round(scale*100)/100)+"\" — "+
            (Math.round(scale/12*100)/100)+"'.");
  try{ tpRender(); }catch(e){}
  return true;
}
/* 12' 6", 12'-6 1/2", 150", 12.5', 3.8m, 450mm — in inches. */
function maParseLen(s){
  let t=String(s==null?"":s).trim().toLowerCase().replace(/′/g,"'").replace(/″/g,'"');
  if(!t)return 0;
  let m=t.match(/^([\d.]+)\s*mm$/);       if(m)return parseFloat(m[1])/25.4;
  m=t.match(/^([\d.]+)\s*(?:cm)$/);       if(m)return parseFloat(m[1])/2.54;
  m=t.match(/^([\d.]+)\s*m$/);            if(m)return parseFloat(m[1])/0.0254;
  let total=0, saw=false;
  m=t.match(/(-?[\d.]+)\s*(?:'|ft|feet)/);
  if(m){ total+=parseFloat(m[1])*12; saw=true; t=t.replace(m[0],"");
    /* 12'-6" writes the two halves with a dash between them; it is a separator, not a minus sign */
    t=t.replace(/^[\s\-\u2013]+/,""); }
  /* whatever is left is inches, with an optional fraction: 6 1/2" or 6-1/2 or just 6 */
  const fr=t.match(/(\d+)\s*\/\s*(\d+)/);
  if(fr){ total+=parseFloat(fr[1])/parseFloat(fr[2]); saw=true; t=t.replace(fr[0],""); }
  const inch=t.match(/(-?[\d.]+)/);
  if(inch){ total+=parseFloat(inch[1]); saw=true; }
  return saw?total:0;
}

/* =================================================================================================
   4. ONE NOTE, MANY PAGES
   -------------------------------------------------------------------------------------------------
   "ACTUAL INSTALL: TRIAD MOUNT WITH STEALTH SHROUD" appears on fifty pages of IN1187 and
   "STRESS RATIO IS < 1. THEREFORE MEMBERS ARE ADEQUATE" on the result pages of four other reports —
   the same words, in the same place, page after page. You place it once and say how far it runs.
   ================================================================================================= */
const MA_NOTES_KEY="ma.notes.v1";
const MA_SEED_NOTES=[
  "ACTUAL INSTALL:",
  "STRESS RATIO IS < 1. THEREFORE MEMBERS ARE ADEQUATE",
  "ACTUAL COUNT CHANGE",
  "NO PIPE-TO-PIPE STANDOFF KIT INSTALLED",
  "RRHs WERE INSTALLED BACK TO BACK",
  "THIS PIPE WAS NOT IN THE FINAL CONFIGURATION",
  "SPDs ARE MOUNTED TO THE MONOPOLE",
  "X"
];
let MA_NOTES=MA_SEED_NOTES.slice();
function maLoadNotes(){
  try{ const raw=localStorage.getItem(MA_NOTES_KEY);
    if(raw){ const v=JSON.parse(raw); if(Array.isArray(v)&&v.length)MA_NOTES=v; }
  }catch(e){ LOG&&LOG("notes could not be read back",e&&e.message); }
  return MA_NOTES;
}
function maSaveNotes(){
  try{ localStorage.setItem(MA_NOTES_KEY,JSON.stringify(MA_NOTES)); }
  catch(e){ LOG&&LOG("notes could not be saved",e&&e.message); }
}
/* Write one note at the same normalised spot on every page in the list. */
function maNoteOnPages(text,pages,x,y){
  const body=String(text||"").trim();
  if(!body){ setStatus("Type the note first.",true); return 0; }
  if(!pages||!pages.length){ setStatus("No pages in that range.",true); return 0; }
  const size=parseFloat($("#c_pt").value)||8;
  const lines=body.split("\n");
  let n=0;
  _maQuiet=true;
  try{
  historyBatch(()=>{
    pages.forEach(pi=>{
      const pt=maPt(pi);
      const wNorm=Math.max(...lines.map(t=>measureTextNorm(t,size,pi,markFontKey(null))))+pt.x(6);
      const lineNh=pt.y(size*1.28);
      const id=addText(pi,Math.max(0,Math.min(1-wNorm,x)),y,body);
      const a=S.annos.find(z=>z.id===id);
      if(a){
        a.maKind="note"; a.size=size; a.align="left"; a.alignSet=true;
        a.nw=wNorm; a.nh=lineNh*lines.length; a.lineNh=lineNh; a.lines=lines.length;
        a.wrap=lines.length>1; a.nowrap=lines.length<=1; a.manualW=true; a.pLines=lines.length;
      }
      n++;
    });
  });
  } finally { _maQuiet=false; }
  layoutAnnos(); updateRail(); updateCount();
  setStatus(`Note written on ${n} page${n===1?"":"s"}.`);
  LOG("Note on",n,"page(s):",body.replace(/\n/g," / "));
  return n;
}

/* The click that a pending placement is waiting for. */
function maPlacePending(pi,x,y){
  const job=_maPending; _maPending=null;
  document.body.classList.remove("maplacing");
  maGhostOff();
  if(!job)return false;
  if(job.kind==="note"){
    maNoteOnPages(job.text,job.pages,x,y);
    maRenderPanel();
    return true;
  }
  if(job.kind==="callout"){
    maPlaceCallout(pi,x,y,job.text);
    return true;
  }
  if(job.kind==="markup"){
    /* 6hf — held by its top-left corner, so it lands with that corner under the click */
    const id=maPlaceMarkup(job.rec,pi,x,y,"tl");
    if(id!=null){ try{ setMode("select"); selectAnno(id); }catch(e){} }
    return true;
  }
  return false;
}
function maArmPlacement(job,hint){
  _maPending=job;
  document.body.classList.add("maplacing");
  if(job&&job.kind==="markup")maGhostOn(job.rec); else maGhostOff();
  setStatus(hint||"Click the page where it should go.");
}

/* =================================================================================================
   6hf — A STAMP IS HELD BEFORE IT IS PUT DOWN
   Ced: "when clicking on mark ups, instead of pasting it already on the pdf, make it as if the user
   is holding it first, have a preview of the stamp, and then the user will click on pdf where it
   should be located. make the stamp be held on its upper left."

   So a click in the library no longer drops anything: it puts the markup IN YOUR HAND. A translucent
   copy of it follows the pointer at the size it will land at, hanging from its top-left corner the
   way a rubber stamp hangs from the hand holding it, and the click that follows is the placement —
   that corner goes exactly where you clicked. Escape puts it back.

   The preview is a plain fixed-position element outside the page, so it costs the document nothing:
   nothing is added to `S.annos` until the sheet is clicked, and there is nothing to undo if it is not.
   ================================================================================================= */
let _maGhostEl=null;
function maGhostSize(){
  if(!_maGhostEl)return;
  const rec=_maGhostEl._rec||{};
  /* the width it will be placed at, in the page under the pointer — so what you hold is the size of
     what you get, at whatever zoom the sheet is being read at */
  const pi=(typeof currentPageIdx==="function")?currentPageIdx():0;
  const pg=document.querySelector(`.page[data-idx="${pi}"]`);
  const pw=pg?pg.offsetWidth:600, ph=pg?pg.offsetHeight:800;
  if(rec.kind==="group"){
    /* 6hl — a saved selection is rebuilt at the size it was saved at, so that is what you hold */
    const b=maGroupBounds(rec);
    _maGhostEl.style.width=Math.max(18,b.w*pw).toFixed(1)+"px";
    _maGhostEl.style.height=Math.max(12,b.h*ph).toFixed(1)+"px";
    return;
  }
  let wNorm=0.34;
  try{ const pt=maPt(pi==null?0:pi); wNorm=Math.min(0.34,pt.x(170)); }catch(e){}
  const w=Math.max(24,wNorm*pw);
  const ar=(rec.w&&rec.h)?(rec.h/rec.w):0.66;
  _maGhostEl.style.width=w.toFixed(1)+"px";
  _maGhostEl.style.height=(w*ar).toFixed(1)+"px";
}
function maGhostMove(ev){
  if(!_maGhostEl)return;
  _maGhostEl.style.left=ev.clientX+"px";
  _maGhostEl.style.top=ev.clientY+"px";
}
function maGhostOn(rec){
  maGhostOff();
  if(!rec)return;
  const g=document.createElement("div");
  g.className="maghost"+(rec.kind==="group"?" grp":"");
  g._rec=rec;
  if(rec.kind==="group"){
    /* 6hl/6k8 — the stamp itself, at the size it will land at, laid out against the page it is
       about to land ON so the drawing and the box it sits in cannot disagree */
    try{
      const pi=(typeof currentPageIdx==="function")?currentPageIdx():0;
      g.appendChild(maGroupSvg(rec,null,null,{page:maPageDims(pi==null?0:pi),exact:true}));
    }catch(e){ g.textContent=(rec.name||"markup"); }
  }else{
    const im=document.createElement("img"); im.src=rec.src; im.alt=""; im.draggable=false;
    g.appendChild(im);
  }
  document.body.appendChild(g);
  _maGhostEl=g;
  maGhostSize();
  document.addEventListener("pointermove",maGhostMove,true);
}
function maGhostOff(){
  if(_maGhostEl){ _maGhostEl.remove(); _maGhostEl=null; }
  document.removeEventListener("pointermove",maGhostMove,true);
}

/* =================================================================================================
   5. THE ANTENNA LOADING TABLE
   -------------------------------------------------------------------------------------------------
   Every one of these reports prints a loading table — "Antenna Loading", "Antenna and Mount
   Loading", "Equipment Loading" — with a row per piece of equipment: how many, what model, at what
   centreline, on what mount. It is where the corrections go, so both the as-built import and the
   report below read it through this one function.
   ================================================================================================= */
/* Finding the loading table is not a matter of one heading: every engineer-of-record words it
   differently — "Antenna Loading", "Final Loading Configuration:", "Proposed Loading Configuration",
   "Equipment Loading" — and every one of those words also appears in the table of contents and in the
   conclusion paragraph, where a correction must never land. So the page is SCORED on what a loading
   table actually prints: the heading, and the column names around it. */
function maLoadingScore(txt){
  let n=0;
  if(/loading\s*(configuration|table|schedule)?/i.test(txt))n+=2;
  if(/\bqty\b|\bquantity\b/i.test(txt))n+=1;
  if(/\bmodel\b/i.test(txt))n+=1;
  if(/manufacturer|\bmfr\b|vendor/i.test(txt))n+=1;
  if(/rad\s*cent|cent(er|re)\s*line|centerline|elevation\s*\(?ft|mount\s*elevation/i.test(txt))n+=1;
  return n;
}

/* A printed cell that carries a VALUE rather than a label: five characters or more with at least one
   letter and one digit in it. That is what an equipment model looks like on these pages — "Ericsson
   AIR 6472 B77G B77M", "KRE 101 2586/1K", "DC9-48-60-24-8C-EV" — and what a site name, an FA code and
   a coordinate are not. */
function maValueRuns(pi){
  const P=S.pages[pi]; if(!P||!P.items)return [];
  const out=[];
  P.items.forEach(t=>{
    const v=String(t.str).trim();
    if(v.length<5||v.length>44)return;
    if(!/[A-Za-z]/.test(v)||!/\d/.test(v))return;
    if(!/^[A-Za-z0-9][A-Za-z0-9 \-\/.()#]*$/.test(v))return;
    if(/^(page|figure|table|rev|note|sheet|date)\b/i.test(v))return;
    if(/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v))return;              /* a date, not a model */
    out.push({page:pi,str:v,it:t});
  });
  return out;
}
/* The parts of a value that identify it: the chunks carrying a number. Two documents write the same
   equipment differently — "AIR 6472" against "AIR6472", "4490 B5/B12A" against "4490 B5/B12" — so the
   comparison is made on these rather than on the whole string. */
function maTokens(str){
  const out=[];
  String(str||"").toUpperCase().split(/[^A-Z0-9]+/).forEach(t=>{
    if(t.length>=3&&/\d/.test(t)&&/[A-Z0-9]/.test(t))out.push(t);
  });
  return out;
}
/* Numbers that read like a centreline or an elevation: 397.0, 161, 54.0 */
function maHeightRuns(pi){
  const P=S.pages[pi]; if(!P||!P.items)return [];
  return P.items.filter(t=>/^\d{1,3}(\.\d)?$/.test(String(t.str).trim())&&parseFloat(t.str)>=10)
                .map(t=>({page:pi,str:String(t.str).trim(),it:t}));
}
/* Which pages carry a loading table. The heading alone is not enough — it appears in the table of
   contents too, and the contents page is the last place a correction goes — so a page has to print
   the heading AND carry equipment on it. Where no page passes both tests (the heading is worded some
   other way, which happens), the pages carrying the most equipment are taken instead. */
function maLoadingPages(){
  const strong=[], weak=[];
  S.pages.forEach((P,pi)=>{
    if(!P||!P.items)return;
    const txt=P.items.map(t=>t.str).join(" ");
    const n=maValueRuns(pi).length;
    if(n<2)return;                                   /* no equipment printed here at all */
    const sc=maLoadingScore(txt);
    if(sc>=4)strong.push(pi);
    else if(sc>=2&&n>=4)weak.push({pi,n:n+sc});
  });
  if(strong.length)return strong;
  return weak.sort((a,b)=>b.n-a.n).slice(0,4).map(z=>z.pi).sort((a,b)=>a-b);
}

/* =================================================================================================
   6. THE AS-BUILT IMPORT
   -------------------------------------------------------------------------------------------------
   The mount analysis says what was designed; the RFDS (or the mount mapping) says what is actually
   on the tower. Where the two disagree, the analysis is what gets redlined — so this reads the
   second document, pulls the models and centrelines out of it, and lists the values in the analysis
   that nothing in the as-built document accounts for. Each one is a button: it jumps to the page and
   puts the correction on the cell.

   It does not decide for you. A mount analysis and an RFDS name the same equipment differently often
   enough that an automatic rewrite would be wrong as often as right; what this removes is the
   FINDING — the reading of two documents side by side looking for the one line that moved.
   ================================================================================================= */
let MA_ASBUILT=null;     /* {name, tokens:Set, heights:Set} */
let MA_DIFFS=[];

async function maReadAsBuilt(file){
  if(typeof pdfjsLib==="undefined"){ setStatus("PDF library not loaded.",true); return null; }
  showProg("Reading "+file.name+"…");
  try{
    const buf=await file.arrayBuffer();
    const doc=await pdfjsLib.getDocument({data:buf}).promise;
    const tokens=new Set(), heights=new Set();
    let runs=0;
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p);
      const tc=await page.getTextContent();
      tc.items.forEach(it=>{
        const v=String(it.str||"").trim();
        if(!v)return;
        runs++;
        maTokens(v).forEach(t=>tokens.add(t));
        v.split(/\s+/).forEach(w=>{
          const t=w.replace(/[(),;]/g,"");
          if(/^\d{1,3}(\.\d)?$/.test(t)&&parseFloat(t)>=10)heights.add(String(Math.round(parseFloat(t))));
        });
      });
      setProg(p,doc.numPages,`Reading page ${p} / ${doc.numPages}…`);
    }
    MA_ASBUILT={name:file.name.replace(/\.pdf$/i,""),tokens,heights,runs,pages:doc.numPages};
    hideProg();
    LOG("As-built:",file.name,"—",doc.numPages,"pages,",tokens.size,"identifying tokens,",heights.size,"heights");
    return MA_ASBUILT;
  }catch(e){
    hideProg();
    setStatus("Could not read that PDF: "+(e&&e.message||e),true);
    return null;
  }
}

/* What the comparison actually asks, value by value: does the as-built document mention the parts of
   this value that identify it? "Ericsson AIR 6472 B77G B77M" is accounted for when 6472, B77G and
   B77M all appear somewhere in the RFDS, however that document happens to space and punctuate them.
   Anything with a piece missing is what the redliner should look at — it does not mean the analysis
   is wrong, it means the two documents do not say the same thing about that line. */
function maCompare(){
  MA_DIFFS=[];
  if(!MA_ASBUILT)return MA_DIFFS;
  const scan=maLoadingPages();
  if(!scan.length){
    LOG("As-built: no page in this report reads like a loading table");
    setStatus("No loading table found in this report — nothing to compare.",true);
    return MA_DIFFS;
  }
  const seen=new Set();
  scan.forEach(pi=>{
    maValueRuns(pi).forEach(r=>{
      const toks=maTokens(r.str);
      if(!toks.length)return;
      const missing=toks.filter(t=>!MA_ASBUILT.tokens.has(t));
      if(!missing.length)return;                       /* the as-built accounts for it */
      const key=toks.join("-")+"@"+pi;
      if(seen.has(key))return;
      seen.add(key);
      MA_DIFFS.push({page:pi,kind:"equipment",printed:r.str,it:r.it,missing:missing,
                     partial:missing.length<toks.length});
    });
    /* centrelines: a height printed on the loading table that the as-built never mentions */
    maHeightRuns(pi).forEach(r=>{
      const v=String(Math.round(parseFloat(r.str)));
      if(MA_ASBUILT.heights.has(v))return;
      if(MA_ASBUILT.heights.has(String(+v+1))||MA_ASBUILT.heights.has(String(+v-1)))return;  /* rounding */
      const key="h"+v+"@"+pi;
      if(seen.has(key))return;
      seen.add(key);
      MA_DIFFS.push({page:pi,kind:"height",printed:r.str,it:r.it,missing:[v],partial:false});
    });
  });
  /* the ones where only part of the value is missing come first: those are the values that MOVED,
     rather than equipment the other document simply never lists */
  MA_DIFFS.sort((a,b)=>(b.partial?1:0)-(a.partial?1:0)||a.page-b.page);
  MA_DIFFS=MA_DIFFS.slice(0,80);
  LOG("As-built comparison: scanned pages",scan.map(p=>p+1).join(", "),"—",MA_DIFFS.length,"value(s) the as-built does not account for");
  return MA_DIFFS;
}
/* Go to one difference. */
function maGotoDiff(d){
  if(!d)return;
  gotoPageInstant(d.page);
  setTimeout(()=>{
    const pg=document.querySelector(`.page[data-idx="${d.page}"]`);
    if(pg)pg.scrollIntoView({behavior:"auto",block:"center"});
  },60);
}
/* Put a redline on the cell a difference is about, pre-filled with what is printed so it can be
   corrected rather than retyped. */
function maRedlineDiff(d){
  if(!d||!d.it)return;
  const id=addText(d.page,d.it.nx,d.it.ny,d.printed,{cell:d.it});
  const a=S.annos.find(z=>z.id===id); if(a)a.maKind="asbuilt";
  layoutAnnos(); updateRail(); updateCount();
  maGotoDiff(d);
  setStatus(`Redline on “${d.printed}”, page ${d.page+1} — type the as-built value over it.`);
}

/* =================================================================================================
   THE MARKUP LIBRARY
   -------------------------------------------------------------------------------------------------
   The same few graphics go onto report after report — a north arrow, a company mark, a photograph of
   what was actually installed, a scanned detail. Uploaded once, they are kept in this browser and can
   be dropped onto any page from then on. A placed markup is an ordinary photo mark: movable,
   resizable, and exported as a PDF stamp annotation.

   They are held in their own localStorage key rather than with the redlines, because they belong to
   YOU rather than to a document, and each is shrunk on the way in so that a library of them does not
   fill the browser's quota.
   ================================================================================================= */
const MA_MARKUP_KEY="ma.markups.v1";
let MA_MARKUPS=[];
function maLoadMarkups(){
  try{ const raw=localStorage.getItem(MA_MARKUP_KEY);
    if(raw){ const v=JSON.parse(raw); if(Array.isArray(v))MA_MARKUPS=v; }
  }catch(e){ LOG&&LOG("markup library could not be read back",e&&e.message); }
  /* 6gl — and the ones the old bug wrote are dropped on the way in. A picture markup saved before the
     fix carries "[object Object]" where its picture should be: it can never draw, never place, and
     shows as a broken square in the library. Nothing is lost that was ever there. */
  const bad=MA_MARKUPS.filter(r=>r&&r.kind!=="group"&&!/^data:/.test(String(r.src||"")));
  if(bad.length){
    MA_MARKUPS=MA_MARKUPS.filter(r=>bad.indexOf(r)<0);
    try{ maSaveMarkups(); }catch(e){}
    LOG&&LOG("markup library: dropped "+bad.length+" entry/entries with no picture in them");
  }
  return MA_MARKUPS;
}
function maSaveMarkups(){
  try{ localStorage.setItem(MA_MARKUP_KEY,JSON.stringify(MA_MARKUPS)); return true; }
  catch(e){
    LOG&&LOG("markup library could not be saved",e&&e.message);
    setStatus("That markup is too large to keep in the library — the browser is out of room. "+
              "Remove one you no longer use and try again.",true);
    return false;
  }
}
async function maAddMarkupFile(file){
  if(!file||!/^image\//.test(file.type||"")){ setStatus("Choose an image file.",true); return null; }
  try{
    const url=await fileToDataUrl(file);
    /* 6gl — THE MARKUP LIBRARY WAS BROKEN HERE, IN ONE LINE.
       Ced: "markups is not working" — with a broken-image square where the thumbnail should be.
       `shrinkDataUrl` takes ONE argument and resolves to an OBJECT, `{url,w,h}`; this passed it a
       second argument it does not have and then used the object itself as the picture. Every markup
       added since therefore carried `src:"[object Object]"`: nothing to show in the library, and
       nothing to drop on a page. The same shrink the paste path uses — a phone photograph is 4000px
       wide and nothing on a letter page can show more than a fraction of that. */
    /* 6gq — a markup is line art far more often than it is a photograph, so transparency is kept */
    const small=await shrinkDataUrl(url,{keepAlpha:/^image\/(png|gif|webp|svg)/i.test(file.type||"")});
    if(!small||!small.url){ setStatus("That image could not be read.",true); return null; }
    const rec={id:"mk"+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36),
               name:(file.name||"markup").replace(/\.[a-z0-9]+$/i,"").slice(0,40),
               src:small.url, w:small.w||600, h:small.h||400};
    MA_MARKUPS.unshift(rec);
    if(!maSaveMarkups())MA_MARKUPS.shift();
    return rec;
  }catch(e){ setStatus("That image could not be read: "+(e&&e.message||e),true); return null; }
}
/* =================================================================================================
   6hl — WHAT A SAVED MARKUP ACTUALLY LOOKS LIKE
   Ced: "make the preview exactly what the stamp should be. also, make sure that the preview on
   markups tab is also what the saved markup is."

   A markup saved from a SELECTION has no picture of its own — it is the marks themselves, kept in
   page coordinates relative to their own top-left corner. The library showed that as the words
   "5 marks", and the stamp in the hand showed the same, so the one thing you needed to see before
   putting a stamp down was the one thing neither told you.

   This draws the marks. It is an SVG built from the same fields the page renderer and the export
   read — colour, weight, fill, dash, font, size, alignment — so the tile, the thing in your hand and
   what lands on the sheet are three drawings of one description rather than three guesses.
   ================================================================================================= */
function maGroupBounds(rec){
  const xs=[],ys=[],xe=[],ye=[];
  (rec.annos||[]).forEach(a=>{ xs.push(a.nx||0); ys.push(a.ny||0);
    xe.push((a.nx||0)+(a.nw||0.02)); ye.push((a.ny||0)+(a.nh||0.02)); });
  (rec.lines||[]).forEach(l=>{ const p=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
    p.forEach(q=>{ xs.push(q[0]); ys.push(q[1]); xe.push(q[0]); ye.push(q[1]); }); });
  if(!xs.length)return {x:0,y:0,w:0.1,h:0.06};
  const x=Math.min(...xs), y=Math.min(...ys);
  return {x, y, w:Math.max(0.004,Math.max(...xe)-x), h:Math.max(0.004,Math.max(...ye)-y)};
}
/* The page the markup was taken from, so the drawing keeps its proportions AND its scale: the marks
   are stored as fractions of a page, and a point size is not — so on a 34x22 drawing sheet a fraction
   is four times the points it is on a letter page and text drawn at its own size comes out four times
   too large for the box beside it. 6hy: records saved before the page was recorded fall back to the
   page that is OPEN, which is nearly always the sheet they were taken from and is never as wrong as
   assuming letter. */
function maGroupPage(rec){
  if(rec&&rec.pw&&rec.ph)return {w:rec.pw, h:rec.ph};
  try{
    const pi=(typeof currentPageIdx==="function")?currentPageIdx():0;
    const P=S.pages[pi==null?0:pi];
    if(P&&P.w1&&P.h1)return {w:P.w1, h:P.h1};
  }catch(e){}
  return {w:612, h:792};
}
/* =================================================================================================
   6k8 — WHAT YOU ARE HOLDING IS WHAT YOU WILL GET.
   Ced: "make sure the preview when putting the markup in the pdf is the same size on the actual
   output itself."

   It was not, and the reason is that two different pages were being used to draw one picture. A
   markup's marks are stored as FRACTIONS of the page they were taken from, and `maPlaceMarkup`
   copies those fractions onto the destination page — so what lands is `b.w x b.h` of the sheet you
   are looking at. `maGhostSize` sized the held preview that way, correctly. But the drawing inside
   it was laid out against `maGroupPage(rec)`, the page it was SAVED from, so its viewBox had the
   SOURCE sheet's aspect while its box had the DESTINATION sheet's. With `xMidYMid meet` between the
   two, a markup saved on letter and placed on a 34x22 drawing came out letterboxed and small inside
   a correctly-sized dashed box — Ced's screenshot, where the held splitter note is squashed onto one
   line and the one that lands wraps onto two.

   Two things follow. The ghost lays the artwork out against the page it is about to land on, so the
   box and the drawing finally agree; and it is drawn EXACTLY, without the 3% breathing pad and
   without the after-the-fact refit, both of which exist so a 90px library TILE never clips and both
   of which shrink the drawing relative to its frame. A tile may shrink to fit. A thing in your hand
   may not: it has one job, which is to be the size of the result.
   ================================================================================================= */
function maGroupSvg(rec,maxW,maxH,opts){
  const NS="http://www.w3.org/2000/svg";
  const exact=!!(opts&&opts.exact);
  const P=(opts&&opts.page&&opts.page.w>0&&opts.page.h>0)?opts.page:maGroupPage(rec);
  const b=maGroupBounds(rec);
  const W=b.w*P.w, H=b.h*P.h;                      /* the markup's own size, in points */
  const pad=exact?0:Math.max(1,Math.min(W,H)*0.03);  /* 6hy — room for a rule on the boundary */
  const svg=document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox",
    `${(-pad).toFixed(2)} ${(-pad).toFixed(2)} ${(W+pad*2).toFixed(2)} ${(H+pad*2).toFixed(2)}`);
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  if(maxW)svg.setAttribute("width",maxW);
  if(maxH)svg.setAttribute("height",maxH);
  /* 6hy — and it CLIPS. A mark whose text runs wider than its own box does that on the page too, but
     in a 90px tile it ran out over the tile beside it and read as a broken preview. */
  svg.style.overflow="hidden";
  const X=v=>((v-b.x)*P.w), Y=v=>((v-b.y)*P.h);
  const put=(tag,attrs,parent)=>{ const n=document.createElementNS(NS,tag);
    for(const k in attrs)if(attrs[k]!=null)n.setAttribute(k,attrs[k]);
    (parent||svg).appendChild(n); return n; };
  const rgba=(hex,op)=>{ try{ return _rgbaOf(hex||"#fa3237",(op==null?1:op)); }
                         catch(e){ return hex||"#fa3237"; } };

  /* 6ik — THE MARKUP IS STACKED THE WAY THE PAGE STACKS IT.
     Ced: "when i make the stamp, it's like this. but when saved to mark up, the word REDLINED becomes
     layered to the back." It did: this drew every stroke and then every mark in ARRAY order, so a
     stamp whose box carries a white fill was painted after the words it surrounds and covered them.
     The four levels the page uses decide the order here too — strokes below, marks below, strokes
     above, marks above, each by its own `z` — so a saved markup and the marks it was made from are
     the same picture. */
  const _band=o=>((o&&o.under)?0:1);
  const _rank=(o,i)=>[_band(o),(o&&o.z)||0,i];
  const _cmp=(p,q)=>(p.k[0]-q.k[0])||(p.k[1]-q.k[1])||(p.k[2]-q.k[2]);
  const _lines=(rec.lines||[]).map((l,i)=>({o:l,k:_rank(l,i)})).sort(_cmp).map(x=>x.o);
  const _annos=(rec.annos||[]).map((a,i)=>({o:a,k:_rank(a,i)})).sort(_cmp).map(x=>x.o);
  /* strokes below, then marks below, then strokes above, then marks above */
  const _order=[..._lines.filter(l=>l.under),..._annos.filter(a=>a.under),
                ..._lines.filter(l=>!l.under),..._annos.filter(a=>!a.under)];
  const putLine=l=>{
    const pts=((l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]])
      .map(q=>X(q[0]).toFixed(2)+","+Y(q[1]).toFixed(2)).join(" ");
    const sw=Math.max(0.2,(l.sw!=null?l.sw:1.5));
    let dash=null; try{ const d=dashPdf(l,sw); if(d)dash=d.join(","); }catch(e){}
    put("polyline",{points:pts,fill:"none",stroke:rgba(l.col,l.colOp),"stroke-width":sw,
                    "stroke-linecap":"round","stroke-linejoin":"round","stroke-dasharray":dash});
    /* an arrowhead is a triangle here: the tip sizes and the twelve endings belong to the page, and
       a thumbnail only has to say "this end has a head on it" */
    const head=(k,from,to)=>{
      if(!k||!/arrow/.test(k))return;
      const x1=X(from[0]),y1=Y(from[1]),x2=X(to[0]),y2=Y(to[1]);
      const a0=Math.atan2(y2-y1,x2-x1), hl=Math.max(3,sw*3.2), hw=hl*0.55;
      const p1=[x2-Math.cos(a0)*hl+Math.sin(a0)*hw, y2-Math.sin(a0)*hl-Math.cos(a0)*hw];
      const p2=[x2-Math.cos(a0)*hl-Math.sin(a0)*hw, y2-Math.sin(a0)*hl+Math.cos(a0)*hw];
      put("polygon",{points:`${x2.toFixed(2)},${y2.toFixed(2)} ${p1[0].toFixed(2)},${p1[1].toFixed(2)} `+
                            `${p2[0].toFixed(2)},${p2[1].toFixed(2)}`, fill:rgba(l.col,l.colOp)});
    };
    const raw=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
    head(l.le1||(l.arrow?"arrow":null),raw[raw.length-2],raw[raw.length-1]);
    head(l.le0,raw[1],raw[0]);
  };

  const putAnno=a=>{
    const x=X(a.nx||0), y=Y(a.ny||0), w=(a.nw||0.02)*P.w, h=(a.nh||0.02)*P.h;
    const g=put("g",{transform:(a.rot?`rotate(${a.rot} ${(x+w/2).toFixed(2)} ${(y+h/2).toFixed(2)})`:null)});
    if(a.kind==="img"&&a.src){ put("image",{x:x.toFixed(2),y:y.toFixed(2),
      width:w.toFixed(2),height:h.toFixed(2),href:a.src,preserveAspectRatio:"none"},g); return; }
    const shp=a.shape||(a.box?"rect":null);
    const sw=(a.sw!=null?a.sw:0);
    if(shp){
      const at={fill:(a.fillOp>0?rgba(a.fill||"#ffffff",a.fillOp):"none"),
                stroke:(sw>0?rgba(a.col,a.colOp):"none"),"stroke-width":(sw||null)};
      let dash=null; try{ const d=dashPdf(a,Math.max(0.2,sw||1)); if(d)dash=d.join(","); }catch(e){}
      at["stroke-dasharray"]=dash;
      if(shp==="ellipse")put("ellipse",Object.assign({cx:(x+w/2).toFixed(2),cy:(y+h/2).toFixed(2),
        rx:Math.max(0.5,w/2-sw/2).toFixed(2),ry:Math.max(0.5,h/2-sw/2).toFixed(2)},at),g);
      else put("rect",Object.assign({x:(x+sw/2).toFixed(2),y:(y+sw/2).toFixed(2),
        width:Math.max(0.5,w-sw).toFixed(2),height:Math.max(0.5,h-sw).toFixed(2)},at),g);
    }else if(!a.bgNone){
      put("rect",{x:x.toFixed(2),y:y.toFixed(2),width:w.toFixed(2),height:h.toFixed(2),
                  fill:rgba(a.bg||"#ffffff",(a.fillOp!=null?a.fillOp:1))},g);
    }
    const txt=String(a.text==null?"":a.text);
    if(!txt)return;
    const size=a.size||8;
    let F={css:"Arial,Helvetica,sans-serif"};
    try{ F=MARK_FONTS[markFontKey(a)]||F; }catch(e){}
    const lines=txt.split("\n");
    const lead=size*1.22*((a.lnsp!=null&&a.lnsp>0)?a.lnsp:1);
    const al=a.align||(shp?"center":"left");
    const anchor=(al==="center")?"middle":(al==="right"?"end":"start");
    const tx=(al==="center")?(x+w/2):(al==="right"?(x+w-2):(x+2));
    /* the block sits where the mark says it does — the top of a text box, the middle of a shape */
    const blockH=lead*lines.length;
    const frac=(a.valign==="middle")?0.5:(a.valign==="bottom"?1:(shp?0.5:0));
    const top=y+1+Math.max(0,h-blockH-2)*frac;
    lines.forEach((t,i)=>{
      put("text",{x:tx.toFixed(2), y:(top+lead*(i+1)-lead*0.26).toFixed(2),
        "font-family":F.css,"font-size":size,"font-weight":F.weight||"400",
        "font-style":F.style||"normal","text-anchor":anchor,
        "letter-spacing":(a.lsp?a.lsp:null),
        fill:rgba(a.col,a.colOp)},g).textContent=t;
    });
  };
  /* 6ik — and now, in the page's own order */
  _order.forEach(o=>{ if((rec.lines||[]).indexOf(o)>=0)putLine(o); else putAnno(o); });
  /* 6id — AND THEN IT FITS WHAT IS ACTUALLY IN IT. Ced: "still an issue on markup preview." The box
     was drawn from the marks' own rectangles, but a line of text is as wide as the text, not as wide
     as the box it was typed in — a label whose words run past their own edge (which is normal on the
     page, where nothing is behind them) fell outside the tile and was cut off, so the preview did not
     show the markup you were about to place. The viewBox is widened to the union of the marks' boxes
     and what the browser actually drew, measured once the tile is on the page and the faces have
     settled. Widening it only ever shrinks the drawing to fit, so nothing can be clipped. */
  const _fit=()=>{ try{
      if(!svg.isConnected)return;
      const bb=svg.getBBox();
      if(!bb||!isFinite(bb.width)||!isFinite(bb.height)||bb.width<=0||bb.height<=0)return;
      const x0=Math.min(-pad,bb.x-pad), y0=Math.min(-pad,bb.y-pad);
      const x1=Math.max(W+pad,bb.x+bb.width+pad), y1=Math.max(H+pad,bb.y+bb.height+pad);
      svg.setAttribute("viewBox",
        `${x0.toFixed(2)} ${y0.toFixed(2)} ${Math.max(1,x1-x0).toFixed(2)} ${Math.max(1,y1-y0).toFixed(2)}`);
    }catch(e){} };
  if(!exact){ try{ requestAnimationFrame(()=>{ _fit(); requestAnimationFrame(_fit); }); }catch(e){ } }
  return svg;
}

/* Put one on the page you are looking at, sized so it lands at a sensible width whatever the page. */
function maPlaceMarkup(rec,pi,x,y,anchor){
  if(!rec)return null;
  const page=(pi==null?currentPageIdx():pi);
  if(page==null){ setStatus("Open a report first.",true); return null; }
  /* 6fb — a markup saved from the SELECTION rather than uploaded as a picture: it carries the marks
     themselves, stored relative to their own top-left corner, so dropping it rebuilds them here. */
  if(rec.kind==="group"){
    const ids=[], gmap={}, comap={};
    /* 6ik — the block keeps its OWN internal order as it lands. `topZ` per mark would have renumbered
       them in array order, which is how a stamp's box ended up over the words inside it. The saved
       order is read first, then each piece is given a z above everything already on the page, in that
       order — so the block lands on top as one and reads exactly as it was saved. */
    const byRank=(list)=>list.map((o,i)=>({o,k:[(o.under?0:1),(o.z||0),i]}))
      .sort((p,q)=>(p.k[0]-q.k[0])||(p.k[1]-q.k[1])||(p.k[2]-q.k[2])).map(x=>x.o);
    const base={}; [0,1].forEach(bd=>{
      const bu=!bd;
      base["a"+bd]=Math.max(0,...S.annos.filter(z=>z.page===page&&!!z.under===bu).map(z=>z.z||0));
      base["l"+bd]=Math.max(0,...(S.lines||[]).filter(z=>z.page===page&&!!z.under===bu).map(z=>z.z||0));
    });
    let na=0, nl=0;
    historyBatch(()=>{
      byRank(rec.annos||[]).forEach(a=>{
        const b=Object.assign({},a,{id:seq++,page,nx:(a.nx||0)+x,ny:(a.ny||0)+y});
        if(a.group!=null){ if(gmap[a.group]==null)gmap[a.group]=seq++; b.group=gmap[a.group]; }
        if(a.id!=null)comap[a.id]=b.id;          /* 6g9 — a stored callout keeps its own leader */
        b.z=base["a"+(b.under?0:1)]+(++na);
        S.annos.push(b); ids.push(b.id);
      });
      byRank(rec.lines||[]).forEach(l=>{
        const b=Object.assign({},l,{id:seq++,page,
          x1:(l.x1||0)+x, y1:(l.y1||0)+y, x2:(l.x2||0)+x, y2:(l.y2||0)+y});
        if(l.pts&&l.pts.length)b.pts=l.pts.map(p=>[p[0]+x,p[1]+y]);
        if(l.group!=null){ if(gmap[l.group]==null)gmap[l.group]=seq++; b.group=gmap[l.group]; }
        if(l.coFor!=null)b.coFor=comap[l.coFor];
        if(l.dimFor!=null)b.dimFor=comap[l.dimFor];   /* 6gg — a measurement keeps its reading */
        b.z=base["l"+(b.under?0:1)]+(++nl);
        S.lines.push(b);
      });
    });
    layoutAnnos(); drawAllLines(); updateRail(); updateCount();
    setStatus(`“${rec.name}” placed on page ${page+1}.`);
    return ids[0]!=null?ids[0]:null;
  }
  const pt=maPt(page);
  const wNorm=Math.min(0.34,pt.x(170));
  const ar=(rec.w&&rec.h)?(rec.h/rec.w):0.66;
  const hNorm=wNorm*ar*(pt.w/pt.h);
  /* 6hf — `tl` hangs it from the click; anything else still centres it, which is what the parts
     list and a scripted placement want. */
  const nx=(anchor==="tl")?(x!=null?x:0.5):((x!=null?x:0.5)-wNorm/2);
  const ny=(anchor==="tl")?(y!=null?y:0.45):((y!=null?y:0.45)-hNorm/2);
  let id=null;
  historyBatch(()=>{
    id=addText(page,Math.max(0,nx),Math.max(0,ny),"");
    const a=S.annos.find(z=>z.id===id);
    if(a){
      a.kind="img"; a.src=rec.src; a.maKind="markup";
      a.nw=wNorm; a.nh=hNorm; a.manualW=true; a.under=false; try{ topZ(a); }catch(e){}   /* 6i3 */
      /* 6gr — A DROPPED MARKUP IS THE PICTURE, NOT A WASH OF IT. Ced: "the applied photo looked weird"
         — a pale pink ghost of his drawing. `addText` stamps the CURRENT TOOL's look onto every new
         mark, and for a picture the tool's FILL OPACITY becomes the picture's opacity: place a markup
         with the Box tool set to 35% fill and the markup lands at 35%. A picture has a look of its own
         and it is the file: fully opaque, no frame, no ground behind it, so a PNG with a transparent
         background drops onto the sheet exactly as it was drawn. */
      a.fillOp=1; a.colOp=1; a.sw=0; a.bgNone=true; a.hl=false;
      a.pat=""; a.patOp=1;
    }
  });
  layoutAnnos(); updateRail(); updateCount();
  setStatus(`“${rec.name}” placed on page ${page+1} — drag it where it goes.`);
  return id;
}

/* =================================================================================================
   7. THE PANEL
   -------------------------------------------------------------------------------------------------
   One panel, four tabs, and every control in it acts on the document behind it rather than on a copy
   of it. It is deliberately not a modal: you stamp, look at the page, drag the stamp, and stamp
   again without anything closing.
   ================================================================================================= */
let MA_TAB="notes";
/* 6ic — WHICH CARDS ARE OPEN. The panel used to be one body with a tab strip over it; it is now a
   column of cards, and this is the set of them that is showing. `MA_TAB` is kept as the card that was
   opened last, because a few callers still say "show me the markups" and mean "put it in front". */
/* 6k4 — and the COP stamp, which is the same kind of thing as the four beside it: something you set
   up once for a document and then apply to pages. Its renderer lives in stamp.js. */
/* =================================================================================================
   6kx — FOUR THINGS TAKEN OUT. Ced: "remove the following functions: Redline report, as-built,
   notes, and parts."

   Notes and Parts were seeded libraries from the tool's first week — canned sentences and a parts
   list the callouts were meant to be built from — and the way the tool is actually used, a note is
   typed where it goes and a callout is typed into. As-built read a second PDF and offered a redline
   wherever the two disagreed, which never survived contact with real drawings. Redline report wrote
   a summary of the marks; the export's own naming and the marks themselves say it better.

   What Assist is now: Read table, Markups, COP stamp — the three that put something on the sheet or
   take something off it. Their entry points, their cards and the report's modal are gone with them,
   so nothing here opens onto a feature that is not there.
   ================================================================================================= */
const MA_CARDS=[["markups","Markups"],["stamp","COP stamp"]];
let MA_OPEN=new Set(["markups"]);

function maEsc(s){ return escapeHtml(String(s==null?"":s)); }
/* 6il — THE ASSIST SECTIONS ARE DROPDOWNS. Ced: "separate the tabs of assist tools. they should pop
   up like the drop down of the redline tools." So this is no longer a docked panel with four things
   inside it; it is the same kind of popover a tool's ▾ opens — one section, anchored under the button
   that asked for it, dismissed on Escape or a click outside. The four renderers below are untouched:
   what changed is where their output appears. */
let _maAnchor=null;
/* =================================================================================================
   6ks — THE ASSIST PANEL MOVES. Ced: "also make the prompts of assist draggable."

   The redline tools' popover has been draggable since 6fe, for a reason that applies here word for
   word: a fixed card hung under the button that opened it sits over the very part of the sheet you
   are working on, and the Assist panel is the taller of the two. It is dragged by its head, it stays
   where it was put — through a close and a reopen, and through a reload, because a panel that forgets
   is a panel you move twice a session — and it is clamped back into view when the window changes
   size rather than left half off the edge. The head is still a head: the ✕ in it is still a button,
   and a press on a field inside the panel is not a drag.
   ================================================================================================= */
const MA_POS_KEY="ma.panelPos";
let _maPos=null;
try{ const raw=localStorage.getItem(MA_POS_KEY);
     if(raw){ const q=JSON.parse(raw);
       if(q&&isFinite(q.left)&&isFinite(q.top))_maPos={left:+q.left,top:+q.top}; } }catch(e){}
function maPosSave(){
  try{ if(_maPos)localStorage.setItem(MA_POS_KEY,JSON.stringify(_maPos));
       else localStorage.removeItem(MA_POS_KEY); }catch(e){}
}
function maPlacePanel(){
  const p=$("#maPanel"); if(!p||!p.classList.contains("show"))return;
  const w=p.offsetWidth||360, h=p.offsetHeight||520;
  let left,top;
  /* 6ks — where it was put wins over where it would have opened */
  if(_maPos){ left=_maPos.left; top=_maPos.top; }
  else if(_maAnchor&&_maAnchor.getBoundingClientRect){
    const r=_maAnchor.getBoundingClientRect();
    left=r.left; top=r.bottom+6;
    /* a button at the foot of the window opens its panel upwards, the way the tool panels do */
    if(top+h>window.innerHeight-8&&r.top-6-h>8)top=r.top-6-h;
  }else{ left=window.innerWidth-w-16; top=76; }
  left=Math.max(8,Math.min(left,window.innerWidth-w-8));
  top =Math.max(8,Math.min(top ,Math.max(8,window.innerHeight-h-8)));
  p.style.left=left+"px"; p.style.top=top+"px";
  /* a clamp is a move: remember where it actually ended up, not where it was asked to go */
  if(_maPos)_maPos={left,top};
}
/* 6ks — and the gesture itself. Bound once, on the panel, so it survives every rebuild of the head
   that `maRenderPanel` does — a listener put on the head would be thrown away with it. */
function maDragWire(){
  const p=$("#maPanel"); if(!p||p._dragWired)return; p._dragWired=true;
  p.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    const head=e.target.closest&&e.target.closest(".mk-head");
    if(!head||!p.contains(head))return;
    /* the head holds controls of its own — the ✕, the tab chips — and those are still controls */
    if(e.target.closest("button,input,select,textarea,a,label"))return;
    const r=p.getBoundingClientRect();
    const dx=e.clientX-r.left, dy=e.clientY-r.top;
    let moved=false;
    try{ p.setPointerCapture&&p.setPointerCapture(e.pointerId); }catch(_){}
    p.classList.add("dragging");
    const move=ev=>{ moved=true; _maPos={left:ev.clientX-dx,top:ev.clientY-dy}; maPlacePanel(); };
    const up=()=>{ p.classList.remove("dragging");
      p.removeEventListener("pointermove",move);
      p.removeEventListener("pointerup",up);
      p.removeEventListener("pointercancel",up);
      if(moved)maPosSave(); };
    p.addEventListener("pointermove",move);
    p.addEventListener("pointerup",up);
    p.addEventListener("pointercancel",up);
    e.preventDefault();
  });
  /* and the way back, for a panel dragged somewhere unhelpful: double-click its head */
  p.addEventListener("dblclick",e=>{
    const head=e.target.closest&&e.target.closest(".mk-head");
    if(!head||!p.contains(head))return;
    if(e.target.closest("button,input,select,textarea,a,label"))return;
    maResetPos();
    try{ setStatus("Panel back where it opens from — drag its head to move it again."); }catch(_){}
  });
}
function maResetPos(){ _maPos=null; maPosSave(); maPlacePanel(); }
window.addEventListener("resize",()=>{ try{ maPlacePanel(); }catch(e){} });
window.addEventListener("scroll",()=>{ try{ maPlacePanel(); }catch(e){} },true);
function maPanelOpen(on,anchor){
  const p=$("#maPanel"); if(!p)return;
  const show=(on==null)?!p.classList.contains("show"):!!on;
  if(anchor)_maAnchor=anchor;
  p.classList.toggle("show",show);
  p.setAttribute("aria-hidden",show?"false":"true");
  document.body.classList.remove("maon");     /* 6il — a popover does not push the sheet over */
  if(show){ maRenderPanel(); try{ maDragWire(); }catch(e){} maPlacePanel();
            requestAnimationFrame(()=>{ try{ maPlacePanel(); }catch(e){} }); }
  try{ syncEmbossSoon(); }catch(e){}
  try{ updateMiniBar(); }catch(e){}     /* 6hb — the ribbon's own button shows the panel is open */
}
/* Escape closes it, and so does a click that is not in it and not on the button that opened it */
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape")return;
  const p=$("#maPanel"); if(p&&p.classList.contains("show")){ maPanelOpen(false); }
},true);
document.addEventListener("pointerdown",e=>{
  const p=$("#maPanel"); if(!p||!p.classList.contains("show"))return;
  if(e.target.closest&&(e.target.closest("#maPanel")||e.target.closest("#dlg")||
                        e.target.closest(".sk-edit")||e.target.closest("#toolpop")))return;
  const b=e.target.closest&&e.target.closest("button");
  if(b&&/^(markupsBtn|stampBtn|miniAnalyze)$/.test(b.id||""))return;   /* 6kx */
  maPanelOpen(false);
},true);
function maSetTab(t){ MA_TAB=t; MA_OPEN=new Set([t]); maRenderPanel(); maPlacePanel(); }
function maCloseTab(t){ if(!t||MA_TAB===t)maPanelOpen(false); }
function maTabOpen(t){
  return MA_TAB===t&&!!($("#maPanel")&&$("#maPanel").classList.contains("show"));
}

function maRenderPanel(){
  const body=$("#maBody"); if(!body)return;
  const site=$("#maSite"); if(site)site.textContent=S.siteCode||"";
  const ttl=$("#maTitle");
  const row=MA_CARDS.find(c=>c[0]===MA_TAB)||MA_CARDS[0];
  if(ttl)ttl.textContent=row[1];
  const pan=$("#maPanel"); if(pan)pan.dataset.ma=row[0];
  body.innerHTML="";
  /* v60 — a card may pin a footer to the panel (outside the scrolling body); it belongs to the
     card that drew it, so it goes when the panel is redrawn */
  { const ft=document.getElementById("maFoot"); if(ft)ft.remove(); }
  if(row[0]==="stamp")maRenderStampTab(body);          /* 6k4 — stamp.js */
  else maRenderMarkupsTab(body);                       /* 6kx — and there are only the two */
  try{ maPlacePanel(); }catch(e){}
}

/* ---- a few small builders, so the four tabs below read as what they are ---- */
function maField(label,id,value,ph,type){
  const l=el("label","ma-f");
  l.innerHTML=`<span>${maEsc(label)}</span><input type="${type||"text"}" id="${id}" value="${maEsc(value)}" placeholder="${maEsc(ph||"")}" spellcheck="false">`;
  return l;
}
function maBtn(label,cls,fn){
  const b=el("button","ma-go"+(cls?" "+cls:""),maEsc(label));
  b.type="button"; b.onclick=fn; return b;
}
function maSection(title){
  const d=el("div","ma-sec");
  if(title)d.appendChild(el("h4",null,maEsc(title)));
  return d;
}
/* the scope control every bulk action shares */
function maScopeControl(pref){
  const wrap=el("div");
  const l=el("label","ma-f");
  l.innerHTML=`<span>Pages</span>
    <select id="maScope">
      <option value="all">Every page</option>
      <option value="page">The page I am on</option>
      <option value="range">A range…</option>
    </select>`;
  wrap.appendChild(l);
  const r=el("label","ma-f");
  r.innerHTML=`<span>Range</span><input type="text" id="maRange" placeholder="e.g. 1-8, 12, 30-" spellcheck="false">`;
  r.style.display=(pref==="range")?"block":"none";
  wrap.appendChild(r);
  setTimeout(()=>{
    const sel=$("#maScope"); if(!sel)return;
    sel.value=pref||"all";
    sel.onchange=()=>{ r.style.display=(sel.value==="range")?"block":"none"; MA_PREFS.scope=sel.value; maSavePrefs(); };
  },0);
  return wrap;
}
function maScopeNow(){
  const sel=$("#maScope"), rng=$("#maRange");
  return maScopePages(sel?sel.value:"all",rng?rng.value:"");
}





/* ---- NOTES ---- */
function maRenderNotesTab(body){
  const s1=maSection("The note");
  const t=el("label","ma-f");
  t.innerHTML=`<span>Text — one line per line</span><textarea id="maNoteText" spellcheck="false" placeholder="ACTUAL INSTALL: TRIAD MOUNT WITH STEALTH SHROUD"></textarea>`;
  s1.appendChild(t);
  s1.appendChild(maScopeControl("all"));
  const btns=el("div","ma-btns");
  btns.appendChild(maBtn("Place on those pages",null,()=>{
    const txt=($("#maNoteText")&&$("#maNoteText").value||"").trim();
    if(!txt){ setStatus("Type the note first.",true); return; }
    const pages=maScopeNow();
    if(!pages.length){ setStatus("No pages in that range.",true); return; }
    maArmPlacement({kind:"note",text:txt,pages},
      `Click where the note should sit — it goes in that spot on all ${pages.length} page${pages.length===1?"":"s"}.`);
  }));
  btns.appendChild(maBtn("Save to the list","ghost",()=>{
    const txt=($("#maNoteText")&&$("#maNoteText").value||"").trim();
    if(!txt)return;
    if(MA_NOTES.indexOf(txt)<0){ MA_NOTES.unshift(txt); maSaveNotes(); maRenderPanel(); }
  }));
  s1.appendChild(btns);
  body.appendChild(s1);

  const s2=maSection("Saved notes");
  const list=el("div","ma-list");
  if(!MA_NOTES.length)list.appendChild(el("div","ma-empty","Nothing saved yet."));
  MA_NOTES.forEach((n,i)=>{
    const row=el("div","ma-item");
    const t2=el("div","t");
    t2.innerHTML=`<b>${maEsc(n.split("\n")[0])}</b>`+(n.indexOf("\n")>=0?`<small>${maEsc(n.split("\n").slice(1).join(" · "))}</small>`:"");
    t2.title="Put this in the box above";
    t2.onclick=()=>{ const f=$("#maNoteText"); if(f){ f.value=n; f.focus(); } };
    row.appendChild(t2);
    const x=el("button","x","✕"); x.type="button"; x.title="Remove from the list";
    x.onclick=()=>{ MA_NOTES.splice(i,1); maSaveNotes(); maRenderPanel(); };
    row.appendChild(x);
    list.appendChild(row);
  });
  s2.appendChild(list);
  body.appendChild(s2);
}

/* ---- PARTS ---- */
function maRenderPartsTab(body){
  const s1=maSection("Callout");
  /* 6ig — Ced: "remove unnecessary sentences on the ui." One line that says what to do. */
  s1.appendChild(el("p","ma-hint","Pick a part, then click where the leader should point."));
  const f=el("label","ma-f");
  f.innerHTML=`<span>Search</span><input type="text" id="maPartFind" placeholder="sabre, pipe, SCX7…" spellcheck="false">`;
  s1.appendChild(f);
  body.appendChild(s1);

  const s2=maSection("Parts");
  const list=el("div","ma-list"); list.id="maPartList";
  s2.appendChild(list);
  body.appendChild(s2);

  const s3=maSection("Add a part");
  const row1=el("div","ma-row");
  row1.appendChild(maField("What it is","maPName","","New Sector Frame"));
  s3.appendChild(row1);
  const row2=el("div","ma-row");
  row2.appendChild(maField("MFR","maPMfr","","Sabre"));
  row2.appendChild(maField("Part #","maPPart","","C10841002C"));
  s3.appendChild(row2);
  s3.appendChild(maField("How many","maPQty","","(1) per sector"));
  const b=el("div","ma-btns");
  b.appendChild(maBtn("Add to the library",null,()=>{
    const g=id=>{ const f2=$("#"+id); return f2?f2.value.trim():""; };
    const p={name:g("maPName"),mfr:g("maPMfr"),part:g("maPPart"),qty:g("maPQty")};
    if(!p.name&&!p.part){ setStatus("Give the part a name or a number.",true); return; }
    MA_PARTS.unshift(p); maSaveParts(); maRenderPanel();
  }));
  s3.appendChild(b);
  body.appendChild(s3);

  const draw=()=>{
    const q=(($("#maPartFind")&&$("#maPartFind").value)||"").toLowerCase().trim();
    const L=$("#maPartList"); if(!L)return;
    L.innerHTML="";
    const hits=MA_PARTS.filter(p=>!q||[p.name,p.mfr,p.part,p.qty].join(" ").toLowerCase().indexOf(q)>=0);
    if(!hits.length){ L.appendChild(el("div","ma-empty","Nothing matches.")); return; }
    hits.forEach(p=>{
      const row=el("div","ma-item");
      const t=el("div","t");
      t.innerHTML=`<b>${maEsc(p.name||p.part)}</b><small>${maEsc([p.mfr,p.part,p.qty].filter(Boolean).join(" · "))}</small>`;
      t.title="Click the page next — the leader points at what you click";
      t.onclick=()=>{
        MA_CALLOUT_TEXT=maPartText(p);
        setMode("callout");
        setStatus("Click what the callout points at.");
      };
      row.appendChild(t);
      const x=el("button","x","✕"); x.type="button"; x.title="Remove from the library";
      x.onclick=()=>{ const i=MA_PARTS.indexOf(p); if(i>=0){ MA_PARTS.splice(i,1); maSaveParts(); draw(); } };
      row.appendChild(x);
      L.appendChild(row);
    });
  };
  const fi=$("#maPartFind"); if(fi)fi.oninput=draw;
  draw();
}

/* ---- MARKUPS ---- */
function maRenderMarkupsTab(body){
  const s1=maSection("Your markups");
  s1.appendChild(el("p","ma-hint","Click one to pick it up, then click the page to place it."));
  const btns=el("div","ma-btns");
  btns.appendChild(maBtn("Add an image…",null,()=>{ const f=$("#maImgFile"); if(f)f.click(); }));
  s1.appendChild(btns);
  body.appendChild(s1);

  /* v60 — PRELOADED MARKUPS. Ced: "add these on pre loaded markup photos." A set of equipment
     drawings ships with the tool (markups-preset.js, built by tools/addmarkups.py), so every user
     starts with them instead of each uploading their own. They sit under their own heading, after
     the user's own library; they are never written to this browser's storage (the library's quota is the user's),
     cannot be removed, and editing one saves an edited COPY into the user's library, so the
     preloaded original is always there to go back to. */
  const PRE=(typeof MA_PRESET_MARKUPS!=="undefined"&&Array.isArray(MA_PRESET_MARKUPS))?MA_PRESET_MARKUPS:[];
  for(const [title,LIST,isPre] of [["Library",MA_MARKUPS,false],["Preloaded",PRE,true]]){   /* yours first */
  if(isPre&&!LIST.length)continue;
  const s2=maSection(`${title} (${LIST.length})`);
  if(!LIST.length){
    s2.appendChild(el("div","ma-empty","Nothing here yet."));
  }else{
    const grid=el("div","ma-grid");
    LIST.forEach(rec=>{
      const cell=el("div","ma-mk");
      if(rec.kind==="group"){
        /* 6hl — a saved selection has no picture of its own, so one is DRAWN from the marks it holds:
           the tile shows the stamp, not a count of its parts. */
        const n=(rec.annos||[]).length+(rec.lines||[]).length;
        const tag=el("div","ma-mkgrp");
        try{
          const svg=maGroupSvg(rec);
          svg.classList.add("ma-mksvg");
          tag.appendChild(svg);
          tag.title=n+" mark"+(n===1?"":"s");
        }catch(e){ tag.textContent=n+" mark"+(n===1?"":"s"); }
        cell.appendChild(tag);
      }else{
        const im=el("img"); im.src=rec.src; im.alt=rec.name; im.draggable=false;
        cell.appendChild(im);
      }
      cell.appendChild(el("span","nm",maEsc(rec.name)));
      /* 6hf — Ced: "instead of pasting it already on the pdf, make it as if the user is holding it
         first … then the user will click on pdf where it should be located." 6gs had it drop straight
         onto the middle of the page, which is one gesture but the wrong place nearly every time: a
         north arrow belongs in a corner and a detail belongs beside the thing it details, so every
         drop was followed by a drag. Now the click picks it UP — the preview follows the pointer at
         the size it will land at — and the next click on the sheet puts it down. Shift still drops one
         in the middle for anyone who wants the old gesture. */
      cell.title="Click to pick it up, then click the sheet where it goes (Shift drops it in the middle)";
      cell.onclick=ev=>{
        if(ev&&ev.shiftKey){
          const pi=(typeof currentPageIdx==="function")?currentPageIdx():0;
          const id=maPlaceMarkup(rec,pi,0.5,0.5);
          if(id!=null){ try{ setMode("select"); selectAnno(id); }catch(e){} }
          return;
        }
        maArmPlacement({kind:"markup",rec},
          `Holding “${rec.name}” — click the sheet where its top-left corner goes.`);
      };
      if(!isPre){
      const x=el("button","x","✕"); x.type="button"; x.title="Remove from the library";
      x.onclick=ev=>{ ev.stopPropagation();
        const i=MA_MARKUPS.indexOf(rec); if(i>=0){ MA_MARKUPS.splice(i,1); maSaveMarkups(); maRenderPanel(); } };
      cell.appendChild(x);
      }
      /* 6ha — AND A MARKUP CAN BE EDITED. Ced: "markups should be editable too as an option." A
         graphic is uploaded once and used on every report after it, which is exactly the thing worth
         cleaning up once: rub out the margin it came with, crop it, turn it, put white behind it. It
         opens in the same picture editor a snapshot does, and what comes back is written to the library
         entry — so every future drop gets the tidied version, and the ones already on the sheet are
         left exactly as they are. */
      if(rec.kind!=="group"){
        const ed=el("button","edit","✎"); ed.type="button";
        ed.title="Edit this markup — erase, crop, turn or fill it";
        ed.onclick=ev=>{ ev.stopPropagation();
          const shim={id:"mk:"+(rec.id!=null?rec.id:rec.name),page:0,kind:"img",
                      src:rec.src,srcOrig:rec.srcOrig||rec.src,nw:null,nh:null};
          try{
            skEditor(shim,{title:"Edit markup — "+(rec.name||""),
              onSave:url=>{
                /* a preloaded markup is never changed in place: the edit becomes the user's copy */
                if(isPre){
                  const copy=Object.assign({},rec,{id:"mk"+Date.now().toString(36),preset:false,
                                                   name:(rec.name||"Markup")+" (edited)",srcOrig:rec.src});
                  MA_MARKUPS.unshift(copy); rec=copy;
                }
                rec.src=url;
                if(!rec.srcOrig)rec.srcOrig=shim.srcOrig;
                const im=new Image();
                im.onload=()=>{ rec.w=im.naturalWidth; rec.h=im.naturalHeight;
                                maSaveMarkups(); maRenderPanel();
                                setStatus("Markup updated — every new drop uses it."); };
                im.onerror=()=>{ maSaveMarkups(); maRenderPanel(); };
                im.src=url;
              }});
          }catch(e){ setStatus("Could not open that markup.",true); }
        };
        cell.appendChild(ed);
      }else{
        /* v60 — A SNAPSHOT SAVED TO THE LIBRARY IS A PICTURE TOO. Ced: "the markups added from snapshot
           still dont have the edit photo option from markups." "Add to markup library" on the
           selection bar saves a SELECTION, so a snapshot added that way became a one-mark group, and
           6ha's ✎ was only ever offered to uploaded images. A group whose marks include exactly one
           picture now gets the same ✎: it edits that picture inside the entry, and a crop that
           changes the picture's shape keeps its width and takes the new height, so the next drop is
           not stretched. (A group of several pictures is ambiguous — which one? — and is left as is.) */
        const pics=(rec.annos||[]).filter(a=>a&&a.kind==="img"&&/^data:image\//.test(String(a.src||"")));
        if(pics.length===1){
          const pic=pics[0];
          const ed=el("button","edit","✎"); ed.type="button";
          ed.title="Edit this markup's picture — erase, crop, turn or fill it";
          ed.onclick=ev=>{ ev.stopPropagation();
            const shim={id:"mk:"+(rec.id!=null?rec.id:rec.name),page:0,kind:"img",
                        src:pic.src,srcOrig:pic.srcOrig||pic.src,nw:null,nh:null};
            try{
              skEditor(shim,{title:"Edit markup — "+(rec.name||""),
                onSave:url=>{
                  pic.src=url;
                  if(!pic.srcOrig)pic.srcOrig=shim.srcOrig;
                  const im=new Image();
                  const done=()=>{ maSaveMarkups(); maRenderPanel();
                                   setStatus("Markup updated — every new drop uses it."); };
                  im.onload=()=>{
                    try{
                      const w=im.naturalWidth, h=im.naturalHeight, pw=rec.pw||612, ph=rec.ph||792;
                      if(w>0&&h>0&&pic.nw>0)pic.nh=pic.nw*pw*h/(w*ph);
                    }catch(e){}
                    done(); };
                  im.onerror=done;
                  im.src=url;
                }});
            }catch(e){ setStatus("Could not open that markup.",true); }
          };
          cell.appendChild(ed);
        }
      }
      grid.appendChild(cell);
    });
    s2.appendChild(grid);
  }
  body.appendChild(s2);
  }
}

/* ---- AS-BUILT ---- */
function maRenderImportTab(body){
  const s1=maSection("As-built source");
  s1.appendChild(el("p","ma-hint","Open the RFDS or mount mapping; what it does not account for is listed below."));
  const btns=el("div","ma-btns");
  btns.appendChild(maBtn(MA_ASBUILT?("Choose another PDF"):("Choose a PDF…"),MA_ASBUILT?"ghost":null,()=>{
    const f=$("#maFile"); if(f)f.click();
  }));
  if(MA_ASBUILT)btns.appendChild(maBtn("Compare again","ghost",()=>{ maCompare(); maRenderPanel(); }));
  s1.appendChild(btns);
  if(MA_ASBUILT)s1.appendChild(el("p","ma-hint",
    `Read: <b>${maEsc(MA_ASBUILT.name)}</b> — ${MA_ASBUILT.pages} pages, ${MA_ASBUILT.tokens.size} identifying values, ${MA_ASBUILT.heights.size} heights.`));
  body.appendChild(s1);

  if(!MA_ASBUILT)return;
  const s2=maSection(`Not accounted for (${MA_DIFFS.length})`);
  if(!MA_DIFFS.length){
    s2.appendChild(el("div","ma-empty","Everything on the loading table is accounted for."));
    body.appendChild(s2);
    return;
  }
  MA_DIFFS.forEach(d=>{
    const card=el("div","ma-diff");
    card.innerHTML=`<div class="h"><span>page ${d.page+1}</span><span>${maEsc(d.kind)}</span></div>
      <div class="v">${maEsc(d.printed)}</div>
      <div class="h" style="margin-top:3px">not in the as-built: <b>${maEsc(d.missing.join(", "))}</b></div>`;
    const go=el("div","ma-btns go");
    go.appendChild(maBtn("Show me","ghost",()=>maGotoDiff(d)));
    go.appendChild(maBtn("Redline it",null,()=>{ maRedlineDiff(d); }));
    card.appendChild(go);
    s2.appendChild(card);
  });
  body.appendChild(s2);
}

/* =================================================================================================
   8. THE REDLINE REPORT — what was marked, page by page, in a form you can paste into an email
   ================================================================================================= */
function maReportText(){
  const out=[];
  out.push(`Redline summary — ${siteLocation()||S.name||"this document"}`);
  const byPage={};
  (S.annos||[]).forEach(a=>{
    if(a.kind==="img")return;
    if(!String(a.text||"").trim())return;
    (byPage[a.page]=byPage[a.page]||[]).push(a);
  });
  const strikes={};
  (S.lines||[]).forEach(l=>{ strikes[l.page]=(strikes[l.page]||0)+1; });
  Object.keys(byPage).map(Number).sort((a,b)=>a-b).forEach(p=>{
    out.push("");
    out.push(`Page ${p+1}`);
    byPage[p].forEach(a=>{
      const what=String(a.text).replace(/\n/g," / ");
      const kind=a.maKind==="callout"?"callout":(a.maKind==="note"?"note":(a.maKind==="fix"?"corrected":"redline"));
      out.push(`  • ${kind}: ${what}`);
    });
    if(strikes[p])out.push(`  • ${strikes[p]} strike${strikes[p]===1?"":"s"}`);
  });
  const total=(S.annos||[]).length+(S.lines||[]).length;
  out.push("");
  out.push(`${total} mark${total===1?"":"s"} in total.`);
  return out.join("\n");
}
function maOpenReport(){
  const m=$("#reportModal"), b=$("#reportBody");
  if(!m||!b)return;
  b.textContent=maReportText();
  m.classList.add("show");
}

/* =================================================================================================
   9. WIRING
   ================================================================================================= */
(function maWire(){
  const start=()=>{
    try{ ttfInstallFaces(); }catch(e){}     /* 6hm — the bundled faces, before anything is laid out */
    maLoadPrefs(); maLoadParts(); maLoadNotes(); maLoadMarkups(); maLoadToolStyles();

    const on=(id,fn)=>{ const b=document.getElementById(id); if(b)b.onclick=fn; };
    /* 6hs — four buttons, one panel. Each opens it on its own tab, and pressing the one that is
       already showing closes it again, so a button reads as the thing it opens rather than as a
       toggle for a panel you then have to find the tab in. */
    /* 6il — a button opens ITS OWN dropdown under itself, and pressing it again closes it */
    const tabBtn=(id,tab)=>on(id,()=>{
      if(maTabOpen(tab)){ maPanelOpen(false); return; }
      MA_TAB=tab; MA_OPEN=new Set([tab]);
      maPanelOpen(true,document.getElementById(id));
    });
    tabBtn("markupsBtn","markups");
    tabBtn("stampBtn","stamp");                        /* 6k4 */
    /* 6kx — maBtn / noteBtn / partsBtn / importBtn / reportBtn are gone, buttons and all */
    on("maClose",()=>maPanelOpen(false));
    on("analyzeMaBtn",maAnalyzeOpen);
    on("maAzClose",maAnalyzeClose);
    on("maAzApply",()=>{ maApplyTable(); maAnalyzeRender(); });
    on("maAzReread",()=>{ MA_TABLE=null; maReadLoading(); maAnalyzeRender(); });



    /* The seven fields the properties panels write into: what the next mark looks like, and — while something is selected — what the
       selection looks like. Wired on `input` so a colour follows the picker as it is dragged. */
    [["c_text","col"],["c_sw","sw"],["c_bg","bg"],["c_fill","fill"],["c_fop","fillOp"],["c_pt","size"],
     ["c_font","font"]]
      .forEach(([id,what])=>{
        const f=document.getElementById(id); if(!f)return;
        const onChange=()=>{
          maRememberToolStyle();                    /* this tool now draws like this */
          const n=maRestyleSelection(what);         /* and anything selected changes with it */
          if(n)setStatus(`Restyled ${n} mark${n===1?"":"s"}.`);
        };
        f.addEventListener("input",onChange);
        f.addEventListener("change",onChange);
      });
    maLoadToolStyles();
    maShowToolStyle(S.mode);

    /* Escape gives up a placement or a half-drawn polyline.
       6jt — AND NOTHING MORE. This used to put the tool down as well, and it ran before the ladder in
       app.js, so the ladder never got a turn: one press cancelled the run, dropped the selection and
       the tool with it. Ced: "a single esc click will deselect the shape while double esc click will
       put the tool to select." Each press undoes one thing, and the thing THIS handler owns is a
       gesture that is half finished — a polyline being laid out, or a stamp waiting to be put down.
       Everything after that belongs to the ladder, which this now falls through to. */
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape"){
        if(maPolyCancel()){ e.preventDefault();
          setStatus("Polyline dropped — the tool is still in your hand."); return; }
        if(_maPending){ _maPending=null; document.body.classList.remove("maplacing");
          maGhostOff();
          setStatus("Placement cancelled — the tool is still in your hand."); e.preventDefault(); return; }
      }
      if((e.key==="Enter"||e.key==="Return")&&_maPoly&&!_editTarget()){ e.preventDefault(); maPolyFinish(); }
    });
    /* the segment under the pointer, drawn live while a polyline is being laid out */
    document.addEventListener("pointermove",e=>{
      if(!_maPoly)return;
      const pg=document.querySelector(`.page[data-idx="${_maPoly.page}"]`); if(!pg)return;
      const r=pg.getBoundingClientRect();
      let hx=(e.clientX-r.left)/pg.offsetWidth, hy=(e.clientY-r.top)/pg.offsetHeight;
      /* 6f6 — a leader's corners straighten too: each segment snaps against the corner before it */
      const prev=_maPoly.pts[_maPoly.pts.length-1];
      if(prev){ const q=snapDrawPoint(prev[0],prev[1],hx,hy,e,pg); hx=q[0]; hy=q[1]; }
      _maPoly.hover=[hx,hy];
      maPolyPaint();
    });

    const img=document.getElementById("maImgFile");
    if(img)img.onchange=async e=>{
      const f=e.target.files&&e.target.files[0]; if(!f)return;
      e.target.value="";
      const rec=await maAddMarkupFile(f);
      if(rec){ MA_TAB="markups"; maPanelOpen(true,document.getElementById("markupsBtn")); setStatus(`“${rec.name}” added to your markups.`); }
    };

    /* The redline colour starts on the red the sample reports are actually marked in. */
    const c=document.getElementById("c_text");
    if(c&&c.value.toLowerCase()==="#c00000"){ c.value=MA_RED; try{ c.dispatchEvent(new Event("input")); }catch(e){} }

    LOG&&LOG("Assist layer ready");
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else setTimeout(start,0);
})();

/* =================================================================================================
   ANALYZE MA — the loading table, off the page and into a form
   -------------------------------------------------------------------------------------------------
   Every mount analysis turns on one table. It is called "Antenna Loading" or "Final Loading
   Configuration" or "Equipment Loading" depending on who wrote the report, and it says, per row: how
   many, of what, at what centreline, on what mount, existing or proposed. It is where nearly every
   correction goes, and correcting it by hand means clicking twenty small cells one at a time.

   This reads it off the page — columns resolved from the printed header, rows from the printed row
   bands, each cell keeping the box it was printed in — shows it as a form, and then writes back ONLY
   the cells that were changed, as redlines sitting exactly on the printed values they replace.

   What it does not do is decide anything. Nothing is written until Apply, nothing is written that was
   not edited, and every mark it makes is an ordinary redline you can move, retype or delete.
   ================================================================================================= */
let MA_TABLE=null;     /* {columns, rows, page…} as read */

/* The header line of a loading table, whoever wrote it. Scored the same way the page itself is:
   several of these column names on one line is a header, one of them is a sentence. */
function maLoadHeaderLine(l){
  const n=l.norm||"";
  let s=0;
  ["qty","quantity","model","manufacturer","mfr","vendor","radcenter","centerline","centreline",
   "elevation","mounttype","mounttyp","status","antenna","equipment","owner","tenant","carrier",
   "existing","proposed"].forEach(k=>{ if(n.indexOf(k)>=0)s++; });
  return s>=3;
}
const MA_LOAD_SKIP=/^(qty|quantity|model|manufacturer|mfr|vendor|status|antenna|equipment|mount|type|owner|tenant|carrier|rad|center|centre|line|elevation|ft|existing|proposed|reserved)+$/;

/* Words a loading table's header is made of, and nothing else is. */
const MA_HDR_WORDS=/(existing|proposed|reserved|decom|mount|center|centre|line|antenna|equipment|model|qty|quantity|type|owner|tenant|carrier|status|manufacturer|mfr|vendor|elevation|rad|azimuth|no\.?|number|item|description|part|ft|in|lbs|sector|position|height|feed|line)/i;
/* Is this line part of the header rather than part of the table? A header line is made of those
   words and carries no value: a model number, a centreline or a count all disqualify it. "(ft)" and
   "(in)" are units and stay. */
function maIsHeaderLine(l){
  const txt=(l.items||[]).map(t=>String(t.str).trim()).filter(Boolean);
  if(!txt.length)return false;
  let words=0, values=0;
  txt.forEach(t=>{
    const bare=t.replace(/[()\/.,:-]/g,"").trim();
    if(!bare)return;
    if(/^\d+(\.\d+)?$/.test(bare)){ values++; return; }              /* a number is a value */
    if(/\d/.test(bare)&&bare.length>=4){ values++; return; }          /* a model carries digits */
    if(MA_HDR_WORDS.test(bare))words++;
  });
  return values===0 && words>=1;
}

/* THE LOADING TABLE, READ THE WAY IT IS PRINTED.
   These tables are not laid out like the tables in an RFDS: the lines are evenly spaced, and the
   cells that describe a whole group — which centreline, which mount, whose equipment — are printed
   ONCE against the middle of the group and left blank on every other line. A reader that tries to
   find where one row ends and the next begins has nothing to go on, and the generic one (which looks
   for a bimodal gap in the line spacing) swallowed the whole table as a single row.

   So each printed LINE is a row here, exactly as the page shows it, and a cell the page left blank is
   shown blank. That is both easier to read against the page and safer to write back from: a redline
   lands on the line it was edited on. */
/* 6i1 — ONE BLOCK OF A TABLE, READ. Given the header lines and the body lines of a table on one page,
   this resolves the columns and produces a row per printed line. It was the inside of the loading-table
   reader; it is a function of its own now because the same work reads ANY table — a construction
   drawing's schedule, a submittal's parts list — once something else has found where the table is. */
function maTableBlock(pi,hdrLines,body,columns,colSpan,rows){
  const hdrItems=[].concat(...hdrLines.map(l=>l.items));
  const dataItems=[].concat(...body.map(l=>l.items));
  const cols=tableColumns(dataItems,hdrItems);
  if(!cols||!cols.defs||cols.defs.length<2){
    LOG("Analyze MA: could not resolve the columns on page",pi+1); return;
  }
  cols.defs.forEach(d=>{
    /* a header that wrapped comes back with its lines joined; keep it short enough to read */
    /* the heading that sits above the table gets swept into the first column's name, because it is
       printed in the same band; it is not part of the column */
    d.name=String(d.name||"").replace(/\s+/g," ")
            .replace(/^((antenna|equipment|mount|final|proposed|existing)\s+)*loading\s*(configuration|table|schedule)?\s*:?\s*/i,"")
            .trim().slice(0,46)||("Column "+(columns.length+1));
    let nm=d.name, k=2;
    while(columns.indexOf(nm)>=0&&colSpan[nm]&&Math.abs(colSpan[nm].from-d.from)>0.01){ nm=d.name+" ("+(k++)+")"; }
    d.name=nm;
    if(columns.indexOf(nm)<0)columns.push(nm);
    if(!colSpan[nm])colSpan[nm]={from:d.from,to:Math.min(1,d.to)};
  });
  /* one row per printed line */
  body.forEach(l=>{
    const cells={}, g={};
    let any=false;
    l.items.forEach(t=>{
      const s2=String(t.str).trim(); if(!s2)return;
      const mid=t.nx+(t.nw||0)/2;
      let d=cols.defs.find(c=>mid>=c.from&&mid<c.to);
      if(!d){
        const l0=t.nx, r0=t.nx+(t.nw||0);
        let bo=0; cols.defs.forEach(c=>{ const ov=Math.min(r0,c.to)-Math.max(l0,c.from); if(ov>bo){bo=ov;d=c;} });
      }
      if(!d)return;
      cells[d.name]=cells[d.name]?(cells[d.name]+" "+s2):s2;
      const r2=t.nx+(t.nw||0), b2=t.ny+(t.nh||0);
      if(!g[d.name])g[d.name]={nx:t.nx,ny:t.ny,nw:t.nw||0,nh:t.nh||0,x2:r2,y2:b2,lines:1,topY:t.ny,topR:r2};
      else{ const q=g[d.name];
        q.nx=Math.min(q.nx,t.nx); q.ny=Math.min(q.ny,t.ny);
        q.x2=Math.max(q.x2,r2); q.y2=Math.max(q.y2,b2); q.nw=q.x2-q.nx;
        q.topR=Math.max(q.topR,r2); }
      any=true;
    });
    if(!any)return;
    const h=Math.max(...l.items.map(t=>t.nh||0.01));
    rows.push({page:pi,cells,_orig:Object.assign({},cells),_g:g,_rowY:l.y-h*0.62,_rowH:h});
  });
}

/* 6i1 — ANY TABLE, ON THE PAGE YOU ARE LOOKING AT.
   Ced: "also read the table in construction drawings, not only in mount analysis. make sure it is
   offline and no ai is going to be used."

   The loading-table reader knows what a mount analysis looks like — the headings it prints, the words
   that end the table — and on a drawing sheet it knows nothing at all. A construction drawing's
   schedules have no vocabulary in common with it and no two are worded alike, so there is nothing to
   recognise. What there IS, on every one of them, is SHAPE: a run of printed lines, each holding the
   same handful of values at the same handful of x positions, under one line that names them.

   That is what this finds, with arithmetic and nothing else: no model, no service, no network. It
   groups the page's text into lines (the same `pageLines` the rest of the tool uses), keeps the ones
   carrying three or more separate values, takes the longest unbroken run of them, and hands the first
   line of the run to `maTableBlock` as the header and the rest as the body. The column resolution that
   follows is the same code the loading table goes through, so an edited cell is written back to the
   sheet exactly the way a corrected centreline is. */
function maTableRun(pi){
  const lines=pageLines(pi);
  if(!lines||lines.length<3)return null;
  /* a line is a candidate row when it carries three or more values with real gaps between them */
  const wide=l=>{
    const it=(l.items||[]).filter(t=>String(t.str).trim().length);
    if(it.length<3)return 0;
    const xs=it.map(t=>t.nx).sort((a,b)=>a-b);
    let gaps=0;
    for(let i=1;i<xs.length;i++)if(xs[i]-xs[i-1]>0.012)gaps++;
    return (gaps>=2)?it.length:0;
  };
  const score=lines.map(wide);
  /* the longest run, allowing ONE blank or narrow line inside it — a table is routinely broken by a
     sub-heading or a rule that carries no text */
  let best=null, i=0;
  while(i<lines.length){
    if(!score[i]){ i++; continue; }
    let j=i, miss=0, last=i;
    while(j+1<lines.length){
      if(score[j+1]){ j++; last=j; miss=0; }
      else if(miss<1){ j++; miss++; }
      else break;
    }
    const run={from:i,to:last};
    if(!best||(run.to-run.from)>(best.to-best.from))best=run;
    i=last+1;
  }
  if(!best||best.to-best.from<2)return null;          /* a header and two rows, at least */
  return {hdr:[lines[best.from]], body:lines.slice(best.from+1,best.to+1).filter(l=>(l.items||[]).length)};
}
function maReadAnyTable(pi){
  if(pi==null)return null;
  const run=maTableRun(pi);
  if(!run||!run.body.length)return null;
  const columns=[], colSpan={}, rows=[];
  try{ maTableBlock(pi,run.hdr,run.body,columns,colSpan,rows); }catch(e){ LOG&&LOG("table read failed",e&&e.message); }
  if(!rows.length||columns.length<2)return null;
  MA_TABLE={columns,rows,colSpan,pages:[pi],generic:true};
  LOG("Read table:",rows.length,"line(s) ×",columns.length,"column(s) on page",pi+1);
  return MA_TABLE;
}
function maReadLoading(){
  const pages=maLoadingPages();
  if(!pages.length){
    /* 6i1 — no loading table in this document, so read whatever table is on the page in front of you */
    const pi=(typeof currentPageIdx==="function")?currentPageIdx():null;
    const any=maReadAnyTable(pi);
    if(any){
      setStatus(`Read the table on page ${pi+1} — ${any.rows.length} row${any.rows.length===1?"":"s"} `+
                `× ${any.columns.length} columns. Edit a cell and Redline the changes writes it back.`);
      return any;
    }
    MA_TABLE=null;
    setStatus("No table found on this page — scroll to the page with the table on it and try again.",true);
    return null;
  }
  const columns=[], colSpan={}, rows=[];
  pages.forEach(pi=>{
    const lines=pageLines(pi);
    let hi=-1;
    for(let i=0;i<lines.length;i++){ if(maLoadHeaderLine(lines[i])){ hi=i; break; } }
    if(hi<0){ LOG("Analyze MA: no header line on page",pi+1); return; }
    /* the whole header, which is usually two or three wrapped lines around the one that matched */
    let top=hi; while(top>0&&maIsHeaderLine(lines[top-1]))top--;
    let bot=hi; while(bot+1<lines.length&&maIsHeaderLine(lines[bot+1]))bot++;
    const hdrLines=lines.slice(top,bot+1);
    /* the body: everything below the header until the page's own footer */
    const body=[];
    for(let i=bot+1;i<lines.length;i++){
      const l=lines[i];
      const n=l.norm||"";
      if(/^page\d|^\d+of\d+$/.test(n))continue;
      /* a footer line runs the width of the page and reads as a sentence */
      if(n.length>90&&/(office|www\.|llc|inc\.|avenue|street|suite|@)/.test(n))break;
      if(/^(notes?|structureusages?|memberc|conclusion|recommend|towerloading|structuralrating)/.test(n))break;
      if(!(l.items||[]).length)continue;
      body.push(l);
    }
    if(!body.length){ LOG("Analyze MA: nothing under the header on page",pi+1); return; }
    maTableBlock(pi,hdrLines,body,columns,colSpan,rows);
  });
  if(!rows.length){
    MA_TABLE=null;
    setStatus("The loading table was found but could not be read — redline it by hand.",true);
    return null;
  }
  MA_TABLE={columns,rows,colSpan,pages};
  LOG("Analyze MA: read",rows.length,"line(s) ×",columns.length,"column(s) from page(s)",
      pages.map(p=>p+1).join(", "));
  return MA_TABLE;
}

/* Which cells the form has changed. */
function maTableEdits(){
  if(!MA_TABLE)return [];
  const out=[];
  MA_TABLE.rows.forEach((r,ri)=>{
    MA_TABLE.columns.forEach(c=>{
      const was=String((r._orig&&r._orig[c])!=null?r._orig[c]:"").trim();
      const now=String(r.cells[c]!=null?r.cells[c]:"").trim();
      if(now!==was)out.push({ri,col:c,was,now,row:r});
    });
  });
  return out;
}
/* Write the edits onto the page. A cell that was printed gets a redline covering it; a cell that was
   blank gets one placed in the column, on that row's line. */
function maApplyTable(){
  const edits=maTableEdits();
  if(!edits.length){ setStatus("Nothing has been changed in the table yet.",true); return 0; }
  let done=0, missed=0;
  _maQuiet=true;
  _azApplying=true;              /* so a second Apply updates its own marks instead of stacking them */
  try{
    historyBatch(()=>{
      edits.forEach(e=>{
        const r=e.row, pi=r.page;
        const box=r._g&&r._g[e.col];
        if(box){
          const P=S.pages[pi], pad=1.0/((P&&P.w1)||612);
          const id=stampWholeCell(pi,{nx:box.nx-pad,ny:box.topY!=null?box.topY:box.ny,
                                      nw:(box.topR!=null?box.topR:box.x2)-box.nx+pad*2,
                                      nh:box.nh||0.011,
                                      x2:box.x2+pad,y2:box.y2,
                                      topR:(box.topR!=null?box.topR:box.x2)+pad,
                                      topY:box.topY!=null?box.topY:box.ny,
                                      lines:box.lines||1,str:e.was},
                                   e.now,"center");
          const a=S.annos.find(z=>z.id===id);
          if(a){ a.maKind="loading"; a.onCell=true; a.orig=e.now; }
          done++;
        }else if(MA_TABLE.colSpan&&MA_TABLE.colSpan[e.col]&&r._rowY!=null){
          /* nothing was printed in this cell — put the value in the column, on this row's line */
          const sp=MA_TABLE.colSpan[e.col];
          const id=putRowCell(pi,sp.from,sp.to-sp.from,r._rowY,e.now,r._rowH||0.011);
          const a=S.annos.find(z=>z.id===id); if(a)a.maKind="loading";
          done++;
        }else missed++;
      });
    });
  } finally { _azApplying=false; _maQuiet=false; }
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  setStatus(`${done} correction${done===1?"":"s"} written onto the loading table`+
            (missed?` — ${missed} could not be placed (nothing printed in that cell)`:"")+".");
  LOG("Analyze MA: applied",done,"edit(s)",missed?("; "+missed+" unplaceable"):"");
  return done;
}

/* ---- the window ------------------------------------------------------------------------------- */
let _maAnalyzeCols=null;        /* which columns are shown; null = all of them */
function maAnalyzeOpen(){
  if(!S.doc){ setStatus("Open a PDF first.",true); return; }
  if(!MA_TABLE)maReadLoading();
  const m=$("#maAnalyze"); if(!m)return;
  m.classList.add("show");
  maAnalyzeRender();
}
function maAnalyzeClose(){ const m=$("#maAnalyze"); if(m)m.classList.remove("show"); }

function maAnalyzeRender(){
  const body=$("#maAzBody"); if(!body)return;
  body.innerHTML="";
  if(!MA_TABLE){
    body.appendChild(el("div","ma-empty",
      "No loading table could be read from this report. The table pages are found by their heading and "+
      "their column names; a report that words both differently has to be redlined by hand."));
    maAnalyzeFoot();
    return;
  }
  const cols=(_maAnalyzeCols&&_maAnalyzeCols.length)?_maAnalyzeCols:MA_TABLE.columns;

  /* which columns to show — a loading table can print a dozen and you correct three */
  const chips=el("div","az-chips");
  MA_TABLE.columns.forEach(c=>{
    const on=cols.indexOf(c)>=0;
    const b=el("button","az-chip"+(on?" on":""),maEsc(c));
    b.type="button";
    b.onclick=()=>{
      const cur=(_maAnalyzeCols&&_maAnalyzeCols.length)?_maAnalyzeCols.slice():MA_TABLE.columns.slice();
      const i=cur.indexOf(c);
      if(i>=0)cur.splice(i,1); else cur.splice(MA_TABLE.columns.indexOf(c),0,c);
      _maAnalyzeCols=cur.length?cur:null;
      maAnalyzeRender();
    };
    chips.appendChild(b);
  });
  body.appendChild(chips);

  const wrap=el("div","az-tablewrap");
  const tbl=el("table","az-table");
  const thead=el("thead");
  const hr=el("tr");
  hr.appendChild(el("th","pg","Pg"));
  cols.forEach(c=>hr.appendChild(el("th",null,maEsc(c))));
  thead.appendChild(hr); tbl.appendChild(thead);
  const tb=el("tbody");
  MA_TABLE.rows.forEach((r,ri)=>{
    const tr=el("tr");
    tr.appendChild(el("td","pg",String((r.page!=null?r.page:0)+1)));
    cols.forEach(c=>{
      const td=el("td");
      const was=String((r._orig&&r._orig[c])!=null?r._orig[c]:"");
      const inp=el("input");
      inp.type="text"; inp.value=String(r.cells[c]!=null?r.cells[c]:"");
      inp.spellcheck=false;
      inp.title=was?("printed: "+was):"nothing printed in this cell";
      if(!(r._g&&r._g[c]))inp.classList.add("blank");
      inp.oninput=()=>{
        r.cells[c]=inp.value;
        const changed=inp.value.trim()!==was.trim();
        inp.classList.toggle("edited",changed);
        maAnalyzeFoot();
      };
      if(String(r.cells[c]||"").trim()!==was.trim())inp.classList.add("edited");
      td.appendChild(inp);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  body.appendChild(wrap);
  maAnalyzeFoot();
}
function maAnalyzeFoot(){
  const f=$("#maAzCount"); if(!f)return;
  const n=maTableEdits().length;
  f.textContent=MA_TABLE
    ? `${MA_TABLE.rows.length} rows · ${n} change${n===1?"":"s"} to write`
    : "nothing read";
  const b=$("#maAzApply"); if(b)b.disabled=!n;
}
