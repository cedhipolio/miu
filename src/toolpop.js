/* =================================================================================================
   TOOL PROPERTIES — one panel per tool
   =================================================================================================
   Ced: "instead of having a style category, just have it within the redline tools with a dropdown
   style/prompt like the example i showed you. put an arrow on the lower right of the icon. and the
   style again should vary from tools."

   So the ribbon's Style group is gone. Every button in Redline tools carries a ▾ in its lower-right
   corner, and pressing it opens THAT TOOL'S properties — the panel Ced showed from Bluebeam, and a
   different panel for each tool, because a rectangle and a line have nothing in common to set.

   How it fits the rest of the app: the seven fields that already had ribbon inputs (`#c_text`,
   `#c_sw`, `#c_bg`, `#c_fill`, `#c_fop`, `#c_pt`, `#c_font`) are still the way a style reaches a new
   mark — the panel writes into them and fires `input`, which is the same event the ribbon fired, so
   `maRememberToolStyle` and `maRestyleSelection` need no changes. Everything the panels add on top of
   those — line endings, line style, hatch, decorations, ink opacity, highlight — has no input of its
   own and is written straight onto the tool's style, then pushed at the selection the same way.
   ================================================================================================= */

/* The nine the panels offer, plus the picker behind "…". Taken off the screenshots, in their order. */
const TP_COLORS=[
  {v:"#fa3237",n:"Red"},   {v:"#2f6fe0",n:"Blue"},  {v:"#000000",n:"Black"},
  {v:"#ffffff",n:"White"}, {v:"#12b886",n:"Green"}, {v:"#8b5cf6",n:"Purple"},
  {v:"#f59f00",n:"Orange"},{v:"#22b8cf",n:"Cyan"},  {v:"#f72585",n:"Magenta"},
  {v:"#ffd43b",n:"Yellow"}
];

/* Which panel a tool gets, and what it is called at the top of it. */
const TP_SPEC={
  select:   {title:"Select",         form:"text",   preview:"text"},
  redline:  {title:"Redline",        form:"text",   preview:"text"},
  text:     {title:"Text",           form:"text",   preview:"text"},
  fix:      {title:"Strike & write", form:"text",   preview:"text"},
  box:      {title:"Rectangle",      form:"shape",  preview:"rect"},
  circle:   {title:"Ellipse",        form:"shape",  preview:"ellipse"},
  callout:  {title:"Callout",        form:"callout",preview:"callout"},
  /* 6gd — a pasted snapshot: its frame and its opacity, nothing else to set */
  snapshot: {title:"Snapshot",       form:"image",  preview:"image"},
  line:     {title:"Line",           form:"stroke", preview:"line"},
  /* 6gg — a LENGTH is a stroke with a reading on it: the stroke's own panel, plus the scale and the
     units the reading is written in */
  dim:      {title:"Length",         form:"stroke", preview:"arrow", dim:true},
  arrow:    {title:"Arrow",          form:"stroke", preview:"arrow"},
  poly:     {title:"Polyline",       form:"stroke", preview:"arrow", fill:true},
  /* 6fh — a strike is a rule through something, never a pointer at it, so these three are held plain
     at both ends and are not offered the choice. */
  cross:    {title:"Strike text",    form:"stroke", preview:"line", noEnds:true},
  strikerow:{title:"Strike row",     form:"stroke", preview:"line", noEnds:true},
  crossout: {title:"Cross out",      form:"stroke", preview:"line", noEnds:true}
};

/* The tick marks under each slider, straight off the screenshots. */
/* 6ha — Ced: "add more smaller font sizes." A mount analysis is redlined into printed tables set at
   5 to 7 points, and the rule started at 8 — so the sizes you actually need were the ones you had to
   type. 3 and 5 are on the rule now, and the bar itself goes down to 2pt. */
const TP_SIZE_TICKS=[3,5,8,10,12,16,20,42,64];
/* 6gt — 0.5 is on the rule now. Sub-point weights were reachable only by dragging the very left of a
   log bar or typing a number, which is why "less than 1 pt" read as broken before it even got to the
   renderer. */
const TP_WIDTH_TICKS=[0.5,1,2,3,6,10,50];
/* The faces on the chips. Only the standard PDF families can be written without embedding anything,
   so the chips are the families this tool can actually produce, each drawn in its own face. */
const TP_FONT_CHIPS=[
  {k:"arial",      label:"Arial"},
  {k:"arialbold",  label:"Arial Bold"},
  {k:"times",      label:"Times New Roman"},
  {k:"courier",    label:"Courier New"},
  /* 6hm — the bundled geometric face. It is the one family here that is embedded in the exported
     file, so it reads the same on a machine that does not have it. */
  {k:"jost",       label:"Jost", hint:"A geometric sans in the Century Gothic manner — bundled with "+
                                      "the tool and written into the exported file, so it looks the "+
                                      "same wherever the PDF is opened"},
  /* 6n1 — Ced: "add more font options." Two more bundled families, each for a job: Carlito is
     Calibri's measure, Archivo Narrow is the one that fits a long correction into a short cell.
     The B and I chips swap the cut, so only the regular of each family is a chip here. */
  {k:"carlito",    label:"Carlito", hint:"Calibri's face and Calibri's measure — what the Word and "+
                                      "Excel paperwork around these reports is set in. Bundled with "+
                                      "the tool and written into the exported file"},
  {k:"narrow",     label:"Narrow",  hint:"A condensed sans — a corrected value that will not fit a "+
                                      "table cell in Arial fits in this at the same size. Bundled "+
                                      "with the tool and written into the exported file"}
];
/* 6hc — the dash rhythm no longer follows the weight, so the LENGTH is the choice. Six lengths,
   shortest first, then the two dash-dot rules. */
const TP_DASHES=[
  {k:"solid",     t:"Solid"},
  {k:"dot",       t:"Dotted"},
  {k:"finedash",  t:"Fine dash"},
  {k:"dash",      t:"Dashed"},
  {k:"longdash",  t:"Long dash"},
  {k:"xlongdash", t:"Extra long"},
  {k:"dashdot",   t:"Dash-dot"},
  {k:"dashdotdot",t:"Dash-dot-dot"}
];
const TP_LPATS=[
  {k:"straight",t:"Straight"},
  {k:"wave",    t:"Wave"},
  {k:"zigzag",  t:"Zigzag"},
  {k:"saw",     t:"Sawtooth"},
  {k:"cloud",   t:"Cloud"}
];
/* 6fd — the order is the GRID's order, four to a row, and Ced picked the second one on the bottom
   row for the Arrow tool's own tip. So the solid arrowhead sits there, and it is what Arrow defaults
   to; the open chevron takes the first place beside it. */
/* 6ga — Ced: "add more line start and endings." Thirteen, in the order of the grid he sent: the plain
   end, the three shapes, then the arrows — closed, open and half — each with its reverse, and the two
   ticks. */
const TP_ENDS=[
  {k:"",        t:"None"},
  {k:"butt",    t:"Butt"},
  {k:"square",  t:"Square"},
  {k:"diamond", t:"Diamond"},
  {k:"circle",  t:"Circle"},
  {k:"ocircle", t:"Open circle"},
  {k:"arrow",   t:"Arrow"},
  {k:"oarrow",  t:"Open arrow"},
  {k:"harrow",  t:"Half arrow"},
  {k:"rarrow",  t:"Reverse arrow"},
  {k:"roarrow", t:"Reverse open arrow"},
  {k:"hrarrow", t:"Reverse half arrow"},
  {k:"slash",   t:"Slash"}
];
const TP_PATS=[
  {k:"",     t:"Solid"},
  {k:"dots", t:"Dot grid"},
  {k:"finedots",t:"Fine dot grid"},
  {k:"cross",t:"Crosshatch"},
  {k:"dense",t:"Dense crosshatch"},
  {k:"diag", t:"Diagonal"},
  {k:"rdiag",t:"Reverse diagonal"},
  {k:"vert", t:"Vertical"},
  {k:"horz", t:"Horizontal"},
  {k:"grid", t:"Grid"},
  {k:"wide", t:"Wide diagonal"}
];

/* ---- reading and writing: the TOOL, or the SELECTION ---------------------------------------------
   6fe — the panel has two jobs and used to do one and a half.

   Opened from a tool's ▾ it edits THAT TOOL: what the next mark drawn with it will look like, kept
   against that tool alone and never carried to another.

   Opened from the selection bar's "Edit properties" it edits WHAT IS SELECTED, live — every control
   shows what the selected mark actually carries and every change lands on it as you make it, without
   touching any tool's remembered style. That is what "changing properties should also change the
   properties of the selected shape in realtime" asks for, and it is the half that was missing: before,
   the panel always showed the TOOL, so opening it on a blue box drawn an hour ago showed red.
   ------------------------------------------------------------------------------------------------- */
let TP_TOOL="redline";                 /* whose properties are on screen */
let TP_TARGET="stroke";                /* which of the two colours the swatches are editing */
let TP_SEL=false;                      /* true = bound to the selection rather than to the tool */

/* The seven that still have a hidden ribbon input behind them; everything else lives only on the
   mark or on the tool's style. */
const TP_FIELD_INPUT={col:"c_text", sw:"c_sw", bg:"c_bg", fill:"c_fill",
                      fillOp:"c_fop", size:"c_pt", font:"c_font"};
/* What a mark can carry, and what a stroke can. A key outside these is ignored for that kind. */
const TP_ANNO_KEYS=["col","colOp","sw","dash","fill","fillOp","bg","bgNone","font","size",
                    "uline","strikeout","align","valign","pat","patCol","patScale","patRot","patOp","hl",
                    /* 6he — tracking and leading travel with everything else a mark is styled by */
                    "lsp","lnsp",
                    /* 6hp — and the pattern a shape's rule is drawn with */
                    "lpat",
                    /* 6ht — and how its lines break */
                    "wrapMode"];
const TP_LINE_KEYS=["col","colOp","sw","dash","lpat","le0","le1","leSz","join","hl",
                    /* 6gg — a measurement's own scale, units and rounding */
                    "dimScale","dimUnit","dimPrec"];

function tpSelMarks(){ try{ return maSelectedMarks(); }catch(e){ return {annos:[],lines:[]}; } }
function tpHasSel(){ const s=tpSelMarks(); return s.annos.length+s.lines.length; }

/* What the panel is showing. In selection mode that is the first selected mark's own look, with the
   tool's style standing in for anything the mark does not carry. */
function tpStyle(){
  const tool=MA_TOOL_STYLES[TP_TOOL]||MA_TOOL_DEFAULTS[TP_TOOL]||MA_TOOL_DEFAULTS.redline;
  if(!TP_SEL)return tool;
  const s=tpSelMarks(), o=s.annos[0]||s.lines[0];
  if(!o)return tool;
  const own={};
  /* 6gj — a MEASUREMENT is one mark made of two: the run carries the stroke and the reading carries
     the words, and its panel shows both. Read the reading first and let the run override, so a colour
     set on the run wins and the font and size come from the reading. */
  const dl=(s.lines||[]).find(z=>z.maKind==="dim");
  if(dl){
    const lab=(S.annos||[]).find(z=>z.id===dl.dimFor);
    if(lab)TP_ANNO_KEYS.forEach(k=>{ if(lab[k]!=null)own[k]=lab[k]; });
    TP_LINE_KEYS.forEach(k=>{ if(dl[k]!=null)own[k]=dl[k]; });
    const de=endsOf(dl); own.le0=de[0]; own.le1=de[1];
    return Object.assign({},tool,own);
  }
  (s.annos.length?TP_ANNO_KEYS:TP_LINE_KEYS).forEach(k=>{ if(o[k]!=null)own[k]=o[k]; });
  if(s.lines.length&&!s.annos.length){ const e=endsOf(o); own.le0=e[0]; own.le1=e[1]; }
  return Object.assign({},tool,own);
}

/* Every write from a panel happens with the panel's own tool standing in for the picked one, so a
   change made in Box's panel lands on Box even while the Line tool is up. */
function tpWith(fn){
  const had=MA_TOOL_OVERRIDE; MA_TOOL_OVERRIDE=TP_TOOL;
  try{ return fn(); } finally { MA_TOOL_OVERRIDE=had; }
}

/* A slider dragged across its whole travel fires a hundred times. One undo step per drag, not a
   hundred: the first write in a burst pushes history and the rest ride on it. */
let _tpHistAt=0;
function tpHist(){
  const now=Date.now();
  if(now-_tpHistAt>700){ try{ pushHistory(); }catch(e){} }
  _tpHistAt=now;
}

/* Put one property where it belongs. This is the ONLY way the panels write anything. */
function tpApply(key,value){
  if(TP_SEL&&tpHasSel())return tpApplySel(key,value);
  const id=TP_FIELD_INPUT[key];
  if(id){
    const f=document.getElementById(id);
    /* v62 — the ribbon's fields are shared by every tool and hold whichever tool was last shown. A
       field write is remembered as the WHOLE set of fields (maStyleNow), so if another tool had been
       picked up since this panel opened, its colour, size and font were copied into this one. The
       panel's own tool is put into the fields for the write and the tool in the hand put back after. */
    const was=(typeof MA_STYLE_TOOL!=="undefined")?MA_STYLE_TOOL:null;
    const swap=was&&was!==TP_TOOL;
    if(f)tpWith(()=>{
      if(swap)maShowToolStyle(TP_TOOL);
      f.value=(key==="fillOp")?Math.round(value*100):value;
      f.dispatchEvent(new Event("input",{bubbles:true}));
      f.dispatchEvent(new Event("change",{bubbles:true}));
    });
    if(swap){ try{ maShowToolStyle(was); }catch(e){} }
  }else{
    MA_TOOL_STYLES[TP_TOOL]=Object.assign({},MA_TOOL_STYLES[TP_TOOL]||{},{[key]:value});
    maSaveToolStyles();
    /* the tool's panel still restyles a selection, which is how it has always behaved */
    try{ tpWith(()=>{ const n=maRestyleSelection(key); if(n)setStatus(`Restyled ${n} mark${n===1?"":"s"}.`); }); }catch(e){}
  }
  tpRender();
}
/* …and the same property straight onto what is selected, touching no tool. */
function tpApplySel(key,value){
  const s=tpSelMarks(); if(!s.annos.length&&!s.lines.length)return;
  tpHist();
  if(TP_ANNO_KEYS.indexOf(key)>=0)s.annos.forEach(a=>{ a[key]=value; });
  if(TP_LINE_KEYS.indexOf(key)>=0)s.lines.forEach(l=>{ l[key]=value; try{syncArrowFlag(l);}catch(e){} });
  /* 6gg — a measurement's READING is part of the measurement: a text property set on the run (its
     colour, its size, its face) lands on the label the run owns, so restyling a length restyles the
     whole of it rather than half. */
  if(TP_ANNO_KEYS.indexOf(key)>=0)s.lines.forEach(l=>{ if(l.dimFor==null)return;
    const lab=(S.annos||[]).find(z=>z.id===l.dimFor); if(lab)lab[key]=value; });
  try{ layoutAnnos(); drawAllLines(); updateRail(); }catch(e){}
  setStatus(`Changed ${s.annos.length+s.lines.length} selected mark`+
            ((s.annos.length+s.lines.length)===1?"":"s")+".");
  tpRender();
}
/* The two names the panels were written against, both now one line over `tpApply`. */
function tpSet(key,value){ tpApply(key,value); }
function tpPut(id,value){
  const key=Object.keys(TP_FIELD_INPUT).find(k=>TP_FIELD_INPUT[k]===id);
  if(!key)return;
  tpApply(key,(key==="fillOp")?(parseFloat(value)/100):value);
}

/* ---- the little pieces the panels are made of -------------------------------------------------- */
function tpEl(tag,cls,txt){ const n=document.createElement(tag); if(cls)n.className=cls;
  if(txt!=null)n.textContent=txt; return n; }

/* the header: the tool's name, and the four buttons the screenshot has in the corner */
function tpHead(title){
  const h=tpEl("div","tp-head");
  const l=tpEl("div","tp-headl");
  l.appendChild(tpEl("div","tp-title",title));
  l.appendChild(tpEl("div","tp-sub",TP_SEL?("Editing "+tpHasSel()+" selected mark"+(tpHasSel()===1?"":"s")):"Tool properties"));
  h.appendChild(l);
  const acts=tpEl("div","tp-acts");
  const mk=(glyph,title,fn,on)=>{ const b=tpEl("button","tp-act"+(on?" on":""),glyph);
    b.type="button"; b.title=title; b.onclick=fn; acts.appendChild(b); return b; };
  mk("↺","Put this tool back to its defaults",()=>{
    MA_TOOL_STYLES[TP_TOOL]=Object.assign({},MA_TOOL_DEFAULTS[TP_TOOL]||MA_TOOL_DEFAULTS.redline);
    maSaveToolStyles(); maShowToolStyle(TP_TOOL); tpRender(); toast("Tool reset");
  });
  mk("⤾","Use this tool's style for every tool",()=>{
    const st=Object.assign({},MA_TOOL_STYLES[TP_TOOL]);
    Object.keys(MA_TOOL_STYLES).forEach(k=>{ MA_TOOL_STYLES[k]=Object.assign({},MA_TOOL_STYLES[k],st); });
    maSaveToolStyles(); maShowToolStyle(S.mode); toast("Applied to every tool");
  });
  mk("✕","Close",()=>tpClose());
  h.appendChild(acts);
  return h;
}

/* the sample at the top of every panel, drawn with what the tool is actually set to */
function tpPreview(kind){
  const st=tpStyle();
  const wrap=tpEl("div","tp-prev");
  const ink=_rgbaOf(st.col||"#fa3237",(st.colOp!=null?st.colOp:1));
  if(kind==="image"){
    const b=tpEl("div","tp-prevshape");
    b.style.background="linear-gradient(135deg,#e9edf3 0 48%,#cfd8e6 48% 100%)";
    b.style.borderRadius="3px";
    const fw=Math.max(0,st.sw!=null?st.sw:1);
    b.style.border=fw>0?(fw+"px "+borderStyleOf(st)+" "+ink):"0";
    b.style.opacity=String(st.fillOp!=null?st.fillOp:1);
    wrap.appendChild(b);
    return wrap;
  }
  if(kind==="text"||kind==="callout"){
    const b=tpEl("div","tp-prevtext",kind==="callout"?"Callout text":"Sample Text");
    b.style.color=ink;
    b.style.fontFamily=(MARK_FONTS[st.font]||MARK_FONTS.arial).css;
    b.style.fontWeight=(MARK_FONTS[st.font]||{}).weight||"400";
    b.style.fontStyle=(MARK_FONTS[st.font]||{}).style||"normal";
    b.style.textDecoration=textDecoOf(st);
    b.style.background=_rgbaOf(kind==="callout"?(st.fill||"#ffffff"):(st.bg||"#ffffff"),
                               (st.fillOp!=null?st.fillOp:1));
    b.style.border=(kind==="callout")
      ? Math.max(1,st.sw||1.5)+"px "+borderStyleOf(st)+" "+ink : "0";
    b.style.textAlign=st.align||"center";
    wrap.appendChild(b);
    if(kind==="callout"){ const t=tpEl("div","tp-prevlead"); t.style.borderColor=ink; wrap.appendChild(t); }
    return wrap;
  }
  if(kind==="rect"||kind==="ellipse"){
    const b=tpEl("div","tp-prevshape");
    b.style.borderRadius=(kind==="ellipse")?"50%":"3px";
    b.style.border=Math.max(1,st.sw||1.5)+"px "+borderStyleOf(st)+" "+ink;
    b.style.backgroundColor=_rgbaOf(st.fill||"#ffffff",(st.fillOp!=null?st.fillOp:1));
    b.style.backgroundImage=patCss(st);
    b.style.backgroundSize=patCssSize(st);        /* 6g9 — the dot lattice tiles here too */
    b.style.backgroundRepeat="repeat";
    wrap.appendChild(b);
    return wrap;
  }
  /* a line or an arrow, drawn as the real thing so the endings and the ripple show */
  const NS="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox","0 0 260 44"); svg.setAttribute("class","tp-prevline");
  const pts=decoratePts(st,[[16,22],[244,22]],Math.max(1,st.sw||1.5));
  const ln=document.createElementNS(NS,"polyline");
  ln.setAttribute("points",pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" "));
  ln.setAttribute("fill","none"); ln.setAttribute("stroke",ink);
  ln.setAttribute("stroke-width",Math.max(1,(st.sw||1.5)*1.4));
  ln.setAttribute("stroke-linecap","round"); ln.setAttribute("stroke-linejoin","round");
  /* 6hc — the preview is drawn in its own 260-unit space, so the dash table's points are scaled by
     the same 1.4 the width is, never by the page's zoom. */
  const d=dashCss(st,Math.max(1,(st.sw||1.5)*1.4),1.4); if(d)ln.setAttribute("stroke-dasharray",d);
  svg.appendChild(ln);
  const [e0,e1]=endsOf(st);
  const head=Math.max(8,(st.sw||1.5)*4);
  [[e1,pts[pts.length-2],pts[pts.length-1]],[e0,pts[1],pts[0]]].forEach(([k,f,t])=>{
    const sp=endShapePath(k,f[0],f[1],t[0],t[1],head); if(!sp)return;
    const p=document.createElementNS(NS,"path"); p.setAttribute("d",sp.d);
    if(sp.fill){ p.setAttribute("fill",ink); p.setAttribute("stroke","none"); }
    else { p.setAttribute("fill","none"); p.setAttribute("stroke",ink);
           p.setAttribute("stroke-width",Math.max(1,(st.sw||1.5)*1.4)); }
    svg.appendChild(p);
  });
  wrap.appendChild(svg);
  return wrap;
}

/* the Border|Fill (or Text|Fill) pair that decides which colour the swatches below are editing */
function tpTargets(a,b){
  const row=tpEl("div","tp-targets");
  const st=tpStyle();
  const mk=(key,label,swatchCol)=>{
    const btn=tpEl("button","tp-target"+(TP_TARGET===key?" on":"")); btn.type="button";
    const chip=tpEl("span","tp-chip");
    chip.style.background=swatchCol;
    if(key==="stroke"){ chip.style.background="transparent"; chip.style.border="2px solid "+(st.col||"#fa3237"); }
    btn.appendChild(chip); btn.appendChild(tpEl("span",null,label));
    btn.onclick=()=>{ TP_TARGET=key; tpRender(); };
    row.appendChild(btn);
  };
  mk("stroke",a,st.col||"#fa3237");
  mk("fill",b,_rgbaOf(st.fill||"#ffffff",(st.fillOp!=null?st.fillOp:1)));
  return row;
}

/* =================================================================================================
   6fe — THE COLOURS
   The swatch row, with white among the defaults, and a picker you can DRAG rather than the operating
   system's colour dialog: a saturation/value square and a hue strip, both of which follow the pointer,
   plus the hex if you know it. It is built here rather than borrowed because `<input type=color>`
   opens a native window that cannot be dragged inside the page and, in a sandboxed frame, sometimes
   does not open at all.
   ================================================================================================= */
function tpHexToHsv(hex){
  const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex||"#ff0000"));
  let r=250,g=50,b=55;
  if(m){ r=parseInt(m[1],16); g=parseInt(m[2],16); b=parseInt(m[3],16); }
  r/=255; g/=255; b/=255;
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  let h=0;
  if(d){ if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4; }
  h=Math.round(h*60); if(h<0)h+=360;
  return {h, s:mx?d/mx:0, v:mx};
}
function tpHsvToHex(h,sa,v){
  h=((h%360)+360)%360;
  const c=v*sa, x=c*(1-Math.abs(((h/60)%2)-1)), m=v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x;} else if(h<120){r=x;g=c;} else if(h<180){g=c;b=x;}
  else if(h<240){g=x;b=c;} else if(h<300){r=x;b=c;} else {r=c;b=x;}
  const to=n=>("0"+Math.round((n+m)*255).toString(16)).slice(-2);
  return "#"+to(r)+to(g)+to(b);
}
/* Anything that has to follow the pointer once it is pressed, in one place. */
function tpDragArea(el,onAt){
  const at=e=>{
    const r=el.getBoundingClientRect();
    onAt(Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),
         Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)));
  };
  el.addEventListener("pointerdown",e=>{
    e.preventDefault(); e.stopPropagation();
    try{ el.setPointerCapture(e.pointerId); }catch(_){}
    tpLiveStart(); at(e);
    const mv=ev=>at(ev);
    const up=()=>{ el.removeEventListener("pointermove",mv); window.removeEventListener("pointerup",up);
                   tpLiveEnd(); };
    el.addEventListener("pointermove",mv); window.addEventListener("pointerup",up);
  });
}
let _tpPick=null;
function tpPickerClose(){ if(_tpPick){ _tpPick.remove(); _tpPick=null; } }
function tpPicker(anchor,current,onPick){
  tpPickerClose();
  let {h,s:sa,v}=tpHexToHsv(current);
  const box=tpEl("div","tp-picker");
  const sv=tpEl("div","tp-sv");
  const svDot=tpEl("i","tp-svdot"); sv.appendChild(svDot);
  const hue=tpEl("div","tp-hue");
  const hueDot=tpEl("i","tp-huedot"); hue.appendChild(hueDot);
  const foot=tpEl("div","tp-pkfoot");
  const prev=tpEl("span","tp-pkprev");
  const hex=document.createElement("input"); hex.type="text"; hex.className="tp-pkhex"; hex.spellcheck=false;
  foot.appendChild(prev); foot.appendChild(hex);
  box.appendChild(sv); box.appendChild(hue); box.appendChild(foot);
  document.body.appendChild(box);

  const paint=(fire)=>{
    const col=tpHsvToHex(h,sa,v);
    sv.style.background=
      "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, "+tpHsvToHex(h,1,1)+")";
    svDot.style.left=(sa*100)+"%"; svDot.style.top=((1-v)*100)+"%";
    svDot.style.background=col;
    hueDot.style.left=(h/360*100)+"%";
    prev.style.background=col;
    if(document.activeElement!==hex)hex.value=col;
    if(fire)onPick(col);
  };
  tpDragArea(sv,(fx,fy)=>{ sa=fx; v=1-fy; paint(true); });
  tpDragArea(hue,(fx)=>{ h=fx*360; paint(true); });
  hex.addEventListener("input",()=>{
    if(/^#?[0-9a-f]{6}$/i.test(hex.value)){
      const c=hex.value[0]==="#"?hex.value:("#"+hex.value);
      const k=tpHexToHsv(c); h=k.h; sa=k.s; v=k.v; paint(true);
    }
  });
  paint(false);
  const r=anchor.getBoundingClientRect();
  box.style.left=Math.max(8,Math.min(window.innerWidth-box.offsetWidth-8,r.left-60))+"px";
  box.style.top=Math.max(8,Math.min(window.innerHeight-box.offsetHeight-8,r.bottom+6))+"px";
  _tpPick=box;
  return box;
}

function tpSwatches(withNone){
  const st=tpStyle();
  const row=tpEl("div","tp-swatches");
  const isText=(TP_SPEC[TP_TOOL].form==="text");
  const cur=(TP_TARGET==="fill")
    ? (isText?(st.bg||"#ffffff"):(st.fill||"#ffffff"))
    : (st.col||"#fa3237");
  const setCol=v=>{
    if(TP_TARGET==="fill"){ if(isText)tpApply("bg",v); else tpApply("fill",v); }
    else tpApply("col",v);
  };
  if(withNone){
    const off=((st.fillOp!=null?st.fillOp:1)<=0&&TP_TARGET==="fill")||
              ((st.colOp!=null?st.colOp:1)<=0&&TP_TARGET==="stroke");
    const b=tpEl("button","tp-sw tp-none"+(off?" on":""));
    b.type="button"; b.title=(TP_TARGET==="fill")?"No fill":"No line";
    b.onclick=()=>{ if(TP_TARGET==="fill")tpApply("fillOp",0); else tpApply("colOp",0); };
    row.appendChild(b);
  }
  TP_COLORS.forEach(c=>{
    const b=tpEl("button","tp-sw"+(String(cur).toLowerCase()===c.v?" on":"")+(c.v==="#ffffff"?" tp-white":""));
    b.type="button"; b.style.background=c.v; b.title=c.n;
    b.onclick=()=>setCol(c.v);
    row.appendChild(b);
  });
  const more=tpEl("button","tp-sw tp-more","…"); more.type="button"; more.title="Any other colour";
  more.onclick=e=>{ e.stopPropagation(); tpPicker(more,cur,setCol); };
  row.appendChild(more);
  return row;
}

/* =================================================================================================
   6fe — THE SLIDERS
   Ced: "make the sliders on the tool properties more seamless, also make sure they are applied or
   working correctly."

   Three things were wrong with them. The track was a bare grey bar with no sense of how far along it
   was; the number beside it was a <select> of presets, so a value between two presets could not be
   set or even read back; and the whole travel was linear, which on a 0.25–50pt width slider meant
   every useful value lived in the first 2% of the bar and the thumb could not resolve them.

   Now: the track fills as it goes, the number is typed as well as dragged, and a width or size slider
   is laid out on a LOG scale so 1pt, 2pt and 3pt are as far apart on the bar as 10, 20 and 30 are.
   Every move applies as it happens.
   ================================================================================================= */
function tpSlider(opts){
  const wrap=tpEl("div","tp-sliderrow");
  const col=tpEl("div","tp-slidercol");
  const lo=opts.min, hi=opts.max, logish=!!opts.log;
  /* the bar runs 0..1000 whatever the property is; the mapping either way lives here */
  const toBar=v=>{
    v=Math.max(lo,Math.min(hi,v));
    if(!logish)return (v-lo)/(hi-lo)*1000;
    const a0=Math.log(Math.max(lo,0.01)), a1=Math.log(hi);
    return (Math.log(Math.max(v,0.01))-a0)/(a1-a0)*1000;
  };
  const fromBar=t=>{
    t=Math.max(0,Math.min(1000,t))/1000;
    let v;
    if(!logish)v=lo+t*(hi-lo);
    else{ const a0=Math.log(Math.max(lo,0.01)), a1=Math.log(hi); v=Math.exp(a0+t*(a1-a0)); }
    const st=opts.step||1;
    return Math.max(lo,Math.min(hi,Math.round(v/st)*st));
  };
  const s=document.createElement("input");
  s.type="range"; s.min=0; s.max=1000; s.step=1; s.value=toBar(opts.value);
  s.className="tp-range"+(opts.ramp?" ramp":"");
  const paint=frac=>s.style.setProperty("--fill",(frac*100).toFixed(2)+"%");
  paint(toBar(opts.value)/1000);
  const ticks=tpEl("div","tp-ticks");
  (opts.ticks||[]).forEach(t=>{
    const sp=tpEl("span",null,String(t));
    sp.style.left=(toBar(t)/10).toFixed(2)+"%";
    /* a tick is a label AND a target: clicking one goes straight to that value */
    sp.title="Set "+t+(opts.suffix||"");
    sp.onclick=()=>{ set(t,true); };
    ticks.appendChild(sp);
  });
  col.appendChild(s); col.appendChild(ticks);
  wrap.appendChild(col);

  /* the number: typed, spun, or dragged — and it always shows the real value */
  const pill=tpEl("div","tp-pill tp-pillnum");
  const num=document.createElement("input");
  num.type="text"; num.inputMode="decimal"; num.className="tp-num";
  num.value=String(+(+opts.value).toFixed(2));
  const suf=tpEl("span","tp-suf",opts.suffix||"");
  pill.appendChild(num); if(opts.suffix)pill.appendChild(suf);

  /* 6gd — AND THE LIST OF VALUES IS BACK, BESIDE THE NUMBER.
     Ced: "have the dropdowns again beside the input so we can select values again." The old ribbon
     controls were <select>s of the sizes and weights anyone actually uses, and the v7 slider replaced
     them with a bar and a typed number — quicker to sweep, slower to hit 2pt exactly. The ▾ puts the
     list back without taking the bar away: the ticks, the presets and the bounds, each a click. */
  const caret=tpEl("button","tp-pilldrop","\u25be"); caret.type="button";
  caret.title="Pick a value";
  caret.onclick=ev=>{
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll(".tp-vmenu").forEach(n=>n.remove());
    const vals=[];
    const add=v=>{ v=Math.max(lo,Math.min(hi,+v));
      if(!vals.some(z=>Math.abs(z-v)<1e-9))vals.push(v); };
    (opts.choices||[]).forEach(add);
    (opts.ticks||[]).forEach(add);
    if(!vals.length){ add(lo); add((lo+hi)/2); add(hi); }
    add(lo); add(hi);
    vals.sort((m,n)=>m-n);
    const m=tpEl("div","sb-menu tp-vmenu");
    vals.forEach(v=>{
      const b=tpEl("button","sb-mi tp-vmi"+(Math.abs(v-cur)<1e-6?" on":""),
                   String(+(+v).toFixed(2))+(opts.suffix||""));
      b.type="button";
      /* v62 — Ced: "changing properties on dropdown should not exit the dropdown or properties tab
         immediately." The list stays open with the new value ticked, so a second pick is one click;
         it closes on a click away or Escape like every other menu. */
      b.onclick=ev=>{ ev.stopPropagation(); set(v,true);
        m.querySelectorAll(".tp-vmi.on").forEach(n=>n.classList.remove("on")); b.classList.add("on"); tpRender(); };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r=caret.getBoundingClientRect();
    m.style.left=Math.min(window.innerWidth-m.offsetWidth-8,Math.max(8,r.right-m.offsetWidth))+"px";
    m.style.top=Math.min(window.innerHeight-m.offsetHeight-8,r.bottom+4)+"px";
    const away=e2=>{ if(!m.contains(e2.target)){ m.remove();
      document.removeEventListener("pointerdown",away,true); } };
    setTimeout(()=>document.addEventListener("pointerdown",away,true),0);
  };
  pill.appendChild(caret);
  wrap.appendChild(pill);

  let cur=opts.value;
  function set(v,moveBar){
    v=Math.max(lo,Math.min(hi,v));
    cur=v;
    if(moveBar){ s.value=toBar(v); }
    paint(toBar(v)/1000);
    num.value=String(+(+v).toFixed(2));
    opts.onInput(v);
  }
  s.addEventListener("pointerdown",()=>tpLiveStart());
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>
    s.addEventListener(ev,()=>tpLiveEnd()));
  s.addEventListener("keydown",()=>{ tpLiveStart(); setTimeout(tpLiveEnd,400); });
  s.addEventListener("input",()=>set(fromBar(parseFloat(s.value)),false));
  num.addEventListener("change",()=>{ const v=parseFloat(num.value); if(!isNaN(v))set(v,true); });
  num.addEventListener("keydown",e=>{
    if(e.key==="Enter"){ e.preventDefault(); num.blur(); }
    else if(e.key==="ArrowUp"||e.key==="ArrowDown"){
      e.preventDefault();
      const st=(opts.step||1)*(e.shiftKey?10:1);
      set(cur+(e.key==="ArrowUp"?st:-st),true);
    }
  });
  return wrap;
}

/* a collapsible section, open by default, with the ⌄ the screenshots have on the right */
/* 6g8 — WHAT THE PANEL LOOKED LIKE WAS NOT SURVIVING A CHANGE
   Ced: "fix the display of the tool properties." Every setting rebuilds the card, and the rebuild used
   to throw away two things the eye depends on: which sections were open, and how far down the card was
   scrolled. So opening Line endings, picking an ending, and finding the card snapped shut and back at
   the top was the normal experience. Both are remembered now — per tool, so each panel reopens the way
   it was left. */
const TP_OPEN={};
function tpSecKey(title){ return TP_TOOL+"|"+title; }
function tpSection(title,openByDefault){
  const key=tpSecKey(title);
  if(TP_OPEN[key]==null)TP_OPEN[key]=(openByDefault!==false);
  const sec=tpEl("section","tp-sec"+(TP_OPEN[key]?" open":""));
  const h=tpEl("button","tp-sech"); h.type="button";
  h.appendChild(tpEl("span",null,title));
  h.appendChild(tpEl("span","tp-caret","⌄"));
  h.onclick=()=>{ sec.classList.toggle("open"); TP_OPEN[key]=sec.classList.contains("open"); };
  sec.appendChild(h);
  const body=tpEl("div","tp-secb");
  sec.appendChild(body);
  sec._body=body;
  return sec;
}
/* a labelled row inside a section */
function tpRow(label,node){
  const r=tpEl("div","tp-row");
  r.appendChild(tpEl("div","tp-rowl",label));
  const c=tpEl("div","tp-rowc"); c.appendChild(node); r.appendChild(c);
  return r;
}
/* a row of small buttons where exactly one is chosen */
/* =================================================================================================
   v60 — THE FONT PICKER. Ced: "add all possible fonts you can add as well."
   Seven faces fitted in a row of chips; thirty-seven do not. The row became one control in the
   panel's own language — a pill naming the face, set IN that face, with a ▾ — and the list it opens
   is the same menu every other ▾ in the panel opens: grouped, each entry drawn in its own face, with a
   filter at the top so "rob" finds Roboto, Roboto Mono and Roboto Condensed in one keystroke. Picking
   a family keeps the bold and italic you had, where the family has that cut.
   ================================================================================================= */
const TP_FONT_GROUP={arial:"Standard",times:"Standard",courier:"Standard",jost:"Bundled",carlito:"Office look-alikes",narrow:"Condensed"};
function tpFontFamOf(k){ return (TP_FAMS.slice().sort((a,b)=>b.length-a.length).find(f=>String(k).indexOf(f)===0))||"arial"; }
function tpFontPicker(current,onPick){
  const fam=tpFontFamOf(current);
  const famLabel=(TP_FONT_CHIPS.find(f=>f.k===fam)||{label:(MARK_FONTS[fam]||{}).label||"Arial"}).label;
  const btn=tpEl("button","tp-pill tp-fontpick"); btn.type="button";
  btn.title="Choose a font — every face here is written into the exported PDF or is one every PDF viewer has";
  const nm=tpEl("span","tp-fontname",famLabel); nm.style.fontFamily=(MARK_FONTS[fam]||MARK_FONTS.arial).css;
  btn.appendChild(nm); btn.appendChild(tpEl("span","tp-fontcaret","\u25be"));
  btn.onclick=ev=>{
    ev.preventDefault(); ev.stopPropagation();
    document.querySelectorAll(".tp-vmenu").forEach(n=>n.remove());
    const m=tpEl("div","sb-menu tp-vmenu tp-fontmenu");
    const q=tpEl("input","tp-fontq"); q.type="text"; q.placeholder="Find a font…"; q.setAttribute("aria-label","Find a font");
    const list=tpEl("div","tp-fontlist");
    m.appendChild(q); m.appendChild(list);
    const seen=new Set(), rows=[];
    TP_FONT_CHIPS.forEach(f=>{ const k=tpFontFamOf(f.k); if(seen.has(k)||!MARK_FONTS[k])return; seen.add(k);
      rows.push({k, label:(f.k===k?f.label:(MARK_FONTS[k].label||f.label)), group:f.group||TP_FONT_GROUP[k]||"Other", hint:f.hint}); });
    const order=["Standard","Bundled","Office look-alikes","Sans serif","Condensed","Serif","Monospace","Handwriting","Other"];
    rows.sort((a,b)=>(order.indexOf(a.group)-order.indexOf(b.group))||a.label.localeCompare(b.label));
    const draw=filter=>{
      list.innerHTML=""; let g=null, any=false;
      rows.forEach(r=>{
        if(filter&&r.label.toLowerCase().indexOf(filter)<0)return;
        if(r.group!==g){ g=r.group; list.appendChild(tpEl("div","sb-mh",g)); }
        const b=tpEl("button","sb-mi tp-vmi tp-fontitem"+(r.k===fam?" on":""),r.label); b.type="button";
        b.style.fontFamily=MARK_FONTS[r.k].css; if(r.hint)b.title=r.hint;
        b.onclick=()=>{
          const bold=/bold/.test(String(current).slice(fam.length)), ital=/ital/.test(String(current).slice(fam.length));
          const want=r.k+(bold&&ital?"bolditalic":bold?"bold":ital?"ital":"");
          onPick(MARK_FONTS[want]?want:r.k);
          list.querySelectorAll(".tp-fontitem.on").forEach(n=>n.classList.remove("on")); b.classList.add("on");
          tpRender();   /* v62 — the list stays open on the face just chosen */
        };
        list.appendChild(b); any=true;
      });
      if(!any)list.appendChild(tpEl("div","tp-fontnone","No font by that name"));
    };
    draw("");
    q.addEventListener("input",()=>draw(q.value.trim().toLowerCase()));
    q.addEventListener("keydown",e=>{
      e.stopPropagation();
      if(e.key==="Escape"){ m.remove(); }
      if(e.key==="Enter"){ const first=list.querySelector(".tp-fontitem"); if(first)first.click(); }
    });
    document.body.appendChild(m);
    const r=btn.getBoundingClientRect();
    m.style.left=Math.min(window.innerWidth-m.offsetWidth-8,Math.max(8,r.left))+"px";
    m.style.top=Math.max(8,Math.min(window.innerHeight-m.offsetHeight-8,r.bottom+4))+"px";
    const on=list.querySelector(".on"); if(on)on.scrollIntoView({block:"center"});
    setTimeout(()=>q.focus(),0);
    const away=e2=>{ if(!m.contains(e2.target)){ m.remove();
      document.removeEventListener("pointerdown",away,true); } };
    setTimeout(()=>document.addEventListener("pointerdown",away,true),0);
  };
  return btn;
}
function tpChoice(items,current,onPick,cls){
  const row=tpEl("div","tp-choice"+(cls?" "+cls:""));
  items.forEach(it=>{
    const b=tpEl("button","tp-cb"+(String(current||"")===String(it.k)?" on":"")); b.type="button";
    b.title=it.t||"";
    if(it.draw)it.draw(b); else b.textContent=it.label||it.t||"";
    b.onclick=()=>onPick(it.k);
    row.appendChild(b);
  });
  return row;
}

/* a swatch of a line style / line pattern / ending, drawn as a tiny SVG so the button shows the thing
   it sets rather than a word for it */
function tpMiniLine(b,build){
  const NS="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(NS,"svg");
  svg.setAttribute("viewBox","0 0 40 20");
  build(svg,NS);
  b.appendChild(svg);
}

/* =================================================================================================
   THE PANELS
   ================================================================================================= */
/* =================================================================================================
   6hb — A LIBRARY OF PROPERTIES
   -------------------------------------------------------------------------------------------------
   Ced: "also have a 'save these properties' and have a saved library of properties that a user can
   apply to shapes when selected."

   A tool remembers its own look, which covers "draw the next one like this one". What it cannot do is
   "draw THIS one like the thing I use on every report" — a 0.5pt dashed blue box, a red hairline with
   a tiny head, the 5pt Arial a dense table needs. Those are recipes, they outlive a session, and there
   is more than one of them at a time.

   So a set is whatever the panel is showing when you press Save: every property the mark kind can
   carry, named, kept in this browser. Pressing one applies the whole set — to the selection when there
   is one, which is the case Ced names, and to the tool in your hand when there is not. A set saved from
   a rectangle can be applied to a line: keys the other kind cannot carry are simply not written, which
   is the same rule `tpApplySel` has always followed for a single property.
   ================================================================================================= */
const TP_SETS_KEY="ma.styleset.v1";
let TP_SETS=null;
function tpSetsLoad(){
  if(TP_SETS)return TP_SETS;
  try{ const raw=localStorage.getItem(TP_SETS_KEY);
       const v=raw?JSON.parse(raw):null;
       TP_SETS=Array.isArray(v)?v:[]; }catch(e){ TP_SETS=[]; }
  return TP_SETS;
}
function tpSetsSave(){
  try{ localStorage.setItem(TP_SETS_KEY,JSON.stringify(TP_SETS||[])); }
  catch(e){ setStatus("No room left in this browser to keep another set of properties.",true); }
}
/* every property worth keeping, off whatever the panel is showing */
function tpCapture(st){
  const keys=[...new Set(TP_ANNO_KEYS.concat(TP_LINE_KEYS))];
  const out={};
  keys.forEach(k=>{ const v=st[k]; if(v!==undefined&&v!==null)out[k]=v; });
  return out;
}
/* and the whole set, in one write */
function tpApplyMany(props){
  const keys=Object.keys(props||{}); if(!keys.length)return 0;
  if(TP_SEL&&tpHasSel()){
    const s=tpSelMarks(); tpHist();
    keys.forEach(k=>{
      const v=props[k];
      if(TP_ANNO_KEYS.indexOf(k)>=0)s.annos.forEach(a=>{ a[k]=v; });
      if(TP_LINE_KEYS.indexOf(k)>=0)s.lines.forEach(l=>{ l[k]=v; try{ syncArrowFlag(l); }catch(e){} });
      /* a measurement's reading takes the text properties its run is given */
      if(TP_ANNO_KEYS.indexOf(k)>=0)s.lines.forEach(l=>{ if(l.dimFor==null)return;
        const lab=(S.annos||[]).find(z=>z.id===l.dimFor); if(lab)lab[k]=v; });
    });
    try{ layoutAnnos(); drawAllLines(); updateRail(); }catch(e){}
    tpRender();
    return s.annos.length+s.lines.length;
  }
  MA_TOOL_STYLES[TP_TOOL]=Object.assign({},MA_TOOL_STYLES[TP_TOOL]||{},props);
  try{ maSaveToolStyles(); }catch(e){}
  /* the seven that live in the ribbon's hidden fields have to agree, or `maStyleNow()` would draw the
     next mark with half of the old set */
  try{ tpWith(()=>{ if(typeof maShowToolStyle==="function")maShowToolStyle(TP_TOOL); }); }catch(e){}
  tpRender();
  return 0;
}
function tpPresets(st){
  const sec=tpSection("Saved properties",false);
  const sets=tpSetsLoad();
  const row=tpEl("div","tp-choice tp-sets");
  if(!sets.length)sec._body.appendChild(tpEl("p","tp-note","Nothing saved yet."));
  sets.forEach(rec=>{
    const b=tpEl("button","tp-cb tp-set"); b.type="button";
    b.title="Apply “"+(rec.name||"set")+"”"+(TP_SEL?" to the selection":" to this tool");
    const dot=tpEl("i","tp-setdot");
    const p=rec.props||{};
    dot.style.background=_rgbaOf(p.fill||p.col||"#fa3237",(p.fillOp!=null?p.fillOp:1));
    dot.style.borderColor=_rgbaOf(p.col||"#fa3237",(p.colOp!=null?p.colOp:1));
    dot.style.borderWidth=Math.max(1,Math.min(4,(p.sw||1)))+"px";
    dot.style.borderStyle=(p.dash&&p.dash!=="solid")?"dashed":"solid";
    b.appendChild(dot);
    b.appendChild(tpEl("span",null,rec.name||"set"));
    b.onclick=()=>{
      const n=tpApplyMany(rec.props||{});
      setStatus(n?("Applied “"+rec.name+"” to "+n+" mark"+(n===1?"":"s")+".")
                 :("“"+rec.name+"” is what this tool draws with now."));
    };
    const x=tpEl("i","tp-setx","\u2715");
    x.title="Forget this set";
    x.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
      const i=TP_SETS.indexOf(rec); if(i>=0){ TP_SETS.splice(i,1); tpSetsSave(); tpRender(); } };
    b.appendChild(x);
    row.appendChild(b);
  });
  if(sets.length)sec._body.appendChild(row);
  const save=tpEl("button","tp-cb tp-wide","\u2b07  Save these properties");
  save.type="button";
  save.title="Keep everything this panel is showing, under a name, for any mark on any report";
  save.onclick=async()=>{
    const props=tpCapture(tpStyle());
    let name=null;
    try{ name=await sbAsk({title:"Save these properties",
      hint:"Name it for what it is used for — \u201cthin blue callout\u201d, \u201c5pt table redline\u201d. "+
           "It is kept in this browser and can be applied to anything selected, from any tool.",
      placeholder:(TP_SPEC[TP_TOOL]&&TP_SPEC[TP_TOOL].title)||"my style", ok:"Save it"}); }catch(e){}
    if(name==null)return;
    name=String(name).trim().slice(0,40)||((TP_SPEC[TP_TOOL]&&TP_SPEC[TP_TOOL].title)||"Set");
    tpSetsLoad();
    const had=TP_SETS.findIndex(z=>String(z.name||"").toLowerCase()===name.toLowerCase());
    const rec={id:Date.now(),name:name,from:TP_TOOL,at:Date.now(),props:props};
    if(had>=0)TP_SETS[had]=rec; else TP_SETS.unshift(rec);
    if(TP_SETS.length>24)TP_SETS.length=24;
    tpSetsSave(); tpRender();
    setStatus("Saved “"+name+"” \u2014 apply it to anything selected from any tool's \u25be.");
  };
  sec._body.appendChild(save);
  return sec;
}
function tpBuild(){
  const spec=TP_SPEC[TP_TOOL]||TP_SPEC.redline;
  const st=tpStyle();
  const pop=document.getElementById("toolpop");
  pop.innerHTML="";
  pop.appendChild(tpHead(spec.title));
  pop.appendChild(tpPreview(spec.preview));

  const ink=st.col||"#fa3237";
  const inkOf=()=>_rgbaOf(st.col||"#fa3237",(st.colOp!=null?st.colOp:1));

  /* ---------- the colour block every panel starts with ---------- */
  if(spec.form==="text"||spec.form==="callout"||spec.form==="shape"){
    pop.appendChild(tpTargets(spec.form==="text"?"Text":"Border","Fill"));
    pop.appendChild(tpSwatches(spec.form!=="text"));
  }else if(spec.form==="image"){
    /* the swatches colour the FRAME; the opacity below belongs to the picture itself */
    TP_TARGET="stroke";
    pop.appendChild(tpSwatches(false));
  }else if(spec.fill){
    /* 6g9 — Ced: "all tools that has a fill item should have editable fill properties." A polyline
       closed on its own first corner is a filled shape, so its panel carries the same Border | Fill
       chooser, the same swatch row with None, and the same fill opacity as a rectangle. */
    pop.appendChild(tpTargets("Line","Fill"));
    pop.appendChild(tpSwatches(true));
  }else{
    TP_TARGET="stroke";
    pop.appendChild(tpSwatches(false));
  }

  /* ---------- the size / width slider ----------
     Text sizes in points; everything else is the weight of its rule. A shape has both — the size
     slider for the text it can carry is inside its own section, the width stays here with the
     colours because that is what the swatch row above is colouring. */
  const opSlider=()=>{
    const opNow=(TP_TARGET==="fill")?Math.round((st.fillOp!=null?st.fillOp:1)*100)
                                    :Math.round((st.colOp!=null?st.colOp:1)*100);
    return tpSlider({min:0,max:100,step:1,value:opNow,ticks:[25,50,75],ramp:true,
      choices:[0,10,25,50,75,90,100], suffix:"%",
      onInput:v=>{ if(TP_TARGET==="fill")tpApply("fillOp",v/100); else tpApply("colOp",v/100); }});
  };
  if(spec.form==="text"){
    pop.appendChild(tpSlider({min:2,max:64,step:0.5,value:st.size||8,ticks:TP_SIZE_TICKS,
      choices:[2,2.5,3,4,5,6,7,8,9,10,12,14,16,20,28,42,64],
      suffix:"pt", log:true, onInput:v=>tpApply("size",v)}));
  }else if(spec.form==="image"){
    /* 6gk — with a picture selected the frame IS that mark's stroke width; with nothing selected it is
       the snapshot tool's own `frameSw`, which no other tool can write. */
    const frameNow=TP_SEL?(st.sw!=null?st.sw:0):(st.frameSw!=null?st.frameSw:0);
    pop.appendChild(tpRow("Frame",tpSlider({min:0,max:12,step:0.05,value:frameNow,
      ticks:[0,0.5,1,2,4,8], choices:[0,0.25,0.5,1,1.5,2,3,4,6,8,12], suffix:"pt",
      onInput:v=>{ if(TP_SEL)tpApply("sw",v); else tpApply("frameSw",v); }})));
    pop.appendChild(tpRow("Picture",tpSlider({min:0,max:100,step:1,ramp:true,
      value:Math.round((st.fillOp!=null?st.fillOp:1)*100), ticks:[25,50,75], suffix:"%",
      onInput:v=>tpApply("fillOp",v/100)})));
    /* 6hz — WHAT A SNAPSHOT COMES BACK AS. A plain picture of the region, which is what a picture of a
       corrected table should be, or the region converted to a redline of itself — the page dropped out
       and the ink recoloured — which is what lifting a detail off a drawing wants. */
    if(!TP_SEL){
      /* 6in — WHAT SHAPE THE REGION IS. Ced: "also add a lasso snapshot under the settings of
         snapshot." A rectangle suits a table; a mount, a sector or one antenna in a cluster wants an
         outline drawn round it, with the sheet behind left out of the capture. */
      pop.appendChild(tpRow("Region",tpChoice(
        [{k:"rect", t:"Drag a rectangle over the region",label:"Rectangle"},
         {k:"lasso",t:"Draw freehand round what you want — everything outside the outline is left "+
                      "out of the capture",label:"Lasso"}],
        (st.region==="lasso")?"lasso":"rect", k=>tpApply("region",k))));
      pop.appendChild(tpRow("Capture",tpChoice(
        [{k:"plain",t:"A plain picture of the region, exactly as it is on the sheet",label:"Plain"},
         {k:"tint", t:"Converted to a redline of itself: the page drops out and the ink takes the "+
                      "colour above",label:"Redline"}],
        (st.tint!==false)?"tint":"plain", k=>tpApply("tint",k==="tint"))));
    }
    /* 6gf — and the door to the picture editor, for the snapshot this panel is bound to */
    if(TP_SEL){
      const s=tpSelMarks(), img=(s.annos||[]).find(z=>z.kind==="img");
      if(img){
        const row=tpEl("div","tp-choice tp-imgtools");
        const b=tpEl("button","tp-cb tp-wide","\u25e8  Erase, select and fill the picture");
        b.type="button"; b.title="Rub parts of it out, or wand a region and fill it \u2014 under the redlines";
        b.onclick=()=>{ tpClose(); try{ skEditor(img); }catch(e){} };
        row.appendChild(b);
        pop.appendChild(row);
      }
    }
  }else{
    /* 6g9 — the CALLOUT comes through here too now. Its width and, the part Ced was missing, its
       OPACITY sat nowhere: the panel skipped both sliders and the section below offered a border
       width only, so a callout box could be filled but not faded. The opacity slider follows the
       Border | Fill chooser above it, so it is the fill's opacity while Fill is the target. */
    /* 6gt — down to a tenth of a point, in twentieths, so a hairline rule is a value you can set
       rather than a value the bar rounds away from you */
    pop.appendChild(tpSlider({min:0.1,max:50,step:0.05,value:st.sw||1.5,ticks:TP_WIDTH_TICKS,
      choices:[0.25,0.5,0.75,1,1.5,2,3,4,6,8,12,24,50],
      suffix:"pt", log:true, onInput:v=>tpApply("sw",v)}));
    pop.appendChild(opSlider());
  }

  /* ---------- TEXT: appearance, font, style and alignment ---------- */
  if(spec.form==="text"||spec.form==="callout"){
    const sec=tpSection(spec.form==="callout"?"Text appearances":"Appearance");
    if(spec.form==="callout"){
      sec._body.appendChild(tpRow("Text size",tpSlider({min:2,max:64,step:0.5,value:st.size||8,
        choices:[2,2.5,3,4,5,6,7,8,9,10,12,14,16,20,28,42,64],
        ticks:TP_SIZE_TICKS, suffix:"pt", log:true, onInput:v=>tpApply("size",v)})));
    }else{
      sec._body.appendChild(opSlider());
    }
    sec._body.appendChild(tpRow("Font",tpFontPicker(st.font||"arial",k=>tpApply("font",k))));
    /* 6he — Ced: "in text settings across all tools, add the ability to change the spacing per letter
       and per line." Tracking is in POINTS, the same unit the size is in, and runs from a little
       tighter than the face's own to well open; leading is a MULTIPLE of the normal pitch, so 1 is
       whatever the face asks for and 2 is double-spaced. Both sit under the font they space. */
    sec._body.appendChild(tpRow("Letter spacing",tpSlider({
      min:-1, max:6, step:0.05, value:(st.lsp!=null?st.lsp:0),
      choices:[-1,-0.5,-0.25,0,0.25,0.5,1,1.5,2,3,4,6],
      ticks:[-1,0,1,2,4,6], suffix:"pt", onInput:v=>tpApply("lsp",v)})));
    sec._body.appendChild(tpRow("Line spacing",tpSlider({
      min:0.6, max:3, step:0.05, value:(st.lnsp!=null?st.lnsp:1),
      choices:[0.6,0.8,0.9,1,1.15,1.25,1.5,1.75,2,2.5,3],
      ticks:[0.6,1,1.5,2,3], suffix:"×", onInput:v=>tpApply("lnsp",v)})));
    pop.appendChild(sec);

    const sec2=tpSection("Style & Alignment");
    const styleRow=tpEl("div","tp-choice tp-deco");
    const mkT=(label,on,fn,cls)=>{ const b=tpEl("button","tp-cb"+(on?" on":"")+(cls?" "+cls:""),label);
      b.type="button"; b.onclick=fn; styleRow.appendChild(b); };
    const fk=st.font||"arial";
    const isBold=/bold/.test(fk), isItal=/ital/.test(fk);   /* 6gf — both can be true */
    /* bold and italic are FACES here, because the export writes standard PDF fonts and those are the
       faces it has — so the two buttons swap the family for its bold or italic cut. */
    mkT("B",isBold,()=>tpApply("font",tpFaceToggle(fk,"bold")),"tp-b");
    mkT("I",isItal,()=>tpApply("font",tpFaceToggle(fk,"ital")),"tp-i");
    mkT("U",!!st.uline,()=>tpSet("uline",!st.uline),"tp-u");
    mkT("S",!!st.strikeout,()=>tpSet("strikeout",!st.strikeout),"tp-s");
    sec2._body.appendChild(tpRow("Text style",styleRow));
    /* the three alignments drawn as the ragged edge each one produces, rather than three copies of
       the same ≡ that told you nothing about which was which */
    const alignIcon=where=>b=>tpMiniLine(b,(svg,NS)=>{
      svg.setAttribute("viewBox","0 0 24 18");
      [16,10,16,8].forEach((w,r)=>{
        const y=3.5+r*3.6;
        const x=(where==="left")?3:((where==="right")?(21-w):(12-w/2));
        const l=document.createElementNS(NS,"line");
        l.setAttribute("x1",x); l.setAttribute("y1",y); l.setAttribute("x2",x+w); l.setAttribute("y2",y);
        l.setAttribute("stroke","currentColor"); l.setAttribute("stroke-width","1.6");
        l.setAttribute("stroke-linecap","round");
        svg.appendChild(l);
      });
    });
    sec2._body.appendChild(tpRow("Alignment",tpChoice(
      [{k:"left",t:"Left",draw:alignIcon("left")},
       {k:"center",t:"Centre",draw:alignIcon("center")},
       {k:"right",t:"Right",draw:alignIcon("right")}],
      st.align||(spec.form==="callout"?"center":"left"),
      k=>{ tpSet("align",k); },"tp-align")));
    /* 6hw — Ced: "add vertical centering styles on textbox." Where the block of text sits in the box
       is a property of every box that HAS a box — a callout, a shape, a text box you drew — and only
       the callout was offering it. The default differs by kind and says so: a callout's words sit in
       the middle of it, a text box fills from the top. */
    if(spec.form==="callout"||spec.form==="text"||spec.form==="shape"){
      sec2._body.appendChild(tpRow("Vertical",tpChoice(
        [{k:"top",t:"Top",label:"⤒"},{k:"middle",t:"Middle",label:"⇳"},{k:"bottom",t:"Bottom",label:"⤓"}],
        st.valign||(spec.form==="text"?"top":"middle"), k=>tpSet("valign",k))));
    }
    /* 6ht — and HOW a line breaks when the box is too narrow for it: per character, the way a printed
       column fills, or between words, the way prose reads. */
    if(spec.form==="callout"||spec.form==="text"||spec.form==="shape"){
      sec2._body.appendChild(tpRow("Wrap",tpChoice(
        [{k:"chars",t:"Fill each line, breaking inside a word where it runs out",label:"AB|C"},
         {k:"words",t:"Break between words",label:"AB C"}],
        st.wrapMode||(spec.form==="text"?"chars":"words"), k=>tpSet("wrapMode",k))));
    }
    pop.appendChild(sec2);
  }

  /* ---------- SHAPE: the hatch ----------
     6g1 — a CALLOUT's box is a rectangle and is styled like one, with its own border weight, line
     style, fill and hatch — kept entirely apart from the Rectangle tool's, because a callout box and a
     box you drew round a member are two different marks that happen to share a geometry. */
  if(spec.form==="shape"||spec.form==="callout"){
    const sec=tpSection("Pattern",true);
    const grid=tpChoice(TP_PATS.map(p=>({k:p.k,t:p.t,draw:b=>{
      const cell=tpEl("span","tp-pat");
      const pv={pat:p.k,patCol:st.patCol||ink,patScale:110};
      cell.style.backgroundImage=patCss(pv);
      cell.style.backgroundSize=patCssSize(pv);
      cell.style.backgroundRepeat="repeat";
      if(!p.k)cell.classList.add("tp-patnone");
      b.appendChild(cell);
    }})), st.pat||"", k=>tpSet("pat",k), "tp-patgrid");
    const patColBtn=tpEl("button","tp-patcol"); patColBtn.type="button";
    patColBtn.title="The hatch's own colour";
    patColBtn.style.background=st.patCol||ink;
        patColBtn.onclick=e=>{ e.stopPropagation(); tpPicker(patColBtn,st.patCol||ink,v=>tpApply("patCol",v)); };
    const gwrap=tpEl("div","tp-patrow");
    gwrap.appendChild(grid); gwrap.appendChild(patColBtn);
    sec._body.appendChild(gwrap);

    const sr=tpEl("div","tp-two");
    const mkSel=(label,vals,cur,suffix,fn)=>{
      const w=tpEl("div","tp-twocell");
      w.appendChild(tpEl("span","tp-rowl",label));
      const s=document.createElement("select"); s.className="tp-pill";
      vals.forEach(v=>{ const o=document.createElement("option"); o.value=String(v);
        o.textContent=v+suffix; s.appendChild(o); });
      s.value=String(cur); s.onchange=()=>fn(parseFloat(s.value));
      w.appendChild(s); sr.appendChild(w);
    };
    mkSel("Scale",[50,75,100,150,200,300],(st.patScale!=null?st.patScale:100),"%",v=>tpSet("patScale",v));
    mkSel("Rotation",[0,15,30,45,60,75,90],(st.patRot||0),"°",v=>tpSet("patRot",v));
    sec._body.appendChild(sr);
    sec._body.appendChild(tpSlider({min:0,max:100,step:1,ramp:true,
      value:Math.round((st.patOp!=null?st.patOp:1)*100), ticks:[25,50,75],
      choices:[0,25,50,75,100], suffix:"%", onInput:v=>tpSet("patOp",v/100)}));
    pop.appendChild(sec);
  }

  /* ---------- LENGTH: the scale, and how the reading is written ----------
     6gg — the one thing a drawing cannot tell us is what it was plotted at, so it is asked here. The
     rows write to the tool while nothing is selected and onto the measurement itself when one is, like
     every other row in every other panel. */
  if(spec.dim){
    const sec=tpSection("Measurement",true);
    const mkSel=(label,items,cur,fn,title)=>{
      const w=tpEl("div","tp-twocell");
      w.appendChild(tpEl("span","tp-rowl",label));
      const sl=document.createElement("select"); sl.className="tp-pill";
      if(title)sl.title=title;
      items.forEach(it=>{ const o=document.createElement("option");
        o.value=String(it.v!=null?it.v:it.k); o.textContent=it.t; sl.appendChild(o); });
      sl.value=String(cur);
      sl.onchange=()=>fn(sl.value);
      w.appendChild(sl);
      return w;
    };
    const st2=st;
    const scaleRow=tpEl("div","tp-two");
    scaleRow.appendChild(mkSel("Drawing scale",MA_DIM_SCALES,
      (st2.dimScale!=null?st2.dimScale:48), v=>tpSet("dimScale",parseFloat(v)),
      "What one inch of the printed sheet is in the real world"));
    scaleRow.appendChild(mkSel("Reads in",MA_DIM_UNITS,(st2.dimUnit||"ft"),
      v=>tpSet("dimUnit",v)));
    sec._body.appendChild(scaleRow);
    /* the rounding and the reading's size get a full-width row each: a slider squeezed into half a
       row puts its tick labels under its own value pill and neither can be read */
    const prec=document.createElement("select"); prec.className="tp-pill";
    prec.title="What fraction of an inch a reading is rounded to";
    MA_DIM_PRECS.forEach(it=>{ const o=document.createElement("option");
      o.value=String(it.v); o.textContent=it.t; prec.appendChild(o); });
    prec.value=String(st2.dimPrec!=null?st2.dimPrec:16);
    prec.onchange=()=>tpSet("dimPrec",parseFloat(prec.value));
    sec._body.appendChild(tpRow("Nearest",prec));
    sec._body.appendChild(tpRow("Reading size",tpSlider({min:2,max:48,step:0.5,value:st2.size||8,
      choices:[2,3,4,5,6,7,8,10,12,16,24,48],
      ticks:TP_SIZE_TICKS, suffix:"pt", log:true, onInput:v=>tpApply("size",v)})));
    /* 6gj — the reading is TYPED, not filled in, so the measurement is offered as an action rather
       than written into the mark: this puts what the run measures into its reading, and from then on
       that reading follows the run until it is typed over. */
    const wrow=tpEl("div","tp-choice tp-imgtools");
    const wb=tpEl("button","tp-cb tp-wide","\u21e5  Write in the measured length");
    wb.type="button";
    wb.title="Put what the selected measurement reads into its own label";
    wb.onclick=()=>{ try{ maDimWriteIn(); }catch(e){} };
    wrow.appendChild(wb);
    sec._body.appendChild(wrow);
    /* and the dial for anyone who would rather every new measurement filled itself in */
    const au=tpEl("div","tp-switchrow");
    au.appendChild(tpEl("div","tp-swl","Fill new ones in for me"));
    const ausw=tpEl("button","tp-switch"+(st2.dimAuto?" on":"")); ausw.type="button";
    ausw.title="Off: a new measurement comes up empty for you to type. On: it is written in for you.";
    ausw.onclick=()=>tpApply("dimAuto",!st2.dimAuto);
    au.appendChild(ausw);
    sec._body.appendChild(au);
    /* a scale that is not on any rule — a photocopied sheet, a cropped detail — is measured off
       something whose length you know */
    const crow=tpEl("div","tp-choice tp-imgtools");
    const cb=tpEl("button","tp-cb tp-wide","\u25ad  Calibrate from a known length");
    cb.type="button";
    cb.title="Select a measurement you have drawn along something you know, then set what it really is";
    cb.onclick=()=>{ try{ maDimCalibrate(); }catch(e){} };
    crow.appendChild(cb);
    sec._body.appendChild(crow);
    sec._body.appendChild(tpEl("p","tp-note",
      "The reading is yours to type. A measurement is stamped with the scale it was drawn at, so a "+
      "sheet redlined at one scale keeps its readings when the next sheet is set to another."));
    pop.appendChild(sec);

    /* 6gj — Ced: "also make the text font and size editable." The reading is a text mark, so it gets
       a text mark's controls — and with a measurement selected they land on its reading, because the
       run and the reading answer as one. */
    const rsec=tpSection("Reading",true);
    rsec._body.appendChild(tpRow("Font",tpFontPicker(st2.font||"arial",k=>tpApply("font",k))));
    rsec._body.appendChild(tpRow("Size",tpSlider({min:2,max:48,step:0.5,value:st2.size||10,
      choices:[2,3,4,5,6,7,8,10,12,16,24,48],
      ticks:TP_SIZE_TICKS, suffix:"pt", log:true, onInput:v=>tpApply("size",v)})));
    const rrow=tpEl("div","tp-choice tp-deco");
    const rfk=st2.font||"arial";
    const mkR=(label,on,fn,cls)=>{ const b=tpEl("button","tp-cb"+(on?" on":"")+(cls?" "+cls:""),label);
      b.type="button"; b.onclick=fn; rrow.appendChild(b); };
    mkR("B",/bold/.test(rfk),()=>tpApply("font",tpFaceToggle(rfk,"bold")),"tp-b");
    mkR("I",/ital/.test(rfk),()=>tpApply("font",tpFaceToggle(rfk,"ital")),"tp-i");
    mkR("U",!!st2.uline,()=>tpSet("uline",!st2.uline),"tp-u");
    mkR("S",!!st2.strikeout,()=>tpSet("strikeout",!st2.strikeout),"tp-s");
    rsec._body.appendChild(tpRow("Style",rrow));
    /* the ground behind the reading is what breaks the rule under it, so it is set here too */
    const grow=tpEl("div","tp-choice tp-imgtools");
    const gb=tpEl("button","tp-cb tp-wide",(st2.bgNone?"\u25a1  No ground \u2014 the rule runs through":"\u25a0  White ground \u2014 the rule breaks"));
    gb.type="button";
    gb.title="Whether the reading hides the part of the rule it sits on";
    gb.onclick=()=>tpSet("bgNone",!st2.bgNone);
    grow.appendChild(gb);
    rsec._body.appendChild(grow);
    pop.appendChild(rsec);
  }

  /* ---------- STROKE: line style, endings, pattern ---------- */
  if(spec.form==="stroke"||spec.form==="shape"||spec.form==="callout"){
    const sec=tpSection("Line style");
    sec._body.appendChild(tpChoice(TP_DASHES.map(d=>({k:d.k,t:d.t,draw:b=>tpMiniLine(b,(svg,NS)=>{
      const l=document.createElementNS(NS,"line");
      l.setAttribute("x1","4"); l.setAttribute("y1","10"); l.setAttribute("x2","36"); l.setAttribute("y2","10");
      l.setAttribute("stroke","currentColor"); l.setAttribute("stroke-width","2");
      const dd=dashCss({dash:d.k},2,1); if(dd)l.setAttribute("stroke-dasharray",dd);
      if(d.k==="dot"||d.k==="dashdot"||d.k==="dashdotdot")l.setAttribute("stroke-linecap","round");
      svg.appendChild(l);
    })})), st.dash||"solid", k=>tpSet("dash",k), "tp-lines"));
    pop.appendChild(sec);
  }
  /* 6gd — a CALLOUT has a stroke too: its leader. Its endings belong in its panel, where Ced went
     looking for them. Everything else in the section works unchanged, because a restyle reaches the
     leader through the selection like any other stroke. */
  /* 6hp — A SHAPE'S RULE CAN RIPPLE TOO. Ced: "also add a cloud style on shapes." The five patterns
     are the stroke's own, applied to the box's outline instead of to a run, so a cloud round a member
     is the Rectangle tool with one chip pressed rather than a tool of its own. */
  if(spec.form==="shape"||spec.form==="callout"){
    const secP=tpSection("Rule pattern");
    secP._body.appendChild(tpChoice(TP_LPATS.map(d=>({k:d.k,t:d.t,draw:b=>tpMiniLine(b,(svg,NS)=>{
      const pv={lpat:d.k};
      const pts=decoratePts(pv,[[4,10],[36,10]],1.6);
      const l=document.createElementNS(NS,"polyline");
      l.setAttribute("points",pts.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" "));
      l.setAttribute("fill","none"); l.setAttribute("stroke","currentColor");
      l.setAttribute("stroke-width","1.6"); l.setAttribute("stroke-linejoin","round");
      svg.appendChild(l);
    })})), st.lpat||"straight", k=>tpSet("lpat",k), "tp-lines"));
    pop.appendChild(secP);
  }
  if((spec.form==="stroke"||spec.form==="callout")&&!spec.noEnds){
    const sec=tpSection("Line endings");
    const [e0,e1]=endsOf(st);
    const tabs=tpEl("div","tp-tabs");
    let side=(pop._side==="start")?"start":"end";
    const mkTab=(k,label)=>{ const b=tpEl("button","tp-tab"+(side===k?" on":""),label); b.type="button";
      b.onclick=()=>{ pop._side=k; tpRender(); }; tabs.appendChild(b); };
    mkTab("start","Start"); mkTab("end","End");
    sec._body.appendChild(tabs);
    sec._body.appendChild(tpChoice(TP_ENDS.map(e=>({k:e.k,t:e.t,draw:b=>tpMiniLine(b,(svg,NS)=>{
      const l=document.createElementNS(NS,"line");
      l.setAttribute("x1","4"); l.setAttribute("y1","10"); l.setAttribute("x2","28"); l.setAttribute("y2","10");
      l.setAttribute("stroke","currentColor"); l.setAttribute("stroke-width","2");
      svg.appendChild(l);
      const sp=endShapePath(e.k,4,10,30,10,9); if(!sp)return;
      const p=document.createElementNS(NS,"path"); p.setAttribute("d",sp.d);
      if(sp.fill){ p.setAttribute("fill","currentColor"); p.setAttribute("stroke","none"); }
      else { p.setAttribute("fill","none"); p.setAttribute("stroke","currentColor");
             p.setAttribute("stroke-width","2"); }
      svg.appendChild(p);
    })})), (side==="start"?e0:e1), k=>tpSet(side==="start"?"le0":"le1",k), "tp-ends"));
    /* 6gj — Ced: "have a small, medium, and large tip arrowheads." One dial for both ends, because a
       stroke with a small head at one end and a large one at the other is a drafting mistake, not a
       choice. Each chip draws the tip it means at the size it means. */
    const tipNow=(typeof st.leSz==="number"&&st.leSz>0)?st.leSz:1;
    sec._body.appendChild(tpRow("Tip size",tpChoice(TIP_SIZES.map(t=>({k:String(t.v),t:t.t,
      label:t.t,
      draw:b=>tpMiniLine(b,(svg,NS)=>{
        const l=document.createElementNS(NS,"line");
        l.setAttribute("x1","3"); l.setAttribute("y1","10"); l.setAttribute("x2","24"); l.setAttribute("y2","10");
        l.setAttribute("stroke","currentColor"); l.setAttribute("stroke-width","1.6");
        svg.appendChild(l);
        const sp=endShapePath("arrow",3,10,30,10,7*t.v); if(!sp)return;
        const p=document.createElementNS(NS,"path"); p.setAttribute("d",sp.d);
        p.setAttribute("fill","currentColor"); p.setAttribute("stroke","none");
        svg.appendChild(p);
      })})), String(tipNow), k=>tpSet("leSz",parseFloat(k)), "tp-tips")));
    /* 6jw — Ced: "make the corners of the lines sharp as well and not rounded, or better yet, add
       this as an editable setting each tool." One dial for the corner AND the end, because a mitred
       elbow with a round nub on the end is neither one thing nor the other. Each chip draws an elbow
       at a hard angle so the difference is the thing you are looking at. */
    const joinNow=(typeof joinOf==="function")?joinOf(st):"sharp";
    sec._body.appendChild(tpRow("Corners",tpChoice(JOIN_KINDS.map(j=>({k:j.v,t:j.t,
      label:j.t,
      draw:b=>tpMiniLine(b,(svg,NS)=>{
        const pl=document.createElementNS(NS,"polyline");
        pl.setAttribute("points","5,16 15,5 25,16");
        pl.setAttribute("fill","none"); pl.setAttribute("stroke","currentColor");
        pl.setAttribute("stroke-width","4");
        pl.setAttribute("stroke-linejoin",j.v==="sharp"?"miter":j.v);
        pl.setAttribute("stroke-linecap",j.v==="round"?"round":"butt");
        pl.setAttribute("stroke-miterlimit","8");
        svg.appendChild(pl);
      })})), joinNow, k=>tpSet("join",k), "tp-joins")));
    pop.appendChild(sec);

    const sec2=tpSection("Pattern");
    sec2._body.appendChild(tpChoice(TP_LPATS.map(d=>({k:d.k,t:d.t,draw:b=>tpMiniLine(b,(svg,NS)=>{
      const pl=document.createElementNS(NS,"polyline");
      pl.setAttribute("points",decoratePts({lpat:d.k},[[4,10],[36,10]],1.4)
        .map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" "));
      pl.setAttribute("fill","none"); pl.setAttribute("stroke","currentColor");
      pl.setAttribute("stroke-width","1.6"); pl.setAttribute("stroke-linejoin","round");
      svg.appendChild(pl);
    })})), st.lpat||"straight", k=>tpSet("lpat",k), "tp-lines"));
    pop.appendChild(sec2);
  }

  /* ---------- 6hb — SAVED PROPERTIES ---------- */
  pop.appendChild(tpPresets(st));

  /* ---------- everything's last section ---------- */
  const adv=tpSection("Advanced settings",false);
  const hl=tpEl("div","tp-switchrow");
  hl.appendChild(tpEl("div","tp-swl","Highlight mode"));
  const sw=tpEl("button","tp-switch"+(st.hl?" on":"")); sw.type="button";
  sw.title="Draw like a highlighter — the page reads through the mark";
  sw.onclick=()=>tpSet("hl",!st.hl);
  hl.appendChild(sw);
  adv._body.appendChild(hl);
  adv._body.appendChild(tpEl("p","tp-note",
    "These properties belong to this tool. They are what it draws with next, and — while something is "+
    "selected — what the selection becomes."));
  pop.appendChild(adv);

  /* 6g8 — the header stays put and everything under it scrolls, so the tool's name and the ✕ are
     always reachable however long the panel is. Everything above was appended flat; it is gathered
     into the scroller here, in one pass, rather than threaded through forty appends. */
  const head=pop.firstChild;
  const scroll=tpEl("div","tp-scroll");
  while(head&&head.nextSibling)scroll.appendChild(head.nextSibling);
  pop.appendChild(scroll);
  scroll.scrollTop=_tpScroll||0;
  scroll.addEventListener("scroll",()=>{ _tpScroll=scroll.scrollTop; },{passive:true});
  tpDragHead(head);
}

/* ---- the panel can be moved out of the way -------------------------------------------------------
   Ced showed it floating over the sheet; a fixed card under the tool button covers the very row being
   marked up. Dragging the header moves it, and where it was put is where it opens next — until the
   window changes size, when it is clamped back into view rather than left half off the screen. */
let _tpScroll=0;
let _tpPos=null;
function tpDragHead(head){
  if(!head)return;
  head.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    if(e.target.closest(".tp-act"))return;          /* the corner buttons are still buttons */
    const pop=document.getElementById("toolpop"); if(!pop)return;
    const r=pop.getBoundingClientRect();
    const dx=e.clientX-r.left, dy=e.clientY-r.top;
    try{ head.setPointerCapture&&head.setPointerCapture(e.pointerId); }catch(_){}
    head.classList.add("dragging");
    const move=ev=>{ _tpPos={left:ev.clientX-dx,top:ev.clientY-dy}; tpPlace(); };
    const up=()=>{ head.classList.remove("dragging");
      head.removeEventListener("pointermove",move);
      head.removeEventListener("pointerup",up);
      head.removeEventListener("pointercancel",up); };
    head.addEventListener("pointermove",move);
    head.addEventListener("pointerup",up);
    head.addEventListener("pointercancel",up);
    e.preventDefault();
  });
}

/* Bold and italic are the FACE, not a flag, because the export writes the standard PDF fonts. */
/* 6gf — AND THEY STACK. Ced: "make sure the text styles are allowed to be stacked." Bold and italic
   are FACES here, because the export writes the standard PDF fonts — and the old table had no bold
   italic, so this function had to choose: asking for italic on a bold mark silently dropped the bold.
   Every family now has all four cuts, so B and I are independent switches and either one can be on,
   off, or both, alongside the underline and the strikethrough. */
/* 6n1 — the families, longest stem first so a key is matched by its own family and not by a shorter
   one inside it. A chain of ternaries was fine for four and is not for six. */
let TP_FAMS=["carlito","courier","narrow","times","jost","arial"];   /* v60 — extended by fonts-extra.js */
function tpFaceToggle(fk,which){
  const fam=TP_FAMS.find(f=>String(fk).indexOf(f)===0)||"arial";
  const bold=/bold/.test(fk), ital=/ital/.test(fk);
  const wantB=(which==="bold")?!bold:bold, wantI=(which==="ital")?!ital:ital;
  const key=fam+(wantB&&wantI?"bolditalic":(wantB?"bold":(wantI?"ital":"")));
  return MARK_FONTS[key]?key:fam;
}

/* ---- open, close, position ---------------------------------------------------------------------- */
let _tpAnchor=null;
/* 6fe — WHILE SOMETHING IS BEING DRAGGED, DO NOT REBUILD THE PANEL. `tpBuild` replaces the whole card,
   so the first `input` from a slider destroyed the very element the pointer was holding: the drag
   ended there and the value stuck wherever that first tick had landed. During a live gesture only the
   preview is refreshed; the full rebuild happens on release. */
let _tpLive=0;
function tpLiveStart(){ _tpLive++; }
function tpLiveEnd(){ _tpLive=Math.max(0,_tpLive-1); if(!_tpLive)tpRender(); }
function tpRender(){
  const pop=document.getElementById("toolpop");
  if(!pop||pop.hasAttribute("hidden"))return;
  if(_tpLive){ tpRefreshPreview(); return; }
  tpBuild(); tpPlace();
}
/* the one part that has to follow a live drag */
function tpRefreshPreview(){
  const pop=document.getElementById("toolpop"); if(!pop)return;
  const old=pop.querySelector(".tp-prev"); if(!old)return;
  const spec=TP_SPEC[TP_TOOL]||TP_SPEC.redline;
  const fresh=tpPreview(spec.preview);
  old.replaceWith(fresh);
}
function tpPlace(){
  const pop=document.getElementById("toolpop"); if(!pop)return;
  if(pop.hasAttribute("hidden"))return;
  const w=pop.offsetWidth||330, h=pop.offsetHeight||520;
  let left,top;
  if(_tpPos){ left=_tpPos.left; top=_tpPos.top; }
  else{
    if(!_tpAnchor)return;
    const r=_tpAnchor.getBoundingClientRect();
    left=r.left; top=r.bottom+6;
    /* opened from the selection bar, which sits at the foot of the window, the panel belongs ABOVE
       its anchor rather than shoved up over it */
    if(top+h>window.innerHeight-8&&r.top-6-h>8)top=r.top-6-h;
  }
  left=Math.max(8,Math.min(left,window.innerWidth-w-8));
  top =Math.max(8,Math.min(top ,window.innerHeight-h-8));
  pop.style.left=left+"px"; pop.style.top=top+"px";
  if(_tpPos)_tpPos={left,top};
}
window.addEventListener("resize",()=>{ try{ tpPlace(); }catch(e){} });
function tpOpen(tool,anchor,forSelection){
  const pop=document.getElementById("toolpop"); if(!pop)return;
  if(maToolOf(tool)!==TP_TOOL)_tpScroll=0;   /* a different tool opens at the top of its own panel */
  TP_TOOL=maToolOf(tool);
  TP_SEL=!!forSelection&&!!tpHasSel();     /* 6fe — bound to what is selected, or to the tool */
  TP_TARGET=(TP_SPEC[TP_TOOL]&&TP_SPEC[TP_TOOL].form==="stroke")?"stroke":TP_TARGET;
  _tpAnchor=anchor||_tpAnchor;
  _tpHistAt=0;                             /* a fresh gesture gets its own undo step */
  /* editing the TOOL means the hidden inputs have to be showing that tool — otherwise a change would
     be remembered against whichever tool was last picked. Editing a SELECTION leaves them alone. */
  if(!TP_SEL)maShowToolStyle(TP_TOOL);
  pop.removeAttribute("hidden"); pop.setAttribute("aria-hidden","false");
  tpBuild(); tpPlace();
  document.querySelectorAll("#tools .tool").forEach(b=>b.classList.toggle("popped",!TP_SEL&&b.dataset.mode===TP_TOOL));
}
function tpClose(){
  tpPickerClose();
  document.querySelectorAll(".tp-vmenu").forEach(n=>n.remove());
  const pop=document.getElementById("toolpop"); if(!pop)return;
  TP_SEL=false;
  pop.setAttribute("hidden",""); pop.setAttribute("aria-hidden","true");
  document.querySelectorAll("#tools .tool.popped").forEach(b=>b.classList.remove("popped"));
}
function tpToggle(tool,anchor){
  const pop=document.getElementById("toolpop");
  if(!pop.hasAttribute("hidden")&&!TP_SEL&&TP_TOOL===maToolOf(tool))tpClose();
  else tpOpen(tool,anchor);
}

/* ---- the ▾ on every tool button ------------------------------------------------------------------ */
function tpAttachCarets(){
  document.querySelectorAll("#tools .tool[data-mode]").forEach(b=>{
    if(b.querySelector(".tcaret"))return;
    const mode=b.dataset.mode;
    if(!TP_SPEC[mode]||mode==="select")return;      /* Select draws nothing, so it styles nothing */
    const c=document.createElement("span");
    c.className="tcaret"; c.textContent="▾";
    c.title=(TP_SPEC[mode].title)+" properties";
    c.setAttribute("role","button");
    c.addEventListener("pointerdown",e=>{ e.preventDefault(); e.stopPropagation(); });
    /* 6fd — Ced: "clicking the dropdown of a tool means you are choosing that tool to use." So the ▾
       picks the tool as well as opening its properties; it is not a separate thing from the button. */
    c.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation();
      try{ if(S.mode!==mode)setMode(mode); }catch(_){}
      tpToggle(mode,b); });
    b.appendChild(c);
    b.classList.add("hascaret");
    /* a right-click anywhere on the button opens the same panel — the shortcut for anyone who does
       not want to aim for a 12px corner */
    b.addEventListener("contextmenu",e=>{ e.preventDefault();
      try{ if(S.mode!==mode)setMode(mode); }catch(_){}
      tpOpen(mode,b); });
  });
}

(function tpWire(){
  const start=()=>{
    tpAttachCarets();
    /* clicking away closes it; the panel itself and the carets do not count as away */
    document.addEventListener("pointerdown",e=>{
      const pop=document.getElementById("toolpop");
      if(!pop||pop.hasAttribute("hidden"))return;
      if(e.target.closest("#toolpop")||e.target.closest(".tcaret")||e.target.closest(".tp-picker"))return;
      /* v62 — a value list or the font list belongs to the panel even though it floats outside it:
         a pick in it used to count as "away" and closed the panel under the pointer */
      if(e.target.closest(".tp-vmenu"))return;
      if(e.target.closest("#selbar"))return;    /* the bar's own buttons re-open it */
      tpClose();
    },true);
    document.addEventListener("keydown",e=>{
      const pop=document.getElementById("toolpop");
      const vm=document.querySelector(".tp-vmenu");
      if(e.key==="Escape"&&vm){ vm.remove(); e.stopPropagation(); return; }
      if(e.key==="Escape"&&pop&&!pop.hasAttribute("hidden")){ tpClose(); e.stopPropagation(); }
    },true);
    window.addEventListener("resize",()=>tpPlace());
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);
  else start();
})();
