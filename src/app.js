const PT2PX=96/72;
/* Declared with `var` and before the error handlers below, which read it. As a `let` further down it sat in
   the temporal dead zone, so any early error threw "Cannot access '_echoConsole' before initialization"
   instead of being reported. */
var _echoConsole=false;
/* pdf.js writes its own notices straight to the console — "Setting up fake worker" appears whenever the
   worker script cannot be fetched. That single line was enough to keep the host's console panel on screen.
   Known notices are routed into our log instead; anything unrecognised still goes through untouched. */
(function(){
  const KNOWN=[/setting up fake worker/i,/deprecated api usage/i,/unsupported feature/i,
               /cmap|standard font data/i,/transferable/i];
  ["warn","log","info"].forEach(k=>{
    const orig=console[k]?console[k].bind(console):null;
    if(!orig)return;
    console[k]=function(...a){
      const s=a.map(x=>{ try{ return typeof x==="string"?x:String(x&&x.message||x); }catch(e){ return ""; } }).join(" ");
      if(KNOWN.some(re=>re.test(s))){
        try{ if(typeof _logBuf!=="undefined")
          _logBuf.push(new Date().toLocaleTimeString()+"  (pdf.js) "+s.slice(0,300)); }catch(e){}
        if(!_echoConsole)return;                 // swallowed unless you asked for the console
      }
      return orig.apply(console,a);
    };
  });
})();
/* v60 — the user-facing half of this moved to guard.js (one notice, benign errors dropped, autosave
   flushed first). This keeps only the console echo for whoever asked for it. */
window.addEventListener("error",ev=>{ try{
  if(_echoConsole)console.error("[MA] runtime error",ev.error||ev.message); }catch(_){} });
window.addEventListener("unhandledrejection",ev=>{
  try{ LOG("promise rejection",(ev.reason&&ev.reason.message)||String(ev.reason)); }catch(e){}
  if(_echoConsole)console.error("[MA] promise rejection",ev.reason); });
const S={ doc:null, docBytes:null, name:"", scale:1.2, mode:"redline", pages:[], annos:[], lines:[], suggestions:new Set(), sel:null, selLine:null, selMulti:new Set(), selMultiL:new Set(), clip:null, discrepancies:[], history:[], future:[], analysis:null, atollName:"", location:"", isPreliminary:null, snap:true, magnet:true, theme:"dark",
  /* 6jd — a cut that has not landed yet: the marks wearing the marching ants */
  cutA:new Set(), cutL:new Set(),
  /* 6jc — the document's named layers, and which one new marks join */
  layers:null, layCur:null };
let seq=1;
/* Set while a bulk action (Stamp all pages, Apply suggestions) is placing marks: it makes addText
   dedupe against a mark already on the same cell instead of stacking a second one on top. `var`, and
   here at the top, so nothing can read it from its temporal dead zone. */
var _azApplying=false;
/* Set while a bulk action places many marks at once: a new mark normally takes the caret so you can
   type over it, and ninety-six of them in a row would leave the page scrolling and the last one in
   edit mode. */
var _maQuiet=false;
/* the printed run nearest a stored cell position — coverage geometry still applies to it */
function pageItemAt(pi,g){ return rfItemAt(pi,g); }
const ONE_VALUE_COL=/vendor|manufact|^model|equipment\s*type|^type$/i;
function isMultiLineBox(box){
  if(!box)return false;
  if((box.lines||1)>1)return true;                       // built from more than one text run
  return box.y2!=null&&(box.y2-box.ny)>(box.nh||0)*1.15;
}
/* stamp one mark stretched over a whole cell box; needs no printed item to anchor on */
/* the printed text's own size, in points, from its glyph height */
function printedPt(pi,box){
  const P=S.pages[pi];
  if(!P||!box||!box.nh)return null;
  const pt=box.nh*(P.h1||792);
  return (pt>=4&&pt<=28)?Math.round(pt*10)/10:null;
}
/* =================================================================================================
   6fh — THE SIZE OF A PRINTED RUN, MEASURED THE ONLY WAY THAT IS EXACT
   -------------------------------------------------------------------------------------------------
   Ced: "make sure the redline tool text is the same size as the text below."

   `printedPt` reads the run's HEIGHT, and a run's reported height is its line box, not its glyphs —
   which on these reports runs a point or two over. Measured on the cover page: a value printed at 11pt
   reports 13, so every correction over one came out visibly larger than the value it replaced.

   Its WIDTH is unambiguous. The run's own string, set in the mark's own face, at the size that makes
   it exactly as wide as the print, is the same size as the print. That is a single division, because
   text width scales linearly with point size. The height is kept as the fallback for a run with no
   usable string (a lone punctuation mark, or a cell we are filling rather than copying).
   ================================================================================================= */
function printedSizeFor(pi,run,fontKey){
  const P=S.pages[pi]; if(!P)return null;
  const byHeight=printedPt(pi,{nh:run&&run.nh});
  const str=String((run&&run.str)||"").trim();
  const wide=(run&&run.nw)||0;
  if(!str||wide<=0||str.length<2)return byHeight;
  const at10=measureTextNorm(str,10,pi,fontKey);
  if(!(at10>0))return byHeight;
  const fitted=10*(wide/at10);
  if(!(fitted>=4&&fitted<=28))return byHeight;
  return Math.round(fitted*10)/10;
}
/* Width comes from the TOP line of the cell, not the widest: for "ROSENBERG"+"ER" the printed text to
   line up with is ROSENBERG. Height still covers every line so nothing shows underneath. */
function cellBoxWidth(box){
  if(!box)return 0;
  const right=(box.topR!=null)?box.topR:(box.x2!=null?box.x2:box.nx+(box.nw||0));
  return Math.max(0,right-box.nx);
}
let _needRelayout=false;
/* Every redline is nudged DOWN by this much so it reads as sitting on the printed line rather than
   floating over it. Held in normalised units so screen and PDF agree at any zoom (~4px on a letter page). */
const REDLINE_DROP=0.0035;   /* ~2px higher than 6l */
/* A left-aligned mark carries a 1pt bleed on its left so it covers the printed glyph; without a matching
   inset the replacement text started 1pt left of the value it replaces, which is what made the Design
   Summary counts look a fraction out. */
const REDLINE_LEFT_INSET=1.0;
/* Copy row — take every printed run inside the dragged box and write it again as an editable redline on
   the line below, keeping each run's own column position and size. That gives you the row you selected,
   in red, ready to change: the usual way to add a near-duplicate of an existing row. */
/* 6dq — CROSS OUT. Drag a box over anything — a row, a block, a whole table — and it is struck through
   with an X. The gesture is the marquee, because you are choosing an AREA rather than following a line
   of text; what it leaves is two ordinary strike lines, grouped, so from that moment on it drags,
   nudges, selects, groups, undoes and exports as the line tool's own marks do. Nothing downstream has
   to know the cross-out exists. */
function crossOutBox(pi,rx1,ry1,rx2,ry2){
  const P=S.pages[pi];
  if(!P){ toast("Nothing to cross out here"); return; }
  if(P.locked){ setStatus("Page "+(pi+1)+" is locked ("+(P.lockReason||"read-only")+") — unlock it to cross anything out."); return; }
  /* 6gn — a click that drew no box puts the tool down, like every other one. It used to say "drag a
     box" and stay armed, so the next click said it again instead of letting you reach the mark you were
     going for. Saying what to do and then blocking the way out is the worst of both. */
  if(Math.abs(rx2-rx1)<0.004&&Math.abs(ry2-ry1)<0.004){ toast("Drag a box over what you want crossed out");
    return; }
  /* a box with no height is a strike, not a cross — treat it as one rather than drawing a degenerate X */
  const flat=Math.abs(ry2-ry1)<0.004;
  const ids=[];
  historyBatch(()=>{
    if(flat){ ids.push(addLine(pi,rx1,(ry1+ry2)/2,rx2,(ry1+ry2)/2)); }
    else{
      ids.push(addLine(pi,rx1,ry1,rx2,ry2));      // top-left to bottom-right
      ids.push(addLine(pi,rx1,ry2,rx2,ry1));      // bottom-left to top-right
    }
  });
  const made=ids.filter(id=>id!=null);
  if(!made.length){ toast("Nothing could be crossed out"); return; }
  if(made.length>1){
    const g=seq++;
    made.forEach(id=>{ const l=S.lines.find(z=>z.id===id); if(l)l.group=g; });
  }
  drawPageLines(pi); updateRail(); updateCount();
  clearMulti();
  made.forEach(id=>S.selMultiL.add(id));
  if(made.length>1)paintMulti(); else selectLine(made[0]);
  toolDone();
  LOG("Cross out: page",pi+1,flat?"— flat box, drew one strike":"— drew an X",
      "over",(rx2-rx1).toFixed(3)+"x"+(ry2-ry1).toFixed(3));
  setStatus(flat?"Struck through — Select is active, so drag or resize it now."
                :"Crossed out — the two strikes are grouped, so they move as one.");
}
function copyRowFromBox(pi,rx1,ry1,rx2,ry2){
  const P=S.pages[pi];
  if(!P){ toast("Nothing to copy here"); return; }
  if(P.locked){ setStatus("Page "+(pi+1)+" is locked ("+(P.lockReason||"read-only")+") — unlock it to copy a row."); return; }
  if(Math.abs(rx2-rx1)<0.004||Math.abs(ry2-ry1)<0.002){ toast("Drag a box over the text you want to copy"); return; }
  /* a run counts as inside when its own centre is inside the box */
  const hits=(P.items||[]).filter(t=>{
    const cx=t.nx+(t.nw||0)/2, cy=t.ny+(t.nh||0)/2;
    return cx>=rx1&&cx<=rx2&&cy>=ry1&&cy<=ry2&&String(t.str).trim()!=="";
  });
  if(!hits.length){ toast("No text inside the box"); return; }
  /* group the runs into their printed lines, so a multi-line cell keeps its shape */
  const fh=hits.reduce((s,t)=>s+(t.nh||0.011),0)/hits.length;
  const lines=[];
  hits.slice().sort((a,b)=>a.ny-b.ny||a.nx-b.nx).forEach(t=>{
    const L=lines.find(l=>Math.abs(l.y-t.ny)<fh*0.6);
    if(L){ L.items.push(t); L.y=Math.min(L.y,t.ny); } else lines.push({y:t.ny,items:[t]});
  });
  /* the row pitch: the gap between the boxed lines, or a line height when there is only one */
  let pitch=fh*1.35;
  if(lines.length>1){
    const gaps=[]; for(let k=1;k<lines.length;k++){ const d=lines[k].y-lines[k-1].y; if(d>fh*0.5)gaps.push(d); }
    if(gaps.length){ gaps.sort((a,b)=>a-b); pitch=gaps[Math.floor(gaps.length/2)]; }
  }
  const bottom=Math.max(...hits.map(t=>t.ny+(t.nh||fh)));
  let made=0; const ids=[];
  historyBatch(()=>{
  /* Position each copy exactly as a Design Summary count redline is positioned: build it through the
     SAME cell path (addText with the printed run), which gives it the printed size, the printed line
     height, the vertical drop and the length rule for alignment — one character flush on the printed
     glyph, two or more centred on the cell. Then shift it down by whole rows.
     Building it any other way is how the copies ended up left-aligned while the counts were centred. */
  const drop=bottom+pitch*0.30;                       // where the first copied line begins
  lines.forEach((L,li)=>{
    L.items.forEach(t=>{
      const txt=String(t.str).trim();
      const id=addText(pi,0,0,txt,{cell:t});          // identical to a count redline over this run
      if(id==null)return;
      const a=S.annos.find(z=>z.id===id);
      if(!a){ return; }
      /* move it off the run it copied and onto its own row, keeping the line spacing of the source */
      a.ny=Math.min(1-fh*1.1, drop+li*pitch);
      made++; ids.push(id);
    });
  });
  });   // close the history batch — the whole copy is a single undo step
  layoutAnnos(); updateRail();
  try{ if(typeof refreshMarkCount==="function")refreshMarkCount(); }catch(e){}
  LOG("Copy row: page",pi+1,"—",hits.length,"run(s) in",lines.length,"line(s) →",made,"redline(s)");
  if(made){
    clearMulti(); S.selMulti=S.selMulti||new Set();
    ids.forEach(id=>S.selMulti.add(id));
    paintMulti();
    /* 6f8 — the tool stays in your hand; the copies are selected either way */
    toolDone();
    ids.forEach(id=>S.selMulti.add(id));
    paintMulti();
    setStatus("Copied "+made+" value"+(made===1?"":"s")+" — Select is active, so drag or retype them now.");
    toast("Copied "+made+" value"+(made===1?"":"s"));
  } else toast("Nothing could be copied");
}
/* 6db — how far inside a column a redline sits. The bounds a reader returns are cut halfway between
   neighbouring column centres, which is a few points outside the ruled cell; this pulls the mark back in
   so it reads as being IN the cell rather than across the rule. ~3.7pt on a letter page. */
const ANT_COL_INSET=0.006;
/* 6dc — where a mark is allowed to sit, and it is not simply "the column".
   A column bound is cut HALFWAY between neighbouring columns, so on a page where one column's text is
   much wider than its neighbour's the cut lands INSIDE the wide value: filling the column then leaves the
   tail of the printed value sticking out beside the correction, which is what
   "ERICSSON TEST TES T TEST" is a picture of. The mark therefore covers the column inset from its rules
   OR the printed value's own extent, whichever is wider — it can never be narrower than the ink it has
   to hide. */
/* 6dm — WHERE THE CELL ACTUALLY IS.
   `colL`/`colR` are cut halfway between neighbouring column centres, so they are not the ruled cell —
   they are the gap between two columns, and on a wide table they sit a long way outside the rules.
   Measured on the Design Summary of the reference RFDS: the believed column is 0.1802 wide while every
   run of text printed in it spans only 0.1314 — the fence is **29.8pt wider than the cell**. A mark
   built to that fence hangs into its neighbours, which is the bleed.

   The ink is the better witness. Every run whose centre falls inside the fence belongs to that column,
   so the extent of all of them, plus a little air, is the cell — clamped to the fence, never past it.
   Cached per page and column, because it is read once per stamped cell. */
const CELL_AIR=0.004;                                     // ~2.4pt of breathing room each side
function columnInk(pi,colL,colR){
  const P=S.pages[pi];
  if(!P||colL==null||colR==null)return null;
  P._colInk=P._colInk||{};
  const k=colL.toFixed(4)+"|"+colR.toFixed(4);
  if(P._colInk[k]!==undefined)return P._colInk[k];
  const fence=colR-colL;
  let L=null,R=null;
  (P.items||[]).forEach(t=>{
    if(!String(t.str||"").trim())return;
    const x1=t.nx, x2=t.nx+(t.nw||0), cx=(x1+x2)/2;
    if(cx<=colL||cx>=colR)return;
    if((x2-x1)>fence*0.98)return;                         // a banner spanning the table is not this column
    if(L==null||x1<L)L=x1;
    if(R==null||x2>R)R=x2;
  });
  const res=(L==null)?null:{L,R};
  P._colInk[k]=res;
  return res;
}
/* 6ea — the 6dz column-line rule is GONE, and this is the record of why, because it looked right.
   It capped a one-line correction at the width the column's own printed values wrap at, on the argument
   that a column which wraps has declared a line width. Measured on the reference form the Model column
   does exactly that — RF Inventory prints `NNH4-65C-R6-HG` on two lines at 53.8pt where the same string
   on one line needs 63.5 — so the rule folded the correction to match. But the cell there is 79.1pt: the
   correction had 11pt of room and was folded anyway. Matching how a column wraps is not the same as
   fitting the cell, and it is the CELL that decides whether a mark bleeds into its neighbour. The width
   rule in `stampWholeCell` measures the cell and keeps two spaces clear of it; nothing needs to know how
   the column happens to wrap, so nothing asks any more. */
/* 6dv — how much of the cell a mark may use.
   6dm sized the cell from THIS column's own ink, which is right when the column holds wide values and
   badly wrong when it does not. The Calculated RAD Center column prints "285" and "59" and nothing else:
   its ink is 8.7pt inside a 57.5pt fence, and its heading is skipped as a banner because it is wider
   than the fence. So a two-part value like "54 | 56" — 15.7pt of text — was given a 13.6pt cell and
   folded onto two lines in a column with room for it four times over.

   The neighbours are the better witness. What a mark must not touch is the text on either side of it,
   so the cell runs from the nearest ink on the left to the nearest ink on the right, held off both by a
   margin — as wide as the column really is, and a few spaces short of its neighbours either way. */
const CELL_MARGIN=0.005;                                   // ~3pt of clear air from the next column's text
const FENCE_INSET=0.006;                                   // ~3.7pt held off the column boundary itself
function columnFrame(pi,colL,colR){
  const P=S.pages[pi];
  if(!P||colL==null||colR==null)return null;
  P._colFrame=P._colFrame||{};
  const k=colL.toFixed(4)+"|"+colR.toFixed(4);
  if(P._colFrame[k]!==undefined)return P._colFrame[k];
  const fence=colR-colL;
  let left=null,right=null;
  (P.items||[]).forEach(t=>{
    if(!String(t.str||"").trim())return;
    const x1=t.nx, x2=t.nx+(t.nw||0), cx=(x1+x2)/2;
    if((x2-x1)>fence*2.5)return;                           // a banner across the table is nobody's column
    /* 6dy — a neighbour is a run that lies ENTIRELY to one side. This tested the run's CENTRE, so a
       page title or a section heading centred left of the column but reaching across it counted as the
       thing immediately to our left, and its right edge — inside our own column — became the cell's left
       wall. The cell then started at, or right of, the printed value it was meant to hold, and a mark
       that should have been centred on that value was clamped flush against it. Straddling runs are on
       another row and bound nothing; the fence still bounds the cell either way. */
    if(x2<=colL){ if(left==null||x2>left)left=x2; }        // the nearest thing wholly to our left
    else if(x1>=colR){ if(right==null||x1<right)right=x1; } // and wholly to our right
  });
  const res={L:(left==null?colL:left), R:(right==null?colR:right)};
  P._colFrame[k]=res;
  return res;
}
function cellBounds(pi,box){
  if(!box||box.colL==null||box.colR==null)return null;
  /* 6ej — if the page's rules were read, the cell is the ruled cell. Everything below this is an
     estimate of exactly that, kept for pages with no ruled table on them. */
  {
    const rc=ruledCell(pi,box.nx,(box.x2!=null?box.x2:box.nx+(box.nw||0)));
    if(rc){
      const inset=Math.min(CELL_MARGIN,(rc.R-rc.L)*0.06);
      let L=rc.L+inset, R=rc.R-inset;
      const pL=box.nx, pR=(box.x2!=null?box.x2:box.nx+(box.nw||0));
      if(pL<L)L=pL;                       // coverage still wins over the inset
      if(pR>R)R=pR;
      if(R-L>=0.006)return {L:Math.max(0,L),R:Math.min(1,R)};
    }
  }
  const ink=columnInk(pi,box.colL,box.colR);
  const fr=columnFrame(pi,box.colL,box.colR);
  let L,R;
  /* 6dw — the frame is bounded BY THE FENCE. A frame on its own reaches to the nearest ink, and where a
     neighbouring column is empty — a run of "-" placeholders, or a blank column on a transposed antenna
     page — the nearest ink is two or three columns away, so the cell swallowed them and the mark ran
     clean across the table. The fence is cut halfway between column centres, so two neighbouring fences
     can never overlap: intersecting the two gives a cell that is as wide as the column really is and
     still cannot reach the column beside it. */
  /* 6dx — and the fence is inset too. Intersecting with the bare fence stopped a mark reaching the
     column beside it, but the fences of two neighbouring columns MEET: a mark filling one and a mark
     filling the next touched at exactly 0pt, which on the page is indistinguishable from one running
     into the other. Holding both sides off the fence leaves a clear channel between them. */
  if(fr){ L=Math.max(box.colL+FENCE_INSET,fr.L+CELL_MARGIN);
          R=Math.min(box.colR-FENCE_INSET,fr.R-CELL_MARGIN); }
  else if(ink){ L=Math.max(box.colL,ink.L-CELL_AIR); R=Math.min(box.colR,ink.R+CELL_AIR); }
  else   { L=box.colL+ANT_COL_INSET;            R=box.colR-ANT_COL_INSET; }
  /* 6dv — the ONLY thing that may push a cell past its neighbours is the printed run it has to cover.
     Widening to the column's whole ink extent did it too, and on the antenna pages that ink is wider
     than the frame, so six marks reached into the next column. Coverage is a must; ink extent is not. */
  const pL=box.nx, pR=(box.x2!=null?box.x2:box.nx+(box.nw||0));
  L=Math.min(L,Math.max(box.colL,pL));
  R=Math.max(R,Math.min(box.colR,pR));
  /* 6eh — AND NEVER PAST THE MIDPOINT BETWEEN THIS COLUMN'S INK AND THE NEXT. `CELL_MARGIN` is a fixed
     inset from the neighbouring ink, which is the right idea only while the gap between two columns is
     small. Where the gap is wide the cell reaches well past the ruled edge — on the form this was
     reported against, the column rules sit at x 279 and 389 and a mark filling the cell put its text at
     391, i.e. through the rule. The ruled edge is not in the text layer and cannot be read directly, but
     it is very close to halfway between the two columns' ink, and halfway is something we can measure.
     This can only ever tighten the cell: where the current bound is already the tighter one it wins. */
  if(fr){
    if(fr.L!=null&&fr.L<pL)L=Math.max(L,(fr.L+pL)/2);
    if(fr.R!=null&&fr.R>pR)R=Math.min(R,(pR+fr.R)/2);
  }
  if(R-L<0.006)return null;
  return {L:Math.max(0,L),R:Math.min(1,R)};
}
function stampCover(box){
  const inset=ANT_COL_INSET;
  const pL=box.nx, pR=(box.x2!=null?box.x2:box.nx+(box.nw||0));
  let L=(box.colL!=null)?(box.colL+inset):pL, R=(box.colR!=null)?(box.colR-inset):pR;
  if(pL<L)L=pL;
  if(pR>R)R=pR;
  /* 6de — and the cover is SYMMETRIC about the column's centre. The text is centred inside the mark, so
     a mark that grew on one side only (a printed run starting outside the column's inset, which is what
     Port Level's left-aligned models do) put its centred text off the middle of the cell by exactly the
     amount it grew. Widening the other side costs nothing — the cell is empty there — and puts the
     correction where the column's own centre is. */
  if(box.colL!=null&&box.colR!=null){
    const cc=(box.colL+box.colR)/2;
    const half=Math.max(cc-L,R-cc);
    /* ...but never past the column's own rules. Growing the empty side to match is free; growing it into
       the NEXT column is not, and on a page whose printed value overruns its column bound by a lot the
       mirrored growth would have whited out the label beside it. */
    L=Math.max(Math.min(box.colL,pL),cc-half);
    R=Math.min(Math.max(box.colR,pR),cc+half);
  }
  return {L:Math.max(0,L),R:Math.min(1,R)};
}
/* ================================================================================================
   6ev — IS THIS CELL ALREADY REDLINED?
   ------------------------------------------------------------------------------------------------
   Apply has always refused to stack a second mark on a cell IT had already stamped — the key is the
   cell's own coordinate, carried on the mark as cx0/cy0. But a redline you drew BY HAND has no cx0, and
   the test only looked at marks tagged `fromAnalyze`, so it was invisible: measured on the real form,
   a hand-drawn "999" on an azimuth cell and then an Apply produced

       id 1  text 999  nx 0.1966  nw 0.0048   (yours, drawn by hand)
       id 3  text 55   nx 0.1908  nw 0.0163   (Apply's, laid straight over it)

   two opaque boxes on one cell, which is the "it sometimes still overlays" you are seeing. So the test
   is geometric as well as keyed: anything whose box contains the middle of this cell counts as covering
   it. What happens next depends on WHOSE mark it is, and that is decided at the call sites — Apply
   updates its own, and leaves yours alone.
   ================================================================================================ */
function markCoveringCell(pi,box){
  if(!box)return null;
  const bx2=(box.x2!=null?box.x2:box.nx+(box.nw||0));
  const by2=(box.y2!=null?box.y2:box.ny+(box.nh||0.011));
  const cx=box.nx+(bx2-box.nx)/2, cy=box.ny+(by2-box.ny)/2;
  let keyed=null, any=null;
  (S.annos||[]).forEach(a=>{
    if(a.page!==pi)return;
    /* the keyed test first: this is the one that survives a re-analyze moving the geometry a hair */
    if(a.fromAnalyze&&Math.abs((a.cx0==null?a.nx:a.cx0)-box.nx)<0.005
                    &&Math.abs((a.cy0==null?a.ny:a.cy0)-box.ny)<0.005){ if(!keyed)keyed=a; return; }
    /* only things that could BE a cell redline: a photo, or a hand-drawn box spanning a quarter of the
       page, is something you put there on purpose and is not a reason to skip a correction underneath it */
    if(a.kind==="img")return;
    const w=a.nw||0, h=(a.nh||a.lineNh||0.011);
    if(w<=0||h<=0||w>0.25)return;
    /* the cell's own middle, inside the mark's box — a neighbouring row's mark cannot contain it
       (rows sit ~0.02 apart and a line is ~0.013 tall) */
    if(cx<a.nx-0.0005||cx>a.nx+w+0.0005)return;
    if(cy<a.ny-0.0005||cy>a.ny+h+0.0005)return;
    if(!any||(!any.fromAnalyze&&a.fromAnalyze))any=a;
  });
  return keyed||any;
}
let _azHandHeld=0;      // cells this Apply left alone because YOUR redline was already on them
function stampWholeCell(pi,box,value,align,opts){
  const _colCentred=!!(opts&&opts.colCentred);
  /* the printed length travels with the mark so the alignment rule can see it */
  const _srcLen=(()=>{ try{ const it=pageItemAt(pi,box);
    return it&&it.str!=null?String(it.str).trim().length:null; }catch(e){ return null; } })();
  /* Same no-stacking rule as the cell path: if an analyze mark already covers this cell, update it in
     place rather than laying a second one on top. stampWholeCell does not go through addText's cell
     dedupe (it has no printed run to key on), so the check has to happen here. */
  let id=null, a=null;
  if(_azApplying){
    const dup=markCoveringCell(pi,box);
    if(dup&&!dup.fromAnalyze){
      /* YOUR redline is on this cell. Never lay a second box over it, and never silently rewrite what
         you wrote: the hand-drawn mark is the more authoritative of the two. It is counted so the run
         can say so rather than the cell just looking untouched. */
      _azHandHeld++;
      LOG("Analyze: cell already carries a redline you drew (",String(dup.text),
          ") — left alone, not restamped with",JSON.stringify(String(value)));
      return dup.id;
    }
    if(dup){
      /* 6ev — RESTAMP, DO NOT PATCH. This branch used to set the text and then recompute the width with
         `max(cellBoxWidth, measureTextNorm+0.002)` — a rule from before every placement rule below it
         existed, so an updated mark got geometry no fresh mark would ever be given. Measured on the
         antenna pages, applying a second time with a new azimuth:
             nw 0.02100 -> 0.01425     the mark SHRANK off the value it was covering
         The mark is now re-placed by the same code that places a new one: same width, same wrap, same
         centring. Only the fields the placement does not always write are cleared first, or a stale one
         from the previous value survives into the new geometry. */
      a=dup; id=dup.id;
      a.text=String(value); a.orig=String(value);
      a.textDx=null; a.wrap=false; a.nowrap=true; a.manualW=false;
      a.cw=null; a.tx0=null; a.lines=1; a.pLines=null;
      delete a._cellHost;
      LOG("Analyze: re-placed the existing whole-cell redline →",String(value));
    }
  }
  if(!a){
    id=addText(pi,box.nx,box.ny,String(value));
    a=S.annos.find(z=>z.id===id);
  }
  if(a&&_colCentred)a.colCentred=true;      // set BEFORE the placement below reads it
  if(a&&_srcLen!=null)a.srcLen=_srcLen;     // so the alignment rule can see the printed length
  if(!a){
    /* addText declined — a duplicate-cell guard, a zero-width box, a NaN coordinate. Place it plainly
       instead of reporting success with nothing on the page. */
    LOG("⚠ stampWholeCell: no mark at",String(box.nx),String(box.ny),
        "— placing directly:",JSON.stringify(String(value)));
    const w=Math.max(0.006,cellBoxWidth(box)||0.006);
    id=putRowCell(pi,box.nx,w,box.ny,String(value),box.nh||0.011);
    a=S.annos.find(z=>z.id===id);
    if(!a){ LOG("⚠ stampWholeCell: STILL no mark — this cell was NOT redlined:",JSON.stringify(String(value))); return null; }
    return id;
  }
  if(a){
    /* 6fh — the size the printed value is SET at, fitted to its own width. The height of a run is its
       line box and reads a point or two over, which is why a correction used to sit visibly larger
       than the value it replaced. `box` carries the printed string wherever the caller had one. */
    const pt=printedSizeFor(pi,{nh:box.nh, str:box.pstr, nw:box.pw},markFontKey(a));
    if(pt)a.size=pt;
    a.lineNh=box.nh||null;                            // ONE line's height, for vertical placement
    a.nx=box.nx; a.ny=box.ny;
    const lines=box.lines||1;
    a.nh=(box.y2-box.ny);
    a.lines=lines;
    if(lines>1){
      /* Guard against a mis-measured top line: if the top-line width is far narrower than the value it
         has to hold, fall back to the cell's whole width. A too-narrow box wraps into a column of single
         characters, which is what "the two-line models still are not redlining" looks like. */
      const topW=cellBoxWidth(box);
      const fullW=(box.x2!=null?box.x2:box.nx+(box.nw||0))-box.nx;
      const need=measureTextNorm(String(value),a.size||8,pi);
      if(topW<need*0.45&&fullW>topW){
        LOG("Analyze: top line",topW.toFixed(4),"too narrow for",JSON.stringify(String(value)),
            "— using the whole cell",fullW.toFixed(4));
        box={...box, topR:(box.x2!=null?box.x2:box.nx+(box.nw||0))};
      }
    }
    if(lines>1){
      /* The printed value occupies several lines, so the redline does too: the box keeps the TOP line's
         width and the text wraps inside it, breaking where the original broke. Previously the mark was
         forced onto one line, so it overflowed and the lines underneath stayed visible. */
      /* 6db — a cell that PRINTED on several lines wraps the same way: the column, inset, and the mark
         placed by its alignment inside it. The top line's own width is only a floor, never a ceiling. */
      /* 6dc — a printed value that ran onto a second line is never narrower than one line and rarely the
         same width on both, so a box sized to one of them leaves the other showing. The mark takes the
         WHOLE column, inset from its rules, and wraps inside it: every printed line is underneath it. */
      /* 6dj — the same rule as a single line: the mark is the width of the printed VALUE — here the
         widest of the lines it printed on — and the correction wraps inside that. A value that already
         wrapped is by definition wide enough to host a replacement. */
      /* 6dl — the same two cases as a single line. A cell that PRINTED on several lines is wide enough
         to host most corrections, but its printed extent is still not a ceiling: when the correction is
         longer than what printed there, the cell is the host and the mark only folds if the cell itself
         is too narrow. */
      const full2=(box.x2!=null?box.x2:box.nx+(box.nw||0))-box.nx;
      let ww=Math.max(cellBoxWidth(box),full2);
      a.nx=box.nx;
      const need2=measureTextNorm(String(value),a.size,pi)+0.002;
      if(box.colL!=null&&box.colR!=null){
        const c2=cellBounds(pi,box)||stampCover(box);
        const cw2=Math.max(0.01,c2.R-c2.L);
        if(ww<0.02){ ww=cw2; a.nx=Math.max(0,c2.L); a._cellHost=true; }            // nothing to wrap into
        else if(need2>ww){
          /* 6dy — the same continuous rule as a single line. This jumped straight to the cell, so a
             two-line vendor corrected to something a few points longer than it printed was given the
             whole column. Grow by what the correction needs; the cell is the ceiling, not the target. */
          /* 6ea — the same rule as a single line: as wide as the correction needs, and never closer
             than two spaces to the cell's own edges. */
          const sp2=Math.max(0.0008,measureTextNorm(" ",a.size,pi)||0.0015);
          /* 6eh — THE PRINTED FIRST LINE IS THE MEASURE, and this is where it went missing.
             A cell that printed on several lines has already told us the width its column wraps at —
             its own top line. 6dl and 6dy grew a wrapping correction to the whole cell instead, which
             is what put one long line hard against the column rule with a two-character stub under it,
             and on a narrower form put the first line THROUGH the rule (measured on the reported page:
             the rules sit at x 279 and 389, the mark's text ran to 391).

             So: if the correction fits on ONE line in the cell, it gets that — a value that no longer
             needs to wrap should not be folded. If it has to wrap, the width is the one the page itself
             demonstrated, and the correction breaks where the printed value broke. */
          /* 6ei — the same ceiling as a single-line cell: what the column is laid out at, with the
             cell as the wall behind it. */
          const raw0=measureTextNorm(String(value),a.size,pi);
          const colMeas2=(box.colTextW>0)?box.colTextW*1.02:null;   // the same tolerance, same reason
          const cap=Math.min(Math.max(full2,cw2),
                             (colMeas2!=null)?Math.max(full2,colMeas2):Math.max(full2,cw2-sp2));
          /* the fit is decided on the text's OWN width — `need2` carries a bleed for the last glyph,
             and testing with it folded a correction that fits by a point, while the identical value in a
             cell that happened to print on ONE line stayed unfolded. Same cell, same value, two answers. */
          const raw=raw0;
          if(raw<=cap) ww=Math.min(need2+sp2*2,cap);   // it fits on one line now: give it one line
          /* it wraps at the COLUMN's measure — the same width every other row in this column wraps at.
             Not at the cell: the cell is measured from the neighbouring ink and on a form with wide gaps
             between columns it reaches past the ruled edge, which is how a one-line mark came to run 14px
             through the rule on the reported page. A value longer than anything the column prints cannot
             be set on one line the way the column is laid out, so it takes the lines the page would take. */
          else ww=cap;
          /* and on a table that centres its column, a mark grown past the run it covers is centred on
             that run — the same as a single line. Left-pinned, the extra width all went on one side, so
             the correction's own text sat off the printed centre by half of it: measured 7.50pt on a
             two-line vendor grown from 40.8pt to 56pt. Coverage is unaffected: the mark is never
             narrower than the printed extent and its left edge never passes the run's. */
          /* 6eb — the same rule as a single line: a centred mark is centred on what it covers. */
          if(((align||"center")==="center")||_colCentred){
            const runC=box.nx+full2/2;
            a.nx=Math.min(box.nx,Math.max(0,runC-ww/2));
          }
          if(a.nx+ww>c2.R)a.nx=Math.max(0,Math.min(box.nx,c2.R-ww));
          if(a.nx<c2.L&&c2.L<=box.nx)a.nx=c2.L;
          if(ww>=cw2-0.0005)a._cellHost=true;
        }
        /* 6dm — and never wider than the cell itself: a printed value that overran its own column used
           to carry the mark out with it */
        if(a.nx+ww>c2.R){ a.nx=Math.max(0,Math.min(a.nx,c2.L)); ww=Math.min(ww,c2.R-a.nx); a._cellHost=true; }
      }
      a.nw=ww;
      /* a value that still does not fit on one line inside the cell wraps, as it always did */
      a.wrap=(need2>ww); a.nowrap=!a.wrap;
    } else {
      const printedFull=(box.x2!=null?box.x2:box.nx+(box.nw||0))-box.nx;        // the printed value
      const textW=measureTextNorm(String(value),a.size,pi)+0.002;
      /* 6cx — the column is the wall. A replacement longer than the printed value used to grow sideways
         until it fitted, which is how a corrected vendor or model ran across its neighbours. When the
         reader tells us where the column is, anything that will not fit WRAPS inside it instead — the
         same thing a two-line cell already did. */
      /* 6db — ONE rule, and a real inset. The column bounds a reader hands back are cut HALFWAY between
         neighbouring columns, so they sit outside the ruled cell by a few points; filling them edge to
         edge is what made a wrapped correction look like it had spilled into the column beside it. */
      /* 6dc — THE rule, and there is only one thing it has to guarantee: the mark is opaque, so wherever
         it lands it must land ON the printed value. 6db placed a correction by its alignment against the
         COLUMN, which is how a redlined "1" -> "0" ended up on the column's left rule with the printed
         "1" still sitting untouched in the middle of the cell. Never again:

           it fits over what it replaces   ->  it covers it WHERE IT SITS, and does not move
           it is wider than that           ->  the mark takes the whole column, so the printed value is
                                               under it either way, and the alignment places the TEXT
           it is wider than the column     ->  the same, wrapped

         "Fits" is measured two ways, because a proportional font makes "0" a hair wider than "1": by
         width, or by character count against the printed value. Either is enough. */
      const hasCol=(box.colL!=null&&box.colR!=null);
      /* 6dm — the CELL, from its ink, not the fence between columns */
      const _cv=hasCol?(cellBounds(pi,box)||stampCover(box)):null;
      const cL=_cv?_cv.L:null, cR=_cv?_cv.R:null;
      const colW=_cv?Math.max(0.01,cR-cL):null;
      /* 6dj — the mark is the size of the VALUE IT REPLACES, and a longer correction WRAPS inside that
         width. This is what you get drawing a redline by hand: the box goes over the printed text, and a
         longer replacement runs onto a second line rather than growing sideways across the cell.

         6dc–6df filled the whole column instead. That covers the printed value, which is why it was done,
         but it also draws a mark two or three times wider than the text it carries — which is what
         "the redline width is too big" is a picture of, on Design Summary, Equipment in Calc and
         RF Inventory alike.

         The one exception is a printed value too small to host the correction — a "-" or a single digit
         standing in for a model. Wrapping a model into the width of a dash gives a column of single
         characters, so there the column is the host and the mark is placed in it. */
      /* 6dl — TWO cases, and only two. The mark is the width of the TEXT when the correction fits over
         the value it replaces, and the width of the CELL — inset a little, so it never touches its
         rules — when it does not. 6dj wrapped a longer correction into the printed value's own width
         instead, which is what broke "NNH4-65B-R6H4-V3" across two lines inside a cell with room for it
         on one: the width of the thing being replaced is not a reason to fold the thing replacing it.
         Wrapping is now the last resort, for a correction too long even for the cell. */
      /* 6dy — ONE rule, and no cliff in it.
         6dl's two cases had a step change between them: "it fits over what it replaces → the width of
         the TEXT; it is longer → the width of the CELL". So a correction ONE CHARACTER longer than the
         printed value stopped being a mark the size of its own text and became a mark filling the whole
         column. Measured on the reference geometry, at the printed 6.5pt:

           MECH TILT   "0"    -> "12"        text 7.7pt    mark 36.7pt   (4.7x its own text)
           RAD CENTER  "285"  -> "287.85"    text 19.1pt   mark 45.7pt
           MODEL   "80010900" -> "SBNHH-1D65C-A2M"  text 60.1pt   mark 83.5pt

         That is the same complaint 6dj was raised for, reintroduced from the other side: 6dj folded
         longer corrections that had room, 6dl stopped folding them and paid for it by widening every
         one of them to its cell.

         Both cases are the same rule once it is written continuously:

             width  = what the text needs
                      never narrower than the printed run it must cover
                      never wider than the cell
             wrap   = only when even the cell is not enough

         Where 6dl was right — the correction fits over what it replaces — this is identical to it, so
         nothing that was already placed correctly moves. Past that point the mark grows by what the
         correction actually needs instead of jumping to the cell. */
      const printedR=box.nx+printedFull;
      /* 6ea — THE RULE, stated in the units the page is set in. A correction longer than the value it
         replaces is wider than that value — it does not fold to match it — and it stops a few spaces
         short of the cell's own edges so it can never bleed into the column beside it.

            width = the correction's own text, with one space of air either side
                    never narrower than the printed run it must cover
                    never closer than two spaces to either edge of the cell
            wrap  = only when the correction will not fit even in that

         Measured in SPACES of the mark's own font rather than in fixed fractions of the page, so the
         clearance reads the same on a 6.5pt table and a 12pt one. 6dz capped a one-line correction at
         the column's own line width instead, which folded `NNH4-65C-R6-HG` onto two lines inside a cell
         with 11pt to spare: matching how the column wraps is not the same as fitting the cell, and it is
         the cell that decides whether a mark bleeds. */
      const spaceW=Math.max(0.0008,measureTextNorm(" ",a.size,pi)||0.0015);
      /* 6eh — ONE space of clearance to the cell's edge, not two. Two spaces on each side is 12% of a
         transposed antenna cell, and it was spending that on nothing: measured, `ANDREW/COMMSCOPE`
         (63.65pt) in a 69.03pt cell was capped at 60.79pt and made to WRAP — a two-line mark in a cell
         with room for one, which is the "too small compared to the cell" on the antenna pages. At one
         space the cap is 64.91pt and it stays on a single line. Half a space, in the end: at one space a
         correction 0.6pt too wide for the cap still folded, leaving two characters alone on line two, and
         the cell it is measured against is now itself held to the midpoint between the columns' ink — so
         the margin protecting the rule is that bound, which is where it belongs, not this number. */
      const AIR=spaceW, CLEAR=spaceW*0.5;
      let want=Math.max(printedFull,textW+AIR*2);
      /* 6ei — THE CEILING IS WHAT THE COLUMN IS LAID OUT AT, not what this one cell has room for.
         `colTextW` is the widest first line the page prints in this column (see assignColMeasures), so it
         is inside the ruled edge by construction and it is the same number for every row — which is what
         makes the same correction in two different sectors come out identical instead of 100px in one and
         123px in the next. The cell is still an absolute wall behind it, for the cells where no measure
         could be taken. */
      /* 6ej — a hair of tolerance on the measure. It is read off the PDF's own text extents while the
         wrap is computed with canvas metrics, and although the two agree to a median of 1.000 they
         differ in the last fraction of a point — enough that a value the page fit at that width broke a
         character earlier here. 2% is a fraction of a character, and the cell still bounds it. */
      const colMeas=(box.colTextW>0)?box.colTextW*1.02:null;
      const ceil=(colMeas!=null)?Math.max(printedFull,colMeas)
                :(colW!=null?Math.max(printedFull,colW-CLEAR*2):null);
      if(ceil!=null)want=Math.max(printedFull,Math.min(want,ceil));
      if(colW!=null)want=Math.min(want,Math.max(printedFull,colW));
      /* 6dk — WHERE it sits. Pinning the LEFT edge is right for a table whose column is read from the
         left, and wrong for one that centres its column: when the replacement is wider than the run it
         covers — "0" over the "-" the as-built columns print — a left-pinned mark carries its text half
         the width difference to the right, which is the ~1pt the redlined "0" stood clear of the Design
         "0" above it. Centred on the printed value it still covers it completely, because it is the
         wider of the two. With no column to speak of, the printed run is the only thing to aim at. */
      /* 6eb — A CENTRED MARK IS CENTRED ON WHAT IT COVERS. This asked `_colCentred`, a flag the caller
         sets only where the table is KNOWN to centre its column — the transposed antenna pages. Every
         other table fell through to "pin the left edge", so a correction longer than the value it
         replaces grew rightwards only, and its text — centred inside the box, which is what align:center
         means — came to rest right of the column that every other value in that column shares.

         Measured on the reference form, correcting an 11-character model to a 14-character one:

            Design Summary  every printed value in the Model column centres on 246.50
                            the correction's text centred on 251.84      +5.34pt
            RF Inventory    every printed value centres on 219.00
                            the correction's text centred on 225.23      +6.23pt

         `textDx` was already trying to pull it back and could only reach 2pt of it, because a mark that
         hugs its own text has almost no room to nudge the text inside it. The box is what has to move.

         The rule needs no flag: if the mark's text is CENTRED in its box, the box belongs centred on the
         run, because any other placement puts the text off the value. A left-aligned mark still pins its
         left edge — that is what left alignment is for, and the length rule still chooses it. */
      const centreOnRun=((align||"center")==="center")||_colCentred;
      let nx=centreOnRun?(box.nx+printedFull/2-want/2):box.nx;
      if(cR!=null&&nx+want>cR)nx=cR-want;          // never out of the cell on the right
      if(cL!=null&&nx<cL)nx=cL;                    // nor on the left
      if(nx>box.nx)nx=box.nx;                      // and never off the printed run's own left edge
      a.nx=Math.max(0,nx);
      a.nw=Math.max(want,printedR-a.nx);           // whatever the clamps did, the run stays covered
      a.wrap=(textW>a.nw+1e-6); a.nowrap=!a.wrap;
      if(colW!=null&&a.nw>=colW-0.0005)a._cellHost=true;
    }
    /* 6de — whatever off-centre is left after balancing the cover is taken out of the text itself. The
       glyphs are centred in the mark, so a mark that had to stay lopsided (its printed value overruns the
       column) would otherwise carry its text off the middle of the cell. `textDx` moves only the text,
       never the cover, and is clamped to the room actually available inside the mark. */
    /* 6dr — HOW MANY LINES THE MARK ACTUALLY CARRIES.
       The wrapped layout divides the mark's height by `a.lines` to get a line height, and `a.lines` was
       whatever the PRINTED value used. A correction longer than what it replaces needs more lines than
       that, so each line was given too much room and the text ran out of the bottom of its own mark —
       which is the wrapping that "does not work well" on the auto redlines. Count the lines from the
       text and the width it has to fit in, and give the mark the height to hold them. Erring high by a
       line costs a little space; erring low leaves the printed value showing through. */
    a.pLines=Math.max(1,box.lines||1);          /* 6ds — the floor a reflow may never go below */
    if(a.wrap&&a.nw>0){
      const tw=measureTextNorm(String(value),a.size,pi);
      /* 6eg — count the lines by RUNNING the wrap, not by dividing the text width by the box. The
         division cannot see where the value is allowed to break, so on a hyphenated model it read
         high or low by a line depending on where the breaks happened to fall; the greedy fill here is
         the same one the screen and the export perform, so the count is the count. */
      /* 6eh — the text wraps in the BOX. 6eg wrapped it in a narrower "balanced" box centred inside
         the cover, and that is what made a correction render a quarter narrower than the printed values
         around it, with a visible indent either side. A mark is the width the rule below gives it and
         the text uses all of it, the way the printed cell does. */
      const need=Math.max(1,redlineWrapLines(String(value),a.size,pi,a.nw).length);
      const printedLines=Math.max(1,box.lines||1);
      const lineNh=(a.lineNh!=null?a.lineNh:((box.y2-box.ny)/printedLines))||0.011;
      a.lines=Math.max(printedLines,need);
      const wantH=lineNh*a.lines;
      if(wantH>(a.nh||0))a.nh=wantH;
      if(need>printedLines)LOG("wrap: "+JSON.stringify(String(value))+" needs "+need+
                               " line(s) in a cell that printed "+printedLines+" — mark grown to fit");
    }
    a.textDx=0;
    /* 6dm — a mark that IS the cell is already centred in it; nudging it toward the fence's own middle
       (which is not the cell's) would put the text back off centre.
       6dv — EXCEPT on a table that centres its column. Now that a cell is measured from its neighbours
       it is not symmetric about the printed value, so centring the text in the cell is no longer the
       same as centring it on the value — which is what put the antenna as-built figures 15pt off. Those
       marks still aim at the printed run. */
    /* 6dw — and this applies to ANY centred mark that fills its cell, not just the transposed tables.
       A cell measured from its neighbours is not symmetric about the printed value, so centring the text
       in the cell is not the same as centring it on the value — which is why the Calculated RAD Center
       correction sat left of the "59" it replaced. Whenever there is a printed run to aim at, aim. */
    /* 6dy — and it applies to a mark sitting AT the printed run's left edge too. The gate required the
       mark to have been moved off that edge, so the one case it never ran on was the commonest one: a
       mark grown a little past the value it covers and pinned to its left, whose centred text then sat
       half the difference to the right of the value. Where the mark is already centred on the run the
       nudge computes to zero, so lifting the gate changes nothing that was right. */
    if((align||"center")==="center"&&box.colL!=null&&box.colR!=null&&!a.wrap){
      /* 6dk — what the text is centred ON. The column bounds are cut halfway between neighbouring
         columns, so the column's own middle is close to, but not exactly, where the page sets its
         values: measured across the reference RFDS the printed runs sit at 0.501–0.512 of the column,
         about a point off centre. On a table we know centres its column, aim at the PRINTED value
         instead — it is the thing the eye compares the redline against, and it is exact. */
      const printedC=(!box.synth&&(box.nw||box.x2!=null))
        ? box.nx+(((box.x2!=null?box.x2:box.nx+(box.nw||0))-box.nx)/2)
        : null;
      const cc=printedC!=null?printedC:(box.colL+box.colR)/2;
      const tw2=measureTextNorm(String(value),a.size,pi);
      const room=Math.max(0,(a.nw-Math.min(tw2,a.nw))/2);
      let d=cc-(a.nx+a.nw/2);
      if(d>room)d=room; if(d<-room)d=-room;
      if(Math.abs(d)>0.0002)a.textDx=d;
    }
    a.manualW=true; a.fullcell=true;
    /* Treat this as a cell redline like any other: without onCell it skipped the vertical centring AND
       the drop, which is why Design Summary MODEL redlines sat differently from every other mark. */
    a.onCell=true;
    if(a.cw==null)a.cw=cellBoxWidth(box);
    if(a.tx0==null)a.tx0=box.nx;
    a.align=align||"center"; a.alignSet=true;
    /* addText already laid this element out, before wrap/height/size were known — mark it for a
       re-layout so the value actually breaks onto its second line */
    _needRelayout=true;
    if(_azApplying){ a.fromAnalyze=true; a.cx0=box.nx; a.cy0=box.ny; }
  }
  return id;
}
/* ---------- undo / redo ---------- */
function _cleanA(a){ return { id:a.id, page:a.page, fixFree:a.fixFree, nx:a.nx, ny:a.ny, nw:a.nw, text:a.text, orig:a.orig, align:a.align, size:a.size, kind:a.kind, src:a.src, nh:a.nh, lineNh:a.lineNh, wrap:a.wrap, lines:a.lines, alignSet:a.alignSet, alignUser:a.alignUser, onCell:a.onCell, nowrap:a.nowrap, fullcell:a.fullcell, cw:a.cw, tx0:a.tx0, cellL:a.cellL, cellR:a.cellR, manualW:a.manualW, group:a.group, rot:a.rot, z:a.z, under:a.under, fromAnalyze:a.fromAnalyze, cx0:a.cx0, cy0:a.cy0, colCentred:a.colCentred, textDx:a.textDx, pLines:a.pLines,
  /* A MARK'S OWN LOOK. Until now one colour pair in the ribbon painted every mark on the document,
     which is fine for a form where every correction is the same red and no use at all on a drawing
     sheet, where a callout box, a cloud round a member and a note each want their own. Every one of
     these is per mark, and every one of them survives an export and a reopen.
        shape   "rect" | "ellipse" — a bordered box or an ellipse; absent means a plain text mark
        col     stroke / text colour          sw      stroke thickness in points
        fill    interior colour               fillOp  interior opacity, 0..1
        bg      the ground behind text        maKind  what the mark is FOR (callout, note, fix …) */
  shape:a.shape, col:a.col, sw:a.sw, fill:a.fill, fillOp:a.fillOp, bg:a.bg, bgNone:a.bgNone, font:a.font,
  box:a.box, maKind:a.maKind,
  /* 6k4 — which line of a COP stamp this mark is. The stamp IS its group; `copRole` is what says
     the group is a stamp and not any other grouped set of marks, so it has to survive a snapshot,
     an undo, an autosave and a reopen or re-dating a reopened document would find nothing. */
  copRole:a.copRole, padIn:a.padIn, userSized:a.userSized,
  /* 6f6 — the rest of what a tool's properties panel can set. `colOp` is the ink's own opacity (the
     slider under the swatches), `under`/`strikeout` the two text decorations, `valign` where the text
     sits in a box, `dash` the rule's pattern, `pat`/`patCol`/`patScale`/`patRot` a hatched interior,
     `hl` highlight (multiply) mode. All optional — a mark without them draws exactly as before. */
  colOp:a.colOp, strikeout:a.strikeout, uline:a.uline, valign:a.valign, dash:a.dash,
  /* 6he — the two text spacings: tracking in points, leading as a multiple of the normal pitch */
  lsp:a.lsp, lnsp:a.lnsp,
  /* 6hp — the pattern the RULE of a shape is drawn with: a cloud round a member, a wave, a zigzag */
  lpat:a.lpat, wrapMode:a.wrapMode, join:a.join,   /* 6jw — its corner style */
  /* 6i6 — a mirrored picture */
  flipX:a.flipX, flipY:a.flipY,
  /* 6hh — the height a text box was DRAWN at, which is the floor it grows back down to */
  minNh:a.minNh,
  pat:a.pat, patCol:a.patCol, patScale:a.patScale, patRot:a.patRot, patOp:a.patOp, hl:a.hl,
  /* 6fb — what the selection bar sets: a label, a lock, and whether it burns into the page */
  subj:a.subj, lock:a.lock, flat:a.flat,
  /* 6gg — a length's reading: where the hand put it, if the hand moved it */
  dimFree:a.dimFree, dimOff:a.dimOff,
  /* 6gk — WHAT A PICTURE IS ALREADY INKED WITH. Without this a copied, duplicated, undone or
     re-opened snapshot looked like a picture whose colour had just been changed, so the tint pass ran
     over it again — Ced: "the result, if copy and pasted, should not change looks". */
  _tintCol:a._tintCol,
  /* 6gs — the picture as it was first made, so Restore in the picture editor can bring it back after
     a save or a copy — and so an edit is never one-way.
     6le — THIS LIST IS ALSO WHAT GOES IN THE FILE, and `srcOrig` and `picRaw` below hold a whole
     picture each. They belong here, because a snapshot, an undo, a copy and the browser autosave all
     want them and all live in memory. They must NOT reach the exported PDF: `_stripPicBytes` takes
     them out of the payload and out of every tag on the way, and `PIC_FIELDS` is the list to add to
     if a fourth field ever holds pixels. */
  srcOrig:a.srcOrig,
  /* 6jb — the picture WITHOUT its frame, and how much of the box the frame takes. Kept with the mark
     so the width can still be changed, or the frame taken off, after a save and a reopen.
     6le — the three small numbers travel in the file; the picture does not. `maPicRawOf` crops it back
     out of the framed pixels, which is exact, so nothing is lost by leaving it behind. */
  picRaw:a.picRaw, _frPadX:a._frPadX, _frPadY:a._frPadY, _frKey:a._frKey,
  /* 6jc — which named layer it belongs to */
  lay:a.lay }; }
/* A stroke carries its own look too, and a polyline carries its points: `pts` is an array of
   [x,y] pairs in normalised page units, and when it is present x1..y2 are only its bounding ends. */
function _cleanL(l){ return { id:l.id, page:l.page, x1:l.x1, y1:l.y1, x2:l.x2, y2:l.y2, group:l.group,
  /* 6gg — the reading this measurement owns, the scale it was measured at, and how it is written */
  dimFor:l.dimFor, dimScale:l.dimScale, dimUnit:l.dimUnit, dimPrec:l.dimPrec, dimManual:l.dimManual,
  coFor:l.coFor, coOff:l.coOff, coLen:l.coLen,   /* 6g9/6ga — the callout this leader
     belongs to, and where along its side the stub leaves it */
  fromAnalyze:l.fromAnalyze, col:l.col, sw:l.sw, arrow:l.arrow, pts:l.pts, maKind:l.maKind,
  /* 6f6 — `le0`/`le1` are the endings the Line panel sets, one per end, and they supersede `arrow`
     (which is kept so every older file still reads). `dash` is the line style, `colOp` the stroke's
     opacity, `hl` highlight mode. */
  le0:l.le0, le1:l.le1, leSz:l.leSz, join:l.join, dash:l.dash, lpat:l.lpat, colOp:l.colOp, hl:l.hl,
  /* 6g1 — a polyline that closed on itself, and the interior it took */
  closed:l.closed, fill:l.fill, fillOp:l.fillOp, pat:l.pat, patCol:l.patCol,
  patScale:l.patScale, patRot:l.patRot, patOp:l.patOp,
  /* 6ib — a stroke has a band and a place in it, exactly as a mark does */
  under:l.under, z:l.z,
  subj:l.subj, lock:l.lock, flat:l.flat,
  lay:l.lay }; }   /* 6jc — its named layer */
function snapshot(){ return JSON.stringify({annos:S.annos.map(_cleanA),lines:S.lines.map(_cleanL)}); }
/* A batch of related edits should be ONE undo step. addText pushes its own entry, so a Copy row of nine
   runs produced ten — Ctrl+Z then undid one value at a time instead of the whole copy. Inside a batch the
   pushes are suppressed; the caller takes a single snapshot first. */
let _histBatch=0;
function pushHistory(){
  if(_histBatch>0)return;
  S.history.push(snapshot()); if(S.history.length>80)S.history.shift(); S.future=[]; updateUndoUI(); autosave();
}
function historyBatch(fn){
  pushHistory();                 // one entry for the whole batch
  _histBatch++;
  try{ return fn(); }
  finally{ _histBatch=Math.max(0,_histBatch-1); updateUndoUI(); autosave(); }
}
function restore(str){ const o=JSON.parse(str); S.annos=o.annos||[]; S.lines=o.lines||[]; S.sel=null; layoutAnnos(); drawAllLines(); applySuggestions&&applySuggestions(); updateRail(); updateCount(); updateUndoUI(); autosave(); }
function undo(){ if(!S.history.length)return; S.future.push(snapshot()); restore(S.history.pop()); }
function redo(){ if(!S.future.length)return; S.history.push(snapshot()); restore(S.future.pop()); }
function updateUndoUI(){ const u=document.getElementById("undoBtn"),r=document.getElementById("redoBtn"); if(u)u.disabled=!S.history.length; if(r)r.disabled=!S.future.length; }

/* ---------- autosave / crash-recovery ---------- */
/* =================================================================================================
   6fy — THE CACHE IS KEYED ON THE DOCUMENT, NOT ON THE FILE NAME.

   Ced: "reopening the same pdf does not show recover anymore." Measured end to end, with a real Export
   in the loop, which is how the tool is actually used:

       work on ohl_prelim.pdf                          -> key rfds_autosave:ohl_prelim   (15,996 bytes)
       export as "OHL01029 - Redlined Preliminary RFDS.pdf"
       reopen the ORIGINAL                             -> prompts
       reopen the EXPORT                               -> key rfds_autosave:exported_loop -> NOTHING

   The key was the file's name. Every export renames the document, and from that point on the file you
   open is the export — so every reopen looks under a key that has never been written, and nothing is
   ever offered. To the person doing the work it is the same PDF: same site, same redlines, one more
   round. To the tool it was a different document every time.

   A document is its CONTENT. The page count and the printed text of its first three pages identify it
   across any number of renames, and — measured on the pair above — an export does not change them,
   because redlines are annotations rather than page text:

       ohl_prelim.pdf      51 pages, sig hash 706144094
       exported_loop.pdf   51 pages, sig hash 706144094

   A transfer onto a genuinely different final gives a different hash, which is correct: that IS a
   different document. The old name-keyed entries are still read (see `legacyKeys`) so nothing saved
   before this build becomes unreachable.
   ================================================================================================= */
function _docSig(){
  try{
    const n=(S.pages||[]).length;
    if(!n)return null;
    let sig=String(S.doc?S.doc.numPages:n);
    for(let i=0;i<Math.min(3,n);i++){
      const P=S.pages[i];
      sig+="#"+((P&&P.items)||[]).map(t=>String(t.str==null?"":t.str).replace(/\s+/g,"").toUpperCase()).join("");
    }
    let h=0;
    for(let i=0;i<sig.length;i++){ h=((h<<5)-h+sig.charCodeAt(i))|0; }
    return "d"+(h>>>0).toString(36)+"-"+(S.doc?S.doc.numPages:n);
  }catch(e){ return null; }
}
function docKey(){ return _docSig()||("n"+(S.name||"doc")); }
function saveKey(){ return "ma_autosave:"+docKey(); }
function verKey(){ return "ma_versions:"+docKey(); }
/* what this document would have been keyed as before 6fy, so work saved then is still offered */
function legacyKeys(kind){
  const out=[];
  if(S.name)out.push("ma_"+kind+":"+S.name);
  return out;
}
// storage adapter: prefer artifact window.storage, fall back to localStorage.
// After the first window.storage failure, stick to localStorage for the rest of
// the session (avoids repeated server round-trips + log spam on every autosave).
const store={
  _useLocal:false, _warned:false,
  _note(){ if(!this._warned){ this._warned=true; LOG&&LOG("Cloud storage unavailable — saving to this browser instead. Your redlines and Analyze edits are still being saved locally."); } },
  async set(k,v){
    if(!this._useLocal && window.storage&&window.storage.set){
      try{ await window.storage.set(k,v); return; }
      catch(e){ this._useLocal=true; this._note(); }
    }
    try{ localStorage.setItem(k,v); }
    catch(e){ throw new Error("Browser storage is full or blocked ("+(e&&e.message||e)+")"); }
  },
  async get(k){
    let cloud=null, local=null;
    if(!this._useLocal && window.storage&&window.storage.get){
      try{ const r=await window.storage.get(k); if(r&&r.value!=null)cloud=r.value; }
      catch(e){ this._useLocal=true; this._note(); }
    }
    try{ local=localStorage.getItem(k); }catch(e){}
    if(cloud!=null && local!=null){
      return _tsOf(local)>_tsOf(cloud) ? local : cloud;   // whichever was saved most recently
    }
    return cloud!=null ? cloud : local;
  },
  /* 6dk — the two halves of "forget what you saved". Both sides are swept, because a session can have
     written to either: window.storage while it was reachable, localStorage after it stopped being. */
  async keys(prefix){
    const out=new Set();
    if(!this._useLocal && window.storage&&window.storage.list){
      try{ const r=await window.storage.list(prefix); (r&&r.keys||[]).forEach(k=>out.add(k)); }
      catch(e){ this._useLocal=true; this._note(); }
    }
    try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i);
           if(k&&k.indexOf(prefix)===0)out.add(k); } }catch(e){}
    return [...out];
  },
  async remove(k){
    let ok=false;
    if(!this._useLocal && window.storage&&window.storage.delete){
      try{ await window.storage.delete(k); ok=true; }catch(e){}
    }
    try{ localStorage.removeItem(k); ok=true; }catch(e){}
    return ok;
  },
};
/* ================================================================================================
   6fz — WHAT GETS STORED, AND WHAT GETS GIVEN UP FIRST WHEN THERE IS NO ROOM.

   Ced, on the artifact and on Vercel:

       Save failed: Browser storage is full or blocked (Failed to execute 'setItem' on 'Storage':
       Setting the value of 'rfds_autosave:d143kloe-51' exceeded the quota.)

   Measured on OHL01029 with a full analysis, before changing anything:

       the redlines          15,461 bytes     36 marks + 1 line — THE WORK
       the analysis       1,439,151 bytes     portLevel, antennaExisting, designSummary, …
       the whole payload  1,454,812 bytes     stored verbatim, uncompressed
       the browser quota  ~5,200,000 bytes

   The thing that matters is ONE PERCENT of what was being stored. Three or four documents and the
   quota is gone — after which the tool saved NOTHING, including the 15KB that cannot be rebuilt,
   and said so by quoting a DOM exception at a person who cannot act on one.

   Two changes, in that order of importance:

   1 · PACK IT. The payload is JSON full of repeated keys; gzip takes it down by roughly an order of
       magnitude. Stored as `gz1:<ts>:<base64>` — the timestamp stays in the clear so the
       cloud-versus-local "whichever is newer" comparison in `store.get` stays cheap and synchronous.
       Anything written before this build is still plain JSON and still reads (see `_lsUnpack`).

   2 · WHEN IT STILL WILL NOT FIT, SHED IN THE RIGHT ORDER. The analysis goes first, always, because
       the Analyze button rebuilds it in seconds and nothing else here can be rebuilt at all. Only
       then are other documents' entries evicted — their version backups before their autosaves,
       oldest first — and this document's own backups last. The redlines are never what is given up.
   ================================================================================================ */
const SAVE_MARK="gz1:";
function _b64enc(u8){
  let s=""; const CH=0x8000;
  for(let i=0;i<u8.length;i+=CH) s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
  return btoa(s);
}
function _b64dec(b64){
  const s=atob(b64), u8=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)u8[i]=s.charCodeAt(i);
  return u8;
}
async function _lsPack(obj){
  const json=JSON.stringify(obj);
  if(typeof CompressionStream!=="function")return json;   // old browser: store it plain, as before
  try{
    const ts=(obj&&!Array.isArray(obj)&&obj.ts)||Date.now();
    const cs=new CompressionStream("gzip"), w=cs.writable.getWriter();
    w.write(new TextEncoder().encode(json)); w.close();
    const buf=new Uint8Array(await new Response(cs.readable).arrayBuffer());
    const packed=SAVE_MARK+ts+":"+_b64enc(buf);
    return packed.length<json.length ? packed : json;     // never pay for packing something tiny
  }catch(e){ return json; }
}
async function _lsUnpack(raw){
  if(raw==null)return null;
  const s=String(raw);
  if(s.indexOf(SAVE_MARK)!==0)return JSON.parse(s);        // written before 6fz, or stored plain
  const ds=new DecompressionStream("gzip"), w=ds.writable.getWriter();
  w.write(_b64dec(s.slice(s.indexOf(":",SAVE_MARK.length)+1))); w.close();
  return JSON.parse(await new Response(ds.readable).text());
}
/* when an entry was written, without unpacking it */
function _tsOf(raw){
  try{
    const s=String(raw);
    if(s.indexOf(SAVE_MARK)===0)return parseInt(s.slice(SAVE_MARK.length),10)||0;
    const o=JSON.parse(s);
    return (o&&o.ts)||(Array.isArray(o)&&o.length&&o[o.length-1].ts)||0;
  }catch(e){ return 0; }
}
/* Store `obj` under `key`, giving things up in order until it fits. Returns what it had to give up
   so the caller can say so — a save that quietly dropped the analysis and a save that did not are
   not the same event, and the person should be told which one happened. */
async function saveObj(key,obj){
  const shed=[]; let last=null;
  try{ await store.set(key, await _lsPack(obj)); return {ok:true,shed:shed}; }
  catch(e){ last=e; }

  // 1 · the analysis: 99% of the bytes, and pressing Analyze brings it back
  if(obj && obj.analysis){
    const lean=Object.assign({},obj); delete lean.analysis; lean.analysisShed=true;
    obj=lean;
    try{ await store.set(key, await _lsPack(obj)); shed.push("analysis"); return {ok:true,shed:shed}; }
    catch(e){ last=e; shed.push("analysis"); }
  }

  // 2 · other documents: their backups before their live work, oldest first
  const vers=[], autos=[];
  for(const pfx of SAVE_PREFIXES){
    let ks=[]; try{ ks=await store.keys(pfx); }catch(e){}
    for(const k of ks){
      if(k===key||k===saveKey()||k===verKey())continue;    // never the document in front of us
      let raw=null; try{ raw=await store.get(k); }catch(e){}
      (pfx==="ma_versions:"?vers:autos).push({k:k,ts:_tsOf(raw)});
    }
  }
  const byAge=(a,b)=>a.ts-b.ts;
  for(const v of vers.sort(byAge).concat(autos.sort(byAge))){
    try{ await store.remove(v.k); }catch(e){ continue; }
    shed.push(v.k);
    try{ await store.set(key, await _lsPack(obj)); return {ok:true,shed:shed}; }catch(e){ last=e; }
  }

  // 3 · this document's own backups, last of all
  try{
    await store.remove(verKey()); shed.push(verKey());
    await store.set(key, await _lsPack(obj)); return {ok:true,shed:shed};
  }catch(e){ last=e; }

  return {ok:false, shed:shed, err:last};
}
/* ------------------------------------------------------------------------------------------------
   Clear saved markings.
   The tool keeps every document's redlines in the browser so a refresh or a crash cannot lose them,
   and offers them back the next time that PDF is opened. That is the right default and the wrong one
   to be stuck with: a stale session from a previous version of the same RFDS gets offered against the
   new one, and there was no way to say no permanently. This empties BOTH stores of everything the tool
   has written — autosaves and the rolling version backups — for every document, not just this one.

   What it does not touch: the document open in front of you, or your appearance settings. Clearing the
   cache and then losing the marks you can see would be a trap; the marks stay until you leave the page.
   ------------------------------------------------------------------------------------------------ */
const SAVE_PREFIXES=["ma_autosave:","ma_versions:"];
async function savedMarkingKeys(){
  const all=[];
  for(const p of SAVE_PREFIXES){ (await store.keys(p)).forEach(k=>all.push(k)); }
  return all;
}
async function clearSavedMarkings(){
  let keys=[];
  try{ keys=await savedMarkingKeys(); }
  catch(e){ setStatus("Could not read what is saved: "+(e&&e.message||e),true); return; }
  if(!keys.length){ setStatus("Nothing is saved in this browser — there was no cache to clear."); toast("Nothing saved"); return; }
  /* 6fy — the key is a content fingerprint now, so it is not a name. The document's name is inside the
     payload; read it, and fall back to the key only when the payload will not parse. */
  const names=[];
  for(const k of keys){
    let nm=null;
    try{ const raw=await store.get(k); if(raw){ const o=await _lsUnpack(raw);
           nm=(o&&o.name)||((Array.isArray(o)&&o.length&&o[0].label)||null); } }catch(e){}
    names.push(nm||k.replace(/^rfds_(autosave|versions):/,""));
  }
  const docs=[...new Set(names)];
  const shown=docs.slice(0,6).join(", ")+(docs.length>6?" and "+(docs.length-6)+" more":"");
  const ans=await uiConfirm({
    title:"Clear saved markings?",
    message:"This browser is holding saved redlines for "+docs.length+" document"+(docs.length===1?"":"s")+":\n"+
            shown+"\n\nClearing them means a document opens clean instead of offering an old session back. "+
            "It cannot be undone, and it does not touch the redlines on screen right now — export first if "+
            "you still need them.",
    buttons:[{id:"no",label:"Keep them",primary:true},{id:"yes",label:"Clear saved markings",danger:true}]
  });
  if(ans!=="yes")return;
  let gone=0,failed=0;
  for(const k of keys){ try{ (await store.remove(k))?gone++:failed++; }catch(e){ failed++; } }
  LOG("Clear saved markings:",gone,"key(s) removed",failed?", "+failed+" could not be removed":"");
  /* 6ga — nothing is saved any more, so the ribbon must stop claiming a last-saved time. Saying
     "Last saved 6:53 PM" next to a cache that was just emptied is exactly the wrong reassurance. */
  clearSavedReadout();
  _pill("✕",1600,"bad","Saved markings cleared — nothing is saved in this browser now");
  setStatus("Cleared "+gone+" saved entr"+(gone===1?"y":"ies")+" for "+docs.length+" document"+
            (docs.length===1?"":"s")+(failed?" — "+failed+" could not be removed":"")+
            ". The redlines on screen are untouched; they will be saved again as you work.");
  toast("Saved markings cleared");
}
function cleanAnnos(){ return S.annos.map(_cleanA); }
function cleanLines(){ return S.lines.map(_cleanL); }
function savePayload(){ return { name:S.name, pages:S.doc?S.doc.numPages:0, annos:cleanAnnos(), lines:cleanLines(), seq, ts:Date.now(),
  analysis:S.analysis, atollName:S.atollName, location:S.location, isPreliminary:S.isPreliminary,
  /* 6jc — the document's named layers and which one is being drawn into */
  layers:S.layers, layCur:S.layCur,
  stamp:{tcol:$("#c_text").value,bcol:$("#c_bg").value} }; }
/* ================================================================================================
   6ga — THE SAVE INDICATOR IS A CHECK MARK, AND THE RIBBON SAYS WHEN THE WORK WAS LAST SAVED.

   Ced: "show the saved mark on the ribbon when saving also, make it minimal, just check mark instead
   of showing saved. also add in ribbon Last Saved: [time and date]".

   The pill is glanced at, never read — "saved ✓" says the same thing twice, and the tick alone says it
   in a sixth of the width. What the word was really carrying is *when*, and a flash that has already
   faded cannot answer that; a permanent "Last saved" can, so the two go together.

   One rule the tick must not break: a check mark that is sometimes a lie is worse than the word it
   replaced. A save that had to shed the analysis is amber, a save that could not happen is a red ✕, and
   both carry the reason on hover. Only a clean save is a green tick.
   ================================================================================================ */
/* 6gb — there are TWO copies of the readout, one above the ribbon and one inside it for page view, and
   only one of them is on screen at a time. Everything here writes to every copy rather than to an id:
   an indicator that is right in one place and stale in the other is worse than having only one. */
function _saveEls(sel){ return [...document.querySelectorAll(sel)]; }
/* 6gd — THE CHECK IS A STATUS NOW, NOT A FLASH, and this reverses 6ga on purpose.
   Ced: "the check should not fade away, it should retain if it was saved."
   He is right, and the earlier reading was thin: a tick that fades tells you a save happened at some
   moment you may have missed, and then tells you nothing. Standing, it answers the question actually
   being asked — IS MY WORK SAVED — and it keeps answering it. The momentary "that just landed" job
   belongs to the flash (`saveFlash`), which is the one thing that should come and go.
   The `ms` argument is kept and ignored for the pill; callers still pass it and the flash still uses it. */
/* 6gl — AND THE COPY ON THE QUICK BAR IS A FLASH AGAIN, which is not a reversal of the paragraph above
   but a split of it. Ced: "when the minibar is on, no need to prompt the check when saved on the left
   side, but make sure this is the same logic on the minibar (fades in and out every saving)."
   The two indicators answer two different questions and 6gb already knew that — it is only that both
   answers were being given in the same place twice. The standing tick on the RIBBON keeps saying "your
   work is saved" for as long as that is true, exactly as 6gd settled. The momentary "that just landed"
   moves off the floating box in the upper-left corner and onto the bar's own tick, where the eye
   already is. When the bar is up the floating flash stands down entirely, because a thing said twice in
   two corners is noise. When the bar is NOT up — page view, a wide window with the ribbon on top and
   nothing scrolled — the floating flash is the only one there is, so it still does the job. */
function _barUp(){
  const b=document.getElementById("miniBar");
  if(!b)return false;
  const r=b.getBoundingClientRect();
  return r.width>0 && r.height>0 && getComputedStyle(b).display!=="none";
}
function _pill(txt,ms,tone,why){
  const ps=_saveEls(".savePill"); if(!ps.length)return;
  ps.forEach(p=>{
    p.textContent=txt;
    p.classList.remove("warn","bad");
    if(tone)p.classList.add(tone);
    p.title=why||(tone?"":"Saved to this browser");
    p.classList.add("on");
    clearTimeout(p._t);            /* on the ribbon nothing clears it: the next save state replaces it */
    if(p.closest("#miniBar")){
      /* the bar's copy fades back out on its own, every save, like the flash it replaces */
      p._t=setTimeout(()=>{ p.classList.remove("on"); }, tone ? 2600 : 1500);
    }
  });
  if(!_barUp())saveFlash(txt,tone,why);
}
/* 6gb — THE SAVE FLASH. Ced: "every time the pdf marks is saved, it should fade in the ui on the upper
   left of the screen." It answers a different question from the ribbon readout: the readout is a
   standing answer to "when was this saved", the flash is a momentary "that just landed" that you can
   see without looking away from the page you are marking. Same three states, same honesty rule — a
   clean save is a bare tick, anything else says what happened, because a floating green tick that
   appears when nothing was saved would be the worst lie in the tool. */
let _flashT=null;
function saveFlash(mark,tone,why){
  const box=document.getElementById("saveFlash"); if(!box)return;
  const m=document.getElementById("saveFlashMark"), t=document.getElementById("saveFlashTxt");
  if(m)m.textContent=mark||"✓";
  if(t)t.textContent = tone==="bad" ? "Not saved" : (tone==="warn" ? "Saved · trimmed" : "");
  box.classList.remove("warn","bad");
  if(tone)box.classList.add(tone);
  box.title=why||"";
  box.classList.add("show");
  clearTimeout(_flashT);
  _flashT=setTimeout(()=>box.classList.remove("show"), tone ? 2600 : 1500);
}
/* when the work was last saved. Kept in S so a reopen can show the time the RESTORED session was saved
   rather than pretending the work is older or newer than it is. */
function _fmtSaved(ts){
  const d=new Date(ts);
  if(isNaN(d))return "";
  const t=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  const today=new Date();
  const sameDay=d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();
  return sameDay ? t : d.toLocaleDateString([],{day:"numeric",month:"short"})+" "+t;
}
function markSaved(ts){
  S.lastSaved=ts||Date.now();
  const txt=_fmtSaved(S.lastSaved);
  const title="Last saved "+new Date(S.lastSaved).toLocaleString()+"\n"+BUILD_ID;
  _saveEls(".lastSaved").forEach(el=>{
    if(!txt){ el.hidden=true; return; }
    /* 6gc — on the compact bar the words go and a clock glyph (in CSS) stands in for them: Ced asked
       that bar for icons only. Everywhere else it still reads "Last saved 8:04 PM" in full. */
    const onBar=!!(el.closest&&el.closest("#miniBar"));
    el.textContent=onBar?txt:("Last saved "+txt);
    el.title=title;
    el.hidden=false;
  });
}
/* nothing is saved: every copy stops claiming a time */
function clearSavedReadout(){
  S.lastSaved=null;
  _saveEls(".lastSaved").forEach(el=>{ el.hidden=true; });
}
/* what a save had to give up, in words a person can act on */
function _shedNote(shed){
  if(!shed||!shed.length)return "";
  if(shed.indexOf("analysis")>=0)
    return " This browser was nearly full, so the Analyze results were left out to make room — press "+
           "Analyze to rebuild them. Your redlines are saved.";
  return " This browser was nearly full, so "+shed.length+" older saved entr"+
         (shed.length===1?"y was":"ies were")+" cleared to make room.";
}
let _saveT=null;
/* v60 — `now` skips the half-second debounce: guard.js passes it when the tab is being hidden or
   closed, or when something has just gone wrong. `S._savePending` is what the close warning reads. */
function autosave(now){
  if(!S.doc)return;
  clearTimeout(_saveT);
  S._savePending=true;
  _saveT=setTimeout(async()=>{
    let r;
    try{ r=await saveObj(saveKey(), savePayload()); }
    catch(e){ r={ok:false, err:e, shed:[]}; }
    finally{ S._savePending=false; }
    if(r.ok){
      markSaved();
      if(r.shed.length){ _pill("✓",1600,"warn","Saved — but this browser was nearly full."+_shedNote(r.shed));
                         LOG&&LOG("Autosave: storage was full — gave up",r.shed.join(", "));
                         /* 6gn — AND SAY IT WHERE IT CAN BE READ. Ced asked "why did the last saved
                            check became orange", which is the tool having changed colour without
                            saying why: amber is the save that only fit because something was thrown
                            away, and the reason was in a tooltip on a 20px tick. The manual path has
                            always written it to the status line; the autosave path only logged it.
                            Same fact, both places, on both paths. */
                         setStatus("Saved — but this browser was nearly full."+_shedNote(r.shed)); }
      else _pill("✓");
    }else{
      _pill("✕",2500,"bad","Not saved — this browser's storage is full. Export the PDF to keep these "+
            "redlines, or use Clear saved markings to free space.");
      LOG&&LOG("Autosave: this browser has no room left ("+(r.err&&r.err.message||r.err)+")");
    }
  },now===true?0:500);
}
/* Version backups, capped by SIZE and not only by a count of 20. Twenty backups of a heavily marked
   document ran to 310KB on their own — a rollback safety net that eats the quota takes away the thing
   it exists to protect. Backups are also the first thing to give up: a failed backup never fails the
   save it was taken alongside. */
const VER_MAX_BYTES=120000;
async function pushVersion(label){
  try{
    let arr=[]; const raw=await store.get(verKey());
    if(raw){ try{ arr=(await _lsUnpack(raw))||[]; }catch(_){ arr=[]; } }
    if(!Array.isArray(arr))arr=[];
    arr.push({label:label||"", ts:Date.now(), annos:cleanAnnos(), lines:cleanLines()});
    if(arr.length>20) arr=arr.slice(-20);
    let packed=await _lsPack(arr);
    while(arr.length>1 && packed.length>VER_MAX_BYTES){ arr=arr.slice(1); packed=await _lsPack(arr); }
    try{ await store.set(verKey(), packed); }
    catch(e){ LOG&&LOG("version backup skipped — no room; the redlines themselves are saved"); }
  }catch(e){ LOG&&LOG("version save error",e&&e.message); }
}
async function manualSave(){
  if(!S.doc){ setStatus("Open a PDF first.",true); return; }
  const n=S.annos.length+S.lines.length;
  const r=await saveObj(saveKey(), savePayload());
  if(r.ok){
    await pushVersion("manual save");
    markSaved();
    _pill("✓",1800,r.shed.length?"warn":null,
          r.shed.length?("Saved — but this browser was nearly full."+_shedNote(r.shed))
                       :("Saved "+n+" redline(s) to this browser"));
    /* 6gn — the other half of the parity above: the autosave path logged the shed and this one did
       not, so whether the reason for an amber tick reached the log depended on which save you happened
       to trigger. */
    if(r.shed.length)LOG&&LOG("Manual save: storage was nearly full — gave up",r.shed.join(", "));
    setStatus(`Saved ${n} redline(s) to this browser. They'll be offered back if you reopen this PDF.`+
              _shedNote(r.shed));
  }else{
    _pill("✕",2800,"bad","Not saved — this browser's storage is full.");
    setStatus(`This browser's storage is full and there was nothing left to clear, so these ${n} `+
              `redline(s) are not saved here. Export the PDF to keep them — the export carries them — `+
              `or use Clear saved markings to free space and save again.`,true);
  }
}
/* 6fx — WHAT A SET OF MARKS IS, so two sets can be compared without their ids. The ids differ between
   a payload read off the page and one read out of this browser even when the marks are identical, so a
   comparison on ids alone would prompt every single time. Position to a thousandth of the page, plus the
   text, is what makes two marks the same mark. */
function _markSig(annos,lines){
  const r=v=>Math.round((v||0)*1000);
  const a=(annos||[]).map(o=>[o.page|0,r(o.nx),r(o.ny),String(o.text==null?"":o.text)].join(":")).sort();
  const l=(lines||[]).map(o=>[o.page|0,r(o.x1),r(o.y1),r(o.x2),r(o.y2==null?o.y1:o.y2)].join(":")).sort();
  return a.join("|")+"#"+l.join("|");
}
/* 6fx — THE CACHE IS OFFERED EVEN WHEN THE PDF CARRIES ITS OWN MARKS.
   Ced: "the autosave function and saving the redlines in browser cache is not working." The writing
   half was fine — a payload lands in `rfds_autosave:<name>` within the second and survives a reload.
   The reading half was gated on the document having NO marks of its own:

       await restoreEmbedded();
       if(!S.annos.length && !S.lines.length) await tryRestoreAutosave();

   On a clean RFDS that works, which is why it looked right for a long time. But every document in this
   project is a *Redlined Preliminary RFDS*: it carries its marks, `restoreEmbedded` installs them, and
   the browser cache — which holds everything done since that export — was silently thrown away.
   Preferring the page is not unreasonable; doing it SILENTLY when the two differ is. The person who
   drew both sets is the one who should choose, so now they are compared and the choice is offered with
   both counts named. When they agree, nothing is asked — a prompt that is always there is one nobody
   reads. */
async function tryRestoreAutosave(){
  try{
    let v=await store.get(saveKey());
    if(!v){
      /* 6fy — nothing under the content key: look for work saved under the old file-name key and
         carry it forward, so a session from before this build is not stranded. */
      for(const lk of legacyKeys("autosave")){
        const old=await store.get(lk);
        if(old){ v=old; LOG&&LOG("Autosave: found work saved under the old key",lk,"— carrying it forward");
                 try{ await store.set(saveKey(), old); }catch(e){}
                 break; }
      }
    }
    if(!v)return;
    const d=await _lsUnpack(v);
    if(d&&d.analysisShed)LOG&&LOG("Autosave: this entry was saved without its Analyze results (the browser was full) — press Analyze to rebuild them");
    // restore Analyze edits + detection silently (independent of redline marks)
    if(d){
      if(d.analysis)S.analysis=d.analysis;
      if(d.location)S.location=d.location;
      if(d.atollName){ S.atollName=d.atollName; if($("#s_site")&&!$("#s_site").value.trim())$("#s_site").value=d.atollName; }
      if(d.isPreliminary!=null){ S.isPreliminary=d.isPreliminary; updateFnamePreview&&updateFnamePreview(); }
    }
    if(!d||((!d.annos||!d.annos.length)&&(!d.lines||!d.lines.length)))return;
    const when=d.ts?new Date(d.ts).toLocaleString():"a previous session";
    const nCache=(d.annos||[]).length+(d.lines||[]).length;
    const nPage=(S.annos||[]).length+(S.lines||[]).length;
    let go;
    if(nPage){
      /* the PDF brought its own marks. Only ask when the two actually differ. */
      if(_markSig(d.annos,d.lines)===_markSig(S.annos,S.lines)){
        LOG&&LOG("Autosave: this browser holds the same "+nCache+" redline(s) the PDF carries — nothing to ask");
        markSaved(d.ts||Date.now());   /* 6ga — nothing to ask, but the work IS saved; say when */
        return;
      }
      LOG&&LOG("Autosave: the PDF carries "+nPage+" redline(s), this browser has "+nCache+" from "+when);
      go=await uiConfirm({title:"Two sets of redlines",
        message:`This PDF carries ${nPage} redline(s).\nThis browser has ${nCache} saved for it from ${when}.\n\nWhich do you want to work from?`,
        buttons:[{id:"yes",label:`Use this browser's (${nCache})`,primary:true},
                 {id:"no",label:`Keep the PDF's (${nPage})`}]});
    } else {
      go=await uiConfirm({title:"Recover redlines?",message:`Redlines from ${when} were found for this PDF.\n(${(d.annos||[]).length} text + ${(d.lines||[]).length} strike marks)`,buttons:[{id:"yes",label:"Recover",primary:true},{id:"no",label:"Start fresh"}]});
    }
    if(go==="yes"){
      S.annos=d.annos||[]; S.lines=d.lines||[]; if(d.seq)seq=Math.max(seq,d.seq);
      /* 6jc — and the layers those marks are filed under */
      if(d.layers&&d.layers.length){ S.layers=d.layers; S.layCur=d.layCur; }
      if(d.stamp){ if(d.stamp.tcol)$("#c_text").value=d.stamp.tcol; if(d.stamp.bcol)$("#c_bg").value=d.stamp.bcol; }
      layoutAnnos(); drawAllLines(); updateRail(); updateCount();
      S.history=[]; S.future=[]; updateUndoUI();
      /* 6ga — the recovered work was saved when the PAYLOAD says it was, not now. Stamping the restore
         time here would tell the user their work is newer than it is. */
      markSaved(d.ts||Date.now());
      setStatus(`Recovered ${S.annos.length+S.lines.length} redline(s) saved in this browser.`);
    } else if(nPage){
      LOG&&LOG("Autosave: kept the "+nPage+" redline(s) the PDF carries; the browser copy is left in place");
      setStatus(`Kept the ${nPage} redline(s) on this PDF. The ${nCache} saved in this browser are still there if you want them.`);
    }
  }catch(e){ LOG&&LOG("restore autosave error",e&&e.message); }
}
/* Clear-all with confirm + version backup safety net */
/* in-page dialog (window.confirm/prompt are blocked in the sandboxed iframe) */
function uiConfirm(opts){
  return new Promise(res=>{
    const box=document.getElementById("dlg");
    document.getElementById("dlgTitle").textContent=opts.title||"";
    document.getElementById("dlgMsg").textContent=opts.message||"";
    const wrap=document.getElementById("dlgBtns"); wrap.innerHTML="";
    const done=v=>{ box.classList.remove("show"); document.removeEventListener("keydown",onKey); box.onclick=null; res(v); };
    (opts.buttons||[{id:"ok",label:"OK",primary:true}]).forEach(b=>{
      const cls="btn sm"+(b.primary?" primary":"")+(b.danger?" danger-btn":"");
      let btn;
      if(b.href){ btn=document.createElement("a"); btn.href=b.href; btn.target="_blank"; btn.rel="noopener noreferrer"; }
      else { btn=document.createElement("button"); }
      btn.className=cls; btn.textContent=b.label; btn.onclick=()=>done(b.id); wrap.appendChild(btn);
    });
    const onKey=e=>{ if(e.key==="Escape")done("cancel"); };
    document.addEventListener("keydown",onKey);
    box.onclick=e=>{ if(e.target===box)done("cancel"); };
    box.classList.add("show");
  });
}

async function clearRedlines(scope){
  if(!S.doc)return;
  const cur=currentPageIdx();
  const isPage=scope==="page";
  const n = isPage ? (S.annos.filter(a=>a.page===cur).length+S.lines.filter(l=>l.page===cur).length)
                   : (S.annos.length+S.lines.length);
  if(!n){ setStatus(isPage?`No redlines on page ${cur+1}.`:"No redlines to clear."); return; }
  try{ await pushVersion(isPage?`before clear page ${cur+1}`:"before clear all"); }catch(e){ LOG&&LOG("clear backup skipped",e&&e.message); }
  pushHistory();   // undo stack is the primary safety net
  if(isPage){ S.annos=S.annos.filter(a=>a.page!==cur); S.lines=S.lines.filter(l=>l.page!==cur); }
  else { S.annos=[]; S.lines=[]; }
  clearMulti&&clearMulti(); S.sel=null; S.selLine=null; annobar&&annobar.classList.remove("show"); if($("#linebar"))$("#linebar").classList.remove("show");
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  setStatus(isPage?`Cleared page ${cur+1}. Press Ctrl+Z or Undo to restore.`:`Cleared all redlines. Press Ctrl+Z or Undo to restore.`);
}

const $=s=>document.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc=s=>(s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function escapeHtml(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
/* 6gh — the status strip is hidden when the ribbon is on the side, so the message goes on the quick
   bar instead of nowhere. One writer, two places, exactly as the save readout works. */
let _lastStatus="";
const setStatus=(t,isErr)=>{
  const s=$("#status"); if(s){ s.textContent=t; s.classList.toggle("err",!!isErr); }
  const m=document.getElementById("miniStatus");
  if(m){ m.textContent=t||""; m.title=t||""; m.classList.toggle("err",!!isErr); m.hidden=!t; }
  /* 6gi — the strip and the bar can both be hidden (side-ribbon mode), so the message also goes to the
     activity log, which is always reachable. Repeats are dropped so the log stays readable. */
  if(t && t!==_lastStatus){
    _lastStatus=t;
    try{ LOG((isErr?"! ":"")+t); }catch(e){}
    /* and an error is not allowed to be silent just because its strip is hidden */
    if(isErr && document.body.classList.contains("ribbonright")){ try{ toast(t); }catch(e){} }
  }
};
const toast=t=>{const e=$("#toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1600);};
const keyOf=(pi,it)=>pi+"|"+it.nx.toFixed(4)+"|"+it.ny.toFixed(4);
/* v60 — this wrote "Error: …" over the status strip for every error, including the browser's
   harmless ResizeObserver notices. guard.js reports errors now, once, in words. */

/* ---------- night / day mode ---------- */
const THEME_KEY="ma_theme";
/* 6em — THE LOGO'S TINT, MIXED HERE. Ced asked for the black and white wordmarks to carry a little of
   the theme. Expressed in CSS as `color-mix(in srgb, var(--accent) N%, var(--ink-strong))` it did not
   re-resolve when the palette or the mode changed — measured in day mode, `--ink-strong` on the element
   read #000000 while the fill stayed rgb(232,232,234), the night answer on a light page. Mixing in script
   and writing one inline custom property takes the engine out of it, and it still follows every palette
   because both arguments are read fresh each time. */
function _hex3(v){
  const t=String(v||"").trim();
  let m=/^#([0-9a-f]{3})$/i.exec(t);
  if(m)return [0,1,2].map(i=>parseInt(m[1][i]+m[1][i],16));
  m=/^#([0-9a-f]{6})$/i.exec(t);
  if(m)return [0,2,4].map(i=>parseInt(m[1].substr(i,2),16));
  m=/^rgba?\(([^)]+)\)$/i.exec(t);
  if(m){ const p=m[1].split(",").map(x=>parseFloat(x)); if(p.length>=3)return p.slice(0,3).map(Math.round); }
  return null;
}
function syncLogoInk(){
  try{
    const cs=getComputedStyle(document.documentElement);
    const A=_hex3(cs.getPropertyValue("--accent")), K=_hex3(cs.getPropertyValue("--ink-strong"));
    if(!A||!K)return;
    let t=parseFloat(cs.getPropertyValue("--logo-tint"));
    if(!isFinite(t))t=16;
    t=Math.max(0,Math.min(100,t))/100;
    const mix=A.map((v,i)=>Math.round(v*t+K[i]*(1-t)));
    const col="rgb("+mix.join(",")+")";
    document.documentElement.style.setProperty("--logo-ink",col);
    /* 6em — and painted straight onto the groups. Going through `fill:var(--logo-ink)` was not enough:
       an SVG `fill` does not re-resolve when a custom property changes, so the variable held the new
       colour (measured rgb(13,14,16) in day mode) while the mark stayed at rgb(232,232,234), the night
       value. A direct value has no indirection left to go stale. */
    document.querySelectorAll(".logo-wm .lg-ink, #markR .lg-ink")
      .forEach(g=>{ try{ g.style.fill=col; }catch(e){} });
    /* 6em — AND THE ASSIST SPARKLE. Its fill is the accent and its glyph was always white, which is fine
       until the accent itself is light: measured in night mode, Teal 2.62:1, Cyan 2.78, Ice 2.37, Mint
       2.51, Sand 2.93 — the sparkle went faint, the same fault as day mode's white-on-white but by
       degrees. White stays unless it drops under 3:1 against the fill, so every palette that reads well
       today is untouched and only the light accents flip to a dark glyph. */
    const wr=_contrast([255,255,255],A);
    document.documentElement.style.setProperty("--assist-ink", wr>=3 ? "#ffffff" : "#0F1216");
  }catch(e){}
}
/* WCAG contrast between two [r,g,b] triples */
function _contrast(x,y){
  const lin=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  const L=c=>0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
  const a=L(x), b=L(y);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
/* ================================================================================================
   6fi — the embossed chrome's two shadow colours, derived from the surface rather than declared.

   Neumorphism only reads as "carved from the surface" when the light side and the dark side belong to
   the surface's own colour family. A light ground wants a near-white highlight and a soft grey shadow;
   a dark ground wants a much fainter highlight and a much deeper shadow, or it looks like a flat box
   with a grey smudge under it.

   Twenty-three palettes times two modes is 46 answers, and Ontel needs two DIFFERENT ones at the same
   moment because its ribbon is inverted against its page. So nothing is hard-coded: this reads what is
   actually painted and sets the pair from its luminance — on <html> for the page and on #toolbar for the
   ribbon. A palette added later is handled without touching this.
   ================================================================================================ */
function _embPaint(el){
  /* composite down to the first opaque ancestor — a translucent ribbon over a dark page is dark, and
     reading its own rgba() would answer for the wrong surface (the 6em/palette_lane lesson) */
  const layers=[]; let n=el, base=[255,255,255];
  while(n){
    let c=""; try{ c=getComputedStyle(n).backgroundColor; }catch(e){}
    const m=c&&c.match(/[\d.]+/g);
    if(m){ const a=m.length>3?parseFloat(m[3]):1;
      if(a>0.999){ base=[+m[0],+m[1],+m[2]]; break; }
      if(a>0)layers.push([+m[0],+m[1],+m[2],a]); }
    n=n.parentElement;
  }
  let out=base.slice();
  for(let i=layers.length-1;i>=0;i--){ const L=layers[i], a=L[3];
    out=[L[0]*a+out[0]*(1-a), L[1]*a+out[1]*(1-a), L[2]*a+out[2]*(1-a)]; }
  return out;
}
function _embLum(c){
  const f=v=>{ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);
}
function _embMix(a,b,k){ return [a[0]+(b[0]-a[0])*k, a[1]+(b[1]-a[1])*k, a[2]+(b[2]-a[2])*k]; }
function _embRgba(c,a){ return "rgba("+Math.round(c[0])+","+Math.round(c[1])+","+Math.round(c[2])+","+a+")"; }
/* 6fj — WHERE THE DAY-MODE HUE COMES FROM. Every control in the ribbon sits on a near-white band
   (measured #FEFEFF in every day palette), so a pair derived from the control's OWN surface is neutral
   grey no matter which palette is on. The palette's colour lives in the page ground, so that is the hue
   source; the local surface still decides how light or dark the pair has to be. Set once per sync. */
let _embTint=null;
function _embSet(el,surface){
  if(!el)return null;
  const L=_embLum(surface);
  const light=(L>0.38);
  let hi,lo,rlo,rhi;
  if(light){
    /* 6fj — Ced: "in day mode make the deboss not white but also a dark shadow of the color." Before
       this, day mode painted rgba(255,255,255,.95) on one side — pure white, which on a near-white band
       is invisible — and the surface at 55% under a .20 alpha on the other, which composites to 0.91 of
       the surface: a grey smudge. Both sides are now the palette's own colour, one lifted and one driven
       down hard, so the dark side lands around 0.73 of the surface the way the reference does. */
    const tint=(_embTint&&_embLum(_embTint)>0.38)?_embTint:surface;
    /* The light side is built on whichever of the two is ALREADY lighter. Every control in the ribbon
       sits on a near-white #FEFEFF, and a tint lighter than the page but darker than that composited to
       a second shadow on the highlight side — a raised control with two dark edges reads as a hole. On
       a surface with nowhere left to go the highlight simply does nothing and the dark side carries it,
       which is what the reference does too. */
    const hiBase=(_embLum(tint)>L)?tint:surface;
    /* 6fm/6fr — HOW HARD THE SHADOW IS, over three corrections. 6fi shipped a wash at 0.81 of the
       surface; 6fj answered with 0.49, which Ced reported as too harsh on a light ground; 6fm brought
       it to 0.62; and 6fr, asked again for "more subtle across the entire ui", takes it to about 0.73.
       Night comes down with it this time — the previous rounds left it alone and the two modes had
       drifted apart. The floor and the ceiling in `emboss.py` moved with these; both ends are still
       failures, so a fourth correction cannot quietly become a wash again. */
    hi=_embRgba(_embMix(hiBase,[255,255,255],0.60),".70");
    lo=_embRgba([tint[0]*0.38,tint[1]*0.38,tint[2]*0.38],".20");
    /* 6fl — A DIVIDER IS A FOLD, NOT A BORDER. Drawn with the control pair a groove came out as dark
       as the shadow under a button, which is a drawn line by another name — the thing the emboss was
       meant to get rid of. Same hue, a third of the weight. */
    rlo=_embRgba([tint[0]*0.38,tint[1]*0.38,tint[2]*0.38],".08");
    rhi=_embRgba(_embMix(hiBase,[255,255,255],0.60),".40");
  }else{
    /* On a dark ground the highlight has to be very faint or every control grows a white rim, and the
       shadow has to go deeper than any tint of the surface can reach. */
    hi="rgba(255,255,255,.05)";
    lo="rgba(0,0,0,.38)";
    rlo="rgba(0,0,0,.18)";
    rhi="rgba(255,255,255,.03)";
  }
  el.style.setProperty("--emb-hi",hi);
  el.style.setProperty("--emb-lo",lo);
  el.style.setProperty("--emb-rule-hi",rhi);
  el.style.setProperty("--emb-rule-lo",rlo);
  return {L:+L.toFixed(3), light:light, hi:hi, lo:lo, rhi:rhi, rlo:rlo};
}
/* The surface is ANIMATING when the palette changes. `html,body` carry a 0.18s background-color
   transition, so reading the computed background the instant the class flips returns the colour we are
   leaving, not the one we are going to — the same trap `palette_lane.py` chased for three builds. Read
   once now so there is never a frame with no shadow, and again once the transition has landed. */
let _embT=null;
function syncEmbossSoon(){
  try{ syncEmboss(); }catch(e){}
  try{ clearTimeout(_embT); }catch(e){}
  _embT=setTimeout(()=>{ try{ syncEmboss(); }catch(e){} },240);
}
/* 6fj — AND DRIVE THE SECOND READ OFF THE TRANSITION ITSELF, not only off a timer. 240ms is longer
   than the 0.18s transition on a quiet main thread, but with a 49-page document open and the Analyze
   panel rendering, the timer can land late and the pair then belongs to the palette being left. The
   transition's own end event cannot be late by construction. The timer stays as the fallback for the
   case where nothing actually animates and no event is ever fired. */
document.addEventListener("transitionend",function(e){
  if(e.propertyName!=="background-color")return;
  if(e.target!==document.body&&e.target!==document.documentElement)return;
  try{ syncEmboss(); }catch(err){}
},true);
function syncEmboss(){
  try{
    const root=document.documentElement;
    const body=document.body;
    const ground=_embPaint(body||root);
    _embTint=ground;                       /* 6fj — the palette's hue, before anything is computed */
    const page=_embSet(root,ground);
    /* The ribbon's OWN shadow is cast onto the page, not onto itself — so it needs the page's pair even
       when the band is the opposite lightness. Under Ontel night the band is light while the page is
       dark, and using the band pair there made the ribbon's shadow LIGHTER than the page it fell on: an
       inverted emboss, a raised panel reading as a hole. These two names are never shadowed by the
       toolbar, so `.toolbar` can reach the page's pair while everything inside it inherits the band's. */
    if(page){ root.style.setProperty("--emb-page-hi",page.hi);
              root.style.setProperty("--emb-page-lo",page.lo); }
    const tb=document.getElementById("toolbar");
    const band=tb?_embSet(tb,_embPaint(tb)):null;
    /* 6fj — the rail, the banner, the Analyze modal, the marks list and the log each get their own
       measurement for the same reason the ribbon does: under Ontel all five are painted from the BAND
       while the page behind them is the opposite lightness, so one shared pair would be inverted on
       every one of them at once. The panel is measured on #maPanel itself, whose
       own background is the scrim. */
    const more={};
    /* 6gl — AND THE QUICK BAR IS ONE OF THEM. Ced: "fix the neumorphism of mini bar in day mode of
       ontel theme too, the shadow is in day mode when it is dark." Exactly right, and the bar was the
       one piece of furniture 6fj's list forgot: it is painted from the BAND like the ribbon, but it was
       never measured, so it inherited <html>'s pair — the PAGE's. Under Ontel day the page is light and
       the band is dark, so the bar was lit as though it were a pale surface: a highlight brighter than
       the bar itself and a shadow that vanished into it. Measuring it puts it on the same footing as
       the ribbon, and it costs one entry in this list rather than a rule of its own. */
    [["rail","aside#rail"],["banner","#detectBanner"],["ma","#maPanel"],
     ["marks","#marksPanel"],["log","#logPanel"],["minibar","#miniBar"]].forEach(function(p){
      var e=document.querySelector(p[1]);
      if(e)more[p[0]]=_embSet(e,_embPaint(e));
    });
    return {page:page, band:band, more:more};
  }catch(e){ LOG&&LOG("syncEmboss skipped",e&&e.message); return null; }
}
function applyTheme(mode){
  const light=(mode==="light");
  document.documentElement.classList.toggle("light",light);
  /* 6fc — HAND THE GROUND BACK TO THE STYLESHEET. The pre-paint script writes an inline background on
     <html> so the first frame is not the browser's white (6es), and nothing ever took it off again — so
     <html>'s ground stayed frozen at the BOOT-TIME guess for the whole session while `body` followed the
     live theme. Wherever the body did not reach, you saw the other one. Measured in a publisher-style
     frame at 1916x936 with nothing loaded, Ontel day: the body stopped at 577px and the bottom 359px of
     the window was #101112 — the NIGHT ground, under a day-mode app. That is the dark band across the
     bottom of Ced's screenshot. Removing the inline property lets `html{background:var(--bg)}` own it,
     and by the time this runs the stylesheet is present in both builds (the packed artifact inflates its
     CSS before the app script). */
  try{ document.documentElement.style.removeProperty("background"); }catch(e){}
  S.theme=light?"light":"dark";
  const b=$("#themeBtn");
  if(b){
    /* 6el — the switch DRAWS its own state (the knob follows `html.light`), so nothing here may touch its
       contents: `b.textContent=` would delete the track and both glyphs. Only the accessible name and the
       hover text are set, and they name the state you are IN, the way the switch does — the old label
       named the action, which is the confusion this replaced.
       Rule 2 still holds for the iconified fallback: never rewrite the label of an `.ico` button. */
    if(b.classList.contains("thm-tog")){ /* nothing to redraw */ }
    else if(b.classList.contains("ico")) b.style.setProperty("--g",light?'"\u263E"':'"\u2600"');
    else b.textContent=light?"🌙 Night":"☀ Day";
    b.title=(light?"Day mode is on":"Night mode is on")+" — click for "+(light?"night":"day")+" (D)";
    b.setAttribute("aria-label",light?"Day mode is on":"Night mode is on");
    b.setAttribute("role","switch");
    b.setAttribute("aria-checked",light?"false":"true");
  }
  /* 6eq — RE-TUNE, then re-ink. The dials work by writing inline custom properties on <html>, computed
     from the palette's colours for the mode that was in force at the time. Flipping day/night swaps the
     stylesheet's values underneath, but the inline overrides are more specific and stayed — so with any
     tuning applied, the day/night switch appeared to do nothing at all. `applyThemeTune` clears its own
     overrides first, so calling it here is what makes the new mode's colours visible. */
  try{ applyThemeTune(true); }catch(e){}
  try{ syncLogoInk(); }catch(e){}
  try{ syncEmbossSoon(); }catch(e){}   /* 6fi — the emboss pair follows the surface */
  try{ _palRender(); }catch(e){}
}
async function toggleTheme(){
  /* T always lands on an explicit choice, even from System */
  applyThemeMode(S.theme==="light"?"dark":"light");
  try{ await store.set(THEME_KEY,S.theme); }catch(e){ LOG&&LOG("theme preference not saved:",e&&e.message); }
}
/* Back to the opening screen. Always asks first — there may be unexported redlines. */
async function goHome(){
  const marks=(S.annos||[]).length+(S.lines||[]).length;
  const go=await uiConfirm({title:"Close this report?",
    message:marks?("You have "+marks+" redline"+(marks===1?"":"s")+" on this document. Going back to the opening screen closes it — export first if you want to keep them."):
                  "This closes the current document and returns to the opening screen.",
    buttons:[{id:"no",label:"Stay here",primary:true},{id:"yes",label:"Close and go home",danger:true}]});
  if(go!=="yes")return;
  try{ location.reload(); }catch(e){}
}
(function(){ const hb=$("#homeBtn"); if(hb)hb.onclick=goHome; })();
/* ---- Organize pages: leave a page out of the export ---- */
function pageTitleOf(pi){
  const P=S.pages[pi]; if(!P)return "";
  return (P.items||[]).slice(0,14).map(t=>t.str).join(" ").replace(/\s+/g," ").trim().slice(0,72);
}
function droppedPages(){ return S.pages.reduce((n,p)=>n+(p&&p.dropped?1:0),0); }
function reflectLocked(){
  S.pages.forEach((P,pi)=>{
    const pg=document.querySelector('.page[data-idx="'+pi+'"]');
    if(pg){ pg.classList.toggle("pagelocked",!!P.locked); if(pg._paintCtl)pg._paintCtl(); }
  });
}
function reflectDropped(){
  S.pages.forEach((P,pi)=>{
    const pg=document.querySelector('.page[data-idx="'+pi+'"]');
    if(pg){ pg.classList.toggle("dropped",!!P.dropped); if(pg._paintCtl)pg._paintCtl(); }
  });
  const n=droppedPages();
  setStatus(n?(n+" page"+(n===1?"":"s")+" set aside — they will not be in the exported PDF."):"All pages will be exported.");
}
function renderPageOrg(){
  const list=$("#pageOrgList"); if(!list)return;
  list.innerHTML="";
  S.pages.forEach((P,pi)=>{
    const row=el("div","po-row"+(P.dropped?" dropped":""));
    row.appendChild(el("span","po-n","Page "+(pi+1)));
    row.appendChild(el("span","po-t",pageTitleOf(pi)||"(no text)"));
    /* Existing / Decommissioned / Notes pages start locked; unlock one here if it needs a manual
       redline after all. The reason is remembered so re-locking says why it was locked. */
    if(P.lockReason==null&&P.locked)P.lockReason="Existing / Decommissioned / Notes";
    const lk=el("button","btn sm"+(P.locked?"":" danger-btn"),P.locked?"🔒 Locked":"🔓 Unlocked");
    lk.title=P.locked
      ? ("Locked ("+(P.lockReason||"read-only")+") — click to allow redlines on this page")
      : "Unlocked — click to protect this page again";
    lk.style.marginRight="4px";
    lk.onclick=()=>{
      P.locked=!P.locked;
      setStatus(P.locked?("Page "+(pi+1)+" locked — no redlines can be placed on it.")
                        :("Page "+(pi+1)+" unlocked — you can redline it by hand."));
      renderPageOrg(); reflectLocked();
    };
    row.appendChild(lk);
    const marks=(S.annos||[]).filter(a=>a.page===pi).length+(S.lines||[]).filter(l=>l.page===pi).length;
    if(marks)row.appendChild(el("span","po-tag",marks+" redline"+(marks===1?"":"s")));
    const b=el("button","btn sm"+(P.dropped?"":" danger-btn"),P.dropped?"Keep":"Drop");
    b.onclick=()=>{ P.dropped=!P.dropped; renderPageOrg(); reflectDropped(); };
    row.appendChild(b);
    list.appendChild(row);
  });
  const n=droppedPages(), note=$("#pageOrgNote");
  if(note)note.textContent=n?(n+" page"+(n===1?"":"s")+" will be left out of the export"):"Every page will be exported";
}
$("#themeBtn").onclick=toggleTheme;
/* ---- 5. appearance (6bz): night / day / system, plus a colour theme chosen from a swatch menu.
   The old build cycled five palettes blind on every click of one button; you could not see what you were
   picking and there was no way back except cycling round. Both live in one popover now. ---- */
/* 6em — ONTEL FIRST. It is the house theme, so it leads the list rather than sitting seventeenth
   among the stock ones. The swatch colours are its own desaturated accents now, not the indigo/cyan the
   picker used to advertise while the theme painted grey. `applyPalette(0)` is the no-document fallback,
   so putting Ontel here also makes it the default. */
const PALETTES=[{id:"pal-ontel",name:"Ontel",a:"#7D808C",d:"#6E7A80"},
                {id:"",name:"Blue",a:"#3A8BD5",d:"#2DD4BF"},
                {id:"pal-slate",name:"Slate",a:"#7f8fa6",d:"#60A5FA"},
                {id:"pal-graphite",name:"Graphite",a:"#b0b7c2",d:"#F59E0B"},
                {id:"pal-forest",name:"Forest",a:"#4fae7a",d:"#A3E635"},
                {id:"pal-teal",name:"Teal",a:"#35b6c4",d:"#6366F1"},
                {id:"pal-indigo",name:"Indigo",a:"#7c8cf8",d:"#22D3EE"},
                {id:"pal-plum",name:"Plum",a:"#b07cd4",d:"#F472B6"},
                {id:"pal-pink",name:"Pink",a:"#ef6fa8",d:"#A78BFA"},
                {id:"pal-crimson",name:"Crimson",a:"#e0555f",d:"#FB923C"},
                {id:"pal-copper",name:"Copper",a:"#d4784a",d:"#FACC15"},
                {id:"pal-amber",name:"Amber",a:"#d99a2b",d:"#84CC16"},
                {id:"pal-midnight",name:"Midnight",a:"#5b7cfa",d:"#F0ABFC",duo:true},
                {id:"pal-sage",name:"Sage",a:"#8fae6a",d:"#38BDF8",duo:true},
                {id:"pal-cyan",name:"Cyan",a:"#22b8cf",d:"#F97316",duo:true},
                {id:"pal-olive",name:"Olive",a:"#9aa83a",d:"#EC4899"},
                {id:"pal-rose",name:"Rose",a:"#e08a8a",d:"#FDE68A"},
                {id:"pal-ice",name:"Ice",a:"#86b6d8",d:"#C084FC",duo:true},
                /* 6dq — Ontel, taken from the product's own interface: the #1A2238 navy it is built on,
                   the #2B50A7 blue its active items carry, and the #04AEC6 cyan beside it. */
                {id:"pal-mint",name:"Mint",a:"#3fbf9a",d:"#7DD3FC"},
                {id:"pal-violet",name:"Violet",a:"#8b6cf0",d:"#F0ABFC"},
                {id:"pal-sand",name:"Sand",a:"#c2a06a",d:"#5EEAD4"},
                {id:"pal-steel",name:"Steel",a:"#5b8ca8",d:"#FBBF24"},
                {id:"pal-oxblood",name:"Oxblood",a:"#b8515f",d:"#FCA5A5"}];
const PAL_KEY="ma.palette";            // index — kept, so a preference saved by an older build still loads
const PAL_ID_KEY="ma.paletteId";       // id — survives the list being reordered
const THEME_MODE_KEY="ma.themeMode";   // "dark" | "light" | "system"
let _palIdx=0, _themeMode="dark";
const _mqLight=(window.matchMedia?window.matchMedia("(prefers-color-scheme: light)"):null);
function applyPalette(idx){
  _palIdx=((idx%PALETTES.length)+PALETTES.length)%PALETTES.length;
  const cl=document.documentElement.classList;
  PALETTES.forEach(p=>{ if(p.id)cl.remove(p.id); });
  const cur=PALETTES[_palIdx];
  if(cur.id)cl.add(cur.id);
  cl.remove("duo");                 /* 6ct — retired; a theme's pair always blends now */
  /* 6fc — same as applyTheme: a palette change also has to hand <html>'s ground back to the stylesheet,
     or the boot script's inline guess outlives it. A palette can be changed without touching the mode. */
  try{ document.documentElement.style.removeProperty("background"); }catch(e){}
  applyCustom(null,null,true);      /* choosing a palette clears any custom colours */
  const b=$("#palBtn");
  if(b)b.title="Appearance — "+cur.name+" theme. Click to change.";
  try{ localStorage.setItem(PAL_KEY,String(_palIdx)); localStorage.setItem(PAL_ID_KEY,cur.id); }catch(e){}
  try{ syncMiniIcons(); }catch(e){}
  try{ applyThemeTune(true); }catch(e){}   /* 6eq — a new palette needs the dials applied to ITS colours */
  try{ syncLogoInk(); }catch(e){}     /* 6em — the logo's tint follows the palette, not only the mode */
  try{ syncEmbossSoon(); }catch(e){}      /* 6fi — and so does the emboss pair */
  try{ _palRender(); }catch(e){}
  return cur;
}
function setPaletteById(id){
  let i=PALETTES.findIndex(p=>p.id===id);
  return applyPalette(i<0?0:i);
}
function cyclePalette(){ const c=applyPalette(_palIdx+1); setStatus("Colour theme: "+c.name+"."); return c; }
function resolvedTheme(){ return _themeMode==="system"?((_mqLight&&_mqLight.matches)?"light":"dark"):_themeMode; }
function applyThemeMode(m){
  _themeMode=(m==="light"||m==="system")?m:"dark";
  applyTheme(resolvedTheme());
  try{ localStorage.setItem(THEME_MODE_KEY,_themeMode); localStorage.setItem(THEME_KEY,S.theme); }catch(e){}
  try{ store.set(THEME_KEY,S.theme); }catch(e){}
  try{ _palRender(); }catch(e){}
  return _themeMode;
}
if(_mqLight){
  const onSys=()=>{ if(_themeMode==="system")applyTheme(resolvedTheme()); };
  if(_mqLight.addEventListener)_mqLight.addEventListener("change",onSys);
  else if(_mqLight.addListener)_mqLight.addListener(onSys);
}
/* 6db — the two Construction-Drawing tools are work in progress. They are wired up but not finished, so
   they are held disabled and their handlers refuse politely rather than half-working. */
const WIP_TOOLS=[];   /* nothing is half-built in this tool */
function wipLock(){
  WIP_TOOLS.forEach(id=>{
    const b=document.getElementById(id); if(!b)return;
    b.disabled=true;
    if(!b.dataset.wipWired){
      b.dataset.wipWired="1";
      b.addEventListener("click",ev=>{ ev.preventDefault(); ev.stopImmediatePropagation();
        setStatus("That one is still being built — it is in the WIP group for a reason.",true); },true);
    }
  });
}
(function(){ const go=()=>{ try{ wipLock(); }catch(e){} };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go); else setTimeout(go,0);
  setInterval(()=>{ try{ WIP_TOOLS.forEach(id=>{ const b=document.getElementById(id);
    if(b&&!b.disabled)b.disabled=true; }); }catch(e){} },1500);
})();
/* ---- 6ct: your own two colours ------------------------------------------------------------------
   Seventeen themes is still seventeen somebody else chose. A custom pair sets --accent and --accent2 as
   inline variables on <html>, which beats every theme block without touching one, and the derived
   variables are computed from them so the rest of the interface follows. It survives a reload and is
   cleared the moment you pick a named theme. */
const CUSTOM_KEY="ma.customPair";
const CUSTOM_LIST_KEY="ma.customThemes";
let _customPair=null;
/* 6cu — a pair you liked, kept by name. Stored as a plain list so it survives a reload and can be
   picked straight from the menu beside the built-in themes. */
let _customSaved=[];
function customSaved(){ return _customSaved.slice(); }
function _customStore(){ try{ localStorage.setItem(CUSTOM_LIST_KEY,JSON.stringify(_customSaved)); }catch(e){} }
function saveCustomTheme(name,a,d){
  const nm=String(name||"").trim().slice(0,24)||("Custom "+(_customSaved.length+1));
  const i=_customSaved.findIndex(x=>x.name.toLowerCase()===nm.toLowerCase());
  const rec={name:nm,a:a,d:d||a};
  if(i>=0)_customSaved[i]=rec; else _customSaved.push(rec);
  if(_customSaved.length>12)_customSaved=_customSaved.slice(-12);
  _customStore();
  try{ _palRender(); }catch(e){}
  return rec;
}
function deleteCustomTheme(name){
  const n=_customSaved.length;
  _customSaved=_customSaved.filter(x=>x.name!==name);
  if(_customSaved.length!==n){ _customStore(); try{ _palRender(); }catch(e){} }
  return n-_customSaved.length;
}
(function(){ try{ const v=JSON.parse(localStorage.getItem(CUSTOM_LIST_KEY)||"[]");
  if(Array.isArray(v))_customSaved=v.filter(x=>x&&x.a&&x.name); }catch(e){} })();
function _hx2(c){ c=String(c||"").replace("#",""); if(c.length===3)c=c.split("").map(x=>x+x).join("");
  return [parseInt(c.slice(0,2),16)||0,parseInt(c.slice(2,4),16)||0,parseInt(c.slice(4,6),16)||0]; }
function _rgb2(r,g,b){ const h=x=>("0"+Math.max(0,Math.min(255,Math.round(x))).toString(16)).slice(-2);
  return "#"+h(r)+h(g)+h(b); }
function _dark(c,f){ const [r,g,b]=_hx2(c); return _rgb2(r*(1-f),g*(1-f),b*(1-f)); }
function _light(c,f){ const [r,g,b]=_hx2(c); return _rgb2(r+(255-r)*f,g+(255-g)*f,b+(255-b)*f); }
function customPair(){ return _customPair; }
function applyCustom(a,d,silent){
  const r=document.documentElement;
  if(!a){
    if(!_customPair)return null;
    ["--accent","--accent2","--accent-deep","--accent-alt","--accent-soft"].forEach(v=>r.style.removeProperty(v));
    _customPair=null;
    try{ localStorage.removeItem(CUSTOM_KEY); }catch(e){}
    if(!silent)try{ _palRender(); }catch(e){}
    return null;
  }
  d=d||a;
  _customPair={a,d};
  const day=(document.documentElement.classList.contains("light"));
  r.style.setProperty("--accent",a);
  r.style.setProperty("--accent2",d);
  r.style.setProperty("--accent-deep",_dark(a,day?0.45:0.52));
  r.style.setProperty("--accent-alt",day?a:_light(a,0.22));
  r.style.setProperty("--accent-soft",day?_light(a,0.82):_dark(a,0.68));
  try{ localStorage.setItem(CUSTOM_KEY,JSON.stringify(_customPair)); }catch(e){}
  if(!silent)try{ _palRender(); }catch(e){}
  return _customPair;
}
(function(){ try{ const v=JSON.parse(localStorage.getItem(CUSTOM_KEY)||"null");
  if(v&&v.a)setTimeout(()=>applyCustom(v.a,v.d,true),0); }catch(e){} })();
/* ---- 6ep: tuning the theme — saturation, brightness, hue -------------------------------------------
   Ced asked for these as controls, on top of the flat desaturation every night palette just took. Two
   ways to build it and only one of them is right:

   A CSS `filter: saturate() brightness() hue-rotate()` on a wrapper is one line and WRONG — the filter
   applies to everything inside it, and everything inside it includes the rendered PDF. Turning the
   interface down would turn the document down with it, and the document is the thing being read.

   So the adjustment is applied to the SURFACE VARIABLES ONLY, in script: read what the palette says,
   convert to HSL, scale S and L, rotate H, write the result back as an inline custom property. The ink
   and the status colours are deliberately left out — they are what makes the interface readable and
   legible, and they are not the theme's decoration. Alpha survives, which `--toolbar-bg` needs. */
const TUNE_KEY="ma.themeTune";
/* 6eq — `hue` stays in the shape so a setting saved by 6ep still loads, but it is forced to 0: the dial
   is gone and nothing may put a rotation back. */
const TUNE_DEFAULT={sat:100,bri:100,hue:0};
let _tune={sat:100,bri:100,hue:0};
/* 6er — THE MAIN BACKGROUND, AND NOTHING ELSE. 6ep put every surface on the dials, and at 60% brightness
   in day mode that meant the ribbon, the tabs, the panels and the popover all went to a washed-out mid
   grey together — the whole interface dimmed rather than the page behind it. Ced's screenshot is that.
   The dials now move `--bg` alone: the ground the pages sit on. The ribbon, the tabs, the panels and the
   Ontel band keep the palette's own colours, so the interface stays the interface at any setting. */
const TUNE_VARS=["--bg"];
function _parseCol(v){
  const t=String(v||"").trim();
  let m=/^#([0-9a-f]{3})$/i.exec(t);
  if(m)return {r:parseInt(m[1][0]+m[1][0],16),g:parseInt(m[1][1]+m[1][1],16),b:parseInt(m[1][2]+m[1][2],16),a:1};
  m=/^#([0-9a-f]{6})$/i.exec(t);
  if(m)return {r:parseInt(m[1].substr(0,2),16),g:parseInt(m[1].substr(2,2),16),b:parseInt(m[1].substr(4,2),16),a:1};
  m=/^rgba?\(([^)]+)\)$/i.exec(t);
  if(m){ const q=m[1].split(",").map(x=>parseFloat(x));
    if(q.length>=3)return {r:q[0],g:q[1],b:q[2],a:(q.length>3?q[3]:1)}; }
  return null;
}
function _rgb2hsl(c){
  const r=c.r/255,g=c.g/255,b=c.b/255;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  let h=0; const l=(mx+mn)/2;
  const s=d===0?0:d/(1-Math.abs(2*l-1));
  if(d!==0){
    if(mx===r)h=((g-b)/d)%6; else if(mx===g)h=(b-r)/d+2; else h=(r-g)/d+4;
    h*=60; if(h<0)h+=360;
  }
  return {h,s,l,a:c.a};
}
function _hsl2css(x){
  const h=((x.h%360)+360)%360, s=Math.max(0,Math.min(1,x.s)), l=Math.max(0,Math.min(1,x.l));
  const c=(1-Math.abs(2*l-1))*s, hp=h/60, xx=c*(1-Math.abs(hp%2-1));
  let r=0,g=0,b=0;
  if(hp<1){r=c;g=xx;} else if(hp<2){r=xx;g=c;} else if(hp<3){g=c;b=xx;}
  else if(hp<4){g=xx;b=c;} else if(hp<5){r=xx;b=c;} else {r=c;b=xx;}
  const m=l-c/2;
  const to=v=>Math.round(Math.max(0,Math.min(255,(v+m)*255)));
  const R=to(r),G=to(g),B=to(b);
  return (x.a!=null&&x.a<0.999)?("rgba("+R+","+G+","+B+","+(+x.a.toFixed(3))+")")
                               :("rgb("+R+","+G+","+B+")");
}
function _tuneOne(v){
  const c=_parseCol(v); if(!c)return null;
  const x=_rgb2hsl(c);
  x.s*=(_tune.sat/100);
  /* brightness moves L TOWARDS the end it is heading for, so a dark theme does not wash out and a light
     one does not go grey: at 130% a 0.06 lightness becomes 0.08, not 0.08 of the way to white. */
  const f=_tune.bri/100;
  x.l = (f>=1) ? x.l + (1-x.l)*(f-1)*0.55 : x.l*f;
  /* 6er — AND IT STOPS BEFORE THE INK STOPS READING. Scaling lightness freely took day mode's #E0E8EE
     (L 0.90) down to 0.54 at the 60% end: a mid grey carrying near-black text, which is what "looks
     weird" was. The dial keeps its whole range of feel and is bounded to the half of the scale its mode
     belongs to, so the page can never end up fighting its own text. */
  const day=document.documentElement.classList.contains("light");
  x.l = day ? Math.max(0.72,Math.min(1,x.l)) : Math.min(0.30,Math.max(0,x.l));
  x.h += _tune.hue;
  return _hsl2css(x);
}
function applyThemeTune(silent){
  const r=document.documentElement;
  TUNE_VARS.forEach(v=>r.style.removeProperty(v));          // read the palette, not our own answer
  const flat=(_tune.sat===100&&_tune.bri===100&&_tune.hue===0);
  if(!flat){
    const cs=getComputedStyle(r);
    const base={};
    TUNE_VARS.forEach(v=>{ base[v]=cs.getPropertyValue(v).trim(); });
    TUNE_VARS.forEach(v=>{ if(!base[v])return; const out=_tuneOne(base[v]); if(out)r.style.setProperty(v,out); });
  }
  try{ localStorage.setItem(TUNE_KEY,JSON.stringify(_tune)); }catch(e){}
  try{ syncLogoInk(); }catch(e){}
  if(!silent)try{ _palRender(); }catch(e){}
  return _tune;
}
function setThemeTune(k,v){
  if(!(k in _tune)||k==="hue")return _tune;
  _tune[k]=+v;
  return applyThemeTune();
}
function resetThemeTune(){ _tune=Object.assign({},TUNE_DEFAULT); return applyThemeTune(); }
(function(){ try{ const v=JSON.parse(localStorage.getItem(TUNE_KEY)||"null");
  if(v){ _tune=Object.assign({},TUNE_DEFAULT,v); _tune.hue=0;
         setTimeout(()=>applyThemeTune(true),0); } }catch(e){} })();
/* ---- the picker ---- */
function _palRender(){
  const g=document.getElementById("palGrid");
  if(g){
    if(!g.dataset.built){
      PALETTES.forEach((p,i)=>{
        const b=document.createElement("button");
        b.className="pm-sw"; b.type="button"; b.dataset.pal=String(i);
        b.title=p.name+" — click to use this theme";
        const sw=document.createElement("i");
        sw.style.background="linear-gradient(135deg,"+p.a+","+p.d+")";
        const dot=document.createElement("u"); dot.style.background=p.d; sw.appendChild(dot);
        const nm=document.createElement("span"); nm.textContent=p.name;
        b.appendChild(sw); b.appendChild(nm);
        b.onclick=ev=>{ ev.stopPropagation(); const c=applyPalette(i); setStatus("Colour theme: "+c.name+"."); };
        g.appendChild(b);
      });
      g.dataset.built="1";
    }
    Array.prototype.forEach.call(g.children,(b,i)=>b.classList.toggle("on",i===_palIdx&&!customPair()));
  }
  /* 6ep — the three tuning sliders. Wired once; their VALUES are refreshed on every render so the popup
     always shows what is actually in force, including a setting restored from a previous session. */
  /* 6eq — Saturation and Brightness only. The hue dial rotated the surfaces' hue, and on a palette whose
     surfaces are nearly neutral by design there is almost no hue there to rotate: it either did nothing
     visible or tinted the interface away from the theme it was supposed to be. Choosing the theme's
     colour is what the palette grid and the custom pair below are for. */
  [["tuneSat","sat","%"],["tuneBri","bri","%"]].forEach(([id,key,unit])=>{
    const el2=document.getElementById(id), out=document.getElementById(id+"V");
    if(!el2)return;
    if(String(el2.value)!==String(_tune[key]))el2.value=_tune[key];
    if(out)out.textContent=_tune[key]+unit;
    if(!el2.dataset.wired){ el2.dataset.wired="1";
      const paint=()=>{ const o=document.getElementById(id+"V"); if(o)o.textContent=el2.value+unit; };
      /* `input` for the live drag and `change` for the keyboard — the drag must feel immediate, and the
         work is one pass over a dozen variables, so there is nothing to debounce. */
      el2.oninput=ev=>{ ev.stopPropagation(); paint(); setThemeTune(key,el2.value); };
      el2.onchange=ev=>{ ev.stopPropagation(); paint(); setThemeTune(key,el2.value); };
      el2.onclick=ev=>ev.stopPropagation();
    }
  });
  const tr=document.getElementById("tuneReset");
  if(tr&&!tr.dataset.wired){ tr.dataset.wired="1";
    tr.onclick=ev=>{ ev.stopPropagation(); resetThemeTune();
      setStatus("Theme tuning reset."); }; }
  /* 6ct — the custom pair, and a line saying what is currently in force */
  const c1=document.getElementById("palC1"), c2=document.getElementById("palC2");
  const cur0=PALETTES[_palIdx]||PALETTES[0];
  const cp=customPair();
  if(c1&&!c1.dataset.touched)c1.value=(cp?cp.a:cur0.a);
  if(c2&&!c2.dataset.touched)c2.value=(cp?cp.d:cur0.d);
  const use=document.getElementById("palCUse");
  if(use&&!use.dataset.wired){ use.dataset.wired="1";
    use.onclick=ev=>{ ev.stopPropagation();
      if(c1)c1.dataset.touched="1"; if(c2)c2.dataset.touched="1";
      applyCustom(c1?c1.value:cur0.a,c2?c2.value:cur0.d);
      setStatus("Using your own colours."); }; }
  const off=document.getElementById("palCOff");
  if(off&&!off.dataset.wired){ off.dataset.wired="1";
    off.onclick=ev=>{ ev.stopPropagation();
      if(c1)delete c1.dataset.touched; if(c2)delete c2.dataset.touched;
      applyCustom(null,null); setStatus("Back to the "+(PALETTES[_palIdx]||PALETTES[0]).name+" theme."); }; }
  /* the saved pairs, as their own row of swatches */
  const sg=document.getElementById("palSaved");
  if(sg){
    sg.innerHTML="";
    if(!_customSaved.length)sg.style.display="none";
    else{
      sg.style.display="";
      _customSaved.forEach(t2=>{
        const b2=document.createElement("button"); b2.className="pm-sw"; b2.type="button";
        b2.title=t2.name+" — "+t2.a+" → "+t2.d;
        const i2=document.createElement("i");
        i2.style.background="linear-gradient(135deg,"+t2.a+","+t2.d+")";
        const u2=document.createElement("u"); u2.style.background=t2.d; i2.appendChild(u2);
        const n2=document.createElement("span"); n2.textContent=t2.name;
        b2.appendChild(i2); b2.appendChild(n2);
        b2.onclick=ev=>{ ev.stopPropagation();
          if(c1){c1.value=t2.a;c1.dataset.touched="1";} if(c2){c2.value=t2.d;c2.dataset.touched="1";}
          applyCustom(t2.a,t2.d); setStatus("Theme: "+t2.name+"."); };
        b2.oncontextmenu=ev=>{ ev.preventDefault(); ev.stopPropagation();
          if(deleteCustomTheme(t2.name))setStatus("Removed the saved theme \u201c"+t2.name+"\u201d."); };
        const x2=document.createElement("b"); x2.className="pm-x"; x2.textContent="\u00d7";
        x2.title="Remove this saved theme";
        x2.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
          deleteCustomTheme(t2.name); setStatus("Removed the saved theme \u201c"+t2.name+"\u201d."); };
        b2.appendChild(x2);
        sg.appendChild(b2);
      });
    }
  }
  const sv=document.getElementById("palCSave");
  if(sv&&!sv.dataset.wired){ sv.dataset.wired="1";
    sv.onclick=ev=>{ ev.stopPropagation();
      const nm=document.getElementById("palCName");
      const a=c1?c1.value:cur0.a, d=c2?c2.value:cur0.d;
      applyCustom(a,d,true);
      const rec=saveCustomTheme(nm?nm.value:"",a,d);
      if(nm)nm.value="";
      setStatus("Saved the theme \u201c"+rec.name+"\u201d."); }; }
  const now=document.getElementById("palNow");
  if(now){
    const a=getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const d=getComputedStyle(document.documentElement).getPropertyValue("--accent2").trim();
    now.innerHTML='<i style="background:'+escapeHtml(a)+'"></i><i style="background:'+escapeHtml(d)+'"></i>'+
      "<span>"+(cp?"Your own pair":escapeHtml(cur0.name))+" · "+escapeHtml(a)+" → "+escapeHtml(d)+"</span>";
  }
  /* 6gc — the ribbon's side, wired the same way as the night/day segment beside it */
  const rseg=document.getElementById("palRibSeg");
  if(rseg){
    Array.prototype.forEach.call(rseg.children,b=>{
      if(!b.dataset.wired){ b.dataset.wired="1";
        b.onclick=ev=>{ ev.stopPropagation(); setRibbonSide(b.dataset.side);
          setStatus(b.dataset.side==="right"
            ? "The ribbon is down the right, icon only. It stays put while you scroll; the quick bar still appears at the top."
            : "The ribbon is back along the top."); }; }
      b.classList.toggle("on", b.dataset.side===(RIBBON_SIDE()?"right":"top"));
    });
  }
  const seg=document.getElementById("palSeg");
  if(seg){
    Array.prototype.forEach.call(seg.children,b=>{
      if(!b.dataset.wired){ b.dataset.wired="1";
        b.onclick=ev=>{ ev.stopPropagation(); applyThemeMode(b.dataset.mode);
          setStatus(b.dataset.mode==="system"?"Appearance follows the system setting."
                                             :"Appearance: "+(b.dataset.mode==="light"?"day":"night")+" mode."); }; }
      b.classList.toggle("on",b.dataset.mode===_themeMode);
    });
  }
}
/* 6gl — THE MENU HANGS OFF WHATEVER YOU ACTUALLY PRESSED. `#palBtn` is the definition of the action,
   but with the ribbon on the side, scrolled away or in page view it is not on screen, and a menu
   right-aligned to a button that is nowhere lands nowhere sensible. The bar's remote is the anchor when
   the ribbon's own button has no box to hang from. */
let _palSrc=null, _palLastAnchor=null, _sideSrc=null;
function _palOnScreen(e){
  if(!e)return false;
  const r=e.getBoundingClientRect();
  return r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight;
}
function _palAnchor(){
  /* 6gp — THE BAR WINS WHENEVER THE BAR IS THERE. Ced: "the theme prompt for mini bar is correct in top
     mode, use the same placement for the right ribbon mode. the prompt should still be in mini bar."
     6gl preferred the ribbon's own button and fell back to the bar's remote, which is right in top mode
     — the bar is hidden until you scroll, so the ribbon is the only thing on screen — and wrong on the
     side, where BOTH are visible and the menu went to the ribbon's copy down the right-hand column
     instead of to the control you actually pressed. The quick bar is the constant: it is up the whole
     time in side mode and up whenever it is relevant in top mode, so it is the anchor when it is there. */
  const m=document.getElementById("miniPal");
  if(m){ const r=m.getBoundingClientRect();
         if(r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight)return m; }
  const b=$("#palBtn");
  if(b){ const r=b.getBoundingClientRect();
         if(r.width>0&&r.height>0&&r.bottom>0&&r.top<window.innerHeight)return b; }
  return b;
}
/* 6gt — AND THE ONE YOU PRESSED WINS OVER BOTH. Ced: "in right ribbon mode, clicking the themes on the
   right ribbon should prompt the themes on the right not on the mini bar, and vice versa."
   6gp made the bar the anchor whenever the bar is up, which is right when only one of the two is on
   screen and wrong the moment both are: in side mode the ribbon's Theme button is right there under the
   pointer and the menu opened somewhere else entirely. A menu belongs to the control that opened it.
   `_palAnchor()` stays as the fallback, for the keyboard shortcut and for a source that has scrolled
   away between the click and the open. */
function _palOpen(src){
  const m=document.getElementById("palMenu");
  const b=(src&&_palOnScreen(src))?src:_palAnchor();
  if(!m||!b)return;
  _palLastAnchor=b;          /* so a resize re-places the menu where it already is */
  _palRender();
  m.classList.add("show");
  const r=b.getBoundingClientRect(), w=m.offsetWidth||272, h=m.offsetHeight||220;
  let left=r.left+r.width-w;                                  // right-aligned to the button
  left=Math.max(8,Math.min(left,window.innerWidth-w-8));
  let top=r.bottom+8;
  if(top+h>window.innerHeight-8) top=Math.max(8,r.top-h-8);    // flip above when it would run off
  m.style.left=Math.round(left)+"px";
  m.style.top=Math.round(top)+"px";
}
function _palClose(){ const m=document.getElementById("palMenu"); if(m)m.classList.remove("show"); }
function togglePalMenu(src){
  const m=document.getElementById("palMenu"); if(!m)return;
  if(m.classList.contains("show"))_palClose(); else _palOpen(src);
}
(function(){
  /* restore: id first, index as the fallback for preferences written by an older build */
  let id=null,start=0;
  try{ id=localStorage.getItem(PAL_ID_KEY); }catch(e){}
  if(id!=null&&PALETTES.some(p=>p.id===id)) setPaletteById(id);
  else{
    try{ const v=localStorage.getItem(PAL_KEY); if(v!=null)start=parseInt(v,10)||0; }catch(e){}
    applyPalette(start);
  }
  /* 6ge — the ribbon's side and width are restored in `restoreRibbonPrefs`, further down. They CANNOT
     be restored here: `RIB_SIDE_KEY` and `RIB_W_KEY` are consts declared after this point, so reading
     them from this block lands in the temporal dead zone. It did, for three builds — and the try/catch
     around it swallowed the ReferenceError, so the tool simply forgot the preference in silence. */
  /* the Export tick is a MASK in some palettes and a label in others, so the bar re-reads its icons
     once the palette has settled, and again whenever one is chosen. */
  try{ syncMiniIcons(); setTimeout(syncMiniIcons,400); }catch(e){}
  const mt=$("#miniTheme");
  if(mt)mt.onclick=()=>{ try{ toggleTheme(); }catch(e){} };
  /* 6gv — the side toggle is a remote too, and here it matters WHICH copy was pressed, for the same
     reason and by the same means as Theme above: a capture listener on the bar's button stamps itself
     before the generic forwarder, and `isTrusted` tells a real press on the ribbon's own button from
     the synthetic one the remote makes. */
  const ms=document.getElementById("miniSide");
  if(ms)ms.addEventListener("click",()=>{ _sideSrc=ms; setTimeout(()=>{ _sideSrc=null; },0); },true);
  const rb=$("#ribSideBtn");
  if(rb)rb.onclick=ev=>{
    const now=RIBBON_SIDE();
    const fromBar=!(ev&&ev.isTrusted) && _sideSrc!=null;
    setRibbonSide(now?"top":"right");
    /* 6gw — AND THE RIBBON DOES NOT COME WITH IT. Ced, correcting 6gv: "the top ribbon should not
       automatically prompt, just hide it first and only show when the ui is scrolled or the user hovered
       above the mini bar."
       6gv kept the bar and let the ribbon drop in beside it, which is two pieces of chrome arriving for
       one press and the ribbon landing on the document you were reading. Going back to the top from the
       BAR should leave you exactly where you were — one thin bar, nothing else — and hand the ribbon
       back on the ordinary terms. `ribbonhidden` is those terms already: it is what a scroll down sets,
       it is what shows `#ribbonPeek`, and hovering that strip calls `revealRibbon`. So this adds no new
       behaviour at all, it just starts in the state the old one would have reached. */
    /* 6gw — and the reflow the move itself causes must not count as a scroll. Going from a narrow right
       column to a full-width top strip re-lays the document, and the browser adjusts the scroll offset
       to keep its place — measured at 1400 before the switch and 1380 after. The auto-hide handler reads
       a 20px decrease as "the reader scrolled up" and hands the ribbon straight back, which is the fault
       this line exists to prevent. `zoomQuiet` is exactly this guard, written at 6gi for exactly this
       reason ("the document moved because it was re-laid, not because anyone scrolled"), so it is reused
       rather than reinvented. */
    if(now&&fromBar){
      try{ zoomQuiet(700); }catch(e){}
      try{ document.body.classList.add("ribbonhidden"); }catch(e){}
    }
    try{ updateMiniBar(); }catch(e){}
    setStatus(now?("The ribbon is back along the top."
                   +(fromBar?" It stays out of the way until you scroll or reach the top edge.":""))
                 :"The ribbon is down the right, icon only. Hover any button for its name."); };
  /* 6gt — WHICH BUTTON WAS PRESSED, when only one of them is ever clicked.
     The bar's Theme control is a remote: it forwards to `#palBtn.click()`, so by the time the handler
     below runs the event's target is always the ribbon's button and the bar's copy has left no trace.
     A capture-phase listener on the remote stamps itself first — capture, so it cannot be outrun by the
     generic forwarder further down — and `isTrusted` separates a real press on the ribbon's own button
     from the synthetic one the remote makes. */
  const mp=document.getElementById("miniPal");
  if(mp)mp.addEventListener("click",()=>{ _palSrc=mp; setTimeout(()=>{ _palSrc=null; },0); },true);
  const b=$("#palBtn");
  if(b)b.onclick=ev=>{ ev.stopPropagation();
    togglePalMenu(ev.isTrusted ? b : (_palSrc||b)); };
  const m=document.getElementById("palMenu"); if(m)m.onclick=ev=>ev.stopPropagation();
  /* 6gl — AND THE CLOSER HAS TO KNOW ABOUT THE REMOTE. Ced: "themes is not prompting when clicking from
     mini bar." The button was working perfectly: the bar's control calls `#palBtn.click()`, that opens
     the menu and stops ITS OWN event — but the original click on the BAR carries on bubbling and
     arrives here, which shut the menu in the same tick. Measured: `palBtn.click()` left `#palMenu`
     showing at 300px wide; `miniPal.click()` left nothing open at all.
     This is a shape, not a one-off: every control on the bar is a remote, so any ribbon action that
     ends in something dismissed by an outside click would have died the same way. The exemption
     `#palBtn` already had now covers anything that drives it. */
  document.addEventListener("click",ev=>{
    const t=ev.target;
    if(t&&t.closest&&t.closest('#palBtn,[data-click="#palBtn"]'))return;
    _palClose();
  });
  document.addEventListener("keydown",ev=>{
    const mm=document.getElementById("palMenu");
    if(ev.key==="Escape"&&mm&&mm.classList.contains("show")){ _palClose(); ev.stopPropagation(); }
  },true);
  window.addEventListener("resize",()=>{ const mm=document.getElementById("palMenu");
    if(mm&&mm.classList.contains("show"))_palOpen(_palLastAnchor); });
})();
(function(){
  const btn=$("#logBtn"), pan=$("#logPanel");
  if(btn&&pan){
    btn.onclick=()=>{ pan.classList.toggle("show"); if(pan.classList.contains("show")){_logRender(); try{ syncEmbossSoon(); }catch(e){}} };
    const c=$("#logClose"); if(c)c.onclick=()=>pan.classList.remove("show");
    const cl=$("#logClear"); if(cl)cl.onclick=()=>{ _logBuf.length=0; _logRender(); };
    /* opt back into the browser console when you want it */
    const ec=$("#logEcho");
    if(ec){
      ec.classList.toggle("on",_echoConsole);
      ec.title=_echoConsole?"Also printing to the browser console — click to stop"
                           :"Also print these messages to the browser console";
      ec.onclick=()=>{ _echoConsole=!_echoConsole;
        try{ localStorage.setItem("ma.echoConsole",_echoConsole?"1":"0"); }catch(e){}
        ec.classList.toggle("on",_echoConsole);
        ec.title=_echoConsole?"Also printing to the browser console — click to stop"
                             :"Also print these messages to the browser console";
        setStatus(_echoConsole?"Messages will also go to the browser console."
                             :"Messages stay in this log only."); };
    }
    const cp=$("#logCopy"); if(cp)cp.onclick=async()=>{
      try{ await navigator.clipboard.writeText(_logBuf.join("\n")); setStatus("Message log copied."); }
      catch(e){ setStatus("Could not copy the log — select the text and copy it manually."); }
    };
  }
})();
/* help lives in a modal opened from the ribbon, not a panel at the bottom of the page */
function openHelp(){ const m=$("#helpModal"); if(m)m.classList.add("show"); }
function closeHelp(){ const m=$("#helpModal"); if(m)m.classList.remove("show"); }
(function(){
  const b2=$("#helpBtn"); if(b2)b2.onclick=openHelp;
  const c=$("#helpClose"); if(c)c.onclick=closeHelp;
  const m=$("#helpModal"); if(m)m.onclick=e=>{ if(e.target===m)closeHelp(); };
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&$("#helpModal")&&$("#helpModal").classList.contains("show")){ closeHelp(); return; }
    if(e.key==="?"&&!_typingTarget()){ openHelp(); }
  });
})();
/* Deferred by a tick: this runs above the `const LOG` declaration, so calling it directly hit the temporal
   dead zone and the stamp was silently lost. */
setTimeout(()=>{ try{ LOG(BUILD_ID); }catch(e){} },0);
(function(){
  /* Instant, flash-free restore. The mode key is authoritative; THEME_KEY is the older build's key and is
     still honoured so an existing preference is not thrown away on first load of this build. */
  let m=null,t=null;
  try{ m=localStorage.getItem(THEME_MODE_KEY); t=localStorage.getItem(THEME_KEY); }catch(e){}
  if(m==="dark"||m==="light"||m==="system") applyThemeMode(m);
  else applyThemeMode(t==="light"?"light":"dark");
})();
(async function(){
  let m=null; try{ m=localStorage.getItem(THEME_MODE_KEY); }catch(e){}
  if(m==="system")return;                                    // the system setting already decided it
  let t=null; try{ t=await store.get(THEME_KEY); }catch(e){}
  if((t==="light"||t==="dark")&&!m)applyThemeMode(t);
})();

/* ---------- logging + progress ---------- */
/* Messages go to the browser console AND into a buffer you can read without opening devtools — see the
   small "Log" button in the lower left. */
const _logBuf=[];
function _logRender(){
  const box=document.getElementById("logBody"); if(!box)return;
  box.textContent=_logBuf.slice(-400).join("\n");
  box.scrollTop=box.scrollHeight;
  const c=document.getElementById("logCount"); if(c)c.textContent=String(_logBuf.length);
}
/* A build stamp, so "which file am I running?" is answerable in one glance — it is logged on load and
   shown in the detection banner. */
const BUILD_ID="MOUNT-ANALYSIS TOOL 1a \u00b7 Built on the RFDS redlining engine: stamp, strike \u0026 write, callouts, notes, as-built import";
/* Everything goes to the in-app log (▤ Log). Mirroring it to the browser console filled the host's console
   panel below the tool with our own messages — and printed the "%c" style prefix as literal text in viewers
   that do not implement it. Turn it back on from the log panel when a browser console is genuinely wanted;
   the choice is remembered. */
try{ _echoConsole=localStorage.getItem("ma.echoConsole")==="1"; }catch(e){}
const LOG=(...a)=>{
  if(_echoConsole){ try{console.log("%c[MA]","color:#3A8BD5;font-weight:bold",...a);}catch(e){} }
  try{
    const t=new Date().toLocaleTimeString();
    _logBuf.push(t+"  "+a.map(x=>{
      if(x==null)return String(x);
      if(typeof x==="object"){ try{return JSON.stringify(x);}catch(e){return String(x);} }
      return String(x);
    }).join(" "));
    if(_logBuf.length>2000)_logBuf.splice(0,_logBuf.length-2000);
    if(document.getElementById("logPanel")&&document.getElementById("logPanel").classList.contains("show"))_logRender();
    const c=document.getElementById("logCount"); if(c)c.textContent=String(_logBuf.length);
  }catch(e){}
};
const overlay=$("#overlay");
function showProg(msg){ $("#ovMsg").textContent=msg; $("#ovBar").style.width="0%"; $("#ovPct").textContent=""; overlay.classList.add("show"); }
function setProg(done,total,msg){ const pct=total?Math.round(done/total*100):0; $("#ovBar").style.width=pct+"%"; $("#ovPct").textContent=`${done} / ${total}`; if(msg)$("#ovMsg").textContent=msg; }
function hideProg(){ overlay.classList.remove("show"); }
const nextFrame=()=>new Promise(r=>requestAnimationFrame(()=>r()));

/* ---------- PDF.js worker (sandbox-safe) ----------
   The sandbox blocks real Workers and blob/script loads, so PDF.js runs on the
   main thread. Loading pdf.worker.min.js as a UMD tag registers
   window.pdfjsWorker, which the fake-worker fallback uses directly — no fetch. */
async function ensureWorker(){
  try{
    if(window.pdfjsWorker){ pdfjsLib.GlobalWorkerOptions.workerSrc=""; }
    else{ pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; }
  }catch(e){}
}

/* ---------- upload ---------- */
const drop=$("#drop"),fileInput=$("#file");
$("#openBtn").onclick=()=>fileInput.click();
drop.onclick=()=>fileInput.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add("over");};
drop.ondragleave=()=>drop.classList.remove("over");
drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");if(e.dataTransfer.files[0])loadPdf(e.dataTransfer.files[0]);};
fileInput.onchange=e=>{if(e.target.files[0])loadPdf(e.target.files[0]);};

/* ==================================================================================================
   v60 — OPENING A FILE, MADE SAFE FOR PEOPLE WHO DID NOT WRITE THE TOOL.
   Four ways this failed for someone other than the person who built it:
     · `file.type!=="application/pdf"` turned real PDFs away. Windows hands a dragged attachment from
       Outlook, a file from some network shares and anything with an odd extension over with an EMPTY
       type, or "application/x-pdf". The file is now judged by its first bytes, which is what a PDF is.
     · a second drop while the first was still reading ran two loads into the same state at once. A
       load now carries a ticket; a newer load retires the older one, and the older one stops.
     · a password-protected or damaged file said "Couldn't open PDF: No password given" or
       "Invalid PDF structure" — true, and no use to anyone. It now says what happened and what to do.
     · a failure part-way left half a document on screen. It now goes back to the opening screen
       unless a document was already open, in which case that one stays as it was.
   ================================================================================================== */
let _loadTicket=0;
async function _looksLikePdf(file){
  try{
    const head=new Uint8Array(await file.slice(0,1024).arrayBuffer());
    const s=String.fromCharCode.apply(null,head);
    return s.indexOf("%PDF-")>=0;          /* the header may follow a little junk; readers allow 1KB */
  }catch(e){ return /\.pdf$/i.test(file.name||""); }
}
function _openErrorText(err){
  const n=(err&&err.name)||"", m=String((err&&err.message)||err||"");
  if(n==="PasswordException"||/password/i.test(m))
    return "This PDF is password-protected. Open it in Acrobat, save a copy without the password, and open that copy here.";
  if(n==="InvalidPDFException"||/Invalid PDF|bad XRef|startxref/i.test(m))
    return "This file is damaged or is not a real PDF. Try re-downloading it, or open and re-save it in Acrobat first.";
  if(n==="MissingPDFException")return "The file could not be read. Check that it still exists and try again.";
  if(/memory|allocation|Array buffer/i.test(m))
    return "This PDF is too large for this browser to open. Close other tabs and try again, or split the PDF.";
  return "Couldn't open this PDF ("+m.slice(0,160)+").";
}
async function loadPdf(file){
  if(!file)return;
  const ticket=++_loadTicket;
  const stale=()=>ticket!==_loadTicket;
  const hadDoc=!!S.doc;
  /* what a failed open must put back: the name the export uses and the bytes it is built from are
     both written BEFORE pdf.js has accepted the new file, so a refused file used to leave the open
     document's export pointing at the refused file's bytes */
  const prev={name:S.name, docBytes:S.docBytes, detached:(typeof _detached!=="undefined")?_detached:null};
  try{
    if(typeof pdfjsLib==="undefined"){setStatus("The PDF engine did not load. Reload the page; if it keeps happening, use another browser.",true);return;}
    if(!file.size){ setStatus("That file is empty (0 bytes).",true); return; }
    if(!(await _looksLikePdf(file))){ setStatus("“"+(file.name||"That file")+"” is not a PDF. Choose a .pdf file.",true); return; }
    if(stale())return;
    S.name=file.name.replace(/\.pdf$/i,"");
    setStatus("Starting…");
    await ensureWorker();
    setStatus("Reading PDF…");
    const buf=await file.arrayBuffer();
    if(stale())return;
    /* 6fe — OURS COME OFF BEFORE pdf.js EVER SEES THE FILE. pdf.js paints annotation appearance streams
       into the page canvas, so a redlined RFDS opened here used to show its old marks as part of the
       PAGE — nothing the tool could select, move or delete. They are detached first and handed back as
       editable objects, which also stops `S.docBytes` re-baking them into the next export. When there is
       nothing of ours in the file, `detachOurRedlines` returns null and the bytes go through untouched. */
    let base=buf;
    _detached=null;
    try{
      setStatus("Checking for redlines already on this PDF…");
      const det=await detachOurRedlines(new Uint8Array(buf.slice(0)));
      if(det){ _detached=det; base=det.bytes; }
    }catch(e){ LOG("detach step skipped",e&&e.message); }
    S.docBytes=(base===buf)?buf.slice(0):base.slice(0);   // clean copy for vector export / re-edit
    const _doc=await pdfjsLib.getDocument({data:(base===buf)?buf:base.slice(0)}).promise;
    if(stale()){ try{ _doc.destroy(); }catch(e){} return; }
    if(!_doc.numPages)throw new Error("Invalid PDF structure (no pages)");
    S.doc=_doc;
    S.pages=[]; S.annos=[]; S.lines=[]; S.suggestions=new Set(); S.sel=null; S.selLine=null; S.selMulti=new Set(); S.selMultiL=new Set(); S.clip=null; S.discrepancies=[]; S._zMerged=0;   /* 6ln */
    /* 6ga — a new document has its own save history. Carrying the previous one's time across would put
       a confident "Last saved 6:53 PM" beside work that has never been saved at all. */
    clearSavedReadout();
    $("#bar").style.display="block";
    showProg("Loading pages…");
    LOG("Opening",file.name,"·",S.doc.numPages,"pages");
    for(let p=1;p<=S.doc.numPages;p++){
      if(stale())return;
      const page=await S.doc.getPage(p);
      const vp1=page.getViewport({scale:1});
      /* v60 — one page whose text layer will not parse no longer refuses the whole document: that page
         is still drawn and markable, it just has nothing for Find or Analyze to read. */
      let tc={items:[]};
      try{ tc=await page.getTextContent(); }catch(e){ LOG("page "+p+": text layer unreadable — "+(e&&e.message||e)); }
      const items=[];
      for(const it of tc.items){
        if(!it.str||!it.str.trim())continue;
        const tx=pdfjsLib.Util.transform(vp1.transform,it.transform);
        const fh=Math.hypot(tx[2],tx[3]);
        items.push({str:it.str, nx:tx[4]/vp1.width, ny:(tx[5]-fh)/vp1.height, nw:(it.width||0)/vp1.width, nh:fh/vp1.height});
      }
      S.pages.push({page, w1:vp1.width, h1:vp1.height, items, jpg:null, locked:false});
      $("#bar>i").style.width=Math.round(p/S.doc.numPages*100)+"%";
      setProg(p,S.doc.numPages,`Reading page ${p} / ${S.doc.numPages}…`);
    }
    $("#bar").style.display="none";
    $("#dropWrap").classList.add("hidden");
    /* 6fc — the opening screen's full-window layout ends here. A loaded document goes back into the
       1360px column, which is where a fixed-width page belongs. */
    document.documentElement.classList.remove("nodoc");
    /* 6db — the WIP pair stays disabled whatever else opens. It is unfinished; a click on it would give
       an answer nobody should act on. */
    $("#dlPdf").disabled=false;
    if($("#homeBtn"))$("#homeBtn").disabled=false;
    if($("#orgBtn")){ $("#orgBtn").disabled=false; $("#orgBtn").onclick=openPageOrg; } $("#copyBtn").disabled=false; $("#saveBtn").disabled=false; $("#clearBtn").disabled=false;
    $("#selAllBtn").disabled=false; $("#photoBtn").disabled=false;
    $("#fitBtn").disabled=false; ["#fitPageBtn","#actualBtn","#facingBtn","#pageViewBtn"].forEach(q=>{ const b=$(q); if(b)b.disabled=false; }); $("#findInput").disabled=false; $("#findPrev").disabled=false; $("#findNext").disabled=false; $("#marksBtn").disabled=false; ["#analyzeMaBtn","#markupsBtn","#stampBtn"]   /* 6kx */
       .forEach(q=>{ const b=$(q); if(b)b.disabled=false; });
    maDetectSite();        // read the site code off the cover page; it names the export
    $("#rail").classList.add("show"); document.body.classList.add("railon");
    try{ syncEmbossSoon(); }catch(e){}   /* 6fj — the rail and the banner are new surfaces */
    buildRail();
    setProg(0,S.pages.length,"Rendering pages…");
    await renderAll();
    hideProg();
    observePages();
    await restoreEmbedded();   // if this PDF already carries redline data, load it as editable marks
    /* 6fx — ALWAYS. This was `if(!S.annos.length && !S.lines.length)`, which meant the browser cache
       was only ever consulted for a document with no marks of its own — i.e. never, for the redlined
       preliminaries this tool exists to work on. `tryRestoreAutosave` compares the two sets itself and
       stays quiet when they agree. */
    await tryRestoreAutosave();
    try{ fitColumn(); }catch(e){}       /* 6gb — size the centred column to this document's sheets */
    LOG("Loaded and rendered",S.pages.length,"pages");
    /* ==============================================================================================
       6k7 — AND THE KEYBOARD IS THE DOCUMENT'S FROM THE FIRST FRAME.
       Ced: "hot keys and shortcuts are still not working well. kindly ensure they work even in boot
       up of the pdf."
       6js made a press on anything that is not a text field hand the keyboard back, which fixed every
       case where a field had STOLEN it. It cannot fix the case where a field never gave it up in the
       first place: opening a document through the file picker leaves `<input id="file">` focused, so
       the very first thing you do with a freshly opened PDF — reach for B, or R, or L — does nothing,
       and there is no way to know why short of clicking the sheet. A drag-and-drop open leaves the
       focus wherever it was, which is the same problem wearing different clothes.
       A document has just become the subject of the whole window, so the window's keyboard is its
       own. Nothing is taken from a mark being typed in, because at this point there are no marks.
       ============================================================================================== */
    try{
      const ae=document.activeElement;
      if(ae&&ae!==document.body&&!(ae.classList&&ae.classList.contains("ed")))ae.blur();
    }catch(e){}
    /* 6gh — the trailer went: you are looking at the pages, and clicking a cell is what the tool does.
       Ced: "remove some texts on the ui, like sentences that are self explanatory." */
    setStatus(`${S.doc.numPages} PAGES`);
  }catch(err){
    if(stale())return;
    try{ $("#bar").style.display="none"; hideProg(); }catch(e){}
    LOG("open failed",(err&&err.name)||"",(err&&err.message)||String(err));
    /* nothing usable was opened: go back to the opening screen rather than leave half a document up */
    if(hadDoc && S.pages.length){
      S.name=prev.name; S.docBytes=prev.docBytes; try{ _detached=prev.detached; }catch(e){}
    }
    if(!hadDoc || !S.pages.length){
      try{ S.doc=null; S.docBytes=null; S.name=""; S.pages=[]; S.annos=[]; S.lines=[];
           const pg=$("#pages"); if(pg)pg.innerHTML="";
           $("#dropWrap").classList.remove("hidden"); document.documentElement.classList.add("nodoc"); }catch(e){}
    }
    const msg=_openErrorText(err);
    setStatus(msg,true);
    try{ MIU_GUARD.notice("Couldn't open "+(file.name||"this file"), msg, "warn"); }catch(e){}
    if(_echoConsole)console.error(err);
  }
}

/* ---------- left rail ---------- */
function buildRail(){
  const r=$("#rail"); r.innerHTML="";
  const hdr=el("div","railhdr","PAGES"); r.appendChild(hdr);
  S.pages.forEach((_,i)=>{
    const b=el("button","rt",String(i+1)); b.dataset.idx=i;
    /* In page view every other page is display:none, so scrolling to one did nothing — go through
       gotoPageInstant, which switches the shown page instead. */
    b.onclick=()=>{ if(typeof gotoPageInstant==="function"){ gotoPageInstant(i); return; }
      const pg=document.querySelector(`.page[data-idx="${i}"]`);
      if(pg)pg.scrollIntoView({behavior:"auto",block:"start"}); };
    r.appendChild(b);
  });
  updateRail();
}
function updateRail(){
  const red=new Set([...S.annos.map(a=>a.page),...S.lines.map(l=>l.page)]);
  /* ==============================================================================================
     6kg — A PAGE THAT ONLY CARRIES A STAMP IS NOT A PAGE YOU HAVE REDLINED.
     Ced: "change the shade of color in pages if the redline is only the stamp."
     Stamping every page is one action, and it lit the whole rail: forty pages marked "has work on
     it", which is the same as none of them being marked. A page whose only marks are the stamp gets
     a paler shade of the same colour — present, accounted for, and plainly not the thing you are
     looking for when you scan the rail for the pages you actually corrected.
     ============================================================================================== */
  const stampOnly=new Set();
  red.forEach(pi=>{
    const A=S.annos.filter(a=>a.page===pi), L=(S.lines||[]).filter(l=>l.page===pi);
    if(!A.length&&!L.length)return;
    if(L.length)return;                                   /* a stroke is never part of a stamp */
    if(A.every(a=>!!a.copRole))stampOnly.add(pi);
  });
  document.querySelectorAll("#rail .rt").forEach(b=>{
    const i=+b.dataset.idx;
    b.classList.toggle("done",red.has(i));
    b.classList.toggle("stamponly",stampOnly.has(i));
  });
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("redlined",red.has(+p.dataset.idx)));
}
let io=null;
/* 6lh — `rebuild` is whether the set of page ELEMENTS has changed. After `renderAll` it has, and the
   observer has to be pointed at the new ones. After a ZOOM it has not — 6ep made zoom keep every page
   div — so rebuilding only costs an entry per page on the next frame and an `unloadPage` for each one
   off screen. The other two halves are wanted either way: which page you are looking at can change
   with the scale, and page view has to be re-applied. See `rezoomPages`. */
function observePages(rebuild){
  if(rebuild!==false)setupVirtualization();
  updateCurrentRail(); reapplyPageView();
}
/* Put page view back after the page list is rebuilt. */
function reapplyPageView(){
  try{
    if(typeof _pageView!=="undefined"&&_pageView){
      showOnlyPage(typeof _viewPi==="number"?_viewPi:0);
      document.body.classList.add("chromehide");
    }
  }catch(e){}
}
function updateCurrentRail(){
  const mid=window.scrollY+window.innerHeight/2; let best=0,bd=1e9;
  document.querySelectorAll(".page").forEach(p=>{ const r=p.getBoundingClientRect(); const c=r.top+window.scrollY+r.height/2; const d=Math.abs(c-mid); if(d<bd){bd=d;best=+p.dataset.idx;} });
  document.querySelectorAll("#rail .rt").forEach(b=>b.classList.toggle("cur",+b.dataset.idx===best));
}
window.addEventListener("scroll",()=>{updateCurrentRail();},{passive:true});
$("#railToggle").onclick=()=>{ const on=$("#rail").classList.toggle("show"); document.body.classList.toggle("railon",on);
  try{ syncEmbossSoon(); }catch(e){}
  /* 6gp — the bar's copy of this control shows the state, so the state has to reach it. Both of the
     places that change it now say so, rather than the bar guessing. */
  try{ updateMiniBar(); }catch(e){} };

/* auto-hide ribbon: hide when scrolling down through pages, reveal on scroll-up or top-hover.
   6gc — `scrolled` is now tracked separately from `ribbonhidden`, because they stopped meaning the same
   thing the moment the ribbon could live on the left: there, nothing hides, but the compact bar still
   has to appear. `scrolled` says "the ribbon is not where it was"; `ribbonhidden` says "it has gone". */
let _lastY=0;
window.addEventListener("scroll",()=>{
  const y=window.scrollY;
  if(!S.doc){ document.body.classList.remove("ribbonhidden","scrolled"); _lastY=y; return; }
  document.body.classList.toggle("scrolled", y>140);
  if(RIBBON_SIDE()){ document.body.classList.remove("ribbonhidden"); _lastY=y; return; }
  /* 6gi — the document moved because it was re-laid at a new scale, not because anyone scrolled */
  if(inZoomQuiet()){ _lastY=y; return; }
  if(y>140 && y>_lastY+6){ document.body.classList.add("ribbonhidden"); }
  else if(y<_lastY-6 || y<120){ document.body.classList.remove("ribbonhidden"); }
  _lastY=y;
},{passive:true});
/* ================================================================================================
   6gc — THE TWO THINGS THAT OPEN THE RIBBON, AND NOTHING ELSE.

   Ced, first: "the ribbon will expand only when hovered on the top most part of the ui or in three dots,
   not when picking functions on the status bar." Then, simpler: "just remove the three dots, just make
   the ribbon appear when hovered at the top most of ui."

   That second half is the whole design. A bar you cannot reach without the ribbon dropping on top of it
   is not a shortcut, it is a trap — so the reveal zone is a 10px strip at the very top (`#ribbonPeek`,
   stacked ABOVE the bar so the pointer meets it first) and NOTHING else. Reaching for Save on the bar
   comes up from below and never crosses it.
   ================================================================================================ */
/* true when the ribbon is off along a side rather than across the top */
function RIBBON_SIDE(){ return document.body.classList.contains("ribbonright"); }
function revealRibbon(on){
  if(RIBBON_SIDE())return;                       // it never went anywhere
  if(document.body.classList.contains("chromehide")){
    document.body.classList.toggle("chromeshow",!!on);
  } else if(on){
    document.body.classList.remove("ribbonhidden");
  }
}
(function(){
  const peek=document.getElementById("ribbonPeek");
  if(peek)peek.addEventListener("pointerenter",()=>revealRibbon(true));
  /* Every control on the bar is a REMOTE for the ribbon's own button. The ribbon stays the single
     definition of what each thing does, so this bar cannot drift away from it, and a disabled ribbon
     button disables its remote too. */
  document.querySelectorAll("#miniBar [data-click]").forEach(b=>{
    b.addEventListener("click",()=>{
      const t=document.querySelector(b.getAttribute("data-click"));
      if(t && !t.disabled)t.click();
    });
  });
  try{ syncMiniIcons(); }catch(e){}
})();
/* 6gd — THE BAR'S ICONS ARE THE RIBBON'S ICONS, not a second set that happens to look similar.
   Ced: "follow the design language of the actual ribbon to the mini bar … the icons should match."
   Every remote takes the glyph off the button it drives, so renaming a ribbon button moves its icon on
   the bar in the same edit. Only where the ribbon button is words all the way through (Export) does the
   markup's own glyph stand. */
function syncMiniIcons(){
  const paint=(el,src)=>{
    if(!el||!src)return false;
    const cs=getComputedStyle(src);
    const gi=(cs.getPropertyValue("--gi")||"").trim();
    const g=(cs.getPropertyValue("--g")||"").trim();
    el.style.removeProperty("--gi"); el.style.removeProperty("--g");
    el.classList.remove("mb-ico","mb-img");
    if(gi){ el.style.setProperty("--gi",gi); el.textContent="";
            el.classList.add("mb-ico","mb-img"); return true; }
    if(g){ el.style.setProperty("--g",g); el.textContent="";
           el.classList.add("mb-ico"); return true; }
    const lead=leadGlyph(src.textContent);      /* the ribbon has not been iconified in this palette */
    if(lead){ el.textContent=lead; return true; }
    return false;
  };
  document.querySelectorAll("#miniBar [data-click]").forEach(b=>{
    const t=document.querySelector(b.getAttribute("data-click"));
    if(!t)return;
    if(!b.title && t.title)b.title=t.title;
    paint(b,t);
  });
  /* the tool indicator takes the ACTIVE tool button's mark, by the same road */
  const tl=document.getElementById("miniTool");
  if(tl){
    const btn=document.querySelector('#tools .tool[data-mode="'+(S.mode||"")+'"]');
    if(btn&&!paint(tl,btn))tl.textContent="\u2022";
  }
}

/* 6ge — typing the site on the bar types it into the field that owns it. `#s_site` already carries the
   whole chain behind it — S.atollName, the export name preview, the autosave — so this hands the value
   over and lets that run, rather than keeping a second copy of the truth. */
(function(){
  const nm=document.getElementById("miniName"); if(!nm)return;
  const push=()=>{
    const si=document.getElementById("s_site"); if(!si)return;
    si.value=nm.value;
    si.dispatchEvent(new Event("input",{bubbles:true}));
  };
  nm.addEventListener("input",push);
  nm.addEventListener("keydown",e=>{
    if(e.key==="Enter"){ e.preventDefault(); nm.blur(); }
    else if(e.key==="Escape"){ e.preventDefault(); try{ updateMiniBar(); }catch(_){ } nm.blur(); }
    e.stopPropagation();          /* the document's single-letter tool keys are not for this field */
  });
  nm.addEventListener("blur",()=>{ try{ updateMiniBar(); }catch(e){} });
})();
/* keep the bar telling the truth: the document, the tool, the count, and whether each remote can act */
/* =================================================================================================
   6hb — A TOGGLE LOOKS LIKE WHAT IT IS
   -------------------------------------------------------------------------------------------------
   Ced: "make sure that the toggles and buttons are working accordingly when selecting. some icons are
   not showing clicked when being clicked."

   Every toggle in the ribbon DID its job; several of them just never said so. The state was kept in
   three different places depending on the control — a class on the button (Snap, Magnet), a class on
   the body (Pages, Marks), or nothing at all but the panel's own `show` (the MA panel, the theme
   menu) — and the two that used the body never put anything on the button, so pressing them looked
   like nothing had happened.

   One function reads the LIVE state of each and writes the same two things on all of them: the `on`
   class the stylesheet already knows how to draw (filled while pressed, in both the iconified ribbon
   and the text one) and `aria-pressed`, which is the same fact for anyone not looking at it. It is
   called wherever the mini bar is refreshed, which is every path that changes any of them.
   ================================================================================================= */
function reflectToggles(){
  const set=(id,on)=>{ const b=document.getElementById(id); if(!b)return;
    b.classList.toggle("on",!!on);
    b.setAttribute("aria-pressed",on?"true":"false"); };
  const shown=sel=>{ const n=document.querySelector(sel); return !!(n&&n.classList.contains("show")); };
  try{
    set("railToggle",document.body.classList.contains("railon"));
    set("marksBtn",document.body.classList.contains("markson"));
    /* 6kx — the Assist buttons that open the panel light while it is open. This used to be one
       line for `maBtn`; Notes is gone, so it is the two that are left, each lit only when the panel
       is showing ITS card — pressing Markups while the stamp is up must not leave both lit. */
    {
      const _maUp=shown("#maPanel");
      const _card=(()=>{ try{ const p=document.getElementById("maPanel");
                              return (p&&p.dataset)?p.dataset.ma:""; }catch(e){ return ""; } })();
      set("markupsBtn",_maUp&&_card==="markups");
      set("stampBtn",  _maUp&&_card==="stamp");
    }
    set("pageViewBtn",(typeof _pageView!=="undefined")&&!!_pageView);
    set("facingBtn",(typeof _facing!=="undefined")&&!!_facing);
    set("snapBtn",!!(S&&S.snap));
    set("magnetBtn",!!(S&&S.magnet));
    set("ribSideBtn",(typeof RIBBON_SIDE==="function")&&!!RIBBON_SIDE());
    set("palBtn",shown("#palMenu"));
    set("orgBtn",shown("#pageOrg"));
    set("helpBtn",shown("#helpModal"));
    /* Snap and Magnet also carry `active`, which is what the icon ribbon paints; keep the two in step
       so neither styling path can be the odd one out. */
    ["snapBtn","magnetBtn"].forEach(id=>{ const b=document.getElementById(id);
      if(b)b.classList.toggle("active",b.classList.contains("on")); });
  }catch(e){}
}
function updateMiniBar(){
  try{ reflectToggles(); }catch(e){}
  const bar=document.getElementById("miniBar"); if(!bar)return;
  /* 6gd — THE SITE, NOT THE FILE. Ced: "instead of file name, replace it with site name rather."
     The file name is an accident of whoever last exported it ("OHL01029 - Redlined Preliminary RFDS
     (2) copy"); the ATOLL site name is what the work is actually about, and it is what the export is
     named from. The file name stays on the tooltip, because that is still how you find it on disk. */
  const nm=document.getElementById("miniName");
  if(nm && document.activeElement!==nm){      /* never overwrite what is being typed */
    const site=((($("#s_site")&&$("#s_site").value)||S.atollName||"")+"").trim();
    const file=(S.name||"").trim();
    nm.value=site;
    nm.placeholder=file||"site name";
    nm.title=site ? ("Site "+site+(file?("  \u00b7  "+file):"")) : (file?("File: "+file):"No document open");
  }
  /* the tool, as the tool's OWN glyph — read off the ribbon button that is active, so the bar and the
     ribbon can never disagree about what is selected. Its name goes on the tooltip and the aria label,
     which is where words belong on an icon-only bar. */
  /* 6ge — the tool's MARK is painted by syncMiniIcons from the ribbon's own --g/--gi, so all that is
     left here is what the mark means. Setting textContent here as well would overwrite it. */
  const tl=document.getElementById("miniTool");
  if(tl){
    const name=(typeof MODE_NAMES!=="undefined" && MODE_NAMES[S.mode]) || S.mode || "—";
    tl.title="Tool: "+name;
    tl.setAttribute("aria-label","Tool: "+name);
    tl.setAttribute("data-mode",S.mode||"");
    try{ syncMiniIcons(); }catch(e){}
  }
  /* 6gg — the banner's three pieces, read from the same places the banner reads them, so the bar and
     the banner can never disagree about which document this is or what it will be called. */
  const kd=document.getElementById("miniKind");
  if(kd){
    const tagEl=document.getElementById("detectTag");
    const txt=((tagEl&&tagEl.textContent)||"").trim();
    const real=S.doc && txt && txt!=="\u2014";
    kd.hidden=!real;
    if(real){
      kd.textContent=txt;                              /* the banner's own wording, in full */
      kd.title=txt;
      kd.classList.toggle("is-final", /final/i.test(txt));
    }
  }
  const fn=document.getElementById("miniFname");
  if(fn){
    let name="";
    try{ name=S.doc?(outputFilename()+".pdf"):""; }catch(e){}
    fn.hidden=!name;
    if(name){ fn.textContent=name; fn.title="Export name: "+name; }
  }
  const ct=document.getElementById("miniCount");
  if(ct){ const n=(S.annos||[]).length+(S.lines||[]).length;
          ct.textContent="\u270E "+n;
          ct.title=n+" redline"+(n===1?"":"s")+" on this document"; }
  bar.querySelectorAll("button[data-click]").forEach(b=>{
    const t=document.querySelector(b.getAttribute("data-click"));
    b.disabled=!!(t&&t.disabled);
  });
  /* 6gp — THE TWO REMOTES THAT ARE TOGGLES SAY SO. Ced: "page view and view page list should also have
     an indication (make the icon filled/reversed when clicked) in the minibar."
     Every other control on the bar does something and is done; these two put the tool INTO a state and
     leave it there, and a button that changes the world and then looks exactly as it did is the one
     kind of control that has to show its state. The state is read from the app rather than from the
     button's own history, so the bar is right after a keyboard shortcut, a click on the ribbon's own
     copy, or a restore — the same rule that keeps every other icon on this bar honest. */
  /* 6gt — the side toggle joins them: it is a state, not an action, and its fill says where the ribbon
     is. The shape itself is copied from the ribbon's button by syncMiniIcons. */
  const onState=[["miniPageView", document.body.classList.contains("chromehide")],
                 ["miniRail",     document.body.classList.contains("railon")],
                 ["miniSide",     RIBBON_SIDE()]];
  onState.forEach(([id,on])=>{
    const b=document.getElementById(id); if(!b)return;
    b.classList.toggle("on",!!on);
    b.setAttribute("aria-pressed", on?"true":"false");
  });
}
/* ---- 6ge · the side ribbon's width is the user's -----------------------------------------------
   Ced: "add the capacity to resize the right ribbon so the user has the control."
   The floor is one column of buttons and the ceiling is a third of the window; inside that the width is
   whatever they drag it to, remembered between sessions. It also answers the arrow keys, because a 12px
   grip is a hard thing to hit and an impossible one without a mouse. Double-click restores the default,
   which is the width three icons need — the thing that took two goes to get right. */
const RIB_W_KEY="ma.ribbonWidth";
/* 6gf — the floor is THREE icons to a row, not one. Ced: "the stretching back should also have a
   limit which is the three icons." 112 = three 30px buttons + two 4px gaps + the group and toolbar
   padding; below that the rows would drop to two and the column would run off the bottom. */
const RIB_W_DEF=112, RIB_W_MIN=112;
function ribWidthMax(){ return Math.max(RIB_W_DEF, Math.round(window.innerWidth/3)); }
function setRibbonWidth(px,save){
  const w=Math.max(RIB_W_MIN,Math.min(ribWidthMax(),Math.round(px||RIB_W_DEF)));
  document.body.style.setProperty("--rib-w",w+"px");
  try{ syncMarkClearSoon(); }catch(e){}     /* 6gt — the mark follows the grip */
  if(save!==false){ try{ localStorage.setItem(RIB_W_KEY,String(w)); }catch(e){} }
  return w;
}
function loadRibbonWidth(){
  let w=RIB_W_DEF;
  try{ const v=parseInt(localStorage.getItem(RIB_W_KEY),10); if(v>0)w=v; }catch(e){}
  setRibbonWidth(w,false);
}
(function(){
  const grip=document.getElementById("ribGrip"); if(!grip)return;
  let id=null;
  const from=e=>{
    if(!RIBBON_SIDE())return;
    id=e.pointerId; grip.setPointerCapture&&grip.setPointerCapture(id);
    document.body.classList.add("ribsizing"); e.preventDefault();
  };
  const move=e=>{
    if(id==null)return;
    setRibbonWidth(window.innerWidth-e.clientX-12);   /* the 12px gutter the ribbon is inset by */
  };
  const stop=()=>{
    if(id==null)return;
    id=null; document.body.classList.remove("ribsizing");
    try{ syncEmbossSoon(); }catch(e){}
    try{ layoutAnnos(); }catch(e){}
  };
  grip.addEventListener("pointerdown",from);
  grip.addEventListener("pointermove",move);
  grip.addEventListener("pointerup",stop);
  grip.addEventListener("pointercancel",stop);
  grip.addEventListener("dblclick",()=>{ setRibbonWidth(RIB_W_DEF);
    setStatus("Ribbon width reset — wide enough for three icons to a row."); });
  grip.addEventListener("keydown",e=>{
    const step=e.shiftKey?24:6;
    const cur=parseInt(getComputedStyle(document.body).getPropertyValue("--rib-w"),10)||RIB_W_DEF;
    if(e.key==="ArrowLeft"){ setRibbonWidth(cur+step); e.preventDefault(); }
    else if(e.key==="ArrowRight"){ setRibbonWidth(cur-step); e.preventDefault(); }
    else if(e.key==="Home"){ setRibbonWidth(RIB_W_DEF); e.preventDefault(); }
  });
  window.addEventListener("resize",()=>{
    if(!RIBBON_SIDE())return;
    const cur=parseInt(getComputedStyle(document.body).getPropertyValue("--rib-w"),10)||RIB_W_DEF;
    if(cur>ribWidthMax())setRibbonWidth(ribWidthMax());
  });
})();
/* ================================================================================================
   6gm — THE CHROME COLUMN'S WIDTH, and the two grips that set it.

   Ced: "can you maximize the space of the top ribbon based on how big the space at the top is? … also
   have the user the freedom to adjust the top ribbon like the right ribbon. make it adustable on both
   left and right but the top ribbon must adjust from the center."

   THE DEFAULT IS FILL. The preference stores the literal string "fill" rather than a number, so the
   column keeps filling as the window changes size instead of freezing at whatever it happened to be
   when the preference was written. A number is stored only once the user has actually dragged, and a
   drag back out to the edge stores "fill" again rather than a number that stops tracking.

   THE DRAG IS SYMMETRIC. Either grip moves both edges by the same amount, so the ribbon grows and
   shrinks about its own centre and never slides sideways under the hand.
   ================================================================================================ */
const COL_W_KEY="ma.colWidth";
const COL_MIN=760;
function colMax(){ return Math.max(COL_MIN, window.innerWidth); }
function colPref(){ try{ return localStorage.getItem(COL_W_KEY)||"fill"; }catch(e){ return "fill"; } }
function colWidthNow(){
  const p=colPref();
  if(p==="fill")return colMax();
  const n=parseInt(p,10);
  return (isFinite(n)&&n>0) ? Math.max(COL_MIN,Math.min(n,colMax())) : colMax();
}
function applyColWidth(px,save){
  const max=colMax();
  const val=(px==null) ? colWidthNow() : Math.max(COL_MIN,Math.min(Math.round(px),max));
  const root=document.documentElement;
  root.style.setProperty("--col-w",val+"px");
  root.style.setProperty("--col-side",Math.max(0,Math.round((window.innerWidth-val)/2))+"px");
  /* 6gp — THE COLUMN GRID IS FOR THE FULL-WIDTH RIBBON ONLY. Ced: "if the ribbon is not to max, do not
     follow the logic of per category 4 icons max, it should flow as before."
     He is right, and the reason is that the grid is a way of SPENDING width, not of saving it. Folding
     every category into four columns turns a long thin run into a short fat one, which is what puts ten
     groups on a single row of an 1829px ribbon. Narrow the ribbon and that same fold buys nothing and
     costs height: the groups are already as narrow as they need to be and stacking them just makes the
     strip taller. So the fold, the left alignment inside a group, the edge-to-edge spread and the tall
     export all hang off this one class, and below full width the ribbon is exactly what it was. */
  try{ document.body.classList.toggle("colmax", val>=max-4); }catch(e){}
  try{ markRibbonRowsSoon(); }catch(e){}
  try{ syncRailTopSoon(); }catch(e){}     /* 6gu — a wider ribbon is a taller ribbon is a new top */
  try{ syncPageColSoon(); }catch(e){}     /* 6lb — the sheet keeps the window, not the column */
  if(px!=null&&save!==false){
    /* within 4px of the edge counts as "fill", so dragging back out resumes tracking the window */
    try{ localStorage.setItem(COL_W_KEY, val>=max-4 ? "fill" : String(val)); }catch(e){}
  }
  return val;
}
(function(){
  const L=document.getElementById("colGripL"), R=document.getElementById("colGripR");
  if(!L||!R)return;
  let id=null, startX=0, startW=0, sign=1;
  const begin=(e,s)=>{
    if(RIBBON_SIDE())return;
    id=e.pointerId; sign=s; startX=e.clientX; startW=colWidthNow();
    const g=(s<0?L:R); g.setPointerCapture&&g.setPointerCapture(id);
    document.body.classList.add("colsizing"); e.preventDefault();
  };
  const move=e=>{ if(id==null)return;
    /* BOTH edges move, so the width changes by twice the pointer's travel */
    applyColWidth(startW + (e.clientX-startX)*sign*2);
  };
  const stop=()=>{ if(id==null)return; id=null;
    document.body.classList.remove("colsizing");
    try{ syncEmbossSoon(); }catch(e){}
    try{ layoutAnnos(); }catch(e){}
  };
  [[L,-1],[R,1]].forEach(([g,s])=>{
    g.addEventListener("pointerdown",e=>begin(e,s));
    g.addEventListener("pointermove",move);
    g.addEventListener("pointerup",stop);
    g.addEventListener("pointercancel",stop);
    g.addEventListener("dblclick",()=>{ applyColWidth(colMax());
      setStatus("Ribbon width reset — it fills the window."); });
    g.addEventListener("keydown",e=>{
      const step=(e.shiftKey?48:12)*s;
      const cur=colWidthNow();
      if(e.key==="ArrowLeft"){ applyColWidth(cur-step*2); e.preventDefault(); }
      else if(e.key==="ArrowRight"){ applyColWidth(cur+step*2); e.preventDefault(); }
      else if(e.key==="Home"){ applyColWidth(colMax()); e.preventDefault(); }
    });
  });
  window.addEventListener("resize",()=>{ applyColWidth(null,false); });
})();
/* Put the saved side and width back. This runs HERE, below the consts it reads, and it reports a
   failure to the log instead of swallowing it — the previous version was silently doing nothing. */
function restoreRibbonPrefs(){
  const note=(what,e)=>{ try{ LOG("ribbon "+what+" not restored:",(e&&e.message)||e); }catch(_){ } };
  try{ loadRibbonWidth(); }catch(e){ note("width",e); }
  try{ applyColWidth(null,false); }catch(e){ note("column width",e); }
  try{
    let side="top";
    try{ side=localStorage.getItem(RIB_SIDE_KEY)==="right"?"right":"top"; }catch(e){}
    setRibbonSide(side,false);
  }catch(e){ note("side",e); }
}
/* 6ge — AFTER the document is ready, not inline. Restoring a preference touches things declared all
   over this file — consts below the call site, `stampRibbonIcons`, the ribbon's buttons — and running
   it during parse means depending on the order of every one of them. It failed silently for three
   builds that way: the width came back and the side did not, and the catch around it said nothing.
   Waiting for DOMContentLoaded costs one frame and removes the whole class of problem. */
if(document.readyState==="loading")
  document.addEventListener("DOMContentLoaded",restoreRibbonPrefs,{once:true});
else setTimeout(restoreRibbonPrefs,0);
/* setTimeout, not a bare call: the PACKED build inflates this whole script after DOMContentLoaded has
   already fired, so the else-branch would run inline — back inside the temporal dead zone this was
   moved to escape. The file build and the artifact take different branches here and both have to work,
   which is exactly the pair a test has to cover. */
/* ---- 6gc · which side the ribbon lives on ------------------------------------------------------ */
const RIB_SIDE_KEY="ma.ribbonSide";
/* At 76px there is no room for words, so every ribbon control shows its own glyph and nothing else.
   The glyph is READ OFF THE BUTTON rather than kept in a second list: every control in this ribbon
   already begins with one, and a hand-maintained icon table would go stale the first time a button was
   renamed. Four buttons are words all the way through and are named here — that list is short enough
   to be honest about, and `stampRibbonIcons` warns to the log if a button ends up with no glyph. */
/* The leading glyph of a label, without a regex full of unicode escapes — a first cut used one and the
   escapes were mangled into literal characters on the way into the file, which made the whole document
   fail to parse. Code-point arithmetic cannot be mangled: take the first character, keep its surrogate
   partner if it has one, then swallow any variation selector, ZWJ or keycap that belongs to it. */
function leadGlyph(text){
  const t=String(text||"").trim();
  if(!t)return "";
  const c0=t.charCodeAt(0);
  if(c0<128)return "";                       // plain ASCII label, no glyph of its own
  let i=(c0>=0xD800&&c0<=0xDBFF)?2:1;        // surrogate pair
  for(;i<t.length;i++){
    const c=t.charCodeAt(i);
    if(c===0xFE0F||c===0xFE0E||c===0x200D||c===0x20E3){ continue; }
    if(c===0x200D){ continue; }
    if(t.charCodeAt(i-1)===0x200D){ i+=(c>=0xD800&&c<=0xDBFF)?1:0; continue; }
    break;
  }
  return t.slice(0,i);
}
const RIB_ICON_FALLBACK={dlPdf:"⭳", openBtn:"📄", actualBtn:"1:1", helpBtn:"?"};
/* ================================================================================================
   6gm — NO DIVIDER AT THE START OF A ROW. Ced: "do not include a line if its the first and last of a
   row."

   The blade is drawn by `.grp + .grp::after`, which asks a question CSS can answer — "is there a group
   before this one?" — instead of the question that matters, which is "is there a group before this one
   ON THIS ROW?". When the ribbon wraps, the first group of the second row still has a sibling before it
   (at the end of the row above), so it was given a blade hanging in the gutter with nothing to its
   left: a divider dividing a group from the edge of the ribbon.

   CSS cannot see a wrap, so this measures it. A group starts a row when its top differs from the
   previous group's, and a group that starts a row loses its blade.

   The side ribbon is excluded by construction, not by accident: its groups are stacked, so EVERY one of
   them has a different top and this test would strip every divider in the column. There the blade sits
   above each group and `+` already answers the right question, because a column has one group per row.
   ================================================================================================ */
/* 6gp — a group asked for a row COUNT gets the narrowest width that achieves it.
   Ced: "just make sure it is 2 rows." A column number is the wrong thing to write down for that — it is
   a guess about widths that happens to be right until someone adds a button — so the group carries the
   requirement (`data-maxrows`) and this finds the width. The wrap is simulated rather than tried in the
   DOM, so the whole search costs one read of each child's width instead of a reflow per candidate. */
function fitGroupRows(){
  const tb=document.getElementById("toolbar"); if(!tb)return;
  tb.querySelectorAll(".grp[data-maxrows]").forEach(g=>{
    const gw=g.querySelector(".grow"); if(!gw)return;
    /* 6gp — and it CLEARS ITSELF when the grid is not in force. This writes an inline width, which
       outranks every rule in the stylesheet, so a `colmax` rule that stands down is not enough: the
       width it wrote would sit there holding VIEW at 304px in a ribbon that had gone back to free
       flow. An inline style has to be taken off by the thing that put it on. */
    if(RIBBON_SIDE() || !document.body.classList.contains("colmax")){
      gw.style.removeProperty("max-width"); return; }
    const want=Math.max(1,parseInt(g.getAttribute("data-maxrows"),10)||2);
    const gap=parseFloat(getComputedStyle(gw).columnGap||getComputedStyle(gw).gap)||6;
    const ws=[...gw.children]
      .map(c=>c.getBoundingClientRect().width)
      .filter(w=>w>0)
      .map(w=>Math.ceil(w));
    if(!ws.length)return;
    const rowsAt=w=>{ let rows=1,cur=0;
      for(const x of ws){ const add=cur?cur+gap+x:x;
        if(add>w+0.5 && cur){ rows++; cur=x; } else cur=add; }
      return rows; };
    let lo=Math.max.apply(null,ws);
    let hi=ws.reduce((a,b)=>a+b,0)+gap*(ws.length-1);
    let best=hi;
    while(lo<=hi){ const mid=Math.floor((lo+hi)/2);
      if(rowsAt(mid)<=want){ best=mid; hi=mid-1; } else lo=mid+1; }
    gw.style.maxWidth=Math.ceil(best)+"px";
  });
}
function markRibbonRows(){
  const tb=document.getElementById("toolbar"); if(!tb)return;
  const gs=[...tb.querySelectorAll(".grp")];
  if(RIBBON_SIDE()){ gs.forEach(g=>g.classList.remove("rowstart")); return; }
  let prevTop=null;
  gs.forEach(g=>{
    const r=g.getBoundingClientRect();
    if(!(r.width>0&&r.height>0))return;                 /* hidden groups take no part in a row */
    const t=Math.round(r.top);
    g.classList.toggle("rowstart", prevTop===null || Math.abs(t-prevTop)>4);
    prevTop=t;
  });
}
let _rowsPend=null;
function markRibbonRowsSoon(){
  if(_rowsPend)return;
  _rowsPend=requestAnimationFrame(()=>{ _rowsPend=null;
    try{ fitGroupRows(); }catch(e){}      /* widths first — the row marking reads the result */
    try{ markRibbonRows(); }catch(e){} });
}
(function(){
  /* A ResizeObserver on the ribbon itself catches every reflow whatever caused it — the window, the
     column grips, a palette that changes a label's width, a button appearing when a document loads.
     Hooking the handful of callers by name would have missed one of those within a build or two. */
  try{
    const tb=document.getElementById("toolbar");
    if(tb && window.ResizeObserver){ new ResizeObserver(markRibbonRowsSoon).observe(tb); }
  }catch(e){}
  window.addEventListener("resize",markRibbonRowsSoon);
  markRibbonRowsSoon();
})();
function stampRibbonIcons(){
  const tb=document.getElementById("toolbar"); if(!tb)return;
  const missing=[];
  tb.querySelectorAll(".btn, .tool, .btn-redline").forEach(b=>{
    if(b.dataset.ico)return;
    let ico=RIB_ICON_FALLBACK[b.id]||"";
    if(!ico)ico=leadGlyph(b.textContent);
    if(!ico){ ico=(b.textContent||"?").trim().slice(0,2)||"?"; missing.push(b.id||b.className); }
    b.dataset.ico=ico;
    if(!b.title){ const t=(b.textContent||"").trim(); if(t)b.title=t; }
  });
  if(missing.length)LOG&&LOG("Side ribbon: no glyph for",missing.join(", "),"— showing initials");
  /* the Find placeholder is a sentence; in a 76px column it shows four letters of one. Swap it for the
     shortest thing that still says what the box is, and put the sentence back on the way out. */
  const fi=document.getElementById("findInput");
  if(fi){
    if(fi.dataset.fullPh==null)fi.dataset.fullPh=fi.placeholder||"";
    fi.placeholder=RIBBON_SIDE()?"Find":(fi.dataset.fullPh||"");
    if(!fi.title)fi.title=fi.dataset.fullPh||"Find in document";
  }
}
/* 6gt — THE PAGES RAIL LINES UP WITH THE CHROME, AND FOLLOWS IT.
   The rail is the one panel that is on screen the whole time, and it was pinned to the window while
   everything beside it was pinned to the chrome. Which chrome depends on what is showing: along the top
   the ribbon sits below the lockup and the banner, and once you scroll it goes and the quick bar takes
   its place at the very top — so the rail's top has to move with whichever one you can actually see,
   not with one of them.

   Measured on a 1919px window at full ribbon width: ribbon top 257, bar top 10, rail top 10 either way.

   The floor is the old 10px, so nothing can push the rail off the top of the window, and a state with
   no chrome at all (page view) reads as 10 rather than as whatever an invisible box last measured. */
function _visTop(el){
  if(!el)return null;
  const cs=getComputedStyle(el);
  if(cs.visibility==="hidden"||cs.display==="none"||parseFloat(cs.opacity||"1")<0.05)return null;
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1)return null;
  if(r.bottom<=0||r.top>=window.innerHeight)return null;   /* scrolled away is not showing */
  return r.top;
}
/* 6gv — where the browser anchors the rail itself, this whole mechanism is down to one job.
   `@supports (anchor-name:--x)` in the stylesheet hands the tracking to the layout engine for every
   state except `ribbonhidden`, which `anchor()` cannot follow because it reads the anchor's
   UNTRANSFORMED box and the ribbon leaves on a transform. So on a browser that has it, the measuring
   below runs only while the ribbon is sliding away — and on one that does not, it runs as it did at
   6gu and the rail behaves exactly as it did there. */
const _RAIL_ANCHORED=(function(){
  try{ return !!(window.CSS&&CSS.supports&&CSS.supports("anchor-name","--x")
                 &&CSS.supports("top","anchor(--x top)")); }catch(e){ return false; }
})();
function _railNeedsJS(){
  return !_RAIL_ANCHORED || document.body.classList.contains("ribbonhidden");
}
function syncRailTop(){
  const rail=document.getElementById("rail"); if(!rail)return;
  /* 6gu — THE RIBBON WHILE THE RIBBON IS THERE, THE BAR ONLY ONCE IT HAS GONE.
     6gt took the MINIMUM of the two tops, and that is what Ced saw as the rail not keeping pace: the
     quick bar appears at y>140 while the ribbon is still sliding up behind it, so from that instant the
     minimum is the bar's 10 and the rail jumped there in one step while the ribbon still had 100-odd
     pixels to travel. Measured on a slow scroll: ribbon 257 -> 190 -> 120 -> 10, rail 257 -> 10.
     The ribbon is the thing the rail belongs beside, so it follows the ribbon for as long as the ribbon
     is drawn, clamped at the floor — which means it glides up WITH it and stops at 10 exactly as the
     ribbon tucks behind the bar, the same distance in the same time. Once the ribbon is really gone,
     the bar is what is there, and it is at the floor anyway. */
  const rib=_visTop(document.getElementById("toolbar"));
  const bar=_visTop(document.getElementById("miniBar"));
  const src=(rib!=null)?rib:bar;
  const t=(src==null)?10:Math.max(10,Math.round(src));
  document.documentElement.style.setProperty("--rail-top",t+"px");
}
/* 6gu — and it is measured EVERY FRAME while anything is moving, not once per event.
   6gt scheduled a single frame per scroll event and per transitionend. Between the last scroll event
   and the end of the ribbon's .12s transform there are no events at all, so the rail sat still through
   the part of the move you can actually see and then arrived — "there is a delay on it aligning". A
   short rAF watch costs nothing at rest and tracks the ribbon exactly while it is in flight, which is
   the only way the two can move at the same speed: the rail's top is read off the ribbon's live box on
   the same frame the compositor draws it. */
let _railRaf=0, _railUntil=0;
const RAIL_WATCH_MS=420;          /* comfortably past the .12s transition and any scroll inertia */
function _railTick(){
  _railRaf=0;
  try{ syncRailTop(); }catch(e){}
  if(performance.now()<_railUntil)_railRaf=requestAnimationFrame(_railTick);
}
function syncRailTopSoon(){
  _railUntil=performance.now()+RAIL_WATCH_MS;
  if(!_railRaf)_railRaf=requestAnimationFrame(_railTick);
}
/* 6gu — AND THE SCROLL IS HANDLED SYNCHRONOUSLY, which is the difference between "nearly" and "with".
   Going through requestAnimationFrame leaves the rail exactly ONE FRAME behind: the frame that measures
   the ribbon is the frame that writes the rail's top, and a style written inside rAF lands on the next
   paint, while the ribbon — `position:sticky` — is placed by the compositor in the frame being drawn.
   Measured on a 40px-per-step scroll, rail against ribbon: 257/257, 257/217, 217/217, 217/177 — never
   wrong for long, always wrong by one step, and at 40px a step that is plainly visible.
   A scroll event fires BEFORE that frame is painted, so measuring and writing there puts both in the
   same frame. It costs two getBoundingClientRect calls per event, which is what `positionBar` below has
   always spent on the same event. The rAF watch stays for the moves no scroll reports: the ribbon's
   .12s transition out, a resize, the banner appearing at boot. */
window.addEventListener("scroll",()=>{
  if(!_railNeedsJS())return;    /* 6gv — the browser is already doing it, and better */
  try{ syncRailTop(); }catch(e){}
  syncRailTopSoon();            /* and keep watching, for the transition that follows the last event */
},{passive:true});
window.addEventListener("resize",syncRailTopSoon);
(function(){
  /* The ribbon leaves and returns on a transform TRANSITION (6gq made it .12s) and its TOP moves when
     anything above it changes height — the detection banner appearing when a document lands, the ribbon
     growing a row. None of those is a scroll, so each one gets its own way in. */
  const wire=()=>{
    ["toolbar","miniBar"].forEach(id=>{
      const e=document.getElementById(id); if(!e)return;
      e.addEventListener("transitionstart",syncRailTopSoon);
      e.addEventListener("transitionend",syncRailTopSoon);
      if(window.ResizeObserver)new ResizeObserver(syncRailTopSoon).observe(e);
    });
    /* 6gu — AND THE BOOT. Measured on 6gt: the ribbon moves to 257 the moment the document lands and
       the rail followed 38ms later, which is the step Ced saw on first load. The ribbon's own box does
       not change size when that happens — only its top — so the ResizeObserver above never fires. The
       wrapper that grows above it does, so that is what is watched. */
    try{
      const wrap=document.querySelector(".wrap")||document.body;
      if(wrap&&window.ResizeObserver)new ResizeObserver(syncRailTopSoon).observe(wrap);
    }catch(e){}
    syncRailTop();
    try{ syncSideToggle(); }catch(e){}
    try{ syncMarkClear(); }catch(e){}
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire);
  else setTimeout(wire,0);
})();
/* 6gt — THE SIDE TOGGLE DRAWS THE MOVE, AND ITS FILL SAYS WHERE THE RIBBON IS.
   Ced sent two marks — a device lying on its side, and one standing up — and asked for the landscape
   one with no fill while the ribbon is along the top, and the portrait one filled while it is down the
   right. It is owned here rather than by `iconifyRibbon`, because that runs once and this changes every
   time the ribbon moves; `mark()` would refuse it anyway, since it returns early for a button that is
   already `.ico`. The bar's remote takes the same shape through `syncMiniIcons` and the same `.on`
   through `updateMiniBar`, so the two copies cannot disagree. */
function syncSideToggle(){
  const right=RIBBON_SIDE();
  const b=document.getElementById("ribSideBtn");
  if(b){
    b.style.removeProperty("--g");
    b.style.setProperty("--gi","var("+(right?"--i-rot-port":"--i-rot-land")+")");
    b.classList.add("ico","icoimg");
    b.classList.toggle("on",right);
    b.setAttribute("aria-pressed",right?"true":"false");
    b.title=right ? "The ribbon is down the right · click to put it back along the top"
                  : "The ribbon is along the top · click to stand it down the right";
  }
}
function setRibbonSide(side,save){
  const off=(side==="right"||side==="left");   /* "left" still understood: 6gc shipped it for an hour */
  document.body.classList.toggle("ribbonright",off);
  if(off)document.body.classList.remove("ribbonhidden","chromeshow");
  document.querySelectorAll("#palRibSeg button").forEach(b=>
    b.classList.toggle("on", b.dataset.side===(off?"right":"top")));
  if(save!==false){ try{ localStorage.setItem(RIB_SIDE_KEY,off?"right":"top"); }catch(e){} }
  stampRibbonIcons();       /* stamps the glyphs going out, restores the Find placeholder coming back */
  try{ syncSideToggle(); }catch(e){}
  try{ syncRailTop(); }catch(e){}
  try{ syncMarkClearSoon(); }catch(e){}
  try{ syncEmbossSoon(); }catch(e){}
  try{ layoutAnnos(); }catch(e){}
  try{ syncMiniIcons(); }catch(e){}
  updateMiniBar();
}
/* ================================================================================================
   6ey — FOCUSING A CONTROL IN THE HIDDEN RIBBON MUST NOT MOVE THE DOCUMENT.
   ------------------------------------------------------------------------------------------------
   This is what "Ctrl+A and Delete are not working, especially on other pages" actually was, and it is
   not the keyboard at all. The ribbon hides itself as you scroll down, so a control inside it is off
   screen — and the browser scrolls whatever it is asked to focus INTO view. Measured on the real form,
   reading page 22 and then pressing F (or clicking the Find box):

       before focusing #findInput   scrollY 16006   page 22 fills the window
       after                        scrollY 14940   pages 20 and 21 are on screen

   a 1,066px jump backwards. Ctrl+A then took the page it had landed on — a different page from the one
   you were reading, usually one with no redlines on it — and the Delete after it had nothing to delete.
   On page 1 there is nowhere to jump back to, which is why it looked like a fault that only happened
   "on other pages".

   The scroll listener above already keeps the last position it saw. A scroll event is dispatched
   asynchronously, while `focusin` runs synchronously inside the focus itself — so at this point
   `_lastY` is still the position from BEFORE the jump, and putting it back here beats the event that
   would have overwritten it. The ribbon is also revealed, because a field you cannot see is not a field
   you can type in.
   ================================================================================================ */
document.addEventListener("focusin",e=>{
  const tb=document.getElementById("toolbar");
  if(!tb||!e.target||!tb.contains(e.target))return;
  const wasHidden=document.body.classList.contains("ribbonhidden");
  document.body.classList.remove("ribbonhidden");
  document.body.classList.add("chromeshow");
  if(!wasHidden)return;                       // it was on screen: the browser had no reason to scroll
  const y=_lastY, sc=(typeof pagesScroller==="function")?pagesScroller():null;
  const put=()=>{
    try{ if(Math.abs(window.scrollY-y)>2)window.scrollTo(0,y); }catch(err){}
    try{ if(sc&&sc!==document.scrollingElement&&Math.abs(sc.scrollTop-y)>2)sc.scrollTop=y; }catch(err){}
    _lastY=y;
  };
  put();
  requestAnimationFrame(put);
  setTimeout(put,0);
});
/* 6ea — the R appears once the page has scrolled, and takes you back to the top. Same threshold the
   ribbon uses to hide itself, so the two happen together and the mark arrives as the header leaves
   rather than a moment after it. */
(function(){
  const mk=document.getElementById("markR"); if(!mk)return;
  const upd=()=>{ mk.classList.toggle("show", window.scrollY>140); };
  window.addEventListener("scroll",upd,{passive:true});
  window.addEventListener("resize",upd,{passive:true});
  mk.addEventListener("click",()=>{
    try{ window.scrollTo({top:0,behavior:"smooth"}); }catch(e){ window.scrollTo(0,0); }
  });
  upd();
})();

/* ---------- virtualized render (keeps memory low; fixes white screen) ---------- */
let vio=null;
function setupVirtualization(){
  if(vio)vio.disconnect();
  vio=new IntersectionObserver(es=>{
    es.forEach(e=>{ const i=+e.target.dataset.idx;
      /* 6mf — and the same crossing says whether the loading animation is worth running: see
         `.page.near:not([data-rendered="1"])` in app.css. The margin is 1400px, so a page wears
         `near` long before any part of it can be seen — the animation can never be late — and the
         other thirty sheets of a site package are not each running one off the bottom of the
         document, which is exactly what this cost when the CSS stood alone. */
      e.target.classList.toggle("near",e.isIntersecting);
      if(e.isIntersecting) ensurePageRendered(i); else unloadPage(i); });
  },{root:null,rootMargin:"1400px 0px 1400px 0px",threshold:0});
  document.querySelectorAll(".page").forEach(p=>vio.observe(p));
}
async function renderAll(){
  /* renderAll() recreates every .page, so anything hidden for page view comes back visible — which is
     why page view "went back to normal view sometimes" (a zoom change, a re-analyze, a re-render).
     The mode is re-applied at the end. */
  const root=$("#pages"); root.innerHTML="";
  for(let i=0;i<S.pages.length;i++){
    const vp=S.pages[i].page.getViewport({scale:S.scale});
    const pg=el("div","page"); pg.dataset.idx=i; pg.dataset.rendered="";
    /* Give the page its full size up front. unloadPage() removes the canvas, and without an explicit
       box the div collapsed to nothing — the document got shorter, the scroll position jumped, the
       observer fired again and re-rendered. That loop is the shaking while scrolling. */
    try{
      const vp0=S.pages[i].page.getViewport({scale:S.scale});
      pg.style.width=vp0.width+"px"; pg.style.height=vp0.height+"px";
    }catch(e){}
    /* Per-page controls live OUTSIDE the page — a bar above it. Inside, they sat over the annotation
       layer (so they only took clicks in redline mode) and made the control div a child of .page. */
    const bar=el("div","page-bar");
    {
      const num=el("span","page-bar-n","Page "+(i+1));
      const tag=el("span","page-tag");
      const lk=el("button","page-btn",""); lk.dataset.role="lock";
      const dp=el("button","page-btn",""); dp.dataset.role="drop";
      const paint=()=>{
        const P=S.pages[i]||{};
        lk.textContent=P.locked?"\u{1F512}":"\u{1F513}";
        lk.title=P.locked?("Locked ("+(P.lockReason||"read-only")+") \u2014 click to allow redlines")
                         :"Unlocked \u2014 click to protect this page";
        lk.classList.toggle("on",!!P.locked);
        dp.textContent=P.dropped?"\u2298":"\u2913";
        dp.title=P.dropped?"Left out of the export \u2014 click to keep it"
                          :"Click to leave this page out of the export";
        dp.classList.toggle("on",!!P.dropped);
        const bits=[]; if(P.locked)bits.push("LOCKED"); if(P.dropped)bits.push("NOT EXPORTED");
        tag.textContent=bits.join(" \u00b7 ");
        tag.style.display=bits.length?"":"none";
        pg.classList.toggle("pagelocked",!!P.locked);
        pg.classList.toggle("dropped",!!P.dropped);
      };
      const stop=e=>{ e.preventDefault(); e.stopPropagation(); };
      [lk,dp].forEach(b=>{ b.addEventListener("mousedown",stop,true); b.addEventListener("pointerdown",stop,true); });
      lk.onclick=e=>{ stop(e); const P=S.pages[i]; P.locked=!P.locked;
        setStatus(P.locked?("Page "+(i+1)+" locked \u2014 no redlines can be placed on it.")
                          :("Page "+(i+1)+" unlocked \u2014 you can redline it by hand."));
        paint(); if($("#pageOrg")&&$("#pageOrg").classList.contains("show"))renderPageOrg(); };
      dp.onclick=e=>{ stop(e); const P=S.pages[i]; P.dropped=!P.dropped;
        setStatus(P.dropped?("Page "+(i+1)+" will be left out of the exported PDF.")
                           :("Page "+(i+1)+" will be exported."));
        paint(); if($("#pageOrg")&&$("#pageOrg").classList.contains("show"))renderPageOrg(); };
      /* everything on the LEFT, with the spacer after it */
      bar.appendChild(num); bar.appendChild(tag);
      bar.appendChild(lk); bar.appendChild(dp);
      bar.appendChild(el("span","grow"));
      pg._paintCtl=paint;
      setTimeout(paint,0);
    }
    pg.appendChild(el("div","pagelabel",`Page ${i+1}`));
    attachPagePointer(pg,i);
    root.appendChild(bar); root.appendChild(pg);
    try{ showBase(i); }catch(e){}   /* 6mj — renderAll replaces the elements; the pictures survive */
  }
  updateRail();
  setupVirtualization();
  try{ syncPageColSoon(); }catch(e){}     /* 6lb — a new document gets the window, not the column */
  try{ preloadBasesSoon(); }catch(e){}    /* 6mj — and every page gets a picture that stays */
}
/* 6gr — the printed text, as clickable boxes over the picture. One function, because the re-sharpen
   after a zoom rebuilds it at the new scale and the two must agree exactly. */
function buildTextLayer(i,vp){
  const P=S.pages[i];
  const tl=el("div","textlayer");
  P.items.forEach(it=>{ const b=el("div","tspan"); b.dataset.key=keyOf(i,it);
    b.style.left=(it.nx*vp.width)+"px"; b.style.top=(it.ny*vp.height)+"px";
    b.style.width=Math.max(it.nw*vp.width,6)+"px"; b.style.height=Math.max(it.nh*vp.height,8)+"px";
    b.textContent=it.str;                 // real text (transparent) so it can be selected & copied
    b.title="Click to redline"; b.onclick=ev=>{ev.stopPropagation();onCell(i,it);}; tl.appendChild(b); });
  return tl;
}
/* 6gr — RE-RENDER WITHOUT EVER SHOWING NOTHING. The stretched canvas stays up until the sharp one is
   finished, and then they are swapped in one go — so a zoom never blanks the sheet. */
async function resharpenPage(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`);
  if(!pg||pg.dataset.rendered!=="1")return;
  const P=S.pages[i]; if(!P||!P.page)return;
  const at=S.scale;
  let vp; try{ vp=P.page.getViewport({scale:at}); }catch(e){ return; }
  const over=overFor(i,at);                                  /* 6mw */
  let vpR=vp; if(over>1.001){ try{ vpR=P.page.getViewport({scale:at*over}); }catch(e){ vpR=vp; } }
  const cv=el("canvas","pdf");
  sizePageCanvas(cv,vp,over);
  try{
    const task=P.page.render({canvasContext:cv.getContext("2d"),viewport:vpR});
    pg._task=task;
    await task.promise;
  }catch(e){ cv.width=cv.height=0; return; }
  /* the world may have moved on while it drew: another zoom, or the page unloaded */
  if(S.scale!==at || pg.dataset.rendered!=="1" || !pg.isConnected){ cv.width=cv.height=0; return; }
  const old=pg.querySelector("canvas.pdf");
  if(old){ old.replaceWith(cv); old.width=old.height=0; }
  else pg.insertBefore(cv, pg.querySelector(".pagelabel").nextSibling);
  const tl=pg.querySelector(".textlayer");
  if(tl)tl.replaceWith(buildTextLayer(i,vp));
  /* 6ia — BOTH stroke layers, not whichever one comes first */
  pg.querySelectorAll("svg.draw").forEach(svg=>{
    svg.setAttribute("width",vp.width); svg.setAttribute("height",vp.height); });
  delete pg.dataset.soft;
  try{ drawPageLines(i); }catch(e){}
}
/* ==================================================================================================
   6m7 — ONE PAGE AT A TIME, NEAREST THE EYE FIRST, AND NOTHING AT ALL FOR A PAGE THAT HAS GONE.
   Ced: "some pages are taking too long to load. and some are not loading at all. also when zooming in
   and out, the loading is too long." · "zoom in and out are so slow again."

   The JavaScript is not the cost and was not the cost in v45 either. Profiled on the 32-page fixture
   with every function on the path counted and timed, a ten-notch ctrl-wheel zoom spends 47ms inside
   `setZoom` ALTOGETHER and the 95th-percentile frame is 31–38ms. What costs is the thing the profile
   cannot see, because it is pdf.js drawing into a canvas:

       one page, rendered      zoom 1.0   61–88 ms
                               zoom 2.0   71–120 ms
                               zoom 3.5   180–204 ms

   And there was nothing between the IntersectionObserver and that work. Scroll quickly through the
   document and every page the observer touches on the way past is handed to pdf.js immediately, all
   of them at once: measured on a fast scroll, **29 page renders were started and 29 pages were then
   unloaded** — about three seconds of drawing, nearly all of it for pages that were off the screen
   again before the ink was dry, and all of it competing with the one page you are actually looking at.
   That is "taking too long to load", and it is also why a page you have stopped on can sit blank: it
   is fourth in a queue of four full-page renders.

   So there is a queue now, and three rules:
     1. ONE render runs at a time. Five concurrent renders do not finish sooner; they finish in a
        different order and they each make the others slower.
     2. The next one taken is the page NEAREST THE MIDDLE OF THE WINDOW. The page under your eyes is
        drawn first whatever order the observer happened to deliver.
     3. A page is re-checked at the moment its turn comes, not when it was asked for. If it has
        scrolled out of reach, or the zoom has moved on, or it has been drawn already, it is dropped
        without being drawn at all.
   A frame is yielded between renders, so a long queue never blocks a scroll.

   `ensurePageRendered` keeps its name and still returns a promise that settles when that page is
   drawn — the observer, the resharpen and the test suite all call it — but what it does now is join
   the queue.
   ================================================================================================== */
const RENDER_REACH=600;            /* a page further than this outside the window is not worth drawing */
let _rq=new Map();                 /* page index -> {resolve[]} */
let _rqBusy=false;
/* ==================================================================================================
   6mf — A PAGE THAT IS COMING SAYS SO. Ced: "add loading animation on pages not yet loaded."

   Until the canvas lands a page is a blank white rectangle, which is exactly what a genuinely blank
   sheet looks like — so 6m7's queue, which is right to make you wait your turn, had no way of saying
   that it was your turn soon rather than never.

   The first cut of this kept a `data-loading` flag, written whenever the queue took a page. It was
   wrong, and `behave.py` said so before it shipped: measured on a fast scroll, TWO pages were on
   screen, blank, and saying nothing — because the IntersectionObserver fires on a crossing and the
   sweep is debounced, so for a moment the eye is on a page the queue has not been told about yet.
   A flag that is one rAF behind the eye is exactly the flag you do not want here.

   There is no bookkeeping in the rule that is actually true: A PAGE WITH NO PICTURE IN IT YET IS A
   PAGE THAT IS STILL COMING. `data-rendered` is "1" only once the canvas is in the tree, so the
   state is already on the element, already correct at every instant, and already written in one
   place. The whole thing is a CSS selector — see `.page:not([data-rendered="1"])` in app.css — and
   the only pages that can be seen doing it are the ones you are looking at.
   ================================================================================================== */
function _pageWanted(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`);
  if(!pg)return null;
  if(pg.dataset.rendered==="1"||pg.dataset.rendered==="wip")return null;
  const r=pg.getBoundingClientRect();
  if(r.bottom<-RENDER_REACH||r.top>window.innerHeight+RENDER_REACH)return null;
  return {pg,dist:Math.abs(r.top+r.height/2-window.innerHeight/2)};
}
function ensurePageRendered(i){
  i=+i;
  const pg=document.querySelector(`.page[data-idx="${i}"]`);
  if(!pg||pg.dataset.rendered==="1")return Promise.resolve();
  return new Promise(res=>{
    const e=_rq.get(i);
    if(e)e.waiting.push(res); else _rq.set(i,{waiting:[res]});
    _runRenderQueue();
  });
}
async function _runRenderQueue(){
  if(_rqBusy)return;
  _rqBusy=true;
  try{
    while(_rq.size){
      /* 6m7 — decided HERE, not when the page was asked for: the window has moved since */
      let best=null, bestD=Infinity;
      for(const i of [..._rq.keys()]){
        const w=_pageWanted(i);
        if(!w){ const e=_rq.get(i); _rq.delete(i); if(e)e.waiting.forEach(f=>f()); continue; }
        if(w.dist<bestD){ bestD=w.dist; best=i; }
      }
      if(best==null)break;
      const e=_rq.get(best); _rq.delete(best);
      try{ await _renderPageNow(best); }catch(err){}
      if(e)e.waiting.forEach(f=>f());
      /* let the window draw a frame between pages, so a queue never blocks a scroll */
      await new Promise(r=>requestAnimationFrame(()=>r()));
    }
  } finally { _rqBusy=false; }
  sweepPagesSoon();        /* 6m7 — and then make sure nothing on screen was left out */
}
/* ==================================================================================================
   6m7 — THE SWEEP, which is the other half of dropping work.
   Dropping a page because it has scrolled away is right while the hand is moving and wrong the moment
   it stops: the IntersectionObserver fires on a CROSSING, so a page that was already inside the
   margin when its render was dropped is never asked for again. Measured with the queue in and no
   sweep: a fast scroll ended with **the page under the eyes blank**, nothing queued, nothing coming.

   So whenever the scrolling settles — and whenever the queue runs dry — every page actually ON SCREEN
   and not drawn is asked for. It is a `querySelectorAll` over the page divs and a rect each, once,
   120ms after the last scroll event; the queue decides what is worth drawing as usual. This is the
   belt to the observer's brace: the observer is the fast path and this is the one that cannot miss.
   ================================================================================================== */
let _sweepT=0;
function sweepPagesSoon(ms){
  clearTimeout(_sweepT);
  _sweepT=setTimeout(()=>{
    try{
      document.querySelectorAll("#pages .page").forEach(pg=>{
        const st=pg.dataset.rendered;
        if(st==="1"||st==="wip")return;
        const r=pg.getBoundingClientRect();
        if(r.bottom>0&&r.top<window.innerHeight)ensurePageRendered(+pg.dataset.idx);
      });
    }catch(e){}
  }, ms==null?120:ms);
}
window.addEventListener("scroll",()=>sweepPagesSoon(),{passive:true});
/* ==================================================================================================
   6mj — THE STANDING PICTURE. Ced: "make the pdf file preload and then retain that in the viewer so
   there will be no lag" · "the loading of pdfs are still slow and zooming in it gets pixelated."

   6m7's queue and the observer's `unloadPage` are both right and both have the same consequence: at
   any moment most of the document has NO pixels at all. Scroll to page 30 and pdf.js is asked for it
   from nothing, which on a mount drawing is 61-204ms before anything appears; scroll back to page 2
   and it has been thrown away, so you pay again. v50 put a spinner on that wait, which is honest and
   is not what was asked for.

   What is asked for is pixels that do not go away. They cannot be the SHARP ones — a 11x17 sheet at
   3.5x is 12 megapixels, 48MB, and a site package is forty-five of them — so they are a second,
   small, fixed picture per page, rendered once and kept for the life of the document:

       budget 360,000 pixels a page     1.4 MB each
       letter   612x792 at 1.0  ->  525x680    0.36 Mpx
       11x17   1224x792 at 0.61 ->  744x482    0.36 Mpx
       a 45-page letter package                 65 MB, once

   It is CSS-stretched to the page box at all times — `width:100%`, so a zoom costs it nothing and
   there is no bookkeeping to get wrong — and it sits UNDER the sharp canvas. So the sharp render is
   still what you read, and everything it used to leave blank now shows the page instead: a page
   waiting its turn, a page whose canvas the observer threw away, and a page mid-zoom. Soft, and
   soft is what "stretched" means; the point is that it is the page and it is there at once.

   The preload runs only when the sharp queue is idle, nearest page first, one at a time with a frame
   between — it must never be the reason the page under your eyes is late.
   ================================================================================================== */
const BASE_BUDGET_PX=360000;
let _baseQ=null, _baseBusy=false;
function _baseScale(i){
  try{
    const vp1=S.pages[i].page.getViewport({scale:1});
    return Math.min(1,Math.sqrt(BASE_BUDGET_PX/Math.max(1,vp1.width*vp1.height)));
  }catch(e){ return 0.5; }
}
function showBase(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg)return;
  const P=S.pages[i]; if(!P||!P.base)return;
  if(pg.querySelector("canvas.pdfbase")){ pg.classList.add("hasbase"); return; }
  const c=el("canvas","pdfbase");
  c.width=P.base.width; c.height=P.base.height;
  try{ c.getContext("2d").drawImage(P.base,0,0); }catch(e){ return; }
  const lbl=pg.querySelector(".pagelabel");
  pg.insertBefore(c, lbl?lbl.nextSibling:pg.firstChild);
  pg.classList.add("hasbase");
}
async function renderBase(i){
  const P=S.pages[i]; if(!P||!P.page||P.base)return;
  const s=_baseScale(i);
  let vp; try{ vp=P.page.getViewport({scale:s}); }catch(e){ return; }
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(vp.width)); c.height=Math.max(1,Math.round(vp.height));
  try{ await P.page.render({canvasContext:c.getContext("2d"),viewport:vp}).promise; }
  catch(e){ c.width=c.height=0; return; }
  P.base=c;
  showBase(i);
}
/* nearest the middle of the window first, exactly as the sharp queue chooses, so the pages you are
   about to scroll onto are the ones that are ready */
/* ==================================================================================================
   6ml — AND THE PRELOAD GETS OUT OF THE WAY. Ced: "zoom in and out is so slow paced again. make it
   all seamless" · "viewing pdf should also be seamless. please improve."

   6mj's picture-per-page is right and the way v51 filled them in was not. pdf.js cannot be made to
   yield — a render is one call that returns when it is finished — so forty-five of them in a row,
   with nothing but a rAF between, is forty-five blocks of the main thread laid end to end. Measured
   on the 45-page site package, over the SIX SECONDS after the document opens:

       25 long tasks · 4,065 ms of them · p95 frame 197.8 ms · worst frame 480.6 ms

   Two thirds of the wall clock, in the window where you are scrolling to find the sheet you want.
   Nothing the hand does in there is seamless, because every frame of it can land behind a quarter
   of a second of someone else's work.

   Two changes, and the first is the one that matters:

     1. A PAGE THAT HAS BEEN DRAWN ALREADY DOES NOT NEED DRAWING AGAIN. The sharp canvas is a
        better picture than the base at every size; shrinking it into the base is one `drawImage`
        on the GPU rather than a pdf.js render. So every page you look at pays nothing at all, and
        the background pass is left with only the pages you have never been to.
     2. WHAT IS LEFT WAITS FOR A GAP. The queue idle check stays, and under it there is now a
        quiet check: nothing is rendered within 650ms of a wheel, a scroll, a pointer or a key.
        An `idle` slot is asked for where the browser offers one. A page render cannot be split,
        so the only honest thing to do with it is to put it where nobody is waiting.
   ================================================================================================== */
let _lastInput=0;
function noteInput(){ _lastInput=Date.now(); }
["wheel","pointerdown","keydown","touchstart"].forEach(t=>
  window.addEventListener(t,noteInput,{passive:true,capture:true}));
window.addEventListener("scroll",noteInput,{passive:true});
const INPUT_QUIET_MS=650;
/* the sharp canvas, shrunk — the same picture, for the price of a blit */
function baseFromSharp(i,cv){
  const P=S.pages[i];
  if(!P||P.base||!cv||!cv.width)return;
  const k=Math.min(1,Math.sqrt(BASE_BUDGET_PX/Math.max(1,cv.width*cv.height)));
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(cv.width*k)); c.height=Math.max(1,Math.round(cv.height*k));
  const g=c.getContext("2d");
  g.imageSmoothingQuality="high";
  try{ g.drawImage(cv,0,0,c.width,c.height); }catch(e){ c.width=c.height=0; return; }
  P.base=c;
  showBase(i);
}
function _idle(ms){
  return new Promise(r=>{
    if(typeof requestIdleCallback==="function")requestIdleCallback(()=>r(),{timeout:ms});
    else setTimeout(r,ms);
  });
}
function preloadBases(){
  if(_baseBusy)return;
  _baseBusy=true;
  (async()=>{
    try{
      for(;;){
        if(!S.pages||!S.pages.length)break;
        /* the sharp queue always wins: it is drawing what is on screen now */
        if(_rq.size||_rqBusy){ await new Promise(r=>setTimeout(r,200)); continue; }
        /* and so does the hand */
        const since=Date.now()-_lastInput;
        if(since<INPUT_QUIET_MS){ await new Promise(r=>setTimeout(r,INPUT_QUIET_MS-since)); continue; }
        let best=-1,bestD=Infinity;
        for(let i=0;i<S.pages.length;i++){
          if(S.pages[i].base)continue;
          const pg=document.querySelector(`.page[data-idx="${i}"]`);
          let d=1e9;
          if(pg){ const r=pg.getBoundingClientRect();
                  d=Math.abs(r.top+r.height/2-window.innerHeight/2); }
          if(d<bestD){ bestD=d; best=i; }
        }
        if(best<0)break;
        await _idle(900);
        if(Date.now()-_lastInput<INPUT_QUIET_MS)continue;   /* the hand moved while we waited */
        if(_rq.size||_rqBusy)continue;
        await renderBase(best);
        await new Promise(r=>requestAnimationFrame(()=>r()));
      }
    }catch(e){}
    _baseBusy=false;
  })();
}
function preloadBasesSoon(){ clearTimeout(_baseQ); _baseQ=setTimeout(preloadBases,500); }
/* ==================================================================================================
   6mw — THE SHEET IS DRAWN WITH MORE PIXELS THAN IT IS SHOWN WITH, SO A ZOOM STAYS SHARP WHILE IT
   MOVES. Ced, with a recording of a native viewer going from deep in to two sheets out and staying
   crisp the whole way: "this is how seamless zoom in and out should be."

   6gr stretches the canvas it already has and re-renders when the zooming stops, and the part of
   that which is already right is the part I assumed was wrong. Measured, from the last wheel notch
   to the sharp canvas landing: **76–90ms**. Nobody sees that. What you see is the gesture itself:

       three notches in   the canvas is stretched 1.30x while you turn the wheel
       ten notches in                             2.00x
       ten notches out                            1.83x

   Two megapixels shown through one megapixel's worth of paint, for the second or so your hand is
   moving — which is exactly the softness in Ced's "pixelated", and no amount of re-rendering SOONER
   fixes it, because re-rendering during the gesture is the 70–200ms long task v48 spent a version
   removing.

   What fixes it is having the pixels already. And the thing that makes it affordable is that a page
   render costs almost nothing extra for them — the time goes into interpreting the content stream,
   not into filling pixels. The same three sheets, rendered at five oversample factors:

       x1.0   5, 18, 43 ms   1.09 Mpx   4.2 MB     x1.6   11, 21, 34 ms   1.79 Mpx   6.8 MB
       x1.25  7, 18, 43 ms   1.09 Mpx   4.2 MB     x2.0   15, 14, 21 ms   2.79 Mpx  10.7 MB
       x1.4   5, 16, 36 ms   1.37 Mpx   5.2 MB

   Flat. So the only real price is memory, and memory is the thing that must be capped: an 11x17
   sheet at 350% is already 9 megapixels before any oversample, and 1.6x of that would be 94MB of
   canvas for one page. The factor is therefore a WANT, not a rule — it is given up as the zoom
   rises, so the oversample lives in the headroom below the budget and nowhere else.
   ================================================================================================== */
const OVER_WANT=1.6;               /* covers about six wheel notches before any softness shows */
const OVER_MAX_PX=6000000;         /* 24MB of canvas, per page, all in */
function overFor(i,at){
  try{
    const vp1=S.pages[i].page.getViewport({scale:1});
    const px=vp1.width*vp1.height*at*at;
    if(!(px>0))return 1;
    return Math.max(1,Math.min(OVER_WANT,Math.sqrt(OVER_MAX_PX/px)));
  }catch(e){ return 1; }
}
/* the one place a page canvas is given its pixels and its size on screen, so the two cannot drift */
function sizePageCanvas(cv,vpShown,over){
  cv.width=Math.round(vpShown.width*over); cv.height=Math.round(vpShown.height*over);
  cv.style.width=vpShown.width+"px"; cv.style.height=vpShown.height+"px";
  cv.dataset.shown=String(Math.round(vpShown.width));
}
/* how far a canvas is being stretched right now: its own displayed width against the width the page
   wants at this scale. Written off `dataset.shown` rather than `cv.width`, which since 6mw is the
   number of pixels in it and not the size it is shown at. */
function canvasStretch(cv,wantW){
  const shown=+(cv&&cv.dataset&&cv.dataset.shown)||0;
  return shown>0?(wantW/shown):1;
}
async function _renderPageNow(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg||pg.dataset.rendered==="1"||pg.dataset.rendered==="wip")return;
  pg.dataset.rendered="wip";
  /* 6gs — WHAT SCALE THIS RENDER IS FOR. Ced: "the pdf also becomes broken at some point" while
     zooming. A page that started drawing before a wheel notch finished drawing after it, and landed a
     full-size canvas into a box that had since become another size — one page on the sheet at the
     wrong scale, which is exactly what "broken" looks like. The scale is caught here and checked on
     the way out; a stale render is thrown away and asked for again at the size that is current now. */
  const P=S.pages[i]; const at=S.scale; const vp=P.page.getViewport({scale:at});
  /* 6mw — shown at `vp`, painted at `over` times that */
  const over=overFor(i,at);
  const vpR=(over>1.001)?P.page.getViewport({scale:at*over}):vp;
  const cv=el("canvas","pdf"); sizePageCanvas(cv,vp,over);
  try{ const task=P.page.render({canvasContext:cv.getContext("2d"),viewport:vpR}); pg._task=task; await task.promise; }
  catch(err){
    /* ============================================================================================
       6m7 — AND A RENDER THAT DID NOT FINISH ASKS AGAIN. Ced: "some are not loading at all."
       A render is cancelled whenever `unloadPage` runs over it, and a cancelled task rejects — so
       this line used to put the page back to blank and stop. The IntersectionObserver only fires on
       a CROSSING, so a page that was still on screen the whole time never got a second chance: it
       stayed blank until it was scrolled out of the window and back in. That is exactly the page
       that never loads.
       It goes back on the queue instead, where the usual rule decides whether it is still worth
       drawing — so a page you have scrolled past is still dropped, and one you are looking at is
       drawn again.
       ============================================================================================ */
    cv.width=cv.height=0;
    pg.dataset.rendered="";
    if(_pageWanted(i))setTimeout(()=>{ try{ ensurePageRendered(i); }catch(e){} },0);
    return;
  }
  if(pg.dataset.rendered!=="wip") return; // unloaded mid-render
  if(S.scale!==at){                       // the zoom moved on while it drew
    cv.width=cv.height=0; pg.dataset.rendered="";
    setTimeout(()=>{ try{ ensurePageRendered(i); }catch(e){} },0);
    return;
  }
  try{ const bb=pg.previousElementSibling;
    if(bb&&bb.classList.contains("page-bar"))bb.style.width=vp.width+"px"; }catch(e){}
  pg.insertBefore(cv, pg.querySelector(".pagelabel").nextSibling);
  pg.appendChild(buildTextLayer(i,vp));
  /* 6ia — FOUR LEVELS, NOT THREE. A stroke used to live on one layer between the two bands of marks,
     so a stroke could never be put under a mark: "some redlines are not following the layering" was
     that, at bottom. There are two stroke layers now — one under the lower band of marks and one above
     it — and every mark and every stroke carries the band it is in, so the stack reads, bottom to top:
         strokes below · marks below · strokes above · marks above
     which is what front, back and the up/down steps walk through. */
  const svgU=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svgU.setAttribute("class","draw under");
  svgU.setAttribute("width",vp.width); svgU.setAttribute("height",vp.height);
  pg.appendChild(svgU);
  pg.appendChild(el("div","annolayer-under"));
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("class","draw"); svg.setAttribute("width",vp.width); svg.setAttribute("height",vp.height);
  pg.appendChild(svg);
  pg.appendChild(el("div","annolayer"));
  /* 6is — AND A LAYER FOR THE FURNITURE, above every band. See `paintSelUI`. */
  pg.appendChild(el("div","annoui"));
  pg.dataset.rendered="1";
  /* 6ml — and this page's standing picture comes FREE, off the canvas that has just landed, rather
     than from a second pdf.js render that blocks the thread for a tenth of a second. One
     `drawImage` into a small canvas; see `baseFromSharp`. */
  try{ baseFromSharp(i,cv); }catch(e){}
  layoutAnnos(); drawPageLines(i); applySuggestions();   /* 6ir — marks first: they build the containers */
}
function unloadPage(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg)return;
  if(pg._task&&pg._task.cancel){ try{pg._task.cancel();}catch(e){} }
  pg.dataset.rendered="";
  /* 6mj — the sharp canvas goes; the standing picture does not, so the page still shows the page */
  [...pg.querySelectorAll("canvas.pdf,.textlayer,svg.draw,svg.draw.under,.annolayer,.annolayer-under,.annoui")].forEach(n=>{ if(n.tagName==="CANVAS"){n.width=0;n.height=0;} n.remove(); });
  showBase(i);
}
/* --- the ruled lines, read off the page ------------------------------------------------------------
   6ej — THE RULES ARE NOT IN THE TEXT LAYER, and every cell bound before this one was an estimate
   standing in for them: the fence (halfway between column centres), the frame (a fixed inset from the
   nearest neighbouring ink), the midpoint between two columns' ink. Each of those is wrong in a
   different geometry, and on Ced's Final form they are wrong by 10pt and more — the Model column's rules
   sit at x 214 and 268 while the estimate reached 278, so a mark filling "the cell" ran through the rule
   and into the column beside it. No amount of tuning fixes an estimate of something that is right there
   on the page.

   A table's rules ARE in the file, as stroked paths — 440 of them on one page of the reference form. The
   robust way to read them is off the RENDERED page rather than out of the operator list: the raster has
   every transform, clip and line width already applied, so a long thin dark run in it is a rule, full
   stop, with no coordinate space to get wrong. One render per table page at analyze time, cached.

   What comes back is the x of every vertical rule and the y of every horizontal one, normalised. */
/* A rule is an unbroken run at least this long, in POINTS. Not a fraction of the page: the reference
   form's tables run most of the page and the narrow-column fixture's are a fifth of it, and a fraction
   tuned for one rejects the other. 40pt is longer than any glyph stroke and shorter than the shortest
   table rule either form draws. */
const RULE_MIN_PT=40;
async function scanPageRules(pi){
  const P=S.pages[pi]; if(!P||!P.page)return null;
  if(P.rules)return P.rules;
  const SC=1.6;                                  // enough to separate two rules 3pt apart
  const vp=P.page.getViewport({scale:SC});
  const cv=el("canvas"); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
  const cx=cv.getContext("2d",{willReadFrequently:true});
  cx.fillStyle="#fff"; cx.fillRect(0,0,cv.width,cv.height);
  try{ await P.page.render({canvasContext:cx,viewport:vp}).promise; }
  catch(e){ cv.width=cv.height=0; return null; }
  const W=cv.width, H=cv.height;
  const d=cx.getImageData(0,0,W,H).data;
  /* "dark" is generous: RFDS rules are printed light grey, and a light rule is still a rule */
  const dark=new Uint8Array(W*H);
  for(let i=0,p=0;i<W*H;i++,p+=4){
    const l=(d[p]*299+d[p+1]*587+d[p+2]*114)/1000;
    dark[i]=(l<225)?1:0;
  }
  const colRun=new Int32Array(W), rowRun=new Int32Array(H);
  /* the longest UNBROKEN dark run in each column and each row: a rule is unbroken, a column of text is not */
  for(let x=0;x<W;x++){ let best=0,run=0;
    for(let y=0;y<H;y++){ if(dark[y*W+x]){ run++; if(run>best)best=run; } else run=0; }
    colRun[x]=best; }
  for(let y=0;y<H;y++){ let best=0,run=0;
    for(let x=0;x<W;x++){ if(dark[y*W+x]){ run++; if(run>best)best=run; } else run=0; }
    rowRun[y]=best; }
  const pick=(runs,n,limit)=>{                   // group adjacent hits and take each group's centre
    const out=[]; let s=-1;
    for(let i=0;i<n;i++){
      const hit=runs[i]>=limit;
      if(hit&&s<0)s=i;
      else if(!hit&&s>=0){ out.push((s+i-1)/2); s=-1; }
    }
    if(s>=0)out.push((s+n-1)/2);
    return out;
  };
  const minPx=Math.max(20,Math.round(RULE_MIN_PT*SC));
  const vx=pick(colRun,W,minPx).map(x=>x/W);
  const hy=pick(rowRun,H,minPx).map(y=>y/H);
  cv.width=cv.height=0;
  /* fewer than three verticals is not a ruled table — a page border, a shaded band edge — and trusting
     it would be worse than the estimate it replaces */
  P.rules=(vx.length>=3)?{v:vx,h:hy}:{v:[],h:hy};
  return P.rules;
}
/* the ruled cell a printed run sits in: the nearest rule either side of it */
function ruledCell(pi,nx,x2){
  const P=S.pages[pi], R=P&&P.rules;
  if(!R||!R.v||R.v.length<2)return null;
  let L=null,Rt=null;
  R.v.forEach(x=>{
    if(x<=nx+0.0008&&(L==null||x>L))L=x;
    if(x>=x2-0.0008&&(Rt==null||x<Rt))Rt=x;
  });
  if(L==null||Rt==null||Rt-L<0.006)return null;
  return {L:L,R:Rt};
}
function pageRendered(i){ const pg=document.querySelector(`.page[data-idx="${i}"]`); return pg&&pg.dataset.rendered==="1"; }
function captureJpg(P,scale){
  const vp=P.page.getViewport({scale});
  const cv=el("canvas"); cv.width=vp.width; cv.height=vp.height;
  return P.page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise.then(()=>{ const d=cv.toDataURL("image/jpeg",0.7).split(",")[1]; cv.width=cv.height=0; return d; });
}

/* ---------- tools / modes ---------- */
const MODE_NAMES={select:"Select",pan:"Pan",redline:"Redline",text:"Text",fix:"Strike & write",callout:"Callout",
                  box:"Box",circle:"Circle",arrow:"Arrow",poly:"Polyline",dim:"Length",
                  strikerow:"Strike row",cross:"Strike text",line:"Line",crossout:"Cross out",
                  /* 6gk — the kit's modes read properly in the pill now that one of them has a ribbon
                     button of its own */
                  snapshot:"Snapshot",lasso:"Lasso select",textsel:"Text select",laser:"Laser pointer",
                  eraser:"Eraser",painter:"Format painter"};
/* =================================================================================================
   6f8 — THE TOOL STAYS IN YOUR HAND
   =================================================================================================
   Ced: "instead of always going back to select, keep on doing the tool selected unless user clicked
   select or clicked escape."

   Every tool used to put itself down the moment it had drawn one thing, which is right for a tool you
   reach for once and wrong for every tool you reach for twenty times — and on a mount analysis you
   draw twenty callouts, not one. So the tool now stays armed, and the only three things that put it
   down are pressing Escape, pressing S, and clicking Select.

   `toolDone()` is what the drawing code calls where it used to call `setMode("select")`. It is one
   function so the rule is in one place, and `STICKY_TOOLS` is the dial if that ever has to change.
   ================================================================================================= */
let STICKY_TOOLS=true;
/* 6gt — AND IT STAYS ONLY FOR THE TOOLS YOU DRAW WITH.
   Ced: "when clicking the pdf ui, the tool should go back to select mode unless the user is using
   shapes." The two halves of the ribbon behave differently in the hand. A shape is DRAWN — you drag a
   box, a circle, a line, a leader, a dimension — and you draw several in a row, so that tool stays.
   Everything else ACTS ON WHAT IS PRINTED: one click redlines a cell, strikes a row, crosses a value,
   captures a region. After one of those the next click is nearly always "now select something", and
   with the tool still armed it put a second correction on the sheet instead. So those put themselves
   down and Select takes over, which is also the state every other key expects. */
/* 6k1 — AND TEXT IS NOT ONE OF THEM, BECAUSE A TEXT BOX IS NOT FINISHED WHEN IT IS DRAWN.
   Ced: "after typing in text mode and clicking the ui, it should not prompt into a new text, rather
   make the text be editable after and go to select mode."
   Every other sticky tool finishes at the mouse-up: the box is drawn, the line is laid, and the next
   drag is reasonably another one. A text box is drawn and then TYPED IN, so the gesture that ends it
   is the click somewhere else — and with the tool still in hand that click landed a second, empty box
   on the sheet. Putting Text down after one box makes that click mean what it looks like: the words
   are committed, the box stays editable on a double-click, and Select is live. */
const STICKY_MODES=new Set(["line","arrow","poly","box","circle","dim","callout"]);
/* 6hq — THE TOOLS THAT DRAW SOMETHING NEW WHERE YOU DRAG. These own the press even when it lands on a
   mark that is already there, because putting a box round a box, a cloud over a note or a strike
   through a correction is ordinary redlining and the alternative — dragging whatever was underneath —
   is never what was meant. Select, Pan and the picture tools are not here: those act ON a mark.
   `crossout` is, because it is drawn as a box over something by definition. */
const DRAW_MODES=new Set(["line","arrow","poly","box","circle","text","dim","callout",
                          "crossout","cross","strikerow"]);
function toolDraws(){ return DRAW_MODES.has(S.mode); }
/* ==================================================================================================
   6m9 — WHOSE PRESS IS THIS, THE MARK'S OR THE TOOL'S? One definition, because there were two.
   6ju wrote the rule twice — once in the page's `pointerdown` and once in the mark's own `_press` —
   and the two had drifted into slightly different shapes. Narrowing it in one place and not the
   other is how a fix half-works: measured, the mark stopped being dragged and the new mark still
   was not drawn, because the page was still bailing out on the half of the rule nobody had touched.

   The rule itself narrowed because Ced's new Escape (6m9) removed the escape hatch 6ju relied on —
   "Escape drops the selection and the sheet is a drawing surface again" is no longer true, so a
   SINGLE selected mark no longer claims the press. A drag draws over it (6hq), a click picks it up
   (6l7), and the mark still moves by its own grip or the arrow keys. A MULTI-SELECTION or a GROUP
   keeps the claim: dragging the block IS the gesture there, and there is no one mark to have meant.
   ================================================================================================== */
function pressOwnedByMark(id){
  if(id==null)return false;
  if(S.selMulti.has(id))return true;
  const o=(S.annos||[]).find(z=>z.id===id);
  if(!o||o.group==null)return false;
  if(S.sel!=null){ const q=S.annos.find(z=>z.id===S.sel); if(q&&q.group===o.group)return true; }
  for(const k of S.selMulti){ const q=S.annos.find(z=>z.id===k); if(q&&q.group===o.group)return true; }
  return false;
}
/* 6jx — switching tools, or putting one down, abandons a start point that is still waiting */
function clickRunDrop(){ try{ if(typeof clickRunClear==="function")clickRunClear(true); }catch(e){} }
/* =================================================================================================
   6l1 — WHETHER THE SELECTION CAME FROM DRAWING, WHICH IS WHAT ESCAPE NEEDS TO KNOW.
   Ced: "esc once means deselect, but if the user clicked on the ui/pdf or on a different
   shape/redline without dragging for shape again, it should go to select mode... the esc click
   (once) should always put the tool on select if it was not from a tool and just selecting other
   redlines."

   6jt made Escape a ladder so that drawing a box, pressing Escape to lose the handles, and drawing
   the next one keeps the tool in the hand — and that is still exactly right for the hand that is
   drawing. It is wrong for the hand that has STOPPED: pick a tool, change your mind, click an
   existing redline to look at it, and Escape only drops the selection while the tool you are no
   longer using stays armed, so the next click on the sheet draws something you did not want.

   The difference between those two is one fact: did this selection come from a mark you just drew,
   or from one you just clicked? `toolDone` runs at the end of every draw and nowhere else, so that
   is where the first is recorded; every path that picks up an EXISTING mark clears it. Escape's
   selection rung then keeps the tool only when the tool is what put the mark there.
   ================================================================================================= */
var _selFromDraw=false;
function selNotFromDraw(){ _selFromDraw=false; }
function toolDone(){
  _selFromDraw=true;                 /* 6l1 — this selection is the thing just drawn */
  if(STICKY_TOOLS&&STICKY_MODES.has(S.mode)){
    /* the tool stays; the status line is what tells you so, once, rather than a toast every time */
    try{ updateMiniBar(); }catch(e){}
    return false;
  }
  setMode("select");
  return true;
}
/* Escape, S and the Select button: the three ways a tool is put down. */
function toolRelease(){
  if(S.mode!=="select")setMode("select");
}
function setMode(m){
  /* 6dr — changing tool mid-drag is one of the ways a selection box was orphaned */
  try{ clearStrayMarquees(); document.querySelectorAll(".page").forEach(p=>p._killDrag&&p._killDrag()); }catch(e){}
  if(S.mode!==m)clickRunDrop();        /* 6jx — and so is a start point left waiting */
  S.mode=m;
  document.querySelectorAll("#tools .tool").forEach(x=>x.classList.toggle("active",x.dataset.mode===m));
  const pg=$("#pages"); if(pg)pg.dataset.mode=m;
  const mp=$("#modePill"); if(mp)mp.textContent=MODE_NAMES[m]||m;
  /* Each tool draws in its own colours — see MA_TOOL_STYLES. Picking one brings its settings into the
     tool's own properties, so what the tool in your hand will draw is always what its ▾ panel shows. */
  try{ maShowToolStyle(m); }catch(e){}
  try{ updateMiniBar(); }catch(e){}
}
document.querySelectorAll("#tools .tool").forEach(b=>b.onclick=()=>{ setMode(b.dataset.mode); selectAnno(null); selectLine(null); });

/* ------------------------------------------------------------------------------------------------
   A value that printed across two or three lines is ONE value — "DC6-48-60-18-8" + "F" is
   DC6-48-60-18-8F, "ROSENBERG" + "ER" is ROSENBERGER. Clicking either line used to redline only that
   line, leaving the rest of the value showing. cellBlock() walks up and down from the clicked run,
   collecting runs in the same column, and returns the whole cell: its joined text and its full box.
   ------------------------------------------------------------------------------------------------ */
function cellBlock(pi,item){
  const P=S.pages[pi];
  const base=cellCluster(pi,item);                       // the runs on the clicked line
  const out={ items:[], textL:base.textL, textR:base.textR, top:null, bot:null, text:"", lines:1 };
  if(!P) return null;
  const fh=item.nh||0.011;
  const overlaps=t=>{ const l=t.nx, r=t.nx+(t.nw||0);
    /* must genuinely overlap the clicked value's span. A 0.012 slack let the neighbouring column's
       cell join the line, which inflated the block's width well past the printed text. */
    return Math.min(r,base.textR)-Math.max(l,base.textL) > -0.002; };
  const lineAt=y=>P.items.filter(t=>Math.abs((t.ny+(t.nh||0)/2)-y)<fh*0.6);
  const clusterOn=y=>lineAt(y).filter(overlaps).sort((a,b)=>a.nx-b.nx);
  const own=clusterOn(item.ny+fh/2);
  let rows=[{y:item.ny,items:own.length?own:[item]}];
  /* is the column one of the "one value per cell" columns? use the analysed column map when present */
  let oneValueCol=null;
  const A=S.analysis, RF=A&&A.rfInventory;
  if(RF&&RF.colX){ let best=null,bd=1e9;
    Object.keys(RF.colX).forEach(nm=>{ const d=Math.abs(RF.colX[nm]-(base.textL+base.textR)/2); if(d<bd){bd=d;best=nm;} });
    if(best&&bd<0.06) oneValueCol=ONE_VALUE_COL.test(String(best).trim());
  }
  const joinable=(cur,next)=>{
    if(oneValueCol===true)return true;
    if(oneValueCol===false)return false;
    const a=String(cur).trim(), b=String(next).trim();
    if(!a||!b)return false;
    if(/[-\/_]$/.test(a))return true;                    // the line ended mid-token
    if(b.length<=3||a.length<=3)return true;             // a stub like "F" or "ER" is never a value
    return b.length<a.length;                            // a shorter remainder, not a sibling value
  };
  const grow=dir=>{
    let guard=0;
    while(guard++<3){
      const ref=dir<0?rows[0]:rows[rows.length-1];
      const y=ref.y+dir*fh*1.5;
      const c=clusterOn(y+fh/2);
      if(!c.length)break;
      const curText=rows.map(r=>r.items.map(t=>t.str.trim()).join(" ")).join(" ");
      const nxt=c.map(t=>t.str.trim()).join(" ");
      if(!joinable(dir<0?nxt:curText, dir<0?curText:nxt))break;
      if(dir<0)rows.unshift({y:c[0].ny,items:c}); else rows.push({y:c[0].ny,items:c});
    }
  };
  grow(-1); grow(1);
  if(rows.length<2) return null;
  let txt="";
  rows.forEach(r=>{ r.items.forEach(t=>{ txt=joinCellLines(txt,String(t.str).trim()); }); out.items.push(...r.items); });
  const L=Math.min(...out.items.map(t=>t.nx)), R=Math.max(...out.items.map(t=>t.nx+(t.nw||0)));
  out.top=Math.min(...out.items.map(t=>t.ny));
  out.bot=Math.max(...out.items.map(t=>t.ny+(t.nh||0)));
  out.textL=L; out.textR=R; out.text=txt; out.lines=rows.length;
  const top=rows[0].items;
  out.topR=Math.max(...top.map(t=>t.nx+(t.nw||0)));       // width to match: the TOP line
  out.topL=Math.min(...top.map(t=>t.nx));
  out.lineH=Math.max(...top.map(t=>t.nh||0))||0.011;      // ONE line's height, for the font size
  return out;
}
function onCell(i,it){
  /* locked pages — Existing / Decommissioned tables and Local Market Notes — take no redlines at all,
     by hand or otherwise */
  if(S.pages[i]&&S.pages[i].locked){
    setStatus("Page "+(i+1)+" is locked ("+(S.pages[i].lockReason||"read-only")
      +"). Unlock it in ⧉ Organize pages if you need to redline it.");
    return;
  }
  if(S.mode==="redline"){
    const blk=cellBlock(i,it);
    if(blk){
      /* one editable mark over the whole cell, pre-filled with the joined value */
      const P=S.pages[i], pad=1.0/((P&&P.w1)||612);
      /* nh is ONE line — it drives the font size. The mark's own height comes from ny..y2. */
      /* 6fh — the RUN under the pointer is the one unambiguous measure: one printed string and the
         width the page gave it. A block can be several runs joined, so its span is not that string's
         width and fitting to it would come out wrong in either direction. */
      const id=stampWholeCell(i,{nx:blk.topL-pad,ny:blk.top,nw:blk.topR-blk.topL+pad*2,
                                 nh:blk.lineH,x2:blk.textR+pad,y2:blk.bot,
                                 topR:blk.topR+pad,topY:blk.top,lines:blk.lines,
                                 pstr:it.str, pw:it.nw},
                              blk.text,"center");
      const a=S.annos.find(z=>z.id===id);
      if(a){ a.onCell=true; a.cw=blk.topR-blk.topL; a.tx0=blk.topL;
        if(a.srcLen==null&&blk.str!=null)a.srcLen=String(blk.str).trim().length;
             a.cellL=blk.textL; a.cellR=blk.textR; a.orig=blk.text; }
      /* addText laid the element out before stampWholeCell set wrap/height, so re-render it now —
         otherwise the mark keeps the single-line styling and the value never breaks onto line two */
      layoutAnnos(); _needRelayout=false;
      redlineAsTextBox(id);
      LOG("Redline: whole cell over",blk.lines,"lines →",blk.text);
      setTimeout(()=>{ const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
        if(ed){ selectAnno(id); ed.focus(); try{document.getSelection().selectAllChildren(ed);}catch(e){} } },0);
      toolDone();
      return;
    }
    const rid=addText(i,it.nx,it.ny,it.str,{cell:it});
    redlineAsTextBox(rid);
  }
  else if(S.mode==="cross"){ const id=addLine(i,it.nx,it.ny+it.nh/2,it.nx+it.nw,it.ny+it.nh/2); selectLine(id); }
  else if(S.mode==="strikerow"){ const id=strikeRow(i,it); selectLine(id); }
  /* the two mount-analysis tools: correct a printed value in place, or point at something on a drawing */
  else if(S.mode==="fix"){ maStrikeAndWrite(i,it); }
  else if(S.mode==="callout"){ maPlaceCallout(i,it.nx+(it.nw||0)/2,it.ny); }
  else if(S.mode==="text"){ maAddTextBox(i,it.nx,it.ny); }
  /* a click on printed text also answers a pending placement */
  else if(typeof _maPending!=="undefined"&&_maPending){ maPlacePending(i,it.nx,it.ny); }
  /* 6gt — AND THE TOOL GOES DOWN. One click on a printed value is the whole gesture for Redline,
     Strike text, Strike row and Strike & write, and what you reach for next is the mark you just made.
     `toolDone` knows which tools stay in the hand, so Callout and Text — which also arrive here when
     they are started from a printed value — are untouched by this line. */
  toolDone();
}

/* ==================================================================================================
   v60 — A REDLINE IS A TEXT BOX. Ced: "make the redline tool text box behave like the actual text
   box" — and, asked which parts: handles resize the box, wrap at words, and fully a Text box.
   The Redline click still does what made it worth having: it finds the printed value, covers it, and
   pre-fills the correction box with it, in the redline's colour and at the printed size. What it
   leaves behind is now a TEXT BOX laid exactly where the cell mark would have been — so it is
   resized by its handles (the type stays the size you set), wraps between words, keeps the size you
   drag it to, and has the same caret, alignment and properties as one drawn with the Text tool.
   The fields that made it a cell mark (fit to the column, type sized by height) are dropped; the
   printed value it covered is kept in `orig`, which Analyze reads.
   ================================================================================================== */
function redlineAsTextBox(id){
  try{
    const a=S.annos.find(z=>z.id===id); if(!a||a.kind==="img"||isShape(a))return;
    const d=markEl(id), pg=d&&d.closest(".page");
    const P=S.pages[a.page]||{w1:612,h1:792};
    if(d&&pg){
      const r=d.getBoundingClientRect(), pr=pg.getBoundingClientRect();
      if(r.width>0&&pr.width>0){
        a.nx=(r.left-pr.left)/pr.width; a.ny=(r.top-pr.top)/pr.height;
        a.nw=r.width/pr.width; a.nh=r.height/pr.height;
      }
      /* the type the cell fit chose, in points, becomes the box's own size */
      const ed=d.querySelector(".ed");
      if(ed){ const px=parseFloat(getComputedStyle(ed).fontSize)||0;
              const z=pr.width/(P.w1||612); if(px>0&&z>0)a.size=Math.round(px/z*2)/2; }
    }
    a.maKind="text";
    a.wrap=true; a.nowrap=false; a.manualW=true;
    a.wrapMode="words";                 /* Ced: "wrap at words" — a correction breaks between its words */
    a.align=a.align||"center"; a.alignSet=true; a.valign=a.valign||"middle";
    a.lineNh=(a.size||10)*1.22/(P.h1||792);
    a.lines=Math.max(1,Math.round((a.nh||a.lineNh)/a.lineNh)); a.pLines=1;
    ["onCell","fullcell","cw","tx0","cellL","cellR","topR","topY","x2","y2","pstr","pw","fitW"].forEach(k=>{ delete a[k]; });
    a.onCell=false; a.fullcell=false;
    layoutAnnos();
  }catch(e){ LOG&&LOG("redline → text box skipped",e&&e.message); }
}

/* strike the full equipment row: find text items sharing this row's vertical band */
function rowBand(i,it){
  const cy=it.ny+it.nh/2, tol=it.nh*0.7;
  const band=S.pages[i].items.filter(t=>Math.abs((t.ny+t.nh/2)-cy)<tol);
  const left=Math.min(...band.map(t=>t.nx)), right=Math.max(...band.map(t=>t.nx+t.nw));
  return {y:cy, left:Math.max(0,left-0.006), right:Math.min(1,right+0.006)};
}

/* Strike the whole row a printed value sits on: the row's band gives the left and right edges, so the
   rule runs the width of what is actually printed rather than the width of the page. */
function strikeRow(i,it){ const b=rowBand(i,it);
  if(_azApplying && S.lines.some(l=>l.fromAnalyze && l.page===i && Math.abs(l.y1-b.y)<0.006)) return null;   // already struck by analyze
  return addLine(i,b.left,b.y,b.right,b.y);
}

/* 6dr — MARQUEE CLEANUP.
   The selection box is a real element parked in the page, and the only thing that removed it was a
   pointerup on the very element the drag started on. Anything that ended a drag another way left the
   box behind for good: a cancelled pointer (the browser takes the gesture back), a lost capture (the
   page re-renders under the pointer — a zoom, or virtualisation unloading and reloading it while you
   scroll), or a mode change from the keyboard mid-drag. They accumulate, which is why several from
   different tools were on screen at once.

   Two defences. The drag owns its box and releases it on every ending, cancel and capture-loss
   included; and anything left over is swept, because a stray box is never wanted and never has to be
   asked about. */
/* `var`, not `let`: setMode is declared above this point and calls clearStrayMarquees, so a `let`
   here would be in its temporal dead zone if a mode were ever set during load. */
var _activeMarquee=null;
/* =================================================================================================
   6f6 — SNAP WHILE DRAWING, AND Ctrl FOR A PERFECT SHAPE
   =================================================================================================
   Ced: "snap on means the lines arrows and others should align to straight vertical and horizontal"
   and "using the redline tool with ctrl pressed should make a perfect shape".

   Snap was, until now, only the alignment guides that appear while a mark is MOVED. Turned on, it
   now also straightens a stroke as it is drawn: come within a few degrees of level or plumb and the
   stroke goes exactly level or plumb, which is what a leader across a drawing sheet almost always
   wants. Shift still forces level outright, snap or no snap, and holding Ctrl suspends the snap for
   the one stroke where the angle is the point.

   Ctrl while dragging a box, an ellipse, a text box or a cross-out squares the drag off its own
   longer side — a perfect square, a true circle. The page never sees a half-finished shape that is
   not the one it will get: the marquee is squared as you drag, not on release.
   ================================================================================================= */
/* the tools whose strokes are rules through something, never pointers at it */
const STRIKE_MODES=["cross","strikerow","crossout","fix"];
const SNAP_DEG=4.5;                    /* how close to an axis counts as meant-to-be-on-it */
/* =================================================================================================
   6kt — A STROKE GOES WHERE IT IS DRAWN, UNLESS YOU ASK FOR A TARGET.
   Ced: "when putting a line or any shape, do not instantly have target, unless user is clicking
   shift. also, if the user is clicking ctrl, also remove target and snap on that."

   6f6 made the Snap toggle straighten a stroke as it was DRAWN: come within 4.5° of a 15° step and
   the stroke is pulled onto it. Measured against how it is actually used, that is the wrong default
   — a leader across a drawing is very often meant to lie at the angle the hand gave it, and a pull
   that happens on its own is one you have to fight, with no way to know in advance that this
   particular drag will be caught. A target you ASK for is a different thing entirely.

   So, while drawing:
     nothing held   the stroke lands exactly where the pointer is. No target, ever.
     Shift          the nearest 15° — level, plumb and every useful diagonal between them — with no
                    tolerance to fall outside, so holding it always gives a target rather than
                    sometimes giving one.
     Ctrl / Cmd     the nearest 45°: level, plumb, or a true diagonal and nothing else.
     Alt            free, the same as nothing held, for a hand already on Ctrl.

   Shift used to force dead level outright. The 15° grid contains level, so the old reflex still
   lands level whenever the hand is anywhere near it, and it now reaches plumb and the diagonals too
   rather than only the one axis.

   The Snap toggle keeps what it meant before 6f6 and still means everywhere else: the alignment
   guides a mark MOVES onto, and the 15° settle on a rotation. It no longer reaches a stroke being
   drawn, which is the whole of this change.
   ================================================================================================= */
function snapDrawPoint(sx,sy,x,y,e,pg){
  const hard=!!(e&&(e.ctrlKey||e.metaKey));
  const soft=!!(e&&e.shiftKey);
  if(e&&e.altKey)return [x,y];
  if(!hard&&!soft)return [x,y];                /* 6kt — no modifier, no target */
  /* the angle has to be measured in PIXELS — a page is not square, so equal steps in normalised
     units are not equal on screen and a "vertical" line would come out leaning */
  const w=(pg&&pg.offsetWidth)||1, h=(pg&&pg.offsetHeight)||1;
  const dx=(x-sx)*w, dy=(y-sy)*h;
  if(!dx&&!dy)return [x,y];
  /* 6f9 — the nearest 15°, which covers level and plumb and every useful diagonal between them.
     The length is kept; only the direction moves, so a stroke does not jump as it settles. */
  const ang=Math.atan2(dy,dx)*180/Math.PI;
  const step=hard?45:SNAP_DEG_STEP, snapped=Math.round(ang/step)*step;
  const len=Math.hypot(dx,dy), th=snapped*Math.PI/180;
  return [ sx+Math.cos(th)*len/w, sy+Math.sin(th)*len/h ];
}
/* Square a drag off its longer side, keeping the corner it started from. */
function squareDrag(sx,sy,x,y,pg){
  const w=(pg&&pg.offsetWidth)||1, h=(pg&&pg.offsetHeight)||1;
  const dx=(x-sx)*w, dy=(y-sy)*h;
  const s=Math.max(Math.abs(dx),Math.abs(dy));
  return [ sx+(dx<0?-s:s)/w, sy+(dy<0?-s:s)/h ];
}
function clearStrayMarquees(){
  let n=0;
  document.querySelectorAll(".marquee").forEach(m=>{ if(m!==_activeMarquee){ m.remove(); n++; } });
  if(n)LOG&&LOG("cleared",n,"stray selection box(es)");
  return n;
}
function attachPagePointer(pg,i){
  let sx,sy,drawing=false,tmp=null,downOnBlank=false,panning=false,psx,psy,pscrX,pscrY,marquee=false,mbox=null,copyMarquee=false,crossMarquee=false,shapeMarquee=null;
  let fromRun=false;        /* 6jx — this press is the second click of a two-click run */
  /* one place that ends a marquee, so no ending can forget the box */
  const dropMarquee=()=>{
    if(mbox){ mbox.remove(); if(_activeMarquee===mbox)_activeMarquee=null; mbox=null; }
    try{ ghostClear(); }catch(e){}          /* 6ha — and the shape preview with it */
    marquee=false; copyMarquee=false; crossMarquee=false; shapeMarquee=null;
  };
  const dropDraw=()=>{ if(tmp){ try{ tmp.remove(); }catch(e){} tmp=null; }
                      try{ ghostClear(); }catch(e){} drawing=false; };
  ["pointercancel","lostpointercapture"].forEach(ev=>
    pg.addEventListener(ev,()=>{ dropMarquee(); dropDraw(); panning=false; pg.style.cursor=""; }));
  pg._killDrag=()=>{ dropMarquee(); dropDraw(); panning=false; pg.style.cursor=""; };
  const rel=e=>{const r=pg.getBoundingClientRect();return {x:(e.clientX-r.left)/pg.offsetWidth,y:(e.clientY-r.top)/pg.offsetHeight};};
  /* 6eo — WHEN WE TAKE THE DRAG, THE BROWSER MUST NOT ALSO TAKE IT. `.tspan` carries
     `user-select:text` so printed text can be selected and copied, and nothing here ever called
     `preventDefault()` — so every marquee drag ALSO dragged a native selection across every span it
     crossed, and the selection stayed behind after the release. That is the whole of "clicking with
     select mode is sometimes doing this": the page comes back with its entire text layer highlighted.
     `body.nosel` turns selection off for the duration, which stops it mid-drag rather than trying to
     clean up afterwards, and any selection already standing is dropped as the gesture starts. */
  const ownGesture=()=>{
    document.body.classList.add("nosel");
    try{ const s0=window.getSelection(); if(s0&&s0.removeAllRanges)s0.removeAllRanges(); }catch(_){}
  };
  const releaseGesture=()=>{ document.body.classList.remove("nosel"); };
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>
    pg.addEventListener(ev,releaseGesture));
  pg.addEventListener("pointerdown",e=>{
    if(e.button===2)return;   // right-click is handled by contextmenu (redline)
    clearStrayMarquees();     /* 6dr — a new press is a clean slate */
    /* 6hq — a press on a MARK belongs to the mark, unless a drawing tool is in the hand, in which
       case it belongs to the tool and the new mark is drawn over the old one. */
    /* 6ju — and unless that mark is the one you have SELECTED. Ced: "make the shapes be draggable
       even if you drag them by the shape itself." The page's pointerdown runs before the mark's own
       mousedown — pointer events come first — so with a drawing tool up the page claimed the press
       and the mark never saw it. A mark you have deliberately selected is one you are working ON:
       the press belongs to it, and Escape (6jt) drops the selection when you want to draw over it. */
    {
      const host=e.target.closest?e.target.closest(".anno"):null;
      if(host){
        /* 6m9 — ONE definition of this, shared with the mark's own handler; see `pressOwnedByMark` */
        if(!toolDraws()||pressOwnedByMark(+host.dataset.id))return;
      }
    }
    /* 6hq — remember WHICH mark the press landed on: if the gesture turns out to be a click rather
       than a drag, the mark is what was meant and it is selected, which is what the tool buttons and
       the help have always promised ("a single click on a mark selects it whatever tool is up"). */
    { const host=e.target.closest?e.target.closest(".anno"):null;
      _downAnno=host?+host.dataset.id:null; }
    fromRun=false;
    const isTspan=e.target.classList.contains("tspan");
    const pt=rel(e); sx=pt.x; sy=pt.y; downOnBlank=!isTspan;
    /* 6hf — SOMETHING IS BEING HELD. A note, a callout or a markup waiting to be put down owns the
       next press outright: without this the press first started whatever the current tool does — in
       Select, a marquee — and that branch returns before the placement is ever reached, so the click
       that was meant to put the stamp down did nothing at all and the stamp stayed in the hand. */
    if(typeof _maPending!=="undefined"&&_maPending){ ownGesture(); e.preventDefault(); return; }
    /* every mode below drives its own drag; only a press on printed text in Select mode is left to the
       browser, which is where selecting a value to copy still has to work */
    if(!(S.mode==="select"&&isTspan)){ ownGesture(); e.preventDefault(); }
    if(S.mode==="crossout"){
      /* 6dq — drag a box; on release it becomes an X of two crossing strikes. The box is only the
         gesture — what it leaves behind is two ordinary lines, so they select, drag, nudge, group,
         undo and export exactly like every other strike. */
      marquee=true; crossMarquee=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      mbox=el("div","marquee crossout");
      mbox.style.left=(sx*pg.offsetWidth)+"px"; mbox.style.top=(sy*pg.offsetHeight)+"px";
      mbox.style.width="0px"; mbox.style.height="0px";
      pg.appendChild(mbox); _activeMarquee=mbox; return;
    }
    /* a BOX or an ELLIPSE is drawn the way you would draw it with a pencil: press at one corner,
       drag to the other. The marquee is only the gesture; what it leaves behind is a mark like any
       other, with its own rule, interior and text. */
    if(S.mode==="box"||S.mode==="circle"||S.mode==="text"){
      marquee=true; shapeMarquee=S.mode; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      mbox=el("div","marquee shape"+(S.mode==="circle"?" round":"")+(S.mode==="text"?" textbox":""));
      mbox.style.left=(sx*pg.offsetWidth)+"px"; mbox.style.top=(sy*pg.offsetHeight)+"px";
      mbox.style.width="0px"; mbox.style.height="0px";
      pg.appendChild(mbox); _activeMarquee=mbox; return;
    }
    /* 6gb — GRAB AND MARQUEE ARE TWO TOOLS NOW.
       Ced: "separate grab/pan vs marquee tool. with marquee tool interchangeable with these tools."
       Select is the marquee: a drag on blank space picks up everything it crosses. Pan is the hand: a
       drag moves the sheet under the window. Either one borrows the other while a modifier is held, and
       holding Space pans from whichever tool is in your hand — so the two are interchangeable without
       putting the tool down. */
    const _wantPan=(S.mode==="pan")!==!!(e.shiftKey||e.ctrlKey||e.metaKey);
    if((S.mode==="select"||S.mode==="pan") && !isTspan){
      if(_wantPan||_spacePan){
        panning=true; try{pg.setPointerCapture(e.pointerId);}catch(_){} pg.style.cursor="grabbing";
        psx=e.clientX; psy=e.clientY; pscrX=window.scrollX; pscrY=window.scrollY; return;
      }
      // the marquee
      marquee=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      mbox=el("div","marquee"); mbox.style.left=(sx*pg.offsetWidth)+"px"; mbox.style.top=(sy*pg.offsetHeight)+"px"; mbox.style.width="0px"; mbox.style.height="0px";
      pg.appendChild(mbox); _activeMarquee=mbox; return;
    }
    /* Space pans from any other tool as well, without disturbing what that tool is doing */
    if(_spacePan){
      panning=true; try{pg.setPointerCapture(e.pointerId);}catch(_){} pg.style.cursor="grabbing";
      psx=e.clientX; psy=e.clientY; pscrX=window.scrollX; pscrY=window.scrollY; return;
    }
    /* 6gd — A CALLOUT IS DRAWN, NOT DROPPED.
       Ced: "the callout add should not be added with click, it should be like a line where the click is
       where the arrow is and the drag is where the end of line of arrow is." So it arms the same drag
       the line tool does: press on the thing you are pointing AT, drag out to where the note goes, let
       go, and the box is built there with its leader already aimed back at the press. */
    if(S.mode==="line" || S.mode==="arrow" || S.mode==="callout" || S.mode==="dim" || (S.mode==="cross" && !isTspan)){
      drawing=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      /* 6ha — THE PREVIEW IS THE MARK. `tmp` is kept as the flag every branch below reads; what is
         actually drawn is a ghost stroke in the tool's own style, painted by the stroke renderer. */
      tmp=true;
      /* 6jx — a run armed by a click keeps ITS start: this press is the second click, and dragging
         from it is the same gesture finished with the hand down. The run is consumed here, so the
         release below is an ordinary one — it just happens to start where the first click was. */
      fromRun=false;
      if(_clickRun&&_clickRun.page===i&&_clickRun.mode===S.mode){
        sx=_clickRun.x; sy=_clickRun.y; fromRun=true; _clickRun=null;
      }
      _ghost=ghostStroke(i,S.mode,sx,sy,sx,sy);
      if(pageRendered(i))drawPageLines(i);
    }
  });
  pg.addEventListener("pointermove",e=>{
    if(panning){ window.scrollTo(pscrX-(e.clientX-psx),pscrY-(e.clientY-psy)); return; }
    /* copyMarquee shares the marquee box; nothing extra to do while dragging */
    if(marquee&&mbox){ let pt=rel(e); const W=pg.offsetWidth,H=pg.offsetHeight;
      /* 6f6 — Ctrl squares a shape off as it is drawn */
      if((e.ctrlKey||e.metaKey)&&(shapeMarquee||crossMarquee)){
        const q=squareDrag(sx,sy,pt.x,pt.y,pg); pt={x:q[0],y:q[1]};
      }
      const x1=Math.min(sx,pt.x)*W,y1=Math.min(sy,pt.y)*H,x2=Math.max(sx,pt.x)*W,y2=Math.max(sy,pt.y)*H;
      mbox.style.left=x1+"px"; mbox.style.top=y1+"px"; mbox.style.width=(x2-x1)+"px"; mbox.style.height=(y2-y1)+"px";
      /* 6ha — a BOX or an ELLIPSE shows the shape itself as it is dragged, in the colours it will have,
         with the dotted marquee left underneath as the size guide. A text box shows its outline the
         same way, because where its edges land is the whole of the gesture. */
      /* ==========================================================================================
         6m5 — EXCEPT A TEXT BOX, WHICH IS NOT A SHAPE. Ced, of the text tool's drag: "the preview for
         it as well is weird. make it look like the textbox", with a capture of a solid red slab.
         `ghostShape` paints the shape IN THE TOOL'S OWN STYLE — the ribbon's fill, its opacity, its
         stroke — which is right for a box and an ellipse, because that is what those marks will look
         like. A text box has no fill and no outline; it is words on the page. So painting the shape
         style over the gesture shows something the mark will never be, and it hides the drawing you
         are placing the box ON, which is the one thing you need to see while you place it.
         The marquee alone is the preview, undimmed, with a see-through interior: a dashed rule where
         the four edges will land, which is exactly what a text box's selection looks like.
         ========================================================================================== */
      if(shapeMarquee&&shapeMarquee!=="text"){
        mbox.classList.add("ghosting");
        ghostShapeMove(i,(shapeMarquee==="circle")?"ellipse":"rect",sx,sy,pt.x,pt.y);
      }
      /* 6g1 — and a dragged box says how big it is, in the sheet's own inches */
      if(shapeMarquee||crossMarquee||copyMarquee){
        const P=S.pages[i]||{};
        const wi=Math.abs(pt.x-sx)*(P.w1||612)/72, hi=Math.abs(pt.y-sy)*(P.h1||792)/72;
        const h=lenHUD();
        h.textContent=wi.toFixed(2)+"\u2033 \u00d7 "+hi.toFixed(2)+"\u2033";
        h.classList.toggle("caught",!!(e.ctrlKey||e.metaKey));
        h.style.left=Math.round(e.clientX+16)+"px"; h.style.top=Math.round(e.clientY-14)+"px";
        h.classList.add("show");
      }
      return; }
    /* 6jx — between the two clicks the preview follows the pointer from the start point */
    if(!drawing&&_clickRun&&_clickRun.page===i&&_clickRun.mode===S.mode){
      const q=rel(e);
      const ep2=(S.mode==="cross")?[q.x,_clickRun.y]
                                  :snapDrawPoint(_clickRun.x,_clickRun.y,q.x,q.y,e,pg);
      ghostMove(ep2[0],ep2[1]);
      lenHUDShow(lenHUD(),i,_clickRun.x,_clickRun.y,ep2[0],ep2[1],
                 (ep2[0]!==q.x||ep2[1]!==q.y),e.clientX,e.clientY);
      return;
    }
    if(!drawing||!tmp)return; const pt=rel(e);
    /* A strike through a printed value is level by definition. A line or an arrow goes where it is
       dragged — Shift levels it, and Snap straightens it when it is nearly straight already. */
    const ep=(S.mode==="cross")?[pt.x,sy]:snapDrawPoint(sx,sy,pt.x,pt.y,e,pg);
    ghostMove(ep[0],ep[1]);
    /* 6g1 — say how long it is, as it is drawn */
    const _caught=(ep[0]!==pt.x||ep[1]!==pt.y);
    lenHUDShow(lenHUD(),i,sx,sy,ep[0],ep[1],_caught,e.clientX,e.clientY);
  });
  pg.addEventListener("pointerup",e=>{
    /* 6hf — and the release puts it down, before any tool's own release can claim it */
    if(typeof _maPending!=="undefined"&&_maPending){
      if(e.target.closest(".anno"))return;
      const q=rel(e); maPlacePending(i,q.x,q.y); return;
    }
    if(e.button===2)return;   // right-click handled by contextmenu
    if(panning===false&&marquee===false&&copyMarquee)copyMarquee=false;
    if(panning){ panning=false; pg.style.cursor="";
      const pt=rel(e); if(Math.hypot(pt.x-sx,pt.y-sy)<0.006){ selectAnno(null); selectLine(null); }
      return; }
    if(marquee){ lenHUDHide(lenHUD()); let pt=rel(e);
      /* 6f6 — a squared drag releases where it was SHOWN, not where the pointer happens to be */
      if((e.ctrlKey||e.metaKey)&&(shapeMarquee||crossMarquee)){
        const q=squareDrag(sx,sy,pt.x,pt.y,pg); pt={x:q[0],y:q[1]};
      }
      const rx1=Math.min(sx,pt.x),ry1=Math.min(sy,pt.y),rx2=Math.max(sx,pt.x),ry2=Math.max(sy,pt.y);
      /* `dropMarquee()` resets every one of these, so whichever gesture this was has to be held on to
         across it — the shape flag was not, which is why Box and Circle drew a selection box and then
         quietly did nothing at all. */
      const wasCopy=copyMarquee, wasCross=crossMarquee, wasShape=shapeMarquee;
      dropMarquee();                      /* the box goes first, whatever this drag turns out to be */
      copyMarquee=wasCopy; crossMarquee=wasCross; shapeMarquee=wasShape;
      if(copyMarquee){ copyMarquee=false; copyRowFromBox(i,rx1,ry1,rx2,ry2); return; }
      if(crossMarquee){ crossMarquee=false; crossOutBox(i,rx1,ry1,rx2,ry2); return; }
      if(shapeMarquee){
        const kind=shapeMarquee; shapeMarquee=null;
        /* 6iv — what counts as a CLICK rather than a drag. It was 0.004 of the page, about 2.4pt,
           which made a deliberately small box impossible to draw: it was read as a click and thrown
           away. A gesture under a point in both directions is a click; anything bigger is a shape. */
        const tiny=(Math.abs(rx2-rx1)<0.0016&&Math.abs(ry2-ry1)<0.0016);
        if(kind==="text"){
          /* a drag sizes the box; a click gives a sensible one you can drag straight away */
          if(tiny)maAddTextBox(i,rx1,ry1);
          else maAddTextBox(i,rx1,ry1,"",rx2-rx1,ry2-ry1);
          return;
        }
        if(tiny){ toolDone(); return; }                           // a click, not a drag
        maAddShape(i,kind==="circle"?"ellipse":"rect",rx1,ry1,rx2-rx1,ry2-ry1);
        return;
      }
      /* 6gn — and the same for the tools that arm a MARQUEE. Cross out drew its X and then put itself
         down; a click that drew no box left it armed. `setMode` only where a tool is actually up, so
         Select's own marquee-click keeps deselecting and nothing else. */
      if(Math.abs(pt.x-sx)<0.004&&Math.abs(pt.y-sy)<0.004){ clearMulti(); selectAnno(null); selectLine(null);
        groupLeave();                                   /* 6jz — blank page closes an open group */
        toolDone();
        return; }  // tiny = click-deselect
      groupLeave();                                     /* 6jz — and so does a marquee */
      clearMulti(); selectAnno(null);
      /* ============================================================================================
         6kb — A MARQUEE CATCHES WHAT IT TOUCHES.
         Ced: "shapes and redlines should be selected if you select it even with just the fill or the
         text."
         The test was whether a mark's TOP-LEFT CORNER fell inside the box — so dragging a selection
         across the middle of a shape, over its fill or over the words in it, caught nothing at all,
         and the only way to pick a box up was to start the drag above and to the left of its origin
         and enclose that one point. On a crowded sheet that is most of the marks on the page.
         Two rectangles that OVERLAP is the test now, which is what every editor means by a marquee
         and what the gesture looks like it is doing. A stroke is caught when any part of its run is
         inside, rather than when its midpoint happens to be — a long leader crossing the box is
         caught by the part that crosses it.
         ============================================================================================ */
      const _hits=(ax1,ay1,ax2,ay2)=>!(ax2<rx1||ax1>rx2||ay2<ry1||ay1>ry2);
      S.annos.forEach(a=>{
        if(a.page!==i)return;
        if(maLayerHidden(a))return;                       /* a hidden layer is not selectable */
        if(a.lock||a.flat)return;                         /* nor is a locked or flattened mark */
        const x0=a.nx||0, y0=a.ny||0;
        if(_hits(x0,y0,x0+(a.nw||0),y0+(a.nh||0)))S.selMulti.add(a.id);
      });
      S.lines.forEach(l=>{
        if(l.page!==i)return;
        if(l.lock||l.flat)return;
        const pts=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
        /* any segment that enters the box catches the stroke; the bounding box alone would catch a
           long diagonal whose line never comes near the marquee */
        let got=false;
        for(let k=0;k<pts.length&&!got;k++){
          const p=pts[k];
          if(p[0]>=rx1&&p[0]<=rx2&&p[1]>=ry1&&p[1]<=ry2){ got=true; break; }
          const q=pts[k+1]; if(!q)break;
          /* sample the segment — cheap, exact enough at marquee scale, and it cannot miss a
             crossing the way two endpoints outside the box can */
          const n=Math.max(2,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/0.004));
          for(let t=1;t<n;t++){
            const x=p[0]+(q[0]-p[0])*t/n, y=p[1]+(q[1]-p[1])*t/n;
            if(x>=rx1&&x<=rx2&&y>=ry1&&y<=ry2){ got=true; break; }
          }
        }
        if(got)S.selMultiL.add(l.id);
      });
      paintMulti();
      if(multiCount())toast(`Selected ${multiCount()} mark${multiCount()>1?"s":""}`);
      return; }
    if(drawing&&tmp){ const pt=rel(e); tmp=null; drawing=false; try{ ghostClear(); }catch(e2){}
      lenHUDHide(lenHUD());
      /* 6f6 — the same point the live stroke was drawn to: Shift levelled, Snap straightened, or
         neither. Recomputing it here is what would have undone the snap on release. */
      const ep=(S.mode==="cross")?[pt.x,sy]:snapDrawPoint(sx,sy,pt.x,pt.y,e,pg);
      const ex=ep[0], ey=ep[1];
      const moved=Math.hypot(ex-sx,ey-sy)>0.004;
      if(S.mode==="callout"){
        /* the press is the arrow, the release is where the note goes. A press that went nowhere still
           places one, the old way, so a click is never a dead gesture. */
        if(moved)maPlaceCallout(i,sx,sy,null,{x:pt.x,y:pt.y});
        else maPlaceCallout(i,sx,sy);
        return;
      }
      /* 6gg — A LENGTH is drawn exactly like a line, and what it leaves behind is the run plus its
         own reading. Before the general stroke branch, because it makes two marks, not one. */
      if(S.mode==="dim"){
        if(moved)maPlaceDim(i,sx,sy,ex,ey);
        else if(!tookClickOnMark())toolDone();
        return;
      }
      if(moved){
        /* 6gd — NO `arrow:"end"` HERE. Ced: "the arrowhead is also not changing when changed on tool
           properties." `opts.arrow` overrides both endings outright, so every arrow came out with the
           default head however the Arrow tool's panel was set. The endings come from the tool's own
           style now, which is where the panel writes them — and the Arrow tool's default style is an
           arrowhead, so nothing about drawing a plain arrow changes. */
        const id=addLine(i,sx,sy,ex,ey,{col:$("#c_text").value,
                                          sw:parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5)});
        selectLine(id);
        /* 6gt — Line and Arrow are drawing tools and stay; Strike text has done its one job and goes
           down, which `toolDone` decides from the mode rather than from here. */
        toolDone();
      }
      /* 6jx — A CLICK, NOT A DRAG: the first one sets the start point and the second finishes the
         run. 6gn's rule — a press-and-release that drew nothing puts the tool down — still holds for
         the click that says "no, nothing here": clicking the same spot twice.
         6hq — and if that press landed ON a mark, the click was meant for the mark. */
      else if(!tookClickOnMark()){
        const two=(S.mode==="line"||S.mode==="arrow"||S.mode==="dim"||S.mode==="cross");
        if(two&&!fromRun){ clickRunArm(i,S.mode,sx,sy); return; }
        /* the second click landed on the first: you did not want one after all */
        toolDone();
      }
      return;
    }
    /* 6gn — AND THE STROKE TOOLS DO THE SAME. Ced: "clicking on pdf surface should go back to select
       even in strike through, lines, strike text and crossout." Redline has behaved this way since it
       was written — a click that draws nothing puts the tool down — and the four stroke tools did not,
       so once you had drawn a strike the tool stayed armed and the next click started another one
       instead of selecting the mark you were reaching for. Cross out already reverted; the other three
       did not, which made it look arbitrary rather than deliberate.
       A DRAG still draws and still leaves the tool up: this is only the click that produced nothing. */
    /* A note or a callout waiting for the click that says where it goes, the callout tool itself, and
       the polyline, which collects a point per click until you finish it. */
    if(!e.target.closest(".anno")){
      const pt=rel(e);
      if(typeof _maPending!=="undefined"&&_maPending){ maPlacePending(i,pt.x,pt.y); return; }
      if(S.mode==="poly"){
        /* 6f6 — the corner lands where the live segment showed it, snapped included */
        let px=pt.x, py=pt.y;
        try{ const prev=maPolyLast(); if(prev){ const q=snapDrawPoint(prev[0],prev[1],px,py,e,pg); px=q[0]; py=q[1]; } }catch(_){}
        maPolyPoint(i,px,py); return; }
      /* 6gd — the callout is placed by the drag above; nothing to do on a bare click here */
    }
    const ARMED_TOOLS=["redline","cross","crossout","strikerow","fix"];
    if(ARMED_TOOLS.indexOf(S.mode)>=0 && downOnBlank && !e.target.closest(".anno")){
      const pt=rel(e);
      if(Math.hypot(pt.x-sx,pt.y-sy)<0.01){ toolDone(); }          // 6f8 — the tool stays armed
    }
    _downAnno=null;
  });
  pg.addEventListener("dblclick",e=>{ if(S.mode==="poly"){ e.preventDefault(); maPolyFinish(); } });
  // right-click = redline: on a text cell it drops a cell redline; on blank it drops a free redline; either way switches to the Redline tool
  pg.addEventListener("contextmenu",e=>{
    if(e.target.closest(".anno"))return;
    e.preventDefault();
    if(S.mode!=="redline") setMode("redline");
    if(e.target.classList.contains("tspan")){ e.target.click(); }   // cell redline (onCell fires in redline mode)
    else { const pt=rel(e); addText(i,pt.x,pt.y,""); }              // free redline on non-text area
  });
}

/* ---------- strokes: lines, arrows and polylines ------------------------------------------------
   One object covers all three. A stroke is a list of points in normalised page units; two points is a
   line, more is a polyline, and `arrow` says whether either end wears a head. Everything that made the
   original horizontal strike work — selection, dragging by the body, dragging an end, grouping, undo,
   the export — works on the list, so a strike through a printed value and a four-segment leader across
   a drawing sheet are the same kind of thing.

   `x1..y2` are kept in step with the first and last point, because a strike is created and read that
   way all over the tool and there is no reason to make every caller learn about points. */
function linePts(l){
  if(l&&l.pts&&l.pts.length>=2)return l.pts;
  return [[l.x1,l.y1],[l.x2,(l.y2!=null?l.y2:l.y1)]];
}
function syncLineEnds(l){
  const p=linePts(l);
  l.x1=p[0][0]; l.y1=p[0][1];
  l.x2=p[p.length-1][0]; l.y2=p[p.length-1][1];
}
function addLine(page,x1,y1,x2,y2,opts){
  pushHistory(); const id=seq++;
  const l={id,page,x1,y1,x2,y2:(y2==null?y1:y2)};
  /* the same rule as a text mark: a stroke keeps the colour and thickness it was drawn with */
  l.col=$("#c_text").value;
  l.sw=parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5)||1.5;
  /* 6f6 — and the rest of the tool's stroke properties: its endings, line style, ink opacity and
     highlight mode, straight from whichever tool is drawing. */
  try{ const st=maStyleNow();
       ["colOp","dash","lpat","hl"].forEach(k=>{ if(st[k]!=null&&st[k]!=="")l[k]=st[k]; });
       /* 6fh — an ENDING is applied even when it is "none": "" is a real answer here, and skipping it
          left a tool you had just switched to no-ending still drawing its default head. */
       ["le0","le1"].forEach(k=>{ if(st[k]!=null)l[k]=st[k]; });
       /* 6jv — AND HOW BIG THE HEAD IS. Ced: "make the arrowheads true to the size again. tiny has
          become bigger again." Measured: Tiny, Small, Medium and Large all drew a 10pt head, because
          `leSz` was never copied off the tool here. The panel set it, the mark never carried it, and
          `tipScaleOf` fell back to 1 — so the dial had four positions and one outcome. It is saved
          with the stroke, copied, exported and reopened already; it was only the drawing that lost it.
          6jw — the corner and cap style travel the same way. */
       ["leSz","join"].forEach(k=>{ if(st[k]!=null&&st[k]!=="")l[k]=st[k]; });
  }catch(_){}
  if(opts){
    if(opts.pts&&opts.pts.length>=2){ l.pts=opts.pts.map(p=>[p[0],p[1]]); syncLineEnds(l); }
    if(opts.col)l.col=opts.col;
    if(opts.sw!=null)l.sw=opts.sw;
    /* an explicit arrow from the caller (a callout's leader, say) decides the endings outright */
    if(opts.arrow){ l.arrow=opts.arrow;
      l.le0=(opts.arrow==="start"||opts.arrow==="both")?"arrow":"";
      l.le1=(opts.arrow==="end"||opts.arrow==="both")?"arrow":""; }
    if(opts.maKind)l.maKind=opts.maKind;
    if(opts.le0!=null)l.le0=opts.le0;
    if(opts.le1!=null)l.le1=opts.le1;
    if(opts.leSz!=null)l.leSz=opts.leSz;      /* 6jv */
    if(opts.join!=null)l.join=opts.join;      /* 6jw */
  }
  /* 6fh — Ced: "strike through should always be line start and end plain". A rule through a printed
     value is a deletion, not a pointer; an arrowhead on one turns it into something it is not. The
     four striking tools are held plain at both ends whatever their panel is set to, and their panels
     no longer offer the choice. */
  if(STRIKE_MODES.indexOf(S.mode)>=0||l.maKind==="fix"||l.maKind==="strike"){ l.le0=""; l.le1=""; }
  syncArrowFlag(l);
  if(_azApplying)l.fromAnalyze=true;
  S.lines.push(l);
  topZ(l);                /* 6ib — a new stroke lands on top of its own band too */
  drawPageLines(page); updateRail(); updateCount(); return id;
}
/* 6gf — HOW BIG AN ENDING IS, IN ONE PLACE AND IN ONE UNIT.
   Ced: "the renders are not exactly the same as the applied redlines and shapes especially on the
   arrow end and start."

   Found by measuring the screen against a rendered page of the export at 252% zoom, which is where
   Ced was working. The size was `max(10, 4×width)` in both renderers — but on screen `width` is in
   SCREEN PIXELS at the current zoom, so the floor of 10 meant ten pixels, which at 252% is four
   points; in the file the same 10 meant ten POINTS. So every ending under 2.5pt came out visibly
   bigger in the file than on the sheet, and the gap changed with the zoom.

   The floor is now scaled with everything else: the screen asks for `headSizeFor(sw*scale)` and gets
   `scale × the file's size`, at any zoom. The export passes a width in points and gets points. */
/* =================================================================================================
   6jw — CORNERS AND ENDS, AS A SETTING.
   Ced: "make the corners of the lines sharp as well and not rounded, or better yet, add this as an
   editable setting each tool." Every stroke was drawn `stroke-linejoin:round` and `stroke-linecap:
   round`, hard-coded in four places, which rounds off the point of a polyline's elbow and puts a
   half-round nub on the end of every rule — fine on a freehand annotation and wrong on a drawing
   sheet, where a leader is expected to come to a corner.
   One property, `join`, with three positions: `sharp` (mitre, the new default), `round` and `bevel`.
   It answers for the cap as well, because the two belong together — a mitred corner with a round end
   is neither one thing nor the other. A dotted rule keeps its round cap whatever this says, because a
   zero-length dash with a butt cap draws nothing at all.
   The same three words map onto the PDF's own `j` and `J` operators, so the file and the screen agree.
   ================================================================================================= */
const JOIN_KINDS=[{v:"sharp",t:"Sharp"},{v:"round",t:"Round"},{v:"bevel",t:"Bevel"}];
function joinOf(o){
  const v=o&&o.join;
  return (v==="round"||v==="bevel"||v==="sharp")?v:"sharp";
}
function joinCss(o){ const j=joinOf(o); return j==="sharp"?"miter":j; }
function capCss(o){  return joinOf(o)==="round"?"round":"butt"; }
/* 0 mitre · 1 round · 2 bevel — the PDF's numbering for both operators */
function joinPdf(o){ const j=joinOf(o); return j==="round"?1:(j==="bevel"?2:0); }
function capPdf(o){  return joinOf(o)==="round"?1:0; }
function headSizeFor(swUnits,scale){
  const k=(scale!=null)?scale:1;
  return Math.max(10*k,swUnits*4);
}
/* 6gj — AND HOW BIG THE TIP ITSELF IS. Ced: "have a small, medium, and large tip arrowheads."
   One number per stroke, multiplying the size above, so a small tip and a large tip are the same
   shape at the same weight — and so the screen and the file stay in step, since both ask here. */
/* 6gt — Ced: "add a tinier option on all the arrowheads in all tools." Small was as small as the dial
   went, and on a dense drawing sheet a 0.68 head is still a wedge. Tiny is a little under half the
   standard head — enough to read as an arrow at 100%, small enough to point INTO a cluster of members
   without covering the one it points at. Every tool that shows Line endings gets it, because the chips
   are drawn from this list. */
const TIP_SIZES=[{v:0.42,t:"Tiny"},{v:0.68,t:"Small"},{v:1,t:"Medium"},{v:1.5,t:"Large"}];
function tipScaleOf(o){
  const v=o&&o.leSz;
  return (typeof v==="number"&&v>0.15&&v<4)?v:1;
}
function headSizeOf(o,swUnits,scale){ return headSizeFor(swUnits,scale)*tipScaleOf(o); }
function drawAllLines(){ S.pages.forEach((_,i)=>{ if(pageRendered(i))drawPageLines(i); }); }
/* The head, as a filled triangle on the end of the stroke. Drawn rather than left to an SVG marker so
   that the shape, the size and the angle are computed once here and written the same way into the
   exported PDF — a marker would look right on screen and be gone in the file. */
/* 6f6 — ONE ENDING, IN ONE PLACE. Every shape an end of a stroke can take, as a path in the drawing's
   own coordinates plus whether it is filled or stroked. `x1,y1` is the point the stroke comes FROM and
   `x2,y2` the end being decorated, so the angle is read off the last segment either way.
   Returns null for "no ending", which is the common case. */
function endShapePath(kind,x1,y1,x2,y2,size){
  if(!kind)return null;
  const a=Math.atan2(y2-y1,x2-x1), s=Math.max(4,size), w=s*0.42;
  const ca=Math.cos(a), sa=Math.sin(a);
  const back=(d)=>[x2-ca*d, y2-sa*d];
  const side=(px,py,d)=>[px-sa*d, py+ca*d];
  if(kind==="arrow"||kind==="rarrow"){
    /* 6fg — A POINTED TIP. The head is a narrow isoceles triangle, and its apex is the exact end of
       the stroke; the barbs are pulled in to `s*0.30` from `s*0.42` so it comes to a point rather
       than a wedge. The stroke itself is stopped short of that apex by `endTrim` below — a round cap
       running all the way to the tip is what was blunting it. */
    const dir=(kind==="rarrow")?-1:1;
    /* 6gd — Ced: "make them a tad wider." The barbs were pulled in to 0.30 of the head's length in 6fg
       to sharpen the point, which worked and left the head narrow for a mark meant to be seen across a
       drawing sheet. 0.38 is the middle ground: still a point, a visibly broader head. */
    const nw=s*0.38;
    const [bx,by]=back(s*dir);
    const [lx,ly]=side(bx,by,nw), [rx,ry]=side(bx,by,-nw);
    return {d:`M ${x2} ${y2} L ${lx} ${ly} L ${rx} ${ry} Z`, fill:true};
  }
  if(kind==="oarrow"){
    const [bx,by]=back(s);
    const ow=w*1.18;                     /* 6gd — the open chevron opens a little wider too */
    const [lx,ly]=side(bx,by,ow), [rx,ry]=side(bx,by,-ow);
    return {d:`M ${lx} ${ly} L ${x2} ${y2} L ${rx} ${ry}`, fill:false};
  }
  if(kind==="butt"){
    const [lx,ly]=side(x2,y2,w*1.4), [rx,ry]=side(x2,y2,-w*1.4);
    return {d:`M ${lx} ${ly} L ${rx} ${ry}`, fill:false};
  }
  if(kind==="square"||kind==="diamond"){
    const r=w*(kind==="diamond"?1.15:0.9);
    const [cx,cy]=back(r);
    const pts=[];
    const turn=(kind==="square")?Math.PI/4:0;   /* a square sits on its side, a diamond on its point */
    for(let k=0;k<4;k++){
      const t=a+turn+k*Math.PI/2;
      pts.push([cx+Math.cos(t)*r*Math.SQRT2, cy+Math.sin(t)*r*Math.SQRT2]);
    }
    return {d:"M "+pts.map(p=>p[0].toFixed(2)+" "+p[1].toFixed(2)).join(" L ")+" Z", fill:true};
  }
  if(kind==="circle"||kind==="ocircle"){
    const r=w*0.95, [cx,cy]=back(r);
    const k=0.5522847498*r;
    return {d:`M ${cx+r} ${cy} C ${cx+r} ${cy+k} ${cx+k} ${cy+r} ${cx} ${cy+r} `+
              `C ${cx-k} ${cy+r} ${cx-r} ${cy+k} ${cx-r} ${cy} `+
              `C ${cx-r} ${cy-k} ${cx-k} ${cy-r} ${cx} ${cy-r} `+
              `C ${cx+k} ${cy-r} ${cx+r} ${cy-k} ${cx+r} ${cy} Z`, fill:(kind==="circle")};
  }
  /* 6ga — the four Ced added. `roarrow` is the open chevron facing back down the line, `harrow` and
     `hrarrow` are half arrows — one barb, on the left of the run, the way a survey leader is drawn —
     and `slash` is the single oblique tick. All four are open strokes, so none of them needs a trim. */
  if(kind==="roarrow"){
    const [bx,by]=back(-s);
    const ow=w*1.18;
    const [lx,ly]=side(bx,by,ow), [rx,ry]=side(bx,by,-ow);
    return {d:`M ${lx} ${ly} L ${x2} ${y2} L ${rx} ${ry}`, fill:false};
  }
  if(kind==="harrow"||kind==="hrarrow"){
    const dir=(kind==="hrarrow")?-1:1;
    const [bx,by]=back(s*dir);
    const [lx,ly]=side(bx,by,w*1.45);   /* 6gd — and the half arrow's single barb with them */
    return {d:`M ${lx} ${ly} L ${x2} ${y2}`, fill:false};
  }
  if(kind==="slash"){
    const [ax,ay]=back(-w*0.9), [bx2,by2]=back(w*0.9);
    const [lx,ly]=side(ax,ay,w*1.1), [rx,ry]=side(bx2,by2,-w*1.1);
    return {d:`M ${lx} ${ly} L ${rx} ${ry}`, fill:false};
  }
  return null;
}
/* 6fg — how far short of the end the STROKE should stop so the ending's own shape is not blunted by
   the line's round cap. A filled head is drawn from the exact end, so the line has to give way to it;
   an open head or a plain end needs nothing. */
function endTrim(kind,size){
  /* 6fh — an ARROW's apex is the end and its body lies behind it, so the line gives way to it. A
     REVERSE arrow's apex is also the end but its body lies BEYOND it, pointing back down the line —
     trimming there left a visible gap between the stroke and the head, which is the whole of "some
     line start and line ends are not working". */
  if(kind==="arrow")return size*0.82;
  if(kind==="rarrow")return 0;
  if(kind==="diamond")return size*0.55;
  if(kind==="circle"||kind==="ocircle"||kind==="square")return size*0.35;
  return 0;
}
/* Pull the two ends of a point list back along their own last segment. */
function trimEnds(pts,e0,e1,size){
  if(pts.length<2)return pts;
  const out=pts.map(p=>[p[0],p[1]]);
  const pull=(i,j,d)=>{
    if(d<=0)return;
    const ax=out[i][0], ay=out[i][1], bx=out[j][0], by=out[j][1];
    const len=Math.hypot(ax-bx,ay-by); if(len<=d+0.01)return;
    out[i]=[ax+(bx-ax)/len*d, ay+(by-ay)/len*d];
  };
  pull(0,1,endTrim(e0,size));
  pull(out.length-1,out.length-2,endTrim(e1,size));
  return out;
}
function arrowHeadPath(x1,y1,x2,y2,size){
  const a=Math.atan2(y2-y1,x2-x1), s=Math.max(4,size);
  const w=s*0.42;
  const bx=x2-Math.cos(a)*s, by=y2-Math.sin(a)*s;
  const lx=bx-Math.sin(a)*w, ly=by+Math.cos(a)*w;
  const rx=bx+Math.sin(a)*w, ry=by-Math.cos(a)*w;
  return `M ${x2} ${y2} L ${lx} ${ly} L ${rx} ${ry} Z`;
}
/* 6gg — a measurement's reading is an ANNO, and the stroke paths repaint strokes only. When the run
   being dragged or turned is a length, the marks are laid out again after it so the reading follows the
   run live rather than a gesture later. */
function dimRelayout(l){ if(l&&l.maKind==="dim"){ try{ layoutAnnos(); }catch(e){} } }
/* =================================================================================================
   6ha — WHAT YOU ARE DRAWING IS WHAT YOU WILL GET
   -------------------------------------------------------------------------------------------------
   Ced: "all tools should refresh in realtime too, even as the shape or line or any redline is just
   being drawn, the redline, line, or shape should already be visible to the user for precise
   redlining."

   Every drawing gesture used to show a PLACEHOLDER: a hairline rubber band for a line, an arrow or a
   dimension — no head, no dash, no ripple — and a dotted selection box for a rectangle or an ellipse,
   which is not even the right shape. You drew by eye and found out what you had made on release, which
   on a drawing sheet is exactly the wrong way round: the whole point of a redline is that it lands on
   something.

   So the preview IS the mark. A ghost carries the tool's own style and is drawn by the same code that
   draws every other stroke — heads, endings, tip size, line style and pattern included — so there is
   nothing for the preview to get wrong. It lives in its own variable rather than in `S.lines`, so
   nothing that reads the document (export, autosave, the marks list, undo) can ever see it. Shapes get
   the same treatment through `ghostShape`, drawn into the page's own SVG layer in the tool's stroke,
   fill, opacity and dash.
   ================================================================================================= */
/* =================================================================================================
   6jx — A STROKE MAY BE DRAWN BY TWO CLICKS AS WELL AS BY A DRAG.
   Ced: "tools with lines should be able to be used by points. example, if you have the line tool,
   clicking once will activate it to start point and clicking the second time finishes the line to the
   end point." A drag is the quick way and is unchanged; two clicks is the accurate way, and on a
   drawing sheet at 400% it is the only comfortable one — holding a button down across a long run is
   how a line ends up a few pixels off the member it was meant to follow.
   The first click arms a start point and the live preview follows the pointer from it; the second
   click finishes the run. Clicking the same spot twice means you did not want one after all, so the
   tool goes down — which is what 6gn asked a do-nothing click to do, and is still what it does.
   Escape calls the run off at any point, as the first rung of the ladder in 6jt.
   ================================================================================================= */
/* 6l7 — a press that a drawing tool let through to the page, and the mark it landed on. Read once,
   at the pointerup that ends the same gesture, and dropped either way. */
let _toolClickOn=null;
const TOOL_CLICK_SLOP=4;               /* px: a hand is never perfectly still on a click */
window.addEventListener("pointerup",e=>{
  const c=_toolClickOn; _toolClickOn=null;
  if(!c)return;
  if(Math.abs(e.clientX-c.x)>TOOL_CLICK_SLOP||Math.abs(e.clientY-c.y)>TOOL_CLICK_SLOP)return;
  if(((S.annos||[]).length+(S.lines||[]).length)!==c.n)return;   /* it drew something after all */
  const a=(S.annos||[]).find(z=>z.id===c.id);
  if(!a||a.lock)return;
  try{ clickRunClear(true); }catch(_){}   /* a line tool armed a run on the way past; call it off */
  selNotFromDraw();                       /* 6l1 — this selection did not come from drawing */
  if(S.mode!=="select")setMode("select");
  if(a.group!=null&&typeof selectGroup==="function"&&!groupOpenIs(a.group))selectGroup(a.group);
  else selectAnno(a.id);
  setStatus("Picked up — the tool is down. Pick it up again to keep drawing.");
},true);
let _clickRun=null;      /* {page,mode,x,y} — a start point waiting for its end */
function clickRunActive(){ return !!_clickRun; }
function clickRunClear(quiet){
  if(!_clickRun)return false;
  const pi=_clickRun.page; _clickRun=null;
  try{ ghostClear(); }catch(e){}
  try{ if(pageRendered(pi))drawPageLines(pi); }catch(e){}
  try{ lenHUDHide(lenHUD()); }catch(e){}
  if(!quiet)setStatus("Start point dropped.");
  return true;
}
function clickRunArm(pi,mode,x,y){
  _clickRun={page:pi,mode,x,y};
  try{ _ghost=ghostStroke(pi,mode,x,y,x,y); if(pageRendered(pi))drawPageLines(pi); }catch(e){}
  setStatus("Start point set — click again to finish, or press Escape to call it off.");
}
let _ghost=null;                       /* a stroke being drawn, in its real style */
let _ghostShape=null;                  /* {page,kind,x1,y1,x2,y2} — a box or an ellipse being dragged */
function ghostClear(){
  const had=_ghost||_ghostShape;
  const pi=(_ghost&&_ghost.page)!=null?_ghost.page:(_ghostShape&&_ghostShape.page);
  _ghost=null; _ghostShape=null;
  if(had&&pi!=null&&pageRendered(pi)){ try{ drawPageLines(pi); }catch(e){} }
}
/* the tool in your hand, as a stroke object the renderer understands */
function ghostStroke(pi,mode,x1,y1,x2,y2){
  let st={};
  try{ st=maStyleNow()||{}; }catch(e){}
  const base={id:-1,page:pi,ghost:true,x1:x1,y1:y1,x2:x2,y2:y2,
              col:st.col||($("#c_text")&&$("#c_text").value)||"#fa3237",
              sw:(st.sw!=null?st.sw:parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5)),
              colOp:st.colOp, dash:st.dash, lpat:st.lpat, hl:st.hl, leSz:st.leSz};
  if(mode==="arrow"){ base.le0=(st.le0!=null?st.le0:""); base.le1=(st.le1!=null?st.le1:"arrow"); }
  else if(mode==="dim"){ base.maKind="dimghost"; base.le0=(st.le0!=null?st.le0:"arrow");
                         base.le1=(st.le1!=null?st.le1:"arrow"); }
  else if(mode==="callout"){ base.le0=(st.le0!=null?st.le0:""); base.le1=(st.le1!=null?st.le1:"arrow"); }
  else { base.le0=st.le0; base.le1=st.le1; }
  return base;
}
function ghostMove(x2,y2){
  if(!_ghost)return;
  _ghost.x2=x2; _ghost.y2=y2; _ghost.pts=null;
  if(pageRendered(_ghost.page))drawPageLines(_ghost.page);
}
function ghostShapeMove(pi,kind,x1,y1,x2,y2){
  _ghostShape={page:pi,kind:kind,x1:x1,y1:y1,x2:x2,y2:y2};
  if(pageRendered(pi))drawPageLines(pi);
}
/* the box or the ellipse, in the tool's own colours, painted into the page's stroke layer */
function paintGhostShape(svg,w,h){
  const g=_ghostShape; if(!g)return;
  let st={}; try{ st=maStyleNow()||{}; }catch(e){}
  const NS="http://www.w3.org/2000/svg";
  const x1=Math.min(g.x1,g.x2)*w, y1=Math.min(g.y1,g.y2)*h;
  const bw=Math.abs(g.x2-g.x1)*w, bh=Math.abs(g.y2-g.y1)*h;
  if(bw<1||bh<1)return;
  const sw=Math.max(0.22,(st.sw!=null?st.sw:1.5)*S.scale);
  const mk=(tag,attrs)=>{ const n=document.createElementNS(NS,tag);
    for(const k in attrs)n.setAttribute(k,attrs[k]); n.style.pointerEvents="none"; return n; };
  const attrs={fill:(st.fill&&st.fillOp>0)?_rgbaOf(st.fill,st.fillOp):"none",
               stroke:_rgbaOf(st.col||"#fa3237",(st.colOp!=null?st.colOp:1)),
               "stroke-width":sw};
  const dsh=dashCss(st,sw);
  if(dsh){ attrs["stroke-dasharray"]=dsh;
           attrs["stroke-linecap"]=dashRound(st.dash||"solid")?"round":"butt"; }
  if(g.kind==="ellipse")
    svg.appendChild(mk("ellipse",Object.assign({cx:x1+bw/2,cy:y1+bh/2,
      rx:Math.max(0.5,bw/2-sw/2),ry:Math.max(0.5,bh/2-sw/2)},attrs)));
  else
    svg.appendChild(mk("rect",Object.assign({x:x1+sw/2,y:y1+sw/2,
      width:Math.max(1,bw-sw),height:Math.max(1,bh-sw)},attrs)));   /* 6hk — square, as it exports */
}
function drawPageLines(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg||pg.dataset.rendered!=="1")return;
  /* a callout's leader answers to its box and its point; this is the one place that has to be true */
  try{ maSyncCallouts(); }catch(e){}
  /* 6gb — and a strike & write's rule answers to its text box the same way */
  try{ maSyncStrikes(); }catch(e){}
  /* 6gg — and a length's reading is re-measured off its own two ends */
  try{ maSyncDims(); }catch(e){}
  const svg=pg.querySelector("svg.draw:not(.under):not(.ingroup)"); if(!svg)return;
  const svgUnder=pg.querySelector("svg.draw.under");
  [...svg.querySelectorAll("*")].forEach(n=>n.remove());
  if(svgUnder)[...svgUnder.querySelectorAll("*")].forEach(n=>n.remove());
  /* 6ir — and the group layers too. `layoutAnnos` builds those containers fresh, but a redraw during
     a drag comes through here on its own, and a group SVG that was not cleared collected a second
     copy of every stroke in it — visible as doubled handles on a callout's leader. */
  [...pg.querySelectorAll("svg.draw.ingroup")].forEach(gs=>{
    [...gs.querySelectorAll("*")].forEach(n=>n.remove()); });
  /* ================================================================================================
     6ln — A STROKE GOES WHERE ITS z PUTS IT, AMONG THE MARKS.
     The two band SVGs stay — the ghost, the shape preview and the start-point marker all belong to
     whatever is being drawn right now and are always on top of their band — but a REAL stroke is drawn
     into a run layer inside the mark layer, so a z-index can put it between two marks.

     One SVG per unbroken run of strokes in the band's order, not one per stroke: a drawing is made in
     bursts, so the runs are few. Measured on the fixture's busiest page the count is in single
     figures, and a run with nothing in it is never created.
     ================================================================================================ */
  [...pg.querySelectorAll("svg.draw.run")].forEach(n=>n.remove());
  /* ================================================================================================
     6lp — A SELECTED STROKE'S HANDLES ARE ALWAYS ON TOP.
     Ced: "the blue dragger of the line is not visible as it rests below the redline."
     The point handles and the rotate / move / delete grips were drawn into the stroke's own layer, so
     a stroke deliberately sitting under a mark had its controls under that mark too — and a control
     you cannot see is a control you do not have. A MARK's furniture has lived in `.annoui`, above
     every band, since 6is; a stroke's belongs there for the same reason. Where the stroke sits in the
     stack is a decision about the drawing; where its handles sit is not.
     ================================================================================================ */
  let _uiSvg=null;
  const uiLayer=()=>{
    if(_uiSvg)return _uiSvg;
    const host=pg.querySelector(".annoui"); if(!host)return svg;
    _uiSvg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    _uiSvg.setAttribute("class","draw selui");
    const _w0=svg.getAttribute("width"), _h0=svg.getAttribute("height");
    if(_w0)_uiSvg.setAttribute("width",_w0);
    if(_h0)_uiSvg.setAttribute("height",_h0);
    host.appendChild(_uiSvg);
    return _uiSvg;
  };
  [...pg.querySelectorAll(".annoui > svg.draw.selui")].forEach(n=>n.remove());
  const _runOf=new Map();
  try{
    const SVGNS="http://www.w3.org/2000/svg";
    const _w=svg.getAttribute("width"), _h=svg.getAttribute("height");
    [true,false].forEach(u=>{
      const host=pg.querySelector(u?".annolayer-under":".annolayer");
      if(!host)return;
      const items=bandList(i,u).filter(o=>!maLayerHidden(o))
        .map(o=>({z:o.z||0, line:(layerColl(o)===S.lines), o}))
        .sort((p,q)=>(p.z-q.z));
      let cur=null;
      items.forEach(it=>{
        if(!it.line){ cur=null; return; }           /* a mark breaks the run */
        if(it.o.group!=null&&!it.o.ghost)  { cur=null; return; }  /* grouped strokes have their own */
        if(!cur){
          cur=document.createElementNS(SVGNS,"svg");
          cur.setAttribute("class","draw run"+(u?" under":""));
          if(_w)cur.setAttribute("width",_w);
          if(_h)cur.setAttribute("height",_h);
          cur.style.zIndex=String(it.z);
          host.appendChild(cur);
        }
        _runOf.set(it.o.id,cur);
      });
    });
  }catch(e){}
  /* 6ia/6ln — the run this stroke belongs in, or its band's own layer for anything transient */
  const layerFor=l=>(l&&l.id!=null&&_runOf.get(l.id))||((l&&l.under&&svgUnder)?svgUnder:svg);
  const w=pg.offsetWidth,h=pg.offsetHeight,defCol=$("#c_text").value;
  /* 6ha — the ghost rides the same pass as the real strokes, so it is drawn by the same code */
  const _draws=S.lines.filter(l=>l.page===i&&!maLayerHidden(l));   /* 6jc — hidden layers stay off */
  if(_ghost&&_ghost.page===i)_draws.push(_ghost);
  try{ paintGhostShape(svg,pg.offsetWidth,pg.offsetHeight); }catch(e){}
  /* ================================================================================================
     6lm — A START POINT YOU CAN SEE.
     Ced: "show the first point of a line if only inserted by click and not dragging."
     `clickRunArm` already builds a ghost — but from (x,y) to (x,y), which is a stroke of zero length
     and draws nothing at all. Until the hand moves and the ghost is stretched to the pointer, the
     only sign that a start point had been taken was a line in the status bar, so a click that landed
     and a click that missed looked exactly alike.
     It is drawn here rather than as part of the ghost because it is not a stroke: it is a mark of
     where the run began, in the stroke's own colour, and it has to stay put while the ghost swings
     about. Two circles — a filled core and a white ring round it — so it reads on ink and on paper
     alike, at a size that does not pretend to be part of the drawing.
     ================================================================================================ */
  try{
    if(_clickRun&&_clickRun.page===i){
      const cx=_clickRun.x*w, cy=_clickRun.y*h;
      const col=(_ghost&&_ghost.col)||defCol||"#fa3237";
      const ring=document.createElementNS("http://www.w3.org/2000/svg","circle");
      ring.setAttribute("cx",cx); ring.setAttribute("cy",cy); ring.setAttribute("r",5.5);
      ring.setAttribute("fill","none"); ring.setAttribute("stroke","#ffffff");
      ring.setAttribute("stroke-width",2); ring.setAttribute("opacity",".95");
      ring.setAttribute("pointer-events","none");
      const dot=document.createElementNS("http://www.w3.org/2000/svg","circle");
      dot.setAttribute("cx",cx); dot.setAttribute("cy",cy); dot.setAttribute("r",3.5);
      dot.setAttribute("fill",col); dot.setAttribute("pointer-events","none");
      svg.appendChild(ring); svg.appendChild(dot);
    }
  }catch(e){}
  /* 6ia — bottom to top inside each layer, by the stroke's own z */
  _draws.sort((p1,q1)=>((p1.z||0)-(q1.z||0))||(S.lines.indexOf(p1)-S.lines.indexOf(q1)));
  _draws.forEach(l=>{
    /* 6ia — every element of this stroke goes into the layer its band names.
       6ir — unless it belongs to a GROUP, in which case it goes into that group's own container, in
       an SVG of its own, so the group is one thing in the stack. The container was made by
       `layoutAnnos`, which is why the strokes are drawn after the marks. */
    let svg=layerFor(l);
    const _gk=(l.ghost?null:groupKeyOf(l));
    if(_gk){
      const host=pg.querySelector(
        `.annolayer${l.under?"-under":""} > .annogroup[data-gk="${_gk}"]`);
      if(host){
        let gs=host.querySelector(":scope > svg.draw.ingroup");
        if(!gs){
          gs=document.createElementNS("http://www.w3.org/2000/svg","svg");
          /* 6ix — `ingroup`, NOT `grp`. The ribbon's own groups are `<div class="grp">`, styled with
             `padding:1px 9px; border-right:1px dotted`, and an SVG is as welcome to that rule as a div
             is: the padding moved the group layer's coordinate origin nine pixels to the right, so
             every stroke inside a group — a callout's leader above all — was drawn nine pixels off the
             box it belongs to. On the left of a box the leader ran into it; on the right it stopped
             short of it. That is exactly what Ced's two pictures show, and it was a class name. */
          gs.setAttribute("class","draw ingroup");
          /* 6ir — the SAME viewport the band layer has, to the fraction. The band SVG is sized from
             the pdf.js viewport (734.4pt, say) and this one was sized from `offsetWidth` (734), and
             two SVGs of different widths lying over the same page do not put a given user coordinate
             in the same place — the group's strokes came out some nine points to the side of where
             the band's did. A `viewBox` on both pins the mapping explicitly rather than leaving it to
             how each element's width happened to be rounded. */
          gs.setAttribute("width",svg.getAttribute("width")||w);
          gs.setAttribute("height",svg.getAttribute("height")||h);
          /* the strokes sit under the group's own marks, which is where a leader belongs */
          host.insertBefore(gs,host.firstChild);
        }
        svg=gs;
      }
    }
    /* 6g9 — a callout's leader is part of its box: it carries its handles whenever the box is
       selected, and it never shows a stroke bar of its own. */
    const coOwned=(l.coFor!=null&&S.sel===l.coFor);
    /* 6ha — a ghost is a picture of a mark, not a mark: it takes no hit area, no halo and no handles */
    const ghost=!!l.ghost;
    const sel=!ghost&&(S.selLine===l.id||coOwned) && !S.selMultiL.has(l.id);
    const mk=(tag,attrs)=>{ const n=document.createElementNS("http://www.w3.org/2000/svg",tag); for(const k in attrs)n.setAttribute(k,attrs[k]); return n; };
    const pts=linePts(l).map(p=>[p[0]*w,p[1]*h]);
    const col=l.col||defCol;
    /* 6gt — Ced: "thickness less than 1 pt is not working properly." It was the clamp on the next
       line: the POINT value was floored at 0.5 before the zoom was applied, so a 0.25pt rule drew as a
       0.5pt one on screen and exported at the 0.25pt it was actually set to — the screen and the file
       disagreed, and two different settings looked identical. The weight is taken as it is now, and the
       only floor left is a fraction of a screen pixel, so a hairline is faint rather than absent. */
    const sw=Math.max(0.22,(l.sw!=null?l.sw:1.4)*S.scale);
    /* 6f6 — the drawn path may ripple; the HANDLES stay on the corners it was drawn with.
       6fg — and it stops short of a filled ending, so the cap does not blunt the point. */
    const dpts=decoratePts(l,pts,sw);
    const _e=endsOf(l), _hd=headSizeOf(l,sw,S.scale);  /* 6gf/6gj — in page units, at its own tip size */
    const poly=trimEnds(dpts,_e[0],_e[1],_hd).map(p=>p[0].toFixed(2)+","+p[1].toFixed(2)).join(" ");
    /* a wide invisible stroke on the same path, so it can be grabbed anywhere along it */
    const hit=mk("polyline",{points:poly,fill:"none",stroke:"transparent","stroke-width":Math.max(14,sw+10),
                             "data-lid":String(l.id)});   /* 6gc — what the eraser and the painter hit */
    if(ghost)hit.style.display="none";
    /* 6je — a flattened stroke is part of the page: nothing to grab hold of any more */
    if(l.flat)hit.style.display="none";
    hit.style.pointerEvents="stroke"; hit.style.cursor="move";
    hit.addEventListener("pointerdown",ev=>{ ev.stopPropagation();
      if(ev.shiftKey||ev.ctrlKey||ev.metaKey){ toggleMultiLine(l.id); return; }          // add/remove from the selection
      if(S.selMultiL.has(l.id)){ dragMulti(ev,pg); return; }                             // already selected → move the whole selection
      /* 6jz — grouped → the group moves as one, UNLESS the group is open, in which case this one
         stroke is what you have hold of */
      if(l.group!=null&&!groupOpenIs(l.group)){ selectGroup(l.group); dragMulti(ev,pg); return; }
      /* 6g9 — a callout's leader belongs to its box: clicking it selects the CALLOUT, and dragging
         the leader's body moves box and leader together, as one mark. */
      if(l.coFor!=null){ const b=maCalloutBoxOf(l);
        if(b){ selectAnno(b.id);
               const d=document.querySelector(`.anno[data-id="${b.id}"]`);
               if(d){ dragBody(ev,d,b,pg); return; } } }
      selectLine(l.id); startLineDrag(ev,l,"move",pg); });
    /* 6jz — and a stroke inside a group is reached the same way a mark is */
    hit.addEventListener("dblclick",ev=>{
      if(l.group==null||groupOpenIs(l.group))return;
      ev.preventDefault(); ev.stopPropagation();
      groupEnter(l.group); selectLine(l.id);
    });
    svg.appendChild(hit);
    if(S.selMultiL.has(l.id)){
      const halo=mk("polyline",{points:poly,fill:"none",stroke:"#ffb02e","stroke-width":Math.max(6,sw+4),
                                "stroke-linecap":"round","stroke-linejoin":"round",opacity:.55});
      halo.style.pointerEvents="none"; svg.appendChild(halo);
    }
    const lnAttrs={points:poly,fill:"none",stroke:col,
                   "stroke-width":sw*(sel?1.25:1),
                   "stroke-linecap":capCss(l),"stroke-linejoin":joinCss(l),"stroke-miterlimit":8};
    /* 6f6 — the line style and the ink's own opacity, both straight off the mark */
    /* a dotted rule is a zero-length dash with a ROUND cap — with a butt cap it draws nothing at all */
    const dsh=dashCss(l,sw);
    if(dsh){ lnAttrs["stroke-dasharray"]=dsh;
             lnAttrs["stroke-linecap"]=dashRound((l&&l.dash)||"solid")?"round":"butt"; }
    const lop=markColOp(l); if(lop<1)lnAttrs.opacity=lop;
    /* 6g1 — a closed run is filled first, under its own rule */
    if(l.closed){
      const fillAttrs={points:poly, fill:_rgbaOf(l.fill||"#ffffff",(l.fillOp!=null?l.fillOp:1)),
                       stroke:"none"};
      const fl=mk("polygon",fillAttrs); fl.style.pointerEvents="none";
      if(l.hl)fl.style.mixBlendMode="multiply";
      svg.appendChild(fl);
      if(patOf(l)){
        /* the hatch, clipped to the run, as one overlay drawn from the same generator the shapes use */
        const cid="clip"+l.id;
        const cp=document.createElementNS("http://www.w3.org/2000/svg","clipPath");
        cp.setAttribute("id",cid);
        const cpoly=mk("polygon",{points:poly}); cp.appendChild(cpoly); svg.appendChild(cp);
        const g=document.createElementNS("http://www.w3.org/2000/svg","g");
        g.setAttribute("clip-path","url(#"+cid+")"); g.style.pointerEvents="none";
        const xs=dpts.map(p=>p[0]), ys=dpts.map(p=>p[1]);
        const bx=Math.min(...xs), by=Math.min(...ys);
        patSegments(l,Math.max(1,Math.max(...xs)-bx),Math.max(1,Math.max(...ys)-by)).forEach(sg=>{
          g.appendChild(mk("line",{x1:bx+sg[0],y1:by+sg[1],x2:bx+sg[2],y2:by+sg[3],
            stroke:_rgbaOf(patColOf(l),patOpOf(l)),
            "stroke-width":Math.max(patIsDot(l)?1.1:0.6,sw*(patIsDot(l)?0.8:0.5)),
            "stroke-linecap":patIsDot(l)?"round":"butt"}));
        });
        svg.appendChild(g);
      }
    }
    const ln=mk("polyline",lnAttrs);
    ln.style.pointerEvents="none";
    if(l.hl)ln.style.mixBlendMode="multiply";      /* highlight mode: the page reads through the ink */
    svg.appendChild(ln);
    /* 6jd — a stroke on its way somewhere wears the ants along its own path */
    if(S.cutL&&S.cutL.has(l.id)){
      const ants=mk("polyline",{points:poly,fill:"none",stroke:"#ffffff",
                                "stroke-width":Math.max(1.4,sw+1.6),"stroke-linecap":"round"});
      ants.setAttribute("class","cutants");
      ants.style.pointerEvents="none";
      svg.appendChild(ants);
      const ants2=mk("polyline",{points:poly,fill:"none",stroke:"#111418",
                                 "stroke-width":Math.max(1.4,sw+1.6),"stroke-linecap":"butt"});
      ants2.setAttribute("class","cutants b");
      ants2.style.pointerEvents="none";
      svg.appendChild(ants2);
    }
    /* the endings, one per end */
    /* 6gd — Ced, on a callout's leader: "especially on this type of arrowhead". A leader is drawn at a
       point or two, and a head of 3.2× a 1pt rule is a seven-pixel sliver at the end of a long line —
       it reads as a taper rather than an arrow. The floor and the multiplier both go up, so a thin
       rule still ends in a head you can see across a drawing sheet. */
    const headSize=headSizeOf(l,sw,S.scale);
    const [e0,e1]=endsOf(l), n=pts.length;
    const putEnd=(kind,fx,fy,tx,ty)=>{
      const sp=endShapePath(kind,fx,fy,tx,ty,headSize); if(!sp)return;
      const hd=mk("path",sp.fill?{d:sp.d,fill:col,stroke:"none"}
                                :{d:sp.d,fill:"none",stroke:col,"stroke-width":sw,
                                  "stroke-linecap":"round","stroke-linejoin":"round"});
      hd.style.pointerEvents="none";
      if(lop<1)hd.setAttribute("opacity",lop);
      if(l.hl)hd.style.mixBlendMode="multiply";
      svg.appendChild(hd);
    };
    putEnd(e1,pts[n-2][0],pts[n-2][1],pts[n-1][0],pts[n-1][1]);
    putEnd(e0,pts[1][0],pts[1][1],pts[0][0],pts[0][1]);
    if(sel){
      /* one handle per point: an end of a strike, or any corner of a leader. A callout's leader is the
         exception only at its FIRST point — that one is where the leader leaves its box and is worked
         out from the box, so it carries no handle. The elbow and the tip both do. */
      const boxEnd=(l.maKind==="calloutleader");
      pts.forEach((p,k)=>{
        if(boxEnd&&k===0)return;
        const c=mk("circle",{cx:p[0],cy:p[1],r:6,fill:selInk(),stroke:"#fff","stroke-width":2});
        c.style.pointerEvents="all"; c.style.cursor="move";
        c.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); selectLine(l.id); startLineDrag(ev,l,"pt"+k,pg); });
        uiLayer().appendChild(c);        /* 6lp — above every band, not in the stroke's own layer */
      });
      /* 6g9 — A STROKE GETS THE SAME TWO GRIPS A MARK HAS.
         Ced: "all shapes, texts, and items should have drag and rotate on them when selected." A
         selected line, arrow, polyline or strike had corner handles and nothing else: it could be
         moved only by grabbing the rule itself, and turned not at all. The two buttons below it are
         the same pair a box carries — ✥ moves the whole stroke, ↻ turns it about its own centre with
         the degree readout and the 15° snap. A callout's leader is the exception: it is part of its
         box and takes the box's grips. */
      if(!boxEnd){
        const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
        const bcx=(Math.min(...xs)+Math.max(...xs))/2, bby=Math.max(...ys);
        /* 6ha — AND THE THIRD GRIP. Ced: "make all redline tools have the drag, rotate, and X button."
           A mark has all three; a stroke had two, and its delete lived in a floating bar — a different
           place to look for the same thing. They sit in a row now, each with a 30px invisible target
           round it so a fingertip finds it as easily as a pointer does. */
        /* 6m6 — the same three controls a mark and a group carry, in the same grey, at the same
           size. The colours come off the `--ctl-*` tokens through `svg.draw.selui .lgrip` in app.css
           rather than being written here, so one edit moves all three kinds of selection at once. */
        const grip=(dx,glyph,title,onDown,danger)=>{
          const g=mk("g",{class:"lgrip"+(danger?" danger":"")});
          const hit=mk("circle",{cx:bcx+dx,cy:bby+26,r:15,class:"lg-hit"});
          const c=mk("circle",{cx:bcx+dx,cy:bby+26,r:10,class:"lg-ring"});
          const t=mk("text",{x:bcx+dx,y:bby+30,"text-anchor":"middle","font-size":12,class:"lg-ink"});
          t.textContent=glyph;
          const ttl=mk("title",{}); ttl.textContent=title;
          g.appendChild(hit); g.appendChild(c); g.appendChild(t); g.appendChild(ttl);
          g.style.pointerEvents="all"; g.style.cursor=(glyph==="\u21bb")?"grab":(danger?"pointer":"move");
          g.style.touchAction="none";
          g.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); onDown(ev); });
          uiLayer().appendChild(g);      /* 6lp */
        };
        grip(-26,"\u21bb","Rotate — the angle is shown as you turn it",ev=>startLineRotate(ev,l,pg));
        grip(0,"\u2725","Drag to move this stroke",ev=>startLineDrag(ev,l,"move",pg));
        grip(26,"\u2715","Delete this mark",ev=>{
          ev.preventDefault();
          /* through the selection, so a measurement or a cross-out goes whole */
          try{ selectLine(l.id); deleteSelection(); setStatus("Deleted."); }catch(e){}
        },true);
      }
      if(!coOwned)positionLineBar(l,pg);
    }
  });
}
/* 6g9 — turn a whole stroke about its own centre. The maths is done in PAGE PIXELS and converted
   back, so a rotation looks like a rotation on a sheet that is taller than it is wide. Snap settles it
   on the nearest 15°, Shift forces the step, Ctrl turns freely — the same three rules the marks use. */
function startLineRotate(ev,l,pg){
  if(l&&l.lock){ try{toast("This stroke is locked");}catch(_){ } return; }
  ev.preventDefault();
  /* 6hb — the same as a mark's grip: drag to turn it by eye, click to type the angle. A stroke has no
     angle of its own, so what is typed is how far to turn it from where it is. */
  const _rx=ev.clientX, _ry=ev.clientY; let _turned=false;
  pushHistory();
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const o=linePts(l).map(p=>[p[0],p[1]]);
  const cx=o.reduce((s,p)=>s+p[0],0)/o.length, cy=o.reduce((s,p)=>s+p[1],0)/o.length;
  const r=pg.getBoundingClientRect();
  const ccx=r.left+cx*w, ccy=r.top+cy*h;
  const a0=Math.atan2(ev.clientY-ccy,ev.clientX-ccx);
  const hud=degHUD();
  /* 6lx — a stroke has no box element, so its extent is measured off its own points: the cross hugs
     the stroke the same way it hugs a mark, rather than reaching across the page. */
  try{
    const _xs=o.map(p=>p[0]), _ys=o.map(p=>p[1]);
    const _bw=(Math.max(..._xs)-Math.min(..._xs))*w, _bh=(Math.max(..._ys)-Math.min(..._ys))*h;
    rotGuideOpen(pg,ccx,ccy,{bw:Math.max(8,_bw),bh:Math.max(8,_bh)});
  }catch(_){}
  const move=e=>{
    if(!_turned){ if(Math.hypot(e.clientX-_rx,e.clientY-_ry)<=DRAG_SLOP)return; _turned=true; }
    let deg=(Math.atan2(e.clientY-ccy,e.clientX-ccx)-a0)*180/Math.PI;
    let caught=false;
    if(!(e.ctrlKey||e.metaKey)){
      const step=SNAP_DEG_STEP, near=Math.round(deg/step)*step;
      if(e.shiftKey||(S.snap&&Math.abs(deg-near)<=SNAP_DEG)){ deg=near; caught=true; }
    }
    const t=deg*Math.PI/180, cs=Math.cos(t), sn=Math.sin(t);
    const np=o.map(p=>{ const px=(p[0]-cx)*w, py=(p[1]-cy)*h;
      return [cx+(px*cs-py*sn)/w, cy+(px*sn+py*cs)/h]; });
    l.pts=np;
    l.x1=np[0][0]; l.y1=np[0][1];
    l.x2=np[np.length-1][0]; l.y2=np[np.length-1][1];
    drawPageLines(l.page); dimRelayout(l);
    /* 6lu — a stroke turns BY an amount rather than TO an angle, so the change is the reading that
       means something here and it is the one shown; the guide is the same for both. */
    try{ rotGuideTo(e.clientX,e.clientY); rotGuideSpin(deg); }catch(_){}   /* 6lx */
    degHUDShow(hud,-deg,caught,ccx,ccy,-deg);
  };
  const up=()=>{ degHUDHide(hud); try{ rotGuideClose(); }catch(_){}   /* 6lu */ window.removeEventListener("pointermove",move);
                 window.removeEventListener("pointerup",up);
    if(!_turned){
      /* 6mt — the same chip a mark gets, placed on the stroke's own box */
      angleChipOpen(null,null,pg,{
        rect:(()=>{ try{ const n=document.querySelector('svg.draw.selui');
          if(n){ const bb=n.getBoundingClientRect(); if(bb.width||bb.height)return bb; } }catch(e){}
          return {left:cx-40,top:cy-12,right:cx+40,bottom:cy+12,width:80,height:24}; })(),
        now:0,
        apply:v=>{ rotateLineBy(l,v,pg); drawPageLines(l.page); dimRelayout(l);
          autosave&&autosave(); setStatus("Turned "+(Math.round(v*10)/10)+"\u00b0."); }});
      return;
    }
    autosave&&autosave(); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
let _ldrag=null;
function startLineDrag(ev,l,mode,pg){
  selNotFromDraw();                    /* 6l1 — a stroke picked up is not a stroke drawn */
  if(l&&l.lock){ try{toast("This stroke is locked");}catch(_){ } return; }   /* 6fb */
  ev.preventDefault();
  /* 6gt — as with a mark: the snapshot is taken now, and put on the stack the moment the stroke
     actually moves. A click on a stroke leaves it, and the history, exactly as they were. */
  _ldrag={id:l.id,mode,pg,cx:ev.clientX,cy:ev.clientY,o:linePts(l).map(p=>[p[0],p[1]]),
          pre:snapshot(),moved:false};
  adjustBegin(null);                     /* 6mn — a stroke has grips too, and they are in the way */
  try{pg.setPointerCapture(ev.pointerId);}catch(e){}
}
window.addEventListener("pointermove",e=>{
  if(!_ldrag)return; const l=S.lines.find(x=>x.id===_ldrag.id); if(!l)return;
  if(!_ldrag.moved){
    if(Math.hypot(e.clientX-_ldrag.cx,e.clientY-_ldrag.cy)<=DRAG_SLOP)return;
    _ldrag.moved=true;
    S.history.push(_ldrag.pre); if(S.history.length>80)S.history.shift();
    S.future=[]; updateUndoUI();
  }
  const w=_ldrag.pg.offsetWidth,h=_ldrag.pg.offsetHeight;
  const dx=(e.clientX-_ldrag.cx)/w, dy=(e.clientY-_ldrag.cy)/h;
  const o=_ldrag.o;
  let pts;
  if(_ldrag.mode==="move")pts=o.map(p=>[p[0]+dx,p[1]+dy]);
  else{
    const k=parseInt(String(_ldrag.mode).replace("pt",""),10);
    pts=o.map(p=>[p[0],p[1]]);
    if(!(k>=0&&k<pts.length))return;
    /* Shift keeps a two-point stroke level, which is what a strike through a printed value wants */
    pts[k]=[o[k][0]+dx,(e.shiftKey&&pts.length===2)?o[k][1]:o[k][1]+dy];
    /* 6f9 — and the MAGNET pulls that one point onto the nearest printed or drawn line, which is what
       puts a leader's tip exactly on the member it points at. Ctrl holds it off for one drag. */
    if(!snapOff(e)){
      const m=magnetPoint(_ldrag.pg,pts[k][0],pts[k][1]);
      pts[k]=[m.nx,m.ny];
      drawSnapGuides(_ldrag.pg,m.gx,m.gy,false,false);
    }
    else clearSnapGuides(_ldrag.pg);
  }
  /* 6ga — dragging a CALLOUT's elbow does not move a point: it sets the two numbers the leader keeps,
     where along the side it leaves the box and how far it stands off. The side belongs to the arrow,
     so the stub stays square-on and on the side the arrow is on however the elbow is pulled about. */
  if(l.coFor!=null&&_ldrag.mode==="pt1"){
    const box=maCalloutBoxOf(l);
    if(box){
      /* 6ha — a turned box is read in its own frame, here as in the draw pass */
      const tip=maRotPt(box,pts[pts.length-1],-1);
      const elb=maRotPt(box,pts[1],-1);
      const side=maCalloutSide(box,tip[0],tip[1]);
      const v=maCalloutFromElbow(box,side,elb[0],elb[1]);
      l.coOff=v.off; l.coLen=v.len;
      drawPageLines(l.page);
      return;
    }
  }
  if(pts.length>2||l.pts)l.pts=pts;
  l.x1=pts[0][0]; l.y1=pts[0][1];
  l.x2=pts[pts.length-1][0]; l.y2=pts[pts.length-1][1];
  drawPageLines(l.page); dimRelayout(l);
});
window.addEventListener("pointerup",()=>{ if(_ldrag){ try{clearSnapGuides(_ldrag.pg);}catch(_){}
  const did=_ldrag.moved; _ldrag=null; dropSnapCache();
  if(did){ try{ autosave(); }catch(_){} } } });
function selectLine(id){ S.selLine=id; if(id!=null){ selectAnno(null); clearMulti(); } S.pages.forEach((_,i)=>{ if(pageRendered(i))drawPageLines(i); }); if(id==null)$("#linebar").classList.remove("show"); }
/* 6gc — and a STROKE's bar clears the stroke, the same way. It used to be placed off the first point
   and the middle one, which on a leader that rises to the right put it straight over the line. */
function positionLineBar(l,pg){
  const bar=$("#linebar"); const r=pg.getBoundingClientRect();
  const p=linePts(l), w=pg.offsetWidth, h=pg.offsetHeight;
  const xs=p.map(q=>r.left+q[0]*w), ys=p.map(q=>r.top+q[1]*h);
  const top0=Math.min(...ys), bot=Math.max(...ys);
  const bh=bar.offsetHeight||34;
  let top=top0-bh-16;                                   /* clear of the end handles, which are r=6 */
  if(top<8)top=bot+18;
  fitFloatingBar(bar,Math.max(8,Math.min(...xs)-14),top);
}

/* ---------- text annotations ---------- */
/* measure text width in normalized page units (deterministic — no DOM/zoom dependence) */
let _measCtx=null;
function measureTextNorm(text,sizePt,pageIdx,fontKey,lsp){
  const P=S.pages[pageIdx]; if(!P||!P.w1)return 0;
  if(!_measCtx){ _measCtx=document.createElement("canvas").getContext("2d"); }
  const F=MARK_FONTS[fontKey]||MARK_FONTS[markFontKey(null)];
  _measCtx.font=(F.style?F.style+" ":"")+(F.weight?F.weight+" ":"")+sizePt+"px "+F.css;
  const t=String(text==null?"":text);
  /* 6he — tracking is part of the width. The browser adds it after EVERY glyph, the last one too,
     which is also what the `Tc` operator does, so the two agree without a special case. */
  const wpx=_measCtx.measureText(t).width+((lsp||0)*t.length);
  return wpx/P.w1;
}
/* 6hi — WHERE THE BROWSER PUTS THE BASELINE, measured rather than guessed.
   A CSS line box of height L holds the font's content box — ascent plus descent — centred in it, and
   the baseline sits one ascent below the top of that content box. The export used to approximate the
   result as a flat fraction of the line height, which is right for one size and one face and drifts
   for every other: a 13pt bold heading came out nearly two points higher in the file than on screen.
   The canvas reports the very metrics the layout used, so the file can place the baseline exactly
   where the screen does, at any size, in any face, at any leading. Everything here is in points, which
   is what a mark's own numbers are in. Returns the baseline's height ABOVE the line box's bottom. */
let _baseProbe=null, _baseMemo={};
function cssBaseline(sizePt,fontKey,lineH){
  const L=(lineH>0)?lineH:sizePt*1.22;
  const key=fontKey+"|"+sizePt.toFixed(3)+"|"+L.toFixed(3);
  if(_baseMemo[key]!=null)return _baseMemo[key];
  /* The canvas reports a font's BOUNDING BOX, which is not what CSS lays a line out with — the two
     disagree by a point at heading sizes, and that point is visible. So the browser is asked to lay
     the line out for real: a strut of zero height sits with its bottom on the baseline, and where it
     lands IS the baseline. Everything is set in px at the mark's own point size, so what comes back
     is already in points. Memoised per face, size and pitch; a handful of entries per document. */
  let out=L-((L-(sizePt*1.117))/2+sizePt*0.905);     /* Helvetica's own, as the fallback */
  try{
    if(!_baseProbe){
      _baseProbe=document.createElement("div");
      _baseProbe.setAttribute("aria-hidden","true");
      _baseProbe.style.cssText="position:absolute;left:-9999px;top:0;visibility:hidden;"+
        "white-space:pre;padding:0;margin:0;border:0";
      _baseProbe.innerHTML='<span class="bp-t">Hxg</span><i class="bp-s" '+
        'style="display:inline-block;width:0;height:0;vertical-align:baseline"></i>';
      document.body.appendChild(_baseProbe);
    }
    const F=MARK_FONTS[fontKey]||MARK_FONTS[markFontKey(null)];
    _baseProbe.style.fontFamily=F.css;
    _baseProbe.style.fontWeight=F.weight||"400";
    _baseProbe.style.fontStyle=F.style||"normal";
    /* =============================================================================================
       6l4 — ASK THE QUESTION BIG, THEN DIVIDE. Ced: "please make sure the redlines are rendered
       exactly how it was showing on the tool."

       This probe used to be set at `sizePt + "px"` — the mark's point size read as a pixel count. On
       a COP stamp's rows that is 4.73px, and a baseline resolved inside a 5.8px line box rounds by
       about half a pixel, which is half a POINT of the finished mark. v38 found exactly this and
       fixed it in the stamp's own layout (`copBase`, measured at twenty times and scaled back) and
       nowhere else — so the stamp was laid out correctly on the sheet and then written into the file
       through this function, which was still rounding.

       Measured on a real stamp, screen and export rendered onto the same pixel grid (360 dpi against
       a page element at 5 css px per point), as a fraction of the frame's inner height:

           REDLINED   screen top 0.0720   file 0.0320   out by 5px, about 1.1pt
           contractor        0.3920        0.3760       out by 2px
           contact           0.5760        0.5600       out by 2px
           date              0.7520        0.7440       out by 1-2px

       Every line high in the file, by more at the bigger size — the signature of a rounding error,
       not of a placement rule. Horizontal agreed to the pixel throughout, which is what said the
       fault was in the baseline and not in the geometry.

       At twenty times the size the same rounding is a twentieth of a point, and `getBoundingClientRect`
       returns fractional pixels so nothing is lost on the way back down. The memo key is unchanged:
       this is a more accurate answer to the same question.
       ============================================================================================= */
    const Z=20;
    _baseProbe.style.fontSize=(sizePt*Z)+"px";
    _baseProbe.style.lineHeight=(L*Z)+"px";
    const r0=_baseProbe.getBoundingClientRect();
    const r1=_baseProbe.querySelector(".bp-s").getBoundingClientRect();
    const fromTop=(r1.top-r0.top)/Z;                 /* the baseline, below the line box's top */
    if(fromTop>0&&fromTop<L*2)out=L-fromTop;
  }catch(e){}
  _baseMemo[key]=out;
  return out;
}
/* --- how a mark breaks ------------------------------------------------------------------------
   6ek — PER CHARACTER, which is what the form does. Measured off the pages Ced sent: the printed cells
   break `ANDREW/COMMSCOP` / `E` and `DC9-48-60-24-8` / `C-EV` — mid-token both times, and the second one
   past a hyphen it could have broken at. So the page fills each line to the column's width and breaks
   wherever it runs out, and matching that is the whole of "the wrapping should work per character and
   not multiple letters".

   In CSS that is `word-break: break-all`, and the two were measured against each other before choosing:
   `DC9-48-60-24-8C-EV` in a 64px box renders 56px + 25.5px under `overflow-wrap: anywhere` (it retreats
   to the hyphen) and 60.5px + 21px under `break-all` (it fills). A space is still swallowed where a line
   happens to break on one, which is how `AIR6472 B77G` / `B77M` comes out right.

   One implementation, used by the stamp that chooses the width, by the screen (through the box it sets)
   and by the export that redraws it. */
/* 6f2 — a FREE box is not a cell. The per-character rule above exists to copy how the printed form
   breaks inside a ruled column; a text box or a callout the user drew is ordinary prose, and breaking
   `INSIDE` into `INSI` / `DE` there is just wrong. So a free box wraps on word boundaries, falling back
   to the character fill only for a single word too long for the box. `wrapsWords(a)` is the switch, and
   the screen, the reflow and the export all read it from the same place. */
/* 6ht — Ced: "text inside textbox should wrap by individual characters and not as words when the box
   was adjusted to be smaller." 6f2 gave a free box prose wrapping, on the reasoning that a box you drew
   is not a ruled column; in use that leaves a narrow box half empty, because one long word cannot be
   broken and every line stops short of the edge. A TEXT BOX now fills each line the way the printed
   form does — per character — unless it is told otherwise; a CALLOUT and a shape keep word wrapping,
   which is what a note in a box wants. `wrapMode` is the per-mark override, so either kind of wrapping
   is a chip in the panel rather than a rule you cannot reach. */
/* 6kn — AND A TEXT BOX BREAKS AT ITS WORDS TOO, BECAUSE THAT IS WHAT IT ALREADY DID ON SCREEN.
   6kf (v39) gave a free text box `word-break:normal; overflow-wrap:break-word` on screen — Ced:
   "wrapping is not working properly in texts" — and hard-coded it there instead of changing this
   function, so the default below still said per character and the EXPORT still read it. Measured on
   the parity fixture, a 122.4pt box holding "THIS NOTE IS LONGER THAN THE BOX IT WAS DRAWN IN":

       screen   THIS NOTE IS LONGER / THAN THE BOX IT WAS / DRAWN IN
       file     THIS NOTE IS LONGER T / HAN THE BOX IT WAS DR / AWN IN

   Two copies of a wrap rule, which is the fault 6eg was raised to kill. The screen's is the one Ced
   asked for, so it becomes the definition and the file reads it. `wrapMode` is still the per-mark
   override in the panel, and it now reaches the screen as well — 6kf overrode it unconditionally. */
/* ==================================================================================================
   6m4 — AND A TEXT BOX BREAKS INSIDE THE WORD AGAIN, BY DEFAULT.
   Ced: "make the default break inside a line."

   This is the third time this switch has moved, so it is worth writing down what each swing was
   actually answering, because they were not the same question:

     6f2  a free box wraps on WORDS — a box you drew is prose, not a ruled column
     6ht  Ced: "text inside textbox should wrap by individual characters and not as words when the
          box was adjusted to be smaller" — a text box fills each line
     6kn  the EXPORT was still reading the old default while the screen had been hard-coded to words
          in 6kf, so screen and file disagreed; one definition won and it happened to be words
     6m4  Ced again, on a narrowed box: break inside the line

   6kn's real work was killing the second copy of the rule, and that stands — this function is still
   the one definition the screen, the reflow and the file all read, so moving it moves all three
   together. What it got wrong was the default it settled on, and Ced has now said twice which one he
   wants for a TEXT BOX: fill the line, break where it runs out. A CALLOUT and a SHAPE are unchanged —
   a note in a box is prose and breaking `INSIDE` into `INSI`/`DE` there is still wrong — and
   `wrapMode` is still the per-mark override in the properties panel, so either rule is a chip away.
   ================================================================================================== */
function wrapsWords(a){
  if(!a)return false;
  const m=a.wrapMode;
  if(m==="words")return true;
  if(m==="chars")return false;
  if(isTextBox(a))return false;      /* 6m4 — fill the line, the way the printed columns do */
  return isFreeBox(a);
}
function redlineWrapLines(text,size,pi,maxW,fontKey,words,lsp){
  const s=String(text==null?"":text);
  const out=[]; let cur="";
  const wid=t=>measureTextNorm(String(t).replace(/\s+$/,""),size,pi,fontKey,lsp);
  if(words){
    const parts=s.split(/\s+/).filter(t=>t.length);
    parts.forEach(w=>{
      if(cur===""){ cur=w; }
      else if(wid(cur+" "+w)<=maxW){ cur+=" "+w; }
      else { out.push(cur); cur=w; }
      /* a single word wider than the box still has to go somewhere — fill it per character */
      if(wid(cur)>maxW&&cur.indexOf(" ")<0){
        const bits=redlineWrapLines(cur,size,pi,maxW,fontKey,false,lsp);
        for(let k=0;k<bits.length-1;k++)out.push(bits[k]);
        cur=bits[bits.length-1]||"";
      }
    });
    if(cur!=="")out.push(cur);
    return out.length?out:[""];
  }
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(cur===""&&/\s/.test(ch))continue;              // a soft break swallows the space it broke at
    if(cur===""||wid(cur+ch)<=maxW){ cur+=ch; continue; }
    out.push(cur.replace(/\s+$/,""));
    cur=/\s/.test(ch)?"":ch;
  }
  if(cur!=="")out.push(cur.replace(/\s+$/,""));
  return out.length?out:[""];
}
/* --- what width does the page lay this column out at? -----------------------------------------
   6ei — THE COLUMN'S OWN MEASURE. Every width rule up to here has been local: this cell's printed run,
   this cell's distance to the nearest ink. Both vary from row to row, so the same correction came out a
   different width in each — measured on the Antenna Position page, `ANDREW/COMMSCOPE` was given a 100px
   box in sector C-1 and a 123px box in C-3, breaking in two different places, because C-1 has a neighbour
   with ink in it and C-3 does not. And where the local bound ran wide it ran past the ruled edge: on the
   RF Inventory page the Model column's rules sit at x 60 and 153 and the mark's text reached 167.

   The page already answers the question. Every printed value in a column is laid out to the same measure,
   so the widest FIRST line printed in that column is the width the form itself wraps it at — inside the
   rule by construction, and identical for every row. That number becomes the ceiling for a correction's
   width: as wide as the correction needs, never past what the column is laid out at.

   A transposed table (the antenna pages) has its columns running the other way: the sector-position is
   the column and each field is a row, so there the measure is taken across the fields of one row. */
/* the measure said in characters — the unit the request was made in, and the one that reads back
   against the page: "the page fits 15 characters before it wraps". Counted off the printed cell the
   measure was taken from, at that cell's own font size. */
function _measureChars(b){
  try{
    const pi=(b.page!=null)?b.page:0;
    const W=(S.pages[pi]&&S.pages[pi].w1)||612;
    const wide=((b.x2!=null?b.x2:b.nx)-b.nx);
    const size=(b.nh!=null)?Math.max(4,Math.min(16,b.nh*((S.pages[pi]&&S.pages[pi].h1)||792)*0.78)):8;
    const em=measureTextNorm("M",size,pi)||0.01;
    return Math.max(1,Math.round(wide/em))+" characters";
  }catch(e){ return "?"; }
}
function _boxFirstLine(b){
  if(!b||b.nx==null)return 0;
  const right=(b.topR!=null)?b.topR:(b.x2!=null?b.x2:b.nx+(b.nw||0));
  return Math.max(0,right-b.nx);
}
function assignColMeasures(A){
  if(!A)return 0;
  let n=0, named=0;
  /* 6ej — WHERE THE EVIDENCE COMES FROM. Ced's own framing, and it is the right one: a cell that the
     PAGE ITSELF wrapped is the only place the form tells you where its wrap boundary is —
     "ANDREW/COMMSCOPE had 15 characters before the E went to the second line", "DC9-48-60-24-8C-EV had
     13". So the measure is only taken from a column where something actually wrapped; there the widest
     printed LINE in the column is a width the page has demonstrated fits, and a correction wrapped at it
     breaks where the page breaks. Where nothing in a column ever wrapped there is no such evidence, and
     inventing a boundary out of the widest value that happens to be printed there would fold corrections
     for no reason — those columns keep the cell as their bound.

     The widest LINE, not the widest first line: a cell's bounding box spans its longest line whichever
     line that is, and every line of a printed cell is by definition a line that fit. */
  const apply=(boxes,label)=>{
    let m=0, sawWrap=false, evid=null;
    boxes.forEach(b=>{
      if(!b||b.synth)return;
      const w=(b.x2!=null?b.x2:b.nx+(b.nw||0))-b.nx;      // the cell's widest line
      if((b.lines||1)>1){ sawWrap=true; }
      if(w>m){ m=w; evid=b; }
    });
    if(!sawWrap||!(m>0))return;                            // no wrapped cell here: no boundary to read
    boxes.forEach(b=>{ if(b){ b.colTextW=m; n++; } });
    if(label&&evid){ named++;
      if(named<=14)LOG("   "+label+": the page fits "+_measureChars(evid)+" ("+
        (m*((S.pages[evid.page!=null?evid.page:0]&&S.pages[evid.page!=null?evid.page:0].w1)||612)).toFixed(1)+
        "pt) before it wraps"); }
  };
  /* upright tables: a column is one key across the rows */
  const upright=(rows,geo,tab)=>{
    if(!rows||!rows.length)return;
    const by={};
    rows.forEach(r=>{ const g=geo(r); if(!g)return;
      Object.keys(g).forEach(k=>{ (by[k]=by[k]||[]).push(g[k]); }); });
    Object.keys(by).forEach(k=>apply(by[k],tab?(tab+" · "+k):null));
  };
  upright(A.designSummary,r=>r&&r._g,"Design Summary");
  [["RF Inventory",A.rfInventory],["Non-RF Inventory",A.nonRfInventory],
   ["Port Level",A.portLevel],["Equipment in Calc",A.ecTable]].forEach(([nm,T])=>{
    if(T&&T.rows)upright(T.rows,r=>r&&r._g,nm);
  });
  /* transposed tables: a column is one ROW's own set of fields */
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>{
    (A[k]||[]).forEach(r=>{
      const g=r&&(r._gf||r._g); if(!g)return;
      apply(Object.keys(g).map(f=>g[f]),k+" · "+String(r.secPos||r._orig_secPos||"?"));
    });
  });
  if(n)LOG("Column measures: set on "+n+" cell(s) — the width the page lays each column out at");
  return n;
}
/* --- cell coverage -------------------------------------------------------
   A cell redline must completely hide the value printed underneath it. A printed value can
   be split across several PDF text runs, so runs on the same row are clustered into cells:
   the cluster gives the value's true extent, and the gaps to the neighbouring clusters give
   the cell's own edges. */
function cellCluster(pi,c){
  const GAP=0.006;                                   // normalized gap that separates columns (~3.7pt)
  const fallback=()=>{ const l=c.nx,r=c.nx+(c.nw||0);
    return {textL:l,textR:r,cellL:Math.max(0,l-0.014),cellR:Math.min(1,r+0.014)}; };
  if(!S.pages[pi])return fallback();
  const band=rowBandItems(pi,c);
  const clusters=[]; let cur=null;
  band.forEach(t=>{ const l=t.nx, r=t.nx+(t.nw||0);
    if(cur && l-cur.r<=GAP){ cur.r=Math.max(cur.r,r); cur.items.push(t); }
    else { cur={l,r,items:[t]}; clusters.push(cur); }
  });
  const idx=clusters.findIndex(cl=>cl.items.indexOf(c)>=0);
  if(idx<0)return fallback();
  const self=clusters[idx], prev=clusters[idx-1], next=clusters[idx+1];
  return { textL:self.l, textR:self.r,
    cellL: prev? (prev.r+self.l)/2 : Math.max(0,self.l-0.014),
    cellR: next? (self.r+next.l)/2 : Math.min(1,self.r+0.014) };
}
/* Size and place a cell redline. The box is always CENTRED ON THE PRINTED VALUE so the new text
   lands directly on top of the old one, and it is never narrower than the value it has to hide:
     width = max(new text width, printed value width) + a ~1pt bleed
   A longer replacement is exactly its own length — it does not stretch to fill the cell. */
/* One character sits flush left in its column; two or more are centred in it. This exists for cells on
   ADDED rows: fitCellBox() returns early on manualW marks, so their alignment used to be frozen at
   creation and a value retyped from one character to two stayed left. */
function applyLenRule(a){
  if(!a||a.alignUser||a._colNw==null)return;
  const tv=String(a.text==null?"":a.text).trim();
  const tw=measureTextNorm(tv,a.size,a.page);
  const wide=(a._colNw||0)>Math.max(tw*1.8,0.012);
  /* Same rule as fitCellBox: either side being two or more characters means centred. */
  /* 6cm — same rule as fitCellBox: both sides a single character means flush left. */
  const src=(a.srcLen!=null?a.srcLen:1);
  a.align=(tv.length<=1&&src<=1&&!wide)?"left":"center"; a.alignSet=true;
  a.nw=Math.max(tw+0.002,0.006);
  a.nx=(a.align==="center")
    ? Math.max(0,a._colNx+(a._colNw/2)-a.nw/2)
    : Math.max(0,a._colNx);
  if(a.nx<a._colNx)a.nx=a._colNx;      // same clamp when the rule is re-applied after an edit
}
function fitCellBox(a){
  if(!a||!a.onCell||a.manualW)return;
  const P=S.pages[a.page]; if(!P)return;
  const pad=1.0/(P.w1||612);                         // ~1pt bleed so glyph ink is fully covered
  const tw=measureTextNorm(a.text==null?"":a.text,a.size,a.page);
  const ow=a.cw||0;
  const tL=(a.tx0!=null?a.tx0:a.nx);
  /* Alignment is decided FIRST, because it drives the placement below. A lone character sits LEFT;
     two or more characters are CENTRED. Only a click on the align buttons overrides that. */
  if(!a.alignUser){
    const tv=String(a.text==null?"":a.text).trim();
    /* Centre whenever EITHER side is two or more characters — the value being written or the printed value
       it replaces. Flush left only when both are a single character, where left-on-the-glyph reads as
       centred anyway. */
    /* 6cm — back to the rule as stated: a "-" REPLACED BY ONE CHARACTER sits flush left. Anything
       longer is centred, because a multi-character value hung off the left edge of a dash reads as
       belonging to the column before it — which is what 6cl's wider version did to the as-built
       columns. Both sides one character = left; anything else = centre. */
    /* 6dk — a cell can opt out of the length rule entirely. The Antenna Position tables are transposed
       and every printed value in them is centred in its column, whatever its length, so a one-character
       correction there belongs in the middle and not on the left edge of what it replaces. The flag is
       set where that is known to be true; everywhere else the rule below is unchanged. */
    const src=(a.srcLen!=null?a.srcLen:1);
    a.align=a.colCentred?"center":((tv.length<=1&&src<=1)?"left":"center");
  }
  /* Width never depends on the alignment — the box always hugs whichever is wider, the new text or the
     value it has to hide, so choosing an alignment can never enlarge the mark. Alignment only decides
     WHERE that box sits against the printed value. */
  a.nw=Math.max(tw,ow)+pad*2;
  const al=a.align||"center";
  if(al==="left")       a.nx=Math.max(0, tL-pad);              // left edges flush
  else if(al==="right") a.nx=Math.max(0, tL+ow+pad-a.nw);      // right edges flush
  else                  a.nx=Math.max(0, (tL+ow/2)-a.nw/2);    // centres match
  a.fullcell=true; a.nowrap=true;
}
function addText(page,nx,ny,orig,opts){
  opts=opts||{};
  // during Apply: dedupe against an analyze redline already on this cell, and tag new ones
  /* 6dv — dedupe EVERY mark this Apply places, not only the ones handed a printed cell. A value written
     into an ADDED row goes through here with no `cell`, so it skipped the check entirely and a second
     Apply laid a fresh mark on top of the first — the stacking that made re-applying look messy. The key
     is simply where the mark goes, which every caller knows. */
  if(_azApplying){
    /* 6fb — WHERE THE MARK GOES IS NOT ALWAYS THE CELL ITS GEOMETRY CAME FROM. An INSERTED row's value is
       built from the anchor row's printed run — that is how it inherits the printed size, line height and
       length rule (`putRun`) — and then dropped onto the new line between the rows. Keyed and matched on
       the run, it collided with the anchor row's OWN redline in that column: same page, same cell, so the
       dedupe handed the inserted row the anchor's mark, rewrote its text and (since 6ev) moved it down to
       the new line. The anchor row's correction vanished, which is "the tool has not redlined some items".
       So a caller that borrows one cell's geometry for a mark that lives somewhere else says where the
       mark actually LIVES, and that is what identifies it — both for this dedupe and for the next Apply. */
    const key=opts.keyAt||opts.cell||{nx:nx,ny:ny};
    const cx0=key.nx, cy0=key.ny;
    /* 0.012 was wide enough to swallow the neighbouring row on a tightly-spaced table, which is how a
       row's redline went missing. Rows here are ~0.02 apart, so 0.005 identifies the same cell only. */
    /* 6ev — and a redline you drew by hand counts as covering the cell too, by geometry, since it has no
       key to match on. Yours is left exactly as it is; Apply does not stamp over it. */
    const dup=markCoveringCell(page,{nx:key.nx,ny:key.ny,
      nw:(key.nw!=null?key.nw:((opts.cell&&opts.cell.nw)||0.004)),
      nh:(key.nh!=null?key.nh:((opts.cell&&opts.cell.nh)||0.011))});
    if(dup&&!dup.fromAnalyze){
      _azHandHeld++;
      LOG("Analyze: cell already carries a redline you drew (",String(dup.text),
          ") — left alone, not restamped with",JSON.stringify(String(orig==null?"":orig)));
      return dup.id;
    }
    if(dup){
      /* A redline is already on this cell. Never stack a second one: if the value moved on, update the
         mark in place; if it is the same, leave it alone. Only genuinely new cells get new marks. */
      const nv=String(orig==null?"":orig);
      if(String(dup.text)!==nv){ dup.text=nv; dup.orig=nv; if(dup.onCell)fitCellBox(dup);
        LOG("Analyze: updated the existing redline on this cell →",nv); }
      return dup.id;
    }
  }
  pushHistory();
  const P=S.pages[page];
  let size=parseFloat($("#c_pt").value)||8, align="center", nw=null, x=nx, y=ny, fullcell=false, nowrap=false, cc=null;
  if(opts.cell){
    const c=opts.cell;
    cc=cellCluster(page,c);
    y=c.ny; x=cc.textL; nw=(cc.textR-cc.textL)||null; nowrap=true; fullcell=true; align="center";
  }
  /* 6ii — A NEW MARK IS ON TOP. Ced, twice: "every new redline should always be on the frontmost
     layer." 6gn had a new mark start BELOW the strokes, on the old rule that a stroke always beat a
     text mark — so the very first thing a new redline did was hide behind whatever was already on the
     sheet. It starts in the upper band now, at the top of it, and the ⇅ button is how it goes under.
     A caller that genuinely wants one underneath still says so with `opts.under`. */
  const a={id:seq++,page,nx:x,ny:y,nw,text:orig||"",orig:orig||"",align,size,onCell:!!opts.cell,nowrap,fullcell,
           under:(opts.under!=null?!!opts.under:false)};
  /* THE MARK REMEMBERS WHAT IT WAS DRAWN IN. The ribbon used to be the only answer to "what colour is
     this", which meant every mark on the document changed colour together — and a mark made in red an
     hour ago came out of the export in whatever colour the ribbon happened to be showing at the time.
     A tool's ▾ properties say what the NEXT mark looks like; the mark itself carries it from then on. */
  a.col=$("#c_text").value;
  a.bg=$("#c_bg").value;
  a.font=markFontKey(null);
  /* 6f6 — and the rest of the tool's look: ink opacity, ground opacity, decorations, highlight. */
  try{ const st=maStyleNow(); maStampExtras(a,st); if(st.fillOp!=null)a.fillOp=st.fillOp; }catch(_){}
  if(opts.cell){
    /* How many characters the PRINTED value had. A one-character replacement over a printed "10" belongs on
       the centre of that wider cell — flush left of it reads as off-centre against the column. Taken from
       the run itself, since the computed cell context carries no text. */
    if(opts.cell.str!=null)a.srcLen=String(opts.cell.str).trim().length;
    /* match the printed run's size, and keep its height so the glyphs can be centred on the printed
       line instead of riding above it */
    /* 6fh — the size the printed value is actually SET at, not the height of its line box */
    const pt=printedSizeFor(page,opts.cell,markFontKey(a));
    if(pt)a.size=pt;
    if(opts.cell.nh){ a.nh=opts.cell.nh; a.lineNh=opts.cell.nh; }
    a.lines=1;
  }
  if(cc){ a.cw=cc.textR-cc.textL; a.tx0=cc.textL; a.cellL=cc.cellL; a.cellR=cc.cellR;
    /* How many characters the PRINTED value had. A one-character replacement over a printed "10" belongs on
       the centre of that wider cell — sitting flush left of it would look off-centre against the column. */
    if(a.srcLen==null&&cc.str!=null)a.srcLen=String(cc.str).trim().length;
    if(opts.align){ a.align=opts.align; a.alignSet=true; }
    fitCellBox(a); }
  if(_azApplying){ a.fromAnalyze=true;
    /* 6fb — the same key the dedupe used above: where the mark lives, not where its geometry came from */
    const key0=opts.keyAt||opts.cell||{nx:nx,ny:ny};
    a.cx0=key0.nx; a.cy0=key0.ny; }
  topZ(a);                 /* 6i3 — a new mark lands on top of its band */
  S.annos.push(a); layoutAnnos(); applySuggestions(); updateRail(); updateCount();
  S.suggestions.delete(page+"|"+x.toFixed(4)+"|"+y.toFixed(4));
  if(!_maQuiet)setTimeout(()=>{const ed=document.querySelector(`.anno[data-id="${a.id}"] .ed`); if(ed){selectAnno(a.id);ed.focus();try{document.getSelection().selectAllChildren(ed);}catch(e){}}},0);
  return a.id;
}
/* 6ds — WHAT THE MARK ACTUALLY RENDERS.
   6dr counted a wrapped mark's lines by measuring the text on a canvas and dividing by the mark width.
   That is an estimate, and it errs high: a value a hair over the width is charged a whole extra line,
   so the mark grew a blank second line and the text no longer sat where the printed value did. The
   browser has already done the real wrapping by the time we can ask, so ask it.

   The floor is `pLines`, the number of lines the PRINTED value used. A mark must stay at least that
   tall whatever its own text does — shrinking a two-line cell's mark to one line would leave the second
   printed line showing underneath it, which is the one thing a redline may never do. */
/* 6dt — KEEP THE TEXT INSIDE THE MARK, live, while you type or resize.
   Editing an auto redline did nothing at all: `oninput` only re-fitted a mark with `manualW` unset, and
   every mark stamped by Analyze has `manualW` set — so the first edit on a PDF ran off the side of its
   own box with nothing catching it. Resizing had the same gap: the box changed width and the text
   ignored it.

   This is done in place, on the element being edited, rather than by re-laying-out the page — a
   re-layout rebuilds the node and would take the caret with it mid-keystroke.

   The height follows the lines the browser actually renders, with `pLines` as the floor for the same
   reason as everywhere else: a mark may never become shorter than the printed value it covers. */
/* 6hb — re-measure a single-line label and keep its centre where it is. Used while typing, where a
   full `layoutAnnos` cannot run: it would rebuild the element and take the caret with it. The mark's
   own numbers are updated as well as the element's, so the next layout agrees with what you can see. */
function refitCentred(a,ed,pg){
  if(!a||!pg)return;
  const P=S.pages[a.page]||{}, W=P.w1||612;
  const w=pg.offsetWidth;
  const cx=a.nx+(a.nw||0)/2;                 /* the centre it is to keep */
  const d=ed?ed.closest(".anno"):document.querySelector(`.anno[data-id="${a.id}"]`);
  a.manualW=true; a.nowrap=true; a.wrap=false; a.lines=1; a.pLines=1;
  /* MEASURED, not computed: let the box size itself to the text and read what the browser made of it,
     so the padding, the border and the font's own metrics are all accounted for exactly. Guessing at
     them is what left the label a few pixels off centre for the whole of a typing session. */
  let want=0;
  if(ed){
    ed.style.setProperty("white-space","pre","important");
    ed.style.setProperty("width","auto","important");
    want=(d?d.offsetWidth:ed.offsetWidth)/w;
  }
  if(!(want>0)){
    try{ want=measureTextNorm(String(a.text||""),a.size||8,a.page,markFontKey(a))+8/W; }catch(e){}
  }
  want=Math.max(12/W,want);
  a.nw=want;
  a.nx=Math.max(0,Math.min(1-want,cx-want/2));
  if(ed)ed.style.setProperty("width",(want*w)+"px","important");
  if(d)d.style.left=(a.nx*w)+"px";
  /* AND THEN PUT IT WHERE IT BELONGS, MEASURED. The model's `nx` and the element's `left` are not the
     same number for every kind of mark — a layout pass lifts and drops some of them — so the last word
     is the element's own rectangle: work out where its centre should be on the page, see where it
     actually is, and move it by the difference. Where it belongs is the middle of the run for a
     reading, the middle of the rule for a writing, and wherever the hand has put it for either one
     once it has been dragged off. */
  if(d){
    let tgt=null;
    try{
      if(a.maKind==="dimlabel"&&!a.dimFree){
        const dl=(typeof maDimLineOf==="function")?maDimLineOf(a):null;
        if(dl)tgt=maDimMid(dl)[0]*w;
      }else if(a.maKind==="fix"&&!a.fixFree){
        const ml=(S.lines||[]).find(z=>z.maKind==="strike"&&z.group!=null&&z.group===a.group);
        if(ml)tgt=((ml.x1+ml.x2)/2)*w;
      }
    }catch(e){}
    if(tgt!=null){
      const r1=d.getBoundingClientRect(), pr=pg.getBoundingClientRect();
      const have=r1.left+r1.width/2-pr.left;
      const dx=tgt-have;
      if(Math.abs(dx)>0.5){
        d.style.left=((parseFloat(d.style.left)||0)+dx)+"px";
        a.nx=Math.max(0,Math.min(1-want,a.nx+dx/w));
      }
    }
  }
  try{ positionBar(); }catch(e){}
}
/* 6hh — A TEXT BOX WRAPS, AND GROWS DOWN RATHER THAN HIDING WHAT IT CANNOT SHOW.
   Ced: "on text boxes, do not always make it 1 line, make them wrap if the box is smaller."
   A text box has always wrapped to its width — but its HEIGHT is the one you drew, and it is drawn
   with `overflow:hidden`, so the lines past the bottom of it were simply not there: you typed a note
   into a box you drew a little short and the end of it vanished. The width is still yours (that is
   what the wrap is measured against) and so is the height you drew, which the box never goes back
   below; it only ever grows downwards to hold what you have typed. Deleting a line gives the height
   back, down to the box you drew and no further. */
function growTextBox(a,ed,pgEl){
  if(!a||!ed||!pgEl)return false;
  /* ==============================================================================================
     6ke — A BOX THE USER HAS SIZED KEEPS THE SIZE THEY GAVE IT.
     Ced: "if the user is adjusting the text, do not change its properties and text box size after
     the fact. always retain what the user intends."
     This grows a text box downward so typing never disappears below its own edge, which is right up
     to the moment somebody drags a handle: from then on the height is a DECISION, and a tool that
     quietly undoes a decision on the next keystroke is worse than one that lets text overflow.

     6lv — AND THE DECISION IS A FLOOR, NOT A CEILING.
     Ced, later: "if the text wraps, the text box should extend below to still cover the text."

     These two asks pull in opposite directions and it is worth writing down how they are reconciled,
     because the obvious reading of either one breaks the other. 6ke stopped the box re-deriving its
     own size, which is right: a box you dragged narrow must not spring back. 6lc then let the lines
     that would not fit SHOW rather than be clipped, which was better than losing them but leaves text
     hanging outside its own box — and that is what Ced is looking at now.

     The two axes are not the same decision. WIDTH is wholly the user's: it decides where the words
     break, and nothing may change it. HEIGHT is only ever a minimum — the box will not shrink below
     the height it was given, and it will grow below to cover whatever the words come to. That is the
     formula two lines down, `Math.max(a.minNh, need/ph)`, which was already right; all that stood in
     front of it was this bail-out. So a hand-sized box keeps every decision that was made about it
     and still covers its own text.
     ============================================================================================== */
  if(a.userSized&&a.minNh==null)a.minNh=a.nh||0.03;
  const ph=pgEl.offsetHeight; if(!(ph>0))return false;
  if(a.minNh==null)a.minNh=a.nh||0.03;
  const prev=ed.style.height;
  ed.style.setProperty("height","auto","important");
  const need=ed.scrollHeight;
  if(prev)ed.style.setProperty("height",prev,"important");
  if(!(need>0))return false;
  const want=Math.max(a.minNh,need/ph);
  /* 6lr — and the LINE COUNT is kept honest while we are measuring anyway. `a.lines` was left at
     whatever the mark was made with — measured on a five-line note it still said 4 — and although
     nothing a free box does reads it today, it is written into the file and into every snapshot, and
     `fitTextInside` derives a line PITCH from it the moment a mark stops being a free box. A number
     in the state that does not match the thing on screen is a trap for the next reader. */
  try{
    const lh=parseFloat(getComputedStyle(ed).lineHeight);
    if(lh>0)a.lines=Math.max(1,Math.round(need/lh));
  }catch(e){}
  if(Math.abs(want-(a.nh||0))<0.0004)return false;
  a.nh=want;
  ed.style.setProperty("height",(want*ph)+"px","important");
  try{ positionBar(); }catch(e){}
  return true;
}
function fitTextInside(a,ed,pgEl){
  if(!a||!ed||!pgEl||a.kind==="img")return false;
  const pw=pgEl.offsetWidth, ph=pgEl.offsetHeight;
  if(!(a.nw>0)||!(pw>0)||!(ph>0))return false;
  const lineNh=(a.lineNh!=null?a.lineNh:(a.nh?a.nh/Math.max(1,a.lines||1):0.011))||0.011;
  const lhPx=Math.max(1,lineNh*ph);
  const set=(k,v)=>ed.style.setProperty(k,v,"important");
  /* 6du — clear the floor first. layoutAnnos gives a single-line mark `min-width: <its width>` so it
     cannot be squeezed narrower than the value it carries; once the mark is resized that floor is the
     PREVIOUS width, and it silently wins over the new one. The box then refused to shrink — the width
     was set, the element stayed put, and the text had no reason to wrap because nothing had actually
     got narrower. Here the width is the authority, so the floor goes. */
  set("min-width","0");
  set("max-width","none");
  set("width",(a.nw*pw)+"px");
  set("white-space","normal");            /* let it wrap so the browser can tell us how tall it is */
  /* 6el — and it has to MEASURE the way it will be DRAWN. This is the resize path: it reads scrollHeight
     to decide how many lines the new width takes. It was still asking under `overflow-wrap:anywhere`
     while layoutAnnos draws under `break-all`, so a value that fills three lines when broken per
     character was measured as two — the box came out a line short and the last line hung outside it. */
  if(wrapsWords(a)){ set("overflow-wrap","break-word"); set("word-break","normal"); }
  else { set("overflow-wrap","normal"); set("word-break","break-all"); }  /* break like the export breaks */
  set("overflow","visible");
  set("line-height",lhPx+"px");
  set("height","auto");
  const need=Math.max(1,Math.max(a.pLines||1,Math.round(ed.scrollHeight/lhPx)));
  a.lines=need; a.nh=lineNh*need;
  a.wrap=need>1; a.nowrap=!a.wrap;
  a.manualW=true;                          /* the width is now the user's, so nothing re-fits it away */
  set("height",(a.nh*ph)+"px");
  if(!a.wrap)set("white-space","nowrap");  /* it fits on one line — keep it on one */
  return true;
}
var _wrapReflowing=false;
function reflowWrapped(){
  if(_wrapReflowing)return 0;
  let changed=0;
  S.annos.forEach(a=>{
    if(!a.wrap||!a.nh||!a.nw||a.kind==="img")return;
    /* A shape or a text box is the size it was DRAWN, not the size its words happen to need — this
       pass exists to correct a cell redline's line count against the printed value it covers, and
       running it on a box you dragged out shrinks the box to fit the text you have typed so far. */
    if(isFreeBox(a))return;
    const ed=document.querySelector('.anno[data-id="'+a.id+'"] .ed'); if(!ed)return;
    const pgEl=document.querySelector('.page[data-idx="'+a.page+'"]'); if(!pgEl)return;
    const h=pgEl.offsetHeight; if(!(h>0))return;
    const lines=Math.max(1,a.lines||1);
    const lh=(a.nh*h)/lines; if(!(lh>1))return;
    /* 6dy — MEASURE IT UNCONSTRAINED. layoutAnnos sets an explicit height on this element, and
       scrollHeight can never report less than the box it is set on — so this read could only ever
       discover that a mark needed MORE lines, never that it needed fewer. An over-counted line count
       therefore survived as a blank line inside the mark, which is the entire fault 6ds was raised to
       fix: it fixed one direction of it. Release the height for the measurement, then put it back. */
    const prevH=ed.style.height;
    ed.style.setProperty("height","auto","important");
    const natural=ed.scrollHeight;
    if(prevH)ed.style.setProperty("height",prevH,"important"); else ed.style.removeProperty("height");
    const actual=Math.max(1,Math.round(natural/lh));
    const want=Math.max(actual,Math.max(1,a.pLines||1));
    if(want===lines)return;
    const lineNh=(a.lineNh!=null?a.lineNh:(a.nh/lines))||0.011;
    a.lines=want; a.nh=lineNh*want;
    if(want===1){ a.wrap=false; a.nowrap=true; }      // it fits on one line after all
    changed++;
  });
  if(changed){
    LOG&&LOG("wrap reflow: corrected",changed,"mark(s) to the lines they actually render");
    _wrapReflowing=true;
    try{ layoutAnnos(); } finally { _wrapReflowing=false; }
  }
  return changed;
}
/* A colour and an opacity as one CSS value. `fillOp` of 0 is a genuinely transparent interior — an
   outline you can read the drawing through — which is not the same thing as no fill at all, so it is
   written out rather than treated as absent. */
function _rgbaOf(hex,op){
  const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex||"#ffffff"));
  if(!m)return "transparent";
  const r=parseInt(m[1],16), g=parseInt(m[2],16), b=parseInt(m[3],16);
  const o=(op==null?1:Math.max(0,Math.min(1,op)));
  return `rgba(${r},${g},${b},${o})`;
}
/* THE FACES A MARK CAN BE SET IN.
   Arial is the default because that is what the sample reports are redlined in — the detail lines of
   every stamp in them are Arial, and a correction written over a printed value reads better in the
   same sans the forms themselves use. Each entry pairs the CSS the screen draws with and the standard
   PDF font the export writes, so a mark measures the same in both places; the fallback stacks matter,
   because a machine without Arial has to land on Helvetica and not on something wider.

   These are the fourteen faces every PDF viewer has built in, so nothing is embedded and the export
   stays small. */
const MARK_FONTS={
  arial:      {label:"Arial",         css:"Arial,Helvetica,'Liberation Sans',sans-serif",              pdf:"Helvetica"},
  arialbold:  {label:"Arial Bold",    css:"Arial,Helvetica,'Liberation Sans',sans-serif",              pdf:"HelveticaBold",   weight:"700"},
  arialital:  {label:"Arial Italic",  css:"Arial,Helvetica,'Liberation Sans',sans-serif",              pdf:"HelveticaOblique",style:"italic"},
  /* 6gf — BOLD AND ITALIC STACK. Ced: "in redline and textbox, make sure the text styles are allowed
     to be stacked." The B and I buttons swap the FACE, because the export writes standard PDF fonts
     and those are the faces it has — so a bold ITALIC needed a face of its own in each family, and
     without one, turning italic on turned bold off. All three families have one. */
  arialbolditalic:{label:"Arial Bold Italic", css:"Arial,Helvetica,'Liberation Sans',sans-serif",
                   pdf:"HelveticaBoldOblique", weight:"700", style:"italic"},
  times:      {label:"Times",         css:"'Times New Roman',Times,'Liberation Serif',serif",          pdf:"TimesRoman"},
  timesbold:  {label:"Times Bold",    css:"'Times New Roman',Times,'Liberation Serif',serif",          pdf:"TimesRomanBold",  weight:"700"},
  timesital:  {label:"Times Italic",  css:"'Times New Roman',Times,'Liberation Serif',serif",          pdf:"TimesRomanItalic",style:"italic"},
  timesbolditalic:{label:"Times Bold Italic", css:"'Times New Roman',Times,'Liberation Serif',serif",
                   pdf:"TimesRomanBoldItalic", weight:"700", style:"italic"},
  courier:    {label:"Courier",       css:"'Courier New',Courier,'Liberation Mono',monospace",         pdf:"Courier"},
  courierbold:{label:"Courier Bold",  css:"'Courier New',Courier,'Liberation Mono',monospace",         pdf:"CourierBold",     weight:"700"},
  courierital:{label:"Courier Italic",css:"'Courier New',Courier,'Liberation Mono',monospace",         pdf:"CourierOblique",  style:"italic"},
  courierbolditalic:{label:"Courier Bold Italic", css:"'Courier New',Courier,'Liberation Mono',monospace",
                   pdf:"CourierBoldOblique", weight:"700", style:"italic"},
  /* 6hm — Ced: "add century gothic fonts and more fonts available." A geometric sans, in the Century
     Gothic manner, that TRAVELS WITH THE FILE: `ttf` names a face bundled with the tool rather than
     one of the PDF's own fourteen, and the same bytes are installed on screen, so this family is the
     one face here where the screen and the file are not cousins but the same font. Jost is the open
     face used, because Century Gothic itself may not be redistributed. */
  jost:      {label:"Jost (Century Gothic)", css:"'MA Jost','Century Gothic',sans-serif",
              ttf:"jost", ps:"Jost-Regular"},
  jostbold:  {label:"Jost Bold",   css:"'MA Jost','Century Gothic',sans-serif",
              ttf:"jostbold", ps:"Jost-Bold", weight:"700"},
  jostital:  {label:"Jost Italic", css:"'MA Jost','Century Gothic',sans-serif",
              ttf:"jostital", ps:"Jost-Italic", style:"italic"},
  jostbolditalic:{label:"Jost Bold Italic", css:"'MA Jost','Century Gothic',sans-serif",
              ttf:"jostbolditalic", ps:"Jost-BoldItalic", weight:"700", style:"italic"},
  /* 6n1 — Ced: "add more font options." Two more bundled families, chosen for a job rather than for
     variety. CARLITO is metric-compatible with CALIBRI — the face the Word and Excel paperwork
     around these reports is set in — so a note added here and a line pasted out of the tracker are
     the same document; the metric compatibility also means a block copied from Word keeps its
     measure. ARCHIVO NARROW is a CONDENSED grotesque, for the one thing a redliner runs out of:
     room. A corrected value that will not fit a table cell in Arial fits in this at the same point
     size. Both travel inside the export the way Jost does, both are OFL. */
  carlito:    {label:"Carlito (Calibri)", css:"'MA Carlito',Calibri,'Carlito',sans-serif",
              ttf:"carlito", ps:"Carlito-Regular"},
  carlitobold:{label:"Carlito Bold", css:"'MA Carlito',Calibri,'Carlito',sans-serif",
              ttf:"carlitobold", ps:"Carlito-Bold", weight:"700"},
  carlitoital:{label:"Carlito Italic", css:"'MA Carlito',Calibri,'Carlito',sans-serif",
              ttf:"carlitoital", ps:"Carlito-Italic", style:"italic"},
  carlitobolditalic:{label:"Carlito Bold Italic", css:"'MA Carlito',Calibri,'Carlito',sans-serif",
              ttf:"carlitobolditalic", ps:"Carlito-BoldItalic", weight:"700", style:"italic"},
  narrow:     {label:"Archivo Narrow", css:"'MA Narrow','Arial Narrow',sans-serif",
              ttf:"narrow", ps:"ArchivoNarrow-Regular"},
  narrowbold: {label:"Archivo Narrow Bold", css:"'MA Narrow','Arial Narrow',sans-serif",
              ttf:"narrowbold", ps:"ArchivoNarrow-Bold", weight:"700"},
  narrowital: {label:"Archivo Narrow Italic", css:"'MA Narrow','Arial Narrow',sans-serif",
              ttf:"narrowital", ps:"ArchivoNarrow-Italic", style:"italic"},
  narrowbolditalic:{label:"Archivo Narrow Bold Italic", css:"'MA Narrow','Arial Narrow',sans-serif",
              ttf:"narrowbolditalic", ps:"ArchivoNarrow-BoldItalic", weight:"700", style:"italic"}
};
const MARK_FONT_DEFAULT="arial";
function markFontKey(a){
  const k=(a&&a.font)||(($("#c_font")&&$("#c_font").value)||MARK_FONT_DEFAULT);
  return MARK_FONTS[k]?k:MARK_FONT_DEFAULT;
}
function markFont(a){ return MARK_FONTS[markFontKey(a)]; }

/* What a mark is drawn in: its own colour where it has one, the ribbon's where it does not. A mark
   made before styles existed has none, so the ribbon still speaks for it. */
function markCol(a){ return (a&&a.col)||$("#c_text").value; }
function markBg(a){ return (a&&a.bg!=null)?a.bg:$("#c_bg").value; }
function markSw(a){ const v=(a&&a.sw!=null)?a.sw:parseFloat($("#c_sw")&&$("#c_sw").value); return (v>0?v:1.5); }
function isShape(a){ return !!(a&&(a.shape||a.box)); }
/* 6ge — WHERE A CSS BORDER IS NOT THE SHAPE THE FILE GETS.
   Ced: "make sure the shapes on the UI are exactly the shape on what's being exported."
   Measured, at 1:1, against a rendered page of the export: a SOLID rectangle matches to the pixel, and
   two cases do not.

     · a DASHED or DOTTED border uses the browser's own dash rhythm, which is not ours and is not the
       one written into the file — so the same mark reads with different dashes on screen and in the
       PDF;
     · an ELLIPSE's CSS border is the gap between two concentric ellipses, which is THINNER at the flat
       ends and thicker at the ends of the long axis. A stroked path in the file has one width all the
       way round. On a squashed ellipse that is plainly visible.

   Both are drawn into the page's own SVG layer instead, from the same numbers the export uses. The box
   keeps its border WIDTH (so the text inside sits where it did) and gives up its colour. */
function shapeSvgOutline(a){
  if(!isShape(a))return false;
  if(shapeOf(a)==="ellipse")return true;
  /* 6gt — AND ANYTHING UNDER A POINT. A CSS border is laid out in whole device pixels: at 0.5pt the
     browser rounds it to 0 on one edge and 1 on another, so a thin box came out with two sides showing
     and two missing, or with no border at all — "thickness less than 1 pt is not working properly". An
     SVG stroke has no such rounding, so a thin box is drawn the way the ellipse and the dashed box
     already are, at exactly the weight it is set to. */
  if(markSw(a)<1)return true;
  if(shapePat(a))return true;                /* 6hp — a cloud is not a CSS border at all */
  const d=(a&&a.dash)||"solid";
  return d!=="solid";
}
/* 6iv — A SHAPE IS THE SIZE YOU DREW IT. Ced: "change the minimum size of the shapes possible to add,
   make sure that the thickness will not dictate the size of the shape. look at how i made a small
   shape but the box is still bigger."
   A shape's interior is a `contenteditable` box, and it was carrying the rule as a CSS BORDER and the
   text inset as CSS PADDING, both inside `box-sizing:border-box`. A border-box element cannot be
   narrower than its own border plus padding, so at 8pt a 14px box came out 28px wide, and even a
   hairline one could not go below about 12×7 because of the padding. The rule moves to the SVG outline
   — which is drawn INSIDE the box at the same half-stroke inset the file uses, so it costs no size at
   all — whenever it would otherwise be the thing setting the size, and the padding is capped at a
   quarter of the box so a small shape keeps its proportions instead of being held open by its insets. */
function shapeNeedsSvg(a,bw,bh){
  if(shapeSvgOutline(a))return true;
  const sw=markSw(a)*S.scale;
  return (sw*2+2)>=Math.min(bw,bh);
}
function shapeOf(a){ return (a&&a.shape)||(a&&a.box?"rect":null); }
/* =================================================================================================
   6k0 — HOW SMALL A MARK IS ALLOWED TO BE. ONE NUMBER, AND IT IS A FRACTION OF THE PAGE.
   Ced: "again, the minimum size of texts and shapes should not rely on thickness or size. allow the
   tool to the smallest sizes of shapes and texts for better accommodation of smaller spaces on the
   pdf."

   6iv fixed the half of this that is about DRAWING — a drag under 0.0016 of the page is a click, and
   `maAddShape` floors at 0.0012, about three quarters of a point — and left the other half alone.
   Measured before this change, with the SE handle dragged as far as it would go:

       shape, 0.5pt / 4pt / 10pt rule   ->  10 x 8 px, every time
       text box, 6pt / 14pt / 30pt      ->  14 x 11 px, 14 x 43 px, 14 x 90 px

   Two separate faults. The 10 and the 8 are literal CSS pixels written into the resize, so a shape
   you can DRAW a point wide cannot be RESIZED below about seven points — and the floor moves with the
   zoom, which means the same drag gives a different smallest box at 50% and at 200%. The 14 is the
   stylesheet's `min-width` on `.ed`, which a free box has no business obeying. And the 11/43/90 is the
   one Ced names: the box springs back to whatever the TEXT needs at its point size, so a 30pt note
   cannot be made small at all.

   The floor is now the same fraction of the page the draw gesture already uses, which makes it
   independent of the rule's weight, of the point size and of the zoom — a box half a point across is
   half a point across at any magnification. A text box being made shorter takes its type down with
   it, so the words fit the space rather than the space being held open by the words.
   ================================================================================================= */
/* 6k3 — the selection's ink, for the handles the SCRIPT draws (a stroke's round grips, the lasso).
   The same value the stylesheet's `--selink` carries; read off the stylesheet so the two cannot
   disagree, with the literal as the fallback for a browser that has not computed it yet. */
function selInk(){
  try{ const v=getComputedStyle(document.documentElement).getPropertyValue("--selink").trim();
       if(v)return v; }catch(e){}
  return "#1268d1";
}
const MARK_MIN_N=0.0012;                       /* ≈0.75pt on a 612pt page — a pen mark */
function markMinPx(px){ return Math.max(0.5, MARK_MIN_N*(px||0)); }

/* 6k1 — the empty text box, taken away quietly. No history entry: nothing was ever put on the page,
   so there is nothing to undo, and pushing one would make Ctrl+Z bring the blank box BACK. */
function dropEmptyText(id){
  const a=S.annos.find(z=>z.id===id);
  if(!a||!isTextBox(a))return false;
  if(String(a.text||"").replace(/[\s ]/g,""))return false;
  const d=markEl(id);
  if(d&&d.classList.contains("editing"))return false;      /* the caret came back to it */
  S.annos=S.annos.filter(z=>z.id!==id);
  if(S.sel===id)selectAnno(null);
  S.selMulti.delete(id);
  layoutAnnos(); updateRail(); updateCount();
  try{ setStatus("Empty text box discarded."); }catch(e){}
  return true;
}
/* A TEXT BOX is a box you type in: drawn to a size, wrapped inside it, and resized in both axes from
   the moment it exists. It is not a cell redline — that one takes its size from the printed value it
   covers — and it is not a shape, because it has no rule around it unless you give it one. */
function isTextBox(a){ return !!(a&&a.maKind==="text"); }
function isFreeBox(a){ return isShape(a)||isTextBox(a); }

/* ================= 6f6 — the rest of a mark's look ================================================
   Everything the per-tool properties panels can set beyond colour and thickness. One definition each,
   read by the screen and by the export, so the two cannot drift.
   ================================================================================================= */
/* The ink's own opacity. Separate from `fillOp`, which is the interior's: a hollow red box at 40%
   ink and a solid one at 40% interior are two different marks. */
function markColOp(a){ const v=(a&&a.colOp!=null)?a.colOp:1; return Math.max(0,Math.min(1,v)); }

/* =================================================================================================
   6jb — A PICTURE'S FRAME FOLLOWS THE PICTURE, NOT ITS BOX.
   Ced: "the border should be within the photos that are not transparent and not on the box. it should
   be the shape's border whether it is irregular." v32 drew the frame as a CSS border on the mark's box
   and as a `re S` rectangle in the file — so a snapshot with its background wanded away, or a corner
   rubbed out, got a rectangle round the empty air it used to fill.
   The frame is drawn INTO THE PICTURE instead: the picture's own alpha is stamped round a circle at the
   frame's radius in the frame's colour, and the picture is laid on top. What you get is an outline that
   hugs whatever shape is actually left, however ragged, and — because it is pixels — the screen, the
   print and the exported file cannot disagree about it. The un-framed picture is kept as `picRaw`, so
   the width can be changed or taken off again at any time, and the editor always opens the picture
   itself rather than the picture plus its frame.
   ================================================================================================= */
/* =================================================================================================
   6jc — NAMED LAYERS.
   Ced sent a picture of Bluebeam's layer list — a column of names, a tick against the one being drawn
   into, and "Create layer" at the foot — and asked for "something like this on the layers". The tool
   already had a STACK (what is in front of what); what it had no notion of was a NAME you could put a
   set of marks under and then turn off as a set. That is what this is: every mark belongs to a layer,
   new marks join whichever layer is current, and a layer can be renamed, hidden or emptied out.
   Hidden means hidden everywhere — on screen, in the redline count, and in the exported file — because
   a layer you have switched off is one you have decided is not part of this drawing today.
   ================================================================================================= */
function maLayers(){
  if(!S.layers||!S.layers.length){
    S.layers=[{id:1,name:"General",vis:true}];
    S.layCur=1;
  }
  if(S.layCur==null||!S.layers.some(L=>L.id===S.layCur))S.layCur=S.layers[0].id;
  return S.layers;
}
function maLayer(id){ return maLayers().find(L=>L.id===id)||maLayers()[0]; }
function maLayerOf(o){
  const ls=maLayers();
  return (o&&o.lay!=null&&ls.some(L=>L.id===o.lay))?o.lay:ls[0].id;
}
function maLayerHidden(o){ const L=maLayer(maLayerOf(o)); return !!(L&&L.vis===false); }
function maLayerAdd(name){
  const ls=maLayers();
  const id=(ls.reduce((m,L)=>Math.max(m,L.id),0)||0)+1;
  ls.push({id,name:String(name||("Layer "+id)).slice(0,60),vis:true});
  S.layCur=id;
  return id;
}
function maLayerRemove(id){
  const ls=maLayers();
  if(ls.length<2)return false;                 /* there is always somewhere for a mark to live */
  const keep=ls.find(L=>L.id!==id).id;
  S.annos.forEach(a=>{ if(maLayerOf(a)===id)a.lay=keep; });
  S.lines.forEach(l=>{ if(maLayerOf(l)===id)l.lay=keep; });
  S.layers=ls.filter(L=>L.id!==id);
  if(S.layCur===id)S.layCur=keep;
  return true;
}
function maLayerCount(id){
  return (S.annos||[]).filter(a=>maLayerOf(a)===id).length
       + (S.lines||[]).filter(l=>maLayerOf(l)===id).length;
}
/* a mark made while a layer is current belongs to it. Rather than thread this through the forty places
   a mark can be made, it is stamped on the next layout — which is the first thing that happens after
   any of them, and is also where a document saved before layers existed picks up its default. */
function maLayerStamp(){
  const d=maLayers()[0].id, cur=(S.layCur!=null?S.layCur:d);
  (S.annos||[]).forEach(a=>{ if(a.lay==null)a.lay=cur; });
  (S.lines||[]).forEach(l=>{ if(l.lay==null)l.lay=cur; });
  /* 6ln — AND THE TWO OLD SEQUENCES ARE MERGED, ONCE PER DOCUMENT. Until now a mark's z and a stroke's
     z were renumbered 1..n inside their own array, so a file written before this carries a mark at
     z=3 and a stroke at z=3 that mean nothing to each other. Comparing them without merging first
     would order a page by which array a thing happened to be in. This runs on the first layout after
     a document arrives, and then not again: afterwards every z is already on the one scale, and
     renumbering on every layout would churn values that a drag is in the middle of reading. */
  try{
    if(!S._zMerged&&(S.pages||[]).length){
      S._zMerged=1;
      for(let pi=0;pi<S.pages.length;pi++){ bandRenumber(pi,true); bandRenumber(pi,false); }
    }
  }catch(e){}
}
function maPicUnframed(a){ return (a&&a.picRaw)||(a&&a.src)||""; }
/* ==================================================================================================
   6le — THE UNFRAMED PICTURE, RECOVERED BY CROPPING WHEN IT WAS NOT CARRIED.
   `picRaw` no longer travels in the file (see `_stripPicBytes`), so a framed photo comes back from a
   reopen with its frame in its pixels and no separate copy of what was underneath. That costs nothing,
   because the frame is drawn AROUND the picture and the picture is drawn on top of it last:
   `maPicFrame` stamps the silhouette round a circle of radius `pad` and then does
   `g.drawImage(im,pad,pad)` at full alpha, into a lossless PNG. So the rectangle inset by `_frPadX` /
   `_frPadY` IS the original, pixel for pixel, and cropping it back out is exact.
   The one case where it is not exact is a picture with transparency in it, where the ring shows
   through the holes by design and a crop would bake that showing-through in. A photo has no holes; and
   the alternative on offer was losing the photo altogether.
   ================================================================================================== */
function maPicRawOf(a){
  if(!a)return Promise.resolve("");
  if(a.picRaw)return Promise.resolve(a.picRaw);
  const px=+a._frPadX||0, py=+a._frPadY||0;
  if(!(a.src&&px>0&&py>0&&px<0.5&&py<0.5))return Promise.resolve(a.src||"");
  return new Promise(res=>{
    const im=new Image();
    im.onerror=()=>res(a.src||"");
    im.onload=()=>{
      try{
        const iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height;
        const sx=Math.round(iw*px), sy=Math.round(ih*py);
        const cw=Math.max(1,iw-sx*2), ch=Math.max(1,ih-sy*2);
        const cv=document.createElement("canvas"); cv.width=cw; cv.height=ch;
        cv.getContext("2d").drawImage(im,sx,sy,cw,ch,0,0,cw,ch);
        const url=cv.toDataURL("image/png");
        cv.width=cv.height=0;
        LOG&&LOG("recovered a photo's unframed picture by cropping",iw+"x"+ih,"to",cw+"x"+ch);
        res(url);
      }catch(e){ res(a.src||""); }
    };
    im.src=a.src;
  });
}
/* the pads are fractions of the FRAMED box, so the un-framed box survives the mark being resized */
function maPicBox(a){
  const px=a._frPadX||0, py=a._frPadY||0;
  return { nx:a.nx+(a.nw||0)*px, ny:a.ny+(a.nh||0)*py,
           nw:(a.nw||0)*(1-2*px), nh:(a.nh||0)*(1-2*py) };
}
function maPicFrameKey(a){
  return [(+a.sw||0).toFixed(2), markCol(a), markColOp(a).toFixed(2)].join("|");
}
/* is the frame in the pixels already? the screen and the export both ask, so neither draws it twice */
function maPicFramed(a){ return !!(a&&a.kind==="img"&&a.picRaw&&a._frKey===maPicFrameKey(a)); }
function maPicFrameStale(a){ return !!(a&&a.kind==="img"&&a.src&&a._frKey!==maPicFrameKey(a)); }
function maPicFrame(a){
  if(!a||a.kind!=="img"||a._frBusy)return Promise.resolve(false);
  const key=maPicFrameKey(a);
  if(a._frKey===key)return Promise.resolve(false);
  /* 6le — ask for the unframed picture rather than reading a field that may not have travelled. On a
     mark that still carries `picRaw` this is the same value it always was and resolves at once. */
  a._frBusy=true;
  return maPicRawOf(a).then(raw=>{ a._frBusy=false; return _maPicFrameWith(a,key,raw); });
}
function _maPicFrameWith(a,key,raw){
  if(!raw)return Promise.resolve(false);
  const B=maPicBox(a);                    /* the picture's own box, whatever the frame is doing */
  const sw=+(a.sw||0);
  if(!(sw>0)){
    /* no frame: the picture goes back to being itself, box and all */
    a.src=raw; a.picRaw=undefined;
    a.nx=B.nx; a.ny=B.ny; a.nw=B.nw; a.nh=B.nh;
    a._frPadX=a._frPadY=0; a._frKey=key;
    return Promise.resolve(true);
  }
  a._frBusy=true;
  return new Promise(res=>{
    const im=new Image();
    im.onerror=()=>{ a._frBusy=false; res(false); };
    im.onload=()=>{
      try{
        const iw=im.naturalWidth||im.width, ih=im.naturalHeight||im.height;
        const P=(S.pages&&S.pages[a.page])||{}; const W=P.w1||612, H=P.h1||792;
        const uw=Math.max(1,(B.nw||0.2)*W);     /* the picture's width in POINTS on the sheet */
        /* the frame is set in points, so it is that many points of paper thick whatever resolution the
           picture happens to carry */
        let pad=Math.round(sw*(iw/uw));
        pad=Math.max(1,Math.min(Math.round(Math.max(iw,ih)*0.4),pad));
        const ow=iw+pad*2, oh=ih+pad*2;
        /* the silhouette: the picture's alpha, filled flat in the frame's colour */
        const sil=document.createElement("canvas"); sil.width=iw; sil.height=ih;
        const sg=sil.getContext("2d");
        sg.drawImage(im,0,0);
        sg.globalCompositeOperation="source-in";
        sg.fillStyle=markCol(a); sg.fillRect(0,0,iw,ih);
        const out=document.createElement("canvas"); out.width=ow; out.height=oh;
        const g=out.getContext("2d");
        /* stamped round a circle at the frame's radius. Enough stamps that the ring has no gaps at the
           radius being drawn — twice the circumference in stamps is plenty — and two rings so a thick
           frame is solid rather than an outline of an outline. */
        g.globalAlpha=markColOp(a);
        const rings=(pad>3)?[pad,pad*0.55]:[pad];
        rings.forEach(r=>{
          const k=Math.max(12,Math.min(96,Math.ceil(r*6)));
          for(let i=0;i<k;i++){
            const t=(i/k)*Math.PI*2;
            g.drawImage(sil,pad+Math.cos(t)*r,pad+Math.sin(t)*r);
          }
        });
        g.globalAlpha=1;
        g.drawImage(im,pad,pad);
        a.picRaw=raw;
        a.src=out.toDataURL("image/png");
        a._frPadX=pad/ow; a._frPadY=pad/oh;
        /* the picture stays exactly where it was; the frame grows outward round it */
        const cx=B.nx+B.nw/2, cy=B.ny+B.nh/2;
        a.nw=B.nw*(ow/iw); a.nh=B.nh*(oh/ih);
        a.nx=cx-a.nw/2; a.ny=cy-a.nh/2;
        a._frKey=key;
        sil.width=sil.height=0;
      }catch(e){ LOG&&LOG("picture frame failed",e&&e.message); }
      a._frBusy=false;
      res(true);
    };
    im.src=raw;
  });
}
/* one pass over whatever needs re-framing, then one re-layout — called from `layoutAnnos`, which is
   where a changed width or colour first shows up */
let _frPass=0;
function maPicFramePass(){
  if(_frPass)return;
  const want=(S.annos||[]).filter(maPicFrameStale);
  if(!want.length)return;
  _frPass=1;
  Promise.all(want.map(a=>maPicFrame(a))).then(any=>{
    _frPass=0;
    if(any.some(Boolean)){ try{ layoutAnnos(); }catch(e){} try{ autosave(); }catch(e){} }
  });
}

/* 6he — LETTER AND LINE SPACING. Ced: "in text settings across all tools, add the ability to change
   the spacing per letter and per line." Two numbers, one meaning each:
     `lsp`  tracking — POINTS added after every glyph, 0 being the face's own. Negative tightens.
     `lnsp` leading  — the line pitch as a MULTIPLE of the normal one, 1 being the face's own.
   Both are read from one place by the screen and by the export, so a mark cannot space one way on
   screen and another in the file: `letter-spacing` and a multiplier on the line box here, the `Tc`
   operator and the same multiplier on the line step there. Tracking also widens the text, so every
   measurement — the wrap, the centring, the box a mark grows to — has to ask for it too. */
function markLsp(a){ const v=(a&&a.lsp!=null)?+a.lsp:0;
  return isFinite(v)?Math.max(-2,Math.min(8,v)):0; }
function markLnsp(a){ const v=(a&&a.lnsp!=null)?+a.lnsp:1;
  return (isFinite(v)&&v>0)?Math.max(0.6,Math.min(3,v)):1; }

/* LINE STYLES. 6hc — Ced: "make the dashed lines constant as well, and not vary spacing per
   thickness. just make it constant and with various versions of length of dashlines."
   These numbers used to be MULTIPLIERS on the stroke width, which is what every drawing program
   does — but it means a 0.5pt dashed rule and a 6pt one beside it march to different rhythms, and
   on a redlined sheet the two read as two different conventions rather than one. So the table is
   now in POINTS, flat: a dash is 4pt long wherever it is drawn, at any weight, at any zoom. The
   dash LENGTH is the thing you choose instead, and there are six of them, shortest to longest.
   `null` is solid. The old five keys are all still here, so every file drawn before this reads. */
const MARK_DASH={
  solid:      null,
  dot:        [0.1, 2.4],
  finedash:   [1.8, 1.8],
  dash:       [4,   3],
  longdash:   [9,   4],
  xlongdash:  [16,  5],
  dashdot:    [7,   3, 0.1, 3],
  dashdotdot: [7,   3, 0.1, 3, 0.1, 3]
};
function dashOf(o){ const k=(o&&o.dash)||"solid"; return MARK_DASH[k]||null; }
/* The one place thickness still has a say, and it is a correctness floor rather than a style: a DOT
   is a zero-length segment drawn with a ROUND cap, so it comes out as wide as the stroke. Hold the
   gap at a flat 2.4pt and a 6pt dotted rule has its dots overlapping into a solid line. So gaps in
   the dotted families — and only those — are floored at the stroke width, which leaves every gap
   untouched up to about 2pt and keeps a heavy dotted rule reading as dots. Dashes never move. */
function dashFit(arr,kind,w){
  if(!dashRound(kind))return arr;
  return arr.map((n,i)=>(i%2===1)?Math.max(n,w+0.4):n);
}
/* Which patterns hold a zero-length segment, and so must be drawn with a ROUND cap: with a butt cap
   a zero-length segment draws nothing at all, which is why the dot in a dash-dot rule used to be
   missing on screen and in the export alike. `true` here is `stroke-linecap:round` and `1 J`. */
function dashRound(kind){ return kind==="dot"||kind==="dashdot"||kind==="dashdotdot"; }
/* in points, for the PDF `d` operator */
function dashPdf(o,sw){ const d=dashOf(o); if(!d)return null;
  const w=Math.max(0.4,sw||1);
  return dashFit(d,(o&&o.dash)||"solid",w).map(n=>+n.toFixed(2)); }
/* In CSS pixels, for the SVG the screen draws. The table is in points, so the only conversion is the
   zoom — never the weight. `scl` overrides it for the little previews on the property chips, which
   are drawn at their own fixed size and must not grow when the page is zoomed in. */
function dashCss(o,swPx,scl){ const d=dashOf(o); if(!d)return null;
  const sc=(scl!=null)?scl:(((typeof S!=="undefined")&&S&&S.scale)?S.scale:1);
  const w=Math.max(0.4,(swPx||1)/(sc||1));            /* back to points, so the floor is one rule */
  return dashFit(d,(o&&o.dash)||"solid",w).map(n=>+(n*sc).toFixed(2)).join(","); }

/* LINE ENDINGS, one per end. `arrow` is the old single field and still speaks for any stroke that has
   no endings of its own, so nothing drawn before this reads differently. */
/* 6ga — Ced: "add more line start and endings." Twelve now, which is the grid he sent and also every
   ending PDF has a standard name for, so a reader that ignores our appearance stream still draws
   something close: the four plain heads, the four reverse/open variants, a half arrow (one barb, the
   surveyor's leader), a slash, an open circle and a bar. */
const MARK_ENDS=["","arrow","oarrow","rarrow","roarrow","harrow","hrarrow",
                 "circle","ocircle","square","diamond","slash","butt"];
function endsOf(l){
  if(!l)return ["",""];
  if(l.le0!=null||l.le1!=null)return [l.le0||"",l.le1||""];
  const a=l.arrow;
  return [ (a==="start"||a==="both")?"arrow":"", (a==="end"||a==="both")?"arrow":"" ];
}
/* Keep `arrow` in step with the endings, so the reopen path, the line bar's ↗ cycle and every older
   reader still see a stroke the same way. */
function syncArrowFlag(l){
  const [s,e]=endsOf(l);
  const hs=/arrow/.test(s), he=/arrow/.test(e);
  l.arrow = (hs&&he)?"both":(he?"end":(hs?"start":undefined));
}

/* STROKE PATTERNS — what the line itself does between its corners. Straight is a straight run; the
   rest ripple it. The shape is produced as EXTRA POINTS along the same path, so everything downstream
   (the screen's polyline, the export's path, the hit strip, the endings' angles) keeps working on a
   plain list of points and nothing else had to learn about it. */
const MARK_LINEPATS={ straight:null, wave:"sin", zigzag:"tri", saw:"saw", cloud:"bump" };
function linePatOf(l){ const k=(l&&l.lpat)||"straight"; return MARK_LINEPATS[k]?k:"straight"; }
function decoratePts(l,pts,unit){
  const k=linePatOf(l); const mode=MARK_LINEPATS[k]; if(!mode||pts.length<2)return pts;
  /* 6i9 — A CLOUD IS ARCS. Ced sent the shape he means: even semicircular bumps, all bulging the same
     way, meeting cleanly at the corners. The old cloud was `|sin|` sampled along the run, which gives
     a row of pointed cusps — a scallop shape, not a cloud — and its period did not divide the side it
     was drawn on, so every corner ended mid-bump. Each straight run is now divided into a WHOLE number
     of bumps and each bump is drawn as a half-circle standing on its own chord, which is what a
     revision cloud is. The other four patterns get the same whole-number division, so their corners
     come out clean too. */
  const amp=Math.max(1.6,(unit||2)*1.7);          /* the ripple scales with the stroke's own weight */
  const period=(mode==="bump")?amp*2.6:amp*4.4;   /* one bump, or one wave */
  const out=[];
  const push=(x,y)=>{ const n=out.length;
    if(n&&Math.abs(out[n-1][0]-x)<1e-9&&Math.abs(out[n-1][1]-y)<1e-9)return;
    out.push([x,y]); };
  for(let i=0;i<pts.length-1;i++){
    const [x1,y1]=pts[i], [x2,y2]=pts[i+1];
    const dx=x2-x1, dy=y2-y1, len=Math.hypot(dx,dy);
    if(len<1e-6)continue;
    const ux=dx/len, uy=dy/len;
    /* the OUTWARD side of a closed run walked clockwise on screen, which is the side a cloud bulges */
    const nx=uy, ny=-ux;
    if(i===0)push(x1,y1);
    const n=Math.max(1,Math.round(len/period));
    const step=len/n;
    if(mode==="bump"){
      /* 6ih — AND EACH SCALLOP CARRIES ITS NOTCH. Ced's reference is not a row of touching
         half-circles: every arc swings a little PAST its chord at both ends, so where two of them
         meet there is a small hook turning back into the shape. That notch is what makes a hand-drawn
         revision cloud read as one, and 6i9's exact semicircles met flush and read as a scallop
         border. `EXT` is how far past each end the arc goes, in radians. */
      const r=step/2, SEG=11, EXT=0.32;
      const SPAN=Math.PI+EXT*2;
      for(let b=0;b<n;b++){
        const d0=b*step, cx=x1+ux*(d0+r), cy=y1+uy*(d0+r);
        for(let t=0;t<=SEG;t++){
          const th=-EXT+SPAN*(t/SEG);             /* just before the chord, round, just past it */
          const along=-Math.cos(th)*r, outw=Math.sin(th)*r;
          push(cx+ux*along+nx*outw, cy+uy*along+ny*outw);
        }
      }
      continue;
    }
    const SEG=Math.max(6,Math.round(step/Math.max(1.2,amp/2.6)));
    for(let b=0;b<n;b++){
      for(let t=1;t<=SEG;t++){
        const f=t/SEG, d=b*step+step*f, ph=f*Math.PI*2;
        let o=0;
        if(mode==="sin")o=Math.sin(ph)*amp;
        else if(mode==="tri")o=(2/Math.PI)*Math.asin(Math.sin(ph))*amp;
        else if(mode==="saw")o=(f*2-1)*amp;
        /* the ends stay put, so an ending still points where the stroke was drawn to */
        if(i===pts.length-2&&b===n-1&&t===SEG)o=0;
        push(x1+ux*d+nx*o, y1+uy*d+ny*o);
      }
    }
  }
  return out.length>=2?out:pts;
}

/* 6hp — A CLOUD ROUND A SHAPE.
   Ced: "also add a cloud style on shapes." A revision cloud is the one border every redliner draws by
   hand, and the tool already knew how to make one — `decoratePts` ripples a STROKE, and `cloud` is one
   of its patterns. What it could not do was ripple a box, because a box was drawn as a rectangle or an
   ellipse and never as a run of points.

   So a shape's outline is produced as a closed POINT LIST, and the same `decoratePts` that scallops a
   line scallops it: one description of what a cloud is, used by the screen and by the export. The list
   is closed (the last point is the first), so the scallops run continuously round the corners instead
   of restarting on each side, and they all bulge the same way because the normal of a closed loop is
   consistent all the way round. */
function shapeOutlinePts(a,bw,bh,ins){
  const pts=[];
  if(shapeOf(a)==="ellipse"){
    const cx=bw/2, cy=bh/2, rx=Math.max(0.5,bw/2-ins), ry=Math.max(0.5,bh/2-ins);
    const n=Math.max(24,Math.round((rx+ry)/2));
    for(let i=0;i<n;i++){ const t=i/n*Math.PI*2; pts.push([cx+Math.cos(t)*rx, cy+Math.sin(t)*ry]); }
  }else{
    const x0=ins, y0=ins, x1=Math.max(ins+1,bw-ins), y1=Math.max(ins+1,bh-ins);
    pts.push([x0,y0],[x1,y0],[x1,y1],[x0,y1]);
  }
  pts.push(pts[0].slice());                 /* closed: the run comes back to where it started */
  return pts;
}
/* Does this shape's rule carry a pattern? `straight` and nothing are the same answer. */
function shapePat(a){ const k=(a&&a.lpat)||"straight"; return (k!=="straight"&&MARK_LINEPATS[k])?k:null; }
/* The finished outline, rippled if it has a pattern, as a list of points in the mark's own box. */
function shapeOutlineRun(a,bw,bh,ins,unit){
  const pts=shapeOutlinePts(a,bw,bh,ins);
  if(!shapePat(a))return pts;
  const out=decoratePts({lpat:a.lpat},pts,unit);
  /* decoratePts holds its two ENDS still so an arrowhead keeps its aim; on a closed loop that leaves
     one flat spot, so the run is closed back onto its own first point. */
  if(out.length>2)out[out.length-1]=out[0].slice();
  return out;
}

/* HATCH PATTERNS for a shape's interior. Each is a list of line families drawn inside the shape:
   `a` is the angle in degrees, `g` the gap between lines as a multiple of the pattern scale. Drawn
   rather than tiled so the same seven lines of code produce them on the canvas and in the PDF. */
const MARK_PATTERNS={
  "":        null,
  diag:      [{a:45,g:1}],
  rdiag:     [{a:-45,g:1}],
  cross:     [{a:45,g:1},{a:-45,g:1}],
  grid:      [{a:0,g:1},{a:90,g:1}],
  horz:      [{a:0,g:1}],
  vert:      [{a:90,g:1}],
  dense:     [{a:45,g:0.5},{a:-45,g:0.5}],
  wide:      [{a:45,g:2}],
  /* 6g1 — the hatch Ced sent: a lattice of dots rather than a run of lines. `dot:true` tells the
     segment generator to emit a point at every crossing instead of a continuous line, which both
     renderers already draw as a round-capped zero-length stroke. */
  dots:      [{a:0,g:1,dot:true}],
  finedots:  [{a:0,g:0.55,dot:true}]
};
function patOf(a){ const k=(a&&a.pat)||""; return MARK_PATTERNS[k]||null; }
/* 6g9 — A DOT LATTICE IS A ZERO-LENGTH STROKE, and a zero-length stroke with a BUTT cap paints
   nothing at all — the same fault the dotted rule had in v5, in a second place. Every renderer
   asks this before it sets a cap, and the CSS one tiles its gradient instead of drawing one dot
   the size of the whole shape, which is why Ced could not see the hatch anywhere. */
function patIsDot(a){ const f=patOf(a); return !!(f&&f[0]&&f[0].dot); }
function patColOf(a){ return (a&&a.patCol)||markCol(a); }
function patStepOf(a){ return Math.max(2,6*((a&&a.patScale!=null?a.patScale:100)/100)); }
function patRotOf(a){ return (a&&a.patRot)||0; }
function patOpOf(a){ const v=(a&&a.patOp!=null)?a.patOp:1; return Math.max(0,Math.min(1,v)); }
/* The hatch as line segments inside a w×h box, in that box's own coordinates. Both renderers walk
   this list; the screen draws it into an SVG overlay, the export writes it as clipped path ops. */
/* The same hatch as CSS, for the box on screen. Layered gradients rather than an SVG child, because
   the element is contenteditable and a child would become part of what you type into it. */
function patCss(a){
  const fam=patOf(a); if(!fam)return "none";
  const step=patStepOf(a)*(typeof S!=="undefined"?S.scale:1), rot=patRotOf(a);
  const c=_rgbaOf(patColOf(a),patOpOf(a));
  const lw=Math.max(1,step*0.2);
  if(fam[0]&&fam[0].dot){
    /* 6g1 — a lattice of dots, as a radial gradient tiled on the same step the export uses.
       6g9 — a radial gradient does NOT repeat on its own: without a background-size it drew ONE dot
       the size of the shape, faded to nothing, which is exactly "dotted hatch is not visible". */
    const gap=Math.max(3,step*fam[0].g);
    const r=Math.max(0.9,gap*0.16);
    return `radial-gradient(circle at 50% 50%, ${c} 0 ${r.toFixed(2)}px, transparent ${(r+0.6).toFixed(2)}px)`;
  }
  return fam.map(f=>{
    const gap=Math.max(3,step*f.g);
    return `repeating-linear-gradient(${(f.a+rot+90)}deg, ${c} 0, ${c} ${lw.toFixed(2)}px,`+
           ` transparent ${lw.toFixed(2)}px, transparent ${gap.toFixed(2)}px)`;
  }).join(",");
}
/* The tile the hatch repeats on. Only a dot lattice needs one — the line families are repeating
   gradients and size themselves. */
function patCssSize(a){
  const fam=patOf(a); if(!fam||!fam[0]||!fam[0].dot)return "auto";
  const step=patStepOf(a)*(typeof S!=="undefined"?S.scale:1);
  const gap=Math.max(3,step*fam[0].g);
  return gap.toFixed(2)+"px "+gap.toFixed(2)+"px";
}
/* The CSS border-style that matches the mark's line style. Only three of the five have a CSS
   equivalent; the others read closest as dashed, and the export draws all five exactly. */
function borderStyleOf(a){
  const k=(a&&a.dash)||"solid";
  return (k==="dot")?"dotted":((k==="solid")?"solid":"dashed");
}
/* Where a box's text sits vertically. */
function flexVAlign(a,dflt){
  const v=a&&a.valign;
  return v==="top"?"flex-start":(v==="bottom"?"flex-end":(v==="middle"?"center":dflt));
}
/* 6hj — the same three positions as `align-content` on the grid the boxes now are, and as the one
   word the export reads. `start` is the top of the box, which is where a text box fills from. */
/* =================================================================================================
   6kd — HOW FAR A MARK'S TEXT SITS INSIDE ITS OWN BOX, IN POINTS. ONE DEFINITION.
   Ced: "no minimum indentation on texts whether horizontal or vertical. making the text small should
   not compensate for its size."

   A SHAPE keeps an inset, because its text would otherwise run under its own rule — but capped at a
   quarter of the box, so a small shape is not held open by its insets (6iv). A TEXT BOX gets none at
   all: it has no rule to clear, and a constant inset is a bigger share of a 4pt note than of a 24pt
   one, so the small end of the range was paying for it.

   The screen and the export both read this. They used to disagree — the screen inset a text box by
   1x2pt and the export by 2pt a side with 4pt taken out of the wrap width — which is a wrap that
   happens in a different place in the file from on the sheet. One function, one answer.
   ================================================================================================= */
function markTextInset(a,bwPt,bhPt){
  if(!a||!isShape(a))return {x:0,y:0};
  const sw=markSw(a)||0;
  return {
    x:Math.max(0,Math.min(4+sw,(bwPt||0)/4)),
    y:Math.max(0,Math.min(2+sw,(bhPt||0)/4))
  };
}
/* 6l3 — and the DEFAULT is translated too, not passed through raw. This used to read `a.valign`
   and hand back `dflt` untouched, so the default had to be written in CSS words ("center") while
   `vAlignFrac` wanted the mark's own ("middle") — two vocabularies for one rule, which is how a
   shared default would have gone in as the literal string `middle` and been ignored by the grid.
   Either word is understood now; "start" is still the fallback for anything else. */
function gridVAlign(a,dflt){
  const v=(a&&a.valign)||dflt;
  return v==="top"?"start":(v==="bottom"?"end":((v==="middle"||v==="center")?"center":"start"));
}
/* Where a block of text sits in the box it is in, as a fraction: 0 at the top, 0.5 centred, 1 at the
   bottom. One definition, read by the screen through `gridVAlign` and by the export directly, so a
   mark cannot fill from the top on screen and from the middle in the file. */
function vAlignFrac(a,dflt){
  const v=(a&&a.valign)||dflt;
  return v==="middle"?0.5:(v==="bottom"?1:0);
}
/* =================================================================================================
   6l3 — WHERE A FREE BOX'S BLOCK SITS WHEN NOTHING TELLS IT. ONE DEFINITION, READ BY BOTH.
   Ced: "please make sure the redlines are rendered exactly how it was showing on the tool. look at
   before and after."

   Measured off Ced's two screenshots of the same stamp — the frame's inner height is the only unit
   both images share, so every edge is given as a fraction of it:

       band        on screen   exported    out by
       title top     0.0781      0.0577     -0.0204
       title bottom  0.2813      0.2500     -0.0313
       row 1 top     0.4063      0.3846     -0.0217
       row 2 top     0.5938      0.5673     -0.0265
       row 3 bottom  0.9063      0.8750     -0.0313

   Every line of it sits high in the file by the same ~0.025 of the box — about a point. Not a
   rounding error and not a font difference: a uniform shift is a placement rule, and there were two
   of them. 6kc (v39) made a text box's block sit in the MIDDLE of its box on screen — Ced: "make
   sure texts are always in the middle vertically and horizontally first" — and changed only the
   screen. The export kept 6hi's older default of TOP, and 6hi's own comment ("`vAlignFrac` is the
   same rule the grid on screen is given, so the two cannot part") had quietly stopped being true.

   Until 6kn the export's 1pt `padV` happened to cover most of the gap, because the stamp's row boxes
   carried a matching 1pt of slack (`COP_EDY`); taking both away at once left the difference naked,
   which is what Ced is looking at. The default lives here now and both sides ask for it, so a
   change to one cannot leave the other behind again.
   ================================================================================================= */
function freeVAlignDflt(a){ return "middle"; }
/* The two text decorations, as one CSS value. */
function textDecoOf(a){
  const bits=[];
  if(a&&a.uline)bits.push("underline");
  if(a&&a.strikeout)bits.push("line-through");
  return bits.length?bits.join(" "):"none";
}
function patSegments(a,w,h){
  const fam=patOf(a); if(!fam)return [];
  const step=patStepOf(a), rot=patRotOf(a);
  const cx=w/2, cy=h/2, R=Math.hypot(w,h)/2+step;
  const out=[];
  fam.forEach(f=>{
    const th=(f.a+rot)*Math.PI/180, c=Math.cos(th), s=Math.sin(th);
    const gap=Math.max(1.5,step*f.g);
    if(f.dot){
      /* a lattice: one zero-length segment at every crossing, which both renderers draw as a dot
         because the pattern stroke is round-capped */
      for(let u=-R;u<=R;u+=gap)for(let v=-R;v<=R;v+=gap){
        const x=cx+c*u-s*v, y=cy+s*u+c*v;
        if(x<-gap||y<-gap||x>w+gap||y>h+gap)continue;
        out.push([x,y,x,y]);
      }
      return;
    }
    for(let d=-R;d<=R;d+=gap){
      out.push([ cx-c*R-s*d, cy-s*R+c*d, cx+c*R-s*d, cy+s*R+c*d ]);
    }
  });
  return out;
}

/* 6gl — THE OUTLINE AN ELLIPSE OR A DASHED SHAPE IS DRAWN WITH, IN ONE PLACE.
   Ced: "sometimes adjusting the shapes breaks it" — a picture of a shape with its red outline sitting
   beside the box it belongs to. The outline is an SVG child of the mark (a CSS border cannot draw an
   ellipse or a dash that meets its corners), and it was built ONLY in `layoutAnnos`: a resize changes
   the element and the mark's numbers, and nothing rebuilt the outline, during the drag or after it. So
   the box moved and its outline stayed exactly where it was. It is a function now, called by the
   layout and by the resize on every pointermove, and the release lays the marks out again. */
function paintShapeOutline(d,a,w,h,force){
  if(!d)return;
  const old=d.querySelector(":scope > svg.shapeoutline");
  if(old)old.remove();
  if(!(force||shapeSvgOutline(a)))return;
  const NS="http://www.w3.org/2000/svg";
  const bw=(a.nw||0.1)*w, bh=(a.nh||0.06)*h;
  const sw=Math.max(0.22,markSw(a)*S.scale), ins=sw/2;   /* 6gt — a hairline is faint, not absent */
  const ov=document.createElementNS(NS,"svg");
  ov.setAttribute("class","shapeoutline");
  ov.setAttribute("width",bw); ov.setAttribute("height",bh);
  ov.setAttribute("viewBox","0 0 "+bw+" "+bh);
  const put=(tag,attrs)=>{ const n=document.createElementNS(NS,tag);
    for(const k in attrs)n.setAttribute(k,attrs[k]); ov.appendChild(n); };
  const base={fill:"none",stroke:_rgbaOf(markCol(a),markColOp(a)),"stroke-width":sw,
              "stroke-linecap":capCss(a),"stroke-linejoin":joinCss(a),"stroke-miterlimit":8};
  const dsh=dashCss(a,sw);
  if(dsh){ base["stroke-dasharray"]=dsh;
           base["stroke-linecap"]=dashRound(a.dash||"solid")?"round":"butt"; }
  if(shapePat(a)){
    /* 6hp — a patterned rule is the outline walked as points and rippled */
    const run=shapeOutlineRun(a,bw,bh,ins,sw);
    put("polygon",Object.assign({points:run.map(p=>p[0].toFixed(2)+","+p[1].toFixed(2)).join(" "),
                                 "stroke-linejoin":joinCss(a),"stroke-miterlimit":8},base));
  }
  else if(shapeOf(a)==="ellipse")
    put("ellipse",Object.assign({cx:bw/2,cy:bh/2,
          rx:Math.max(0.5,bw/2-ins),ry:Math.max(0.5,bh/2-ins)},base));
  else
    put("rect",Object.assign({x:ins,y:ins,
          width:Math.max(1,bw-sw),height:Math.max(1,bh-sw)},base));
  if(a.hl)ov.style.mixBlendMode="multiply";
  d.appendChild(ov);
}
/* 6ir — A GROUP IS ONE LAYER. Ced: "the callouts are not acting as one in layer… all shapes, lines,
   textbox, and grouped items should be in one layer if they are grouped."
   Until now a group was only a group to the COMMANDS: front, back and the two steps moved its parts
   together, but the parts were still drawn in the four page-wide levels — every stroke under every
   mark — so a callout's leader could not be above a photograph its own box was above, and anything
   drawn in between slid into the middle of the group. A group is now drawn into a CONTAINER of its
   own, one element sitting at the group's own place in the stack, with its marks and its strokes
   inside it. Nothing can come between them, and moving the group moves all of it.
   What counts as one group: marks and strokes that carry the same `group`, and a box together with
   the stroke that answers to it — a callout's leader, a strike's rule, a measurement's line. */
function groupKeyOf(o){
  if(!o)return null;
  if(o.group!=null)return "g"+o.group;
  if(o.coFor!=null)return "a"+o.coFor;
  if(o.dimFor!=null)return "a"+o.dimFor;
  /* a box that owns its leader — or its measurement's run — is the other half of the same pair */
  try{
    if(o.nx!=null&&(S.lines||[]).some(l=>l.coFor===o.id||l.dimFor===o.id))return "a"+o.id;
  }catch(e){}
  return null;
}
/* the container a group's parts are drawn into, made on demand and stacked at the group's own z */
let _sawGroup=false;
function groupBox(layer,key,z){
  if(!layer||!key)return layer;
  _sawGroup=true;
  let d=layer.querySelector(`:scope > .annogroup[data-gk="${key}"]`);
  if(!d){ d=el("div","annogroup"); d.dataset.gk=key; layer.appendChild(d); }
  /* 6it — inside a group the members carry their own z-index, so two with the SAME z fall back to the
     order they sit in the DOM. That order was the order they happen to occupy in `S.annos`, which for
     a stamp put the box after the words it surrounds; with an opaque interior that is the words gone.
     The container is kept sorted, so the fallback is the stacking order and not an accident. */
  const now=+(d.dataset.z||0);
  if(z>now){ d.dataset.z=z; d.style.zIndex=String(z); }
  return d;
}
function layoutAnnos(){
  dropSnapCache();       /* 6f9 — the marks moved, so the magnet's targets have */
  try{ maLayerStamp(); }catch(e){}     /* 6jc — a new mark joins the layer being drawn into */
  _sawGroup=false;
  try{ clearGroupFrame(); }catch(e){}   /* 6g1 — redrawn from paintMulti once the marks are placed */
  document.querySelectorAll(".annolayer,.annolayer-under").forEach(l=>l.innerHTML="");
  /* ==============================================================================================
     6k2 — THE PAGE IS MEASURED ONCE PER LAYOUT, NOT ONCE PER MARK.
     `pg.offsetWidth` is a READ, and a read of layout after a write to the tree makes the browser stop
     and recompute everything pending. This loop writes a mark and then reads the page, writes the
     next and reads the page again — forty marks, forty forced reflows. Measured on 41 marks and 20
     strokes: 25.8ms with the sheet on screen, 2.6ms with `#pages` hidden, which is the same JavaScript
     doing the same work with nothing to flush. The gap WAS the thrash.
     A page's size cannot change while marks are being put into it — the layers are `position:absolute;
     inset:0` inside it — so one measurement per page per layout is not an approximation, it is the
     same number, asked for once. Same for finding the page element and its two layers.
     ============================================================================================== */
  const _pgC=new Map();
  const pgCell=i=>{
    let c=_pgC.get(i);
    if(c===undefined){
      const pg=document.querySelector(`.page[data-idx="${i}"]`);
      c=(!pg||pg.dataset.rendered!=="1") ? null
        : {pg:pg, w:pg.offsetWidth, h:pg.offsetHeight,
           over:pg.querySelector(".annolayer"), under:pg.querySelector(".annolayer-under")};
      _pgC.set(i,c);
    }
    return c;
  };
  const tc=$("#c_text").value, bg=$("#c_bg").value;
  S.annos.forEach(a=>{
    if(maLayerHidden(a))return;        /* 6jc — a layer that is switched off is not drawn */
    const _c=pgCell(a.page); if(!_c)return;
    const pg=_c.pg;
    const layer=a.under?_c.under:_c.over; if(!layer)return;
    const w=_c.w,h=_c.h;
    const d=el("div","anno"); d.dataset.id=a.id; if(S.sel===a.id)d.classList.add("sel"); if(a.group!=null)d.classList.add("grouped");
    /* 6is — THE FURNITURE LEAVES THE DRAWING. Ced: "do not put the markers behind the shape even if
       the layer is below", and then: "when the shape is in the back, clicking it should not put it
       upfront." Both are the same problem seen from two sides. 6ij solved the first by lifting the
       SELECTED MARK to the top of its layer — which reached the handles and, in doing so, changed what
       the drawing looked like the moment you clicked something: a box with a white interior, selected,
       jumped in front of the words inside it.
       The mark does not move at all now. Its handles, its ✕, its two grips and its layer buttons are
       drawn in a layer of their own (`.annoui`) above every band — see `paintSelUI` at the foot of the
       layout — so they are always reachable and the stack is exactly what you arranged. */
    const _isSel=(S.sel===a.id)||(S.selMulti&&S.selMulti.has(a.id));   /* 6is — see `paintSelUI` */
    /* a shape mark: a rule around it, an interior that can be transparent, and text inside it if it
       has any — which is what a callout is */
    if(isShape(a))d.classList.add("shapemark");
    if(isTextBox(a))d.classList.add("textbox");   /* 6g1 — it gets the vertical handles too */
    /* 6na — AND SO DOES A CELL REDLINE. Ced: "the text in redline tool should behave similarly with
       text box when selected", after "please be consistent in every selected item. apply how the
       textbox works on all redlines if possible."

       Measured, a redline showed six grips where a text box and a shape show eight: no top, no
       bottom. 6lc's reasoning for that was that a plain redline has no box of its own, so a
       vertical handle has nothing to resize — true of the BOX and not true of the mark, because a
       redline's height IS its type. So the pills are there now and they do what the vertical half
       of a corner has always done on this kind of mark: they size the text. `.cellmark` rather
       than `.textbox`, because the class also decides which resize branch the mark takes and a
       redline is still not a free box. */
    if(!isFreeBox(a)&&a.kind!=="img")d.classList.add("cellmark");
    /* 6fb — a locked mark is left alone by every gesture; a flattened one is going into the page */
    if(a.lock)d.classList.add("locked");
    if(a.flat)d.classList.add("flatm");
    if(S.cutA&&S.cutA.has(a.id))d.classList.add("cutting");   /* 6jd — on its way somewhere */
    if(S.selMulti.has(a.id))d.classList.add("multi");   // survives layoutAnnos/zoom/virtualized re-render
    d.style.left=(a.nx*w)+"px";
    /* A cell redline must sit ON the printed text, not above it. Our line box is usually taller than the
       printed glyph box (it carries the row's line pitch), and text centres inside a line box — so the
       element is lifted by half that difference to put the first line's glyphs over the printed ones. */
    let topPx=a.ny*h;
    if(a.onCell&&a.nh){
/* 6ea — the lift is per LINE BOX, and a mark can be several lines tall without wrapping.
         A cell that printed on two lines is covered by a two-line-tall mark even when the correction
         fits on one — the second printed line has to be hidden. `a.wrap` was standing in for "this box
         is more than one line", so on that mark the whole two-line height was treated as one line box
         and the lift became half a line: the box rose 5.65pt and the bottom of the printed value came
         out from under it. You could read "HG" under the correction on the RF Inventory page. The height
         is what decides the lift, so ask the height. */
      const lineBox=((a.lines||1)>1)?((a.nh*h)/a.lines):(a.nh*h);
      const glyph=((a.lineNh!=null?a.lineNh:a.nh)*h);
      topPx-=(lineBox-glyph)/2;
    }
    /* 6ea — and the drop is for a mark that SITS ON a printed line, which is not what a box blanketing a
       two-line cell is doing. Nudging that box down 2.1pt uncovered the top of the printed value: with
       the lift now correctly zero, the drop was the whole of the remaining gap, and the first printed
       line's ascenders came through above the correction. A wrapped mark still gets it — its lines do sit
       on printed lines — so the test is "is this one box over several printed lines". */
    if(a.onCell&&(a.wrap||(a.lines||1)<=1)) topPx+=REDLINE_DROP*h;   // 2. sit 4px lower
    d.style.top=topPx+"px"; if(a.z)d.style.zIndex=a.z;
    setMarkSpin(d,a.rot);          /* 6lz — and the controls on it stay the right way up */

    const isImg=(a.kind==="img");
    const shp=shapeOf(a);
    const tbox=isTextBox(a);
    const ed=isImg?el("div","ed imgwrap"):el("div","ed");
    if(isImg){
      const im=el("img"); im.src=a.src||""; im.draggable=false; im.alt="redline photo";
      im.style.width="100%"; im.style.height="100%"; im.style.display="block"; im.style.pointerEvents="none";
      /* 6i6 — mirrored, if it has been flipped */
      if(a.flipX||a.flipY)im.style.transform=`scale(${a.flipX?-1:1},${a.flipY?-1:1})`;
      ed.appendChild(im);
      ed.style.width=((a.nw||0.2)*w)+"px"; ed.style.height=((a.nh||0.15)*h)+"px";
      ed.style.padding="0"; ed.style.overflow="hidden"; ed.style.resize="none";
      /* 6gd — a picture mark has a look of its own: a frame in its own colour and weight, and its own
         opacity. A snapshot dropped on the sheet is a mark like any other and is expected to be
         restyled like one. */
      ed.style.boxSizing="border-box";
      /* 6jb — when the frame has been drawn INTO the picture it is already on screen; the CSS border
         is only what stands in for it while the bake is still catching up with a changed width. */
      const _fw=maPicFramed(a)?0:((a.sw!=null?a.sw:0)*S.scale);
      ed.style.border=(_fw>0)?(_fw+"px "+borderStyleOf(a)+" "+_rgbaOf(markCol(a),markColOp(a))):"0";
      im.style.opacity=String(a.fillOp!=null?a.fillOp:1);
    } else {
    ed.contentEditable="true"; ed.textContent=a.text;
    /* 6mo — AND AN EMPTY ONE SAYS WHAT IT IS FOR. A box with nothing in it is a rectangle of
       nothing: on a drawing full of ink you cannot tell a text box you have just placed from a
       stray selection. The prompt is a CSS `::before` on an `:empty` box rather than text in the
       element, so it is not in `a.text`, not in the export, and not something the caret can be put
       inside — it is gone the instant the first character lands. */
    if(isTextBox(a))ed.dataset.ph="Add text here";
    ed.style.color=_rgbaOf(markCol(a),markColOp(a));
    /* 6i7 — THE GROUND, AT ITS OWN OPACITY. Ced: "text box of lengths are also moving down in the
       render" — the reading had not moved at all: on screen its white ground covered the run behind
       it and in the file it did not, so in the file the line ran straight through the words and the
       text READ as though it had dropped onto the line. The screen painted the ground flat opaque
       whatever `fillOp` said, while the export has always honoured it, so a mark whose tool carried a
       hollow fill came out with no ground at all. One rule now, on both sides. */
    ed.style.background=(a.bgNone?"transparent"
      :_rgbaOf(markBg(a),(a.fillOp!=null?a.fillOp:1)));
    ed.style.textAlign=a.align;
    ed.style.textDecoration=textDecoOf(a);          /* 6f6 — underline / strikethrough, per mark */
    /* A SHAPE: the rule, the interior, and — for an ellipse — the corner radius that makes it one.
       Its height is its own, because nothing inside it need set one, and its text sits in the middle
       of it rather than on a printed line. */
    if(shp||tbox){
      ed.style.boxSizing="border-box";
      ed.style.width=((a.nw||0.1)*w)+"px";
      ed.style.height=((a.nh||0.06)*h)+"px";
      /* 6hj — A GRID, NOT A FLEX ROW. Ced: "make sure that the alignment is not broken." The text a
         box holds is an anonymous child, and as a FLEX item it shrinks to its own widest line — so a
         centred three-line note centred the BLOCK and left the lines ragged inside it, and a right
         aligned one did nothing visible at all. A grid item stretches across the track by default, so
         `text-align` governs every line the way it reads in the panel, while `align-content` still
         places the block up, down or in the middle of the box. */
      ed.style.display="grid"; ed.style.justifyContent="stretch"; ed.style.justifyItems="stretch";
      ed.style.gridAutoRows="min-content";
      /* 6lc — A TEXT BOX SHOWS THE LINES IT CANNOT FIT; A SHAPE CLIPS.
         Ced, again: "wrapping in textbox is still not working accordingly." Screen and file agree on
         WHERE the words break — measured on a 53-character note at three widths, the two line sets are
         identical. What was wrong is what happens to the lines that do not fit: `overflow:hidden` here
         cut them off without a trace, so narrowing a hand-sized box (which 6ke rightly stops growing
         back) looked like text being eaten rather than text being re-wrapped. 6kf said this in words —
         "it OVERFLOWS rather than hides: once 6ke lets a hand-sized box stay the height it was given,
         `overflow:hidden` would make the extra lines silently invisible, which is the one outcome worse
         than a box that is too small" — and then set `hidden` three hundred lines above, where every
         free box passes. Measured on the built page, the same 53-character note narrowed three times
         by its east grip: 2 lines in 38px of 38px, then 3 lines needing 41px, then 5 needing 56px —
         so at the narrowest two of the five lines sat outside a box that was clipping them. Same
         gestures with this line changed and nothing else: identical line breaks, nothing clipped.
         A SHAPE keeps the clip: its fill and hatch are painted on this element's background and must
         stop at the outline. Only a text box, which has neither, lets its words show. */
      ed.style.whiteSpace="pre-wrap"; ed.style.overflow=(tbox&&!shp)?"visible":"hidden"; ed.style.resize="none";
      /* 6ht — HOW IT BREAKS is the mark's own choice now. A callout and a shape hold prose and break
         between words; a text box fills each line to the edge, breaking inside a word where it runs
         out, which is what the printed columns do and what Ced asked a narrowed box to do. Either can
         be set per mark from the panel. */
      if(wrapsWords(a)){
        ed.style.setProperty("word-break","normal","important");
        ed.style.setProperty("overflow-wrap","break-word","important");
      }else{
        ed.style.setProperty("word-break","break-all","important");
        ed.style.setProperty("overflow-wrap","normal","important");
      }
      ed.style.lineHeight=(1.22*markLnsp(a)).toFixed(3);   /* 6he — leading, off the face's own */
      ed.style.textAlign=a.align||(shp?"center":"left");
      if(shp){
        ed.style.backgroundColor=_rgbaOf(a.fill,(a.fillOp!=null?a.fillOp:1));
        /* 6f6 — a hatched interior, drawn as CSS gradients rather than a child element, because the
           box is contenteditable and anything inside it would become part of what you are typing. */
        ed.style.backgroundImage=patCss(a);
        ed.style.backgroundSize=patCssSize(a);      /* 6g9 — the dot lattice has to tile */
        ed.style.backgroundRepeat="repeat";
        const _bw=(a.nw||0.1)*w, _bh=(a.nh||0.06)*h;
        const _svgRule=shapeNeedsSvg(a,_bw,_bh);
        ed.style.border=_svgRule?"0"
          :((markSw(a)*S.scale)+"px "+borderStyleOf(a)+" "+_rgbaOf(markCol(a),markColOp(a)));
        /* 6ge — and where the CSS border cannot be faithful, the outline is drawn as SVG INSIDE the
           mark, over its own interior: same inset, same dash array, one constant width all the way
           round, exactly as the export writes it. It is a child of the mark, so it moves, resizes and
           turns with it and needs no redraw of its own. */
        paintShapeOutline(d,a,w,h,_svgRule);
        /* 6hk — Ced: "make the shapes corners sharp because the ui shows more rounded ones but are
           sharp corners on the render." The file writes a plain `re` — four straight sides and four
           right angles — so the 2px softening on screen was a shape the export could not draw. */
        ed.style.borderRadius=(shp==="ellipse")?"50%":"0";
        /* 6hi — in POINTS, not device pixels: a fixed 2px inset is a different inset at every zoom
           and cannot be matched by a file written in points. */
        /* 6iv — the inset never takes more than a quarter of the box in each direction */
        const _py=Math.max(0,Math.min(2*S.scale,_bh/4)), _px=Math.max(0,Math.min(4*S.scale,_bw/4));
        ed.style.padding=(shp==="ellipse")?("min(8%,"+_py.toFixed(2)+"px) min(8%,"+_px.toFixed(2)+"px)")
                                          :(_py.toFixed(2)+"px "+_px.toFixed(2)+"px");
        ed.style.alignContent=gridVAlign(a,"center");  /* a shape's text sits in the middle of it */
      }else{
        ed.style.backgroundColor=a.bgNone?"transparent":_rgbaOf(markBg(a),(a.fillOp!=null?a.fillOp:1));
        ed.style.backgroundImage="none";
        ed.style.border="0";
        /* 6k4/6kd — NO MINIMUM INDENTATION ON A TEXT BOX. Ced: "no minimum indentation on texts
           whether horizontal or vertical. making the text small should not compensate for its size."
           There was a 1x2pt inset here so a box's words would not sit flush against their own
           ground. It is a constant, so at 4pt type it is half the line's height and at 24pt it is
           invisible — the small end of the range pays for it, which is the opposite of what a floor
           should do. It also silently took 4pt out of every box's usable width, which is what was
           clipping a COP stamp's contractor row. The box IS its text now: what the user drew is the
           whole of what the words get, and the one mark that still wants an inset says so. */
        /* 6kd — a TEXT BOX is all box: no inset, so what the user drew is the whole of what the
           words get. A CELL REDLINE keeps the 1x2pt inset it has always had — its width comes from
           the printed column it covers and the export's own figures are tuned against it; measured
           when this was applied to both, text parity went from 0 of 10 to 5 of 10. */
        /* =========================================================================================
           6kn — AND NOW IT GOES. Ced, twice: "no minimum indentation on texts whether horizontal or
           vertical", then "do the remaining items".

           6kd deferred this because the first attempt measured text parity 5 of 10, every failure
           horizontal, 2 to 5pt — and read that as `.ed` being content-box, so that the 1x2pt padding
           made the element 4pt wider than `a.nw`. Measured again before touching anything: `.ed`
           resolves `box-sizing: border-box` (app.css line 128, `*{box-sizing:border-box}`), so the
           padding has always been INSIDE the width and there was never a width to reclaim. The real
           mismatch was one line in the export — a free box wrapped at `a.nw*W - 4` while the screen
           wrapped inside `a.nw*W - 4` of CONTENT and then drew its first glyph 2pt in, i.e. the two
           agreed. Dropping the padding on screen ALONE moved the wrap by 4pt and the left edge by
           2pt while the export kept both: that is the 5 of 10, and it is a one-sided change, not a
           property of the box model.

           So both sides move together, in the same three numbers: wrap width `a.nw*W` (no deduction),
           first glyph at 0, first line at the top of the box. A TEXT BOX is now exactly its own
           words — "making the text small should not compensate for its size". A SHAPE keeps its
           inset, capped at a quarter of the box (6iv), because its text would otherwise run under
           its own rule; a CELL REDLINE keeps the inset chain its figures are tuned against.
           ========================================================================================= */
        ed.style.padding=tbox?"0":((1*S.scale)+"px "+(2*S.scale)+"px");
        /* 6kc — a text box sits in the MIDDLE of its box unless told otherwise; a cell redline still
           fills from the top, because it is sitting ON a printed line, not in a space of its own */
        /* 6l3 — the same default the export reads, through the one function that states it */
        ed.style.alignContent=gridVAlign(a,freeVAlignDflt(a));
      }
      if(a.hl)ed.style.mixBlendMode="multiply";
    }
    ed.style.fontSize=(a.size*S.scale)+"px";   // 1 PDF pt = S.scale css px (matches export)
    {
      const F=markFont(a);
      ed.style.fontFamily=F.css;
      ed.style.fontWeight=F.weight||"400";
      ed.style.fontStyle=F.style||"normal";
    }
    /* 6he — tracking, in the same points as everything else the mark is measured in */
    ed.style.letterSpacing=markLsp(a)?((markLsp(a)*S.scale).toFixed(3)+"px"):"normal";
    /* Everything from here to the end of this block is the cell-redline sizing chain: widths measured
       against a printed column, line boxes matched to a printed line, wrap rules taken from the form.
       None of it applies to a shape, whose width and height ARE the mark — so a shape leaves now, with
       the look it was given above. */
    if(shp||tbox){
      /* 6k4 — A FREE BOX THAT SAYS `nowrap` DOES NOT WRAP. The stylesheet gives `.ed`
         `white-space:pre-wrap` and `word-break:break-all`, which is right for a cell redline filling a
         printed column and wrong for a box sized to its own single line: measured on a COP stamp's
         contractor row, a 71.05px box holding 71.01px of text wrapped "LC" onto a second line that
         `overflow:hidden` then cut off — the mark read "TSC CONSTRUCTION L" on screen while its text
         was correct and its width was correct. `a.nowrap` already means this for a cell mark; the free
         boxes simply never asked. */
      if(a.nowrap){
        ed.style.setProperty("white-space","nowrap","important");
        ed.style.setProperty("word-break","normal","important");
        ed.style.setProperty("overflow-wrap","normal","important");
      }else if(tbox){
        /* ==========================================================================================
           6kf — A TEXT BOX WRAPS AT ITS WORDS, TO THE WIDTH IT WAS DRAWN.
           Ced: "wrapping is not working properly in texts. if the user adjusts the text within the
           left and right size, it should adjust the wrapping."
           The stylesheet gives `.ed` `word-break:break-all`, which is deliberate and correct for a
           cell redline: it has to fill a printed column the way the form does, breaking wherever the
           width runs out. A free text box is not filling anything — it is a note — and breaking
           "CONSTRUCTION" into "CONSTRUC / TION" is not wrapping, it is damage. Words here.
           And it OVERFLOWS rather than hides: once 6ke lets a hand-sized box stay the height it was
           given, `overflow:hidden` would make the extra lines silently invisible, which is the one
           outcome worse than a box that is too small.
           6kn — through `wrapsWords`, not hard-coded: words is now that function's answer for a text
           box, so the file breaks where the screen breaks, and a mark switched to `chars` in the
           panel is honoured here instead of being overridden. */
        ed.style.setProperty("white-space","pre-wrap","important");
        if(wrapsWords(a)){
          ed.style.setProperty("word-break","normal","important");
          ed.style.setProperty("overflow-wrap","break-word","important");
        }else{
          ed.style.setProperty("word-break","break-all","important");
          ed.style.setProperty("overflow-wrap","normal","important");
        }
      }
      /* 6k0 — AND A FREE BOX OBEYS NO STYLESHEET FLOOR. `.anno .ed` carries `min-width:14px`, a
         sensible last resort for a cell redline whose width is derived and a hard stop for a box the
         user drew: measured, a text box resized as small as it would go sat at 14px on screen while
         its own width was 0.88. A shape or a text box IS its width — the only floor it answers to is
         6k0's. */
      ed.style.setProperty("min-width","0","important");
    }
    else {
    if(a.onCell&&(a.align||"center")==="left"){
      const P0=S.pages[a.page];
      ed.style.paddingLeft=(REDLINE_LEFT_INSET/((P0&&P0.w1)||612)*w)+"px";   // 1. cancel the left bleed
    }
    if(a.wrap && a.nw){
      /* the stylesheet sets white-space:pre-wrap on .ed, so these have to win outright for the value to
         break onto the second line the way the printed text does */
      ed.style.setProperty("width",(a.nw*w)+"px","important");
      /* 6dy — the stylesheet's `min-width:14px` is a floor for a free-form textbox and a bug for a cell
         redline: a one-character mark is about 5px wide at 1.2x, so the floor drew it nearly three times
         too wide on screen while the export drew it at its real width. Where the width is decided, it
         is the authority. */
      ed.style.setProperty("min-width","0","important");
      ed.style.setProperty("white-space","normal","important");
      ed.style.setProperty("overflow-wrap","normal","important");
      /* 6ek — fill the line PER CHARACTER, which is what the printed form does and what the wrap above
         computes. `overflow-wrap:anywhere` retreats to a hyphen instead of filling: measured,
         `DC9-48-60-24-8C-EV` in a 64px box renders 56px + 25.5px that way and 60.5px + 21px under
         `break-all`, and the page's own cell breaks at the wider one. */
      if(wrapsWords(a)){                                    // 6f2 — a free box breaks between words
        ed.style.setProperty("word-break","normal","important");
        ed.style.setProperty("overflow-wrap","break-word","important");
      }
      else ed.style.setProperty("word-break","break-all","important");
      ed.style.setProperty("overflow","visible","important");
      ed.style.setProperty("text-align",(a.align||"center"),"important");
      /* 6f2 — a free box keeps its own size, so its lines are pitched off the FONT, not off the box:
         stretching the pitch to fill the height is right for a cell redline that was sized to its lines
         and wrong here, where the user types on into a box whose height they set. */
      ed.style.setProperty("resize","none","important");
      if(isFreeBox(a)) ed.style.setProperty("line-height",
                          (a.size*S.scale*1.22*markLnsp(a))+"px","important");
      else if(a.nh) ed.style.setProperty("line-height",((a.nh*h)/Math.max(1,a.lines||1))+"px","important");
    }
    /* 6dy — and the same floor here. A centred mark carrying a textDx nudge skips the `a.nowrap` branch
       below, which is the only other place min-width is set, so a one-character as-built or tilt
       correction kept the stylesheet's 14px and rendered far wider than it exports. */
    else if(a.fullcell && a.nw){ ed.style.width=(a.nw*w)+"px"; ed.style.minWidth=(a.nw*w)+"px"; ed.style.whiteSpace="nowrap"; ed.style.overflow="visible"; ed.style.textAlign=(a.align||"center"); ed.style.resize="none"; }
    if(a.textDx&&(a.align||"center")==="center"){
      const px=a.textDx*w;                                   // 6de — the same nudge the export applies
      ed.style.boxSizing="border-box";
      if(px>0){ ed.style.paddingLeft=(2*px)+"px"; ed.style.paddingRight="0px"; }
      else    { ed.style.paddingRight=(-2*px)+"px"; ed.style.paddingLeft="0px"; }
    }
    else if(a.nowrap){ ed.style.whiteSpace="nowrap"; ed.style.overflow="visible"; ed.style.resize="none"; if(a.nw) ed.style.minWidth=(a.nw*w)+"px"; }
    else if(a.nw){ ed.style.width=(a.nw*w)+"px"; }
    if(a.nh){
      /* one line: make the line box exactly the printed line's height so the glyphs centre on it —
         they were sitting high because the text started at the top of the box */
      ed.style.height=(a.nh*h)+"px";
      if(!a.wrap) ed.style.lineHeight=(a.nh*h)+"px";
    }
    /* A mark written with HARD line breaks — the stamp's three lines, a callout's four — has to show
       them. Every branch above chooses between `nowrap` and wrapping at a width, and neither renders a
       newline: the stamp came out as one long run on screen while the export, which splits on the
       newline itself, drew it correctly. `pre-line` keeps the breaks and still lets an over-long line
       fold inside the box. */
    if(String(a.text||"").indexOf("\n")>=0){
      const nl=Math.max(1,a.lines||String(a.text).split("\n").length);
      ed.style.setProperty("white-space","pre-line","important");
      ed.style.setProperty("overflow","visible","important");
      if(a.nh){
        ed.style.setProperty("height",(a.nh*h)+"px","important");
        ed.style.setProperty("line-height",((a.nh*h)/nl)+"px","important");
      }
    }
    }   /* end of the cell-redline sizing chain a shape skips */
    ed.oninput=()=>{ a._dirty=true; a.text=ed.innerText;
      /* a shape or a text box holds its text inside a box of its own size — nothing re-measures it */
      /* 6hh — a text box wraps to the width you drew and grows down to hold the lines */
      if(tbox){ growTextBox(a,ed,pg); return; }
      if(shp)return;
      /* 6hb — A ONE-LINE LABEL GROWS AS IT IS TYPED. Ced, of the Length tool: "when editing length in
         the length tool, make sure the text is still aligned center in the ui and was not breaking.
         there are instance where it breaks and will only come back when moved." Both a measurement's
         reading and a strike & write's writing are single-line labels centred on something — the middle
         of a run, the value being replaced — and both were being re-flowed INSIDE a box whose width was
         fixed when the mark was made. Type a character too many and the text wrapped, or ran out of the
         box, and stayed wrong until the mark was moved and a layout pass put it right. They are
         re-measured here instead, on every keystroke, and the box grows about its own centre. */
      if(a.maKind==="dimlabel"||a.maKind==="fix"){ refitCentred(a,ed,pg); return; }
      if(a.onCell&&!a.manualW){ fitCellBox(a); const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px"; }
      else if(a.lenRule&&!a.alignUser&&a._colNw!=null){
        /* an added row's cell — the same rule as a count redline, kept live as the text changes */
        applyLenRule(a);
        const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px";
      }
      /* 6dt — and in every other case, which is most of them, the text wraps inside the mark it is in
         instead of running off the side of it */
      else fitTextInside(a,ed,pg);
    };
    /* 6hj — ENTER STARTS A NEW LINE IN A BOX YOU DREW.
       Ced: "make enter when typing going to another line below." A `contenteditable` left to itself
       answers Enter with whatever the browser feels like — a `<div>` here, a `<br>` there — and the
       mark's text is read back with `innerText`, so what came out depended on the browser rather than
       on what was typed. In a FREE BOX (a text box, a shape, a callout) Enter now inserts one line
       break itself, which `innerText` reads back as one `\n` and the export draws as one hard break.
       Everywhere else — a cell redline, a measurement's reading, a strike & write correction — the
       mark is one line by definition, so Enter finishes it instead, which is what pressing Enter in a
       field has always meant. */
    ed.addEventListener("keydown",ev=>{
      if(ev.key!=="Enter"||ev.isComposing)return;
      if(!(shp||tbox||a.maKind==="callout")){ ev.preventDefault(); ed.blur(); return; }
      if(ev.shiftKey)return;                       /* Shift+Enter is the browser's own, and is fine */
      ev.preventDefault();
      let done=false;
      try{ done=document.execCommand("insertLineBreak"); }catch(e){}
      if(!done){
        const sel=window.getSelection();
        if(sel&&sel.rangeCount){
          const r=sel.getRangeAt(0); r.deleteContents();
          const n=document.createTextNode("\n");
          r.insertNode(n); r.setStartAfter(n); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
        }
      }
      a._dirty=true; a.text=ed.innerText;
      ed.dispatchEvent(new Event("input",{bubbles:true}));
    });
    /* 6. spreadsheet / rich-text paste lands as PLAIN TEXT, exactly as copied */
    ed.addEventListener("paste",ev=>{
      const dt=ev.clipboardData; if(!dt)return;
      if([...(dt.items||[])].some(it=>it.kind==="file"&&/^image\//.test(it.type)))return;   // photo: handled globally
      ev.preventDefault();
      let t=dt.getData("text/plain")||"";
      t=t.replace(/\r\n?/g,"\n").replace(/\s+$/,"");         // Excel appends a trailing newline/tab
      try{ document.execCommand("insertText",false,t); }
      catch(_){ ed.textContent=(ed.textContent||"")+t; }
      a.text=ed.innerText; a._dirty=true;
      if(tbox){ growTextBox(a,ed,pg); return; }
      if(shp)return;
      if(a.maKind==="dimlabel"||a.maKind==="fix"){ refitCentred(a,ed,pg); return; }   /* 6hb */
      if(a.onCell&&!a.manualW){ fitCellBox(a); const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px"; }
      else if(a.lenRule&&!a.alignUser&&a._colNw!=null){
        /* an added row's cell — the same rule as a count redline, kept live as the text changes */
        applyLenRule(a);
        const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px";
      }
      else fitTextInside(a,ed,pg);          /* 6dt — pasted text wraps inside the mark too */
    });
    }
    /* 6f8 — A CLICK SELECTS, A DOUBLE-CLICK TYPES, WHATEVER TOOL IS IN YOUR HAND.
       This used to be gated on Select mode, which was fine while every tool put itself down after one
       use: by the time you clicked a mark, Select was active. Now the tool stays, so a single click on
       a mark you had just drawn fell through to the browser, put the caret in it, and from then on
       Ctrl+D, Delete and the arrow keys were text editing rather than mark editing. The rule belongs to
       the MARK, not to the mode. */
    const _groupSelected=g=>{
      if(g==null)return false;
      if(S.sel!=null){ const o=S.annos.find(z=>z.id===S.sel); if(o&&o.group===g)return true; }
      for(const id of S.selMulti){ const o=S.annos.find(z=>z.id===id); if(o&&o.group===g)return true; }
      for(const id of S.selMultiL){ const o=S.lines.find(z=>z.id===id); if(o&&o.group===g)return true; }
      return false;
    };
    const _press=e=>{
      if(d.classList.contains("editing"))return;     /* already typing in it — leave the caret alone */
      /* 6hq — A TOOL IN THE HAND DRAWS, EVEN OVER SOMETHING.
         Ced: "when using a tool, and you are editing on top of another shape, do not move the shape
         below, make the application of the new shape first." A mark claimed every press that landed on
         it, whatever was in your hand — so drawing a box over a box you had already drawn dragged the
         first one across the sheet instead. With a drawing tool up the press belongs to the TOOL: the
         mark lets it through and the page underneath starts the new one. Select (and Pan) still pick
         the mark up, which is what those two are for. */
      /* 6ju — UNLESS IT IS THE ONE YOU HAVE HOLD OF. Ced: "make the shapes be draggable even if you
         drag them by the shape itself." 6hq is right that a tool in the hand should draw over a mark
         rather than shove it aside — but a mark you have deliberately SELECTED is one you are working
         on, and with the tool now staying in the hand after Escape (6jt) there was no way to nudge it
         without putting the tool down first. A press on a selected mark moves it; a press on any other
         mark still starts a new one, which is what 6hq asked for. Escape drops the selection and the
         sheet is a drawing surface again. */
      /* ===========================================================================================
         6m9 — AND THAT LAST SENTENCE IS NO LONGER TRUE, so the exemption narrows.
         6ju's whole justification rested on "Escape drops the selection and the sheet is a drawing
         surface again". Ced's new rule — "when esc was clicked, always go to select current redline.
         double esc is select tool" — means the first press KEEPS the selection and the second puts
         the tool down with it, so there is no longer any press that leaves a drawing tool in the hand
         over an empty sheet. Measured: with a box drawn and the tool still up, a drag starting inside
         it moved the first box instead of drawing a second — 6hq's exact complaint, re-introduced by
         the change to Escape.
         A SINGLE selected mark therefore stops being exempt: the press goes through 6l7 like any
         other, so a DRAG draws (6hq) and a CLICK picks the mark up. Nothing is lost — the mark still
         moves by its own grip, which 6lw put under the box and 6lp lifted above every band, and by the
         arrow keys. A MULTI-SELECTION and a GROUP keep the exemption, because dragging the whole
         block IS the gesture there and there is no one mark to have clicked instead.
         =========================================================================================== */
      if(toolDraws()&&!pressOwnedByMark(a.id)){
        /* ===========================================================================================
           6l7 — A CLICK IS NOT A DRAW. Ced, twice: "if the user clicked on the ui/pdf or on a
           different shape/redline without dragging for shape again, it should go to select mode."

           6hq is right that a tool in the hand must DRAW over a mark rather than shove it aside —
           drawing a box over a box you have already drawn should make a second box. But drawing is a
           DRAG. A press that goes down and comes up in the same place has drawn nothing, and what it
           plainly meant was the mark underneath it; until now it meant nothing at all, and the mark
           could only be reached by putting the tool down first.

           The decision cannot be taken here, because at pointerdown nobody knows yet whether this is
           a click or a drag. So the press is let through exactly as before — a drag still draws —
           and the mark is remembered. `_toolClickOn` below is read at pointerup: if the pointer
           never travelled and the tool created nothing, that mark is selected and the tool goes
           down. If it travelled, or something was drawn, the note is discarded and 6hq stands.
           =========================================================================================== */
        _toolClickOn={id:a.id, x:e.clientX, y:e.clientY, n:(S.annos||[]).length+(S.lines||[]).length};
        return;
      }
      /* 6gs — THE SECOND PRESS OF A DOUBLE-CLICK IS NOT A DRAG. Ced: "double clicking items that has
         texts (length and call outs) should enable editing the texts." Every mark starts a drag on
         mousedown, and on the second press of a double-click that drag was starting too — on a
         measurement it grabs the whole run, and a hand that moves a pixel between the two clicks
         moved the mark instead of opening it for typing. `detail` is 2 on that second press, so it is
         left alone and the dblclick below takes the gesture. */
      if(e.detail>=2)return;
      e.preventDefault();
      /* 6gj — A MEASUREMENT IS ONE MARK. Ced: "apply the same logic as callout to length where it is
         editable but is treated as one shape." Clicking the reading selects the MEASUREMENT — the run
         is the half with the handles — and dragging the reading moves the whole of it, run and all.
         A double-click still puts the caret in the reading, which is how it stays editable. */
      if(a.maKind==="dimlabel"&&!(e.shiftKey||e.ctrlKey||e.metaKey)){
        const dl=(typeof maDimLineOf==="function")?maDimLineOf(a):null;
        if(dl){ selectLine(dl.id); startLineDrag(e,dl,"move",pg); return; }
      }
      selNotFromDraw();                  /* 6l1 — this is a mark being PICKED UP, not drawn */
      if(e.shiftKey||e.ctrlKey||e.metaKey){
        try{ sbPaintHold(); }catch(_){}    /* 6i0 — adding to a selection is not painting */
        toggleMulti(a.id); return; }
      if(S.selMulti.has(a.id)){ dragMulti(e,pg); return; }
      if(a.group!=null&&!groupOpenIs(a.group)){ selectGroup(a.group); dragMulti(e,pg); return; }   /* 6jz */
      /* ============================================================================================
         6ll — A PRESS INSIDE THE SELECTED MARK MOVES THE SELECTED MARK.
         Ced: "when editing a redline, all dragger or tool drag should be shown above the redlines and
         you should be moving the selected redline."

         The handles were already right: measured with a small mark selected under a larger one,
         `elementsFromPoint` at the move grip answers `BUTTON.mov` and dragging it moved the selected
         mark and not the other. The BODY was not: at the centre of the selected mark the topmost
         element was the OTHER mark's `.ed`, three deep, so a drag that started inside the box you
         were working on picked up whatever happened to lie over it.

         Overlap is the normal state of a marked-up drawing — a note inside a box, a box over a
         cloud — and the mark you are working on is the one the tool has every reason to prefer. So
         while something is selected, a press that lands inside ITS box drags IT, whichever mark the
         hit test reached first.

         A CLICK is still a click. `dragBody` does nothing until the pointer passes the slop, so a
         press that never moves has changed nothing; the pointerup below then selects the mark that
         was actually under the hand, which is how you reach a small mark lying inside a big selected
         one. Drag what you are holding, click to pick up something else.
         ============================================================================================ */
      if(S.sel!=null&&S.sel!==a.id&&!a.group){
        const _f=document.querySelector(".annoui > .anno.selui");
        const _sa=S.annos.find(z=>z.id===S.sel);
        const _sd=markEl(S.sel);
        const _sp=_sa?document.querySelector('.page[data-idx="'+_sa.page+'"]'):null;
        if(_f&&_sa&&_sd&&_sp&&!_sa.lock&&_sa.group==null){
          const r=_f.getBoundingClientRect();
          if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){
            const sx=e.clientX, sy=e.clientY, pick=a.id;
            const onUp=ev2=>{
              window.removeEventListener("pointerup",onUp,true);
              if(Math.hypot(ev2.clientX-sx,ev2.clientY-sy)<=DRAG_SLOP){
                try{ selNotFromDraw(); selectAnno(pick); }catch(_){}
              }
            };
            window.addEventListener("pointerup",onUp,true);
            selNotFromDraw();
            dragBody(e,_sd,_sa,_sp);
            return;
          }
        }
      }
      selectAnno(a.id); dragBody(e,d,a,pg);
    };
    ed.addEventListener("mousedown",_press);
    /* 6ha — AND A FINGER DOES THE SAME THING, AT ONCE. Ced: "make the tool more responsive to user's
       clicks and touch." A touch produces no `mousedown` until the browser has decided the gesture is
       not a scroll, a pan or a double-tap zoom — which is a third of a second on a good day and never
       at all if it decides otherwise — so on a tablet a mark could not be dragged, only tapped into
       typing. The press is taken straight from the pointer for touch and pen; `preventDefault` on a
       touch pointerdown is what stops the compatibility mouse event arriving later and running the
       whole thing a second time. The mouse keeps its own path, where `detail` still tells a
       double-click from a drag. */
    ed.addEventListener("pointerdown",e=>{
      if(e.pointerType==="mouse")return;
      if(d.classList.contains("editing"))return;
      e.preventDefault();
      _press(e);
    });
    const startTyping=()=>{ d.classList.add("editing"); ed.focus();
      try{ document.getSelection().selectAllChildren(ed); }catch(e){} };
    /* 6jz — a double-click on a member of a CLOSED group goes into the group first and picks this one
       mark out of it; the caret waits for the next one. The frame (6g1) usually catches this gesture
       before the mark does, so the same decision lives there too — but not always, and the rule
       belongs to the mark as much as to the furniture over it. */
    const _dblGroup=ev=>{
      if(a.group==null||groupOpenIs(a.group))return false;
      ev.preventDefault(); ev.stopPropagation();
      groupEnter(a.group); selectAnno(a.id);
      return true;
    };
    ed.addEventListener("dblclick",ev=>{ if(_dblGroup(ev))return; startTyping(); });
    /* and a double-click anywhere on the mark — its border, a shape's padding, the space beside the
       words — opens it too, which is where the hand lands on a callout box or a reading */
    d.addEventListener("dblclick",ev=>{ if(ev.target===ed)return; if(_dblGroup(ev))return; ev.preventDefault(); startTyping(); });
    ed.onfocus=()=>{ selectAnno(a.id); d.classList.add("editing"); a._dirty=false; a._pre=snapshot(); };
    ed.onblur=()=>{ d.classList.remove("editing"); if(a._dirty){ S.history.push(a._pre); if(S.history.length>80)S.history.shift(); S.future=[]; updateUndoUI(); a._dirty=false; }
      /* 6k1 — AND AN EMPTY TEXT BOX IS NOT A MARK. Ced: "if a text tool was prototyped and no text
         was made or entered, do not put a blank text box and delete it on the pdf." A box with
         nothing in it draws nothing, exports nothing and is invisible on the sheet — but it is still
         there to be clicked, dragged and counted, which is how a stray one ends up under a later
         mark. The caret leaving an empty one takes it away. Only a TEXT BOX: a shape, a callout and a
         cell redline are all marks in their own right with or without words in them. */
      if(isTextBox(a)&&!String(ed.textContent||"").replace(/[\s ]/g,"")) setTimeout(()=>dropEmptyText(a.id),0);
    };
    /* This adopted the element's measured width on every mouseup — and a mouseup fires during a
       double-click. For a centred or right-aligned mark the width decides where the text sits, and
       offsetWidth includes padding, so each double-click nudged the mark off position. Only a mark whose
       box is genuinely free-form and left-aligned may be measured this way, and only for a real change;
       the resize handles remain the proper way to change a width. */
    if(!isImg)ed.onmouseup=()=>{
      if(a.fullcell||a.nowrap||a.onCell||a.manualW)return;
      if((a.align||"left")!=="left")return;
      const px=ed.offsetWidth;
      if(a._rw==null){ a._rw=px; return; }
      if(Math.abs(px-a._rw)<3)return;          // sub-pixel and re-render noise
      a._rw=px; a.nw=px/w;
    };
    d.appendChild(ed);
    const x=el("button","x","✕"); x.title="Delete this redline";
    x.onclick=ev=>{ ev.stopPropagation(); pushHistory();
      /* 6gj — the ✕ on a reading takes its measurement with it: one mark, one delete */
      if(a.maKind==="dimlabel"){ const dl=(typeof maDimLineOf==="function")?maDimLineOf(a):null;
        if(dl){ S.lines=S.lines.filter(z=>z.id!==dl.id); if(S.selLine===dl.id)selectLine(null); } }
      S.annos=S.annos.filter(z=>z.id!==a.id); if(S.sel===a.id)selectAnno(null);
      layoutAnnos(); drawAllLines(); updateRail(); updateCount(); };
    d.appendChild(x);
    /* 6k2 — the handles are built for the mark you are HOLDING, not for all of them. See
       `markHandles`. The ✕ stays on every mark because `.anno:hover .x` shows it on hover. */
    if(S.sel===a.id)markHandles(d,a,pg,ed);
    /* 6ir — into its group's container when it has one, so the group stacks as a single thing */
    const _gk=groupKeyOf(a);
    const _host=(_gk?groupBox(layer,_gk,a.z||0):layer);
    if(_gk){
      /* 6it — put it in its place rather than on the end */
      const mine=(a.z||0);
      const after=[..._host.children].find(n=>n.classList&&n.classList.contains("anno")&&
        ((+(n.style.zIndex||0))>mine));
      if(after)_host.insertBefore(d,after); else _host.appendChild(d);
    } else _host.appendChild(d);
  });
  positionBar();
  /* 6ds — now that the marks are on the page, correct any whose wrapped line count was estimated
     wrongly. Guarded, so the re-layout this triggers cannot recurse. */
  try{ reflowWrapped(); }catch(e){ LOG&&LOG("wrap reflow skipped:",e&&e.message||String(e)); }
  /* 6ge — a snapshot re-inks itself when its colour is changed */
  try{ skSyncSnapshotTint(); }catch(e){}
  /* 6fq — and put the transfer's amber rings back. Every layout rebuilds the mark elements, so a class
     set once would survive exactly until the next scroll. */
  /* 6ir — AND THE STROKES GO BACK IN. A group's strokes live inside the group's container, and this
     function has just thrown every container away and built them again — so the strokes have to be
     redrawn after it, not before. Rather than fix that order at forty call sites, the layout does it
     itself. `_inLayout` keeps a redraw from re-entering the layout it was started from. */
  /* 6iu — ONLY WHEN THERE IS A GROUP TO PUT BACK. The strokes are redrawn from here because a group's
     strokes live inside a container this function has just rebuilt — but on a document with no groups
     there is nothing to put back, and doing it anyway made every page render redraw the lines on every
     other rendered page. A fast zoom through six levels then did that work squared, which is enough to
     take the renderer down. */
  if(!_inLayout&&_sawGroup){
    _inLayout=true;
    try{ drawAllLines(); }catch(e){ LOG&&LOG("line redraw skipped:",e&&e.message||String(e)); }
    _inLayout=false;
  }
  try{ paintSelUI(); }catch(e){ LOG&&LOG("selection furniture skipped:",e&&e.message||String(e)); }
  try{ maPicFramePass(); }catch(e){}   /* 6jb — a changed frame width is re-drawn into the picture */
}
let _inLayout=false;
/* 6is — THE SELECTION'S FURNITURE, IN A LAYER OF ITS OWN.
   Everything you use to work a mark — the eight resize handles, the ✕, ↻ and ✥, and the two layer
   buttons — is moved out of the mark and into `.annoui`, which sits above every band on the page. The
   frame it goes into is an empty `.anno.sel` at exactly the mark's box, so every rule that positions a
   handle against `.anno` positions it identically here, and the mark itself keeps its own place in the
   stack. That is the whole point: selecting something must not change what the drawing looks like. */
/* =================================================================================================
   6k2 — THE HANDLES ARE BUILT FOR THE MARK IN YOUR HAND, NOT FOR EVERY MARK ON THE PAGE.
   Ced: "make everything more seamless, i have seen some lag issues."

   Measured on a page carrying 41 marks and 20 strokes, `layoutAnnos` took 19.96ms — and a layout runs
   on every mark added, every resize let go, every zoom step and every undo. Nearly all of it was DOM
   that nobody could see: twelve elements per mark (eight resize handles, rotate, move, and the two
   layer steps), every one of them `display:none` until that mark is selected, each with a listener
   bound to it. Five hundred nodes built and thrown away to show twelve.

   Only one mark at a time can carry handles — 6is already moved them into `.annoui` for exactly that
   mark — so they are built for exactly that mark. `paintSelUI` makes them on demand for a mark that
   gains the selection without a re-layout, which is the ordinary case: a click on a neighbour.
   ================================================================================================= */
let _hEl=null;                 /* the one element that currently carries a set */
const HANDLE_SEL=":scope > .rz, :scope > .rot, :scope > .mov, :scope > .lup, :scope > .ldn, :scope > .edp";
function stripHandles(d){ if(!d)return; d.querySelectorAll(HANDLE_SEL).forEach(n=>n.remove()); }
function markHandles(d,a,pg,ed){
  if(!d||!a||!pg)return d;
  if(d.querySelector(":scope > .rz")){ _hEl=d; return d; }   /* already has them */
  _hEl=d;
  ed=ed||d.querySelector(".ed");
  // resize handles (shown when selected & not editing)
  ["nw","n","ne","e","se","s","sw","w"].forEach(pos=>{ const hd=el("span","rz "+pos); hd.dataset.pos=pos; hd.addEventListener("pointerdown",ev=>startAnnoResize(ev,a,d,ed,pg,pos)); d.appendChild(hd); });
  /* Rotate and Move sit together below the box — the six-dot grip that used to hang off the top-left
     is gone, so nothing overlaps the text any more. */
  const rotH=el("button","rot","↻"); rotH.title="Rotate — the angle is shown as you turn it. Snap settles it on the nearest 15°; Shift forces 15° steps; Ctrl turns freely";
  rotH.addEventListener("pointerdown",ev=>startAnnoRotate(ev,a,d,pg)); d.appendChild(rotH);
  const movH=el("button","mov","✥"); movH.title="Drag to move this redline";
  d.appendChild(movH);
  dragify(movH,d,a,pg,ed);
  /* ================================================================================================
     6lk — AND THE PICTURE EDITOR, WHERE THE HAND ALREADY IS.
     Ced: "add an edit picture button in here as well beside the drag for easy access", with a capture
     of a selected picture and an arrow at the move grip.
     Opening the editor meant going down to the selection bar at the foot of the window, or finding it
     in the right-click menu — a trip across the screen for the one thing you do to a picture over and
     over. It is a round control beside the move grip, the same size and the same ink as the rest of
     the furniture, and it appears on ANY picture mark: a photo you added, a snapshot you took with the
     snapshot tool, and a markup placed from the library are all `kind:"img"` and all open the same
     editor. (Ced: "add an edit as well if the photo was from a snapshot markup on tool, not only on
     added image photos" — measured on the built page, the BAR and the right-click menu already offered
     it for a snapshot; this control is the one that was missing, so it is the one that has to cover
     every kind.)
     ================================================================================================ */
  if(a.kind==="img"){
    const edH=el("button","edp","✎"); edH.type="button";
    edH.title="Edit this picture — erase, select and fill, without leaving the sheet";
    edH.onclick=ev=>{ ev.stopPropagation(); ev.preventDefault();
      try{ selectAnno(a.id); skEditor(a); }catch(e){ try{toast("Could not open the picture editor");}catch(_){} } };
    /* a press must not start a drag of the mark underneath it */
    edH.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); });
    d.appendChild(edH);
    d.classList.add("haspic");      /* 6lk — re-centres the row of three; the frame copies the class */
  }
  /* 6i5 — one step up or down the stack, on the left edge of the box */
  const up=el("button","lup","⤒"); up.type="button";
  up.title="Up one layer — above the mark it is under, and past the strokes at the top of the stack";
  up.onclick=ev=>{ ev.stopPropagation(); ev.preventDefault();
    pushHistory(); stepLayer(layerFamily(a),1);
    layoutAnnos(); drawAllLines(); selectAnno(a.id); updateRail(); autosave(); };
  d.appendChild(up);
  const dn=el("button","ldn","⤓"); dn.type="button";
  dn.title="Down one layer — under the mark it is over, and past the strokes at the bottom of it";
  dn.onclick=ev=>{ ev.stopPropagation(); ev.preventDefault();
    pushHistory(); stepLayer(layerFamily(a),-1);
    layoutAnnos(); drawAllLines(); selectAnno(a.id); updateRail(); autosave(); };
  d.appendChild(dn);
  return d;
}
const SEL_FURNITURE=".x,.rz,.rot,.mov,.lup,.ldn,.edp";
function selUIFrameFor(id){
  const a=S.annos.find(z=>z.id===id); if(!a)return null;
  const pg=document.querySelector(`.page[data-idx="${a.page}"]`); if(!pg)return null;
  const ui=pg.querySelector(".annoui"); if(!ui)return null;
  const d=markEl(id); if(!d||!pg.contains(d))return null;
  return {a,pg,ui,d};
}
function markEl(id){
  return [...document.querySelectorAll(`.anno[data-id="${id}"]`)]
           .find(n=>!n.classList.contains("selui"))||null;
}
let _selUIon=false;
/* 6is — WHERE A MARK'S HANDLE ACTUALLY IS. While the mark is selected its furniture lives in the
   frame above the page; the rest of the time it sits on the mark. Anything that reaches for a handle
   asks here rather than assuming one of the two. */
function markHandle(id,sel){
  const f=document.querySelector(`.annoui > .anno.selui[data-sel="${id}"]`);
  const h=f&&f.querySelector(sel);
  if(h)return h;
  const d=markEl(id);
  return d?d.querySelector(sel):null;
}
function paintSelUI(){
  /* 6iu — nothing selected and nothing to tear down: do not touch the DOM at all. This runs at the
     end of every layout, and a layout runs per page while a zoom settles. */
  if(S.sel==null&&!_selUIon)return;
  _selUIon=(S.sel!=null);
  /* the furniture goes HOME before the frame is torn down. Emptying the layer outright destroyed the
     handles, and a mark selected, deselected and selected again — without a re-layout in between —
     came back with none: the nodes had been thrown away with the frame that borrowed them. */
  document.querySelectorAll(".annoui > .anno.selui").forEach(f=>{
    const back=markEl(f.dataset.sel);
    /* ...but only if the mark has not been rebuilt in the meantime. A layout makes every mark afresh,
       furniture and all, so handing the borrowed set back to the new element gave it two of everything
       — and half of them were still wired to the element that had just been thrown away. Those are the
       ones a rotated box was being resized by, which is why it went the wrong way. */
    const fresh=back&&back.querySelector(":scope > "+SEL_FURNITURE);
    [...f.children].forEach(n=>{ if(back&&!fresh)back.appendChild(n); else n.remove(); });
    try{ if(back)back.classList.remove("hasselui"); }catch(e){}   /* 6lj */
    f.remove();
  });
  document.querySelectorAll(".annoui").forEach(l=>{ l.innerHTML=""; });
  /* 6k2 — AND EXACTLY ONE MARK CARRIES A SET. A mark that was selected when the page was last laid
     out keeps its handles — invisible, since `.rz` is `display:none` off the selection, but twelve
     live listeners all the same, and one more set for every mark that has ever been the selection.
     The previous holder gives them up here, which is the only place that knows the selection has
     moved. */
  const _want=(S.sel!=null)?markEl(S.sel):null;
  if(_hEl&&_hEl!==_want){ stripHandles(_hEl); _hEl=null; }
  if(S.sel==null)return;
  const c=selUIFrameFor(S.sel); if(!c)return;
  const f=el("div","anno sel selui"); f.dataset.sel=String(S.sel);
  /* 6is — and the frame wears the mark's own classes, because which handles a mark gets is decided by
     them: a shape and a free text box carry the two side pills, a cell redline does not. `editing` is
     deliberately left off — a selected mark keeps its handles while you type in it (6ha).
     6lj — and so is `hasselui`, which is the mark's note to itself that this frame exists. Copying it
     onto the frame told the frame not to draw the ring either, and the selection lost its outline
     altogether — measured as no blue at all on four scan lines through the box. */
  [...c.d.classList].forEach(k=>{ if(!/^(anno|sel|multi|dragging|editing|hasselui)$/.test(k))f.classList.add(k); });
  /* 6k2 — a mark that has just BECOME the selection has no handles yet: a click on a neighbour
     repaints this layer without re-laying the marks out. Built here, once, for the one that needs
     them. */
  try{ if(!c.d.querySelector(":scope > .rz")){
    markHandles(c.d,c.a,c.pg,c.d.querySelector(".ed"));
  } }catch(e){}
  [...c.d.querySelectorAll(":scope > "+SEL_FURNITURE)].forEach(n=>f.appendChild(n));
  if(!f.children.length)return;
  c.ui.appendChild(f);
  /* 6lj — ONE RING, NOT THREE. `.anno.sel` carries a 2px `box-shadow` ring, and this frame is itself
     an `.anno.sel`, so a selected mark was drawing two of them — at two slightly different fractional
     positions, which is what reads as a thick or doubled edge. A picture drew a THIRD: `.ed.imgwrap`
     has an `outline` of its own. The frame is the one that should carry it, because the frame is the
     thing that sits above every mark and is now pixel-aligned, so the mark underneath is told to stop
     drawing its own while the frame is up. */
  try{ c.d.classList.add("hasselui"); }catch(e){}
  syncSelUI();
}
/* the frame follows the mark through a drag, a resize and a turn — `positionBar` is called on every
   move of all three, so it is the one place this has to be hooked */
function syncSelUI(){
  const f=document.querySelector(".annoui > .anno.selui"); if(!f)return;
  const c=selUIFrameFor(+f.dataset.sel);
  if(!c){ f.remove(); return; }
  /* ==============================================================================================
     6lj — THE SELECTION FRAME LANDS ON WHOLE PIXELS.
     Ced: "make the blue lines in display all even", with a capture of a selected picture.

     Measured on that capture: scanning across the frame gave blue runs of 2, 2, 2 and 3 pixels, and
     scanning down it gave 2, 2, 1 and 2. A 2px ring, painting 3 on one side and 1 on the other.

     Two causes, and both are here. The frame took its `left` and `top` straight from the mark's own
     inline style — a fraction, because a mark's position is a fraction of the page width times the
     scale — while its width and height came from `offsetWidth`, which is already rounded. So one
     edge sat on a whole pixel and the opposite edge did not, and a ring straddling a half pixel is
     painted as three device pixels on one side and one on the other. Rounding the whole box fixes
     every side at once, and moving the furniture by less than a pixel is not a thing the eye can
     see — it is drawn on top of a mark that has not moved.
     (The second cause is three rings being drawn where one was wanted; see `hasselui` below.)
     ============================================================================================== */
  const _px=v=>Math.round(parseFloat(v)||0);
  const _l=_px(c.d.style.left), _t=_px(c.d.style.top);
  f.style.left=_l+"px";
  f.style.top=_t+"px";
  f.style.width=Math.round(c.d.offsetWidth)+"px";
  f.style.height=Math.round(c.d.offsetHeight)+"px";
  /* 6lj — and the rounding has to be done where the PIXELS are, not where the page's numbers are.
     Rounding `left` inside the page lands on a whole pixel of the page, and the page itself sits at a
     fraction of the window (it is centred in the free space, and that is rarely an even number), so
     the first attempt at this measured 622.8 on screen from a left of 623. The frame is nudged by
     whatever fraction is left after it has been placed, which costs one rect read and puts all four
     of its edges on the device grid. */
  try{
    const r=f.getBoundingClientRect();
    const dx=r.left-Math.round(r.left), dy=r.top-Math.round(r.top);
    if(dx)f.style.left=(_l-dx)+"px";
    if(dy)f.style.top=(_t-dy)+"px";
  }catch(e){}
  setMarkSpin(f,c.a.rot);          /* 6lz — the frame turns; the controls on it do not */
  /* the mark may have gained or lost a class since the frame was built (a shape typed into, say) */
  [...c.d.classList].forEach(k=>{ if(!/^(anno|sel|multi|dragging|editing|hasselui)$/.test(k))f.classList.add(k); });
}
/* ==================================================================================================
   6mn — WHILE YOU ARE ADJUSTING IT, YOU CAN SEE IT. Ced: "when adjusting the text size, the preview
   should look like this to not cover the space being edited and then once the user is not holding
   the text anymore, go back to the previous view" · "this adjusting view should apply to all items,
   redlines, shapes, lines on the ui."

   Selecting a mark puts a great deal round it — eight resize grips, a ✕ at the corner, the turn and
   move and edit grips hanging under it, a ring on the box and, for a stroke, a grip at every point.
   All of that is what you want when you are DECIDING what to touch, and all of it is in the way the
   moment you are touching it: the grips sit exactly where the edge you are dragging is, and what you
   are trying to judge is the edge.

   So for as long as the pointer is down on a mark the furniture goes, and the mark is backed by a
   pale wash the size of its own box — which says what is being adjusted, in the one way that cannot
   cover it, because an inset shadow paints over the mark's ground and UNDER its ink. Let go and
   everything comes back exactly as it was. The wash is on the box, so a shape shows the box it is
   being fitted into, which is the thing a shape resize is actually about.

   ONE switch, and the release is written once: every gesture that adjusts a mark calls
   `adjustBegin()`, and the pointer coming up anywhere ends it. A gesture that forgets to turn it off
   cannot exist, which matters more here than anywhere — a stuck `adjusting` would leave the user
   with no handles at all.
   ================================================================================================== */
let _adjOn=false;
function adjustEnd(){
  if(!_adjOn)return;
  _adjOn=false;
  document.body.classList.remove("adjusting");
  document.querySelectorAll(".anno.adjusting").forEach(n=>n.classList.remove("adjusting"));
}
/* the wash belongs on the MARK, not on whatever element the grip hung off: since 6is a selected
   mark's handles live on a frame in `.annoui`, which sits ABOVE every band, and a wash painted
   there would be over the ink rather than under it. The id is the one thing both have. */
function adjustBegin(id){
  _adjOn=true;
  document.body.classList.add("adjusting");
  if(id==null)return;
  const m=document.querySelector('.anno[data-id="'+id+'"]');
  if(m)m.classList.add("adjusting");
}
window.addEventListener("pointerup",adjustEnd,true);
window.addEventListener("pointercancel",adjustEnd,true);
window.addEventListener("blur",adjustEnd);
function startAnnoResize(ev,a,d,ed,pg,pos){
  /* 6fb — a LOCKED mark does not move. The lock is checked at the gesture, not in the renderer,
     so the mark still selects and still shows its bar — you just cannot shift it by accident. */
  if(a&&a.lock){ try{toast("This mark is locked");}catch(_){ } return; }
  ev.preventDefault(); ev.stopPropagation();
  /* 6gt — a press on a handle that turns out to be a click resizes nothing and writes no history */
  const _pre=snapshot(); let _rsMoved=false;
  selectAnno(a.id);
  try{d.setPointerCapture(ev.pointerId);}catch(e){}
  adjustBegin(a&&a.id);                /* 6mn — the furniture is in the way of this gesture */
  const w=pg.offsetWidth, cx=ev.clientX, cy=ev.clientY;
  /* 6dt — the modifier is read at the START of the drag as well as during it. Reading it only from the
     move events makes the behaviour depend on the browser still reporting the key on a captured pointer,
     and it means letting go of Ctrl halfway silently changes what the drag is doing. Held when you grab
     the handle is the whole gesture. */
  const startCtrl=!!(ev.ctrlKey||ev.metaKey);
  const startW=ed.offsetWidth, startPx=a.size*S.scale, startLeft=parseFloat(d.style.left);
  const isImg=(a.kind==="img");
  const shp=isFreeBox(a);
  const h0=pg.offsetHeight, startH=ed.offsetHeight, startTop=parseFloat(d.style.top);
  const ax0=a.nx, ay0=a.ny;      /* 6eq — the logical position the gesture started from */
  /* 6g9 — A ROTATED BOX RESIZES IN ITS OWN FRAME.
     Ced: "when a shape is rotated to 90deg, the adjustment controls/resizing is not working well."
     The handles are drawn by the browser on the ROTATED element, so the one labelled `e` is wherever
     the rotation put it — on a quarter-turned box it points down the page. The gesture, though, was
     read in screen pixels and applied to width and height directly, so dragging that handle changed
     the wrong dimension and the box also walked across the page, because the position correction
     (`left += startW - nw`) is only true for an unrotated box.

     Both halves are fixed by working in the mark's own frame. The pointer delta is turned back through
     -θ, so `dxr` is along the box's own width whichever way it is facing; and the new left/top are
     derived from the rule that the edge or corner OPPOSITE the handle must not move: with a rotation
     about the centre, holding that anchor still means shifting the centre by R·(anchor_before -
     anchor_after) and placing the box around it. At θ=0 this reduces exactly to the arithmetic that
     was here before. */
  const _th=((a.rot||0)*Math.PI)/180, _cs=Math.cos(_th), _sn=Math.sin(_th);
  const move=e=>{
    const dxs=e.clientX-cx, dys=e.clientY-cy;
    if(!_rsMoved){
      if(Math.hypot(dxs,dys)<=DRAG_SLOP)return;
      _rsMoved=true;
      S.history.push(_pre); if(S.history.length>80)S.history.shift();
      S.future=[]; updateUndoUI();
    }
    const dx= dxs*_cs+dys*_sn;          /* along the mark's own width  */
    const dy=-dxs*_sn+dys*_cs;          /* along the mark's own height */
    /* Where the box has to sit so the edge opposite the handle stays put. */
    const place=(w1,h1)=>{
      const sx=(pos.indexOf("e")>=0)?-1:((pos.indexOf("w")>=0)?1:0);
      const sy=(pos.indexOf("s")>=0)?-1:((pos.indexOf("n")>=0)?1:0);
      const vx=sx*(startW-w1)/2, vy=sy*(startH-h1)/2;
      const Cx=startLeft+startW/2+(vx*_cs-vy*_sn);
      const Cy=startTop +startH/2+(vx*_sn+vy*_cs);
      return [Cx-w1/2,Cy-h1/2];
    };
    /* A SHAPE OR A TEXT BOX resizes in both axes, freely, from whichever edge or corner is held — a
       box round a table cell, an ellipse round a bolt and a note beside a member are all drawn to fit
       something on the page, so neither an aspect lock nor a font size has any business in it. */
    if(shp){
      /* 6k0 — the floor is a fraction of the PAGE, not a count of screen pixels, so it is the same
         mark at every zoom and the rule's weight has no say in it. */
      const FW=markMinPx(w), FH=markMinPx(h0);
      let nw=startW, nh=startH;
      if(pos.indexOf("e")>=0)nw=Math.max(FW,startW+dx);
      if(pos.indexOf("w")>=0)nw=Math.max(FW,startW-dx);
      if(pos.indexOf("s")>=0)nh=Math.max(FH,startH+dy);
      if(pos.indexOf("n")>=0)nh=Math.max(FH,startH-dy);
      /* 6fh — Ced: "resizing the shapes with ctrl on should make the shape perfect too." The same rule
         the DRAW gesture has: hold Ctrl and the box squares off — a perfect square, a true circle. The
         longer side wins, and the edge you are NOT holding stays where it is, so the shape grows from
         the corner opposite the handle rather than jumping. */
      /* 6lc — A TEXT BOX IS NOT A SHAPE, AND CTRL MEANS SOMETHING ELSE ON ONE.
         Ced: "expanding a text using ctrl should only make the textbox longer in width not in height
         if dragged with the left or right handle." On a shape Ctrl squares the box off, which is what
         it has always meant; on a TEXT box the same modifier has meant "grow about the middle" since
         6dr — a redline sits centred over the value it covers, so widening it from one side walks it
         off that value. A text box arrived in this branch with the shapes (6kn made every free box one
         gesture) and picked up the square-off with them, so Ctrl on a side handle was turning a note
         into a square: measured on a 240x29px box, one Ctrl-drag of the `e` handle took it to 331x331.
         So Ctrl on a text box's SIDE handle grows the width about the middle and leaves the height
         exactly where it was, and Ctrl on a corner is left to the shape rule, where it still squares. */
      /* 6mz — AND NOW EVERY HANDLE ON A TEXT BOX, NOT ONLY THE TWO SIDES.
         Ced: "using ctrl on text box if dragged on the top or bottom and corners should just adjust
         the text on both sides, same idea of the ctrl used to adjust the left and right which
         adjusts both sides the same time." 6lc read the modifier on `e` and `w` only, so a top
         handle moved its own edge and a corner fell through to the shape rule and squared the note
         off. The rule is one rule: on a text box, Ctrl means the CENTRE stays put, and whichever
         axes the handle touches grow by twice the drag — a side touches width, a top or bottom
         touches height, a corner touches both. An axis the handle does not touch is left alone. */
      const _ctrl=(startCtrl||e.ctrlKey||e.metaKey);
      const _tbMid=isTextBox(a)&&!isImg;
      if(_ctrl&&_tbMid){
        const _ex=pos.indexOf("e")>=0, _wx=pos.indexOf("w")>=0;
        const _sy=pos.indexOf("s")>=0, _ny=pos.indexOf("n")>=0;
        nw=(_ex||_wx)?Math.max(FW,startW+(_ex?dx:-dx)*2):startW;
        nh=(_sy||_ny)?Math.max(FH,startH+(_sy?dy:-dy)*2):startH;
      }
      else if(_ctrl&&!isImg){
        const side=Math.max(nw,nh); nw=side; nh=side;
      }
      /* 6lc — growing about the middle means the CENTRE is what stays put, not the opposite edge, so
         this one gesture places itself rather than asking `place()`, which holds the far edge. The
         box turns about its centre, so a rotated box needs no extra correction here. */
      let [nl,nt]=(_ctrl&&_tbMid)
        ? [startLeft+(startW-nw)/2, startTop+(startH-nh)/2]
        : place(nw,nh);
      ed.style.width=nw+"px"; ed.style.height=nh+"px";
      d.style.left=nl+"px"; d.style.top=nt+"px";
      a.nw=nw/w; a.nh=nh/h0;
      a.nx=ax0+(nl-startLeft)/w; a.ny=ay0+(nt-startTop)/h0;
      a.manualW=true;
      /* 6k0 — A TEXT BOX MADE SHORTER TAKES ITS TYPE WITH IT. Without this the box is let go at the
         new height and `growTextBox` immediately pushes it back out to whatever the words need at
         their old point size — which is why a 30pt note floored at 90px and a 6pt one at 11px, the
         "minimum relies on size" Ced reported. Only a vertical handle rescales, exactly as the
         ordinary text path does: a side handle re-wraps, which is what a side handle is for. */
      /* 6lc — AND NOW ONLY A CORNER DOES. Ced: "resizing using the top and bottom handles should not
         make the font smaller in texts. it should only work when the corner handles were used."
         `pos.indexOf("n")>=0` is true of `nw` and `ne` as well as `n`, so this read every handle but
         `e` and `w` — eight handles, six of which changed the point size. A top or bottom handle is
         how you give a note more room to wrap into, and taking the type size with it meant you could
         not do that at all: the box got taller and the words grew to match, so nothing re-wrapped.
         A CORNER is the one that scales the mark as a picture, and it is the only one left that does.
         `pos.length===2` is exactly the four corners. */
      if(isTextBox(a)&&!isImg&&startH>0&&pos.length===2){
        const k=nh/startH;
        const npt=Math.max(0.5,(startPx/S.scale)*k);
        if(Math.abs(npt-a.size)>0.01){
          a.size=npt;
          ed.style.fontSize=(npt*S.scale)+"px";
          ed.style.setProperty("line-height",(npt*S.scale*1.22*markLnsp(a))+"px","important");
        }
      }
      /* 6g9 — resizing a callout re-derives where its leader leaves the box; the elbow and tip stay */
      /* 6gl — the outline follows the box it belongs to, every frame of the drag */
      paintShapeOutline(d,a,w,h0,shapeNeedsSvg(a,(a.nw||0.1)*w,(a.nh||0.06)*h0));
      if((a.group!=null||a.maKind==="callout"||shapeSvgOutline(a))&&pageRendered(a.page))drawPageLines(a.page);
      positionBar(); return;
    }
    if(isImg){
      const ar=(startH>0?startW/startH:1);
      if(pos.length===2){                                  // corner: keep the aspect ratio
        const sx=pos.includes("e")?dx:-dx;
        const nw=Math.max(24,startW+sx), nh=Math.max(18,nw/ar);
        ed.style.width=nw+"px"; ed.style.height=nh+"px"; a.nw=nw/w; a.nh=nh/h0;
        /* 6eq — deltas here too, for the same reason as dragBody: the rendered top is not the mark's
           logical position, so converting it back bakes the renderer's own offset into the value. */
        if(pos.includes("w")){ const nl=startLeft+(startW-nw); d.style.left=nl+"px"; a.nx=ax0+(nl-startLeft)/w; }
        if(pos.includes("n")){ const nt=startTop+(startH-nh); d.style.top=nt+"px"; a.ny=ay0+(nt-startTop)/h0; }
      } else if(pos==="e"||pos==="w"){
        if(startCtrl||e.ctrlKey||e.metaKey){             // 6dr — from the middle, as for text
          const nw=Math.max(24,startW+(pos==="e"?dx:-dx)*2);
          ed.style.width=nw+"px"; a.nw=nw/w;
          const nl=startLeft-(nw-startW)/2; d.style.left=nl+"px"; a.nx=nl/w;
        } else {
          const nw=Math.max(24,pos==="e"?startW+dx:startW-dx);
          ed.style.width=nw+"px"; a.nw=nw/w;
          if(pos==="w"){ const nl=startLeft+dx; d.style.left=nl+"px"; a.nx=nl/w; }
        }
      }
      a.manualW=true; positionBar(); return;
    }
    /* 6dr — hold Ctrl (or Cmd) and a side handle grows the box about its MIDDLE: both edges move, the
       centre stays put. A redline sits centred over the value it covers, so widening it from one side
       walks it off that value and you then have to drag it back — which is the whole reason this was
       asked for. Without the modifier the handle behaves as it always did, moving its own edge. */
    /* 6mz — a corner counts too: it holds an east or west edge, so under Ctrl that edge's growth is
       shared with the one opposite it, the same as a bare side handle. The type still scales with
       the vertical part of the corner drag, below. */
    const fromMiddle=(startCtrl||e.ctrlKey||e.metaKey)&&(pos.indexOf("e")>=0||pos.indexOf("w")>=0);
    if(fromMiddle){
      const grow=(pos.indexOf("e")>=0?dx:-dx);           // outward on either side is positive
      const nw=Math.max(markMinPx(w),startW+grow*2);          /* 6k0 */
      ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true;
      const nl=startLeft-(nw-startW)/2;                  // half the growth off each edge
      d.style.left=nl+"px"; a.nx=nl/w;
    } else {
      /* 6k0 — the same page-relative floor the free boxes now use */
      if(pos.includes("e")){ const nw=Math.max(markMinPx(w),startW+dx); ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true; }
      if(pos.includes("w")){ const nw=Math.max(markMinPx(w),startW-dx); ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true; const nl=startLeft+dx; d.style.left=nl+"px"; a.nx=nl/w; }
    }
    /* 6dt — the text follows the box as it is dragged: narrow it and the value wraps inside rather
       than spilling past the edge you are dragging. */
    if(pos==="e"||pos==="w"||pos.length===2) fitTextInside(a,ed,pg);
    /* 6lc — CORNERS ONLY, the same rule the boxed path now has. A plain redline has no box of its own,
       so a top or bottom handle has nothing left to change and does nothing, which is the honest
       answer to "it should only work when the corner handles were used". */
    /* 6na — A CORNER SCALES THE TYPE, AND SO DOES A TOP OR BOTTOM PILL.
       6lc left `n` and `s` doing nothing on a plain redline, on the reasoning that it has no box to
       make taller — true of the box and not of the mark. A redline's height IS its type, so the one
       honest thing a vertical handle can do here is size the type, which is exactly the vertical
       half of what a corner already does. Ced: "the text in redline tool should behave similarly
       with text box when selected." `pos.length===2` is the four corners; `n` and `s` are the two
       pills; `e` and `w` are left alone, because a side handle re-wraps and always has. */
    if(pos.length===2||pos==="n"||pos==="s"){
      const delta=(pos.indexOf("s")>=0?dy:-dy);
      /* 6ha — down to 2pt, the same floor the panel now has */
      const npx=Math.max(2*S.scale,startPx+delta); ed.style.fontSize=npx+"px"; a.size=npx/S.scale;
    }
    positionBar();
  };
  /* 6gl — AND THE MARK IS LAID OUT AGAIN WHEN THE HANDLE IS LET GO. Everything a layout derives —
     the outline, the hatch, the wrap, where the text sits — was left at whatever the drag happened to
     set, which is how a resized shape ended up in two pieces. Skipped while a mark is being typed in,
     since a re-layout rebuilds the element and would take the caret with it. */
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    try{
      /* 6hh — a text box you have just made narrower re-wraps, and the height you let go of is the
         new floor it will not shrink below */
      /* 6ke — the handle is the user speaking. From here the box is theirs: `growTextBox` steps
         aside, and the one thing that still happens is a re-wrap to the new width, which is what
         narrowing a box is FOR. */
      /* 6ke — the handle is the user speaking. From here the box is theirs, and NOTHING re-measures
         it: `growTextBox` steps aside, and so does `fitTextInside`, which re-wraps to the new width
         but also re-derives the HEIGHT from the lines — which is the very decision just taken away
         from it. Measured with the re-fit left in: a text box dragged as small as it would go sprang
         back to 26.3pt tall whatever its point size, which is the floor Ced asked to be rid of.
         The re-wrap happens anyway, in CSS, at the width the box now has. */
      if(isTextBox(a)&&_rsMoved){ a.minNh=a.nh; a.userSized=true; }
      if(!document.querySelector(".anno.editing")){ layoutAnnos(); }
      /* ==========================================================================================
         6m4 — AND THEN THE BOX IS MADE TALL ENOUGH TO HOLD WHAT IT NOW SAYS.
         Ced: "text wrapping issue not yet solved. make the default break inside a line. but the text
         should be all covered", with a capture of a box three lines deep whose third line is sitting
         below its own bottom edge, and then "make sure the size of the textbox the user puts is
         granted."

         Measured: `growTextBox` is called from exactly two places, `ed.oninput` and the paste
         handler. Both are TYPING. Narrowing a box with a side handle re-wraps the text — more lines,
         in the same height — and nothing re-measured it, so the extra lines hung out of the bottom.
         6lc had already made a text box's overflow visible rather than clipped, which is why they are
         seen rather than lost, and that is the picture Ced sent.

         The missing call is this one, and the rule it follows is 6lv's: WIDTH is the user's decision
         and is not touched; HEIGHT is a floor — `minNh` was just set to the height the hand let go
         of, one line above — and the box may grow past it to cover its own text. So the size the
         hand gave is granted in the only sense that can be granted for both asks at once.
         ========================================================================================== */
      if(isTextBox(a)&&_rsMoved){
        const dd=document.querySelector(`.anno[data-id="${a.id}"]`);
        const ee=dd&&dd.querySelector(".ed");
        if(ee&&growTextBox(a,ee,pg))layoutAnnos();
      }
      else { const dd=document.querySelector(`.anno[data-id="${a.id}"]`);
             paintShapeOutline(dd,a,pg.offsetWidth,pg.offsetHeight,
               shapeNeedsSvg(a,(a.nw||0.1)*pg.offsetWidth,(a.nh||0.06)*pg.offsetHeight)); }
      if(pageRendered(a.page))drawPageLines(a.page);
      positionBar(); if(_rsMoved)autosave();
    }catch(e){}
  };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
/* move every selected mark — text redlines and strikes alike — as a single rigid block */
function dragMulti(e,pg){
  /* 6fb — a LOCKED mark does not move. The lock is checked at the gesture, not in the renderer,
     so the mark still selects and still shows its bar — you just cannot shift it by accident. */
  try{ const L=[...S.selMulti].some(id=>{const o=S.annos.find(z=>z.id===id);return o&&o.lock;})
        ||[...S.selMultiL].some(id=>{const o=S.lines.find(z=>z.id===id);return o&&o.lock;});
       if(L){ toast("Some of these are locked"); return; } }catch(_){ }
  e.preventDefault();
  const w=pg.offsetWidth,h=pg.offsetHeight, sx=e.clientX, sy=e.clientY;
  const startA=multiAnnos().map(a=>({a,ox:a.nx,oy:a.ny}));
  /* 6fm — KEEP BOTH ENDS. This recorded only y1 and then wrote `l.y1=l.y2=oy+dy`, so ANY drag of a
     selection flattened every sloped line in it — and a cross-out is always selected as a group, so
     clicking one and moving the pointer a few pixels turned the X into two parallel strikes. 6dw found
     exactly this in `alignSelected` and guarded it there; the same flattening was still here and in
     `distributeSelected`. Ced: "the cross sometimes becomes 2 lines when reclicked." */
  /* 6g9 — a callout's leader travels with its box even when the marquee caught only the box */
  const startL=multiLines().map(l=>({l,pts:linePts(l).map(p=>[p[0],p[1]])}));
  if(!startA.length&&!startL.length)return;
  /* 6gt — the snapshot is taken, but it is only PUT ON THE STACK once something has actually moved:
     a click on a selection used to push an entry that undid to the state you were already in. */
  const pre=snapshot();
  const bb=multiBBox(pg); if(!bb)return;
  const targets=(S.magnet)?buildSnapTargets(pg,startA.map(s=>s.a.id)):null;
  const pagesTouched=new Set(startL.map(s=>s.l.page));
  let moved=false, _mdPt=null;
  const move=ev=>{
    let dxp=ev.clientX-sx, dyp=ev.clientY-sy;
    /* 6gt — a click on a selection leaves it exactly where it is; see dragBody */
    if(!moved){ if(Math.hypot(dxp,dyp)<=DRAG_SLOP)return; moved=true; }
    if(targets&&!snapOff(ev)){ const s=applySnap(targets,bb.l+dxp,bb.t+dyp,bb.r-bb.l,bb.b-bb.t); dxp=s.l-bb.l; dyp=s.t-bb.t; drawSnapGuides(pg,s.gx,s.gy,s.gxMid,s.gyMid); }
    else if(targets)clearSnapGuides(pg);
    const dx=dxp/w, dy=dyp/h;
    startA.forEach(s=>{ s.a.nx=s.ox+dx; s.a.ny=s.oy+dy;
      const d=document.querySelector(`.anno[data-id="${s.a.id}"]`); if(d){ d.style.left=(s.a.nx*w)+"px"; d.style.top=(s.a.ny*h)+"px"; } });
    startL.forEach(s=>{ const moved=s.pts.map(p=>[p[0]+dx,p[1]+dy]);
      if(s.l.pts)s.l.pts=moved;
      s.l.x1=moved[0][0]; s.l.y1=moved[0][1];
      s.l.x2=moved[moved.length-1][0]; s.l.y2=moved[moved.length-1][1]; });
    if(startL.length) pagesTouched.forEach(pi=>{ if(pageRendered(pi))drawPageLines(pi); });
    _mdPt={x:ev.clientX,y:ev.clientY};
    try{ maHintCrossPage(ev.clientX,ev.clientY,(startA[0]||startL[0]||{}).a?startA[0].a.page:(startL[0]?startL[0].l.page:-1)); }catch(e2){}
    /* 6gc — THE FRAME TRAVELS WITH THE MARKS. Ced: "moving shapes after grouping leaves the ui."
       The frame, its handles and its rotate grip were painted once when the selection was made and
       never again until the drag ended, so dragging a group left the whole apparatus sitting where
       the marks used to be — and the handles you would reach for next were nowhere near them. */
    try{ paintGroupFrame(); }catch(e){}
    positionMultibar();
  };
  const up=()=>{ clearSnapGuides(pg); window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    try{ maHintCrossPage(null); }catch(e2){}
    /* 6jn — a selection let go over another page moves to it, whole */
    if(moved&&_mdPt){ try{ maDropAcrossPages(_mdPt.x,_mdPt.y,true); }catch(e2){} }
    if(moved){ S.history.push(pre); if(S.history.length>80)S.history.shift();
               S.future=[]; updateUndoUI();
               updateRail(); refreshMarks(); autosave(); } positionMultibar(); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
/* ---- align / distribute / match size across the selection ---- */
function annoBox(a,w,h){ const d=document.querySelector(`.anno[data-id="${a.id}"]`);
  return {l:a.nx*w, t:a.ny*h, w:d?d.offsetWidth:0, h:d?d.offsetHeight:0}; }
function alignSelected(how){
  if(multiCount()<2)return;
  const pg=selectionPage(); if(!pg)return;
  const w=pg.offsetWidth,h=pg.offsetHeight, bb=multiBBox(pg); if(!bb)return;
  pushHistory();
  const setAX=(a,px)=>{ a.nx=px/w; }, setAY=(a,py)=>{ a.ny=py/h; };
  multiAnnos().forEach(a=>{ const b=annoBox(a,w,h);
    if(how==="left")setAX(a,bb.l);
    else if(how==="right")setAX(a,bb.r-b.w);
    else if(how==="hcenter")setAX(a,(bb.l+bb.r)/2-b.w/2);
    else if(how==="top")setAY(a,bb.t);
    else if(how==="bottom")setAY(a,bb.b-b.h);
    else if(how==="vmiddle")setAY(a,(bb.t+bb.b)/2-b.h/2);
  });
  multiLines().forEach(l=>{ const len=Math.abs(l.x2-l.x1);
    if(how==="left"){ l.x1=bb.l/w; l.x2=l.x1+len; }
    else if(how==="right"){ l.x2=bb.r/w; l.x1=l.x2-len; }
    else if(how==="hcenter"){ const c=((bb.l+bb.r)/2)/w; l.x1=c-len/2; l.x2=c+len/2; }
    /* 6dw — a line has no top or bottom to align to: flattening y1 and y2 onto one value is exactly
       what collapsed a cross-out into a single stroke. Horizontal alignment still applies; vertical
       does not, and the buttons for it are hidden whenever a line is selected. The guard stays here as
       well, because a keyboard shortcut can reach this function without going through the bar. */
    else if(how==="top"||how==="bottom"||how==="vmiddle"){ /* not for a line */ }
  });
  layoutAnnos(); drawAllLines(); paintMulti(); updateRail(); refreshMarks(); autosave();
  toast("Aligned "+multiCount()+" marks");
}
function distributeSelected(axis){
  const pg=selectionPage(); if(!pg)return;
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const items=[...multiAnnos().map(a=>({kind:"a",o:a})),...multiLines().map(l=>({kind:"l",o:l}))];
  if(items.length<3){ toast("Pick at least 3 marks to space evenly"); return; }
  const pos=it=>it.kind==="a" ? (axis==="h"?it.o.nx*w:it.o.ny*h) : (axis==="h"?Math.min(it.o.x1,it.o.x2)*w:it.o.y1*h);
  const size=it=>{ if(it.kind==="l")return axis==="h"?Math.abs(it.o.x2-it.o.x1)*w:0; const b=annoBox(it.o,w,h); return axis==="h"?b.w:b.h; };
  items.sort((p,q)=>pos(p)-pos(q));
  pushHistory();
  const first=pos(items[0]), lastI=items[items.length-1];
  const span=(pos(lastI)+size(lastI))-first;
  const totalSize=items.reduce((n,it)=>n+size(it),0);
  const gap=(span-totalSize)/(items.length-1);
  let cur=first;
  items.forEach(it=>{
    if(it.kind==="a"){ if(axis==="h")it.o.nx=cur/w; else it.o.ny=cur/h; }
    else { if(axis==="h"){ const len=Math.abs(it.o.x2-it.o.x1); it.o.x1=cur/w; it.o.x2=it.o.x1+len; }
           /* 6fm — TRANSLATE, never flatten (the 6dw rule, which this function never got). Spacing a
              sloped line down the page moves it; it does not turn it into a horizontal one. */
           else { const y2=(it.o.y2!=null?it.o.y2:it.o.y1), d=cur/h-it.o.y1; it.o.y1+=d; it.o.y2=y2+d; } }
    cur+=size(it)+gap;
  });
  layoutAnnos(); drawAllLines(); paintMulti(); updateRail(); refreshMarks(); autosave();
  toast("Spaced "+items.length+" marks evenly");
}
function matchSizeSelected(){
  const as=multiAnnos(); if(as.length<2){ toast("Select two or more redlines"); return; }
  pushHistory();
  const target=Math.max(...as.map(a=>a.size||8));
  as.forEach(a=>{ a.size=target; fitCellBox(a); });
  layoutAnnos(); paintMulti(); autosave();
  toast("Matched to "+target+" pt");
}
/* the page filling most of the viewport (independent of where the mouse happens to be) */
/* 6ey — WHICH PAGE AM I ON: the one with the most of it on screen. The old rule took the page whose
   CENTRE was nearest the middle of the window, which is only the same answer while every page is the same
   height and none is much taller than the window: a page zoomed past the window's height has its centre
   off-screen, and a shorter neighbour showing a sliver can hold a centre that is nearer the middle than
   the page you are reading. Visible area cannot be argued with — it is the page you are looking at.
   In page view there is only one page shown and `_pageView` answers directly. */
function visiblePageIdx(){
  if(typeof _pageView!=="undefined"&&_pageView&&typeof _viewPi!=="undefined")return _viewPi;
  const H=window.innerHeight; let best=null,ba=0;
  document.querySelectorAll("#pages .page").forEach(pgEl=>{
    const r=pgEl.getBoundingClientRect();
    const vis=Math.max(0,Math.min(r.bottom,H)-Math.max(r.top,0));
    if(vis<=0)return;                                        // off-screen
    if(vis>ba){ ba=vis; best=+pgEl.dataset.idx; }
  });
  return best==null?currentPageIdx():best;
}
function selectAllOnPage(){
  if(!S.doc)return;
  /* 6ey — and the caret comes back to the document. 6ex let the CHORDED keys through while a ribbon field
     held the caret, so Ctrl+A now selects — but Delete keeps the wide guard (it has to: Delete must not
     remove a mark while you edit a search term), so the pair came apart: Ctrl+A worked and the Delete
     after it did nothing. Taking a selection IS working on the document, so it releases the field. */
  _releaseChromeFocus();
  try{ sbPaintHold(); }catch(_){}          /* 6i0 — taking the page is not painting either */
  const pi=visiblePageIdx();
  clearMulti(); selectAnno(null); S.selLine=null; $("#linebar").classList.remove("show");
  ensurePageRendered(pi);                                     // marks can only paint on a rendered page
  S.annos.forEach(a=>{ if(a.page===pi)S.selMulti.add(a.id); });
  S.lines.forEach(l=>{ if(l.page===pi)S.selMultiL.add(l.id); });
  setTimeout(()=>{ paintMulti(); positionMultibar(); },60);
  paintMulti();
  const n=multiCount();
  LOG("selectAllOnPage: page",pi+1,"→",n,"mark(s)");
  setStatus(n?`Selected ${n} mark(s) on page ${pi+1} — drag any one to move them together.`
             :`No redlines on page ${pi+1} yet.`);
}
/* 6gt — how far the pointer has to travel before a press counts as a drag. Three pixels is under the
   wobble of a click and well under anything anybody means as a move. Every gesture that MOVES a mark —
   the body, a selection, a stroke, a stroke's own points — measures against this one number. */
const DRAG_SLOP=3;
/* 6hq — the mark a drawing tool's press landed on, if any; cleared on the release that used it */
let _downAnno=null;
function tookClickOnMark(){
  if(_downAnno==null)return false;
  const id=_downAnno; _downAnno=null;
  const a=S.annos.find(z=>z.id===id);
  if(!a)return false;
  setMode("select");
  /* the same decision a press in Select mode makes: a reading selects the MEASUREMENT it belongs to,
     a grouped mark selects its group, anything else selects itself */
  if(a.maKind==="dimlabel"){
    const dl=(typeof maDimLineOf==="function")?maDimLineOf(a):null;
    if(dl){ selectLine(dl.id); return true; }
  }
  if(a.group!=null&&!groupOpenIs(a.group)){ selectGroup(a.group); return true; }   /* 6jz */
  selectAnno(id);
  return true;
}
function dragBody(e,d,a,pg){
  /* 6fb — a LOCKED mark does not move. The lock is checked at the gesture, not in the renderer,
     so the mark still selects and still shows its bar — you just cannot shift it by accident. */
  if(a&&a.lock){ try{toast("This mark is locked");}catch(_){ } return; }
  e.preventDefault();
  let sx=e.clientX,sy=e.clientY,ox=parseFloat(d.style.left),oy=parseFloat(d.style.top),moved=false;
  /* 6eq — TWO BUGS LIVED IN THE NEXT SIX LINES, and both are what Ced reported.

     ONE. `a.ny = nt/h` took the element's RENDERED top and stored it as the mark's logical position. For
     a cell redline those are not the same number: `layoutAnnos` lifts the box by half the difference
     between its line box and its glyph box, and drops it by REDLINE_DROP, so `d.style.top` is already
     `a.ny*h` minus that offset. Storing it back baked the offset into `a.ny`, and the next layout applied
     the lift AGAIN — the mark stepped down. And because the lift is a fraction of the PAGE HEIGHT, the
     size of the error changes with the scale, which is why it showed up on a zoom: "a redline that was
     moved, then zoomed out, moves down a bit."
     The cure is to stop converting rendered pixels back into logical ones at all. The gesture is a
     DELTA: however the renderer chooses to offset the box, moving the pointer 30px down moves the mark
     30px down. The nudge path has always done it this way.

     TWO. `pushHistory()` fired on the way UP, so the snapshot on the stack was the state AFTER the move.
     Every other caller in the file snapshots BEFORE it mutates. So the first Ctrl+Z restored the state
     you were already in — it looked like nothing happened — and the second popped the entry underneath,
     which for redlines placed by Apply is the state before Apply: every new redline vanished at once.
     That is "ctrl z directly removes all new redlines". The snapshot is taken before the first movement
     and committed only if the mark actually moved. */
  const ax0=a.nx, ay0=a.ny;
  const pre=snapshot();
  let _dragPt=null;
  d.classList.add("dragging");
  adjustBegin(a&&a.id);                  /* 6mn */
  const targets=(S.magnet)?buildSnapTargets(pg,[a.id]):null;
  const move=ev=>{ const w=pg.offsetWidth,h=pg.offsetHeight; let nl=ox+(ev.clientX-sx),nt=oy+(ev.clientY-sy);
    /* 6gt — A CLICK IS NOT A DRAG. Ced: "adjusting redlines/photos and then clicking them should not
       move it whatsoever." A press and release on a mark still fires a pointermove or two — the hand
       never holds a mouse perfectly still — and the old code acted on every one of them: the magnet
       took the nearest guide and the mark jumped there, on a gesture the user read as "I clicked it".
       Worse, `moved` stayed false, so nothing was pushed onto the history and Ctrl+Z could not put it
       back. Nothing happens now until the pointer has travelled past the slop, and past that point the
       gesture is a real drag and behaves exactly as it always did. */
    if(!moved){ if(Math.hypot(ev.clientX-sx,ev.clientY-sy)<=DRAG_SLOP)return; moved=true; }
    if(targets&&!snapOff(ev)){ const s=applySnap(targets,nl,nt,d.offsetWidth,d.offsetHeight); nl=s.l; nt=s.t; drawSnapGuides(pg,s.gx,s.gy,s.gxMid,s.gyMid); }
    else if(targets)clearSnapGuides(pg);
    d.style.left=nl+"px";d.style.top=nt+"px";
    const _pnx=a.nx, _pny=a.ny;
    a.nx=ax0+(nl-ox)/w; a.ny=ay0+(nt-oy)/h;      /* the DELTA, not the rendered position */
    /* 6ha — A READING BEING DRAGGED IS FREE FROM THE FIRST PIXEL. Ced: "it should refresh in realtime
       and should not be broken when moved." `maSyncDims` puts an un-freed reading back on the middle of
       its run on every draw pass, and the free flag was only set on pointerUP — so for the whole of a
       drag the reading was being pulled by one hand and shoved back by the other, which is exactly what
       "broken when moved" looks like. Freeing it as it moves keeps its offset and its position the same
       number at every frame. */
    if(a.maKind==="dimlabel"){ try{ maDimLabelFreed(a); }catch(e){} }
    /* 6gu — THE ARROW IS THE ANCHOR, NOT THE BOX. Ced: "in callouts, make the body movable but if the
       body is moved, the anchoring should be from the arrow." The arrow is on the member the note is
       about; the box is wherever there is room for it. Moving the box used to carry the arrow with it,
       so tidying the note off a crowded drawing pulled the arrow off the thing it was pointing at and
       you then had to put the tip back by hand. The tip stays where it is now, and the leader re-routes
       from the box's new position — including flipping to whichever side of the box faces the arrow,
       which `maSyncCallouts` derives on the next draw — the redraw on the next line. To move the whole
       callout, arrow and all, take it with a marquee (or Shift-click both halves) and drag that. */
    if((a.group!=null||a.maKind==="callout"||shapeSvgOutline(a))&&pageRendered(a.page))drawPageLines(a.page);
    /* 6jn — while the hand is over another page, say so: the drop will move the mark there */
    _dragPt={x:ev.clientX,y:ev.clientY};
    try{ maHintCrossPage(ev.clientX,ev.clientY,a.page); }catch(e2){}
    positionBar(); };
  const up=()=>{ d.classList.remove("dragging"); clearSnapGuides(pg);
    window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    try{ maHintCrossPage(null); }catch(e2){}
    /* 6gc — a strike & write's writing follows its rule until the hand puts it somewhere itself */
    if(moved&&a.maKind==="fix")a.fixFree=true;
    /* 6gg — and a reading dragged off the middle of its run keeps that offset, travelling with it */
    if(moved&&a.maKind==="dimlabel"){ try{ maDimLabelFreed(a); }catch(e){} }
    /* 6jn — and if the hand let go over a different page, the mark goes to that page */
    let crossed=false;
    if(moved&&_dragPt){ try{ crossed=maDropAcrossPages(_dragPt.x,_dragPt.y,true); }catch(e2){} }
    if(moved){ S.history.push(pre); if(S.history.length>80)S.history.shift();
               S.future=[]; updateUndoUI(); autosave(); } };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
function dragify(handle,d,a,pg,ed){
  handle.addEventListener("pointerdown",e=>{ e.stopPropagation(); if(ed)ed.blur();
    if(S.selMulti.has(a.id)){ dragMulti(e,pg); return; }                    // part of a selection → move all of it
    if(a.group!=null&&!groupOpenIs(a.group)){ selectGroup(a.group); dragMulti(e,pg); return; }   /* 6jz */
    selectAnno(a.id); dragBody(e,d,a,pg); });
}
function updateCount(){const n=S.annos.length+S.lines.length;$("#cntPill").textContent=`${n} mark${n===1?"":"s"}`;refreshMarks();try{ updateMiniBar(); }catch(e){}}

/* ---------- selection toolbar ---------- */
const annobar=$("#annobar");
const multibar=$("#multibar");
/* one selection, two kinds of mark: text redlines (S.selMulti) and strikes/lines (S.selMultiL) */
function multiCount(){ return S.selMulti.size+S.selMultiL.size; }
function multiAnnos(){ return [...S.selMulti].map(id=>S.annos.find(a=>a.id===id)).filter(Boolean); }
/* 6gb — and a selected CALLOUT brings its leader, wherever the selection is used: a group move, a
   group scale, a rotate, an align, a delete. Ced: "it is one shape, the line and arrow should not come
   off from callout." The count is unchanged — the callout still reads as one thing. */
function multiLines(){
  const out=[...S.selMultiL].map(id=>S.lines.find(l=>l.id===id)).filter(Boolean);
  const have=new Set(out.map(l=>l.id));
  [...S.selMulti].forEach(id=>{
    const a=S.annos.find(z=>z.id===id); if(!a||a.maKind!=="callout")return;
    const l=(S.lines||[]).find(z=>z.coFor===a.id);
    if(l&&!have.has(l.id)){ have.add(l.id); out.push(l); }
  });
  return out;
}
function paintMulti(){
  document.querySelectorAll(".anno").forEach(d=>{
    d.classList.toggle("multi",S.selMulti.has(+d.dataset.id));
  });
  drawAllLines();
  updateGroupBtn&&updateGroupBtn();
  positionMultibar();
  paintGroupFrame();
}
/* =================================================================================================
   6g1 — THE FRAME ROUND A MULTI-SELECTION
   Ced: "when adjusting grouped items, the drag, rotate, and other changing functions should still
   show." A selection of several marks — which is what a GROUP is, since a group selects as a whole —
   drew a halo on each and nothing else: no extent, nothing to grab, no rotate grip. This is that
   frame, with the same four corner handles and the same rotate grip a single mark carries, acting on
   everything selected at once.
   ================================================================================================= */
function clearGroupFrame(){ document.querySelectorAll(".gframe").forEach(n=>n.remove()); }
function paintGroupFrame(){
  clearGroupFrame();
  if(multiCount()<2)return;
  const pg=selectionPage(); if(!pg)return;
  const bb=multiBBox(pg); if(!bb)return;
  const f=el("div","gframe");
  f.style.left=bb.l+"px"; f.style.top=bb.t+"px";
  f.style.width=Math.max(4,bb.r-bb.l)+"px"; f.style.height=Math.max(4,bb.b-bb.t)+"px";
  /* the body moves the whole selection, which is what dragMulti already does */
  const mv=el("div","gmove");
  mv.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); dragMulti(ev,pg); });
  /* 6hv — A DOUBLE-CLICK STILL OPENS THE TEXT UNDERNEATH. Ced: "double clicking a text in a grouped
     shape should also trigger edit." The frame's body covers the whole selection so that one drag
     moves all of it, and that same cover swallowed the double-click that would have put the caret in
     a callout or a labelled box. The frame hides itself for an instant, asks the page what is under
     the pointer, and sends the double-click on to that mark — so the gesture reaches the text without
     the frame giving up the drag. */
  /* 6jz — AND IT IS ALSO THE WAY INTO THE GROUP. The frame is what the pointer meets once a group is
     picked up, so the double-click that opens the group has to be answered here as well as on the
     mark. First double-click: the group opens and the thing under the pointer — mark OR stroke — is
     selected on its own, with its own handles and its own bar. Second double-click on a text: the
     caret, exactly as before. The group's membership is not touched either time. */
  mv.addEventListener("dblclick",ev=>{
    ev.preventDefault(); ev.stopPropagation();
    /* 6jz — the COVER has to come off, not just the frame. `.gframe .gmove` carries
       `pointer-events:auto` of its own, so silencing `f` left the cover answering the hit test and
       `elementFromPoint` handed back the cover itself — the mark underneath was never found and the
       double-click did nothing at all. Both are silenced for the one measurement. */
    const was=f.style.pointerEvents, wasM=mv.style.pointerEvents;
    f.style.pointerEvents="none"; mv.style.pointerEvents="none";
    let el2=null;
    try{ el2=document.elementFromPoint(ev.clientX,ev.clientY); }catch(e){}
    f.style.pointerEvents=was||""; mv.style.pointerEvents=wasM||"";
    const host=el2&&el2.closest?el2.closest(".anno"):null;
    const a2=host?S.annos.find(z=>+z.id===+host.dataset.id):null;
    let l2=null;
    if(!a2&&el2){ const lid=el2.getAttribute&&el2.getAttribute("data-lid");
      if(lid!=null)l2=S.lines.find(z=>+z.id===+lid); }
    const o2=a2||l2;
    if(o2&&o2.group!=null&&!groupOpenIs(o2.group)){
      groupEnter(o2.group);
      if(a2)selectAnno(a2.id); else selectLine(l2.id);
      return;
    }
    if(!a2)return;
    const ed2=host.querySelector(".ed"); if(!ed2)return;
    host.classList.add("editing"); ed2.focus();
    try{ document.getSelection().selectAllChildren(ed2); }catch(e){}
  });
  f.appendChild(mv);
  /* 6nb — THE SAME EIGHT GRIPS A MARK HAS. Ced: "the cross does not follow the same design
     language when selected." A cross-out is two grouped strokes, so what you click is the GROUP,
     and the group's frame carried four corners where every mark on the sheet carries four corners
     and four pills. The pills are the same elements with the same geometry — see `.gframe .gh.n`
     in selbar.css, which takes the mark's own clamp — and they drive the same `startGroupScale`,
     which now leaves an axis alone when the handle does not touch it. */
  ["nw","ne","se","sw","n","s","e","w"].forEach(pos=>{
    const h=el("div","gh "+pos);
    h.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); startGroupScale(ev,pg,bb,pos); });
    f.appendChild(h);
  });
  /* 6hb — THE SAME THREE CONTROLS A MARK AND A STROKE HAVE. Ced: "rotate, drag, and x is still not
     visible on cross out shapes" — a cross-out is two grouped strokes, so clicking it selects the
     GROUP, and the group's frame carried a rotate grip and nothing else: the body was draggable but
     said so nowhere, and there was no delete at all. They sit in a row under the frame now, in the
     same order and at the same size as the trio on a single mark. */
  /* 6i2 — if the bar will sit over the grips, put them above the frame instead */
  try{
    const mb=document.getElementById("multibar");
    const mr=mb&&mb.classList.contains("show")?mb.getBoundingClientRect():null;
    const fr=pg.getBoundingClientRect();
    const bottomY=fr.top+bb.b;                     /* the frame's foot, in window coordinates */
    if(mr&&bottomY+40>mr.top&&bottomY<mr.bottom+40)f.classList.add("up");
    else if(bottomY+40>window.innerHeight)f.classList.add("up");
  }catch(e){}
  const grips=el("div","ggrips");
  const gbtn=(cls,glyph,title,onDown,danger)=>{
    const b=el("button","ggrip "+cls+(danger?" danger":""),glyph); b.type="button"; b.title=title;
    b.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); onDown(ev); });
    grips.appendChild(b); return b;
  };
  gbtn("grot","\u21bb","Rotate the selection — drag to turn it, click to type an angle",
       ev=>startGroupRotate(ev,pg,bb));
  gbtn("gdrag","\u2725","Drag the selection",ev=>dragMulti(ev,pg));
  gbtn("gdel","\u2715","Delete the selection",ev=>{ ev.preventDefault();
        const n=deleteSelection(); if(n>0)setStatus("Deleted "+n+" mark"+(n===1?"":"s")+"."); },true);
  f.appendChild(grips);
  pg.appendChild(f);
}
/* Scale everything selected about the corner opposite the handle. */
function startGroupScale(ev,pg,bb,pos){
  ev.preventDefault(); pushHistory();
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const ax=(pos.indexOf("w")>=0)?bb.r:bb.l, ay=(pos.indexOf("n")>=0)?bb.b:bb.t;   /* the anchor */
  const w0=Math.max(4,bb.r-bb.l), h0=Math.max(4,bb.b-bb.t);
  const cx=ev.clientX, cy=ev.clientY;
  const A=multiAnnos().map(a=>({a,nx:a.nx,ny:a.ny,nw:a.nw||0,nh:a.nh||0,size:a.size||8}));
  const L=multiLines().map(l=>({l,pts:linePts(l).map(p=>[p[0],p[1]])}));
  const move=e=>{
    const dx=e.clientX-cx, dy=e.clientY-cy;
    /* 6nb — an axis the handle does not touch is NOT scaled. With only corners this was moot: every
       handle held both an east/west and a north/south edge. A side pill holds one, and the old
       arithmetic read "no east" as "west" and squashed the other axis by the drag it never made. */
    const _hx=(pos.indexOf("e")>=0)||(pos.indexOf("w")>=0);
    const _hy=(pos.indexOf("s")>=0)||(pos.indexOf("n")>=0);
    let sx=_hx?((w0+((pos.indexOf("e")>=0)?dx:-dx))/w0):1;
    let sy=_hy?((h0+((pos.indexOf("s")>=0)?dy:-dy))/h0):1;
    if((e.shiftKey||e.ctrlKey||e.metaKey)&&_hx&&_hy){ const k=Math.max(sx,sy); sx=k; sy=k; }
    sx=Math.max(0.05,sx); sy=Math.max(0.05,sy);
    A.forEach(o=>{
      o.a.nx=(ax+(o.nx*w-ax)*sx)/w; o.a.ny=(ay+(o.ny*h-ay)*sy)/h;
      if(o.nw)o.a.nw=o.nw*sx; if(o.nh)o.a.nh=o.nh*sy;
      o.a.size=Math.max(4,o.size*Math.min(sx,sy));
      o.a.manualW=true;
    });
    L.forEach(o=>{
      const np=o.pts.map(p=>[(ax+(p[0]*w-ax)*sx)/w,(ay+(p[1]*h-ay)*sy)/h]);
      if(o.l.pts||np.length>2)o.l.pts=np;
      o.l.x1=np[0][0]; o.l.y1=np[0][1];
      o.l.x2=np[np.length-1][0]; o.l.y2=np[np.length-1][1];
    });
    layoutAnnos(); drawAllLines(); paintMulti();
  };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
                 dropSnapCache(); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
/* Turn everything selected about the centre of the frame, with the angle shown. */
function startGroupRotate(ev,pg,bb){
  ev.preventDefault();
  const _rx=ev.clientX, _ry=ev.clientY; let _turned=false;
  pushHistory();
  const w=pg.offsetWidth,h=pg.offsetHeight, r=pg.getBoundingClientRect();
  const cxp=(bb.l+bb.r)/2, cyp=(bb.t+bb.b)/2;
  const cx=r.left+cxp, cy=r.top+cyp;
  const start=Math.atan2(ev.clientY-cy,ev.clientX-cx);
  /* 6gb — a mark turns about ITS OWN centre, so it is the centre that has to travel round the group's
     centre. Rotating the top-left corner instead and then spinning the element in place moved every
     mark off by half its own diagonal — which is the drift Ced saw as "the group rotated ui". */
  const A=multiAnnos().map(a=>{
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const bw=d?d.offsetWidth:(a.nw||0)*w, bh=d?d.offsetHeight:(a.nh||0)*h;
    return {a,bw,bh,cx:a.nx*w+bw/2,cy:a.ny*h+bh/2,rot:a.rot||0};
  });
  const L=multiLines().map(l=>({l,pts:linePts(l).map(p=>[p[0],p[1]])}));
  const hud=degHUD();
  const move=e=>{
    if(!_turned){ if(Math.hypot(e.clientX-_rx,e.clientY-_ry)<=DRAG_SLOP)return; _turned=true; }
    let deg=(Math.atan2(e.clientY-cy,e.clientX-cx)-start)*180/Math.PI;
    let caught=false;
    if(e.shiftKey){ deg=Math.round(deg/15)*15; caught=true; }
    else if(S.snap&&!(e.ctrlKey||e.metaKey)){
      const sn=Math.round(deg/SNAP_DEG_STEP)*SNAP_DEG_STEP;
      if(Math.abs(deg-sn)<=SNAP_DEG){ deg=sn; caught=true; }
    }
    const th=deg*Math.PI/180, c=Math.cos(th), sn2=Math.sin(th);
    const turn=(px,py)=>{ const x=px-cxp, y=py-cyp;
      return [cxp+x*c-y*sn2, cyp+x*sn2+y*c]; };
    A.forEach(o=>{ const q=turn(o.cx,o.cy);
      o.a.nx=(q[0]-o.bw/2)/w; o.a.ny=(q[1]-o.bh/2)/h; o.a.rot=o.rot+deg; });
    L.forEach(o=>{
      const np=o.pts.map(p=>{ const q=turn(p[0]*w,p[1]*h); return [q[0]/w,q[1]/h]; });
      if(o.l.pts||np.length>2)o.l.pts=np;
      o.l.x1=np[0][0]; o.l.y1=np[0][1];
      o.l.x2=np[np.length-1][0]; o.l.y2=np[np.length-1][1];
    });
    layoutAnnos(); drawAllLines(); paintMulti();
    degHUDShow(hud,deg,caught,cx,cy);
  };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    degHUDHide(hud);
    if(!_turned){
      /* 6hb — a click on the grip types the angle instead of turning by eye */
      /* 6mt — and the same chip for a selection, on the selection's own box */
      angleChipOpen(null,null,pg,{
        rect:(()=>{ try{ const f=document.querySelector('.gframe');
          if(f){ const r=f.getBoundingClientRect(); if(r.width||r.height)return r; } }catch(e){}
          return {left:cx-40,top:cy-12,right:cx+40,bottom:cy+12,width:80,height:24}; })(),
        now:0,
        apply:v=>{ rotateSelectionBy(v,pg,bb);
          layoutAnnos(); drawAllLines(); paintMulti();
          autosave&&autosave(); setStatus("Turned the selection "+(Math.round(v*10)/10)+"\u00b0."); }});
      return;
    }
  };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
/* the selection's bounding box, in css px on its page (annos measured from the DOM, lines from their extent) */
/* 6gb — THE FRAME HAS TO FIT WHAT IS ACTUALLY ON THE PAGE.
   Ced: "fix the group rotated ui." Two things were wrong with the box the group frame is drawn from.
   A ROTATED mark was measured by its unrotated rectangle, so a diamond turned 45° stuck out of its own
   selection frame and the handles sat inside the shape. And a STROKE contributed `y1` twice — its top
   and its bottom — so a sloped line or a leader was flat as far as the frame was concerned, and the
   frame cut straight through it. Both are measured properly now: a rotated mark by the extent of its
   four turned corners, a stroke by every point it has. */
function multiBBox(pg){
  const w=pg.offsetWidth,h=pg.offsetHeight, L=[],T=[],R=[],B=[];
  multiAnnos().forEach(a=>{
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const bw=d?d.offsetWidth:(a.nw||0)*w, bh=d?d.offsetHeight:(a.nh||0)*h;
    const x=a.nx*w, y=a.ny*h;
    const rot=+(a.rot||0);
    if(!rot){ L.push(x); T.push(y); R.push(x+bw); B.push(y+bh); return; }
    const th=rot*Math.PI/180, cs=Math.cos(th), sn=Math.sin(th);
    const cx=x+bw/2, cy=y+bh/2;
    [[-bw/2,-bh/2],[bw/2,-bh/2],[bw/2,bh/2],[-bw/2,bh/2]].forEach(([px,py])=>{
      const qx=cx+px*cs-py*sn, qy=cy+px*sn+py*cs;
      L.push(qx); R.push(qx); T.push(qy); B.push(qy);
    });
  });
  multiLines().forEach(l=>{ linePts(l).forEach(p=>{
    L.push(p[0]*w); R.push(p[0]*w); T.push(p[1]*h); B.push(p[1]*h); }); });
  if(!L.length)return null;
  return {l:Math.min(...L), t:Math.min(...T), r:Math.max(...R), b:Math.max(...B)};
}
function selectionPage(){
  const a=multiAnnos()[0], l=multiLines()[0];
  const pi=a?a.page:(l?l.page:null);
  return pi==null?null:document.querySelector(`.page[data-idx="${pi}"]`);
}
function positionMultibar(){
  if(multiCount()<2){ multibar.classList.remove("show"); return; }
  const pg=selectionPage(); const bb=pg?multiBBox(pg):null;
  if(!pg||!bb){ multibar.classList.remove("show"); return; }
  const r=pg.getBoundingClientRect();
  /* 6dr — BELOW the selection, not above it. A multi-selection is usually a run of rows, and the bar
     sitting over the top of it covered the first row you had just selected — the one you were looking
     at to decide what to do. Below, the marks stay visible while you work on them. It still flips up
     when there is no room underneath. */
  const h=multibar.offsetHeight||36;
  const ins=_chromeInset();                       /* 6gc — same keep-out as the single-selection bar */
  let top=r.top+bb.b+10;
  if(top+h>window.innerHeight-8){
    const above=r.top+bb.t-h-10;
    top=(above>=ins.top)?above:Math.max(ins.top,window.innerHeight-h-8);
  }
  if(top<ins.top)top=ins.top;
  /* 6n9 — and the multi bar centres on the selection's own box, for the same reason. It is placed
     by hand rather than through `fitFloatingBar` because it is already `show`n; the clamp is the
     same one — the chrome's inset on the left, the window less the bar on the right. */
  {
    const mw=multibar.offsetWidth||330;
    const mid=r.left+(bb.l+bb.r)/2;
    let ml=mid-mw/2;
    if(ml<ins.left)ml=ins.left;
    if(ml+mw>window.innerWidth-ins.right)ml=Math.max(ins.left,window.innerWidth-ins.right-mw);
    multibar.style.left=ml+"px";
  }
  multibar.style.top=top+"px";
  $("#mbCount").textContent=multiCount()+" selected";
  /* 6dv — a line has no top or bottom to align: it IS a single horizontal (or diagonal) stroke, and
     "align tops" on a cross-out would pull its two halves onto each other and destroy the X. When the
     selection is lines only, the vertical controls and the text controls have nothing to act on, so
     they are not offered. */
  /* 6dw — ANY line in the selection, not only a selection made entirely of lines. With one line mixed
     in, "align tops" still had a line to act on and still tore a cross-out apart; the control has to go
     the moment a line is in the set. */
  const linesOnly=(S.selMultiL.size>0);
  multibar.querySelectorAll('[data-al2="top"],[data-al2="vmiddle"],[data-al2="bottom"],[data-dist="v"],[data-tal],[data-mbsize],[data-lay2],[data-lay3],[data-lay2grp]')
    .forEach(b=>{ b.style.display=linesOnly?"none":""; });
  const als=[...new Set(multiAnnos().map(a=>a.align||"center"))];
  multibar.querySelectorAll("[data-tal]").forEach(b=>b.classList.toggle("on",als.length===1&&als[0]===b.dataset.tal));
  multibar.classList.add("show");
}
function clearMulti(){
  try{ clearGroupFrame(); }catch(e){}
  const hadL=S.selMultiL.size;
  S.selMulti.clear(); S.selMultiL.clear();
  document.querySelectorAll(".anno.multi").forEach(d=>d.classList.remove("multi"));
  if(hadL)drawAllLines();
  multibar.classList.remove("show");
  updateGroupBtn&&updateGroupBtn();
}
/* 6gc — CTRL-CLICKING A SECOND MARK SELECTS BOTH.
   Ced: "selecting item and then clicking the ctrl and selecting another one should instantly select
   both items." It did not, because a plain click leaves the mark in `S.sel` — the SINGLE selection —
   and the multi set empty; ctrl-clicking the next one added only that one to the set and then dropped
   the single selection, so the first mark was quietly let go and you were left holding the second.
   Whatever is singly selected now joins the set first, which is what every other editor does. */
function _seedMulti(){
  if(S.sel!=null&&!S.selMulti.has(S.sel))S.selMulti.add(S.sel);
  if(S.selLine!=null&&!S.selMultiL.has(S.selLine))S.selMultiL.add(S.selLine);
}
function toggleMulti(id){
  _seedMulti();
  if(S.selMulti.has(id))S.selMulti.delete(id); else S.selMulti.add(id);
  dropSingleSel(); paintMulti();
}
function toggleMultiLine(id){
  _seedMulti();
  if(S.selMultiL.has(id))S.selMultiL.delete(id); else S.selMultiL.add(id);
  dropSingleSel(); paintMulti();
}
/* while a multi-selection exists the single-mark bars stay out of the way */
function dropSingleSel(){
  if(!multiCount())return;
  S.sel=null; S.selLine=null;
  document.querySelectorAll(".anno.sel").forEach(d=>d.classList.remove("sel"));
  annobar.classList.remove("show"); $("#linebar").classList.remove("show");
}
function selectAnno(id){
  S.sel=id;
  /* Selecting a mark gives up whatever stroke was selected. It always read that way on screen — one
     thing at a time carries handles — but the two selections were kept separately, so a restyle or a
     nudge aimed at the mark quietly caught the stroke as well. */
  if(id!=null){ clearMulti(); if(S.selLine!=null){ S.selLine=null;
    try{ $("#linebar").classList.remove("show"); drawAllLines(); }catch(e){} } }
  /* 6gm — the mark you are working on comes forward, so a stroke lying across it cannot swallow the
     8px handles. Everything else stays under the strokes, which is the rule. */
  /* 6ij — and it floats to the top of its own layer for as long as it is selected, so its handles
     are never behind a neighbour. Deselecting puts its own `z` back. */
  document.querySelectorAll(".anno").forEach(d=>d.classList.toggle("sel",+d.dataset.id===id));
  try{ paintSelUI(); }catch(e){}       /* 6is — the handles go in the layer above the drawing */
  if(id==null){annobar.classList.remove("show");return;}
  const a=S.annos.find(x=>x.id===id); if(!a){annobar.classList.remove("show");return;}
  annobar.querySelectorAll("[data-al]").forEach(b=>b.classList.toggle("on",b.dataset.al===a.align));
  annobar.classList.add("show"); positionBar();
}
/* 6gb — A CALLOUT'S LEADER IS PART OF THE SELECTION, SO IT HAS TO BE REDRAWN WITH IT.
   Ced: "clicking the rectangle in callout should also toggle the points on the line and the arrow."
   The handles were already conditioned on the box being selected — but `selectAnno` repaints the marks
   and only redraws the STROKES when it is dropping a selected stroke, so clicking the box showed its
   own handles and nothing on the leader until something else happened to redraw the page. Selecting or
   deselecting a callout now redraws that page's strokes, which is what puts the elbow and the arrow
   handles on screen with the box's. */
const _selAnnoBase=selectAnno;
selectAnno=function(id){
  const prev=S.sel;
  _selAnnoBase(id);
  try{
    const isCo=o=>!!(o&&o.maKind==="callout");
    const a=(id!=null)?S.annos.find(x=>x.id===id):null;
    const b=(prev!=null&&prev!==id)?S.annos.find(x=>x.id===prev):null;
    if(isCo(a)||isCo(b)){
      const pi=(isCo(a)?a.page:b.page);
      if(pageRendered(pi))drawPageLines(pi);
    }
  }catch(e){}
};
/* Put a floating bar where it will actually fit: to the LEFT of the anchor once there is no room on the
   right, so editing a redline in the last column no longer pushes its tools off screen. */
/* 6gc — WHAT THE CHROME OWNS, so a floating bar never lands underneath it. The compact bar owns the
   top of the window whenever it is showing and the left ribbon owns its own column; a selection bar
   clamped to a flat 8px put itself under both, covering the controls you had just reached for. */
/* 6gn — AND THE SIDE RIBBON IS ON THE RIGHT. This function was written for the LEFT-hand ribbon 6gc
   shipped for about an hour, and it kept reserving the space on that side after the ribbon moved: with
   the ribbon on the right it computed `left = ribbon.right + 8`, which is a number just off the RIGHT
   edge of the screen, and then `fitFloatingBar` obediently "tucked the bar against the chrome" there.
   Measured in a 1700px window: the line's delete bar was placed at x=1696 and is 42px wide — thirty-
   eight pixels past the edge. That is Ced's "strike through, lines, strike text and crossout has no
   delete anymore": the delete button existed and was off the screen, in one ribbon mode only.
   The inset now has a RIGHT as well as a left, and the ribbon fills whichever one it is actually on. */
function _chromeInset(){
  let top=8, left=8, right=8;
  try{
    const mb=document.getElementById("miniBar");
    if(mb && getComputedStyle(mb).display!=="none"){
      const r=mb.getBoundingClientRect();
      if(r.height>0 && r.top<40) top=Math.max(top, r.bottom+6);
    }
    const tb=document.getElementById("toolbar");
    if(RIBBON_SIDE() && tb){
      const r=tb.getBoundingClientRect();
      if(r.width>0){
        if(r.left > window.innerWidth/2) right=Math.max(right, window.innerWidth-r.left+8);
        else                             left =Math.max(left,  r.right+8);
      }
    }
    /* 6j8 — AND THE RIBBON ALONG THE TOP. Ced: "do not overlay the shape tools on the ribbons." Only
       the compact bar was measured, and only when it was within 40px of the top — so with the full
       ribbon open, a mark near the top of the sheet put its bar straight over the tools. The ribbon is
       fixed at the top of the window and it is chrome like any other: a floating bar starts below it. */
    else if(tb && getComputedStyle(tb).display!=="none"){
      const r=tb.getBoundingClientRect();
      if(r.height>0 && r.top<window.innerHeight/2) top=Math.max(top, r.bottom+6);
    }
    /* 6gq — AND EVERY OTHER PANEL DOCKED TO AN EDGE. Ced: "make sure the MA logo on the lower right
       does not overlay on any item in the right ribbon, make it move when necessary." It was measuring
       the side ribbon and nothing else, so the marks list (290px) and the Mount Analysis panel (370px)
       — both fixed to the right edge — were invisible to it, and the corner mark and the floating bars
       sat under them. Anything on screen and docked to an edge is measured, whatever put it there. */
    ["#marksPanel","#maPanel","#ribGrip","#rail"].forEach(sel=>{
      const n=document.querySelector(sel);
      if(!n)return;
      const st=getComputedStyle(n);
      if(st.display==="none"||st.visibility==="hidden"||+st.opacity===0)return;
      const r=n.getBoundingClientRect();
      if(!(r.width>0&&r.height>0))return;
      if(r.left>window.innerWidth/2) right=Math.max(right, window.innerWidth-r.left+8);
      else if(r.right<window.innerWidth/2) left=Math.max(left, r.right+8);
    });
  }catch(e){}
  return {top:top,left:left,right:right};
}
/* 6gt — the corner mark keeps clear of the chrome by the same measurement the floating bars use.
   `_chromeInset().right` is how far in the right-hand chrome reaches, plus its own 8px of air; the mark
   adds a little more so it is not tucked right against the ribbon's edge, and never comes inside the
   20px it has always had from the window. */
const MARK_CLEAR=12;
function syncMarkClear(){
  try{
    const r=_chromeInset().right;
    const want=Math.max(20, Math.round(r + MARK_CLEAR));
    document.documentElement.style.setProperty("--mark-right",want+"px");
    /* 6gq — and when the chrome has taken the whole corner, the mark gets out of the way rather than
       sitting on top of something. It is a "back to the top" button and a signature, not a control
       anything depends on. */
    const m=document.getElementById("markR");
    if(m)m.classList.toggle("nofit", (want+m.offsetWidth+8)>window.innerWidth);
  }catch(e){}
}
let _markRaf=0;
function syncMarkClearSoon(){
  if(_markRaf)return;
  _markRaf=requestAnimationFrame(()=>{ _markRaf=0; syncMarkClear(); syncPageCol(); });
}
window.addEventListener("resize",syncMarkClearSoon);
window.addEventListener("scroll",syncMarkClearSoon,{passive:true});
/* ================================================================================================
   6lb — THE READING MEASURE CAPS THE CHROME, NOT THE SHEET.
   ------------------------------------------------------------------------------------------------
   Ced: "make sure the pdf is in the middle of the ui", with a capture of an 11x17 sheet jammed against
   the right edge of the window and 476px of empty white to the left of it.

   `.wrap` is a reading column — `max-width:var(--col-w)` with `margin:0 auto` — and the page column
   lives inside it. A sheet NARROWER than that column is centred in it by `.page`'s auto margins, and
   that has always looked right. A sheet WIDER than it is not: auto margins resolve to zero when there
   is no free space to share, so the sheet goes flush to the column's LEFT edge and the whole overflow
   hangs off to the right. Measured on Ced's own window — 1895px wide, column dragged to 951px, sheet
   zoomed to 1322px: the sheet sat at 546..1868, so gapL=476 and gapR=27, and the reproduction lands
   within 2px of his capture. Nothing was broken; the column cap was simply being asked a question it
   is not the answer to. The cap exists so the RIBBON and the chrome do not stretch to a 2000px window.
   Where the paper sits is a different question, and its answer is the space the chrome leaves.

   So the page column escapes the cap by exactly as much as it needs to span that space, and nothing
   else moves. `_chromeInset()` is already the one function that knows how far in the chrome reaches on
   each side — the rail, the side ribbon, the marks list, the Mount Analysis panel — so the free space
   is `inset.left .. innerWidth-inset.right` and the escape is the difference between that and where
   `.main`'s content box already ends. `.main` is measured rather than `#pages` because `.main`'s own
   box does not depend on the margins being written, so this is idempotent and needs no reset pass.

   Once the column spans the free space, `.page`'s auto margins do the centring again, and a sheet too
   wide for even that goes flush to the free space's LEFT edge — reachable, and scrolling right reveals
   the rest, which is the behaviour that loses nothing.
   ================================================================================================ */
let _pcL=null,_pcR=null;
function syncPageCol(){
  try{
    const ps=document.getElementById("pages"); if(!ps)return;
    const host=ps.parentElement; if(!host)return;
    if(document.documentElement.classList.contains("nodoc")){
      if(_pcL!==0||_pcR!==0){ ps.style.marginLeft="0px"; ps.style.marginRight="0px"; _pcL=_pcR=0; }
      return;
    }
    const r=host.getBoundingClientRect(); if(!(r.width>0))return;
    const cs=getComputedStyle(host);
    /* ================================================================================================
       6md — THE COLUMN IS PLACED IN THE DOCUMENT, AND THE BAND IT IS PLACED AGAINST IS THE WINDOW AT
       REST. Ced: "the pdf is again not in the middle."

       `getBoundingClientRect()` is a VIEWPORT reading and `margin-left` is a DOCUMENT length, and this
       function was comparing one against the other. Scroll right by N and `cl` comes back N smaller,
       so `dl` is N more negative and the margin written is N bigger — the column is pushed right by
       exactly as far as you just scrolled. It is a treadmill, and it is measurable: on the 11x17 set
       at 168% in a 1900px window,

           scrollX   0 → marginLeft   4px      sheet 78..2134
           scrollX 156 → marginLeft 160px      sheet 78..2134
           scrollX 300 → marginLeft 304px      sheet 78..2134   (scrollWidth 2290 → 2434, growing)

       The sheet never moves. 234px of it is off the right of the window and there is NO scroll
       position that will show it — the document just gets longer as you try. That is what "not in the
       middle" is: not a centring error of a few pixels, a sheet nailed to the left rail with a quarter
       of it unreachable.

       Adding the scroll back makes both readings document-space, which is the space the margin is in.
       The band (`wantL`/`wantR`) stays a window measurement because the chrome it clears is fixed to
       the window; taken at rest it is the document band, and the column then stays put while the
       document scrolls under the rails, which is what a scrollable canvas is supposed to do.
       ================================================================================================ */
    const _sx=window.scrollX||0;
    const cl=r.left +_sx+(parseFloat(cs.paddingLeft )||0)+(parseFloat(cs.borderLeftWidth )||0);
    const cr=r.right+_sx-(parseFloat(cs.paddingRight)||0)-(parseFloat(cs.borderRightWidth)||0);
    const ins=_chromeInset();
    const freeL=ins.left, freeR=window.innerWidth-ins.right;
    /* ==============================================================================================
       6m8 — AND THE BAND IS CENTRED ON THE WINDOW. Ced: "always make the the pdf center unless zoomed
       in in specific place."

       6lb escaped the column outward to the chrome's free space, which is the right WIDTH and the
       wrong MIDDLE: the rail takes 78px on the left and nothing takes more than 8 on the right, so
       the free band runs 70..1592 in a 1600px window and its centre is 831, not 800. The sheet is
       centred in the column by `margin:auto`, so it landed 31px right of the window's middle at every
       zoom — measured, and it is what Ced is looking at.

       The band is made symmetric about the window instead: as wide as the NARROWER side allows, so
       both halves match and the column's middle is the window's middle. `margin:auto` then centres
       the sheet on the window with no arithmetic at all — which matters more than it sounds, because
       the first cut of this computed an explicit pixel margin per page and that margin went STALE the
       moment anything moved. Measured with it: changing the reading-column width left the old margin
       in place and the sheet 250px off. An `auto` margin cannot go stale; it is the browser's job and
       the browser redoes it on every layout.

       It costs a little width when the chrome is lopsided — 62px in that 1600px window — and that is
       the right trade: the column exists to hold the paper, and paper that is not in the middle is
       what the complaint was about. Below 160px a side the symmetry is dropped rather than squeezing
       the sheet, which is the case 6lb's "only ever OUTWARD" rule was protecting.
       ============================================================================================== */
    const _cx=window.innerWidth/2;
    const _half=Math.min(_cx-freeL,freeR-_cx);
    const wantL=(_half>=160)?(_cx-_half):freeL;
    const wantR=(_half>=160)?(_cx+_half):freeR;
    const dl=cl-wantL, dr=wantR-cr;
    if(_pcL!==null&&Math.abs(dl-_pcL)<0.5&&Math.abs(dr-_pcR)<0.5)return;
    _pcL=dl; _pcR=dr;
    ps.style.marginLeft =(-dl)+"px";
    ps.style.marginRight=(-dr)+"px";
    /* the column just changed width, and `resizePageBoxes` decides per page whether it fits —
       auto margins if it does, flush left if it does not. That decision is now stale. */
    try{ if(typeof resizePageBoxes==="function")resizePageBoxes(); }catch(e){}
  }catch(e){}
}
function syncPageColSoon(){ syncMarkClearSoon(); }
/* 6gq — THE RIBBON'S SIDEWAYS OFFSET. A zoomed-in sheet makes the document scroll across, and a sticky
   element can only hold inside its own containing block — the ribbon is that block's full width, so it
   has no room to stick in and travels with the page. `--sx` is the horizontal scroll, and the ribbon
   and the header are translated by it, which is exactly where they sit at rest. */
let _sxRaf=0,_sxLast=-1,_sxT=0;
function syncRibbonX(){
  const x=Math.round(window.scrollX||0);
  if(x===_sxLast)return;
  _sxLast=x;
  try{
    document.documentElement.style.setProperty("--sx",x+"px");
    document.body.classList.add("xscrolling");
    clearTimeout(_sxT);
    _sxT=setTimeout(()=>{ try{ document.body.classList.remove("xscrolling"); }catch(e){} },160);
  }catch(e){}
}
function syncRibbonXSoon(){
  if(_sxRaf)return;
  _sxRaf=requestAnimationFrame(()=>{ _sxRaf=0; syncRibbonX(); });
}
window.addEventListener("scroll",syncRibbonXSoon,{passive:true});
window.addEventListener("resize",syncRibbonXSoon);
/* 6n9 — THE BAR IS CENTRED ON WHAT IT BELONGS TO. Ced: "always put the mini toolbar in the middle
   of the shape if allowable. only put it on left or right if the item is on the edge of UI."
   `cx` is the middle of the mark in window coordinates; `x` stays the left-hand fallback for the
   few callers that place the bar at a POINT — a right-click menu — rather than against a box. The
   clamping below is unchanged, so "only on the edge" is what the chrome insets already enforce:
   the bar is centred until centring would put it past the chrome, and then it stops at the chrome. */
function fitFloatingBar(bar,x,y,cx){
  bar.classList.add("show");
  const w=bar.offsetWidth||220, h=bar.offsetHeight||34;
  const vw=window.innerWidth, vh=window.innerHeight;
  const ins=_chromeInset();
  /* 6gn — the right-hand limit is the chrome's, not the window's, so a bar next to a mark near the
     right edge stops at the side ribbon instead of behind it or past the screen. */
  const rmax=vw-ins.right;
  let left=(cx!=null)?(cx-w/2):x;
  if(cx!=null){
    if(left<ins.left) left=ins.left;
    if(left+w>rmax) left=Math.max(ins.left,rmax-w);
  }
  else {
  if(left+w>rmax) left=x-w;                      // flip to the left of the cursor / mark
  if(left<ins.left) left=Math.max(ins.left,rmax-w);  // and if that overflows too, tuck it against the chrome
  if(left+w>rmax) left=Math.max(ins.left,rmax-w);    // never past the right-hand chrome either
  }
  let top=y;
  if(top<ins.top)top=ins.top;
  if(top+h>vh-8)top=Math.max(ins.top,vh-h-8);
  bar.style.left=left+"px"; bar.style.top=top+"px";
}
/* 6dk — how far the bar stands off the redline it belongs to. A selected redline is not just its own
   box: the ✕ overhangs the top-right corner by 11px and the rotate/move handles hang 32px below it.
   The old gap was a flat 38px measured from the top, which on a normal 34px-tall bar left 4px of air
   and laid the bar straight over the ✕ — the button you reach for most was the one you could not hit.
   The offsets below are read from those rules, so the bar clears whichever side it lands on. */
const BAR_X_OVERHANG=11;      // .anno .x  { top:-11px }
const BAR_HANDLE_DROP=52;     // .anno .rot/.mov { bottom:-32px; height:20px }
const BAR_AIR=8;              // breathing room either way
/* 6gb — AND THE BAR NEVER SITS ON THE MARK.
   Ced: "make sure the shape is not covered by the smaller prompt of tools." Above the box there are
   three things to clear, not one: the ✕ at −11px, the top-middle handle at −5px with its 7px collar,
   and the bar's own shadow. Measured together that is about 20px, where the old sum allowed 19 and the
   bar's lower edge landed on the box's top rule. And when there is no room above, the flip down has to
   clear the rotate and move grips, which hang 52px below. Both gaps are taken from the rules, with a
   check afterwards: if the bar would still overlap the mark's own rectangle, it is pushed clear. */
const BAR_TOP_CLEAR=BAR_X_OVERHANG+12;   // ✕ overhang + the top handle and its collar
/* The whole of what is selected, on screen — which for a callout is the box AND its leader, because
   the two are one mark. 6gc: Ced: "notice how the small tool is covering the lines/shape." The bar was
   placed off the BOX alone, so on a callout whose leader goes up and to the right it landed squarely on
   the leader every time. */
function selectedScreenBox(d,a){
  const r=d.getBoundingClientRect();
  const out={top:r.top,bottom:r.bottom,left:r.left,right:r.right};
  try{
    if(a&&a.maKind==="callout"){
      const l=(S.lines||[]).find(z=>z.coFor===a.id);
      const pg=document.querySelector(`.page[data-idx="${a.page}"]`);
      if(l&&pg){
        const pr=pg.getBoundingClientRect(), w=pg.offsetWidth, h=pg.offsetHeight;
        linePts(l).forEach(p=>{
          const x=pr.left+p[0]*w, y=pr.top+p[1]*h;
          out.top=Math.min(out.top,y); out.bottom=Math.max(out.bottom,y);
          out.left=Math.min(out.left,x); out.right=Math.max(out.right,x);
        });
      }
    }
  }catch(e){}
  return out;
}
function positionBar(){
  if(S.sel==null){annobar.classList.remove("show");return;}
  const d=document.querySelector(`.anno[data-id="${S.sel}"]`); if(!d){annobar.classList.remove("show");return;}
  const _a=S.annos.find(x=>x.id===S.sel);
  const r=selectedScreenBox(d,_a);
  const h=annobar.offsetHeight||34;
  const vh=window.innerHeight;
  let top=r.top-h-BAR_TOP_CLEAR-BAR_AIR;
  const below=r.bottom+BAR_HANDLE_DROP+BAR_AIR;
  if(top<8)top=below;                       // no room above: go under the handles
  if(top+h>vh-8&&r.top-h-BAR_TOP_CLEAR-BAR_AIR>8)top=r.top-h-BAR_TOP_CLEAR-BAR_AIR;
  /* last resort: if it would still lie across the mark, put it wherever there is more room */
  if(top<r.bottom&&top+h>r.top){
    const roomAbove=r.top-8, roomBelow=vh-8-r.bottom;
    top=(roomAbove>=roomBelow)?Math.max(8,r.top-h-BAR_TOP_CLEAR-BAR_AIR):Math.min(vh-h-8,below);
  }
  /* 6n9 — centred on the mark, with the mark's left kept as the fallback the clamp falls back to */
  fitFloatingBar(annobar,Math.max(8,r.left),top,(r.left+r.right)/2);
  try{ syncSelUI(); }catch(e){}     /* 6is — the handle frame rides along with the bar */
}
function setTextAlign(al){
  const list = multiCount() ? multiAnnos()
             : (S.sel!=null ? [S.annos.find(x=>x.id===S.sel)].filter(Boolean) : []);
  if(!list.length){ toast("Select a redline first"); return; }
  pushHistory();
  list.forEach(a=>{ a.align=al; a.alignSet=true; a.alignUser=true; fitCellBox(a); });
  layoutAnnos();
  if(multiCount()) paintMulti(); else if(S.sel!=null) selectAnno(S.sel);
  annobar.querySelectorAll("[data-al]").forEach(b=>b.classList.toggle("on",b.dataset.al===al));
  multibar.querySelectorAll("[data-tal]").forEach(b=>b.classList.toggle("on",b.dataset.tal===al));
  autosave();
  if(list.length>1)toast("Aligned text in "+list.length+" redlines");
}
annobar.querySelectorAll("[data-al]").forEach(b=>b.onclick=()=>setTextAlign(b.dataset.al));
multibar.querySelectorAll("[data-tal]").forEach(b=>b.onclick=()=>setTextAlign(b.dataset.tal));
annobar.querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{ const a=S.annos.find(x=>x.id===S.sel); if(!a)return; a.size=Math.max(2,Math.min(64,a.size+(+b.dataset.fs))); fitCellBox(a); layoutAnnos(); selectAnno(a.id); });
/* =================================================================================================
   6gu — LAYERING, AND A GROUP IS ONE LAYER
   Ced: "also make sure the layering works. group items should act as one layer."

   Front and back used to be a single line acting on a single mark: `a.z = max+1`. Two things were
   wrong with that the moment more than one mark was involved. A GROUP was never handled at all —
   clicking a grouped mark selects the whole group, which shows the multi bar, and the multi bar had no
   front or back on it — so a grouped detail could not be layered by any route. And a selection sent to
   the front one mark at a time comes out in the order the marks happen to be listed in, which shuffles
   a drawing that was built up in a deliberate order.

   So both bars call this. It moves a whole block of marks as one, KEEPING THEIR ORDER AMONG
   THEMSELVES, and it works per page and per band — `under` (below the strike lines) and above are two
   different stacks, and a mark only has to clear the others in its own.
   ================================================================================================= */
/* 6i3 — A NEW MARK LANDS ON TOP. Ced: "make sure all the most recent redlines added will
   automatically be on the top of the layers." A mark is stacked by its `z`, and a mark that has never
   been layered has none — which reads as zero, i.e. BELOW everything that has been brought forward. So
   the moment one mark on a page is sent to the front, every mark drawn afterwards appears under it,
   which is the opposite of what drawing something new means. Every new mark now takes the top of its
   own band as it is made. */
/* 6ib — WHICH PILE AN ITEM IS IN. Ced: "layering are still bad, please polish it." The stack is four
   levels deep, not two: under-strokes, under-marks, over-strokes, over-marks. A stroke now carries its
   own `under` and `z` just as a mark does, so every function below takes a MIXED list and sorts each
   item within its own pile. The two never interleave — on screen they are separate SVG and div layers,
   and the export mirrors that — so keeping them apart here is what makes the two agree. */
function isStrokeObj(o){ return !!(o&&o.x1!=null&&o.y1!=null&&o.nx==null&&o.kind===undefined); }
function layerColl(o){
  if(o&&S.lines&&S.lines.indexOf(o)>=0)return S.lines;
  if(o&&S.annos&&S.annos.indexOf(o)>=0)return S.annos;
  return isStrokeObj(o)?S.lines:S.annos;      /* not yet in either list: go by its shape */
}
/* ==================================================================================================
   6ln — MARKS AND STROKES SHARE ONE STACK.
   Ced, twice: "the lines still don't have layers" and "they should also be able to rest on top of
   photos and other redlines" — and, separately, "the blue dragger of the line is not visible as it
   rests below the redline." All three are one fault, and it is structural rather than a bug in the
   layering arithmetic.

   A stroke was drawn into `svg.draw` and a mark into `.annolayer`, two sibling layers at z-index 7
   and 8. So a stroke was BELOW every mark on the page by construction, however many times you pressed
   ⤒, and its selection handles — which are drawn into the same stroke layer — were below them too.
   Worse, the two kinds kept SEPARATE z sequences, each renumbered 1..n inside its own array, so a
   mark's z and a stroke's z were two different scales that could not be compared at all. "Raise this
   line above that photo" had no expressible answer.

   One band, one sequence. `bandList` is every mark AND every stroke in a band, `bandRenumber` gives
   them a single gapless order, and every operation that moves something through the stack — front,
   back, one step up, one step down — works on that list. The screen follows: `drawPageLines` builds
   a run of SVG inside the mark layer for each unbroken run of strokes in the order, with the run's
   own z-index, so a stroke can sit between two marks. The export follows too: two bands rather than
   four, each sorted by the one z.
   ================================================================================================== */
function sameBand(o,p){ return o&&p&&o.page===p.page&&(!!o.under===!!p.under); }
function bandList(page,under){
  const u=!!under;
  return (S.annos||[]).filter(a=>a.page===page&&!!a.under===u)
    .concat((S.lines||[]).filter(l=>l.page===page&&!!l.under===u));
}
/* one gapless, positive 1..n order over both kinds. A z is a CSS z-index on screen and a sort key in
   the export, and a NEGATIVE one on screen drops a mark behind the sheet itself rather than behind its
   neighbours — so the stack is kept positive rather than counting away from zero in both directions. */
function bandRenumber(page,under){
  const all=bandList(page,under);
  const ord=(o)=>{ const c=layerColl(o); return c.indexOf(o); };
  all.sort((p,q)=>((p.z||0)-(q.z||0))||(ord(p)-ord(q)));
  all.forEach((o,k)=>{ o.z=k+1; });
  return all;
}
function topZ(a){
  if(!a)return a;
  try{
    const mx=Math.max(0,...bandList(a.page,a.under).filter(z=>z!==a).map(z=>z.z||0));
    a.z=mx+1;
  }catch(e){}
  return a;
}
/* 6i5 — ONE STEP UP OR DOWN THE STACK.
   `layerMarks` takes a mark all the way to the top or the bottom; this moves it past ONE neighbour,
   which is what you want when two marks overlap and you only need them the other way round. The ladder
   runs through both bands: at the top of the lower band the next step up is into the band above the
   strokes, and at the bottom of the upper band the next step down is under them. */
function stepLayer(list,dir){
  const all=(list||[]).filter(Boolean);
  if(!all.length)return 0;
  /* 6ln — ONE PILE, NOT TWO. A mixed selection used to step each kind in its own sequence, which is
     exactly why a line could never pass a mark. */
  return _stepBand(all,dir);
}
/* ==================================================================================================
   6lo — ONE PRESS STEPS PAST WHAT IT OVERLAPS.
   Ced: "if a page has 100 redlines, and two are overlapping, where the first is in layer 10 and the
   second is in layer 20, the user clicking the up layer should not take 9 to ten clicks to swap with
   the item on top. it should know that the item being up layered should be above the one it overlaps
   with."

   The step was already "past the nearest NEIGHBOUR", not "one unit of z" — but nearest by z, over
   everything in the band, and on a busy sheet most of what is between you and the thing you can see
   on top of you is somewhere else entirely. Nine presses to move past one picture, and eight of them
   look like nothing happening, because the eight marks you passed were not overlapping anything.

   So the neighbour to step past is the nearest one ABOVE that actually touches the block's own
   rectangle. A press then does the thing you pressed it for: it puts this mark over the one that was
   covering it. With nothing overlapping — a mark on its own in the corner — there is nothing on
   screen that a step could show, so it falls back to the nearest by z and the stack still walks.
   ================================================================================================== */
function _bbox(o){
  try{
    if(o&&o.nx!=null){
      const w=(o.nw||0.02), h=(o.nh||0.02);
      return [o.nx,o.ny,o.nx+w,o.ny+h];
    }
    const P=(o&&o.pts&&o.pts.length)?o.pts:[[o.x1,o.y1],[o.x2,o.y2]];
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    P.forEach(q=>{ if(!q)return; x0=Math.min(x0,q[0]); y0=Math.min(y0,q[1]);
                   x1=Math.max(x1,q[0]); y1=Math.max(y1,q[1]); });
    if(!isFinite(x0))return null;
    /* a rule has no thickness to speak of; give it a hair so a crossing counts as a touch */
    const pad=0.004;
    return [x0-pad,y0-pad,x1+pad,y1+pad];
  }catch(e){ return null; }
}
function _hits(a,b){
  const r=_bbox(a), q=_bbox(b);
  if(!r||!q)return false;
  return !(r[2]<q[0]||q[2]<r[0]||r[3]<q[1]||q[3]<r[1]);
}
function _stepBand(marks,dir){
  if(!marks.length)return 0;
  const a0=marks[0];
  const ids=new Set(marks.map(a=>a.id));
  const others=bandList(a0.page,a0.under).filter(z=>!ids.has(z.id));
  const mine=marks.map(z=>z.z||0);
  const lo=Math.min(...mine), hi=Math.max(...mine);
  const touches=z=>marks.some(m=>_hits(m,z));
  const upAll   =others.filter(z=>(z.z||0)>hi).sort((p,q)=>(p.z||0)-(q.z||0));
  const downAll =others.filter(z=>(z.z||0)<lo).sort((p,q)=>(q.z||0)-(p.z||0));
  /* the one it is actually hiding behind, if there is one; otherwise the next by z */
  const above=upAll.filter(touches)[0]||upAll[0];
  const below=downAll.filter(touches)[0]||downAll[0];
  if(dir>0&&above){
    /* everything from the block up to and including that neighbour shifts down by the block's size,
       and the block lands just above it — so the ones skipped keep their order among themselves */
    const t=above.z;
    others.forEach(z=>{ if((z.z||0)>hi&&(z.z||0)<=t)z.z=(z.z||0)-marks.length; });
    marks.forEach((m,k)=>{ m.z=t-marks.length+1+k; });
  }
  else if(dir<0&&below){
    const t=below.z;
    others.forEach(z=>{ if((z.z||0)<lo&&(z.z||0)>=t)z.z=(z.z||0)+marks.length; });
    marks.forEach((m,k)=>{ m.z=t+k; });
  }
  else{
    /* nothing left to step past in this band — cross into the other one */
    const to=(dir>0)?false:true;
    if(!!a0.under===to)return 0;                 /* already at the very top or the very bottom */
    marks.forEach(m=>{ m.under=to; });
    const band2=bandList(a0.page,to).filter(z=>!ids.has(z.id)).map(z=>z.z||0);
    const edge=band2.length?(dir>0?Math.min(...band2)-1:Math.max(...band2)+1):1;
    marks.forEach((m,k)=>{ m.z=edge+k*(dir>0?-1:1); });
  }
  bandRenumber(a0.page,true); bandRenumber(a0.page,false);
  return marks.length;
}
function layerMarks(list,dir){
  const all=(list||[]).filter(Boolean);
  if(!all.length)return 0;
  /* 6hu — FRONT AND BACK CROSS THE BANDS. A mark sent to the front of the lower band still came out
     under every line on the page and looked as though the button had done nothing.
     6ln — and the band is now marks AND strokes, so "the front" means the front of everything. */
  all.forEach(a=>{ a.under=(dir!=="front"); });
  const ids=new Set(all.map(a=>a.id));
  const pages=[...new Set(all.map(a=>a.page))];
  pages.forEach(pi=>{
    const u=(dir!=="front");
    const rank=a=>((a.z||0)*1e6)+layerColl(a).indexOf(a);
    const mine=all.filter(a=>a.page===pi).sort((p,q)=>rank(p)-rank(q));
    const others=bandList(pi,u).filter(a=>!ids.has(a.id)).map(a=>a.z||0);
    const mx=others.length?Math.max(...others):0, mn=others.length?Math.min(...others):0;
    mine.forEach((a,k)=>{ a.z=(dir==="front")?(mx+1+k):(mn-mine.length+k); });
    bandRenumber(pi,true); bandRenumber(pi,false);
  });
  return all.length;
}
/* every mark that travels with this one: a group moves as one layer, and a callout's box is the
   whole of it as far as layering goes (its leader is a stroke and lives in the stroke layer) */
function layerFamily(a){
  if(!a)return [];
  /* 6ib — the family now takes its STROKES with it. A group whose rules stayed behind when its text
     moved was the plainest form of Ced's "some redlines are not following the layering": half the mark
     went and half of it did not. A callout's leader and a strike's rule and a measurement's line all
     answer to their box the same way. */
  const owned=o=>(S.lines||[]).filter(l=>l.coFor===o.id||l.dimFor===o.id);
  if(a.group!=null){
    const A=S.annos.filter(x=>x.group===a.group);
    const L=(S.lines||[]).filter(l=>l.group===a.group);
    const own=[]; A.forEach(x=>owned(x).forEach(l=>{ if(L.indexOf(l)<0&&own.indexOf(l)<0)own.push(l); }));
    return A.concat(L,own);
  }
  return [a].concat(owned(a));
}
/* 6ib — and the other way round: a stroke that belongs to a box layers with the whole box */
function layerFamilyL(l){
  if(!l)return [];
  const own=(l.coFor!=null?l.coFor:(l.dimFor!=null?l.dimFor:null));
  if(own!=null){ const a=S.annos.find(x=>x.id===own); if(a)return layerFamily(a); }
  if(l.group!=null){
    const A=S.annos.filter(x=>x.group===l.group);
    if(A.length)return layerFamily(A[0]);
    return (S.lines||[]).filter(x=>x.group===l.group);
  }
  return [l];
}
annobar.querySelectorAll("[data-lay]").forEach(b=>b.onclick=()=>{ const a=S.annos.find(x=>x.id===S.sel); if(!a)return; pushHistory();
  if(b.dataset.lay==="under"){
    /* the band flip takes the group with it too, else half a group ends up under the lines */
    const fam=layerFamily(a); const to=!a.under;
    fam.forEach(x=>{ x.under=to; });
  }
  else layerMarks(layerFamily(a),b.dataset.lay);
  layoutAnnos(); drawAllLines(); selectAnno(a.id); updateRail(); autosave(); });
multibar.querySelectorAll("[data-lay2]").forEach(b=>b.onclick=()=>{
  /* 6ib — the strokes in the selection move with it; leaving them behind was the other half of
     "some redlines are not following the layering". */
  const list=[...multiAnnos(),...multiLines()]; if(!list.length){ toast("Select some redlines first"); return; }
  pushHistory();
  /* one decision for the whole selection rather than flipping each in turn: a mixed set would other-
     wise just swap which half is under, and you would have to press it twice to line them up. If any
     of them is still above the lines, they all go below; only when every one is already below does it
     put them back. */
  const anyAbove=list.some(a=>!a.under);
  list.forEach(a=>{ a.under=anyAbove; });
  layoutAnnos(); drawAllLines(); paintMulti(); positionMultibar(); updateRail(); autosave();
  toast(anyAbove?("Moved "+list.length+" below the lines"):("Moved "+list.length+" above the lines"));
});
/* 6gu — and the same two commands for a selection, which is the only way a GROUP can be reached:
   clicking a grouped mark selects the group, and the group's bar is this one. */
multibar.querySelectorAll("[data-lay3]").forEach(b=>b.onclick=()=>{
  const list=[...multiAnnos(),...multiLines()]; if(!list.length){ toast("Select some redlines first"); return; }
  pushHistory();
  const n=layerMarks(list,b.dataset.lay3);
  layoutAnnos(); drawAllLines(); paintMulti(); positionMultibar(); updateRail(); autosave();
  toast((b.dataset.lay3==="front"?"Brought ":"Sent ")+n+" mark"+(n===1?"":"s")+
        (b.dataset.lay3==="front"?" to the front":" to the back"));
});
multibar.querySelectorAll("[data-al2]").forEach(b=>b.onclick=()=>alignSelected(b.dataset.al2));
multibar.querySelectorAll("[data-dist]").forEach(b=>b.onclick=()=>distributeSelected(b.dataset.dist));
multibar.querySelector("[data-mbsize]").onclick=matchSizeSelected;
/* 6i2 — the bar's own rotate: the same question the frame's grip asks, on the control that is never
   covered by anything. The turn is relative, about the middle of whatever is selected. */
(function(){
  const b=multibar.querySelector("[data-mbrot]"); if(!b)return;
  b.onclick=()=>{
    if(!multiCount()){ toast("Select some marks first"); return; }
    const pi=(multiAnnos()[0]||multiLines()[0]||{}).page;
    const pg=document.querySelector(`.page[data-idx="${pi}"]`); if(!pg)return;
    const bb=multiBBox(pg); if(!bb)return;
    askAngle({title:"Turn the selection", now:0, ok:"Turn it",
      hint:"Type the angle in degrees — the selection turns about its own middle. "+
           "Negative turns anticlockwise.",
      apply:v=>{ pushHistory(); rotateSelectionBy(v,pg,bb);
                 layoutAnnos(); drawAllLines(); paintMulti(); autosave(); }});
  };
})();
multibar.querySelector("[data-mbgroup]").onclick=()=>{
  const allG=multiCount()>0&&multiAnnos().every(a=>a.group!=null)&&multiLines().every(l=>l.group!=null);
  if(allG)ungroupSelected(); else groupSelected();
};
multibar.querySelector("[data-mbdel]").onclick=()=>{
  if(!multiCount())return; pushHistory();
  S.annos=S.annos.filter(x=>!S.selMulti.has(x.id)); S.lines=S.lines.filter(x=>!S.selMultiL.has(x.id));
  clearMulti(); layoutAnnos(); drawAllLines(); updateRail(); updateCount();
};
/* 6jf — the two mirrors, on the bar that pops on a mark */
annobar.querySelectorAll("[data-flip]").forEach(b=>{ b.onclick=()=>{
  if(S.sel==null)return;
  try{ sbFlip(b.dataset.flip); }catch(e){ toast("Cannot flip this"); }
}; });
annobar.querySelector("[data-del]").onclick=()=>{ if(S.sel==null)return; deleteSelection(); };
/* A mark with NO TEXT — a box, an ellipse, a blank redline — has nothing for Delete to delete inside
   it, so Delete means the mark. This is the whole of "I drew a box, pressed Delete and nothing
   happened": the caret was in the box, and the key went to a string that was already empty. */
function _emptyMarkFocused(){
  const ae=document.activeElement;
  if(!ae||!ae.classList||!ae.classList.contains("ed"))return false;
  return String(ae.innerText||"").trim()==="";
}
/* 6gk — ONE DELETE, AND IT TAKES WHOLE MARKS.
   Delete had three branches — a multi-selection, a stroke, a mark — and none of them knew that a
   callout or a measurement is two objects that answer as one, so deleting a reading left its run
   behind and deleting a callout's box left the leader to be swept on the next draw pass. This asks
   the selection what it is made of, which is the same question the bar, the copy and the restyle ask,
   and removes all of it in one history step. Returns how many marks went. */
/* =================================================================================================
   6ky — AND A LOCKED MARK CANNOT BE DELETED EITHER. Ced: "lock and unlock does not work correctly."

   The lock has always said what it promises — selbar.js: "a locked mark cannot be moved, resized,
   restyled or deleted until it is unlocked" — and three of those four were enforced, each at its own
   gesture (`dragBody`, `startAnnoResize`, `startAnnoRotate`). Measured on the built page: a locked
   mark really does refuse a drag (nx 0.2 before, 0.2 after) and really does still select and show
   its bar with Unlock lit — and then Delete took it straight off the sheet. The bar's own Delete
   checks (`sbDelete` → "Unlock these first"); the KEY does not, because it goes through
   `deleteSelection`, which nothing had ever told about the lock. Restyling was the fourth: a locked
   mark took a new colour or weight from the panel without a murmur.

   One predicate, asked by both — a lock that holds for the mouse and not for the keyboard is worse
   than no lock, because it is the one you stop checking. */
function lockedAmong(annos,lines){
  return (annos||[]).concat(lines||[]).some(o=>o&&o.lock);
}
function deleteSelection(){
  let annos=[], lines=[];
  try{ const sel=maSelectedMarks(); annos=sel.annos.slice(); lines=sel.lines.slice(); }catch(e){}
  if(!annos.length&&!lines.length){
    const ids=S.selMulti.size?[...S.selMulti]:(S.sel!=null?[S.sel]:[]);
    const lids=S.selMultiL.size?[...S.selMultiL]:(S.selLine!=null?[S.selLine]:[]);
    annos=ids.map(id=>S.annos.find(a=>a.id===id)).filter(Boolean);
    lines=lids.map(id=>S.lines.find(l=>l.id===id)).filter(Boolean);
  }
  if(!annos.length&&!lines.length)return 0;
  /* 6ky — and it reports a count of -1 rather than 0, because the Delete key reads this as "did
     something happen?" and a plain 0 would send it on to say nothing was selected. */
  if(lockedAmong(annos,lines)){
    try{ toast("Unlock these first"); }catch(_){}
    setStatus("Locked \u2014 unlock these marks before deleting them.",true);
    return -1;
  }
  pushHistory();
  const ai=new Set(annos.map(a=>a.id)), li=new Set(lines.map(l=>l.id));
  S.annos=S.annos.filter(a=>!ai.has(a.id));
  S.lines=S.lines.filter(l=>!li.has(l.id));
  clearMulti(); S.sel=null; S.selLine=null;
  annobar.classList.remove("show");
  const lb=$("#linebar"); if(lb)lb.classList.remove("show");
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  return ai.size+li.size;
}
document.addEventListener("keydown",e=>{ if((e.key==="Delete"||e.key==="Backspace")&&(!_typingTarget()||_emptyMarkFocused())){
  if(_emptyMarkFocused()){ try{ document.activeElement.blur(); }catch(_){} }
  if(deleteSelection())return;
  /* 6ex — AND IT PUSHES HISTORY. The multi-selection and line branches above always did; this one did
     not, so deleting one mark left the undo stack where it was and the next Ctrl+Z jumped back past it —
     measured: Delete took 24 marks to 23 with the history still at 1 entry, and one Ctrl+Z then removed
     all 23. The same fault 6eq found in the drag, in the branch nobody had measured. */
  /* 6ey — and when there is nothing selected, SAY SO. Delete has always been silent in that case, which
     from the keyboard is indistinguishable from a key that does not work. */
  if(S.doc)setStatus("Nothing is selected — click a redline first, or Ctrl+A to take the whole page.",true);
  } });
/* Ground on / off for the selected mark, and the current tool's properties applied to it. Both live on the mark's
   own bar rather than in the ribbon: they are things you decide about one mark once it is down. */
(function(){
  const bar=$("#annobar"); if(!bar)return;
  const bg=bar.querySelector("[data-bgoff]");
  if(bg)bg.onclick=()=>{
    if(S.sel==null)return;
    const a=S.annos.find(z=>z.id===S.sel); if(!a)return;
    pushHistory(); a.bgNone=!a.bgNone; layoutAnnos();
    setStatus(a.bgNone?"No ground — the page reads through this mark.":"Ground on — this mark hides what is under it.");
  };
  const st=bar.querySelector("[data-style]");
  if(st)st.onclick=()=>{
    if(S.sel==null)return;
    const a=S.annos.find(z=>z.id===S.sel); if(!a)return;
    pushHistory();
    a.col=$("#c_text").value; a.bg=$("#c_bg").value;
    a.font=markFontKey(null);
    const sw=parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5); if(sw>0)a.sw=sw;
    if(isShape(a)){
      a.fill=($("#c_fill")&&$("#c_fill").value)||a.fill;
      const op=parseFloat(($("#c_fop")&&$("#c_fop").value)||0); if(!isNaN(op))a.fillOp=Math.max(0,Math.min(1,op/100));
    }
    layoutAnnos();
    setStatus("Mark restyled from the tool's properties.");
  };
})();
$("#linebar").querySelector("[data-ldel]").onclick=()=>{ if(S.selLine==null)return; deleteSelection(); };
/* 6ib — up, down and the band flip, for a stroke. The same three commands the mark bar has, working on
   the same four-level stack, so "put this line behind the cloud" is one click from either end. */
$("#linebar").querySelectorAll("[data-llay]").forEach(b=>b.onclick=()=>{
  const l=(S.lines||[]).find(z=>z.id===S.selLine); if(!l)return;
  pushHistory();
  const fam=layerFamilyL(l);
  const k=b.dataset.llay;
  if(k==="under"){ const to=!l.under; fam.forEach(x=>{ x.under=to; }); }
  else stepLayer(fam,k==="up"?1:-1);
  layoutAnnos(); drawAllLines(); selectLine(l.id); updateRail(); autosave();
});
/* A head on the end, a head on both ends, or neither — cycled on the selected stroke, because which
   one a leader wants is only obvious once it is drawn. */
(function(){
  const b=$("#linebar").querySelector("[data-larrow]"); if(!b)return;
  b.onclick=()=>{
    if(S.selLine==null)return;
    const l=S.lines.find(x=>x.id===S.selLine); if(!l)return;
    pushHistory();
    l.arrow=(l.arrow==="end")?"both":((l.arrow==="both")?undefined:"end");
    drawAllLines();
    setStatus(l.arrow==="end"?"Arrowhead on the end.":(l.arrow==="both"?"Arrowheads on both ends.":"No arrowhead."));
  };
})();
/* And the tool's properties applied to it, for a stroke drawn before you settled on the colour. */
(function(){
  const b=$("#linebar").querySelector("[data-lstyle]"); if(!b)return;
  b.onclick=()=>{
    if(S.selLine==null)return;
    const l=S.lines.find(x=>x.id===S.selLine); if(!l)return;
    pushHistory();
    l.col=$("#c_text").value;
    l.sw=parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5)||1.5;
    drawAllLines();
    setStatus("Stroke restyled.");
  };
})();
/* =================================================================================================
   6ff — PRESSING THE FURNITURE DOES NOT DROP THE SELECTION
   -------------------------------------------------------------------------------------------------
   This used to drop the selection on any press that was not on a mark, a bar or the page — which
   included the ribbon, the tool properties panel, and (once it existed) the selection bar along the
   bottom. So "Edit subject" was gone before its own click handler ran: the pointerdown deselected,
   the bar hid itself, and the button the pointer was over no longer existed. That is the whole of
   "the bottom tools when selecting a redline is not working".

   The rule is now the other way round and much simpler: a press CLEARS the selection only when it
   lands on the document itself or inside the page area. Every piece of chrome — anything that is not
   the pages — leaves the selection exactly where it is, because a control you reached for is a
   control you meant to use ON the selection.
   ================================================================================================= */
document.addEventListener("pointerdown",e=>{
  const t=e.target;
  if(t.closest("#annobar")||t.closest("#multibar")||t.closest(".anno"))return;
  if(t.closest("#linebar")||t.closest("svg.draw"))return;
  if(t.closest(".tspan")||t.closest(".page")){ if(!t.closest("svg.draw"))selectLine(null); return; }
  /* the furniture: keep the selection */
  if(t.closest("#pages")===null && t!==document.body && t!==document.documentElement)return;
  selectAnno(null); selectLine(null);
});
window.addEventListener("scroll",()=>{ positionBar(); positionMultibar(); if(S.selLine!=null){ const l=S.lines.find(x=>x.id===S.selLine); if(l){ const pg=document.querySelector(`.page[data-idx="${l.page}"]`); if(pg)positionLineBar(l,pg); } } },true);

["#c_text","#c_bg"].forEach(id=>$(id).addEventListener("input",()=>{layoutAnnos();drawAllLines();}));
/* the defaults the ribbon starts on, before any tool has spoken */
(function(){ const f=$("#c_fop"); if(f&&f.value==="0")f.value="100"; })();
$("#c_pt").addEventListener("input",()=>{});

/* ---------- photos ----------
   A photo is an annotation with kind:"img", so selection, dragging, grouping, undo, autosave
   and the re-editable export payload all apply to it unchanged. Pasted bitmaps are downscaled
   so the embedded payload stays a sane size. */
const PHOTO_MAX=1200, PHOTO_Q=0.82;
function fileToDataUrl(file){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error("could not read the image")); r.readAsDataURL(file); });
}
/* 6gq — AND A PICTURE THAT HAS NO BACKGROUND KEEPS IT THAT WAY.
   Ced: "add a png support in markups tool to make sure the transparent background is considered."
   Everything shrunk here used to be painted onto WHITE and written out as a JPEG, which is right for a
   photograph off a phone and wrong for the thing a markup library is actually full of: a north arrow,
   a detail lifted out of a drawing, a logo — line art on nothing, which came back as line art on a
   white card that covers whatever it is dropped on. A source that can carry transparency is kept as a
   PNG, un-painted, unless the result would be big enough to matter, in which case the white card is
   still the better trade and the picture says so by being a photograph. */
const PNG_KEEP_MAX=1500000;
function shrinkDataUrl(url,opts){
  const alphaWanted=!!(opts&&opts.keepAlpha) || /^data:image\/(png|gif|webp|svg\+xml)/i.test(String(url||""));
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      const sc=Math.min(1,PHOTO_MAX/Math.max(im.width,im.height));
      if(sc>=1 && url.length<600000){ res({url,w:im.width,h:im.height}); return; }
      const cv=document.createElement("canvas");
      cv.width=Math.max(1,Math.round(im.width*sc)); cv.height=Math.max(1,Math.round(im.height*sc));
      const cx=cv.getContext("2d");
      let out=null;
      if(alphaWanted){
        cx.drawImage(im,0,0,cv.width,cv.height);          /* nothing painted underneath it */
        const png=cv.toDataURL("image/png");
        if(png.length<=PNG_KEEP_MAX)out=png;
        else cx.clearRect(0,0,cv.width,cv.height);
      }
      if(!out){
        cx.fillStyle="#fff"; cx.fillRect(0,0,cv.width,cv.height);
        cx.drawImage(im,0,0,cv.width,cv.height);
        out=cv.toDataURL("image/jpeg",PHOTO_Q);
      }
      const rw=cv.width, rh=cv.height; cv.width=cv.height=0;
      res({url:out,w:rw,h:rh});
    };
    im.onerror=()=>res(null);
    im.src=url;
  });
}
async function addPhotoFromFile(file,at){
  if(!S.doc){ setStatus("Open the report before adding photos.",true); return null; }
  if(!file||!/^image\//.test(file.type||"")){ setStatus("That doesn't look like an image file.",true); return null; }
  let raw;
  try{ raw=await fileToDataUrl(file); }catch(e){ setStatus("Couldn't read that image: "+e.message,true); return null; }
  const im=await shrinkDataUrl(raw);
  if(!im){ setStatus("That image couldn't be decoded.",true); return null; }
  const pi=(at&&at.page!=null)?at.page:visiblePageIdx();
  const P=S.pages[pi]; if(!P)return null;
  pushHistory();
  const wNorm=Math.min(0.42, 320/(P.w1||612));                  // a sensible default on-page size
  const aspect=im.h/im.w;
  const hNorm=wNorm*aspect*((P.w1||612)/(P.h1||792));
  const nx=(at&&at.nx!=null)?Math.max(0,Math.min(1-wNorm,at.nx-wNorm/2)):(0.5-wNorm/2);
  const ny=(at&&at.ny!=null)?Math.max(0,Math.min(1-hNorm,at.ny-hNorm/2)):0.12;
  const a={id:seq++,page:pi,kind:"img",src:im.url,nx,ny,nw:wNorm,nh:hNorm,
           text:"",orig:"",align:"center",size:8,onCell:false,nowrap:false,fullcell:false,manualW:true};
  topZ(a);                 /* 6i3 */
  S.annos.push(a);
  toolDone(); layoutAnnos(); updateRail(); updateCount();
  selectAnno(a.id);
  const pgEl=document.querySelector(`.page[data-idx="${pi}"]`); if(pgEl&&!at)pgEl.scrollIntoView({behavior:"auto",block:"center"});
  LOG("photo added:",im.w+"x"+im.h,"payload",Math.round(im.url.length/1024)+"KB","page",pi+1);
  setStatus(`Photo added to page ${pi+1} — drag to move, corner handles to resize. It exports as a movable PDF annotation.`);
  return a.id;
}
/* =================================================================================================
   6l0 — PASTE A PICTURE, HOWEVER IT WAS COPIED. Ced: "make copy pasting photo on ui possible."

   A paste already worked for a screenshot — the Snipping Tool and Cmd-Shift-4 put a real FILE on the
   clipboard, and the handler looked for exactly that. What they do NOT put there is the thing people
   copy most often: "Copy image" in a browser, a picture out of a document, a drag from a chat. Those
   arrive as `text/html` holding an `<img src=…>`, or as a bare `data:image/...` URL in `text/plain`,
   and the handler walked straight past them, so the paste did nothing at all and there was no way to
   tell whether the copy or the paste had failed.

   All three forms land now, in order of fidelity: the file if there is one, then an `<img>` in the
   HTML flavour, then a data URL in the text. A remote `http(s)` src is fetched, which is the one
   that can fail — the sheet's own network rules apply — and says so rather than failing quietly.
   ================================================================================================= */
async function pastePictureFrom(dt){
  /* 1. a real file: a screenshot, or an image dragged out of the filesystem */
  const it=[...(dt.items||[])].find(x=>x.kind==="file"&&/^image\//.test(x.type));
  if(it){ const f=it.getAsFile(); if(f)return f; }
  const fs=[...(dt.files||[])].find(x=>/^image\//.test(x.type||""));
  if(fs)return fs;
  /* 2. an <img> in the HTML flavour, which is what a browser's "Copy image" gives */
  let url="";
  try{
    const html=dt.getData("text/html")||"";
    if(html){ const m=/<img\b[^>]*\bsrc\s*=\s*("([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(html);
              if(m)url=(m[2]||m[3]||m[4]||"").replace(/&amp;/g,"&"); }
  }catch(e){}
  /* 3. or a data URL sitting in the plain text */
  if(!url){ try{ const t=(dt.getData("text/plain")||"").trim();
                 if(/^data:image\//i.test(t))url=t; }catch(e){} }
  if(!url)return null;
  if(/^data:image\//i.test(url)){
    try{ const b=await (await fetch(url)).blob();
         return new File([b],"pasted.png",{type:b.type||"image/png"}); }catch(e){ return null; }
  }
  if(/^https?:/i.test(url)){
    try{ const r=await fetch(url,{mode:"cors"}); if(!r.ok)throw new Error(r.status);
         const b=await r.blob();
         if(!/^image\//.test(b.type||""))throw new Error("not an image");
         return new File([b],"pasted",{type:b.type}); }
    catch(e){ setStatus("That picture is on a page this tool cannot fetch from \u2014 copy the image "+
                        "itself (right-click \u203a Copy image) or save it and use Photo.",true);
              return null; }
  }
  return null;
}
document.addEventListener("paste",async ev=>{
  if(!S.doc)return;
  const dt=ev.clipboardData; if(!dt)return;
  /* 6l0 — a paste into a mark you are TYPING in is text, but only if there is text to paste. A
     browser's "Copy image" puts HTML and no plain text on the clipboard, and bailing on the caret
     alone meant that clicking a mark and then pasting a picture did nothing at all. */
  let _plain=""; try{ _plain=(dt.getData("text/plain")||"").trim(); }catch(e){}
  const _typing=(()=>{ try{ return typeof _editTarget==="function"&&_editTarget(); }catch(e){ return false; } })();
  if(_typing&&_plain&&!/^data:image\//i.test(_plain))return;
  const hasPic=[...(dt.items||[])].some(x=>x.kind==="file"&&/^image\//.test(x.type))
    || [...(dt.files||[])].some(x=>/^image\//.test(x.type||""))
    || /<img\b/i.test((()=>{ try{ return dt.getData("text/html")||""; }catch(e){ return ""; } })())
    || /^data:image\//i.test((()=>{ try{ return (dt.getData("text/plain")||"").trim(); }catch(e){ return ""; } })());
  if(!hasPic)return;                               // not a picture — the text handlers deal with it
  ev.preventDefault(); ev.stopPropagation();
  if(_typing){ try{ document.activeElement.blur(); }catch(e){} }
  const pgEl=pageAtPoint(_ptr.x,_ptr.y);
  let at=null;
  if(pgEl){ const r=pgEl.getBoundingClientRect();
    at={page:+pgEl.dataset.idx, nx:(_ptr.x-r.left)/pgEl.offsetWidth, ny:(_ptr.y-r.top)/pgEl.offsetHeight}; }
  const file=await pastePictureFrom(dt);
  if(!file)return;
  await addPhotoFromFile(file,at);
},true);
$("#photoBtn").onclick=()=>$("#photoFile").click();
$("#photoFile").onchange=async e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(f)await addPhotoFromFile(f); };

/* ---------- copy / cut / paste redlines (Ctrl+C / Ctrl+X / Ctrl+V) ---------- */
let _ptr={x:innerWidth/2,y:innerHeight/2};
window.addEventListener("pointermove",e=>{ _ptr.x=e.clientX; _ptr.y=e.clientY; },true);
/* =================================================================================================
   6jn — A REDLINE DRAGGED ONTO ANOTHER PAGE GOES TO IT.
   Ced: "make it possible to drag redlines from one page to another without breaking the redline."
   A drag has always been arithmetic inside ONE page: the pointer's travel is divided by that page's
   width and added to the mark's own fraction. Carry the mark past the foot of the sheet and the
   fraction simply goes over 1 — the mark is still filed under the page it started on, still drawn into
   that page's layer, and that layer clips, so it vanishes. Nothing was corrupted; it had walked off
   the edge of the only page it was allowed to be on.
   What the mark needs when it crosses is a change of frame, and the frame it must keep is the one on
   the SCREEN: whatever it looked like under the hand is what it should look like when the hand lets
   go. So the conversion is written that way — a point is taken to screen pixels through the page it is
   leaving and back through the page it is joining — which carries position and size together, keeps
   the mark exactly where it was dropped, and comes out right even between pages of different sizes,
   where the same fraction is a different number of points.
   Everything the mark owns travels with it: a callout's leader, a measurement's run and its reading, a
   strike & write's rule, and every member of a group. That is what `maSelectedMarks` already answers,
   so a mark cannot be half moved.
   ================================================================================================= */
/* WHICH PAGE IS UNDER THE POINTER — and `pageAtPoint` cannot answer it during a drag. The selection's
   handles, its ✕ and its grips are drawn in `.annoui`, which is pinned to the mark's OWN page and is
   deliberately not clipped, so while a mark is being carried down the document its furniture is the
   topmost thing under the hand and every hit test came back with the page it started on. Measured: the
   pointer two hundred pixels inside page 2 and `pageAtPoint` still answering page 1. So the overlays
   are stepped over, and if nothing but chrome is under the pointer the page whose box CONTAINS the
   point is the answer — not `pageAtPoint`'s nearest-centre guess, which would drop a mark on a page the
   hand was never over. */
function maPageUnder(x,y){
  /* 6jr — and a MARK is no longer a witness to which page you are over. Marks used to be clipped to
     their own sheet, so hitting one meant you were on that sheet; now that one may hang past the edge
     (Ced: "make the markings visible beyond the pages in the ui") a mark lying over the next page
     would answer with the page it belongs to. Only the sheet itself speaks for the sheet: its canvas,
     its text layer, its own box. Everything drawn ON a page, and every floating bar, is stepped over. */
  const skip=el=>!!(el&&el.closest&&(el.closest(".annoui")||el.closest(".anno")||
                    el.closest("svg.draw")||el.closest(".annogroup")||
                    el.closest("#annobar")||el.closest("#multibar")||el.closest("#linebar")||
                    el.closest(".selbar")||el.closest(".sb-menu")||el.closest("#toolpop")||
                    el.closest("#maPanel")||el.closest("#toolbar")||el.closest("#miniBar")));
  let els=[];
  try{ els=document.elementsFromPoint(x,y); }catch(e){ els=[]; }
  for(const el of els){
    if(skip(el))continue;
    const pg=el.closest&&el.closest(".page");
    if(pg)return pg;
  }
  let hit=null;
  document.querySelectorAll('#pages .page[data-rendered="1"]').forEach(p=>{
    const r=p.getBoundingClientRect();
    if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)hit=p;
  });
  return hit;
}
function maReframe(fromPg,toPg){
  const r1=fromPg.getBoundingClientRect(), r2=toPg.getBoundingClientRect();
  const w1=fromPg.offsetWidth||1, h1=fromPg.offsetHeight||1;
  const w2=toPg.offsetWidth||1,   h2=toPg.offsetHeight||1;
  return { x:nx=>(r1.left+nx*w1-r2.left)/w2, y:ny=>(r1.top+ny*h1-r2.top)/h2,
           w:nw=>nw*w1/w2,                    h:nh=>nh*h1/h2 };
}
/* does this selection sit on one page, and is the pointer over a different one? */
function maCrossPage(sel,x,y){
  const pgs=new Set((sel.annos||[]).map(a=>a.page).concat((sel.lines||[]).map(l=>l.page)));
  if(pgs.size!==1)return null;                     /* already spread: leave it alone */
  const from=[...pgs][0];
  const el=maPageUnder(x,y); if(!el)return null;
  const to=+el.dataset.idx;
  if(!(to>=0)||to===from)return null;
  if(el.dataset.rendered!=="1")return null;        /* a page that is not laid out has no frame to give */
  const P=S.pages[to];
  if(P&&P.locked)return {locked:true,from,to};
  return {from,to};
}
function maMoveToPage(sel,from,to){
  const A=document.querySelector(`.page[data-idx="${from}"]`);
  const B=document.querySelector(`.page[data-idx="${to}"]`);
  if(!A||!B)return false;
  const T=maReframe(A,B);
  (sel.annos||[]).forEach(a=>{
    if(a.page!==from)return;
    const nx=T.x(a.nx||0), ny=T.y(a.ny||0);
    if(a.nw!=null)a.nw=T.w(a.nw);
    if(a.nh!=null)a.nh=T.h(a.nh);
    if(a.minNh!=null)a.minNh=T.h(a.minNh);
    if(a.lineNh!=null)a.lineNh=T.h(a.lineNh);
    if(a.dimOff)a.dimOff=[T.w(a.dimOff[0]||0),T.h(a.dimOff[1]||0)];
    a.nx=nx; a.ny=ny; a.page=to;
    /* a redline placed ON a printed cell is about a run of text that is not on the new page */
    a.onCell=false; a.fullcell=false;
  });
  (sel.lines||[]).forEach(l=>{
    if(l.page!==from)return;
    const f=p=>[T.x(p[0]),T.y(p[1])];
    if(l.pts&&l.pts.length)l.pts=l.pts.map(f);
    const p1=f([l.x1,l.y1]), p2=f([l.x2,l.y2]);
    l.x1=p1[0]; l.y1=p1[1]; l.x2=p2[0]; l.y2=p2[1];
    if(l.fixW!=null)l.fixW=T.w(l.fixW);
    if(l.coLen!=null)l.coLen=T.w(l.coLen);
    l.page=to;
  });
  return true;
}
/* 6jn — while a drag is over a page that is not the mark's own, that page says so. Without it the
   gesture is invisible until the hand lets go, and a move between pages is not a thing to discover
   after the fact. `null` clears it. */
let _xpHint=null;
function maHintCrossPage(x,y,fromPi){
  const off=()=>{ if(_xpHint){ _xpHint.classList.remove("xpage"); _xpHint=null; } };
  if(x==null){ off(); return; }
  let el=null;
  try{ el=maPageUnder(x,y); }catch(e){ el=null; }
  const to=el?+el.dataset.idx:-1;
  if(!el||to===fromPi||el.dataset.rendered!=="1"){ off(); return; }
  if(_xpHint===el)return;
  off();
  el.classList.add("xpage"); _xpHint=el;
}
/* =================================================================================================
   6jp — A REDLINE IS THE SIZE IT IS, ON WHATEVER SIZE OF SHEET.
   Ced sent a document where one stamp had been applied to all 67 pages, six of which are landscape,
   and the six came out wrong. Measured in the exported file: the box is 91.7 x 41.6 points on the
   portrait pages and 129.6 x 29.5 on the landscape ones — 1.414 times wider and 0.707 times shorter,
   which is exactly the ratio of the two page sizes. The writing inside went with it: 57.6 x 9.9 became
   81.6 x 7.0.
   The cause is the unit a mark is kept in. Everything is a FRACTION of its page, which is the right
   thing for zoom, for re-rendering and for a document whose pages are all one size — and the wrong
   thing the moment a copy lands on a page of another size, because the same fraction of a wider page
   is a wider mark. A copy has to keep the mark's SIZE, not its fraction.
   So a family copied onto a differently-sized page is rescaled by the ratio of the two pages, about
   its own top-left, and nudged back on if that pushes it off the edge. Same-sized pages — which is
   almost every page of almost every document — are left untouched, bit for bit.
   ================================================================================================= */
function maKeepSize(annos,lines,fromPi,toPi){
  const A=(S.pages||[])[fromPi]||{}, B=(S.pages||[])[toPi]||{};
  const aw=A.w1||612, ah=A.h1||792, bw=B.w1||612, bh=B.h1||792;
  const kx=aw/bw, ky=ah/bh;
  if(Math.abs(kx-1)<1e-6&&Math.abs(ky-1)<1e-6)return false;
  annos=annos||[]; lines=lines||[];
  const xs=[], ys=[];
  annos.forEach(o=>{ xs.push(o.nx||0); ys.push(o.ny||0); });
  lines.forEach(l=>{ const P=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
                     P.forEach(p=>{ xs.push(p[0]); ys.push(p[1]); }); });
  if(!xs.length)return false;
  const ox=Math.min(...xs), oy=Math.min(...ys);
  const fx=v=>ox+(v-ox)*kx, fy=v=>oy+(v-oy)*ky;
  annos.forEach(o=>{
    o.nx=fx(o.nx||0); o.ny=fy(o.ny||0);
    if(o.nw!=null)o.nw*=kx;
    if(o.nh!=null)o.nh*=ky;
    if(o.minNh!=null)o.minNh*=ky;
    if(o.lineNh!=null)o.lineNh*=ky;
    if(o.dimOff)o.dimOff=[(o.dimOff[0]||0)*kx,(o.dimOff[1]||0)*ky];
    /* a value written onto a printed cell is about a run that is not on this page at this size */
    o.onCell=false; o.fullcell=false;
  });
  lines.forEach(l=>{
    if(l.pts&&l.pts.length)l.pts=l.pts.map(p=>[fx(p[0]),fy(p[1])]);
    l.x1=fx(l.x1); l.y1=fy(l.y1); l.x2=fx(l.x2); l.y2=fy(l.y2);
    if(l.fixW!=null)l.fixW*=kx;
    if(l.coLen!=null)l.coLen*=kx;
  });
  /* and back onto the sheet if the rescale pushed it over an edge */
  const X=[], Y=[];
  annos.forEach(o=>{ X.push(o.nx,(o.nx||0)+(o.nw||0)); Y.push(o.ny,(o.ny||0)+(o.nh||0)); });
  lines.forEach(l=>{ const P=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
                     P.forEach(p=>{ X.push(p[0]); Y.push(p[1]); }); });
  let dx=0, dy=0;
  const x0=Math.min(...X), x1=Math.max(...X), y0=Math.min(...Y), y1=Math.max(...Y);
  if(x1>1)dx=-(x1-1); if(x0+dx<0)dx=-x0;
  if(y1>1)dy=-(y1-1); if(y0+dy<0)dy=-y0;
  if(dx||dy){
    annos.forEach(o=>{ o.nx=(o.nx||0)+dx; o.ny=(o.ny||0)+dy; });
    lines.forEach(l=>{
      if(l.pts&&l.pts.length)l.pts=l.pts.map(p=>[p[0]+dx,p[1]+dy]);
      l.x1+=dx; l.y1+=dy; l.x2+=dx; l.y2+=dy; });
  }
  return true;
}
/* the whole gesture: called from a drag's pointerup with the last place the pointer was */
function maDropAcrossPages(x,y,inDrag){
  let sel;
  try{ sel=maSelectedMarks(); }catch(e){ return false; }
  if(!sel||(!sel.annos.length&&!sel.lines.length))return false;
  const c=maCrossPage(sel,x,y);
  if(!c)return false;
  if(c.locked){ toast("Page "+(c.to+1)+" is locked"); return false; }
  /* a drag has already taken its own snapshot before the first pixel moved, and that one covers this;
     called any other way, the move is a change like any other and puts itself on the stack */
  if(!inDrag){ try{ pushHistory(); }catch(e){} }
  if(!maMoveToPage(sel,c.from,c.to))return false;
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  try{ paintMulti(); }catch(e){}
  try{ positionBar(); }catch(e){}
  setStatus("Moved to page "+(c.to+1)+".");
  return true;
}
function pageAtPoint(cx,cy){
  const els=document.elementsFromPoint(cx,cy);
  for(const el of els){ const pg=el.closest&&el.closest(".page"); if(pg)return pg; }
  // fallback: nearest page by center
  let best=null,bd=1e9; document.querySelectorAll(".page").forEach(p=>{const r=p.getBoundingClientRect();const d=Math.abs((r.top+r.height/2)-cy);if(d<bd){bd=d;best=p;}}); return best;
}
/* 6ey — THIS FUNCTION WAS DEAD AND LOOKED LIVE. A second `function currentPageIdx()` is declared 1,000
   lines below and a later declaration wins, so every caller has always run that one — while this copy,
   with its own different rule (the page under the POINTER, then nearest-centre), sat here reading like the
   definition. The same trap the handover records from 6b. It now delegates, so there is one answer to the
   question and one place to change it. */
function currentPageIdx(){ return _scrollPageIdx(); }
/* =================================================================================================
   6gk — COPY AND PASTE, INCLUDING THE THINGS THAT ARE NOT TEXT MARKS
   Ced: "undo redo delete copy and paste ... please make sure every tool is working."

   Copy only ever took ANNOS. Every stroke — a line, an arrow, a measurement, a callout's leader, a
   cross-out — was silently left behind, so copying an arrow did nothing at all and copying a callout
   or a length gave you half of it. The clipboard now holds both lists, the selection is expanded to
   whatever it owns (a callout's leader, a measurement's reading) before it is taken, and the ids
   inside it are remapped on paste so the pasted copy owns its own halves rather than pointing at the
   original's.

   A pasted picture is byte-for-byte the one that was copied: `_tintCol` travels with it, so the tint
   pass sees a picture already in its own colour and leaves it alone. That is Ced's "the result, if
   copy and pasted, should not change looks".
   ================================================================================================= */
function clipCount(){ return S.clip?(((S.clip.a||[]).length)+((S.clip.l||[]).length)):0; }
/* 6jd — the pending cut: which marks are wearing the ants, and what happens to them next */
function maCutPending(){ return !!((S.cutA&&S.cutA.size)||(S.cutL&&S.cutL.size)); }
/* Escape calls a pending cut off, wherever the hand is — before anything else Escape does, because a
   cut nobody meant to make is the thing you want out of the way first. */
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||!maCutPending())return;
  if(typeof _typingTarget==="function"&&_typingTarget())return;
  if(document.querySelector(".sk-edit,.sb-ask,#dlg[open]"))return;
  if(maCutClear())e.stopPropagation();
},true);
function maCutMark(ids,lids){
  S.cutA=new Set(ids||[]); S.cutL=new Set(lids||[]);
  try{ layoutAnnos(); drawAllLines(); }catch(e){}
}
function maCutClear(quiet){
  if(!maCutPending())return false;
  S.cutA=new Set(); S.cutL=new Set();
  try{ layoutAnnos(); drawAllLines(); }catch(e){}
  if(!quiet)setStatus("Cut called off — nothing was moved.");
  return true;
}
/* the marks leave the page only once the paste has put them somewhere */
function maCutCommit(){
  if(!maCutPending())return false;
  const ai=S.cutA, li=S.cutL;
  S.annos=S.annos.filter(a=>!ai.has(a.id));
  S.lines=S.lines.filter(l=>!li.has(l.id));
  S.cutA=new Set(); S.cutL=new Set();
  return true;
}
function copySelectedAnnos(cut){
  let annos=[], lines=[];
  try{
    const sel=maSelectedMarks();          /* a callout, a measurement: whole, not half */
    annos=sel.annos.slice(); lines=sel.lines.slice();
  }catch(e){}
  if(!annos.length&&!lines.length){
    const ids=S.selMulti.size?[...S.selMulti]:(S.sel!=null?[S.sel]:[]);
    const lids=S.selMultiL.size?[...S.selMultiL]:(S.selLine!=null?[S.selLine]:[]);
    annos=ids.map(id=>S.annos.find(a=>a.id===id)).filter(Boolean);
    lines=lids.map(id=>S.lines.find(l=>l.id===id)).filter(Boolean);
  }
  if(!annos.length&&!lines.length)return false;
  /* 6jp — and WHICH PAGE it came from, so a paste onto a different-sized sheet can keep its size */
  S.clip={ a:annos.map(a=>({..._cleanA(a)})), l:lines.map(l=>({..._cleanL(l)})),
           page:(annos[0]||lines[0]||{}).page };
  if(cut){
    /* 6jd — A CUT MARKS, IT DOES NOT REMOVE. Ced: "cut function should not automatically removes the
       redline, add an animation of a dotted lines that are moving first." Taking the mark away the
       instant Ctrl+X is pressed means that if you then change your mind, or paste somewhere that turns
       out to be wrong, the thing you cut has already gone from where it was. So the cut is PENDING:
       the marks are outlined in moving dashes — the marching ants every drawing program uses to say
       "this is on its way somewhere" — and they leave the page at the moment they land somewhere else.
       Escape calls it off, and so does cutting or copying something else. */
    maCutMark(annos.map(a=>a.id),lines.map(l=>l.id));
  } else maCutClear();
  const n=clipCount();
  toast(cut?`Cut ${n} mark${n>1?"s":""} — paste to move ${n>1?"them":"it"}, Esc to call it off`
           :`Copied ${n} mark${n>1?"s":""}`);
  return true;
}
/* 6gu — vestigial since a paste lands where the pointer is instead of following it: nothing sets this
   any more, so the two handlers below are inert. They are kept because `commitPlacing` is called from
   a few places that must stay safe to call. */
let _placing=null;   // {ids, lids, page, last:{x,y}} — the pasted marks following the cursor
function pasteAnnos(){
  if(!clipCount())return;
  const pg=pageAtPoint(_ptr.x,_ptr.y)||document.querySelector(`.page[data-idx="${currentPageIdx()}"]`);
  if(!pg){ toast("Scroll a page into view, then paste."); return; }
  const pre=snapshot();
  const target=+pg.dataset.idx;
  const r=pg.getBoundingClientRect();
  const px=Math.min(Math.max((_ptr.x-r.left)/pg.offsetWidth,0),1);
  const py=Math.min(Math.max((_ptr.y-r.top)/pg.offsetHeight,0),1);
  /* the top-left corner of everything on the clipboard, so a group of marks keeps its arrangement and
     lands under the pointer as a whole rather than hanging off whichever one happened to be first */
  const xs=[], ys=[];
  (S.clip.a||[]).forEach(a=>{ xs.push(a.nx); ys.push(a.ny); });
  (S.clip.l||[]).forEach(l=>{ const P=(l.pts&&l.pts.length)?l.pts:[[l.x1,l.y1],[l.x2,l.y2]];
    P.forEach(q=>{ xs.push(q[0]); ys.push(q[1]); }); });
  const bx=xs.length?Math.min(...xs):0, by=ys.length?Math.min(...ys):0;
  const dx=px-bx, dy=py-by;
  clearMulti(); S.sel=null; S.selLine=null;
  const newIds=[], newLids=[], comap={}, gmap={};
  (S.clip.a||[]).forEach(src=>{
    const a={..._cleanA(src),id:seq++,page:target,nx:src.nx+dx,ny:src.ny+dy};
    if(src.group!=null){ if(gmap[src.group]==null)gmap[src.group]=seq++; a.group=gmap[src.group]; }
    if(src.id!=null)comap[src.id]=a.id;
    topZ(a); S.annos.push(a); newIds.push(a.id);   /* 6i3 */
  });
  (S.clip.l||[]).forEach(src=>{
    const l={..._cleanL(src),id:seq++,page:target,
             x1:src.x1+dx,y1:src.y1+dy,x2:src.x2+dx,y2:src.y2+dy};
    if(src.pts&&src.pts.length)l.pts=src.pts.map(q=>[q[0]+dx,q[1]+dy]);
    if(src.group!=null){ if(gmap[src.group]==null)gmap[src.group]=seq++; l.group=gmap[src.group]; }
    /* the copy owns ITS OWN box and ITS OWN reading — never the original's */
    if(src.coFor!=null)l.coFor=(comap[src.coFor]!=null?comap[src.coFor]:undefined);
    if(src.dimFor!=null)l.dimFor=(comap[src.dimFor]!=null?comap[src.dimFor]:undefined);
    S.lines.push(l); newLids.push(l.id);
  });
  /* a leader or a reading whose partner did not come along would be swept away by the next draw
     pass, which is right — but a callout copied on its own should keep its box, so the halves are
     dropped rather than left dangling */
  /* 6jp — a paste onto a page of another size keeps the marks' own size */
  let _resized=false;
  if(S.clip.page!=null&&S.clip.page!==target){
    try{
      const nA=newIds.map(id=>S.annos.find(z=>z.id===id)).filter(Boolean);
      const nL=newLids.map(id=>S.lines.find(z=>z.id===id)).filter(Boolean);
      _resized=maKeepSize(nA,nL,S.clip.page,target);
    }catch(e){}
  }
  /* 6jd — and NOW the cut lands: the marks leave where they were, at the moment they arrive somewhere
     else, so a cut you never paste has cost you nothing. */
  const _cut=maCutCommit();
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  /* ==============================================================================================
     6ld — A PASTE OF ONE MARK IS AN ORDINARY SELECTION.
     Ced: "pasting should select the pasted item where you can already drag it immediately."
     6gu stopped the paste hovering and left the marks "selected and ready to be dragged like anything
     else" — in `S.selMulti`, which for a SET is right and for ONE mark is not. Measured on the built
     page, pasting a single text box: `S.sel` came back `null`, `S.selMulti` held the one id, and
     there was no `.anno.selui .rz` anywhere on the page. Dragging it did work — `dragMulti` takes
     that gesture — so what was missing was everything else a selection is: no grips, so the mark
     could not be resized without first clicking it again; and the floating bar was the multi bar,
     offering what you do to a SET rather than this mark's own properties.
     One mark pasted is therefore selected the way one mark clicked is: `selectAnno`, its own grips,
     its own bar. A set keeps the group selection, which is what a set is.
     And the mode comes back to Select, because a paste is an edit. Measured the same way: pasting
     with the Text tool still in hand left `S.mode` on `text`, so the next drag drew a new box instead
     of working on what had just arrived. 6l1's `selNotFromDraw` is told, so Escape reads this as a
     selection rather than as something left over from a tool.
     ============================================================================================== */
  const _one=(newIds.length===1&&newLids.length===0);
  const _oneL=(newLids.length===1&&newIds.length===0);
  try{ if(S.mode!=="select")setMode("select"); }catch(e){}
  try{ selNotFromDraw(); }catch(e){}
  if(_one){ clearMulti(); selectAnno(newIds[0]); }
  else if(_oneL){ clearMulti(); selectLine(newLids[0]); }
  else{
    newIds.forEach(id=>S.selMulti.add(id));
    newLids.forEach(id=>S.selMultiL.add(id));
    paintMulti();
  }
  /* 6gu — A PASTE LANDS, IT DOES NOT HOVER. Ced: "make sure shortcuts also work (copy paste
     delete) in keyboard." Copy and Delete always did; paste put the marks on the page and then left
     them FOLLOWING THE CURSOR until you clicked, so the natural next gesture — pasting and then
     clicking where you wanted to work — dragged the paste across the sheet with it, and pressing
     Ctrl+V twice stacked two floating copies. They are dropped where the pointer was, selected and
     ready to be dragged like anything else, which is the same rule a markup drop follows. */
  if(pre!=null){ S.history.push(pre); if(S.history.length>80)S.history.shift();
                 S.future=[]; updateUndoUI(); }
  /* and the clipboard steps, so a second paste in the same place is legible rather than exactly on
     top of the first */
  const P=S.pages[target]; const off=P?12/P.w1:0.014;
  S.clip={ a:(S.clip.a||[]).map(src=>({...src,nx:src.nx+off,ny:src.ny+off})),
           l:(S.clip.l||[]).map(src=>Object.assign({},src,{
                x1:src.x1+off,y1:src.y1+off,x2:src.x2+off,y2:src.y2+off,
                pts:(src.pts&&src.pts.length)?src.pts.map(q=>[q[0]+off,q[1]+off]):src.pts })) };
  autosave();
  setStatus(_cut
    ? `Moved ${newIds.length+newLids.length} mark${(newIds.length+newLids.length)>1?"s":""} here.`
    : `Pasted ${newIds.length+newLids.length} mark${(newIds.length+newLids.length)>1?"s":""} — `+
      (_resized?"this page is a different size, so they were kept at their own size rather than "+
                "stretched to fit. ":"")+
      `They are selected, so drag them anywhere from here.`);
}
/* While placing, the pasted marks follow the cursor. The delta is applied to the MARKS, not to their
   elements: a stroke has no element to nudge, and a mark whose rendered top is not its logical
   position (a cell redline) would bake the renderer's lift into it. */
window.addEventListener("pointermove",e=>{
  if(!_placing)return;
  const pg=document.querySelector(`.page[data-idx="${_placing.page}"]`); if(!pg)return;
  const r=pg.getBoundingClientRect(), w=pg.offsetWidth, h=pg.offsetHeight;
  const nx=(e.clientX-r.left)/w, ny=(e.clientY-r.top)/h;
  const dx=nx-_placing.last.x, dy=ny-_placing.last.y;
  if(!dx&&!dy)return;
  _placing.last={x:nx,y:ny};
  _placing.ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); if(a){ a.nx+=dx; a.ny+=dy; } });
  _placing.lids.forEach(id=>{ const l=S.lines.find(z=>z.id===id); if(!l)return;
    if(l.pts&&l.pts.length)l.pts=l.pts.map(q=>[q[0]+dx,q[1]+dy]);
    l.x1+=dx; l.y1+=dy; l.x2+=dx; l.y2+=dy; });
  layoutAnnos();
  if(_placing.lids.length)drawPageLines(_placing.page);
  paintMulti();
},true);
function commitPlacing(){
  if(!_placing)return;
  /* keep the clipboard stepping, so a second paste lands a little off the first */
  const P=S.pages[_placing.page]; const off=P?12/P.w1:0.014;
  S.clip={ a:(S.clip.a||[]).map(src=>({...src,nx:src.nx+off,ny:src.ny+off})),
           l:(S.clip.l||[]).map(src=>Object.assign({},src,{
                x1:src.x1+off,y1:src.y1+off,x2:src.x2+off,y2:src.y2+off,
                pts:(src.pts&&src.pts.length)?src.pts.map(q=>[q[0]+off,q[1]+off]):src.pts })) };
  const pre=_placing.pre;
  _placing=null;
  if(pre!=null){ S.history.push(pre); if(S.history.length>80)S.history.shift();
                 S.future=[]; updateUndoUI(); autosave(); }
  else pushHistory();
  layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  setStatus("Pasted.");
}
window.addEventListener("pointerdown",e=>{ if(_placing){ e.preventDefault(); e.stopPropagation(); commitPlacing(); } },true);
window.addEventListener("keydown",e=>{ if(_placing&&(e.key==="Escape"||e.key==="Enter")){ commitPlacing(); } });
document.addEventListener("keydown",e=>{
  const ae=document.activeElement;
  const editing=ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||(ae.classList&&ae.classList.contains("ed")));
  const sel=window.getSelection&&String(window.getSelection());
  const k=e.key.toLowerCase();
  /* 6gu — AND THEY WORK WITH THE CARET IN A MARK. Ced: "make sure shortcuts also work (copy paste
     delete) in keyboard." A mark you have just drawn or double-clicked holds the caret, and while it
     did, Ctrl+C and Ctrl+X were handed to the browser as a text copy — of nothing, because no text was
     selected — so the keys did nothing at all. With text actually selected they still mean the text;
     with none selected, in a MARK (not a ribbon field), they mean the mark. */
  const inMark=!!(ae&&ae.classList&&ae.classList.contains("ed"));
  const hasText=!!(sel&&sel.length);
  /* ================================================================================================
     6ma — AND A FIELD WITH NOTHING SELECTED IN IT DOES NOT OWN THE CLIPBOARD.
     Ced: "ctrl a, s, c, v, x, y, and del are not working well all the time."

     Measured, every one of them, in nine states — nothing selected, a mark, a stroke, a
     multi-selection, straight after drawing with the tool still in hand, with a ribbon control
     focused, with the properties popup open, with the caret in a mark, and with the caret in Find.
     Seventeen of eighteen combinations already worked. The one that did not:

         Ctrl+C / Ctrl+X with the caret in the FIND box   ->   nothing at all

     and it is a state a hand gets into constantly: press `/`, find the row, then try to copy a mark.
     `editing && !inMark` handed the key to the browser, which copied the empty selection in a search
     field. 6gu had already worked out the right rule for a MARK — "with text actually selected it
     means the text; with none selected it means the mark" — and simply did not apply it to the
     ribbon's own fields, which is the kind of near-miss that makes a shortcut feel unreliable rather
     than broken.
     The rule is the same everywhere now: a Ctrl+C or Ctrl+X with NO text under it is about the
     drawing, wherever the caret happens to be. Ctrl+V is deliberately left alone — pasting a search
     term into Find is a real thing to want, and there is no selection to tell the two apart.
     ================================================================================================ */
  if((e.ctrlKey||e.metaKey)&&k==="c"){
    if(hasText) return;                       // native text copy
    if(copySelectedAnnos(false)) e.preventDefault();
    return;
  }
  if((e.ctrlKey||e.metaKey)&&k==="x"){
    if(hasText) return;                       // native cut in a text box
    if(copySelectedAnnos(true)) e.preventDefault();
    return;
  }
  if((e.ctrlKey||e.metaKey)&&k==="v"){
    if(editing) return;                       // normal paste into a text box
    if(clipCount()){ e.preventDefault(); pasteAnnos(); }
  }
});

/* =================================================================================================
   6gk — THE FOUR RIBBON BUTTONS THAT WERE NEVER WIRED
   Ced: "some tools in the general ribbon is not working like delete markings, remove redlines, undo
   redo delete copy and paste, and others. please make sure every tool is working."

   Save, Clear saved markings, Clear… and All on page each had their function, their icon, their
   tooltip and their enable/disable line — and no `onclick` at all. They were wired in the RFDS tool
   this one was forked from, and the wiring is one of the things that did not come across; everything
   they call has been here the whole time. An audit case now clicks every button in the ribbon and
   fails on any that does nothing, so a button cannot go quiet again without the tests saying so.
   ================================================================================================= */
$("#selAllBtn").onclick=selectAllOnPage;
$("#saveBtn").onclick=manualSave;
/* the cache button is live whether or not a document is open: what it clears is what the BROWSER is
   holding, which is exactly what you want to empty before opening anything */
(function(){ const b=$("#cacheBtn"); if(b)b.onclick=clearSavedMarkings; })();
$("#clearBtn").onclick=async()=>{
  if(!S.doc){ setStatus("Open a report first.",true); return; }
  const cur=currentPageIdx();
  const choice=await uiConfirm({
    title:"Clear redlines",
    message:`Remove redlines from page ${cur+1} only, or the entire document?\nA backup is kept, so Ctrl+Z brings them back.`,
    buttons:[{id:"page",label:`This page (${cur+1})`,primary:true},
             {id:"all",label:"Entire document",danger:true},
             {id:"cancel",label:"Cancel"}]
  });
  if(choice==="page")clearRedlines("page");
  else if(choice==="all")clearRedlines("all");
};

/* ---------- undo / redo wiring ---------- */
$("#undoBtn").onclick=undo;
$("#redoBtn").onclick=redo;
document.addEventListener("keydown",e=>{
  /* 6ex — the narrow guard: a mark's own text or the Analyze grid, not the ribbon's Find box */
  const typing=_editTarget();
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){ if(typing)return; e.preventDefault(); undo(); }
  else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.key.toLowerCase()==="z"&&e.shiftKey))){ if(typing)return; e.preventDefault(); redo(); }
});

/* ---------- zoom ---------- */
/* 6iw — a proportional step, so the wheel of clicks it takes to get from 100% to 800% is the same
   handful it takes to get from 100% to 200%, rather than forty-seven. */
/* 6ji — a press is one deliberate step and nothing more is coming, so it sharpens on the next frame
   instead of waiting out a settle meant for the wheel. */
$("#zoomIn").onclick=()=>setZoom(S.scale*(S.scale<1.5?1.2:1.25),null,0);
$("#zoomOut").onclick=()=>setZoom(S.scale/(S.scale<=1.5?1.2:1.25),null,0);
function resizePageBoxes(){
  /* 6gb — CENTRED WHILE IT FITS, FLUSH LEFT WHEN IT DOES NOT.
     A flex item with auto side margins is centred by the browser even when it is WIDER than the
     column — and then half of it hangs off the left edge, where no amount of scrolling reaches it.
     That is the clipped sheet Ced has been seeing at 200%. So the margins are set per page against
     the column's own width: a sheet that fits is centred, a sheet that does not starts at the left
     edge and overflows to the right, which scrolls. */
  /* ================================================================================================
     6m8 — centred while it FITS, flush left when it does not. The sheet's own margins are left to
     `margin:auto`: `syncPageCol` now makes the column symmetric about the window, so the browser's
     own centring puts the sheet on the window's middle and keeps it there through every resize, rail
     toggle and column change without this function being told. The first cut of 6m8 computed an
     explicit pixel margin here instead and it went stale the moment anything moved — measured, a
     change of reading-column width left the old margin in place and the sheet 250px off centre.
     ================================================================================================ */
  const host=document.getElementById("pages");
  const room=host?host.clientWidth:0;
  S.pages.forEach((P,i)=>{
    if(!P||!P.page)return;
    const pg=document.querySelector('.page[data-idx="'+i+'"]');
    if(!pg)return;
    try{ const vp=P.page.getViewport({scale:S.scale});
      pg.style.width=vp.width+"px"; pg.style.height=vp.height+"px";
      const fits=(!room||vp.width<=room);
      pg.style.marginLeft=fits?"auto":"0px";
      pg.style.marginRight=fits?"auto":"0px";
      const bb=pg.previousElementSibling;
      if(bb&&bb.classList.contains("page-bar")){
        bb.style.width=vp.width+"px";
        bb.style.marginLeft=fits?"auto":"0px";
        bb.style.marginRight=fits?"auto":"0px";
      }
    }catch(e){}
  });
}
/* 6ep — ZOOM WITHOUT REBUILDING THE DOCUMENT.
   `setZoom` called `renderAll()`, and `renderAll()` starts with `#pages.innerHTML=""` and then builds
   every page div, every page bar, all their handlers and the rail again — 49 pages' worth, on every
   wheel notch. That is the whole of "zooming is not smooth": a full teardown and rebuild per step, with
   a flash where the document briefly has no pages in it at all. It is also the only mechanism by which a
   redline you were working on could move, because its element is destroyed mid-edit and everything
   derived from that element's pixels is derived again from a new one.

   Nothing about a zoom needs new DOM. The pages keep their divs, their bars and their handlers; each
   rendered page drops its canvas and layers exactly the way the virtualiser already unloads one, so the
   visible pages redraw crisply at the new scale; and the marks are laid out from the normalised
   coordinates they have held all along. */
/* 6gb — HOW WIDE THE CENTRED COLUMN IS.
   The layout column is 1,360px by default, which is right for the chrome and too narrow for a drawing
   sheet at 200%. It is widened here to whatever the widest sheet needs — and never past the window, so
   the body itself never gains a horizontal scrollbar and the ribbon, the header and the status line
   stay exactly where they are. A sheet wider than the window still overflows its column to the RIGHT,
   which scrolls; nothing is ever clipped on the left. */
/* =================================================================================================
   6gs — THE RIBBON'S WIDTH IS THE RIBBON'S, NOT THE ZOOM'S
   Ced: "fix the implementation of the ribbon, currently it is very broken. zooming in and out should
   not resize the ribbon."

   Two different things were writing `--col-w`, and they disagreed. `applyColWidth` owns it: it is the
   user's own column setting — "fill" by default, a number once they have dragged a grip — measured
   against the window and nothing else. And then this function overwrote it on every zoom with a width
   derived from THE PAGE (`widest*scale + 36`), so zooming in stretched the ribbon, zooming out shrank
   it, and a column the user had set by hand was thrown away by the next wheel notch.

   A sheet's width has no business setting the chrome's width. This re-applies the user's setting — for
   the window it is in now — and touches nothing else. The pages are centred by their own margins
   (`resizePageBoxes`), which is where centring belongs.
   ================================================================================================= */
function fitColumn(){
  try{ applyColWidth(null,false); }catch(e){}
}
window.addEventListener("resize",()=>{ try{ fitColumn(); }catch(e){} });
/* =================================================================================================
   6gr — A ZOOM SHOWS AT ONCE AND SHARPENS AFTER
   Ced: "zooming in and out on the main ui is not as seamless. the pdf refresh time is too slow."

   Every zoom threw the rendered pages away and asked pdf.js to draw them again, and on a mount drawing
   — thousands of vectors on a sheet — that is most of a second per page. With the sheet blank until it
   lands, one wheel notch is a flash of nothing; ten notches is ten of them, and each one cancels the
   render before it, so the picture only comes back when the hand stops.

   A viewer does not do that. The pixels it already has are STRETCHED to the new size — instantly, a
   little soft — and the crisp render is done once, when the zoom settles. So:

     · `softenPages()` rescales what is on screen: the canvas by its CSS box (the bitmap is untouched),
       the text layer by a transform, the stroke layer by its own width and height. Nothing is thrown
       away and nothing is asked of pdf.js.
     · `resharpenSoon()` waits for the zooming to stop, then re-renders the pages near the window and
       drops the far ones for the observer to bring back.

   The result is a zoom that moves with the wheel and a sheet that is never blank.
   ================================================================================================= */
function softenPages(){
  document.querySelectorAll("#pages .page").forEach(pg=>{
    if(pg.dataset.rendered!=="1")return;
    const i=+pg.dataset.idx; const P=S.pages[i];
    if(!P||!P.page)return;
    let vp; try{ vp=P.page.getViewport({scale:S.scale}); }catch(e){ return; }
    const cv=pg.querySelector("canvas.pdf");
    if(cv&&cv.width){
      /* 6mw — against what it is SHOWN at. `cv.width` is how many pixels were painted into it,
         which since the oversample is a different number. */
      const k=canvasStretch(cv,vp.width);
      if(Math.abs(k-1)<0.001)return;                       /* already at this size */
      cv.style.width=vp.width+"px"; cv.style.height=vp.height+"px";
      cv.dataset.shown=String(Math.round(vp.width));      /* 6mw — it is shown at this now */
      const tl=pg.querySelector(".textlayer");
      if(tl){ tl.style.transformOrigin="0 0"; tl.style.transform="scale("+k+")"; }
      pg.querySelectorAll(":scope > svg.draw").forEach(svg=>{     /* 6ia — both layers */
        svg.setAttribute("width",vp.width); svg.setAttribute("height",vp.height); });
      /* ==========================================================================================
         6mi — AND THE MARKS ARE NOT SOFTENED. Ced, twice: "zooming in and out is making the preview
         of the redlines all messed up" · "zooming in it gets pixelated."

         v49's `6mc` gave the marks and the strokes the same stretch as the canvas, to save the
         `layoutAnnos` and `drawAllLines` a notch used to cost. Their POSITIONS were right — measured
         through a whole ten-notch gesture, the worst any mark moved was 0.0013 of the page — and
         that was never what Ced was looking at. What he was looking at is that a redline drawn at
         one size and then scaled by CSS is a stretched bitmap of itself: the text in a box goes
         soft, a 2pt rule comes out at 2.2pt, and every edge is resampled. For the whole gesture,
         and on a sheet of redlines that is everything on it.

         It was a bad trade and the measurement says so plainly. Re-laying the marks is NOT the
         expensive part of a zoom — that is pdf.js, 61-204ms a page, which is why 6gr softens the
         canvas and why that half stays. Against it, on the 167-mark construction set:

             layoutAnnos    8.2 ms      the whole of what softening the marks was saving,
             drawAllLines   0.5 ms      per notch, and a notch is already frame-bounded because
             drawPageLines  2.6 ms      the wheel handler batches to one setZoom per rAF

         about 12ms a frame to have every redline crisp and exactly where it belongs at every
         instant of the gesture. v48's nineteen calls were the real fault, and they came from
         `resharpenSoon` and from renders landing mid-gesture, not from the one call a notch makes.

         So: the canvas and the text layer are stretched, and the marks and strokes are drawn. 6mc's
         two stand-in removers in `layoutAnnos` and `drawPageLines` go with it — nothing sets them
         now, and a rule nothing uses is a rule that rots.
         ========================================================================================== */
      pg.dataset.soft="1";
    }
  });
}
let _sharpT=0;
/* 6ji — HOW LONG THE BLUR LASTS IS MOST OF HOW SLOW A ZOOM FEELS. Ced: "make zooming in and out of
   the pdfs a bit faster." A zoom step is already instant — the page is CSS-scaled on the spot — but it
   is soft until the re-render lands, and the wait before that even starts was a flat 170ms whether you
   pressed the button once or spun the wheel. A single press now re-renders on the next frame; only a
   wheel gesture, where more notches are probably coming, waits — and it waits 110ms rather than 170. */
function resharpenSoon(ms){
  clearTimeout(_sharpT);
  _sharpT=setTimeout(()=>{
    /* 6gs — and ANY rendered page whose picture is not the size of its box is put right, however it
       got that way: a render that landed late, a page brought back by the observer mid-zoom, a soft
       page that was never marked. The box is the truth — `resizePageBoxes` sets it from the scale. */
    document.querySelectorAll('#pages .page[data-rendered="1"]').forEach(pg=>{
      if(pg.dataset.soft==="1")return;
      const cv=pg.querySelector("canvas.pdf"); if(!cv)return;
      const want=Math.round(parseFloat(pg.style.width)||0);
      const has=Math.round(parseFloat(cv.style.width)||cv.width||0);
      if(want&&has&&Math.abs(want-has)>1)pg.dataset.soft="1";
    });
    /* 6ji — nearest the middle of the window first. Every soft page used to be re-rendered in page
       order, so on a long document the one under your eyes could be fourth in a queue of four full
       page renders — which is the wait that reads as "zooming is slow". */
    const _mid=window.innerHeight/2;
    const _soft=[...document.querySelectorAll('#pages .page[data-soft="1"]')].sort((p,q)=>{
      const a=p.getBoundingClientRect(), b=q.getBoundingClientRect();
      return Math.abs(a.top+a.height/2-_mid)-Math.abs(b.top+b.height/2-_mid); });
    /* ============================================================================================
       6m7 — AND THEY GO ONE AT A TIME. This loop STARTED every soft page's render in the same turn:
       measured on a six-press zoom, thirteen `resharpenPage` calls all in flight together, each of
       them 70–200ms of pdf.js on the one thread, so the page under the cursor came back last and the
       whole gesture read as treacle. The nearest one is drawn, a frame is yielded, then the next —
       and any that has scrolled away by then is dropped rather than drawn.
       ============================================================================================ */
    const _near=[];
    _soft.forEach(pg=>{
      const i=+pg.dataset.idx;
      const r=pg.getBoundingClientRect();
      const close=(r.bottom>-800 && r.top<window.innerHeight+800);
      if(close)_near.push(i);
      else { delete pg.dataset.soft; unloadPage(i); }         /* far away: the observer brings it back */
    });
    (async()=>{
      for(const i of _near){
        const pg=document.querySelector(`.page[data-idx="${i}"]`);
        if(!pg||pg.dataset.soft!=="1")continue;               /* already caught up */
        const r=pg.getBoundingClientRect();
        if(r.bottom<-800||r.top>window.innerHeight+800){      /* it moved while we waited */
          delete pg.dataset.soft; unloadPage(i); continue;
        }
        try{ await resharpenPage(i); }catch(e){}
        await new Promise(res=>requestAnimationFrame(()=>res()));
      }
    })();
    /* 6my — and the marks are NOT laid out here. This pair arrived with 6mc, when `rezoomPages` had
       stopped doing it and the settle was the only place left; 6mi put it back on every notch and
       left this as a second copy of the same work, firing once per debounce — which on a long
       gesture is several times. Measured on a ten-notch zoom, `layoutAnnos` went from 18 calls to
       10 with these two lines gone, and nothing needs them: a page the resharpen re-renders goes
       through `_renderPageNow`, which lays the marks out itself. */
  }, (ms==null?110:ms));
}
function rezoomPages(settle){
  fitColumn();
  resizePageBoxes();
  softenPages();                           /* what is on screen stays on screen */
  /* ==============================================================================================
     6lh — A ZOOM DOES NOT NEED A NEW OBSERVER, AND BUILDING ONE COSTS THE WHOLE DOCUMENT.
     Ced: "zoom in and out are again very slow."

     `setupVirtualization()` disconnects the IntersectionObserver and makes a new one over every page.
     A fresh observer delivers an entry for EVERY element it is given, on the next frame, whether or
     not anything about it has changed — so each zoom step produced one record per page, and the
     off-screen ones (most of a 32-page site package) each ran `unloadPage`, throwing away a canvas
     that the next step would have to draw again. Measured on the 32-page fixture: a ten-notch wheel
     zoom made 300 `unloadPage` calls and 20 observers, 30 pages torn down per notch, and the worst
     frame in the gesture was 462ms.

     None of that work was ever needed. An observer watches ELEMENTS, and a zoom does not create or
     remove any — 6ep made zoom keep every page div and only redraw its canvas — so the observer it
     already has is watching exactly the right things and recomputes its own intersections when they
     change size. Rebuilding is only right after `renderAll`, which does replace the elements, and
     that is where the other two calls are.
     ============================================================================================== */
  resharpenSoon(settle);                   /* and comes back crisp when the zooming stops */
  /* 6mi — and the redlines are DRAWN at the new scale, not stretched to it. ~12ms on a 167-mark
     sheet, once per frame because the wheel handler batches, and every mark is crisp throughout. */
  try{ layoutAnnos(); }catch(e){}
  try{ drawAllLines(); }catch(e){}
  /* 6ji — the page list does not change with the zoom, and rebuilding it on every notch of a wheel
     gesture is work nobody sees. It is caught up once the zooming stops. */
  if(settle===0){ try{ updateRail(); }catch(e){} }
  else { clearTimeout(_railT); _railT=setTimeout(()=>{ try{ updateRail(); }catch(e){} },160); }
}
let _railT=0;
/* 6gi — A ZOOM IS NOT A SCROLL. Changing the scale re-lays every page, which moves the document under
   the window and fires `scroll` — and the ribbon's auto-hide reads any downward scroll as "the user is
   reading, get out of the way". So pressing + or − , or ctrl-wheeling, made the ribbon vanish under the
   hand that was using it. Ced: "the buttons and the scroll for zoom should not hide the ribbons."
   The guard is a timestamp rather than a flag: the scroll events a zoom causes arrive after it, some of
   them a frame or two later, and a flag cleared on the next line would already be off. */
let _zoomQuiet=0;
function zoomQuiet(ms){ _zoomQuiet=Date.now()+(ms||700); }
function inZoomQuiet(){ return Date.now()<_zoomQuiet; }
async function setZoom(z,anchor,settle){
  zoomQuiet();
  const old=S.scale;
  /* 6gl — WHERE THE HAND IS LOOKING, MEASURED FIRST. `resizePageBoxes()` below pins every page at the
     NEW size before anything re-renders, so anything measured after it is already the new layout —
     which is why the first cut of this read back the fraction it had just produced and moved nothing. */
  const _zax=anchor?anchor.x:window.innerWidth/2, _zay=anchor?anchor.y:window.innerHeight/2;
  const _zpi=(()=>{ try{ const el=document.elementFromPoint(_zax,_zay);
      const p=el&&el.closest&&el.closest(".page");
      if(p)return +p.dataset.idx; }catch(e){}
    try{ return currentPageIdx(); }catch(e){ return 0; } })();
  /* ================================================================================================
     6mv — ZOOMING FROM THE PAPER'S EDGE ZOOMS THE PAPER'S EDGE.
     Ced: "the tool just goes back to the pdf like this if zoomed in from the free space. if zooming
     on the right most, just zoom of the right most of the pdf, and vice versa to the left. on the
     left, just make sure the zoom is only showing to the page list and not overlaying the pages
     list."

     The anchor is a point on the sheet, as a fraction of it — and over the grey beside the sheet
     that fraction is outside 0..1. Putting an off-paper point back under the cursor drags the sheet
     across by however far off the paper you were, which is why a zoom started in the free space
     threw the view somewhere else entirely; and the further out you were, the further it threw.

     Clamped, the nearest point ON the paper is held instead. Zoom from the grey on the right and
     the right edge stays under the cursor; from the grey on the left, the left edge does — which
     also means the sheet cannot be driven in under the page list, because the edge is pinned to a
     pointer that is to the right of it.
     ================================================================================================ */
  const _zfrac=(()=>{ const p=document.querySelector(`.page[data-idx="${_zpi}"]`);
    if(!p)return null; const r=p.getBoundingClientRect();
    if(!r.width||!r.height)return null;
    const cl=(v)=>Math.max(0,Math.min(1,v));
    return {fx:cl((_zax-r.left)/r.width), fy:cl((_zay-r.top)/r.height)}; })();
  /* 6iw — Ced: "do not also limit the zoom to just 350%." On a 34x22 drawing sheet 350% is barely
     enough to read a part number off a detail, let alone put a mark on one. The ceiling is 12x, which
     is as far as a page canvas can be rendered before the memory it needs stops being reasonable, and
     the floor stays where it was. */
  S.scale=Math.min(12,Math.max(0.2,+z.toFixed(2)));
  if(S.scale===old){ resizePageBoxes(); return; }
  resizePageBoxes();          // pin the new box before anything re-renders
  $("#zoomLbl").textContent=Math.round(S.scale*100)+"%";
  if(S.doc){
    /* 6ep — page view has ONE page on screen and its own scroller, so the anchor that keeps a point
       under the cursor is the wrong rule there: it drags the page off-centre as it shrinks. Centre it
       instead, which is what "zooming out should stay in the middle" asks for. */
    const inPage=(typeof _pageView!=="undefined")&&_pageView;
    const ax=_zax, ay=_zay;
    /* 6gl — THE ANCHOR IS A POINT ON THE SHEET, NOT A POINT IN THE DOCUMENT.
       Ced: "fix the centering of the pdf when zooming in."
       Scaling the scroll position by the zoom ratio assumes everything above and to the left of the
       sheet scales with it, and it does not: the page sits in a CENTRED column, so its left margin is
       (column − page)/2, which shrinks as the page grows. Zooming in therefore walked the sheet left
       out of the window, a little further at every step. So the point under the cursor is measured as
       a FRACTION OF THE PAGE before the re-layout and put back under the cursor after it — exact at
       any zoom, on both axes, and clamped to what there actually is to scroll. */
    const pi=_zpi, before=_zfrac;
    rezoomPages(settle); observePages(false);   /* 6lh — the pages are the same elements */
    if(inPage) centreCurrentPage();
    else{
      const p=document.querySelector(`.page[data-idx="${pi}"]`);
      if(before&&p){
        const r=p.getBoundingClientRect();
        const maxX=Math.max(0,(document.documentElement.scrollWidth||0)-window.innerWidth);
        /* 6md — "unless zoomed in in specific place". A ctrl-wheel names a place and the point under
           it is held; the + and − buttons, a fit, a keyboard zoom name none, so the sheet is put in
           the middle of the window instead of wherever the previous scroll left it. When the sheet
           fits, the column's `margin:auto` has already centred it and this asks for the scroll it is
           already at; when it does not fit, this is the only thing that can centre it. */
        const _mid=window.scrollX+(r.left+r.width/2)-window.innerWidth/2;
        const wantX=anchor
          ? Math.max(0,Math.min(maxX,window.scrollX+(r.left+before.fx*r.width)-ax))
          : Math.max(0,Math.min(maxX,_mid));
        const wantY=Math.max(0,window.scrollY+(r.top+before.fy*r.height)-ay);
        window.scrollTo(wantX,wantY);
        /* 6gq — and the ribbon goes with it in the same frame, not on the scroll event after */
        try{ syncRibbonX(); }catch(e){}
      }
    }
    positionMultibar();
  }
}
/* 6ep — keep the page in the middle of its own scroller. In page view the pages live in a scroller of
   their own and the page can be smaller than it, so "centred" means both axes. */
function centreCurrentPage(){
  try{
    const i=(typeof _viewPi!=="undefined")?_viewPi:currentPageIdx();
    const pg=document.querySelector('.page[data-idx="'+i+'"]'); if(!pg)return;
    const sc=pagesScroller();
    if(!sc||sc===document.scrollingElement||sc===document.documentElement){
      const r=pg.getBoundingClientRect();
      window.scrollTo({left:Math.max(0,window.scrollX+r.left+r.width/2-window.innerWidth/2),
                       top:Math.max(0,window.scrollY+r.top+r.height/2-window.innerHeight/2)});
      return;
    }
    sc.scrollLeft=Math.max(0,(sc.scrollWidth-sc.clientWidth)/2);
    sc.scrollTop=Math.max(0,(pg.offsetTop+pg.offsetHeight/2)-sc.clientHeight/2);
  }catch(e){}
}
/* Ctrl + mouse wheel to zoom.
   6ep — the notches are ACCUMULATED and applied once per frame. The old lock took one notch and threw
   away everything that arrived in the next 60ms, so a fast wheel gesture became a handful of jumps with
   dropped steps between them; now a burst of ten notches is one re-render at the scale they add up to. */
let _zPend=0,_zAnchor=null,_zRaf=0;
document.addEventListener("wheel",e=>{
  if(!e.ctrlKey||!S.doc)return;
  /* 6gl — Ced: "zooming in and out on the edit picture in snapshot should zoom in and out on the
     interface and not the page itself." A ctrl-wheel over a dialog is the dialog's: the picture
     editor zooms the picture with it, and the sheet behind must not move at all. */
  if(typeof SK_ED!=="undefined"&&SK_ED)return;
  if(e.target&&e.target.closest&&e.target.closest(".sk-edit,#dlg,.sb-ask,#toolpop,#maPanel,.az-box"))return;
  e.preventDefault();
  /* 6gi — quiet the auto-hide from the FIRST notch, not from the setZoom a frame later: the scroll a
     long wheel gesture generates starts before the re-render does. */
  zoomQuiet(900);
  _zPend+=(e.deltaY<0?0.12:-0.12);
  _zAnchor={x:e.clientX,y:e.clientY};
  if(_zRaf)return;
  _zRaf=requestAnimationFrame(()=>{
    _zRaf=0; const d=_zPend; _zPend=0;
    if(d)setZoom(S.scale+d,_zAnchor);
  });
},{passive:false});

/* ---------- Claude API helpers ---------- */
async function askClaude(prompt,imgs){
  const content=imgs.map(b=>({type:"image",source:{type:"base64",media_type:"image/jpeg",data:b}}));
  content.push({type:"text",text:prompt});
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,messages:[{role:"user",content}]})});
  if(!r.ok){ const t=await r.text().catch(()=>""); throw new Error("API "+r.status+" "+t.slice(0,300)); }
  const d=await r.json();
  window._lastApi=d;
  try{ LOG("api resp",{stop:d.stop_reason,types:(d.content||[]).map(b=>b.type),usage:d.usage}); }catch(e){}
  if(d&&d.stop_reason==="max_tokens"){ LOG&&LOG("⚠ response hit max_tokens — output may be truncated"); }
  if(d&&d.error){ throw new Error(d.error.message||JSON.stringify(d.error)); }
  return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").replace(/```json|```/g,"").trim();
}
function parseJson(t){
  if(!t)return null;
  const s=t.indexOf("{"),a=t.indexOf("[");
  let i=(a>=0&&(a<s||s<0))?a:s; if(i<0)return null;
  const str=t.slice(i);
  try{ return JSON.parse(str); }catch(e){}
  // salvage a truncated array/object: cut to the last complete nested element, then close open brackets
  const stack=[]; let inStr=false, esc=false, lastComplete=-1;
  for(let k=0;k<str.length;k++){ const c=str[k];
    if(inStr){ if(esc)esc=false; else if(c==="\\")esc=true; else if(c==='"')inStr=false; continue; }
    if(c==='"'){ inStr=true; continue; }
    if(c==="{"||c==="[") stack.push(c);
    else if(c==="}"||c==="]"){ stack.pop(); if(stack.length>=1) lastComplete=k; }   // finished a nested element, still inside container
  }
  if(lastComplete>0){
    let cut=str.slice(0,lastComplete+1);
    const st=[]; inStr=false; esc=false;
    for(let k=0;k<cut.length;k++){ const c=cut[k];
      if(inStr){ if(esc)esc=false; else if(c==="\\")esc=true; else if(c==='"')inStr=false; continue; }
      if(c==='"'){ inStr=true; continue; }
      if(c==="{"||c==="[") st.push(c); else if(c==="}"||c==="]") st.pop();
    }
    while(st.length){ cut += (st.pop()==="{" ? "}" : "]"); }
    try{ const v=JSON.parse(cut); LOG&&LOG("parseJson: salvaged truncated JSON"); return v; }catch(e){}
  }
  return null;
}
async function askClaudeText(prompt){
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:8000,messages:[{role:"user",content:prompt}]})});
  if(!r.ok){ const t=await r.text().catch(()=>""); throw new Error("API "+r.status+" "+t.slice(0,300)); }
  const d=await r.json();
  if(d&&d.stop_reason==="max_tokens"){ LOG&&LOG("⚠ text response hit max_tokens — output may be truncated"); }
  if(d&&d.error){ throw new Error(d.error.message||JSON.stringify(d.error)); }
  return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").replace(/```json|```/g,"").trim();
}
function applySuggestions(){ document.querySelectorAll(".tspan").forEach(b=>b.classList.toggle("suggested",S.suggestions.has(b.dataset.key))); }

function findOnPage(pi,needle){
  const n=String(needle).trim(); if(!n)return null;
  const norm=s=>s.replace(/\s+/g,"").toLowerCase(); const nn=norm(n);
  const its=S.pages[pi].items;
  let it=its.find(t=>t.str.trim()===n) || its.find(t=>t.str.trim().toLowerCase()===n.toLowerCase())
       || (nn.length>=2 && its.find(t=>norm(t.str)===nn))
       || (nn.length>=3 && its.find(t=>norm(t.str).includes(nn)));
  return it||null;
}

/* shared: apply a list of {p,op,find,value} marks to the open report */
function applyMarks(marks){
  let applied=0,missed=0,first=null,locked=0;
  marks.forEach(m=>{
    const needle=String(m.find||"").trim(); if(!needle)return;
    let pi=(typeof m.p==="number"&&m.p>=0&&m.p<S.pages.length)?m.p:-1;
    let it=(pi>=0&&!S.pages[pi].locked)?findOnPage(pi,needle):null;
    if(!it){ for(let k=0;k<S.pages.length&&!it;k++){ if(S.pages[k].locked)continue; it=findOnPage(k,needle); if(it)pi=k; } }
    if(!it){ missed++; LOG("NO MATCH",m.op,":",needle); return; }
    if(S.pages[pi].locked){ locked++; LOG("SKIP locked page",pi+1,m.op,needle); return; }
    if(m.op==="strike_row") strikeRow(pi,it);
    else if(m.op==="strike_text") addLine(pi,it.nx,it.ny+it.nh/2,it.nx+it.nw,it.ny+it.nh/2);
    else addText(pi,it.nx,it.ny,(m.value!=null&&String(m.value).trim())?String(m.value):it.str,{cell:it,auto:true});
    applied++; if(!first)first={pi}; LOG("applied",m.op,"p"+(pi+1),":",needle,m.value?("→ "+m.value):"");
  });
  if(locked)LOG(`skipped ${locked} mark(s) on locked pages`);
  return {applied,missed,first,locked};
}


/* ---------- copy list ---------- */
$("#copyBtn").onclick=async()=>{
  const tc=$("#c_text").value,bg=$("#c_bg").value;
  const byPage={}; S.annos.forEach(a=>{(byPage[a.page]=byPage[a.page]||[]).push(a);});
  let html=`<div style="font-family:Arial"><p style="font-family:Arial;font-size:12px;margin:0 0 8px"><b>Redline list — ${esc(siteLocation()||S.name||"this document")}</b></p>`;
  let plain=`Redline list — ${siteLocation()||S.name||"this document"}\n`;
  Object.keys(byPage).sort((a,b)=>a-b).forEach(p=>{
    html+=`<h4 style="font-family:Arial;font-size:12px;margin:12px 0 3px">Page ${+p+1}</h4>`; plain+=`\nPage ${+p+1}\n`;
    byPage[p].forEach(a=>{ html+=`<div><span style="font-family:'Times New Roman',Times,serif;font-size:${a.size}pt;color:${tc};background:${bg}">${esc(a.text)}</span></div>`; plain+="  "+a.text+"\n"; });
  });
  html+="</div>";
  try{ await navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([html],{type:"text/html"}),"text/plain":new Blob([plain],{type:"text/plain"})})]); toast("Copied — paste into Word/Excel"); }
  catch(e){ const ta=el("textarea");ta.value=plain;document.body.appendChild(ta);ta.select();document.execCommand("copy");ta.remove();toast("Copied (text)"); }
};

/* ---------- export: redlines as real PDF annotations (comments), original content untouched ---------- */
/* Report an export failure instead of appearing to do nothing, and give it a shortcut so a layout
   problem can never be the only thing standing between you and the file. */
async function runExport(){
  const btn=$("#dlPdf");
  if(btn&&btn.disabled){ setStatus("Open a PDF first — then the export button will save the marked-up copy."); return; }
  /* v60 — one export at a time. A double-click on Export, or Ctrl+Shift+E pressed while the first was
     still writing, ran two exports into the same pdf-lib document and the same download name. */
  if(runExport._busy){ setStatus("Already exporting — one moment."); return; }
  runExport._busy=true;
  try{ if(btn)btn.setAttribute("aria-busy","true"); }catch(e){}
  try{ await exportPdf(); }
  catch(err){
    const m=(err&&err.message)||String(err);
    LOG("export failed",m); if(_echoConsole)console.error("[MA] export failed:",err);
    /* the redlines are untouched by a failed export — say that first, then what to try */
    try{ autosave(true); }catch(e){}
    setStatus("Export failed ("+m.slice(0,140)+"). Your redlines are still here and saved — try Export again.",true);
    try{ MIU_GUARD.notice("Export failed",
      "Your redlines are still here and saved in this browser. Try Export again; if it fails twice, use Copy details and send it on.","warn"); }catch(e){}
  }finally{
    runExport._busy=false;
    try{ if(btn)btn.removeAttribute("aria-busy"); }catch(e){}
  }
}
$("#dlPdf").onclick=runExport;
/* Ctrl/Cmd+Shift+E as a second route to the export, in case the button is ever unreachable.
   (Plain Ctrl+E is reserved by some browsers, so it is not used.) */
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&(e.key==="e"||e.key==="E")&&!_editTarget()){
    e.preventDefault(); runExport();
  }
});
/* ================================================================================================
   THE TAG A MARK TRAVELS UNDER, AND WHY IT IS NOT PLAIN JSON.
   ------------------------------------------------------------------------------------------------
   Every mark is written into the exported PDF twice over: as the annotation's own fingerprint, and in
   the document's Subject. Both were plain `JSON.stringify` inside a PDF string literal, and a PDF
   string literal treats a backslash as an ESCAPE. So `"text":"TSC CONSTRUCTION, LLC\nEDEN TA"` — the
   two characters backslash and n, which is how JSON writes a line break — came back out of the file as
   a REAL newline inside a JSON string, and `JSON.parse` refuses that: "Bad control character".

   Measured on a stamped report: the frame and the word reopened fine and the three-line detail did not.
   It fell through to the geometry rebuild, which knows nothing about the mark it is rebuilding, so the
   stamp came back as a nameless 8pt mark sitting on top of the real one — one extra mark per page,
   thirty-two of them, growing every time the file went round.

   Base64 has no backslashes, so nothing in it can be re-escaped on the way through. Older files are
   still read: plain JSON first, and failing that the same JSON with its control characters escaped
   back to what they were before the PDF parser got to them. */
/* ==================================================================================================
   6le — A PICTURE'S BYTES TRAVEL ONCE, AND NEVER INSIDE A STRING.
   Ced: "the photo redlines are not being kept when a pdf was reopened on the tool."

   6fg found this once already and fixed it for ONE field. The rule it established is right: a photo's
   pixels are in its annotation's own appearance stream, so carrying them a second time in the re-edit
   payload is pure weight — and worse than weight, because pdf-lib's `decodeText()` spreads a string's
   code units through `String.fromCharCode` and throws `RangeError: Maximum call stack size exceeded`
   somewhere past a million and a half of them. A payload that big is not merely large, it is
   UNREADABLE, and an unreadable payload loses every mark in it.

   6fg wrote `delete o.src` and stopped there. Since then two more fields have been added to `_cleanA`
   that hold a whole picture each — `srcOrig` (6gs, what Restore goes back to) and `picRaw` (6jb, the
   picture without its baked frame) — and both have been riding in the payload AND in every photo's
   own `MAPhoto` tag ever since. Measured on three 1200x873 photos that had been through the picture
   editor, which is all it takes to set `srcOrig`:

       each photo's src          776,279 chars
       each MAPhoto tag        1,035,409 chars     ← one whole picture inside it
       the re-edit payload     3,106,394 chars     ← three more

   Both routes past the ceiling, so both were unreadable, and the reopen said it plainly: "Detached 3
   of our annotation(s) ... 4 annotation(s) are not ours" — the three it detached were the file's own
   text marks and all three photos were counted as somebody else's. Nothing was corrupt. The photos
   were simply written in a form that could not be read back.

   So the rule gets a function instead of a line in one caller, which is the 6ff lesson: one place that
   knows pictures do not travel in strings, used by the payload and by the tag, and no way for a third
   field to be added without passing through it. `maPicFrame` recovers the unframed picture by cropping
   when it needs it (see there), so nothing is lost by leaving `picRaw` out.
   ================================================================================================== */
/* ==================================================================================================
   6nm — A PICTURE HAS TO SURVIVE SOMEONE ELSE FLATTENING THE FILE.
   Ced: "uploading a pdf into a different platform and editing it again seems to flatten the photos
   in the pdf", with the file back from the site it was submitted to.

   Measured on that file — 18 pages, our own Producer still on it:

       /Annots on every page .......... 0      every annotation stripped
       MAData / MAPhoto / MARL ........ 0      so every per-mark tag went with them
       /Subject MAREDLINE payload ..... 99,934 chars, intact
       marks in it .................... 139 marks, 41 strokes  — all of them
       pictures in it ................. 8, every one with NO pixels

   So the document payload is the channel that survives, and the reason the PICTURES do not come
   back is 6ff and 6le: a photo's bytes were taken out of the payload because they were also in the
   photo's own annotation tag, and the tag is what a flattener destroys. Everything else in the
   payload is enough to rebuild the mark; the picture is the one thing that is only pixels.

   The payload is also stored UNCOMPRESSED — base64 of plain JSON. Measured on Ced's file, gzipping
   it first takes 99,920 chars to 9,624, which is a tenth. That is where the room comes from.

   So each picture now travels twice, on purpose and at two different weights:

     the annotation tag  the picture as it is, full resolution — the normal reopen, unchanged
     the payload         a RECOVERY COPY, bounded to 1400px on the long side, PNG where the
                         picture has transparency (every cut-out does) and JPEG where it has not

   A reopen prefers the tag and falls back to the recovery copy, so an ordinary round trip loses
   nothing and a flattened one comes back with the pictures visible. Identical pictures — the same
   markup placed five times — are stored once and referenced. And if the whole thing would still
   grow past what pdf-lib can read back, the largest copies are dropped one at a time until it
   fits and the count is recorded, so the reopen can say which pictures it could not bring back
   rather than quietly showing an empty box.
   ================================================================================================== */
/* measured: pdf-lib's `decodeText` spreads a string a character at a time and blew the stack past
   about 1.5M; this is the ceiling for the whole encoded payload, with room to spare. */
const PAY_SAFE_MAX=900000;
/* 6nm — SHRINK BEFORE YOU SHED. The first cut made one copy at 1400px and dropped whole pictures
   when the total would not fit, which is the worst trade available: three incompressible test
   photos cost 644,761 chars and TWO of them were thrown away to make the third fit. A picture that
   comes back small is worth a great deal more than a picture that does not come back, so each one
   is stepped down until it fits a budget of its own, and only a picture that will not fit even at
   its smallest is given up. Measured on three 1180x820 noise photos — the worst case there is,
   since noise is exactly what will not compress — 1400px/q0.72 came to about 215,000 chars each
   and 700px/q0.55 to about 46,000. */
const PIC_RECOVER_STEPS=[[1400,0.72],[1000,0.62],[700,0.55],[480,0.5]];
const PIC_RECOVER_BUDGET=120000;   /* chars, per picture */
/* does this picture have anything transparent in it? a cut-out does, a photograph does not */
function _picHasAlpha(im){
  try{
    const w=Math.min(im.naturalWidth||im.width||0,320), h=Math.min(im.naturalHeight||im.height||0,320);
    if(!(w&&h))return true;
    const c=document.createElement("canvas"); c.width=w; c.height=h;
    const g=c.getContext("2d",{willReadFrequently:true});
    g.drawImage(im,0,0,w,h);
    const d=g.getImageData(0,0,w,h).data;
    for(let i=3;i<d.length;i+=4) if(d[i]<250) return true;
    return false;
  }catch(e){ return true; }     /* cannot tell: keep the alpha-safe format */
}
/* the bounded copy that rides in the document payload */
function _picRecovery(src){
  return new Promise(res=>{
    try{
      const im=new Image();
      im.onload=()=>{
        try{
          const w0=im.naturalWidth||im.width, h0=im.naturalHeight||im.height;
          if(!(w0&&h0))return res(null);
          /* 6nm — a picture with no transparency is a photograph, and a photograph in PNG is
             several times the size of the same picture in JPEG for no gain a redliner can see.
             A cut-out has transparency and has to stay PNG however big that makes it, which is why
             the steps go down to 480: that is the lever PNG leaves. */
          const alpha=_picHasAlpha(im);
          let best=null;
          for(const [maxPx,q] of PIC_RECOVER_STEPS){
            const k=Math.min(1,maxPx/Math.max(w0,h0));
            const w=Math.max(1,Math.round(w0*k)), h=Math.max(1,Math.round(h0*k));
            const c=document.createElement("canvas"); c.width=w; c.height=h;
            const g=c.getContext("2d");
            g.drawImage(im,0,0,w,h);
            const url=alpha ? c.toDataURL("image/png") : c.toDataURL("image/jpeg",q);
            c.width=c.height=0;
            best=url;
            if(url.length<=PIC_RECOVER_BUDGET)break;
          }
          res(best);
        }catch(e){ res(null); }
      };
      im.onerror=()=>res(null);
      im.src=src;
    }catch(e){ res(null); }
  });
}
/* Build the `pics` table for a payload: one entry per DISTINCT picture, each mark pointing at it.
   Returns {pics, dropped} and writes `picRef` onto the marks it could serve. */
async function _payPics(annos){
  const pics={}, bySrc=new Map();
  let n=0;
  for(const a of (annos||[])){
    if(!a||a.kind!=="img")continue;
    const src=a.__picSrc;                       /* put there by the caller, before the strip */
    if(!src)continue;
    let key=bySrc.get(src);
    if(key==null){
      const rec=await _picRecovery(src);
      if(!rec)continue;
      key="p"+(++n); bySrc.set(src,key); pics[key]=rec;
    }
    a.picRef=key;
  }
  return pics;
}
const PIC_FIELDS=["src","srcOrig","picRaw"];
function _stripPicBytes(o){
  if(!o)return o;
  PIC_FIELDS.forEach(k=>{ delete o[k]; });
  return o;
}
/* the tripwire. With `_stripPicBytes` in front of both writers this cannot fire; it is here so that
   if a fourth picture field is ever added and NOT routed through it, the file says so at the moment it
   is written rather than at the reopen that loses the marks. 1,000,000 is comfortably under the
   measured ceiling and comfortably over anything a legitimate tag holds. */
const TAG_SAFE_MAX=1000000;
/* 6nm — THE DOCUMENT PAYLOAD IS PACKED. `_tagEnc` is shared with the per-mark tags, which are small
   and must stay exactly as they are, so the payload gets its own pair. `gz:` is the new carrier and
   `b64:` is what every file written before this build has — both are read, only `gz:` is written.
   Measured on Ced's returned file: 99,920 chars of base64 JSON becomes 9,624. */
async function _payEnc(o){
  let json; try{ json=JSON.stringify(o); }catch(e){ return ""; }
  if(typeof CompressionStream==="function"){
    try{
      const cs=new CompressionStream("gzip"), w=cs.writable.getWriter();
      w.write(new TextEncoder().encode(json)); w.close();
      const buf=new Uint8Array(await new Response(cs.readable).arrayBuffer());
      const packed="gz:"+_b64enc(buf);
      if(packed.length<json.length)return packed;
    }catch(e){ LOG&&LOG("payload: could not pack it, writing it plain —",e&&e.message); }
  }
  try{ return "b64:"+btoa(unescape(encodeURIComponent(json))); }catch(e){ return json; }
}
async function _payDec(v){
  if(v==null)return null;
  const t=String(v);
  if(t.indexOf("gz:")===0){
    try{
      const ds=new DecompressionStream("gzip"), w=ds.writable.getWriter();
      w.write(_b64dec(t.slice(3))); w.close();
      return JSON.parse(await new Response(ds.readable).text());
    }catch(e){ LOG&&LOG("payload: packed but would not unpack —",e&&e.message); return null; }
  }
  return _tagDec(t);                 /* `b64:` and bare JSON, exactly as before */
}
function _tagEnc(o){
  let s;
  try{ s="b64:"+btoa(unescape(encodeURIComponent(JSON.stringify(o)))); }
  catch(e){ try{ s=JSON.stringify(o); }catch(_){ return ""; } }
  if(s.length>TAG_SAFE_MAX){
    let big="";
    try{ big=Object.keys(o||{}).map(k=>[k,String(JSON.stringify(o[k])||"").length])
            .filter(p=>p[1]>20000).sort((x,y)=>y[1]-x[1])
            .map(p=>p[0]+" "+p[1]).join(", "); }catch(_){}
    LOG&&LOG("WRITING A TAG OF",s.length,"chars — past what pdf-lib can read back (6le). Biggest "+
             "field(s):",big||"(could not measure)");
  }
  return s;
}
function _tagDec(v){
  if(v==null)return null;
  const t=String(v);
  if(t.indexOf("b64:")===0){
    try{ return JSON.parse(decodeURIComponent(escape(atob(t.slice(4))))); }catch(e){}
  }
  try{ return JSON.parse(t); }catch(e){}
  try{ return JSON.parse(t.replace(/[\u0000-\u001f]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"))); }
  catch(e){ return null; }
}

function hexRgb(h){ const m=/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h)||["","c0","00","00"]; return {r:parseInt(m[1],16)/255,g:parseInt(m[2],16)/255,b:parseInt(m[3],16)/255}; }
function pdfEsc(s){ return String(s).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)"); }
async function exportPdf(){
  if(!window.PDFLib){ setStatus("PDF library (pdf-lib) not loaded.",true); return; }
  if(!S.docBytes){ setStatus("No source PDF loaded.",true); return; }
  showProg("Building redlined PDF…");
  LOG("Export (annotations) started:",S.annos.length,"redlines,",S.lines.length,"lines");
  try{
    const {PDFDocument,StandardFonts,rgb,PDFName,PDFArray,PDFDict,PDFString,PDFNumber}=PDFLib;
    const doc=await PDFDocument.load(S.docBytes);       // original pages stay untouched
    /* Only the faces this document actually uses are embedded — normally one, and never more than the
       handful in MARK_FONTS. They are the standard fourteen, so "embedding" costs a font dictionary
       and nothing else. */
    const _fontKeys=new Set([MARK_FONT_DEFAULT]);
    S.annos.forEach(a=>{ if(a&&a.kind!=="img")_fontKeys.add(markFontKey(a)); });
    const fontMap={};
    for(const k of _fontKeys){
      const F=MARK_FONTS[k]||{};
      try{
        /* 6hm — a bundled face is written into the file itself; a standard one is named and the
           viewer supplies it. Both come back with the same two things the writer below uses. */
        if(F.ttf){
          const emb=ttfEmbed(PDFLib,doc,F.ttf,F.ps||("Face"+k));
          if(emb){ fontMap[k]=emb; continue; }
          LOG("bundled face",F.ttf,"could not be embedded — falling back to Helvetica");
          fontMap[k]=await doc.embedFont(StandardFonts.Helvetica);
        }
        else fontMap[k]=await doc.embedFont(StandardFonts[F.pdf]);
      }
      catch(e){ LOG("could not embed",F.pdf||F.ttf,"—",e&&e.message); }
    }
    const font=fontMap[MARK_FONT_DEFAULT]||fontMap[Object.keys(fontMap)[0]];
    const fontOf=a=>fontMap[markFontKey(a)]||font;
    const tc=hexRgb($("#c_text").value), bgc=hexRgb($("#c_bg").value);
    const ctx=doc.context, pages=doc.getPages();
    const author="Redline";
    const col=[tc.r,tc.g,tc.b], bg=[bgc.r,bgc.g,bgc.b];

    /* ---- WHERE A MARK GOES ON A PAGE THAT IS NOT UPRIGHT ------------------------------------------
       pdf.js renders a page with its /Rotate applied, so every coordinate this tool holds is in the
       ROTATED, on-screen frame. pdf-lib writes an annotation in the page's OWN frame, which is the
       unrotated one. On an upright page the two are the same and nothing here does anything.

       Mount analyses are not all upright: the drawing sheets, the RISA output and the wind tables are
       routinely landscape, carried as a portrait mediabox with /Rotate 90 or 270. Without this a mark
       placed on one of those pages was written a quarter turn away from where it was put — and the
       drawing sheets are exactly the pages the callouts go on.

       `dispOf` gives the page's on-screen size (the one the normalised coordinates are measured
       against). `toPdf` maps a normalised on-screen point into the page's own coordinates. `spinOf`
       is the rotation, counter-clockwise in degrees, that the mark's own artwork needs so that it
       reads upright once the viewer has turned the page. */
    const rotOf=pg=>{ try{ return ((pg.getRotation().angle%360)+360)%360; }catch(e){ return 0; } };
    const dispOf=pg=>{ const {width:W,height:H}=pg.getSize(); const r=rotOf(pg);
      return (r===90||r===270)?{Wd:H,Hd:W,W:W,H:H,r}:{Wd:W,Hd:H,W:W,H:H,r}; };
    const toPdf=(pg,nx,ny)=>{ const {W,H,r}=dispOf(pg);
      if(r===90) return {x:ny*W,        y:nx*H};
      if(r===180)return {x:W*(1-nx),    y:ny*H};
      if(r===270)return {x:W*(1-ny),    y:H*(1-nx)};
      return       {x:nx*W,        y:H-ny*H}; };
    const spinOf=pg=>rotOf(pg);

    // ensure a page has an /Annots array we can push to
    const annotsOf=pg=>{ let a=pg.node.lookup(PDFName.of("Annots")); if(!a){ a=ctx.obj([]); pg.node.set(PDFName.of("Annots"),a); } return a; };
    /* =============================================================================================
       6fb — FLATTEN, AND THE SUBJECT LINE
       ---------------------------------------------------------------------------------------------
       A mark the selection bar has flattened does not become an annotation: its appearance stream is
       registered in the PAGE's own resources and drawn by the page's content, which is what a flatten
       is — part of the drawing from then on, not something another editor can pick up and move.

       The placement is the same arithmetic a viewer does for an annotation's appearance: take the
       form's BBox through its Matrix, then scale and shift that box onto the rectangle the annotation
       would have had. So a flattened mark lands exactly where the un-flattened one did, rotated pages
       included.

       Everything else keeps going out as an annotation, now with `/Subj` when the mark carries one —
       that is the column another editor lists its markups by.
       ============================================================================================= */
    let _flatN=0;
    function pageResources(pg){
      let res=null;
      try{ res=pg.node.Resources&&pg.node.Resources(); }catch(e){ res=null; }
      if(!res){ res=pg.node.lookup(PDFName.of("Resources")); }
      if(!res){ res=ctx.obj({}); pg.node.set(PDFName.of("Resources"),res); }
      return res;
    }
    function flattenInto(pg,apRef,rect,matrix,bw,bh){
      /* the form's box, through its own Matrix */
      const M=matrix||[1,0,0,1,0,0];
      const pts=[[0,0],[bw,0],[bw,bh],[0,bh]].map(([x,y])=>[
        M[0]*x+M[2]*y+M[4], M[1]*x+M[3]*y+M[5] ]);
      const xs=pts.map(q=>q[0]), ys=pts.map(q=>q[1]);
      const tx0=Math.min(...xs), tx1=Math.max(...xs);
      const ty0=Math.min(...ys), ty1=Math.max(...ys);
      const sx=(tx1-tx0)>0.001?((rect[2]-rect[0])/(tx1-tx0)):1;
      const sy=(ty1-ty0)>0.001?((rect[3]-rect[1])/(ty1-ty0)):1;
      const dx=rect[0]-tx0*sx, dy=rect[1]-ty0*sy;
      const name="MAF"+(_flatN++);
      const res=pageResources(pg);
      let xo=res.lookup?res.lookup(PDFName.of("XObject")):null;
      if(!xo){ xo=ctx.obj({}); res.set(PDFName.of("XObject"),xo); }
      xo.set(PDFName.of(name),apRef);
      /* the page's own content is wrapped so our state cannot leak into it, and ours goes after */
      const pre=ctx.register(ctx.stream("q\n"));
      const post=ctx.register(ctx.stream(
        `Q\nq ${sx.toFixed(5)} 0 0 ${sy.toFixed(5)} ${dx.toFixed(3)} ${dy.toFixed(3)} cm /${name} Do Q\n`));
      let cont=pg.node.get(PDFName.of("Contents"));
      if(cont&&cont.asArray){ cont.insert?cont.insert(0,pre):cont.push(pre); cont.push(post); }
      else if(cont){ pg.node.set(PDFName.of("Contents"),ctx.obj([pre,cont,post])); }
      else { pg.node.set(PDFName.of("Contents"),ctx.obj([pre,post])); }
    }
    /* One exit for every kind of mark: flatten it, or register it as the annotation it describes. */
    function emitMark(o,pg,apRef,rect,matrix,bw,bh,dict){
      /* 6lq — a PICTURE is never painted into the sheet, whatever its `flat` says. The flag can only
         be set on one by a document written before pictures were kept out of the flatten, and the
         point of the rule is the file somebody else opens: a photo has to arrive as an annotation
         they can move or delete. */
      if(o&&o.flat&&o.kind!=="img"){ flattenInto(pg,apRef,rect,matrix,bw,bh); return; }
      if(o&&o.subj)dict.Subj=PDFString.of(String(o.subj));
      annotsOf(pg).push(ctx.register(ctx.obj(dict)));
    }

    /* ==================================================================================================
       6nc — AND THE STREAM SAYS HOW IT IS TO BE COMPOSITED.
       Ced: "the colors rendered are sometimes different to the one showed in ui", with a 34% red fill
       that reads #fdb9bb on screen and #c5aeae in his render.

       Measured against poppler, every variant of ours comes out exact — a plain fill at 1.0, 0.6,
       0.34 and 0.15, dashed, rotated, hatched, multiply-blended, ink at half opacity, and a
       translucent PNG at four combinations of image and mark opacity: twelve cases, twelve exact
       matches. So the file we write is right by that renderer.

       But #c5aeae is not a random wrong colour. Solve for it: take the fill PREMULTIPLIED by its own
       opacity — 0.34 x (250,50,55) = (85,17,19) — and composite THAT over white at 0.34 again, and
       you get (197.2, 174.1, 174.8). Ced's render is (197,174,174). Three channels, within one unit.
       That is the signature of the alpha being applied twice, which is what a viewer does when it
       composites an appearance stream as a NON-ISOLATED group: the stream's own alpha is applied
       inside it and again as it is laid onto the page.

       A form XObject that paints with transparency is supposed to say so. Ours did not — no `/Group`
       — so a viewer was free to pick, and some pick the one that darkens. The group is declared now:
       isolated (`/I true`), so the stream composites against a transparent backdrop and then lands on
       the page once, which is the only reading that matches the screen. Poppler's answer does not
       change — the parity suites still pass to the pixel — and the viewers that were guessing stop.
       ================================================================================================== */
    const _apGroup=()=>ctx.obj({ S:PDFName.of("Transparency"), CS:PDFName.of("DeviceRGB"), I:true });
    // build an appearance-stream XObject (Form) so every viewer renders the annotation
    function appearance(w,h,drawOps,useFont,matrix,gs){
      const r={ Font: ctx.obj({ TR:(useFont||font).ref }) };
      if(gs)r.ExtGState=ctx.obj(gs);        /* 6f6 — opacity / blend states the ops refer to by name */
      const res=ctx.obj(r);
      const dict={ Type:"XObject", Subtype:"Form", FormType:1, BBox:[0,0,w,h], Resources:res,
                   Group:_apGroup() };      /* 6nc */
      if(matrix)dict.Matrix=matrix;
      const streamObj=ctx.stream(drawOps,dict);
      return ctx.register(streamObj);
    }

    // draw redlines + strikes in on-screen stacking order: under-redlines, then strikes, then over-redlines (each by z)
    /* The standard fonts are WinAnsi-encoded: pdf-lib throws on a newline or any character outside
       Latin-1, and it throws from widthOfTextAtSize too — so text is sanitised BEFORE it is measured.
       A newline is kept only as a hard line break; anything unencodable is dropped and logged once. */
    let _dropped=0;
    const sanitizePdfText=s=>{
      const raw=String(s==null?"":s).replace(/\r\n?/g,"\n");
      const out=raw
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g,"")   // control chars (newline kept)
        .replace(/[^\n\x20-\x7e\u00a0-\u00ff]/g,"");                 // outside WinAnsi's reach
      if(out.length!==raw.length)_dropped+=raw.length-out.length;
      return out;
    };
    /* break a value to fit a box: words first, then inside a word when the token itself is too long
       (these values are single tokens split by cell width). Never sees a newline — see below. */
    /* 6dy — the break opportunities the BROWSER uses, so the exported lines are the lines you saw:
       after a run of whitespace, and after a hyphen. Splitting on whitespace alone meant a hyphenated
       model — every antenna model on the form — broke mid-token here and at the hyphen on screen, so the
       same value could take a different number of lines in the file than on the page. */
    /* 6ea — and NOT after a slash, which 6dy added on the assumption that CSS breaks there. Measured:
       it does not. `COMMSCOPE/ANDREW/KATHREIN` in a 61.2pt box renders on TWO lines in Chrome — the
       whole string is one unbreakable word, so `overflow-wrap:anywhere` cuts it at the box edge — while
       treating the slashes as break opportunities gives `COMMSCOPE/` `ANDREW/` `KATHREIN`, three lines,
       which is what the exported file carried. One assumed break opportunity, one line of difference
       between the page and the file. */
    /* 6ea — the wrap is decided with the measurements THE SCREEN USED, not pdf-lib's.
       pdf-lib measures Times from the font's own metrics and the browser measures it from the
       platform's, and the two differ by a few per cent. That was tolerable while a mark filled its
       cell; now that a mark stops two spaces short of the cell, the slack is gone and the difference
       started showing: `COMMSCOPE/ANDREW/KATHREIN` in a 61.2pt box took two lines on screen and three
       in the exported file — the same value, laid out two ways, which is the one thing the export must
       never do. The canvas metric is the authority because it is what the mark's own width and line
       count were computed from; pdf-lib's is still what positions each line inside the box. */
    const measurePt=(t,size,pi,W,fk)=>{
      try{ const v=measureTextNorm(t,size,pi,fk); if(v>0||t==="")return v*W; }catch(e){}
      return font.widthOfTextAtSize(t,size);
    };
    /* 6eg — the export re-wraps with the SAME function the stamp chose the width with, in the same
       normalised units. It used to carry its own copy of the loop; two copies of a wrap rule is how the
       page and the file came to disagree about a trailing space and about the slash before that. The
       canvas metric is the authority here for the same reason it always was: it is what the mark's own
       width and line count were computed from. */
    const wrapToWidth=(text,size,maxW,pi,W,fk,words,lsp)=>
      redlineWrapLines(text,size,pi,maxW/W,fk,words,lsp);
    /* A mark's own colours, falling back to the ribbon's for anything made before marks had any. */
    const colOf=o=>{ const c=hexRgb((o&&o.col)||$("#c_text").value); return [c.r,c.g,c.b]; };
    const bgOf=o=>{ const c=hexRgb((o&&o.bg!=null)?o.bg:$("#c_bg").value); return [c.r,c.g,c.b]; };
    const fillOf=o=>{ const c=hexRgb((o&&o.fill)||"#ffffff"); return [c.r,c.g,c.b]; };
    const swOf=o=>{ const v=(o&&o.sw!=null)?o.sw:parseFloat(($("#c_sw")&&$("#c_sw").value)||1.5);
                    return (v>0?v:1.5); };
    /* An interior that is not fully opaque needs a graphics state of its own; the stroke stays solid,
       so `ca` (non-stroking alpha) is the only thing in it. */
    const alphaGs=op=>ctx.register(ctx.obj({Type:"ExtGState", ca:Math.max(0,Math.min(1,op)), CA:1}));

    const drawText=a=>{
      const pg=pages[a.page]; if(!pg)return;
      const {Wd:W,Hd:H}=dispOf(pg);      /* the frame the mark's own numbers are in */
      const col=colOf(a), bg=bgOf(a);
      const fk=markFontKey(a), fnt=fontOf(a);
      const size=a.size||8;
      /* 6he — the mark's own spacing. `Tc` is points of tracking after every glyph, so it widens each
         line by exactly `lsp * its length`; every width taken below adds that, or the centring and
         the box would be measured for text narrower than the one drawn. */
      const lsp=markLsp(a), lnsp=markLnsp(a);
      const twOf=t=>fnt.widthOfTextAtSize(t,size)+lsp*String(t).length;
      /* 6hg — AND THE LINE IS DRAWN AT THE WIDTH THE SCREEN DREW IT.
         Ced, with the tool beside the exported file: "please fix the texts. first is the preview on
         the tool, the next is the rendered on pdf." The words were the same and the box was the same,
         but in the file every line ran a few per cent wider — enough to touch the frame the mark sat
         in, and on the longest line to cross it.

         There is no bug to fix in either measurement: the screen lays the text out with the platform's
         Arial and the file is drawn with the viewer's Helvetica, and the two are metric-compatible
         only in name — a few per cent apart on a long line, which is exactly the slack a stamp does
         not have. 6ea already made the browser's number the authority for WHERE a value breaks; this
         makes it the authority for HOW WIDE the line comes out. `Tz` is the PDF's own horizontal
         scaling, so the line is squeezed or opened by the ratio between the two measurements and
         lands at the width that was on screen. It is clamped: a ratio outside a few per cent means
         something other than a metric difference (a face with no counterpart at all), and distorting
         the type to force it would be worse than the gap. */
      const twScreen=t=>{ try{ const v=measureTextNorm(t,size,a.page,fk,lsp);
                                if(v>0||t==="")return v*W; }catch(e){} return twOf(t); };
      const hzOf=t=>{ const p0=twOf(t), s0=twScreen(t);
        if(!(p0>0.01)||!(s0>0.01))return 100;
        return Math.max(92,Math.min(108,100*s0/p0)); };
      /* hard breaks first, then width-wrapping inside each one — so a wrapped line can never carry a
         newline into drawText, which is exactly what raised "WinAnsi cannot encode 0x000a". */
      const hard=sanitizePdfText(a.text).split("\n");
      let linesArr=hard;
      /* 6hh — a FREE BOX always wraps to its own width in the file, exactly as the screen wraps it
         inside the box: the flag is a cell redline's business, and a text box that was never marked
         as wrapped used to have its long line drawn straight out of the side of the box here while
         the screen had folded it. */
      if((a.wrap||wrapsWords(a))&&a.nw){
        /* 6ea — the box's own width, not a point less. The screen wraps inside exactly `a.nw`, so
           shaving a point off here made the export wrap a hair earlier than the screen did, which on a
           mark that now stops short of its cell is enough to cost a whole extra line. Anything that
           still will not fit grows `boxW` below rather than being clipped. */
        /* 6hi — inside the padding, which is what the screen wraps inside */
        /* 6kn — and a free box has no padding any more, so it wraps inside the whole of its width.
           This number and the two below (`padV`, `padH`) are the export's half of dropping the text
           inset; they move with the screen's `padding:0` or not at all. */
        const maxW=Math.max(4,a.nw*W);
        const ww=wrapsWords(a);
        linesArr=[]; hard.forEach(t=>{ wrapToWidth(t,size,maxW,a.page,W,fk,ww,lsp).forEach(x=>linesArr.push(x)); });
      }
      linesArr=linesArr.map(s=>s.replace(/\n/g,""));      // belt and braces
      const twMax=Math.max(...linesArr.map(t=>Math.max(twOf(t)*hzOf(t)/100,twScreen(t))),1);
      const boxW=a.nw? Math.max(a.nw*W, twMax) : twMax+4;   // cell redlines keep their measured coverage width
      /* 6dy — the box is sized for the lines THIS renderer produced. pdf-lib measures Times with the
         font's own metrics and the browser measures it with the platform's, so even with the same break
         rule the export can land a value on one more line than the screen recorded — and that extra
         line used to be drawn below the bottom of a box sized for the smaller count, i.e. straight onto
         the page underneath the mark, with the printed value showing through beside it. */
      const nL=Math.max(1,linesArr.length);
      /* A mark can be several lines tall WITHOUT wrapping: the stamp's contractor / TA / date and a
         callout's four lines are hard breaks, not a value folded to a column width. The line pitch is
         the mark's own whenever it has more than one line, however those lines came about. */
      /* 6f2 — a free box pitches off the font, matching what the screen now draws. */
      /* 6ht — the PITCH of a free box is the font's own, whether it breaks on words or fills each
         line: a box you drew is not a ruled column and its height is not a line count. Only the
         BREAKING follows `wrapsWords`. */
      const lineH0=isFreeBox(a) ? size*1.22
        : (a.nh&&(a.wrap||nL>1))
        ? (a.lineNh!=null?(a.lineNh*H):((a.nh*H)/Math.max(1,a.lines||nL)))
        : size*1.15;
      /* 6he — a line box stretched by leading grows AROUND its glyphs, half above and half below,
         which is what CSS does with `line-height` and therefore what the screen shows. A cell
         redline's pitch is the printed line's, not the face's, so leading leaves it alone. */
      const lineH=lineH0*((a.nh&&(a.wrap||nL>1)&&!isFreeBox(a))?1:lnsp);
      const boxH=a.nh? Math.max(a.nh*H, (a.wrap&&!isFreeBox(a))?lineH*nL:0) : Math.max(lineH*nL, size*1.2)+2;
      let topAdj=0;
      if(a.onCell&&a.nh){
        /* 6ea — the same correction as on screen; see layoutAnnos. */
        const lineBox=((a.lines||1)>1)?((a.nh*H)/a.lines):(a.nh*H);
        const glyph=((a.lineNh!=null?a.lineNh:a.nh)*H);
        topAdj=(lineBox-glyph)/2;                     // matches the on-screen lift
      }
      /* 6ea — the same exemption as on screen; see layoutAnnos. */
      if(a.onCell&&(a.wrap||(a.lines||1)<=1)) topAdj-=REDLINE_DROP*H;   // 2. matches the on-screen drop
      /* the mark's centre, still on screen — the placement below works from the centre because that
         is the one point a rotation leaves alone */
      const cnx=(a.nx*W+boxW/2)/W, cny=(a.ny*H-topAdj+boxH/2)/H;
      /* A mark with no ground paints none: the drawing underneath reads through it. A mark with one
         paints it first, which is what hides the printed value a correction replaces. */
      /* 6f6 — the ground can be part-transparent, and the ink has its own opacity too; both need a
         graphics state of their own, which is gathered into `gsT` and named in the resources below. */
      const gsT={}, tOp=markColOp(a), gOp=(a.fillOp!=null?a.fillOp:1);
      if(gOp<1)gsT.GSg=alphaGs(gOp);
      if(tOp<1)gsT.GSc=ctx.register(ctx.obj({Type:"ExtGState", ca:tOp, CA:tOp}));
      if(a.hl)gsT.GSh=ctx.register(ctx.obj({Type:"ExtGState", BM:PDFName.of("Multiply")}));
      let ops=a.bgNone?"":`q ${a.hl?"/GSh gs ":""}${gOp<1?"/GSg gs ":""}${bg[0]} ${bg[1]} ${bg[2]} rg 0 0 ${boxW} ${boxH} re f Q\n`;
      /* A box mark is a ruled frame: the fill above is its ground, this is its rule. Drawn inset by
         half the stroke so the whole line lands inside the annotation's own rectangle — a stroke
         centred on the edge would be clipped in half by the appearance stream's bounding box. */
      if(a.box)ops+=`q ${col[0]} ${col[1]} ${col[2]} RG 1 w 0.5 0.5 ${(boxW-1).toFixed(2)} ${(boxH-1).toFixed(2)} re S Q\n`;
      ops+=`q ${a.hl?"/GSh gs ":""}${tOp<1?"/GSc gs ":""}BT /TR ${size} Tf ${col[0]} ${col[1]} ${col[2]} rg\n`;
      if(lsp)ops+=`${lsp.toFixed(3)} Tc\n`;
      /* 6hi — WHERE THE BLOCK SITS IN THE BOX, and it is the screen that decides.
         Ced: "the rendered one is still lower than the text on ui. make sure that they are the
         same." A FREE BOX — a text box you drew — fills from the TOP on screen, because that is what
         typing into a box does; the file centred any single-line one vertically instead, so a heading
         in a box taller than its line came out sitting in the middle of it, lower than the screen had
         it, by half the slack. A CELL REDLINE still centres: its box is the printed line it covers and
         the glyphs belong on that line. `vAlignFrac` is the same rule the grid on screen is given, so
         the two cannot part, and the inset is the 1pt/2pt padding the box is drawn with. */
      const freeV=isFreeBox(a);
      const blockH=lineH*nL, padV=freeV?0:1;   /* 6kn */
      const top=freeV
        ? (padV+(Math.max(0,boxH-blockH-padV*2))*vAlignFrac(a,freeVAlignDflt(a)))   /* 6l3 */
        : 2;
      const decoT=[];
      let hzNow=100;
      linesArr.forEach((ln,li)=>{
        const hz=hzOf(ln);
        if(Math.abs(hz-hzNow)>0.05){ ops+=`${hz.toFixed(2)} Tz\n`; hzNow=hz; }
        const tw=twOf(ln)*hz/100;
        const padH=freeV?0:1;   /* 6kn */
        let tx=padH;
        if(a.align==="center"){ tx=(boxW-tw)/2;
          if(a.textDx)tx=Math.max(0,Math.min(boxW-tw,tx+a.textDx*W)); }
        else if(a.align==="right")tx=boxW-tw-padH;
        else if(a.onCell)tx=REDLINE_LEFT_INSET;        // 1. start exactly on the printed glyph
        /* centre the glyphs in the line box: PDF text sits on its baseline, so drop by the cap height */
        /* one line in a cell centres on the printed line; anything with real lines is stacked from the
           top of the box. Without the line count in this test every hard-broken mark drew all of its
           lines on top of each other — the stamp came out as three lines of type in one place. */
        /* (see the block placement computed just above the loop) */
        /* 6hi — WHERE THE BLOCK SITS IN THE BOX, and it is the screen that decides.
           Ced: "the rendered one is still lower than the text on ui. make sure that they are the
           same." A FREE BOX — a text box you drew — fills from the TOP on screen, because that is
           what typing into a box does; the file centred any single-line one vertically instead, so a
           heading in a box taller than its line came out sitting in the middle of it, lower than the
           screen had it, by half the slack. A CELL REDLINE still centres: its box is the printed
           line it covers and the glyphs belong on that line.
           `vAlignFrac` is the same rule the grid on screen is given, so the two cannot part. */
        const ty=(!freeV&&a.nh&&!a.wrap&&nL<=1)
          ? (boxH-size*0.78)/2
          : boxH-top-(li+1)*lineH+cssBaseline(size,fk,lineH);
        ops+=`1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm (${pdfEsc(ln)}) Tj\n`;
        if(a.uline)decoT.push([tx,ty-size*0.14,tx+tw]);
        if(a.strikeout)decoT.push([tx,ty+size*0.28,tx+tw]);
      });
      if(hzNow!==100)ops+="100 Tz\n";
      ops+=`ET Q\n`;
      if(decoT.length){
        ops+=`q ${tOp<1?"/GSc gs ":""}${col[0]} ${col[1]} ${col[2]} RG ${Math.max(0.4,size*0.06).toFixed(2)} w\n`;
        decoT.forEach(d=>{ ops+=`${d[0].toFixed(2)} ${d[1].toFixed(2)} m ${d[2].toFixed(2)} ${d[1].toFixed(2)} l S\n`; });
        ops+="Q\n";
      }
      /* the page's own turn, plus whatever turn the mark was given by hand */
      const phi=(spinOf(pg)-(a.rot||0))%360;
      const th=phi*Math.PI/180, cth=Math.cos(th), sth=Math.sin(th);
      const ctr=toPdf(pg,cnx,cny);
      const rw=Math.abs(boxW*cth)+Math.abs(boxH*sth), rh=Math.abs(boxW*sth)+Math.abs(boxH*cth);
      const rect=[ctr.x-rw/2, ctr.y-rh/2, ctr.x+rw/2, ctr.y+rh/2];
      const matrix=phi?[cth,sth,-sth,cth,0,0]:null;
      const ap=appearance(boxW,boxH,ops,fnt,matrix,Object.keys(gsT).length?gsT:null);
      const da=`${col[0]} ${col[1]} ${col[2]} rg /TR ${size} Tf`;
      /* Stamp our own fingerprint on the annotation. The subject payload can be stripped by another
         editor or a re-save; these keys travel with the annotation itself, so a file that has been through
         other hands can still be reopened here with its redlines editable. */
      /* 6ff — ONE WHITELIST, NOT TWO. This was a hand-written list of 29 fields sitting beside
         `_cleanA`'s 35, and the eight it had quietly fallen behind on were `orig`, `under`, `z`, `cx0`,
         `cy0`, `fromAnalyze`, `cellL` and `cellR`. That did not matter much until 6fe made the
         ANNOTATIONS authoritative over the Subject payload — at which point this list became the whole
         persistence contract, and a reopen started losing those eight on BOTH paths, not just on a
         stripped file. 6fe narrowed what survives and I did not notice; `kinds.py` did.

         `_cleanA` is the whitelist the handover has always pointed at ("if you add a field that affects
         placement, add it there"). Deriving the tag from it means there is now one place to add a field
         and no way for the two to drift again. */
      const tag=Object.assign({}, _cleanA(a), {
        /* the three the tag needs and `_cleanA` does not keep — they describe the COLUMN a mark was
           measured against, which only the export has to reproduce */
        lenRule:a.lenRule, _colNx:a._colNx, _colNw:a._colNw,
        text:String(a.text)});
      const _dict={
        Type:"Annot", Subtype:"FreeText", Rect:rect,
        Contents:PDFString.of(String(a.text)), DA:PDFString.of(da), Q:(a.align==="center"?1:a.align==="right"?2:0),
        F:4, T:PDFString.of(author), CA:1, Border:[0,0,0],
        MARL:PDFString.of("1"), MAData:PDFString.of(_tagEnc(tag)),
        AP: ctx.obj({ N: ap })
      };
      emitMark(a,pg,ap,rect,matrix,boxW,boxH,_dict);
    };
    /* A STROKE — a strike, a free line, an arrow or a many-cornered leader — written as the PDF
       annotation that matches its shape: `/Line` for two bare points, `/PolyLine` for anything with a
       corner or a head. Every point is mapped into page space individually, so a stroke drawn across a
       landscape sheet lands along the same members it was drawn along. */
    const drawStroke=l=>{
      const pg=pages[l.page]; if(!pg)return;
      const col=colOf(l), sw=swOf(l);
      const P=linePts(l).map(p=>{ const q=toPdf(pg,p[0],p[1]); return [q.x,q.y]; });
      if(P.length<2)return;
      const head=headSizeOf(l,sw);           /* 6gf/6gj — the same size the screen drew */
      /* 6f6 — a rippled stroke swings out to either side of the path it was drawn along, so the
         appearance box has to be wide enough for the ripple as well as for the endings. */
      /* 6if — the same overshoot a rippled rule takes, measured rather than guessed at */
      const _amp=Math.max(1.6,sw*1.7);
      const pad=Math.max(2,sw+head*0.6,(linePatOf(l)!=="straight")?(_amp*1.35+sw/2+0.5):0);
      const xs=P.map(p=>p[0]), ys=P.map(p=>p[1]);
      const minx=Math.min(...xs), maxx=Math.max(...xs);
      const miny=Math.min(...ys), maxy=Math.max(...ys);
      const bw=Math.max(maxx-minx,1)+pad*2, bh=Math.max(maxy-miny,1)+pad*2;
      const L0=P.map(p=>[(p[0]-minx)+pad,(p[1]-miny)+pad]);         // inside the appearance box
      const L=decoratePts(l,L0,sw);                                 /* 6f6 — wave / zigzag / cloud */
      /* 6f6 — the ink's own opacity and highlight mode, as one graphics state for the whole stroke,
         endings included, so a 50% arrow does not come out solid at the head. */
      const lop=markColOp(l);
      const gsL=(lop<1||l.hl)?ctx.register(ctx.obj(Object.assign(
            {Type:"ExtGState", ca:lop, CA:lop}, l.hl?{BM:PDFName.of("Multiply")}:{} ))):null;
      const [pe0,pe1]=endsOf(l);
      let ops="q\n";
      if(gsL)ops+="/GSL gs\n";
      /* 6jw — the corner and the end the mark was drawn with, not a hard-coded round one */
      ops+=`q ${col[0]} ${col[1]} ${col[2]} RG ${sw} w ${capPdf(l)} J ${joinPdf(l)} j 8 M\n`;
      const dsh=dashPdf(l,sw);
      /* a dotted rule needs the round cap to have anything to draw; everything else takes butt, so a
         dash is exactly as long as it says it is */
      if(dsh)ops+=`[${dsh.join(" ")}] 0 d ${dashRound(l.dash||"solid")?1:0} J\n`;
      /* 6g1 — a closed run is a shape: filled, hatched if it carries one, then ruled */
      if(l.closed){
        const fc=hexRgb(l.fill||"#ffffff"), fop=(l.fillOp!=null?l.fillOp:1);
        const pathOps=()=>{ let o=`${L[0][0].toFixed(2)} ${L[0][1].toFixed(2)} m\n`;
          for(let k=1;k<L.length;k++)o+=`${L[k][0].toFixed(2)} ${L[k][1].toFixed(2)} l\n`;
          return o+"h\n"; };
        if(fop>0)ops+="q "+(fop<1?"/GSf gs ":"")+`${fc.r} ${fc.g} ${fc.b} rg\n`+pathOps()+"f Q\n";
        const segs=patSegments(l,Math.max(1,maxx-minx),Math.max(1,maxy-miny));
        if(segs.length){
          const pc=hexRgb(patColOf(l));
          ops+="q\n"+(patOpOf(l)<1?"/GSp gs\n":"")+pathOps()+"W n\n";
          ops+=`${pc.r} ${pc.g} ${pc.b} RG `+
               `${Math.max(patIsDot(l)?0.8:0.4,sw*(patIsDot(l)?0.8:0.5)).toFixed(2)} w `+
               `${patIsDot(l)?1:0} J\n`;
          segs.forEach(sg=>{ ops+=`${(pad+sg[0]).toFixed(2)} ${(pad+sg[1]).toFixed(2)} m `+
                                  `${(pad+sg[2]).toFixed(2)} ${(pad+sg[3]).toFixed(2)} l S\n`; });
          ops+="Q\n";
        }
        ops+=pathOps()+"S Q\n";
      }else{
      /* 6fg — the same trim the screen applies, so the exported head is as pointed as the drawn one */
      const LT=trimEnds(L,pe0,pe1,head);
      ops+=`${LT[0][0].toFixed(2)} ${LT[0][1].toFixed(2)} m\n`;
      for(let k=1;k<LT.length;k++)ops+=`${LT[k][0].toFixed(2)} ${LT[k][1].toFixed(2)} l\n`;
      ops+="S Q\n";
      }
      /* the endings — the same shapes, angles and sizes the screen drew, from the same generator */
      const putEnd=(kind,fromP,toP)=>{
        const sp=endShapePath(kind,fromP[0],fromP[1],toP[0],toP[1],head); if(!sp)return "";
        /* the same path, re-spelled in PDF operators: M→m, L→l, C→c, Z→h */
        const bits=sp.d.trim().split(/\s+/);
        let out="", i=0;
        while(i<bits.length){
          const t=bits[i];
          if(t==="M"){ out+=`${bits[i+1]} ${bits[i+2]} m `; i+=3; }
          else if(t==="L"){ out+=`${bits[i+1]} ${bits[i+2]} l `; i+=3; }
          else if(t==="C"){ out+=`${bits.slice(i+1,i+7).join(" ")} c `; i+=7; }
          else if(t==="Z"){ out+="h "; i+=1; }
          else i+=1;
        }
        return sp.fill
          ? `q ${col[0]} ${col[1]} ${col[2]} rg ${out}f Q\n`
          : `q ${col[0]} ${col[1]} ${col[2]} RG ${sw} w 1 J 1 j ${out}S Q\n`;
      };
      ops+=putEnd(pe1,L[L.length-2],L[L.length-1]);
      ops+=putEnd(pe0,L[1],L[0]);
      ops+="Q\n";
      const gsMap=gsL?{GSL:gsL}:null;
      if(l.closed){
        const fop=(l.fillOp!=null?l.fillOp:1);
        if(fop<1||patOpOf(l)<1){
          const m=gsMap||{};
          if(fop<1)m.GSf=ctx.register(ctx.obj({Type:"ExtGState", ca:fop, CA:1}));
          if(patOpOf(l)<1)m.GSp=ctx.register(ctx.obj({Type:"ExtGState", ca:patOpOf(l), CA:patOpOf(l)}));
          var _gs2=m;
        }
      }
      const ap=appearance(bw,bh,ops,false,null,(typeof _gs2!=="undefined"&&_gs2)||gsMap);
      const ltag=Object.assign({}, _cleanL(l), {kind:"line"});
      const rect=[minx-pad,miny-pad,maxx+pad,maxy+pad];
      const simple=(P.length===2&&!pe0&&!pe1);
      const dict={
        Type:"Annot", Rect:rect,
        C:[col[0],col[1],col[2]],
        F:4, T:PDFString.of(author), Border:[0,0,sw], CA:1,
        MARL:PDFString.of("1"), MALine:PDFString.of(_tagEnc(ltag)),
        AP: ctx.obj({ N: ap })
      };
      if(simple){ dict.Subtype="Line"; dict.L=[P[0][0],P[0][1],P[1][0],P[1][1]];
                  dict.IC=[col[0],col[1],col[2]]; }
      else{
        dict.Subtype="PolyLine";
        dict.Vertices=P.reduce((acc,p)=>acc.concat([p[0],p[1]]),[]);
        /* 6f6 — the ending names a reader that ignores our appearance stream would draw. Ours is
           authoritative; this is the courtesy copy. */
        const LE_NAME={arrow:"ClosedArrow", oarrow:"OpenArrow", rarrow:"RClosedArrow",
                       roarrow:"ROpenArrow", harrow:"OpenArrow", hrarrow:"ROpenArrow",
                       circle:"Circle", ocircle:"Circle", square:"Square", diamond:"Diamond",
                       slash:"Slash", butt:"Butt"};
        dict.LE=[PDFName.of(LE_NAME[pe0]||"None"), PDFName.of(LE_NAME[pe1]||"None")];
      }
      emitMark(l,pg,ap,rect,null,bw,bh,dict);
    };

    /* A SHAPE — a box, an ellipse, or either of them carrying the text of a callout. The interior is
       drawn at its own opacity, the rule at full strength, and any text centred inside. */
    const drawShape=a=>{
      const pg=pages[a.page]; if(!pg)return;
      const {Wd:W,Hd:H}=dispOf(pg);
      const col=colOf(a), fill=fillOf(a), sw=swOf(a);
      const op=(a.fillOp!=null?a.fillOp:0);
      const bw=Math.max(2,(a.nw||0.1)*W), bh=Math.max(2,(a.nh||0.05)*H);
      const inset=sw/2;
      const x0=inset, y0=inset, x1=bw-inset, y1=bh-inset;
      /* 6f6 — the path is written once and reused: the outline strokes it, the hatch clips to it. */
      const outline=()=>{
        /* 6hp — a patterned rule: the same points the screen walks, written as a polygon */
        if(shapePat(a)){
          const run=shapeOutlineRun(a,bw,bh,inset,sw);
          let d=`${run[0][0].toFixed(2)} ${(bh-run[0][1]).toFixed(2)} m\n`;
          for(let i=1;i<run.length;i++)
            d+=`${run[i][0].toFixed(2)} ${(bh-run[i][1]).toFixed(2)} l\n`;
          return d+"h\n";
        }
        if(shapeOf(a)==="ellipse"){
          const k=0.5522847498, cx=(x0+x1)/2, cy=(y0+y1)/2, rx=(x1-x0)/2, ry=(y1-y0)/2;
          return `${cx+rx} ${cy} m `+
                 `${cx+rx} ${cy+ry*k} ${cx+rx*k} ${cy+ry} ${cx} ${cy+ry} c `+
                 `${cx-rx*k} ${cy+ry} ${cx-rx} ${cy+ry*k} ${cx-rx} ${cy} c `+
                 `${cx-rx} ${cy-ry*k} ${cx-rx*k} ${cy-ry} ${cx} ${cy-ry} c `+
                 `${cx+rx*k} ${cy-ry} ${cx+rx} ${cy-ry*k} ${cx+rx} ${cy} c\n`;
        }
        return `${x0} ${y0} ${(x1-x0).toFixed(2)} ${(y1-y0).toFixed(2)} re\n`;
      };
      let ops="q\n";
      if(a.hl)ops+="/GSh gs\n";                       /* highlight: the drawing reads through the mark */
      if(op>0)ops+=`/GSa gs `;
      ops+=`${fill[0]} ${fill[1]} ${fill[2]} rg ${col[0]} ${col[1]} ${col[2]} RG ${sw} w\n`;
      /* 6hp — the INTERIOR follows the rule's own shape, so a cloud is filled as a cloud */
      if(shapePat(a)) ops+=outline();
      else if(shapeOf(a)==="ellipse"){
        /* four Béziers: the constant is the usual circle approximation, 4/3·(√2−1) */
        const k=0.5522847498, cx=(x0+x1)/2, cy=(y0+y1)/2, rx=(x1-x0)/2, ry=(y1-y0)/2;
        ops+=`${cx+rx} ${cy} m `+
             `${cx+rx} ${cy+ry*k} ${cx+rx*k} ${cy+ry} ${cx} ${cy+ry} c `+
             `${cx-rx*k} ${cy+ry} ${cx-rx} ${cy+ry*k} ${cx-rx} ${cy} c `+
             `${cx-rx} ${cy-ry*k} ${cx-rx*k} ${cy-ry} ${cx} ${cy-ry} c `+
             `${cx+rx*k} ${cy-ry} ${cx+rx} ${cy-ry*k} ${cx+rx} ${cy} c\n`;
      }else{
        ops+=`${x0} ${y0} ${(x1-x0).toFixed(2)} ${(y1-y0).toFixed(2)} re\n`;
      }
      /* 6f6 — fill first, then the rule in its own state, so the rule can carry its own opacity and
         line style without those leaking into the interior. */
      ops+=(op>0?"f\n":"n\n")+"Q\n";     /* `n` ends the path without painting it */
      const segs=patSegments(a,bw,bh);
      if(segs.length){
        /* the hatch, clipped to the shape it fills */
        const pc=hexRgb(patColOf(a));
        ops+="q\n"+(patOpOf(a)<1?"/GSp gs\n":"")+outline()+"W n\n";
        ops+=`${(pc.r).toFixed(3)} ${(pc.g).toFixed(3)} ${(pc.b).toFixed(3)} RG `+
             `${Math.max(patIsDot(a)?0.8:0.4,sw*(patIsDot(a)?0.8:0.5)).toFixed(2)} w `+
             `${patIsDot(a)?1:0} J\n`;
        segs.forEach(s=>{ ops+=`${s[0].toFixed(2)} ${s[1].toFixed(2)} m ${s[2].toFixed(2)} ${s[3].toFixed(2)} l S\n`; });
        ops+="Q\n";
      }
      {
        const cop=markColOp(a);
        ops+="q\n"+(a.hl?"/GSh gs\n":"")+(cop<1?"/GSc gs\n":"");
        const dsh=dashPdf(a,sw);
        ops+=`${col[0]} ${col[1]} ${col[2]} RG ${sw} w ${capPdf(a)} J ${joinPdf(a)} j 8 M `+
             (dsh?`[${dsh.join(" ")}] 0 d ${dashRound(a.dash||"solid")?1:0} J `:"")+"\n";
        ops+=outline()+"S\nQ\n";
      }
      /* the text, centred in the box, at full opacity whatever the interior is doing */
      const fnt=fontOf(a);
      /* the text inside a shape wraps to the shape, the way it does on screen — a callout is written
         to fit its box, not to run out of the side of it */
      const size=a.size||8;
      /* 6he — the same two spacings the screen draws this box with */
      const clsp=markLsp(a), lineH=size*1.22*markLnsp(a);
      const cwOf=t=>fnt.widthOfTextAtSize(t,size)+clsp*String(t).length;
      /* 6hg — and the same width authority inside a box: see drawText */
      const cwScreen=t=>{ try{ const v=measureTextNorm(t,size,a.page,markFontKey(a),clsp);
                               if(v>0||t==="")return v*W; }catch(e){} return cwOf(t); };
      const chzOf=t=>{ const p0=cwOf(t), s0=cwScreen(t);
        if(!(p0>0.01)||!(s0>0.01))return 100;
        return Math.max(92,Math.min(108,100*s0/p0)); };
      /* 6kd — the same inset the screen uses, so the wrap happens in the same place in both.
         A CELL REDLINE is not covered by this and must not be: its width is derived from the printed
         column it covers, and the screen gives it its own inset chain (`REDLINE_LEFT_INSET` and the
         rest) that the figures below were tuned against. Measured when this first went in
         unconditionally: text parity went from 0 of 10 to 5 of 10. Free boxes only. */
      /* Only a PURE TEXT BOX loses its inset. A callout, a reading, a cell redline and every other
         mark keep the figures the export has always used and that both parity suites are tuned
         against — measured when this was applied to all of them, text parity went from 0 of 10 to
         5 of 10, every failure horizontal. */
      const _ti={x:sw+2,y:sw+2};
      const inner=Math.max(8,bw-sw*2-8);
      const body=[];
      sanitizePdfText(a.text||"").split("\n").filter(t=>t.length).forEach(t=>{
        if(cwOf(t)<=inner){ body.push(t); return; }
        redlineWrapLines(t,size,a.page,inner/W,markFontKey(a),true,clsp).forEach(x=>body.push(x));
      });
      if(body.length){
        const blockH=lineH*body.length;
        /* 6f6 — where the block of text sits in the box: middle by default, which is what a callout
           wants, top or bottom when the panel says so. */
        const pad=_ti.y;
        const cBase=cssBaseline(size,markFontKey(a),lineH);
        let ty=(bh+blockH)/2-lineH+cBase;
        if(a.valign==="top")    ty=bh-pad-lineH+cBase;
        if(a.valign==="bottom") ty=pad+blockH-lineH+cBase;
        const deco=[];
        ops+=`q BT /TR ${size} Tf ${col[0]} ${col[1]} ${col[2]} rg\n`;
        if(clsp)ops+=`${clsp.toFixed(3)} Tc\n`;
        let chzNow=100;
        body.forEach(t=>{
          const chz=chzOf(t);
          if(Math.abs(chz-chzNow)>0.05){ ops+=`${chz.toFixed(2)} Tz\n`; chzNow=chz; }
          const tw=cwOf(t)*chz/100;
          const tx=(a.align==="left")?_ti.x:((a.align==="right")?(bw-tw-_ti.x):((bw-tw)/2));
          /* (`_ti.x` is `sw+2` for a cell redline, which is what it always was) */
          ops+=`1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm (${pdfEsc(t)}) Tj\n`;
          if(a.uline)deco.push([tx,ty-size*0.14,tx+tw]);
          if(a.strikeout)deco.push([tx,ty+size*0.28,tx+tw]);
          ty-=lineH;
        });
        if(chzNow!==100)ops+="100 Tz\n";
        ops+="ET Q\n";
        if(deco.length){
          ops+=`q ${col[0]} ${col[1]} ${col[2]} RG ${Math.max(0.4,size*0.06).toFixed(2)} w\n`;
          deco.forEach(d=>{ ops+=`${d[0].toFixed(2)} ${d[1].toFixed(2)} m ${d[2].toFixed(2)} ${d[1].toFixed(2)} l S\n`; });
          ops+="Q\n";
        }
      }
      const res={ Font: ctx.obj({ TR: fnt.ref }) };
      const gsS={};
      if(op>0)gsS.GSa=alphaGs(op);
      if(markColOp(a)<1)gsS.GSc=ctx.register(ctx.obj({Type:"ExtGState", CA:markColOp(a), ca:markColOp(a)}));
      if(patOpOf(a)<1)gsS.GSp=ctx.register(ctx.obj({Type:"ExtGState", CA:patOpOf(a), ca:patOpOf(a)}));
      if(a.hl)gsS.GSh=ctx.register(ctx.obj({Type:"ExtGState", BM:PDFName.of("Multiply")}));
      if(Object.keys(gsS).length)res.ExtGState=ctx.obj(gsS);
      const phi=(spinOf(pg)-(a.rot||0))%360;
      const th=phi*Math.PI/180, cth=Math.cos(th), sth=Math.sin(th);
      /* 6if — AND THE BOX HAS TO BE BIG ENOUGH FOR WHAT IS DRAWN IN IT.
         Ced: "other shapes look weird when rendered." A cloud, and every other rippled rule, bulges
         OUTSIDE the mark's own rectangle — that is what a scallop is — and on screen it shows, because
         the outline SVG is `overflow:visible`. In the file the rule lives in an appearance stream whose
         BBox is exactly the mark's box, and a viewer clips an appearance stream to its BBox: every bump
         was cut off at the edge, leaving the little inward wedges where two arcs met. The stream is
         given room for the overshoot and moved into the middle of it, and the annotation's own Rect
         grows by the same amount, so what was drawn is what comes out. */
      const ovr=shapePat(a)?(Math.max(1.6,sw*1.7)*1.35+sw/2+0.5):0;
      if(ovr>0)ops=`q 1 0 0 1 ${ovr.toFixed(2)} ${ovr.toFixed(2)} cm\n`+ops+"\nQ\n";
      const BW=bw+ovr*2, BH=bh+ovr*2;
      const dict={ Type:"XObject", Subtype:"Form", FormType:1, BBox:[0,0,BW,BH],
                   Resources:ctx.obj(res), Group:_apGroup() };      /* 6nc */
      if(phi)dict.Matrix=[cth,sth,-sth,cth,0,0];
      const ap=ctx.register(ctx.stream(ops,dict));
      const ctr=toPdf(pg,(a.nx*W+bw/2)/W,(a.ny*H+bh/2)/H);
      const rw=Math.abs(BW*cth)+Math.abs(BH*sth), rh=Math.abs(BW*sth)+Math.abs(BH*cth);
      const rect=[ctr.x-rw/2, ctr.y-rh/2, ctr.x+rw/2, ctr.y+rh/2];
      const tag=Object.assign({}, _cleanA(a), {text:String(a.text||"")});
      const _dict={
        Type:"Annot", Subtype:(shapeOf(a)==="ellipse"?"Circle":"Square"), Rect:rect,
        Contents:PDFString.of(String(a.text||"")),
        C:[col[0],col[1],col[2]], IC:[fill[0],fill[1],fill[2]], CA:1,
        F:4, T:PDFString.of(author), Border:[0,0,sw],
        MARL:PDFString.of("1"), MAData:PDFString.of(_tagEnc(tag)),
        AP: ctx.obj({ N: ap })
      };
      emitMark(a,pg,ap,rect,(phi?[cth,sth,-sth,cth,0,0]:null),BW,BH,_dict);
    };

    /* photos and markups: each image is embedded once, then drawn as a Stamp annotation whose
       appearance stream paints it. The embed has to happen before the drawing pass because it is
       asynchronous and the pass is not. */
    const imgCache=new Map();
    const dataUrlBytes=u=>{ const b64=String(u||"").split(",")[1]||""; const bin=atob(b64);
      const arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k); return arr; };
    for(const a of S.annos.filter(x=>x.kind==="img"&&x.src)){
      try{
        const bytes=dataUrlBytes(a.src);
        const head=a.src.slice(0,40).toLowerCase();
        imgCache.set(a.id, head.indexOf("image/png")>=0 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
      }catch(e){ LOG("image embed failed for",a.id,e&&e.message); }
    }
    const drawImg=a=>{
      const emb=imgCache.get(a.id); const pg=pages[a.page]; if(!emb||!pg)return;
      const {Wd:W,Hd:H}=dispOf(pg);
      const bw=(a.nw||0.2)*W, bh=(a.nh||0.15)*H;
      /* 6gd — the picture at its own opacity, and a frame round it when it carries one */
      const iop=(a.fillOp!=null?a.fillOp:1);
      const fsw=(a.sw!=null?a.sw:0);
      const _fop=markColOp(a);
      const _gsi={};
      if(iop<1)_gsi.GSf=ctx.register(ctx.obj({Type:"ExtGState", ca:iop, CA:iop}));
      if(fsw>0&&_fop<1)_gsi.GSc=ctx.register(ctx.obj({Type:"ExtGState", ca:_fop, CA:_fop}));
      const _resD={ XObject: ctx.obj({ Im0: emb.ref }) };
      if(Object.keys(_gsi).length)_resD.ExtGState=ctx.obj(_gsi);
      const res=ctx.obj(_resD);
      /* 6i6 — a flip is a negative scale about the picture's own middle, which the `cm` carries */
      const fx=a.flipX?-1:1, fy=a.flipY?-1:1;
      const tx=a.flipX?bw:0, ty=a.flipY?bh:0;
      let ops=`q ${(iop<1?"/GSf gs ":"")}${(bw*fx).toFixed(2)} 0 0 ${(bh*fy).toFixed(2)} `+
              `${tx.toFixed(2)} ${ty.toFixed(2)} cm /Im0 Do Q`;
      /* 6jb — a baked frame is already in the picture's own pixels, and hugs whatever shape is left of
         it; drawing this rectangle as well would put a box round the outline. */
      if(fsw>0&&!maPicFramed(a)){
        const fc=hexRgb(markCol(a)), fop=markColOp(a);
        const dsh=dashPdf(a,fsw);
        ops+=`\nq ${(fop<1?"/GSc gs ":"")}${fc.r} ${fc.g} ${fc.b} RG ${fsw} w `+
             (dsh?`[${dsh.join(" ")}] 0 d ${dashRound(a.dash||"solid")?1:0} J `:"")+
             `${(fsw/2).toFixed(2)} ${(fsw/2).toFixed(2)} ${(bw-fsw).toFixed(2)} ${(bh-fsw).toFixed(2)} re S Q`;
      }
      const dict={ Type:"XObject", Subtype:"Form", FormType:1, BBox:[0,0,bw,bh], Resources:res };
      const phi=(spinOf(pg)-(a.rot||0))%360;
      const th=phi*Math.PI/180, cth=Math.cos(th), sth=Math.sin(th);
      if(phi)dict.Matrix=[cth,sth,-sth,cth,0,0];
      const ctr=toPdf(pg,(a.nx*W+bw/2)/W,(a.ny*H+bh/2)/H);
      const rw=Math.abs(bw*cth)+Math.abs(bh*sth), rh=Math.abs(bw*sth)+Math.abs(bh*cth);
      const rect=[ctr.x-rw/2, ctr.y-rh/2, ctr.x+rw/2, ctr.y+rh/2];
      const ap=ctx.register(ctx.stream(ops,dict));
      /* the tag carries everything BUT the picture: the bytes are already in this annotation's own
         appearance stream, and a second copy in the tag would add a third of every image to the file.
         `recoverPhotoSrcs` reads the picture back out of that stream on a reopen. */
      /* 6le — the same one rule, not a second hand-written `delete`. This is where `srcOrig` was
         riding: a photo the picture editor had touched put a whole second copy of itself in its own
         tag, and the tag then could not be read back at all. */
      const itag=_stripPicBytes(Object.assign({}, _cleanA(a), {kind:"img"}));
      const _dict={ Type:"Annot", Subtype:"Stamp", Rect:rect, F:4, T:PDFString.of(author),
        CA:1, Border:[0,0,0], Name:PDFName.of("Photo"),
        MARL:PDFString.of("1"), MAPhoto:PDFString.of(_tagEnc(itag)),
        AP: ctx.obj({ N: ap }) };
      emitMark(a,pg,ap,rect,(phi?[cth,sth,-sth,cth,0,0]:null),bw,bh,_dict);
    };

    const drawItems=[];
    /* 6gn — layer 4, not 2, for a mark that is NOT under: the exported page has to put it above the
       strokes at layer 3, exactly as the screen now does. */
    /* 6ib — four levels, the same four the screen draws: under-strokes(1), under-marks(2),
       over-strokes(3), over-marks(4). A stroke now carries its own band and its own z. */
    /* 6jc — a layer that is switched off is not in the file either: switching one off is a decision
       about what this drawing says today, not about what you can see while you work. */
    /* 6ln — TWO BANDS, NOT FOUR, and one z inside each. The four-level split put every stroke below
       every mark of its band by construction, which is the fault on screen as well; now the exported
       page carries exactly the order the screen shows, because both read the same number. */
    S.annos.forEach((a,idx)=>{ if(maLayerHidden(a))return;
      drawItems.push({kind:(a.kind==="img"?"i":(isShape(a)?"s":"t")),a,layer:a.under?1:2,z:(a.z||0),idx}); });
    /* 6gm — and the SAME order on the exported page as on the screen: a stroke is layer 3, above every
       text mark, not layer 1 underneath them. The two orderings disagreeing would be worse than either
       being wrong, because you would not find out until the PDF was on someone's desk. */
    S.lines.forEach((l,idx)=>{ if(maLayerHidden(l))return;
      drawItems.push({kind:"l",l,layer:(l.under?1:2),z:(l.z||0),idx:1e6+idx}); });
    drawItems.sort((p,q)=> (p.layer-q.layer) || (p.z-q.z) || (p.idx-q.idx));
    drawItems.forEach(it=>{
      if(it.kind==="t")drawText(it.a);
      else if(it.kind==="s")drawShape(it.a);
      else if(it.kind==="i")drawImg(it.a);
      else drawStroke(it.l);
    });

    /* The REDLINED stamp is not written here: it goes on in the stamping tool, after this. */

    /* Pages set aside in Organize pages are removed now — after every annotation has been attached to
       its page object, so nothing has to be re-indexed on the drawn side. */
    const drop=[]; S.pages.forEach((P,pi)=>{ if(P&&P.dropped)drop.push(pi); });
    if(drop.length){
      drop.slice().reverse().forEach(pi=>{ try{ doc.removePage(pi); }catch(e){ LOG("could not drop page",pi+1,e); } });
      LOG("Export: left out page(s)",drop.map(i=>i+1).join(", "));
    }

    // embed re-editable redline data (so this tool can reopen & keep editing)
    /* Reopening this file must land every mark back on the page it belongs to. When pages are dropped the
       exported PDF is renumbered, so the stored page indices are remapped here — and marks that lived on a
       dropped page are left out, since their page no longer exists. Without this, exporting with a page
       dropped and reopening put every later mark on the wrong page. */
    /* 6fg — THE PAYLOAD SERIALISED THE LIVE OBJECTS, and that put 1.6 MEGABYTES of internal scratch into
       Ced's GRANMI2713 export. Measured on it: the Subject is 1,674,897 characters, and **94% of it is
       `_pre`** — the field `ed.onfocus` uses to stash `snapshot()`, a copy of the WHOLE document, on every
       mark you click into for editing. Seventeen marks focused, seventeen whole-document snapshots,
       written into the PDF.

       That is not merely wasteful. A Subject that big cannot be read back: pdf-lib's `decodeText()` spreads
       the string's code units into `String.fromCharCode`, and at 1.67 million units it throws
       `RangeError: Maximum call stack size exceeded`. So the payload was unreadable, which cost the photo
       and the line their only source of truth — that is Ced's "the added photo and the lines are not
       editable", two layers down.

       `_cleanA`/`_cleanL` are the persistence whitelists, and 6ff already made the annotation tags derive
       from them. The payload never did. It does now, so `_pre`, `_dirty` and every other scratch field
       stop travelling. Measured after: the same document's payload is a few tens of KB.

       `src` is dropped too, for the same reason the tag omits it: since 6ff a photo's picture is read back
       out of its own appearance stream, so carrying the base64 a second time is pure weight. An OLDER
       file's payload still has `src` and is still read — this only changes what we WRITE. */
    /* 6le — and so are the other two fields that hold a whole picture, through the one function that
       knows which those are. `delete o.src` alone let `srcOrig` and `picRaw` back in. */
    /* 6nm — the picture's own bytes are remembered on the way past, so the recovery copy can be
       made from them after the strip. `__picSrc` never reaches the file: `_payPics` reads it and
       the payload is built from `picRef` instead. */
    const _payA=z=>{ const o=_stripPicBytes(_cleanA(z));
      if(z&&z.kind==="img"){ const raw=z.srcOrig||z.src; if(raw)o.__picSrc=raw; }
      return o; };
    let outAnnos=(S.annos||[]).map(_payA), outLines=(S.lines||[]).map(_cleanL);
    if(drop.length){
      const gone=new Set(drop);
      const remap=new Map();
      let n=0;
      S.pages.forEach((_,pi)=>{ if(!gone.has(pi))remap.set(pi,n++); });
      const keep=z=>remap.has(z.page);
      const move=z=>Object.assign({},z,{page:remap.get(z.page)});
      outAnnos=outAnnos.filter(keep).map(move);
      outLines=outLines.filter(keep).map(move);
      const lostA=(S.annos||[]).length-outAnnos.length, lostL=(S.lines||[]).length-outLines.length;
      LOG("Export: remapped page numbers for",outAnnos.length,"mark(s) and",outLines.length,"line(s)"
          +((lostA+lostL)?("; left out "+(lostA+lostL)+" on dropped page(s)"):""));
    }
    /* 6nm — the recovery copies, then the payload, then as many copies as it takes to fit */
    let pics={}, picsDropped=0;
    try{ pics=await _payPics(outAnnos); }catch(e){ LOG("payload: no recovery copies —",e&&e.message); }
    const nPics=Object.keys(pics).length;
    const build=()=>({v:1, name:S.name, pages:(S.pages.length-drop.length),
                   stamp:{tcol:$("#c_text").value,bcol:$("#c_bg").value},
                   pics:pics, picsDropped:picsDropped,
                   annos:outAnnos.map(z=>{ const o=Object.assign({},z); delete o.__picSrc; return o; }),
                   lines:outLines});
    let _pj="MAREDLINE:"+await _payEnc(build());
    /* over the ceiling: give up the biggest recovery copy and try again. Dropping the largest
       first means the most pictures survive for a given budget, and the count is written into the
       payload so the reopen can say how many it could not bring back. */
    while(_pj.length>PAY_SAFE_MAX && Object.keys(pics).length){
      const worst=Object.keys(pics).sort((x,y)=>pics[y].length-pics[x].length)[0];
      delete pics[worst]; picsDropped++;
      outAnnos.forEach(z=>{ if(z.picRef===worst)delete z.picRef; });
      _pj="MAREDLINE:"+await _payEnc(build());
    }
    LOG("Export: the re-edit payload is",_pj.length,"chars for",outAnnos.length,"mark(s), ",
        outLines.length,"line(s) and",Object.keys(pics).length,"of",nPics,
        "recovery picture(s)"+(picsDropped?(" — "+picsDropped+" too large to carry"):""));
    doc.setSubject(_pj);
    doc.setTitle(`${siteLocation()||S.name||"Document"} (${outputFilename().replace(/^.*? - /,"")})`);
    setProg(1,1,"Saving…");
    const bytes=await doc.save({useObjectStreams:false});
    const blob=new Blob([bytes],{type:"application/pdf"});
    const how=await deliverFile(outputFilename()+".pdf",blob);
    hideProg();
    if(how==="declined") setStatus("Export cancelled — the file was not saved.",true);
    else if(how==="blocked") setStatus("This view would not save the file — allow the download when the "+
                                      "viewer asks, or open the tool from the HTML file itself and export "+
                                      "there. Nothing is lost: every redline is still here.",true);
    else setStatus("Redlined PDF saved (vector, original pages intact). Reopen it here to keep editing the redlines.");
    LOG("Export complete, size",blob.size);
    /* 6cn — the prompt used to open on the same tick as the download click, so the dialog could arrive
       before the browser had taken the file. Give the download a moment to start, and only then ask. */
  }catch(e){ hideProg(); setStatus("PDF export failed: "+e.message,true); LOG("Export error",e); if(_echoConsole)console.error(e); }
}
/* ================================================================================================
   6ez — HANDING THE FILE OVER, WHEREVER THE TOOL IS RUNNING.
   ------------------------------------------------------------------------------------------------
   Opened from the file, an export is an ordinary download: a blob URL and a click on a hidden <a>.
   Published as an artifact the tool runs framed, and that frame BLOCKS a download the page starts
   itself — the anchor is simply inert, which from the outside looks exactly like an export that did
   nothing. The host offers a way through instead: `claude.use("downloads")` resolves a namespace whose
   `save({filename,data})` asks the viewer to accept the file.
   So the export asks the host first and falls back to the anchor. `window.claude` does not exist outside
   a viewer, so this costs one property read when the tool is opened from the file.
   A PDF is in the host's EXTENDED set, which a given view may not have enabled — that comes back as
   `extension_not_enabled`, and it is reported rather than swallowed: the marks are all still there, and
   the same document exported from the file build will save.
   ================================================================================================ */
let _hostDl=undefined;                       // undefined: not asked · null: not available here
async function hostDownloads(){
  if(_hostDl!==undefined)return _hostDl;
  _hostDl=null;
  try{
    if(window.claude&&typeof window.claude.use==="function"){
      _hostDl=await window.claude.use("downloads");
      LOG("host downloads:",_hostDl?"available":"not available in this view");
    }
  }catch(e){ _hostDl=null; LOG("host downloads: use() threw",e&&e.message); }
  return _hostDl;
}
async function deliverFile(name,blob){
  let dl=null;
  try{ dl=await hostDownloads(); }catch(e){}
  if(dl&&typeof dl.save==="function"){
    try{
      await dl.save({filename:name,data:blob});
      LOG("Export handed to the host:",name,blob.size,"bytes");
      return "host";
    }catch(err){
      const code=(err&&err.code)||"";
      LOG("host save refused:",code||(err&&err.message)||String(err));
      if(code==="declined")return "declined";
      /* anything else: the anchor cannot work in a frame either, so say so rather than looking dead */
      if(code==="extension_not_enabled"||code==="rejected_extension"||code==="too_large"||
         code==="unavailable"||code==="not_granted")return "blocked";
      return "blocked";
    }
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); },2000);
  return "anchor";
}
/* 6gg — the stamp tool's own deployment, not the artifact it was prototyped as. */
const STAMP_URL="https://attcopstamptool.vercel.app/";


/* ================================================================================================
   6fe — TAKE OUR REDLINES OFF THE PAGE AND HAND THEM OVER AS OBJECTS.

   Ced's own file said it plainest. `SOH2465 - Redlined RFDS.pdf`, 42 pages:

       100  FreeText annotations carrying our tag — every redline he had made
         3  marks named by the Subject payload
        84  FreeText and 42 Square annotations belonging to the STAMP TOOL (not ours)

   Opened in 6fd it restored the payload's THREE and stopped there, because `restoreEmbedded` preferred
   the Subject and returned. And pdf.js paints annotation appearance streams into the page canvas, so the
   other ninety-seven were still visible — measured on his file: page 5, 1,012 red pixels on the canvas
   and NOT ONE editable mark; page 18, 1,473 red pixels and one mark. That is exactly "the tool does not
   recognize the actual movable items on the pdf": the redlines were there, drawn, and belonged to nobody.

   So the fix is not more recovery. It is OWNERSHIP:

     1. THE ANNOTATIONS ARE THE TRUTH, not the payload. The payload is one line of metadata that any
        re-save can drop or leave behind; a tagged annotation is the mark itself. His payload said 3 and
        his file held 100, and the file was right. The payload is now only used to fill in a mark the
        annotations do not account for.
     2. OURS COME OFF THE DOCUMENT. Every tagged text mark and line is removed from the page's Annots
        array before pdf.js ever sees the bytes, so the page shows the printed form and the tool's own
        editable marks — one copy of each, and moving one moves what you see. That is the Acrobat/Nitro
        behaviour asked for.
     3. WHAT IS NOT OURS IS LEFT ALONE. The stamp tool's REDLINED boxes and signature blocks are untagged,
        so they stay exactly where they are, visible, and travel through the next export untouched.
     4. AND THIS ALSO STOPS THE FILE GROWING. The export builds on `S.docBytes`, so every round trip used
        to re-bake the annotations the file arrived with and add the new ones on top — which is how a
        payload of 3 ended up on a file of 100 in the first place. With ours detached, `S.docBytes` holds
        the form plus other people's marks, and the export writes each of ours exactly once.

   A PHOTO IS THE ONE EXCEPTION and it is deliberate: its bitmap lives in the annotation's appearance
   stream, not in the tag, so detaching it would delete the photo outright. It is left on the page,
   counted, and named in the message — visible but not editable beats silently destroyed.

   The bytes are only rewritten when something of ours was actually found. An ordinary RFDS is handed to
   pdf.js byte-identical, because every measurement in this tool is taken against the text geometry and a
   needless re-save is a needless risk. `reopen.py` asserts that the geometry is unchanged even when the
   rewrite does happen.
   ================================================================================================ */
/* ================================================================================================
   6ff — GET A PHOTO'S PICTURE BACK OUT OF THE PDF.

   A photo's tag carries its box but not its bitmap, on purpose: the image is already in the file once, as
   this annotation's own appearance stream, and putting the data URL in the tag as well would add a third
   of every photo to the export. Until now that meant a photo was editable only while the Subject payload
   survived — and the stamp tool the export sends you to drops the payload, so in practice Ced's photos
   were never editable again.

   The picture is right there. This walks in and takes it:

       Stamp annot -> AP -> N (a Form XObject)
                        -> Resources -> XObject -> Im0 (the image)

   and rebuilds a data URL from it. Two encodings matter, and they are the two the export can produce:

     DCTDecode    the raw stream IS a JPEG file. Hand it over as one; nothing to decode.
     FlateDecode  raw samples, which is what pdf-lib's embedPng writes — measured on a real export:
                  FlateDecode, DeviceRGB, 8 bits, with the alpha channel in a SEPARATE SMask image, also
                  FlateDecode. Inflate both, put them in a canvas, and let the canvas re-encode a PNG.

   Anything else — 1/2/4-bit samples, CMYK, an indexed palette, a JPX stream — is left alone and reported
   rather than guessed at. The tool only ever writes the two above, so the others can only arrive from
   somebody else's editor, and a wrong guess there would silently corrupt someone's photo.
   ================================================================================================ */
/* 6fg — READ THE SUBJECT WITHOUT BLOWING THE STACK.
   `doc.getSubject()` calls pdf-lib's `decodeText()`, which spreads the string's code units into
   `String.fromCharCode`. On Ced's GRANMI2713 that is 1.67 million units and it throws
   `RangeError: Maximum call stack size exceeded` — so a file whose payload got large became a file with
   no payload at all, silently. 6fg stops WRITING payloads that big, but his existing files are already
   written, so the reader has to cope: take the bytes, which pdf-lib hands over without complaint
   (measured: 3,349,796 of them), and decode in 16k chunks.
   The Subject is a PDFHexString holding UTF-16BE with a FEFF byte-order mark — again measured, not
   assumed — with a PDFString of PDFDocEncoded text as the other possibility. */
function _pdfText(v){
  if(!v)return null;
  /* small strings: let pdf-lib do it, it handles the encodings properly */
  try{ if(typeof v.sizeInBytes==="function"&&v.sizeInBytes()<131072&&typeof v.decodeText==="function")
         return v.decodeText(); }catch(e){}
  let b=null;
  try{ if(typeof v.asBytes==="function")b=v.asBytes(); }catch(e){}
  if(!b){ try{ return String(v.value!=null?v.value:v); }catch(e){ return null; } }
  const CH=0x4000;                                     /* 16k arguments per apply(), far under the limit */
  const parts=[];
  if(b.length>=2&&b[0]===0xFE&&b[1]===0xFF){
    for(let i=2;i<b.length;i+=CH*2){
      const end=Math.min(b.length,i+CH*2), units=[];
      for(let j=i;j+1<end;j+=2)units.push((b[j]<<8)|b[j+1]);
      parts.push(String.fromCharCode.apply(null,units));
    }
  }else{
    for(let i=0;i<b.length;i+=CH)
      parts.push(String.fromCharCode.apply(null,b.subarray(i,Math.min(b.length,i+CH))));
  }
  return parts.join("");
}
/* the raw /Subject object out of the Info dictionary, bypassing getSubject() entirely */
function _subjectOf(doc){
  try{
    const {PDFName}=PDFLib;
    const info=doc.context.lookup(doc.context.trailerInfo.Info);
    if(!info||!info.get)return null;
    return _pdfText(info.get(PDFName.of("Subject")));
  }catch(e){ LOG&&LOG("could not read the Subject:",e&&e.message); return null; }
}

async function _inflate(u8){
  if(typeof DecompressionStream!=="function")throw new Error("no DecompressionStream in this browser");
  const s=new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function _b64(u8){
  let s=""; const CH=0x8000;
  for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
  return btoa(s);
}
function _filterNames(dict){
  try{
    const {PDFName}=PDFLib;
    const f=dict.lookup(PDFName.of("Filter"));
    if(!f)return [];
    if(typeof f.asString==="function")return [String(f.asString()).replace(/^\//,"")];
    if(typeof f.size==="function"){ const out=[];
      for(let i=0;i<f.size();i++){ const n=f.lookup(i); out.push(String(n&&n.asString?n.asString():n).replace(/^\//,"")); }
      return out; }
    return [String(f).replace(/^\//,"")];
  }catch(e){ return []; }
}
function _num(dict,key){
  try{ const {PDFName}=PDFLib; const v=dict.lookup(PDFName.of(key));
       return (v&&typeof v.asNumber==="function")?v.asNumber():null; }catch(e){ return null; }
}
function _name(dict,key){
  try{ const {PDFName}=PDFLib; const v=dict.lookup(PDFName.of(key));
       if(!v)return null;
       return String(v.asString?v.asString():v).replace(/^\//,""); }catch(e){ return null; }
}
/* the image XObject behind a Stamp annotation's appearance, or null */
function _imageOf(d){
  try{
    const {PDFName}=PDFLib;
    const ap=d.lookup(PDFName.of("AP")); if(!ap||!ap.lookup)return null;
    const form=ap.lookup(PDFName.of("N")); if(!form||!form.dict)return null;
    const res=form.dict.lookup(PDFName.of("Resources")); if(!res||!res.lookup)return null;
    const xo=res.lookup(PDFName.of("XObject")); if(!xo||!xo.keys)return null;
    const keys=xo.keys();
    for(let i=0;i<keys.length;i++){
      const im=xo.lookup(keys[i]);
      if(im&&im.dict&&_name(im.dict,"Subtype")==="Image")return im;
    }
  }catch(e){}
  return null;
}
async function _srcFromImage(im){
  const filters=_filterNames(im.dict);
  const bytes=im.contents||im.getContents&&im.getContents();
  if(!bytes||!bytes.length)throw new Error("the image stream is empty");

  if(filters.indexOf("DCTDecode")>=0)return "data:image/jpeg;base64,"+_b64(bytes);
  if(filters.indexOf("JPXDecode")>=0)throw new Error("JPEG-2000 images are not decoded here");
  if(filters.indexOf("FlateDecode")<0)throw new Error("unsupported image filter: "+(filters.join("+")||"none"));

  const W=_num(im.dict,"Width"), H=_num(im.dict,"Height");
  const bpc=_num(im.dict,"BitsPerComponent")||8;
  const cs=_name(im.dict,"ColorSpace");
  if(!W||!H)throw new Error("the image has no size");
  if(bpc!==8)throw new Error(bpc+"-bit samples are not decoded here");
  const comps=(cs==="DeviceGray")?1:(cs==="DeviceRGB")?3:0;
  if(!comps)throw new Error("unsupported colour space: "+(cs||"none"));

  const raw=await _inflate(bytes);
  if(raw.length<W*H*comps)throw new Error("the inflated image is short: "+raw.length+" of "+(W*H*comps));

  /* alpha, if the export wrote a soft mask — pdf-lib's embedPng does for a PNG with transparency */
  let alpha=null;
  try{
    const {PDFName}=PDFLib;
    const sm=im.dict.lookup(PDFName.of("SMask"));
    if(sm&&sm.dict&&_filterNames(sm.dict).indexOf("FlateDecode")>=0&&_num(sm.dict,"BitsPerComponent")===8
       &&_num(sm.dict,"Width")===W&&_num(sm.dict,"Height")===H){
      const a=await _inflate(sm.contents);
      if(a.length>=W*H)alpha=a;
    }
  }catch(e){ LOG&&LOG("photo: could not read the soft mask, treating it as opaque —",e&&e.message); }

  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const cx=cv.getContext("2d");
  const id=cx.createImageData(W,H);
  for(let i=0;i<W*H;i++){
    const o=i*comps, p=i*4;
    id.data[p]  =raw[o];
    id.data[p+1]=(comps===1)?raw[o]:raw[o+1];
    id.data[p+2]=(comps===1)?raw[o]:raw[o+2];
    id.data[p+3]=alpha?alpha[i]:255;
  }
  cx.putImageData(id,0,0);
  return cv.toDataURL("image/png");
}
/* every photo of ours in the document, as {id -> data URL}. Runs BEFORE the detach walk removes
   anything, because reading an appearance stream is async and the removal pass cannot be. */
async function recoverPhotoSrcs(doc){
  const out=new Map();
  const why=[];
  try{
    const {PDFName}=PDFLib;
    const str=v=>{ try{ if(!v)return null;
        if(typeof v.decodeText==="function")return v.decodeText();
        if(typeof v.asString==="function")return v.asString();
        return String(v); }catch(e){ return null; } };
    const pages=doc.getPages();
    for(let pi=0;pi<pages.length;pi++){
      let arr=null;
      try{ arr=pages[pi].node.Annots&&pages[pi].node.Annots(); }catch(e){}
      if(!arr||!arr.size)continue;
      for(let i=0;i<arr.size();i++){
        let d=null;
        try{ d=arr.lookup(i); }catch(e){ continue; }
        if(!d||!d.get)continue;
        const pblob=(str(d.get(PDFName.of("MAPhoto")))||str(d.get(PDFName.of("RFDSPhoto"))));
        /* 6fg — an UNTAGGED Stamp of ours counts too. A file exported before 6fd has no `RFDSPhoto`, and
           if its payload has also been stripped there is nothing left but the annotation itself — so it
           is indexed by WHERE IT IS instead of by id, and the legacy pass looks it up that way. Gated on
           our own author string, so the stamp tool's Stamp is never touched. */
        const untagged=(!pblob&&_name(d,"Subtype")==="Stamp"&&str(d.get(PDFName.of("T")))==="Redline");
        if(!pblob&&!untagged)continue;
        let id=null;
        if(pblob){ const _pt=_tagDec(pblob); if(_pt)id=_pt.id; }
        let key=id;
        if(key==null){
          try{
            const {width:W,height:H}=pages[pi].getSize();
            const rc=d.lookup(PDFName.of("Rect"));
            const r=rc.asRectangle?rc.asRectangle():null;
            const n=r?null:rc.asArray().map(x=>x.asNumber());
            const x1=r?r.x:n[0], y2=r?(r.y+r.height):n[3];
            key="at:"+pi+":"+(x1/W).toFixed(4)+":"+((H-y2)/H).toFixed(4);
          }catch(e){}
        }
        if(key==null)continue;
        const im=_imageOf(d);
        if(!im){ why.push(key+": no image in its appearance stream"); continue; }
        try{ out.set(key, await _srcFromImage(im)); }
        catch(e){ why.push(key+": "+(e&&e.message||String(e))); }
      }
    }
  }catch(e){ LOG&&LOG("recoverPhotoSrcs skipped",e&&e.message); }
  if(why.length)LOG&&LOG("photo(s) whose picture could not be read back:",why.join(" · "));
  return out;
}

let _detached=null;
/* ================================================================================================
   6fq — TRANSFER REDLINES: a marked-up PRELIMINARY onto the FINAL.

   Ced's brief: pick the redlined preliminary and the final; if the two are identical apart from page 1,
   the final's page 1 replaces the preliminary's and the redlines come across at the same positions; and
   where the rest of the document HAS changed, the tool has to move the redlines itself.

   Both halves are the same operation once it is written down properly: the output is the FINAL document
   with every redline placed on the page that corresponds to the one it came from. When only page 1
   differs, "the final's page 1 on the preliminary's body" and "the final carrying the preliminary's
   redlines" are the same file — the pages behind page 1 are identical, so there is nothing to choose
   between them. Building it the second way is what makes the changed-pages case work too, instead of
   being a separate feature.

   THREE THINGS HAVE TO BE DECIDED, AND EACH IS MEASURED RATHER THAN ASSUMED:

     1 · WHICH FINAL PAGE EACH PRELIMINARY PAGE IS. Pages get inserted and dropped between issues, so
         page 7 is not always page 7. Every page is fingerprinted by its printed text; identical
         fingerprints pair off first, and what is left is matched on how much text two pages share.

     2 · WHETHER THAT PAGE IS THE SAME PAGE. If the fingerprints match, nothing on it has moved and a
         mark keeps its coordinates exactly — the case that covers "identical except page 1", and it is
         exact, not approximate.

     3 · WHERE THE MARK GOES WHEN THE PAGE HAS CHANGED. A mark does not record what it was placed
         over — `orig` is its own text — so the printed runs AROUND it are the anchor: found by
         geometry on the preliminary, matched by text on the final, and believed only when two of them
         agree on the same delta. A cell reading "0" appears two hundred times on an RFDS; one anchor
         can pair with the wrong one, two agreeing cannot.

   WHAT CANNOT BE ANCHORED IS CARRIED OVER AND FLAGGED, which is Ced's call: the mark lands where it was,
   wears a dashed amber ring, and the report names it. Nothing you drew is silently dropped and nothing
   is silently trusted.
   ================================================================================================ */
const _tfNorm=s=>String(s==null?"":s).replace(/\s+/g,"").toUpperCase();


/* TWO FINGERPRINTS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS.

   `tfTextPrint` is what a page SAYS. It pairs a preliminary page with its counterpart in the final, and
   it has to ignore position or a page whose table has shifted would look like a page that is not there
   at all.

   `tfGeomPrint` is what a page LOOKS LIKE — the same text with each run's position folded in, rounded to
   a thousandth of the page (about 0.6pt at A3). It answers "did anything move", and only that answer may
   be used to let a mark keep its coordinates. Measured on a fixture whose page 6 was pushed down 18pt:
   with text alone the page read as IDENTICAL and every mark on it stayed where it was, 18pt above the


/* How much two pages have in common, as a fraction of the larger one. Counting each token once per
   OCCURRENCE matters: a page of "0" cells would otherwise look like every other page of "0" cells.
   The bag is built once per page (`tfBag`) because the alignment below asks this question for every




/* =================================================================================================
   PRELIM PAGE -> FINAL PAGE, AND IT MAY NOT RUN BACKWARDS (6fs).

   6fq matched pages greedily: identical text at the same index, then identical text anywhere, then
   best-remaining similarity. Every pass was locally sensible and the whole thing had no notion of
   ORDER, which is the one thing a document guarantees. Measured on Ced's real pair — a 43-page
   preliminary against a 36-page final whose sector tables had lost their continuation pages — it
   produced 16->16, 18->15, 20->13. Preliminary 20 is "Antenna Position Details - Sector C"; final 13
   is "Antenna Position Details - Proposed Decommission". Every mark on that page went onto a table it
   had nothing to do with, and the anchors then found "unique" text there and flung the marks up to
   95pt. Three of the four things Ced reported at once — wrong page, scattered, bunched — are that.

   Issues of a document insert pages and remove pages. They do not shuffle them. So the map is not a
   set of independent best guesses, it is an ORDERED alignment, and it is found the way an ordered
   alignment always is: a small dynamic program over the two page lists, maximising the total
   similarity of a non-crossing matching. 43 x 36 is 1,548 cells.

   A tie prefers pairing over skipping — a page that can be paired should be, since an unpaired page
   means its marks have nowhere to go. Below TF_MIN_SIM two pages are not a pair at any price.
   ================================================================================================= */
const TF_MIN_SIM=0.35;


/* MOVING A POINT FROM THE OLD PAGE TO THE NEW ONE.

   A mark does NOT record the printed text it covers — `orig` is the mark's own text, which for a
   correction is the NEW value and not what the page said. So the anchor has to be found by geometry on
   the preliminary, where the mark's coordinates still mean something, and then by text on the final.

   THE ANCHOR HAS TO BE A RUN THAT IDENTIFIES ITSELF, and this is the part that had to be measured
   before it was right. The first cut matched each neighbouring run to the nearest run on the new page
   carrying the same text. On a fixture whose page had been pushed down 18pt it confidently returned
   MINUS 12.5pt — because the table's row pitch is 12.5pt, so "the nearest cell that also says 0" was
   the row above, every time. Every anchor made the same mistake, so agreement between them did not
   catch it: a systematic error is unanimous.

   What identifies a run is being the only one of its text on the page. Only runs whose text appears
   EXACTLY ONCE on the preliminary page and exactly once on the final page are used, so there is no
   nearer twin to pair with. An RFDS page has plenty — headers, model numbers, site ids. The nearest few
   of those to the mark then vote, and the delta they agree on is the one used:
     · two or more agree  -> "text", the mark follows and is not flagged
     · only one to go on  -> "nearby", the mark follows and IS flagged
     · none at all        -> "none", the mark stays put and is flagged                                */
const TF_ANCHORS=8;        // how many identifying runs around the mark to consult
const TF_MIN_TOK=2;        // a run shorter than this is too common to identify anything
const TF_MAX_JUMP=0.28;    // a delta bigger than this is not a page that moved, it is a mismatch
/* every run that identifies itself on BOTH pages, with how far it moved. The tallies come back with it
   because the covered-run lookup below needs exactly the same "is this text unique on both pages"



/* 6fr — THE RUN THE MARK IS ACTUALLY ON, WHICH BEATS ITS NEIGHBOURHOOD.
   Ced: "applying the redlines means applying the redline of prelim rfds matching the positions into the
   final rfds." The neighbourhood vote answers "how far did this part of the page move" — which is right
   when the page moved as a block and WRONG when one row moved on its own, because the eight runs around
   the mark did not move and the row under it did. A redline belongs to the value it covers, so that
   value is asked first.

   It is only trusted when the mark really is on it and it can only be one thing:
     · the nearest printed run to the mark, by distance to its box — not the nearest UNIQUE run, which
       would happily grab a header two rows away when the mark sits on a cell reading "0";
     · within TF_ON_R of the mark, so a line drawn across white space does not adopt a distant row;
     · and unique on both pages, or there is no way to say which of its twins it became.
   Anything else falls through to the neighbourhood vote, unchanged. */
const TF_ON_R=0.016;       // ~12pt at letter height: a mark is on its own row or it is not on one
/* 6ft — THE COLUMN SAYS WHICH ONE. 6fr would only follow the covered run when its text appeared exactly
   once on each page, and on an RFDS table that rules out the common case: a value repeats across the
   sector's positions. Ced's Sector A page prints "NNH4-65B-R6H4-V3" twice, once under A-1 and once under
   A-3, so a model correction fell back to the neighbourhood, which anchored on a column header that had
   not moved and left the mark on the Vendor row while its own row had dropped 0.064 of the page.

   Two runs of the same text in a table are not ambiguous — they are in different COLUMNS, and the mark
   is in one of them. Measured on that page: the covered run's centre is x 0.3207 and the two candidates
   in the final are at x 0.1989 and x 0.3207. One is exactly right and the other is a tenth of the sheet
   away. So the candidates are ranked by how far their centre is from the covered run's, and the winner
   is taken only when it is CLEARLY nearer than the runner-up (TF_COL_SEP) and near enough in absolute
   terms (TF_COL_TOL) that it is the same column rather than a distant one.

   When the column cannot separate them — the same value twice in the SAME column, two rows apart — the
   nearest in y is taken and the mark is FLAGGED, because at that point it is a guess and Ced asked to
   be shown the guesses. */
const TF_COL_TOL=0.060;    // how far in x a run may be and still be in the mark's own column
/* 6ft — AND A DASH DOES NOT COUNT, WHICH WAS TRIED THE OTHER WAY FIRST. The ordinal identifies a run by
   its place in its column, so it was tempting to let "-" and "0" be followed too: three marks sitting on
   a "-" were otherwise handed to the neighbourhood vote and landed 104 to 198pt from their cell.
   MEASURED, it made things worse, not better. Ced's final gained a Vendor (As-Built) and a Model
   (As-Built) row and lost others, so the count of "-" down a column came out the same by coincidence
   while the k-th "-" was a different row entirely — and two marks that had been landing correctly (the
   Rad Center and Azimuth corrections) moved a row and a half, with full confidence. A placeholder is not
   an identity, and a coincidence of counts is not evidence. The floor stays. */
const TF_ON_MIN_TOK=TF_MIN_TOK;



/* =================================================================================================
   6fu — WHEN THE VALUE ITSELF HAS CHANGED, ASK THE REST OF ITS ROW.

   Measured on Ced's PAL01099 pair. A Tip Height correction sat over the printed "63.5"; the final
   prints "63.51" in that cell. So there is no "63.5" to follow, `tfOnValue` returns nothing, and the
   neighbourhood vote put the mark on **Rad Center (As-Built)** — a different field, one row up, with no
   ring on it. That is the case Ced photographed, and it is not rare: the whole point of a correction is
   that the final often ADOPTS it, which changes the very text the mark was placed over.

   A row is not identified only by the cell the mark covers. It is identified by everything printed on
   that line — the heading in the first column and the other positions' values. Those are still there.
   So each run on the mark's own line is asked, by the same column-ordinal rule, where IT went, and the
   answer two or more of them agree on is the row's move. On that Tip Height line the mates are "Tip",
   "Height", "65" and "65", all still on the final page in the same columns, and they agree.

   Two or more must agree. One mate is not agreement — that is the mistake 6fq made with anchors, and
   it would be the same mistake here.
   ================================================================================================= */
const TF_ROW_BAND=0.012;   // a run on the same printed line as the value the mark covers

/* 6fu — THE ROW'S PRINTED HEADING. These forms name every row in the first column, and that name is
   what says whether the row is a Design/As-Built half or a single bare row. A wrapped heading is two
   runs and both are wanted. */
const TF_LABEL_X=0.14;
const TF_SPLIT_RE=/\((?:design|as-?built)\)/i;


async function detachOurRedlines(u8){
  if(!window.PDFLib)return null;
  let doc=null;
  /* ================================================================================================
     6mm — AND IT READS THE FILE THE QUICK WAY. Ced: "viewing pdf should also be seamless."

     Timed on a 45-page site package, from the click to the first page on screen: 3.2 seconds, of
     which `detachOurRedlines` is **1,660ms** and all of it happens before anything is drawn. Taken
     apart, the whole of that is this one line — pdf-lib parsing the file — and nothing else in the
     function is measurable:

         PDFDocument.load, as it was called      404 ms
         load, parseSpeed Fastest                115 ms
         recoverPhotoSrcs                          1 ms
         the annotation walk                       0 ms

     `parseSpeed` is how far pdf-lib looks ahead when it meets something it does not understand.
     Fastest means it does not go hunting, which costs nothing at all on a well-formed file and on
     a malformed one throws instead of recovering — and a throw here is already handled, three
     lines down, by leaving the file exactly as it came in. So the slow setting was buying a
     recovery path for a case where the fast setting's failure is the same answer.
     ================================================================================================ */
  try{ doc=await PDFLib.PDFDocument.load(u8,{updateMetadata:false,
          parseSpeed:(PDFLib.ParseSpeeds&&PDFLib.ParseSpeeds.Fastest)||Infinity}); }
  catch(e){ LOG("detachOurRedlines: could not read the PDF, leaving it alone —",e&&e.message); return null; }
  const {PDFName}=PDFLib;
  const str=v=>{ try{ if(!v)return null;
      if(typeof v.decodeText==="function")return v.decodeText();
      if(typeof v.asString==="function")return v.asString();
      return String(v);
    }catch(e){ return null; } };

  /* the payload, if the file still has one — used only to fill gaps */
  let payA=[], payL=[], stamp=null, payPicsDropped=0;
  try{
    const subj=_subjectOf(doc);              /* 6fg — never getSubject(); see _pdfText */
    const _mk=(subj&&subj.indexOf("MAREDLINE:")===0)?"MAREDLINE:"
              :((subj&&subj.indexOf("RFDSREDLINE:")===0)?"RFDSREDLINE:":null);
    if(_mk){
      const d=await _payDec(subj.slice(_mk.length));
      payA=(d&&d.annos)||[]; payL=(d&&d.lines)||[]; stamp=(d&&d.stamp)||null;
      /* 6nm — the recovery copies, put back on the marks that point at them. A mark whose
         annotation survived is served by the annotation instead; this only fills what is missing,
         which is exactly the flattened case. */
      const _pics=(d&&d.pics)||null;
      payPicsDropped=(d&&d.picsDropped)||0;
      if(_pics)payA.forEach(z=>{ if(z&&z.picRef&&!z.src&&_pics[z.picRef]){
        z.src=_pics[z.picRef]; z.__fromRecovery=true; } });
    }
  }catch(e){ LOG("detachOurRedlines: the payload would not parse; the annotations still speak",e&&e.message); }

  /* 6ff — the pictures first, because reading an appearance stream is async and the removal walk below
     cannot be (removing shifts indices, so it has to run start-to-finish in one pass) */
  let pics=new Map();
  try{ pics=await recoverPhotoSrcs(doc); }
  catch(e){ LOG("photo recovery skipped",e&&e.message); }

  const tagA=[], tagL=[];
  const leftPhotos=new Set();   /* 6nm — photo ids left on the page */
  let photos=0, removed=0, other=0;
  try{
    doc.getPages().forEach((pg,pi)=>{
      let arr=null;
      try{ arr=pg.node.Annots&&pg.node.Annots(); }catch(e){}
      if(!arr||!arr.size)return;
      const {width:W,height:H}=pg.getSize();
      /* BACKWARDS, because removing shifts every index after it */
      for(let i=arr.size()-1;i>=0;i--){
        let d=null;
        try{ d=arr.lookup(i); }catch(e){ continue; }
        if(!d||!d.get){ other++; continue; }
        const mine=(str(d.get(PDFName.of("MARL")))||str(d.get(PDFName.of("RFDSRL"))));
        const blob=(str(d.get(PDFName.of("MAData")))||str(d.get(PDFName.of("RFDSData"))));
        const lblob=(str(d.get(PDFName.of("MALine")))||str(d.get(PDFName.of("RFDSLine"))));
        const pblob=(str(d.get(PDFName.of("MAPhoto")))||str(d.get(PDFName.of("RFDSPhoto"))));
        if(!mine&&!blob&&!lblob&&!pblob){ other++; continue; }   /* somebody else's — leave it */
        /* A PHOTO, and it depends on whether its picture can be got back. The annotation's tag carries
           the box but NOT the bitmap; the Subject payload does carry `src`, because `_cleanA` keeps it.
           So: payload present -> detach the annotation and restore the photo whole, editable, one copy.
           Payload gone -> leave the annotation alone, count it, say so.
           Getting this wrong doubles the photo on every trip, which is what the first run of this build
           did: it left the annotation on the page AND restored the photo from the payload, so the export
           wrote two — measured, "1 photo stayed" on the first reopen and "2 photos" on the next. */
        if(pblob){
          let ptag=_tagDec(pblob);
          const pid=ptag&&ptag.id;
          /* the payload if it is still here, otherwise the picture read out of this annotation's own
             appearance stream (6ff). Either way the photo comes off the page as an editable mark; it is
             only left alone when neither can supply the image. */
          const whole=pid?payA.find(a=>a&&a.id===pid&&a.kind==="img"&&a.src):null;
          const pic=(pid!=null)?pics.get(pid):null;
          if(whole||pic){
            const m=Object.assign({}, ptag||{}, whole||{}, {page:pi, kind:"img"});
            if(!m.src)m.src=pic;
            tagA.push(m);
            try{ arr.remove(i); removed++; }catch(e){ LOG("could not detach a photo",e&&e.message); }
          }else{
            photos++;
            if(pid!=null)leftPhotos.add(pid);   /* 6nm — this one is still on the page */
          }
          continue;
        }
        let took=false;
        if(lblob){ const L=_tagDec(lblob); if(L){ L.page=pi; tagL.push(L); took=true; } }
        if(!took&&blob){ const m=_tagDec(blob); if(m){ m.page=pi; tagA.push(m); took=true; } }
        if(!took){
          /* tagged but the blob is gone or unreadable — rebuild from the annotation's own geometry */
          try{
            const sub=String(d.get(PDFName.of("Subtype"))||"");
            if(sub.indexOf("Line")>=0){
              const L=d.get(PDFName.of("L")).asArray().map(n=>n.asNumber());
              tagL.push({id:0, page:pi, x1:L[0]/W, y1:(H-L[1])/H, x2:L[2]/W, y2:(H-L[3])/H});
              took=true;
            }else{
              const rc=d.get(PDFName.of("Rect"));
              const r=rc.asRectangle?rc.asRectangle():null;
              const nums=r?null:rc.asArray().map(n=>n.asNumber());
              const x1=r?r.x:nums[0], y2=r?(r.y+r.height):nums[3];
              const x2=r?(r.x+r.width):nums[2], y1=r?r.y:nums[1];
              const q=(()=>{ try{ return d.get(PDFName.of("Q")).asNumber(); }catch(e){ return 0; } })();
              tagA.push({ id:0, page:pi, kind:"text",
                text:str(d.get(PDFName.of("Contents")))||"",
                nx:x1/W, ny:(H-y2)/H, nw:(x2-x1)/W, nh:(y2-y1)/H,
                size:8, align:(q===1?"center":q===2?"right":"left"), alignSet:true, nowrap:true });
              took=true;
            }
          }catch(e){}
        }
        if(took){ try{ arr.remove(i); removed++; }catch(e){ LOG("could not detach an annotation",e&&e.message); } }
      }
    });
  }catch(e){ LOG("detachOurRedlines: walk failed, leaving the file alone —",e&&e.message); return null; }

  /* ------------------------------------------------------------------------------------------------
     6fg — A SECOND PASS FOR ANNOTATIONS FROM BEFORE THE TAGS EXISTED.

     `RFDSLine` and `RFDSPhoto` arrived in 6fd. A file exported before that has its text tagged and its
     lines and photos NOT — Ced's GRANMI2713 is exactly this: 72 tagged FreeText, plus one Line and one
     Stamp carrying no tag at all. The pass above therefore counted both as somebody else's and left them
     painted onto the page, which is his "the added photo and the lines are not editable".

     The payload knows about them. So an untagged annotation is claimed when the payload has an entry
     whose GEOMETRY matches it, and three things must line up before anything is taken:

       · the subtype matches the kind      Line for a line, Stamp for a photo, FreeText for text
       · `T` is our own author string      ours say "Redline"; measured on his file, the stamp tool's
                                           say "Epsilon Cluster Techni…", so this alone separates them
       · the geometry matches to 0.002     on his file it agrees to five decimal places — the Line's
                                           43.168/842 is the payload's 0.051268 exactly

     Three independent signals, all of which have to agree. Guessing here would mean stealing somebody
     else's annotation off their page, so the bar is deliberately high; an annotation that does not match
     is left exactly where it is.
     ------------------------------------------------------------------------------------------------ */
  const claimed=new Set();
  try{
    const {PDFName}=PDFLib;
    const str2=v=>{ try{ if(!v)return null;
        if(typeof v.decodeText==="function")return v.decodeText();
        if(typeof v.asString==="function")return v.asString();
        return String(v); }catch(e){ return null; } };
    const idsA=new Set(tagA.map(a=>a.id).filter(v=>v));
    const idsL=new Set(tagL.map(l=>l.id).filter(v=>v));
    const wantA=payA.filter(a=>a&&a.id!=null&&!idsA.has(a.id));
    const wantL=payL.filter(l=>l&&l.id!=null&&!idsL.has(l.id));
    /* 6fg — this pass runs even with NO payload at all. It used to be guarded on the payload having
       something left over, which meant the "no tag AND no payload" case — a pre-6fd export that has since
       been through the stamp tool, i.e. Ced's actual workflow — skipped the whole pass and lost the photo
       and the line. The loop early-continues on anything tagged or authored by someone else, so running it
       unconditionally costs one pass over the annotations. */
    {
      const NEAR=0.002;
      const near=(a,b)=>(a!=null&&b!=null&&Math.abs(a-b)<=NEAR);
      const rectOf=(d,W,H)=>{ try{
          const rc=d.lookup(PDFName.of("Rect"));
          const n=rc.asRectangle?null:rc.asArray().map(x=>x.asNumber());
          const r=rc.asRectangle?rc.asRectangle():null;
          const x1=r?r.x:n[0], y1=r?r.y:n[1];
          const x2=r?(r.x+r.width):n[2], y2=r?(r.y+r.height):n[3];
          return {nx:x1/W, ny:(H-y2)/H, nw:(x2-x1)/W, nh:(y2-y1)/H};
        }catch(e){ return null; } };
      doc.getPages().forEach((pg,pi)=>{
        let arr=null;
        try{ arr=pg.node.Annots&&pg.node.Annots(); }catch(e){}
        if(!arr||!arr.size)return;
        const {width:W,height:H}=pg.getSize();
        for(let i=arr.size()-1;i>=0;i--){
          let d=null;
          try{ d=arr.lookup(i); }catch(e){ continue; }
          if(!d||!d.get)continue;
          if((str2(d.get(PDFName.of("MARL")))||str2(d.get(PDFName.of("RFDSRL")))))continue;         /* already handled above */
          if(str2(d.get(PDFName.of("T")))!=="Redline")continue;  /* not written by this tool */
          const sub=_name(d,"Subtype")||"";
          let hit=null, isLine=false;

          if(sub==="Line"){
            let L=null;
            try{ L=d.lookup(PDFName.of("L")).asArray().map(x=>x.asNumber()); }catch(e){}
            if(L&&L.length>=4){
              const x1=L[0]/W, y1=(H-L[1])/H, x2=L[2]/W, y2=(H-L[3])/H;
              hit=wantL.find(l=>l.page===pi&&!claimed.has(l.id)&&
                    near(l.x1,x1)&&near(l.y1,y1)&&near(l.x2,x2)&&
                    near((l.y2!=null?l.y2:l.y1),y2));
              isLine=true;
            }
          }else if(sub==="Stamp"||sub==="FreeText"){
            const g=rectOf(d,W,H);
            if(g){
              const wantKind=(sub==="Stamp")?"img":null;
              hit=wantA.find(a=>a.page===pi&&!claimed.has(a.id)&&
                    ((wantKind==="img")?(a.kind==="img"):(a.kind!=="img"))&&
                    near(a.nx,g.nx)&&near(a.ny,g.ny)&&near(a.nw,g.nw));
            }
          }
          /* 6fg — a photo with NEITHER a tag NOR a payload entry: a pre-6fd export that has since been
             through the stamp tool, which is Ced's actual workflow, so this pair of conditions is likely
             rather than exotic. Our own Stamp is identifiable without either: the exporter writes
             `Name:/Photo` and `T:"Redline"`, and the picture is in its own appearance stream. The box is
             rebuilt from the Rect, exactly as the untagged-text fallback does. */
          if(!hit&&sub==="Stamp"&&_name(d,"Name")==="Photo"){
            const g=rectOf(d,W,H);
            const pic=g?pics.get("at:"+pi+":"+g.nx.toFixed(4)+":"+g.ny.toFixed(4)):null;
            if(g&&pic){
              tagA.push({id:0, page:pi, kind:"img", src:pic,
                         nx:g.nx, ny:g.ny, nw:g.nw, nh:g.nh});
              try{ arr.remove(i); removed++; }catch(e){ LOG("could not detach an untagged photo",e&&e.message); }
              other--;
              continue;
            }
          }
          /* a LINE with neither a tag nor a payload entry. `T:"Redline"` is this tool's own author
             string — the exporter writes it on every mark it makes — so a Line carrying it came from
             here, and its two endpoints are in its own `L` array. Same evidence standard as the photo
             above: the author string plus a shape only we draw. */
          if(!hit&&isLine){
            let L=null;
            try{ L=d.lookup(PDFName.of("L")).asArray().map(x=>x.asNumber()); }catch(e){}
            if(L&&L.length>=4){
              tagL.push({id:0, page:pi, x1:L[0]/W, y1:(H-L[1])/H, x2:L[2]/W, y2:(H-L[3])/H});
              try{ arr.remove(i); removed++; }catch(e){ LOG("could not detach an untagged line",e&&e.message); }
              other--;
              continue;
            }
          }
          if(!hit)continue;
          claimed.add(hit.id);
          if(isLine)tagL.push(Object.assign({},hit,{page:pi}));
          else{
            const m=Object.assign({},hit,{page:pi});
            if(m.kind==="img"&&!m.src){
              /* by id if this one carried a tag, otherwise by where it sits — see recoverPhotoSrcs */
              const g=rectOf(d,W,H);
              const pic=pics.get(hit.id)||
                        (g?pics.get("at:"+pi+":"+g.nx.toFixed(4)+":"+g.ny.toFixed(4)):null);
              if(pic)m.src=pic;
            }
            tagA.push(m);
          }
          try{ arr.remove(i); removed++; }catch(e){ LOG("could not detach a legacy annotation",e&&e.message); }
          other--;                                    /* it was counted as somebody else's a moment ago */
        }
      });
      if(claimed.size)LOG("Claimed",claimed.size,"untagged annotation(s) the payload accounts for "+
                          "(an export from before the line/photo tags existed)");
    }
  }catch(e){ LOG("the legacy pass was skipped —",e&&e.message); }

  /* the annotations first — they are what is on the page — then any payload mark they do not account
     for, keyed on id so a mark cannot arrive twice */
  const annos=tagA.slice(), lines=tagL.slice();
  const haveA=new Set(annos.map(a=>a.id).filter(v=>v));
  const haveL=new Set(lines.map(l=>l.id).filter(v=>v));
  let extraA=0, extraL=0;
  /* photos are settled in the walk above — either detached and taken from the payload whole, or left on
     the page. Filling one in here would put it in S.annos while its annotation is still on the document,
     which is the doubling this build had to measure its way out of once already. */
  /* 6nm — AND A PICTURE TOO, WHEN NOTHING ON THE PAGE CLAIMS IT.
     This said `kind!=="img"` flatly, to stop a photo arriving twice: restored from the payload AND
     still sitting on the document as an annotation, which is a doubling this build measured its way
     out of once already. But that only happens when the ANNOTATION IS STILL THERE — and on a file
     another platform has flattened there are no annotations at all, so the blanket refusal was the
     reason Ced's 8 pictures came back as nothing. The test is now the precise one: no annotation
     claimed this id (`haveA`), none was left on the page under it (`leftPhotos`), and the payload
     actually has pixels for it. */
  payA.forEach(a=>{ if(!a||!a.id||haveA.has(a.id))return;
    if(a.kind==="img"&&(!a.src||leftPhotos.has(a.id)))return;
    annos.push(a); haveA.add(a.id); extraA++; });
  payL.forEach(l=>{ if(l&&l.id&&!haveL.has(l.id)){ lines.push(l); haveL.add(l.id); extraL++; } });

  if(!annos.length&&!lines.length&&!photos){
    LOG("No redlines of ours in this file — handing the bytes to pdf.js untouched ("+other+" other annotation(s))");
    return null;
  }

  /* ids must be unique across marks AND lines: the selection, the marks list and the group id all key
     on them */
  let n=1; annos.concat(lines).forEach(o=>{ if(o.id&&o.id>=n)n=o.id+1; });
  annos.forEach(a=>{ if(!a.id)a.id=n++; });
  lines.forEach(l=>{ if(!l.id)l.id=n++; });

  let bytes=u8;
  if(removed){
    try{
      doc.setSubject("");        /* nothing stale to read next time; the export writes a fresh payload */
      /* ============================================================================================
         6mm — AND IT WRITES THEM BACK THE QUICK WAY TOO. These bytes are not a file: they are handed
         straight to pdf.js and kept as `S.docBytes` for the export to build on, and both of those
         read object streams perfectly well. The export's own save keeps `useObjectStreams:false`,
         because that output IS a file and our tags are meant to be legible in it. Measured on the
         45-page package, the same document written both ways:

             save({useObjectStreams:false})   1,164 ms   4.8 MB
             save()                             218 ms   4.2 MB

         Nine hundred and fifty milliseconds, before the first page is on screen, for a property
         nothing downstream of here uses.
         ============================================================================================ */
      bytes=await doc.save();
    }catch(e){
      LOG("detachOurRedlines: the rewrite failed, so the marks stay on the page —",e&&e.message);
      return null;              /* better the old behaviour than a broken document */
    }
  }
  LOG("Detached",removed,"of our annotation(s) from the file:",annos.length,"mark(s),",lines.length,
      "line(s)"+(extraA+extraL?(" ("+(extraA+extraL)+" from the payload only)"):"")
      +(photos?("; "+photos+" photo(s) left in place"):"")+"; "+other+" annotation(s) are not ours");
  /* 6nm — how many pictures came back from the payload's recovery copy rather than from their own
     annotation, and how many the payload could not carry. Both are worth saying out loud: the
     first means the file has been through a flattener, the second means a picture is gone. */
  const recovered=annos.filter(z=>z&&z.__fromRecovery).length;
  annos.forEach(z=>{ if(z)delete z.__fromRecovery; });
  return {bytes:bytes, annos:annos, lines:lines, photos:photos, removed:removed,
          other:other, stamp:stamp, fromPayload:extraA+extraL,
          recovered:recovered, picsLost:payPicsDropped};
}

/* Read our marks back out of the PDF's own annotations. Each one written by this tool carries an RFDSRL
   flag and a blob holding the mark exactly as it was, so recovery is exact rather than guessed.
   A tool-made annotation without the blob (an older export) is rebuilt from its rectangle and text.

   6fd — THIS USED TO READ TEXT ONLY. `RFDSData` is the text blob; a line's `RFDSLine` and a photo's
   `RFDSPhoto` did not exist, so every strike, strike-text, free line and cross-out was invisible to this
   function — and `restoreEmbedded` then set `S.lines=[]`, which is why a file that had been through the
   stamp tool came back with the values and none of the marks over them. It returns three things now:
   the text marks, the LINES, and a count of the photos it could see but cannot rebuild. */
function recoverTaggedAnnots(doc){
  const out=[];
  const outLines=[];
  let photos=0;
  try{
    const {PDFName,PDFString,PDFHexString}=PDFLib;
    const str=v=>{ try{ if(!v)return null;
        if(typeof v.decodeText==="function")return v.decodeText();
        if(typeof v.asString==="function")return v.asString();
        return String(v);
      }catch(e){ return null; } };
    doc.getPages().forEach((pg,pi)=>{
      let arr=null;
      try{ arr=pg.node.Annots&&pg.node.Annots(); }catch(e){}
      if(!arr||!arr.size)return;
      const {width:W,height:H}=pg.getSize();
      for(let i=0;i<arr.size();i++){
        let d=null;
        try{ d=arr.lookup(i); }catch(e){ continue; }
        if(!d||!d.get)continue;
        const mine=(str(d.get(PDFName.of("MARL")))||str(d.get(PDFName.of("RFDSRL"))));
        const blob=(str(d.get(PDFName.of("MAData")))||str(d.get(PDFName.of("RFDSData"))));
        const lblob=(str(d.get(PDFName.of("MALine")))||str(d.get(PDFName.of("RFDSLine"))));
        const pblob=(str(d.get(PDFName.of("MAPhoto")))||str(d.get(PDFName.of("RFDSPhoto"))));
        if(!mine&&!blob&&!lblob&&!pblob)continue;        // not one of ours
        /* a LINE, exact: its two ends and its group, so a cross-out comes back as a cross-out */
        if(lblob){
          const L=_tagDec(lblob);
          if(L){ L.page=pi;                             // trust the page it is actually on
                 outLines.push(L); continue; }
        }
        /* a PHOTO: seen and counted, but its bitmap lives in the annotation's appearance stream rather
           than in the tag, so it cannot be handed back as an editable mark. Counted so the reopen can
           SAY it, which is the whole difference between a known limit and a silent loss. */
        if(pblob){ photos++; continue; }
        if(blob){
          const m=_tagDec(blob);
          if(m){ m.page=pi;                             // trust the page it is actually on
                 out.push(m); continue; }
        }
        /* a Line subtype we tagged but whose blob did not parse — rebuild it from its own L array, which
           is the two endpoints in page space. Better a line in the right place than no line. */
        try{
          const sub=String(d.get(PDFName.of("Subtype"))||"");
          if(sub.indexOf("Line")>=0){
            const L=d.get(PDFName.of("L")).asArray().map(n=>n.asNumber());
            outLines.push({id:0, page:pi, x1:L[0]/W, y1:(H-L[1])/H, x2:L[2]/W, y2:(H-L[3])/H});
            continue;
          }
        }catch(e){}
        /* no blob: rebuild from the rectangle, the text and the alignment code */
        try{
          const r=d.get(PDFName.of("Rect")).asRectangle
                  ? d.get(PDFName.of("Rect")).asRectangle()
                  : null;
          const nums=r?null:d.get(PDFName.of("Rect")).asArray().map(n=>n.asNumber());
          const x1=r?r.x:nums[0], y1=r?r.y:nums[1];
          const x2=r?(r.x+r.width):nums[2], y2=r?(r.y+r.height):nums[3];
          const q=(()=>{ try{ return d.get(PDFName.of("Q")).asNumber(); }catch(e){ return 0; } })();
          out.push({ id:0, page:pi, kind:"text",
            text:str(d.get(PDFName.of("Contents")))||"",
            nx:x1/W, ny:(H-y2)/H, nw:(x2-x1)/W, nh:(y2-y1)/H,
            size:8, align:(q===1?"center":q===2?"right":"left"), alignSet:true, nowrap:true });
        }catch(e){}
      }
    });
    /* ids have to be unique ACROSS marks and lines — the selection, the marks list and the group id all
       key on them, so numbering the two lists independently would put two different things on one id */
    let n=1; out.forEach(m=>{ if(!m.id)m.id=n++; });
    outLines.forEach(l=>{ if(!l.id)l.id=n++; });
  }catch(e){ LOG("recoverTaggedAnnots skipped",e&&e.message); }
  return {annos:out, lines:outLines, photos:photos};
}

/* reopen support: if a loaded PDF carries our embedded redline data, restore editable marks */
async function restoreEmbedded(){
  try{
    /* 6fe — THE DETACH STEP HAS ALREADY DONE THIS, and better: it read the annotations rather than the
       payload, so it has the marks that are actually on the page. All that is left is to install them.
       The two branches below stay for a file the detach could not rewrite — a PDF pdf-lib refuses to
       save, say — so the old behaviour is still the floor rather than nothing at all. */
    if(_detached){
      const d=_detached;
      S.annos=d.annos||[]; S.lines=d.lines||[];
      let mx=0; S.annos.concat(S.lines).forEach(o=>{ if(o.id>mx)mx=o.id; }); seq=mx+1;
      if(d.stamp){ if(d.stamp.tcol)$("#c_text").value=d.stamp.tcol;
                   if(d.stamp.bcol)$("#c_bg").value=d.stamp.bcol; }
      layoutAnnos(); drawAllLines(); updateRail(); updateCount();
      S.history=[]; S.future=[]; updateUndoUI();
      const n=S.annos.length+S.lines.length;
      LOG("Installed",n,"editable redline(s) taken off the page ("+d.removed+" annotation(s) detached, "
          +d.other+" left as somebody else's)");
      /* 6nm — and it says what it had to reach for. A file that has been through another platform
         comes back with every annotation stripped, so the marks are rebuilt from the document
         payload and the pictures from the bounded copies it carries — which is worth telling
         someone, because those pictures are at the recovery resolution and not the originals. A
         picture the payload could not carry is simply gone, and that is worth telling them twice. */
      const msg=n+" redline"+(n===1?"":"s")+" on this PDF "+(n===1?"is":"are")+
                " now editable — move, retype or delete "+(n===1?"it":"them")+" and re-export."+
                (d.photos?(" "+d.photos+" photo"+(d.photos===1?"":"s")+
                           " stayed on the page and cannot be edited here."):"")+
                (d.recovered?(" This file had been flattened by another tool, so "+d.recovered+
                              " picture"+(d.recovered===1?"":"s")+" came back from the copy kept in "+
                              "the document rather than from the original — re-add "+
                              (d.recovered===1?"it":"them")+" if you need full resolution."):"")+
                (d.picsLost?(" "+d.picsLost+" picture"+(d.picsLost===1?"":"s")+" could not be "+
                             "recovered at all and will need re-adding."):"");
      try{ toast(n+" redline"+(n===1?"":"s")+" on this PDF "+(n===1?"is":"are")+" editable"); }catch(e){}
      setStatus(msg);
      setTimeout(()=>{ try{ setStatus(msg); }catch(e){} },350);
      return;
    }
    if(!window.PDFLib||!S.docBytes)return;
    const doc=await PDFLib.PDFDocument.load(S.docBytes);
    const subj=_subjectOf(doc);              /* 6fg — never getSubject(); see _pdfText */
    /* Our own payload marker, and the one the RFDS tool wrote — a report redlined there still opens. */
    const _mark=(subj&&subj.indexOf("MAREDLINE:")===0)?"MAREDLINE:"
               :((subj&&subj.indexOf("RFDSREDLINE:")===0)?"RFDSREDLINE:":null);
    if(!_mark){
      /* No embedded payload — but the annotations themselves carry our fingerprint, so read them back. */
      const rec=recoverTaggedAnnots(doc);
      const rA=(rec&&rec.annos)||[], rL=(rec&&rec.lines)||[], rP=(rec&&rec.photos)||0;
      if(rA.length||rL.length||rP){
        /* 6fd — THE LINES COME BACK TOO. This branch used to write `S.lines=[]`, which threw away every
           strike, strike-text, line and cross-out on a file whose Subject another tool had dropped. */
        S.annos=rA; S.lines=rL;
        let mx=0; S.annos.concat(S.lines).forEach(o=>{ if(o.id>mx)mx=o.id; }); seq=mx+1;
        layoutAnnos(); drawAllLines(); updateRail(); updateCount();
        S.history=[]; S.future=[]; updateUndoUI();
        LOG("Recovered",rA.length,"mark(s) and",rL.length,"line(s) from the annotations themselves"
            +(rP?(" ("+rP+" photo(s) could not be rebuilt)"):"")+" — no embedded payload");
        /* the page-load message lands after this, so say it in a way that survives: a toast plus a
           status set on the next tick */
        const n=rA.length+rL.length;
        const msg="This report was redlined with this tool — recovered "+n+" redline"+(n===1?"":"s")+
                  " from its annotations"+
                  (rP?(", but "+rP+" photo"+(rP===1?"":"s")+" could not be rebuilt — re-add "+
                       (rP===1?"it":"them")):"")+
                  ". They are editable; edit here and re-export.";
        try{ toast("Recovered "+n+" redline"+(n===1?"":"s")+" from this file"); }catch(e){}
        setStatus(msg);
        setTimeout(()=>{ try{ setStatus(msg); }catch(e){} },350);
      }
      return;
    }
    const data=_tagDec(subj.slice(_mark.length));
    if(!data||(!data.annos&&!data.lines))return;
    S.annos=data.annos||[]; S.lines=data.lines||[];
    let mx=0; S.annos.concat(S.lines).forEach(o=>{ if(o.id>mx)mx=o.id; }); seq=mx+1;
    if(data.stamp){ if(data.stamp.tcol){$("#c_text").value=data.stamp.tcol;} if(data.stamp.bcol){$("#c_bg").value=data.stamp.bcol;} }
    layoutAnnos(); drawAllLines(); updateRail(); updateCount();
    S.history=[]; S.future=[]; updateUndoUI();
    LOG("Restored embedded redlines:",S.annos.length,"text,",S.lines.length,"lines");
    /* 6fd — AND THIS BRANCH HAS TO SAY SO AS LOUDLY AS THE OTHER ONE. The page-load message
       ("49 pages loaded · click any cell to redline") is set AFTER this and overwrote it, so a reopen
       that had correctly restored every mark looked exactly like a reopen that had found nothing —
       measured: 3 marks and 3 lines restored, and the status line said "49 pages loaded". A toast and a
       delayed re-assert, the same treatment the recovery branch already had. */
    const rn=S.annos.length+S.lines.length;
    const rmsg="Reopened with "+rn+" saved redline"+(rn===1?"":"s")+
               " — editable. This file already shows those marks; edit here and re-export.";
    try{ toast("Reopened with "+rn+" saved redline"+(rn===1?"":"s")); }catch(e){}
    setStatus(rmsg);
    setTimeout(()=>{ try{ setStatus(rmsg); }catch(e){} },350);
  }catch(e){ LOG("restoreEmbedded skipped",e); }
}

/* ================= power-user additions (tool hotkeys, nudge, duplicate, fit, find, marks drawer) ================= */

/* keep the parts of the app that touch the current page/selection reused below */
/* ================================================================================================
   6ex — TWO GUARDS, NOT ONE. Every shortcut in the tool asked one question — "is the caret in a text
   field?" — and answered it for ANY input on the page, the ribbon's own controls included. So the moment
   you used Find, or typed a size, or touched the page box, the caret stayed there and the whole keyboard
   went quiet: measured on the real form, with the caret left in the Find box, Ctrl+Z and Ctrl+Y did
   nothing at all (24 marks before, 24 after, the history untouched), and Delete, Escape, Ctrl+A, Ctrl+G,
   Ctrl+D and every letter hotkey were dead with it. Nothing on screen said why, and the only way out was
   to click somewhere else — which is exactly "some keys are not working".

   A keystroke is text input in two places, and only two: inside a MARK's own text, and inside the Analyze
   modal, where the grid has its own undo. Everywhere else a ribbon field is holding the caret by accident.

       _editTarget()    the caret is somewhere a keystroke really is text — .ed, or the Analyze modal.
                        This gates the CHORDED keys (Ctrl+Z/Y/A/G/D/S/E) and Escape.
       _typingTarget()  the caret is in any text field at all. This still gates the PLAIN letters
                        (S R W C T L F M D) and Delete/Backspace, because "d" typed into Find must not
                        flip the theme and Delete must not remove a mark while you edit a search term.

   And the caret is handed back the moment you touch the document — see the pointerdown below — so a field
   cannot hold it while you work on the page.
   ================================================================================================ */
function _typingTarget(){ const ae=document.activeElement; return ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||(ae.classList&&ae.classList.contains("ed"))); }
function _editTarget(){
  const ae=document.activeElement; if(!ae)return false;
  if(ae.classList&&ae.classList.contains("ed"))return true;
  if(ae.tagName!=="INPUT"&&ae.tagName!=="TEXTAREA"&&ae.tagName!=="SELECT")return false;
  try{ const m=document.getElementById("maPanel");
       if(m&&m.classList.contains("show")&&m.contains(ae))return true;
       const z=document.getElementById("maAnalyze");
       if(z&&z.classList.contains("show")&&z.contains(ae))return true; }catch(e){}
  return false;
}
/* a ribbon or panel field holding the caret while you work on the document: give it back */
function _releaseChromeFocus(){
  const ae=document.activeElement;
  if(!ae||ae===document.body)return false;
  if(ae.classList&&ae.classList.contains("ed"))return false;      // a mark being edited keeps it
  if(ae.tagName!=="INPUT"&&ae.tagName!=="TEXTAREA")return false;
  try{ const m=document.getElementById("maPanel");
       if(m&&m.classList.contains("show")&&m.contains(ae))return false; }catch(e){}
  try{ ae.blur(); }catch(e){}
  return true;
}
/* 6js — THE DOCUMENT GETS THE KEYBOARD BACK THE MOMENT THE HAND LEAVES A FIELD.
   Ced: "the keyboard shortcuts are not working again. please fix and make sure this will not get a
   fallback again." Measured: every shortcut works with the caret nowhere — and every plain-letter one
   is dead the moment any field in the tool's own chrome holds it. Focus the width box in a tool's
   properties, or the Find box, and B, O, L, R and the rest do nothing at all, with nothing on screen
   to say why. That is the fault, and it has come back twice because the release was written as a list
   of places that give the keyboard back: the page, a mark, the drawing layer, the rail. Every control
   added since — the mini bar's site field, the properties panels, the overflow menus — was a new way
   to lose it that the list did not know about.
   It is one rule now, and it is the opposite way round: a press on anything that is NOT a text field
   hands the keyboard back. Nothing has to be added to a list when a control is added, and the only
   way to keep the caret is to be typing in something. */
document.addEventListener("pointerdown",e=>{
  const t=e.target;
  if(!t||!t.closest)return;
  /* a press inside a field, or on the label that focuses one, keeps the caret where it is */
  if(t.closest("input,textarea,select,[contenteditable=true],label"))return;
  _releaseChromeFocus();
},true);

/* ---- arrow-key nudge of the selected redline(s); one undo entry per burst ---- */
let _nudgePre=null,_nudgeT=null;
function nudgeSelected(dxpx,dypx){
  const ids=S.selMulti.size?[...S.selMulti]:(S.sel!=null?[S.sel]:[]);
  /* 6fg — A SINGLY-SELECTED LINE COULD NOT BE NUDGED. This read only the multi-select set, so arrow keys
     moved a mark but did nothing to a line you had simply clicked — `selectLine` sets `S.selLine`, not
     `S.selMultiL`. Found while testing whether the recovered strike on Ced's GRANMI2713 was really an
     object: it selected, and then would not move. Now derived the same way `ids` is, one line above. */
  const lids=S.selMultiL.size?[...S.selMultiL]:(S.selLine!=null?[S.selLine]:[]);
  if(!ids.length&&!lids.length)return false;
  if(_nudgePre===null)_nudgePre=snapshot();
  clearTimeout(_nudgeT);
  _nudgeT=setTimeout(()=>{ if(_nudgePre!==null){ S.history.push(_nudgePre); if(S.history.length>80)S.history.shift(); S.future=[]; updateUndoUI(); autosave(); _nudgePre=null; } },500);
  const dims=pi=>{ const pg=document.querySelector(`.page[data-idx="${pi}"]`); return {w:pg?pg.offsetWidth:1000,h:pg?pg.offsetHeight:1300}; };
  ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); if(!a)return; const {w,h}=dims(a.page);
    a.nx+=dxpx/w; a.ny+=dypx/h;
    /* 6gu — and the arrow keeps its place when the box is nudged, exactly as when it is dragged: the
       nudge is how a note is squared up against something, which is the moment you least want the tip
       to wander off what it points at. */
    if(a.maKind==="dimlabel"){ try{ maDimLabelFreed(a); }catch(e){} } });
  lids.forEach(id=>{ const l=S.lines.find(z=>z.id===id); if(!l)return; const {w,h}=dims(l.page);
    const moved=linePts(l).map(p=>[p[0]+dxpx/w,p[1]+dypx/h]);
    if(l.pts)l.pts=moved;
    l.x1=moved[0][0]; l.y1=moved[0][1];
    l.x2=moved[moved.length-1][0]; l.y2=moved[moved.length-1][1]; });
  layoutAnnos();
  if(lids.length||ids.some(id=>{const a=S.annos.find(z=>z.id===id);return a&&a.maKind==="callout";}))drawAllLines();
  if(multiCount()){ paintMulti(); }
  else if(S.sel!=null){ selectAnno(S.sel); }
  updateRail(); refreshMarks();
  return true;
}

/* ---- duplicate the selected redline(s), offset slightly (Ctrl+D) ---- */
function duplicateSelected(){
  const ids=S.selMulti.size?[...S.selMulti]:(S.sel!=null?[S.sel]:[]);
  if(!ids.length)return false;
  pushHistory();
  const newIds=[];
  ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); if(!a)return;
    const P=S.pages[a.page]; const off=P?10/P.w1:0.012;
    const b={..._cleanA(a),id:seq++,nx:a.nx+off,ny:a.ny+off};
    topZ(b); S.annos.push(b); newIds.push(b.id);   /* 6i3 — a copy lands on top too */
    /* 6g9 — a callout duplicates whole: the copy gets its own leader */
    if(b.maKind==="callout"){ try{ maCalloutCopyFor(a.id,b); }catch(e){} }
    /* 6gg — a copy of a READING belongs to no measurement, so it becomes an ordinary note rather
       than an orphan the next draw pass would sweep away */
    if(b.maKind==="dimlabel"){ b.maKind="text"; b.dimFree=undefined; b.dimOff=undefined; } });
  if(!newIds.length)return false;
  clearMulti(); S.sel=null;
  layoutAnnos(); updateRail(); updateCount();
  if(newIds.length===1){ selectAnno(newIds[0]); }
  else { newIds.forEach(id=>S.selMulti.add(id)); paintMulti(); }
  toast(`Duplicated ${newIds.length} redline${newIds.length>1?"s":""}`);
  return true;
}

/* ---- fit page width to the window ---- */
function fitWidth(){
  if(!S.doc||!S.pages.length)return;
  const railW=document.body.classList.contains("railon")?74:0;
  const marksW=document.body.classList.contains("markson")?300:0;
  const avail=window.innerWidth-railW-marksW-40;
  const w1=S.pages[0].w1||612;
  if(avail>60) setZoom(avail/w1);
}
$("#fitBtn").onclick=fitWidth;
/* Nitro-style view options: fit width, fit a whole page, actual size, two-up. */
function fitPage(){
  const P=S.pages[0]; if(!P||!P.page)return;
  const vp=P.page.getViewport({scale:1});
  const root=$("#pages")||document.body;
  const availW=Math.max(200,(root.clientWidth||window.innerWidth)-48);
  const availH=Math.max(200,window.innerHeight-170);
  setZoom(Math.min(availW/vp.width, availH/vp.height));
}
function actualSize(){ setZoom(1); }
/* The element that actually scrolls the pages — snap has to go on that, not on #pages. */
/* 6gb — HOLD SPACE TO PAN, the way every drawing program does it. It is a latch rather than a mode:
   nothing about the tool in your hand changes, and letting go puts the hand away. */
let _spacePan=false;
document.addEventListener("keydown",e=>{
  if(e.code!=="Space"||_spacePan)return;
  if(_editTarget&&_editTarget())return;
  const t=e.target;
  if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.tagName==="SELECT"||t.isContentEditable))return;
  _spacePan=true; document.body.classList.add("spacepan"); e.preventDefault();
});
document.addEventListener("keyup",e=>{ if(e.code!=="Space")return;
  _spacePan=false; document.body.classList.remove("spacepan"); });
window.addEventListener("blur",()=>{ _spacePan=false; document.body.classList.remove("spacepan"); });
function pagesScroller(){
  let e=$("#pages");
  while(e&&e!==document.body){
    const st=getComputedStyle(e);
    if(/(auto|scroll)/.test(st.overflowY)&&e.scrollHeight>e.clientHeight+4)return e;
    e=e.parentElement;
  }
  return document.scrollingElement||document.documentElement;
}
let _pageView=false, _viewPi=0;
/* Page view shows ONE page at a time.
   The first attempt used CSS scroll snapping with `mandatory`, which traps the scroller on any page
   taller than the window — you could not reach the bottom of a page. Showing a single page has no such
   failure mode: the page scrolls normally because it is the only thing in the flow. */
function togglePageView(){
  _pageView=!_pageView;
  const b=$("#pageViewBtn"); if(b)b.classList.toggle("on",_pageView);
  if(_pageView){ _viewPi=currentPageIdx(); showOnlyPage(_viewPi); }
  else { showAllPages(); }
  /* the ribbon only shows on a deliberate move to the top while in page view */
  document.body.classList.toggle("chromehide",_pageView);
  if(!_pageView)document.body.classList.remove("chromeshow");
  try{ updateMiniBar(); }catch(e){}     /* 6gp — page view is a state; the bar's remote shows it */
  const bar=$("#pagerBar"); if(bar)bar.classList.toggle("show",_pageView);
  setStatus(_pageView?("Page view — showing page "+(_viewPi+1)+" of "+S.pages.length
            +". Use ‹ › or PageUp/PageDown."):"Continuous view — all pages.");
}
function showAllPages(){
  document.querySelectorAll(".page,.page-bar").forEach(e=>{ e.style.display=""; });
}
function showOnlyPage(i){
  const _sameI=(typeof _viewPi==="number"&&_viewPi===Math.max(0,Math.min(S.pages.length-1,i)));
  _viewPi=Math.max(0,Math.min(S.pages.length-1,i));
  document.querySelectorAll(".page").forEach(p=>{
    const on=(+p.dataset.idx===_viewPi);
    p.style.display=on?"":"none";
    const bar=p.previousElementSibling;
    if(bar&&bar.classList.contains("page-bar"))bar.style.display=on?"":"none";
  });
  try{ ensurePageRendered(_viewPi); }catch(e){}
  const sc=pagesScroller(); if(sc&&sc.scrollTop!==undefined)sc.scrollTop=0;
  const lbl=$("#pagerLbl"); if(lbl)lbl.textContent=(_viewPi+1)+" / "+S.pages.length;
  document.querySelectorAll("#rail .rt").forEach(b=>b.classList.toggle("cur",+b.dataset.idx===_viewPi));
  setStatus("Page "+(_viewPi+1)+" of "+S.pages.length+".");
}
function stepPage(d){ if(_pageView)showOnlyPage(_viewPi+d); }
/* 6ey — renamed, and it is the ONE implementation: `currentPageIdx` above delegates here rather than
   being silently shadowed by it. */
/* 6gf — WHICH PAGE AM I LOOKING AT, measured where the eye is rather than in scroll coordinates.

   This used to compare each page's `offsetTop` against a scroller's `scrollTop`. Those are two
   different coordinate systems the moment the scrolling element is not the page's offset parent, and
   when they drifted apart the answer came out ONE PAGE HIGH — Ctrl+A then selected nothing, because it
   was acting on the page above the one on screen. A rect against the viewport cannot drift: it is the
   same number the user is looking at. The probe line sits a little below the top so a page scrolled
   just past the header still counts as the one you are on. */
function _scrollPageIdx(){
  if(_pageView)return _viewPi;
  const probe=Math.min(160, Math.round(window.innerHeight*0.28));
  let best=0, bd=1e9, hit=null;
  document.querySelectorAll(".page").forEach(p=>{
    const r=p.getBoundingClientRect(), idx=+p.dataset.idx||0;
    if(hit===null && r.top<=probe && r.bottom>probe)hit=idx;   /* the page under the probe line */
    const d=Math.abs(r.top-probe);
    if(d<bd){ bd=d; best=idx; }
  });
  return hit!==null ? hit : best;
}
function gotoPageInstant(i){
  if(_pageView){ showOnlyPage(i); return; }
  const p=document.querySelector('.page[data-idx="'+i+'"]');
  if(p)p.scrollIntoView({behavior:"auto",block:"start"});
}
(function(){
  const b=$("#pageViewBtn"); if(b)b.onclick=togglePageView;
  const pv=$("#pagerPrev"); if(pv)pv.onclick=()=>stepPage(-1);
  /* The reveal zone is a THIN strip at the very top of the tool — not the ribbon's whole height, which
     covered the page and the rail and so opened on almost any upward move. It also never opens from the
     pages rail, and stays open while the pointer is actually on the ribbon. */
  /* 6eo — 9px was a strip you had to aim at, which was fine while the ribbon was merely dimmed and is
     not fine now that it is the only way back to it. The peek pill is about 18px tall, so the zone is
     the pill plus a little. */
  /* 6gc — 26px was the pill's height back when the pill hung off the top edge. The compact bar now
     occupies y 0..34, so a 26px reveal zone covered its whole left half: reaching for Save dropped the
     ribbon on top of the button you were aiming at. The zone is the 10px strip and nothing more, and
     the dots are the deliberate, aimable way in. */
  const REVEAL_PX=10;
  document.addEventListener("mousemove",e=>{
    if(!document.body.classList.contains("chromehide"))return;
    if(RIBBON_SIDE())return;
    const tb=$("#toolbar");
    const onRibbon=tb&&document.body.classList.contains("chromeshow")&&
                   e.clientY<=tb.getBoundingClientRect().bottom+4;
    const onRail=!!(e.target&&e.target.closest&&e.target.closest("#rail"));
    const onBar=!!(e.target&&e.target.closest&&e.target.closest("#miniBar"));
    const inStrip=e.clientY<=REVEAL_PX&&!onRail;
    document.body.classList.toggle("chromeshow",!!(inStrip||(onRibbon&&!onBar)));
  },{passive:true});
  /* Wheel: scroll within the page until its edge, then step to the next or previous page. */
  let _wheelLock=0;
  document.addEventListener("wheel",e=>{
    if(!_pageView)return;
    if(e.target&&e.target.closest&&(e.target.closest("#rail")||e.target.closest("#logPanel")||
       e.target.closest(".az-box")))return;
    const sc=pagesScroller(); if(!sc)return;
    const atTop=sc.scrollTop<=1, atBot=sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1;
    const down=e.deltaY>0;
    if((down&&!atBot)||(!down&&!atTop))return;      // still room to scroll inside this page
    const now=Date.now(); if(now<_wheelLock)return;  // one page per gesture
    const n=S.pages.length, next=_viewPi+(down?1:-1);
    if(next<0||next>=n)return;
    _wheelLock=now+320;
    e.preventDefault();
    showOnlyPage(next);
    if(!down){ try{ sc.scrollTop=sc.scrollHeight; }catch(err){} }  // arrive at the foot going back
  },{passive:false});
  /* keep it visible while a control in it has focus, so tabbing does not hide it mid-use */
  document.addEventListener("focusin",e=>{
    const tb=$("#toolbar");
    if(tb&&tb.contains(e.target))document.body.classList.add("chromeshow");
  });
  const nx=$("#pagerNext"); if(nx)nx.onclick=()=>stepPage(1);
  /* Leaving page view must never depend on the hidden ribbon — the pager carries its own exit, and Esc
     works too. */
  const ex=$("#pagerExit"); if(ex)ex.onclick=()=>{ if(_pageView)togglePageView(); };
  document.addEventListener("keydown",e=>{
    if(_pageView&&e.key==="Escape"&&!_typingTarget()){ e.preventDefault(); togglePageView(); }
  });
  document.addEventListener("keydown",e=>{
    if(!_pageView||_typingTarget())return;
    if(e.key==="PageDown"||e.key==="ArrowRight"){ e.preventDefault(); stepPage(1); }
    else if(e.key==="PageUp"||e.key==="ArrowLeft"){ e.preventDefault(); stepPage(-1); }
  });
})();
let _facing=false;
function toggleFacing(){
  _facing=!_facing;
  const root=$("#pages");
  if(root)root.classList.toggle("facing",_facing);
  const b=$("#facingBtn"); if(b)b.classList.toggle("on",_facing);
  setStatus(_facing?"Two pages side by side.":"One page per row.");
  /* wrapping alone does nothing while each page is wider than half the pane — halve the zoom too */
  const P=S.pages[0];
  if(P&&P.page){
    const vp=P.page.getViewport({scale:1});
    const rootEl=$("#pages")||document.body;
    const availW=Math.max(200,(rootEl.clientWidth||window.innerWidth)-48);
    if(_facing) setZoom((availW*0.47)/vp.width);
    else fitWidth();
  }
}
(function(){
  const fp=$("#fitPageBtn"); if(fp)fp.onclick=fitPage;
  const as=$("#actualBtn"); if(as)as.onclick=actualSize;
  const fc=$("#facingBtn"); if(fc)fc.onclick=toggleFacing;
})();

/* ---- find in document ---- */
let _find={q:"",matches:[],idx:-1};
let _findT=null;
function clearFindHits(){ document.querySelectorAll(".tspan.findhit").forEach(b=>b.classList.remove("findhit")); }
function runFind(q){
  _find.q=q; _find.matches=[]; _find.idx=-1;
  clearFindHits();
  const needle=String(q||"").trim().toLowerCase();
  if(!needle){ $("#findCount").textContent=""; return; }
  for(let pi=0;pi<S.pages.length;pi++){
    S.pages[pi].items.forEach(it=>{ if(it.str&&it.str.toLowerCase().includes(needle)) _find.matches.push({pi,it}); });
  }
  $("#findCount").textContent=_find.matches.length?`0/${_find.matches.length}`:"none";
  if(_find.matches.length) gotoFind(0);
}
function gotoFind(i){
  if(!_find.matches.length)return;
  _find.idx=((i%_find.matches.length)+_find.matches.length)%_find.matches.length;
  const m=_find.matches[_find.idx];
  const pg=document.querySelector(`.page[data-idx="${m.pi}"]`);
  if(pg) pg.scrollIntoView({behavior:"auto",block:"center"});
  $("#findCount").textContent=`${_find.idx+1}/${_find.matches.length}`;
  setTimeout(()=>{
    clearFindHits();
    const b=document.querySelector(`.tspan[data-key="${keyOf(m.pi,m.it)}"]`);
    if(b){ b.classList.add("findhit"); b.scrollIntoView({behavior:"auto",block:"center"}); }
  },360);
}
$("#findInput").addEventListener("input",e=>{ clearTimeout(_findT); const v=e.target.value; _findT=setTimeout(()=>runFind(v),200); });
$("#findInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){ e.preventDefault(); if(!_find.matches.length){ runFind(e.target.value); return; } gotoFind(_find.idx+(e.shiftKey?-1:1)); }
  else if(e.key==="Escape"){ e.target.value=""; runFind(""); e.target.blur(); }
});
$("#findPrev").onclick=()=>gotoFind(_find.idx-1);
$("#findNext").onclick=()=>gotoFind(_find.idx+1);

/* ---- Redlines drawer: list every mark, click to jump, ✕ to delete ---- */
function refreshMarks(){
  const panel=$("#marksPanel"); if(!panel||!panel.classList.contains("show"))return;
  const list=$("#marksList"); list.innerHTML="";
  const items=[];
  /* A mark with words is named by its words; a mark without any — a box round a member, an ellipse, a
     markup — is named by what it IS. "(empty)" told you nothing about eleven identical rows. */
  const shapeName=a=>(shapeOf(a)==="ellipse"?"◯ circle":"▢ box");
  S.annos.forEach(a=>{
    const words=(a.text&&a.text.trim())?a.text.trim().replace(/\s+/g," "):"";
    let label;
    if(a.kind==="img")label=(a.maKind==="markup"?"🖼 markup":"🖼 photo");
    else if(isShape(a))label=words?(shapeName(a)+" · "+words):shapeName(a);
    else label=words||"(empty text)";
    items.push({type:"text",page:a.page,id:a.id,label});
  });
  S.lines.forEach(l=>{
    const n=(l.pts||[]).length;
    const label=(n>2)?("⤳ polyline · "+n+" points"):(l.arrow?"↗ arrow":"— line / strike");
    items.push({type:"line",page:l.page,id:l.id,label});
  });
  $("#marksTitle").textContent=`Redlines (${items.length})`;
  if(!items.length){ list.innerHTML='<div class="mk-empty">No redlines yet. Marks you add show up here.</div>'; return; }
  items.sort((a,b)=>a.page-b.page||a.id-b.id);
  let curP=-1;
  items.forEach(m=>{
    if(m.page!==curP){ curP=m.page; list.appendChild(el("div","mk-ph",`Page ${m.page+1}`)); }
    const row=el("div","mk-row");
    const t=el("div","mk-t"+(m.type==="line"?" strike":"")); t.textContent=m.label; t.title=m.label+" — click to jump";
    t.onclick=()=>jumpToMark(m);
    const x=el("button","mk-x","✕"); x.title="Delete this redline";
    x.onclick=ev=>{ ev.stopPropagation(); pushHistory();
      if(m.type==="text"){ S.annos=S.annos.filter(z=>z.id!==m.id); if(S.sel===m.id){S.sel=null;annobar.classList.remove("show");} }
      else { S.lines=S.lines.filter(z=>z.id!==m.id); if(S.selLine===m.id){S.selLine=null;$("#linebar").classList.remove("show");} }
      layoutAnnos(); drawAllLines(); updateRail(); updateCount(); };
    row.appendChild(t); row.appendChild(x); list.appendChild(row);
  });
}
function jumpToMark(m){
  const pg=document.querySelector(`.page[data-idx="${m.page}"]`);
  if(pg)pg.scrollIntoView({behavior:"auto",block:"center"});
  setTimeout(()=>{ if(m.type==="text")selectAnno(m.id); else selectLine(m.id); },360);
}
function toggleMarks(){ const p=$("#marksPanel"); const on=p.classList.toggle("show"); try{ syncEmbossSoon(); }catch(e){} document.body.classList.toggle("markson",on); $("#marksBtn").classList.toggle("tool",on); $("#marksBtn").classList.toggle("active",on); if(on)refreshMarks();
  try{ updateMiniBar(); }catch(e){} }   /* 6hb — and the button says so */
$("#marksBtn").onclick=toggleMarks;
$("#marksClose").onclick=toggleMarks;

/* said at most once every few seconds, so holding a key down does not fill the status bar */
let _hkSaid=0;
function _hotkeyHeld(inMark){
  const now=Date.now(); if(now-_hkSaid<2500)return; _hkSaid=now;
  try{ setStatus(inMark
    ? "The caret is in this mark's text, so the letter was typed rather than used as a shortcut — Escape steps out."
    : "The caret is in a field, so the shortcuts are paused — press Escape, or click the sheet, to get them back."); }catch(e){}
}
/* ---- keyboard shortcuts: tool hotkeys + arrow nudge + Ctrl+D duplicate + F (find) / M (marks) ---- */
document.addEventListener("keydown",e=>{
  // Ctrl+D duplicate (works even mid-selection; never when typing)
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="d"){ if(_editTarget())return; if(duplicateSelected())e.preventDefault(); return; }
  /* 6cc — Ctrl+S saves, Ctrl+E exports. Both take the key off the browser: Ctrl+S would otherwise open
     "save this page as HTML", which looks like it worked and saves entirely the wrong thing. Both are
     claimed even when the button is disabled, so the shortcut never silently falls through to the
     browser — it says why instead. */
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==="s"){
    if(_editTarget())return;
    e.preventDefault();
    if(!S.doc){ setStatus("Open an RFDS first — there is nothing to save.",true); return; }
    const b=$("#saveBtn");
    if(!b||b.disabled){ setStatus("Nothing to save yet.",true); return; }
    /* Click the button rather than calling the handler: the ribbon button stays the single definition of
       what Save does, so rewiring it can never leave the shortcut pointing at the old path. */
    try{ b.click(); }catch(err){ setStatus("Save failed: "+(err&&err.message||err),true); }
    return;
  }
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==="e"){
    if(_editTarget())return;
    e.preventDefault();
    if(!S.doc){ setStatus("Open an RFDS first — there is nothing to export.",true); return; }
    const b=$("#dlPdf");
    if(!b||b.disabled){ setStatus("The export is not ready yet.",true); return; }
    try{ b.click(); }catch(err){ setStatus("Export failed: "+(err&&err.message||err),true); }
    return;
  }
  /* Ctrl+Shift+A opens Assist. It is claimed above the plain Ctrl+A below, which matches on
     `key==="a"` without checking Shift and would otherwise read the chord as "select everything on
     this page". 6kx — it opens MARKUPS now: the Notes button it used to press is gone. */
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="a"){
    if(_editTarget())return;
    e.preventDefault();
    const b=$("#markupsBtn");
    if(b&&!b.disabled)b.click();
    return;
  }
  /* Ctrl+Shift+L opens the loading table */
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="l"){
    if(_editTarget())return;
    e.preventDefault();
    const b=$("#analyzeMaBtn");
    if(b&&!b.disabled)b.click();
    return;
  }
  // Ctrl+A selects every mark on the page you're looking at
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){ if(_editTarget()||!S.doc)return; e.preventDefault(); selectAllOnPage(); return; }
  if(e.ctrlKey||e.metaKey||e.altKey)return;   // leave other combos alone
  /* 6js — and when a hotkey IS swallowed because something is being typed into, say so. A shortcut
     that does nothing and explains nothing is the thing that gets reported as "broken again"; one
     that tells you the caret is in a field is a thing you fix in one keystroke. */
  if(_typingTarget()){
    const k0=(e.key||"").toLowerCase();
    if(k0.length===1&&/[a-z\/]/.test(k0)&&S.doc){
      const ae=document.activeElement;
      const inMark=!!(ae&&ae.classList&&ae.classList.contains("ed"));
      _hotkeyHeld(inMark);
    }
    return;                                    // don't hijack typing
  }
  /* 6bz: the theme hotkey sat below the `if(!S.doc)return` guard, so it did nothing on the opening screen
     even though the help advertised it. Appearance is not a document action — it stays above the guard.
     6cc: it moved from T to D, because T is now Strike text.
     6i4 — AND NOW OFF D ALTOGETHER. Ced: "make all the hot keys work too." D is the Length tool's key —
     it is printed on the button and in the help — and this line claimed it first, so the one tool with
     a documented hotkey did not have one: pressing D flipped the theme instead. A TOOL beats a setting
     for a bare letter; day/night keeps the same letter with Shift. */
  if(e.shiftKey&&e.key.toLowerCase()==="d"){ toggleTheme(); e.preventDefault(); return; }
  if(!S.doc)return;
  const k=e.key.toLowerCase();
  // arrow-key nudge of the selection
  if(["arrowleft","arrowright","arrowup","arrowdown"].includes(k)){
    /* 6fg — `S.selLine` belongs here too; without it the guard threw away every arrow key pressed with a
       single line selected, before nudgeSelected ever saw it */
    if(!(multiCount()||S.sel!=null||S.selLine!=null))return;
    const step=e.shiftKey?8:1;
    const dx=k==="arrowleft"?-step:k==="arrowright"?step:0;
    const dy=k==="arrowup"?-step:k==="arrowdown"?step:0;
    if(nudgeSelected(dx,dy))e.preventDefault();
    return;
  }
  /* The tool hotkeys:
       S select · R redline · F strike & write · K callout · W strike row · C copy row
       T strike text · L line · A arrow · P polyline · B box · O circle · X cross out · E text box */
  const map={s:"select",h:"pan",r:"redline",e:"text",f:"fix",k:"callout",w:"strikerow",t:"cross",
             l:"line",x:"crossout",b:"box",o:"circle",a:"arrow",p:"poly",d:"dim"};
  if(map[k]){ setMode(map[k]); selectAnno(null); selectLine(null); e.preventDefault(); return; }
  /* 6ey — and ask the browser not to scroll at all on the way in. `preventScroll` is honoured by every
     current engine; the focusin guard above is the belt to this brace, for a click or a Tab. */
  if(k==="/"){ const fi=$("#findInput");
    if(fi&&!fi.disabled){ try{ fi.focus({preventScroll:true}); }catch(err){ fi.focus(); }
                          fi.select(); e.preventDefault(); } return; }
  if(k==="m"){ toggleMarks(); e.preventDefault(); return; }
  if(k==="g"&&(S.selMulti.size>1)){ /* handled in ctrl block; plain g ignored */ }
});

/* Esc drops the current selection (paste-placement and dialogs handle Esc themselves) */
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||_placing)return;
  if($("#dlg").classList.contains("show")||($("#maPanel")&&$("#maPanel").classList.contains("show"))
     ||($("#maAnalyze")&&$("#maAnalyze").classList.contains("show")))return;
  /* 6ex — Escape is the way OUT of a field as well. A ribbon control holding the caret is what silences
     the plain-letter hotkeys, so Escape gives it back and says so; a second Escape then clears the
     selection as it always did. */
  /* THE CARET IS IN A MARK'S TEXT. Escape steps out of the text and keeps the mark selected, which is
     the state every other key then expects: Delete removes it, the arrows nudge it, the properties panel
     restyles it. Without this the only way out of a mark was to click somewhere else, and Delete —
     pressed on a mark you had just drawn — silently did nothing, because the browser read it as an
     edit to the text. */
  {
    const ae=document.activeElement;
    if(ae&&ae.classList&&ae.classList.contains("ed")){
      try{ ae.blur(); }catch(_){}
      try{ const sel=window.getSelection(); if(sel&&sel.removeAllRanges)sel.removeAllRanges(); }catch(_){}
      /* 6jt — and the TOOL STAYS IN THE HAND. 6gt made Escape always land on Select, which is one
         press too many of a hand that was about to draw the next one. Ced: "a single esc click will
         deselect the shape while double esc click will put the tool to select." Stepping out of the
         text is the first of those two presses. */
      _escArmed=true;      /* 6m9 — that was rung one */
      setStatus("Out of the text — the redline is selected. Escape again puts the tool down.");
      return;
    }
  }
  if(_releaseChromeFocus()){ _escArmed=true;   /* 6m9 */
    setStatus("Back to the document — the shortcuts are live again."); return; }
  if(_editTarget())return;
  /* 6jx — a start point waiting for its end is the nearest thing to undo.
     6l7 — and a run with only its START point down has drawn nothing, so this press is the one Ced
     means by "the esc click (once) should always put the tool on select if it was not from a tool":
     the run is called off AND the tool goes down, in the one press. A run with real segments behind
     it (a polyline three corners in) is work, so there the first press only ends the run. */
  if(clickRunActive()){
    const bare=!(typeof _maPoly!=="undefined"&&_maPoly&&_maPoly.pts&&_maPoly.pts.length>1);
    clickRunClear();
    if(bare&&S.mode!=="select"){ setMode("select"); setStatus("Back to Select."); }
    return;
  }
  /* 6jt — ESCAPE IS A LADDER, NOT A SWITCH. Ced: "when you are in a tool mode, the tool should still
     work in one esc click, a single esc click will deselect the shape while double esc click will put
     the tool to select."
     6gt had made one press do both, on an earlier request that Escape should always reach Select — and
     the cost of that is the common case: you draw a box, it comes up selected, you press Escape to get
     the handles out of the way, and the tool you were about to draw the next box with has gone too.
     So each press undoes one thing, nearest first:
         a point being placed  ->  the run in progress (handled where it is drawn)
         the caret in a mark   ->  out of the text, mark still selected
         the caret in a field  ->  back to the document
         a selection           ->  dropped, TOOL STILL IN HAND
         a tool in hand        ->  put down, Select active
     Nothing is lost: two presses still reach Select, which is what the earlier request asked for. */
  /* 6jz — INSIDE A GROUP, THE FIRST PRESS IS THE WAY BACK OUT. Each rung still undoes exactly one
     thing: this one undoes the double-click that went in, leaving the group picked up as a whole,
     exactly as it was before. The group itself is never altered by either direction. */
  if(_grpIn!=null){
    const g=_grpIn; groupLeave();
    if(S.annos.some(a=>a.group===g)||S.lines.some(l=>l.group===g))selectGroup(g);
    else { clearMulti(); selectAnno(null); selectLine(null); }
    _escArmed=true;      /* 6m9 */
    setStatus("Out of the group — the group is selected again, whole.");
    return;
  }
  /* ================================================================================================
     6m9 — TWO RUNGS, NOT FIVE. Ced: "when esc was clicked, always go to select current redline.
     double esc is select tool."

     6jt built Escape as a ladder where each press undid exactly one thing — the caret, then the
     field, then the group, then the selection, then the tool. Every rung was defensible on its own
     and the sum was not: from inside a mark's text with a tool in the hand it took FOUR presses to
     reach Select, and a hand cannot count rungs it cannot see.

     Ced's rule is two rungs and it is a better rule, because each one names a state you can picture:

         press once   the current redline is SELECTED — the caret is out of it, any half-drawn run is
                      called off, an open group is closed, and the mark itself stays picked up
         press again  the tool is put down: the selection goes and Select is active

     Everything that used to be its own rung now happens inside the first press, which is what makes
     the count fixed. The one case that still reaches Select in a single press is the one where there
     is nothing to settle — no caret, no run, nothing selected — because then the first rung has no
     work to do and doing nothing is not an answer.
     ================================================================================================ */
  const hadSel=(multiCount()||S.sel!=null||S.selLine!=null);
  if(hadSel&&!_escArmed){
    _escArmed=true;
    setStatus(S.mode!=="select"
      ? "The redline is selected — Escape again puts the tool down."
      : "The redline is selected — Escape again drops it.");
    return;
  }
  clearMulti(); selectAnno(null); selectLine(null);
  _escArmed=false;
  if(S.mode!=="select"){ toolRelease(); setStatus("Tool put down — Select is active."); }
  else setStatus(hadSel?"Selection dropped.":"Nothing selected.");
});
/* 6m9 — WHAT MAKES THE SECOND PRESS THE SECOND PRESS. The two rungs have to be told apart, and the
   only honest way is to remember that the last key was an Escape that settled something. Anything
   else a hand does — a click, a drag, another key — means the next Escape starts the ladder again,
   so the flag is cleared by both, in the capture phase, before any handler can act on them. */
let _escArmed=false;
document.addEventListener("pointerdown",()=>{ _escArmed=false; },true);
document.addEventListener("keydown",e=>{ if(e.key!=="Escape")_escArmed=false; },true);

/* ------------------------------------------------------------------------------------------------
   Ctrl-select cells, then give them all one value.
     hold Ctrl (or Cmd) and click cells  ->  Backspace  ->  type the value  ->  Enter
   Works on text cells and on dropdowns alike, in every Analyze grid.
   ------------------------------------------------------------------------------------------------ */
const _azSel=new Set();





/* =================================================================================================
   6f9 — SNAP AND MAGNET ARE TWO DIFFERENT THINGS
   =================================================================================================
   Ced: "the snap is not working well. add a snap and magnet and fix its utilization."

   They were one switch doing half a job. `Snap` drew alignment guides against OTHER MARKS while you
   moved one — which on a blank sheet is useful and on a mount analysis is nearly useless, because what
   you actually want to line up with is the printed form: the column rules, the left edge of a value,
   the line a row sits on. And the same switch had been made to straighten a stroke as it was drawn,
   so turning one off turned the other off with it.

   So there are two now, and they do not overlap:

     SNAP    is about ANGLE. A stroke you draw, and a mark you rotate, go to the nearest 15° when they
             are already within a couple of degrees of it — which is how a line comes out exactly level
             or exactly plumb without being forced there. Ctrl suspends it for one gesture; Shift still
             forces level outright.

     MAGNET  is about POSITION. A mark you move, resize, or whose stroke-point you drag is pulled onto
             the nearest edge, centre or baseline — of the other marks on the page AND of the printed
             page itself. That is the half that was missing: `buildSnapTargets` only ever looked at
             marks, so on a page of printed rows there was nothing to pull to.

   Both are remembered in this browser, both have a ribbon button, and the status line says which is on.
   ================================================================================================= */
const SNAP_DEG_STEP=15;      /* the angles a stroke settles on */
const MAGNET_TOL=7;          /* px — how close counts as "on" it */

/* ---- the targets a magnet can pull to, gathered once per gesture ----------------------------------
   Rounded to the half pixel and de-duplicated, because a page of printed text offers the same left
   edge a hundred times over and there is no point comparing against it a hundred times. Sorted, so a
   move event does a binary search rather than walking the list. */
let _magCache=null;
/* 6gs — CTRL PUTS THE MAGNET DOWN FOR ONE GESTURE.
   Ced: "adjusting objects using ctrl should temporarily stop magnet/snap from working."
   The magnet is right almost always and wrong exactly when you are placing something a hair off a
   neighbour on purpose — and fighting it means turning it off in the ribbon and remembering to turn it
   back on. Held while you drag, Ctrl (or Cmd, or Alt, which the stroke points already used) suspends
   it for that gesture only; let go and the next drag is magnetic again. It is read from the LIVE event
   rather than latched at the start, so it can be taken hold of mid-drag. */
function snapOff(e){ return !!(e&&(e.ctrlKey||e.metaKey||e.altKey)); }
function buildSnapTargets(pg,excludeIds){
  const w=pg.offsetWidth,h=pg.offsetHeight, pi=+pg.dataset.idx;
  const key=pi+"|"+w+"x"+h+"|"+(excludeIds||[]).join(",")+"|"+S.annos.length+"|"+S.lines.length;
  if(_magCache&&_magCache.key===key)return _magCache.T;
  const XS=new Set([w/2, w*0]), YS=new Set([h/2]);
  const put=(set,v)=>{ if(v>=-2&&v<=1e5)set.add(Math.round(v*2)/2); };
  /* the other marks on this page */
  S.annos.forEach(o=>{ if(o.page!==pi||(excludeIds||[]).includes(o.id))return;
    const dd=document.querySelector(`.anno[data-id="${o.id}"]`); if(!dd)return;
    const l=parseFloat(dd.style.left)||0, t=parseFloat(dd.style.top)||0, ow=dd.offsetWidth, oh=dd.offsetHeight;
    put(XS,l); put(XS,l+ow/2); put(XS,l+ow);
    put(YS,t); put(YS,t+oh/2); put(YS,t+oh);
  });
  /* and the strokes' own ends and corners */
  S.lines.forEach(l=>{ if(l.page!==pi)return;
    linePts(l).forEach(q=>{ put(XS,q[0]*w); put(YS,q[1]*h); });
  });
  /* 6f9 — AND THE PRINTED PAGE. This is the half that was missing: every printed run offers its left
     edge, its centre, its right edge, its top and its baseline, and those are the lines a correction
     actually wants to sit on. */
  const P=S.pages[pi];
  if(P&&P.items){
    P.items.forEach(t=>{
      const x=t.nx*w, y=t.ny*h, tw=(t.nw||0)*w, th=(t.nh||0)*h;
      put(XS,x); put(XS,x+tw/2); put(XS,x+tw);
      put(YS,y); put(YS,y+th/2); put(YS,y+th);
    });
  }
  const T={xs:[...XS].sort((a,b)=>a-b), ys:[...YS].sort((a,b)=>a-b), w, h};
  _magCache={key,T};
  return T;
}
function dropSnapCache(){ _magCache=null; }
/* the nearest target to `val`, or null if none is within tolerance */
function nearestVal(sorted,val,tol){
  if(!sorted.length)return null;
  let lo=0,hi=sorted.length-1;
  while(lo<hi){ const mid=(lo+hi)>>1; if(sorted[mid]<val)lo=mid+1; else hi=mid; }
  let best=null,bd=(tol||MAGNET_TOL)+0.001;
  for(let k=Math.max(0,lo-2);k<Math.min(sorted.length,lo+3);k++){
    const d=Math.abs(sorted[k]-val); if(d<bd){ bd=d; best=sorted[k]; }
  }
  return best;
}
function nearest(cands,val){ const a=Array.isArray(cands)?cands:(cands&&cands.xs)||[];
  const v=nearestVal(a,val); return v==null?null:{v}; }
/* snap the box (l,t,w0,h0) so any of its left/centre/right hits an x-target, top/mid/bottom a y-target */
function applySnap(T,l,t,w0,h0){
  let gx=null,gy=null,nl=l,nt=t,gxMid=false,gyMid=false;
  const pick=(sorted,edges)=>{
    let best=null;
    edges.forEach(([ev,off])=>{ const v=nearestVal(sorted,ev);
      if(v!=null){ const d=Math.abs(v-ev); if(best===null||d<best.d)best={v,off,d}; } });
    return best;
  };
  const bx=pick(T.xs,[[l,0],[l+w0/2,w0/2],[l+w0,w0]]);
  if(bx){ nl=bx.v-bx.off; gx=bx.v; gxMid=Math.abs(bx.off-w0/2)<0.51; }
  const by=pick(T.ys,[[t,0],[t+h0/2,h0/2],[t+h0,h0]]);
  if(by){ nt=by.v-by.off; gy=by.v; gyMid=Math.abs(by.off-h0/2)<0.51; }
  return {l:nl,t:nt,gx,gy,gxMid,gyMid};
}
/* a single point — a stroke's end or corner — pulled onto the nearest printed or drawn line */
function magnetPoint(pg,nx,ny){
  if(!S.magnet)return {nx,ny,gx:null,gy:null};
  const T=buildSnapTargets(pg,[]);
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const px=nx*w, py=ny*h;
  const vx=nearestVal(T.xs,px), vy=nearestVal(T.ys,py);
  return { nx:(vx!=null?vx/w:nx), ny:(vy!=null?vy/h:ny), gx:vx, gy:vy };
}
function clearSnapGuides(pg){ [...pg.querySelectorAll(".snap-g")].forEach(n=>n.remove()); }
function drawSnapGuides(pg,gx,gy,gxMid,gyMid){
  clearSnapGuides(pg);
  if(gx!=null){ const v=el("div","snap-g v"+(gxMid?" mid":"")); v.style.left=gx+"px"; pg.appendChild(v); }
  if(gy!=null){ const hh=el("div","snap-g h"+(gyMid?" mid":"")); hh.style.top=gy+"px"; pg.appendChild(hh); }
}
/* 6f9 — two switches, each remembered. Snap is the ANGLE one, Magnet the POSITION one; see the
   block above `buildSnapTargets` for why they are not one. */
const SNAPKEY="ma.snap.v2";
function saveSnapPrefs(){ try{ localStorage.setItem(SNAPKEY,JSON.stringify({snap:S.snap,magnet:S.magnet})); }catch(e){} }
function loadSnapPrefs(){
  try{ const v=JSON.parse(localStorage.getItem(SNAPKEY)||"null");
       if(v){ if(v.snap!=null)S.snap=!!v.snap; if(v.magnet!=null)S.magnet=!!v.magnet; } }catch(e){}
  reflectSnapBtns();
}
function reflectSnapBtns(){
  const a=$("#snapBtn"), b=$("#magnetBtn");
  if(a){ a.classList.toggle("active",!!S.snap); a.classList.toggle("on",!!S.snap);
         a.setAttribute("aria-pressed",S.snap?"true":"false"); }
  if(b){ b.classList.toggle("active",!!S.magnet); b.classList.toggle("on",!!S.magnet);
         b.setAttribute("aria-pressed",S.magnet?"true":"false"); }
}
/* 6kt — the toggle no longer reaches a stroke being DRAWN; Shift and Ctrl are how a stroke is given
   a target now, and they work whether this is on or off. What is left to it is what it meant before
   6f6: a rotation settling on 15°, alongside Magnet's alignment guides. */
$("#snapBtn").onclick=()=>{ S.snap=!S.snap; reflectSnapBtns(); saveSnapPrefs();
  toast(S.snap?"Snap on — a turn settles on the nearest 15°":"Snap off — a turn stops where you leave it");
  setStatus(S.snap?"Snap on: a rotation settles on 15°. Drawing is unaffected — hold Shift for the "+
                   "nearest 15° as you draw, or Ctrl for level, plumb or a true diagonal."
                 :"Snap off: a turn stops exactly where you leave it. Drawing is unaffected — hold "+
                  "Shift for the nearest 15° as you draw, or Ctrl for level, plumb or a true diagonal."); };
const _mb=$("#magnetBtn");
if(_mb)_mb.onclick=()=>{ S.magnet=!S.magnet; reflectSnapBtns(); saveSnapPrefs(); dropSnapCache();
  toast(S.magnet?"Magnet on — marks pull onto the printed page":"Magnet off");
  setStatus(S.magnet?"Magnet on: moving, resizing or dragging a point pulls onto the nearest edge, centre or baseline. Ctrl suspends."
                   :"Magnet off: marks go exactly where you put them."); };
loadSnapPrefs();

/* ================= Grouping ================= */
function updateGroupBtn(){ const b=$("#groupBtn"); if(!b)return;
  const n=multiCount();
  const allGrouped=n>0&&multiAnnos().every(a=>a.group!=null)&&multiLines().every(l=>l.group!=null);
  b.disabled=n<2 && !allGrouped;
  b.textContent=allGrouped?"⛓ Ungroup":"⛓ Group";
  b.classList.toggle("active",allGrouped);
}
/* =================================================================================================
   6jz — GOING INSIDE A GROUP, AND THE GROUP SURVIVING IT.
   Ced: "in a grouped redlines, double clicking a shape/redline should allow you to edit that specific
   item and still retain the group once done."

   A group is deliberately one thing to the pointer: press any member and the whole group picks up
   (6g1's frame, `selectGroup`). That is right for moving it and wrong for fixing one arrow inside it,
   and until now the only way in was to ungroup, mend, and group again — which loses the group.

   So the group ISOLATES, the way every vector editor does it: double-click a member and the group is
   "open" — from that moment a press picks up that one mark, with its own handles, its own bar, its
   own restyle — while every member keeps its `group` exactly as it was. Nothing about the grouping is
   touched by going in or coming out, which is the whole of "still retain the group once done".

   Coming out: Escape, a click on anything outside the group, or a click on blank page. The next press
   on a member picks the group up again as one.

   Two rules keep this from leaking. `_grpIn` is only ever closed by `groupLeave`, never as a side
   effect of a selection being cleared — `selectLine` calls `selectAnno(null)` on its way, and a
   deselect-closes rule would have slammed the group shut the moment you clicked a stroke inside it.
   And the guard is asked for the OBJECT, not the id, so a mark that has since been ungrouped cannot
   hold the door open.
   ================================================================================================= */
var _grpIn=null;   /* `var`, not `let`: hoisted, so an early `selectGroup` cannot hit a dead zone */
function groupOpenIs(g){ return g!=null && _grpIn===g; }
function groupOpenNow(){ return _grpIn; }
function groupPaintOpen(){
  const k=(_grpIn==null)?null:("g"+_grpIn);
  try{ document.querySelectorAll(".annogroup").forEach(d=>
        d.classList.toggle("opengrp", k!=null && d.dataset.gk===k)); }catch(e){}
}
function groupEnter(g){
  if(g==null)return false;
  if(_grpIn===g){ groupPaintOpen(); return true; }
  _grpIn=g; groupPaintOpen();
  try{ setStatus("Inside the group — this one mark is selected. Escape steps back out; the group itself is untouched."); }catch(e){}
  return true;
}
function groupLeave(){
  if(_grpIn==null)return false;
  _grpIn=null; groupPaintOpen();
  return true;
}
/* selecting something that is not in the open group closes it */
function groupKeepFor(o){ if(_grpIn==null)return; if(o&&o.group===_grpIn)return; groupLeave(); }
(function(){
  const _sa=selectAnno, _sl=selectLine, _la=layoutAnnos;
  selectAnno=function(id){ if(id!=null&&_grpIn!=null)groupKeepFor(S.annos.find(z=>z.id===id)); return _sa.apply(this,arguments); };
  selectLine=function(id){ if(id!=null&&_grpIn!=null)groupKeepFor(S.lines.find(z=>z.id===id)); return _sl.apply(this,arguments); };
  /* the containers are rebuilt on every layout, so the open marking has to be put back on */
  layoutAnnos=function(){ const r=_la.apply(this,arguments); groupPaintOpen(); return r; };
})();
function selectGroup(gid){
  if(_grpIn!==gid)groupLeave();
  clearMulti(); S.sel=null; S.selLine=null; annobar.classList.remove("show"); $("#linebar").classList.remove("show");
  S.annos.forEach(a=>{ if(a.group===gid)S.selMulti.add(a.id); });
  S.lines.forEach(l=>{ if(l.group===gid)S.selMultiL.add(l.id); });
  paintMulti();
}
function groupSelected(){
  if(multiCount()<2){ toast("Select two or more marks first"); return false; }
  pushHistory();
  const gid=seq++, n=multiCount();
  multiAnnos().forEach(a=>a.group=gid);
  multiLines().forEach(l=>l.group=gid);
  layoutAnnos(); drawAllLines(); paintMulti(); updateCount();
  toast(`Grouped ${n} marks — they now move as one`);
  return true;
}
function ungroupSelected(){
  const gids=new Set();
  multiAnnos().forEach(a=>{ if(a.group!=null)gids.add(a.group); });
  multiLines().forEach(l=>{ if(l.group!=null)gids.add(l.group); });
  if(S.sel!=null){ const a=S.annos.find(z=>z.id===S.sel); if(a&&a.group!=null)gids.add(a.group); }
  if(S.selLine!=null){ const l=S.lines.find(z=>z.id===S.selLine); if(l&&l.group!=null)gids.add(l.group); }
  if(!gids.size)return false;
  pushHistory();
  S.annos.forEach(a=>{ if(gids.has(a.group))a.group=undefined; });
  S.lines.forEach(l=>{ if(gids.has(l.group))l.group=undefined; });
  layoutAnnos(); drawAllLines(); paintMulti(); updateCount();
  toast("Ungrouped");
  return true;
}
$("#groupBtn").onclick=()=>{ const b=$("#groupBtn"); if(b.textContent.indexOf("Ungroup")>=0)ungroupSelected(); else groupSelected(); };
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="g"){ if(_editTarget())return; e.preventDefault(); if(e.shiftKey)ungroupSelected(); else groupSelected(); }
});
// strip group on duplicated copies so they're independent
const _dupOrig=duplicateSelected;
duplicateSelected=function(){ const before=new Set(S.annos.map(a=>a.id)); const r=_dupOrig(); S.annos.forEach(a=>{ if(!before.has(a.id))a.group=undefined; }); return r; };

/* ================= Mount Analysis: site detection + export name ================= */
/* Every mount analysis in the sample set names its site somewhere on the cover page, but no two
   engineers-of-record label it the same way:

     Site Number      : SOH3361          (Trust Engineering / Concordia)
     AT&T Site Number : CTL02036         (TEP)
     Carrier Site Name: OHL02465         (SGS Towers)
     AT&T SITE NO     : IN1187           (Foresite)
     Site Number      : SINJ009955       (EFI — the redlined copy is filed as NJ009955)
     AT&T Site ID / Name / FA: SIPA001815 / Coplay / 12575110   (KCI)

   So the reader does not trust any one label. It gathers every candidate on the first three pages —
   from a labelled field where there is one, and from the bare shape of the token otherwise — and picks
   the best by shape: two to four letters followed by four to six digits is what a site code looks like
   and what the redlined files are named after. An "SI" prefix is dropped because that is what the
   filed copies do (SINJ009955 -> NJ009955). Whatever it lands on is editable in the site field, which
   is the one that actually names the export. */
const MA_SITE_LABEL=/(?:at\s*&?\s*t\s*)?(?:carrier\s*)?site\s*(?:no\.?|number|id|name)\b/i;
const MA_CODE=/^(SI)?([A-Z]{2,4})(\d{4,6})$/;
const MA_NOT_A_CODE=/^(FA|PTN|IWM|WS|PACE|PT|REV|TIA|ANSI|EIA)/i;

function maCodeScore(tok){
  const t=String(tok||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(!t||t.length<5||t.length>12)return 0;
  if(MA_NOT_A_CODE.test(t))return 0;
  const m=MA_CODE.exec(t);
  if(!m)return 0;
  let sc=10;
  if(m[1])sc-=3;                       /* an SI-prefixed code is the long form of the same site */
  if(m[3].length>=4&&m[3].length<=5)sc+=2;
  return sc;
}
/* The site code as it should be written: the SI prefix the filed copies drop, dropped. */
function maCleanCode(tok){
  const t=String(tok||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  const m=MA_CODE.exec(t);
  return m?(m[2]+m[3]):t;
}
/* Runs on one page, in reading order, as plain tokens. */
function maPageTokens(pi){
  const P=S.pages[pi]; if(!P||!P.items)return [];
  return P.items.map(t=>String(t.str).trim()).filter(Boolean);
}
function maDetectSite(){
  let best=null;
  const take=(tok,bonus,why)=>{
    const sc=maCodeScore(tok)+(bonus||0);
    if(sc>0&&(!best||sc>best.sc))best={sc,code:maCleanCode(tok),raw:tok,why};
  };
  for(let pi=0;pi<Math.min(3,S.pages.length);pi++){
    const toks=maPageTokens(pi);
    toks.forEach((t,i)=>{
      /* a labelled field: the value is the next token, or the one after a lone colon */
      if(MA_SITE_LABEL.test(t)){
        for(let k=1;k<=3&&i+k<toks.length;k++){
          const v=toks[i+k].replace(/^[:\s]+/,"").split("/")[0].trim();
          if(!v||/^[:]$/.test(v))continue;
          take(v,4,"labelled “"+t.trim()+"”");
          break;
        }
      }
      /* and any bare token that simply looks like a site code */
      t.split(/[\s/,]+/).forEach(w=>take(w,0,"reads like a site code"));
    });
    if(best&&best.sc>=12)break;
  }
  S.siteCode=best?best.code:"";
  S.siteWhy=best?best.why:"";
  const si=$("#s_site");
  if(si&&!si.value.trim()&&S.siteCode)si.value=S.siteCode;
  S.atollName=S.siteCode||S.atollName;
  maShowDetection();
  updateFnamePreview();
  LOG("Site:",S.siteCode||"(not found)",S.siteWhy?("— "+S.siteWhy):"");
  return S.siteCode;
}
/* What the banner says about the document that is open. */
function maShowDetection(){
  const band=$("#detectBanner"), tag=$("#detectTag"), why=$("#detectWhy");
  if(band){ band.classList.add("show");
    band.classList.toggle("final",!!S.siteCode); band.classList.toggle("prelim",!S.siteCode); }
  if(tag)tag.textContent=S.siteCode||"SITE?";
  if(why)why.textContent=S.siteCode
    ? (S.pages.length+" pages · site "+(S.siteWhy||"read from the cover page"))
    : "No site code on this document — type one here to name the export after it, or leave it and "+
      "the export keeps the file's own name.";
}
function siteLocation(){
  return (($("#s_site")&&$("#s_site").value)||S.siteCode||S.atollName||S.name||"").trim();
}
/* 6hn — WHAT THE EXPORT IS CALLED, ON ANY PDF.
   Ced: "remove all the mount analysis only indications here and make it more general on pdf."
   A mount analysis is filed as "<SITE> - Redlined Mount Analysis.pdf" and that is still exactly what
   comes out of one, because the tool RECOGNISED it: a site code was read off the first page. Open a
   drawing set, a scope or a scan and there is no site code and no report to name, so the file keeps
   its own name with "Marked Up" on it instead of being called a mount analysis it is not. */
function outputFilename(){
  const clean=v=>String(v||"").replace(/[\\/:*?"<>|]+/g,"").replace(/\s+/g," ").trim();
  /* a SITE CODE is the signal that this is one of the reports: it was read off the first page, or it
     was typed into the SITE box. Either way the filed copy is named the way the filed copies are. */
  const code=clean((($("#s_site")&&$("#s_site").value)||S.siteCode||"").trim());

  /* ==============================================================================================
     6ki — THE DOCUMENT SAYS WHAT IT IS. WE SAY WHAT WE DID TO IT.
     Ced: "remove the 'Mount Analysis' as default name, use the name of the file as the default
     name. may it be final construction drawings, mount analysis, preliminary construction drawings,
     etc. just retain the site name input in the start of name and whether it is as built or
     redlined based on the stamp."

     Every export was called "<SITE> - Redlined Mount Analysis", whatever had been opened — so a set
     of construction drawings came back claiming to be a mount analysis, and an as-built set came
     back claiming to be a redline. Three parts, and only the middle one is ours to decide:

        <SITE>   the code read off the cover page, or whatever is typed in the SITE box
        <STATE>  Redlined or As-Built, taken from the stamp actually on the document
        <KIND>   what the file already said it was, with any previous state word taken out

     The kind is the opened file's own name, stripped of the site code it usually starts with and of
     a leading "Redlined"/"As-Built" from a previous pass, so re-exporting a file this tool has
     already named does not stack the words up. Nothing is invented: a file with nothing left after
     the stripping keeps the old generic ending rather than guessing at a document type.
     ============================================================================================== */
  const state=exportStateWord();
  let kind=clean(String(S.name||"").replace(/\.pdf$/i,""));
  if(code){
    /* drop a leading site code, however it is punctuated off the rest */
    kind=kind.replace(new RegExp("^"+code.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*[-–—_:]*\\s*","i"),"");
  }
  kind=kind.replace(/^(STAMPED[_\s]+)?/i,"")
           /* 6ki — the state word goes wherever it sits, not only at the front. Without a site code
              in the box the file name still starts with its own code ("SOH3361 - Redlined Mount
              Analysis"), so anchoring the strip to the start left the old "Redlined" in place and
              the export came out "... - Redlined Mount Analysis - Redlined". */
           .replace(/(^|[\s\-–—_:])(redlined|red\s*lined|as[-\s]?built|marked[-\s]?up)(?=$|[\s\-–—_:])/ig,"$1")
           .replace(/^\s*[-–—_:]\s*/,"")
           .replace(/\s*[-–—_:]\s*$/,"")
           .replace(/\s{2,}/g," ")
           .trim();
  /* The site code leads, then what we did, then what the document is — "SOH3361 - Redlined Final
     Construction Drawings". With no site code there is nothing to lead with, so the state does:
     "Redlined Mount Analysis". The order is the same in both; only the prefix differs. */
  if(code)return kind ? `${code} - ${state} ${kind}` : `${code} - ${state}`;
  return kind ? `${state} ${kind}` : `Document - ${state}`;
}
/* 6ki — Redlined or As-Built, according to the stamp. A document with no stamp on it has not said
   which it is, and "Redlined" is what this tool does by default, so that is the fallback. Mixed
   stamps — which should not happen, but can — are reported as the state the FIRST one carries, so
   the name is at least something a person put there. */
function exportStateWord(){
  try{
    if(typeof copStampsOn==="function"){
      const gs=copStampsOn(null);
      for(const g of gs){
        const st=copReadStamp(g);
        if(st&&/^AS/i.test(String(st.status).replace(/\s+/g,"")))return "As-Built";
        if(st)return "Redlined";
      }
    }
  }catch(e){}
  return "Redlined";
}
function updateFnamePreview(){ try{ updateMiniBar(); }catch(e){} const f=$("#detectFname"); if(f)f.title=BUILD_ID; if(f)f.innerHTML=`Export name: <b>${escapeHtml(outputFilename())}.pdf</b>`; }
(function(){ const si=$("#s_site"); if(si)si.addEventListener("input",()=>{ S.siteCode=si.value.trim(); S.atollName=S.siteCode; updateFnamePreview(); }); })();

/* Turn the ribbon into icons once everything is wired up; the DOM is complete at this point. */
/* 6er — the boot screen's own driver. It reports REAL stages, in the order they actually happen, and it
   gets out of the way as soon as the last one is done.
   Two things it must never do: strobe, and strand. A minimum on-screen time stops a fast local load from
   flashing the screen for 40ms, and a hard failsafe removes the overlay after 4 seconds whatever happens
   — a boot screen that outlives a thrown error would hide the entire application behind itself, which is
   a far worse bug than the one it was added to fix. */
/* ================================================================================================
   6fa — THE TAB WEARS THE R, WHEREVER THIS RUNS.
   ------------------------------------------------------------------------------------------------
   Opened from the file, the <link rel="icon"> in the head is the whole story. PUBLISHED as an artifact
   it is not: the page is wrapped in a head of the host's making, and the host puts its own icon there —
   the emoji the publish call has to carry. Two icons in one document means whichever the browser reads
   LAST wins, and the answer differs by engine and by where the wrapper drops ours.
   So the app claims it: every other icon link goes, and ours is appended to the head last. It runs at
   boot and again a second later, because a host that injects its icon after us would otherwise take the
   tab back. Nothing here is artifact-specific — from the file it removes nothing and re-appends the same
   link, which is what it already was.
   ================================================================================================ */
function claimFavicon(){
  try{
    const mine=document.getElementById("favIcon");
    if(!mine)return;
    const href=mine.getAttribute("href")||"";
    if(!href)return;
    document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"]').forEach(l=>{
      if(l!==mine)l.parentNode&&l.parentNode.removeChild(l);
    });
    /* last in the head, and re-inserted rather than left where the wrapper put it (ours sits in the body
       once the page is wrapped, and an icon in the body is honoured unevenly) */
    const head=document.head||document.getElementsByTagName("head")[0];
    if(head&&mine.parentNode!==head)head.appendChild(mine);
    else if(head)head.appendChild(mine);      // re-append: moves it to the end, no clone, no reload
    const touch=document.getElementById("favTouch");
    if(head&&touch)head.appendChild(touch);
  }catch(e){}
}
claimFavicon();
setTimeout(claimFavicon,1200);
const _bootT0=Date.now();
let _bootDone=false;
function bootStage(pct,label){
  try{
    const bar=document.getElementById("bootBar"), st=document.getElementById("bootStage");
    if(bar)bar.style.width=Math.max(0,Math.min(100,pct))+"%";
    if(st&&label)st.textContent=label;
  }catch(e){}
}
function bootFinish(){
  if(_bootDone)return; _bootDone=true;
  bootStage(100,"Ready");
  const wait=Math.max(0,420-(Date.now()-_bootT0));   /* never a flash */
  setTimeout(()=>{
    try{
      document.documentElement.classList.remove("booting");
      const b=document.getElementById("boot");
      if(b)setTimeout(()=>{ try{ b.classList.add("gone"); }catch(e){} },320);
    }catch(e){}
  },wait);
}
setTimeout(()=>{ if(!_bootDone){ try{ LOG&&LOG("boot: failsafe reveal"); }catch(e){} bootFinish(); } },4000);
(function(){
  const go=()=>{
    bootStage(55,"Building the ribbon");
    try{ iconifyRibbon(); }catch(e){ LOG("iconifyRibbon",e&&e.message||String(e)); if(_echoConsole)console.error("iconifyRibbon",e); }
    /* 6ge — the bar copies the marks iconifyRibbon just set, so it has to follow it, never precede it */
    try{ syncMiniIcons(); }catch(e){ LOG("syncMiniIcons",e&&e.message||String(e)); }
    bootStage(80,"Applying appearance");
    /* the appearance is settled BEFORE the reveal, so nothing about it is ever seen changing */
    try{ applyThemeTune(true); }catch(e){}
    try{ syncLogoInk(); }catch(e){}
    try{ _palRender(); }catch(e){}
    bootStage(94,"Ready");
    /* two frames, so the layout the reveal shows is the settled one */
    requestAnimationFrame(()=>requestAnimationFrame(bootFinish));
  };
  /* This call is what turns the ribbon into icons.
     6cf: the `else` branch was dead code for the life of the project — this script has always sat in the
     middle of the document, so readyState was "loading" and the listener path always won. The packed
     artifact injects the app AFTER DOMContentLoaded, the else branch ran for the first time, and it threw
     `Cannot access 'RIBBON_ICONS' before initialization`: that const is declared further down this same
     script, so calling iconifyRibbon synchronously from here is inside its temporal dead zone. The throw
     went into the in-app log and nowhere else, and the ribbon quietly rendered as text labels.
     Deferring by a tick lets the rest of the script finish first — the same fix the build stamp uses. */
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);
  else setTimeout(go,0);
})();

/* ------------------------------------------------------------------------------------------------
   Icon-only ribbon, second attempt — and this time the DOM text is never touched.
   The first version replaced each button's label with a glyph, which broke Fill As-Built: something in
   that path reads a button's own text. Here the glyph is drawn by CSS (::before, from a per-button custom
   property) and the label is hidden with font-size:0. textContent is byte-for-byte unchanged, so no code
   that reads a label can be affected. Hovering still shows the wording, which was already in `title`.
   ------------------------------------------------------------------------------------------------ */
const RIBBON_ICONS={
  /* EXPORT — a tick, drawn inside a circle by the CSS below */
  dlPdf:"\u2713",
  /* FILE */
  openBtn:"\u2b06", homeBtn:"\u2302", saveBtn:"\ud83d\uddab", copyBtn:"\u29c9", photoBtn:"\u25a3",
  /* a bin: this one empties what the browser has kept, it does not touch the open document */
  cacheBtn:"\u232b",
  /* EDIT */
  undoBtn:"\u21b6", redoBtn:"\u21b7", clearBtn:"\u2327",
  /* ARRANGE — a grid to snap to, overlapping squares to group, a dotted square to select all */
  snapBtn:"\u2317", magnetBtn:"\u2299", groupBtn:"\u25a8", selAllBtn:"\u2b1a",
  /* MOUNT ANALYSIS — the panel, the stamp, a callout, a repeated note, the RFDS import */
  /* 6j1 — Ced, twice: "switch the notes and read table icons… this was not done." It was not, and
     6iy is why: I swapped the two GLYPHS, and `maBtn` never shows its glyph — `RIBBON_SHAPES` below
     gave it a drawn star, which wins. So Notes wore a star whatever this line said, and the swap only
     moved the grid off Read table. The star is gone from `RIBBON_SHAPES` and the glyphs are back the
     way they read: ruled lines for the note, a grid for the table. */
  analyzeMaBtn:"\u25a6",                              /* 6kx — notes, parts and as-built are gone */
  markupsBtn:"\u25e9", stampBtn:"\u25a3",
  /* VIEW — stacked bars for the page rail, a filled grid for marks, arrows for the two fits,
     a bisected square for two-up, a banded square for page view, a half-disc for day/night */
  /* 6ca — the View group was seven variations on "small square": a trigram, a filled grid, a banded
     square, a bisected square, a half-disc, a three-quarter disc and a comb. At 15px they were one
     shape. Each one now has a distinct silhouette and, where possible, means something:
     bars for a page list, a flag for marks, arrows for the two fits, a bisected square for two-up
     (two pages side by side), a single shadowed page for page view, a diamond for the theme picker,
     and up/down arrows for reordering pages. */
  railToggle:"\u2630", marksBtn:"\u2691", zoomOut:"\u2212", zoomIn:"\uff0b",
  fitBtn:"\u2194", fitPageBtn:"\u2195", actualBtn:"1:1", facingBtn:"\u25eb",
  /* 6el — themeBtn is NOT in this map any more. It is a two-state switch now (see `.thm-tog`), and
     iconifying it replaced the whole switch with one glyph — which is exactly the ambiguity Ced asked to
     be rid of: a sun could equally mean "you are in day mode" or "click for day mode". */
  pageViewBtn:"\u2751", palBtn:"\u2756", orgBtn:"\u25a5", helpBtn:"?",
  /* 6ge — the ribbon-side toggle was the one VIEW button left un-iconified, so it stood out as a bare
     character among circles. Transfer Redlines' two arrows, stood on end: same idea, one axis over.
     6gt \u2014 and it is no longer a character at all: `syncSideToggle` owns it, because the mark changes
     with the ribbon's side while `mark()` below stamps a button once and then leaves it alone. It is
     left out of this table on purpose \u2014 an entry here would win at load and stick. */
  /* FIND */
  findPrev:"\u2039", findNext:"\u203a"
};
/* "cross" is the mode name for Strike text — it was missing from this map, which is why that one tool had
   no icon at all. */
const MODE_ICONS={ select:"\u2b1a", pan:"\u270b", redline:"\u270e", fix:"\u2261", strikerow:"\u25ad", cross:"\u2612",
                   crossout:"\u2715", line:"\u2571", arrow:"\u2197", poly:"\u2933", box:"\u25a1", text:"T",
                   circle:"\u25cb", callout:"\u25f8", dim:"\u2194", snapshot:"\u25a3" };
/* 6do — the buttons whose icon is a shape, not a character. `mark` still runs for them (title, aria,
   the .ico sizing) — they only take a different source for the mark itself. */
/* =================================================================================================
   6jo — THE ICON SET.
   Ced sent ten drawings and asked for them on the bar and, where the same thing exists there, in the
   ribbon: flip, lock and unlock, flatten, add to markup library, copy properties, group, edit picture,
   layers, copy and duplicate. They were traced from the artwork itself rather than approximated with
   the nearest character in a font — every one of them was a glyph borrowed for its shape, and half of
   them read as something else at 13px. Each is one path on a 24-unit grid, drawn in `currentColor`, so
   the set is monochrome by construction and takes the theme's ink, the hover colour and the inverted
   state of a pressed button without a second copy of anything.
   ================================================================================================= */
const MA_ICONS={
  flip:"M0.66 11.16L0.71 23.84L0.03 24.00L23.97 24.00L23.19 23.84L23.08 11.06L15.07 17.24L22.40 23.90L1.49 23.90L8.83 17.24L1.49 11.16Z M11.82 8.23L11.29 8.54L11.14 9.07L11.14 21.90L11.40 22.53L12.03 22.74L12.55 22.48L12.76 21.96L12.76 9.01L12.45 8.38Z M0.13 7.23L0.50 7.81L7.10 5.87L7.31 5.29L5.74 4.40L6.16 3.93L9.30 2.52L12.60 2.20L15.59 2.83L18.10 4.19L16.59 5.29L16.79 5.87L23.76 7.65L21.72 0.58L21.25 0.63L19.99 2.62L17.48 1.00L14.59 0.00L9.25 0.00L6.31 1.05L3.90 2.62L2.28 0.52Z",
  lock:"M9.33 0.31L6.35 2.35L4.63 5.33L4.31 10.04L3.37 11.14L3.37 22.90L4.47 24.00L19.53 24.00L20.63 22.59L20.63 11.45L19.53 10.04L19.53 6.43L18.90 4.39L16.71 1.57L14.51 0.31L13.41 0.00Z M11.37 13.49L12.63 13.49L13.41 14.27L13.41 15.53L13.25 15.69L13.25 15.84L12.78 16.31L12.63 16.31L12.63 16.94L12.78 17.10L12.78 17.73L12.94 17.88L12.94 18.35L13.10 18.51L13.10 18.82L12.94 18.98L11.06 18.98L10.90 18.82L10.90 17.88L11.06 17.73L11.06 16.94L11.22 16.78L11.22 16.31L11.06 16.16L10.90 16.16L10.75 16.00L10.75 15.84L10.43 15.53L10.43 14.43L10.59 14.27L10.59 14.12L11.06 13.65L11.22 13.65Z M7.76 5.18L9.18 3.61L10.75 2.82L12.31 2.67L12.47 2.82L13.57 2.98L14.51 3.45L15.92 4.86L16.55 6.12L16.55 6.59L16.71 6.75L16.71 9.88L16.55 10.04L7.29 10.04L7.14 9.88L7.14 6.90Z",
  unlock:"M9.46 0.00L6.54 2.00L4.69 5.54L4.54 10.31L3.62 11.38L3.62 22.92L4.69 24.00L19.31 24.00L20.38 22.92L20.23 11.08L19.15 10.31L7.31 10.15L7.62 5.38L10.38 2.62L12.54 2.31L14.54 3.08L16.38 5.38L16.85 8.00L17.92 8.77L19.46 7.85L19.00 4.46L17.62 2.15L14.54 0.00Z M11.46 13.69L12.54 13.69L12.69 13.85L12.85 13.85L13.31 14.31L13.31 14.46L13.62 14.92L13.62 15.23L13.46 15.38L13.46 15.69L13.31 15.85L13.31 16.00L12.85 16.46L12.69 16.46L12.69 17.08L12.85 17.23L12.85 17.85L13.00 18.00L13.00 18.92L12.85 19.08L11.15 19.08L11.00 18.92L11.00 18.00L11.15 17.85L11.15 17.23L11.31 17.08L11.31 16.46L11.15 16.31L11.00 16.31L10.69 16.00L10.69 15.85L10.54 15.69L10.54 14.62L10.69 14.46L10.69 14.31L11.15 13.85L11.31 13.85Z",
  flatten:"M11.69 17.94L9.09 20.54L9.09 20.78L9.84 21.53L10.08 21.53L10.95 20.66L11.20 20.66L11.32 20.78L11.32 24.00L12.68 24.00L12.68 20.78L12.80 20.66L13.05 20.66L13.79 21.40L14.29 21.40L14.78 20.91L14.78 20.41L12.31 17.94Z M1.18 11.75L1.18 12.37L1.55 12.74L11.57 15.59L12.93 15.46L22.45 12.74L22.82 12.37L22.82 11.75L22.45 11.38L12.43 8.54L11.44 8.54L1.92 11.26Z M11.32 0.00L11.32 3.34L11.20 3.46L10.95 3.46L10.08 2.60L9.84 2.60L9.09 3.34L9.09 3.59L11.57 6.06L12.19 6.19L12.43 6.06L14.78 3.71L14.78 3.22L14.29 2.72L13.79 2.72L13.05 3.46L12.80 3.46L12.68 3.34L12.68 0.00Z",
  library:"M0.00 4.75L1.18 18.72L1.70 19.90L12.66 22.72L22.56 19.57L24.00 5.41L23.74 4.56L12.59 7.38L0.52 4.56Z M21.97 2.66L19.93 3.25L16.46 4.03L15.34 4.43L13.97 5.28L13.05 6.20L12.98 6.46L21.90 4.23Z M1.97 2.59L2.03 4.16L10.95 6.46L10.95 6.26L9.97 5.28L8.59 4.43L7.48 4.03L5.64 3.64Z M19.15 1.28L15.93 2.00L15.02 2.33L13.97 2.98L13.18 3.90L12.85 4.62L12.79 5.28L12.92 5.28L13.38 4.75L14.03 4.23L14.95 3.70L16.07 3.31L19.02 2.66Z M4.79 1.28L4.92 2.59L6.95 3.05L8.98 3.70L9.90 4.23L10.62 4.82L11.02 5.28L11.15 5.28L11.08 4.62L10.75 3.90L10.43 3.44L9.51 2.66L8.92 2.33L8.00 2.00Z",
  props:"M2.39 5.27L2.09 5.70L2.09 21.70L2.64 22.91L3.36 23.58L4.76 24.00L16.45 23.82L16.76 22.91L16.03 22.30L4.52 22.30L3.91 21.88L3.73 6.00L3.36 5.27Z M6.58 0.36L5.30 2.24L5.30 18.48L5.79 19.64L6.58 20.36L8.03 20.79L19.18 20.79L20.82 20.24L21.91 18.42L21.91 2.30L21.36 1.03L19.67 0.00L7.55 0.00Z",
  group:"M14.98 10.42L14.55 10.95L11.17 16.97L11.28 17.61L11.81 17.99L19.06 17.99L19.33 17.88L19.70 17.34L19.65 16.81L16.32 10.95L15.79 10.36Z M15.36 12.99L15.52 12.99L17.23 15.95L17.34 16.16L17.29 16.32L13.58 16.32L13.53 16.27L13.64 15.95Z M8.54 6.01L6.98 6.55L5.91 7.52L5.26 8.86L5.15 10.31L5.69 11.87L6.60 12.89L7.79 13.53L9.45 13.69L11.01 13.15L12.03 12.24L12.67 11.06L12.83 9.40L12.67 8.64L12.30 7.84L11.38 6.82L10.20 6.17Z M0.38 0.11L0.00 4.46L1.72 5.15L1.72 18.85L0.05 19.38L0.11 23.62L4.46 24.00L5.15 22.28L18.85 22.28L19.38 23.95L23.62 23.89L24.00 19.54L22.28 18.85L22.28 5.15L23.95 4.62L23.89 0.38L19.54 0.00L18.85 1.72L5.15 1.72L4.62 0.05Z M5.15 3.38L18.85 3.38L19.01 4.72L20.62 5.15L20.62 18.85L19.28 19.01L18.85 20.62L5.15 20.62L4.99 19.28L3.38 18.85L3.38 5.15L4.72 4.99Z",
  editpic:"M1.63 2.93L0.00 6.13L0.00 19.63L0.98 22.17L4.17 23.93L17.87 23.93L20.35 22.96L22.04 20.09L22.04 10.37L21.33 9.78L20.28 10.50L20.22 20.02L18.65 21.91L4.11 22.11L2.35 21.00L1.83 19.76L2.22 4.96L4.24 3.65L13.70 3.65L14.35 2.48L13.76 1.89L3.91 1.89Z M21.85 0.78L20.28 0.07L19.30 0.13L18.33 0.59L7.83 11.02L7.24 12.13L6.39 15.46L6.52 16.63L7.04 17.28L8.48 17.67L12.85 16.37L23.48 5.74L24.00 4.50L23.93 3.39L23.41 2.35Z M16.83 4.83L19.24 7.24L19.24 7.43L11.67 15.00L8.28 15.85L8.22 15.59L9.07 12.39L16.37 5.02Z M19.63 1.89L20.28 1.89L20.61 2.09L21.98 3.46L22.17 3.78L22.17 4.43L22.11 4.57L20.67 6.00L20.54 6.00L18.07 3.52L18.07 3.39L18.26 3.13L18.46 3.00L18.91 2.48Z",
  layers:"M24.00 17.82L23.66 17.30L20.48 15.77L13.50 19.29L11.57 19.57L3.29 15.83L0.17 17.42L0.00 18.10L0.28 18.50L10.61 23.66L12.43 24.00L23.72 18.50Z M24.00 11.91L23.66 11.40L20.48 9.87L13.50 13.39L11.63 13.67L10.61 13.45L3.29 9.93L0.17 11.52L0.00 12.20L0.28 12.60L11.01 17.93L12.43 18.10L23.60 12.65Z M0.00 5.90L0.28 6.70L11.52 12.20L12.99 12.03L23.60 6.75L24.00 6.24L23.66 5.50L12.26 0.00L10.67 0.34Z",
  copy:"M1.35 0.76L0.11 2.87L0.11 16.20L1.03 18.04L2.55 18.96L4.82 19.07L5.20 22.10L7.42 23.89L20.75 24.00L22.65 23.24L23.89 21.13L23.89 7.80L22.92 5.91L21.24 4.98L19.18 4.93L18.64 1.63L16.36 0.05L3.25 0.00Z M6.93 6.45L8.02 6.01L20.75 6.01L22.43 7.04L22.81 7.96L22.81 20.97L21.89 22.43L20.59 22.92L8.23 22.92L6.45 22.00L5.96 20.91L5.96 8.02Z M16.96 1.46L17.99 2.82L17.99 4.93L7.86 4.93L6.66 5.31L5.53 6.28L4.88 7.86L4.88 17.93L3.25 17.99L2.17 17.55L1.19 16.04L1.19 3.03L1.68 2.00L3.09 1.14L16.14 1.14Z",
  duplicate:"M9.77 8.18L9.35 8.71L9.35 13.27L4.57 13.38L4.25 13.59L4.14 14.23L4.67 14.65L9.24 14.65L9.35 19.33L9.66 19.75L10.19 19.86L10.62 19.33L10.62 14.76L15.29 14.65L15.72 14.34L15.82 13.81L15.40 13.38L10.73 13.38L10.51 12.42L10.62 8.60L10.41 8.28Z M5.42 0.32L4.25 1.59L4.04 3.82L1.38 4.35L0.00 6.27L0.00 21.77L0.42 22.73L2.23 24.00L17.73 24.00L18.69 23.58L19.75 22.41L19.96 20.07L22.73 19.54L24.00 17.73L23.68 1.38L21.77 0.00Z M2.12 5.52L17.20 5.31L18.48 6.16L18.69 21.24L17.84 22.51L2.44 22.62L1.49 21.88L1.27 6.69Z M6.16 1.49L21.35 1.27L22.30 1.81L22.73 2.65L22.73 17.31L21.88 18.48L19.96 18.48L19.96 6.27L19.43 5.10L17.73 4.04L5.52 4.04L5.42 2.34Z",
  /* 6k9 — the rubber stamp, traced off the mark Ced sent: dome, neck, platen and the bar
     under it. Drawn rather than borrowed from a glyph, so it sits at the same weight as the
     rest of the ribbon at 15px. */
  stamp:"M12 0.4C9.3 0.4 7.1 2.6 7.1 5.3C7.1 6.6 7.6 7.6 8.2 8.6C8.9 9.7 9.3 10.6 9.5 11.5L14.5 11.5C14.7 10.6 15.1 9.7 15.8 8.6C16.4 7.6 16.9 6.6 16.9 5.3C16.9 2.6 14.7 0.4 12 0.4Z M10.4 12.7L13.6 12.7C14.8 12.7 15.6 13.5 15.6 14.7L15.6 15.6L8.4 15.6L8.4 14.7C8.4 13.5 9.2 12.7 10.4 12.7Z M4.2 15.6L19.8 15.6C21.6 15.6 22.6 16.9 22.6 18.5L22.6 19.0C22.6 19.4 22.3 19.6 21.9 19.6L2.1 19.6C1.7 19.6 1.4 19.4 1.4 19.0L1.4 18.5C1.4 16.9 2.4 15.6 4.2 15.6Z M3.0 21.2L21.0 21.2L21.0 22.0C21.0 23.1 20.1 24.0 19.0 24.0L5.0 24.0C3.9 24.0 3.0 23.1 3.0 22.0L3.0 21.2Z",
  /* ================================================================================================
     6mb — THE TWO PICTURE TOOLS, IN CED'S OWN DRAWING.
     He sent a mark for each: a bracketed frame round a camera for Snapshot, and a file for Insert
     photo, "but replace the camera as the a file icon as this one" — so the second is the first's
     frame with his folder where the camera was. They were a glyph apiece before, U+25A3 "white
     square containing black small square" and the picture emoji, and neither says what the tool
     does: one is a square, the other is whatever face the machine happens to have, in whatever
     colours that face was designed in, beside a row of monochrome marks.

     TRACED, NOT REDRAWN. Ced: "just use the logo is sent no need to replicate it." The first cut of
     this was drawn by eye from the pictures and it was close and it was not his: the corner radii,
     the exact gap in the bracket frame and the weight of the folder's back plate were all mine.
     `tools/traceicon.py` takes the artwork's own pixels — marching squares, then Douglas-Peucker at
     a tolerance just wide enough to swallow the antialiasing — and `tools/composeicon.py` builds the
     second mark by rasterising the frame and the folder TOGETHER and tracing once, so there is no
     seam where two separately-fitted outlines would have met. Both come out as one path on the same
     24-unit grid as the rest of the set, in `currentColor`, with `fill-rule:evenodd` for the holes.
     ================================================================================================ */
  snapshot:"M2.29 6.70L-0.03 6.67L-0.03 2.67L0.16 2.03L0.54 1.40L1.46 0.60L2.29 0.29L6.38 0.32L6.35 2.57L2.86 2.57L2.38 2.86L2.32 6.67ZM14.48 2.63L8.83 2.63L8.73 2.54L8.73 0.32L14.54 0.29L14.51 2.60ZM23.30 6.70L21.08 6.70L20.98 6.60L20.92 2.86L20.63 2.63L17.02 2.63L16.92 2.54L16.92 0.32L20.95 0.29L21.59 0.48L22.22 0.86L23.02 1.78L23.33 2.60L23.33 6.67ZM21.59 23.65L11.11 23.65L10.35 23.40L9.37 22.60L8.92 21.84L8.73 21.14L8.73 12.19L8.98 11.30L9.30 10.79L9.90 10.19L10.60 9.81L11.37 9.62L12.83 9.62L13.11 9.02L13.52 8.60L13.84 8.48L18.86 8.48L19.52 8.95L19.87 9.62L21.33 9.62L21.90 9.75L22.60 10.06L23.33 10.73L23.78 11.49L23.97 12.32L23.97 21.02L23.71 21.97L23.40 22.48L22.54 23.27L21.62 23.62ZM2.29 14.89L-0.03 14.86L-0.03 9.08L2.32 9.08L2.32 14.86ZM21.30 21.27L21.62 20.83L21.62 12.51L21.40 12.10L21.14 11.97L11.37 12.03L11.08 12.38L11.08 20.95L11.30 21.24L21.27 21.30ZM16.83 20.16L15.81 20.16L14.79 19.84L14.03 19.33L13.24 18.35L12.86 17.27L12.86 16.00L13.05 15.37L13.56 14.48L14.16 13.87L15.05 13.37L15.68 13.17L16.95 13.17L17.78 13.43L18.67 14.00L19.52 15.11L19.84 16.13L19.84 17.14L19.40 18.41L18.48 19.46L17.71 19.90L16.86 20.13ZM16.67 17.78L17.02 17.62L17.49 16.95L17.49 16.38L17.37 16.06L16.95 15.65L16.44 15.46L15.94 15.52L15.62 15.71L15.21 16.25L15.21 17.02L15.46 17.46L15.75 17.68L16.06 17.81L16.63 17.81ZM6.35 23.65L2.29 23.65L1.71 23.46L1.08 23.08L0.29 22.16L-0.03 21.27L-0.03 17.27L2.22 17.24L2.32 17.33L2.38 21.08L2.67 21.30L6.29 21.30L6.38 21.40L6.38 23.62Z",
  photofile:"M2.29 6.70L-0.03 6.67L-0.03 2.67L0.16 2.03L0.54 1.40L1.46 0.60L2.29 0.29L6.38 0.32L6.35 2.57L2.86 2.57L2.38 2.86L2.32 6.67ZM14.48 2.63L8.83 2.63L8.73 2.54L8.73 0.32L14.54 0.29L14.51 2.60ZM23.30 6.70L21.08 6.70L20.98 6.60L20.92 2.86L20.63 2.63L17.02 2.63L16.92 2.54L16.92 0.32L20.95 0.29L21.59 0.48L22.22 0.86L23.02 1.78L23.33 2.60L23.33 6.67ZM2.29 14.89L-0.03 14.86L-0.03 9.08L2.32 9.08L2.32 14.86ZM20.25 22.32L9.97 22.32L9.52 22.13L9.05 21.71L8.73 21.08L8.73 10.54L8.98 10.10L9.52 9.75L14.03 9.75L14.79 10.06L16.00 11.27L16.70 11.71L17.21 11.84L20.44 11.84L20.89 12.03L21.30 12.63L21.30 13.90L20.32 13.94L20.29 12.95L20.19 12.86L16.95 12.86L16.38 12.73L15.49 12.22L14.22 10.95L13.78 10.76L9.84 10.76L9.75 10.86L9.75 20.76L9.81 20.95L10.16 21.24L10.60 21.17L11.02 20.83L13.30 15.05L13.65 14.63L13.90 14.51L23.05 14.44L23.43 14.57L23.84 14.98L23.97 15.75L21.94 20.83L21.62 21.46L21.14 21.94L20.29 22.29ZM6.35 23.65L2.29 23.65L1.71 23.46L1.08 23.08L0.29 22.16L-0.03 21.27L-0.03 17.27L2.22 17.24L2.32 17.33L2.38 21.08L2.67 21.30L6.29 21.30L6.38 21.40L6.38 23.62Z",
  applypages:"M7.22 6.43L0.00 13.80L1.15 14.80L4.18 12.03L1.57 15.37L2.77 16.47L4.97 14.75L3.29 17.10L5.23 19.03L8.05 16.42L5.80 19.50L7.11 20.92L12.44 15.90L7.69 21.33L8.84 22.64L10.46 21.80L9.57 23.16L10.30 24.00L17.57 16.63Z M22.80 0.00L21.07 0.21L18.82 1.52L14.01 6.95L10.09 3.24L9.67 3.24L7.90 5.07L7.95 5.44L18.61 16.05L19.03 16.00L20.76 14.01L16.99 9.93L20.44 7.16L23.22 4.03L24.00 1.57L23.58 0.42Z"
};
/* one inline drawing, sized to sit on the same line as a word */
function maIconSvg(name,px){
  const d=MA_ICONS[name]; if(!d)return "";
  const s=px||14;
  return '<svg class="ma-i" viewBox="0 0 24 24" width="'+s+'" height="'+s+'" aria-hidden="true" '+
         'focusable="false"><path fill="currentColor" fill-rule="evenodd" d="'+d+'"/></svg>';
}
function maIconEl(name,px){
  const wrap=document.createElement("span");
  wrap.className="ma-ico";
  wrap.innerHTML=maIconSvg(name,px);
  return wrap;
}
const RIBBON_SHAPES={
  homeBtn:"--i-home", openBtn:"--i-file", cacheBtn:"--i-cache",   /* 6j1 — maBtn keeps its glyph */
  saveBtn:"--i-save", copyBtn:"--i-copy", clearBtn:"--i-clear",
  railToggle:"--i-eye",         /* 6gh — show / hide the page list */
  orgBtn:"--i-org",       /* 6ep — a stack of pages, not another pair of arrows */
  /* 6jo — the two the ribbon shares with the selection bar, so one idea has one picture */
  groupBtn:"--i-group", markupsBtn:"--i-library", stampBtn:"--i-stamp",  /* 6k9 */
  photoBtn:"--i-photofile"                                               /* 6mb */
};
/* v60 — select and pan take the marks Ced sent (see ds.css §6) */
const MODE_SHAPES={ select:"--i-select", pan:"--i-hand", redline:"--i-pen",
                    /* v60 — the heavier, filled set (ds.css §8) */
                    text:"--i-t-text", fix:"--i-t-fix", crossout:"--i-t-crossout",
                    strikerow:"--i-t-strikerow", cross:"--i-t-striketext", line:"--i-t-line",
                    arrow:"--i-t-arrow", dim:"--i-t-dim", poly:"--i-t-poly", box:"--i-t-box", circle:"--i-t-circle",
                    /* 6fh — the callout, drawn as what it makes: a box of text, a stub, a leader, an arrow */
                    callout:"--i-t-callout",
                    /* 6mb — the bracketed camera, in place of U+25A3 */
                    snapshot:"--i-snapshot" };
function iconifyRibbon(){
  const mark=(b,glyph,shape)=>{
    if(!b||b.classList.contains("ico"))return;
    if(!b.title){ const t=(b.textContent||"").trim(); if(t)b.title=t; }   // hover names the tool
    b.setAttribute("aria-label",(b.textContent||"").trim()||b.title||"");
    if(shape){ b.style.setProperty("--gi","var("+shape+")"); b.classList.add("icoimg"); }
    else b.style.setProperty("--g",'"'+glyph+'"');                        // CSS draws it
    b.classList.add("ico");
  };
  Object.keys(RIBBON_ICONS).forEach(id=>mark(document.getElementById(id),RIBBON_ICONS[id],RIBBON_SHAPES[id]));
  document.querySelectorAll("#toolbar .tool[data-mode]").forEach(b=>{
    const g=MODE_ICONS[b.dataset.mode]; if(g)mark(b,g,MODE_SHAPES[b.dataset.mode]);
  });
}


function rfItemAt(pi,g){
  if(!S.pages[pi]||!g)return null;
  let best=null,bd=1e9;
  S.pages[pi].items.forEach(t=>{ const d=Math.abs(t.nx-g.nx)+Math.abs(t.ny-g.ny); if(d<bd){bd=d;best=t;} });
  return bd<0.02?best:null;
}

/* Place a value into a cell defined by column geometry rather than by a printed run. */
function putRowCell(pi,cellNx,cellNw,y,val,lineNh,noClamp){
  const tv=String(val==null?"":val).trim();
  const id=addText(pi,Math.max(0,cellNx),y,tv);
  const a=S.annos.find(z=>z.id===id);
  if(a){
    const lh=lineNh||0.011;
    /* a COLUMN fill, not a copy of a printed run: the column is far wider than the value, so there is
       nothing to fit to and the printed line height is the only measure available */
    const pt=printedPt(pi,{nh:lh}); if(pt)a.size=pt;
    a.nh=lh; a.lineNh=lh; a.lines=1;
    a.onCell=true; a.manualW=true; a.nowrap=true; a.fullcell=false;
    /* The one-character rule exists for a count written over a printed digit, where the box hugs that
       digit. When we are handed a whole COLUMN (its width is far wider than the text), a single character
       belongs on the column's centre like every other value — otherwise "6" in a Quantity column sat left
       of everything above it. */
    const _tw0=measureTextNorm(tv,a.size,pi);
    const _wideBox=(cellNw||0)>Math.max(_tw0*1.8,0.012);
    const _src=(a.srcLen!=null?a.srcLen:1);
    a.align=(tv.length<=1&&_src<=1&&!_wideBox)?"left":"center"; a.alignSet=true;
    /* REVERTED (was addendum 6u): an inserted row's value is never wrapped. Measuring it against a
       column width — the anchor cell's, or the reader's span — split values that fit perfectly well
       ("DC_TRU/NK", "EXISTI/NG", "SQUI/D"). One line, always, as it behaved before that change. */
    /* 6ea — an added row's value takes the same rule as every other redline: its own text with a space
       of air either side, held two spaces clear of the column's edges so it cannot bleed into the one
       beside it, and folded only if it will not fit even then. "One line, always" let a long value run
       the full width of the column and into its neighbour; 6dz's answer — fold it to the width the
       column's printed values wrap at — folded values the cell had room for. The cell decides. */
    const tw=measureTextNorm(tv,a.size,pi)+0.002;
    const spc=Math.max(0.0008,measureTextNorm(" ",a.size,pi)||0.0015);
    const room=Math.max(0.006,(cellNw||0)-spc*4);      // two spaces clear either side
    a.wrap=false; a.nowrap=true; a.lines=1;
    a.nw=Math.max(0.006,Math.min(tw+spc*2,room));
    if(tw>room){
      a.wrap=true; a.nowrap=false;
      a.lines=Math.max(2,Math.ceil(tw/(a.nw*0.98)));
      a.nh=lh*a.lines;                     // the box has to be tall enough to hold them
      a.pLines=1;                          // nothing is printed underneath, so one line is the floor
      LOG("Analyze insert:",JSON.stringify(tv),"wraps to",a.lines,
          "line(s) — it will not fit the column's",(room*(S.pages[pi].w1||612)).toFixed(1)+"pt of clear room");
    }
    a.nx=(a.align==="center")
      ? Math.max(0,cellNx+((cellNw||0)/2)-a.nw/2)
      : Math.max(0,cellNx);
    /* A value wider than its column centres and so spills BOTH ways — which is how a long model on an
       added Design Summary row ran back over Equipment Type. Never start left of the column. */
    /* Never start left of the column — EXCEPT where the caller says that column has clear space either
       side. The Sector column is one character wide with white space around it, so clamping there stopped
       "A,B,C" from centring. */
    if(!noClamp&&a.nx<cellNx)a.nx=cellNx;
    /* Keep the column box on the mark. fitCellBox() bails out for manualW marks, so without this the
       alignment was frozen at creation: a value typed as one character stayed LEFT after being retyped as
       two, where a count redline would have re-centred. */
    a.lenRule=true; a._colNx=cellNx; a._colNw=(cellNw||0);
  }
  return id;
}

function putLeftAt(pi,x,y,val){
  const id=addText(pi,Math.max(0,x),y,String(val));
  const a=S.annos.find(z=>z.id===id);
  /* the length rule applies here too: only a LONE character is left-aligned */
  if(a){ a.nowrap=true; a.align=(String(val).trim().length<=1)?"left":"center"; a.alignSet=true; a.fullcell=false; }
  return id;
}

/* place a value centred on a column x at a given y (no printed cell to sit on) */
function putFreeAt(pi,cx,y,val){
  const size=parseFloat($("#c_pt").value)||8;
  const tw=measureTextNorm(String(val),size,pi);
  const id=addText(pi,Math.max(0,cx-tw/2),y,String(val));
  const a=S.annos.find(z=>z.id===id);
  if(a){ a.nowrap=true; a.align="center"; a.fullcell=false; }
  return id;
}

/* locate a model row and overlay the four count columns that differ */
function rowBandItems(i,it){ const cy=it.ny+it.nh/2, tol=it.nh*0.7; return S.pages[i].items.filter(t=>Math.abs((t.ny+t.nh/2)-cy)<tol).sort((a,b)=>a.nx-b.nx); }

/* group a page's text items into visual lines (cached), for span matching + column reading */
function pageLines(pi){
  const P=S.pages[pi]; if(P._lines)return P._lines;
  const rows={};
  P.items.forEach(t=>{ const key=Math.round((t.ny+t.nh/2)*300); (rows[key]=rows[key]||[]).push(t); });
  const lines=Object.keys(rows).map(k=>{ const its=rows[k].sort((a,b)=>a.nx-b.nx); return {y:+k/300, items:its, norm:its.map(t=>t.str).join("").replace(/\s+/g,"").toLowerCase()}; }).sort((a,b)=>a.y-b.y);
  P._lines=lines; return lines;
}

/* =================================================================================================
   6g1 — WHAT THE STROKE MEASURES, WHILE IT IS BEING DRAWN
   Ced: "lines should be shown when applying in realtime, like the length of it is visible when
   dragging." A leader across a drawing sheet is placed by eye, and by eye you cannot tell a 2-inch
   line from a 2.4-inch one. The reading follows the pointer and says the length in inches — the unit
   these sheets are dimensioned in — and the angle beside it, which is also what tells you Snap has
   caught one.
   ================================================================================================= */
function lenHUD(){
  let h=document.getElementById("lenHUD");
  if(!h){ h=document.createElement("div"); h.id="lenHUD"; h.className="deghud lenhud"; document.body.appendChild(h); }
  return h;
}
/* The length of a normalised span on page `pi`, in inches of the printed sheet. */
function spanInches(pi,nx1,ny1,nx2,ny2){
  const P=S.pages[pi]; if(!P)return 0;
  const dx=(nx2-nx1)*(P.w1||612), dy=(ny2-ny1)*(P.h1||792);   /* points */
  return Math.hypot(dx,dy)/72;
}
function lenHUDShow(h,pi,nx1,ny1,nx2,ny2,caught,clientX,clientY){
  if(!h)return;
  const inches=spanInches(pi,nx1,ny1,nx2,ny2);
  const P=S.pages[pi]||{};
  const dx=(nx2-nx1)*(P.w1||612), dy=(ny2-ny1)*(P.h1||792);
  let deg=Math.atan2(-dy,dx)*180/Math.PI; if(deg<0)deg+=360;
  /* 6gg — while a LENGTH is being drawn the readout is the length it will read, at the tool's own
     scale, rather than inches of paper: it is the number you are aiming for. */
  let head=inches.toFixed(2)+"\u2033";
  if(S.mode==="dim"){ try{ const st=maDimStyleOf(null);
      head=maFmtLen(inches*st.scale,st.unit,st.prec); }catch(e){} }
  h.textContent=head+"  \u00b7  "+(Math.round(deg*10)/10)+"\u00b0";
  h.classList.toggle("caught",!!caught);
  h.style.left=Math.round(clientX+16)+"px";
  h.style.top=Math.round(clientY-14)+"px";
  h.classList.add("show");
}
function lenHUDHide(h){ if(!h)return; h.classList.remove("show","caught"); h.textContent=""; }
/* a gesture that ends anywhere — off the page, in another window, cancelled — still puts the
   readout away, so a stale length is never left hanging over the sheet */
window.addEventListener("pointerup",()=>{ try{ lenHUDHide(document.getElementById("lenHUD")); }catch(e){} },true);
window.addEventListener("pointercancel",()=>{ try{ lenHUDHide(document.getElementById("lenHUD")); }catch(e){} },true);

/* ==================================================================================================
   6lz — THE CONTROLS AROUND A MARK STAY THE RIGHT WAY UP.
   Ced: "when a redline is rotated, always make the arrows of up and down layer retain the up and down
   orientation so it does not become confusing for the user. actually, retain this principle to all
   icons of the redlines so its not confusing."

   A mark is turned by putting a `rotate()` on the element, and everything inside an element turns with
   it — including the five round controls hanging off its edges. Measured on a box turned 30°: the
   mark's transform was `matrix(0.866, 0.5, -0.5, 0.866, 0, 0)` and `.lup`'s own transform was `none`,
   so the up-arrow was wearing the mark's 30° and pointing somewhere between up and right. On a mark
   turned past 90° the up arrow points DOWN, which is not a confusing control so much as a wrong one.

   An icon is not part of the drawing; it is a thing you press. So the mark carries the turn and each
   control cancels it: one custom property written beside the transform, and one CSS rule that reads
   it. The controls still ORBIT the box — they stay attached to the edge they belong to, which is what
   says which box they act on — and each one is drawn upright wherever it has landed.
   ================================================================================================== */
/* ==================================================================================================
   6mp — THE CURSOR ON A TURNED MARK POINTS WHERE THE EDGE ACTUALLY IS.
   Ced: "the changes in cursor especially when adjusting corners of a rotated item should not be
   based on the previous orientation. it should be based on the current orientation."

   The eight grips carry their cursor in CSS — `.rz.nw{cursor:nwse-resize}` and so on — which is a
   statement about the UNROTATED box. Turn a mark 45° and the grip that is now at the top of the
   screen still says it resizes along the old diagonal: the arrow points one way and the edge under
   it runs another. On a mount drawing, where a redline is turned to lie along a member, that is
   every mark.

   A resize cursor only has four directions, 45° apart, so the right one is simply the grip's own
   compass bearing plus the mark's rotation, taken to the nearest 45° and folded into a half turn
   (an edge has no up or down: `ns-resize` serves both n and s).
   ================================================================================================== */
const GRIP_BEARING={n:0,ne:45,e:90,se:135,s:180,sw:225,w:270,nw:315};
const GRIP_CURSOR=["ns-resize","nesw-resize","ew-resize","nwse-resize"];
function gripCursor(pos,deg){
  const b=GRIP_BEARING[pos];
  if(b==null)return "";
  let a=(b+(+deg||0))%180; if(a<0)a+=180;
  return GRIP_CURSOR[Math.round(a/45)%4];
}
function setMarkSpin(el,rot){
  if(!el)return;
  const r=+rot||0;
  el.style.transformOrigin="center center";
  el.style.transform=r?("rotate("+r+"deg)"):"";
  try{ el.style.setProperty("--urot",(-r)+"deg"); }catch(e){}
  /* 6mp — the one place a mark's rotation is applied is the one place its cursors are set.
     Guarded on there being something to correct: `layoutAnnos` calls this for every mark on the
     page and nearly all of them are square on, so an unturned mark that has never been turned does
     no DOM work at all. `tools.py`'s thrash case measured the ungated version at 14.7ms against its
     14ms budget on a 40-mark page, which is what the guard is worth. */
  if(r||el.dataset.spun){
    try{
      el.querySelectorAll(":scope > .rz").forEach(h=>{
        const c=gripCursor(h.dataset.pos,r);
        if(c)h.style.cursor=c;
      });
    }catch(e){}
    if(r)el.dataset.spun="1"; else delete el.dataset.spun;
  }
}
/* 6fa — the angle readout that follows a rotate handle. One element, made once and reused. */
function degHUD(){
  let h=document.getElementById("degHUD");
  if(!h){ h=document.createElement("div"); h.id="degHUD"; h.className="deghud"; document.body.appendChild(h); }
  return h;
}
/* ==================================================================================================
   6lu — WHAT A TURN LOOKS LIKE WHILE IT IS HAPPENING.
   Ced sent a picture of a mark mid-rotation and said "apply this animation when rotating": the mark
   lifted on a pale ground, a dashed cross through the point it is turning about, an arm out to the
   hand, and the angle read twice — where it is now, and how far it has come.

   The reading is the part that does real work. One number cannot answer both questions a hand asks
   while turning something: "what angle is this at" and "how far have I moved it". A callout being
   lined up with a member wants the first; a mark being nudged back straight wants the second. They
   are stacked, the absolute above and the change below, so neither has to be worked out from the
   other. The cross and the arm are there so the centre of the turn is a place you can see rather
   than a point you infer from the way the mark is swinging.

   None of it exists at rest: the overlay is built when a rotation starts and taken down when the
   hand lets go, so a sheet that is not being turned carries nothing extra at all.
   ================================================================================================== */
function degHUDShow(h,deg,caught,cx,cy,delta){
  if(!h)return;
  const d=((Math.round(deg*10)/10)%360+360)%360;
  const abs=(Math.round(d*10)/10)+"\u00b0";
  if(delta==null){ h.textContent=abs; }
  else{
    /* 6lu — two readings, the angle and the change, the way Ced's picture has them */
    let dv=Math.round(delta*10)/10;
    if(dv>180)dv-=360; if(dv<-180)dv+=360;
    h.innerHTML="";
    const a1=document.createElement("span"); a1.className="dh-abs"; a1.textContent=abs;
    const a2=document.createElement("span"); a2.className="dh-dlt";
    a2.textContent=(dv>0?"+":"")+dv+"\u00b0";
    h.appendChild(a1); h.appendChild(a2);
  }
  h.classList.toggle("caught",!!caught);
  h.classList.add("show");
  /* ================================================================================================
     6ly — ONE SMALL PROMPT, LYING DOWN.
     Ced: "the input for the angle should be just a small prompt like the photo earlier, just always
     make it horizontal", with a capture of the chip standing on end, its digits running down the
     screen one to a line.

     6lu stacked the two readings, the angle above the change, on the argument that it kept the chip
     the width of one number. It does — and it also makes a chip two lines tall and barely wider than
     "238°", which is a tall block sitting on top of the very thing you are trying to look at, and
     which is one narrow container away from breaking a second time. The two numbers go side by side
     instead (see `.deghud` in ma.css): a short wide pill reads at a glance, it covers a band of the
     drawing rather than a column of it, and lying down is a shape a reading can keep however small the
     room gets. `white-space:nowrap` in the sheet is the belt to that brace — a chip with no break
     opportunities in it cannot be made to stand up.

     It is also kept INSIDE the window. The chip is placed on the mark's own centre, and a mark near an
     edge put it half off the screen with nothing to pull it back; it is clamped to the viewport with a
     margin, which costs one measurement and means the reading is always readable. The clamp is in
     half-size terms because the chip is centred on the point it is given.
     ================================================================================================ */
  let L=Math.round(cx), T=Math.round(cy);
  try{
    const w=h.offsetWidth||46, hh=h.offsetHeight||22, M=8;
    L=Math.min(Math.max(L,w/2+M), window.innerWidth-w/2-M);
    T=Math.min(Math.max(T,hh/2+M), window.innerHeight-hh/2-M);
  }catch(e){}
  h.style.left=L+"px";
  h.style.top=T+"px";
}
function degHUDHide(h){ if(h)h.classList.remove("show"); }
/* the dashed cross, the arm and the pale ground — one SVG over the page, for the length of the turn */
function rotGuideOpen(pg,cx,cy,box){
  try{
    rotGuideClose();
    const host=pg&&pg.querySelector(".annoui"); if(!host)return null;
    const r=pg.getBoundingClientRect();
    const NS="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(NS,"svg");
    svg.setAttribute("class","rotguide");
    svg.setAttribute("width",pg.offsetWidth); svg.setAttribute("height",pg.offsetHeight);
    const X=cx-r.left, Y=cy-r.top;
    const mk=(n,at)=>{ const e=document.createElementNS(NS,n);
      for(const k in at)e.setAttribute(k,at[k]); return e; };
    if(box){
      svg.appendChild(mk("rect",{x:box.x-r.left,y:box.y-r.top,width:box.w,height:box.h,
        class:"rg-lift",rx:3}));
    }
    /* ==============================================================================================
       6lx — THE CROSS BELONGS TO THE SHAPE, NOT TO THE PAGE.
       Ced: "make the grey lines only stretch up to the shape or redline or photo's shape, just a
       little extended."

       6lu drew the two axes right across the sheet — measured on a 734 x 950 page, `x1 0 -> x2 734`
       and `y1 0 -> y2 950`. That is a pair of full-length rules cutting the drawing in half, over a
       mark that may be an inch across, and at that length they stop reading as "this mark's centre"
       and start reading as a guide belonging to the page. The job of the cross is to say where the
       pivot is, and that only needs to reach as far as the thing turning about it.

       So each axis is the mark's own half-extent plus a short overhang, and because the box's extent
       changes as it turns, the half-extents are recomputed from the ANGLE each frame (`rotGuideSpin`):
       the axis-aligned bounding box of a w x h rectangle turned by t is
       `w|cos t| + h|sin t`  by  `w|sin t| + h|cos t|`. A stroke, which has no box of its own, gets a
       modest fixed reach instead.
       ============================================================================================== */
    const EXT=16;                                       /* the "little extended" part, in pixels */
    const bw=(box&&(box.bw||box.w))||0, bh=(box&&(box.bh||box.h))||0;
    const ax=(bw?bw/2:70)+EXT, ay=(bh?bh/2:70)+EXT;
    const axH=mk("line",{x1:X-ax,y1:Y,x2:X+ax,y2:Y,class:"rg-ax"});
    const axV=mk("line",{x1:X,y1:Y-ay,x2:X,y2:Y+ay,class:"rg-ax"});
    svg.appendChild(axH); svg.appendChild(axV);
    const arm=mk("line",{x1:X,y1:Y,x2:X,y2:Y,class:"rg-arm"});
    svg.appendChild(arm);
    svg.appendChild(mk("circle",{cx:X,cy:Y,r:3,class:"rg-hub"}));
    host.appendChild(svg);
    _rotGuide={svg,arm,axH,axV,X,Y,r,bw,bh,ext:EXT};
    return _rotGuide;
  }catch(e){ return null; }
}
let _rotGuide=null;
function rotGuideTo(x,y){
  if(!_rotGuide)return;
  try{ _rotGuide.arm.setAttribute("x2",x-_rotGuide.r.left);
       _rotGuide.arm.setAttribute("y2",y-_rotGuide.r.top); }catch(e){}
}
/* 6lx — the axes follow the box's turning extent, so the cross keeps hugging the shape */
function rotGuideSpin(deg){
  const G=_rotGuide; if(!G||!G.axH||!G.bw||!G.bh)return;
  try{
    const t=((+deg||0)*Math.PI)/180, cs=Math.abs(Math.cos(t)), sn=Math.abs(Math.sin(t));
    const ax=(G.bw*cs+G.bh*sn)/2+G.ext, ay=(G.bw*sn+G.bh*cs)/2+G.ext;
    G.axH.setAttribute("x1",G.X-ax); G.axH.setAttribute("x2",G.X+ax);
    G.axV.setAttribute("y1",G.Y-ay); G.axV.setAttribute("y2",G.Y+ay);
  }catch(e){}
}
function rotGuideClose(){
  try{ if(_rotGuide&&_rotGuide.svg)_rotGuide.svg.remove(); }catch(e){}
  _rotGuide=null;
}

/* rotate an annotation by dragging the ↻ handle */
/* =================================================================================================
   6hb — TYPE THE ANGLE
   -------------------------------------------------------------------------------------------------
   Ced: "when clicking the rotate, allow user to enter value of degrees."

   Dragging the ↻ grip is how you turn something by eye, and it is the wrong tool for "this member is
   at 37°". A CLICK on the grip — a press that goes nowhere, which until now did nothing at all — asks
   for the number instead. A mark carries an absolute angle, so its dialog says what it is now and 0
   puts it back square; a stroke and a selection have no angle of their own, so theirs turns BY what is
   typed, which is the only thing that means anything for a run of points.
   ================================================================================================= */
async function askAngle(opts){
  let said=null;
  try{
    said=await sbAsk({title:opts.title||"Rotate",
                      hint:opts.hint||"Type the angle in degrees. Negative turns anticlockwise.",
                      placeholder:String(opts.now!=null?opts.now:0),
                      ok:opts.ok||"Turn it"});
  }catch(e){ return false; }
  if(said==null)return false;
  const v=parseFloat(String(said).replace(/[^0-9.+-]/g,""));
  if(!isFinite(v)){ setStatus("\u201c"+said+"\u201d is not an angle.",true); return false; }
  opts.apply(v);
  return true;
}
/* turn a stroke's points about their own centre, by a given number of degrees */
function rotateLineBy(l,deg,pg){
  if(!l||!pg||!deg)return;
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const o=linePts(l).map(p=>[p[0],p[1]]);
  const cx=o.reduce((t,p)=>t+p[0],0)/o.length, cy=o.reduce((t,p)=>t+p[1],0)/o.length;
  const t=deg*Math.PI/180, cs=Math.cos(t), sn=Math.sin(t);
  const np=o.map(p=>{ const px=(p[0]-cx)*w, py=(p[1]-cy)*h;
    return [cx+(px*cs-py*sn)/w, cy+(px*sn+py*cs)/h]; });
  if(l.pts||np.length>2)l.pts=np;
  l.x1=np[0][0]; l.y1=np[0][1];
  l.x2=np[np.length-1][0]; l.y2=np[np.length-1][1];
}
/* and everything selected, about the middle of the selection */
function rotateSelectionBy(deg,pg,bb){
  if(!pg||!bb||!deg)return;
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const cxp=(bb.l+bb.r)/2, cyp=(bb.t+bb.b)/2;
  const th=deg*Math.PI/180, c=Math.cos(th), sn=Math.sin(th);
  const turn=(px,py)=>{ const x=px-cxp, y=py-cyp; return [cxp+x*c-y*sn, cyp+x*sn+y*c]; };
  multiAnnos().forEach(a=>{
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const bw=d?d.offsetWidth:(a.nw||0)*w, bh=d?d.offsetHeight:(a.nh||0)*h;
    const q=turn(a.nx*w+bw/2,a.ny*h+bh/2);
    a.nx=(q[0]-bw/2)/w; a.ny=(q[1]-bh/2)/h; a.rot=(a.rot||0)+deg;
  });
  multiLines().forEach(l=>{
    const np=linePts(l).map(p=>{ const q=turn(p[0]*w,p[1]*h); return [q[0]/w,q[1]/h]; });
    if(l.pts||np.length>2)l.pts=np;
    l.x1=np[0][0]; l.y1=np[0][1];
    l.x2=np[np.length-1][0]; l.y2=np[np.length-1][1];
  });
}
function startAnnoRotate(ev,a,d,pg){
  /* 6fb — a LOCKED mark does not move. The lock is checked at the gesture, not in the renderer,
     so the mark still selects and still shows its bar — you just cannot shift it by accident. */
  if(a&&a.lock){ try{toast("This mark is locked");}catch(_){ } return; }
  ev.preventDefault(); ev.stopPropagation(); selectAnno(a.id);
  /* 6gt — and a click on the rotate grip turns the mark by nothing at all */
  const _rpre=snapshot(); let _rotMoved=false;
  const _rx=ev.clientX, _ry=ev.clientY;
  try{d.setPointerCapture(ev.pointerId);}catch(e){}
  const r=d.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const start=Math.atan2(ev.clientY-cy, ev.clientX-cx); const base=a.rot||0;
  /* 6fa — SAY THE ANGLE. Rotating by eye and hoping is not a way to line a callout up with a member:
     the reading follows the handle, and it says when Snap has caught the angle rather than leaving you
     to guess whether 89.6° was meant to be 90. */
  const hud=degHUD();
  const move=e=>{
    if(!_rotMoved){
      if(Math.hypot(e.clientX-_rx,e.clientY-_ry)<=DRAG_SLOP)return;
      _rotMoved=true;
      S.history.push(_rpre); if(S.history.length>80)S.history.shift();
      S.future=[]; updateUndoUI();
      /* 6lu — the cross and the arm go up on the first real movement, not on the press, so a click
         that turns out to be a request to type the angle leaves nothing behind */
      /* 6lx — the guide is given the mark's UNROTATED size (`offsetWidth/Height`); `r` is the
         bounding box it already occupies at `base`, which is a different number the moment the mark
         arrives with a turn on it, and `rotGuideSpin` derives the turning extent itself. */
      try{ rotGuideOpen(pg,cx,cy,{x:r.left,y:r.top,w:r.width,h:r.height,
                                  bw:d.offsetWidth,bh:d.offsetHeight}); }catch(_){}
      try{ rotGuideSpin(a.rot||0); }catch(_){}
    }
    try{ rotGuideTo(e.clientX,e.clientY); }catch(_){}
    let deg=base+(Math.atan2(e.clientY-cy, e.clientX-cx)-start)*180/Math.PI;
    let caught=false;
    if(e.shiftKey){ deg=Math.round(deg/15)*15; caught=true; }
    else if(S.snap&&!(e.ctrlKey||e.metaKey)){
      const step=SNAP_DEG_STEP, sn=Math.round(deg/step)*step;
      if(Math.abs(deg-sn)<=SNAP_DEG){ deg=sn; caught=true; }
    }
    a.rot=Math.round(deg*10)/10;
    setMarkSpin(d,a.rot);                            /* 6lz — upright while it turns, too */
    try{ const _f=document.querySelector('.anno.selui'); if(_f)setMarkSpin(_f,a.rot); }catch(_){}
    positionBar();
    /* 6lx — the cross hugs the shape, so it has to follow the shape's own turning box */
    try{ rotGuideSpin(a.rot); }catch(_){}
    degHUDShow(hud,a.rot,caught,cx,cy,a.rot-base);   /* 6lu — and how far it has come */
  };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    degHUDHide(hud);
    try{ rotGuideClose(); }catch(_){}        /* 6lu */
    if(!_rotMoved){
      /* 6hb — a press that went nowhere is a request to type the angle. 6ms — and it is typed on
         the mark, not in a dialog over the drawing: see `angleChipOpen`. */
      angleChipOpen(a,d,pg);
      return;
    }
    try{ autosave(); }catch(_){}
    setStatus(`Rotated to ${((a.rot||0)%360+360)%360 ? ((Math.round((a.rot||0)*10)/10)+"\u00b0") : "0\u00b0"}.`); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* ==================================================================================================
   6ms — TYPING AN ANGLE HAPPENS ON THE MARK. Ced, with a screenshot of the modal: "this is still
   showing when rotate was clicked, change it to what i asked to be", beside his own picture of a
   small rounded chip carrying a rotate glyph and an editable `-45°`.

   6hb made a click on the rotate grip open `askAngle` — a dialog in the middle of the window, over
   a dimmed sheet. For a thing as small as an angle that is the wrong size of gesture twice over: it
   covers the drawing you are turning the mark against, and it moves your eye and your hand away
   from the mark and back again for two keystrokes.

   The chip is the readout that is already there while you drag (`degHUD`), with the number made
   editable and put beside the mark. Enter turns it, Escape leaves it, clicking anywhere else leaves
   it. It is the same shape and the same place your eye is already looking, so the angle is typed
   where the turning is happening.
   ================================================================================================== */
let _angChip=null;
function angleChipClose(){
  if(!_angChip)return;
  const c=_angChip; _angChip=null;
  try{ document.removeEventListener("pointerdown",c._away,true); }catch(e){}
  try{ c.el.remove(); }catch(e){}
}
/* 6mt — and it serves EVERY selectable thing, not only a mark. Ced: "apply this to all selectable
   items." A stroke and a multi-selection turn by a DELTA rather than to an absolute angle, so what
   differs between them is the starting value and what the number means; the chip itself does not
   care. `opts` is {rect, now, apply, note}. */
function angleChipOpen(a,d,pg,opts){
  angleChipClose();
  opts=opts||{};
  if(!a&&!opts.rect)return;
  const el=document.createElement("div");
  el.className="angchip";
  const g=document.createElement("span"); g.className="ac-g"; g.textContent="\u21bb";
  const inp=document.createElement("input");
  inp.type="text"; inp.className="ac-in"; inp.spellcheck=false;
  inp.setAttribute("aria-label","Angle in degrees");
  inp.value=String(Math.round(((opts.now!=null?opts.now:(a&&a.rot)||0))*10)/10);
  const deg=document.createElement("span"); deg.className="ac-d"; deg.textContent="\u00b0";
  el.appendChild(g); el.appendChild(inp); el.appendChild(deg);
  document.body.appendChild(el);
  /* beside the mark, below its box, and never off the window — the same clamp 6ly gave the HUD */
  try{
    const r=opts.rect||(d||document.querySelector('.anno[data-id="'+a.id+'"]')).getBoundingClientRect();
    const w=el.offsetWidth||120, h=el.offsetHeight||26, M=8;
    /* 6ms — below the turn and drag grips, not on top of them. Ced: "make the input for degree
       lower than the drag and rotate icon." They hang `BAR_HANDLE_DROP` (52px) under the box, so
       the chip starts past that. */
    let L=r.left+r.width/2, Tp=r.bottom+BAR_HANDLE_DROP+14+h/2;
    if(Tp+h/2>window.innerHeight-M)Tp=Math.max(M+h/2,r.top-18-h/2);
    L=Math.min(Math.max(L,w/2+M), window.innerWidth-w/2-M);
    el.style.left=L+"px"; el.style.top=Tp+"px";
  }catch(e){}
  const commit=()=>{
    const v=parseFloat(String(inp.value).replace(/[^0-9.+-]/g,""));
    angleChipClose();
    if(!isFinite(v))return;
    try{ pushHistory(); }catch(e){}
    if(opts.apply){ try{ opts.apply(Math.round(v*10)/10); }catch(e){} return; }
    a.rot=Math.round(v*10)/10;
    try{ layoutAnnos(); drawAllLines(); selectAnno(a.id); autosave(); }catch(e){}
    setStatus("Turned to "+(Math.round(v*10)/10)+"\u00b0.");
  };
  inp.addEventListener("keydown",e=>{
    e.stopPropagation();
    if(e.key==="Enter"){ e.preventDefault(); commit(); }
    else if(e.key==="Escape"){ e.preventDefault(); angleChipClose(); }
  });
  /* a press anywhere else leaves the angle as it was — the next frame, so the press that opened
     this one does not immediately close it */
  const away=e=>{ if(!el.contains(e.target))angleChipClose(); };
  _angChip={el,_away:away};
  setTimeout(()=>{ if(_angChip&&_angChip.el===el)document.addEventListener("pointerdown",away,true); },0);
  requestAnimationFrame(()=>{ try{ inp.focus(); inp.select(); }catch(e){} });
}
function openPageOrg(){ renderPageOrg(); reflectLocked(); const m=$("#pageOrg"); if(m)m.classList.add("show"); }

/* Join the fragments of one wrapped cell back into a single value. */
function joinCellLines(prev,next){
  if(!prev)return next;
  /* 6ef — a STACKED cell, not a wrapped one. Some forms print the same value on two lines of one cell
     (the Vendor cell of an antenna row carrying the antenna's vendor and the mount's, both COMMSCOPE).
     Every rule below assumes the two fragments are halves of one value, so it glued them into
     "COMMSCOPE COMMSCOPE" — a string nothing printed and nobody typed, which then differs from the
     printed cell, counts as a change, and gets redlined as two crammed lines. A repeat is a repeat:
     keep one copy. Only an EXACT repeat collapses — of the whole cell so far, or of its last token when
     the incoming line is a single token — so "ANDREW/CO"+"MMSCOPE" and "INTEGRATED"+"ANTENNA" are
     untouched. */
  {
    const p=String(prev).trim(), q=String(next).trim();
    if(q&&(p===q||(!/\s/.test(q)&&(p.split(/\s+/).pop()||"")===q)))return prev;
  }
  /* If the first fragment already contains a space the cell holds several words, so the break is at a
     word boundary and the space is kept ("AIRSCALE DUAL RRH 4T4R" + "B25/66 320W AHFIB").
     A single-token fragment means the token itself was too long for the column, so it is rejoined with
     no space ("ANDREW/CO"+"MMSCOPE" -> ANDREW/COMMSCOPE, "WR-VG66ST-B"+"RD" -> WR-VG66ST-BRD).
     Two plain words are also kept apart, which preserves "INTEGRATED ANTENNA RADIO". */
  const multiWord=/\s/.test(prev.trim());
  const t2=next.trim().split(/\s+/)[0]||"";
  /* both plain words AND the second is a real word, not a 1-2 letter remnant: "ROSENBERG"+"ER" is one
     token (ROSENBERGER) while "INTEGRATED"+"ANTENNA" is two words. */
  const bothPlain=/^[A-Za-z]+$/.test(prev.trim().split(/\s+/).pop()||"")&&/^[A-Za-z]{3,}$/.test(t2);
  return prev+((multiWord||bothPlain)?" ":"")+next;
}

/* ---- generic geometry-driven table reading (columns, row bands, cells) ---- */
function clusterBy(vals,tol){
  const cl=[]; vals.slice().sort((a,b)=>a-b).forEach(v=>{
    const last=cl[cl.length-1];
    if(last && v-last.x<=tol){ last.sum+=v; last.n++; last.x=last.sum/last.n; }
    else cl.push({x:v,sum:v,n:1});
  });
  return cl;
}

function tableColumns(dataItems,headerItems){
  const TOL=0.012;
  const cen=clusterBy(dataItems.map(t=>t.nx+(t.nw||0)/2),TOL);
  const lef=clusterBy(dataItems.map(t=>t.nx),TOL);
  const mode=(cen.length<=lef.length)?"center":"left";
  const cl=(mode==="center")?cen:lef;
  const xs=cl.map(c=>c.x);
  const key=t=>(mode==="center")?(t.nx+(t.nw||0)/2):t.nx;
  const defs=xs.map((x,i)=>{
    const prev=xs[i-1], next=xs[i+1];
    return { x, mode,
             from: prev!=null?(prev+x)/2:Math.max(0,x-0.06),
             to:   next!=null?(x+next)/2:1.01, name:"" };
  });
  (headerItems||[]).slice().sort((a,b)=>(a.ny-b.ny)||(a.nx-b.nx)).forEach(t=>{
    const k=key(t); const d=defs.find(c=>k>=c.from&&k<c.to); if(!d)return;
    const s=String(t.str).trim(); if(s) d.name=d.name?(d.name+" "+s):s;
  });
  defs.forEach((d,i)=>{ if(!d.name)d.name="Column "+(i+1); });
  /* 6df — where a column really BEGINS and ENDS, for anything that has to sit inside it.
     `from`/`to` are cut halfway between neighbouring column CENTRES, which is right for deciding which
     column a run belongs to and wrong for everything else: when a wide column sits beside a narrow one
     the midpoint of the two centres is nowhere near the middle of either. That is why a correction
     centred "in its column" on Port Level sat left of the printed model it replaced — the Vendor column
     beside it is twice as wide. `boxL`/`boxR` are cut halfway through the WHITE GAP between the ink of
     one column and the ink of the next, so the centre between them is the cell's own centre. */
  const ext=defs.map(()=>null);
  (dataItems||[]).forEach(t=>{
    const k=key(t); const i=defs.findIndex(c=>k>=c.from&&k<c.to); if(i<0)return;
    const l=t.nx, r=t.nx+(t.nw||0);
    if(!ext[i])ext[i]={l,r}; else { ext[i].l=Math.min(ext[i].l,l); ext[i].r=Math.max(ext[i].r,r); }
  });
  defs.forEach((d,i)=>{
    const e=ext[i]; if(!e){ d.boxL=d.from; d.boxR=d.to; return; }
    let p=null,n=null;
    for(let j=i-1;j>=0;j--){ if(ext[j]){ p=ext[j]; break; } }
    for(let j=i+1;j<defs.length;j++){ if(ext[j]){ n=ext[j]; break; } }
    d.boxL=(p&&p.r<e.l)?((p.r+e.l)/2):Math.max(0,e.l-0.008);
    d.boxR=(n&&n.l>e.r)?((e.r+n.l)/2):Math.min(1,e.r+0.008);
    if(d.boxL>e.l)d.boxL=e.l;                       // never inside its own ink
    if(d.boxR<e.r)d.boxR=e.r;
    if(!(d.boxR>d.boxL)){ d.boxL=d.from; d.boxR=d.to; }
  });
  LOG(`tableColumns: ${mode}-aligned, ${defs.length} column(s) [${defs.map(d=>d.name).join(" | ")}]`);
  return {defs,mode,key};
}

/* split lines into physical rows on vertical gaps larger than the in-cell line pitch */
function groupLineRows(lines){
  if(lines.length<2)return lines.map(l=>[l]);
  const gaps=[]; for(let i=1;i<lines.length;i++) gaps.push(lines[i].y-lines[i-1].y);
  const asc=gaps.slice().sort((a,b)=>a-b);
  /* Look for a BIMODAL split: in-cell line pitch vs. between-row padding. The largest relative jump
     in the sorted gaps is that boundary. If there is no such jump the rows are single-line and evenly
     spaced, so threshold 0 leaves every line as its own row. (A median-based threshold merged an
     evenly-spaced table into one band and the reader then returned nothing.) */
  let thr=0, best=0;
  for(let i=1;i<asc.length;i++){
    const jump=asc[i]-asc[i-1];
    if(asc[i]>0 && jump>best && jump/asc[i]>0.4){ best=jump; thr=(asc[i]+asc[i-1])/2; }
  }
  const out=[]; let cur=[lines[0]];
  for(let i=1;i<lines.length;i++){
    if(gaps[i-1]>thr){ out.push(cur); cur=[lines[i]]; } else cur.push(lines[i]);
  }
  out.push(cur);
  return out;
}

function readTableByCell(pages,headerTest,skipRe){
  const columns=[], rows=[], colX={}, colSpan={};
  let carried=null;                         // column defs carried onto continuation pages
  (pages||[]).forEach(pi=>{
    if(!S.pages[pi])return;
    const lines=pageLines(pi);
    let hi=-1;
    for(let i=0;i<lines.length;i++){ if(headerTest(lines[i])){ hi=i; break; } }
    /* 1. A continuation page usually does NOT repeat the header. Previously the whole page was
       skipped, which is why sectors printed on later pages never appeared at all. */
    if(hi<0){
      if(!carried){ LOG("readTableByCell: no header line on page",pi+1); return; }
      LOG("readTableByCell: page",pi+1,"continues the table (no repeated header)");
      const bandsC=groupLineRows(lines.filter(l=>!/^page\d|page\d+of\d+/.test(l.norm)));
      emit(bandsC,carried,pi);
      return;
    }
    /* Group everything from the header down into row-bands. A wrapped header ("Sec-"/"Pos",
       "Cascaded"/"From/Cpri Info") is tightly spaced just like any multi-line cell, so it forms the
       FIRST band — no keyword guessing needed. Previously its second line became a data row, which
       both stripped the column names and produced a phantom row. */
    let fromHdr=lines.slice(hi).filter(l=>!/^page\d|page\d+of\d+/.test(l.norm));
    const cut=fromHdr.findIndex(l=>/localmarketnote|marketnotes/.test(l.norm));
    if(cut>0){ LOG("readTableByCell: stopping at Local Market Notes on page",pi+1); fromHdr=fromHdr.slice(0,cut); }
    const bands=groupLineRows(fromHdr);
    if(bands.length<2){ LOG("readTableByCell: nothing below the header on page",pi+1); return; }
    const hdrItems=[].concat(...bands[0].map(l=>l.items));
    const bodyBands=bands.slice(1);
    const body=[].concat(...bodyBands);
    if(!body.length)return;
    const dataItems=[].concat(...body.map(l=>l.items));
    const cols=tableColumns(dataItems,hdrItems);
    if(cols.defs.length<2){ LOG("readTableByCell: could not resolve columns on page",pi+1); return; }
    carried=cols;
    /* Two columns can print the SAME header — the RFDS has "Calculated SQIN per Unit" twice. Cells are
       keyed by column name, so the second overwrote the first and neither redlined properly. Later
       duplicates get a numeric suffix; the printed text is shown in the header. */
    /* Dedupe only WITHIN this page's own header row. Comparing against the accumulated list renamed a
       header that simply repeats on page 2 of the same table, so page 2's cells ended up under different
       keys from page 1's and stopped matching — that broke RF Inventory. */
    const _seen=new Set();
    cols.defs.forEach(d=>{
      if(_seen.has(d.name)&&!d._dedup){
        const base=d.name; let k=2;
        while(_seen.has(base+" ("+k+")"))k++;
        d.label=base; d.name=base+" ("+k+")"; d._dedup=true;
      }
      _seen.add(d.name);
      if(columns.indexOf(d.name)<0)columns.push(d.name);
      if(colX[d.name]==null)colX[d.name]=d.x;
      /* the column's real span — the cell's text width is NOT the column width */
      if(colSpan[d.name]==null)colSpan[d.name]={from:d.from,to:Math.min(1,d.to)};
    });
    emit(bodyBands,cols,pi);
    LOG(`readTableByCell p${pi+1}: ${rows.length} row(s) so far from ${body.length} line(s)`);
  });
  return {columns,rows,colX,colSpan};

  /* Turn bands into rows. A band only STARTS a row when it carries a value in the key column;
     otherwise it is the rest of the row above (the key can sit on a middle line, and a tall cell can
     be split by the gap heuristic). Bands before the first keyed band are page furniture and dropped
     — that is what was showing up as blank/fragment rows. */
  function emit(bands,cols,pi){
    const {defs,key}=cols;
    const keyName=defs[0].name;
    const cellsOf=group=>{
      const cells={}, g={};
      group.forEach(l=>l.items.forEach(t=>{
        const s=String(t.str).trim(); if(!s)return;
        const k=key(t);
        let d=defs.find(c=>k>=c.from&&k<c.to);
        if(!d){
          /* A run whose centre falls just outside a band was being DROPPED — which is how
             "DC6-48-60-18-8" lost its "-8" and read as "DC6-48-60-18". Fall back to the column its span
             overlaps most, then to the nearest centre. */
          const l0=t.nx, r0=t.nx+(t.nw||0);
          let bo=0; defs.forEach(c=>{ const ov=Math.min(r0,c.to)-Math.max(l0,c.from); if(ov>bo){bo=ov;d=c;} });
          if(!d){ let bd=1e9; defs.forEach(c=>{ const dd=Math.abs(k-c.x); if(dd<bd){bd=dd;d=c;} }); if(bd>0.09)d=null; }
        }
        if(!d)return;
        cells[d.name]=joinCellLines(cells[d.name],s);
        /* keep the cell's whole box: a value wrapped onto a second line must be covered in full,
           otherwise the redline hides line 1 and leaves line 2 showing */
        const r2=t.nx+(t.nw||0), b2=t.ny+(t.nh||0);
        if(!g[d.name]) g[d.name]={nx:t.nx,ny:t.ny,nw:t.nw||0,nh:t.nh||0,x2:r2,y2:b2,lines:1,topY:t.ny,topR:r2,
                                   colL:(d.boxL!=null?d.boxL:(d.from!=null?d.from:null)),
                                   colR:(d.boxR!=null?d.boxR:(d.to!=null?d.to:null))};
        else { const q=g[d.name];
          if(t.ny<q.topY-0.002){ q.topY=t.ny; q.topR=r2; }        // a new topmost line
          else if(Math.abs(t.ny-q.topY)<=0.002){ q.topR=Math.max(q.topR,r2); }
          q.nx=Math.min(q.nx,t.nx); q.ny=Math.min(q.ny,t.ny);
          q.x2=Math.max(q.x2,r2); q.y2=Math.max(q.y2,b2);
          q.nw=q.x2-q.nx; q.lines=(q.lines||1)+1; }
      }));
      return {cells,g};
    };
    const parsed=bands.map(b=>({b,...cellsOf(b)}));
    const anyKeyed=parsed.some(p=>String(p.cells[keyName]||"").trim()!=="");
    let dropped=0;
    parsed.forEach(p=>{
      const filled=Object.keys(p.cells).filter(k2=>String(p.cells[k2]).trim()!=="");
      if(!filled.length)return;
      const keyed=String(p.cells[keyName]||"").trim()!=="";
      if(anyKeyed&&!keyed){
        const prev=rows[rows.length-1];
        if(!prev||prev.page!==pi){ dropped++; return; }        // fragment above the first real row
        Object.keys(p.cells).forEach(k2=>{
          const v=String(p.cells[k2]).trim(); if(!v)return;
          prev.cells[k2]=joinCellLines(prev.cells[k2],v);
          prev._orig[k2]=prev.cells[k2];
          /* 6ej — MERGE the geometry, do not just fill a gap in it. This took the continuation band's
             box only when the row had none for that column, so for a cell the page printed on two lines
             the second line's geometry was thrown away: the box covered line one only, `lines` stayed 1,
             and both of the things that depend on it went wrong — the mark did not cover the second
             printed line, and nothing in the column ever looked like it had wrapped, so no wrap measure
             could be taken from it. Which is why a form whose cells wrap read as a form where none do. */
          if(p.g[k2]){
            if(!prev._g[k2]) prev._g[k2]=p.g[k2];
            else {
              const q=prev._g[k2], nb=p.g[k2];
              const nbR=(nb.topR!=null?nb.topR:nb.x2);
              if(nb.ny<q.topY-0.002){ q.topY=nb.ny; q.topR=nbR; }
              else if(Math.abs(nb.ny-q.topY)<=0.002){ q.topR=Math.max(q.topR,nbR); }
              q.nx=Math.min(q.nx,nb.nx); q.ny=Math.min(q.ny,nb.ny);
              q.x2=Math.max(q.x2,nb.x2); q.y2=Math.max(q.y2,nb.y2);
              q.nw=q.x2-q.nx;
              q.lines=(q.lines||1)+(nb.lines||1);
            }
          }
        });
        prev._lines=(prev._lines||1)+p.b.length;
        return;
      }
      if(!anyKeyed&&filled.length<2)return;
      const kv=String(p.cells[keyName]||"").trim();
      const kidx=rows.filter(x=>x.page===pi&&String(x._key||"")===kv).length;
      rows.push({ cells:p.cells, _orig:Object.assign({},p.cells), _g:p.g, page:pi,
                  _y:p.b[0].y, _lines:p.b.length, _bind:"geometry", struck:false,
                  _key:kv, _keyIdx:kidx, _colName:keyName,
                  anchor:Object.values(p.cells).map(String).sort((a,b)=>b.length-a.length)[0]||"" });
    });
    if(dropped)LOG(`readTableByCell p${pi+1}: dropped ${dropped} fragment band(s) above the first keyed row`);
  }
}
