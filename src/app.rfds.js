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
window.addEventListener("error",ev=>{ try{ const s=document.getElementById("status"); if(s){ s.textContent="⚠ "+(ev.message||"error")+" — your work is autosaved; refresh to recover if needed."; s.className="err"; } try{ LOG("runtime error",ev.message||String(ev.error)); }catch(_){}
  if(_echoConsole)console.error("[RFDS] runtime error",ev.error||ev.message); }catch(_){} });
window.addEventListener("unhandledrejection",ev=>{
  try{ LOG("promise rejection",(ev.reason&&ev.reason.message)||String(ev.reason)); }catch(e){}
  if(_echoConsole)console.error("[RFDS] promise rejection",ev.reason); });
const S={ doc:null, docBytes:null, name:"", scale:1.2, mode:"redline", pages:[], annos:[], lines:[], suggestions:new Set(), sel:null, selLine:null, selMulti:new Set(), selMultiL:new Set(), clip:null, discrepancies:[], history:[], future:[], analysis:null, atollName:"", location:"", isPreliminary:null, snap:true, theme:"dark" };
let seq=1;
/* 6ct — Mirror is PER TAB. One flag drove the Design Summary and RF Inventory together, so turning it on
   to copy a count across sectors also started copying RF Inventory cells you had not touched. Antenna
   Position has always had its own (`_antMirror`); these two now do as well. */
let _mirrorSectors=true;    // Design Summary — 6ek: on by default
let _mirrorRf=true;         // RF Inventory — 6ek: on by default
function mirrorFlag(tab){
  let k=tab; if(!k){ try{ k=_azTab; }catch(e){ k=null; } }
  if(k==="rfInventory")return "rf";
  if(k==="antennaPosition"||k==="antennaExisting"||k==="antennaDecom")return "ant";
  /* 6cu — Equipment in Calc has NO mirror. There are no sectors to mirror across on that page, and
     falling through to the Design Summary's flag meant the two switched together. */
  if(k==="equipmentCalc")return null;
  if(k==="designSummary")return "ds";
  return null;
}
function mirrorOn(tab){
  const f=mirrorFlag(tab);
  if(!f)return false;
  try{ return f==="rf"?!!_mirrorRf:(f==="ant"?!!_antMirror:!!_mirrorSectors); }catch(e){ return false; }
}
function mirrorApplies(tab){ return !!mirrorFlag(tab); }
function mirrorToggle(tab){
  const f=mirrorFlag(tab);
  if(!f)return false;
  try{
    if(f==="rf")_mirrorRf=!_mirrorRf;
    else if(f==="ant")_antMirror=!_antMirror;
    else _mirrorSectors=!_mirrorSectors;
  }catch(e){}
  return mirrorOn(tab);
}  // 6ca: OFF by default. Mirroring an edit into sectors you have not looked at is a
                           // surprise, not a convenience — turn it on deliberately from the lane toggle.
const _rowUI=new WeakMap();   // row object -> its input elements (kept off the row so S.analysis stays serializable)
let _dsSub=null;   // active Design Summary sub-tab (sec:A / sec:B / bySector / bySite)
let _rfSub=null;   // active RF Inventory sector sub-tab
let _antSecSub=null;   // active Antenna sector sub-tab (within Final/Existing/Decom)
/* EVERY column is read and kept (so values round-trip and can still be redlined programmatically);
   the grid shows only the five that get redlined by hand. An allow-list beats a block-list here —
   real headers vary ("Common Name From/Cpri Info") and an unlisted column should stay hidden. */
const RF_SHOW=[/sec\W*pos/i,/equip/i,/vendor|manufact/i,/model/i,/status/i];
/* Every column is shown again. Hiding them was collapsing real tables whose headers are worded
   differently (Equipment Configuration, Equipment USID, Linked SideHaul, Common Name …), so the
   safe default is to show whatever the page actually has. Flip RF_HIDE_EXTRA to re-enable trimming. */
let _rfCols=null;                        // null until the first render decides the defaults
function rfDefaultCols(all){
  /* RRH Position is off by default — turn it on from the column chips if you need it */
  const want=[/sec\W*pos/i,/equipment\s*type/i,/vendor/i,/^model/i,/status/i];
  const vis=(all||[]).filter(c=>want.some(re=>re.test(String(c).trim())));
  return vis.length>=2?vis:(all||[]).slice();
}
function rfVisibleCols(cols){
  const all=cols||[];
  if(!_rfCols) _rfCols=rfDefaultCols(all);
  const vis=all.filter(c=>_rfCols.indexOf(c)>=0);
  return vis.length?vis:all;
}
function rfColToggleBar(all){
  const wrap=el("div","rf-cols");
  wrap.appendChild(el("span","rf-cols-lbl","Columns"));
  (all||[]).forEach(c=>{
    const on=_rfCols.indexOf(c)>=0;
    const b=el("button","rf-col"+(on?" on":""),escapeHtml(c));
    b.title=(on?"Hide":"Show")+" the "+c+" column";
    b.onclick=()=>{ const i=_rfCols.indexOf(c); if(i>=0)_rfCols.splice(i,1); else _rfCols.push(c); renderAnalyze(); };
    wrap.appendChild(b);
  });
  const allB=el("button","rf-col","All"); allB.title="Show every column";
  allB.onclick=()=>{ _rfCols=(all||[]).slice(); renderAnalyze(); };
  const defB=el("button","rf-col","Default"); defB.title="Back to the usual six columns";
  defB.onclick=()=>{ _rfCols=rfDefaultCols(all); renderAnalyze(); };
  wrap.appendChild(allB); wrap.appendChild(defB);
  return wrap;
}
/* which sector does an RF Inventory row belong to? read a Sector / Sec-Pos style column */
/* The sector of an RF Inventory row is the FIRST LETTER of its Sec-Pos value: "A-3" -> A, "B-1" -> B,
   "C-2(D)" -> C. Sec-Pos is checked before any column literally named "Sector", because Sec-Pos is what
   these tables actually carry. */
function rfRowSector(r,cols){
  const list=cols||Object.keys(r.cells||{});
  const secPos=list.find(c=>/sec\W*pos/i.test(String(c).trim()))
             || list.find(c=>/^sec-?pos/i.test(String(c).trim()));
  const pick=col=>{
    if(!col)return null;
    const v=String(r.cells[col]==null?"":r.cells[col]).trim();
    if(!v)return null;
    const m=v.match(/^\s*([A-Za-z])/);            // the leading letter is the sector
    if(m){ const s=normSector(m[1]); if(s!=="—")return s; }
    return normSector(v);
  };
  let s=pick(secPos);
  if(s&&s!=="—")return s;
  s=pick(list.find(c=>/^sector$/i.test(String(c).trim()))||list.find(c=>/sector/i.test(String(c))));
  if(s&&s!=="—")return s;
  return r._sec||"—";
}
/* the Model column of the RF table (used to carry Design Summary model redlines across) */
/* Off by default: rows added on one tab are never added to another. */
let _carryInserts=false;
function rfModelCol(cols){
  const list=cols||[];
  return list.find(c=>/^model$/i.test(String(c).trim()))
      || list.find(c=>/model/i.test(String(c)))
      || list.find(c=>/^equipment$/i.test(String(c).trim()))
      || null;
}
/* 4. carry Design Summary edits into RF Inventory: a renamed model follows every unit of that
   model, and a struck Design Summary row strikes that model's units in the same sector. */
/* Item 4: a model corrected in RF Inventory is reflected in the Design Summary rows that print the same
   model (and vice versa via carryDsToRf). Each table then redlines its OWN cell using its OWN geometry —
   counts are never carried across, only the model text. */
function carryRfModelsToDs(){
  /* 6dz — the same gate carryDsToRf has, for the same reason. This one had NO Link check at all, so if
     it were ever wired up it would push every RF Inventory correction onto the Design Summary whatever
     either switch said. It is not wired up — `syncModels` decides a model from the shared map instead
     of pushing it, which is why (see §5, "push vs. decide") it is idempotent, order-free and reversible
     where this is none of the three. Kept, gated, and deliberately not called. */
  if(!linkOn("rfInventory")||!linkOn("designSummary"))return 0;
  const A=S.analysis; if(!A||!A.rfInventory||!A.designSummary)return 0;
  const cols=A.rfInventory.columns||[];
  const mcol=rfModelCol(cols); if(!mcol)return 0;
  let n=0;
  (A.rfInventory.rows||[]).forEach(r=>{
    if(r.inserted)return;
    const printed=String((r._orig&&r._orig[mcol]!=null)?r._orig[mcol]:"").trim();
    const now=String(r.cells[mcol]||"").trim();
    if(!printed||!now||printed===now)return;
    const pk=normModelKey(printed);
    (A.designSummary||[]).forEach(ds=>{
      if(ds.inserted||ds._noGeo)return;
      if(normModelKey(ds.origModel||ds.model)!==pk)return;
      if(String(ds.model)!==now){ ds.model=now; ds.fromRfModel=true; n++; }
    });
  });
  if(n)LOG("carryRfModelsToDs: reflected",n,"RF model correction(s) into Design Summary rows");
  return n;
}
/* Item 2: in these columns a value that occupies two or three lines is a single token broken by the
   cell width (ROSENBERG|ER, DC6-48-60-18-8|F, ANDREW/CO|MMSCOPE, NNH4-65C-R6-|HG). The redline must
   therefore cover the WHOLE cell as one block, not the first line only — covering one line left the
   remainder showing, which is why some redlines looked like they never applied. */
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
    setMode("select"); return; }
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
  setMode("select");
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
    /* hand back the select tool so the copies can be moved or retyped without a second click */
    setMode("select");
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
    const pt=printedPt(pi,box); if(pt)a.size=pt;      // same size as the printed text
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
function carryDsToRf(){
  /* This predates the per-tab toggle and was still copying Design Summary model renames into RF units
     whatever the RF tab's switch said — the remaining way a model leaked across sectors with linking off. */
  /* 6dz — BOTH ENDS, not just the receiving one. 6cn's rule is "a correction made on a linked tab goes
     into the shared map and lands on every OTHER tab that is also on; a tab that is off neither sends
     nor takes" — and this enforced only the taking half. It checked the tab it writes INTO and never the
     tab the change came FROM, so a Design Summary edit made with the Design Summary's own Link OFF — a
     row-local correction, deliberately confined to one row — was pushed onto every RF Inventory row
     carrying that model the moment the RF tab was opened, because opening it is what runs this.

     Measured on the reference form, one row-local model edit on sector A:
        before   Design Summary A corrected, RF Inventory A-1, B-1 and C-1 ALL corrected
        after    Design Summary A corrected, RF Inventory untouched
     The same leak carried a strike, which is worse: it marked equipment for removal on a tab the user
     had explicitly unlinked. */
  if(!linkOn("designSummary")||!linkOn("rfInventory"))return 0;
  const A=S.analysis; if(!A||!A.rfInventory||!A.rfInventory.rows)return 0;
  const cols=A.rfInventory.columns||[];
  const mcol=rfModelCol(cols); if(!mcol)return 0;
  let n=0;
  (A.designSummary||[]).forEach(ds=>{
    const renamed=!!(ds.model&&ds.origModel&&ds.model!==ds.origModel);
    if(!renamed&&!ds.struck)return;
    const key=normModelKey(ds.origModel||ds.model); if(!key)return;
    A.rfInventory.rows.forEach(r=>{
      if(r.inserted)return;
      const printed=(r._orig&&r._orig[mcol]!=null)?r._orig[mcol]:r.cells[mcol];
      if(normModelKey(printed)!==key)return;
      /* 6ek — and the same sector. The strike path below has always had this test; the RENAME path did
         not, so a model corrected on Alpha's Design Summary was pushed onto the Beta and Gamma RF rows
         carrying that model. Link goes across tabs; crossing sectors is Mirror's to do. */
      { const rs2=rfRowSector(r,cols), ds2=normSector(ds.sector);
        if(rs2&&rs2!=="—"&&ds2&&ds2!=="—"&&rs2!==ds2)return; }
      if(ds.struck){
        const rs=rfRowSector(r,cols), dss=normSector(ds.sector);
        if(rs&&rs!=="—"&&dss&&dss!=="—"&&rs!==dss)return;      // sector-specific removal
        if(!r.struck){ r.struck=true; r.fromDs=true; n++; }
        return;
      }
      if(String(r.cells[mcol]||"")!==String(ds.model)){ r.cells[mcol]=ds.model; r.fromDs=true; n++; }
    });
  });
  if(n)LOG("carryDsToRf: carried",n,"Design Summary change(s) into RF Inventory");
  return n;
}
/* 2. Every inserted RF Inventory row is one new physical unit, so it raises that model's Final count
   in the Design Summary. Recomputed from scratch on each call (never incremental), so it is idempotent
   and self-corrects when an inserted row is edited or removed. */
/* Item 1: a model corrected anywhere is reflected in Equipment in Calculation too, so all three tables
   show the same corrected text. Counts still never cross tables. */
function carryModelsToEc(){
  /* 6cs — Equipment in Calc takes NOTHING from another tab while its own Link is off. This function
     predates the per-tab switch and carried Design Summary and RF Inventory model renames in regardless,
     so a page you had not touched came back redlined. */
  if(!linkOn("equipmentCalc"))return 0;
  const A=S.analysis; if(!A||!A.equipmentCalc)return 0;
  const map=new Map();
  (A.designSummary||[]).forEach(r=>{
    const was=String(r.origModel||"").trim(), now=String(r.model||"").trim();
    if(was&&now&&was!==now) map.set(normModelKey(was),now);
  });
  const cols=(A.rfInventory&&A.rfInventory.columns)||[];
  const mcol=rfModelCol(cols);
  if(mcol)(A.rfInventory.rows||[]).forEach(r=>{
    if(r.inserted)return;
    const was=String((r._orig&&r._orig[mcol])||"").trim(), now=String(r.cells[mcol]||"").trim();
    if(was&&now&&was!==now) map.set(normModelKey(was),now);
  });
  if(!map.size)return 0;
  let n=0;
  A.equipmentCalc.forEach(r=>{
    const now=map.get(normModelKey(r.origModel||r.model));
    if(now&&String(r.model)!==now){ r.model=now; r.fromLink=true; n++; }
  });
  if(n)LOG("carryModelsToEc: reflected",n,"model correction(s) into Equipment in Calc");
  return n;
}
/* Item 4: a model corrected in Equipment in Calc flows back the other way, so all three tables agree
   whichever one you edit. Counts still never cross. */
function carryEcModelsToOthers(){
  /* 6dz — gated like the others; it had no Link check either. Equipment in Calc starts unlinked
     precisely so a figure typed there stays there, and this would have carried its models out
     regardless. Not wired up: `syncModels` decides. */
  if(!linkOn("equipmentCalc"))return 0;
  const A=S.analysis; if(!A||!A.equipmentCalc)return 0;
  const map=new Map();
  A.equipmentCalc.forEach(r=>{
    const was=String(r.origModel||"").trim(), now=String(r.model||"").trim();
    if(was&&now&&was!==now) map.set(normModelKey(was),now);
  });
  if(!map.size)return 0;
  let n=0;
  (A.designSummary||[]).forEach(r=>{
    if(r.inserted||r._noGeo)return;
    const now=map.get(normModelKey(r.origModel||r.model));
    if(now&&String(r.model)!==now){ r.model=now; r.fromLink=true; n++; }
  });
  const cols=(A.rfInventory&&A.rfInventory.columns)||[];
  const mcol=rfModelCol(cols);
  if(mcol)(A.rfInventory.rows||[]).forEach(r=>{
    if(r.inserted)return;
    const printed=String((r._orig&&r._orig[mcol])||"").trim();
    const now=map.get(normModelKey(printed));
    if(now&&String(r.cells[mcol])!==now){ r.cells[mcol]=now; r.fromDs=true; n++; }
  });
  if(n)LOG("carryEcModelsToOthers: pushed",n,"Equipment-in-Calc model correction(s) out to the other tabs");
  return n;
}
/* ------------------------------------------------------------------------------------------------
   A model correction belongs to the EQUIPMENT, not to a tab. syncModels() rebuilds every table's model
   from one map on each call, so an edit shows up in the other two tabs immediately and — because the map
   is rebuilt rather than added to — undoing the edit puts every table back to the printed value. The
   older carry functions only ever wrote forwards, so a corrected value stayed behind after you changed
   your mind and switched tabs.
   ------------------------------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------------------------------
   Model corrections live in ONE explicit map on the analysis: printed-model-key -> corrected text.
   The previous version tried to infer which rows were "sources" from a _linked flag it set itself, and
   that flag came back on the next keystroke and disqualified the very row you were typing in — so every
   correction reverted. Nothing is inferred now: an edit writes the map, reverting to the printed value
   deletes from it, and syncModels() only ever copies the map outwards.
   ------------------------------------------------------------------------------------------------ */
function modelFix(){ const A=S.analysis; if(!A)return null; if(!A._modelFix)A._modelFix={}; return A._modelFix; }
/* 6ek — LINK IS SECTOR-SCOPED. The shared map was keyed by the model string alone, so a correction made
   on Alpha's Design Summary row landed on every RF Inventory and Antenna row carrying that model — Beta
   and Gamma included. That is Mirror's job, not Link's: Link carries a correction ACROSS TABS, Mirror
   carries it ACROSS SECTORS, and keying by model alone did both at once whether or not Mirror was on.

   The key carries the row's sector now. Mirror still crosses sectors, and because each row it copies to
   records its own edit, those corrections then travel across tabs in their own sector — so "unless it
   was mirrored" needs no special case, it is what falls out.

   Equipment in Calc has no sector: its rows are one line per model for the whole site. So it reads the
   sector-less answer, which exists only when every sector that carries that model agrees — which is the
   rule as asked for: EC follows a model when all three tabs agree on it. */
function rowSectorAny(r){
  if(!r)return "";
  try{
    if(r.sector!=null&&String(r.sector).trim()!=="")return normSector(r.sector);
    if(r.secPos||r._orig_secPos)return antRowSector(r);
    if(r.cells){
      const cols=Object.keys(r.cells);
      const s=rfRowSector(r,cols);
      if(s)return s;
    }
  }catch(e){}
  return "";
}
/* 6fp — THE POSITION A ROW SITS AT, when it has one. RF Inventory rows carry a Sec-Pos and Antenna
   Position rows carry a secPos; Design Summary and Equipment in Calc do not — a Design Summary line is
   one entry for a model in a sector, with no position of its own. */
function rowPosAny(r){
  if(!r)return "";
  try{
    if(r.secPos||r._orig_secPos){ const n=antPosNum(r); return n||""; }
    if(r.cells){
      const cols=Object.keys(r.cells);
      const k=rfRowSecPosKey(r,cols);
      const m=String(k||"").match(/^[A-Za-z]\s*(\d+)/);
      return m?m[1]:"";
    }
  }catch(e){}
  return "";
}
/* 6fp — AND THE KEY CARRIES IT. Ced: "do not change all the same model in a single sector when changing
   the model and vendor, only change corresponding position to other sectors. A-1 to B-1 and C-1, not
   A-1 to B-1 and B-3, C-1 and C-3 (if they're all the same models)."

   Until now the key was SECTOR + model, so a correction typed at A-1 was a statement about "this model,
   in sector A" and every position in sector A carrying it followed — measured on a form built with one
   model at A-1, A-3, B-1, B-3, C-1 and C-3, an edit at A-1 reached all six. A position is what
   identifies a piece of equipment on a tower; the model is not.

   A row that HAS a position is keyed by it. A row that has none is keyed as before, so Design Summary
   and Equipment in Calc are untouched, and the link between the tabs still works in both directions —
   see `want()` in syncModels for the two lookups that make that hold. */
function modelKeyFor(printed,row){
  const k=normModelKey(printed); if(!k)return "";
  const sec=rowSectorAny(row);
  if(!sec||sec==="—")return k;
  const pos=rowPosAny(row);
  return pos?(sec+"\u0001"+pos+"\u0001"+k):(sec+"\u0001"+k);
}
/* Which sectors carry this model at all, anywhere in the form. An Equipment in Calc row is one line for
   the whole site, so it may only follow a correction that EVERY sector carrying that model has on it.
   Counting the sectors that have an OPINION is not the same test, and it is the one I got wrong first:
   with a correction typed on alpha only, alpha was the single entry in the map, nothing disagreed with
   it, and the site-wide figure moved on one sector's say-so. */
function sectorsCarryingModel(k){
  const out={}; const A=S.analysis;
  if(!A||!k)return out;
  const add=s=>{ if(s&&s!=="\u2014")out[s]=true; };
  (A.designSummary||[]).forEach(r=>{ if(!r.inserted&&normModelKey(r.origModel)===k)add(normSector(r.sector)); });
  const cols=(A.rfInventory&&A.rfInventory.columns)||[], mc=rfModelCol(cols);
  if(mc)(A.rfInventory.rows||[]).forEach(r=>{
    if(!r.inserted&&normModelKey((r._orig&&r._orig[mc])||"")===k)add(rfRowSector(r,cols)); });
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(t=>{
    (A[t]||[]).forEach(r=>{
      const p=(r._orig_model!=null?r._orig_model:r.model);
      if(normModelKey(p)===k)add(antRowSector(r)); }); });
  return out;
}
/* the answer for a row with no sector of its own: only when every sector carrying the model agrees */
/* 6fp — every position in ONE sector that carries this model, and the correction they agree on. Used
   for the row that has no position of its own. */
function posFixUnanimous(m,sec,k){
  if(!m||!sec||!k)return null;
  const A=S.analysis; if(!A)return null;
  const pos={};
  const add=r=>{ const p=rowPosAny(r); if(p&&rowSectorAny(r)===sec)pos[p]=true; };
  const cols=(A.rfInventory&&A.rfInventory.columns)||[], mc=rfModelCol(cols);
  if(mc)(A.rfInventory.rows||[]).forEach(r=>{
    if(!r.inserted&&normModelKey((r._orig&&r._orig[mc])||"")===k)add(r); });
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(t=>{
    (A[t]||[]).forEach(r=>{
      const printed=(r._orig_model!=null?r._orig_model:r.model);
      if(normModelKey(printed)===k)add(r); }); });
  const list=Object.keys(pos);
  if(!list.length)return null;
  let v=null;
  for(let i=0;i<list.length;i++){
    const e=m[sec+"\u0001"+list[i]+"\u0001"+k];
    if(e==null)return null;                     // a position with no correction on it: not unanimous
    if(v==null)v=e;
    else if(String(v)!==String(e))return null;  // the positions disagree
  }
  return v;
}
function modelFixUnanimous(m,k){
  if(!k)return null;
  if(m[k]!=null)return m[k];                    // a sector-less correction speaks for the whole site
  const secs=Object.keys(sectorsCarryingModel(k));
  if(!secs.length)return null;
  let v=null;
  for(let i=0;i<secs.length;i++){
    const e=m[secs[i]+"\u0001"+k];
    if(e==null)return null;                     // a sector with no correction on it: not unanimous
    if(v==null)v=e;
    else if(String(v)!==String(e))return null;  // the sectors disagree: EC follows nothing
  }
  return v;
}
/* 6ek — A MIRRORED MODEL IS A CORRECTION IN EVERY SECTOR IT REACHED.
   With linking scoped by sector, a value mirrored to beta and gamma used to be pinned on those rows and
   nothing else: their own RF Inventory and antenna rows never heard about it, because the only entry in
   the shared map was the sector the value was typed in. "Unless it was mirrored" is this function — each
   sibling records the correction under ITS OWN sector's key, exactly as if it had been typed there. Every
   sector then agrees, which is also what lets Equipment in Calc (no sector of its own) follow it. */
function noteMirroredModel(row,printed,now,tab){
  const p=String(printed||"").trim(), n=String(now==null?"":now).trim();
  if(linkOn(tab)){
    const m=modelFix(), k=m?modelKeyFor(printed,row):"";
    if(k){
      if(!n||n===p) delete m[k]; else m[k]=n;
      if(row) delete row._ownFix;      // the map answers for it now, as it does for a typed correction
      return;
    }
  }
  /* not linked, or a row whose printed model is blank so there is no key: hold it on the row, which is
     what keeps a mirror from being undone by the next sync */
  if(row){ if(!n||n===p) delete row._ownFix; else row._ownFix=n; }
}
/* record (or clear) a correction; call from any model field */
/* The canonical equipment type of whatever row shape is passed in. */
function rowTypeAny(row){
  if(!row)return "";
  if(row.type)return canonType(row.type);
  if(row.origType)return canonType(row.origType);
  if(row.cells){
    const k=Object.keys(row.cells).find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
    if(k)return canonType(row.cells[k]);
  }
  return "";
}
function noteModelEdit(printed,now,row,tab){
  const m=modelFix(); if(!m)return;
  /* Remember which equipment type the correction came from, so an ANTENNA correction cannot reach an
     INTEGRATED ANTENNA RADIO that happens to carry the same model (AIR6472 B77G B77M). */
  try{
    const A0=S.analysis; if(A0){ A0._modelType=A0._modelType||{};
      const k0=normModelKey(printed), t0=rowTypeAny(row);
      if(k0){ if(t0)A0._modelType[k0]=t0; else delete A0._modelType[k0]; } }
  }catch(e){}
  const p=String(printed||"").trim(), n=String(now==null?"":now).trim();
  const k=modelKeyFor(printed,row);          // 6ek — the row's sector is part of the key
  /* 6ca — the Equipment in Calc bug. A row whose PRINTED model is blank (the reader finds plenty of them)
     produced an empty key, this function returned before storing anything, and `_ownFix` was never set.
     `syncModels` then resolved the row back to its printed value — "" — and the model you had just typed
     was wiped, on this render or the next tab switch. A row-local correction does not need a key: it is
     stored on the row. Only the SHARED map is keyed by model, so only that branch may bail out. */
  if(!k){
    if(row){ if(!n) delete row._ownFix; else row._ownFix=n; }
    syncModels();
    if(!n)LOG&&LOG("model cleared on a row with no printed model");
    else LOG&&LOG("row-local model kept on a row with no printed model:",JSON.stringify(n));
    return;
  }
  if(linkOn(tab)){
    /* linked: the correction belongs to the MODEL, so it goes in the shared map and reaches every row
       carrying that model, in every tab */
    if(row) delete row._ownFix;
    if(!n||n===p) delete m[k]; else m[k]=n;
  } else {
    /* not linked: the correction belongs to THIS ROW only. Nothing is written to the shared map, so no
       other row — and no other tab — can pick it up. */
    if(row){ if(!n||n===p) delete row._ownFix; else row._ownFix=n; }
  }
  syncModels();
}
/* Pick up corrections not made through a model field — a saved analysis from before the map existed,
   or a rename applied in code. Runs ONCE per analysis: doing it on every call is what made corrections
   stick around after they were undone. */
function seedModelFix(){
  const A=S.analysis; if(!A||A._modelSeeded)return 0;
  const m=modelFix(); if(!m)return 0;
  let n=0;
  /* 6ek — keyed the same way noteModelEdit keys, or a correction adopted at load would be sector-blind
     while every correction typed afterwards was not. */
  const take=(printed,now,row)=>{ const k=modelKeyFor(printed,row);
    if(!k||m[k]!=null)return;
    const p=String(printed||"").trim(), q=String(now||"").trim();
    if(p&&q&&p!==q){ m[k]=q; n++; } };
  (A.designSummary||[]).forEach(r=>{ if(!r.inserted)take(r.origModel,r.model,r); });
  (A.equipmentCalc||[]).forEach(r=>take(r.origModel,r.model,r));
  const mcol=rfModelCol((A.rfInventory&&A.rfInventory.columns)||[]);
  if(mcol)(A.rfInventory.rows||[]).forEach(r=>{ if(!r.inserted)take((r._orig&&r._orig[mcol])||"",r.cells[mcol],r); });
  A._modelSeeded=true;
  if(n)LOG("seedModelFix: adopted",n,"existing model correction(s)");
  return n;
}
/* One rule for the whole Analyze modal: when a model is corrected, should every row carrying that same
   model be corrected too? Applies to EVERY equipment type across Design Summary, RF Inventory,
   Antenna Position Details and Equipment in Calculation. */
/* Design Summary: type the four counts yourself instead of deriving them from Before/After. */
let _dsManualCounts=false;
/* Linking is per tab: a tab with it OFF neither sends its corrections out nor takes anyone else's in.
   Equipment in Calc starts OFF, since a figure typed there is meant to stay there. */
/* 6ca: every lane starts UNLINKED. A linked correction silently rewrites the same model on tabs you are
   not looking at, which is the wrong default for a document you are redlining cell by cell. */
/* 6ek — ON by default, on every tab. Link and Mirror are what the tool is FOR: a correction belongs to
   the equipment, not to the row it happened to be typed on, and having to switch that on before every
   session was a step with no decision in it. They are still per-tab switches and still visible in the
   lane, so anything unusual can be turned off deliberately. */
const _linkModels={designSummary:true, rfInventory:true, antennaPosition:true, equipmentCalc:true};
function linkTabKey(t){
  /* _azTab is declared further down the file, and this runs during top-level setup too — reading it
     inside its temporal dead zone throws and aborts the whole script, so guard it. */
  let k=t;
  if(!k){ try{ k=_azTab; }catch(e){ k=null; } }
  if(!k)k="designSummary";
  if(k==="antennaExisting"||k==="antennaDecom")return "antennaPosition";
  return (_linkModels[k]!==undefined)?k:"designSummary";
}
function linkOn(t){ return !!_linkModels[linkTabKey(t)]; }
/* 6ch — Link is ONE setting, not four. It was stored per tab and the toggle only ever set the tab you
   were looking at, so a correction linked on Design Summary never reached RF Inventory, Antenna Position
   or Equipment in Calc — which is the entire point of it. The per-tab store stays (a lot of code reads
   `_linkModels[key]`), but every key moves together. */
const LINK_TABS=["designSummary","rfInventory","antennaPosition","equipmentCalc"];
function linkAllOn(){ return LINK_TABS.every(k=>!!_linkModels[k]); }
function setLinkAll(on){ LINK_TABS.forEach(k=>{ _linkModels[k]=!!on; }); return !!on; }
/* 6cn — Link is a PER-TAB switch again. 6ch made it one setting because a correction linked on Design
   Summary was not reaching the other tabs; the real fault was elsewhere (the printed Equipment in Calc
   grid, fixed in 6ck), and moving all four together took away the ability to link two tabs and leave a
   third alone. The switch sets the tab you are on; a correction made on a linked tab goes into the
   shared map and lands on every OTHER tab that is also on. */
function setLinkTab(tab,on){ const k=linkTabKey(tab); _linkModels[k]=!!on; return !!on; }
function linkedTabNames(){
  const N={designSummary:"Design Summary",rfInventory:"RF Inventory",
           antennaPosition:"Antenna Position",equipmentCalc:"Equipment in Calc"};
  return LINK_TABS.filter(k=>_linkModels[k]).map(k=>N[k]);
}
/* Turning a tab ON adopts the row-local corrections already made on it, so they start spreading. */
function adoptOwnFixes(tab){
  const A=S.analysis; if(!A)return 0;
  const k=linkTabKey(tab), m=modelFix(); if(!m)return 0;
  let n=0;
  const take=(printed,r)=>{ if(!r||r._ownFix==null)return; const key=modelKeyFor(printed,r);
    if(key){ m[key]=r._ownFix; n++; } delete r._ownFix; };
  if(k==="designSummary")(A.designSummary||[]).forEach(r=>take(r.origModel,r));
  if(k==="equipmentCalc"){
    (A.equipmentCalc||[]).forEach(r=>take(r.origModel,r));
    const T=A.ecTable, mc=T&&T.columns?rfModelCol(T.columns):null;
    if(mc)(T.rows||[]).forEach(r=>take((r._orig&&r._orig[mc])||"",r));
  }
  if(k==="rfInventory"){
    const mc=rfModelCol((A.rfInventory&&A.rfInventory.columns)||[]);
    if(mc)((A.rfInventory&&A.rfInventory.rows)||[]).forEach(r=>take((r._orig&&r._orig[mc])||"",r));
  }
  if(k==="antennaPosition")["antennaPosition","antennaExisting","antennaDecom"].forEach(x=>
    (A[x]||[]).forEach(r=>take(r._orig_model!=null?r._orig_model:r.model,r)));
  return n;
}
/* 6da — every model correction that exists anywhere, gathered into the shared map. Turning Link ON for a
   tab means "make this tab agree with the rest of the document", and a correction made while the source
   tab was unlinked lives on its own ROW — so without this there was nothing for the newly linked tab to
   pick up and the switch appeared to do nothing. */
function adoptEveryModelFix(){
  const A=S.analysis; if(!A)return 0;
  const m=modelFix(); if(!m)return 0;
  let n=0;
  const take=(printed,now)=>{
    const p=String(printed||"").trim(), q=String(now||"").trim();
    if(!p||!q||p===q)return;
    const k=normModelKey(p); if(!k||m[k]!=null)return;
    m[k]=q; n++;
  };
  (A.designSummary||[]).forEach(r=>{ if(!r.inserted)take(r.origModel,r.model); });
  (A.equipmentCalc||[]).forEach(r=>take(r.origModel,r.model));
  [["rfInventory",A.rfInventory],["equipmentCalc",A.ecTable]].forEach(([k,T])=>{
    if(!T||!T.columns||!T.rows)return;
    const mc=rfModelCol(T.columns); if(!mc)return;
    T.rows.forEach(r=>{ if(r.inserted)return; take((r._orig&&r._orig[mc])||"",r.cells[mc]); });
  });
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>
    (A[k]||[]).forEach(r=>take(r._orig_model,r.model)));
  if(n)LOG("Link on: adopted",n,"model correction(s) already made elsewhere");
  return n;
}
function toggleLinkHere(){
  const tab=linkTabKey();
  const on=!linkOn(tab);
  setLinkTab(tab,on);
  if(on){ adoptOwnFixes(tab); adoptEveryModelFix(); }
  try{ azBeginEdit(); }catch(e){}
  try{ syncModels(); }catch(e){}
  const names=linkedTabNames();
  setStatus(on
    ? ("Link is on for this tab. Linked: "+(names.join(", ")||"none")+
       " — a model corrected on any of them is corrected on all of them.")
    : ("Link is off for this tab — a correction here stays on the row you edit. Still linked: "+
       (names.join(", ")||"none")+"."));
  return on;
}
function syncModels(){
  seedModelFix();
  const A=S.analysis; if(!A)return 0;
  const m=A._modelFix||{};
  const cols=(A.rfInventory&&A.rfInventory.columns)||[];
  const mcol=rfModelCol(cols);
  let n=0;
  const want=(printed,r)=>{
    const bare=normModelKey(printed); if(!bare)return String(printed||"");
    const sec=rowSectorAny(r);
    if(sec&&sec!=="—"){
      /* 6fp — A ROW WITH A POSITION ANSWERS TO ITS POSITION FIRST, and only then to a correction made
         somewhere without one. Both lookups are needed and neither can go:
           · the position key is what keeps A-3 out of an edit made at A-1;
           · the sector key is what lets a correction typed on the DESIGN SUMMARY — which has no
             position — still reach the RF Inventory and antenna rows in that sector, which is the whole
             point of Link and what `linkmirror_real.py` measures in both directions.
         Since a positioned edit now writes only the position key, the sector fallback can no longer
         carry one position's correction to another. */
      const pos=rowPosAny(r);
      if(pos){
        const pk=sec+"\u0001"+pos+"\u0001"+bare;
        if(m[pk]!=null)return m[pk];
      }
      const kk=sec+"\u0001"+bare;
      if(m[kk]!=null)return m[kk];
      if(m[bare]!=null)return m[bare];                   // a correction made before sectors were keyed
      /* and the other way: a correction typed on a POSITIONED row reaching a row that has none (a
         Design Summary line for that model in that sector). It follows only when every position in the
         sector carrying the model agrees — one position's say-so must not move a line that stands for
         all of them, which is the rule Equipment in Calc has had since 6cy. */
      if(!pos){
        const u=posFixUnanimous(m,sec,bare);
        if(u!=null)return u;
      }
      return String(printed||"");
    }
    const u=modelFixUnanimous(m,bare);                   // no sector of its own: only if all agree
    return (u!=null)?u:String(printed||"");
  };
  /* a row holding its own unlinked correction keeps it; everything else follows the shared map */
  /* a row keeps its own correction; otherwise it follows the shared map only if ITS tab is linked */
  const TY=(A&&A._modelType)||{};
  /* a linked correction only lands on a row of the same equipment type as the row it came from */
  const typeOk=(r,printed)=>{
    const k=normModelKey(printed); if(!k)return true;
    const src=TY[k]; if(!src)return true;
    const mine=rowTypeAny(r); if(!mine)return true;
    /* 6ct — RRH and RADIO name the same unit, so a correction made on one must reach the other. */
    if(mine===src)return true;
    try{ return discTypesAgree([mine,src]); }catch(e){ return mine===src; }
  };
  /* `cur` is the row's CURRENT model, and every caller must pass it — RF Inventory keeps its model in
     r.cells[mcol], not r.model, so reading r.model here silently blanked every RF row. */
  const resolve=(r,printed,tab,cur)=>{
    if(r._ownFix!=null)return r._ownFix;
    if(linkOn(tab)&&typeOk(r,printed))return want(printed,r);
    /* 6ca: never blank a value the user can see because the page printed nothing there. With no printed
       model there is nothing to resolve BACK to, so resolving at all can only destroy work. */
    if(!String(printed||"").trim())return String(cur==null?"":cur);
    return String(printed||"");
  };
  (A.designSummary||[]).forEach(r=>{ if(r.inserted)return;
    const printed=String(r.origModel||"");
    const v=resolve(r,printed,"designSummary",r.model);
    if(String(r.model)!==v){ r.model=v; n++; }
    r._linked=(v!==printed&&r._ownFix==null); });
  (A.equipmentCalc||[]).forEach(r=>{
    const printed=String(r.origModel||"");
    const v=resolve(r,printed,"equipmentCalc",r.model);
    if(String(r.model)!==v){ r.model=v; n++; }
    r._linked=(v!==printed&&r._ownFix==null); });
  if(mcol){
    (A.rfInventory.rows||[]).forEach(r=>{ if(r.inserted)return;
      const printed=String((r._orig&&r._orig[mcol])||"");
      const v=resolve(r,printed,"rfInventory",r.cells&&r.cells[mcol]);
      if(String(r.cells[mcol])!==v){ r.cells[mcol]=v; n++; }
      r._linked=(v!==printed&&r._ownFix==null); });
  }
  /* 6ck — and the PRINTED Equipment in Calc table. Without this a linked correction reached the derived
     rows and left the grid on screen untouched. */
  const ecT=A.ecTable;
  if(ecT&&ecT.columns&&ecT.rows&&ecT.rows.length){
    const emc=rfModelCol(ecT.columns);
    if(emc)ecT.rows.forEach(r=>{
      if(r.inserted)return;
      const printed=String((r._orig&&r._orig[emc])||"");
      const v=resolve(r,printed,"equipmentCalc",r.cells&&r.cells[emc]);
      if(String(r.cells[emc])!==v){ r.cells[emc]=v; n++; }
      r._linked=(v!==printed&&r._ownFix==null);
    });
  }
  /* Antenna Position Details carries models too, in three categories */
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>{
    (A[k]||[]).forEach(r=>{
      const printed=String(r._orig_model!=null?r._orig_model:r.model||"");
      const v=resolve(r,printed,"antennaPosition",r.model);
      if(String(r.model)!==v){ r.model=v; n++; }
      r._linked=(v!==printed&&r._ownFix==null);
    });
  });
  /* 6cw — and the QUANTITY. Link on Equipment in Calc means that page follows the Design Summary, and a
     model's quantity there is its TOTAL across every sector, not one sector's figure. This runs inside
     syncModels so it happens as you type, not on the next render of that tab. */
  /* 6cy — Link off means the page goes BACK, the same way a model does. Following while linked and then
     leaving the followed value behind when the switch is turned off is the one thing a link must not do. */
  if(ecLinked())n+=ecCountsFollowDs(); else n+=ecUnfollow();
  /* 6cx — and the rad centre. This is driven by the LINK, not by the keystroke: toggling Link on Antenna
     Position brings Equipment in Calc into line with what is already on that tab, instead of only
     following the next value you happen to change. */
  /* 6dj — and every antenna row re-derives. The tip height used to move only when a rad centre was TYPED,
     so a rad centre that arrived any other way — the as-built pass, a link, a mirror, a suggested value —
     left the tip on the printed figure. `antReDerive` is idempotent: on a row whose values already agree
     it changes nothing, so running it here costs a comparison per row. */
  n+=antReDeriveAll();
  /* 6dq — the rad centre follows AFTER every antenna row has re-derived (a stacked pair's as-built rad
     is computed there), and ALWAYS, not only while linked: with the link off this is what puts the
     figures back to what the page printed, the same way ecUnfollow does for the counts. */
  n+=ecRadFollowAntenna();
  /* 6dl — and the VENDOR, which was never linked to anything. See syncVendors below. */
  n+=syncVendors();
  if(n)LOG("syncModels:",Object.keys(m).length,"correction(s) on file,",n,"cell(s) updated");
  return n;
}

/* ------------------------------------------------------------------------------------------------
   The vendor link — RF Inventory <-> Antenna Position.

   A model correction travels by MODEL: every row printing that model, on every linked tab, follows it.
   A vendor cannot travel that way. The same vendor appears against a dozen unrelated models, and one
   Sec-Pos carries several pieces of equipment from different makers — the antenna at A-2 is
   ANDREW/COMMSCOPE while the radio at A-2 is ERICSSON. Keyed by vendor name, correcting the antenna's
   maker would rewrite the radio's.

   So the vendor is keyed by SEC-POS, and only ANTENNA rows take part: Antenna Position Details is a
   table of antennas, and the RF Inventory row it corresponds to is the antenna row at the same
   Sec-Pos. That is a one-to-one relationship, which is what a link needs.

   It obeys the same Link switch as the model: on, the correction belongs to the position and reaches
   the other tab; off, it stays on the row you typed it into.
   ------------------------------------------------------------------------------------------------ */
function vendorFix(){ const A=S.analysis; if(!A)return null; A._vendorFix=A._vendorFix||{}; return A._vendorFix; }
/* the Sec-Pos column of an RF Inventory row, normalised to the "A2" form both tables can be keyed on */
function rfRowSecPosKey(r,cols){
  const list=cols&&cols.length?cols:Object.keys(r.cells||{});
  const c=list.find(x=>/sec\W*pos/i.test(String(x).trim()))||list.find(x=>/^sec-?pos/i.test(String(x).trim()));
  if(!c)return "";
  return normSecPos(String(r.cells&&r.cells[c]||"").replace(/\(\s*D\s*\)/gi,""));
}
function rfRowIsAntenna(r,cols){
  const list=cols&&cols.length?cols:Object.keys(r.cells||{});
  const t=list.find(x=>/equipment\s*type|^type$/i.test(String(x).trim()));
  if(!t)return false;
  return /ANTENNA/.test(String(canonType(r.cells&&r.cells[t])||"").toUpperCase());
}
function rfVendorCol(cols){
  const list=cols||[];
  return list.find(x=>/^vendor$/i.test(String(x).trim()))||list.find(x=>/vendor|manufact/i.test(String(x)))||null;
}
/* every place a vendor lives, as {key, get, set, printed, row, tab} — one list, so the seed, the
   resolve and the apply cannot drift apart */
function vendorSlots(){
  const A=S.analysis; if(!A)return [];
  const out=[];
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>{
    (A[k]||[]).forEach(r=>{
      const key=normSecPos(r.secPos||r._orig_secPos);
      if(!key)return;
      out.push({key,row:r,tab:"antennaPosition",
        printed:String(r._orig_vendor==null?"":r._orig_vendor),
        get:()=>String(r.vendor==null?"":r.vendor),
        set:v=>{ r.vendor=v; }});
    });
  });
  const T=A.rfInventory;
  if(T&&T.columns&&T.rows){
    const vc=rfVendorCol(T.columns);
    if(vc)T.rows.forEach(r=>{
      if(r.inserted||!rfRowIsAntenna(r,T.columns))return;
      const key=rfRowSecPosKey(r,T.columns);
      if(!key)return;
      out.push({key,row:r,tab:"rfInventory",col:vc,
        printed:String((r._orig&&r._orig[vc])||""),
        get:()=>String(r.cells[vc]==null?"":r.cells[vc]),
        set:v=>{ r.cells[vc]=v; }});
    });
  }
  return out;
}
/* adopt any vendor correction already on the grids when the map is first used, so turning Link on does
   not silently drop what you had already typed */
function seedVendorFix(){
  const A=S.analysis; if(!A||A._vendorSeeded)return 0;
  const m=vendorFix(); if(!m)return 0;
  let n=0;
  vendorSlots().forEach(s=>{
    if(m[s.key]!=null)return;
    const p=s.printed.trim(), v=s.get().trim();
    if(p&&v&&p!==v){ m[s.key]=v; n++; }
  });
  A._vendorSeeded=true;
  if(n)LOG("seedVendorFix: adopted",n,"existing vendor correction(s)");
  return n;
}
/* `quiet` records the correction WITHOUT the global re-resolve. The mirror records one row per sibling
   and must not re-resolve between them: syncVendors() walks every antenna row, so a sync halfway through
   the loop put the source row back to its printed vendor (it has no record until the loop ends), and the
   remaining siblings then read the reverted source and copied that instead. The mirror syncs once, after
   it has recorded them all. */
function noteVendorEdit(row,tab,secPos,printed,now,quiet){
  const m=vendorFix(); if(!m)return;
  seedVendorFix();
  const key=normSecPos(secPos), p=String(printed||"").trim(), v=String(now==null?"":now).trim();
  if(!key||!linkOn(tab)){
    /* not linked, or nothing to key on: the correction belongs to this row only */
    if(row){ if(!v||v===p) delete row._ownVendor; else row._ownVendor=v; }
  } else {
    if(row) delete row._ownVendor;
    if(!v||v===p) delete m[key]; else m[key]=v;
  }
  if(!quiet)syncVendors();
}
function syncVendors(){
  const A=S.analysis; if(!A)return 0;
  seedVendorFix();
  const m=A._vendorFix||{};
  let n=0;
  vendorSlots().forEach(s=>{
    const want=(s.row&&s.row._ownVendor!=null) ? s.row._ownVendor
             : (linkOn(s.tab)&&m[s.key]!=null) ? m[s.key]
             : s.printed;
    if(String(s.get())!==String(want)){ s.set(want); n++; }
    s.row._vendorLinked=(String(want)!==s.printed&&s.row._ownVendor==null);
  });
  if(n)LOG("syncVendors:",Object.keys(m).length,"vendor correction(s) on file,",n,"cell(s) updated");
  return n;
}
/* every antenna row on every antenna tab, re-derived */
function antReDeriveAll(){
  const A=S.analysis; if(!A)return 0;
  let n=0;
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>{
    (A[k]||[]).forEach(r=>{ try{ n+=antReDerive(r); }catch(e){} });
  });
  if(n)LOG("antReDeriveAll: "+n+" derived value(s) followed what they are derived from");
  return n;
}
/* 6cw — the total per model comes from `dsTotalsByModel()`, which already exists further down the file
   and already knows the one exception that matters: an AIR is an integrated antenna-radio and is counted
   on its Antenna row only, never twice. (A second copy declared here quietly lost to it — a function
   declaration later in the same script wins — and handed back its `{existing,final}` object where a
   number was expected. Hence "[object Object]" in a Qty cell during testing.) */
/* 6cx — Equipment in Calc follows when ITS link is on, and also when Antenna Position's is: that tab is
   the source of the rad centres, and asking for one of them is asking for the page to agree. */
/* 6ds — Equipment in Calc follows the other tabs only while ITS OWN Link is on.
   This was `linkOn(equipmentCalc) || linkOn(antennaPosition)`, which meant the switch on the page you
   were looking at did nothing by itself: turning Link off on Equipment in Calc left the rad centres
   sitting there, because Antenna Position's link was still holding the OR open. Everywhere else in this
   tool a tab's Link governs that tab, and this is the tab the values land ON — so it governs here too.
   Turning it off puts the page back to the figures it printed, counts and rad centres alike. */
function ecLinked(){ return linkOn("equipmentCalc"); }
/* 6cy — every Equipment in Calc value that a link is allowed to write, put back to what the page printed.
   Anything you typed there yourself is left exactly as you typed it. */
function ecUnfollow(){
  const A=S.analysis; if(!A)return 0;
  let n=0;
  (A.equipmentCalc||[]).forEach(r=>{
    if(r._countEdited||r.inserted)return;
    if(sgHas(r,"count"))return;         // 6cy: a SUGGESTION is a proposal, not a link's doing
    if(r.printed==null)return;
    if(int(r.count)!==int(r.printed)){ r.count=int(r.printed); n++; }
  });
  const T=A.ecTable;
  if(T&&T.columns&&T.rows){
    const qc=T.columns.find(c=>/qty|quantity|count|total/i.test(String(c)));
    const rc=T.columns.find(c=>/calc\w*\s*rad/i.test(String(c)))||T.columns.find(c=>/rad\s*cent/i.test(String(c)));
    T.rows.forEach(r=>{
      if(r.inserted)return;
      [qc,rc].forEach(c=>{
        if(!c)return;
        if(r._edited&&r._edited[c])return;            // yours
        if(sgHas(r,c))return;                         // 6cy: or a suggestion, which ⊘ takes back
        const was=(r._orig&&r._orig[c]!=null)?String(r._orig[c]):null;
        if(was==null)return;
        if(String(r.cells[c])!==was){ r.cells[c]=was; delete r._fromAntenna; n++; }
      });
    });
  }
  if(n)LOG("Equipment in Calc: Link is off —",n,"value(s) put back to the printed figure");
  return n;
}
function ecCountsFollowDs(){
  if(!ecLinked())return 0;
  const A=S.analysis; if(!A)return 0;
  const tot=dsTotalsByModel(); if(!tot.size)return 0;
  let n=0;
  (A.equipmentCalc||[]).forEach(r=>{
    if(r.struck||r._countEdited)return;
    const q=tot.get(normModelKey(r.model||r.origModel));
    if(!q)return;
    if(int(r.count)!==int(q.final)){ r.count=int(q.final); n++; }
  });
  const T=A.ecTable;
  if(T&&T.columns&&T.rows){
    const mc=rfModelCol(T.columns);
    const qc=T.columns.find(c=>/qty|quantity|count|total/i.test(String(c)));
    if(mc&&qc){
      /* the printed table can list the same model on several rows; the TOTAL belongs on a single row, so
         a model spread over several rows is left alone rather than counted several times over. */
      const seen=new Map();
      T.rows.forEach(r=>{ if(r.struck)return; const k=normModelKey(r.cells[mc]); if(!k)return;
        seen.set(k,(seen.get(k)||0)+1); });
      T.rows.forEach(r=>{
        if(r.struck||r.inserted||r._qtyEdited)return;
        const k=normModelKey(r.cells[mc]); if(!k||seen.get(k)!==1)return;
        const q=tot.get(k); if(!q)return;
        if(int(r.cells[qc])!==int(q.final)){ r.cells[qc]=String(int(q.final)); n++; }
      });
    }
  }
  if(n)LOG("Equipment in Calc: quantity followed the Design Summary total on",n,"row(s)");
  return n;
}
/* 6dz — `carryBothWays` is gone. It called all four push functions and nothing called it, which made
   three of the four dead code that would have broken the per-tab Link rule the day anyone revived it.
   What actually carries a model correction between tabs is `syncModels`, which DECIDES each row's model
   from the shared map every time it runs; the survivor of the four, `carryDsToRf`, is still called when
   the RF pane renders because it carries something the map does not — a Design Summary strike. */
/* A row you add on one tab stays on that tab. This used to mirror every RF Inventory insert into the
   Design Summary as a "from RF" row, which meant adding one row produced rows you had not asked for on
   another tab. Add them where you want them.
   Existing "from RF" rows in a reopened file are left alone; nothing new is created. */
function carryRfInsertsToDs(){
  const A=S.analysis; if(!A||!A.rfInventory||!A.designSummary)return 0;
  if(!_carryInserts){
    /* clear out any that a previous build created, so the two tabs agree */
    const before=A.designSummary.length;
    A.designSummary=A.designSummary.filter(r=>!r._fromRf);
    const n=before-A.designSummary.length;
    if(n)LOG("Inserted rows are no longer mirrored across tabs — removed",n,"'from RF' row(s)");
    return 0;
  }
  const cols=A.rfInventory.columns||[];
  const mcol=rfModelCol(cols); if(!mcol)return 0;
  const tally=new Map();
  (A.rfInventory.rows||[]).forEach(r=>{
    if(!r.inserted)return;
    const m=String(r.cells[mcol]||"").trim(); if(!m)return;
    const sec=rfRowSector(r,cols)||"—";
    const k=normModelKey(m)+"|"+sec;
    const cur=tally.get(k)||{cnt:0,model:m,sec};
    cur.cnt++; tally.set(k,cur);
  });
  // undo any previous RF-driven bump first
  (A.designSummary||[]).forEach(ds=>{ if(ds._rfAdds){ ds.after=int(ds.after)-ds._rfAdds; ds._rfAdds=0; } });
  // drop DS rows that only existed because of an RF insert that is now gone
  A.designSummary=(A.designSummary||[]).filter(ds=>!(ds._fromRf&&!tally.has(ds._fromRf)));
  let n=0;
  tally.forEach((info,k)=>{
    const mk=normModelKey(info.model);
    let ds=A.designSummary.find(x=>normModelKey(x.origModel||x.model)===mk&&normSector(x.sector)===info.sec)
         || A.designSummary.find(x=>normModelKey(x.origModel||x.model)===mk);
    if(!ds){
      // no Design Summary row for this model yet: add one, anchored after that sector's last row
      const list=A.designSummary;
      let ai=-1; for(let i=0;i<list.length;i++) if(normSector(list[i].sector)===info.sec) ai=i;
      if(ai<0) ai=list.length-1;
      const above=list[ai];
      if(!above) return;
      ds={ page:above.page, sector:info.sec, type:above.type, origType:above.type,
           model:info.model, origModel:"", before:0, after:0, origBefore:0, origAfter:0,
           printed:{existing:0,removals:0,additions:0,final:0}, struck:false, inserted:true,
           _aboveModel:above.origModel||above.model, _sec:info.sec, _fromRf:k };
      list.splice(ai+1,0,ds);
    }
    ds.after=int(ds.after)+info.cnt; ds._rfAdds=info.cnt; n++;
  });
  if(n)LOG("carryRfInsertsToDs: reflected",n,"inserted RF row group(s) into Design Summary counts");
  return n;
}
/* 5. insert a redline row between two printed rows */
/* A row inserted below an inserted row has no printed row of its own to anchor to, so it borrows its
   parent's anchor and stacks one line lower. Without this, adding a second row from a newly added one —
   the common case at the bottom of a page — placed it on top of the first. */
function rfAdoptAnchor(idx){
  const rows=(S.analysis&&S.analysis.rfInventory&&S.analysis.rfInventory.rows)||[];
  const parent=rows[idx], nw=rows[idx+1];
  if(!nw||!nw.inserted)return null;
  /* keep the anchor's geometry and page on the new row, whatever its own _y turned out to be */
  if(parent){
    if(!nw._aboveG)nw._aboveG=parent._g||parent._aboveG||null;
    if(nw._aboveY==null){
      if(parent._y!=null)nw._aboveY=parent._y;
      else if(nw._aboveG){
        const b0=Object.keys(nw._aboveG).map(k=>nw._aboveG[k]).filter(Boolean)[0];
        if(b0&&b0.ny!=null)nw._aboveY=b0.ny;
      }
    }
    if(typeof parent.page==="number"){ nw._anchorPage=parent.page; if(typeof nw.page!=="number")nw.page=parent.page; }
  }
  if(parent&&parent.inserted){
    /* 6bz: rfInsertAfter now stores the anchor structurally, so only fill the gaps here. Overwriting
       `_anchorY`/`_anchorPage` from the parent is exactly the inheritance that made rows drift. */
    if(nw._anchorY==null){ nw._aboveY=parent._aboveY; nw._anchorY=parent._anchorY!=null?parent._anchorY:parent._aboveY; }
    if(!nw._aboveG)nw._aboveG=parent._aboveG;
    if(nw._anchorPage==null&&parent._anchorPage!=null)nw._anchorPage=parent._anchorPage;
    if(parent._sec&&!nw._sec)nw._sec=parent._sec;
    if(typeof parent.page==="number")nw.page=parent.page;
    if(nw._stackIdx==null)nw._stackIdx=(parent._stackIdx||0)+1;
  }
  return nw;
}
function dsAdoptAnchor(above){
  const rows=(S.analysis&&S.analysis.designSummary)||[];
  const i=rows.indexOf(above), nw=rows[i+1];
  if(!nw||!nw.inserted)return null;
  if(above&&above.inserted){
    nw._aboveModel=above._aboveModel; nw._aboveY=above._aboveY;
    nw.page=above.page; nw.sector=above.sector; nw.origSector=above.origSector;
    nw._stackIdx=(above._stackIdx||0)+1;
  }
  return nw;
}
function rfInsertAfter(idx){
  const A=S.analysis; if(!A||!A.rfInventory)return;
  const rows=A.rfInventory.rows, cols=A.rfInventory.columns||[];
  const above=rows[idx]; if(!above)return;
  azBeginEdit();
  /* 6bz — open item 1 (diagnosed 6bn). `rfResolveRows` only ran at APPLY time, so a row inserted before
     the first apply captured `_aboveY: above._y` while every printed `_y` was still null. Every added row
     then fell through to the model-text search in `placeInsertedRfRow`, rows on Alpha, Beta and Gamma all
     resolved to the same printed row, and the whole lot stacked from one point. The slot key
     (page + "|" + _aboveY) collapsed to "p|?" for the same reason.
     Resolve the printed bands FIRST, then store the anchor structurally — the treatment Design Summary
     got in 6bs. */
  if(rows.some(r=>!r.inserted&&r._y==null)){
    try{ rfResolveRows(rows,[]); }
    catch(e){ LOG&&LOG("rfInsertAfter: could not resolve the printed rows:",e&&e.message||String(e)); }
  }
  /* Walk back to the nearest PRINTED predecessor. An inserted row's own anchor is borrowed, so inheriting
     from it is how an anchor drifted between sectors. */
  let ai=idx;
  while(ai>=0&&rows[ai]&&rows[ai].inserted)ai--;
  const anc=(ai>=0?rows[ai]:above);
  const stack=(ai>=0?(idx-ai):0);        // how many inserted rows already sit under this anchor
  const gBox=(g=>{ if(!g)return null; const k=Object.keys(g).map(q=>g[q]).filter(Boolean); return k.length?k[0]:null; })(anc._g||anc._aboveG);
  let aY=(anc._y!=null)?anc._y:(anc._aboveY!=null?anc._aboveY:(gBox&&gBox.ny!=null?gBox.ny:null));
  const aPage=(typeof anc.page==="number")?anc.page:(typeof above.page==="number"?above.page:null);
  const cells={}; cols.forEach(c=>cells[c]="");
  rows.splice(idx+1,0,{
    cells, _orig:{}, struck:false, inserted:true,
    page:(aPage!=null?aPage:above.page), anchor:anc.anchor,
    _sec:rfRowSector(above,cols)||rfRowSector(anc,cols),
    _aboveY:aY, _aboveG:anc._g||anc._aboveG||null, _iid:seq++,
    _anchorPage:aPage, _anchorY:aY, _stackIdx:stack,
    afterAnchor:anc.anchor, _above:Object.assign({},anc._orig||anc.cells)
  });
  LOG&&LOG("RF insert row: anchored to printed row",ai,"page",(aPage==null?"?":aPage+1),
           "y",(aY==null?"unresolved":(+aY).toFixed(4)),"slot",stack,
           "sector",rfRowSector(above,cols)||rfRowSector(anc,cols)||"—");
  renderAnalyze();
}
/* remove the inserted RF row(s) behind a Design-Summary row that the carry created */
function rfRemoveInsertsFor(key){
  const A=S.analysis; if(!A||!A.rfInventory)return;
  const cols=A.rfInventory.columns||[]; const mcol=rfModelCol(cols); if(!mcol)return;
  A.rfInventory.rows=A.rfInventory.rows.filter(r=>{
    if(!r.inserted)return true;
    const m=String(r.cells[mcol]||"").trim(); if(!m)return true;
    return (normModelKey(m)+"|"+(rfRowSector(r,cols)||"—"))!==key;
  });
}
function rfRemoveRow(r){
  const A=S.analysis; if(!A||!A.rfInventory)return;
  azBeginEdit();
  A.rfInventory.rows=A.rfInventory.rows.filter(x=>x!==r);
  renderAnalyze();
}
/* 1. Anchoring an RF row by its longest cell value was wrong: that value repeats across rows, so
   several rows resolved to the SAME printed row and addText's cell-dedupe silently dropped all but
   the first. Rows are now bound to a real row band (its y) in reading order, with a used-set so no
   two rows can claim the same band — the same technique correctDetailCounts uses. */
function rfDataLines(pi){
  return pageLines(pi).filter(l=>{
    if(l.items.length<2)return false;
    if(/^(sector|sec-?pos|position|technology|equipment|manufacturer|model|status|serial|notes|linkedcells|rrhposition|commonname|cascaded)/.test(l.norm))return false;
    if(/rfinventory|antennaposition|designsummary|equipmentin/.test(l.norm))return false;
    return true;
  });
}
function rfResolveRows(rows,pages){
  const byPage=new Map();
  (rows||[]).forEach(r=>{ if(r.inserted)return; const pi=(typeof r.page==="number")?r.page:-1; if(pi<0)return;
    if(!byPage.has(pi))byPage.set(pi,[]); byPage.get(pi).push(r); });
  let ok=0,miss=0;
  byPage.forEach((list,pi)=>{
    if(!S.pages[pi])return;
    const lines=rfDataLines(pi), used=new Set();
    list.forEach(r=>{
      const vals=Object.values(r._orig||{}).map(v=>String(v==null?"":v).trim())
        .filter(v=>v.length>1).sort((a,b)=>b.length-a.length);
      let band=null;
      for(const v of vals){
        const nv=v.replace(/\s+/g,"").toLowerCase();
        const cand=lines.filter(l=>!used.has(l)&&l.norm.indexOf(nv)>=0);
        if(cand.length){ band=cand[0]; break; }
      }
      if(band){ used.add(band); r._y=band.y; r._bind="value"; ok++; }
    });
    /* Second pass: anything still unbound gets the remaining printed rows in reading order. An RF
       Inventory has one printed row per extracted row, so order is a reliable last resort — and
       without it a row whose extracted text no longer matches the page could never be redlined. */
    const left=list.filter(r=>r._y==null);
    if(left.length){
      const free=lines.filter(l=>!used.has(l));
      left.forEach((r,i)=>{ const l=free[i]; if(l){ used.add(l); r._y=l.y; r._bind="order"; ok++; } else miss++; });
      LOG(`rfResolveRows: ${Math.min(left.length,free.length)} row(s) bound by position on page ${pi+1}`);
    }
  });
  LOG(`rfResolveRows: bound ${ok} row(s) to a page row, ${miss} unresolved`);
  return ok;
}
/* the text items of the row band at (or nearest) y */
function rfBandAt(pi,y){
  if(y==null||!S.pages[pi])return null;
  let best=null,bd=1e9;
  pageLines(pi).forEach(l=>{ const d=Math.abs(l.y-y); if(d<bd){bd=d;best=l;} });
  return (best&&bd<0.012)?best:null;
}
/* Column x positions read from the RF Inventory header row on the page. Inserted-row placement used
   to depend on finding the same column's value in the row above — blank or split cells there meant the
   value was silently skipped. The header gives every column an x regardless. */
function rfHeaderXs(pi){
  const P=S.pages[pi]; if(!P)return null;
  if(P._rfHdrX!==undefined)return P._rfHdrX;
  const KEYS=["sector","secpos","position","technology","band","equipment","manufacturer","model",
              "status","serial","notes","linkedcells","rrhposition","commonname","cascaded","cpri","qty","quantity"];
  let best=null,bs=0;
  pageLines(pi).forEach(l=>{ let s=0; KEYS.forEach(k=>{ if(l.norm.indexOf(k)>=0)s++; }); if(s>bs){bs=s;best=l;} });
  P._rfHdrX=(best&&bs>=2)?{line:best,items:best.items.slice()}:null;
  return P._rfHdrX;
}
function rfColX(pi,col){
  const H=rfHeaderXs(pi); if(!H)return null;
  const want=String(col).replace(/[^a-z0-9]/gi,"").toLowerCase(); if(!want)return null;
  const cx=t=>t.nx+(t.nw||0)/2;
  let hit=H.items.find(t=>String(t.str).replace(/[^a-z0-9]/gi,"").toLowerCase()===want);
  if(hit)return cx(hit);
  hit=H.items.find(t=>{ const k=String(t.str).replace(/[^a-z0-9]/gi,"").toLowerCase();
    return k.length>2 && (want.indexOf(k)>=0||k.indexOf(want)>=0); });
  return hit?cx(hit):null;
}
/* Find the page cell for one column of one RF row. Matching the extracted value against the printed
   text fails whenever extraction drifted, so the column's header x is used as a fallback — that is
   what made edits silently not apply. Returns null only if the cell is genuinely empty. */
function rfCellFor(pi,band,col,printed){
  if(!band)return null;
  const nrm=s=>String(s).replace(/\s+/g,"").toLowerCase();
  const cs=String(printed==null?"":printed).trim();
  if(cs){
    const hit=band.items.find(t=>t.str.trim()===cs)||band.items.find(t=>nrm(t.str)===nrm(cs));
    if(hit)return hit;
  }
  const cx=rfColX(pi,col);
  if(cx!=null){
    let best=null,bd=1e9;
    band.items.forEach(t=>{ const c=t.nx+(t.nw||0)/2; const d=Math.abs(c-cx); if(d<0.06&&d<bd){bd=d;best=t;} });
    if(best)return best;
  }
  return null;
}
/* ============================================================================================
   RF Inventory, rebuilt. Every previous version extracted the table with the model and then tried
   to map those strings back onto the page — and every mapping heuristic failed somewhere, silently.
   This reads the table straight from the page instead: the header row defines the columns and their
   x boundaries, each following line is a row, and each text item is assigned to the column whose
   span contains it. Cells therefore arrive WITH their geometry, so a redline can never be misplaced
   or dropped: there is nothing left to match.
   ============================================================================================ */
/* ---------------------------------------------------------------------------------------------
   RF Inventory reader. Columns are found from the DATA's left edges: table cells are left-aligned
   at fixed x, so items in one column share an nx. (Gap-based header splitting glued "SEC-POS" to
   "EQUIPMENT TYPE" and "TECHNOLOGY" to "RRH POSITION".) Physical rows wrap over several text
   lines, so lines are grouped by the Sec-Pos key in the first column.
   --------------------------------------------------------------------------------------------- */
const RF_KEY=/^[A-Za-z]{1,3}[-_ ]?\d{1,2}\b/;
/* ==========================================================================================
   Generic table reader — reads a table BY CELL rather than by line.

   Two things broke every line-based attempt:
     1. These tables are CENTER-aligned. "ANDREW/CO" + "MMSCOPE" are two lines of one Vendor cell;
        their left edges differ but their CENTRES coincide. Clustering on left edges therefore
        invented a new column for every line length.
     2. A physical row spans several text lines, and its Sec-Pos can sit on the middle line
        (vertically centred), so "a row starts where the key column has a value" is not reliable.

   So: columns come from whichever clustering (centre or left) yields FEWER columns — over-splitting
   is the failure mode of the wrong one — and rows come from vertical gaps, which are bimodal
   (line pitch inside a cell vs. padding between rows). A cell is then the intersection of a row
   band and a column, with its lines joined in reading order.
   ========================================================================================== */
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
/* read a table: returns {columns, rows:[{cells,_g,page,_y}]} */
/* Join the lines of one cell. A wrapped cell breaks MID-TOKEN on these documents
   ("ANDREW/CO"+"MMSCOPE" = ANDREW/COMMSCOPE, "WR-VG66ST-B"+"RD" = WR-VG66ST-BRD), so no space is
   added — except when both fragments are plain words, which keeps "INTEGRATED ANTENNA RADIO" legible. */
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
function rfColumnsFromData(dataItems,headerItems){
  const TOL=0.010;
  const cl=[];
  dataItems.map(t=>t.nx).sort((a,b)=>a-b).forEach(x=>{
    const last=cl[cl.length-1];
    if(last && x-last.x<=TOL){ last.sum+=x; last.n++; last.x=last.sum/last.n; }
    else cl.push({x,sum:x,n:1});
  });
  const xs=cl.filter(c=>c.n>=1).map(c=>c.x).sort((a,b)=>a-b);
  return xs.map((x,i)=>{
    const next=xs[i+1];
    const from=Math.max(0,x-TOL*1.6), to=(next!=null)?(next-TOL*0.6):1;
    const names=headerItems.filter(t=>t.nx>=from && t.nx<to)
      .sort((a,b)=>(a.ny-b.ny)||(a.nx-b.nx)).map(t=>String(t.str).trim()).filter(Boolean);
    return { name:(names.join(" ").replace(/\s+/g," ").trim())||("Column "+(i+1)), x, from, to };
  });
}
/* Equipment in Calculation, read column for column off the page — the treatment RF Inventory gets, so
   the tab can mirror the printed table instead of a reduced type/model/count view. */
function readEcFromGeometry(pages){
  /* never read a Local Market Notes page into this table */
  pages=(pages||[]).filter(pi=>{
    const P=S.pages[pi];
    if(!P)return false;
    if(P.locked&&/notes/i.test(String(P.lockReason||"")))return false;
    const head=(P.items||[]).slice(0,60).map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g,"");
    if(/localmarketnote|marketnotes/.test(head)||/^notes?(page\d|$)/.test(head)||
       (/^notes?/.test(head)&&/datetime|creator|category/.test(head))){
      LOG("EC read: skipping notes page",pi+1); return false;
    }
    return true;
  });
  const HDR=l=>{ const n=l.norm; let s=0;
    ["equipmenttype","vendor","model","quantity","qty","count","total","existing","final","removal",
     "addition","unit","description","partnumber","band"].forEach(k=>{ if(n.indexOf(k)>=0)s++; });
    return s>=2; };
  const SKIP=/^(equipment|type|vendor|model|quantity|qty|count|total|existing|final|removal|addition|unit|description|part|number|band)+$/;
  const t=readTableByCell(pages,HDR,SKIP);
  LOG("Equipment in Calc table:",(t.columns||[]).length,"column(s),",(t.rows||[]).length,"row(s) —",
      JSON.stringify(t.columns||[]));
  return t;
}
/* The RFDS prints these in a fixed order — From · Type · Model · Calculated RAD Center · Quantity ·
   Dimensions · Calculated SQIN per Unit — so the default set is chosen by walking the table's OWN column
   list, never by walking a list of patterns (which reordered them). */
const EC_HIDE=[/^notes?$/i, /^comments?$/i, /^remarks?$/i];
const EC_DEFAULT=[/^from$/i, /^type$|equipment\s*type/i, /^model$|part\s*number/i,
                  /calculated\s*rad\s*cent|^rad\s*cent/i, /^quantity$|^qty$/i];
function ecDefaultCols(all){
  /* Pre-toggled: From · Type · Model · Quantity — picked by walking the table's OWN column list, so the
     page order is kept. */
  const out=(all||[]).filter(c=>EC_DEFAULT.some(re=>re.test(String(c).trim()))&&
                                !EC_HIDE.some(re=>re.test(String(c).trim())));
  if(out.length)return out;
  return (all||[]).filter(c=>!EC_HIDE.some(re=>re.test(String(c).trim()))).slice(0,4);
}
/* a column that is read but never editable */
function ecLockedCol(c){ return EC_HIDE.some(re=>re.test(String(c).trim())); }
/* put any column set back into the page's order */
function ecOrder(T,cols){
  const idx=c=>{ const i=(T.columns||[]).indexOf(c); return i<0?9999:i; };
  return (cols||[]).slice().sort((a,b)=>idx(a)-idx(b));
}
let _ecCols=null;
function ecColToggleBar(all){
  const wrap=el("div","rf-cols");
  wrap.appendChild(el("span","rf-cols-lbl","Columns"));
  (all||[]).forEach(c=>{
    const on=_ecCols.indexOf(c)>=0;
    const b=el("button","rf-col"+(on?" on":""),escapeHtml(c));
    b.title=(on?"Hide":"Show")+" the "+c+" column";
    b.onclick=()=>{ const i=_ecCols.indexOf(c); if(i>=0)_ecCols.splice(i,1); else _ecCols.push(c);
      const T=S.analysis&&S.analysis.ecTable; if(T)_ecCols=ecOrder(T,_ecCols);
      renderAnalyze(); };
    wrap.appendChild(b);
  });
  const allB=el("button","rf-col","All"); allB.onclick=()=>{ _ecCols=(all||[]).slice(); renderAnalyze(); };
  const defB=el("button","rf-col","Default"); defB.onclick=()=>{ _ecCols=ecDefaultCols(all); renderAnalyze(); };
  wrap.appendChild(allB); wrap.appendChild(defB);
  return wrap;
}
/* one row of the printed EC table, with dropdowns on the type column and add/duplicate buttons */
/* the Model column of a printed Equipment-in-Calc table */
function _ecModelCol(T){ return (T&&T.columns)?rfModelCol(T.columns):null; }
function ecTableRow(T,r,idx){
  const cols=_ecCols||[];
  const tr=el("tr"); if(r.inserted)tr.classList.add("rf-new");
  /* 6ew — every OTHER grid re-runs markInput from its recolor; this one called it once at render and
     never again, so on the printed Equipment in Calc table a value you typed did not turn orange (and
     its cell was not marked) until something else re-rendered the tab. Found by the cell-mark test
     asking the obvious question of every tab in turn. */
  const cellInputs={};
  const recolor=()=>{
    let ch=false;
    cols.forEach(c=>{ if(String(r.cells[c]||"").trim()!==String((r._orig&&r._orig[c])||"").trim())ch=true;
      if(cellInputs[c])markInput(cellInputs[c],r.cells[c],(r._orig&&r._orig[c])||""); });
    tr.classList.toggle("chg",ch&&!r.struck);
    tr.classList.toggle("struck",!!r.struck);
    refreshAzFoot();
  };
  cols.forEach(c=>{
    const td=el("td");
    const isType=/equipment\s*type|^type$/i.test(String(c).trim());
    const locked=ecLockedCol(c);
    let inp;
    if(isType){
      inp=el("select","az-in");
      const cur=String(r.cells[c]||"");
      const opts=(typeof TYPE_OPTIONS!=="undefined"?TYPE_OPTIONS:[]).slice();
      if(cur&&opts.indexOf(cur)<0)opts.unshift(cur);
      opts.forEach(o=>{ const op=el("option",null,o); op.value=o; if(o===cur)op.selected=true; inp.appendChild(op); });
      inp.onchange=()=>{ azBeginEdit(); r.cells[c]=inp.value; inp.dataset.edited="1"; recolor(); };
    } else {
      inp=el("input","az-in"); inp.value=String(r.cells[c]==null?"":r.cells[c]);
      inp.oninput=()=>{ azBeginEdit(); r.cells[c]=inp.value; inp.dataset.edited="1";
        /* 6ck — this is the grid the tab actually shows when the document has a printed EC table, and it
           wrote straight to the cell without ever telling the model map. That is why Link did nothing
           here: 6ch fixed the DERIVED rows, which most documents never render. */
        if(/qty|quantity|count|total/i.test(String(c)))r._qtyEdited=true;   // 6cw: yours, not the link's
        r._edited=r._edited||{}; r._edited[c]=true;                        // 6cy: and this cell generally
        if(c===_ecModelCol(T)) noteModelEdit((r._orig&&r._orig[c])||"",inp.value,r,"equipmentCalc");
        recolor(); };
    }
    if(locked){
      inp.readOnly=true; inp.disabled=true; inp.classList.add("locked");
      inp.title=c+" is read-only — it is not redlined.";
      inp.oninput=null; inp.onchange=null;
    }
    cellInputs[c]=inp;
    markInput(inp,r.cells[c],(r._orig&&r._orig[c])||"");
    td.appendChild(inp); tr.appendChild(td);
  });
  const tda=el("td","az-act");
  const sb=el("button","az-strk"+(r.struck?" on":""),"⛔"); sb.title="Strike this row";
  sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck); recolor(); };
  tda.appendChild(sb);
  const ib=el("button","az-ins","＋"); ib.title="Insert a new row below this one"; ib.style.marginLeft="5px";
  ib.onclick=()=>{ ecInsertAfter(T,idx); renderAnalyze(); };
  tda.appendChild(ib);
  const db=el("button","az-ins","⧉"); db.title="Duplicate this row"; db.style.marginLeft="4px";
  db.onclick=()=>{ const nw=ecInsertAfter(T,idx);
    if(nw)Object.keys(r.cells||{}).forEach(k=>{ nw.cells[k]=r.cells[k]; });
    renderAnalyze(); };
  tda.appendChild(db);
  if(r.inserted){
    const rm=el("button","az-strk","✕"); rm.title="Remove this inserted row"; rm.style.marginLeft="5px";
    rm.onclick=()=>{ const i=T.rows.indexOf(r); if(i>=0)T.rows.splice(i,1); renderAnalyze(); };
    tda.appendChild(rm);
  }
  tr.appendChild(tda);
  recolor();
  return tr;
}
/* Redline the printed Equipment in Calc table: changed cells on printed rows, and whole inserted rows. */
function applyEcTable(){
  const A=S.analysis, T=A&&A.ecTable;
  if(!T||!T.rows||!T.rows.length)return {applied:0,missed:0};
  const cols=T.columns||[];
  let applied=0, missed=0;
  T.rows.forEach((r,i)=>{
    if(r.inserted){
      /* place the whole row in the gap below its anchor, one line per stack step */
      const anchor=(()=>{ for(let k=i-1;k>=0;k--) if(!T.rows[k].inserted) return T.rows[k]; return null; })();
      const ag=(r._aboveG||(anchor&&anchor._g))||null;
      if(!ag){ missed++; LOG("EC insert: no anchor geometry for row",i); return; }
      const any=Object.keys(ag).map(k=>ag[k]).filter(Boolean)[0];
      if(!any){ missed++; return; }
      const pi=(typeof r.page==="number"&&r.page>=0)?r.page:(anchor?anchor.page:0);
      const fh=any.nh||0.011;
      /* Use the table's OWN row pitch, measured between printed rows, so added rows sit at the same
         spacing as the rows above them instead of a guessed line height. */
      let pitch=fh*1.15;
      const printedRows=T.rows.filter(x=>!x.inserted&&x._g);
      if(printedRows.length>=2){
        const ys=printedRows.map(x=>{ const b=Object.keys(x._g).map(k=>x._g[k]).filter(Boolean)[0];
          return b?b.ny:null; }).filter(y=>y!=null).sort((a,b)=>a-b);
        const gaps=[]; for(let k=1;k<ys.length;k++){ const d=ys[k]-ys[k-1]; if(d>fh*0.5)gaps.push(d); }
        if(gaps.length){ gaps.sort((a,b)=>a-b); pitch=gaps[Math.floor(gaps.length/2)]; }
      }
      let midY=(any.ny!=null?any.ny:0)+pitch+(r._stackIdx||0)*pitch;
      midY=Math.min(midY,1-fh*1.1);
      cols.forEach(c=>{
        if(ecLockedCol(c))return;
        const v=String(r.cells[c]||"").trim(); if(!v)return;
        /* The column's span gives BOTH the left edge and the width. Mixing the anchor cell's TEXT left
           with the column's width pushed every value off centre — the From column most visibly. */
        const span=T.colSpan&&T.colSpan[c];
        const g=ag[c];
        /* Centre on the column's own measured centre. The span's midpoint is not the printed centre —
           spans are cut halfway between neighbouring columns — which left every value shifted. */
        let centre=(T.colX&&T.colX[c]!=null)?T.colX[c]
                  :(g?(g.nx+((g.x2!=null?g.x2:g.nx+(g.nw||0))-g.nx)/2):null);
        if(centre==null)return;
        const colW=span?Math.max(0.006,span.to-span.from)
                       :(g?Math.max(0.006,((g.x2!=null?g.x2:g.nx+(g.nw||0))-g.nx)*1.5):0.05);
        const left=Math.max(0,centre-colW/2);
        putRowCell(pi,left,colW,midY,v.toUpperCase(),fh);
        applied++;
      });
      LOG("EC insert row",i,"page",pi+1,"pitch",pitch.toFixed(4),"y",midY.toFixed(4));
      return;
    }
    /* a printed row: stamp each changed cell over its own box */
    cols.forEach(c=>{
      if(ecLockedCol(c))return;
      const was=String((r._orig&&r._orig[c])!=null?r._orig[c]:"").trim();
      const now=String(r.cells[c]!=null?r.cells[c]:"").trim();
      if(!now||now===was)return;
      const box=r._g&&r._g[c];
      if(!box){ missed++; LOG("EC: no box for ["+c+"] on row",i); return; }
      const pi=(typeof r.page==="number"&&r.page>=0)?r.page:0;
      /* One character sits flush on the printed digit it replaces; two or more centre in the cell — the
         same rule the Design Summary counts use. */
      const al=(now.length<=1)?"left":"center";
      const id=stampWholeCell(pi,box,now,al);
      if(id==null){ missed++; return; }
      applied++;
      LOG("EC cell ["+c+"] row",i,":",JSON.stringify(was),"→",JSON.stringify(now),"page",pi+1);
    });
  });
  LOG("EC table apply:",applied,"mark(s),",missed,"missed");
  return {applied,missed};
}
function ecInsertAfter(T,idx){
  const src=T.rows[idx]; if(!src)return null;
  const cells={}; (T.columns||[]).forEach(c=>{ cells[c]=""; });
  /* 6da — a row you add by hand came from the field, so its From column says so before you type anything.
     Only the From column, and only when the table prints one. */
  (T.columns||[]).forEach(c=>{ if(/^from$/i.test(String(c).trim())||/\bfrom\b/i.test(String(c).trim()))cells[c]="Input"; });
  const nw={cells, _orig:Object.assign({},cells), inserted:true, struck:false,
            page:src.page, _aboveG:src._g||src._aboveG||null, _y:src._y,
            _stackIdx:(src.inserted?(src._stackIdx||0)+1:0)};
  T.rows.splice(idx+1,0,nw);
  return nw;
}
/* 6cb — Non RF Inventory Details (Final). Read the same way as RF Inventory: straight off the page
   geometry, no AI. It is READ-ONLY — nothing here is ever redlined; it exists so the Discrepancies tab
   can check the BBU (and anything else non-RF) against what the Design Summary says. Its header is
   looser than the RF one: the non-RF table does not carry Sec-Pos or Technology. */
function readNonRfFromGeometry(pages){
  const HDR=l=>{
    const n=l.norm;
    if(n.indexOf("model")<0)return false;
    let s=0; ["equipmenttype","vendor","manufacturer","quantity","qty","description",
              "status","commonname","usid","location","type"].forEach(k=>{ if(n.indexOf(k)>=0)s++; });
    return s>=1;
  };
  const SKIP=/^(equipment|type|vendor|manufacturer|model|quantity|qty|description|status|common|name|usid|location|no|item)+$/;
  const t=readTableByCell(pages,HDR,SKIP);
  if(!t.rows.length)LOG("Non-RF Inventory: no rows read — check the header row on those pages");
  return t;
}
/* 6dd — some RFDS forms split Vendor, Model and Tip Height into Design / As-Built pairs the way Rad
   Center, Azimuth and Mechanical Downtilt already are. They are canonical fields in their own right, so
   they read, redline and follow their Design partner like every other as-built column. */
const ANT_FIELDS=["secPos","vendor","vendorAsBuilt","model","modelAsBuilt",
                  "radCenterDesign","radCenterAsBuilt","tipHeight","tipHeightAsBuilt",
                  "azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt"];
/* 6ci — read Antenna Position Details as WHOLE CELLS, every field.
   ------------------------------------------------------------------------------------------------
   Two things were wrong with the first version. It asked `antCellAt` for the single nearest text run, so
   a value that wrapped ("ANDREW/COMMSCOP" + "E") came back as whichever fragment happened to be closer —
   which is why Vendor read as "E". And it only ever looked for ten known fields, so everything else the
   page prints (Antenna Size, Weight, Linked Cells, Coax Amount, the separations) was thrown away.

   Now: the left-hand labels define the row bands, the Sec-Pos row defines the column boundaries, and each
   cell is every run inside that rectangle joined in reading order with `joinCellLines` — the same joiner
   the other table readers use. Known labels map to the canonical keys the rest of the app already uses;
   everything else is kept under its printed label. */
/* 6dd — ORDER MATTERS here, and getting it wrong is what emptied the Vendor and Model rows on a form
   that prints both. "Vendor (As-Built)" normalises to "vendorasbuilt", which `/^vendor/` matches just as
   happily as "Vendor (Design)" does — so both rows mapped to the same key and the second one (the
   as-built, printing "-") overwrote the value read from the first. Every as-built pattern is now tried
   BEFORE its bare partner.

   6fu — AND EVERY FIELD NEEDS A BARE FALLBACK, NOT JUST THE ONES ADDED LAST. Rad Center, Azimuth and
   Mechanical Downtilt required the word: `/^radcenter.*design/`. Some forms print no split at all and
   call the row simply "Rad Center" — PAL01099 does — and a label with no key becomes a generic column,
   so those three fields could not be redlined, Mirrored or Linked. Vendor, Model and Tip Height escaped
   only because 6dd bolted their as-built halves onto rows that were already bare, which left them with
   a fallback by accident. Ced: "when an rfds has no design and as built in antenna position, make sure
   to default populate the same toggles and make the same functionality of mirror and link across all
   tabs." A bare label IS the design value. */
const ANT_LABEL_KEY=[
  [/^sec-?pos/,"secPos"],
  [/^vendor.*asbuilt/,"vendorAsBuilt"],[/^vendor/,"vendor"],
  [/^model.*asbuilt/,"modelAsBuilt"],[/^model/,"model"],
  [/^radcenter.*asbuilt/,"radCenterAsBuilt"],[/^radcenter/,"radCenterDesign"],
  [/^tipheight.*asbuilt/,"tipHeightAsBuilt"],[/^tipheight/,"tipHeight"],
  [/^azimuth.*asbuilt/,"azimuthAsBuilt"],[/^azimuth/,"azimuthDesign"],
  [/^mechanicaldowntilt.*asbuilt|^downtilt.*asbuilt/,"mechDowntiltAsBuilt"],
  [/^mechanicaldowntilt|^downtilt/,"mechDowntiltDesign"],
  [/^antennasize/,"antSize"]
];
function antKeyForLabel(lbl){
  const n=String(lbl||"").toLowerCase().replace(/[^a-z]/g,"");
  const hit=ANT_LABEL_KEY.find(([re])=>re.test(n));
  return hit?hit[1]:null;
}
/* Rad Center is in FEET, the antenna's height is in INCHES: the tip sits half the antenna above its
   centre. 150 ft with a 48 in antenna tips at 152 ft. */
const ANT_TIP_TOL=0.5;      // feet. Below this the printed value stands — it is a rounding difference.
/* 6cu — a STACKED antenna is two radiating elements on one mount, so it does not have one rad centre:
   the page prints the middle and the real pair sits two feet either side of it. Written the way the
   as-built column takes it, upper first. */
const ANT_STACK_OFFSET=2;
/* 6cv — a stacked pair is not measured from the antenna's printed H. The two elements are 2.4 ft of
   aperture between them, so each element's tip sits half of that above its own rad centre:
       287 | 283   ->   288.2 | 284.2
   The Antenna Size column describes the whole assembly and is the wrong number here. */
const ANT_STACK_H_FT=2.4;
function antIsStacked(model){ return /\bSTACK(ED)?\b/i.test(String(model||"")); }
function antStackPair(rad){
  const v=parseFloat(String(rad==null?"":rad).replace(/[^0-9.\-]/g,""));
  if(!isFinite(v))return "";
  const up=Math.round((v+ANT_STACK_OFFSET)*10)/10, dn=Math.round((v-ANT_STACK_OFFSET)*10)/10;
  return String(up)+" | "+String(dn);
}
function antIsStackPair(v){ return /^\s*-?\d+(\.\d+)?\s*\|\s*-?\d+(\.\d+)?\s*$/.test(String(v||"")); }
/* the parts of a value written as "a | b" — one part for an ordinary cell, two for a pair. A pair is a
   pair whether the tool made it or you typed it. */
function antParts(v){
  return String(v==null?"":v).split("|").map(x=>x.trim()).filter(x=>x!=="");
}
function antHasPair(v){ return antParts(v).length>1; }
/* 6cv — the tip for a whole cell, part by part. A stacked model measures from 2.4 ft, everything else
   from the H of its Antenna Size. Returns "" when it cannot compute every part. */
/* 6da — the page's way of writing "nothing here". Any of these in an As-Built cell means it has not been
   measured, so the Design value belongs in it. */
function antBlank(v){
  const t=String(v==null?"":v).trim();
  return !t || /^[-\u2010-\u2015\u2212\u2043]+$/.test(t) || /^(n\/?a|na|tbd|none|null)$/i.test(t);
}
/* 6dc — the tip is the rad centre plus half the antenna, and half the antenna comes from the Antenna
   Size column. Not every RFDS prints that column, and on the ones that do not, `antTipCell` returned ""
   and the Tip Height simply never moved — correct the rad centre and the tip stayed at the printed
   figure, which is what "tip height is not applying the redlines" looks like.

   The page itself knows the offset: whatever it printed as Tip Height, minus whatever it printed as Rad
   Center (Design), IS half the antenna. Read it once, use it whenever the size cannot be. A freshly read
   page therefore computes its own printed tip back exactly and nothing is redlined until you move the
   rad centre — at which point the tip moves with it. */
function antTipOffset(row){
  if(!row)return null;
  const t=parseFloat(String(row._orig_tipHeight==null?"":row._orig_tipHeight).replace(/[^0-9.\-]/g,""));
  const r=parseFloat(String(row._orig_radCenterDesign==null?"":row._orig_radCenterDesign).replace(/[^0-9.\-]/g,""));
  if(!isFinite(t)||!isFinite(r))return null;
  const d=Math.round((t-r)*100)/100;
  return (d>=0&&d<=25)?d:null;          // a sane half-antenna; anything else is two unrelated numbers
}
function antTipCell(row,rad){
  const parts=antParts(rad!=null?rad:(row&&row.radCenterDesign));
  if(!parts.length)return "";
  const stacked=antIsStacked(row&&row.model);
  const out=[];
  for(const pt of parts){
    const rc=parseFloat(String(pt).replace(/[^0-9.\-]/g,""));
    if(!isFinite(rc))return "";
    let t;
    if(stacked) t=antRound(rc+ANT_STACK_H_FT/2);
    else {
      t=antTipFrom(pt,row&&row.antSize);
      if(t==null){                       // 6dc — no readable Antenna Size: use the offset the page printed
        const off=antTipOffset(row);
        if(off==null)return "";
        t=antRound(rc+off);
      }
    }
    out.push(String(antRound(t)));      /* 6dv — to the nearest hundredth, on every path */
  }
  return out.join(" | ");
}
/* the upper element — what the tip height is measured from */
function antStackTop(v){
  const m=String(v||"").split("|")[0];
  const n=parseFloat(String(m).replace(/[^0-9.\-]/g,""));
  return isFinite(n)?n:null;
}
/* 6dj — a tip height is not a round number. This page prints 287.85, and rounding the computed value to
   one decimal answered 287.9 — a redline that is wrong by 5/100 of a foot and, worse, one that turns a
   correct page into a corrected one. Two decimals, and a trailing zero is dropped so 199.00 reads 199. */
function antRound(v){
  if(!isFinite(v))return v;
  return Math.round(v*100)/100;
}
function antTipFrom(radCenter,size){
  /* 6dv — the result is rounded where it is produced, so no caller can pass a raw float through */
  const rc=parseFloat(String(radCenter||"").replace(/[^0-9.\-]/g,""));
  const h=parseFloat(String(size||"").trim().split(/[^0-9.]+/).filter(Boolean)[0]||"");
  if(!isFinite(rc)||!isFinite(h)||h<=0)return null;
  return antRound(rc+(h/2)/12);
}
/* 6cq — what a Sec-Pos can look like. "A-1", "A1", "AA-2", "ALPHA-1", "C-1 (D)" — a short alphabetic
   prefix, a number, optionally a bracketed letter. What it can NOT look like is "ANDREW/COMMSCOPE" or
   "ERICSSON", and that is the point: on a document where the Sec-Pos band drifted by one row, every
   column took its name from the VENDOR line. The sector is the first letter of the Sec-Pos, so
   "ANDREW/COMMSCOPE" became sector A and seven antennas piled into Alpha. Anything that is not a
   position is not a position. */
const ANT_POS_RE=/^[A-Za-z]{1,6}\s*[-\u2010-\u2015]?\s*\d{1,3}\s*(\(\s*[A-Za-z]\s*\))?$/;
function antIsPos(v){
  const t=String(v==null?"":v).trim();
  return !!t && t.length<=12 && /\d/.test(t) && ANT_POS_RE.test(t);
}
function readAntennaFromGeometry(pages){
  const out=[];
  (pages||[]).forEach(pi=>{
    if(!S.pages[pi])return;
    const items=(S.pages[pi].items||[]).filter(t=>String(t.str).trim()!=="");
    if(!items.length)return;
    const LBL_X=0.135;
    /* 1. the label column, grouped into blocks — a label that wraps ("Mechanical Downtilt" / "(Design)")
          is one field, not two. */
    const labs=items.filter(t=>t.nx<LBL_X).sort((a,b)=>a.ny-b.ny);
    if(!labs.length){ LOG("Antenna geometry: no label column on page",pi+1); return; }
    const lh=labs.reduce((m,t)=>Math.min(m,t.nh||0.011),0.02)||0.011;
    const blocks=[];
    labs.forEach(t=>{
      const prev=blocks[blocks.length-1];
      /* 6cq — 1.2 line heights was wide enough to swallow the NEXT FIELD's label: on a compact table
         "Sec-Pos" and "Vendor" merged into one block and the Vendor row disappeared. A label that WRAPPED
         sits about a fifth of a line below its own first line (leading minus height); a label that belongs
         to the next row sits a whole row away. Half a line separates the two cases. A continuation that
         opens a bracket — "(Design)", "(As-Built)" — is still taken whatever the gap. */
      const cont=prev&&((t.ny-prev.yEnd)<lh*0.5||/^\(/.test(String(t.str).trim()));
      if(cont){ prev.text=joinCellLines(prev.text,String(t.str).trim()); prev.yEnd=t.ny+(t.nh||lh); }
      else blocks.push({text:String(t.str).trim(),y:t.ny,yEnd:t.ny+(t.nh||lh)});
    });
    /* 2. the Sec-Pos row gives the columns */
    const secBlock=blocks.find(b=>/^sec-?pos/.test(b.text.toLowerCase().replace(/[^a-z-]/g,"")));
    if(!secBlock){ LOG("Antenna geometry: no Sec-Pos row on page",pi+1); return; }
    /* the page title sits in the label column too — everything above Sec-Pos is heading, not a field */
    blocks.splice(0,blocks.indexOf(secBlock));
    /* 6cj — a tall row (Linked Cells) centres its label vertically, so the label's TOP sits well below
       where the row's value starts. Taking the band from label tops therefore pulled the row above down
       over its neighbour's content — which is how "Linked Cells" ended up inside MDT (As-Built).
       Midpoints between label CENTRES land in the gap between rows however tall they are. */
    /* 6gj — THE MIDPOINT BETWEEN TWO LABEL CENTRES IS NOT THE ROW SEPARATOR WHEN ONE ROW IS TALL.
       6cj moved off label TOPS and onto label CENTRES, which fixed a tall row pulling its neighbour
       DOWN. It left the mirror image: Linked Cells holds seven entries, so its label is centred about
       three and a half lines below the row's top, and the midpoint between it and "Mechanical Downtilt
       (As-Built)" above lands INSIDE the list. `OMIN091948_N002A_1` was read as a mechanical downtilt.
       Measured on the fixture: A-3's MDT (As-Built) came back as "OMIN091948_N002A_1"; A-1 and A-2,
       whose lists are short enough to sit centred and clear of the boundary, were fine — which is why
       it looks like one bad column rather than a bad rule.

       Rows are separated by WHITESPACE, so that is what to look for. Between one label's centre and the
       next, cluster everything printed in the value area into lines and put the boundary in the widest
       gap between consecutive lines. The midpoint is kept as the answer when no gap stands out (a
       comfortable margin over the typical gap), so a table with even rows behaves exactly as before. */
    const valueLines=(y0,y1)=>{
      const its=items.filter(t=>t.nx>=LBL_X)
                     .map(t=>({c:t.ny+(t.nh||lh)/2,h:t.nh||lh}))
                     .filter(o=>o.c>y0&&o.c<y1)
                     .sort((a,b)=>a.c-b.c);
      const out=[];
      its.forEach(o=>{
        const last=out[out.length-1];
        if(last&&(o.c-last.c)<=Math.max(o.h,last.h)*0.6){
          last.c=(last.c*last.n+o.c)/(last.n+1); last.n++; last.h=Math.max(last.h,o.h);
        } else out.push({c:o.c,h:o.h,n:1});
      });
      return out;
    };
    const bandsOf=list=>{
      const c=list.map(b=>(b.y+b.yEnd)/2);
      const cut=(i)=>{
        const a=c[i], z=c[i+1], mid=(a+z)/2;
        const ls=valueLines(a,z);
        /* the candidate separators: every gap between consecutive printed lines, and the two gaps at
           the ends of the window. A window with nothing in it has only the midpoint to offer. */
        const stops=[a].concat(ls.map(o=>o.c)).concat([z]);
        let best=null, sum=0, n=0;
        for(let k=0;k<stops.length-1;k++){
          const g=stops[k+1]-stops[k];
          sum+=g; n++;
          if(!best||g>best.g)best={g:g,at:(stops[k]+stops[k+1])/2};
        }
        if(!best||n<2)return mid;
        const avg=sum/n;
        /* no gap stands clear of the rest — the rows are even and the midpoint was already right */
        if(best.g<avg*1.35)return mid;
        return best.at;
      };
      const cuts=list.map((b,i)=>i===list.length-1?1:cut(i));
      return list.map((b,i)=>[i===0?(c[0]-lh*1.2):cuts[i-1], cuts[i]]);
    };
    const band=(b,next)=>[b.y-lh*0.4, next?next.y-lh*0.4:1];
    const [sy0,sy1]=band(secBlock,blocks[blocks.indexOf(secBlock)+1]);
    /* 6cj — EVERY column in the Sec-Pos row defines a boundary, including the empty ones that print only
       a dash. Before this the last real position was given the rest of the page, so A-3 swallowed the
       dashes from the four unused columns to its right and read "59—", "CCI—", "61—". Only the columns
       with a real Sec-Pos become rows; the rest exist purely to fence them in.

       6cr — the band is derived from LABEL positions, and a label is vertically CENTRED in its row. The
       Vendor row is two lines tall when the vendor wraps ("ANDREW/COMMSCOP" / "E"), so its label sits
       below its own first line and the Sec-Pos band ran on into it. The band then held both the
       positions AND the vendor line, the boundaries were cut between them, and every column whose vendor
       wrapped got a sliver too narrow to hold its own cells — which is why the columns that survived
       were exactly the ones with a single-line vendor (ERICSSON). The band is now re-derived from the
       POSITIONS THEMSELVES as soon as we have found any: they are one printed line, so their own extent
       is the row. */
    const headsIn=(y0,y1)=>items.filter(t=>t.nx>=LBL_X&&(t.ny+(t.nh||lh)/2)>=y0&&(t.ny+(t.nh||lh)/2)<y1)
                        .sort((a,b)=>a.nx-b.nx)
                        .map(t=>({label:String(t.str).trim(),cx:t.nx+(t.nw||0)/2,ny:t.ny,nh:t.nh||lh}));
    const boundsOf=list=>list.map((h,i)=>{
      const lo=i===0?LBL_X:(list[i-1].cx+h.cx)/2;
      const hi=i===list.length-1
        ? Math.min(1,h.cx+(list.length>1?(h.cx-list[i-1].cx)/2:0.09))
        : (h.cx+list[i+1].cx)/2;
      return [lo,hi];
    });
    /* the tight band around a set of runs that share a printed line */
    const tightBand=list=>{
      const h=Math.max.apply(null,list.map(t=>t.nh||lh));
      const c=list.reduce((m,t)=>m+((t.ny!=null?t.ny:0)+(t.nh||lh)/2),0)/list.length;
      return [c-h*0.75, c+h*0.75];
    };
    let allHeads=headsIn(sy0,sy1);
    let posHeads=allHeads.filter(h=>antIsPos(h.label));
    let how="the Sec-Pos label";
    if(!posHeads.length){
      /* Nothing in the label's band looks like a position — the band is wrong, or empty. Find the row
         from its VALUES: cluster every position-shaped run on the page by printed line and take the
         line carrying the most of them (the topmost wins a tie). */
      const cand=items.filter(t=>t.nx>=LBL_X&&antIsPos(t.str))
                      .map(t=>({t,cy:t.ny+(t.nh||lh)/2,h:(t.nh||lh)}))
                      .sort((a,b)=>a.cy-b.cy);
      if(!cand.length){
        LOG("⚠ Antenna geometry: page "+(pi+1)+" — nothing anywhere on the page looks like a Sec-Pos; no rows read");
        return;
      }
      const clusters=[];
      cand.forEach(o=>{
        const last=clusters[clusters.length-1];
        if(last&&Math.abs(o.cy-last.cy)<=Math.max(o.h,last.h)*0.8){
          last.items.push(o.t); last.cy=(last.cy*(last.items.length-1)+o.cy)/last.items.length;
        } else clusters.push({cy:o.cy,items:[o.t]});
      });
      let best=null;
      clusters.forEach(c=>{ if(!best||c.items.length>best.items.length)best=c; });
      const [ry0,ry1]=tightBand(best.items.map(t=>({ny:t.ny,nh:t.nh})));
      allHeads=headsIn(ry0,ry1);
      posHeads=allHeads.filter(h=>antIsPos(h.label));
      how="the position values themselves";
    } else {
      /* We have the positions. Re-cut the band around THEM so a neighbouring row that overlapped the
         label's band cannot take part in the boundaries. */
      const [ty0,ty1]=tightBand(posHeads);
      const re=headsIn(ty0,ty1);
      const reP=re.filter(h=>antIsPos(h.label));
      if(reP.length>=posHeads.length){ allHeads=re; posHeads=reP; }
    }
    const allBounds=boundsOf(allHeads);
    const keep=allHeads.map((h,i)=>i).filter(i=>antIsPos(allHeads[i].label));
    const heads=keep.map(i=>allHeads[i]);
    const bounds=keep.map(i=>allBounds[i]);
    if(!heads.length){
      LOG("⚠ Antenna geometry: page "+(pi+1)+" — nothing in the Sec-Pos row looks like a position: "+
          (allHeads.length?allHeads.slice(0,6).map(h=>JSON.stringify(h.label)).join(", "):"(the row read empty)")+
          " — no rows read from this page");
      return;
    }
    LOG("Antenna geometry: page "+(pi+1)+" — Sec-Pos row from "+how+": "+
        heads.map(h=>h.label).join(", ")+"  (+"+(allHeads.length-heads.length)+" empty column(s) fencing them)");
    /* 3. one cell = every run inside (column, field band), joined in reading order */
    const BANDS=bandsOf(blocks);
    /* the cell, and the box it occupies — the box is what a redline is stamped over, so it is kept even
       when the cell printed nothing (6cj: a value typed into a previously blank row still lands) */
    const cellAt=(ci,bi)=>{
      const [y0,y1]=BANDS[bi], [x0,x1]=bounds[ci];
      /* the item's LEFT edge has to be inside the column too. A long field label that overflows the
         label column ("Vertical Separation from Antenna Above (Tip to Tip)") has its CENTRE past the
         boundary and was being read as part of the first position's value. */
      const got=items.filter(t=>{ const cx=t.nx+(t.nw||0)/2, cy=t.ny+(t.nh||lh)/2;
        return t.nx>=x0-0.002&&cx>x0&&cx<=x1&&cy>=y0&&cy<y1; })
        .sort((p,q)=>(p.ny-q.ny)||(p.nx-q.nx));
      /* 6cj — `joinCellLines` glues two single-token lines with no space, which is right for a word the
         column broke ("ANDREW/COMMSCOP" + "E") and wrong for a cell that genuinely holds a LIST, one
         entry per line (Linked Cells). A break mid-token leaves a short remnant; a list does not. */
      const antJoin=(prev,next)=>{
        if(!prev)return next;
        const p=prev.trim(), q=next.trim();
        const remnant=q.length<=3||/^[a-z]/.test(q);
        const longStem=p.replace(/\s+$/,"").split(/\s+/).pop().length>=8;
        return (remnant&&longStem)?joinCellLines(prev,next):(prev+" "+next);
      };
      /* 6cq — a lone dash is a placeholder for "nothing here", so it is never PART of a value. When a
         cell holds a dash next to real text the dash came from the column beside it, and joining the two
         produced reads like "ANDREW/COMMSCOP - E". Drop the dashes whenever anything else is present. */
      const real=got.filter(t=>!/^[-\u2010-\u2015\u2212]+$/.test(String(t.str).trim()));
      const use=real.length?real:got;
      /* 6cr — a dash can arrive INSIDE a run: some writers emit "ANDREW/COMMSCOP -" as one text-showing
         operation when the empty column's dash sits close enough. Strip a dash standing alone at either
         end of a run before joining, or it lands in the middle of the joined value ("…COMMSCOP - E").
         Only a dash with whitespace beside it — "NNH4-65C-R6-V4" is untouched. */
      const clean=x=>String(x).trim()
        .replace(/^[-\u2010-\u2015\u2212]\s+/,"").replace(/\s+[-\u2010-\u2015\u2212]$/,"").trim();
      let v=""; use.forEach(t=>{ const c2=clean(t.str); if(c2)v=antJoin(v,c2); });
      v=v.trim();
      /* 6cs — how many LINES the cell printed on, and how wide its top line is. Without these every
         antenna redline was stamped as a single line: "ANDREW/COMMSCOPE" written over a cell that
         printed "ANDREW/COMMSCOP" / "E" ran past the column and left the "E" showing underneath. With
         them, stampWholeCell wraps the value into the printed width and covers both lines — the same
         treatment RF Inventory and the Design Summary have had since 6ci. */
      let box;
      if(use.length){
        const rows2=[];
        use.slice().sort((a,b)=>a.ny-b.ny).forEach(t=>{
          const last=rows2[rows2.length-1];
          if(last&&Math.abs(t.ny-last.ny)<=Math.max(t.nh||lh,lh)*0.45){
            last.right=Math.max(last.right,t.nx+(t.nw||0));
            last.left=Math.min(last.left,t.nx);
          } else rows2.push({ny:t.ny,left:t.nx,right:t.nx+(t.nw||0)});
        });
        const top=rows2[0];
        box={nx:Math.min(...use.map(t=>t.nx)),ny:Math.min(...use.map(t=>t.ny)),
             nh:(use[0].nh||lh),
             nw:Math.max(...use.map(t=>t.nx+(t.nw||0)))-Math.min(...use.map(t=>t.nx)),
             x2:Math.max(...use.map(t=>t.nx+(t.nw||0))),
             y2:Math.max(...use.map(t=>t.ny+(t.nh||lh))),
             lines:rows2.length, topY:top.ny, topR:top.right,
             /* 6cx — the COLUMN the cell sits in. Without it a replacement longer than the printed value
                had nothing to be measured against and simply grew sideways out of its column. */
             colL:x0, colR:x1};
      } else {
        box={nx:x0+0.004,ny:(y0+y1)/2-lh/2,nw:Math.max(0.02,(x1-x0)-0.008),nh:lh,
             x2:x1-0.004,y2:(y0+y1)/2+lh/2,lines:1,synth:true,colL:x0,colR:x1};
      }
      return {v:/^[-–—]$/.test(v)?"":v, box};
    };
    const order=[];
    heads.forEach((h,ci)=>{
      const o={page:pi,struck:false,fields:{},_fieldOrder:[],_gf:{}};
      blocks.forEach((b,bi)=>{
        const label=b.text.replace(/\s+/g," ").trim();
        if(!label)return;
        const cell=cellAt(ci,bi);
        const val=(bi===0)?h.label:cell.v;
        const key=antKeyForLabel(label);
        o.fields[label]=val;
        o._gf[label]=cell.box;                    // where to stamp a correction to this cell
        if(o._fieldOrder.indexOf(label)<0)o._fieldOrder.push(label);
        if(key){ o[key]=val; o["_orig_"+key]=val; o._gf[key]=cell.box; }
      });
      o._origFields=Object.assign({},o.fields);
      /* every canonical field exists even when the page does not print it */
      ANT_FIELDS.forEach(f=>{ if(o[f]==null){ o[f]=""; o["_orig_"+f]=""; } });
      /* 6gj — A NUMBER COLUMN CANNOT HOLD A CELL REFERENCE. The band fix above stops Linked Cells
         reaching up into Mechanical Downtilt, but a band is a measurement and measurements can be wrong
         on a form nobody has seen yet. So the canonical numeric fields also check their own value: a
         figure, optionally a stacked pair, optionally a unit — and nothing else. What fails is dropped
         and NAMED in the log rather than carried silently into a redline, and `_orig_` is cleared with
         it so the correction is not measured against rubbish. */
      const ANT_NUM_RE=/^-?\d+(\.\d+)?(\s*\|\s*-?\d+(\.\d+)?)?$/;
      ["radCenterDesign","radCenterAsBuilt","tipHeight","tipHeightAsBuilt",
       "azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt"].forEach(f=>{
        const raw=String(o[f]==null?"":o[f]).trim();
        if(!raw)return;
        const bare=raw.replace(/\s*(?:ft|feet|deg(?:rees)?|in(?:ches)?|°)\s*$/i,"").trim();
        if(ANT_NUM_RE.test(bare))return;
        LOG("⚠ Antenna "+(o.secPos||h.label)+": "+f+" read "+JSON.stringify(raw)+
            " — that is not a number, so it came from a neighbouring row. Cell left empty.");
        o[f]=""; o["_orig_"+f]="";
      });
      /* 6gj — NO MECHANICAL DOWNTILT MEANS ZERO DEGREES OF IT. The form prints a dash in the mechanical
         downtilt rows of an antenna that is mounted flat, and a dash was read as "unknown" and left the
         cell empty — so the grid showed a hole where the answer is 0, and Fill As-Built had nothing to
         copy. A dash here is a statement, not a gap. Scoped to mechanical downtilt on purpose: a dash in
         Rad Center or Tip Height genuinely is a missing measurement and must stay missing. */
      const filled=ANT_FIELDS.filter(f=>f!=="secPos"&&String(o[f]||"").trim()!=="").length;
      const anyField=Object.keys(o.fields).filter(k=>String(o.fields[k]||"").trim()!=="").length;
      if(!filled&&anyField<2)return;                      // a column of dashes is not an antenna
      /* 6gs — AND THE ZERO IS A CORRECTION, NOT A READ. 6gj wrote the 0 into `_orig_` as well, which
         made it the value the page was taken to have printed — so the grid showed 0, nothing counted as
         changed, and the dash stayed on the exported page. Ced: "it should still read '-' as a value and
         then redline it to '0'." `_orig_` therefore keeps what the page actually printed (the dash,
         which the reader normalises to empty) and only the working value becomes 0, so the row counts as
         changed and the redline pass stamps the 0 over the dash in its own cell.
         It also moved BELOW the dash-column guard above: an invented zero must never be the thing that
         promotes a column of dashes into an antenna, which is what would now get stamped. */
      if(o._gf&&(o._gf.mechDowntiltDesign||o._gf.mechDowntiltAsBuilt)){
        if(!String(o.mechDowntiltDesign||"").trim()&&o._gf.mechDowntiltDesign)o.mechDowntiltDesign="0";
        if(!String(o.mechDowntiltAsBuilt||"").trim()&&o._gf.mechDowntiltAsBuilt)o.mechDowntiltAsBuilt="0";
      }
      /* As-Built prefills from Design — what Fill As-Built would write, shown before you write it.
         6da — a printed as-built cell is EMPTY when it holds a placeholder, not just when it holds
         nothing: "-", "—", "N/A" and "TBD" are all the page saying "not measured yet", and any of them
         used to block the prefill, which is why the columns filled on some rows and not others. */
      /* 6db — the As-Built column IS the Design value. Not "when it is blank", not "when it still looks
         like a prefill": if the page printed something else there, that is the thing to redline. A page
         reading 178.3 against a design of 179 is exactly the case this exists for. The printed figure
         stays in `_orig_` and is what the correction is measured against. */
      /* 6dd — vendor and model join the rule. A form that prints "Vendor (As-Built)  -" against a design
         vendor is stating an unmeasured column, and that is precisely what gets redlined. */
      [["radCenterAsBuilt","radCenterDesign"],["azimuthAsBuilt","azimuthDesign"],
       ["mechDowntiltAsBuilt","mechDowntiltDesign"],
       ["vendorAsBuilt","vendor",1],["modelAsBuilt","model",1],
       ["tipHeightAsBuilt","tipHeight",1]].forEach(([ab,des,onlyIfPrinted])=>{
        /* 6dd — the three new pairs only exist on the forms that print them. Without this guard a page
           with a single "Tip Height" column grew a phantom as-built value, and the redline pass fell back
           to the design row and stamped the design tip on top of itself. */
        if(onlyIfPrinted&&!(o._gf&&o._gf[ab]))return;
        const dv=String(o[des]||"").trim();
        if(dv&&String(o[ab]||"").trim()!==dv){
          if(!antBlank(o[ab]))LOG("Antenna "+o.secPos+": "+ab+" "+JSON.stringify(String(o[ab]))+
            " does not match the design "+JSON.stringify(dv)+" — redlined to the design value");
          o[ab]=dv;
        }
      });
      /* 6ci — Tip Height from the rad centre and the antenna's own height. Only when the printed value is
         genuinely off: within ANT_TIP_TOL feet the page stands, because that is a rounding difference and
         not an error worth redlining. */
      /* 6cu — a stacked model's as-built rad centre is the pair, derived from the printed design value.
         It is a real correction, so it redlines like any other as-built figure. */
      /* 6cv — a stacked antenna has two rad centres, and BOTH columns say so: the design figure the page
         prints is the middle of the pair, not one of them. */
      if(antIsStacked(o.model)&&!antHasPair(o.radCenterDesign)){
        const src=String(o.radCenterDesign||"").trim();
        const pair=antStackPair(src);
        if(pair){
          o.radCenterDesign=pair;
          if(!antHasPair(o.radCenterAsBuilt))o.radCenterAsBuilt=pair;
          o._stackPair=true;
          LOG("Antenna "+o.secPos+": STACKED model \""+o.model+"\" — rad centre "+src+" becomes "+pair+
              " (\u00b1"+ANT_STACK_OFFSET+" ft) in both the Design and As-Built columns");
        }
      }
      const tipCell=antTipCell(o,o.radCenterDesign);
      if(!tipCell)LOG("Antenna "+o.secPos+": Tip Height not computed — no rad centre, no readable "+
        "Antenna Size and no printed tip to take the offset from. rad "+
        JSON.stringify(String(o.radCenterDesign||""))+", size "+JSON.stringify(String(o.antSize||""))+
        " (both are needed: tip = rad + half the H value, in feet"+
        (antIsStacked(o.model)?("; a STACKED model uses "+ANT_STACK_H_FT+" ft instead of H"):"")+")");
      if(tipCell){
        o._tipCalc=tipCell;
        const printed=String(o.tipHeight||"").trim();
        const pp=antParts(printed), cp=antParts(tipCell);
        const far=(pp.length!==cp.length)||cp.some((c,i)=>{
          const a2=parseFloat(String(pp[i]||"").replace(/[^0-9.\-]/g,""));
          return !isFinite(a2)||Math.abs(a2-parseFloat(c))>ANT_TIP_TOL;
        });
        /* 6dd — the As-Built tip follows the DESIGN tip, and the design tip is computed below, after the
           pair loop has run. Carry it again here so a page that prints both columns does not keep the
           printed figure in the as-built one. */
        if(!printed){ o.tipHeight=tipCell; o._tipFilled=true;
          LOG("Antenna "+o.secPos+": Tip Height was blank — computed "+tipCell+" ft"); }
        else if(far){ o.tipHeight=tipCell; o._tipFixed=true;
          LOG("Antenna "+o.secPos+": Tip Height "+printed+" → "+tipCell+" ft (rad "+o.radCenterDesign+
              (antIsStacked(o.model)?(" + half of "+ANT_STACK_H_FT+" ft, stacked"):(" + half of "+o.antSize))+")"); }
      }
      if(o._gf&&o._gf.tipHeightAsBuilt&&String(o.tipHeight||"").trim()
         &&String(o.tipHeightAsBuilt||"").trim()!==String(o.tipHeight).trim())
        o.tipHeightAsBuilt=String(o.tipHeight).trim();
      out.push(o); order.push(h.label);
    });
    LOG("Antenna geometry: page "+(pi+1)+" — "+order.length+" position(s) ("+order.join(", ")+") × "+
        blocks.length+" field(s): "+blocks.map(b=>b.text).join(" | "));
  });
  return out;
}
/* ================================================================================================
   6ck — Generate RFDS Redline Report.
   ------------------------------------------------------------------------------------------------
   A short description of what was redlined, in the voice an RF engineer writes it in:

       Actual equipment count on Design Summary
       Actual status of some equipment
       Actual model of squids (DC9-48-60-24-8C-EV instead of DC6-48-60-18-8F)
       Actual as-built values

   Built from the ANALYSIS, not from the marks: the marks know a red string sits at a coordinate, the
   analysis knows it was a count on the Design Summary that went from 3 to 4. Marks are only consulted for
   the redlines you drew by hand, which the analysis cannot know about.
   ================================================================================================ */
function _rlModelPhrase(type,model,one){
  const c=canonType(String(type||"").trim());
  if(!c||c==="Other")return "equipment";
  /* "DC_TRUNK" should read "DC trunks", not "dc_trunks": separators become spaces, short all-caps tokens
     stay acronyms, the rest go lower case, and the last word takes the plural. */
  const w=c.replace(/[_\-]+/g," ").split(/\s+/).filter(Boolean)
           .map(x=>/^[A-Z0-9]{2,3}$/.test(x)?x:x.toLowerCase());   // DC and RRH are acronyms, TRUNK is a word
  if(!w.length)return "equipment";
  /* 6cw — singular when it is one unit. "Actual model of antenna (…)" reads better than "of antennas"
     when exactly one row changed. */
  if(one)return w.join(" ");
  const last=w[w.length-1];
  w[w.length-1]=/s$/i.test(last)?last:(last+"s");
  return w.join(" ");
}
/* "A-1" -> "Alpha", "Sector B" -> "Beta", "gamma" -> "Gamma", anything that is not a sector -> "" */
function _rlSector(v){
  const t=String(v==null?"":v).trim(); if(!t)return "";
  let x=normSector(t);
  if(!x||x==="—"){ const m=t.match(/^\s*([A-Za-z])/); x=m?normSector(m[1]):""; }
  if(!x||x==="—")return "";
  if(x==="SITE")return "Site-wide";
  return /^[A-F]$/.test(x)?greek(x):("Sector "+x);
}
/* 6eu — NO MORE "AND N MORE". A list that has outgrown the line says how big it is instead of naming
   three of its members and hiding the rest: "in 7 positions" is shorter than "in A-1, A-2, B-1 and 4
   more" AND it is the whole truth, where the old phrasing was a sample plus an apology. `noun` is what
   the list is a list of; without one the whole list is spelled out rather than trimmed. */
function _rlJoin(list,max,noun){
  const a=[...new Set((list||[]).filter(Boolean))]; max=max||3;
  if(!a.length)return "";
  if(a.length===1)return a[0];
  if(a.length<=max)return a.slice(0,-1).join(", ")+" and "+a[a.length-1];
  /* 6cy — never trade one item for the words "1 more". */
  if(a.length===max+1)return a.slice(0,-1).join(", ")+" and "+a[a.length-1];
  return noun ? (a.length+" "+noun) : (a.slice(0,-1).join(", ")+" and "+a[a.length-1]);
}
/* A list of old→new pairs on one line. One or two are worth printing; beyond that the pairs stop being
   readable and start being a wall — 6eu says how many there are instead. "(6 different values)" tells an
   engineer what the old "(100' instead of 166', and 5 more)" was trying to: go and read the column. */
function _rlPairList(set){
  const ps=[...set];
  if(!ps.length)return "";
  if(ps.length===1)return ps[0];
  if(ps.length===2)return ps[0]+", and "+ps[1];
  return ps.length+" different values";
}
/* 6cz — an antenna correction belongs to a POSITION, not to a sector: "in A-2 and C-2" tells you which
   antenna to walk up to, where "in all sectors" only tells you the job is site-wide. Positions are used
   wherever the row has one; the sector phrasing stays for the tabs that have no positions. */
function _rlPos(v){
  const t=String(v==null?"":v).trim(); if(!t)return "";
  try{ const p=prettySecPos(t); return p||t; }catch(e){ return t; }
}
function _rlPosPhrase(hit,universe){
  const H=[...new Set((hit||[]).filter(Boolean))];
  if(!H.length)return "";
  const U=[...new Set((universe||[]).filter(Boolean))];
  if(U.length>=3&&H.length>=U.length&&U.every(x=>H.indexOf(x)>=0))return "every position";
  return _rlJoin(H,4,"positions");
}
/* 6cm — "in Alpha, Beta and Gamma" is nine words for something that has a two-word name. When the
   corrections cover every sector the table carries, the line says "in all sectors". */
function _rlSecPhrase(hit,universe){
  const H=[...new Set((hit||[]).filter(Boolean))];
  if(!H.length)return "";
  const U=[...new Set((universe||[]).filter(Boolean))];
  if(U.length>=2&&H.length>=U.length&&U.every(x=>H.indexOf(x)>=0))return "all sectors";
  return _rlJoin(H,3,"sectors");
}
/* Where a correction was made. The report names the tab, because "the model is wrong" is a different
   piece of work depending on whether it is wrong on Design Summary or on Port Level Details. */
const RL_TAB={designSummary:"Design Summary",rfInventory:"RF Inventory",
  antennaPosition:"Antenna Position",antennaExisting:"Antenna Position (Existing)",
  antennaDecom:"Antenna Position (Decommissioned)",equipmentCalc:"Equipment in Calc",
  portLevel:"Port Level Details",rfdsDetails:"RFDS Details",siteDetails:"Site Details"};
/* 6cm — the report describes what was REDLINED. Existing and Decommissioned antenna pages are in
   `_skipRedline`: nothing is ever stamped on them, so a difference read there is not a correction and
   has no business in the report. Nine "Antenna Position (Existing)" lines were pure noise. */
function _rlAntKeys(){ return ["antennaPosition","antennaExisting","antennaDecom"].filter(k=>!_skipRedline.has(k)); }
/* WHAT was corrected, named the way the field is printed. */
const RL_ANT_FIELD={vendor:"manufacturer", vendorAsBuilt:"manufacturer (as-built)",
  modelAsBuilt:"model (as-built)",
  radCenterDesign:"rad center", radCenterAsBuilt:"rad center (as-built)",
  tipHeight:"tip height", tipHeightAsBuilt:"tip height (as-built)",
  azimuthDesign:"azimuth", azimuthAsBuilt:"azimuth (as-built)",
  mechDowntiltDesign:"mechanical downtilt", mechDowntiltAsBuilt:"mechanical downtilt (as-built)"};
const RL_ASBUILT=["radCenterAsBuilt","azimuthAsBuilt","mechDowntiltAsBuilt",
                  "vendorAsBuilt","modelAsBuilt","tipHeightAsBuilt"];
/* 6cv — the unit the figure is in, so the line reads like an engineer wrote it: 105' and 240°. Each part
   of a stacked pair carries it — 287' | 283'. Anything already carrying a unit is left alone. */
const RL_ANT_UNIT={radCenterDesign:"'",radCenterAsBuilt:"'",tipHeight:"'",tipHeightAsBuilt:"'",
  azimuthDesign:"\u00b0",azimuthAsBuilt:"\u00b0"};
function _rlUnit(field,v){
  const u=RL_ANT_UNIT[field]; const t=String(v==null?"":v).trim();
  if(!u||!t)return t;
  return t.split("|").map(x=>{
    const p=x.trim(); if(!p)return p;
    if(p.indexOf(u)>=0)return p;
    return /[0-9]$/.test(p)?(p+u):p;
  }).join(" | ");
}
/* 6cn's `_rlPages` is gone: 6co took the page number out of the line, so it had no caller — and the
   one thing it still did was carry the "and N more" phrasing 6eu is removing. */
/* 6cn — the order the tabs appear in, so the report reads down the document the way you worked through
   it rather than in whatever order the checks happen to run. */
const RL_ORDER={rfdsDetails:1,siteDetails:2,designSummary:3,rfInventory:4,
  antennaPosition:5,antennaExisting:5,antennaDecom:5,equipmentCalc:6,portLevel:7};
/* One line: what changed · where on the site · the values · which tab and page.
       Actual equipment count in all sectors on Design Summary, page 4
       Actual status of some equipment in Alpha on RF Inventory, pages 6 and 7
       Actual model of panel antennas in all sectors (TPA65R-BU4DA instead of TPA65R-BU4D) on Design Summary, page 4
   6cn — the em dash is gone: the tab and its page are part of the sentence. */
function _rlLine(what,o){
  o=o||{}; let t=what;
  /* 6eu — "in Site-wide" is not English. The site-wide rows are the BBUs and the processor: they belong
     to no sector, and the line says so without the preposition. */
  if(o.sector)t+=(/^site-wide$/i.test(o.sector)?" site-wide":(" in "+o.sector));
  if(o.pair)  t+=" ("+o.pair+")";
  /* 6co — the page number is out again: the tab already says where to look, and "page 11" on a line that
     covers three sectors was more qualification than the sentence could carry. */
  if(o.where)t+=" on "+o.where;
  return t;
}
function buildRedlineReport(){
  /* 6ct — the report describes what is ON THE DOCUMENT. It used to be built from the analysis diff alone,
     so a freshly analysed file — where as-built columns are prefilled and counts are derived before you
     have stamped anything — already listed corrections under a heading that said nothing had been
     redlined yet. No marks, nothing to report. */
  if(!(S.annos&&S.annos.length)&&!(S.lines&&S.lines.length))return [];
  const A=S.analysis, L=[];
  const seen=new Set();
  let _seq=0;
  const add=(t,k)=>{ if(t&&!seen.has(t)){ seen.add(t);
    L.push({t,o:(RL_ORDER[k]!=null?RL_ORDER[k]:9),i:_seq++}); } };
  if(A){
    const rf=A.rfInventory, ecT=A.ecTable;
    /* every sector each table carries, so a line can say "all sectors" instead of listing them */
    const uDs=(A.designSummary||[]).map(r=>_rlSector(r.sector));
    const uRf=(rf&&rf.rows?rf.rows:[]).map(r=>_rlSector(rfRowSector(r,rf.columns)));
    const uAnt=[]; _rlAntKeys().forEach(k=>(A[k]||[]).forEach(r=>uAnt.push(_rlSector(r.secPos))));
    const uPos=[]; _rlAntKeys().forEach(k=>(A[k]||[]).forEach(r=>{ const p=_rlPos(r.secPos); if(p)uPos.push(p); }));

    /* --- counts --- */
    let dsCounts=0; const dsSec=[], dsPg=[];
    (A.designSummary||[]).forEach(r=>{
      if(r.struck||r.inserted)return;
      /* 6cu — measure against what the tool READ, not against what the page printed. A derived row can
         differ from the printed cell the moment it is read (the four counts are computed from Before and
         After), so comparing with `printed` reported a correction on a Design Summary nobody had
         touched. Before/After against their originals is the only thing that means "you changed this". */
      const edited=(int(r.before)!==int(r.origBefore))||(int(r.after)!==int(r.origAfter))||!!r.manual;
      if(!edited)return;
      const d=rowCounts(r), p=r.printed||{};
      if(int(d.existing)!==int(p.existing)||int(d.removals)!==int(p.removals)||
         int(d.additions)!==int(p.additions)||int(d.final)!==int(p.final)){ dsCounts++; dsSec.push(_rlSector(r.sector)); dsPg.push(r.page); }
    });

    let ecQty=0; const ecPg=[];
    if(ecT&&ecT.columns&&ecT.rows){
      const qc=ecT.columns.find(c=>/qty|quantity|count|total/i.test(String(c)));
      if(qc)ecT.rows.forEach(r=>{ if(!r.struck&&String(r.cells[qc]||"").trim()!==String((r._orig&&r._orig[qc])||"").trim()){ ecQty++; ecPg.push(r.page); } });
    }
    (A.equipmentCalc||[]).forEach(r=>{ if(!r.struck&&int(r.count)!==int(r.printed)){ ecQty++; ecPg.push(r.page); } });
    /* 6eu — ONE count line, not one per tab. The Design Summary and Equipment in Calc carry the same
       count, and Link makes the second follow the first, so "Actual equipment count site-wide on Design
       Summary" followed by "Actual equipment count on Equipment in Calc" was the same correction read
       twice. The sector is named only when the correction is the Design Summary's alone — a line that
       spans two tabs cannot claim one tab's sectors. */
    if(dsCounts||ecQty){
      const w=[]; if(dsCounts)w.push(RL_TAB.designSummary); if(ecQty)w.push(RL_TAB.equipmentCalc);
      add(_rlLine("Actual equipment count",
        {sector:(dsCounts&&!ecQty)?_rlSecPhrase(dsSec,uDs):"",where:_rlJoin(w,2)}),
        dsCounts?"designSummary":"equipmentCalc");
    }

    /* --- status --- */
    let status=0; const stSec=[], stPg=[];
    if(rf&&rf.columns&&rf.rows){
      const sc=rf.columns.filter(c=>/status|state/i.test(String(c)));
      sc.forEach(c=>rf.rows.forEach(r=>{ if(r.inserted||r.struck)return;
        if(String(r.cells[c]||"").trim()!==String((r._orig&&r._orig[c])||"").trim()){ status++; stSec.push(_rlSector(rfRowSector(r,rf.columns))); stPg.push(r.page); } }));
    }
    if(status)add(_rlLine("Actual status of some equipment",{sector:_rlSecPhrase(stSec,uRf),where:RL_TAB.rfInventory,pages:stPg}),"rfInventory");

    /* --- models, named, with the sector and the tab they were corrected on --- */
    const byPair=new Map();
    const noteModel=(type,oldV,newV,tab,sector,page)=>{
      const o=String(oldV||"").trim(), n=String(newV||"").trim();
      if(!o||!n||o===n)return;
      const k=_rlModelPhrase(type,n)+"|"+o+"|"+n;
      if(!byPair.has(k))byPair.set(k,{type,o,n,rows:0,tabs:[],secs:[],pages:[],keys:[]});
      const g=byPair.get(k); g.rows++;
      if(tab){ g.tabs.push(RL_TAB[tab]||tab); g.keys.push(tab); }
      if(typeof page==="number")g.pages.push(page);
      const sx=_rlSector(sector); if(sx)g.secs.push(sx);
    };
    (A.designSummary||[]).forEach(r=>{ if(!r.struck&&!r.inserted)noteModel(r.type,r.origModel,r.model,"designSummary",r.sector,r.page); });
    (A.equipmentCalc||[]).forEach(r=>{ if(!r.struck)noteModel(r.type,r.origModel,r.model,"equipmentCalc",r.sector,r.page); });
    if(rf&&rf.columns&&rf.rows){
      const mc=rfModelCol(rf.columns);
      const tc=rf.columns.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
      if(mc)rf.rows.forEach(r=>{ if(r.inserted||r.struck)return;
        noteModel(tc?r.cells[tc]:"",(r._orig&&r._orig[mc])||"",r.cells[mc],"rfInventory",rfRowSector(r,rf.columns),r.page); });
    }
    if(ecT&&ecT.columns&&ecT.rows){
      const mc=rfModelCol(ecT.columns);
      const tc=ecT.columns.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
      if(mc)ecT.rows.forEach(r=>{ if(r.struck)return;
        noteModel(tc?r.cells[tc]:"",(r._orig&&r._orig[mc])||"",r.cells[mc],"equipmentCalc",rfRowSector(r,ecT.columns),r.page); });
    }
    /* An Antenna Position row carries no equipment TYPE — the page does not print one. The type is
       looked up from whichever tab does print it for that same model, so the line can say "panel
       antennas" rather than the generic "antennas". */
    const typeOfModel=m=>{
      const k=normModelKey(m); if(!k)return "ANTENNA";
      let t="";
      const scan=(mm,tt)=>{ if(!t&&normModelKey(mm)===k&&String(tt||"").trim())t=tt; };
      (A.designSummary||[]).forEach(r=>{ scan(r.model,r.type); scan(r.origModel,r.type); });
      (A.equipmentCalc||[]).forEach(r=>{ scan(r.model,r.type); scan(r.origModel,r.type); });
      [rf,ecT].forEach(T=>{ if(!T||!T.columns||!T.rows)return;
        const mc=rfModelCol(T.columns), tc=T.columns.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
        if(mc&&tc)T.rows.forEach(r=>{ scan(r.cells[mc],r.cells[tc]); scan(r._orig&&r._orig[mc],r.cells[tc]); }); });
      return t||"ANTENNA";
    };
    _rlAntKeys().forEach(k=>(A[k]||[]).forEach(r=>{
      if(!r.struck)noteModel(typeOfModel(r.model||r._orig_model),r._orig_model,r.model,k,r.secPos,r.page); }));
    /* 6eu — ONE LINE PER KIND OF EQUIPMENT, and no cap. Six lines named by pair and then "Actual model
       of 3 further item(s)" was the worst of both: longer than the corrections it listed, and it hid the
       rest behind a number you could do nothing with. What an engineer does with this line is walk to the
       squids — whether two of them changed or five. So the pairs are grouped by the equipment they belong
       to, the values are printed while there are one or two of them, and past that the group says how
       many there are. Nothing is dropped. */
    const byType=new Map();
    byPair.forEach(m=>{
      const key=_rlModelPhrase(m.type,m.n,false)||"equipment";
      if(!byType.has(key))byType.set(key,{type:m.type,rows:0,tabs:[],secs:[],keys:[],pairs:new Set()});
      const g=byType.get(key);
      g.rows+=m.rows; g.tabs.push(...m.tabs); g.secs.push(...m.secs); g.keys.push(...m.keys);
      g.pairs.add(m.n+" instead of "+m.o);
    });
    byType.forEach((g,phrase)=>{
      const tabs=[...new Set(g.tabs)];
      const uni=(tabs.indexOf(RL_TAB.antennaPosition)>=0)?uAnt:(tabs.indexOf(RL_TAB.rfInventory)>=0?uRf:uDs);
      /* 6cw — as short as it can be said: one row on one tab needs no sector, and reads in the singular. */
      const one=(g.rows<=1);
      /* 6cy — a correction that reaches several tabs names none of them: the same model changed
         everywhere it appears is one fact. One tab still names its tab. */
      add(_rlLine("Actual model of "+(one?_rlModelPhrase(g.type,"",true):phrase),
        {sector:one?"":_rlSecPhrase(g.secs,uni),pair:_rlPairList(g.pairs),
         where:(tabs.length===1?tabs[0]:"")}),
        g.keys[0]||"designSummary");
    });

    /* --- the antenna fields: ONE line per field, whichever sectors it happened in --- */
    const antG=new Map(); const abSec=[], abPos=[], abPg=[]; let ab=0;
    _rlAntKeys().forEach(k=>(A[k]||[]).forEach(r=>{
      if(r.struck)return;
      Object.keys(RL_ANT_FIELD).forEach(f=>{
        const o=String(r["_orig_"+f]==null?"":r["_orig_"+f]).trim();
        const n=String(r[f]==null?"":r[f]).trim();
        if(!n||n===o)return;
        const sec=_rlSector(r.secPos), pos=_rlPos(r.secPos);
        /* 6cm — no printed value means there is nothing to claim a correction AGAINST. Filling an empty
           as-built column is real work and folds into the one as-built line; anything else with a blank
           original is the tool completing a field, not an engineer correcting one, and is left out. */
        if(!o||/^[-‐-―−]+$/.test(o)){
          if(RL_ASBUILT.indexOf(f)>=0){ ab++; abSec.push(sec); abPos.push(pos); abPg.push(r.page); }
          return;
        }
        /* 6eu — an as-built field folds into the ONE as-built line and does not also get its own. The
           report used to say "Actual rad center (as-built) in A-1, B-1 and C-1 (…)" and then "Actual
           as-built values in every position" underneath it: the same work, described twice, and the
           second line is the one an engineer acts on. */
        if(RL_ASBUILT.indexOf(f)>=0){ ab++; abSec.push(sec); abPos.push(pos); abPg.push(r.page); return; }
        if(!antG.has(f))antG.set(f,{f,secs:[],pos:[],pairs:new Set(),pages:[],n:0});
        const g=antG.get(f); g.n++; g.secs.push(sec); if(pos)g.pos.push(pos);
        g.pairs.add(_rlUnit(f,n)+" instead of "+_rlUnit(f,o)); g.pages.push(r.page);
      });
    }));
    /* 6eu — no slice (eleven fields in all, and a cap here could only drop a real correction silently),
       and FIELDS THAT SHARE A PHRASE SHARE A LINE. Four lines reading "Actual rad center in every
       position (6 different values)", "Actual tip height in every position (6 different values)" … say
       one thing four times. A field with one or two values keeps its own line, because those values are
       the point of it; a field that can only report a COUNT of values has nothing left to distinguish it,
       so those merge into one line per place: "Actual rad center, tip height, azimuth and mechanical
       downtilt in every position on Antenna Position". Nothing is lost — the values were already not
       being printed. */
    const antBulk=new Map();
    [...antG.values()].forEach(g=>{
      const pair=_rlPairList(g.pairs);
      /* the position if the rows carry one, the sector only as a fallback */
      const who=_rlPosPhrase(g.pos,uPos)||_rlSecPhrase(g.secs,uAnt);
      if(g.pairs.size>2){
        if(!antBulk.has(who))antBulk.set(who,[]);
        antBulk.get(who).push(RL_ANT_FIELD[g.f]);
        return;
      }
      add(_rlLine("Actual "+RL_ANT_FIELD[g.f],{sector:who,pair,
        where:RL_TAB.antennaPosition,pages:g.pages}),"antennaPosition");
    });
    antBulk.forEach((fields,who)=>{
      add(_rlLine("Actual "+_rlJoin(fields,4,"fields"),
        {sector:who,where:RL_TAB.antennaPosition}),"antennaPosition");
    });
    if(ab)add(_rlLine("Actual as-built values",
      {sector:_rlPosPhrase(abPos,uPos)||_rlSecPhrase(abSec,uAnt),
       where:RL_TAB.antennaPosition,pages:abPg}),"antennaPosition");

    /* --- port level --- */
    try{
      const plv=portLevelCheck();
      if(plv.have&&plv.mismatch.length){
        const pg=new Map(), uPort=plv.rows.map(x=>_rlPos(x.secPos));
        plv.mismatch.forEach(m=>{
          const f=(m.field==="vendor")?"vendor":"model";
          if(!pg.has(f))pg.set(f,{f,secs:[],pos:[],pairs:new Set(),pages:[]});
          const g=pg.get(f); g.secs.push(_rlSector(m.secPos));
          const p2=_rlPos(m.secPos); if(p2)g.pos.push(p2);
          if(typeof m.page==="number")g.pages.push(m.page);
          if(m.correct)g.pairs.add(String(m.correct)+" instead of "+String(m.printed));
        });
        [...pg.values()].forEach(g=>{
          const pair=_rlPairList(g.pairs);
          add(_rlLine("Actual antenna "+g.f,
            {sector:_rlPosPhrase(g.pos,uPort)||_rlSecPhrase(g.secs,uAnt),pair,
             where:RL_TAB.portLevel,pages:g.pages}),"portLevel");
        });
      }
    }catch(e){}

    /* --- struck and added, per tab --- */
    const struckT=[], addedT=[], struckS=[], addedS=[];
    ["designSummary","equipmentCalc"].concat(_rlAntKeys()).forEach(k=>
      (A[k]||[]).forEach(r=>{
        const sx=_rlSector(r.sector!=null?r.sector:r.secPos);
        if(r.struck){ struckT.push(RL_TAB[k]); if(sx)struckS.push(sx); }
        if(r.inserted){ addedT.push(RL_TAB[k]); if(sx)addedS.push(sx); } }));
    [["rfInventory",rf],["equipmentCalc",ecT],["portLevel",A.portLevel]].forEach(([k,T])=>{
      if(T&&T.rows)T.rows.forEach(r=>{
        const sx=_rlSector(rfRowSector(r,T.columns));
        if(r.struck){ struckT.push(RL_TAB[k]); if(sx)struckS.push(sx); }
        if(r.inserted){ addedT.push(RL_TAB[k]); if(sx)addedS.push(sx); } }); });
    if(struckT.length)add(_rlLine("Equipment removed from the design struck through",
      {sector:_rlJoin(struckS),where:_rlJoin(struckT,2)}),"designSummary");
    if(addedT.length)add(_rlLine("Equipment added to the design",
      {sector:_rlJoin(addedS),where:_rlJoin(addedT,2)}),"designSummary");
    /* --- the label/value pages --- */
    ["rfdsDetails","siteDetails"].forEach(k=>{
      const changed=(A[k]||[]).filter(r=>String(r.value||"").trim()!==String(r.printed||"").trim());
      if(!changed.length)return;
      const names=changed.map(r=>String(r.label||"").trim()).filter(Boolean);
      add(_rlLine("Actual "+(names.length?_rlJoin(names,3,"fields"):"values"),
        {where:RL_TAB[k],pages:changed.map(r=>r.page)}),k);
    });
  }
  /* --- anything drawn by hand: the analysis cannot know about these --- */
  const manual=(S.annos||[]).filter(a=>!a.fromAnalyze).length+(S.lines||[]).filter(l=>!l.fromAnalyze).length;
  if(manual)add(manual+" redline"+(manual===1?"":"s")+" added by hand","_manual");
  /* stable sort: tab order first, then the order the checks produced them */
  L.sort((a,b)=>(a.o-b.o)||(a.i-b.i));
  return L.map(x=>x.t);
}
function redlineReportText(){
  /* 6cu — Copy gives you the REPORT: the lines, nothing else. The site name and the "N redlines on the
     document" heading are on screen for you, not for the email you are pasting this into. */
  const L=buildRedlineReport();
  if(!L.length)return "No redlines yet. Analyze the RFDS and stamp your corrections first.";
  return L.join("\n");
}
function openRedlineReport(){
  const m=document.getElementById("reportModal"); if(!m)return;
  const body=document.getElementById("reportBody");
  const L=buildRedlineReport();
  body.innerHTML="";
  const marks=(S.annos||[]).length+(S.lines||[]).length;
  body.appendChild(el("div","az-secn",
    marks?("<b>"+marks+"</b> redline"+(marks===1?"":"s")+" on this document. Each line below is one kind of correction — this is the summary you paste into an email or a task note."):
          "Nothing has been redlined yet."));
  if(L.length){
    const ul=el("ul","rl-list");
    L.forEach(t=>ul.appendChild(el("li",null,escapeHtml(t))));
    body.appendChild(ul);
  }
  m.classList.add("show");
}
(function(){
  const b=document.getElementById("reportBtn"); if(b)b.onclick=openRedlineReport;
  const c=document.getElementById("reportClose");
  if(c)c.onclick=()=>document.getElementById("reportModal").classList.remove("show");
  const m=document.getElementById("reportModal");
  if(m)m.onclick=e=>{ if(e.target===m)m.classList.remove("show"); };
  const cp=document.getElementById("reportCopy");
  if(cp)cp.onclick=()=>copyText(redlineReportText(),"Redline report");
})();
/* ================================================================================================
   6cg — Port Level Details (Final), checked against Antenna Position.
   ------------------------------------------------------------------------------------------------
   The two pages describe the same antennas from different angles: Antenna Position gives one model per
   Sec-Pos, Port Level lists the ports of those same antennas and repeats the model on every row. When an
   antenna is swapped, one of the two pages routinely gets missed, and the port page keeps naming the old
   unit. Sec-Pos is the join between them.

   Read from the page geometry — no AI — like every other section since 6cf. Read-only in the sense that
   Antenna Position is the authority: a mismatch redlines the PORT LEVEL cell with the Antenna Position
   model, never the other way round.
   ================================================================================================ */
function normSecPos(v){ return String(v==null?"":v).toUpperCase().replace(/[^A-Z0-9]/g,""); }
function prettySecPos(v){
  const k=normSecPos(v); const m=k.match(/^([A-Z]+)(\d+)$/);
  return m?(m[1]+"-"+m[2]):(String(v||"").trim()||k);
}
function portSecPosCol(cols){
  const list=cols||[];
  return list.find(c=>/sec\W*pos/i.test(String(c)))
      || list.find(c=>/^position$/i.test(String(c).trim()))
      || list.find(c=>/antenna\s*position|ant\W*pos/i.test(String(c)))
      || list.find(c=>/^sector$/i.test(String(c).trim()))
      || null;
}
function readPortLevelFromGeometry(pages){
  const HDR=l=>{
    const n=l.norm;
    if(n.indexOf("model")<0)return false;
    let s=0; ["secpos","position","port","technology","band","sector","antenna","carrier","tilt"]
      .forEach(k=>{ if(n.indexOf(k)>=0)s++; });
    return s>=1;
  };
  const SKIP=/^(sec|pos|secpos|position|port|model|technology|band|sector|antenna|carrier|tilt|no|item)+$/;
  const t=readTableByCell(pages,HDR,SKIP);
  if(!t.rows.length)LOG("Port Level: no rows read — check the header row on those pages");
  else LOG("Port Level read from geometry: "+t.rows.length+" row(s), columns: "+t.columns.join(" | "));
  return t;
}

/* Antenna Position is the authority. One entry per Sec-Pos. */
function antennaBySecPos(){
  const A=S.analysis, m=new Map();
  ((A&&A.antennaPosition)||[]).forEach(r=>{
    if(r.struck)return;
    const k=normSecPos(r.secPos); if(!k)return;
    if(!m.has(k))m.set(k,{secPos:r.secPos,model:String(r.model||"").trim(),
                          vendor:String(r.vendor||"").trim(),page:r.page});
  });
  return m;
}
/* Compare, and say per row what should be written where. */
/* which field of a port row is being compared — 6ci added Vendor alongside Model */
function portVendorCol(cols){
  const list=cols||[];
  return list.find(c=>/^vendor$/i.test(String(c).trim()))
      || list.find(c=>/vendor|manufacturer|make/i.test(String(c)))
      || null;
}
function portLevelCheck(){
  const A=S.analysis;
  const T=A&&A.portLevel;
  const out={have:false,rows:[],mismatch:[],orphan:[],unmatched:[],skipped:[],ant:antennaBySecPos()};
  if(!T||!T.columns||!T.rows||!T.rows.length)return out;
  const sc=portSecPosCol(T.columns), mc=rfModelCol(T.columns), vc=portVendorCol(T.columns);
  if(!sc||!mc){ LOG("Port Level: need a Sec-Pos column and a Model column — found "+T.columns.join(" | ")); return out; }
  out.have=true; out.secCol=sc; out.modelCol=mc; out.vendorCol=vc;
  /* `portLevelCheck` runs on every render, so this note has to be said once per read, not once per call */
  if(!vc&&!T._noVendLogged){ T._noVendLogged=true;
    LOG("Port Level: no Vendor column on this page — only the model is checked"); }
  const seen=new Set();
  T.rows.forEach((r,i)=>{
    if(r.struck)return;
    const rawSp=String((r.cells&&r.cells[sc])||"");
    /* 6ck — "(D)" on a Sec-Pos marks it decommissioned. It is not part of the final build, so comparing it
       against Antenna Position produces a mismatch for kit that is being removed, and redlining it would
       write the new antenna onto a row about the old one. Skipped, and counted so the band can say so. */
    if(/\(\s*D\s*\)/i.test(rawSp)){ out.skipped.push(prettySecPos(rawSp.replace(/\(\s*D\s*\)/ig,""))); return; }
    const sp=normSecPos(rawSp);
    const pm=String((r.cells&&r.cells[mc])||"").trim();
    if(!sp)return;
    seen.add(sp);
    const a=out.ant.get(sp);
    const pv=vc?String((r.cells&&r.cells[vc])||"").trim():"";
    const rec={i,row:r,page:r.page,secPos:prettySecPos(r.cells[sc]),key:sp,portModel:pm,portVendor:pv,
               antModel:a?a.model:null,antVendor:a?a.vendor:null,antPage:a?a.page:null};
    if(!a){ out.orphan.push(rec); out.rows.push(rec); return; }
    /* the same tolerance the checklist uses: separators do not make it a different antenna */
    rec.ok = !!pm && !!a.model && discLooseKey(pm)===discLooseKey(a.model);
    if(!rec.ok)out.mismatch.push(Object.assign({},rec,{field:"model",col:mc,
      printed:pm,correct:a.model,label:"Model"}));
    /* 6ci — the vendor too. Only when both pages print one, and only when they really differ:
       "ANDREW/COMMSCOPE" against "ANDREW / COMMSCOPE" is the same company. */
    if(vc&&pv&&a.vendor&&discLooseKey(pv)!==discLooseKey(a.vendor)){
      rec.vendorOk=false;
      out.mismatch.push(Object.assign({},rec,{field:"vendor",col:vc,
        printed:pv,correct:a.vendor,label:"Vendor"}));
    } else rec.vendorOk=true;
    out.rows.push(rec);
  });
  out.ant.forEach((v,k)=>{ if(!seen.has(k))out.unmatched.push({key:k,secPos:v.secPos,model:v.model}); });
  /* 6el — a disagreement that has already been REDLINED is not the same finding as one that has not.
     Ced's Port Level page carries corrections he has stamped; the card kept calling those rows
     "disagrees", which reads as outstanding work on a row that is done. Each mismatch is asked whether a
     mark sits on its cell, and the ones that do are reported as "disagrees but redlined", in orange.
     The check is geometric on purpose: a mark stamped by Apply records the cell it went on (`cx0`/`cy0`),
     but a mark drawn by hand records nothing, and a correction is a correction either way. */
  out.mismatch.forEach(m=>{ m.redlined=portCellRedlined(m); });
  out.redlined=out.mismatch.filter(m=>m.redlined);
  out.open=out.mismatch.filter(m=>!m.redlined);
  return out;
}
/* Is there a redline over the cell this mismatch is about? */
function portCellRedlined(m){
  if(!m||m.page==null)return false;
  const box=(m.row&&m.row._g&&m.col)?m.row._g[m.col]:null;
  if(!box)return false;
  const bx1=box.nx, bx2=(box.x2!=null?box.x2:box.nx+0.02);
  const by1=box.ny, by2=(box.y2!=null?box.y2:box.ny+((box.nh||0.011)));
  return (S.annos||[]).some(a=>{
    if(!a||a.page!==m.page||a.kind==="img")return false;
    /* the fast, exact answer for a mark Apply put there */
    if(a.fromAnalyze&&a.cx0!=null&&a.cy0!=null
       &&Math.abs(a.cx0-box.nx)<0.006&&Math.abs(a.cy0-box.ny)<0.006)return true;
    /* and the honest one for anything else: does it actually sit over the cell? */
    const ax2=a.nx+(a.nw||0), ay2=a.ny+(a.nh||0.011);
    const ox=Math.min(ax2,bx2)-Math.max(a.nx,bx1);
    const oy=Math.min(ay2,by2)-Math.max(a.ny,by1);
    if(!(ox>0&&oy>0))return false;
    /* it has to cover a real part of the cell, not clip a corner of it */
    return (ox*oy) > 0.35*Math.max(1e-9,(bx2-bx1)*(by2-by1));
  });
}
function readRfFromGeometry(pages){
  const HDR=l=>{
    const n=l.norm;
    let s=0; ["secpos","equipmenttype","vendor","model","status","technology","linkedcells","commonname","cascaded","rrhposition","configuration","usid","sidehaul"].forEach(k=>{ if(n.indexOf(k)>=0)s++; });
    return s>=3;
  };
  const SKIP=/^(sec|pos|equipment|type|vendor|model|linked|cells|technology|rrh|position|cascaded|from|cpri|info|common|name|status|configuration|usid|sidehaul)+$/;
  const t=readTableByCell(pages,HDR,SKIP);
  if(!t.rows.length) LOG("⚠ RF Inventory: no rows read — check the header detection above");
  return t;
}
/* the printed item behind a stored cell position (so coverage geometry still applies) */
/* Capture the on-page position of every editable cell of every Design Summary row, plus the two
   summary tables, ONCE at analysis time. Apply then writes straight to a stored position instead of
   re-deriving it by matching text — which is what made counts land on the wrong row (or nowhere). */
function pageItemAt(pi,g){ return rfItemAt(pi,g); }
function dsTypeOfRow(row){
  const opts=TYPE_OPTIONS.slice().sort((a,b)=>b.length-a.length);   // longest first: IAR before ANTENNA
  for(const o of opts){ if(typeAliases(o).some(a=>row.norm.indexOf(a)>=0)) return o; }
  return null;
}
function captureDsGeometry(dsPages,rows){
  const T=buildDsTables(dsPages);
  const pos=it=>it?{nx:it.nx,ny:it.ny,nw:it.nw||0,nh:it.nh||0}:null;
  const nearest=(items,cx)=>{ if(cx==null)return null; let best=null,bd=1e9;
    items.forEach(t=>{ const c=t.nx+(t.nw||0)/2; const d=Math.abs(c-cx); if(d<0.07&&d<bd){bd=d;best=t;} });
    return best; };
  const used=new Set();
  /* the column each named field lives in, from the header centres */
  const dsBounds=(function(){
    const c=T.detail&&T.detail.cols; if(!c)return null;
    const keys=["sector","type","model","existing","removal","addition","final"];
    const have=keys.filter(k=>c[k]!=null).sort((a,b)=>c[a]-c[b]);
    if(have.length<2)return null;
    const out={};
    have.forEach((k,i)=>{
      const lo=(i===0)?Math.max(0,c[k]-(c[have[1]]-c[k])/2):(c[have[i-1]]+c[k])/2;
      const hi=(i===have.length-1)?Math.min(1,c[k]+(c[k]-c[have[i-1]])/2):(c[k]+c[have[i+1]])/2;
      out[k]=[lo,hi];
    });
    return out;
  })();
  let ok=0,miss=0;
  (rows||[]).forEach(r=>{
    if(r.inserted)return;
    /* Rows read straight off the page already carry exact positions. Re-deriving them by matching model
       text could hand two similar models ("AIRSCALE DUAL RRH 4T4R…" vs "AIRSCALE RRH 4T4R B5…") the same
       printed row — one then took the other's cell and the second redline was dropped as a duplicate. */
    if(r._bind==="geometry"&&r._g&&(r._g.existing||r._g.final)&&typeof r._page==="number"){ ok++; return; }
    const M=r.origModel||r.model, sec=normSector(r.origSector!=null?r.origSector:r.sector);
    const g=T.detail.rows.find(x=>!used.has(x)&&dsRowMatchesModel(x,M)&&dsRowSec(x)===sec)
         || T.detail.rows.find(x=>!used.has(x)&&dsRowMatchesModel(x,M));
    if(!g){ miss++; LOG("DS geometry: no row for",sec,M); return; }
    used.add(g);
    const cnt=countCellsOf(g.items,false);
    const G={};
    ["existing","removal","addition","final"].forEach((k,i)=>{ if(cnt[i])G[k]=pos(cnt[i]); });
    G.sector=pos(g.items[0]);
    const mk=normModelKey(M);
    G.model=pos(g.items.find(t=>{const s=normModelKey(t.str); return s.length>2&&mk.indexOf(s)>=0;})||g.items[1]||g.items[0]);
    if(T.detail.cols) G.type=pos(nearest(g.items,T.detail.cols.type));
    /* 6da — and each cell's COLUMN, cut halfway between the header centres, so a Design Summary redline
       wraps and centres by the same rule as every other tab (6cx gave the other two readers this). */
    if(dsBounds){
      Object.keys(G).forEach(k=>{ const b2=dsBounds[k]; if(G[k]&&b2){ G[k].colL=b2[0]; G[k].colR=b2[1]; } });
    }
    r._g=G; r._page=g.pi; ok++;
  });
  /* the two derived tables, keyed so apply can find them without matching text again */
  const geo={bySector:{},bySite:{}};
  [["bySector",T.bySector],["bySite",T.bySite]].forEach(([key,tbl])=>{
    tbl.rows.forEach(x=>{
      const ty=dsTypeOfRow(x); if(!ty)return;
      const cnt=countCellsOf(x.items,key==="bySite");
      if(cnt.length<4)return;
      const G={pi:x.pi, printed:{}};
      ["existing","removal","addition","final"].forEach((k,i)=>{
        G[k]=pos(cnt[i]);
        const v=parseInt(String(cnt[i].str).replace(/[^\d-]/g,""),10);
        G.printed[k]=isNaN(v)?null:v;
      });
      const id=(key==="bySector")?(dsRowSec(x)+"|"+ty):ty;
      if(!geo[key][id]) geo[key][id]=G;
    });
  });
  LOG(`DS geometry: ${ok} detail row(s) positioned, ${miss} unmatched · bySector ${Object.keys(geo.bySector).length} · bySite ${Object.keys(geo.bySite).length}`);
  return geo;
}
/* Locate an RF row on the page by its FIRST-COLUMN key (Sec-Pos). Several rows share a key, so the
   row's occurrence index is used: the nth "A-3" going down the page is the nth A-3 row. Gives a y for
   the row even when a cell's own position was never captured. */
function rfRowYByKey(pi,key,idx){
  if(!S.pages[pi]||!key)return null;
  const k=String(key).trim(); if(!k)return null;
  const hits=S.pages[pi].items.filter(t=>String(t.str).trim()===k).sort((a,b)=>a.ny-b.ny);
  if(!hits.length)return null;
  const it=hits[Math.min(idx==null?0:idx,hits.length-1)];
  return it?(it.ny+(it.nh||0)/2):null;
}
function rfItemAt(pi,g){
  if(!S.pages[pi]||!g)return null;
  let best=null,bd=1e9;
  S.pages[pi].items.forEach(t=>{ const d=Math.abs(t.nx-g.nx)+Math.abs(t.ny-g.ny); if(d<bd){bd=d;best=t;} });
  return bd<0.02?best:null;
}
/* Dump every RF row: what the page printed against what the grid holds now, per cell. Use the
   "⚑ Audit RF" button on the tab (or rfAudit() from the console) — it writes to the message log, so one
   Copy from ▤ Log shows exactly which rows drifted from the page and in which columns. */
/* Everything the RF Inventory apply decides from, as text. Copy it out and it can be replayed exactly —
   which is what a failure I cannot reproduce here needs. */
function rfDiagnostics(){
  const A=S.analysis, RF=A&&A.rfInventory;
  const L=[];
  L.push("=== RFDS redline diagnostics ===");
  L.push("pages: "+S.pages.length+"  locked: "+S.pages.map((p,i)=>p.locked?(i+1):null).filter(x=>x).join(",")
        +"  dropped: "+S.pages.map((p,i)=>p.dropped?(i+1):null).filter(x=>x).join(","));
  L.push("sections: "+JSON.stringify(A&&A.pagesFor||{}));
  L.push("link flags: "+JSON.stringify(_linkModels)+"  skipRedline: "+JSON.stringify([..._skipRedline]));
  L.push("model corrections: "+JSON.stringify((A&&A._modelFix)||{}));
  if(!RF||!RF.rows){ L.push("no RF Inventory rows"); }
  else{
    L.push("columns: "+JSON.stringify(RF.columns||[]));
    L.push("colX: "+JSON.stringify(RF.colX||{}));
    (RF.rows||[]).forEach((r,i)=>{
      L.push("-- row "+i+" page "+((r.page||0)+1)+" key="+JSON.stringify(r._key||"")+"#"+(r._keyIdx||0)
        +" sec="+rfRowSector(r,RF.columns)+" y="+(r._y!=null?r._y.toFixed(4):"null")
        +(r.inserted?" INSERTED":"")+(r.struck?" STRUCK":"")
        +(r._ownFix!=null?(" ownFix="+JSON.stringify(r._ownFix)):"")+(r._linked?" linked":""));
      (RF.columns||[]).forEach(c=>{
        const was=String((r._orig&&r._orig[c])!=null?r._orig[c]:"");
        const now=String(r.cells[c]!=null?r.cells[c]:"");
        const g=r._g&&r._g[c];
        if(was!==now||g)L.push("     "+c+": "+JSON.stringify(was)+" -> "+JSON.stringify(now)
          +(g?("  box "+g.nx.toFixed(4)+","+g.ny.toFixed(4)+" -> "+
               String(g.x2!=null?g.x2.toFixed(4):"?")+","+String(g.y2!=null?g.y2.toFixed(4):"?")
               +" lines="+(g.lines||1)+(g.topR!=null?(" topR="+g.topR.toFixed(4)):"")):"  NO BOX"));
      });
    });
  }
  L.forEach(x=>LOG(x));
  return L.join("\n");
}
function rfAudit(){
  const A=S.analysis, RF=A&&A.rfInventory;
  if(!RF||!RF.rows||!RF.rows.length){ LOG("rfAudit: no RF Inventory rows"); return []; }
  const cols=RF.columns||[];
  const out=[];
  RF.rows.forEach((r,i)=>{
    const diffs=[];
    cols.forEach(c=>{
      const was=String((r._orig&&r._orig[c])!=null?r._orig[c]:"").trim();
      const now=String(r.cells[c]!=null?r.cells[c]:"").trim();
      if(was!==now)diffs.push(c+': "'+was+'" -> "'+now+'"');
    });
    const key=cols.length?String(r.cells[cols[0]]||"").trim():"";
    const line="row "+i+" p"+((r.page||0)+1)+" "+key+" sec="+rfRowSector(r,cols)
      +(r.inserted?" INSERTED":"")
      +(r._ownFix!=null?(" ownFix="+r._ownFix):"")
      +(r._linked?" linked":"")
      +(diffs.length?(" || "+diffs.join(" || ")):" (unchanged)");
    out.push(line); LOG(line);
  });
  LOG("rfAudit: model corrections on file =",JSON.stringify(A._modelFix||{}));
  LOG("rfAudit: link flags =",JSON.stringify(_linkModels));
  return out;
}
function rfRowChanged(r,cols){
  if(r.struck)return true;
  const list=cols&&cols.length?cols:Object.keys(r.cells||{});
  return list.some(c=>String(r.cells[c]||"").trim()!==String(r._orig&&r._orig[c]!=null?r._orig[c]:"").trim());
}
let _antSub="final";   // active Antenna sub-tab (final / existing / decom)
const _skipRedline=new Set(["antennaExisting","antennaDecom"]);   // sections excluded from Apply (Existing/Decom antenna never auto-redline)
function currentRedlineKey(){
  if(_azTab==="detection"||_azTab==="discrepancies") return null;   // read-only views
  if(_azTab==="antennaPosition") return _antSub==="existing"?"antennaExisting":(_antSub==="decom"?"antennaDecom":"antennaPosition");
  if(_azTab==="rfdsDetails"||_azTab==="siteDetails") return _azTab;
  return _azTab;
}
const SEC_ORDER=["A","B","C","D","E","F"];
function secClass(s){ const v=String(s||"").toUpperCase();
  return SEC_ORDER.indexOf(v)>=0 ? ("sec-"+v) : (v==="SITE"?"sec-SITE":"sec-none"); }
function secLabel(s){ const v=String(s||"").toUpperCase();
  if(SEC_ORDER.indexOf(v)>=0) return greek(v)+" ("+v+")";
  if(v==="SITE") return "Site";
  return (s&&s!=="—")?String(s):"Unsectored";
}
/* one tinted sub-tab bar for any sector-grouped pane */
function sectorTabBar(sectors,current,onPick,counts){
  const bar=el("div","az-tabs sub"); bar.style.cssText="padding:0;margin-bottom:10px";  /* 6fk — the rule
     that was inline here could not be reached by the emboss: an inline style beats every selector.
     `.az-tabs.sub` draws it as a groove instead. */
  sectors.forEach(s=>{
    const b=el("button","az-tab sec "+secClass(s)+(s===current?" active":""),
      `<span class="sdot"></span>${escapeHtml(secLabel(s))}${counts&&counts[s]!=null?` <span class="pip">${counts[s]}</span>`:""}`);
    b.onclick=()=>onPick(s);
    bar.appendChild(b);
  });
  return bar;
}
function sectorAccent(s,text){
  const d=el("div","az-secbar "+secClass(s), `<span class="sdot"></span><span>${escapeHtml(text)}</span>`);
  return d;
}
function greek(sec){ return ({A:"Alpha",B:"Beta",C:"Gamma",D:"Delta",E:"Epsilon",F:"Zeta"})[sec]||("Sector "+sec); }

/* ---------- undo / redo ---------- */
function _cleanA(a){ return { id:a.id, page:a.page, nx:a.nx, ny:a.ny, nw:a.nw, text:a.text, orig:a.orig, align:a.align, size:a.size, kind:a.kind, src:a.src, nh:a.nh, lineNh:a.lineNh, wrap:a.wrap, lines:a.lines, alignSet:a.alignSet, alignUser:a.alignUser, onCell:a.onCell, nowrap:a.nowrap, fullcell:a.fullcell, cw:a.cw, tx0:a.tx0, cellL:a.cellL, cellR:a.cellR, manualW:a.manualW, group:a.group, rot:a.rot, z:a.z, under:a.under, fromAnalyze:a.fromAnalyze, cx0:a.cx0, cy0:a.cy0, colCentred:a.colCentred, textDx:a.textDx, pLines:a.pLines }; }
function _cleanL(l){ return { id:l.id, page:l.page, x1:l.x1, y1:l.y1, x2:l.x2, y2:l.y2, group:l.group, fromAnalyze:l.fromAnalyze }; }
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
function saveKey(){ return "rfds_autosave:"+docKey(); }
function verKey(){ return "rfds_versions:"+docKey(); }
/* what this document would have been keyed as before 6fy, so work saved then is still offered */
function legacyKeys(kind){
  const out=[];
  if(S.name)out.push("rfds_"+kind+":"+S.name);
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
      (pfx==="rfds_versions:"?vers:autos).push({k:k,ts:_tsOf(raw)});
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
const SAVE_PREFIXES=["rfds_autosave:","rfds_versions:"];
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
function autosave(){
  if(!S.doc)return;
  clearTimeout(_saveT);
  _saveT=setTimeout(async()=>{
    const r=await saveObj(saveKey(), savePayload());
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
  },500);
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
window.addEventListener("error",e=>setStatus("Error: "+(e.message||e.error),true));

/* ---------- night / day mode ---------- */
const THEME_KEY="rfds_theme";
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
       every one of them at once. The modal is measured on .az-box rather than on #analyzeModal, whose
       own background is the scrim. */
    const more={};
    /* 6gl — AND THE QUICK BAR IS ONE OF THEM. Ced: "fix the neumorphism of mini bar in day mode of
       ontel theme too, the shadow is in day mode when it is dark." Exactly right, and the bar was the
       one piece of furniture 6fj's list forgot: it is painted from the BAND like the ribbon, but it was
       never measured, so it inherited <html>'s pair — the PAGE's. Under Ontel day the page is light and
       the band is dark, so the bar was lit as though it were a pale surface: a highlight brighter than
       the bar itself and a shadow that vanished into it. Measuring it puts it on the same footing as
       the ribbon, and it costs one entry in this list rather than a rule of its own. */
    [["rail","aside#rail"],["banner","#detectBanner"],["analyze","#analyzeModal .az-box"],
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
  const go=await uiConfirm({title:"Close this RFDS?",
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
/* ---------- 6fq — the Transfer Redlines dialog ---------- */
let _tfPre=null, _tfFin=null, _tfPlan=null, _tfBusy=false;
/* the marks the transfer could not place with confidence, by id. Kept OUT of the marks themselves so an
   undo cannot silently clear the flags and an export cannot carry them into the PDF — it is a review
   state for this session, and the report is the record. */
let _tfFlagged=new Set();
const $tf=id=>document.getElementById(id);
function openTransfer(){
  _tfPre=null; _tfFin=null; _tfPlan=null;
  ["xferPrelim","xferFinal"].forEach(k=>{ const el=$tf(k); if(el)el.value=""; });
  $tf("xferPrelimName").textContent="drop a PDF here, or click to choose";
  $tf("xferFinalName").textContent="drop a PDF here, or click to choose";
  document.querySelectorAll("#xferModal .xf-slot").forEach(e=>e.classList.remove("set"));
  $tf("xferReport").innerHTML="";
  $tf("xferNote").textContent="";
  $tf("xferGo").disabled=true;
  /* 6fs — the open document is named ONCE, in a line of its own, and the buttons beside it say which
     ROLE it would fill. 6fr put its name on both buttons, so a document called "Final RFDS" produced a
     button reading "use Final RFDS" inside the PRELIMINARY slot. */
  const have=!!S.docBytes, row=$tf("xferOpenRow");
  if(row){
    row.hidden=!have;
    const n=$tf("xferOpenName");
    if(n)n.textContent=(S.name||"the open document");
  }
  $tf("xferModal").classList.add("show");
  try{ syncEmbossSoon(); }catch(e){}
}
function closeTransfer(){ $tf("xferModal").classList.remove("show"); }
function _tfEsc(t){ return escapeHtml(String(t==null?"":t)); }
function tfRenderReport(plan){
  const box=$tf("xferReport");
  if(!plan){ box.innerHTML=""; return; }
  if(plan.err){
    box.innerHTML='<div class="az-empty">'+_tfEsc(plan.err)+'</div>';
    $tf("xferGo").disabled=true; return;
  }
  const same=plan.moves.filter(m=>m.how==="same").length;
  const onval=plan.moves.filter(m=>m.how==="value").length;
  const onrow=plan.moves.filter(m=>m.how==="row").length;
  const moved=plan.moves.filter(m=>m.how==="text").length;
  const weak=m=>m.how!=="same"&&m.how!=="text"&&m.how!=="value"&&m.how!=="row";
  const check=plan.moves.filter(m=>weak(m)||m.split).length;
  const splits=plan.moves.filter(m=>m.split&&!weak(m)).length;
  const rows=[];
  rows.push(["Pages", plan.prePages+" in the preliminary, "+plan.finPages+" in the final", ""]);
  rows.push(["Identical pages", String(plan.same),
             plan.same===plan.prePages
               ? '<span class="xf-k same">every page matches</span>'
               : (plan.changed?('<span class="xf-k moved">'+plan.changed+" changed</span>"):"")]);
  if(plan.gone)rows.push(["No counterpart", String(plan.gone),
             '<span class="xf-k check">those pages are not in the final</span>']);
  if(plan.added)rows.push(["New in the final", String(plan.added),
             '<span class="xf-k moved">pages the preliminary did not have</span>']);
  rows.push(["Redlines found", String(plan.moves.length), ""]);
  rows.push(["Land exactly where they were", String(same),
             same?'<span class="xf-k same">the page is unchanged</span>':""]);
  rows.push(["Follow their own row", String(onrow),
             onrow?'<span class="xf-k moved">the value changed, the row did not</span>':""]);
  rows.push(["Follow the value they cover", String(onval),
             onval?'<span class="xf-k moved">the row moved, the mark went with it</span>':""]);
  rows.push(["Follow the text around them", String(moved),
             moved?'<span class="xf-k moved">the page changed</span>':""]);
  if(splits)rows.push(["On a row the final has split", String(splits),
             '<span class="xf-k check">placed on the Design half, ringed</span>']);
  rows.push(["Need a look", String(check),
             check?'<span class="xf-k check">carried over and ringed</span>':'<span class="xf-k same">none</span>']);
  let html='<div class="az-sech">What the comparison found</div><table class="xf-tbl">'
    +"<tr><th>&nbsp;</th><th>&nbsp;</th><th>&nbsp;</th></tr>";
  rows.forEach(r=>{ html+="<tr><td>"+_tfEsc(r[0])+'</td><td class="n">'+_tfEsc(r[1])+"</td><td>"+r[2]+"</td></tr>"; });
  html+="</table>";

  /* the page map itself — what was read out of the two documents, before anything is transferred */
  const runs=plan.runs||[];
  if(runs.length){
    const span=(a,b)=>(a===b)?String(a+1):((a+1)+"\u2013"+(b+1));
    html+='<div class="az-sech">How the pages line up</div><table class="xf-tbl">'
      +"<tr><th>Preliminary</th><th>Final</th><th>&nbsp;</th></tr>";
    runs.forEach(r=>{
      const to=(r.b0<0)?"\u2014":span(r.b0,r.b1);
      const cls=(r.kind==="gone")?"check":(r.kind==="same"?"same":"moved");
      const say=(r.kind==="gone")?"no counterpart in the final"
              :(r.off?("shifted "+(r.off>0?"down ":"up ")+Math.abs(r.off)+" page"+(Math.abs(r.off)===1?"":"s")
                       +(r.kind==="changed"?", and changed":""))
                     :(r.kind==="same"?"unchanged":"changed in place"));
      html+="<tr><td>"+_tfEsc(span(r.a0,r.a1))+"</td><td>"+_tfEsc(to)
           +'</td><td><span class="xf-k '+cls+'">'+_tfEsc(say)+"</span></td></tr>";
    });
    html+="</table>";
  }
  if(check){
    const list=plan.moves.filter(m=>weak(m)||m.split).slice(0,12);
    html+='<div class="az-sech">The ones to check</div><table class="xf-tbl">'
      +"<tr><th>Page</th><th>What it says</th><th>Why</th></tr>";
    list.forEach(m=>{
      const what=m.isLine?"a line":(m.o.kind==="img"?"a photo":(m.o.text||m.o.orig||"a mark"));
      const why=m.how==="nopage"?"its page has no counterpart in the final"
              :(m.split&&!weak(m))?("the final splits this row into Design and As-Built; it is on the "
                                    +"Design half ("+_tfEsc(String(m.headFin||"").slice(0,30))+")")
              :m.how==="nearby"?("the text it was on is gone; it follows "+(m.on||"a nearby run"))
              :"nothing on the new page matches what it was placed over";
      html+="<tr><td class=\"n\">"+(m.page+1)+"</td><td>"+_tfEsc(String(what).slice(0,60))
           +"</td><td>"+_tfEsc(why)+"</td></tr>";
    });
    if(check>list.length)html+='<tr><td colspan="3">and '+(check-list.length)+" more</td></tr>";
    html+="</table>";
  }
  box.innerHTML=html;
  $tf("xferGo").disabled=false;
  $tf("xferNote").textContent=plan.moves.length+" redline(s) ready · "+check+" to check";
}
async function tfCompare(){
  if(!_tfPre||!_tfFin)return;
  if(_tfBusy)return;
  _tfBusy=true;
  $tf("xferGo").disabled=true;
  $tf("xferNote").textContent="Reading both documents…";
  $tf("xferReport").innerHTML='<div class="az-empty">Comparing every page…</div>';
  try{
    const a=await _tfPre.arrayBuffer(), b=await _tfFin.arrayBuffer();
    _tfPlan=await tfPlan(a,b);
    tfRenderReport(_tfPlan);
    LOG("Transfer: compared",_tfPlan.prePages||0,"page(s) against",_tfPlan.finPages||0,
        "—",(_tfPlan.same||0),"identical,",(_tfPlan.changed||0),"changed;",
        (_tfPlan.moves||[]).length,"redline(s)");
  }catch(e){
    _tfPlan=null;
    $tf("xferReport").innerHTML='<div class="az-empty">'+_tfEsc("That did not read: "+(e&&e.message||e))+"</div>";
    LOG("Transfer: compare failed —",e&&e.message);
  }
  $tf("xferNote").textContent=_tfPlan&&!_tfPlan.err?$tf("xferNote").textContent:"";
  _tfBusy=false;
}
async function tfRun(){
  if(!_tfPlan||_tfPlan.err||!_tfFin)return;
  const plan=_tfPlan;
  const out=tfApply(plan);
  closeTransfer();
  /* the FINAL becomes the open document, and then the marks go on it. loadPdf resets S.annos, so the
     order matters — this is the same order the reopen path uses. */
  await loadPdf(_tfFin);
  S.annos=out.annos; S.lines=out.lines;
  _tfFlagged=out.flagged;
  layoutAnnos(); drawAllLines(); updateRail(); updateCount(); refreshMarks&&refreshMarks();
  paintTransferFlags();
  autosave();
  const check=out.flagged.size;
  setStatus("Transferred "+(out.annos.length+out.lines.length)+" redline(s) onto the final"
    +(check?(" — "+check+" ringed in amber for you to check"):" — every one anchored"));
  LOG("Transfer: applied",out.annos.length,"mark(s) and",out.lines.length,"line(s);",check,"flagged");
  if(check)toast(check+" redline(s) need a look");
}
/* the amber ring, re-applied after any layout */
function paintTransferFlags(){
  if(!_tfFlagged||!_tfFlagged.size)return;
  document.querySelectorAll(".anno.tfcheck").forEach(e=>e.classList.remove("tfcheck"));
  _tfFlagged.forEach(id=>{
    const d=document.querySelector('.anno[data-id="'+id+'"]');
    if(d)d.classList.add("tfcheck");
  });
}
(function(){
  const b=$tf("transferBtn"); if(b)b.onclick=openTransfer;
  const c=$tf("xferClose"); if(c)c.onclick=closeTransfer;
  const g=$tf("xferGo"); if(g)g.onclick=tfRun;
  const m=$tf("xferModal");
  if(m)m.addEventListener("click",e=>{ if(e.target===m)closeTransfer(); });
  /* 6fr — one place that accepts a file, however it arrived: the picker, a drop, or the document that
     is already open. Everything else funnels through here so the three routes cannot drift apart. */
  const take=(which,f)=>{
    if(!f)return;
    if(f.type&&f.type!=="application/pdf"&&!/\.pdf$/i.test(f.name||"")){
      setStatus("That is not a PDF — Transfer Redlines needs two PDFs.",true); return;
    }
    if(which==="pre"){ _tfPre=f; $tf("xferPrelimName").textContent=f.name; }
    else { _tfFin=f; $tf("xferFinalName").textContent=f.name; }
    const slot=document.querySelector('#xferModal .xf-slot[data-slot="'+which+'"]');
    if(slot)slot.classList.add("set");
    if(_tfPre&&_tfFin)tfCompare();
  };
  window._tfTake=take;                       /* the drop handlers and the suite both use it */
  const pick=(inputId,which)=>{
    const el=$tf(inputId); if(!el)return;
    el.addEventListener("change",()=>{ const f=el.files&&el.files[0]; if(f)take(which,f); });
  };
  pick("xferPrelim","pre");
  pick("xferFinal","fin");

  /* DROP. Each slot takes one, and the dialog as a whole takes one too — a drop that misses the slot
     by a few pixels should not go to the browser, which would navigate away from the tool and lose
     whatever is open. */
  const stop=e=>{ e.preventDefault(); e.stopPropagation(); };
  document.querySelectorAll("#xferModal .xf-slot").forEach(slot=>{
    const which=slot.getAttribute("data-slot");
    ["dragenter","dragover"].forEach(t=>slot.addEventListener(t,e=>{ stop(e); slot.classList.add("over"); }));
    ["dragleave","dragend"].forEach(t=>slot.addEventListener(t,e=>{ stop(e); slot.classList.remove("over"); }));
    slot.addEventListener("drop",e=>{ stop(e); slot.classList.remove("over");
      const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
      take(which,f); });
  });
  const mm=$tf("xferModal");
  if(mm){
    ["dragenter","dragover"].forEach(t=>mm.addEventListener(t,e=>{ stop(e); mm.classList.add("over"); }));
    ["dragleave","dragend"].forEach(t=>mm.addEventListener(t,e=>{ stop(e); mm.classList.remove("over"); }));
    mm.addEventListener("drop",e=>{ stop(e); mm.classList.remove("over");
      const f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0];
      if(!f)return;
      /* which side? the empty one, and the preliminary first when both are empty */
      take(!_tfPre?"pre":(!_tfFin?"fin":"pre"), f); });
  }

  /* and the document already open, which is the commonest case for the preliminary: you have just
     finished marking it up */
  const useOpen=which=>()=>{
    if(!S.docBytes){ setStatus("No document is open to use.",true); return; }
    const name=(S.name||"document")+".pdf";
    try{ take(which,new File([S.docBytes.slice(0)],name,{type:"application/pdf"})); }
    catch(e){ setStatus("Could not use the open document — choose the file instead.",true); }
  };
  const up=$tf("xferUsePre"); if(up)up.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); useOpen("pre")(); });
  const uf=$tf("xferUseFin"); if(uf)uf.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); useOpen("fin")(); });
})();
function openPageOrg(){ renderPageOrg(); reflectLocked(); const m=$("#pageOrg"); if(m)m.classList.add("show"); }
(function(){
  const m=$("#pageOrg");
  const c=$("#pageOrgClose"); if(c)c.onclick=()=>m.classList.remove("show");
  if(m)m.onclick=e=>{ if(e.target===m)m.classList.remove("show"); };
  const all=$("#pageOrgAll"); if(all)all.onclick=()=>{ S.pages.forEach(p=>{ if(p)p.dropped=false; });
    renderPageOrg(); reflectDropped(); };
})();
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
const PAL_KEY="rfds.palette";            // index — kept, so a preference saved by an older build still loads
const PAL_ID_KEY="rfds.paletteId";       // id — survives the list being reordered
const THEME_MODE_KEY="rfds.themeMode";   // "dark" | "light" | "system"
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
/* 6fq — Transfer Redlines LEAVES the WIP group: the page-and-cell mapping it was waiting for is built
   and measured (see tfPlan / tfApply). Mirror from CDs and Apply CD findings stay. */
const WIP_TOOLS=["mirrorBtn","applyCdBtn"];
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
const CUSTOM_KEY="rfds.customPair";
const CUSTOM_LIST_KEY="rfds.customThemes";
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
const TUNE_KEY="rfds.themeTune";
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
        try{ localStorage.setItem("rfds.echoConsole",_echoConsole?"1":"0"); }catch(e){}
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
const BUILD_ID="RFDS-TOOL 6gy \u00b7 The quick bar takes the ribbon's edges at every column width, not only at the maximum";
/* Everything goes to the in-app log (▤ Log). Mirroring it to the browser console filled the host's console
   panel below the tool with our own messages — and printed the "%c" style prefix as literal text in viewers
   that do not implement it. Turn it back on from the log panel when a browser console is genuinely wanted;
   the choice is remembered. */
try{ _echoConsole=localStorage.getItem("rfds.echoConsole")==="1"; }catch(e){}
const LOG=(...a)=>{
  if(_echoConsole){ try{console.log("%c[RFDS]","color:#3A8BD5;font-weight:bold",...a);}catch(e){} }
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

async function loadPdf(file){
  try{
    if(typeof pdfjsLib==="undefined"){setStatus("PDF library failed to load — check network.",true);return;}
    if(file.type!=="application/pdf"){setStatus("Please choose a PDF.",true);return;}
    S.name=file.name.replace(/\.pdf$/i,"");
    setStatus("Starting…");
    await ensureWorker();
    setStatus("Reading PDF…");
    const buf=await file.arrayBuffer();
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
    S.doc=await pdfjsLib.getDocument({data:(base===buf)?buf:base.slice(0)}).promise;
    S.pages=[]; S.annos=[]; S.lines=[]; S.suggestions=new Set(); S.sel=null; S.selLine=null; S.selMulti=new Set(); S.selMultiL=new Set(); S.clip=null; S.discrepancies=[];
    try{ _tfFlagged=new Set(); }catch(e){}   /* 6fq — the transfer's rings belong to the transfer */
    /* 6ga — a new document has its own save history. Carrying the previous one's time across would put
       a confident "Last saved 6:53 PM" beside work that has never been saved at all. */
    clearSavedReadout();
    $("#bar").style.display="block";
    showProg("Loading pages…");
    LOG("Opening",file.name,"·",S.doc.numPages,"pages");
    for(let p=1;p<=S.doc.numPages;p++){
      const page=await S.doc.getPage(p);
      const vp1=page.getViewport({scale:1});
      const tc=await page.getTextContent();
      const items=[];
      for(const it of tc.items){
        if(!it.str||!it.str.trim())continue;
        const tx=pdfjsLib.Util.transform(vp1.transform,it.transform);
        const fh=Math.hypot(tx[2],tx[3]);
        items.push({str:it.str, nx:tx[4]/vp1.width, ny:(tx[5]-fh)/vp1.height, nw:(it.width||0)/vp1.width, nh:fh/vp1.height});
      }
      S.pages.push({page, w1:vp1.width, h1:vp1.height, items, jpg:null, locked:false});
      const head=items.slice(0,10).map(t=>t.str).join(" ");
      S.pages[S.pages.length-1].locked = /\(\s*existing\s*\)|proposed\s+decommission|decommission/i.test(head);
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
    $("#asBuiltBtn").disabled=false; $("#dlPdf").disabled=false;
    if($("#homeBtn"))$("#homeBtn").disabled=false;
    if($("#orgBtn")){ $("#orgBtn").disabled=false; $("#orgBtn").onclick=openPageOrg; } $("#copyBtn").disabled=false; $("#saveBtn").disabled=false; $("#clearBtn").disabled=false;
    $("#selAllBtn").disabled=false; $("#photoBtn").disabled=false; updateCdBtn();
    $("#fitBtn").disabled=false; ["#fitPageBtn","#actualBtn","#facingBtn","#pageViewBtn"].forEach(q=>{ const b=$(q); if(b)b.disabled=false; }); $("#findInput").disabled=false; $("#findPrev").disabled=false; $("#findNext").disabled=false; $("#marksBtn").disabled=false; $("#analyzeBtn").disabled=false;
    detectPreliminary();   // quick text-based Preliminary/Final read on load (refined by Analyze)
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
    LOG("Loaded and rendered",S.pages.length,"pages");
    /* 6gh — the trailer went: you are looking at the pages, and clicking a cell is what the tool does.
       Ced: "remove some texts on the ui, like sentences that are self explanatory." */
    setStatus(`${S.doc.numPages} PAGES`);
  }catch(err){
    $("#bar").style.display="none";
    setStatus("Couldn't open PDF: "+(err&&err.message?err.message:err),true);
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
  document.querySelectorAll("#rail .rt").forEach(b=>b.classList.toggle("done",red.has(+b.dataset.idx)));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("redlined",red.has(+p.dataset.idx)));
}
let io=null;
function observePages(){ setupVirtualization(); updateCurrentRail(); reapplyPageView(); }
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
function updateMiniBar(){
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
const RIB_W_KEY="rfds.ribbonWidth";
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
const COL_W_KEY="rfds.colWidth";
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
const RIB_SIDE_KEY="rfds.ribbonSide";
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
  }
  updateRail();
  setupVirtualization();
}
async function ensurePageRendered(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg||pg.dataset.rendered==="1"||pg.dataset.rendered==="wip")return;
  pg.dataset.rendered="wip";
  const P=S.pages[i]; const vp=P.page.getViewport({scale:S.scale});
  const cv=el("canvas","pdf"); cv.width=vp.width; cv.height=vp.height; cv.style.width=vp.width+"px"; cv.style.height=vp.height+"px";
  try{ const task=P.page.render({canvasContext:cv.getContext("2d"),viewport:vp}); pg._task=task; await task.promise; }
  catch(err){ pg.dataset.rendered=""; return; }
  if(pg.dataset.rendered!=="wip") return; // unloaded mid-render
  try{ const bb=pg.previousElementSibling;
    if(bb&&bb.classList.contains("page-bar"))bb.style.width=vp.width+"px"; }catch(e){}
  pg.insertBefore(cv, pg.querySelector(".pagelabel").nextSibling);
  const tl=el("div","textlayer");
  P.items.forEach(it=>{ const b=el("div","tspan"); b.dataset.key=keyOf(i,it);
    b.style.left=(it.nx*vp.width)+"px"; b.style.top=(it.ny*vp.height)+"px";
    b.style.width=Math.max(it.nw*vp.width,6)+"px"; b.style.height=Math.max(it.nh*vp.height,8)+"px";
    b.textContent=it.str;                 // real text (transparent) so it can be selected & copied
    b.title="Click to redline"; b.onclick=ev=>{ev.stopPropagation();onCell(i,it);}; tl.appendChild(b); });
  pg.appendChild(tl);
  pg.appendChild(el("div","annolayer-under"));
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("class","draw"); svg.setAttribute("width",vp.width); svg.setAttribute("height",vp.height);
  pg.appendChild(svg);
  pg.appendChild(el("div","annolayer"));
  pg.dataset.rendered="1";
  drawPageLines(i); layoutAnnos(); applySuggestions();
}
function unloadPage(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg)return;
  if(pg._task&&pg._task.cancel){ try{pg._task.cancel();}catch(e){} }
  pg.dataset.rendered="";
  [...pg.querySelectorAll("canvas.pdf,.textlayer,svg.draw,.annolayer,.annolayer-under")].forEach(n=>{ if(n.tagName==="CANVAS"){n.width=0;n.height=0;} n.remove(); });
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
const MODE_NAMES={select:"Select",redline:"Redline",strikerow:"Strike row",cross:"Strike text",line:"Line",crossout:"Cross out"};
function setMode(m){
  /* 6dr — changing tool mid-drag is one of the ways a selection box was orphaned */
  try{ clearStrayMarquees(); document.querySelectorAll(".page").forEach(p=>p._killDrag&&p._killDrag()); }catch(e){}
  S.mode=m;
  document.querySelectorAll("#tools .tool").forEach(x=>x.classList.toggle("active",x.dataset.mode===m));
  const pg=$("#pages"); if(pg)pg.dataset.mode=m;
  const mp=$("#modePill"); if(mp)mp.textContent=MODE_NAMES[m]||m;
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
      const id=stampWholeCell(i,{nx:blk.topL-pad,ny:blk.top,nw:blk.topR-blk.topL+pad*2,
                                 nh:blk.lineH,x2:blk.textR+pad,y2:blk.bot,
                                 topR:blk.topR+pad,topY:blk.top,lines:blk.lines},
                              blk.text,"center");
      const a=S.annos.find(z=>z.id===id);
      if(a){ a.onCell=true; a.cw=blk.topR-blk.topL; a.tx0=blk.topL;
        if(a.srcLen==null&&blk.str!=null)a.srcLen=String(blk.str).trim().length;
             a.cellL=blk.textL; a.cellR=blk.textR; a.orig=blk.text; }
      /* addText laid the element out before stampWholeCell set wrap/height, so re-render it now —
         otherwise the mark keeps the single-line styling and the value never breaks onto line two */
      layoutAnnos(); _needRelayout=false;
      LOG("Redline: whole cell over",blk.lines,"lines →",blk.text);
      setTimeout(()=>{ const ed=document.querySelector(`.anno[data-id="${id}"] .ed`);
        if(ed){ selectAnno(id); ed.focus(); try{document.getSelection().selectAllChildren(ed);}catch(e){} } },0);
      setMode("select");
      return;
    }
    addText(i,it.nx,it.ny,it.str,{cell:it});
  }
  else if(S.mode==="cross"){ const id=addLine(i,it.nx,it.ny+it.nh/2,it.nx+it.nw,it.ny+it.nh/2); selectLine(id); }
  else if(S.mode==="strikerow"){ const id=strikeRow(i,it); selectLine(id); }
}

/* strike the full equipment row: find text items sharing this row's vertical band */
function rowBand(i,it){
  const cy=it.ny+it.nh/2, tol=it.nh*0.7;
  const band=S.pages[i].items.filter(t=>Math.abs((t.ny+t.nh/2)-cy)<tol);
  const left=Math.min(...band.map(t=>t.nx)), right=Math.max(...band.map(t=>t.nx+t.nw));
  return {y:cy, left:Math.max(0,left-0.006), right:Math.min(1,right+0.006)};
}
/* 6fw — the quantity cell on an Equipment in Calc row: the last numeric run in the row's band, to the
   right of the model. Returns null rather than guessing when the row has no number on it. */
function ecQtyCellFor(pi,it){
  const P=S.pages[pi]; if(!P||!P.items)return null;
  const cy=it.ny+(it.nh||0.01)/2, tol=Math.max((it.nh||0.01)*0.8,0.006);
  const band=P.items.filter(t=>Math.abs((t.ny+(t.nh||0)/2)-cy)<tol
                              && (t.nx+(t.nw||0)/2)>(it.nx+(it.nw||0)/2))
                    .sort((a,b)=>a.nx-b.nx);
  const nums=band.filter(t=>/^\d{1,4}$/.test(String(t.str).trim()));
  return nums.length?nums[nums.length-1]:null;
}
/* 6fw — AN ANTENNA POSITION IS A COLUMN, SO STRIKING ONE IS A CROSS, NOT A STRIKE.
   Ced: "striking through a column in antenna position should cross out that column instead of using
   striketrough." Every other table in an RFDS puts one thing per ROW, so `strikeRow` draws a horizontal
   line and that is right. Antenna Position Details is TRANSPOSED — the fields are the rows and each
   Sec-Pos is a column — so a horizontal line through it strikes one field across every position, which
   is both wrong and misleading. The column gets the same X the Cross out tool draws: two grouped lines,
   so it behaves like any other cross and can be moved or undone as one thing.
   The column's extent is measured from the page rather than assumed: its width from the gaps to the
   columns either side, its height from the topmost and bottommost runs that sit in it. */
function antColumnBox(pi,colX){
  const P=S.pages[pi]; if(!P||!P.items||colX==null)return null;
  const mid=t=>t.nx+(t.nw||0)/2;
  /* the other column centres on the Sec-Pos row tell us how wide a column is here */
  const secRow=antFieldRow(pi,ANT_ROW.secPos);
  let half=0.055;
  if(secRow&&secRow.items){
    const xs=secRow.items.filter(t=>t.nx>0.135&&String(t.str).trim()).map(mid).sort((a,b)=>a-b);
    const gaps=[]; for(let i=1;i<xs.length;i++)gaps.push(xs[i]-xs[i-1]);
    if(gaps.length){ gaps.sort((a,b)=>a-b); half=gaps[Math.floor(gaps.length/2)]*0.46; }
  }
  /* THE TABLE'S EXTENT, NOT THE PAGE'S. Measured on OHL01029: taking every run that falls in the
     column's x band put the cross from y 0.018 to 0.951 — the page title sits in that band too, so the
     X was drawn over the heading as well as the column. The top is the Sec-Pos row, which is where the
     table starts, and the bottom is the last row LABEL in the first column, which is where it ends. */
  const labels=P.items.filter(t=>t.nx<0.135&&String(t.str).trim());
  if(!labels.length)return null;
  let top=secRow?secRow.y:null;
  if(top==null){ const inCol0=P.items.filter(t=>Math.abs(mid(t)-colX)<=half);
    if(!inCol0.length)return null; top=Math.min.apply(null,inCol0.map(t=>t.ny)); }
  const lastLabel=Math.max.apply(null,labels.map(t=>t.ny+(t.nh||0.01)));
  const inCol=P.items.filter(t=>Math.abs(mid(t)-colX)<=half
                              && (t.ny+(t.nh||0)/2)>=top-0.02
                              && (t.ny+(t.nh||0)/2)<=lastLabel+0.01);
  if(!inCol.length)return null;
  top=Math.min(top, Math.min.apply(null,inCol.map(t=>t.ny)));
  const bot=Math.min(lastLabel, Math.max.apply(null,inCol.map(t=>t.ny+(t.nh||0.01))));
  if(bot-top<0.01)return null;                       // one lonely run is not a column
  return {x1:Math.max(0,colX-half*0.92), x2:Math.min(1,colX+half*0.92),
          y1:Math.max(0,top-0.004), y2:Math.min(1,bot+0.004)};
}
function crossOutColumn(pi,colX){
  const b=antColumnBox(pi,colX);
  if(!b)return null;
  if(_azApplying && S.lines.some(l=>l.fromAnalyze && l.page===pi
        && Math.abs(((l.x1+l.x2)/2)-((b.x1+b.x2)/2))<0.01
        && Math.abs((l.y2||l.y1)-(l.y1))>0.01)) return null;   // this column is already crossed
  const g=++seq;
  const a=addLine(pi,b.x1,b.y1,b.x2,b.y2);
  const c=addLine(pi,b.x1,b.y2,b.x2,b.y1);
  [a,c].forEach(id=>{ const l=S.lines.find(z=>z.id===id); if(l)l.group=g; });
  return a;
}
function strikeRow(i,it){ const b=rowBand(i,it);
  if(_azApplying && S.lines.some(l=>l.fromAnalyze && l.page===i && Math.abs(l.y1-b.y)<0.006)) return null;   // already struck by analyze
  return addLine(i,b.left,b.y,b.right,b.y);
}

/* Fill As-Built = Design on Antenna Position Details (Final) pages.
   Matches each "(As-Built)" row to its "(Design)" row and copies each column's
   Design value into the blank As-Built cell (aligned by x). Overlays are editable. */
function fillAsBuilt(){
  if(!S.doc){ setStatus("Open the RFDS first.",true); return; }
  pushHistory();
  const pairs=[["radCenterDesign","radCenterAsBuilt","Rad Center"],
               ["azimuthDesign","azimuthAsBuilt","Azimuth"],
               ["mechDowntiltDesign","mechDowntiltAsBuilt","Mechanical Downtilt"]];
  const secs=detectSections();
  const pages=(secs.antennaPosition||[]);
  let filled=0, pagesHit=0, blanks=0;
  pages.forEach(pi=>{
    const secRow=antFieldRow(pi,ANT_ROW.secPos);
    if(!secRow){ LOG("Fill As-Built: no Sec-Pos row on page",pi+1); return; }
    // the position columns (A-1, A-2, B-1 …) are the cells to the right of the row label
    const cols=secRow.items.filter(t=>t.nx>0.135 && t.str.trim()!=="")
                           .map(t=>({label:t.str.trim(), x:t.nx+(t.nw||0)/2}));
    if(!cols.length){ LOG("Fill As-Built: no position columns on page",pi+1); return; }
    let did=false;
    pairs.forEach(([dKey,bKey,label])=>{
      const dRow=antFieldRow(pi,ANT_ROW[dKey]), bRow=antFieldRow(pi,ANT_ROW[bKey]);
      if(!dRow||!bRow||dRow===bRow){ LOG(`Fill As-Built: p${pi+1} ${label}: design/as-built rows not both found`); return; }
      cols.forEach(col=>{
        const dCell=antCellAt(pi,col.x,dRow.y);
        if(!dCell)return;
        const val=String(dCell.str).trim();
        if(!val||/^[-–—]$/.test(val))return;                       // nothing to copy
        const bCell=antCellAt(pi,col.x,bRow.y);
        if(bCell){
          if(String(bCell.str).trim()===val)return;                // already matches
          addText(pi,bCell.nx,bCell.ny,val,{cell:bCell});
        } else {
          // the As-Built cell is truly empty (no text run to anchor on): place it in the
          // same column, on the As-Built row, using the Design cell's width for coverage
          const P=S.pages[pi];
          const nx=Math.max(0,col.x-(dCell.nw||0.01)/2);
          const id=addText(pi,nx,Math.max(0,bRow.y-(dCell.nh||0.01)*0.62),val);
          const a=S.annos.find(z=>z.id===id);
          if(a){ a.nowrap=true; a.align="center"; }
          blanks++;
        }
        filled++; did=true;
      });
    });
    if(did)pagesHit++;
  });
  setMode("select"); selectAnno(null); layoutAnnos(); updateRail(); updateCount();
  LOG(`Fill As-Built: ${pages.length} antenna(Final) page(s), filled ${filled} cell(s) on ${pagesHit} page(s), ${blanks} into empty cells`);
  if(!pages.length){ setStatus("No Antenna Position Details (Final) pages found. Run Analyze RFDS first if the section wasn't detected.",true); return; }
  setStatus(filled
    ? `Filled ${filled} As-Built value(s) from Design across ${pagesHit} antenna page(s). They're editable redlines — review them.`
    : `Found ${pages.length} antenna page(s) but every As-Built value already matches its Design value.`);
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
function clearStrayMarquees(){
  let n=0;
  document.querySelectorAll(".marquee").forEach(m=>{ if(m!==_activeMarquee){ m.remove(); n++; } });
  if(n)LOG&&LOG("cleared",n,"stray selection box(es)");
  return n;
}
function attachPagePointer(pg,i){
  let sx,sy,drawing=false,tmp=null,downOnBlank=false,panning=false,psx,psy,pscrX,pscrY,marquee=false,mbox=null,copyMarquee=false,crossMarquee=false;
  /* one place that ends a marquee, so no ending can forget the box */
  const dropMarquee=()=>{
    if(mbox){ mbox.remove(); if(_activeMarquee===mbox)_activeMarquee=null; mbox=null; }
    marquee=false; copyMarquee=false; crossMarquee=false;
  };
  const dropDraw=()=>{ if(tmp){ tmp.remove(); tmp=null; } drawing=false; };
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
    if(e.target.closest(".anno"))return;
    const isTspan=e.target.classList.contains("tspan");
    const pt=rel(e); sx=pt.x; sy=pt.y; downOnBlank=!isTspan;
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
    if(S.mode==="copyrow"){
      /* drag a box over printed text; on release its runs are copied as redlines */
      marquee=true; copyMarquee=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      mbox=el("div","marquee copyrow");
      mbox.style.left=(sx*pg.offsetWidth)+"px"; mbox.style.top=(sy*pg.offsetHeight)+"px";
      mbox.style.width="0px"; mbox.style.height="0px";
      pg.appendChild(mbox); _activeMarquee=mbox; return;
    }
    if(S.mode==="select" && !isTspan){
      if(e.shiftKey||e.ctrlKey||e.metaKey){   // modifier + drag on blank = pan
        panning=true; try{pg.setPointerCapture(e.pointerId);}catch(_){} pg.style.cursor="grabbing";
        psx=e.clientX; psy=e.clientY; pscrX=window.scrollX; pscrY=window.scrollY; return;
      }
      // plain drag on blank = marquee select
      marquee=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      mbox=el("div","marquee"); mbox.style.left=(sx*pg.offsetWidth)+"px"; mbox.style.top=(sy*pg.offsetHeight)+"px"; mbox.style.width="0px"; mbox.style.height="0px";
      pg.appendChild(mbox); _activeMarquee=mbox; return;
    }
    if(S.mode==="line" || (S.mode==="cross" && !isTspan)){
      drawing=true; try{pg.setPointerCapture(e.pointerId);}catch(_){}
      const svg=pg.querySelector("svg.draw");
      tmp=document.createElementNS("http://www.w3.org/2000/svg","line");
      tmp.setAttribute("stroke",$("#c_text").value); tmp.setAttribute("stroke-width",Math.max(1.4,1.4*S.scale));
      tmp.setAttribute("x1",sx*pg.offsetWidth); tmp.setAttribute("y1",sy*pg.offsetHeight);
      tmp.setAttribute("x2",sx*pg.offsetWidth); tmp.setAttribute("y2",sy*pg.offsetHeight);
      svg.appendChild(tmp);
    }
  });
  pg.addEventListener("pointermove",e=>{
    if(panning){ window.scrollTo(pscrX-(e.clientX-psx),pscrY-(e.clientY-psy)); return; }
    /* copyMarquee shares the marquee box; nothing extra to do while dragging */
    if(marquee&&mbox){ const pt=rel(e); const W=pg.offsetWidth,H=pg.offsetHeight;
      const x1=Math.min(sx,pt.x)*W,y1=Math.min(sy,pt.y)*H,x2=Math.max(sx,pt.x)*W,y2=Math.max(sy,pt.y)*H;
      mbox.style.left=x1+"px"; mbox.style.top=y1+"px"; mbox.style.width=(x2-x1)+"px"; mbox.style.height=(y2-y1)+"px"; return; }
    if(!drawing||!tmp)return; const pt=rel(e);
    tmp.setAttribute("x2",pt.x*pg.offsetWidth); tmp.setAttribute("y2",sy*pg.offsetHeight); // horizontal only: lock y to start
  });
  pg.addEventListener("pointerup",e=>{
    if(e.button===2)return;   // right-click handled by contextmenu
    if(panning===false&&marquee===false&&copyMarquee)copyMarquee=false;
    if(panning){ panning=false; pg.style.cursor="";
      const pt=rel(e); if(Math.hypot(pt.x-sx,pt.y-sy)<0.006){ selectAnno(null); selectLine(null); }
      return; }
    if(marquee){ const pt=rel(e);
      const rx1=Math.min(sx,pt.x),ry1=Math.min(sy,pt.y),rx2=Math.max(sx,pt.x),ry2=Math.max(sy,pt.y);
      const wasCopy=copyMarquee, wasCross=crossMarquee;
      dropMarquee();                      /* the box goes first, whatever this drag turns out to be */
      copyMarquee=wasCopy; crossMarquee=wasCross;
      if(copyMarquee){ copyMarquee=false; copyRowFromBox(i,rx1,ry1,rx2,ry2); return; }
      if(crossMarquee){ crossMarquee=false; crossOutBox(i,rx1,ry1,rx2,ry2); return; }
      /* 6gn — and the same for the tools that arm a MARQUEE. Cross out drew its X and then put itself
         down; a click that drew no box left it armed. `setMode` only where a tool is actually up, so
         Select's own marquee-click keeps deselecting and nothing else. */
      if(Math.abs(pt.x-sx)<0.004&&Math.abs(pt.y-sy)<0.004){ clearMulti(); selectAnno(null); selectLine(null);
        if(S.mode!=="select")setMode("select");
        return; }  // tiny = click-deselect
      clearMulti(); selectAnno(null);
      S.annos.forEach(a=>{ if(a.page!==i)return; if(a.nx>=rx1&&a.nx<=rx2&&a.ny>=ry1&&a.ny<=ry2) S.selMulti.add(a.id); });
      S.lines.forEach(l=>{ if(l.page!==i)return; const mx=(l.x1+l.x2)/2;   // a strike is caught by its midpoint
        if(mx>=rx1&&mx<=rx2&&l.y1>=ry1&&l.y1<=ry2) S.selMultiL.add(l.id); });
      paintMulti();
      if(multiCount())toast(`Selected ${multiCount()} mark${multiCount()>1?"s":""}`);
      return; }
    if(drawing&&tmp){ const pt=rel(e); tmp.remove(); tmp=null; drawing=false;
      const moved=Math.abs(pt.x-sx)>0.004;
      if(moved){ const id=addLine(i,sx,sy,pt.x,sy); selectLine(id); }   // horizontal (y2=y1); stay on tool
      /* 6gn — a press-and-release that drew nothing puts the tool down, like Redline. This branch
         returns before the general rule below, which is why adding the modes there alone was not
         enough: Line and Strike text arm a drag on pointerdown and never reach it. */
      else setMode("select");
      return;
    }
    /* 6gn — AND THE STROKE TOOLS DO THE SAME. Ced: "clicking on pdf surface should go back to select
       even in strike through, lines, strike text and crossout." Redline has behaved this way since it
       was written — a click that draws nothing puts the tool down — and the four stroke tools did not,
       so once you had drawn a strike the tool stayed armed and the next click started another one
       instead of selecting the mark you were reaching for. Cross out already reverted; the other three
       did not, which made it look arbitrary rather than deliberate.
       A DRAG still draws and still leaves the tool up: this is only the click that produced nothing. */
    const ARMED_TOOLS=["redline","line","cross","crossout","strikerow"];
    if(ARMED_TOOLS.indexOf(S.mode)>=0 && downOnBlank && !e.target.closest(".anno")){
      const pt=rel(e);
      if(Math.hypot(pt.x-sx,pt.y-sy)<0.01){ setMode("select"); }   // left-click on blank → back to Select
    }
  });
  // right-click = redline: on a text cell it drops a cell redline; on blank it drops a free redline; either way switches to the Redline tool
  pg.addEventListener("contextmenu",e=>{
    if(e.target.closest(".anno"))return;
    e.preventDefault();
    if(S.mode!=="redline") setMode("redline");
    if(e.target.classList.contains("tspan")){ e.target.click(); }   // cell redline (onCell fires in redline mode)
    else { const pt=rel(e); addText(i,pt.x,pt.y,""); }              // free redline on non-text area
  });
}

/* ---------- lines / strikes (selectable, draggable endpoints + body) ---------- */
/* 6dq — y2 is honoured when given. Every line the tool made until the cross-out was horizontal, so
   this quietly flattened them all; a caller that wants a slope now says so. */
function addLine(page,x1,y1,x2,y2){ pushHistory(); const id=seq++;
  const l={id,page,x1,y1,x2,y2:(y2==null?y1:y2)}; if(_azApplying)l.fromAnalyze=true; S.lines.push(l); drawPageLines(page); updateRail(); updateCount(); return id; }
function drawAllLines(){ S.pages.forEach((_,i)=>{ if(pageRendered(i))drawPageLines(i); }); }
function drawPageLines(i){
  const pg=document.querySelector(`.page[data-idx="${i}"]`); if(!pg||pg.dataset.rendered!=="1")return;
  const svg=pg.querySelector("svg.draw"); if(!svg)return;
  [...svg.querySelectorAll("*")].forEach(n=>n.remove());
  const w=pg.offsetWidth,h=pg.offsetHeight,col=$("#c_text").value;
  S.lines.filter(l=>l.page===i).forEach(l=>{
    const sel=S.selLine===l.id && !S.selMultiL.has(l.id);
    const mk=(tag,attrs)=>{ const n=document.createElementNS("http://www.w3.org/2000/svg",tag); for(const k in attrs)n.setAttribute(k,attrs[k]); return n; };
    // wide invisible hit line for easy select/drag
    const hit=mk("line",{x1:l.x1*w,y1:l.y1*h,x2:l.x2*w,y2:l.y2*h,stroke:"transparent","stroke-width":14}); hit.style.pointerEvents="stroke"; hit.style.cursor="move";
    hit.addEventListener("pointerdown",ev=>{ ev.stopPropagation();
      if(ev.shiftKey||ev.ctrlKey||ev.metaKey){ toggleMultiLine(l.id); return; }          // add/remove from the selection
      if(S.selMultiL.has(l.id)){ dragMulti(ev,pg); return; }                             // already selected → move the whole selection
      if(l.group!=null){ selectGroup(l.group); dragMulti(ev,pg); return; }               // grouped → move the group as one
      selectLine(l.id); startLineDrag(ev,l,"move",pg); });
    svg.appendChild(hit);
    if(S.selMultiL.has(l.id)){
      const halo=mk("line",{x1:l.x1*w,y1:l.y1*h,x2:l.x2*w,y2:l.y2*h,stroke:"#ffb02e","stroke-width":Math.max(6,5*S.scale),"stroke-linecap":"round",opacity:.55});
      halo.style.pointerEvents="none"; svg.appendChild(halo);
    }
    const ln=mk("line",{x1:l.x1*w,y1:l.y1*h,x2:l.x2*w,y2:l.y2*h,stroke:col,"stroke-width":Math.max(1.4,(sel?1.9:1.4)*S.scale)}); ln.style.pointerEvents="none";
    svg.appendChild(ln);
    if(sel){
      [["1",l.x1],["2",l.x2]].forEach(([end,x])=>{ const c=mk("circle",{cx:x*w,cy:l.y1*h,r:6,fill:"#37a6ff",stroke:"#fff","stroke-width":1.5}); c.style.pointerEvents="all"; c.style.cursor="ew-resize";
        c.addEventListener("pointerdown",ev=>{ ev.stopPropagation(); selectLine(l.id); startLineDrag(ev,l,"e"+end,pg); }); svg.appendChild(c); });
      positionLineBar(l,pg);
    }
  });
}
let _ldrag=null;
function startLineDrag(ev,l,mode,pg){ ev.preventDefault(); pushHistory();
  _ldrag={id:l.id,mode,pg,cx:ev.clientX,cy:ev.clientY,o:{x1:l.x1,x2:l.x2,y:l.y1,y2:(l.y2!=null?l.y2:l.y1)}}; try{pg.setPointerCapture(ev.pointerId);}catch(e){}
}
window.addEventListener("pointermove",e=>{
  if(!_ldrag)return; const l=S.lines.find(x=>x.id===_ldrag.id); if(!l)return;
  const w=_ldrag.pg.offsetWidth,h=_ldrag.pg.offsetHeight; const dx=(e.clientX-_ldrag.cx)/w, dy=(e.clientY-_ldrag.cy)/h;
  if(_ldrag.mode==="move"){ l.x1=_ldrag.o.x1+dx; l.x2=_ldrag.o.x2+dx;
    l.y1=_ldrag.o.y+dy; l.y2=_ldrag.o.y2+dy; }   /* 6dq — both ends, so a slope survives being moved */
  else if(_ldrag.mode==="e1"){ l.x1=_ldrag.o.x1+dx; }        // horizontal: y unchanged
  else if(_ldrag.mode==="e2"){ l.x2=_ldrag.o.x2+dx; }
  drawPageLines(l.page);
});
window.addEventListener("pointerup",()=>{ if(_ldrag){ _ldrag=null; } });
function selectLine(id){ S.selLine=id; if(id!=null){ selectAnno(null); clearMulti(); } S.pages.forEach((_,i)=>{ if(pageRendered(i))drawPageLines(i); }); if(id==null)$("#linebar").classList.remove("show"); }
function positionLineBar(l,pg){ const bar=$("#linebar"); const r=pg.getBoundingClientRect(); const mx=r.left+((l.x1+l.x2)/2)*pg.offsetWidth, my=r.top+l.y1*pg.offsetHeight;
  fitFloatingBar(bar,mx-14,my-38); }

/* ---------- text annotations ---------- */
/* measure text width in normalized page units (deterministic — no DOM/zoom dependence) */
let _measCtx=null;
function measureTextNorm(text,sizePt,pageIdx){
  const P=S.pages[pageIdx]; if(!P||!P.w1)return 0;
  if(!_measCtx){ _measCtx=document.createElement("canvas").getContext("2d"); }
  _measCtx.font=sizePt+"px 'Times New Roman',Times,serif";
  const wpx=_measCtx.measureText(String(text==null?"":text)).width;
  return wpx/P.w1;
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
function redlineWrapLines(text,size,pi,maxW){
  const s=String(text==null?"":text);
  const out=[]; let cur="";
  const wid=t=>measureTextNorm(String(t).replace(/\s+$/,""),size,pi);
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
  /* 6gn — a new mark starts BELOW the strokes, which is 6gm's rule ("a stroke is always above a text
     mark, whatever order the two were made in"). The ⇅ button on the selection bar lifts it above them
     when that is what you want, which is the state Ced asked to get back. */
  const a={id:seq++,page,nx:x,ny:y,nw,text:orig||"",orig:orig||"",align,size,onCell:!!opts.cell,nowrap,fullcell,
           under:(opts.under!=null?!!opts.under:true)};
  if(opts.cell){
    /* How many characters the PRINTED value had. A one-character replacement over a printed "10" belongs on
       the centre of that wider cell — flush left of it reads as off-centre against the column. Taken from
       the run itself, since the computed cell context carries no text. */
    if(opts.cell.str!=null)a.srcLen=String(opts.cell.str).trim().length;
    /* match the printed run's size, and keep its height so the glyphs can be centred on the printed
       line instead of riding above it */
    const pt=printedPt(page,{nh:opts.cell.nh});
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
  S.annos.push(a); layoutAnnos(); applySuggestions(); updateRail(); updateCount();
  S.suggestions.delete(page+"|"+x.toFixed(4)+"|"+y.toFixed(4));
  setTimeout(()=>{const ed=document.querySelector(`.anno[data-id="${a.id}"] .ed`); if(ed){selectAnno(a.id);ed.focus();try{document.getSelection().selectAllChildren(ed);}catch(e){}}},0);
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
  set("overflow-wrap","normal");
  set("word-break","break-all");          /* break like the stamp and the export break */
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
function layoutAnnos(){
  document.querySelectorAll(".annolayer,.annolayer-under").forEach(l=>l.innerHTML="");
  const tc=$("#c_text").value, bg=$("#c_bg").value;
  S.annos.forEach(a=>{
    const pg=document.querySelector(`.page[data-idx="${a.page}"]`); if(!pg||pg.dataset.rendered!=="1")return;
    const layer=pg.querySelector(a.under?".annolayer-under":".annolayer"); if(!layer)return;
    const w=pg.offsetWidth,h=pg.offsetHeight;
    const d=el("div","anno"); d.dataset.id=a.id; if(S.sel===a.id)d.classList.add("sel"); if(a.group!=null)d.classList.add("grouped");
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
    d.style.transformOrigin="center center"; if(a.rot)d.style.transform="rotate("+a.rot+"deg)";

    const isImg=(a.kind==="img");
    const ed=isImg?el("div","ed imgwrap"):el("div","ed");
    if(isImg){
      const im=el("img"); im.src=a.src||""; im.draggable=false; im.alt="redline photo";
      im.style.width="100%"; im.style.height="100%"; im.style.display="block"; im.style.pointerEvents="none";
      ed.appendChild(im);
      ed.style.width=((a.nw||0.2)*w)+"px"; ed.style.height=((a.nh||0.15)*h)+"px";
      ed.style.padding="0"; ed.style.overflow="hidden"; ed.style.resize="none";
    } else {
    ed.contentEditable="true"; ed.textContent=a.text;
    ed.style.color=tc; ed.style.background=bg; ed.style.textAlign=a.align;
    ed.style.fontSize=(a.size*S.scale)+"px";   // 1 PDF pt = S.scale css px (matches export)
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
      ed.style.setProperty("word-break","break-all","important");
      ed.style.setProperty("overflow","visible","important");
      ed.style.setProperty("text-align",(a.align||"center"),"important");
      ed.style.setProperty("resize","none","important");
      if(a.nh) ed.style.setProperty("line-height",((a.nh*h)/Math.max(1,a.lines||1))+"px","important");
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
    ed.oninput=()=>{ a._dirty=true; a.text=ed.innerText;
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
      if(a.onCell&&!a.manualW){ fitCellBox(a); const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px"; }
      else if(a.lenRule&&!a.alignUser&&a._colNw!=null){
        /* an added row's cell — the same rule as a count redline, kept live as the text changes */
        applyLenRule(a);
        const pw=pg.offsetWidth; d.style.left=(a.nx*pw)+"px"; ed.style.width=(a.nw*pw)+"px";
      }
      else fitTextInside(a,ed,pg);          /* 6dt — pasted text wraps inside the mark too */
    });
    }
    ed.addEventListener("mousedown",e=>{ if(S.mode==="select"){ e.preventDefault();
      if(e.shiftKey||e.ctrlKey||e.metaKey){ toggleMulti(a.id); return; }
      if(S.selMulti.has(a.id)){ dragMulti(e,pg); return; }
      if(a.group!=null){ selectGroup(a.group); dragMulti(e,pg); return; }
      selectAnno(a.id); dragBody(e,d,a,pg);
    } });
    ed.addEventListener("dblclick",()=>{ d.classList.add("editing"); ed.focus(); try{document.getSelection().selectAllChildren(ed);}catch(e){} });
    ed.onfocus=()=>{ selectAnno(a.id); d.classList.add("editing"); a._dirty=false; a._pre=snapshot(); };
    ed.onblur=()=>{ d.classList.remove("editing"); if(a._dirty){ S.history.push(a._pre); if(S.history.length>80)S.history.shift(); S.future=[]; updateUndoUI(); a._dirty=false; } };
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
    x.onclick=ev=>{ ev.stopPropagation(); pushHistory(); S.annos=S.annos.filter(z=>z.id!==a.id); if(S.sel===a.id)selectAnno(null); layoutAnnos(); updateRail(); updateCount(); };
    d.appendChild(x);
    // resize handles (shown when selected & not editing)
    ["nw","n","ne","e","se","s","sw","w"].forEach(pos=>{ const hd=el("span","rz "+pos); hd.dataset.pos=pos; hd.addEventListener("pointerdown",ev=>startAnnoResize(ev,a,d,ed,pg,pos)); d.appendChild(hd); });
    /* Rotate and Move sit together below the box — the six-dot grip that used to hang off the top-left
       is gone, so nothing overlaps the text any more. */
    const rotH=el("button","rot","↻"); rotH.title="Rotate (Shift = snap 15°)";
    rotH.addEventListener("pointerdown",ev=>startAnnoRotate(ev,a,d,pg)); d.appendChild(rotH);
    const movH=el("button","mov","✥"); movH.title="Drag to move this redline";
    d.appendChild(movH);
    dragify(movH,d,a,pg,ed);
    layer.appendChild(d);
  });
  positionBar();
  /* 6ds — now that the marks are on the page, correct any whose wrapped line count was estimated
     wrongly. Guarded, so the re-layout this triggers cannot recurse. */
  try{ reflowWrapped(); }catch(e){ LOG&&LOG("wrap reflow skipped:",e&&e.message||String(e)); }
  /* 6fq — and put the transfer's amber rings back. Every layout rebuilds the mark elements, so a class
     set once would survive exactly until the next scroll. */
  try{ paintTransferFlags(); }catch(e){}
}
function startAnnoResize(ev,a,d,ed,pg,pos){
  ev.preventDefault(); ev.stopPropagation();
  pushHistory(); selectAnno(a.id);
  try{d.setPointerCapture(ev.pointerId);}catch(e){}
  const w=pg.offsetWidth, cx=ev.clientX, cy=ev.clientY;
  /* 6dt — the modifier is read at the START of the drag as well as during it. Reading it only from the
     move events makes the behaviour depend on the browser still reporting the key on a captured pointer,
     and it means letting go of Ctrl halfway silently changes what the drag is doing. Held when you grab
     the handle is the whole gesture. */
  const startCtrl=!!(ev.ctrlKey||ev.metaKey);
  const startW=ed.offsetWidth, startPx=a.size*S.scale, startLeft=parseFloat(d.style.left);
  const isImg=(a.kind==="img");
  const h0=pg.offsetHeight, startH=ed.offsetHeight, startTop=parseFloat(d.style.top);
  const ax0=a.nx, ay0=a.ny;      /* 6eq — the logical position the gesture started from */
  const move=e=>{
    const dx=e.clientX-cx, dy=e.clientY-cy;
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
    const fromMiddle=(startCtrl||e.ctrlKey||e.metaKey)&&(pos==="e"||pos==="w");
    if(fromMiddle){
      const grow=(pos==="e"?dx:-dx);                     // outward on either side is positive
      const nw=Math.max(16,startW+grow*2);
      ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true;
      const nl=startLeft-(nw-startW)/2;                  // half the growth off each edge
      d.style.left=nl+"px"; a.nx=nl/w;
    } else {
      if(pos.includes("e")){ const nw=Math.max(16,startW+dx); ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true; }
      if(pos.includes("w")){ const nw=Math.max(16,startW-dx); ed.style.width=nw+"px"; a.nw=nw/w; a.manualW=true; const nl=startLeft+dx; d.style.left=nl+"px"; a.nx=nl/w; }
    }
    /* 6dt — the text follows the box as it is dragged: narrow it and the value wraps inside rather
       than spilling past the edge you are dragging. */
    if(pos==="e"||pos==="w"||pos.length===2) fitTextInside(a,ed,pg);
    if(pos==="n"||pos==="s"||pos.length===2){ // corners + top/bottom scale font
      const delta=(pos.includes("s")?dy:-dy);
      const npx=Math.max(5*S.scale,startPx+delta); ed.style.fontSize=npx+"px"; a.size=npx/S.scale;
    }
    positionBar();
  };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
/* move every selected mark — text redlines and strikes alike — as a single rigid block */
function dragMulti(e,pg){
  e.preventDefault();
  const w=pg.offsetWidth,h=pg.offsetHeight, sx=e.clientX, sy=e.clientY;
  const startA=multiAnnos().map(a=>({a,ox:a.nx,oy:a.ny}));
  /* 6fm — KEEP BOTH ENDS. This recorded only y1 and then wrote `l.y1=l.y2=oy+dy`, so ANY drag of a
     selection flattened every sloped line in it — and a cross-out is always selected as a group, so
     clicking one and moving the pointer a few pixels turned the X into two parallel strikes. 6dw found
     exactly this in `alignSelected` and guarded it there; the same flattening was still here and in
     `distributeSelected`. Ced: "the cross sometimes becomes 2 lines when reclicked." */
  const startL=multiLines().map(l=>({l,ox1:l.x1,ox2:l.x2,oy1:l.y1,oy2:(l.y2!=null?l.y2:l.y1)}));
  if(!startA.length&&!startL.length)return;
  pushHistory();
  const bb=multiBBox(pg); if(!bb)return;
  const targets=(S.snap)?buildSnapTargets(pg,startA.map(s=>s.a.id)):null;
  const pagesTouched=new Set(startL.map(s=>s.l.page));
  let moved=false;
  const move=ev=>{
    let dxp=ev.clientX-sx, dyp=ev.clientY-sy;
    if(Math.abs(dxp)+Math.abs(dyp)>2)moved=true;
    if(targets){ const s=applySnap(targets,bb.l+dxp,bb.t+dyp,bb.r-bb.l,bb.b-bb.t); dxp=s.l-bb.l; dyp=s.t-bb.t; drawSnapGuides(pg,s.gx,s.gy,s.gxMid,s.gyMid); }
    const dx=dxp/w, dy=dyp/h;
    startA.forEach(s=>{ s.a.nx=s.ox+dx; s.a.ny=s.oy+dy;
      const d=document.querySelector(`.anno[data-id="${s.a.id}"]`); if(d){ d.style.left=(s.a.nx*w)+"px"; d.style.top=(s.a.ny*h)+"px"; } });
    startL.forEach(s=>{ s.l.x1=s.ox1+dx; s.l.x2=s.ox2+dx; s.l.y1=s.oy1+dy; s.l.y2=s.oy2+dy; });
    if(startL.length) pagesTouched.forEach(pi=>{ if(pageRendered(pi))drawPageLines(pi); });
    positionMultibar();
  };
  const up=()=>{ clearSnapGuides(pg); window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    if(moved){ updateRail(); refreshMarks(); autosave(); } positionMultibar(); };
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
function dragBody(e,d,a,pg){
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
  d.classList.add("dragging");
  const targets=(S.snap)?buildSnapTargets(pg,[a.id]):null;
  const move=ev=>{ const w=pg.offsetWidth,h=pg.offsetHeight; let nl=ox+(ev.clientX-sx),nt=oy+(ev.clientY-sy);
    if(Math.abs(ev.clientX-sx)+Math.abs(ev.clientY-sy)>2)moved=true;
    if(targets){ const s=applySnap(targets,nl,nt,d.offsetWidth,d.offsetHeight); nl=s.l; nt=s.t; drawSnapGuides(pg,s.gx,s.gy,s.gxMid,s.gyMid); }
    d.style.left=nl+"px";d.style.top=nt+"px";
    a.nx=ax0+(nl-ox)/w; a.ny=ay0+(nt-oy)/h;      /* the DELTA, not the rendered position */
    positionBar(); };
  const up=()=>{ d.classList.remove("dragging"); clearSnapGuides(pg);
    window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    if(moved){ S.history.push(pre); if(S.history.length>80)S.history.shift();
               S.future=[]; updateUndoUI(); autosave(); } };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
function dragify(handle,d,a,pg,ed){
  handle.addEventListener("pointerdown",e=>{ e.stopPropagation(); if(ed)ed.blur();
    if(S.selMulti.has(a.id)){ dragMulti(e,pg); return; }                    // part of a selection → move all of it
    if(a.group!=null){ selectGroup(a.group); dragMulti(e,pg); return; }     // grouped → move the group
    selectAnno(a.id); dragBody(e,d,a,pg); });
}
function updateCount(){const n=S.annos.length+S.lines.length;$("#cntPill").textContent=`${n} mark${n===1?"":"s"}`;refreshMarks();try{ updateMiniBar(); }catch(e){}}

/* ---------- selection toolbar ---------- */
const annobar=$("#annobar");
const multibar=$("#multibar");
/* one selection, two kinds of mark: text redlines (S.selMulti) and strikes/lines (S.selMultiL) */
function multiCount(){ return S.selMulti.size+S.selMultiL.size; }
function multiAnnos(){ return [...S.selMulti].map(id=>S.annos.find(a=>a.id===id)).filter(Boolean); }
function multiLines(){ return [...S.selMultiL].map(id=>S.lines.find(l=>l.id===id)).filter(Boolean); }
function paintMulti(){
  document.querySelectorAll(".anno").forEach(d=>d.classList.toggle("multi",S.selMulti.has(+d.dataset.id)));
  drawAllLines();
  updateGroupBtn&&updateGroupBtn();
  positionMultibar();
}
/* the selection's bounding box, in css px on its page (annos measured from the DOM, lines from their extent) */
function multiBBox(pg){
  const w=pg.offsetWidth,h=pg.offsetHeight, L=[],T=[],R=[],B=[];
  multiAnnos().forEach(a=>{ const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    L.push(a.nx*w); T.push(a.ny*h); R.push(a.nx*w+(d?d.offsetWidth:0)); B.push(a.ny*h+(d?d.offsetHeight:0)); });
  multiLines().forEach(l=>{ L.push(Math.min(l.x1,l.x2)*w); R.push(Math.max(l.x1,l.x2)*w); T.push(l.y1*h); B.push(l.y1*h); });
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
  multibar.style.left=Math.max(ins.left,Math.min(window.innerWidth-330,r.left+bb.l))+"px";
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
  multibar.querySelectorAll('[data-al2="top"],[data-al2="vmiddle"],[data-al2="bottom"],[data-dist="v"],[data-tal],[data-mbsize],[data-lay2],[data-lay2grp]')
    .forEach(b=>{ b.style.display=linesOnly?"none":""; });
  const als=[...new Set(multiAnnos().map(a=>a.align||"center"))];
  multibar.querySelectorAll("[data-tal]").forEach(b=>b.classList.toggle("on",als.length===1&&als[0]===b.dataset.tal));
  multibar.classList.add("show");
}
function clearMulti(){
  const hadL=S.selMultiL.size;
  S.selMulti.clear(); S.selMultiL.clear();
  document.querySelectorAll(".anno.multi").forEach(d=>d.classList.remove("multi"));
  if(hadL)drawAllLines();
  multibar.classList.remove("show");
  updateGroupBtn&&updateGroupBtn();
}
function toggleMulti(id){
  if(S.selMulti.has(id))S.selMulti.delete(id); else S.selMulti.add(id);
  dropSingleSel(); paintMulti();
}
function toggleMultiLine(id){
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
  if(id!=null)clearMulti();
  /* 6gm — the mark you are working on comes forward, so a stroke lying across it cannot swallow the
     8px handles. Everything else stays under the strokes, which is the rule. */
  try{ document.body.classList.toggle("annosel", id!=null); }catch(e){}
  document.querySelectorAll(".anno").forEach(d=>d.classList.toggle("sel",+d.dataset.id===id));
  if(id==null){annobar.classList.remove("show");return;}
  const a=S.annos.find(x=>x.id===id); if(!a){annobar.classList.remove("show");return;}
  annobar.querySelectorAll("[data-al]").forEach(b=>b.classList.toggle("on",b.dataset.al===a.align));
  annobar.classList.add("show"); positionBar();
}
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
    document.documentElement.style.setProperty("--mark-right",
      Math.max(20, Math.round(r + MARK_CLEAR)) + "px");
  }catch(e){}
}
let _markRaf=0;
function syncMarkClearSoon(){
  if(_markRaf)return;
  _markRaf=requestAnimationFrame(()=>{ _markRaf=0; syncMarkClear(); });
}
window.addEventListener("resize",syncMarkClearSoon);
window.addEventListener("scroll",syncMarkClearSoon,{passive:true});
function fitFloatingBar(bar,x,y){
  bar.classList.add("show");
  const w=bar.offsetWidth||220, h=bar.offsetHeight||34;
  const vw=window.innerWidth, vh=window.innerHeight;
  const ins=_chromeInset();
  /* 6gn — the right-hand limit is the chrome's, not the window's, so a bar next to a mark near the
     right edge stops at the side ribbon instead of behind it or past the screen. */
  const rmax=vw-ins.right;
  let left=x;
  if(left+w>rmax) left=x-w;                      // flip to the left of the cursor / mark
  if(left<ins.left) left=Math.max(ins.left,rmax-w);  // and if that overflows too, tuck it against the chrome
  if(left+w>rmax) left=Math.max(ins.left,rmax-w);    // never past the right-hand chrome either
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
function positionBar(){
  if(S.sel==null){annobar.classList.remove("show");return;}
  const d=document.querySelector(`.anno[data-id="${S.sel}"]`); if(!d){annobar.classList.remove("show");return;}
  const r=d.getBoundingClientRect();
  const h=annobar.offsetHeight||34;
  let top=r.top-h-BAR_X_OVERHANG-BAR_AIR;
  if(top<8)top=r.bottom+BAR_HANDLE_DROP+BAR_AIR;   // flipped below: clear the handles, not just the box
  fitFloatingBar(annobar,r.left,top);
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
annobar.querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{ const a=S.annos.find(x=>x.id===S.sel); if(!a)return; a.size=Math.max(5,Math.min(40,a.size+(+b.dataset.fs))); fitCellBox(a); layoutAnnos(); selectAnno(a.id); });
annobar.querySelectorAll("[data-lay]").forEach(b=>b.onclick=()=>{ const a=S.annos.find(x=>x.id===S.sel); if(!a)return; pushHistory();
  const zs=S.annos.filter(x=>x.page===a.page && !!x.under===!!a.under).map(x=>x.z||0);
  const mx=zs.length?Math.max(...zs):0, mn=zs.length?Math.min(...zs):0;
  if(b.dataset.lay==="front") a.z=mx+1;
  else if(b.dataset.lay==="back") a.z=mn-1;
  else if(b.dataset.lay==="under") a.under=!a.under;
  layoutAnnos(); selectAnno(a.id); updateRail(); });
multibar.querySelectorAll("[data-lay2]").forEach(b=>b.onclick=()=>{
  const list=multiAnnos(); if(!list.length){ toast("Select some redlines first"); return; }
  pushHistory();
  /* one decision for the whole selection rather than flipping each in turn: a mixed set would other-
     wise just swap which half is under, and you would have to press it twice to line them up. If any
     of them is still above the lines, they all go below; only when every one is already below does it
     put them back. */
  const anyAbove=list.some(a=>!a.under);
  list.forEach(a=>{ a.under=anyAbove; });
  layoutAnnos(); paintMulti(); positionMultibar(); updateRail(); autosave();
  toast(anyAbove?("Moved "+list.length+" below the lines"):("Moved "+list.length+" above the lines"));
});
multibar.querySelectorAll("[data-al2]").forEach(b=>b.onclick=()=>alignSelected(b.dataset.al2));
multibar.querySelectorAll("[data-dist]").forEach(b=>b.onclick=()=>distributeSelected(b.dataset.dist));
multibar.querySelector("[data-mbsize]").onclick=matchSizeSelected;
multibar.querySelector("[data-mbgroup]").onclick=()=>{
  const allG=multiCount()>0&&multiAnnos().every(a=>a.group!=null)&&multiLines().every(l=>l.group!=null);
  if(allG)ungroupSelected(); else groupSelected();
};
multibar.querySelector("[data-mbdel]").onclick=()=>{
  if(!multiCount())return; pushHistory();
  S.annos=S.annos.filter(x=>!S.selMulti.has(x.id)); S.lines=S.lines.filter(x=>!S.selMultiL.has(x.id));
  clearMulti(); layoutAnnos(); drawAllLines(); updateRail(); updateCount();
};
annobar.querySelector("[data-del]").onclick=()=>{ if(S.sel==null)return; pushHistory(); S.annos=S.annos.filter(x=>x.id!==S.sel); const s=S.sel; S.sel=null; annobar.classList.remove("show"); layoutAnnos(); updateRail(); updateCount(); };
document.addEventListener("keydown",e=>{ if((e.key==="Delete"||e.key==="Backspace")&&!_typingTarget()){
  if(multiCount()){ pushHistory(); S.annos=S.annos.filter(x=>!S.selMulti.has(x.id)); S.lines=S.lines.filter(x=>!S.selMultiL.has(x.id)); clearMulti(); layoutAnnos(); drawAllLines(); updateRail(); updateCount(); return; }
  if(S.selLine!=null){ pushHistory(); S.lines=S.lines.filter(x=>x.id!==S.selLine); const p=S.selLine; S.selLine=null; $("#linebar").classList.remove("show"); drawAllLines(); updateRail(); updateCount(); return; }
  /* 6ex — AND IT PUSHES HISTORY. The multi-selection and line branches above always did; this one did
     not, so deleting one mark left the undo stack where it was and the next Ctrl+Z jumped back past it —
     measured: Delete took 24 marks to 23 with the history still at 1 entry, and one Ctrl+Z then removed
     all 23. The same fault 6eq found in the drag, in the branch nobody had measured. */
  if(S.sel!=null){ pushHistory(); S.annos=S.annos.filter(x=>x.id!==S.sel);S.sel=null;annobar.classList.remove("show");layoutAnnos();updateRail();updateCount(); return; }
  /* 6ey — and when there is nothing selected, SAY SO. Delete has always been silent in that case, which
     from the keyboard is indistinguishable from a key that does not work. */
  if(S.doc)setStatus("Nothing is selected — click a redline first, or Ctrl+A to take the whole page.",true);
  } });
$("#linebar").querySelector("[data-ldel]").onclick=()=>{ if(S.selLine==null)return; pushHistory(); S.lines=S.lines.filter(x=>x.id!==S.selLine); S.selLine=null; $("#linebar").classList.remove("show"); drawAllLines(); updateRail(); updateCount(); };
document.addEventListener("pointerdown",e=>{ if(e.target.closest("#annobar")||e.target.closest("#multibar")||e.target.closest(".anno"))return; if(e.target.closest("#linebar")||e.target.closest("svg.draw"))return; if(e.target.closest(".tspan")||e.target.closest(".page")){ if(!e.target.closest("svg.draw"))selectLine(null); return; } selectAnno(null); selectLine(null); });
window.addEventListener("scroll",()=>{ positionBar(); positionMultibar(); if(S.selLine!=null){ const l=S.lines.find(x=>x.id===S.selLine); if(l){ const pg=document.querySelector(`.page[data-idx="${l.page}"]`); if(pg)positionLineBar(l,pg); } } },true);

["#c_text","#c_bg"].forEach(id=>$(id).addEventListener("input",()=>{layoutAnnos();drawAllLines();}));
$("#c_pt").addEventListener("input",()=>{});

/* ---------- photos ----------
   A photo is an annotation with kind:"img", so selection, dragging, grouping, undo, autosave
   and the re-editable export payload all apply to it unchanged. Pasted bitmaps are downscaled
   so the embedded payload stays a sane size. */
const PHOTO_MAX=1200, PHOTO_Q=0.82;
function fileToDataUrl(file){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error("could not read the image")); r.readAsDataURL(file); });
}
function shrinkDataUrl(url){
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{
      const sc=Math.min(1,PHOTO_MAX/Math.max(im.width,im.height));
      if(sc>=1 && url.length<600000){ res({url,w:im.width,h:im.height}); return; }
      const cv=document.createElement("canvas");
      cv.width=Math.max(1,Math.round(im.width*sc)); cv.height=Math.max(1,Math.round(im.height*sc));
      const cx=cv.getContext("2d"); cx.fillStyle="#fff"; cx.fillRect(0,0,cv.width,cv.height);
      cx.drawImage(im,0,0,cv.width,cv.height);
      const out=cv.toDataURL("image/jpeg",PHOTO_Q);
      const rw=cv.width, rh=cv.height; cv.width=cv.height=0;
      res({url:out,w:rw,h:rh});
    };
    im.onerror=()=>res(null);
    im.src=url;
  });
}
async function addPhotoFromFile(file,at){
  if(!S.doc){ setStatus("Open the RFDS before adding photos.",true); return null; }
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
  S.annos.push(a);
  setMode("select"); layoutAnnos(); updateRail(); updateCount();
  selectAnno(a.id);
  const pgEl=document.querySelector(`.page[data-idx="${pi}"]`); if(pgEl&&!at)pgEl.scrollIntoView({behavior:"auto",block:"center"});
  LOG("photo added:",im.w+"x"+im.h,"payload",Math.round(im.url.length/1024)+"KB","page",pi+1);
  setStatus(`Photo added to page ${pi+1} — drag to move, corner handles to resize. It exports as a movable PDF annotation.`);
  return a.id;
}
/* paste a bitmap from the clipboard (screenshot, Snipping Tool, copied image) */
document.addEventListener("paste",async ev=>{
  if(!S.doc)return;
  const dt=ev.clipboardData; if(!dt)return;
  const it=[...(dt.items||[])].find(x=>x.kind==="file"&&/^image\//.test(x.type));
  if(!it)return;                                   // not an image paste — text handlers deal with it
  const file=it.getAsFile(); if(!file)return;
  ev.preventDefault(); ev.stopPropagation();
  const pgEl=pageAtPoint(_ptr.x,_ptr.y);
  let at=null;
  if(pgEl){ const r=pgEl.getBoundingClientRect();
    at={page:+pgEl.dataset.idx, nx:(_ptr.x-r.left)/pgEl.offsetWidth, ny:(_ptr.y-r.top)/pgEl.offsetHeight}; }
  await addPhotoFromFile(file,at);
},true);
$("#photoBtn").onclick=()=>$("#photoFile").click();
$("#photoFile").onchange=async e=>{ const f=e.target.files&&e.target.files[0]; e.target.value=""; if(f)await addPhotoFromFile(f); };

/* ---------- copy / cut / paste redlines (Ctrl+C / Ctrl+X / Ctrl+V) ---------- */
let _ptr={x:innerWidth/2,y:innerHeight/2};
window.addEventListener("pointermove",e=>{ _ptr.x=e.clientX; _ptr.y=e.clientY; },true);
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
function copySelectedAnnos(cut){
  let ids=[]; if(S.selMulti.size)ids=[...S.selMulti]; else if(S.sel!=null)ids=[S.sel];
  if(!ids.length)return false;
  S.clip=ids.map(id=>S.annos.find(a=>a.id===id)).filter(Boolean).map(a=>({..._cleanA(a)}));
  if(cut){ pushHistory(); S.annos=S.annos.filter(a=>!ids.includes(a.id)); clearMulti(); S.sel=null; annobar.classList.remove("show"); layoutAnnos(); updateRail(); updateCount(); }
  toast(`${cut?"Cut":"Copied"} ${S.clip.length} redline${S.clip.length>1?"s":""}`);
  return true;
}
let _placing=null;   // {ids:[...], base:{nx,ny,page}} — pasted group following the cursor
function pasteAnnos(){
  if(!(S.clip&&S.clip.length))return;
  pushHistory();
  const pg=pageAtPoint(_ptr.x,_ptr.y)||document.querySelector(`.page[data-idx="${currentPageIdx()}"]`);
  if(!pg){ toast("Scroll a page into view, then paste."); return; }
  const target=+pg.dataset.idx;
  const r=pg.getBoundingClientRect();
  const px=Math.min(Math.max((_ptr.x-r.left)/pg.offsetWidth,0),1);
  const py=Math.min(Math.max((_ptr.y-r.top)/pg.offsetHeight,0),1);
  const base=S.clip[0];
  clearMulti(); S.sel=null;
  const newIds=[];
  S.clip.forEach(src=>{
    const a={..._cleanA(src),id:seq++,page:target,nx:px+(src.nx-base.nx),ny:py+(src.ny-base.ny)};
    S.annos.push(a); newIds.push(a.id);
  });
  layoutAnnos(); updateRail(); updateCount();
  newIds.forEach(id=>S.selMulti.add(id));
  paintMulti();
  // enter follow-cursor placement: group tracks the mouse until the user clicks
  /* 6eq — carry the pre-paste snapshot and the running delta. Reading the elements' rendered tops back
     at commit time had the same fault dragBody had: a cell redline's rendered top is not its logical
     position, and a layout pass between the preview and the drop would bake the renderer's lift into it.
     The delta is what the gesture actually means. */
  _placing={ids:newIds,page:target,anchor:{px,py},dx:0,dy:0,pre:snapshot()};
  setStatus("Move the pasted redline(s) — click on the page to drop, Esc to keep here.");
}
// while placing, the group follows the cursor; a click (on interface, incl. the moved object) drops it
window.addEventListener("pointermove",e=>{
  if(!_placing)return;
  const pg=document.querySelector(`.page[data-idx="${_placing.page}"]`); if(!pg)return;
  const r=pg.getBoundingClientRect(), w=pg.offsetWidth,h=pg.offsetHeight;
  const nx=(e.clientX-r.left)/w, ny=(e.clientY-r.top)/h;
  const dx=nx-_placing.anchor.px, dy=ny-_placing.anchor.py;
  _placing.dx=dx; _placing.dy=dy;
  _placing.ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); const d=document.querySelector(`.anno[data-id="${id}"]`); if(a&&d){ const bnx=a.nx+dx, bny=a.ny+dy; d.style.left=(bnx*w)+"px"; d.style.top=(bny*h)+"px"; } });
},true);
function commitPlacing(){
  if(!_placing)return;
  const pg=document.querySelector(`.page[data-idx="${_placing.page}"]`);
  if(pg){
    const dx=_placing.dx||0, dy=_placing.dy||0;
    _placing.ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); if(a){ a.nx+=dx; a.ny+=dy; } });
  }
  // keep clip stepping so a subsequent paste offsets slightly
  const P=S.pages[_placing.page]; const off=P?12/P.w1:0.014;
  S.clip=S.clip.map(src=>({...src,nx:src.nx+off,ny:src.ny+off}));
  /* the snapshot from BEFORE the paste, not after it — see dragBody */
  const pre=_placing.pre;
  _placing=null;
  if(pre!=null){ S.history.push(pre); if(S.history.length>80)S.history.shift();
                 S.future=[]; updateUndoUI(); autosave(); }
  else pushHistory();
  layoutAnnos(); updateRail(); updateCount();
  setStatus("Pasted.");
}
window.addEventListener("pointerdown",e=>{ if(_placing){ e.preventDefault(); e.stopPropagation(); commitPlacing(); } },true);
window.addEventListener("keydown",e=>{ if(_placing&&(e.key==="Escape"||e.key==="Enter")){ commitPlacing(); } });
document.addEventListener("keydown",e=>{
  const ae=document.activeElement;
  const editing=ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||(ae.classList&&ae.classList.contains("ed")));
  const sel=window.getSelection&&String(window.getSelection());
  const k=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&k==="c"){
    if(editing||(sel&&sel.length)) return;   // native text copy
    if(copySelectedAnnos(false)) e.preventDefault();
    return;
  }
  if((e.ctrlKey||e.metaKey)&&k==="x"){
    if(editing||(sel&&sel.length)) return;   // native cut in a text box
    if(copySelectedAnnos(true)) e.preventDefault();
    return;
  }
  if((e.ctrlKey||e.metaKey)&&k==="v"){
    if(editing) return;                       // normal paste into a text box
    if(S.clip&&S.clip.length){ e.preventDefault(); pasteAnnos(); }
  }
});

/* ---------- undo / redo wiring ---------- */
$("#undoBtn").onclick=undo;
$("#redoBtn").onclick=redo;
document.addEventListener("keydown",e=>{
  const azOpen=$("#analyzeModal")&&$("#analyzeModal").classList.contains("show");
  if(azOpen){
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){ e.preventDefault(); azUndo(); return; }
    if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.key.toLowerCase()==="z"&&e.shiftKey))){ e.preventDefault(); azRedo(); return; }
  }
  /* 6ex — the narrow guard: a mark's own text or the Analyze grid, not the ribbon's Find box */
  const typing=_editTarget();
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!e.shiftKey){ if(typing)return; e.preventDefault(); undo(); }
  else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==="y"||(e.key.toLowerCase()==="z"&&e.shiftKey))){ if(typing)return; e.preventDefault(); redo(); }
});

/* ---------- zoom ---------- */
$("#zoomIn").onclick=()=>setZoom(S.scale+0.15);
$("#zoomOut").onclick=()=>setZoom(S.scale-0.15);
function resizePageBoxes(){
  S.pages.forEach((P,i)=>{
    if(!P||!P.page)return;
    const pg=document.querySelector('.page[data-idx="'+i+'"]');
    if(!pg)return;
    try{ const vp=P.page.getViewport({scale:S.scale});
      pg.style.width=vp.width+"px"; pg.style.height=vp.height+"px";
      const bb=pg.previousElementSibling;
      if(bb&&bb.classList.contains("page-bar"))bb.style.width=vp.width+"px";
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
function rezoomPages(){
  resizePageBoxes();
  document.querySelectorAll("#pages .page").forEach(pg=>{
    const st=pg.dataset.rendered;
    if(st==="1"||st==="wip"){ const i=+pg.dataset.idx; if(i>=0)unloadPage(i); }
  });
  setupVirtualization();
  try{ layoutAnnos(); }catch(e){}
  try{ drawAllLines(); }catch(e){}
  try{ updateRail(); }catch(e){}
}
/* 6gi — A ZOOM IS NOT A SCROLL. Changing the scale re-lays every page, which moves the document under
   the window and fires `scroll` — and the ribbon's auto-hide reads any downward scroll as "the user is
   reading, get out of the way". So pressing + or − , or ctrl-wheeling, made the ribbon vanish under the
   hand that was using it. Ced: "the buttons and the scroll for zoom should not hide the ribbons."
   The guard is a timestamp rather than a flag: the scroll events a zoom causes arrive after it, some of
   them a frame or two later, and a flag cleared on the next line would already be off. */
let _zoomQuiet=0;
function zoomQuiet(ms){ _zoomQuiet=Date.now()+(ms||700); }
function inZoomQuiet(){ return Date.now()<_zoomQuiet; }
async function setZoom(z,anchor){ 
  zoomQuiet();
  const old=S.scale;
  S.scale=Math.min(3.5,Math.max(0.5,+z.toFixed(2)));
  if(S.scale===old){ resizePageBoxes(); return; }
  resizePageBoxes();          // pin the new box before anything re-renders
  $("#zoomLbl").textContent=Math.round(S.scale*100)+"%";
  if(S.doc){ 
    /* 6ep — page view has ONE page on screen and its own scroller, so the anchor that keeps a point
       under the cursor is the wrong rule there: it drags the page off-centre as it shrinks. Centre it
       instead, which is what "zooming out should stay in the middle" asks for. */
    const inPage=(typeof _pageView!=="undefined")&&_pageView;
    const ax=anchor?anchor.x:window.innerWidth/2, ay=anchor?anchor.y:window.innerHeight/2;
    const docX=(window.scrollX+ax), docY=(window.scrollY+ay);
    const ratio=S.scale/old;
    rezoomPages(); observePages();
    if(inPage) centreCurrentPage();
    else window.scrollTo(docX*ratio-ax, docY*ratio-ay);
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

/* shared: apply a list of {p,op,find,value} marks to the RFDS */
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


/* ---------- Mirror from redlined CDs (photographic read) ---------- */
$("#mirrorBtn").onclick=()=>$("#cdFile").click();
$("#asBuiltBtn").onclick=fillAsBuilt;
/* Mirror from CDs stores discrepancies; this stamps them onto the RFDS as editable marks. */
function updateCdBtn(){
  const b=$("#applyCdBtn"); if(!b)return;
  const n=(S.discrepancies||[]).length;
  b.disabled=!n;
  b.textContent=n?`✨ Apply CD findings (${n})`:"✨ Apply CD findings";
}
function applyCdFindings(){
  if(!S.doc){ setStatus("Open the RFDS first.",true); return; }
  const marks=S.discrepancies||[];
  if(!marks.length){ setStatus("No findings yet — run Mirror from CDs to compare the drawings against the RFDS.",true); return; }
  pushHistory();
  const {applied,missed,first,locked}=applyMarks(marks);
  setMode("select"); selectAnno(null);
  setStatus(`Applied ${applied} CD finding(s)${missed?`, ${missed} not located`:""}${locked?`, ${locked} skipped on locked pages`:""}. Every mark is editable.`);
  if(first){ const pg=document.querySelector(`.page[data-idx="${first.pi}"]`); if(pg)pg.scrollIntoView({behavior:"auto",block:"start"}); }
}
$("#applyCdBtn").onclick=applyCdFindings;
$("#selAllBtn").onclick=selectAllOnPage;
$("#saveBtn").onclick=manualSave;
/* 6dk — the cache button is live whether or not a document is open: what it clears is what the BROWSER
   is holding, which is exactly what you want to empty before opening anything. */
(function(){ const b=$("#cacheBtn"); if(b)b.onclick=clearSavedMarkings; })();
$("#clearBtn").onclick=async()=>{
  if(!S.doc){ setStatus("Open a PDF first.",true); return; }
  const cur=currentPageIdx();
  const choice=await uiConfirm({
    title:"Clear redlines",
    message:`Remove redlines from page ${cur+1} only, or the entire document?\nA backup is saved so you can undo (Ctrl+Z).`,
    buttons:[{id:"page",label:`This page (${cur+1})`,primary:true},{id:"all",label:"Entire document",danger:true},{id:"cancel",label:"Cancel"}]
  });
  if(choice==="page") clearRedlines("page");
  else if(choice==="all") clearRedlines("all");
};
$("#cdFile").onchange=e=>{ if(e.target.files[0]) mirrorFromCDs(e.target.files[0]); e.target.value=""; };
async function mirrorFromCDs(file){
  if(!S.doc){ setStatus("Open the RFDS first.",true); return; }
  showProg("Reading redlined CDs…");
  pushHistory();
  try{
    await ensureWorker();
    const buf=await file.arrayBuffer();
    const cd=await pdfjsLib.getDocument({data:buf}).promise;
    const MAX=16, n=Math.min(cd.numPages,MAX);
    // Render every CD sheet crisp (each is analyzed in its own call, so payload per call stays small)
    const imgs=[];
    for(let p=1;p<=n;p++){
      const page=await cd.getPage(p);
      const vp=page.getViewport({scale:2.1});
      const cv=el("canvas"); cv.width=vp.width; cv.height=vp.height;
      await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;
      imgs.push(cv.toDataURL("image/jpeg",0.7).split(",")[1]);
      cv.width=cv.height=0;
      setProg(p,n,`Rendering CD sheet ${p}/${n}…`);
    }
    if(cd.numPages>MAX) LOG(`CD has ${cd.numPages} pages; reading first ${MAX}.`);
    // RFDS text context (compact; skip locked Existing/Decom pages)
    let rtext="";
    for(let pi=0;pi<S.pages.length;pi++){ if(S.pages[pi].locked)continue; rtext+=`\n[p${pi}] `+S.pages[pi].items.map(t=>t.str.trim()).filter(Boolean).join(" | "); }
    if(rtext.length>12000) rtext=rtext.slice(0,12000);

    const baseRules=`Return ONLY JSON, no prose:
{"discrepancies":[
 {"p":<RFDS page N from [pN]>,"op":"strike_row","find":"<exact Equipment Model on the RFDS row the CD shows REMOVED>","reason":"…"},
 {"p":N,"op":"overlay","find":"<exact RFDS value to correct>","value":"<corrected value from CD>","current":"<RFDS now>","reason":"…"},
 {"p":N,"op":"strike_text","find":"<exact wrong RFDS value the CD replaces>","reason":"…"}
]}

CD SCHEDULE TABLES — read these carefully. The CDs contain a "PLANNED ANTENNA/CABLE SCHEDULE" (the correct as-built config) and an "EXISTING ANTENNA/CABLE SCHEDULE". Columns:
  SECTOR | POS | TECH | MANUFACTURER/MODEL# (the ANTENNA, e.g. CELLMAX 120726) | AZIMUTH (TN) | RAD CENTER | RRU/ODU MODEL (with (n) quantities, e.g. "(1) 4490 B5/B12A") | TMA/DIPLEXER | SURGE PROTECTION/FILTER | COAX/CABLE | LENGTH, then "N TOTAL" summary rows.
  ** The SURGE PROTECTION/FILTER column IS the SQUID model (e.g. DC9-48-60-24-8C-EV). **
Asterisk legend: a leading "*" on an item = EXISTING equipment TO BE REMOVED; "**" = TO BE RELOCATED.
Treat the PLANNED schedule as the correct Final values. Items with "*" in the EXISTING schedule are removed.

Map CD → RFDS:
- SURGE PROTECTION/FILTER (SQUID) model → overlay/correct the RFDS SQUID model to match the CD (this is a common miss — always check it).
- MANUFACTURER/MODEL# antenna (e.g. CELLMAX 120726) → correct the RFDS antenna Vendor/Model.
- AZIMUTH (TN) and RAD CENTER → correct the RFDS Azimuth / Rad Center for that Sec-Pos.
- RRU/ODU MODEL and its (n) quantities, plus "N TOTAL" rows → correct the RFDS RRH models and Final Counts / quantities.
- Any "*" existing item (or a struck bullet on the title sheet) → strike_row on the RFDS Design Summary / (Final) row for that model.
- Red inline corrections (amp ratings, part numbers, fuse-panel notes, revised counts) → overlay the corrected value (or strike_text the wrong one).

Rules:
- Only report REAL differences; if the RFDS already matches the corrected CD, omit it.
- CRITICAL — matching is NOT 1:1 by exact string. The same equipment is often written differently on the CD vs the RFDS (e.g. CD "(1) 4890 B25/B66" ↔ RFDS "4890 B25/B66" or "AIRSCALE ... B25/66"; a radio's band/power wording can differ). Before you strike a row, confirm that equipment is genuinely ABSENT from the CD's corrected/planned config. If the CD's planned schedule still contains that equipment (even under a different name/format), DO NOT strike it — at most correct its value.
- strike_row ONLY for equipment the CD clearly shows as removed (a "*" existing item, a struck bullet, or something not present anywhere in the planned schedule). Never strike a row just because the strings don't match exactly.
- "find" MUST be copied exactly from the RFDS text so it can be located. Prefer the Equipment Model string to locate a row.
- Never target Existing/Decommission RFDS pages (they are excluded below).
- Max ~20 discrepancies for THIS sheet.

RFDS CONTENT (each line: [pN] then that page's cell values separated by " | "):${rtext}`;

    let all=[];
    for(let p=0;p<imgs.length;p++){
      const sheetNote = p===0
        ? `This is the CD TITLE SHEET. Read the bulleted lists "CHANGES ON THE EXISTING AT&T ANTENNA…" and "GROUND SCOPE OF WORK" — the corrected as-built list = un-struck bullets plus every red inline correction.`
        : `This is CD sheet ${p+1}. If it holds a "PLANNED ANTENNA/CABLE SCHEDULE" or "EXISTING ANTENNA/CABLE SCHEDULE", read every row and column (antenna MANUFACTURER/MODEL#, AZIMUTH, RAD CENTER, RRU/ODU MODEL & counts, SURGE PROTECTION/FILTER = SQUID model, and the N TOTAL rows) plus the "*"/"**" removal legend. Also read any other redlines on the sheet.`;
      const prompt=`You are reading ONE redlined AT&T Construction Drawing sheet (image) and comparing it to the current RFDS text below.
${sheetNote}
${baseRules}`;
      $("#ovMsg").textContent=`Claude reading CD sheet ${p+1}/${imgs.length}…`; setProg(p,imgs.length);
      let raw="";
      try{ raw=await askClaude(prompt,[imgs[p]]); }catch(err){ LOG("CD sheet",p+1,"error",err.message); continue; }
      LOG(`CD sheet ${p+1} raw:\n`+raw);
      const j=parseJson(raw); const marks=(j&&(j.discrepancies||j.marks))||[];
      marks.forEach(m=>{ m._cd=p+1; all.push(m); });
      setProg(p+1,imgs.length);
    }
    // filter locked pages + dedupe + resolve conflicts across sheets (accuracy/consistency pass)
    const byKey=new Map();          // exact op+find dedupe (keep first, remember which sheets agreed)
    const byFind=new Map();         // p+find -> ops seen, to resolve strike-vs-correct
    all.forEach(d=>{
      const p=(typeof d.p==="number")?d.p:-1;
      if(p>=0&&S.pages[p]&&S.pages[p].locked) return;
      if(!d.find||!String(d.find).trim()) return;
      const fkey=(d.p)+"|"+String(d.find).trim().toLowerCase();
      const okey=fkey+"|"+d.op;
      (byFind.get(fkey)||byFind.set(fkey,new Set()).get(fkey)).add(d.op);
      if(byKey.has(okey)){ byKey.get(okey)._agree=(byKey.get(okey)._agree||1)+1; return; }
      d._agree=1; byKey.set(okey,d);
    });
    // if the CDs both correct AND strike the same item, prefer the correction (it's being changed, not removed)
    const clean=[];
    byKey.forEach((d,okey)=>{
      const fkey=(d.p)+"|"+String(d.find).trim().toLowerCase();
      const ops=byFind.get(fkey)||new Set();
      if(d.op==="strike_row" && (ops.has("overlay")||ops.has("strike_text"))){ LOG("consolidate: drop strike_row (also corrected)",d.find); return; }
      clean.push(d);
    });
    clean.sort((a,b)=>(b._agree||1)-(a._agree||1));   // sheets that agreed rank first
    S.discrepancies=clean;
    LOG("Discrepancies stored:",clean.length,clean);
    hideProg();
    updateCdBtn();
    setStatus(clean.length
      ? `Found ${clean.length} discrepancy(ies) across ${imgs.length} CD sheets. Click “Apply CD findings” to stamp them. (Console lists each.)`
      : `No discrepancies detected from the CDs. (Console shows each sheet's raw response.)`);
  }catch(e){ hideProg(); setStatus("Mirror from CDs failed: "+e.message,true); LOG("Mirror error",e); }
}

/* ---------- copy list ---------- */
$("#copyBtn").onclick=async()=>{
  const tc=$("#c_text").value,bg=$("#c_bg").value;
  const byPage={}; S.annos.forEach(a=>{(byPage[a.page]=byPage[a.page]||[]).push(a);});
  let html=`<div style="font-family:Arial"><p style="font-family:Arial;font-size:12px;margin:0 0 8px"><b>Redline list — ${esc(S.name||"RFDS")}</b></p>`;
  let plain=`Redline list — ${S.name||"RFDS"}\n`;
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
  if(btn&&btn.disabled){ setStatus("Open an RFDS first — then REDLINE RFDS will export it."); return; }
  try{ await exportPdf(); }
  catch(err){
    LOG("export failed",err&&err.message||String(err)); if(_echoConsole)console.error("[RFDS] export failed:",err);
    setStatus("Export failed: "+((err&&err.message)||err)+" — see the browser console for details.");
    try{ toast("Export failed — "+((err&&err.message)||err)); }catch(e){}
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
    const font=await doc.embedFont(StandardFonts.TimesRoman);
    const fontB=await doc.embedFont(StandardFonts.TimesRomanBold);
    const tc=hexRgb($("#c_text").value), bgc=hexRgb($("#c_bg").value);
    const ctx=doc.context, pages=doc.getPages();
    const author="Redline";
    const col=[tc.r,tc.g,tc.b], bg=[bgc.r,bgc.g,bgc.b];

    // ensure a page has an /Annots array we can push to
    const annotsOf=pg=>{ let a=pg.node.lookup(PDFName.of("Annots")); if(!a){ a=ctx.obj([]); pg.node.set(PDFName.of("Annots"),a); } return a; };

    // build an appearance-stream XObject (Form) so every viewer renders the annotation
    function appearance(w,h,drawOps,useFont,matrix){
      const res=ctx.obj({ Font: ctx.obj({ TR:(useFont?fontB:font).ref }) });
      const dict={ Type:"XObject", Subtype:"Form", FormType:1, BBox:[0,0,w,h], Resources:res };
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
    const measurePt=(t,size,pi,W)=>{
      try{ const v=measureTextNorm(t,size,pi); if(v>0||t==="")return v*W; }catch(e){}
      return font.widthOfTextAtSize(t,size);
    };
    /* 6eg — the export re-wraps with the SAME function the stamp chose the width with, in the same
       normalised units. It used to carry its own copy of the loop; two copies of a wrap rule is how the
       page and the file came to disagree about a trailing space and about the slash before that. The
       canvas metric is the authority here for the same reason it always was: it is what the mark's own
       width and line count were computed from. */
    const wrapToWidth=(text,size,maxW,pi,W)=>redlineWrapLines(text,size,pi,maxW/W);
    const drawText=a=>{
      const pg=pages[a.page]; if(!pg)return; const {width:W,height:H}=pg.getSize();
      const size=a.size||8;
      /* hard breaks first, then width-wrapping inside each one — so a wrapped line can never carry a
         newline into drawText, which is exactly what raised "WinAnsi cannot encode 0x000a". */
      const hard=sanitizePdfText(a.text).split("\n");
      let linesArr=hard;
      if(a.wrap&&a.nw){
        /* 6ea — the box's own width, not a point less. The screen wraps inside exactly `a.nw`, so
           shaving a point off here made the export wrap a hair earlier than the screen did, which on a
           mark that now stops short of its cell is enough to cost a whole extra line. Anything that
           still will not fit grows `boxW` below rather than being clipped. */
        const maxW=Math.max(4,a.nw*W);
        linesArr=[]; hard.forEach(t=>{ wrapToWidth(t,size,maxW,a.page,W).forEach(x=>linesArr.push(x)); });
      }
      linesArr=linesArr.map(s=>s.replace(/\n/g,""));      // belt and braces
      const twMax=Math.max(...linesArr.map(t=>font.widthOfTextAtSize(t,size)),1);
      const boxW=a.nw? Math.max(a.nw*W, twMax) : twMax+4;   // cell redlines keep their measured coverage width
      /* 6dy — the box is sized for the lines THIS renderer produced. pdf-lib measures Times with the
         font's own metrics and the browser measures it with the platform's, so even with the same break
         rule the export can land a value on one more line than the screen recorded — and that extra
         line used to be drawn below the bottom of a box sized for the smaller count, i.e. straight onto
         the page underneath the mark, with the printed value showing through beside it. */
      const nL=Math.max(1,linesArr.length);
      const lineH=(a.wrap&&a.nh)
        ? (a.lineNh!=null?(a.lineNh*H):((a.nh*H)/Math.max(1,a.lines||nL)))
        : size*1.15;
      const boxH=a.nh? Math.max(a.nh*H, a.wrap?lineH*nL:0) : Math.max(lineH*nL, size*1.2)+2;
      let topAdj=0;
      if(a.onCell&&a.nh){
        /* 6ea — the same correction as on screen; see layoutAnnos. */
        const lineBox=((a.lines||1)>1)?((a.nh*H)/a.lines):(a.nh*H);
        const glyph=((a.lineNh!=null?a.lineNh:a.nh)*H);
        topAdj=(lineBox-glyph)/2;                     // matches the on-screen lift
      }
      /* 6ea — the same exemption as on screen; see layoutAnnos. */
      if(a.onCell&&(a.wrap||(a.lines||1)<=1)) topAdj-=REDLINE_DROP*H;   // 2. matches the on-screen drop
      const x0=a.nx*W, topY=H-a.ny*H+topAdj, y0=topY-boxH;
      let ops=`q ${bg[0]} ${bg[1]} ${bg[2]} rg 0 0 ${boxW} ${boxH} re f Q\n`;
      ops+=`q BT /TR ${size} Tf ${col[0]} ${col[1]} ${col[2]} rg\n`;
      linesArr.forEach((ln,li)=>{
        const tw=font.widthOfTextAtSize(ln,size);
        let tx=1;
        if(a.align==="center"){ tx=(boxW-tw)/2;
          if(a.textDx)tx=Math.max(0,Math.min(boxW-tw,tx+a.textDx*W)); }
        else if(a.align==="right")tx=boxW-tw-2;
        else if(a.onCell)tx=REDLINE_LEFT_INSET;        // 1. start exactly on the printed glyph
        /* centre the glyphs in the line box: PDF text sits on its baseline, so drop by the cap height */
        const ty=(a.nh&&!a.wrap)
          ? (boxH-size*0.78)/2
          : boxH-2-(li+1)*lineH+lineH*0.24;
        ops+=`1 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} Tm (${pdfEsc(ln)}) Tj\n`;
      });
      ops+=`ET Q`;
      let rect=[x0,y0,x0+boxW,topY], matrix=null;
      if(a.rot){
        const th=-a.rot*Math.PI/180, c=Math.cos(th), s=Math.sin(th);
        matrix=[c,s,-s,c,0,0];
        const cx=x0+boxW/2, cy=topY-boxH/2;
        const rw=Math.abs(boxW*c)+Math.abs(boxH*s), rh=Math.abs(boxW*s)+Math.abs(boxH*c);
        rect=[cx-rw/2, cy-rh/2, cx+rw/2, cy+rh/2];
      }
      const ap=appearance(boxW,boxH,ops,false,matrix);
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
      const annot=ctx.obj({
        Type:"Annot", Subtype:"FreeText", Rect:rect,
        Contents:PDFString.of(String(a.text)), DA:PDFString.of(da), Q:(a.align==="center"?1:a.align==="right"?2:0),
        F:4, T:PDFString.of(author), CA:1, Border:[0,0,0],
        RFDSRL:PDFString.of("1"), RFDSData:PDFString.of(JSON.stringify(tag)),
        AP: ctx.obj({ N: ap })
      });
      annotsOf(pg).push(ctx.register(annot));
    };
    const drawLine=l=>{
      const pg=pages[l.page]; if(!pg)return; const {width:W,height:H}=pg.getSize();
      /* 6dq — a line has two ENDS, not one height. It was exported as if y2 were y1, which was true of
         every line the tool could make until the cross-out arrived; a diagonal would have come out flat.
         The appearance stream is drawn in the annotation's own box, so the stroke runs corner to corner
         in whichever direction the line actually goes. */
      const x1=l.x1*W, x2=l.x2*W;
      const y1=H-l.y1*H, y2=H-((l.y2!=null?l.y2:l.y1)*H);
      const minx=Math.min(x1,x2), maxx=Math.max(x1,x2);
      const miny=Math.min(y1,y2), maxy=Math.max(y1,y2);
      const pad=2;
      const bw=Math.max(maxx-minx,1)+pad*2, bh=Math.max(maxy-miny,1)+pad*2;
      /* where each end sits inside that box */
      const ax=(x1-minx)+pad, ay=(y1-miny)+pad, bx=(x2-minx)+pad, by=(y2-miny)+pad;
      const ops=`q ${col[0]} ${col[1]} ${col[2]} RG 1.4 w ${ax.toFixed(2)} ${ay.toFixed(2)} m ${bx.toFixed(2)} ${by.toFixed(2)} l S Q`;
      const ap=appearance(bw,bh,ops,false);
      /* 6fd — A LINE HAD NO FINGERPRINT, and that is why reopening a file another tool had touched came
         back with the text but none of the strikes. The Subject payload carries everything, but it is
         METADATA: the stamp tool, Acrobat, a re-save — anything — drops it, and after that the only thing
         that speaks for a mark is the annotation itself. Text annotations have carried RFDSRL/RFDSData
         since they were introduced; lines never did, so `recoverTaggedAnnots` found nothing to rebuild
         and `S.lines=[]` finished the job. Measured on the real form: three strikes exported, three
         restored from the file as written, ZERO after another tool re-saved it. */
      /* 6ff — derived from `_cleanL` for the same reason as the text tag above. The two happened to
         match exactly; now they cannot stop matching. */
      const ltag=Object.assign({}, _cleanL(l), {kind:"line"});
      const annot=ctx.obj({
        Type:"Annot", Subtype:"Line", Rect:[minx-pad,miny-pad,maxx+pad,maxy+pad], L:[x1,y1,x2,y2],
        C:[col[0],col[1],col[2]], IC:[col[0],col[1],col[2]],
        F:4, T:PDFString.of(author), Border:[0,0,1.4], CA:1,
        RFDSRL:PDFString.of("1"), RFDSLine:PDFString.of(JSON.stringify(ltag)),
        AP: ctx.obj({ N: ap })
      });
      annotsOf(pg).push(ctx.register(annot));
    };
    /* photos: embed once, then draw as Stamp annotations with an image appearance stream */
    const imgCache=new Map();
    const dataUrlBytes=u=>{ const b64=String(u||"").split(",")[1]||""; const bin=atob(b64);
      const arr=new Uint8Array(bin.length); for(let k=0;k<bin.length;k++)arr[k]=bin.charCodeAt(k); return arr; };
    for(const a of S.annos.filter(x=>x.kind==="img"&&x.src)){
      try{
        const bytes=dataUrlBytes(a.src);
        const head=a.src.slice(0,40).toLowerCase();
        imgCache.set(a.id, head.indexOf("image/png")>=0 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes));
      }catch(e){ LOG("photo embed failed for",a.id,e&&e.message); }
    }
    const drawImg=a=>{
      const emb=imgCache.get(a.id); const pg=pages[a.page]; if(!emb||!pg)return;
      const {width:W,height:H}=pg.getSize();
      const bw=(a.nw||0.2)*W, bh=(a.nh||0.15)*H;
      const x0=a.nx*W, topY=H-a.ny*H, y0=topY-bh;
      const res=ctx.obj({ XObject: ctx.obj({ Im0: emb.ref }) });
      const ops=`q ${bw.toFixed(2)} 0 0 ${bh.toFixed(2)} 0 0 cm /Im0 Do Q`;
      const dict={ Type:"XObject", Subtype:"Form", FormType:1, BBox:[0,0,bw,bh], Resources:res };
      let rect=[x0,y0,x0+bw,topY];
      if(a.rot){
        const th=-a.rot*Math.PI/180, c=Math.cos(th), s=Math.sin(th);
        dict.Matrix=[c,s,-s,c,0,0];
        const cx2=x0+bw/2, cy2=topY-bh/2;
        const rw=Math.abs(bw*c)+Math.abs(bh*s), rh=Math.abs(bw*s)+Math.abs(bh*c);
        rect=[cx2-rw/2, cy2-rh/2, cx2+rw/2, cy2+rh/2];
      }
      const ap=ctx.register(ctx.stream(ops,dict));
      /* 6fd — a photo is tagged too, but WITHOUT its `src`: the image bytes are already in the file once,
         as this annotation's own XObject, and carrying the data URL a second time would inflate the
         export by a third of every photo. So a photo can be COUNTED on recovery but not rebuilt, and the
         recovery says so out loud rather than quietly dropping it. */
      /* 6ff — `_cleanA` again, minus `src`. The picture itself is deliberately not in the tag: it is
         already in this annotation's own appearance stream, and carrying the data URL a second time
         would add a third of every photo to the export. `recoverPhotoSrcs` reads it back out of that
         appearance stream instead, so a photo is editable without the tag carrying it. */
      const itag=Object.assign({}, _cleanA(a), {kind:"img"});
      delete itag.src;
      const annot=ctx.obj({ Type:"Annot", Subtype:"Stamp", Rect:rect, F:4, T:PDFString.of(author),
        CA:1, Border:[0,0,0], Name:PDFName.of("Photo"),
        RFDSRL:PDFString.of("1"), RFDSPhoto:PDFString.of(JSON.stringify(itag)),
        AP: ctx.obj({ N: ap }) });
      annotsOf(pg).push(ctx.register(annot));
    };
    const drawItems=[];
    /* 6gn — layer 4, not 2, for a mark that is NOT under: the exported page has to put it above the
       strokes at layer 3, exactly as the screen now does. */
    S.annos.forEach((a,idx)=>drawItems.push({kind:(a.kind==="img"?"i":"t"),a,layer:a.under?0:4,z:(a.z||0),idx}));
    /* 6gm — and the SAME order on the exported page as on the screen: a stroke is layer 3, above every
       text mark, not layer 1 underneath them. The two orderings disagreeing would be worse than either
       being wrong, because you would not find out until the PDF was on someone's desk. */
    S.lines.forEach((l,idx)=>drawItems.push({kind:"l",l,layer:3,z:0,idx:1e6+idx}));
    drawItems.sort((p,q)=> (p.layer-q.layer) || (p.z-q.z) || (p.idx-q.idx));
    drawItems.forEach(it=>{ if(it.kind==="t")drawText(it.a); else if(it.kind==="i")drawImg(it.a); else drawLine(it.l); });

    // (Stamp removed — the "REDLINED" stamp is now applied in the separate stamp tool after saving.)

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
    const _payA=z=>{ const o=_cleanA(z); delete o.src; return o; };
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
    const payload={v:1, name:S.name, pages:(S.pages.length-drop.length),
                   stamp:{tcol:$("#c_text").value,bcol:$("#c_bg").value},
                   annos:outAnnos, lines:outLines};
    const _pj="RFDSREDLINE:"+JSON.stringify(payload);
    LOG("Export: the re-edit payload is",_pj.length,"chars for",outAnnos.length,"mark(s) and",
        outLines.length,"line(s)");
    doc.setSubject(_pj);
    doc.setTitle(`${S.name||"RFDS"} (Redlined)`);
    setProg(1,1,"Saving…");
    const bytes=await doc.save({useObjectStreams:false});
    const blob=new Blob([bytes],{type:"application/pdf"});
    const how=await deliverFile(outputFilename()+".pdf",blob);
    hideProg();
    if(how==="declined") setStatus("Export cancelled — the file was not saved.",true);
    else if(how==="blocked") setStatus("This viewer will not save a PDF. Open the tool from the file itself "+
                                      "and export there — the redlines are all still here.",true);
    else setStatus("Redlined PDF saved (vector, original pages intact). Reopen it here to keep editing the redlines.");
    LOG("Export complete, size",blob.size);
    /* 6cn — the prompt used to open on the same tick as the download click, so the dialog could arrive
       before the browser had taken the file. Give the download a moment to start, and only then ask. */
    if(how==="host"||how==="anchor")setTimeout(()=>{ try{ promptStampTool(); }catch(e){} },1600);
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
function promptStampTool(){
  uiConfirm({
    title:"Saved — now add the stamp",
    message:"The redlined PDF has downloaded, without a stamp. Open the stamp tool, load the file you just saved, and redline the stamps onto it there.",
    buttons:[{id:"open",label:"Open stamp tool ↗",primary:true,href:STAMP_URL},{id:"done",label:"Not now"}]
  });
}

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
        const pblob=str(d.get(PDFName.of("RFDSPhoto")));
        /* 6fg — an UNTAGGED Stamp of ours counts too. A file exported before 6fd has no `RFDSPhoto`, and
           if its payload has also been stripped there is nothing left but the annotation itself — so it
           is indexed by WHERE IT IS instead of by id, and the legacy pass looks it up that way. Gated on
           our own author string, so the stamp tool's Stamp is never touched. */
        const untagged=(!pblob&&_name(d,"Subtype")==="Stamp"&&str(d.get(PDFName.of("T")))==="Redline");
        if(!pblob&&!untagged)continue;
        let id=null;
        if(pblob){ try{ id=JSON.parse(pblob).id; }catch(e){} }
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

/* every page's printed runs, read straight from pdf.js and in the same normalised frame the tool uses
   everywhere else, without touching S */
async function tfPageText(u8){
  const doc=await pdfjsLib.getDocument({data:u8}).promise;
  const out=[];
  try{
    for(let p=1;p<=doc.numPages;p++){
      const page=await doc.getPage(p);
      const vp=page.getViewport({scale:1});
      const tc=await page.getTextContent();
      const items=[];
      for(const it of tc.items){
        if(!it.str||!it.str.trim())continue;
        const tx=pdfjsLib.Util.transform(vp.transform,it.transform);
        const fh=Math.hypot(tx[2],tx[3]);
        items.push({str:it.str, nx:tx[4]/vp.width, ny:(tx[5]-fh)/vp.height,
                    nw:(it.width||0)/vp.width, nh:fh/vp.height});
      }
      out.push(items);
    }
  } finally { try{ doc.destroy(); }catch(e){} }
  return out;
}
/* TWO FINGERPRINTS, BECAUSE THEY ANSWER TWO DIFFERENT QUESTIONS.

   `tfTextPrint` is what a page SAYS. It pairs a preliminary page with its counterpart in the final, and
   it has to ignore position or a page whose table has shifted would look like a page that is not there
   at all.

   `tfGeomPrint` is what a page LOOKS LIKE — the same text with each run's position folded in, rounded to
   a thousandth of the page (about 0.6pt at A3). It answers "did anything move", and only that answer may
   be used to let a mark keep its coordinates. Measured on a fixture whose page 6 was pushed down 18pt:
   with text alone the page read as IDENTICAL and every mark on it stayed where it was, 18pt above the
   value it was covering. Two pages can say the same thing and not be the same page. */
function tfTextPrint(items){ return (items||[]).map(t=>_tfNorm(t.str)).join(""); }
function tfGeomPrint(items){
  const r=v=>Math.round((v||0)*1000);
  return (items||[]).map(t=>_tfNorm(t.str)+"@"+r(t.nx)+","+r(t.ny)).join("");
}
/* How much two pages have in common, as a fraction of the larger one. Counting each token once per
   OCCURRENCE matters: a page of "0" cells would otherwise look like every other page of "0" cells.
   The bag is built once per page (`tfBag`) because the alignment below asks this question for every
   preliminary page against every final page. */
function tfBag(items){
  const m=new Map(); let n=0;
  (items||[]).forEach(t=>{ const k=_tfNorm(t.str); if(!k)return; n++; m.set(k,(m.get(k)||0)+1); });
  return {m:m,n:n};
}
function tfSimilarBags(A,B){
  if(!A.n&&!B.n)return 1;
  let hit=0;
  B.m.forEach((cb,k)=>{ const ca=A.m.get(k)||0; hit+=Math.min(ca,cb); });
  const big=Math.max(A.n,B.n);
  return big?hit/big:0;
}
function tfSimilar(a,b){ return tfSimilarBags(tfBag(a),tfBag(b)); }

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
function tfMapPages(pre,fin){
  const np=pre.length, nf=fin.length;
  /* PAIRING is on the text; whether the pair is IDENTICAL is decided by the caller on the geometry */
  const fpP=pre.map(tfTextPrint), fpF=fin.map(tfTextPrint);
  const gpP=pre.map(tfGeomPrint), gpF=fin.map(tfGeomPrint);
  const map=new Array(np).fill(-1);
  if(!np||!nf)return {map:map, fpP:fpP, fpF:fpF, gpP:gpP, gpF:gpF};

  const bagP=pre.map(tfBag), bagF=fin.map(tfBag);
  const sc=new Float64Array(np*nf);
  for(let i=0;i<np;i++)for(let j=0;j<nf;j++){
    let v;
    if(fpP[i]===fpF[j]) v=1;
    else { v=tfSimilarBags(bagP[i],bagF[j]); if(v<TF_MIN_SIM) v=-1; }
    sc[i*nf+j]=v;
  }
  const W=nf+1;
  const best=new Float64Array((np+1)*W);
  const from=new Uint8Array((np+1)*W);   /* 0 pair · 1 this prelim page has no counterpart · 2 this
                                            final page is new */
  for(let i=1;i<=np;i++){
    for(let j=1;j<=nf;j++){
      const up=best[(i-1)*W+j], left=best[i*W+j-1], s=sc[(i-1)*nf+(j-1)];
      let v=-Infinity, f=1;
      if(s>=0){ v=best[(i-1)*W+j-1]+s; f=0; }      /* pairing first, so a tie goes to pairing */
      if(up>v){ v=up; f=1; }
      if(left>v){ v=left; f=2; }
      best[i*W+j]=v; from[i*W+j]=f;
    }
  }
  let i=np, j=nf;
  while(i>0&&j>0){
    const f=from[i*W+j];
    if(f===0){ map[i-1]=j-1; i--; j--; }
    else if(f===1){ i--; }
    else { j--; }
  }
  return {map:map, fpP:fpP, fpF:fpF, gpP:gpP, gpF:gpF};
}
/* the printed run nearest (x,y), optionally the nearest one carrying a given text */
function tfFindRun(items,text,x,y){
  const k=_tfNorm(text);
  let best=null, bestD=Infinity;
  (items||[]).forEach(t=>{
    if(k && _tfNorm(t.str)!==k)return;
    const d=Math.hypot((t.nx+(t.nw||0)/2)-x,(t.ny+(t.nh||0)/2)-y);
    if(d<bestD){ bestD=d; best=t; }
  });
  return best?{item:best,dist:bestD}:null;
}
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
   question answered, and counting the page twice would be the slow way to get the same answer. */
function tfAnchorSet(preItems,finItems){
  const tally=items=>{ const m=new Map();
    (items||[]).forEach(t=>{ const k=_tfNorm(t.str); if(!k)return; m.set(k,(m.get(k)||0)+1); });
    return m; };
  const cp=tally(preItems), cf=tally(finItems);
  const firstF=new Map();
  (finItems||[]).forEach(t=>{ const k=_tfNorm(t.str); if(k&&!firstF.has(k))firstF.set(k,t); });
  const list=[];
  (preItems||[]).forEach(t=>{
    const k=_tfNorm(t.str);
    if(!k||k.length<TF_MIN_TOK)return;
    if(cp.get(k)!==1||cf.get(k)!==1)return;       // one on each side, or it identifies nothing
    const m=firstF.get(k); if(!m)return;
    const ax=t.nx+(t.nw||0)/2, ay=t.ny+(t.nh||0)/2;
    const dx=(m.nx+(m.nw||0)/2)-ax, dy=(m.ny+(m.nh||0)/2)-ay;
    if(Math.abs(dx)>TF_MAX_JUMP||Math.abs(dy)>TF_MAX_JUMP)return;
    list.push({x:ax,y:ay,dx:dx,dy:dy,on:t.str});
  });
  return {list:list, cp:cp, cf:cf, firstF:firstF};
}
function tfAnchors(preItems,finItems){ return tfAnchorSet(preItems,finItems).list; }

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
function tfOnValue(set,preItems,finItems,x,y){
  let best=null,bestD=Infinity;
  (preItems||[]).forEach(t=>{
    if(!_tfNorm(t.str))return;
    const x0=t.nx, x1=t.nx+(t.nw||0), y0=t.ny, y1=t.ny+(t.nh||0.01);
    const ddx=x<x0?x0-x:(x>x1?x-x1:0), ddy=y<y0?y0-y:(y>y1?y-y1:0);
    const d=Math.hypot(ddx,ddy);
    if(d<bestD){ bestD=d; best=t; }
  });
  if(!best||bestD>TF_ON_R)return null;
  const k=_tfNorm(best.str);
  if(k.length<TF_ON_MIN_TOK)return null;
  const bx=best.nx+(best.nw||0)/2, by=best.ny+(best.nh||0)/2;
  const mid=list=>{ const o=[];
    (list||[]).forEach(t=>{ if(_tfNorm(t.str)===k)
      o.push({cx:t.nx+(t.nw||0)/2, cy:t.ny+(t.nh||0)/2}); });
    return o; };
  /* the mark's own column, top to bottom, on each side */
  const col=arr=>arr.filter(c=>Math.abs(c.cx-bx)<=TF_COL_TOL).sort((a,b)=>a.cy-b.cy);
  const pcol=col(mid(preItems)), fcol=col(mid(finItems));
  if(!fcol.length)return null;                     // the value it was placed over is gone from its column
  let pick=null, how="value";
  if(pcol.length===fcol.length){
    /* THE SAME COUNT DOWN THE SAME COLUMN, SO THE k-TH IS THE k-TH. This is the ordinary case on a port
       table: page 25 of Ced's preliminary prints the same model 18 times down one column and the final
       prints it 18 times down the same column. Nearest-in-y would be a guess there and would flag all
       eighteen; the ordinal is not a guess. It is the same argument as the page map — order is the thing
       a document keeps. */
    let idx=-1, bd=Infinity;
    pcol.forEach((c,i)=>{ const d=Math.abs(c.cy-by)+Math.abs(c.cx-bx);
      if(d<bd){ bd=d; idx=i; } });
    pick=fcol[idx];
  } else {
    /* the column gained or lost rows: the k-th is no longer the k-th, so take the nearest and say it is
       a guess. Ced asked to be shown the guesses. */
    let bd=Infinity;
    fcol.forEach(c=>{ const d=Math.abs(c.cy-by); if(d<bd){ bd=d; pick=c; } });
    how="nearby";
  }
  if(!pick)return null;
  const dx=pick.cx-bx, dy=pick.cy-by;
  if(Math.abs(dx)>TF_MAX_JUMP||Math.abs(dy)>TF_MAX_JUMP)return null;
  return {dx:dx,dy:dy,how:how,on:best.str,votes:1};
}
function tfDeltaAt(anchors,x,y){
  if(!anchors||!anchors.length)return {dx:0,dy:0,how:"none",on:"",votes:0};
  const near=anchors.map(a=>({a:a,d:Math.hypot(a.x-x,a.y-y)}))
                    .sort((p,q)=>p.d-q.d).slice(0,TF_ANCHORS);
  const votes=new Map();
  near.forEach(o=>{
    const key=Math.round(o.a.dx*1000)+"|"+Math.round(o.a.dy*1000);
    const v=votes.get(key)||{dx:o.a.dx,dy:o.a.dy,n:0,on:o.a.on};
    v.n++; votes.set(key,v);
  });
  let best=null; votes.forEach(v=>{ if(!best||v.n>best.n)best=v; });
  if(best&&best.n>=2)return {dx:best.dx,dy:best.dy,how:"text",on:best.on,votes:best.n};
  return {dx:near[0].a.dx,dy:near[0].a.dy,how:"nearby",on:near[0].a.on,votes:1};
}

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
/* where a single run went, by the column-ordinal rule tfOnValue uses. Null when it cannot be told. */
function _tfRunMove(preItems,finItems,t){
  const k=_tfNorm(t.str);
  if(!k||k.length<TF_MIN_TOK)return null;
  const tx=t.nx+(t.nw||0)/2, ty=t.ny+(t.nh||0)/2;
  const col=(list)=>{ const o=[];
    (list||[]).forEach(u=>{ if(_tfNorm(u.str)!==k)return;
      const ux=u.nx+(u.nw||0)/2;
      if(Math.abs(ux-tx)<=TF_COL_TOL)o.push({cx:ux,cy:u.ny+(u.nh||0)/2}); });
    return o.sort((a,b)=>a.cy-b.cy); };
  const pc=col(preItems), fc=col(finItems);
  if(!fc.length||pc.length!==fc.length)return null;
  let idx=-1,bd=Infinity;
  pc.forEach((c,i)=>{ const d=Math.abs(c.cy-ty); if(d<bd){ bd=d; idx=i; } });
  if(idx<0)return null;
  const dx=fc[idx].cx-tx, dy=fc[idx].cy-ty;
  if(Math.abs(dx)>TF_MAX_JUMP||Math.abs(dy)>TF_MAX_JUMP)return null;
  return {dx:dx,dy:dy};
}
/* 6fu — THE ROW'S PRINTED HEADING. These forms name every row in the first column, and that name is
   what says whether the row is a Design/As-Built half or a single bare row. A wrapped heading is two
   runs and both are wanted. */
const TF_LABEL_X=0.14;
const TF_SPLIT_RE=/\((?:design|as-?built)\)/i;
function tfRowHead(items,y){
  const got=[];
  (items||[]).forEach(t=>{
    if(t.nx>=TF_LABEL_X)return;
    const ty=t.ny+(t.nh||0.01)/2;
    if(Math.abs(ty-y)<=TF_ROW_BAND+0.003)got.push({y:ty,x:t.nx,s:String(t.str)});
  });
  got.sort((a,b)=>a.y-b.y||a.x-b.x);
  return got.map(g=>g.s).join(" ").replace(/\s+/g," ").trim();
}
function tfRowMove(preItems,finItems,by){
  const votes=new Map();
  (preItems||[]).forEach(t=>{
    if(Math.abs((t.ny+(t.nh||0)/2)-by)>TF_ROW_BAND)return;
    const m=_tfRunMove(preItems,finItems,t);
    if(!m)return;
    /* the vote is on the VERTICAL move: mates sit in different columns and a column may have shifted
       sideways on its own, which would split a vote keyed on both */
    const key=Math.round(m.dy*1000);
    const v=votes.get(key)||{dx:m.dx,dy:m.dy,n:0,on:t.str};
    v.n++; votes.set(key,v);
  });
  let best=null; votes.forEach(v=>{ if(!best||v.n>best.n)best=v; });
  if(!best||best.n<2)return null;          // one mate is not agreement
  return {dx:best.dx,dy:best.dy,how:"row",on:best.on,votes:best.n};
}

/* Read a redlined preliminary and a final, compare them, and work out where every mark would land.
   Nothing is applied here — this is the half the dialog shows you before you commit. */
async function tfPlan(preBytes,finBytes){
  const det=await detachOurRedlines(new Uint8Array(preBytes.slice(0)));
  if(!det||(!det.annos.length&&!det.lines.length))
    return {err:"There are no redlines of this tool's in that preliminary — nothing to transfer."};
  /* the marks are OFF these bytes, so the text read here is the document's own */
  const pre=await tfPageText(det.bytes.slice(0));
  const fin=await tfPageText(new Uint8Array(finBytes.slice(0)));
  const mp=tfMapPages(pre,fin);
  const pageState=mp.map.map(function(j,i){
    /* "same" is the GEOMETRY print: a mark may only keep its coordinates when nothing on the page has
       moved, not merely when the page still says the same words */
    const identical=(j>=0&&mp.gpP[i]===mp.gpF[j]);
    return {from:i,to:j,same:identical,changed:(j>=0&&!identical)};
  });
  const moves=[];
  const anchorCache=new Map();
  const place=(o,isLine)=>{
    const i=o.page|0, st=pageState[i];
    if(!st||st.to<0){ moves.push({o:o,isLine:isLine,to:-1,how:"nopage",dx:0,dy:0,page:i}); return; }
    if(st.same){ moves.push({o:o,isLine:isLine,to:st.to,how:"same",dx:0,dy:0,page:i}); return; }
    const x = isLine ? ((o.x1+o.x2)/2) : (o.nx+(o.nw||0)/2);
    const y = isLine ? ((o.y1+(o.y2==null?o.y1:o.y2))/2) : (o.ny+(o.nh||0.011)/2);
    const ak=i+"|"+st.to;
    if(!anchorCache.has(ak))anchorCache.set(ak,tfAnchorSet(pre[i],fin[st.to]));
    const set=anchorCache.get(ak);
    /* the value under the mark first; the neighbourhood only when there is no value to follow */
    /* the value the mark covers; then, if that value is gone or changed, the rest of its own row;
       and only then the neighbourhood */
    const d = tfOnValue(set,pre[i],fin[st.to],x,y)
           || tfRowMove(pre[i],fin[st.to],y)
           || tfDeltaAt(set.list, x, y);
    /* 6fu — CED'S CALL: LAND ON DESIGN, AND RING IT. When the preliminary printed ONE row where the
       final prints a Design half and an As-Built half, the mark follows its printed value, which puts
       it on the Design row. That is defensible and it is not certain — a correction is often the
       as-built figure, and the tool cannot read intent off a number. Asked which he wanted, Ced chose
       "land on Design, and ring it", so this is not the tool being unsure of its geometry: it is the
       tool saying the DOCUMENT gained a distinction the preliminary did not have. */
    const hp=tfRowHead(pre[i],y), hf=tfRowHead(fin[st.to],y+(d.dy||0));
    const split=!!(hp&&hf&&!TF_SPLIT_RE.test(hp)&&TF_SPLIT_RE.test(hf));
    moves.push({o:o,isLine:isLine,to:st.to,how:d.how,dx:d.dx,dy:d.dy,on:d.on,page:i,
                split:split, headPre:hp, headFin:hf});
  };
  (det.annos||[]).forEach(a=>place(a,false));
  (det.lines||[]).forEach(l=>place(l,true));
  const mapped=pageState.filter(p=>p.to>=0).length;
  return {det:det, pre:pre, fin:fin, pageState:pageState, moves:moves, runs:tfMapRuns(pageState),
          prePages:pre.length, finPages:fin.length,
          same:pageState.filter(p=>p.same).length,
          changed:pageState.filter(p=>p.changed).length,
          gone:pageState.filter(p=>p.to<0).length,
          added:Math.max(0,fin.length-mapped)};
}

/* 6fr — THE MAPPING, IN A FORM A PERSON CAN READ. Ced: "please read the mapping of both pdfs in the
   process." Forty-nine rows of "page n becomes page n" is not reading, it is scrolling, so consecutive
   pages that shift by the same amount and were treated the same way collapse into one line. What is
   left is exactly the interesting part: where the numbering slips, and which stretches changed. */
function tfMapRuns(pageState){
  const runs=[];
  (pageState||[]).forEach(p=>{
    const off=(p.to<0)?null:(p.to-p.from);
    const kind=(p.to<0)?"gone":(p.same?"same":"changed");
    const last=runs[runs.length-1];
    if(last&&last.kind===kind&&last.off===off&&last.a1===p.from-1){ last.a1=p.from; if(p.to>=0)last.b1=p.to; }
    else runs.push({a0:p.from,a1:p.from,b0:p.to,b1:p.to,off:off,kind:kind});
  });
  return runs;
}

/* Apply a plan: the marks, moved onto the final's pages. */
function tfApply(plan){
  const flagged=new Set(), annos=[], lines=[];
  (plan.moves||[]).forEach(mv=>{
    const o=JSON.parse(JSON.stringify(mv.o));
    if(mv.to>=0)o.page=mv.to;
    if(mv.isLine){
      if(mv.dx||mv.dy){ o.x1+=mv.dx; o.x2+=mv.dx;
        const y2=(o.y2==null?o.y1:o.y2); o.y1+=mv.dy; o.y2=y2+mv.dy; }
      lines.push(o);
    } else {
      if(mv.dx||mv.dy){ o.nx+=mv.dx; o.ny+=mv.dy;
        /* the cell fences travel with it, or the next layout snaps the mark back to the old column */
        if(o.cellL!=null)o.cellL+=mv.dx;
        if(o.cellR!=null)o.cellR+=mv.dx;
        if(o.tx0!=null)o.tx0+=mv.dx;
        if(o.cx0!=null)o.cx0+=mv.dx;
        if(o.cy0!=null)o.cy0+=mv.dy; }
      annos.push(o);
    }
    if(mv.split)flagged.add(o.id);
    else if(mv.how!=="same"&&mv.how!=="text"&&mv.how!=="value"&&mv.how!=="row")flagged.add(o.id);
  });
  return {annos:annos,lines:lines,flagged:flagged};
}
async function detachOurRedlines(u8){
  if(!window.PDFLib)return null;
  let doc=null;
  try{ doc=await PDFLib.PDFDocument.load(u8); }
  catch(e){ LOG("detachOurRedlines: could not read the PDF, leaving it alone —",e&&e.message); return null; }
  const {PDFName}=PDFLib;
  const str=v=>{ try{ if(!v)return null;
      if(typeof v.decodeText==="function")return v.decodeText();
      if(typeof v.asString==="function")return v.asString();
      return String(v);
    }catch(e){ return null; } };

  /* the payload, if the file still has one — used only to fill gaps */
  let payA=[], payL=[], stamp=null;
  try{
    const subj=_subjectOf(doc);              /* 6fg — never getSubject(); see _pdfText */
    if(subj&&subj.indexOf("RFDSREDLINE:")===0){
      const d=JSON.parse(subj.slice("RFDSREDLINE:".length));
      payA=(d&&d.annos)||[]; payL=(d&&d.lines)||[]; stamp=(d&&d.stamp)||null;
    }
  }catch(e){ LOG("detachOurRedlines: the payload would not parse; the annotations still speak",e&&e.message); }

  /* 6ff — the pictures first, because reading an appearance stream is async and the removal walk below
     cannot be (removing shifts indices, so it has to run start-to-finish in one pass) */
  let pics=new Map();
  try{ pics=await recoverPhotoSrcs(doc); }
  catch(e){ LOG("photo recovery skipped",e&&e.message); }

  const tagA=[], tagL=[];
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
        const mine=str(d.get(PDFName.of("RFDSRL")));
        const blob=str(d.get(PDFName.of("RFDSData")));
        const lblob=str(d.get(PDFName.of("RFDSLine")));
        const pblob=str(d.get(PDFName.of("RFDSPhoto")));
        if(!mine&&!blob&&!lblob&&!pblob){ other++; continue; }   /* somebody else's — leave it */
        /* A PHOTO, and it depends on whether its picture can be got back. The annotation's tag carries
           the box but NOT the bitmap; the Subject payload does carry `src`, because `_cleanA` keeps it.
           So: payload present -> detach the annotation and restore the photo whole, editable, one copy.
           Payload gone -> leave the annotation alone, count it, say so.
           Getting this wrong doubles the photo on every trip, which is what the first run of this build
           did: it left the annotation on the page AND restored the photo from the payload, so the export
           wrote two — measured, "1 photo stayed" on the first reopen and "2 photos" on the next. */
        if(pblob){
          let ptag=null; try{ ptag=JSON.parse(pblob); }catch(e){}
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
          }
          continue;
        }
        let took=false;
        if(lblob){ try{ const L=JSON.parse(lblob); L.page=pi; tagL.push(L); took=true; }catch(e){} }
        if(!took&&blob){ try{ const m=JSON.parse(blob); m.page=pi; tagA.push(m); took=true; }catch(e){} }
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
          if(str2(d.get(PDFName.of("RFDSRL"))))continue;         /* already handled above */
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
  payA.forEach(a=>{ if(a&&a.id&&a.kind!=="img"&&!haveA.has(a.id)){ annos.push(a); haveA.add(a.id); extraA++; } });
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
      bytes=await doc.save({useObjectStreams:false});
    }catch(e){
      LOG("detachOurRedlines: the rewrite failed, so the marks stay on the page —",e&&e.message);
      return null;              /* better the old behaviour than a broken document */
    }
  }
  LOG("Detached",removed,"of our annotation(s) from the file:",annos.length,"mark(s),",lines.length,
      "line(s)"+(extraA+extraL?(" ("+(extraA+extraL)+" from the payload only)"):"")
      +(photos?("; "+photos+" photo(s) left in place"):"")+"; "+other+" annotation(s) are not ours");
  return {bytes:bytes, annos:annos, lines:lines, photos:photos, removed:removed,
          other:other, stamp:stamp, fromPayload:extraA+extraL};
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
        const mine=str(d.get(PDFName.of("RFDSRL")));
        const blob=str(d.get(PDFName.of("RFDSData")));
        const lblob=str(d.get(PDFName.of("RFDSLine")));
        const pblob=str(d.get(PDFName.of("RFDSPhoto")));
        if(!mine&&!blob&&!lblob&&!pblob)continue;        // not one of ours
        /* a LINE, exact: its two ends and its group, so a cross-out comes back as a cross-out */
        if(lblob){
          try{ const L=JSON.parse(lblob);
            L.page=pi;                                  // trust the page it is actually on
            outLines.push(L); continue;
          }catch(e){}
        }
        /* a PHOTO: seen and counted, but its bitmap lives in the annotation's appearance stream rather
           than in the tag, so it cannot be handed back as an editable mark. Counted so the reopen can
           SAY it, which is the whole difference between a known limit and a silent loss. */
        if(pblob){ photos++; continue; }
        if(blob){
          try{ const m=JSON.parse(blob);
            m.page=pi;                                  // trust the page it is actually on
            out.push(m); continue;
          }catch(e){}
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
      const msg=n+" redline"+(n===1?"":"s")+" on this PDF "+(n===1?"is":"are")+
                " now editable — move, retype or delete "+(n===1?"it":"them")+" and re-export."+
                (d.photos?(" "+d.photos+" photo"+(d.photos===1?"":"s")+
                           " stayed on the page and cannot be edited here."):"");
      try{ toast(n+" redline"+(n===1?"":"s")+" on this PDF "+(n===1?"is":"are")+" editable"); }catch(e){}
      setStatus(msg);
      setTimeout(()=>{ try{ setStatus(msg); }catch(e){} },350);
      return;
    }
    if(!window.PDFLib||!S.docBytes)return;
    const doc=await PDFLib.PDFDocument.load(S.docBytes);
    const subj=_subjectOf(doc);              /* 6fg — never getSubject(); see _pdfText */
    if(!subj||subj.indexOf("RFDSREDLINE:")!==0){
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
        const msg="This RFDS was redlined with this tool — recovered "+n+" redline"+(n===1?"":"s")+
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
    const data=JSON.parse(subj.slice("RFDSREDLINE:".length));
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
  try{ const m=document.getElementById("analyzeModal");
       if(m&&m.classList.contains("show")&&m.contains(ae))return true; }catch(e){}
  return false;
}
/* a ribbon or panel field holding the caret while you work on the document: give it back */
function _releaseChromeFocus(){
  const ae=document.activeElement;
  if(!ae||ae===document.body)return false;
  if(ae.classList&&ae.classList.contains("ed"))return false;      // a mark being edited keeps it
  if(ae.tagName!=="INPUT"&&ae.tagName!=="TEXTAREA")return false;
  try{ const m=document.getElementById("analyzeModal");
       if(m&&m.classList.contains("show")&&m.contains(ae))return false; }catch(e){}
  try{ ae.blur(); }catch(e){}
  return true;
}
document.addEventListener("pointerdown",e=>{
  /* the document itself: a page, a mark, the drawing layer, the page rail */
  if(!e.target||!e.target.closest)return;
  if(e.target.closest(".page")||e.target.closest(".anno")||e.target.closest("svg.draw")
     ||e.target.closest("aside#rail")) _releaseChromeFocus();
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
  ids.forEach(id=>{ const a=S.annos.find(z=>z.id===id); if(!a)return; const {w,h}=dims(a.page); a.nx+=dxpx/w; a.ny+=dypx/h; });
  lids.forEach(id=>{ const l=S.lines.find(z=>z.id===id); if(!l)return; const {w,h}=dims(l.page);
    l.x1+=dxpx/w; l.x2+=dxpx/w;
    const _y2=(l.y2!=null?l.y2:l.y1); l.y1+=dypx/h; l.y2=_y2+dypx/h; });
  layoutAnnos(); if(lids.length)drawAllLines();
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
    const b={..._cleanA(a),id:seq++,nx:a.nx+off,ny:a.ny+off}; S.annos.push(b); newIds.push(b.id); });
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
  S.annos.forEach(a=>items.push({type:"text",page:a.page,id:a.id,label:a.kind==="img"?"🖼 photo":((a.text&&a.text.trim())?a.text:"(empty)")}));
  S.lines.forEach(l=>items.push({type:"line",page:l.page,id:l.id,label:"— strike / line —"}));
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
function toggleMarks(){ const p=$("#marksPanel"); const on=p.classList.toggle("show"); try{ syncEmbossSoon(); }catch(e){} document.body.classList.toggle("markson",on); $("#marksBtn").classList.toggle("tool",on); $("#marksBtn").classList.toggle("active",on); if(on)refreshMarks(); }
$("#marksBtn").onclick=toggleMarks;
$("#marksClose").onclick=toggleMarks;

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
  /* 6gh — Ctrl+Shift+A runs Analyze RFDS. It sits above the plain Ctrl+A below it because that one
     matches on `key==="a"` without checking Shift, so the chord has to be claimed first or it would be
     read as "select everything on this page". */
  if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==="a"){
    if(_editTarget())return;
    e.preventDefault();
    const b=$("#analyzeBtn");
    if(b&&!b.disabled)b.click();
    else setStatus("OPEN AN RFDS FIRST — THERE IS NOTHING TO ANALYZE.",true);
    return;
  }
  // Ctrl+A selects every mark on the page you're looking at
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a"){ if(_editTarget()||!S.doc)return; e.preventDefault(); selectAllOnPage(); return; }
  if(e.ctrlKey||e.metaKey||e.altKey)return;   // leave other combos alone
  if(_typingTarget())return;                   // don't hijack typing
  /* 6bz: the theme hotkey sat below the `if(!S.doc)return` guard, so it did nothing on the opening screen
     even though the help advertised it. Appearance is not a document action — it stays above the guard.
     6cc: it moved from T to D, because T is now Strike text. */
  if(e.key.toLowerCase()==="d"){ toggleTheme(); e.preventDefault(); return; }
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
  /* 6cc — the tool hotkeys, as asked for:
       S select · R redline · W strike row · C copy row · T strike text · L line
     Copy row has carried a "(C)" in its tooltip since it was built with no key behind it. T was the theme
     toggle and is now Strike text; the theme moved to D, above the document guard. */
  const map={s:"select",r:"redline",w:"strikerow",c:"copyrow",t:"cross",l:"line",x:"crossout"};
  if(map[k]){ setMode(map[k]); selectAnno(null); selectLine(null); e.preventDefault(); return; }
  /* 6ey — and ask the browser not to scroll at all on the way in. `preventScroll` is honoured by every
     current engine; the focusin guard above is the belt to this brace, for a click or a Tab. */
  if(k==="f"){ const fi=$("#findInput");
    if(fi&&!fi.disabled){ try{ fi.focus({preventScroll:true}); }catch(err){ fi.focus(); }
                          fi.select(); e.preventDefault(); } return; }
  if(k==="m"){ toggleMarks(); e.preventDefault(); return; }
  if(k==="g"&&(S.selMulti.size>1)){ /* handled in ctrl block; plain g ignored */ }
});

/* Esc drops the current selection (paste-placement and dialogs handle Esc themselves) */
document.addEventListener("keydown",e=>{
  if(e.key!=="Escape"||_placing)return;
  if($("#dlg").classList.contains("show")||$("#analyzeModal").classList.contains("show"))return;
  /* 6ex — Escape is the way OUT of a field as well. A ribbon control holding the caret is what silences
     the plain-letter hotkeys, so Escape gives it back and says so; a second Escape then clears the
     selection as it always did. */
  if(_releaseChromeFocus()){ setStatus("Back to the document — the shortcuts are live again."); return; }
  if(_editTarget())return;
  if(multiCount()||S.sel!=null||S.selLine!=null){ clearMulti(); selectAnno(null); selectLine(null); setStatus("Selection cleared."); }
});

/* ------------------------------------------------------------------------------------------------
   Ctrl-select cells, then give them all one value.
     hold Ctrl (or Cmd) and click cells  ->  Backspace  ->  type the value  ->  Enter
   Works on text cells and on dropdowns alike, in every Analyze grid.
   ------------------------------------------------------------------------------------------------ */
const _azSel=new Set();
function azSelClear(){
  _azSel.forEach(el=>{ try{ el.classList.remove("cellsel"); }catch(e){} });
  _azSel.clear(); azSelHint();
}
function azSelHint(){
  const bar=$("#azSelBar"), msg=$("#azSelMsg");
  if(!bar)return;
  if(!_azSel.size){ bar.classList.remove("show"); return; }
  bar.classList.add("show");
  if(msg)msg.textContent=_azSel.size+" cell"+(_azSel.size===1?"":"s")+" selected — press Backspace, type a value, then Enter";
}
function azSelApply(){
  const inp=$("#azSelVal"); if(!inp)return;
  const val=inp.value;
  const norm=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,"");
  let n=0, skipped=0;
  _azSel.forEach(el=>{
    if(el.tagName==="SELECT"){
      /* a dropdown takes the matching option; an unknown value is added so nothing is silently lost */
      let opt=[...el.options].find(o=>norm(o.value)===norm(val));
      if(!opt&&String(val).trim()){
        opt=document.createElement("option"); opt.value=val; opt.textContent=val; el.appendChild(opt);
      }
      if(opt){ el.value=opt.value; el.dispatchEvent(new Event("change",{bubbles:true})); n++; }
      else skipped++;
    } else {
      el.value=val; el.dispatchEvent(new Event("input",{bubbles:true})); n++;
    }
  });
  setStatus("Set "+n+" cell"+(n===1?"":"s")+' to "'+val+'"'+(skipped?(" — "+skipped+" could not take it"):"")+".");
  inp.value="";
  azSelClear();
}
(function(){
  /* Ctrl+click marks a cell instead of focusing it, so Backspace reaches the document */
  document.addEventListener("mousedown",e=>{
    const modal=$("#analyzeModal");
    if(!modal||!modal.classList.contains("show"))return;
    if(!(e.ctrlKey||e.metaKey))return;
    const t=e.target.closest&&e.target.closest(".az-in");
    const body=$("#azBody");
    if(!t||!body||!body.contains(t))return;
    e.preventDefault(); e.stopPropagation();
    if(_azSel.has(t)){ _azSel.delete(t); t.classList.remove("cellsel"); }
    else { _azSel.add(t); t.classList.add("cellsel"); }
    azSelHint();
  },true);
  document.addEventListener("keydown",e=>{
    if(!_azSel.size)return;
    const inp=$("#azSelVal");
    if(e.key==="Escape"){ azSelClear(); e.preventDefault(); return; }
    if(e.key==="Backspace"&&document.activeElement!==inp){
      e.preventDefault();
      if(inp){ inp.value=""; inp.focus(); }
      return;
    }
    if(e.key==="Enter"&&document.activeElement===inp){ e.preventDefault(); azSelApply(); }
  },true);
  const ap=$("#azSelApply"); if(ap)ap.onclick=azSelApply;
  const cn=$("#azSelCancel"); if(cn)cn.onclick=azSelClear;
})();

/* ---- Analyze grid filter: text match + "changed only" ---- */
let _azFilter="", _azOnlyChanged=false;
function azLinkBarSync(){
  const lm=$("#azLinkModels"); if(lm)lm.checked=linkOn();
  /* The two lane icons drive exactly the state the old checkboxes did. */
  const ll=$("#laneLink");
  if(ll){
    ll.classList.toggle("on",linkOn());
    ll.title="Link models on THIS tab — a correction here reaches every other tab whose Link is also on";
    ll.onclick=()=>{ toggleLinkHere(); renderAnalyze(); };
  }
  /* One mirror, tab-aware: on Antenna Position it drives that tool's flag, elsewhere the sector mirror. */
  const lmr=$("#laneMirror");
  if(lmr){
    const isAnt=(_azTab==="antennaPosition"||_azTab==="antennaExisting"||_azTab==="antennaDecom");
    /* 6cu — the tab decides whether there is anything to mirror at all. Equipment in Calc has no
       sectors, so the icon is disabled there rather than quietly driving another tab's switch. */
    const applies=mirrorApplies();
    let on=false; try{ on=mirrorOn(); }catch(e){}
    lmr.classList.toggle("on",on&&applies);
    lmr.disabled=!applies;
    lmr.style.opacity=applies?"":"0.35";
    lmr.title=!applies
      ? "Mirror does not apply on this tab — there are no sectors to mirror across"
      : (isAnt
        ? "Mirror edits across sectors — Rad Center, Tip Height, Downtilt, Model and Vendor follow the same position in the other sectors. Azimuth mirrors WITHIN its sector instead, across its own positions."
        : "Mirror edits across sectors — editing one sector updates the same equipment in the others");
    lmr.onclick=()=>{ if(!mirrorApplies())return; try{ mirrorToggle(); }catch(e){}
      renderAnalyze(); };
  }
  const t=$("#azLinkTab");
  if(t){
    const names={designSummary:"Design Summary",rfInventory:"RF Inventory",
                 antennaPosition:"Antenna Position",equipmentCalc:"Equipment in Calc"};
    t.textContent="("+(names[linkTabKey()]||"this tab")+")";
  }
  const bar=$("#azLinkBar");
  /* 6ca: Detection and Discrepancies are read-only views. "Changed only", Link and Mirror all act on
     editable rows, so showing them here offers controls that quietly do nothing. */
  /* 6ek — the two icons are hidden where they cannot act: the read-only views, and RFDS Details and
     Site Details, which are one field per row with no model to link by and no sectors to mirror across.
     The row filter beside them still works, so only the two buttons go — `#azLinkBar` does not exist in
     the markup, they live in the filter bar, which is why hiding "the bar" hid nothing. */
  const NO_LANE=["detection","discrepancies","rfdsDetails","siteDetails"];
  const hideLane=(NO_LANE.indexOf(_azTab)>=0);
  [ll,lmr].forEach(b2=>{ if(b2)b2.style.display=hideLane?"none":""; });
  if(bar)bar.style.display=hideLane&&(_azTab==="detection"||_azTab==="discrepancies")?"none":"";
}
function azApplyFilter(){
  const body=$("#azBody"); if(!body)return;
  const q=_azFilter.trim().toLowerCase();
  let shown=0,total=0;
  body.querySelectorAll("table.az tbody tr").forEach(tr=>{
    total++;
    const txt=(tr.textContent||"")+" "+[...tr.querySelectorAll("input,select")].map(i=>i.value||"").join(" ");
    let ok=!q||txt.toLowerCase().indexOf(q)>=0;
    if(ok&&_azOnlyChanged) ok=tr.classList.contains("chg")||tr.classList.contains("struck")||tr.classList.contains("rf-new");
    tr.classList.toggle("az-hide",!ok);
    if(ok)shown++;
  });
  const s=$("#azShown"); if(s)s.textContent=total?`${shown} of ${total} row(s)`:"";
}
(function(){
  const lm=$("#azLinkModels");
  if(lm){ lm.checked=linkOn();
    /* 6cn — the checkbox and the lane icon are the same per-tab switch. */
    lm.onchange=()=>{ if(lm.checked!==linkOn())toggleLinkHere(); renderAnalyze(); }; }
  const fi=$("#azFind"); if(fi)fi.addEventListener("input",()=>{ _azFilter=fi.value; azApplyFilter(); });
  const tg=$("#azOnlyChg");
  if(tg)tg.onclick=()=>{ _azOnlyChanged=!_azOnlyChanged; tg.classList.toggle("on",_azOnlyChanged); azApplyFilter(); };
})();

/* ================= Snap alignment ================= */
const SNAP_TOL=6;   // px
function buildSnapTargets(pg,excludeIds){
  const w=pg.offsetWidth,h=pg.offsetHeight, pi=+pg.dataset.idx;
  const xs=[{v:w/2,kind:"page"}], ys=[{v:h/2,kind:"page"}];
  S.annos.forEach(o=>{ if(o.page!==pi||excludeIds.includes(o.id))return;
    const dd=document.querySelector(`.anno[data-id="${o.id}"]`); if(!dd)return;
    const l=parseFloat(dd.style.left)||0, t=parseFloat(dd.style.top)||0, ow=dd.offsetWidth, oh=dd.offsetHeight;
    xs.push({v:l},{v:l+ow/2},{v:l+ow}); ys.push({v:t},{v:t+oh/2},{v:t+oh});
  });
  return {xs,ys,w,h};
}
function nearest(cands,val){ let best=null,bd=SNAP_TOL+0.001; cands.forEach(c=>{const dd=Math.abs(c.v-val); if(dd<bd){bd=dd;best=c;}}); return best; }
/* snap the box (l,t,w0,h0) so any of its left/center/right hits an x-target, top/mid/bottom hits a y-target */
function applySnap(T,l,t,w0,h0){
  let gx=null,gy=null,nl=l,nt=t;
  const xEdges=[[l,0],[l+w0/2,w0/2],[l+w0,w0]];   // [edgeValue, offsetFromLeft]
  let bestX=null;
  let gxMid=false,gyMid=false;
  xEdges.forEach(([ev,off])=>{ const c=nearest(T.xs,ev); if(c&&(bestX===null||Math.abs(c.v-ev)<bestX.d)){ bestX={v:c.v,off,d:Math.abs(c.v-ev)}; } });
  if(bestX){ nl=bestX.v-bestX.off; gx=bestX.v; gxMid=Math.abs(bestX.off-w0/2)<0.51; }
  const yEdges=[[t,0],[t+h0/2,h0/2],[t+h0,h0]];
  let bestY=null;
  yEdges.forEach(([ev,off])=>{ const c=nearest(T.ys,ev); if(c&&(bestY===null||Math.abs(c.v-ev)<bestY.d)){ bestY={v:c.v,off,d:Math.abs(c.v-ev)}; } });
  if(bestY){ nt=bestY.v-bestY.off; gy=bestY.v; gyMid=Math.abs(bestY.off-h0/2)<0.51; }
  return {l:nl,t:nt,gx,gy,gxMid,gyMid};
}
function clearSnapGuides(pg){ [...pg.querySelectorAll(".snap-g")].forEach(n=>n.remove()); }
function drawSnapGuides(pg,gx,gy,gxMid,gyMid){
  clearSnapGuides(pg);
  if(gx!=null){ const v=el("div","snap-g v"+(gxMid?" mid":"")); v.style.left=gx+"px"; pg.appendChild(v); }
  if(gy!=null){ const hh=el("div","snap-g h"+(gyMid?" mid":"")); hh.style.top=gy+"px"; pg.appendChild(hh); }
}
$("#snapBtn").onclick=()=>{ S.snap=!S.snap; $("#snapBtn").classList.toggle("active",S.snap); toast(S.snap?"Snap on":"Snap off"); };

/* ================= Grouping ================= */
function updateGroupBtn(){ const b=$("#groupBtn"); if(!b)return;
  const n=multiCount();
  const allGrouped=n>0&&multiAnnos().every(a=>a.group!=null)&&multiLines().every(l=>l.group!=null);
  b.disabled=n<2 && !allGrouped;
  b.textContent=allGrouped?"⛓ Ungroup":"⛓ Group";
  b.classList.toggle("active",allGrouped);
}
function selectGroup(gid){
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

/* ================= Preliminary / Final detection + filename ================= */
/* 6fv — ONE LIST OF THINGS THAT ARE NOT A SITE NAME, AND BOTH READERS CONSULT IT. `_atollPick` — the
   geometry reader — has refused these since 6cm, because reading a neighbouring FIELD LABEL as the value
   is exactly the "FA Code" bug. `guessAtollName`, the plain regex, never got the list, and on a form that
   prints its labels as a header row it captured the next one along:

       Site ID | USID | FA Code | ATOLL Site Name | Location Name
       HOAGLOND | OML02713 | 18967 | SIIN002000 | ...

   "ATOLL Site Name" is followed in reading order by "Location", so the regex returned **"Location"** —
   the word Ced saw on the Detection tab — and, being truthy, it also suppressed the pages-1-to-3 re-read
   that exists to find the real name. A wrong answer is worse than none precisely because it stops the
   search. The fourth sweep of this kind in this run of builds. */
const ATOLL_NOT_A_NAME=/^(location|usid|latitude|longitude|structure|market|region|address|cascade|sector|technology|facode|fa|cellname|celldetails|node|enodeb|gnodeb|carrier|band|owner|county|state|city|zip|ground|tower|height|status|date|revision|prepared)/;
const ATOLL_IS_THE_LABEL=/^(atoll|site|name|sitename|atollsitename|atollname)$/;
function _atollBadValue(v){
  const n=String(v||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  return !n || ATOLL_IS_THE_LABEL.test(n) || ATOLL_NOT_A_NAME.test(n);
}
function guessAtollName(txt){
  let m=txt.match(/ATOLL\s*(?:Site\s*)?Name[:\s]*([A-Za-z0-9_.\-]{3,})/i);
  if(m&&!_atollBadValue(m[1]))return m[1].replace(/\.tmp$/i,"");
  m=txt.match(/\bATOLL\b[:\s]*([A-Za-z0-9_.\-]{3,})/i);
  if(m&&!_atollBadValue(m[1]))return m[1].replace(/\.tmp$/i,"");
  return "";
}
/* 6cm — the ATOLL Site Name read off page 1 by GEOMETRY, and tolerantly.
   Two things defeated the earlier attempts. guessAtollName is a regex over the page text, so it needs the
   label and its value to be adjacent in the PDF's READING ORDER — on a two-column cover sheet they are
   routinely dozens of runs apart. And 6cl's version grouped the page into lines by an exact rounded y,
   so a value whose baseline sits a hair off its label's landed in a different "line" and was never seen.
   This version works off the runs themselves: find the label, take the band around it with a real
   tolerance, and read the first value-looking run to its right — or, for a stacked layout, below it. */
function _atollPick(list){
  const out=[];
  for(const t of list){
    const s=String(t.str).trim().replace(/^[:\-–]+\s*/,"");
    if(!s)continue;
    const n=s.toLowerCase().replace(/[^a-z0-9]/g,"");
    if(!n)continue;
    if(ATOLL_IS_THE_LABEL.test(n))continue;                                      // still the label
    /* every other FIELD LABEL this block can run into — reading one of these as the site name is
       exactly the "FA Code" bug. 6fv moved the list to a constant so the regex reader shares it. */
    if(ATOLL_NOT_A_NAME.test(n))break;
    out.push(s);
    if(out.join("").replace(/\s+/g,"").length>=3)break;
  }
  const v=out.join("").replace(/\s+/g,"").replace(/\.tmp$/i,"").trim();
  return /^[A-Za-z0-9_.\-]{3,40}$/.test(v)?v:"";
}
/* 6fv — PAGES 1 TO 3, NOT JUST PAGE 1. Ced: "If the analyze rfds only populates 'Location' on the
   detection tab, automatically reanalyze pages 1-3." 6fm taught the cheap text re-read to try three
   pages for exactly this reason — a cover sheet or a revision-history page in front pushes Site Details
   to 2 or 3 — and the COLUMN-AWARE read, which is the one that gets a header-row form right, was still
   only ever shown page 1. Each page is tried in order and the first real name wins, so a form that
   carries it on page 1 behaves exactly as before. */
function atollFromHeadPages(n){
  for(let pi=0; pi<Math.min(n||3,(S.pages||[]).length); pi++){
    const v=atollFromPage(pi);
    if(v){ if(pi)LOG("ATOLL Site Name found on page",pi+1,"— page 1 had none"); return v; }
  }
  return "";
}
function atollFromPage1(){ return atollFromPage(0); }
function atollFromPage(pi){
  try{
    const P=S.pages&&S.pages[pi|0];
    if(!P||!P.items||!P.items.length)return "";
    const its=P.items;
    const cand=[];
    its.forEach((t,i)=>{ if(/atoll/i.test(String(t.str)))cand.push(i); });
    if(!cand.length)its.forEach((t,i)=>{ if(/^\s*site\s*name\b/i.test(String(t.str)))cand.push(i); });
    if(!cand.length){ LOG("page "+((pi|0)+1)+" re-read: no ATOLL / Site Name label on the page"); return ""; }
    for(const i of cand){
      const L=its[i], ly=L.ny+(L.nh||0)/2, tol=Math.max((L.nh||0.01)*0.9,0.006);
      /* 6cn/6co — BELOW first, and in the label's OWN COLUMN. On this form the labels are a header row
         (Site ID · USID · FA Code · ATOLL Site Name · Location Name) and the values are the row beneath,
         so "below" alone still reaches FA Code's 10000382 two columns to the left. Take the nearest row
         under the label, then keep only what lines up with the label horizontally: same left edge, or an
         overlapping span. Only if nothing sits under it do we look along the row. */
      const dyOf=t=>(t.ny+(t.nh||0)/2)-ly;
      const below=its.filter(t=>{ const dy=dyOf(t); return dy>tol&&dy<0.06; });
      let v="";
      if(below.length){
        const minDy=Math.min.apply(null,below.map(dyOf));
        const rowB=below.filter(t=>Math.abs(dyOf(t)-minDy)<=Math.max(tol,0.004)).sort((a,b)=>a.nx-b.nx);
        const l1=L.nx, r1=L.nx+(L.nw||0);
        const col=rowB.filter(t=>{ const l2=t.nx, r2=t.nx+(t.nw||0);
          return Math.abs(l2-l1)<0.035 || (l2<r1&&r2>l1); });
        v=_atollPick(col);
      }
      if(!v){
        const band=its.filter(t=>Math.abs((t.ny+(t.nh||0)/2)-ly)<=tol).sort((a,b)=>a.nx-b.nx);
        v=_atollPick(band.filter(t=>t.nx>L.nx+(L.nw||0)*0.5));
      }
      if(v){ LOG("ATOLL Site Name read from page "+((pi|0)+1)+" geometry:",v,"(label",JSON.stringify(String(L.str).trim())+")"); return v; }
    }
    LOG("page 1 re-read: found the label but no value beside it —",
        cand.slice(0,3).map(i=>JSON.stringify(String(its[i].str).trim())).join(", "));
  }catch(e){ LOG("page-1 ATOLL read failed:",e&&e.message); }
  return "";
}
/* The reliable marker: on the "Cell Details (Final)" page the USeId column carries a ".tmp" suffix while
   the RFDS is still preliminary. Look there specifically rather than anywhere in the document. */
function tmpInCellDetails(){
  /* The marker is a ".tmp" suffix on USeId values on the Cell Details page. Two things made the previous
     version miss it: it only looked at the FIRST Cell Details page, and it required a run's centre to sit
     within 0.12 of the USeId header's centre — which throws away a value wider than its header, or one
     PDF.js split across runs. Both checks are gone: the page text is joined with NO separator (so
     "…4G" + ".tmp1" and even "tm" + "p1" still read as ".tmp") and every Cell Details page is scanned. */
  let found=false, tmp=false; const pages=[], samples=[], skipped=[];
  for(let pi=0;pi<S.pages.length;pi++){
    const P=S.pages[pi]; if(!P||!P.items||!P.items.length)continue;
    const head=P.items.slice(0,60).map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g,"");
    if(!/celldetails/.test(head))continue;
    /* Only the FINAL table decides this. An Existing or Decommissioned Cell Details page keeps the ".tmp"
       ids it was issued with, so counting those would mark a finished RFDS as preliminary for ever. */
    if(/\(existing\)|existing\)|decommission|decom\b/.test(head) || P.locked){
      skipped.push(pi+1); continue;
    }
    found=true; pages.push(pi+1);
    const joined=P.items.map(t=>String(t.str)).join("");
    if(/\.tmp/i.test(joined)){
      tmp=true;
      P.items.forEach(t=>{ const s=String(t.str);
        if(/\.tmp/i.test(s)&&samples.length<4)samples.push(s.trim()); });
    }
  }
  LOG("Cell Details (Final) page(s):",pages.length?pages.join(", "):"none",
      skipped.length?("· ignored Existing/Decommissioned page(s) "+skipped.join(", ")):"",
      "— .tmp",tmp?("PRESENT → preliminary"+(samples.length?" e.g. "+samples.join(" | "):"")):"absent → final");
  return {found,tmp,pages,skipped};
}
function detectPreliminary(){
  if(!S.pages.length)return;
  const allText=S.pages.map(p=>p.items.map(t=>t.str).join(" ")).join("  \n  ");
  let prelim=false; const reasons=[];
  const cd=tmpInCellDetails();
  if(cd.found){
    prelim=cd.tmp;
    reasons.push(cd.tmp ? 'Cell Details USeId carries ".tmp"' : 'Cell Details USeId has no ".tmp"');
  }
  else {
    /* no Final Cell Details page to judge by: fall back to the document, but only the pages that are
       not Existing / Decommissioned / Notes */
    const openText=S.pages.filter(p=>p&&!p.locked).map(p=>(p.items||[]).map(t=>t.str).join("")).join(" ");
    if(/\.tmp/i.test(openText)){ prelim=true; reasons.push('".tmp" found in the document'); }
  }
  if(/RF\s*Modify\s*Pre[-\s]?Construction\s*RFDS/i.test(allText)){ prelim=true; reasons.push("Current Task: RF Modify Pre-Construction RFDS"); }
  if(/RF\s*Issue\s*Pre[-\s]?Construction\s*RFDS/i.test(allText)){ prelim=true; reasons.push("Current Task: RF Issue Pre-Construction RFDS"); }
  /* Page 1 carries the Site Details block. On the first analyze it is read again here, so the ATOLL Site
     Name is found even when page 1 was not in the analysed range. */
  let site=guessAtollName(allText);
  try{
    /* 6fm — THE FIRST THREE PAGES, not just the first. Ced: "instead of just rereading just page 1,
       reread 1 to 3." The Site Details block is on page 1 on most forms, but a document with a cover
       sheet or a revision-history page in front of it pushes it to 2 or 3, and re-reading only page 1
       found nothing there. Each page is tried in order and the first name found wins, so a form that
       has it on page 1 behaves exactly as before. */
    if(!site&&!S._firstPageReread&&S.pages&&S.pages.length){
      S._firstPageReread=true;
      for(let pi=0; pi<Math.min(3,S.pages.length) && !site; pi++){
        const P=S.pages[pi];
        if(!P||!P.items||!P.items.length)continue;
        const s2=guessAtollName(P.items.map(t=>t.str).join(" "));
        if(s2){ site=s2; LOG("Analyze: page "+(pi+1)+" re-read — ATOLL Site Name",s2); }
      }
      /* 6fv — and if the text of those pages still says nothing, read them by GEOMETRY. The text
         regex needs the label and its value adjacent in reading order; a header-row form puts a whole
         row between them. This is the "reanalyze pages 1-3" Ced asked for. */
      if(!site){
        try{ site=atollFromHeadPages(3); }catch(e){}
        if(site)LOG("Analyze: pages 1-3 re-read by geometry — ATOLL Site Name",site);
      }
      if(!site)LOG("Analyze: pages 1-3 re-read — no ATOLL Site Name on any of them");
    }
  }catch(e){}
  if(site){
    S.atollName=site;
    /* the ATOLL Site Name IS the default Site Name — filled in unless you have typed your own */
    const f=$("#s_site");
    if(f && (!f.value.trim() || !f.dataset.userset)) f.value=site;
    LOG("Site Name defaulted to the ATOLL Site Name:",site);
  }
  S.isPreliminary=prelim;
  showDetection(prelim, reasons.length?reasons:["no preliminary indicators found in the text"]);
}
function showDetection(prelim, reasons){
  const b=$("#detectBanner"); if(!b)return;
  b.classList.remove("prelim","final"); b.classList.add(prelim?"prelim":"final","show");
  $("#detectTag").textContent=prelim?"PRELIMINARY RFDS":"FINAL RFDS";
  $("#detectWhy").textContent=(reasons||[]).join(" · ");
  updateFnamePreview();
}
/* Location: auto-detected, and it defaults to the ATOLL Site Name so the export name is never blank */
/* one field: SITE NAME. It is what the export is named after. */
function siteLocation(){
  return (($("#s_site")&&$("#s_site").value)||S.atollName||S.location||S.name||"").trim();
}
function outputFilename(){
  let site=siteLocation()||"RFDS";
  site=site.replace(/[\\/:*?"<>|]+/g,"").replace(/\s+/g," ").trim()||"RFDS";
  const suffix=S.isPreliminary?"Redlined Preliminary RFDS":"Redlined RFDS";
  return `${site} - ${suffix}`;
}
function updateFnamePreview(){ try{ updateMiniBar(); }catch(e){} const f=$("#detectFname"); if(f)f.title=BUILD_ID; if(f)f.innerHTML=`Export name: <b>${escapeHtml(outputFilename())}.pdf</b>`; }
(function(){ const si=$("#s_site"); if(si)si.addEventListener("input",()=>{ S.atollName=si.value.trim(); if(!(S.location||"").trim())updateFnamePreview(); updateFnamePreview(); }); })();

/* ================= Analyze RFDS ================= */
const int=v=>{ const n=parseInt(String(v).replace(/[^\d-]/g,""),10); return isNaN(n)?0:n; };
/* Antenna values are stamped exactly as the user typed them — no decimal padding.
   Coverage is handled geometrically instead: fitCellBox() keeps the redline at least as wide
   as the printed value, so replacing "95.0" with "96" still hides the original completely. */
function deriveCounts(before,after){
  const b=int(before), a=int(after);
  let removal=0, addition=0;
  if(a>=b) addition=a-b; else removal=b-a;
  return { existing:b, removal, addition, final:a, changed:(b!==a) };
}
/* effective counts for a detail row: use the PDF's printed removals/additions when the user hasn't
   edited before/after (handles rows that are both removed AND added / swaps); derive only after an edit. */
function rowCounts(r){
  /* Counts typed in by hand win over the derived ones (the "Edit counts directly" toggle). */
  if(r.manual&&!r.struck){
    /* Everything hangs off Before and After, which are NEVER moved by this. Existing = Before,
       Final = After, and the one you did not type is derived so the four stay consistent:
           Final = Existing − Removal + Addition
       Type Removal and Addition follows; type Addition and Removal follows.
       2 before / 2 after with Removal 1 therefore gives Addition 1 — after stays 2. */
    const ex=int(r.before), fin=int(r.after);
    const lead=(r.manual.lead==="addition")?"addition":"removal";
    let rm,ad;
    if(lead==="removal"){ rm=int(r.manual.removal); ad=fin-ex+rm; if(ad<0)ad=0; }
    else               { ad=int(r.manual.addition); rm=ex-fin+ad; if(rm<0)rm=0; }
    return { existing:ex, removal:rm, addition:ad, final:fin, changed:!!(rm||ad), manual:true, lead:lead };
  }
  const b=int(r.before), a=int(r.after);
  if(r.struck){
    /* 6fw — ZERO ACROSS ALL FOUR, AND THIS REVERSES AN EARLIER DECISION ON PURPOSE.
       Until now a struck row returned `existing: ex, removal: ex, addition: 0, final: 0` — the reading
       that a strike means "this job removes it", so it still existed and the removal column should say
       so. The note that shipped with it said zeroing all four made the Summary totals that contained a
       struck row too low, and that is still true; see below.
       Ced, naming all four columns: "strikethrough does not make the quantity 0 in all parts. please
       fix. it should be zero across existing, removal, addition, and final count." So a strike means
       the row does not belong in the document at all, not that this job removes it. He is the one
       reading these forms.
       WHAT IT COSTS, stated rather than buried: a printed "Summary by Sector" or "Summary by Site"
       total that included the struck row will now disagree with the sum of the detail rows. That
       disagreement is real and the Discrepancies tab is where it belongs — the tool should report it,
       not paper over it by counting a row the user has struck out. */
    return { existing:0, removal:0, addition:0, final:0, changed:true, struck:true };
  }
  const edited = int(r.origBefore==null?b:r.origBefore)!==b || int(r.origAfter==null?a:r.origAfter)!==a;
  if(!edited && r.printed){
    const ex=int(r.printed.existing), rm=int(r.printed.removals), ad=int(r.printed.additions), fn=int(r.printed.final);
    return { existing:ex, removal:rm, addition:ad, final:fn, changed:(rm>0||ad>0||ex!==fn) };
  }
  return deriveCounts(b,a);
}
/* read the sector ONLY when a page is a single-sector page (title/body mentions exactly one sector).
   Multi-sector pages return "" so the AI assigns each row's sector from its block. */
function pageSector(pi){
  const full=S.pages[pi].items.map(t=>t.str).join(" ");
  const found=new Set(); let m; const re=/sector\s*([A-F])\b/ig;
  while((m=re.exec(full)))found.add(m[1].toUpperCase());
  [["alpha","A"],["beta","B"],["gamma","C"],["delta","D"],["epsilon","E"],["zeta","F"]].forEach(([g,l])=>{ if(new RegExp("\\b"+g+"\\b","i").test(full))found.add(l); });
  return found.size===1 ? [...found][0] : "";
}
/* Which section does a page's HEADER announce? null = no header (continuation of the current section).
   Only the header/top of the page is inspected so table content doesn't trigger false boundaries. */
function pageHeaderKey(pi){
  const P=S.pages[pi];
  const band=P.items.filter(t=>t.ny<0.14);                     // items in the top ~14% of the page (the title bar)
  const src=(band.length>=2?band:P.items.slice(0,40));
  const top=src.map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g," ");
  if(/antenna position/.test(top)){
    if(/decommission/.test(top)) return "antennaDecom";
    if(/existing/.test(top)) return "antennaExisting";
    if(/final/.test(top)) return "antennaPosition";   // only explicit (Final) starts the Final set
    return null;   // bare "Antenna Position" page → continuation of the current antenna category
  }
  /* 6cg — Port Level Details. Existing/Decommissioned variants are read by nothing, the same treatment
     the RF and Non-RF equivalents get. */
  if(/port\s*level/.test(top)){
    if(/existing|decommission|decom/.test(top)) return "other";
    return "portLevel";
  }
  if(/local\s*market\s*note|market\s*notes/.test(top)) return "notes";   // never read, never redlined
  /* 6cb — "Non RF Inventory Details (Final)" CONTAINS the string "rf inventory", so it matched the test
     below and every one of its pages was read into RF Inventory. BBUs and other non-RF kit were landing in
     the RF grid. Test for it first; it is its own section. */
  if(/non\s*-?\s*rf\s*inventory/.test(top)){
    if(/existing|decommission|decom/.test(top)) return "other";   // read but never analysed
    return "nonRfInventory";
  }
  if(/rf inventory/.test(top)){
    if(/existing/.test(top)) return "rfInvExisting";          // read but never analysed
    if(/decommission|decom/.test(top)) return "rfInvDecom";   // ditto — must not be counted
    if(/final/.test(top)) return "rfInventory";
    return null;                                              // bare header: continuation of the current one
  }
  if(/equipment.*calc/.test(top)) return /existing/.test(top) ? "other" : "equipmentCalc";
  if(/design summary/.test(top)) return "designSummary";
  // other clear section titles act as boundaries (stop the current section)
  if(/rfds\s*details/.test(top)) return "rfdsDetails";
  if(/site\s*details/.test(top)) return "siteDetails";
  if(/cell details|site summary|proposed decommission|structural|tower loading|mount analysis|azimuth summary|plumbing|antenna schedule|link budget|power (audit|summary)/.test(top)) return "other";
  return null;
}
function detectSections(){
  const secs={designSummary:[],rfInventory:[],rfInvExisting:[],rfInvDecom:[],nonRfInventory:[],portLevel:[],antennaPosition:[],antennaExisting:[],antennaDecom:[],equipmentCalc:[],rfdsDetails:[],siteDetails:[],notes:[]};
  const keys=[]; let current=null;
  for(let i=0;i<S.pages.length;i++){
    const k=pageHeaderKey(i);
    if(k!==null) current=k;
    keys.push(current);
    if(secs[current]!==undefined) secs[current].push(i);   // continuation pages inherit the running section
  }
  /* RULE: Local Market Notes is never read. Any page mentioning it is pulled out of every section list
     and locked, so no reader touches it and no redline can be placed on it. Its free text was being
     picked up as antenna positions, which is what produced the phantom rows on that tab. */
  const NOTES_RE=/local\s*market\s*note|market\s*notes/;
  /* A page headed simply "Notes" is a notes page too — that is what the RFDS prints, and it was being
     read straight into Equipment in Calculation. Judged on the page's HEADING, not its body. */
  const NOTES_HEAD=P=>{
    const head=(P.items||[]).slice(0,40).map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g,"");
    if(/localmarketnote|marketnotes/.test(head))return true;
    if(/^notes?(page\d|$)/.test(head))return true;
    return /^notes?/.test(head)&&/datetime|creator|category/.test(head);
  };
  const SECT_KEYS=["designSummary","rfInventory","rfInvExisting","rfInvDecom","nonRfInventory","portLevel","antennaPosition",
                   "antennaExisting","antennaDecom","equipmentCalc","rfdsDetails","siteDetails"];
  for(let i=0;i<S.pages.length;i++){
    const P=S.pages[i]; if(!P)continue;
    const full=P.items.map(t=>t.str).join(" ").toLowerCase();
    if(!NOTES_RE.test(full)&&!NOTES_HEAD(P))continue;
    let pulled=[];
    SECT_KEYS.forEach(k=>{ const j=secs[k].indexOf(i); if(j>=0){ secs[k].splice(j,1); pulled.push(k); } });
    if(secs.notes.indexOf(i)<0)secs.notes.push(i);
    P.locked=true;
    LOG("Local Market Notes on page",i+1,"— excluded from",pulled.length?pulled.join(", "):"(no section)",
        "and locked against redlines");
  }
  /* 6ce — Antenna Position read zero rows on a real document.
     `pageHeaderKey` only starts the Final set on an explicit "(Final)", and returns null for a bare
     "Antenna Position" heading so it continues whatever antenna category is already running. On a document
     where NO antenna page ever says Final, Existing or Decommissioned, nothing ever starts one: every such
     page inherits the section that preceded it — usually RF Inventory, which is why its row count comes out
     inflated — and the Antenna Position tab is empty.
     If not one of the three antenna buckets caught a page, adopt every page whose title band names Antenna
     Position as Final, and take those pages back off whichever section absorbed them. */
  if(!secs.antennaPosition.length&&!secs.antennaExisting.length&&!secs.antennaDecom.length){
    const adopt=[];
    for(let i=0;i<S.pages.length;i++){
      if(secs.notes.indexOf(i)>=0)continue;
      const P2=S.pages[i]; if(!P2||!P2.items)continue;
      const band=P2.items.filter(t=>t.ny<0.14);
      const src=(band.length>=2?band:P2.items.slice(0,40));
      const top=src.map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g," ");
      if(/antenna\s*position/.test(top))adopt.push(i);
    }
    if(adopt.length){
      const stolen={};
      SECT_KEYS.forEach(k=>{ adopt.forEach(i=>{ const j=secs[k].indexOf(i);
        if(j>=0){ secs[k].splice(j,1); (stolen[k]=stolen[k]||[]).push(i+1); } }); });
      secs.antennaPosition=adopt.slice();
      LOG("⚠ detectSections: no page reads \"Antenna Position … (Final)\" — adopting page "+
          adopt.map(p=>p+1).join(", ")+" as Antenna Position (Final) from the heading alone"+
          (Object.keys(stolen).length?(" · taken back from "+Object.keys(stolen)
            .map(k=>k+" (page "+stolen[k].join(", ")+")").join(", ")):""));
    }
  }
  /* both sections commonly live on page one, so scan every page for either heading */
  for(let i=0;i<S.pages.length;i++){
    const full=S.pages[i].items.map(t=>t.str).join(" ").toLowerCase().replace(/\s+/g,"");
    if(secs.notes.indexOf(i)>=0) continue;                      // never a Notes page
    if(/rfdsdetails/.test(full) && secs.rfdsDetails.indexOf(i)<0) secs.rfdsDetails.push(i);
    if(/sitedetails/.test(full) && secs.siteDetails.indexOf(i)<0) secs.siteDetails.push(i);
  }
  secs.rfdsDetails.sort((a,b)=>a-b); secs.siteDetails.sort((a,b)=>a-b);
  const covered=new Set([].concat(secs.notes,secs.designSummary,secs.rfInventory,secs.rfInvExisting,secs.rfInvDecom,secs.nonRfInventory,secs.portLevel,secs.antennaPosition,secs.antennaExisting,secs.antennaDecom,secs.equipmentCalc,secs.rfdsDetails,secs.siteDetails));
  const unread=[]; for(let i=0;i<S.pages.length;i++) if(!covered.has(i)) unread.push(i+1);
  LOG("detectSections (ranged):",{designSummary:secs.designSummary,rfInventory:secs.rfInventory,rfInvExisting:secs.rfInvExisting,rfInvDecom:secs.rfInvDecom,nonRfInventory:secs.nonRfInventory,portLevel:secs.portLevel,antennaPosition:secs.antennaPosition,antennaExisting:secs.antennaExisting,antennaDecom:secs.antennaDecom,equipmentCalc:secs.equipmentCalc});
  LOG("Page classification (1-based):", keys.map((k,i)=>((i+1)+":"+(k||"-"))).join(" "));
  LOG(`Coverage: ${covered.size}/${S.pages.length} pages assigned to a section. Not read (no recognized section): ${unread.length?unread.join(", "):"none"}`);
  return secs;
}
/* RFDS Details / Site Details are label:value field pages, not tables */
function detailsPrompt(sec){
  return `You are extracting the "${sec}" page of an AT&T RFDS. Use the page IMAGES plus the page TEXT below.
This page is a list of FIELDS with values (not a table of equipment). For every field on the page return:
- "label": the field label exactly as printed (e.g. "ATOLL Site Name", "Location", "USID", "Latitude", "Structure Type").
- "value": the value printed for that field, verbatim. Use "" when the field is blank.
Return ONLY JSON — no prose, no markdown:
{"rows":[{"label":"Location","value":"HUNTINGTON, WV"}]}
Include every field you can see, in reading order. Max 90 rows.`;
}
function normDetails(rows){
  return (rows||[]).filter(r=>r&&r.label).map(r=>{ const v=r.value!=null?String(r.value):"";
    return { page:(typeof r.p==="number"?r.p:-1), label:String(r.label), value:v, printed:v, struck:false }; });
}
/* Read a label:value field page off the geometry. Labels sit on one line with their values on the
   line beneath, matched by x — and BOTH sections routinely share page one, so the page is split at
   whichever headings it contains rather than being classified as a whole. */
function detailsSectionsOnPage(pi){
  const out={};
  if(!S.pages[pi])return out;
  const lines=pageLines(pi);
  const marks=[];
  lines.forEach((l,i)=>{
    if(/^rfdsdetails/.test(l.norm)||/rfdsdetails$/.test(l.norm)) marks.push({i,key:"rfdsDetails"});
    else if(/^sitedetails/.test(l.norm)||/sitedetails$/.test(l.norm)) marks.push({i,key:"siteDetails"});
  });
  if(!marks.length)return out;
  marks.forEach((m,k)=>{
    const from=m.i+1, to=(k+1<marks.length)?marks[k+1].i:lines.length;
    out[m.key]=(out[m.key]||[]).concat(lines.slice(from,to));
  });
  return out;
}
function readDetailsFromGeometry(pages){
  const res={rfdsDetails:[],siteDetails:[]};
  (pages||[]).forEach(pi=>{
    const secs=detailsSectionsOnPage(pi);
    Object.keys(secs).forEach(key=>{
      const lines=secs[key];
      /* how many of a label line's items find a partner directly under them on some other line */
      const pairUp=(Lx,Vx)=>{
        let paired=0; const pairs=[];
        (Lx.items||[]).forEach(lt=>{
          const lx=lt.nx;
          let best=null,bd=1e9;
          (Vx?Vx.items:[]).forEach(vt=>{ const d=Math.abs(vt.nx-lx); if(d<0.035&&d<bd){bd=d;best=vt;} });
          if(best){ paired++; pairs.push([lt,best]); } else pairs.push([lt,null]);
        });
        return {paired,pairs};
      };
      /* 6da — a HEADER that wrapped is still one header. "Site Lat Decimal" and "Structure Long Decimal"
         break across two lines on this form, and the word "Decimal" underneath was being read as the
         VALUE of the field above it — so the field was called "Structure Long" and its value was
         "Decimal", and the actual number below was never read. A line whose items are plain words with no
         digits, and which pairs up worse than the line after it, is a continuation: it is appended to the
         label nearest it in x and the line below becomes the values. */
      const wordy=Lx=>(Lx.items||[]).length>0&&(Lx.items||[]).every(t=>{
        const v=String(t.str).trim();
        return v.length>0&&v.length<=14&&!/[0-9]/.test(v)&&/^[A-Za-z()\/. -]+$/.test(v);
      });
      /* 6dj — a value that wrapped is not a label. On this form Directions runs to three lines, and the
         second line was read as a field NAME with the third as its value:
             "AND TURN LEFT ONTO N HIGH ST FOLLOW HIGH ST TO W MINER ST…" = "PA842 TO ALLERTON RD…"
         A line carrying prose — any item longer than 24 characters — is the tail of the value above it.
         Skipping it as a label candidate also stops the label/value accounting drifting by one line,
         which is how the field AFTER a long value went missing entirely. */
      const prose=Lx=>(Lx.items||[]).some(t=>String(t.str).trim().length>24);
      for(let i=0;i<lines.length;i++){
        const L=lines[i];
        if(prose(L)&&res[key].length){
          LOG("Details: line skipped as the tail of a wrapped value — "+
              JSON.stringify(String((L.items[0]||{}).str||"").slice(0,40)));
          continue;
        }
        let V=lines[i+1], skipped=0;
        if(!V)break;
        const V2=lines[i+2];
        if(V2&&wordy(V)&&pairUp(L,V).paired<pairUp(L,V2).paired){
          /* fold the continuation into the labels it belongs to */
          V.items.forEach(ct=>{
            let best=null,bd=1e9;
            L.items.forEach(lt=>{ const d=Math.abs(lt.nx-ct.nx); if(d<0.06&&d<bd){bd=d;best=lt;} });
            if(best)best.str=String(best.str).trim()+" "+String(ct.str).trim();
          });
          LOG("Details: a wrapped header joined up — "+L.items.map(t=>JSON.stringify(String(t.str).trim())).join(", "));
          V=V2; skipped=1;
        }
        const up=pairUp(L,V);
        let paired=up.paired; const pairs=up.pairs;
        if(!paired){ continue; }                      // not a label/value pair — skip this line
        pairs.forEach(([lt,vt])=>{
          const label=String(lt.str).trim(); if(!label)return;
          const value=vt?String(vt.str).trim():"";
          res[key].push({ page:pi, label, value, printed:value, struck:false,
            _g: vt?{nx:vt.nx,ny:vt.ny,nw:vt.nw||0,nh:vt.nh||0}
                  :{nx:Math.min(0.95,lt.nx+(lt.nw||0)+0.005),ny:lt.ny,nw:0,nh:lt.nh||0} });
        });
        i+=1+skipped;                                  // consume the value line (and any continuation)
      }
    });
  });
  /* 6dj — Lat and Long come as a PAIR on these forms, so a Lat with no Long is a read that went wrong,
     not a form that omits it. The partner sits on the same printed row as the Lat value, immediately to
     its right; that is enough to recover it by geometry rather than by searching for its label. */
  ["rfdsDetails","siteDetails"].forEach(key=>{
    const have=new Set(res[key].map(r=>String(r.label||"").trim().toLowerCase()));
    res[key].slice().forEach(r=>{
      const lbl=String(r.label||"").trim();
      if(!/\blat\b/i.test(lbl))return;
      const want=lbl.replace(/\blat\b/i,m=>(m===m.toUpperCase()?"LONG":(m[0]===m[0].toUpperCase()?"Long":"long")));
      if(have.has(want.toLowerCase()))return;
      const g=r._g; if(!g||typeof r.page!=="number")return;
      let band=[];
      try{ band=rowBandItems(r.page,g)||[]; }catch(e){ band=[]; }
      const right=band.filter(t=>t.nx>g.nx+Math.max(0.004,(g.nw||0)/2)&&String(t.str).trim())
                      .sort((a,b)=>a.nx-b.nx)[0];
      if(!right)return;
      const v=String(right.str).trim();
      if(!/^-?\d+(\.\d+)?$/.test(v))return;                 // a longitude, not the next field's text
      res[key].push({ page:r.page, label:want, value:v, printed:v, struck:false,
        _g:{nx:right.nx,ny:right.ny,nw:right.nw||0,nh:right.nh||0} });
      have.add(want.toLowerCase());
      LOG("Details: "+JSON.stringify(lbl)+" had no "+JSON.stringify(want)+
          " — recovered "+JSON.stringify(v)+" from the value beside it");
    });
  });
  LOG(`Details read from geometry: RFDS ${res.rfdsDetails.length} field(s), Site ${res.siteDetails.length} field(s)`);
  return res;
}
function detailsRowChanged(r){ return !!(r.struck || String(r.value||"").trim()!==String(r.printed||"").trim()); }
/* pull a field value out of the analysed detail pages by label */
function detailsField(re){
  const A=S.analysis; if(!A)return "";
  for(const k of ["siteDetails","rfdsDetails"]){
    const hit=(A[k]||[]).find(r=>re.test(String(r.label||"")));
    if(hit&&String(hit.value||"").trim())return String(hit.value).trim();
  }
  return "";
}
function ecPrompt(){
  return `You are extracting the "Equipment in Calculation (Active)" table of an AT&T RFDS. Use the page IMAGES plus the page TEXT below.
This table lists each piece of equipment ONCE for the whole site with a SINGLE quantity. It is NOT a per-sector table and has no Existing/Removals/Additions columns.
For each row return:
- "type": one of BBU, ANTENNA, RRH, INTEGRATED ANTENNA RADIO, DIPLEXER, TRIPLEXER, SQUID, SURGE ARRESTOR, FIBER, DC_TRUNK, TMA, RADIO, CABINET (report it in CAPITALS). Treat RRU as RRH. INTEGRATED ANTENNA RADIO is its OWN type — never report it as RRH. A DC trunk is "DC_TRUNK". Read every type present, including DIPLEXER AND TRIPLEXER AND FIBER.
- "model": the exact Equipment Model string exactly as printed (copy verbatim so it can be located).
- "final": the quantity printed for that model on this table.
Return ONLY JSON — no prose, no markdown:
{"rows":[{"type":"Antenna","model":"NNH4-65C-R6","final":6}]}
Read the ENTIRE table; never return an empty list when equipment is visible. Max 120 rows.`;
}
function countPrompt(sec){
  const ds=/design summary/i.test(sec);
  return `You are extracting the "${sec}" table of an AT&T RFDS. Use the page IMAGES plus the page TEXT below.
List EVERY equipment row on this page — do not skip any. For each row return:
- "sector": the ALPHA SECTOR the row belongs to — a single letter A, B, C, D (or Alpha/Beta/Gamma/Delta, or 1/2/3). This is the value in the Sector column of the table. NEVER put an azimuth, a degree value, or a raw number of degrees here. If the table is not grouped by sector, use "".
- "type": equipment type — one of BBU, ANTENNA, RRH, INTEGRATED ANTENNA RADIO, DIPLEXER, TRIPLEXER, SQUID, SURGE ARRESTOR, FIBER, DC_TRUNK, TMA, RADIO, CABINET (report it in CAPITALS). Treat RRU as RRH. INTEGRATED ANTENNA RADIO is its OWN type — never report it as RRH. A DC trunk is "DC_TRUNK". Read EVERY equipment type present, including DIPLEXER AND TRIPLEXER AND FIBER — never relabel a type you can read.
- "model": the exact Equipment Model string exactly as printed (copy verbatim so it can be located).
- the counts, mapped exactly: "existing" = Existing Count column, "removals" = Removals column, "additions" = Additions column, "final" = Final Count column.
Return ONLY JSON — no prose, no markdown:
{"rows":[{"sector":"A","type":"Antenna","model":"NNH4-65C-R6","existing":4,"removals":2,"additions":0,"final":2}]}
Rules:
${ds?`- Extract ONLY the main per-sector equipment DETAIL table — the one whose columns are: Sector | Equipment Type | Equipment Model | Existing Count | Removals | Additions | Final Count. Every detail row HAS an Equipment Model.
- This page may contain MORE than one table. Below the detail table there may be a "Summary by Sector" table (columns: Summary by Sector | Equipment Type | Existing | Removals | Additions | Final) and/or a "Summary by Site" table (…| Final | As-Built). Those totals tables have NO Equipment Model column. DO NOT return any of their rows. If a row has no Equipment Model, skip it.
- The "sector" for each row is the value in that row's Sector column (SITE, A, B, C, D…). Copy it EXACTLY per row. Rows in different blocks have DIFFERENT sectors — do NOT report the same sector for every row. Example mix: [{"sector":"SITE",...},{"sector":"A",...},{"sector":"A",...},{"sector":"B",...},{"sector":"C",...}].
- Return every detail row on the page (these pages often have ~20 rows). Do not stop early.
`:""}- If a table has no Existing/Removals/Additions/Final columns (e.g. an inventory with only a Status column NEW/UPDATE/REMOVE), still return one row per equipment: "existing"=current qty (or 0), "final"=resulting qty; Status REMOVE means final 0.
- This table may continue across pages; a CONTINUATION page often has NO column header. The columns are still, left to right: (Sector,) Equipment Type, Equipment Model, Existing, Removals, Additions, Final — assume that same order.
- Read the ENTIRE table including every sector block (A, then B, then C…). Never return an empty list when equipment is visible. Max 120 rows.`;
}
function antennaPrompt(){
  return `You are extracting "Antenna Position Details (Final)" from an AT&T RFDS. Use the page IMAGES plus the page TEXT. For each antenna position return its values. Return ONLY JSON:
{"rows":[{"p":<page N from [pN]>,"secPos":"<Sector-Position e.g. A1>","vendor":"<antenna vendor>","model":"<antenna model>","radCenterDesign":"<value>","radCenterAsBuilt":"<value>","tipHeight":"<value>","azimuthDesign":"<value>","azimuthAsBuilt":"<value>","mechDowntiltDesign":"<value>","mechDowntiltAsBuilt":"<value>"}]}
Copy each value verbatim as printed; use "" when blank or "-"; max 40 rows.`;
}
function rfInvPrompt(){
  return `You are extracting the "RF Inventory Details (Final)" table from an AT&T RFDS page. Read the table AS PRINTED — its own columns, not counts. First list the column headers in order, then every data row's cell values in the SAME order. Return ONLY JSON:
{"columns":["<header1>","<header2>",...],"rows":[["r1c1","r1c2",...],["r2c1",...]]}
Rules: use the REAL headers on the page (e.g. Sector, Position, Sec-Pos, Technology/Band, Equipment, Manufacturer, Model, Status, Serial, Notes). Copy every value verbatim; use "" for blank cells; keep each row's cell order matching "columns"; include EVERY data row. Do NOT invent Existing/Removals/Additions/Final columns. Max 120 rows.`;
}
/* A Summary table row has a TYPE but no real MODEL, and extraction tends to copy the type into the
   model field. Those rows must never enter the detail set: Summary by Sector and Summary by Site are
   DERIVED from the detail rows, so including them double-counts everything. */
function looksLikeSummaryRow(r){
  const m=String(r.model||"").trim();
  if(!m) return true;
  const mk=m.toUpperCase().replace(/[^A-Z0-9]/g,"");
  const isTypeWord = TYPE_OPTIONS.some(o=>o.toUpperCase().replace(/[^A-Z0-9]/g,"")===mk)
    || /^(INTEGRATEDANTENNARADIO|INTEGRATEDANTENNA|ANTENNARADIO|SURGEARRESTER|TRUNK|DCTRUNKCABLE|TOTAL)$/.test(mk);
  if(isTypeWord && normSector(r.sector)==="SITE") return true;      // the pattern seen in the wild
  if(normModelKey(m)===normModelKey(r.type||"")) return true;        // "model" is just its own type
  return false;
}
function dropSummaryRows(rows,label){
  const keep=[], drop=[];
  (rows||[]).forEach(r=>{ (looksLikeSummaryRow(r)?drop:keep).push(r); });
  if(drop.length) LOG(`${label}: ignored ${drop.length} summary-table row(s) so the derived totals don't double count:`,
    drop.map(r=>normSector(r.sector)+"/"+r.type+"/"+r.model).join(", "));
  return keep;
}
function normCount(rows){
  return (rows||[]).filter(r=>r&&r.model).map(r=>{ const ex=int(r.existing), fn=int(r.final); const ty=canonType(r.type||"");
    const bf=(r.before!=null?int(r.before):ex), af=(r.after!=null?int(r.after):fn);
    return { page:(typeof r.p==="number"?r.p:-1), sector:r.sector||"", origSector:r.sector||"", type:ty, origType:ty, model:String(r.model), origModel:String(r.model),
      before:bf, after:af, origBefore:bf, origAfter:af,
      printed:{existing:ex,removals:int(r.removals),additions:int(r.additions),final:fn}, struck:false }; });
}
/* Equipment in Calculation is a site-wide list: one row per model with a single quantity. */
function normEc(rows){
  return (rows||[]).filter(r=>r&&r.model).map(r=>{ const ty=canonType(r.type||"");
    const cnt=(r.final!=null&&String(r.final).trim()!=="")?int(r.final):int(r.existing);
    return { page:(typeof r.p==="number"?r.p:-1), type:ty, origType:ty,
      model:String(r.model), origModel:String(r.model), count:cnt, printed:cnt, struck:false }; });
}
/* the same model must not appear twice — the table is per model, not per sector */
function dedupeEc(rows){
  const m=new Map();
  (rows||[]).forEach(r=>{ const k=normModelKey(r.origModel||r.model); if(k&&!m.has(k))m.set(k,r); });
  return [...m.values()];
}
function ecRowChanged(r){
  if(r.struck)return true;
  /* a total that already matches the page is not a change — no orange, no redline */
  const countDiff=(String(r.count).trim()!=="")&&(int(r.count)!==int(r.printed));
  const modelDiff=String(r.model||"")!==String(r.origModel||"") && String(r.origModel||"")!=="";
  const typeDiff=canonType(r.type)!==canonType(r.origType||r.type);
  return !!(countDiff||modelDiff||typeDiff);
}
function normAntenna(rows){
  const F=["secPos","vendor","model","radCenterDesign","radCenterAsBuilt","tipHeight","azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt"];
  const AB=[["radCenterAsBuilt","radCenterDesign"],["azimuthAsBuilt","azimuthDesign"],["mechDowntiltAsBuilt","mechDowntiltDesign"]];
  return (rows||[]).filter(r=>r).map(r=>{ const o={page:(typeof r.p==="number"?r.p:-1),struck:false};
    F.forEach(f=>{ o[f]=r[f]!=null?String(r[f]):""; o["_orig_"+f]=o[f]; });   // _orig = value as printed on the PDF
    AB.forEach(([ab,des])=>{ const dv=String(o[des]||"").trim(); if(dv&&!/^[-–—]$/.test(dv)) o[ab]=o[des]; });  // As-Built prefills from Design (not the PDF)
    return o; });
}
async function analyzeRFDS(filterSet){
  if(!S.doc)return;
  /* 6cd — two different ideas were sharing one flag.
       SCOPE   = which pages to read.
       PARTIAL = merge what is read into an analysis that already exists.
     They were the same variable, so a page filter on the FIRST run was ignored entirely: `partial` was
     false without an existing analysis, and `inSel` then let every page through. Splitting them is what
     makes "read only these pages" possible before anything has been read. */
  const scope = (filterSet && filterSet.size>0) ? filterSet : null;
  const partial = !!(scope && S.analysis);
  const scoped = !!scope;
  $("#analyzeBtn").disabled=true;
  openAnalyze();
  if(!partial){ $("#azTabs").innerHTML="";
    $("#azBody").innerHTML='<div class="az-empty">'+(scoped?("Reading "+scope.size+" page"+(scope.size===1?"":"s")+"…"):"Reading every page…")+'</div>'; }
  $("#azApply").disabled=true;
  $("#azSub").textContent = partial ? "Re-reading selected pages…"
    : (scoped ? ("Reading the "+scope.size+" page"+(scope.size===1?"":"s")+" you chose…")
              : "Reading every page and extracting each section…");
  showProg(partial?"Re-analyzing selected pages…":(scoped?"Analyzing the selected pages…":"Analyzing RFDS…"));
  try{
    detectPreliminary();
    const secs=detectSections();
    const A = partial ? S.analysis : {designSummary:[],rfInventory:{columns:[],rows:[]},nonRfInventory:{columns:[],rows:[]},portLevel:{columns:[],rows:[]},antennaPosition:[],antennaExisting:[],antennaDecom:[],equipmentCalc:[],rfdsDetails:[],siteDetails:[]};
    A.notesPages=secs.notes.slice();      // 6cc: read-only, never redlined — the BBU cross-check reads it
    A.scope = scoped ? [...scope].sort((a,b)=>a-b) : null;
    A.scopeAll = !scoped;
    A.pagesFor={designSummary:secs.designSummary,rfInventory:secs.rfInventory,nonRfInventory:secs.nonRfInventory,portLevel:secs.portLevel,antennaPosition:secs.antennaPosition,antennaExisting:secs.antennaExisting,antennaDecom:secs.antennaDecom,equipmentCalc:secs.equipmentCalc,rfdsDetails:secs.rfdsDetails,siteDetails:secs.siteDetails};
    const inSel=pi=>!scope||scope.has(pi);
    /* On a FRESH scoped run, `pagesFor` must describe what was actually read. Leaving the full section
       page lists there would send the apply pass hunting for tables on pages nobody looked at, and
       anchor rows against geometry that was never checked. A partial re-read keeps the full lists —
       those pages really were read, just earlier. */
    if(scoped&&!partial){
      Object.keys(A.pagesFor).forEach(k=>{ A.pagesFor[k]=(A.pagesFor[k]||[]).filter(inSel); });
      LOG("Analyze scope: pages "+[...scope].sort((a,b)=>a-b).map(p=>p+1).join(", "));
    }
    const _allJobs=[
      ["designSummary","Design Summary",secs.designSummary,countPrompt("Design Summary"),normCount],
      ["equipmentCalc","Equipment in Calculation (Active)",secs.equipmentCalc,ecPrompt(),normEc],

      ["antennaPosition","Antenna Position Details (Final)",secs.antennaPosition,antennaPrompt(),normAntenna],
      ["antennaExisting","Antenna Position Details (Existing)",secs.antennaExisting,antennaPrompt(),normAntenna],
      ["antennaDecom","Antenna Position Details (Decommissioned)",secs.antennaDecom,antennaPrompt(),normAntenna],
    ];
    const selPages=arr=>arr.filter(inSel);
    /* 6cf — Antenna Position from geometry first; only pages geometry could not read go to the model, so a
       build with no API still fills this tab.
       This sits BELOW `const selPages` deliberately. It was written above it, where `selPages` is still in
       its temporal dead zone — the call threw, the outer catch swallowed it, and the tab came back empty
       with no error on screen. Exactly the shape of hard-won rule 1. */
    const antGeoDone={};
    ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>{
      const pgs=selPages(secs[k]||[]);
      if(!pgs.length)return;
      let rows=[];
      try{ rows=readAntennaFromGeometry(pgs); }
      catch(e){ LOG("Antenna geometry failed on",k,e&&e.message||String(e)); }
      if(!rows.length){ LOG("Antenna geometry: nothing read for "+k+" — leaving those pages to the model"); return; }
      const prev=(partial&&A[k])?A[k].filter(r=>!filterSet.has(r.page)):[];
      A[k]=prev.concat(rows);
      antGeoDone[k]=new Set(pgs);
      LOG("Antenna "+k+": "+rows.length+" row(s) read from geometry — no AI request needed");
    });
    /* 6et — AND THE SAME FOR DESIGN SUMMARY AND EQUIPMENT IN CALC. Both were read by the model first and
       then overwritten by the page's own geometry a few lines below ("prefer the page itself"), so every
       run spent a request per page on an answer it threw away — and on a build with no API each of those
       requests was a failed round trip you waited for. Measured on the real form with every request
       aborted: Design Summary 53 rows, Equipment in Calc's printed table 9 rows, Antenna 6, RF 22, Port
       Level 48 — the whole document, from geometry. So probe the geometry FIRST (it is local and free)
       and drop the job when it answers. The model stays as the fallback it should always have been. */
    const geoDone={};
    try{ const _p=selPages(secs.designSummary);
         if(_p.length&&readDsFromGeometry(_p).length)geoDone.designSummary=true; }
    catch(e){ LOG("Design Summary geometry probe failed:",e&&e.message); }
    try{ const _p=selPages(secs.equipmentCalc);
         if(_p.length){ const t=readEcFromGeometry(_p);
           if(t&&t.columns&&t.columns.length>=2&&t.rows&&t.rows.length)geoDone.equipmentCalc=true; } }
    catch(e){ LOG("Equipment in Calc geometry probe failed:",e&&e.message); }
    Object.keys(geoDone).forEach(k=>LOG(k+": read from geometry — no request needed"));
    const jobs=_allJobs.filter(j=>!antGeoDone[j[0]]&&!geoDone[j[0]]);
    const total=(jobs.reduce((n,j)=>n+selPages(j[2]).length,0)+selPages(secs.rfInventory).length)||1; let step=0;
    for(const [key,label,pagesIdx,prompt,norm] of jobs){
      const pages=selPages(pagesIdx);
      if(!pages.length){ if(!partial)LOG("Analyze: no pages for",key); continue; }
      const acc=[];
      for(const pi of pages){
        setProg(step,total,`Reading ${label} (page ${pi+1})…`); step++;
        const P=S.pages[pi]; let img=null;
        try{ if(!P.jpg)P.jpg=await captureJpg(P,2.0); img=await P.jpg; }catch(_){}
        let txt=P.items.map(t=>t.str.trim()).filter(Boolean).join(" | "); if(txt.length>15000)txt=txt.slice(0,15000);
        const full=prompt+"\n\nPAGE TEXT (cells separated by \" | \"):\n"+txt;
        let raw="";
        try{ raw=img?await askClaude(full,[img]):await askClaudeText(full); }
        catch(err){ LOG("Analyze",key,"p"+(pi+1),"error",err&&err.message); }
        let j=parseJson(raw)||{}; let rows=norm(j.rows||j.items||[]);
        if(!rows.length){ try{ const raw2=await askClaudeText(full); j=parseJson(raw2)||{}; rows=norm(j.rows||j.items||[]); }
          catch(err){ LOG("Analyze",key,"p"+(pi+1),"text-only error",err&&err.message); } }
        rows.forEach(r=>{ r.page=pi;
          if(key.indexOf("antenna")!==0){ const s=normSector(r.sector);
            if(!(s&&/^[A-F1-9]$/.test(s))){ const ps=pageSector(pi); if(ps)r.sector=ps; }
          }
        });
        LOG(`Analyze ${key} page ${pi+1}: ${rows.length} row(s)`);
        acc.push(...rows);
      }
      // partial: replace only rows from the re-read pages; keep edits on other pages
      A[key] = partial ? (A[key]||[]).filter(r=>!filterSet.has(r.page)).concat(acc) : acc;
    }
    /* Port Level Details (Final) — geometric. Checked against Antenna Position and redlined from it. */
    const plvPages=selPages(secs.portLevel);
    if(plvPages.length){
      setProg(step,total,"Reading Port Level Details…");
      const g3=readPortLevelFromGeometry(plvPages);
      A.portLevel={columns:g3.columns,rows:g3.rows};
    } else if(!partial){
      A.portLevel={columns:[],rows:[]};
      LOG("Port Level: no such section in this document");
    }
    /* Non RF Inventory Details (Final) — read-only, geometric, never redlined. Used by Discrepancies. */
    const nrfPages=selPages(secs.nonRfInventory);
    if(nrfPages.length){
      setProg(step,total,"Reading Non RF Inventory…");
      const g2=readNonRfFromGeometry(nrfPages);
      A.nonRfInventory={columns:g2.columns,rows:g2.rows};
      LOG(`Non-RF Inventory read from geometry: ${g2.rows.length} row(s), columns: ${g2.columns.join(" | ")}`);
    } else if(!partial){
      A.nonRfInventory={columns:[],rows:[]};
      LOG("Non-RF Inventory: no such section in this document");
    }
    // RF Inventory (Final): read straight from the page geometry — no AI, no string matching
    const rfPages=selPages(secs.rfInventory);
    if(rfPages.length){
      setProg(step,total,"Reading RF Inventory…"); step+=rfPages.length;
      const geo=readRfFromGeometry(rfPages);
      const prevRows=(partial&&A.rfInventory&&A.rfInventory.rows)?A.rfInventory.rows:[];
      const kept=partial ? prevRows.filter(r=>r.inserted||!filterSet.has(r.page)) : prevRows.filter(r=>r.inserted);
      if(geo.rows.length){
        A.rfInventory={columns:geo.columns, rows:kept.concat(geo.rows)};
        LOG(`RF Inventory read from geometry: ${geo.rows.length} row(s), columns: ${geo.columns.join(" | ")}`);
      } else {
        A.rfInventory={columns:geo.columns.length?geo.columns:((A.rfInventory&&A.rfInventory.columns)||[]), rows:kept};
        LOG("RF Inventory: no rows could be read from the page geometry — check the header row");
      }
    }
    // Antenna: autofill each blank As-Built from its Design value (idempotent — only fills blanks)
    (A.antennaPosition||[]).forEach(r=>{
      [["radCenterAsBuilt","radCenterDesign"],["azimuthAsBuilt","azimuthDesign"],["mechDowntiltAsBuilt","mechDowntiltDesign"]].forEach(([ab,des])=>{
        const abv=String(r[ab]||"").trim(), dv=String(r[des]||"").trim();
        if((abv===""||/^[-–—]$/.test(abv)) && dv!=="" && !/^[-–—]$/.test(dv)) r[ab]=r[des];
      });
    });
    /* prefer the page itself; the extraction is only a fallback when the table can't be read */
    {
      const dsGeoRows=readDsFromGeometry(selPages(secs.designSummary));
      if(dsGeoRows.length){
        const keptIns=(A.designSummary||[]).filter(r=>r.inserted);
        const kept=partial?(A.designSummary||[]).filter(r=>!r.inserted&&!filterSet.has(r.page)):[];
        A.designSummary=kept.concat(dsGeoRows,keptIns);
        LOG("Design Summary taken from page geometry — extraction not used for counts");
      } else {
        A.designSummary=dropSummaryRows(A.designSummary,"Design Summary");
        correctDetailCounts(secs.designSummary, A.designSummary, partial?filterSet:null);
      }
    }
    A.equipmentCalc=dedupeEc(A.equipmentCalc);
    correctEcCount(secs.equipmentCalc, A.equipmentCalc, partial?filterSet:null);
    LOG("EC rows extracted:", (A.equipmentCalc||[]).length);
    S.analysis=A;
    /* read the printed Equipment in Calc table so its tab can mirror the page */
    try{
      const _ecPages=(A.pagesFor&&A.pagesFor.equipmentCalc)||[];
      if(_ecPages.length){
        const _t=readEcFromGeometry(_ecPages);
        if(_t&&_t.columns&&_t.columns.length>=2&&_t.rows&&_t.rows.length){ A.ecTable=_t; _ecCols=null;
          try{ assignColMeasures({ecTable:_t}); }catch(e){} }
      }
    }catch(e){ LOG("EC table read failed:",e&&e.message); }
    let dsName=detailsField(/atoll\s*(site\s*)?name/i)||detailsField(/^site\s*name/i);
    /* 6cl/6co — EVERY analyze goes back to page 1 for the ATOLL Site Name, first run or re-run, whether
       or not page 1 was in the scope that was read. And page 1 now WINS: the details grid pairs labels to
       values by its own rules and on a header-row form it was handing back the neighbouring column (FA
       Code). The page-1 read is column-aware, so where the two disagree the geometry is the one to trust.
       Both are logged, so a wrong answer can be traced without guessing. */
    {
      S._atollP1=true;
      const p1=atollFromHeadPages(3);
      if(p1&&p1!==dsName){
        if(dsName)LOG("ATOLL Site Name: page 1 says",p1,"and the details grid says",dsName,"— using page 1");
        else LOG("Site Name taken from the page-1 read:",p1);
        dsName=p1;
      }
    }
    /* 6fv — and a "name" that is one of the field labels is not a name. The details grid can hand back
       "Location" from the same header-row shape the regex fell for; taking it would put the word Ced
       reported straight onto the Detection tab. */
    if(dsName&&_atollBadValue(dsName)){
      LOG("Site Name: the details grid offered",JSON.stringify(dsName),
          "— that is a field label, not a site name; ignored");
      dsName="";
    }
    if(dsName){ S.atollName=dsName; if($("#s_site"))$("#s_site").value=dsName; }
    else if(S.atollName&&_atollBadValue(S.atollName)){
      LOG("Site Name: clearing",JSON.stringify(S.atollName),"— it is a field label, not a site name");
      S.atollName=""; const _f=$("#s_site"); if(_f&&!_f.dataset.userset)_f.value="";
    }
    const loc=detailsField(/^location$/i)||detailsField(/location/i)||detailsField(/site\s*address/i);
    if(loc){ S.location=loc; }
    if(!S.location) S.location=S.atollName||"";
    updateFnamePreview&&updateFnamePreview();
    /* RFDS / Site Details come from the page, not the model: labels and values are positioned data */
    {
      const dPages=[...new Set([].concat(secs.rfdsDetails,secs.siteDetails))].filter(inSel);
      if(dPages.length){
        const d=readDetailsFromGeometry(dPages);
        ["rfdsDetails","siteDetails"].forEach(k=>{
          const prev=(partial&&A[k])?A[k].filter(r=>!filterSet.has(r.page)):[];
          if(d[k].length||!partial) A[k]=prev.concat(d[k]);
        });
      }
    }
    /* 6ej — read the ruled lines off every page that carries a table, before anything is measured
       against them. One render per page, cached on the page. */
    try{
      const _rp=[...new Set([].concat(...Object.values(A.pagesFor||{})))].filter(i=>S.pages[i]);
      let _nr=0;
      for(const i of _rp){ const r=await scanPageRules(i); if(r&&r.v&&r.v.length>1)_nr++; }
      if(_rp.length)LOG("Ruled lines: read from "+_nr+" of "+_rp.length+" table page(s)");
    }catch(e){ LOG("ruled lines:",e&&e.message||String(e)); }
    try{ assignColMeasures(A); }catch(e){ LOG("column measures:",e&&e.message||String(e)); }
    A._dsGeo=captureDsGeometry(secs.designSummary, A.designSummary);   // positions for apply
    A._defaults=azSnapshot(A);   // remember what the tool read, for "Restore default"
    _azHist=[]; _azFuture=[];     // fresh undo history after a (re)analysis
    S.analysis=A;
    /* read the printed Equipment in Calc table so its tab can mirror the page */
    try{
      const _ecPages=(A.pagesFor&&A.pagesFor.equipmentCalc)||[];
      if(_ecPages.length){
        const _t=readEcFromGeometry(_ecPages);
        if(_t&&_t.columns&&_t.columns.length>=2&&_t.rows&&_t.rows.length){ A.ecTable=_t; _ecCols=null;
          try{ assignColMeasures({ecTable:_t}); }catch(e){} }
      }
    }catch(e){ LOG("EC table read failed:",e&&e.message); }
    LOG("DS distinct sectors:", [...new Set((A.designSummary||[]).map(r=>normSector(r.sector)))]);
    LOG("DS detail rows extracted:", (A.designSummary||[]).length, "| derived Summary-by-Sector rows:", deriveSummaryBySector(A.designSummary||[]).length, "| derived Summary-by-Site rows:", deriveSummaryBySite(A.designSummary||[]).length);
    hideProg();
    renderAnalyze();
    setStatus(partial?"Re-analyzed the selected page(s) and merged the results.":"Analyzed the RFDS. Review the values in each tab, edit anything wrong, then Redline changed items.");
  }catch(e){ hideProg(); LOG("analyze error",e); $("#azBody").innerHTML='<div class="az-empty">Analysis failed: '+escapeHtml(e&&e.message||String(e))+'. See console.</div>'; }
  $("#analyzeBtn").disabled=false;
}
/* parse "3-6, 10" (1-based page numbers) into a Set of 0-based page indices */
function parsePageRange(str,max){
  const set=new Set(); if(!str)return set;
  String(str).split(/[,\s]+/).forEach(tok=>{ tok=tok.trim(); if(!tok)return;
    const m=tok.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if(m){ let a=+m[1],b=+m[2]; if(a>b){const t=a;a=b;b=t;} for(let p=a;p<=b;p++){ if(p>=1&&p<=max)set.add(p-1); } }
    else if(/^\d+$/.test(tok)){ const p=+tok; if(p>=1&&p<=max)set.add(p-1); }
  });
  return set;
}
/* ---- Analyze RFDS: per-tab undo/redo + restore-default ---- */
const AZ_KEYS=["designSummary","rfInventory","antennaPosition","antennaExisting","antennaDecom","equipmentCalc","rfdsDetails","siteDetails",
  /* 6eo — AND THE SHARED CORRECTION MAPS, which is why Ctrl+Z "sometimes" did nothing. A snapshot of the
     eight grids restores the ROWS; it does not touch `_modelFix` / `_vendorFix`, and `renderAnalyze()`
     re-resolves every row from those maps on its way out. So undoing a model or vendor correction put the
     row back and the map immediately overwrote it again — invisibly, in the same tick. It only became the
     common case in 6ek, when Link started ON by default and most corrections began going into the map.
     `ecTable` and `portLevel` are here for the same reason: syncModels writes resolved values into their
     cells, so a snapshot that leaves them out restores a grid that disagrees with the page under it.
     `_modelSeeded`/`_vendorSeeded` come along so the restore cannot be re-seeded from the rows it just
     replaced. */
  "_modelFix","_vendorFix","_modelType","_modelSeeded","_vendorSeeded","ecTable","portLevel"];
let _azHist=[], _azFuture=[], _azEditTs=0;
function azSnapshot(A){ A=A||S.analysis; if(!A)return {}; const o={}; AZ_KEYS.forEach(k=>{ if(A[k]!==undefined)o[k]=JSON.parse(JSON.stringify(A[k])); }); return o; }
/* 6eo — a key ABSENT from the snapshot has to be removed, not left alone. `_modelFix` does not exist
   until the first correction is made, so the snapshot taken before that one has no entry for it — and
   skipping absent keys meant the very first correction could never be undone: the row went back and the
   map it had created survived. AZ_KEYS is exactly the tracked set, so deleting is the honest inverse. */
function azRestoreSnapshot(s){
  const A=S.analysis; if(!A||!s)return;
  AZ_KEYS.forEach(k=>{
    if(s[k]!==undefined)A[k]=JSON.parse(JSON.stringify(s[k]));
    else if(A[k]!==undefined)delete A[k];
  });
}
function azUpdateHistButtons(){ const u=$("#azUndo"),r=$("#azRedo"); if(u)u.disabled=!_azHist.length; if(r)r.disabled=!_azFuture.length; }
function azBeginEdit(){ // push a pre-edit snapshot once per burst (coalesces rapid keystrokes)
  const now=Date.now();
  if(now-_azEditTs>700){ _azHist.push(azSnapshot()); if(_azHist.length>60)_azHist.shift(); _azFuture.length=0; azUpdateHistButtons(); }
  _azEditTs=now;
}
function azUndo(){ if(!_azHist.length)return; _azFuture.push(azSnapshot()); azRestoreSnapshot(_azHist.pop()); _azEditTs=0; renderAnalyze(); azUpdateHistButtons(); }
function azRedo(){ if(!_azFuture.length)return; _azHist.push(azSnapshot()); azRestoreSnapshot(_azFuture.pop()); _azEditTs=0; renderAnalyze(); azUpdateHistButtons(); }
function azRestoreKeys(keys,label){
  const A=S.analysis; if(!A||!A._defaults)return;
  azBeginEdit(); _azEditTs=0;
  keys.forEach(k=>{ if(k&&A._defaults[k]!==undefined)A[k]=JSON.parse(JSON.stringify(A._defaults[k])); });
  if(keys.length>1){ A._modelFix={}; A._modelSeeded=true;
                     A._vendorFix={}; A._vendorSeeded=true; }   /* 6dl — the vendor map goes back too */
  syncModels();
  renderAnalyze(); azUpdateHistButtons();
  setStatus("Restored "+label+" to the values read from the RFDS.");
}
async function azRestoreTab(){
  const k=(_azTab==="antennaPosition")?currentRedlineKey():(_azTab==="detection"?null:_azTab);
  if(!k){ setStatus("Nothing to restore on this tab."); return; }
  const go=await uiConfirm({title:"Restore this tab?",
    message:"Every edit you have made on this tab will be discarded and the values read from the RFDS put back. This cannot be undone with Undo.",
    buttons:[{id:"no",label:"Cancel",primary:true},{id:"yes",label:"Restore this tab",danger:true}]});
  if(go!=="yes")return;
  azRestoreKeys([k],"this tab");
}
async function azRestoreAll(){
  const go=await uiConfirm({title:"Restore EVERY tab?",
    message:"Every edit on every Analyze tab — Design Summary, RF Inventory, Antenna Position, Equipment in Calc, Details — will be discarded and the values read from the RFDS put back.",
    buttons:[{id:"no",label:"Cancel",primary:true},{id:"yes",label:"Restore everything",danger:true}]});
  if(go!=="yes")return;
  azRestoreKeys(AZ_KEYS.slice(),"every Analyze tab");
}
function openAnalyze(){ $("#analyzeModal").classList.add("show");
  /* 6fj — the panel is measured for its own emboss pair the moment it exists on screen; under Ontel
     it is painted from the band while the page behind it is the opposite lightness. */
  try{ syncEmbossSoon(); }catch(e){} }
function closeAnalyze(){ $("#analyzeModal").classList.remove("show"); }
/* 6cd: the first click opens the chooser; it no longer starts reading on its own. */
$("#analyzeBtn").onclick=()=>{ openAnalyze(); renderAnalyze(); };
$("#azClose").onclick=closeAnalyze;
$("#azReapply").onclick=async()=>{
  const filt=parsePageRange($("#azPages")&&$("#azPages").value, S.pages.length);
  const partial=filt.size>0;
  if(!partial && analysisChangeCount()>0){
    const go=await uiConfirm({title:"Re-analyze RFDS?",message:"Re-analyzing every page discards the values you've edited here. Continue?\n\nTip: type page numbers in the Pages box (e.g. 2-5) to re-read only those and keep the rest of your edits.",buttons:[{id:"yes",label:"Re-analyze all",danger:true},{id:"no",label:"Keep edits"}]});
    if(go!=="yes")return;
  }
  analyzeRFDS(partial?filt:null);
};
$("#azApply").onclick=()=>{ applyAnalysis("add",null); closeAnalyze(); };
/* 6dz — the two footer buttons these wired up are gone; the guards stay so the wiring is harmless if
   either is ever put back. */
(function(){ const a=$("#azSuggest"); if(a)a.onclick=sgSuggestFlow;
             const b=$("#azUnsuggest"); if(b)b.onclick=sgRemoveFlow; })();
$("#azReplace").onclick=async()=>{
  const key=currentRedlineKey();
  const tabLabel = key? ("this tab ("+key+")") : "this tab";
  const go=await uiConfirm({title:"Replace redlines",message:"Remove existing analyze redlines and re-stamp fresh. Choose the scope:",
    buttons:[ (key?{id:"tab",label:"This tab"}:null), {id:"all",label:"All pages",danger:true}, {id:"cancel",label:"Cancel"} ].filter(Boolean)});
  if(go==="cancel"||!go)return;
  if(go==="tab") applyAnalysis("replace", key);
  else applyAnalysis("replace", null);
  closeAnalyze();
};
$("#azUndo").onclick=azUndo;
$("#azRedo").onclick=azRedo;
$("#azRestore").onclick=azRestoreTab;
$("#azRestoreAll").onclick=azRestoreAll;
$("#azNoRedline").onclick=()=>{ const k=currentRedlineKey(); if(!k)return; if(_skipRedline.has(k))_skipRedline.delete(k); else _skipRedline.add(k); updateNoRedlineBtn(); refreshAzFoot(); };
function updateNoRedlineBtn(){
  const b=$("#azNoRedline"); if(b) b.style.display="none";   // replaced by the per-tab toggle at the top of each pane
}
function redlineToggleEl(key){
  const on=!_skipRedline.has(key);
  const t=el("div","rl-tog "+(on?"on":"off"));
  t.innerHTML=`<span class="dot"></span><span>Redline: ${on?"ON":"OFF"}</span>`;
  t.title = on ? "Redlining is ON for this tab — click to turn OFF (won't apply here)" : "Redlining is OFF for this tab — click to turn ON";
  t.onclick=()=>{ if(_skipRedline.has(key))_skipRedline.delete(key); else _skipRedline.add(key); renderAnalyze(); };
  return t;
}

let _azTab="detection";
function analysisChangeCount(){
  if(!S.analysis)return 0; let n=0; const A=S.analysis;
  (A.designSummary||[]).forEach(r=>{ if(dsRowUserChanged(r))n++; });
  (A.equipmentCalc||[]).forEach(r=>{ if(ecRowChanged(r))n++; });
  ["rfdsDetails","siteDetails"].forEach(k=>(A[k]||[]).forEach(r=>{ if(detailsRowChanged(r))n++; }));
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>(A[k]||[]).forEach(r=>{
    if(r.struck){ n++; return; }
    ["secPos","vendor","model","radCenterDesign","radCenterAsBuilt","tipHeight","azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt"].forEach(f=>{ if(String(r[f]).trim()!==String(r["_orig_"+f]).trim())n++; });
    /* 6cj: the free-form rows count as changes too — otherwise the footer reads 0 and Redline stays off */
    (r._fieldOrder||[]).forEach(label=>{ if(antKeyForLabel(label))return;
      const a=String(((r._origFields||{})[label])||"").trim(), b=String(((r.fields||{})[label])||"").trim();
      if(a!==b)n++; });
  }));
  const rf=A.rfInventory; if(rf&&rf.rows){ const cols=rf.columns||[];
    rf.rows.forEach(r=>{
      if(r.inserted){ if((cols.length?cols:Object.keys(r.cells)).some(c=>String(r.cells[c]||"").trim()!==""))n++; return; }
      if(r.struck)n++;
      else (cols.length?cols:Object.keys(r.cells)).forEach(c=>{ if(String(r.cells[c]||"").trim()!==String(r._orig[c]!=null?r._orig[c]:"").trim())n++; });
    }); }
  return n;
}
function refreshAzFoot(){ const n=analysisChangeCount(); $("#azApply").disabled=!n;
  /* 6cl — the same ✦ the Analyze RFDS button wears, and set in caps: this is the button that writes
     on the PDF, and it should not read like the tab labels around it. */
  $("#azApply").textContent=n?`✦ REDLINE ${n} CHANGED ITEM${n===1?"":"S"}`:"✦ NOTHING TO REDLINE YET";
  $("#azNote").textContent=`${n} change(s) staged`; autosave&&autosave(); }
/* ================================================================================================
   6ca/6cb — Discrepancies: where the same equipment model disagrees with itself across the document.
   ------------------------------------------------------------------------------------------------
   Computed in code, not asked of a model. The tables are already in S.analysis after Analyze, so the
   comparison is exact, repeatable, and works with no network. Claude is used only to WRITE ABOUT the
   table, never to produce it — a discrepancy report you cannot reproduce is worse than none.

   The grid is a CHECKLIST: one row per model, one column per table, a tick where it is present.
     v   present
     x   absent, and this table should have carried it
     ·   absent, and there is no reason to expect it here (a radio on Antenna Position, say)
   ================================================================================================ */
const DISC_SRC=[["ds","Design Summary","Design Summary"],["rf","RF Inventory","RF Inventory"],
                ["nrf","Non-RF Inventory","Non RF Inventory Details (Final)"],
                ["ec","Equipment in Calc","Equipment in Calc"],["ant","Antenna Pos","Antenna Position"],
                ["plv","Port Level","Port Level Details (Final)"]];
const DISC_CORE=["ds","rf","nrf","ec"];
function discLabel(k){ const e=DISC_SRC.find(x=>x[0]===k); return e?e[2]:k; }
/* A looser key than normModelKey: strips every separator, so "AIR6449 B77D" and "AIR6449-B77D" collide.
   Two DIFFERENT normModelKeys sharing a loose key is the spelling finding. */
/* 6co — CCI ship the same antenna under two part numbers, one carrying a "-K" kit suffix:
   "TPA65R-BU8D" and "TPA65R-BU8D-K" are one unit, and marking each of them missing from the table the
   other is in is a false alarm on both halves. The separator is required — a bare trailing K is part of
   the name ("NOK"), a hyphenated or spaced one is the suffix. */
function discLooseKey(m){
  return String(m||"").trim().replace(/[-\s]+K$/i,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
}
/* 6ct — which FAMILY a printed equipment type belongs to. The same unit is written differently from page
   to page: RRH on one, RADIO on another; an INTEGRATED ANTENNA RADIO is both a radio and an antenna, and
   an RRH and an ANTENNA can legitimately carry the same model. Two types only disagree when they share no
   family at all. */
function discTypeFams(t){
  const c=String(canonType(t)||"").toUpperCase();
  const f=new Set();
  if(/\bRR[UH]\b|RADIO/.test(c))f.add("RADIO");
  if(/ANTENNA/.test(c))f.add("ANTENNA");
  if(/INTEGRATED\s+ANTENNA\s+RADIO|^IAR$/.test(c)){ f.add("RADIO"); f.add("ANTENNA"); }
  if(!f.size)f.add(c||"OTHER");
  return f;
}
function discTypesAgree(list){
  const ts=[...new Set((list||[]).map(x=>String(x||"").trim()).filter(Boolean))];
  if(ts.length<2)return true;
  let common=null;
  for(const t of ts){
    const f=discTypeFams(t);
    if(common==null)common=new Set(f);
    else common=new Set([...common].filter(x=>f.has(x)));
    if(!common.size)return false;
  }
  return true;
}
function discIsAntennaType(t){ const u=String(canonType(t)||"").toUpperCase(); return /ANTENNA/.test(u); }
/* A BBU is named by its TYPE where the page gives one; the model text is only a fallback. */
function discIsBbu(type,model){
  const t=String(type||"").toUpperCase(), m=String(model||"").toUpperCase();
  return /BBU|BASE\s*BAND|BASEBAND/.test(t) || /^BBU|\bBBU\b|BASEBAND/.test(m);
}
function discPageList(set){ return [...set].sort((a,b)=>a-b).map(p=>p+1); }
/* 6cc — the model NUMBER is what survives the naming. "RAN PROCESSOR 6672", "RANP6672" and "BBU 6672"
   are the same unit written three ways; the only stable token is 6672. Every run of 3-6 digits counts. */
function discModelNums(m){ return [...new Set(String(m||"").match(/\d{3,6}/g)||[])]; }
/* The Notes page is never read into a grid and never redlined — it is free text. But it is where the
   market writes what is actually going in, so it is worth asking whether it names the same BBU. Digit
   runs are compared, never words, so the naming style on the Notes page does not matter. */
function readNotesNumbers(){
  const A=S.analysis;
  const pages=(A&&A.notesPages)||[];
  const byNum=new Map(); let chars=0;
  pages.forEach(pi=>{
    const P2=S.pages[pi]; if(!P2||!P2.items)return;
    const txt=P2.items.map(t=>t.str).join(" ");
    chars+=txt.length;
    (txt.match(/\d{3,6}/g)||[]).forEach(n=>{
      if(!byNum.has(n))byNum.set(n,new Set());
      byNum.get(n).add(pi);
    });
  });
  return {pages,byNum,chars};
}

/* 6df — the RRH Configuration line on the Notes page.
   ------------------------------------------------------------------------------------------------
   The market writes the build into the Notes as free text:

       RRH Configuration :4490 B5/B12A||4494 B14/B29 || 4890 B25/B66|| AIR6472 B77G B77M

   Each `||` separates one radio. That is the same question the BBU card asks, for the radios: does RF
   Inventory carry these, and only these? Compared on the model NUMBER (every run of 3-6 digits), never
   on words, so "RRUS 4490", "4490 B5/B12A" and "RADIO 4490" are one radio written three ways. */
function readNotesRrhLine(){
  const A=S.analysis;
  const pages=(A&&A.notesPages)||[];
  for(const pi of pages){
    let lines=[];
    try{ lines=pageLines(pi)||[]; }catch(e){ lines=[]; }
    for(let i=0;i<lines.length;i++){
      const txt=lines[i].items.map(t=>t.str).join(" ").replace(/\s+/g," ").trim();
      /* 6di — the market does not always call it "RRH Configuration". This document says
             Final RRH Combination: 4494 B14/B29 || 4890 B25/B66|| 4490 B5/B12||4467 C BAND||4471 B30||
         so the rule is the shape, not the wording: a note whose LABEL — everything before the first
         colon — names RRH, and a list after it. */
      /* The whole printed ROW is one line — timestamp, creator, category, then the note — so the first
         colon on it belongs to "12:09:24.0", not to the label. Take the colon that FOLLOWS the word RRH
         and nothing else. */
      const m0=/\b(?:RRH|RRU)\b[^:]{0,40}:/i.exec(txt);
      if(!m0)continue;
      let body=txt.slice(m0.index+m0[0].length).trim();
      /* a list that ran onto the next line carries on with a separator or a bare model, never with a new
         "Something Configuration :" label or a timestamp */
      const nx=(i+1<lines.length)?lines[i+1].items.map(t=>t.str).join(" ").replace(/\s+/g," ").trim():"";
      if(nx&&!/:/.test(nx)&&!/^\d{4}-\d{2}-\d{2}/.test(nx)&&(/^[|]/.test(nx)||/[|]\s*$/.test(body)))
        body=(body+" "+nx).trim();
      if(body)return {page:pi,text:body,label:(m0[0].slice(0,-1)||"").trim(),
        models:body.split(/\s*\|\|\s*|\s*\|\s*/).map(x=>x.trim()).filter(Boolean)};
    }
  }
  return null;
}
/* 6dg — a radio's identity is its WHOLE model, not its digits.
   The BBU card compares digit runs because a BBU is written three different ways for the same unit. A
   radio is not: "AIR6472 B77G B77M" and "AIR6472 B77G" are the same family and different hardware, and
   comparing 6472 to 6472 called them equal. The key is the whole model with the separators and the
   vendor's row prefix taken off, so the two sides can be written differently and still be compared
   exactly:

       Notes         "4490 B5/B12A"        ->  4490B5B12A
       RF Inventory  "RRUS 4490 B5/B12A"   ->  4490B5B12A     same radio
       RF Inventory  "AIR6472 B77G"        ->  AIR6472B77G    NOT "AIR6472 B77G B77M"
*/
/* 6di — the MODEL, and only the model. The two pages describe the same radio with different bands after
   it — RF Inventory prints "4467 B77D/B77G" where the Notes line says "4467 C BAND" — so comparing the
   whole string called one radio two. What identifies the unit is its model designator: the first token
   carrying digits, once a row prefix is out of the way.

       "4490 B5/B12A"        -> 4490          "RRUS 4490 B5/B12A"  -> 4490
       "4467 C BAND"         -> 4467          "4467 B77D/B77G"     -> 4467
       "AIR6472 B77G B77M"   -> AIR6472       "AIR6472 B77G"       -> AIR6472
*/
function rrhKey(m){
  let t=String(m==null?"":m).toUpperCase();
  t=t.replace(/[\u2010-\u2015\u2212\u00ad]/g,"-");
  t=t.replace(/^\s*(?:RRUS|RRU|RRH|RADIO|UNIT)\b[\s:-]*/g,"");   // a row prefix, not part of the model
  const tok=t.split(/[^A-Z0-9]+/).filter(Boolean).find(x=>/\d/.test(x));
  return tok||t.replace(/[^A-Z0-9]/g,"");
}
/* an RRH by the type the tables give it. RADIO is the same kit; INTEGRATED ANTENNA RADIO is not. */
function discIsRrhType(t){
  const c=canonType(t);
  return c==="RRH"||c==="RADIO";
}
function collectModelIndex(){
  const A=S.analysis; const idx=new Map();
  const touch=(model,src,o)=>{
    o=o||{};
    const k=normModelKey(model); if(!k)return null;
    if(!idx.has(k))idx.set(k,{key:k,labels:new Set(),types:new Set(),src:{}});
    const e=idx.get(k);
    if(String(model||"").trim())e.labels.add(String(model).trim());
    if(o.type&&canonType(o.type))e.types.add(canonType(o.type));
    if(o.type)e.rawType=e.rawType||String(o.type);
    const d=e.src[src]||(e.src[src]={rows:0,qty:0,pages:new Set(),sectors:new Set()});
    d.rows++;
    if(o.qty!=null)d.qty+=int(o.qty);
    if(typeof o.page==="number"&&o.page>=0)d.pages.add(o.page);
    if(o.sector&&o.sector!=="—")d.sectors.add(o.sector);
    return e;
  };
  if(!A)return idx;
  (A.designSummary||[]).forEach(r=>{ if(r.struck)return;
    const d=rowCounts(r);
    touch(r.origModel||r.model,"ds",{page:r.page,qty:d.final,sector:normSector(r.sector),type:r.type}); });
  const tableInto=(T,src)=>{
    if(!T||!T.columns||!T.rows||!T.rows.length)return;
    const mc=rfModelCol(T.columns);
    const tc=T.columns.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
    const qc=T.columns.find(c=>/qty|quantity|count|total/i.test(String(c)));
    if(!mc)return;
    T.rows.forEach(r=>{ if(r.struck)return;
      touch(r.cells&&r.cells[mc],src,{page:r.page,qty:qc?int(r.cells[qc]):1,
        sector:(src==="rf"?rfRowSector(r,T.columns):null),
        type:tc?(r.cells&&r.cells[tc]):null}); });
  };
  tableInto(A.rfInventory,"rf");
  tableInto(A.nonRfInventory,"nrf");
  const T=A.ecTable;
  if(T&&T.columns&&T.rows&&T.rows.length)tableInto(T,"ec");
  else (A.equipmentCalc||[]).forEach(r=>{ if(r.struck)return;
    touch(r.origModel||r.model,"ec",{page:r.page,qty:r.count,type:r.type}); });
  (A.antennaPosition||[]).forEach(r=>{ if(r.struck)return;
    touch(r.model,"ant",{page:r.page,qty:1,sector:normSector(r.secPos),type:"ANTENNA"}); });
  /* Port Level repeats the model once per port, so its row count is ports, not antennas — informational
     only: a model absent from Port Level is never itself a finding. */
  const PL=A.portLevel;
  if(PL&&PL.columns&&PL.rows&&PL.rows.length){
    const mc=rfModelCol(PL.columns), sc=portSecPosCol(PL.columns);
    if(mc)PL.rows.forEach(r=>{ if(r.struck)return;
      touch(r.cells&&r.cells[mc],"plv",{page:r.page,qty:null,
        sector:sc?normSector(String(r.cells[sc]||"").charAt(0)):null,type:"ANTENNA"}); });
  }
  return idx;
}

/* ================================================================================================
   6cp — SUGGESTED redlines.
   ------------------------------------------------------------------------------------------------
   The Discrepancies tab has always been able to say what disagrees; this makes it able to propose the
   fix. A suggestion is written into the grid like any other correction — so it redlines, and so you can
   type over it — but it is recorded on the row (`_sugg`) with the value it replaced, which is what lets
   it be shown in BLUE as "suggested" rather than red as "edited", and taken back in one click.

   Only disagreements with one obvious target are proposed. "Not in RF Inventory" is not one of them:
   the fix is a row somebody has to add, and guessing its sector and counts would be inventing data.
   ================================================================================================ */
function sgMark(r,key,oldVal){
  if(!r)return;
  r._sugg=r._sugg||{};
  if(!Object.prototype.hasOwnProperty.call(r._sugg,key))r._sugg[key]=(oldVal==null?"":String(oldVal));
}
function sgHas(r,key){ return !!(r&&r._sugg&&Object.prototype.hasOwnProperty.call(r._sugg,key)); }
function sgAny(r){ return !!(r&&r._sugg&&Object.keys(r._sugg).length); }
function sgTag(inp,r,key){ if(inp&&sgHas(r,key))inp.dataset.suggested="1"; return inp; }
const SG_TABS=["designSummary","rfInventory","antennaPosition","equipmentCalc"];
function sgRowsOf(tab){
  const A=S.analysis; if(!A)return [];
  if(tab==="designSummary")return (A.designSummary||[]).map(r=>({r,kind:"ds"}));
  if(tab==="rfInventory")return (((A.rfInventory&&A.rfInventory.rows)||[])).map(r=>({r,kind:"tbl",cols:A.rfInventory.columns||[]}));
  if(tab==="antennaPosition")return ["antennaPosition","antennaExisting","antennaDecom"]
      .flatMap(k=>(A[k]||[]).map(r=>({r,kind:"ant"})));
  if(tab==="equipmentCalc"){
    const out=(A.equipmentCalc||[]).map(r=>({r,kind:"ec"}));
    const T=A.ecTable;
    if(T&&T.rows)T.rows.forEach(r=>out.push({r,kind:"tbl",cols:T.columns||[]}));
    return out;
  }
  return [];
}
function suggestRedlines(scope){
  const A=S.analysis; if(!A)return 0;
  let D=null; try{ D=buildDiscrepancies(); }catch(e){ LOG("Suggest: buildDiscrepancies failed:",e&&e.message); return 0; }
  const tabs=scope?[scope==="antennaExisting"||scope==="antennaDecom"?"antennaPosition":scope]:SG_TABS.slice();
  let n=0;
  /* ---- one spelling per model ---------------------------------------------------------------
     A twin group is the same kit printed two ways. The spelling that appears in the most tables wins
     (ties break on the most rows, then alphabetically, so the answer is the same every time). */
  const winner=new Map();
  const groups=new Map();
  (D.rows||[]).forEach(r=>{ if(!r.twin||!r.loose)return;
    if(!groups.has(r.loose))groups.set(r.loose,[]); groups.get(r.loose).push(r); });
  groups.forEach((list,k)=>{
    if(list.length<2)return;
    const score=r=>DISC_SRC.reduce((m,[s])=>m+(r.src[s]?1:0),0);
    const rows=r=>DISC_SRC.reduce((m,[s])=>m+((r.src[s]&&r.src[s].rows)||0),0);
    const best=list.slice().sort((a,b)=>score(b)-score(a)||rows(b)-rows(a)||String(a.label).localeCompare(String(b.label)))[0];
    if(best&&best.label)winner.set(k,best.label);
  });
  const wantFor=v=>{ const k=discLooseKey(v); return (k&&winner.has(k))?winner.get(k):null; };
  tabs.forEach(tab=>sgRowsOf(tab).forEach(({r,kind,cols})=>{
    if(r.struck)return;
    if(kind==="ds"||kind==="ec"){
      const w=wantFor(r.model);
      if(w&&String(r.model)!==w){ sgMark(r,"model",r.model); r.model=w; r._ownFix=w; n++; }
    } else if(kind==="ant"){
      const w=wantFor(r.model);
      if(w&&String(r.model)!==w){ sgMark(r,"model",r.model); r.model=w; r._ownFix=w; n++; }
    } else if(kind==="tbl"){
      const mc=rfModelCol(cols||[]);
      if(mc){ const w=wantFor(r.cells[mc]);
        if(w&&String(r.cells[mc])!==w){ sgMark(r,mc,r.cells[mc]); r.cells[mc]=w; r._ownFix=w; n++; } }
    }
  }));
  /* ---- one equipment TYPE per model (6ct) -------------------------------------------------------
     A model typed RRH here and RADIO there is the same unit and is no longer a finding at all; a model
     typed as genuinely different kit is, and the fix is to make the minority follow the majority. */
  const typeWinner=new Map();
  (D.rows||[]).forEach(r=>{
    if(!r.findings.some(f=>f.kind==="type"))return;
    const tally=new Map();
    (r.types||[]).forEach(t=>tally.set(t,(tally.get(t)||0)+1));
    const best=[...tally.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])))[0];
    if(best)typeWinner.set(r.loose,best[0]);
  });
  if(typeWinner.size)tabs.forEach(tab=>sgRowsOf(tab).forEach(({r,kind,cols})=>{
    if(r.struck)return;
    if(kind==="ds"||kind==="ec"){
      const w=typeWinner.get(discLooseKey(r.model));
      if(w&&canonType(r.type)!==canonType(w)){ sgMark(r,"type",r.type); r.type=w; n++; }
    } else if(kind==="tbl"){
      const mc=rfModelCol(cols||[]);
      const tc=(cols||[]).find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
      if(mc&&tc){ const w=typeWinner.get(discLooseKey(r.cells[mc]));
        if(w&&canonType(r.cells[tc])!==canonType(w)){ sgMark(r,tc,r.cells[tc]); r.cells[tc]=w; n++; } }
    }
  }));
  /* ---- Equipment in Calc follows the Design Summary on quantity -------------------------------- */
  if(tabs.indexOf("equipmentCalc")>=0){
    const dsQty=new Map();
    (D.rows||[]).forEach(r=>{ if(r.src&&r.src.ds)dsQty.set(r.loose,r.src.ds.qty); });
    (A.equipmentCalc||[]).forEach(r=>{ if(r.struck)return;
      const q=dsQty.get(discLooseKey(r.model)); if(q==null)return;
      if(int(r.count)!==int(q)){ sgMark(r,"count",r.count); r.count=q; n++; } });
    const T=A.ecTable;
    if(T&&T.columns&&T.rows){
      const mc=rfModelCol(T.columns);
      const qc=T.columns.find(c=>/qty|quantity|count|total/i.test(String(c)));
      if(mc&&qc)T.rows.forEach(r=>{ if(r.struck)return;
        const q=dsQty.get(discLooseKey(r.cells[mc])); if(q==null)return;
        if(int(r.cells[qc])!==int(q)){ sgMark(r,qc,r.cells[qc]); r.cells[qc]=String(q); n++; } });
    }
  }
  if(n){ try{ syncModels(); }catch(e){}
    LOG("Suggest redlines:",n,"value(s) proposed"+(scope?(" on "+scope):" across the document")); }
  return n;
}
function removeSuggested(scope){
  const A=S.analysis; if(!A)return 0;
  const tabs=scope?[scope==="antennaExisting"||scope==="antennaDecom"?"antennaPosition":scope]:SG_TABS.slice();
  let n=0;
  tabs.forEach(tab=>sgRowsOf(tab).forEach(({r,kind})=>{
    if(!sgAny(r))return;
    Object.keys(r._sugg).forEach(k=>{
      const was=r._sugg[k];
      if(kind==="ds"||kind==="ec"||kind==="ant"){ if(k==="model"){ r.model=was; delete r._ownFix; } else r[k]=was; }
      else if(r.cells){ r.cells[k]=was; if(rfModelCol(Object.keys(r.cells))===k)delete r._ownFix; }
      n++;
    });
    delete r._sugg;
    delete r._ownFix;
  }));
  if(n){ try{ syncModels(); }catch(e){} LOG("Removed",n,"suggested value(s)"+(scope?(" on "+scope):"")); }
  return n;
}
function sgCount(scope){
  const tabs=scope?[scope==="antennaExisting"||scope==="antennaDecom"?"antennaPosition":scope]:SG_TABS.slice();
  let n=0; tabs.forEach(t=>sgRowsOf(t).forEach(({r})=>{ if(sgAny(r))n+=Object.keys(r._sugg).length; }));
  return n;
}
/* Both buttons ask the same question: this tab, or the whole document. */
async function sgAsk(title,message){
  const tab=(function(){ try{ return AZ_KEYS.indexOf(_azTab)>=0?_azTab:null; }catch(e){ return null; } })();
  const buttons=[];
  if(tab&&SG_TABS.indexOf(tab==="antennaExisting"||tab==="antennaDecom"?"antennaPosition":tab)>=0)
    buttons.push({id:"tab",label:"This tab only"});
  buttons.push({id:"all",label:"Whole document",primary:true},{id:"cancel",label:"Cancel"});
  const v=await uiConfirm({title,message,buttons});
  if(v==="cancel"||!v)return undefined;
  return v==="tab"?(tab==="antennaExisting"||tab==="antennaDecom"?"antennaPosition":tab):null;
}
async function sgSuggestFlow(){
  if(!S.analysis){ setStatus("Analyze the RFDS first.",true); return; }
  const scope=await sgAsk("Suggest redlines",
    "Line the grids up with the Discrepancies tab: one spelling per model, and Equipment in Calc "+
    "quantities following the Design Summary. Suggested values show in blue and can be taken back in one click.");
  if(scope===undefined)return;
  azBeginEdit();
  const n=suggestRedlines(scope);
  renderAnalyze();
  if(n){ setStatus(n+" suggested value(s) — shown in blue. ⊘ takes them back."); return; }
  /* 6ct — say WHY there was nothing, rather than implying the checklist is clean. Most findings are
     "this model is not in that table", and the fix for those is a row somebody has to add. */
  let open=0, kinds={};
  try{ const D=buildDiscrepancies();
    (D.rows||[]).forEach(r=>r.findings.forEach(f=>{ if(f.sev>0){ open++; kinds[f.kind]=(kinds[f.kind]||0)+1; } }));
  }catch(e){}
  const k=Object.keys(kinds).sort((a,b)=>kinds[b]-kinds[a]);
  setStatus(open
    ? ("Nothing to suggest — the "+open+" remaining finding(s) are "+k.slice(0,3).join(", ")+
       ", which need a row added or a decision, not a value copied.")
    : "Nothing to suggest: the grids already agree.");
}
async function sgRemoveFlow(){
  if(!S.analysis)return;
  const scope=await sgAsk("Remove suggested",
    "Put every suggested value back to what the page printed. Anything you typed yourself is untouched.");
  if(scope===undefined)return;
  azBeginEdit();
  const n=removeSuggested(scope);
  renderAnalyze();
  setStatus(n?(n+" suggested value(s) reverted."):"There were no suggested values to remove.");
}
function buildDiscrepancies(){
  const idx=collectModelIndex();
  const have={}; DISC_SRC.forEach(([k])=>{ have[k]=false; });
  idx.forEach(e=>DISC_SRC.forEach(([k])=>{ if(e.src[k])have[k]=true; }));
  let rows=[];
  idx.forEach(e=>{
    const label=[...e.labels][0]||e.key;
    const types=[...e.types];
    const isAnt=types.some(discIsAntennaType);
    const isBbu=discIsBbu(types.join(" ")+" "+(e.rawType||""),label);
    /* Which tables SHOULD carry this model? A model listed in the Non-RF table is non-RF kit and has no
       business in RF Inventory, and the reverse. Judge by where it actually appears; fall back on type. */
    const nonRf = !!e.src.nrf || (!e.src.rf && (isBbu||/DC|BREAKER|SURGE|RECTIFIER|BATTERY|CABINET|GPS|FIBER|TRUNK|POWER/.test(String(e.rawType||"").toUpperCase())));
    const expect={};
    if(have.ds)expect.ds=true;
    if(have.ec)expect.ec=true;
    if(have.rf&&!nonRf)expect.rf=true;
    if(have.nrf&&nonRf)expect.nrf=true;
    if(have.ant&&isAnt)expect.ant=true;
    const findings=[];
    const gone=DISC_CORE.filter(k=>expect[k]&&!e.src[k]);
    const here=DISC_CORE.filter(k=>e.src[k]);
    /* `miss` carries the table keys, not just the sentence — the twin pass below has to be able to remove
       PART of a missing finding, and re-deriving that from prose is how you end up with "Not in ." */
    if(here.length&&gone.length)
      findings.push({kind:"missing",sev:2,miss:gone.slice(),text:"Not in "+gone.map(discLabel).join(" or ")+"."});
    /* 6cg: a model that appears ONLY on Port Level is a reference to an antenna, not an antenna in its
       own right — reporting it as missing from Antenna Position restates the port finding as a second,
       vaguer one. It has to be in at least one inventory table before its absence there means anything. */
    if(expect.ant&&!e.src.ant&&here.length)
      findings.push({kind:"missing",sev:1,text:"No row on Antenna Position Details."});
    if(e.src.ds&&e.src.ec&&e.src.ec.qty!=null&&e.src.ds.qty!==e.src.ec.qty)
      findings.push({kind:"quantity",sev:2,text:"Design Summary "+e.src.ds.qty+", Equipment in Calc "+e.src.ec.qty+"."});
    if(e.src.ds&&e.src.rf&&e.src.ds.qty!==e.src.rf.rows)
      findings.push({kind:"quantity",sev:1,text:"Design Summary "+e.src.ds.qty+", RF Inventory "+e.src.rf.rows+" row"+(e.src.rf.rows===1?"":"s")+"."});
    /* 6ct — only when the names really are different kit. RRH / RADIO, and INTEGRATED ANTENNA RADIO
       against either ANTENNA or RRH, are the same thing written two ways. */
    if(types.length>1&&!discTypesAgree(types))
      findings.push({kind:"type",sev:1,text:"Typed as "+types.join(" and ")+"."});
    const pages=new Set();
    DISC_SRC.forEach(([k])=>{ if(e.src[k])e.src[k].pages.forEach(p=>pages.add(p)); });
    rows.push({key:e.key,loose:discLooseKey(label),label,types,isBbu,isAnt,nonRf,
               src:e.src,expect,pages,findings,sev:findings.reduce((m,f)=>Math.max(m,f.sev),0)});
  });
  /* spelling — two distinct models that are the same kit read two ways.
     Normally that means a shared loose key ("AIR6449 B77D" / "AIR6449-B77D"). For a BBU it also means a
     shared model NUMBER: "RAN PROCESSOR 6672" and "RANP6672" share nothing textually and are the same
     unit. Without this the checklist marked each of them missing from the table the other one is in —
     contradicting the BBU verdict sitting directly above it. */
  const twinKey=r=>{
    if(r.isBbu){ const n=discModelNums(r.label); if(n.length===1)return "bbu#"+n[0]; }
    return r.loose;
  };
  const byLoose=new Map();
  rows.forEach(r=>{ const k=twinKey(r); if(!k)return;
    if(!byLoose.has(k))byLoose.set(k,[]);
    byLoose.get(k).push(r); });
  byLoose.forEach(list=>{
    if(list.length<2)return;
    const union={}; list.forEach(r=>DISC_SRC.forEach(([k])=>{ if(r.src[k])union[k]=true; }));
    list.forEach(r=>{
      const others=list.filter(x=>x!==r).map(x=>'"'+x.label+'" (page '+discPageList(x.pages).join(", ")+")");
      /* A "missing from RF Inventory" on a model that IS in RF Inventory under another spelling is a
         false alarm, and the noisiest kind — it would fire on both halves of every variant pair. */
      /* Rewrite rather than drop: "Not in Design Summary or Equipment in Calc" on a model whose twin IS
         in the Design Summary should become "Not in Equipment in Calc", not disappear and not stand. */
      let softened=0;
      r.findings=r.findings.filter(f=>{
        if(f.kind!=="missing"||!f.miss)return true;
        const left=f.miss.filter(k=>!union[k]);
        if(left.length===f.miss.length)return true;
        softened++;
        if(!left.length)return false;
        f.miss=left; f.text="Not in "+left.map(discLabel).join(" or ")+".";
        return true;
      });
      const before=r.findings.length+softened;
      /* The checklist must not contradict the finding: a cell that says "missing" while the note says
         "nothing is actually missing" is worse than either alone. Record where the twin covers it so the
         grid can mark those cells differently. */
      r.twin=true; r.twinSrc={}; r.twinLabel={};
      DISC_SRC.forEach(([k])=>{ if(r.src[k])return;
        const o2=list.find(x=>x!==r&&x.src[k]);
        if(o2){ r.twinSrc[k]=true; r.twinLabel[k]=o2.label; } });
      r.findings.push({kind:"spelling",sev:2,
        text:"Also printed as "+others.join(" and ")+"."+
             ((before-r.findings.length)?" Between the two spellings nothing is actually missing there.":"")});
      r.sev=Math.max(r.sev,2);
    });
  });
  /* ---- the BBU check (6cb, tightened 6cc) ----
     Design Summary against Non RF Inventory Details (Final), then both against the Notes page.
     Two rules from the field:
       - a Design Summary BBU whose FINAL count is 0 is being removed. It is not the site's BBU and must
         not be compared as though it were; before this it dragged decommissioned kit into the verdict.
       - the Notes page names the BBU however the market writes it ("RAN PROCESSOR 6672", "RANP6672"),
         so the comparison is on the model NUMBER alone. */
  const notes=readNotesNumbers();
  const dsLive=rows.filter(r=>r.isBbu&&r.src.ds&&r.src.ds.qty>0);
  const dsDead=rows.filter(r=>r.isBbu&&r.src.ds&&!(r.src.ds.qty>0));
  const nrfBbu=rows.filter(r=>r.isBbu&&r.src.nrf);
  dsDead.forEach(r=>{
    /* A BBU on its way out is SUPPOSED to be absent from the final inventory. Reporting it as missing
       from Non RF Inventory Details is not a finding, it is the plan. */
    r.findings=r.findings.filter(f=>f.kind!=="missing");
    r.expect={ds:true};
    r.sev=r.findings.reduce((m,f)=>Math.max(m,f.sev),0);
    r.findings.push({kind:"note",sev:0,
      text:"Design Summary final is 0 — being removed, so it is left out of the BBU comparison and is not expected in the other tables."});
  });
  rows.filter(r=>r.isBbu).forEach(r=>{
    const nums=discModelNums(r.label);
    r.bbuNums=nums;
    r.notesHit=nums.filter(n=>notes.byNum.get(n)).map(n=>({n,pages:discPageList(notes.byNum.get(n))}));
    if(notes.pages.length&&nums.length){
      if(r.notesHit.length)r.findings.push({kind:"notes",sev:1,
        text:"Notes page mentions "+r.notesHit.map(h=>h.n+" (page "+h.pages.join(", ")+")").join(", ")+"."});
      else r.findings.push({kind:"notes",sev:1,
        text:"Not mentioned on the Notes page ("+nums.join("/")+" does not appear there)."});
    }
  });
  /* 6cn — the same rule, for EVERY equipment type. A model whose Design Summary final count is 0 is
     being removed: it is supposed to be absent from RF Inventory, Equipment in Calc and Antenna Position
     afterwards, so listing those absences as discrepancies buries the real ones. 6cc already did this for
     BBUs (`dsDead` above); this generalises it, and such rows are dropped from the checklist entirely
     rather than shown with an explanation nobody needs to read twice. */
  const dsGone=rows.filter(r=>!r.isBbu&&r.src.ds&&r.src.ds.rows>0&&!(r.src.ds.qty>0));
  dsGone.forEach(r=>{ r.removed=true; });
  if(dsGone.length)LOG("Discrepancies: left out",dsGone.length,
    "model(s) whose Design Summary final count is 0 (being removed):",dsGone.map(r=>r.label).join(", "));
  const nameOf=list=>list.map(r=>r.label).join(", ");
  const bbu={ds:dsLive,nrf:nrfBbu,dead:dsDead,notes,note:"",ok:false,notesLine:""};
  if(have.nrf||dsLive.length||dsDead.length){
    const same=new Set(), nsame=new Set();
    dsLive.forEach(r=>discModelNums(r.label).forEach(n=>same.add(n)));
    nrfBbu.forEach(r=>discModelNums(r.label).forEach(n=>nsame.add(n)));
    const agree=same.size&&nsame.size&&[...same].some(n=>nsame.has(n));
    if(!dsLive.length&&!nrfBbu.length)
      bbu.note=dsDead.length
        ? ("The only BBU in the Design Summary ("+nameOf(dsDead)+") has a final count of 0 — it is being removed, and nothing replaces it.")
        : "No BBU identified in either the Design Summary or Non RF Inventory Details.";
    else if(!have.nrf)
      bbu.note="Design Summary BBU is "+nameOf(dsLive)+". This document has no Non RF Inventory Details (Final) section to check it against.";
    else if(!dsLive.length)
      bbu.note="Non RF Inventory lists BBU "+nameOf(nrfBbu)+", and the Design Summary has no BBU with a final count above 0.";
    else if(!nrfBbu.length)
      bbu.note="Design Summary BBU is "+nameOf(dsLive)+", and Non RF Inventory Details lists none.";
    else if(agree){ bbu.ok=true;
      bbu.note="BBU model agrees: "+nameOf(dsLive)+" in the Design Summary and "+nameOf(nrfBbu)+" in Non RF Inventory Details."; }
    else
      bbu.note="BBU model disagrees — Design Summary says "+nameOf(dsLive)+", Non RF Inventory Details says "+nameOf(nrfBbu)+".";
    if(notes.pages.length){
      const side=list=>list.filter(r=>(r.notesHit||[]).length);
      const dsN=side(dsLive), nrN=side(nrfBbu);
      const numsOf=list=>[...new Set(list.flatMap(r=>r.notesHit.map(h=>h.n+" (page "+h.pages.join(", ")+")")))].join(", ");
      if(!same.size&&!nsame.size) bbu.notesLine="";
      else if(bbu.ok) bbu.notesLine=(dsN.length||nrN.length)
        ? ("The Notes page agrees — it mentions "+numsOf(dsN.concat(nrN))+".")
        : "The Notes page does not mention this BBU number either way.";
      else if(dsN.length&&!nrN.length) bbu.notesLine="The Notes page backs the Design Summary — it mentions "+numsOf(dsN)+".";
      else if(nrN.length&&!dsN.length) bbu.notesLine="The Notes page backs Non RF Inventory — it mentions "+numsOf(nrN)+".";
      else if(dsN.length&&nrN.length) bbu.notesLine="The Notes page mentions both numbers, so it does not settle it.";
      else bbu.notesLine="The Notes page mentions neither number, so it does not settle it.";
    } else bbu.notesLine="No Notes page was found in this document.";
    const flag=(list,txt,brief)=>list.forEach(r=>{ r.findings.unshift({kind:"bbu",sev:3,text:txt,brief:brief}); r.sev=3; });
    if(!bbu.ok&&dsLive.length&&nrfBbu.length){
      flag(dsLive.filter(r=>!discModelNums(r.label).some(n=>nsame.has(n))),
           "BBU mismatch — this is the Design Summary's BBU; Non RF Inventory Details says "+nameOf(nrfBbu)+".",
           "Design Summary's BBU; Non RF Inventory says "+nameOf(nrfBbu));
      flag(nrfBbu.filter(r=>!discModelNums(r.label).some(n=>same.has(n))),
           "BBU mismatch — this is the Non RF Inventory BBU; the Design Summary says "+nameOf(dsLive)+".",
           "Non RF Inventory's BBU; Design Summary says "+nameOf(dsLive));
    } else if(!bbu.ok&&have.nrf&&dsLive.length&&!nrfBbu.length){
      flag(dsLive,"BBU is in the Design Summary but not in Non RF Inventory Details.");
    } else if(!bbu.ok&&have.nrf&&!dsLive.length&&nrfBbu.length){
      flag(nrfBbu,"BBU is in Non RF Inventory Details but not in the Design Summary.");
    }
  }
  /* ---- 6df: the RRH check — the Notes page's RRH Configuration against RF Inventory ---- */
  const rrhNote=readNotesRrhLine();
  /* 6dh — EVERY model on the RRH Configuration line is a radio. That is what the line is; the tool does
     not get to second-guess it from how RF Inventory happened to type the row. Two consequences:

       - "is this radio in RF Inventory?" is asked of EVERY RF Inventory model, whatever its printed
         Equipment Type. A radio the line names is either in that table or it is not.
       - a model named on the line counts as a radio on the RF side too, so it joins the RRH set even
         where the row is typed something else.

     The reverse question — "does RF Inventory carry a radio the line never names?" — stays limited to
     rows that ARE radios (RRH or RADIO, never INTEGRATED ANTENNA RADIO), or every antenna on the site
     would read as an extra RRH. */
  const rfAll=rows.filter(r=>r.src.rf);
  const noteKeys=new Set();
  const noteModels=rrhNote?rrhNote.models.map(m=>({text:m,key:rrhKey(m)})):[];
  noteModels.forEach(m=>{ if(m.key)noteKeys.add(m.key); });
  const rfRrh=rfAll.filter(r=>r.types.some(discIsRrhType)||noteKeys.has(rrhKey(r.label)));
  const rrh={have:!!rrhNote,line:rrhNote?rrhNote.text:"",page:rrhNote?rrhNote.page:null,
             label:rrhNote?(rrhNote.label||""):"",
             notes:[],rf:rfRrh,extra:[],missing:[],note:"",ok:false};
  if(rrhNote){
    const rfKeys=new Set(); rfAll.forEach(r=>{ const k=rrhKey(r.label); if(k)rfKeys.add(k); });
    rrh.notes=noteModels;
    rrh.notes.forEach(m=>{ m.inRf=m.key?rfKeys.has(m.key):null; });
    rrh.extra=rrh.notes.filter(m=>m.inRf===false);                       // named in Notes, not in RF
    rrh.missing=rfRrh.filter(r=>{ const k=rrhKey(r.label);
      return k&&!noteKeys.has(k); });                                    // in RF, not named in Notes
    const nm=list=>list.map(x=>x.text||x.label).join(", ");
    if(!rfAll.length)
      rrh.note="The Notes page lists "+rrh.notes.length+" radio(s) — "+nm(rrh.notes)+
               " — and this document has no RF Inventory to check them against.";
    else if(!rrh.extra.length&&!rrh.missing.length){ rrh.ok=true;
      rrh.note="The radios agree — the Notes page lists "+nm(rrh.notes)+
               ", and RF Inventory carries all of them."; }
    else{
      const bits=[];
      if(rrh.extra.length)bits.push(nm(rrh.extra)+" "+(rrh.extra.length===1?"is":"are")+
        " on the Notes page but not in RF Inventory");
      if(rrh.missing.length)bits.push(nm(rrh.missing)+" "+(rrh.missing.length===1?"is":"are")+
        " in RF Inventory but not on the Notes page");
      rrh.note="The radios disagree — "+bits.join(", ")+".";
    }
    /* the RF rows the Notes page does not name are flagged on the checklist, like a BBU mismatch */
    rrh.missing.forEach(r=>{ r.findings.unshift({kind:"rrh",sev:3,
      text:"RRH mismatch — the Notes page's RRH Configuration does not name this radio; it lists "+
           rrh.notes.map(m=>m.text).join(", ")+".",
      brief:"not in the Notes RRH Configuration"}); r.sev=3; });
    LOG("Discrepancies RRH: Notes page "+(rrhNote.page+1)+" lists ["+rrhNote.models.join(" | ")+
        "]; RF Inventory has ["+rfRrh.map(r=>r.label).join(", ")+"] — "+(rrh.ok?"agree":"disagree"));
  }

  /* ---- Port Level against Antenna Position, by Sec-Pos (6cg) ---- */
  const plv=portLevelCheck();
  const port={have:plv.have,mismatch:plv.mismatch,orphan:plv.orphan,unmatched:plv.unmatched,skipped:plv.skipped,
              redlined:plv.redlined||[],open:plv.open||[],
              rows:plv.rows.length,note:"",ok:false,allRedlined:false};
  if(plv.have){
    if(!plv.mismatch.length&&!plv.orphan.length){
      port.ok=true;
      port.note="Port Level Details agrees with Antenna Position on every Sec-Pos ("+plv.rows.length+" port row(s) checked).";
    } else {
      /* 6el — count the OUTSTANDING disagreements, and say separately how many are already redlined. The
         card used to count every mismatch as a disagreement, so a page that had been fully corrected
         still read "disagrees on 6 rows" and gave no way to tell finished work from work to do. */
      const open=plv.open||plv.mismatch, done=plv.redlined||[];
      const bits=[];
      const nm=open.filter(m=>m.field!=="vendor").length, nv=open.length-nm;
      if(nm)bits.push(nm+" port row(s) name a different model than Antenna Position");
      if(nv)bits.push(nv+" name a different vendor");
      if(plv.orphan.length)bits.push(plv.orphan.length+" port row(s) have a Sec-Pos with no Antenna Position row");
      port.allRedlined=(!open.length&&!plv.orphan.length&&done.length>0);
      if(port.allRedlined){
        port.note="Port Level Details disagrees but redlined — all "+done.length+
          " row(s) that differ from Antenna Position already carry a correction.";
      } else {
        port.note="Port Level Details disagrees — "+bits.join(", ")+"."+
          (done.length?(" A further "+done.length+" row(s) disagree but are already redlined."):"");
      }
    }
    if(plv.unmatched.length)port.note+=" "+plv.unmatched.length+" antenna position(s) have no port row: "+
      plv.unmatched.map(u=>prettySecPos(u.secPos)).join(", ")+".";
    if(plv.skipped.length)port.note+=" "+plv.skipped.length+" decommissioned port row(s) — Sec-Pos marked (D) — were left out.";
    /* attach the finding to BOTH models involved, so either one leads you to it in the grid */
    const byModel=new Map();
    plv.mismatch.forEach(m=>{
      [m.printed,m.correct].forEach(mo=>{
        const k=normModelKey(mo); if(!k)return;
        if(!byModel.has(k))byModel.set(k,[]);
        byModel.get(k).push(m);
      });
    });
    rows.forEach(r=>{
      const list=byModel.get(r.key); if(!list||!list.length)return;
      const txt=list.slice(0,4).map(m=>m.secPos+" "+(m.label||"Model")+": Port Level says "+
        JSON.stringify(m.printed)+", Antenna Position says "+JSON.stringify(m.correct)+
        (m.redlined?" (already redlined)":"")).join(" · ");
      const b0=list[0];
      /* 6el — a model every one of whose port rows is already redlined is not an open finding. It stays
         in the grid, because it is still a disagreement on the page, but at severity 2 and saying so —
         a sev-3 row sorts to the top and colours the group red, which put finished work above work
         that has not been started. */
      const allDone=list.every(m=>m.redlined);
      r.findings.unshift({kind:"port",sev:allDone?2:3,redlined:allDone,
        brief:(allDone?"disagrees but redlined — ":"")+
              b0.secPos+" "+(b0.label||"Model")+": printed "+JSON.stringify(b0.printed)+
              ", should be "+JSON.stringify(b0.correct)+
              (list.length>1?(" (+"+(list.length-1)+" more row"+(list.length>2?"s":"")+")"):""),
        text:(allDone?"Port Level disagrees with Antenna Position but is already redlined — "
                     :"Port Level does not match Antenna Position — ")+txt+
             (list.length>4?(" · +"+(list.length-4)+" more"):"")+
             (allDone?". Nothing further to do on these rows."
                     :". Redlining will correct the Port Level page.")});
      r.sev=Math.max(r.sev,allDone?2:3);
    });
    plv.orphan.forEach(o=>{
      const k=normModelKey(o.portModel); if(!k)return;
      const r=rows.find(x=>x.key===k); if(!r)return;
      r.findings.push({kind:"port",sev:1,
        text:"Port Level Sec-Pos "+o.secPos+" has no matching row on Antenna Position Details."});
      r.sev=Math.max(r.sev,1);
    });
  }
  rows.sort((a,b)=>b.sev-a.sev||b.findings.length-a.findings.length||a.label.localeCompare(b.label));
  const flagged=rows.filter(r=>r.findings.length);
  const kinds=k=>flagged.filter(r=>r.findings.some(f=>f.kind===k)).length;
  /* 2 (6cc): group by equipment type so the grid reads as a document, not a list */
  /* the removed kit never reaches the grid, the counts or the groups */
  rows=rows.filter(r=>!r.removed);
  const groups=[]; const gi=new Map();
  rows.forEach(r=>{
    const g=(r.types[0]?canonType(r.types[0]):"")||"Untyped";
    if(!gi.has(g)){ gi.set(g,{type:g,rows:[],sev:0,flagged:0}); groups.push(gi.get(g)); }
    const o=gi.get(g); o.rows.push(r); o.sev=Math.max(o.sev,r.sev); if(r.findings.length)o.flagged++;
  });
  groups.forEach(g=>g.rows.sort((a,b)=>b.sev-a.sev||a.label.localeCompare(b.label)));
  /* worst group first, then most disagreements, then alphabetically — Untyped always last */
  groups.sort((a,b)=>(a.type==="Untyped")-(b.type==="Untyped")||b.sev-a.sev||b.flagged-a.flagged||a.type.localeCompare(b.type));
  return {rows,flagged,have,bbu,rrh,port,groups,
          counts:{total:rows.length,flagged:flagged.length,bbu:kinds("bbu"),missing:kinds("missing"),
                  quantity:kinds("quantity"),spelling:kinds("spelling"),type:kinds("type"),
                  notes:kinds("notes"),port:kinds("port"),groups:groups.length,
                  rrh:(rrh.have&&!rrh.ok)?Math.max(1,rrh.extra.length+rrh.missing.length):0}};
}

/* The plain-text form: what gets copied, and what Claude is given to write about. Kept compact —
   a shorter table is a shorter report. */
/* 6ch — clipboard writes throw inside a sandboxed artifact frame, which is why ⇩ Copy did nothing at all.
   Try the real API, fall back to a hidden textarea + execCommand, and if even that is refused put the text
   on screen selected so it can be copied by hand. Never fail silently. */
function copyText(t,what){
  const ok=()=>setStatus((what||"Text")+" copied.");
  const manual=()=>{
    const m=document.getElementById("copyFallback")||(()=>{
      const d=el("div"); d.id="copyFallback";
      d.style.cssText="position:fixed;inset:auto 16px 16px 16px;z-index:80;background:var(--pop);"+
        "border:1px solid var(--accent);border-radius:10px;padding:10px;box-shadow:0 12px 40px var(--shadow-lg)";
      const h=el("div","az-secn","Your browser refused the clipboard. The text is selected — press Ctrl/Cmd+C, then close this.");
      const ta=el("textarea"); ta.id="copyFallbackText";
      ta.style.cssText="width:100%;height:180px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:7px;font:11px ui-monospace,monospace;padding:8px";
      const b=el("button","btn sm","✕ Close"); b.onclick=()=>d.remove();
      d.appendChild(h); d.appendChild(ta); d.appendChild(b); document.body.appendChild(d); return d;
    })();
    const ta=document.getElementById("copyFallbackText");
    ta.value=t; ta.focus(); ta.select();
    setStatus("Could not reach the clipboard — the text is on screen, ready to copy.",true);
  };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText)
      return navigator.clipboard.writeText(t).then(ok).catch(()=>{
        try{
          const ta=el("textarea"); ta.value=t;
          ta.style.cssText="position:fixed;left:-9999px;top:0";
          document.body.appendChild(ta); ta.select();
          const done=document.execCommand&&document.execCommand("copy");
          ta.remove();
          if(done)ok(); else manual();
        }catch(e){ manual(); }
      });
  }catch(e){}
  manual();
}
function discReportText(D){
  const L=[];
  L.push("EQUIPMENT MODEL CHECKLIST"+(S.atollName?(" — "+S.atollName):""));
  L.push("Tables read: "+DISC_SRC.filter(([k])=>D.have[k]).map(x=>x[2]).join(", ")+".");
  if(D.rrh&&D.rrh.note){ L.push("RRH: "+D.rrh.note);
    if(D.rrh.line)L.push((D.rrh.label||"RRH")+" on the Notes page: "+D.rrh.line); }
  L.push("BBU: "+(D.bbu.note||"not checked"));
  L.push("PORT LEVEL vs ANTENNA POSITION: "+((D.port&&D.port.note)||"no Port Level Details (Final) section"));
  /* 6el — name the rows that disagree but are already redlined, so the report does not read as a list of
     outstanding work when half of it is done. */
  if(D.port&&D.port.redlined&&D.port.redlined.length)
    L.push("  disagrees but redlined: "+D.port.redlined.slice(0,8)
      .map(m=>m.secPos+" "+(m.label||"Model")).join(", ")+
      (D.port.redlined.length>8?(" +"+(D.port.redlined.length-8)+" more"):""));
  if(D.port&&D.port.mismatch.length)D.port.mismatch.forEach(m=>
    L.push("   ! [port] "+m.secPos+" "+(m.label||"Model")+" — Port Level "+JSON.stringify(m.printed)+
           ", Antenna Position "+JSON.stringify(m.correct)+" (page "+(m.page+1)+")"));
  if(D.bbu.notesLine)L.push("BBU vs Notes page: "+D.bbu.notesLine);
  L.push(D.counts.flagged+" of "+D.counts.total+" model(s) disagree, across "+D.counts.groups+" equipment type(s).");
  D.groups.forEach(g=>{
    L.push("");
    L.push("== "+g.type+" ("+g.rows.length+" model"+(g.rows.length===1?"":"s")+
           (g.flagged?(", "+g.flagged+" disagreeing"):", all agree")+")");
    L.push("MODEL | "+DISC_SRC.map(x=>x[1]).join(" | ")+" | PAGES");
    g.rows.forEach(r=>{
      L.push(r.label+" | "+DISC_SRC.map(([k])=>r.src[k]?"yes":((r.twinSrc&&r.twinSrc[k])?"yes(other spelling)":(r.expect[k]?"NO":"n/a"))).join(" | ")+
             " | "+discPageList(r.pages).join(","));
      r.findings.forEach(f=>L.push("   ! ["+f.kind+"] "+f.text));
    });
  });
  return L.join("\n");
}

/* 6cf — write the report without asking anyone.
   The checklist is already computed, so the report over it can be too. This is what runs when there is no
   API to reach — the standalone artifact, a deploy with no key, an offline machine — which until now left
   Explain doing nothing visible at all. It is deterministic, which for a discrepancy report is a virtue
   rather than a compromise: same document, same words, every time. */
function discLocalReport(D){
  const c=D.counts;
  const sections=[];
  const cap=(list,n)=>list.slice(0,n);
  const pagesOf=r=>discPageList(r.pages).join(", ");
  const pick=kind=>D.flagged.filter(r=>r.findings.some(f=>f.kind===kind));
  const mk=(title,rows,kind,action)=>{
    if(!rows.length)return;
    sections.push({title,items:cap(rows,5).map(r=>({
      model:r.label,
      issue:(f0=>f0?(f0.brief||(f0.text.length>110?f0.text.slice(0,107)+"…":f0.text)):"")
            (r.findings.find(f=>f.kind===kind)),
      action:typeof action==="function"?action(r):action,
      pages:pagesOf(r)
    }))});
  };
  mk("BBU",pick("bbu"),"bbu","Confirm which BBU is actually being built");
  /* both models of a mismatch carry the finding so either leads you to it in the grid — but the report
     wants the problem once, listed under the model that is actually printed wrongly. */
  const seenPort=new Set();
  mk("Port Level vs Antenna Position",pick("port").filter(r=>{
    const f=r.findings.find(x=>x.kind==="port"); if(!f||!f.brief)return true;
    if(seenPort.has(f.brief))return false; seenPort.add(f.brief); return true;
  }),"port",r=>{
    /* 6el — a row already carrying its correction gets a different action, or the report tells you to do
       work that is done. */
    const f=r.findings.find(x=>x.kind==="port");
    return (f&&f.redlined)?"Already redlined — nothing further"
                          :"Redline to correct the Port Level page";
  });
  mk("Counts disagree",pick("quantity"),"quantity","Recount this model on the pages listed");
  mk("Missing from a table",pick("missing"),"missing","Confirm the model exists, or add the row");
  mk("Spelt two ways",pick("spelling"),"spelling","Unify the spelling before export");
  mk("Typed two ways",pick("type"),"type","Decide which equipment type is right");
  let verdict;
  if(!c.flagged) verdict="Every model reads the same in every table that carries it.";
  else if(c.rrh) verdict="The radios do not match the Notes page's RRH Configuration — that is the one to settle first.";
  else if(c.bbu) verdict="The BBU does not match between tables — that is the one to settle first.";
  else if(c.port) verdict=(D.port&&D.port.allRedlined)
    ? ("Port Level Details disagrees with Antenna Position on "+D.port.redlined.length+
       " row(s), and every one of them is already redlined.")
    : ("Port Level Details names a different antenna than Antenna Position on "+
       (D.port?(D.port.open||D.port.mismatch).length:0)+" row(s)."+
       ((D.port&&D.port.redlined.length)?(" A further "+D.port.redlined.length+
         " disagree but are already redlined."):""));
  else if(c.quantity) verdict=c.flagged+" model(s) disagree, mostly on quantity.";
  else if(c.missing) verdict=c.flagged+" model(s) appear in some tables and not others.";
  else verdict=c.flagged+" model(s) disagree across the tables.";
  const next=[];
  if(c.rrh)next.push("Settle the radios against the Notes page's RRH Configuration line");
  if(c.bbu)next.push("Settle the BBU against the Notes page and the build plan");
  if(c.port&&!(D.port&&D.port.allRedlined))next.push("Redline the Port Level page to the Antenna Position models");
  if(c.quantity)next.push("Recount the models flagged above on their own pages");
  if(c.spelling)next.push("Unify any model printed two ways before exporting");
  if(c.missing&&!c.bbu)next.push("Confirm the models that appear in only one table");
  if(!next.length)next.push("Nothing to chase — the tables agree");
  return {verdict,confidence:"high",sections,next,_local:true};
}
let _discReport="";      // raw text Claude returned, kept so switching tabs does not lose it
let _discReportObj=null; // the same thing parsed — rendered as sections whenever it parses
let _discBusy=false, _discStage="", _discT0=0, _discTimer=null;
function _discSetStage(t){
  _discStage=t;
  const n=document.getElementById("discStage"); if(n)n.textContent=t;
}
function _discTick(){
  const n=document.getElementById("discElapsed"); if(!n)return;
  const sec=Math.round((performance.now()-_discT0)/1000);
  n.textContent=sec+"s";
}
async function discExplain(){
  const D=buildDiscrepancies();
  if(!D.flagged.length&&!D.bbu.note&&!(D.rrh&&D.rrh.note)){ setStatus("Nothing to explain — no discrepancies found."); return; }
  _discBusy=true; _discT0=performance.now();
  _discStage="Comparing "+D.counts.total+" model(s) across "+
             DISC_SRC.filter(([k])=>D.have[k]).length+" table(s)…";
  renderAnalyze();
  if(_discTimer)clearInterval(_discTimer);
  _discTimer=setInterval(_discTick,250);
  try{
    const table=discReportText(D);
    _discSetStage("Sending the checklist to Claude…");
    await new Promise(r=>setTimeout(r,60));           // let the stage line paint before the request blocks
    const prompt=
      "Below is a COMPUTED checklist of every equipment model in an AT&T RFDS and which of the document's "+
      "tables each one appears in, grouped by equipment type. It was produced by reading the tables "+
      "directly. Treat every value in it as fact: do not re-derive, re-count or contradict it.\n\n"+
      "Return ONLY JSON — no prose, no markdown fence — in exactly this shape:\n"+
      '{"verdict":"...","confidence":"high|medium|low",'+
      '"sections":[{"title":"...","items":[{"model":"...","issue":"...","action":"...","pages":"1, 3"}]}],'+
      '"next":["...","..."]}\n\n'+
      "Rules:\n"+
      "- verdict: one sentence, at most 25 words — is this document internally consistent, and what is the "+
      "single biggest problem?\n"+
      "- sections: group the problems the way an engineer would work through them, worst first. Put the BBU "+
      "first whenever the BBU line reports a disagreement, then Port Level. Title of 1-4 words, e.g. "+
      "\"BBU mismatch\", \"Port Level\", "+
      "\"Counts disagree\", \"Spelt two ways\", \"Missing from a table\".\n"+
      "- issue: at most 14 words, saying what disagrees. action: at most 12 words, imperative — what to "+
      "check or change on the page. pages: the page numbers as printed in the checklist.\n"+
      "- At most 5 sections, at most 5 items each. Never list something that agrees.\n"+
      "- next: 1 to 3 imperative lines, at most 12 words each, in the order to do them.\n"+
      "- confidence: low when a finding could be a reading error rather than a real difference.\n"+
      "- Never invent a model, page or number that is not in the checklist. Say \"unclear\" rather than "+
      "guessing.\n\n"+
      table;
    _discSetStage("Waiting for Claude to write the report…");
    _discReport=await askClaudeText(prompt);
    /* Structured when it parses, raw text when it does not. A model that ignores the schema must not cost
       you the answer, so the fallback still renders — it just renders plainer. */
    _discReportObj=null;
    try{ const j=parseJson(_discReport);
         if(j&&(j.verdict||Array.isArray(j.sections)))_discReportObj=j; }catch(e){}
    LOG("Discrepancy report: "+_discReport.length+" chars in "+
        Math.round((performance.now()-_discT0)/1000)+"s"+
        (_discReportObj?" (structured)":" (plain text — the JSON did not parse)"));
    setStatus("Discrepancy report ready.");
  }catch(e){
    /* 6cf: no API here — a standalone build, a deploy with no key, or simply offline. Write the report
       locally rather than leaving the button looking broken. */
    LOG("Discrepancy report: the API is unreachable ("+(e&&e.message||String(e))+") — writing it locally instead");
    try{
      _discReportObj=discLocalReport(D);
      _discReport=JSON.stringify(_discReportObj);
      setStatus("No connection to Claude — wrote the report from the checklist instead.");
    }catch(e2){
      _discReport=""; _discReportObj=null;
      LOG("Local report failed too:",e2&&e2.message||String(e2));
      setStatus("Could not write the report: "+(e&&e.message||e)+" — the checklist below is still complete.",true);
    }
  }
  if(_discTimer){ clearInterval(_discTimer); _discTimer=null; }
  _discBusy=false; _discStage="";
  renderAnalyze();
}

/* 6ch — the tab, rebuilt. What was wrong with it: every finding's full sentence sat inside the grid, so
   four columns of ticks were pushed against a wall of prose and neither could be read; the two verdict
   bands were a bold word and a paragraph; the report was a stack of loose lines; and the toggle button was
   labelled with its own state rather than what pressing it would do. */
const DISC_KIND={bbu:["BBU","BBU"],port:["PORT","Port Level"],missing:["MISSING","Missing"],
  quantity:["COUNT","Quantity"],spelling:["SPELLING","Spelt two ways"],type:["TYPE","Typed two ways"],
  notes:["NOTES","Notes page"],note:["NOTE","Note"]};
function discVerdictCard(kind,title,note,state,detail){
  const c=el("div","disc-card "+(state||""));
  const h=el("div","disc-card-h");
  h.innerHTML='<span class="disc-card-t">'+escapeHtml(title)+"</span>"+
    '<span class="disc-pill disc-pill-'+(state||"none")+'">'+
    (state==="ok"?"agrees":state==="bad"?"disagrees"
      :state==="warn"?"disagrees but redlined":"for information")+"</span>";
  c.appendChild(h);
  c.appendChild(el("div","disc-card-b",escapeHtml(note)));
  if(detail)c.appendChild(detail);
  return c;
}
function renderDiscrepancyPane(){
  const p=el("div","az-pane active");
  const A=S.analysis;
  if(!A){ p.appendChild(el("div","az-empty","Run Analyze RFDS first — this tab compares the tables it reads.")); return p; }
  const D=buildDiscrepancies();
  const c=D.counts;

  /* ---- the two named checks, as cards ---- */
  const cards=el("div","disc-cards");
  /* 6df — the radios first: it is the check that most often decides whether the rest is worth reading. */
  if(D.rrh&&D.rrh.note){
    let det=null;
    if(D.rrh.line){
      det=el("div","disc-card-n");
      det.textContent="Notes page "+((D.rrh.page!=null?D.rrh.page+1:"?"))+
        (D.rrh.label?(" — "+D.rrh.label+": "):" — ")+D.rrh.line;
    }
    cards.appendChild(discVerdictCard("rrh","RRH",D.rrh.note,
      D.rrh.ok?"ok":(c.rrh?"bad":""),det));
  }
  if(D.bbu&&D.bbu.note){
    let det=null;
    if(D.bbu.notesLine){ det=el("div","disc-card-n",escapeHtml(D.bbu.notesLine)); }
    cards.appendChild(discVerdictCard("bbu","BBU",D.bbu.note,D.bbu.ok?"ok":(c.bbu?"bad":""),det));
  }
  if(D.port&&D.port.note){
    let det=null;
    if(D.port.mismatch.length){
      det=el("table","disc-mini");
      const hr=el("tr");
      ["Sec-Pos","Field","On Port Level","Should be","State"].forEach(h=>hr.appendChild(el("th",null,h)));
      det.appendChild(hr);
      /* 6el — the outstanding rows first, so what is left to do is what you read. */
      const ordered=D.port.mismatch.slice().sort((a,b)=>(a.redlined?1:0)-(b.redlined?1:0));
      ordered.slice(0,8).forEach(m=>{
        const tr=el("tr",m.redlined?"disc-done":null);
        tr.appendChild(el("td",null,"<b>"+escapeHtml(m.secPos)+"</b>"));
        tr.appendChild(el("td","disc-fld",escapeHtml(m.label||"Model")));
        tr.appendChild(el("td","disc-was",escapeHtml(m.printed||"—")));
        tr.appendChild(el("td","disc-now",escapeHtml(m.correct||"—")));
        tr.appendChild(el("td",m.redlined?"disc-st-done":"disc-st-open",
          m.redlined?"disagrees but redlined":"disagrees"));
        det.appendChild(tr);
      });
      if(ordered.length>8){
        const tr=el("tr"); const td=el("td",null,"+"+(ordered.length-8)+" more"); td.colSpan=5;
        td.className="disc-more"; tr.appendChild(td); det.appendChild(tr);
      }
    }
    /* 6el — a page whose every disagreement is already redlined is neither "agrees" nor "disagrees".
       It gets its own orange state, so it stops reading as outstanding work. */
    const state=D.port.ok?"ok":(D.port.allRedlined?"warn":(c.port?"bad":""));
    cards.appendChild(discVerdictCard("port","Port Level vs Antenna Position",D.port.note,state,det));
  }
  if(cards.children.length)p.appendChild(cards);

  /* ---- one line of numbers, not a paragraph ---- */
  const bits=[["RRH",c.rrh],["BBU",c.bbu],["port level",c.port],["missing",c.missing],["quantity",c.quantity],
              ["spelt two ways",c.spelling],["typed two ways",c.type]].filter(x=>x[1]);
  const sum=el("div","disc-sum");
  sum.innerHTML="<b>"+c.flagged+"</b> of "+c.total+" model(s) disagree"+
    (bits.length?(" — "+bits.map(x=>"<b>"+x[1]+"</b> "+x[0]).join(" · ")):"")+
    '<span class="disc-legend">✓ present · ✗ missing · ≈ other spelling · · not expected</span>';
  p.appendChild(sum);

  /* ---- controls. The toggle says what pressing it DOES. ---- */
  const bar=el("div","disc-bar");
  const only=el("button","btn sm"+(_discOnlyFlagged?" on":""),
    _discOnlyFlagged?"Show every model":"Show only disagreements");
  only.title=_discOnlyFlagged?"Currently showing only the models that disagree"
                             :"Currently showing every model that was read";
  only.onclick=()=>{ _discOnlyFlagged=!_discOnlyFlagged; renderAnalyze(); };
  bar.appendChild(only);
  /* 6dv — "Suggest redlines" removed from this tab: it proposed values you then had to review and undo
     more often than accept, and the footer's ✧ still offers it for anyone who wants it. */
  const nsg=sgCount(null);
  if(nsg){
    const un=el("button","btn sm azico","⊘ Remove suggested"); un.dataset.g="⊘";
    un.title=nsg+" suggested value(s) on the grids — click to put them all back";
    un.onclick=sgRemoveFlow;
    bar.appendChild(un);
  }
  /* 6dv — "Copy the checklist" removed: Explain already writes the report you would paste. */
  /* 6ch: one button. "Explain" and "Summarise offline" did the same job — this asks Claude when it can
     reach it and writes the report itself when it cannot, which is what both of them already did. */
  /* 6fk — a bulb, drawn rather than typed. The glyph it replaced was U+25A4, a shaded square, which
     said nothing about what the button does; and an SVG takes `currentColor`, so it reads correctly in
     all 23 palettes and both modes without a rule per theme. */
  /* THREE BARS IS THE LOGO; AT 15px IT IS A SMUDGE. Rendered and looked at: the 1.4-unit gaps in a
     24-unit box come out under a pixel and the base fused into a stem. The head plus one banded base
     is what actually reads as a bulb at this size. */
  const BULB='<svg class="bulbico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" '
    +'focusable="false"><circle cx="12" cy="8.6" r="6.9"/><path d="M9 14.2h6v2.6H9z"/>'
    +'<rect x="8.1" y="17.9" width="7.8" height="2.8" rx="1.4"/>'
    +'<rect x="9.9" y="21.6" width="4.2" height="2.4" rx="1.2"/></svg>';
  const ex=el("button","btn sm primary",_discBusy?"… writing the report":(BULB+" Explain"));
  ex.disabled=_discBusy||(!D.flagged.length&&!(D.bbu&&D.bbu.note)&&!(D.port&&D.port.note)&&!(D.rrh&&D.rrh.note));
  ex.title="Write a short report on the checklist below — Claude if it is reachable, otherwise generated here";
  ex.onclick=discExplain;
  bar.appendChild(ex);
  if(_discReport&&!_discBusy){
    const clr=el("button","btn sm","✕ Clear the report");
    clr.onclick=()=>{ _discReport=""; _discReportObj=null; renderAnalyze(); };
    bar.appendChild(clr);
  }
  p.appendChild(bar);

  if(_discBusy){
    const pr=el("div","disc-prog");
    const h=el("div","disc-prog-h");
    h.innerHTML='<span class="disc-spin"></span><span id="discStage">'+escapeHtml(_discStage)+'</span>'+
                '<span class="disc-prog-t" id="discElapsed">0s</span>';
    pr.appendChild(h);
    const track=el("div","disc-prog-bar"); track.appendChild(el("i")); pr.appendChild(track);
    pr.appendChild(el("div","disc-prog-n",
      "Claude returns the report in one piece, so there is no percentage to show — that is elapsed time, not progress. The checklist below is already complete and does not depend on it."));
    p.appendChild(pr);
    setTimeout(_discTick,0);
  }
  if(_discReport&&!_discBusy)p.appendChild(renderDiscReport());

  /* ---- the checklist ---- */
  const groups=D.groups.map(g=>({type:g.type,flagged:g.flagged,
      rows:_discOnlyFlagged?g.rows.filter(r=>r.findings.length):g.rows})).filter(g=>g.rows.length);
  if(!groups.length){
    p.appendChild(el("div","az-empty",D.rows.length
      ? "No disagreements. Every model reads the same in every table that carries it."
      : "No equipment models were read from this document."));
    return p;
  }
  const t=el("table","az disc-tbl");
  const thd=el("thead"); const hr=el("tr");
  hr.appendChild(el("th",null,"Model"));
  DISC_SRC.forEach(([k,short,full])=>{
    const th=el("th","disc-th",escapeHtml(short));
    th.title=full+(D.have[k]?"":" — no such table was read from this document");
    if(!D.have[k])th.className="disc-th disc-off";
    hr.appendChild(th);
  });
  hr.appendChild(el("th",null,"Pages"));
  hr.appendChild(el("th",null,"What disagrees"));
  thd.appendChild(hr); t.appendChild(thd);
  const NCOL=DISC_SRC.length+3;
  const tb=el("tbody");
  groups.forEach(g=>{
    const gh=el("tr","disc-grp"); const gtd=el("td"); gtd.colSpan=NCOL;
    gtd.innerHTML='<span class="disc-grp-n">'+escapeHtml(g.type)+"</span>"+
      '<span class="disc-grp-c">'+g.rows.length+" model"+(g.rows.length===1?"":"s")+
      (g.flagged?(" · <b>"+g.flagged+"</b> disagreeing"):" · all agree")+"</span>";
    gh.appendChild(gtd); tb.appendChild(gh);
    g.rows.forEach(r=>{
      const tr=el("tr","disc-row"+(r.sev>=2?" chg":""));
      const td0=el("td","disc-m");
      td0.innerHTML="<b>"+escapeHtml(r.label)+"</b>"+
        (r.types.length?('<span class="disc-ty">'+escapeHtml(r.types.join(" / "))+"</span>"):"");
      tr.appendChild(td0);
      DISC_SRC.forEach(([k,,full])=>{
        const o=r.src[k], td=el("td","disc-c");
        if(o){ td.innerHTML='<span class="disc-ok">✓</span>'+
                 (o.qty?('<span class="disc-dim">'+escapeHtml(String(o.qty))+"</span>"):"");
               td.title=full+": "+o.rows+" row"+(o.rows===1?"":"s")+
                 (o.qty?(", qty "+o.qty):"")+(o.sectors.size?(", sector "+[...o.sectors].sort().join("/")):"")+
                 ", page "+discPageList(o.pages).join(", "); }
        else if(r.twinSrc&&r.twinSrc[k]){ td.innerHTML='<span class="disc-twin">≈</span>';
          td.title="In "+full+' under the other spelling, "'+r.twinLabel[k]+'" — the same model, not a missing one.'; }
        else if(r.expect[k]){ td.innerHTML='<span class="disc-bad">✗</span>'; td.title="Missing from "+full; }
        else { td.innerHTML='<span class="disc-na">·</span>';
          td.title=D.have[k]?("Not expected in "+full+" for this kind of equipment"):(full+" was not read from this document"); }
        tr.appendChild(td);
      });
      tr.appendChild(el("td","disc-pg",escapeHtml(discPageList(r.pages).join(", "))||"—"));
      const fd=el("td","disc-f-cell");
      if(!r.findings.length)fd.innerHTML='<span class="az-chg no">agrees</span>';
      else{
        /* chips in the grid, sentences one click away — the grid stays scannable either way */
        fd.innerHTML=r.findings.map(f=>{
          const k=DISC_KIND[f.kind]||[f.kind.toUpperCase(),f.kind];
          return '<span class="disc-chip disc-k-'+f.kind+(f.redlined?" done":"")+
            '" title="'+escapeHtml(f.text)+'">'+k[0]+"</span>";
        }).join("")+'<span class="disc-open">details</span>';
        fd.style.cursor="pointer";
      }
      tr.appendChild(fd);
      tb.appendChild(tr);
      if(r.findings.length){
        const dr=el("tr","disc-det"); const dtd=el("td"); dtd.colSpan=NCOL;
        dtd.innerHTML=r.findings.map(f=>{
          const k=DISC_KIND[f.kind]||[f.kind.toUpperCase(),f.kind];
          return '<div class="disc-det-l"><span class="disc-chip disc-k-'+f.kind+(f.redlined?" done":"")+
            '">'+k[0]+"</span>"+escapeHtml(f.text)+"</div>";
        }).join("");
        dr.appendChild(dtd); tb.appendChild(dr);
        const toggle=()=>{ dr.classList.toggle("show"); tr.classList.toggle("open"); };
        fd.onclick=toggle; td0.style.cursor="pointer"; td0.onclick=toggle;
      }
    });
  });
  t.appendChild(tb); p.appendChild(t);
  return p;
}
/* the report, as tables */
function renderDiscReport(){
  const box=el("div","disc-report");
  const J=_discReportObj;
  const h=el("div","disc-report-h");
  h.innerHTML=((J&&J._local)
    ? "Written from the checklist below — no connection to Claude, so this one is generated here"
    : "Claude's report — written from the checklist below, which is the record")+
    ((J&&J.confidence)?(' <span class="disc-conf disc-conf-'+escapeHtml(String(J.confidence))+'">'+
      escapeHtml(String(J.confidence))+" confidence</span>"):"");
  box.appendChild(h);
  if(!J){ box.appendChild(el("div","disc-report-b",escapeHtml(_discReport))); return box; }
  if(J.verdict)box.appendChild(el("div","disc-verdict",escapeHtml(String(J.verdict))));
  (J.sections||[]).forEach(sec=>{
    if(!sec||!(sec.items||[]).length)return;
    box.appendChild(el("div","disc-sec-h",escapeHtml(String(sec.title||""))));
    const t=el("table","disc-rtbl");
    const hr=el("tr"); ["Model","What is wrong","What to do","Pages"].forEach(x=>hr.appendChild(el("th",null,x)));
    t.appendChild(hr);
    (sec.items||[]).forEach(it=>{
      if(!it)return;
      const tr=el("tr");
      tr.appendChild(el("td",null,"<b>"+escapeHtml(String(it.model||"—"))+"</b>"));
      tr.appendChild(el("td",null,escapeHtml(String(it.issue||""))));
      tr.appendChild(el("td","disc-act",escapeHtml(String(it.action||""))));
      tr.appendChild(el("td","disc-pg",escapeHtml(String(it.pages||""))));
      t.appendChild(tr);
    });
    box.appendChild(t);
  });
  if(J.next&&J.next.length){
    box.appendChild(el("div","disc-sec-h","Do this next"));
    const ol=el("ol","disc-next");
    J.next.forEach(x=>ol.appendChild(el("li",null,escapeHtml(String(x)))));
    box.appendChild(ol);
  }
  return box;
}
let _discOnlyFlagged=false;      // the checklist is the point of the tab: show every model by default
/* ================================================================================================
   6cd — "What should I read?"
   ------------------------------------------------------------------------------------------------
   Analyze RFDS used to start reading the whole document the moment it was clicked. On a long RFDS that
   is a long wait and one AI request per page of the sections that need one, with no way to say "just
   the Design Summary" or "only pages 3-6". The first click now opens this instead: what was detected,
   how many pages each section has, what it costs, and a choice. Nothing is read until you pick.

   Detection itself is free — it reads text already extracted from the pages, no AI — so the chooser can
   show the real page numbers before committing to anything.
   ================================================================================================ */
/* 6et — the third field used to mean "this section costs one request per page", and every section is
   read from the page's own geometry now (see the probe in analyzeRFDS), so it is false throughout. It is
   kept rather than removed because a section that geometry cannot read still falls back to the model, and
   this is where that would be declared again. */
const AZ_SECTIONS=[
  ["designSummary","Design Summary",false],
  ["equipmentCalc","Equipment in Calculation",false],
  ["antennaPosition","Antenna Position Details (Final)",false],
  ["antennaExisting","Antenna Position Details (Existing)",false],
  ["antennaDecom","Antenna Position Details (Decommissioned)",false],
  ["rfInventory","RF Inventory (Final)",false],
  ["nonRfInventory","Non RF Inventory Details (Final)",false],
  /* 6cl — Port Level Details was never listed here. It did not matter while "Read the whole document"
     existed, because that button bypassed the chooser entirely; with one button left, a section missing
     from this list is a section that never gets read. */
  ["portLevel","Port Level Details (Final)",false],
  ["rfdsDetails","RFDS Details",false],
  ["siteDetails","Site Details",false]
];
let _azScopeOff=new Set();          // section keys the user has unticked
let _azScopePages="";               // the free-text page box
const AZ_SCOPE_KEY="rfds.analyzeScope";
function azScopeSections(){
  let secs=null;
  try{ secs=detectSections(); }catch(e){ LOG("Analyze chooser: detectSections failed:",e&&e.message); }
  return secs||{};
}
/* the pages the current choice would read */
function azScopeSet(secs){
  const set=new Set();
  AZ_SECTIONS.forEach(([k])=>{ if(_azScopeOff.has(k))return; (secs[k]||[]).forEach(p=>set.add(p)); });
  const typed=parsePageRange(_azScopePages,S.pages.length);
  if(typed.size){
    /* the page box narrows the ticked sections rather than replacing them — asking for "pages 3-6" of a
       section you have unticked would otherwise silently read it anyway */
    [...set].forEach(p=>{ if(!typed.has(p))set.delete(p); });
  }
  return set;
}
function renderAnalyzeScope(){
  const p=el("div","az-pane active");
  if(!S.doc){ p.appendChild(el("div","az-empty","Open an RFDS first.")); return p; }
  const secs=azScopeSections();
  const set=azScopeSet(secs);
  const known=new Set(); AZ_SECTIONS.forEach(([k])=>(secs[k]||[]).forEach(x=>known.add(x)));

  p.appendChild(el("div","az-sech","What should I read?"));
  p.appendChild(el("div","az-secn",
    "These are the sections found in this document — nothing has been read yet. Every section is read "+
    "from the page itself, so untick anything you do not need only to make it quicker. You can widen "+
    "the scope later with <b>\u21bb Re-analyze</b>."));

  const list=el("div","az-scope");
  AZ_SECTIONS.forEach(([k,label,isAi])=>{
    const pages=secs[k]||[];
    const row=el("label","az-scope-row"+(pages.length?"":" empty"));
    const cb=el("input"); cb.type="checkbox"; cb.checked=pages.length>0&&!_azScopeOff.has(k);
    cb.disabled=!pages.length;
    cb.onchange=()=>{ if(cb.checked)_azScopeOff.delete(k); else _azScopeOff.add(k);
      renderAnalyze(); };
    row.appendChild(cb);
    const nm=el("span","az-scope-n",escapeHtml(label));
    row.appendChild(nm);
    row.appendChild(el("span","az-scope-geo","read from the page"));
    row.appendChild(el("span","az-scope-p",pages.length
      ? (pages.length+" page"+(pages.length===1?"":"s")+" · "+pages.map(x=>x+1).join(", "))
      : "not in this document"));
    list.appendChild(row);
  });
  p.appendChild(list);

  const unread=[]; for(let i=0;i<S.pages.length;i++) if(!known.has(i)&&!(secs.notes||[]).indexOf(i)>=0) unread.push(i+1);
  const notes=(secs.notes||[]).map(x=>x+1);
  if(notes.length)p.appendChild(el("div","az-secn",
    "Page "+notes.join(", ")+" "+(notes.length===1?"is":"are")+" Local Market Notes — never read into a grid and never redlined, but the BBU check does look there for a model number."));

  const pr=el("div"); pr.style.cssText="display:flex;align-items:center;gap:9px;margin:12px 0 4px;flex-wrap:wrap";
  pr.appendChild(el("span","az-secn","Narrow further to pages"));
  const pi2=el("input","az-in"); pi2.style.maxWidth="150px"; pi2.placeholder="e.g. 2-5, 8";
  pi2.value=_azScopePages;
  pi2.oninput=()=>{ _azScopePages=pi2.value; azScopeRefreshCount(secs); };
  pr.appendChild(pi2);
  pr.appendChild(el("span","az-secn","Leave blank for every page of the ticked sections."));
  p.appendChild(pr);

  const sum=el("div","az-scope-sum"); sum.id="azScopeSum";
  p.appendChild(sum);

  const bar=el("div"); bar.style.cssText="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px";
  const go=el("button","btn primary","\u25B8 Read the selected pages");
  go.id="azScopeGo";
  go.onclick=()=>{
    const use=azScopeSet(azScopeSections());
    if(!use.size){ setStatus("Nothing selected to read.",true); return; }
    analyzeRFDS(use);
  };
  bar.appendChild(go);
  /* 6cl — "Read the whole document" is gone. Every section starts ticked, so the one button already
     reads everything; two buttons that did the same thing only invited the wrong one. */
  p.appendChild(bar);
  setTimeout(()=>azScopeRefreshCount(secs),0);
  return p;
}
/* Recount without re-rendering: the page box must not lose focus on every keystroke. */
function azScopeRefreshCount(secs){
  const sum=document.getElementById("azScopeSum"); if(!sum)return;
  secs=secs||azScopeSections();
  const set=azScopeSet(secs);
  sum.innerHTML="<b>"+set.size+"</b> page"+(set.size===1?"":"s")+" of "+S.pages.length+
    " will be read \u00b7 every one straight off the page.";
  sum.classList.toggle("none",!set.size);
  const go=document.getElementById("azScopeGo");
  if(go){ go.disabled=!set.size;
    go.textContent=set.size?("\u25B8 Read "+set.size+" page"+(set.size===1?"":"s")):"Nothing selected"; }
}
function renderAnalyze(){
  /* Nothing read yet — show the chooser rather than an empty set of tabs. */
  if(!S.analysis){
    const tw0=$("#azTabs"); if(tw0)tw0.innerHTML="";
    const fb0=document.getElementById("azFilterBar"); if(fb0)fb0.style.display="none";
    const b0=$("#azBody"); if(b0){ b0.innerHTML=""; b0.appendChild(renderAnalyzeScope()); }
    const sub=$("#azSub"); if(sub)sub.textContent="Nothing has been read yet — choose what to read.";
    const ap=$("#azApply"); if(ap)ap.disabled=true;
    try{ refreshAzFoot(); }catch(e){}
    return;
  }
  carryRfInsertsToDs(); syncModels();
  const A=S.analysis||{designSummary:[],rfInventory:[],antennaPosition:[],equipmentCalc:[]};
  const counts={
    detection:"",
    designSummary:(A.designSummary||[]).length,
    rfInventory:((A.rfInventory&&A.rfInventory.rows)||[]).length,
    antennaPosition:(A.antennaPosition||[]).length,
    /* 6ce — the pip read 0 while the tab showed seven rows. The Equipment in Calc tab renders the PRINTED
       table (A.ecTable) whenever the document has one and only falls back to the derived list; the pip
       counted the derived list either way. Count whatever the tab is actually showing. */
    equipmentCalc:((A.ecTable&&A.ecTable.columns&&A.ecTable.columns.length>=2&&A.ecTable.rows&&A.ecTable.rows.length)
                    ? A.ecTable.rows.length : (A.equipmentCalc||[]).length),
  };
  counts.rfdsDetails=(A.rfdsDetails||[]).length;
  counts.siteDetails=(A.siteDetails||[]).length;
  /* 6ca: the pip counts DISAGREEMENTS, not models — the number you want to see is how much is wrong. */
  try{ counts.discrepancies=S.analysis?buildDiscrepancies().counts.flagged:""; }catch(e){ counts.discrepancies=""; }
  /* 6fk — Ced: "in discrep, make the color of tabs show green red or orange based on if they agree,
     disagree, or redlined." The cards carry it, and so does the tab itself: red while anything is still
     outstanding, orange once every disagreement left has been redlined, green when the checks agree —
     so the verdict is readable without opening the tab. The three states are the ones the cards already
     use, taken from the same places, so the tab can never disagree with what is inside it. */
  let _discV="";
  try{
    const D=buildDiscrepancies(), dc=D.counts, st=[];
    if(D.rrh&&D.rrh.note) st.push(D.rrh.ok?"ok":(dc.rrh?"bad":""));
    if(D.bbu&&D.bbu.note) st.push(D.bbu.ok?"ok":(dc.bbu?"bad":""));
    if(D.port&&D.port.note) st.push(D.port.ok?"ok":(D.port.allRedlined?"warn":(dc.port?"bad":"")));
    if(dc.flagged) st.push("bad");
    _discV = st.indexOf("bad")>=0 ? "bad"
           : st.indexOf("warn")>=0 ? "warn"
           : (st.length && st.every(x=>x==="ok")) ? "ok" : "";
  }catch(e){ _discV=""; }
  const tabs=[["detection","Detection"],["rfdsDetails","RFDS Details"],["siteDetails","Site Details"],["designSummary","Design Summary"],["rfInventory","RF Inventory"],["antennaPosition","Antenna Position"],["equipmentCalc","Equipment in Calc"],["discrepancies","Discrepancies"]];
  const tabWrap=$("#azTabs"); tabWrap.innerHTML="";
  /* 6fn — EACH TAB WEARS ITS GROUP'S COLOUR. Ced's list: Detection, RFDS Details and Site Details are
     grey — they are what the document says about itself; the four data tabs are blue — they are the
     tables you edit; Discrepancies is red — it is the one that reports a problem. The colour is in the
     tab and in its shadow, the way the discrepancy verdict already was.
     A verdict class, when there is one, is written after this and wins: red is Discrepancies' resting
     colour and also its commonest state, but a document where every check agrees still turns it green. */
  const TAB_HUE={detection:"grey", rfdsDetails:"grey", siteDetails:"grey",
                 designSummary:"blue", rfInventory:"blue", antennaPosition:"blue",
                 equipmentCalc:"blue", discrepancies:"red"};
  tabs.forEach(([k,lbl])=>{ const b=el("button","az-tab"+(k===_azTab?" active":"")
      +(TAB_HUE[k]?(" c-"+TAB_HUE[k]):"")
      +((k==="discrepancies"&&_discV)?(" v-"+_discV):""),
      lbl+(counts[k]!==""?`<span class="pip">${counts[k]}</span>`:""));
    if(k==="discrepancies"&&_discV) b.title=(_discV==="ok"?"Every check agrees"
      :_discV==="warn"?"Everything that disagrees has been redlined":"Something still disagrees");
    b.onclick=()=>{ _azTab=k; renderAnalyze(); }; tabWrap.appendChild(b); });
  fitAzTabs();
  const body=$("#azBody"); body.innerHTML="";
  try{ const fb=document.getElementById("azFilterBar");
       if(fb)fb.style.display=(_azTab==="detection"||_azTab==="discrepancies")?"none":""; }catch(e){}
  if(_azTab==="detection") body.appendChild(renderDetectionPane());
  else if(_azTab==="discrepancies") body.appendChild(renderDiscrepancyPane());
  else if(_azTab==="antennaPosition") body.appendChild(renderAntennaPane());
  else if(_azTab==="rfInventory") body.appendChild(renderRfPane());
  else if(_azTab==="rfdsDetails"||_azTab==="siteDetails") body.appendChild(renderDetailsPane(_azTab));
  else body.appendChild(renderCountPane(_azTab));
  $("#azSub").textContent=(S.analysis&&S.analysis.scope&&S.analysis.scope.length)
    ? ("Read "+S.analysis.scope.length+" of "+S.pages.length+" pages (page "+
       S.analysis.scope.map(p=>p+1).join(", ")+") — ↻ Re-analyze to widen the scope.")
    : "Values are auto-filled from the RFDS — edit any that are wrong, hit ⛔ to strike a row, then redline.";
  updateNoRedlineBtn();
  azUpdateHistButtons();
  refreshAzFoot();
  azApplyFilter&&azApplyFilter();
  azLinkBarSync&&azLinkBarSync();
  azSelClear&&azSelClear();   // the old cell elements are gone after a re-render
}
/* ================================================================================================
   6eu — THE TAB STRIP IS ONE LINE, WHATEVER THE WINDOW IS.
   ------------------------------------------------------------------------------------------------
   6et set the tabs in caps with the tracking opened out and measured that eight of them fit — at 1920.
   Caps and tracking make a word wider, so on a narrower window the eighth wrapped onto a second row and
   took 40px of table with it. A fixed number cannot be right at every width, so this measures instead:
   the strip is `nowrap`, and the tracking comes down a step at a time until the row fits. Tracking goes
   first because it is the cheapest thing to lose — the letters keep their size — then the padding, then
   the type. The steps are ordered so the FIRST one that fits is used, which on a wide window is the full
   setting and on a narrow one is only as tight as it has to be.
   Nothing is hidden: if even the tightest step does not fit, the strip scrolls sideways rather than
   dropping a tab or wrapping. See noai_typeset.py, which drives four widths.
   ================================================================================================ */
const AZ_TAB_STEPS=[
  {ls:".09em",pad:"8px 8px", fs:"10px"},     /* as designed */
  {ls:".07em",pad:"8px 7px", fs:"10px"},
  {ls:".05em",pad:"8px 6px", fs:"10px"},
  {ls:".03em",pad:"8px 6px", fs:"9.5px"},
  {ls:".01em",pad:"8px 5px", fs:"9.5px"},
  {ls:"0",    pad:"8px 5px", fs:"9px"}
];
function fitAzTabs(){
  const w=document.getElementById("azTabs"); if(!w)return;
  const tabs=[...w.querySelectorAll(".az-tab")]; if(!tabs.length)return;
  const apply=st=>tabs.forEach(b=>{ b.style.letterSpacing=st.ls; b.style.padding=st.pad;
                                    b.style.fontSize=st.fs; });
  w.classList.add("fit");
  for(let i=0;i<AZ_TAB_STEPS.length;i++){
    apply(AZ_TAB_STEPS[i]);
    /* scrollWidth vs clientWidth is the question "does the row fit", asked of the strip itself — a row
       count read off the tabs' own tops cannot be asked while they are `nowrap`. */
    if(w.scrollWidth<=w.clientWidth+1){
      if(i)LOG&&LOG("Analyze tabs: tightened to step "+i+" ("+AZ_TAB_STEPS[i].ls+") to hold one row");
      return;
    }
  }
  LOG&&LOG("Analyze tabs: even the tightest step overflows by "+
           (w.scrollWidth-w.clientWidth)+"px — the strip scrolls");
}
/* the strip is re-measured when the window changes, because that is when it stops fitting */
(function(){ let t=0;
  window.addEventListener("resize",()=>{ clearTimeout(t); t=setTimeout(()=>{ try{ fitAzTabs(); }catch(e){} },120); });
})();
function renderDetectionPane(){
  /* 6cp — `let`, not `const`: the page table is wrapped in a fold and `p` is swapped for it partway
     through, then swapped back at the end. */
  let p=el("div","az-pane active");
  p.appendChild(el("div","az-sech","RFDS Type"));
  const type=S.isPreliminary?"PRELIMINARY":"FINAL";
  const box=el("div"); box.style.cssText="display:flex;align-items:center;gap:12px;margin-bottom:14px";
  const badge=el("span","az-chg "+(S.isPreliminary?"yes":"no")); badge.style.fontSize="12px"; badge.style.padding="4px 12px"; badge.textContent=type+" RFDS";
  box.appendChild(badge);
  const note=el("span","az-secn"); note.textContent=S.isPreliminary?"Indicators: .tmp UseId and/or Pre-Construction task detected. Output uses the Preliminary name.":"No preliminary indicators found — output uses the Final name.";
  box.appendChild(note); p.appendChild(box);
  p.appendChild(el("div","az-sech","Site Name (defaults to the ATOLL Site Name)"));
  const wrap=el("div"); wrap.style.cssText="display:flex;align-items:center;gap:10px;margin-bottom:8px";
  const inp=el("input","az-in wide"); inp.value=($("#s_site").value||S.atollName||S.name||""); inp.style.maxWidth="280px";
  inp.oninput=()=>{ S.atollName=inp.value.trim(); $("#s_site").value=inp.value; updateFnamePreview(); const fp=p.querySelector(".az-fname"); if(fp)fp.innerHTML=`<b>${escapeHtml(outputFilename())}.pdf</b>`; };
  wrap.appendChild(inp); p.appendChild(wrap);
  p.appendChild(el("div","az-sech","Export Filename"));
  const fn=el("div","az-fname"); fn.style.fontSize="13px"; fn.innerHTML=`<b>${escapeHtml(outputFilename())}.pdf</b>`; p.appendChild(fn);
  /* 6ce — every page, and what it was read as. Antenna Position reading zero rows was invisible until you
     opened the log: the tab just said "none detected". The question "why was my page not read?" is a
     detection question, so it is answered here, next to the detection. */
  /* 6cp — the page table is reference material, not the first thing you need: it opens closed. */
  const pgWrap=el("details","az-fold");
  const pgSum=el("summary","az-sech"); pgSum.textContent="What each page was read as";
  pgWrap.appendChild(pgSum);
  p={appendChild:x=>pgWrap.appendChild(x), _real:p, _fold:pgWrap};
  let secs=null; try{ secs=detectSections(); }catch(e){ LOG("Detection pane:",e&&e.message); }
  if(!secs){ p.appendChild(el("div","az-secn","Could not classify the pages."));
    if(p._real){ const real=p._real; real.appendChild(p._fold); p=real; } return p; }
  const KEYS=AZ_SECTIONS.map(x=>x[0]).concat(["rfInvExisting","rfInvDecom"]);
  const LBL={designSummary:"Design Summary",equipmentCalc:"Equipment in Calculation",
    antennaPosition:"Antenna Position (Final)",antennaExisting:"Antenna Position (Existing)",
    antennaDecom:"Antenna Position (Decommissioned)",rfInventory:"RF Inventory (Final)",
    nonRfInventory:"Non RF Inventory (Final)",rfdsDetails:"RFDS Details",siteDetails:"Site Details",
    rfInvExisting:"RF Inventory (Existing)",rfInvDecom:"RF Inventory (Decommissioned)"};
  const AI=new Set(AZ_SECTIONS.filter(x=>x[2]).map(x=>x[0]));
  const NEVER=new Set(["rfInvExisting","rfInvDecom"]);
  const t=el("table","az disc-tbl");
  const thd=el("thead"), hr=el("tr");
  ["Page","Heading on the page","Read as","How"].forEach(h=>hr.appendChild(el("th",null,h)));
  thd.appendChild(hr); t.appendChild(thd);
  const tb=el("tbody");
  let unread=0;
  for(let i=0;i<S.pages.length;i++){
    const P2=S.pages[i]||{items:[]};
    const band=(P2.items||[]).filter(x=>x.ny<0.14);
    const src=(band.length>=2?band:(P2.items||[]).slice(0,40));
    let head=src.map(x=>x.str).join(" ").replace(/\s+/g," ").trim().slice(0,70);
    const inNotes=(secs.notes||[]).indexOf(i)>=0;
    const key=inNotes?null:KEYS.find(k=>(secs[k]||[]).indexOf(i)>=0);
    const tr=el("tr");
    tr.appendChild(el("td",null,"<b>"+(i+1)+"</b>"));
    tr.appendChild(el("td","az-derived",escapeHtml(head||"(no text in the title band)")));
    if(inNotes){
      tr.appendChild(el("td",null,'<span class="disc-k-note">Local Market Notes</span>'));
      tr.appendChild(el("td","az-derived","never read, never redlined — the BBU check looks here for a number"));
    } else if(!key){
      unread++;
      tr.classList.add("chg");
      tr.appendChild(el("td",null,'<span class="disc-bad">not read</span>'));
      tr.appendChild(el("td","az-derived","no recognised section heading on this page"));
    } else {
      tr.appendChild(el("td",null,escapeHtml(LBL[key]||key)));
      tr.appendChild(el("td","az-derived",NEVER.has(key)?"read but never analysed or redlined"
        :(AI.has(key)?"read by the model — one request":"read straight off the page")));
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb); p.appendChild(t);
  p.appendChild(el("div","az-secn",unread
    ? ("<b>"+unread+"</b> page(s) carry no heading this tool recognises, so nothing on them is read. If a section you expect is empty, this table is where it went — a page classified as the section ABOVE it means its own heading was not recognised.")
    : "Every page was matched to a section. If a tab is still empty, the section was found but no rows could be read from it — check ▤ Log for that section's name."));
  /* 6cp — hand the fold back to the real pane. A page that was NOT read is the one thing worth opening
     for, so the fold starts open when there is one. */
  /* 6cs — always closed, even when a page was not read: the count in the summary says so without
     taking over the tab. */
  if(p._real){ const real=p._real, fold=p._fold;
    pgSum.textContent="What each page was read as"+(unread?("  ·  "+unread+" not read"):"");
    real.appendChild(fold); p=real; }
  return p;
}

/* 6bz — open items 2 and 3. `normSector` only knows the single sector letters, so a real-world label like
   "A,B,C", "ALL" or a carrier name collapsed to "—" and was silently never placed. A value the user TYPED
   is carried through verbatim; anything read off the page still goes through normSector as before. */
function sectorOut(r){
  const raw=String(r&&r.sector==null?"":r.sector).trim();
  if(r&&r._secTyped&&raw)return raw.toUpperCase();
  return normSector(raw);
}
function sectorChanged(r){
  if(!r||r.origSector==null)return false;
  return sectorOut(r)!==normSector(r.origSector);
}
function normSector(s){
  let v=String(s==null?"":s).trim();
  if(!v)return "—";
  const map={alpha:"A",beta:"B",gamma:"C",delta:"D",epsilon:"E",zeta:"F"};
  const low=v.toLowerCase();
  if(map[low])return map[low];
  // "sector a", "sec a", "sa"
  let m=low.match(/(?:sector|sec)\s*([a-f])\b/); if(m)return m[1].toUpperCase();
  if(/^[a-f]$/i.test(v))return v.toUpperCase();
  if(/^[1-9]$/.test(v))return v;               // numeric sectors 1..9
  if(/^site$/i.test(v))return "SITE";          // site-wide equipment
  /* Anything else is NOT a sector. Returning it uppercased (the old behaviour) turned equipment
     types, model names and Summary-by-Site row labels into their own "sectors" — which is what
     filled the SITE tab with unrelated items. */
  return "—";
}
function sectorRank(s){ const o="ABCDEF"; const i=o.indexOf(s); if(i>=0)return i; if(/^[1-9]$/.test(s))return 10+ +s; if(s==="—")return 999; return 500; }
function bySector(rows){ const m={}; rows.forEach(r=>{ const s=normSector(r.sector); (m[s]=m[s]||[]).push(r); }); return m; }
/* --- Design Summary codependency: derive Summary-by-Sector & Summary-by-Site from the By-Sector detail --- */
function normModelKey(m){ return String(m||"").replace(/[\u2010-\u2015\u2212\u00ad]/g,"-").replace(/\s+/g,"").toLowerCase(); }
/* canonical equipment type — treats RRH and RRU (and RRH/RRU) as the same type */
/* Display/label form of a type — always upper case. INTEGRATED ANTENNA RADIO keeps its own name here
   (it is a real printed type) but groups with RRH for counting: see typeGroup(). */
function canonType(t){
  const raw=String(t||"").trim();
  const u=raw.toUpperCase().replace(/[^A-Z0-9]/g,"");          // separators stripped: DC_TRUNK -> DCTRUNK
  if(/^(INTEGRATEDANTENNARADIO|INTEGRATEDANTENNA|INTEGRATEDRADIO|ANTENNARADIO|IAR)$/.test(u)) return "INTEGRATED ANTENNA RADIO";
  if(/^RR[UH]$/.test(u)||/RR[UH]RR[UH]/.test(u)) return "RRH";
  if(/^(DCTRUNK|TRUNK|DCTRUNKCABLE)$/.test(u)) return "DC_TRUNK";
  if(/^(SURGEARRESTOR|SURGEARRESTER)$/.test(u)) return "SURGE ARRESTOR";
  const hit=TYPE_OPTIONS.find(o=>o.toUpperCase().replace(/[^A-Z0-9]/g,"")===u);
  return hit||raw.toUpperCase();
}
/* Counting group: an integrated antenna-radio unit is counted as an RRH. */
/* Each printed type counts on its own — INTEGRATED ANTENNA RADIO is NOT folded into RRH. */
function typeGroup(t){ return canonType(t); }
/* normalized tokens to match a type against printed rows (RRH-class matches both rrh & rru) */
function typeAliases(t){
  const c=typeGroup(t);
  if(c==="INTEGRATED ANTENNA RADIO") return ["integratedantennaradio","integratedantenna","antennaradio"];
  if(c==="RRH") return ["rrh","rru"];
  if(c==="DC_TRUNK") return ["dc_trunk","dctrunk","trunk"];
  if(c==="SURGE ARRESTOR") return ["surgearrestor","surgearrester"];
  return [String(c).replace(/\s+/g,"").toLowerCase()];
}
function aggregate(detail,keyFn,withSector){
  const m=new Map();
  (detail||[]).forEach(r=>{ if(r.inserted&&!String(r.model||"").trim())return; const key=keyFn(r); const d=rowCounts(r);
    if(!m.has(key))m.set(key,{sector:withSector?normSector(r.sector):"",type:typeGroup(r.type),existing:0,removal:0,addition:0,final:0});
    const o=m.get(key); o.existing+=d.existing; o.removal+=d.removal; o.addition+=d.addition; o.final+=d.final; });   // struck rows count as removed (final 0)
  return [...m.values()];
}
function deriveSummaryBySector(detail){ return aggregate((detail||[]).filter(r=>{const s=normSector(r.sector);return s!=="SITE"&&s!=="—";}), r=>normSector(r.sector)+"|"+typeGroup(r.type).toLowerCase(), true); }   // per sector, per TYPE (RRH=RRU, models summed)
function deriveSummaryBySite(detail){ return aggregate(detail, r=>typeGroup(r.type).toLowerCase(), false); }                                    // per TYPE across ALL sectors
/* Does this derived summary row differ from what the page prints? Falls back to the old
   "any activity" reading when the printed values were never captured. */
function summaryRowDiffers(o){
  const A=S.analysis, geo=A&&A._dsGeo;
  const sec=o.sector?normSector(o.sector):"";
  const id=sec?(sec+"|"+canonType(o.type)):canonType(o.type);
  const g=geo&&((sec?geo.bySector:geo.bySite)||{})[id];
  if(g&&g.printed){
    return ["existing","removal","addition","final"].some(k=>
      g.printed[k]!=null && int(g.printed[k])!==int(o[k]));
  }
  return (o.removal>0||o.addition>0||o.existing!==o.final);
}
function derivedRow(o,showSector){
  const tr=el("tr");
  let html="";
  if(showSector)html+=`<td class="az-derived">${escapeHtml(o.sector||"—")}</td>`;
  html+=`<td>${escapeHtml(o.type||"")}</td>`;
  html+=`<td class="az-derived"><b>${o.existing}</b> / <b>${o.removal}</b> / <b>${o.addition}</b> / <b>${o.final}</b></td>`;
  html+=`<td class="az-derived">${summaryRowDiffers(o)?"auto-totaled":"—"}</td>`;
  tr.innerHTML=html; return tr;
}
function refreshDerived(){
  const secEl=document.getElementById("azSumSector"), siteEl=document.getElementById("azSumSite");
  if(!secEl||!siteEl)return;
  const detail=(S.analysis&&S.analysis.designSummary)||[];
  const bySec=deriveSummaryBySector(detail).sort((a,b)=>sectorRank(normSector(a.sector))-sectorRank(normSector(b.sector))||(a.type||"").localeCompare(b.type||"")||(a.model||"").localeCompare(b.model||""));
  const bySite=deriveSummaryBySite(detail).sort((a,b)=>(a.type||"").localeCompare(b.type||"")||(a.model||"").localeCompare(b.model||""));
  secEl.innerHTML=""; siteEl.innerHTML="";
  const t1=el("table","az"); t1.innerHTML="<thead><tr><th>Sector</th><th>Type</th><th>Model</th><th>Existing / Removal / Addition / Final</th><th>Change</th></tr></thead>";
  const b1=el("tbody"); bySec.forEach(o=>b1.appendChild(derivedRow(o,true))); t1.appendChild(b1); secEl.appendChild(t1);
  const t2=el("table","az"); t2.innerHTML="<thead><tr><th>Type</th><th>Model</th><th>Existing / Removal / Addition / Final</th><th>Change</th></tr></thead>";
  const b2=el("tbody"); bySite.forEach(o=>b2.appendChild(derivedRow(o,false))); t2.appendChild(b2); siteEl.appendChild(t2);
}
/* find the y of a sub-table header line on a page, e.g. /summarybysector/ */
function headerY(pi,re){ for(const ln of pageLines(pi)){ if(re.test(ln.norm))return ln.y; } return null; }
/* find a table row line within a y-region, matched by model and (optionally) sector cell */
function dsRowInRegion(pi,y0,y1,modelKey,sectorLetter){
  const lines=pageLines(pi).filter(ln=>(y0==null||ln.y>=y0)&&(y1==null||ln.y<y1)&&ln.norm.includes(modelKey));
  if(!lines.length)return null;
  if(sectorLetter&&sectorLetter!=="—"){
    const want=sectorLetter.toLowerCase();
    const hit=lines.find(ln=>{ const first=(ln.items[0]&&ln.items[0].str.trim().toLowerCase())||""; return first===want||first==="sector"+want||first==="sec"+want; });
    if(hit)return hit;
  }
  return lines[0];
}
/* count-column x-centers from a table's header row (Existing/Removals/Additions/Final; ignores As-Built) */
function colsFromHeaderLine(line){
  if(!line)return null;
  const colX=kw=>{ let x=null; line.items.forEach(it=>{ if(it.str.replace(/\s+/g,"").toLowerCase().indexOf(kw)>=0)x=it.nx+(it.nw||0)/2; }); return x; };
  const c={ existing:colX("existing"), removal:colX("removal"), addition:colX("addition"), final:colX("final"), sector:colX("sector"), type:colX("type"), model:colX("model") };
  return (c.existing!=null&&c.final!=null)?c:null;
}
/* overlay a text value onto the row cell nearest a column x */
function placeTextAtCol(pi,rowItems,colX,value){
  if(colX==null)return false; let best=null,bd=1e9;
  rowItems.forEach(t=>{ const c=t.nx+(t.nw||0)/2; const dd=Math.abs(c-colX); if(dd<0.09&&dd<bd){bd=dd;best=t;} });
  if(best){ addText(pi,best.nx,best.ny,String(value),{cell:best}); return true; }
  return false;
}
/* build logical rows for the three DS sub-tables across all pages (merging wrapped model lines),
   and capture each sub-table's count-column x-centers from its header row */
function buildDsTables(dsPages){
  const T={ detail:{cols:null,rows:[]}, bySector:{cols:null,rows:[]}, bySite:{cols:null,rows:[]} };
  /* Row splitting by CONTENT, not by margin. Every equipment row carries counts (or at least a few
     cells); a wrapped cell continuation is one or two items with no numbers. Earlier versions used an
     absolute left-margin threshold, which merged an entire table whenever it started further right. */
  /* A detail row is identified by its COUNT CELLS. When the table's count columns are known, a row
     starts when it has an integer sitting IN one of those columns — that works even if only one count
     is printed. Otherwise fall back to "two or more standalone integers". A wrapped model line
     ("B25/66 320W AHFIB") has no integer in a count column, so it merges into the row above. */
  const countXs=c=>c?["existing","removal","addition","final"].map(k=>c[k]).filter(v=>v!=null):[];
  const startsRow=(ln,cols)=>{
    const ints=ln.items.filter(t=>/^-?\d+$/.test(t.str.trim()));
    if(!ints.length)return false;
    const xs=countXs(cols);
    if(xs.length>=2){
      const inCol=ints.some(t=>{ const cx=t.nx+(t.nw||0)/2; return xs.some(x=>Math.abs(cx-x)<0.06); });
      if(inCol)return true;
      return ints.length>=3;                 // a stray digit outside the count columns is not a row
    }
    return ints.length>=2;
  };
  let cur="detail", curRow=null;
  (dsPages||[]).forEach(pi=>{ if(S.pages[pi]&&S.pages[pi].locked)return;
    pageLines(pi).forEach(ln=>{
      if(/summarybysector|sectorsummary/.test(ln.norm)){ cur="bySector"; if(!T.bySector.cols)T.bySector.cols=colsFromHeaderLine(ln); curRow=null; return; }
      if(/summarybysite|sitesummary|summarybysiteas/.test(ln.norm)){ cur="bySite"; if(!T.bySite.cols)T.bySite.cols=colsFromHeaderLine(ln); curRow=null; return; }
      if(cur==="detail" && !T.detail.cols && /existing/.test(ln.norm) && /final/.test(ln.norm)){ T.detail.cols=colsFromHeaderLine(ln); curRow=null; return; }
      if(/equipmenttype/.test(ln.norm) && /final/.test(ln.norm)){ if(!T[cur].cols)T[cur].cols=colsFromHeaderLine(ln); return; }   // skip a repeated header row (but capture its columns)
      if(!curRow || startsRow(ln,T[cur].cols)){ curRow={pi, items:ln.items.slice(), norm:ln.norm}; T[cur].rows.push(curRow); }
      else { curRow.items=curRow.items.concat(ln.items); curRow.norm+=ln.norm; }   // wrapped continuation
    });
  });
  /* Carry the sector forward through the two sector-bearing sub-tables only. Summary by Site has no
     sector column at all, so nothing is carried there and its rows can never be read as a sector. */
  ["detail","bySector"].forEach(k=>{ let last="";
    T[k].rows.forEach(r=>{ const s=rowSector(r); if(s&&s!=="—"){ last=s; } r._sec=last||s; }); });
  T.bySite.rows.forEach(r=>{ r._sec=""; });
  // if any sub-table never had its header captured (header on an unread page), infer columns from its data
  ["detail","bySector","bySite"].forEach(k=>{ if(!T[k].cols && T[k].rows.length) T[k].cols=inferCountCols(T[k].rows); });
  const _dsInts=(dsPages||[]).reduce((n,pi)=>n+(S.pages[pi]?pageLines(pi).filter(l=>l.items.filter(t=>/^-?\d+$/.test(t.str.trim())).length>=2).length:0),0);
  if(T.detail.rows.length<2 && _dsInts>2) LOG("⚠ DS split looks wrong: only",T.detail.rows.length,"row(s) for",_dsInts,"count line(s) — check the header/column detection");
  LOG("DS rows:",T.detail.rows.map(r=>(dsRowSec(r)||"?")+":"+(r.items.filter(t=>/^-?\d+$/.test(t.str.trim())).map(t=>t.str).join("/")||"-")).join("  "));
  LOG("DS placement tables:",{detail:T.detail.rows.length, bySector:T.bySector.rows.length, bySite:T.bySite.rows.length, colsFound:{detail:!!T.detail.cols,bySector:!!T.bySector.cols,bySite:!!T.bySite.cols}});
  return T;
}
/* Does this geometry row carry this model? On a wrapped row the model is split by its own count
   cells ("…4T4R" + "4 4 0 0" + "B25/66 320W AHFIB"), so the model is NOT a contiguous substring of
   the row text. Fall back to token coverage. */
function dsRowMatchesModel(row,model){
  if(!row||!row.norm)return false;
  const m=String(model||"").trim(); if(m.length<2)return false;
  const mk=normModelKey(m);
  if(mk && row.norm.indexOf(mk)>=0)return true;
  const an=s=>String(s||"").replace(/[^a-z0-9]/gi,"").toLowerCase();
  if(mk.length>3 && an(row.norm).indexOf(an(m))>=0)return true;
  /* token coverage, for a model split around its own count cells. Distinctive tokens only (length>=3)
     and a high bar, so it can't latch onto a sibling model that shares generic words. */
  const toks=m.split(/\s+/).map(s=>s.replace(/[^a-z0-9/]/gi,"").toLowerCase()).filter(s=>s.length>=3);
  if(toks.length>=3){
    const hit=toks.filter(tk=>row.norm.indexOf(tk)>=0).length;
    if(hit/toks.length>=0.8)return true;
  }
  return false;
}
function rowSector(row){ return normSector(row&&row.items&&row.items[0]?row.items[0].str:""); }
/* A detail row's sector, carried forward: these tables often print the sector once per group, so a
   blank first cell means "same as the row above". Without this, rows after the first in each group
   failed their sector match and their edits were plotted on the wrong row (or not at all). */
function dsRowSec(row){ return (row&&row._sec)||rowSector(row); }
/* fallback when a sub-table's header row is on a page we couldn't read: infer the count-column
   x-centers from the numeric cells to the right of the model column (leftmost 4 = Existing/Removals/Additions/Final; a 5th cluster like As-Built is ignored). */
function inferCountCols(rows){
  const xs=[];
  (rows||[]).forEach(r=>r.items.forEach(t=>{ if(/^\d+$/.test(t.str.trim())){ const cx=t.nx+(t.nw||0)/2; if(cx>0.34)xs.push(cx); } }));
  if(xs.length<4)return null;
  xs.sort((a,b)=>a-b);
  const clusters=[]; let cur=[xs[0]];
  for(let i=1;i<xs.length;i++){ if(xs[i]-cur[cur.length-1]<0.03)cur.push(xs[i]); else { clusters.push(cur); cur=[xs[i]]; } }
  clusters.push(cur);
  const centers=clusters.map(c=>c.reduce((a,b)=>a+b,0)/c.length);
  if(centers.length<4)return null;
  const u=centers.slice(0,4);   // leftmost 4 count columns
  return {existing:u[0],removal:u[1],addition:u[2],final:u[3]};
}
/* the row's four count cells: rightmost 4 numeric cells (model digits sit to their left);
   when the table has a trailing As-Built column, take the leftmost 4 of the count numbers instead. */
function countCellsOf(rowItems,hasAsBuilt){
  const nums=rowItems.filter(t=>/^\d+$/.test(t.str.trim())).sort((a,b)=>a.nx-b.nx);
  if(nums.length<4)return [];
  return hasAsBuilt ? nums.slice(0,4) : nums.slice(-4);
}
/* overlay the four count values. Prefer the table's own header column x-centers (robust to an extra
   As-Built column); fall back to positional (rightmost/leftmost 4) when no header was captured. */
function placeCountsInRow(pi,rowItems,vals,hasAsBuilt,cols,align){
  const AL=align||"left";
  const order=["existing","removal","addition","final"]; let applied=0;
  if(cols && cols.existing!=null && cols.final!=null){
    let hit=false;
    order.forEach(k=>{ const cx=cols[k]; if(cx==null)return;
      let best=null,bd=1e9; rowItems.forEach(t=>{ if(!/^\d+$/.test(t.str.trim()))return; const c=t.nx+(t.nw||0)/2; const dd=Math.abs(c-cx); if(dd<0.07&&dd<bd){bd=dd;best=t;} });
      if(best){ hit=true; const nv=String(vals[k]);
        if(best.str.trim()!==nv){
          const id=addText(pi,best.nx,best.ny,nv,{cell:best,align:AL});
          if(AL==="center"){ const m=S.annos.find(z=>z.id===id); if(m){ m.align="center"; m.alignUser=true; fitCellBox(m); } }
          applied++;
        } }
    });
    if(hit)return applied;
  }
  const cells=countCellsOf(rowItems,hasAsBuilt); if(cells.length<4)return applied;
  order.forEach((k,idx)=>{ const cell=cells[idx]; const nv=String(vals[k]); if(cell.str.trim()!==nv){ addText(pi,cell.nx,cell.ny,nv,{cell,align:AL}); applied++; } });
  return applied;
}
/* read the numeric cell nearest a column x within a logical row (or null) */
function readNumAt(rowItems,cx){
  if(cx==null)return null; let best=null,bd=1e9;
  rowItems.forEach(t=>{ const s=t.str.trim(); if(!/^\d+$/.test(s))return; const c=t.nx+(t.nw||0)/2; const dd=Math.abs(c-cx); if(dd<0.05&&dd<bd){bd=dd;best=s;} });
  return best!=null?parseInt(best,10):null;
}
/* Fix prefilled counts by reading the ACTUAL numbers from the PDF at each count column.
   Overrides only freshly-read rows (onlyPages) so it never clobbers a user's manual edits. */
/* Read the Design Summary detail table by cell, so wrapped model cells and centred counts are
   handled the same way as RF Inventory. Returns normCount-shaped rows carrying their geometry. */
const DS_COL={sector:/^sector/i, type:/equipment\s*type|^type$/i, model:/equipment\s*model|^model/i,
              existing:/existing/i, removals:/removal/i, additions:/addition/i, final:/final/i};
/* Walk the Design Summary pages in order, carrying the current sub-table across page breaks. The
   rule: a page continues the table above it until a NEW heading appears — "Summary by Sector" or
   "Summary by Site". Only detail bands become rows.
   Previously the reader searched each page for a header row, and the Summary-by-Sector header ALSO
   matches Existing/Removals/Final — so on a page holding the tail of the detail table followed by that
   summary, everything above the summary header was thrown away. That is the missing Gamma rows. */
function readDsFromGeometry(pages){
  const _out=[];
  function emitDsRows(list,pi,defs){
    const names=defs.map(d=>d.name);
    const find=re=>names.find(c=>re.test(String(c).trim()));
    const C={}; Object.keys(DS_COL).forEach(k=>{ C[k]=find(DS_COL[k]); });
    if(!C.model||!C.existing||!C.final){ LOG("DS geometry: header lacks model/existing/final —",names.join(" | ")); return; }
    let lastSec="";
    list.forEach(z=>{
      const model=String(z.cells[C.model]||"").trim(); if(!model)return;
      const num=k=>{ const v=String(z.cells[C[k]]||"").replace(/[^\d-]/g,""); const n=parseInt(v,10); return isNaN(n)?0:n; };
      let sec=normSector(C.sector?z.cells[C.sector]:"");
      if(sec==="—"&&lastSec) sec=lastSec; else if(sec!=="—") lastSec=sec;
      const ty=canonType(C.type?z.cells[C.type]:"");
      const ex=num("existing"), rm=num("removals"), ad=num("additions"), fn=num("final");
      const gi=k=>C[k]?z.g[C[k]]:null;
      _out.push({ page:pi, sector:sec, origSector:sec, type:ty, origType:ty,
        model, origModel:model, before:ex, after:fn, origBefore:ex, origAfter:fn,
        printed:{existing:ex,removals:rm,additions:ad,final:fn}, struck:false,
        _page:pi, _y:z.y, _bind:"geometry",
        _g:{ sector:gi("sector"), type:gi("type"), model:gi("model"),
             existing:gi("existing"), removal:gi("removals"), addition:gi("additions"), final:gi("final") } });
    });
  }
  const SUMSEC=n=>/summarybysector|sectorsummary/.test(n);
  const SUMSITE=n=>/summarybysite|sitesummary/.test(n);
  const isDetailHdr=l=>/existing/.test(l.norm)&&/final/.test(l.norm)&&/(removal|addition)/.test(l.norm)
                       &&/model/.test(l.norm)&&!SUMSEC(l.norm)&&!SUMSITE(l.norm);
  let cols=null, mode="none";
  const out=[], seenCols=[];
  (pages||[]).forEach(pi=>{
    if(!S.pages[pi])return;
    const lines=pageLines(pi).filter(l=>!/^page\d|page\d+of\d+/.test(l.norm));
    if(!lines.length)return;
    const bands=groupLineRows(lines);
    const detail=[]; let hdrItems=null;
    bands.forEach(band=>{
      const norm=band.map(l=>l.norm).join("");
      if(/localmarketnote|marketnotes/.test(norm)){ mode="notes"; return; }   // stop reading here
      if(SUMSEC(norm)){ mode="bySector"; return; }
      if(SUMSITE(norm)){ mode="bySite"; return; }
      /* test the whole BAND, not each line: a wrapped header splits "Equipment"/"Model" and
         "Existing"/"Count" across lines, so no single line carries all the keywords */
      const isHdrBand=/existing/.test(norm)&&/final/.test(norm)&&/(removal|addition)/.test(norm)&&/model/.test(norm);
      if(isHdrBand||band.some(isDetailHdr)){ mode="detail"; hdrItems=[].concat(...band.map(l=>l.items)); return; }
      if(mode==="detail") detail.push(band);
    });
    if(!detail.length){ LOG(`DS p${pi+1}: no detail bands (mode=${mode})`); return; }
    const dataItems=[].concat(...[].concat(...detail).map(l=>l.items));
    if(hdrItems||!cols){
      const c=tableColumns(dataItems,hdrItems||[]);
      if(c.defs.length>=4){ cols=c; c.defs.forEach(d=>{ if(seenCols.indexOf(d.name)<0)seenCols.push(d.name); }); }
    }
    if(!cols){ LOG(`DS p${pi+1}: no columns yet — skipped`); return; }
    const {defs,key}=cols;
    const keyName=defs[0].name;
    /* Rows are defined by their COUNT CELLS, not by vertical gaps. Every equipment row has exactly one
       set of counts, so clustering the y of the integers sitting in count columns gives one anchor per
       row; every other item then joins its nearest anchor. Gap-based banding attached a wrapped row's
       first line to the single-line row above it, which merged two models and put the stored cell
       positions between rows — the wrong count positions you saw. */
    const colOf=t=>{ const k=key(t); let d=defs.find(c=>k>=c.from&&k<c.to);
      if(!d){ const l0=t.nx, r0=t.nx+(t.nw||0); let bo=0;
        defs.forEach(c=>{ const ov=Math.min(r0,c.to)-Math.max(l0,c.from); if(ov>bo){bo=ov;d=c;} });
        if(!d){ let bd=1e9; defs.forEach(c=>{ const dd=Math.abs(k-c.x); if(dd<bd){bd=dd;d=c;} }); if(bd>0.09)d=null; } }
      return d; };
    const findName=re=>defs.map(d=>d.name).find(c=>re.test(String(c).trim()));
    const cnames=[findName(DS_COL.existing),findName(DS_COL.removals),findName(DS_COL.additions),findName(DS_COL.final)].filter(Boolean);
    const allItems=[].concat(...[].concat(...detail).map(l=>l.items));
    const anchors=[];
    allItems.forEach(t=>{ if(!/^-?\d+$/.test(String(t.str).trim()))return;
      const d=colOf(t); if(!d||cnames.indexOf(d.name)<0)return;
      const cy=t.ny+(t.nh||0)/2;
      const near=anchors.find(a=>Math.abs(a.y-cy)<0.006);
      if(near){ near.sum+=cy; near.n++; near.y=near.sum/near.n; } else anchors.push({y:cy,sum:cy,n:1});
    });
    anchors.sort((a,b)=>a.y-b.y);
    if(anchors.length){
      const pitch=anchors.length>1?(anchors[anchors.length-1].y-anchors[0].y)/(anchors.length-1):0.03;
      const tol=Math.max(pitch*0.62,0.012);
      const buckets=anchors.map(a=>({y:a.y,cells:{},g:{},ys:[]}));
      allItems.forEach(t=>{
        const d=colOf(t); if(!d)return;
        const cy=t.ny+(t.nh||0)/2;
        let best=null,bd=1e9;
        buckets.forEach(bk=>{ const dd=Math.abs(bk.y-cy); if(dd<bd){bd=dd;best=bk;} });
        if(!best||bd>tol)return;
        const s=String(t.str).trim(); if(!s)return;
        best.ys.push({t,d,s});
      });
      buckets.forEach(bk=>{
        bk.ys.sort((p,q)=>(p.t.ny-q.t.ny)||(p.t.nx-q.t.nx));
        bk.ys.forEach(({t,d,s})=>{
          bk.cells[d.name]=joinCellLines(bk.cells[d.name],s);
          const r2=t.nx+(t.nw||0), b2=t.ny+(t.nh||0);
          if(!bk.g[d.name]) bk.g[d.name]={nx:t.nx,ny:t.ny,nw:t.nw||0,nh:t.nh||0,x2:r2,y2:b2,lines:1,topY:t.ny,topR:r2,
                                          colL:(d.boxL!=null?d.boxL:(d.from!=null?d.from:null)),
                                          colR:(d.boxR!=null?d.boxR:(d.to!=null?d.to:null))};
          else { const q=bk.g[d.name];
                 if(t.ny<q.topY-0.002){ q.topY=t.ny; q.topR=r2; }
                 else if(Math.abs(t.ny-q.topY)<=0.002){ q.topR=Math.max(q.topR,r2); }
                 q.nx=Math.min(q.nx,t.nx); q.ny=Math.min(q.ny,t.ny);
                 q.x2=Math.max(q.x2,r2); q.y2=Math.max(q.y2,b2); q.nw=q.x2-q.nx; q.lines=(q.lines||1)+1; }
        });
      });
      emitDsRows(buckets.map(bk=>({cells:bk.cells,g:bk.g,y:bk.y})),pi,defs);
      LOG(`DS p${pi+1}: ${buckets.length} row(s) anchored on count cells`);
      return;
    }
    const parsed=detail.map(band=>{
      const cells={}, g={};
      band.forEach(l=>l.items.forEach(t=>{
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
        const r2=t.nx+(t.nw||0), b2=t.ny+(t.nh||0);
        if(!g[d.name]) g[d.name]={nx:t.nx,ny:t.ny,nw:t.nw||0,nh:t.nh||0,x2:r2,y2:b2,lines:1};
        else { const q=g[d.name]; q.nx=Math.min(q.nx,t.nx); q.ny=Math.min(q.ny,t.ny);
               q.x2=Math.max(q.x2,r2); q.y2=Math.max(q.y2,b2); q.nw=q.x2-q.nx; q.lines=(q.lines||1)+1; }
      }));
      return {band,cells,g};
    });
    /* merge a band with no sector value into the row above it (the sector prints once per group,
       and a tall model cell can be split by the gap heuristic) */
    const merged=[];
    parsed.forEach(pz=>{
      const filled=Object.keys(pz.cells).filter(k2=>String(pz.cells[k2]).trim()!=="");
      if(!filled.length)return;
      const nums=Object.keys(pz.cells).filter(k2=>/^\d+$/.test(String(pz.cells[k2]).trim())).length;
      const isRow=nums>=2;                       // a real row carries at least two count cells
      if(!isRow&&merged.length){
        const prev=merged[merged.length-1];
        Object.keys(pz.cells).forEach(k2=>{
          const v=String(pz.cells[k2]).trim(); if(!v)return;
          prev.cells[k2]=joinCellLines(prev.cells[k2],v);
          if(!prev.g[k2]&&pz.g[k2]) prev.g[k2]=pz.g[k2];
          else if(prev.g[k2]&&pz.g[k2]){ const q=prev.g[k2], n2=pz.g[k2];
            q.nx=Math.min(q.nx,n2.nx); q.ny=Math.min(q.ny,n2.ny);
            q.x2=Math.max(q.x2,n2.x2); q.y2=Math.max(q.y2,n2.y2); q.nw=q.x2-q.nx; }
        });
        return;
      }
      if(!isRow)return;
      merged.push(pz);
    });
    const find=re=>seenCols.find(c=>re.test(String(c).trim()))||defs.map(d=>d.name).find(c=>re.test(String(c).trim()));
    const C={}; Object.keys(DS_COL).forEach(k=>{ C[k]=find(DS_COL[k]); });
    if(!C.model||!C.existing||!C.final){ LOG("DS geometry: header lacks model/existing/final —",seenCols.join(" | ")); return; }
    emitDsRows(merged.map(pz=>({cells:pz.cells,g:pz.g,y:pz.band[0].y})),pi,defs);
    LOG(`DS p${pi+1}: ${merged.length} detail row(s) via bands`);
    return;
    let lastSec="";
    merged.forEach(pz=>{
      const model=String(pz.cells[C.model]||"").trim(); if(!model)return;
      const num=k=>{ const v=String(pz.cells[C[k]]||"").replace(/[^\d-]/g,""); const n=parseInt(v,10); return isNaN(n)?0:n; };
      let sec=normSector(C.sector?pz.cells[C.sector]:"");
      if(sec==="—"&&lastSec) sec=lastSec; else if(sec!=="—") lastSec=sec;
      const ty=canonType(C.type?pz.cells[C.type]:"");
      const ex=num("existing"), rm=num("removals"), ad=num("additions"), fn=num("final");
      const gi=k=>C[k]?pz.g[C[k]]:null;
      out.push({ page:pi, sector:sec, origSector:sec, type:ty, origType:ty,
        model, origModel:model, before:ex, after:fn, origBefore:ex, origAfter:fn,
        printed:{existing:ex,removals:rm,additions:ad,final:fn}, struck:false,
        _page:pi, _y:pz.band[0].y, _bind:"geometry",
        _g:{ sector:gi("sector"), type:gi("type"), model:gi("model"),
             existing:gi("existing"), removal:gi("removals"), addition:gi("additions"), final:gi("final") } });
    });
    LOG(`DS p${pi+1}: ${merged.length} detail row(s) (mode carried in as ${mode})`);
  });
  LOG(`DS read by cell: ${_out.length} row(s) — ${_out.map(r=>normSector(r.sector)+":"+r.printed.existing+"/"+r.printed.removals+"/"+r.printed.additions+"/"+r.printed.final).join("  ")}`);
  return _out;
}
function correctDetailCounts(dsPages,rows,onlyPages){
  const T=buildDsTables(dsPages);
  let unmatched=null;
  const an=s=>String(s||"").replace(/[^a-z0-9]/gi,"").toLowerCase();
  const used=new Set();
  let fixed=0, misses=0;
  (rows||[]).forEach(r=>{
    if(onlyPages && !onlyPages.has(r.page)) return;
    const mk=normModelKey(r.origModel||r.model), sec=normSector(r.sector), mk2=an(r.origModel||r.model);
    let cands=T.detail.rows.filter(g=>!used.has(g)&&g.norm.includes(mk));
    if(!cands.length) cands=T.detail.rows.filter(g=>!used.has(g)&&an(g.norm).includes(mk2));
    if(!cands.length) cands=T.detail.rows.filter(g=>!used.has(g)&&dsRowMatchesModel(g,r.origModel||r.model));
    if(!cands.length){ (unmatched=unmatched||[]).push(r); return; }
    const g=cands.find(x=>dsRowSec(x)===sec) || cands[0];   // prefer matching sector; else next unused row in reading order
    used.add(g);
    const gs=dsRowSec(g); if(gs && (/^[A-F1-9]$/.test(gs)||gs==="SITE")){ r.sector=gs; if(r.origSector==null||r.origSector==="")r.origSector=gs; }   // authoritative sector from the PDF's Sector column (fixes TMA etc.)
    const nums=g.items.filter(t=>/^\d+$/.test(t.str.trim())).sort((a,b)=>a.nx-b.nx).map(t=>parseInt(t.str.trim(),10));
    if(nums.length<4){ misses++; LOG("DS count-correct: <4 numbers on row",gs,r.origModel||r.model); return; }
    const four=nums.slice(-4); const ex=four[0], rm=four[1], ad=four[2], fn=four[3];
    if(int(r.before)!==ex){ r.before=ex; fixed++; }
    if(int(r.after)!==fn){ r.after=fn; fixed++; }
    r.origBefore=ex; r.origAfter=fn;
    r.printed={existing:ex,removals:rm,additions:ad,final:fn};
  });
  /* Second pass, same idea as rfResolveRows: a table prints one row per extracted row, in order, so
     anything the model text could not match takes the remaining printed rows in reading order. Without
     this the row kept whatever the extraction guessed — which is how every row ended up reading "1". */
  if(unmatched&&unmatched.length){
    const free=T.detail.rows.filter(g=>!used.has(g)&&countCellsOf(g.items,false).length===4);
    unmatched.forEach((r,i)=>{
      const g=free[i];
      if(!g){ r._noGeo=true; misses++; LOG("DS count-correct: no printed row for",normSector(r.sector),r.origModel||r.model); return; }
      used.add(g);
      const four=countCellsOf(g.items,false).map(t=>parseInt(t.str.trim(),10));
      r.before=four[0]; r.after=four[3]; r.origBefore=four[0]; r.origAfter=four[3];
      r.printed={existing:four[0],removals:four[1],additions:four[2],final:four[3]};
      const gs=dsRowSec(g); if(gs&&(/^[A-F1-9]$/.test(gs)||gs==="SITE")){ r.sector=gs; if(!r.origSector)r.origSector=gs; }
      r._byOrder=true; fixed++;
      LOG("DS count-correct (by position):",gs,r.origModel||r.model,"→",four.join("/"));
    });
  }
  LOG("DS count-correct:",fixed,"fixed,",misses,"with no printed row");
  return fixed;
}
/* generic count corrector for a plain count table (e.g. Equipment in Calc): read the model's line and take the rightmost 4 numbers */
/* Equipment in Calc geometry: find the model's row and read its single printed quantity
   (the rightmost numeric cell — model digits sit to its left). */
/* x of the Equipment-in-Calc quantity column, from that page's header row */
function ecQtyX(pi){
  const P=S.pages[pi]; if(!P)return null;
  if(P._ecQtyX!==undefined)return P._ecQtyX;
  let x=null;
  for(const l of pageLines(pi)){
    const hit=l.items.find(t=>/^(quantity|qty|count|total|final)$/i.test(String(t.str).trim()));
    if(hit && l.items.some(t=>/equipment|model|type/i.test(String(t.str)))){ x=hit.nx+(hit.nw||0)/2; break; }
  }
  P._ecQtyX=x; return x;
}
function correctEcCount(pages,rows,onlyPages){
  const an=s=>String(s||"").replace(/[^a-z0-9]/gi,"").toLowerCase();
  let read=0,misses=0;
  (rows||[]).forEach(r=>{
    if(onlyPages && !onlyPages.has(r.page))return;
    const mk=normModelKey(r.origModel||r.model), mk2=an(r.origModel||r.model);
    let line=null, lp=r.page;
    for(const pi of (pages||[])){
      const cand=pageLines(pi).filter(l=>l.norm.includes(mk)||an(l.norm).includes(mk2));
      if(cand.length){ line=cand[0]; lp=pi; break; }
    }
    if(!line){ misses++; LOG("EC: no geometry row for",r.origModel||r.model); return; }
    const nums=line.items.filter(t=>/^\d+$/.test(t.str.trim())).sort((a,b)=>a.nx-b.nx);
    if(!nums.length){ misses++; LOG("EC: no quantity cell on row",r.origModel||r.model); return; }
    /* prefer the numeric under the Quantity/Count/Total header; fall back to the rightmost */
    let qty=nums[nums.length-1];
    const qx=ecQtyX(lp);
    if(qx!=null){ let bd=1e9; nums.forEach(t=>{ const c=t.nx+(t.nw||0)/2; const d=Math.abs(c-qx); if(d<0.07&&d<bd){bd=d;qty=t;} }); }
    r.printed=parseInt(qty.str.trim(),10);
    if(r.count==null)r.count=r.printed;
    r.page=lp; read++;
  });
  LOG(`EC count-read: ${read} row(s) read from the page, ${misses} unmatched`);
  return read;
}
/* total Existing/Final per model across ALL sectors (from Design Summary), using effective counts */
/* 6eu — WHAT THE RF INVENTORY SAYS IS AT THE TOP.
   Equipment in Calc is the wind-load table — dimensions, SQIN per unit — so what belongs in its Quantity
   is the number of units ON THE TOWER, and the RF Inventory is the table that records where each unit
   sits. A model whose rows carry an RRH Position is counted by its TOP rows alone.
   Two deliberate limits. A row whose RRH Position is blank or "-" says NOTHING about where that unit is
   (every antenna on the real form reads "-"), so a model with no positioned rows at all is left to the
   Design Summary total. And a struck row is not counted, the same as everywhere else. */
function rfTopPositions(){
  const m=new Map();                      // model key -> {top, placed}
  const rf=S.analysis&&S.analysis.rfInventory;
  if(!rf||!rf.columns||!rf.rows)return m;
  const mc=rfModelCol(rf.columns);
  const pc=rf.columns.find(c=>/rrh\s*position/i.test(String(c))||/^\s*position\s*$/i.test(String(c)));
  if(!mc||!pc)return m;
  rf.rows.forEach(r=>{
    if(r.struck)return;
    const k=normModelKey(r.cells[mc]); if(!k)return;
    const v=String(r.cells[pc]==null?"":r.cells[pc]).trim();
    if(!v||/^[-\u2010-\u2015\u2212]+$/.test(v))return;   // the column is empty for this row
    if(!m.has(k))m.set(k,{top:0,placed:0});
    const o=m.get(k); o.placed++;
    if(/^top$/i.test(v))o.top++;
  });
  return m;
}
function dsTotalsByModel(){
  const m=new Map();
  ((S.analysis&&S.analysis.designSummary)||[]).forEach(r=>{ const model=r.origModel||r.model; const k=normModelKey(model); if(!k)return;
    if(/air/i.test(model) && typeGroup(r.type)==="RRH") return;   // AIR = integrated antenna+radio; count only the Antenna row, not the RRH duplicate
    const d=rowCounts(r);
    if(!m.has(k))m.set(k,{existing:0,final:0}); const o=m.get(k); o.existing+=d.existing; o.final+=d.final; });
  /* 6gg — THE TOP RULE IS GONE, and this reverses 6eu on Ced's instruction.

     6eu read Equipment in Calc as the wind-load table and so counted only the units the RF Inventory
     puts at TOP. The cost was written down at the time and is what Ced hit: a model whose rows are all
     at BOTTOM came out as ZERO — equipment that plainly exists, counted as none — and a model split
     between TOP and BOTTOM lost its bottom half. Asked which rule the form actually wants, Ced's answer
     was "don't override — use the Design Summary", so Equipment in Calc now carries the same per-model
     total the Design Summary does and the mount position never changes it.

     `rfTopPositions()` is KEPT and still attached: the TOP/placed split is real information, the
     Discrepancies tab and the log read it, and it costs nothing to carry. It simply no longer overwrites
     the quantity. */
  const top=rfTopPositions();
  top.forEach((o,k)=>{
    if(!o.placed||!m.has(k))return;
    const e=m.get(k);
    e.top=o.top; e.placed=o.placed;
    if(int(e.final)!==o.top){
      LOG&&LOG("Equipment in Calc quantity: "+k+" — Design Summary total "+e.final+
               "; the RF Inventory puts "+o.top+" of "+o.placed+" positioned rows at TOP. "+
               "The Design Summary total is what is used.");
    }
  });
  return m;
}
/* Equipment in Calc reflects the Design-Summary total FINAL (and existing) for each model, across sectors */
/* In Equipment in Calculation the same equipment is listed under different type names than the
   Design Summary uses: an RRH appears as RADIO, and an INTEGRATED ANTENNA RADIO appears as ANTENNA. */
function ecTypeOf(dsType){
  const c=canonType(dsType);
  if(c==="RRH")return "RADIO";
  if(c==="INTEGRATED ANTENNA RADIO")return "ANTENNA";
  return c;
}
/* total per equipment MODEL across every sector, tagged with its Equipment-in-Calc type */
function ecTotalsFromDs(){
  const out=new Map();
  ((S.analysis&&S.analysis.designSummary)||[]).forEach(r=>{
    if(r._noGeo)return;
    if(r.inserted&&!_carryInserts)return;   // a row added on Design Summary stays there
    const model=r.origModel||r.model; const k=normModelKey(model); if(!k)return;
    const d=rowCounts(r);
    if(!out.has(k))out.set(k,{existing:0,final:0,type:ecTypeOf(r.type),model});
    const o=out.get(k); o.existing+=d.existing; o.final+=d.final;
  });
  return out;
}
function reflectEcFromDS(){
  /* 6cs — and neither does the COUNT. The Design Summary total was pushed into every derived Equipment
     in Calc row on each render, which is the same leak as the model one and produced the same unasked-for
     redlines on that page. */
  if(!linkOn("equipmentCalc"))return;
  const A=S.analysis; if(!A||!A.equipmentCalc)return;
  const tot=ecTotalsFromDs();
  A.equipmentCalc.forEach(r=>{
    if(r._countEdited)return;              // you typed this one — leave it alone
    const t=tot.get(normModelKey(r.origModel||r.model));
    if(!t)return;
    r.count=t.final;                       // the site-wide total for this model
    r.dsType=t.type;                       // RADIO / ANTENNA / … as this table names it
    if(!r.type||canonType(r.type)!==t.type) r.typeHint=t.type;
  });
}
function renderCountPane(secKey){
  if(secKey==="equipmentCalc"){
    /* only reflect DS totals into the DERIVED rows, and only when the printed table is not the view */
    const _T0=S.analysis&&S.analysis.ecTable;
    const _hasT=!!(_T0&&_T0.columns&&_T0.columns.length>=2&&_T0.rows&&_T0.rows.length);
    if(!_hasT)reflectEcFromDS();
  }
  const rows=(S.analysis&&S.analysis[secKey])||[];
  const p=el("div","az-pane active");
  /* Equipment in Calc may have no derived rows and still have a printed table to show — do not bail out
     before that block gets a chance. */
  const _ecT=(secKey==="equipmentCalc"&&S.analysis&&S.analysis.ecTable)||null;
  const _ecHas=!!(_ecT&&_ecT.columns&&_ecT.columns.length>=2&&_ecT.rows&&_ecT.rows.length);
  if(!rows.length&&!_ecHas){ p.appendChild(el("div","az-empty","No rows detected for this section. If your RFDS has it, try Re-analyze — or redline it manually.")); return p; }
  if(secKey==="equipmentCalc"){
    p.appendChild(redlineToggleEl("equipmentCalc"));
    const T=S.analysis&&S.analysis.ecTable;
    if(T&&T.columns&&T.columns.length>=2&&T.rows&&T.rows.length){
      /* the printed table, column for column, with the same controls RF Inventory has */
      if(!_ecCols)_ecCols=ecDefaultCols(T.columns);
      _ecCols=ecOrder(T,_ecCols.filter(c=>T.columns.indexOf(c)>=0));
      if(!_ecCols.length)_ecCols=ecDefaultCols(T.columns);
      p.appendChild(ecColToggleBar(T.columns));
      p.appendChild(el("div","az-secn","The Equipment in Calculation table as printed. Edit any cell to redline it · ⛔ strikes the row · ＋ adds a row below · ⧉ duplicates it."));
      const t2=el("table","az");
      const thd=el("thead"); const hr=el("tr");
      _ecCols.forEach(c=>hr.appendChild(el("th",null,escapeHtml(String(c).replace(/\s\(\d+\)$/,"")))));
      hr.appendChild(el("th",null,"")); thd.appendChild(hr); t2.appendChild(thd);
      const tb2=el("tbody");
      T.rows.forEach((r,i)=>tb2.appendChild(ecTableRow(T,r,i)));
      t2.appendChild(tb2); p.appendChild(t2);
      const foot=el("div","az-secn");
      const ab=el("button","btn sm","＋ Add a row at the end");
      ab.onclick=()=>{ ecInsertAfter(T,T.rows.length-1); renderAnalyze(); };
      foot.appendChild(ab);
      p.appendChild(foot);
      return p;
    }
    p.appendChild(el("div","az-secn","One row per equipment model — this table is site-wide, not per sector. <b>Total</b> is the sum of that model's Final count across every sector of the Design Summary, and that single number is what gets redlined here. <b>On page</b> is the quantity the RFDS currently prints."));
    const t=el("table","az");
t.innerHTML="<thead><tr><th>Type</th><th>Model</th><th>On page</th><th>Total (all sectors)</th><th>From Design Summary</th><th>Change</th><th></th></tr></thead>";
    const tb=el("tbody");
    rows.slice().sort((a,b)=>(a.type||"").localeCompare(b.type||"")||(a.model||"").localeCompare(b.model||""))
        .forEach(r=>tb.appendChild(ecRow(r)));
    t.appendChild(tb); p.appendChild(t);
    return p;
  }
  // ---- Design Summary: sub-tabs per sector + Summary by Sector + Summary by Site ----
  p.appendChild(redlineToggleEl("designSummary"));
  const groups=bySector(rows);
  const sectors=Object.keys(groups).sort((a,b)=>sectorRank(a)-sectorRank(b));
  const subtabs=sectors.map(s=>["sec:"+s, secLabel(s)]).concat([["bySector","Summary by Sector"],["bySite","Summary by Site"]]);
  if(!subtabs.find(t=>t[0]===_dsSub)) _dsSub=subtabs.length?subtabs[0][0]:null;
  // mirror toggle
  const mrow=el("label","az-secn"); mrow.style.cssText="display:flex;align-items:center;gap:7px;cursor:pointer;margin:0 0 10px";
  const cb=el("input"); cb.type="checkbox"; cb.checked=_mirrorSectors; cb.style.cssText="width:auto;margin:0"; cb.onchange=()=>{ _mirrorSectors=cb.checked; };
  /* the lane icon carries this now — the row is kept only as the state holder, hidden */
  mrow.style.display="none";
  mrow.appendChild(cb);
  p.appendChild(mrow);
  // sub-tab bar
  const bar=el("div","az-tabs sub"); bar.style.cssText="padding:0;margin-bottom:10px";  /* 6fk — the rule
     that was inline here could not be reached by the emboss: an inline style beats every selector.
     `.az-tabs.sub` draws it as a groove instead. */
  subtabs.forEach(([k,lbl])=>{
    const isSec=k.indexOf("sec:")===0;
    const cls="az-tab"+(isSec?(" sec "+secClass(k.slice(4))):"")+(k===_dsSub?" active":"");
    const b=el("button",cls,(isSec?'<span class="sdot"></span>':"")+lbl);
    b.onclick=()=>{ _dsSub=k; renderAnalyze(); }; bar.appendChild(b); });
  p.appendChild(bar);
  if(_dsSub&&_dsSub.indexOf("sec:")===0){
    const sec=_dsSub.slice(4);
    p.appendChild(el("div","az-secn","Editing "+(sec==="—"?"unsectored":greek(sec)+" (Sector "+sec+")")+" rows. Changes flow into Summary by Sector and Summary by Site automatically."));
    const t=el("table","az"); t.innerHTML="<thead><tr><th>Sector</th><th>Type</th><th>Model</th><th>Before</th><th>After</th><th class=\"cnt-h\">Existing / Removal / Addition / Final</th><th>Change</th><th></th></tr></thead>";
    /* The counts column carries its own edit button — a pencil beside the heading, not a sentence above
       the grid. It toggles the two editable numbers in that column; the arithmetic is unchanged. */
    {
      const cth=t.querySelector("th.cnt-h");
      if(cth){
        const eb=el("button","cnt-edit"+(_dsManualCounts?" on":""),"edit");
        eb.title=_dsManualCounts
          ? "Editing Removals and Additions — click to stop. Before and After never move; Existing = Before, Final = After, and the field you did not type follows."
          : "Edit Removals and Additions in this column";
        eb.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
          _dsManualCounts=!_dsManualCounts; renderAnalyze(); };
        cth.appendChild(eb);
      }
    }
    const tb=el("tbody"); (groups[sec]||[]).forEach(r=>tb.appendChild(countRow(r,"designSummary"))); t.appendChild(tb); p.appendChild(t);
    p.appendChild(el("div","az-secn","Use <b>＋</b> on a row to insert a new equipment row — it gets written in the gap between that row and the next one on the page."));
  } else if(_dsSub==="bySector"){
    p.appendChild(el("div","az-secn","Consolidated per sector by equipment TYPE (all models of a type summed). Derived from the sector tabs and redlined onto the Summary by Sector table."));
    const rowsBS=deriveSummaryBySector(rows).sort((a,b)=>sectorRank(normSector(a.sector))-sectorRank(normSector(b.sector))||(a.type||"").localeCompare(b.type||""));
    const t=el("table","az"); t.innerHTML="<thead><tr><th>Sector</th><th>Type</th><th>Existing / Removal / Addition / Final</th><th>Change</th></tr></thead>";
    const tb=el("tbody"); rowsBS.forEach(o=>tb.appendChild(derivedRow(o,true))); t.appendChild(tb); p.appendChild(t);
  } else if(_dsSub==="bySite"){
    p.appendChild(el("div","az-secn","Accumulated across ALL sectors by equipment TYPE (site totals). Derived from the sector tabs and redlined onto the Summary by Site table."));
    const rowsST=deriveSummaryBySite(rows).sort((a,b)=>(a.type||"").localeCompare(b.type||""));
    const t=el("table","az"); t.innerHTML="<thead><tr><th>Type</th><th>Existing / Removal / Addition / Final</th><th>Change</th></tr></thead>";
    const tb=el("tbody"); rowsST.forEach(o=>tb.appendChild(derivedRow(o,false))); t.appendChild(tb); p.appendChild(t);
  }
  return p;
}
/* 3. insert a redline row into the Design Summary detail table, between two printed rows */
function dsInsertAfter(above){
  const A=S.analysis; if(!A||!A.designSummary)return;
  const rows=A.designSummary, idx=rows.indexOf(above); if(idx<0)return;
  azBeginEdit();
  /* Record WHERE the anchor row is, from its own captured geometry — the same `_g` that a count or a model
     redline is placed against. Storing only `_aboveModel` meant the anchor had to be found again later by
     searching for that text, which is the pattern that misplaced SQUID rows in 6af: a non-unique value
     resolves to the wrong row, and every value on the new row then lands against the wrong columns. */
  const _ag=above._g||above._aboveG||null;
  const _ab=_ag?(Object.keys(_ag).map(k=>_ag[k]).filter(Boolean)[0]||null):null;
  rows.splice(idx+1,0,{ page:above.page, sector:above.sector, type:above.type, origType:above.type,
    _aboveG:_ag, _anchorPage:(typeof above.page==="number"?above.page:null),
    _anchorY:(_ab&&_ab.ny!=null)?_ab.ny:(above._y!=null?above._y:null),
    model:"", origModel:"", before:0, after:0, origBefore:0, origAfter:0,
    printed:{existing:0,removals:0,additions:0,final:0}, struck:false,
    inserted:true, _aboveModel:above.origModel||above.model, _sec:normSector(above.sector) });
  renderAnalyze();
}
function dsRemoveRow(r){
  const A=S.analysis; if(!A||!A.designSummary)return;
  azBeginEdit();
  A.designSummary=A.designSummary.filter(x=>x!==r);
  renderAnalyze();
}
/* place a value with its LEFT edge at x (how printed counts/fields line up in a column) */
/* A cell on an INSERTED row has no printed run of its own, so it used to be placed as a bare free mark:
   no printed font size, no vertical drop, no length-based alignment. It therefore looked nothing like the
   count redlines around it. This gives it the same treatment as a real cell redline. */
function putRowCell(pi,cellNx,cellNw,y,val,lineNh,noClamp){
  const tv=String(val==null?"":val).trim();
  const id=addText(pi,Math.max(0,cellNx),y,tv);
  const a=S.annos.find(z=>z.id===id);
  if(a){
    const lh=lineNh||0.011;
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
/* write an inserted Design Summary row into the gap under the row it was added beneath */
function placeInsertedDsRow(r,dsT){
  const out={applied:0,missed:0,pi:null};
  const model=String(r.model||"").trim();
  if(!model && !int(r.after) && !int(r.before)) return out;      // nothing typed yet
  const mk=normModelKey(r._aboveModel||""), sec=r._sec;
  const all=dsT.detail.rows;
  const AM=r._aboveModel||"";
  let idx=-1;
  /* Structural first: the row on the anchor's page whose band sits at the anchor's y. This cannot pick a
     different row that happens to carry the same model. */
  if(r._anchorY!=null&&r._anchorPage!=null){
    let best=null,bd=1e9;
    all.forEach((x,i)=>{
      if(x.pi!==r._anchorPage)return;
      const t=x.items&&x.items[0]; if(!t||t.ny==null)return;
      const d=Math.abs(t.ny-r._anchorY);
      if(d<bd){ bd=d; best=i; }
    });
    const tol=((all[best]&&all[best].items[0]&&all[best].items[0].nh)||0.012)*1.2;
    if(best!=null&&bd<=tol){ idx=best; LOG("Analyze DS insert: anchor by position, page",r._anchorPage+1,"y",(+r._anchorY).toFixed(4)); }
  }
  if(idx<0){
    idx=all.findIndex(x=>dsRowMatchesModel(x,AM) && (!sec||sec==="—"||dsRowSec(x)===sec));
    if(idx<0) idx=all.findIndex(x=>dsRowMatchesModel(x,AM));
    if(idx>=0)LOG("Analyze DS insert: anchor by model text (no stored position):",AM);
  }
  if(idx<0){ out.missed++; LOG("Analyze DS insert: row above not located:",r._aboveModel); return out; }
  const g=all[idx], next=all[idx+1];
  const pi=g.pi; out.pi=pi;
  const fh=(g.items[0]&&g.items[0].nh)||0.012;
  /* centre of the row above and of the row below, so the inserted line lands exactly halfway */
  const cOf=row=>{ const t=row&&row.items&&row.items[0]; return t?(t.ny+(t.nh||fh)/2):null; };
  const aboveC=cOf(g);
  const nextC=(next&&next.pi===pi)?cOf(next):(aboveC+fh*1.8);
  let midY=Math.max(0,(aboveC+nextC)/2-fh/2);          // top of our text => its centre is the midpoint
  if(!(nextC>aboveC+fh*0.5)) midY=Math.min(1-fh,aboveC+fh*0.80);   // last row on the page: go under it
  if(r._stackIdx) midY+=r._stackIdx*fh*1.15;           // minimum spacing, one line per row
  midY=Math.min(midY,1-fh*1.1);
  const cols=dsT.detail.cols||{};
  const d=rowCounts(r);
  /* left edges taken from the row above so the new values line up with the column, and counts are
     left-aligned like every other count redline */
  const aboveCounts=countCellsOf(g.items,false);
  const nearestIn=cx=>{ if(cx==null)return null; let best=null,bd=1e9;
    g.items.forEach(t=>{ const c=t.nx+(t.nw||0)/2; const dd=Math.abs(c-cx); if(dd<0.07&&dd<bd){bd=dd;best=t;} });
    return best; };
  const modelIt=g.items.find(t=>normModelKey(t.str).length>2&&mk.indexOf(normModelKey(t.str))>=0)||g.items[1]||g.items[0];
  /* inserted rows are written in CAPS and centred on their column */
  const lineNh=fh||0.011;                 /* there is no `line` here — that threw and killed the row */
  /* Copy row's mapping: build the mark through addText with the printed RUN as its cell — the same call a
     count redline uses — then drop it onto the inserted row's line. That inherits the printed size, the
     printed line height and the live length rule, so an added row is placed by exactly the same code as
     every other redline. putRowCell remains the fallback for a column that has only a box, no run. */
  const putRun=(run,v)=>{
    const V=String(v).toUpperCase();
    const dupR=(S.annos||[]).some(a=>a.page===pi&&String(a.text).toUpperCase()===V
      &&Math.abs((a.ny||0)-midY)<lineNh*0.9&&Math.abs((a.nx||0)-run.nx)<0.04);
    if(dupR){ LOG("Analyze DS insert: already redlined here, left alone:",V); return true; }
    /* 6fb — geometry from the anchor's run, identity on the line this row is being written onto. Without
       the second half this call was indistinguishable from a redline on the anchor row itself. */
    const liveY=Math.min(1-(lineNh)*1.1,midY);
    const id=addText(pi,0,0,V,{cell:run,keyAt:{nx:run.nx,ny:liveY,nw:run.nw,nh:run.nh||lineNh}});
    const a=S.annos.find(z=>z.id===id);
    if(!a)return false;
    a.ny=Math.min(1-(a.nh||lineNh)*1.1,midY);
    out.applied++;
    return true;
  };
  const putL=(x,v,w,noClamp)=>{ if(x==null||v==null||String(v)===""){ out.missed++; return; }
    const V=String(v).toUpperCase();
    /* Already written? Pressing Redline again must not lay a second copy over the first — the same rule the
       printed-cell redlines follow. Matched on page, text and position. */
    const dup=(S.annos||[]).some(a=>a.page===pi&&String(a.text).toUpperCase()===V
      &&Math.abs((a.ny||0)-midY)<lineNh*0.9&&Math.abs((a.nx||0)-x)<0.04);
    if(dup){ LOG("Analyze DS insert: already redlined here, left alone:",V); return; }
    putRowCell(pi,x,w||0,midY,V,lineNh,noClamp); out.applied++; };
  /* One rule for every value on the row: it is placed against ITS OWN column and nothing else — the same
     box a count or a model redline would be written into. The type used to fall back to `g.items[0]`, which
     is the SECTOR cell, so when the type column could not be resolved the values slid one column left and
     the model appeared under Equipment Type. A value with no column of its own is skipped and logged. */
  /* the printed RUN for a column, when there is one — that is what Copy row maps onto */
  const runOf=key=>{
    const it=nearestIn(cols[key]);
    return (it&&it.nx!=null&&it.str!=null)?it:null;
  };
  const anchorOf=key=>{
    const it=runOf(key);
    if(it)return {nx:it.nx,nw:it.nw};
    const ag=r._aboveG&&r._aboveG[key];
    if(ag&&ag.nx!=null)return {nx:ag.nx,nw:(ag.x2!=null?ag.x2-ag.nx:ag.nw)};
    if(cols[key]!=null)return {nx:cols[key],nw:null};
    return null;
  };
  const putCol=(key,val)=>{
    if(val==null||String(val)==="")return;
    const run=runOf(key);
    if(run&&putRun(run,val))return;                 // Copy row's mapping first
    const a2=anchorOf(key);
    if(!a2){ out.missed++; LOG("Analyze DS insert: no column for ["+key+"] — skipped",String(val)); return; }
    putL(a2.nx,val,a2.nw);
  };
  if(r.sector&&sectorOut(r)!=="—"){
    /* Same rule as a count: a single letter sits flush on the printed one; "A,B,C" centres in the column.
       The anchor's box is centred in that column, so centring on it centres in the column — which needs the
       clamp lifted, since the value is wider than one character. */
    const sv=sectorOut(r);
    const srun=runOf("sector");
    if(srun&&putRun(srun,sv)){ /* placed by the Copy row mapping */ }
    else {
      const sa=anchorOf("sector");
      if(!sa){ out.missed++; LOG("Analyze DS insert: no column for [sector] — skipped",sv); }
      else putL(sa.nx,sv,sa.nw,String(sv).trim().length>1);
    }
  }
  if(r.type)putCol("type",canonType(r.type));
  if(model){
    /* The stored column comes FIRST here as well. `modelIt` is a run located by searching the anchor line,
       and it was resolving to the Equipment Type run — which put the model in that column. */
    const mrun=runOf("model");
    if(mrun&&putRun(mrun,model)){ /* placed by the Copy row mapping */ }
    else {
      const a3=anchorOf("model")||(modelIt?{nx:modelIt.nx,nw:modelIt.nw}:null);
      if(a3)putL(a3.nx,model,a3.nw);
      else { out.missed++; LOG("Analyze DS insert: no column for [model] — skipped",model); }
    }
  }
  /* All four counts take the SAME width — the narrowest printed count box on the anchor row — centred where
     each printed figure sits. Mixing per-cell widths is what made an added row's figures look ragged against
     the count redlines above them. */
  const cboxes=["existing","removal","addition","final"].map((k,i)=>
    ((aboveCounts&&aboveCounts.length===4)?aboveCounts[i]:anchorOf(k))||null);
  const wOf=c=>(c.nw!=null?c.nw:(c.x2!=null?c.x2-c.nx:0));
  const cws=cboxes.filter(Boolean).map(wOf).filter(w=>w>0);
  const cw=cws.length?Math.min.apply(null,cws):null;
  ["existing","removal","addition","final"].forEach((k,i)=>{
    const cell=cboxes[i];
    if(!cell){ out.missed++; LOG("Analyze DS insert: no column for ["+k+"] — skipped",String(d[k])); return; }
    /* a count cell IS a printed run, so it maps the same way; the shared width still governs the fallback */
    if(cell.str!=null&&putRun(cell,String(d[k])))return;
    const wid=(cw!=null?cw:wOf(cell));
    const c0=cell.nx+wOf(cell)/2;
    putL(Math.max(0,c0-wid/2),String(d[k]),wid);
  });
  LOG("Analyze DS insert:",model,d,"between rows on page",pi+1);
  return out;
}
function strikePropagate(r){
  if(!_mirrorSectors)return;        // Mirror edits off => this sector's row only
  const detail=(S.analysis&&S.analysis.designSummary)||[];
  const tk=canonType(r.type).toLowerCase(), mk=normModelKey(r.origModel||r.model);
  detail.forEach(o=>{ if(o===r)return; if(canonType(o.type).toLowerCase()!==tk)return; if(normModelKey(o.origModel||o.model)!==mk)return;
    o.struck=r.struck; const ui=_rowUI.get(o); if(ui){ ui.sb.classList.toggle("on",o.struck); ui.sb.textContent="\u26d4"; ui.sb.title=o.struck?"Struck — click to keep this row":"Strike this row"; ui.recolor(); }
  });
  refreshAzFoot();
}
/* 6cp — Mirror, on RF INVENTORY. It only ever existed for the Design Summary: the ribbon's ⇅ lit up on
   this tab and did nothing, which is what "not working well in RF Inventory" was. The sibling rule is the
   Design Summary's, translated to a table: same PRINTED model, same equipment type, DIFFERENT sector —
   the same physical unit repeated per sector. The edited column is copied across; Sec-Pos never is,
   because that IS the sector, and neither is anything on an inserted row. */
function rfMirrorSiblings(r,cols){
  const A=S.analysis, T=A&&A.rfInventory; if(!T||!T.rows)return [];
  const list=cols||T.columns||[];
  const mc=rfModelCol(list); if(!mc)return [];
  const tc=list.find(c=>/equipment\s*type|^type$/i.test(String(c).trim()));
  const printed=x=>String((x._orig&&x._orig[mc]!=null)?x._orig[mc]:(x.cells&&x.cells[mc])||"");
  const key=normModelKey(printed(r)); if(!key)return [];
  const myType=tc?canonType(r.cells&&r.cells[tc]).toLowerCase():"";
  const mySec=rfRowSector(r,list);
  /* 6fp — A SIBLING IS THE SAME POSITION IN ANOTHER SECTOR, not any row carrying the same model.
     Ced: "A-1 to B-1 and C-1, not A-1 to B-1 and B-3, C-1 and C-3 (if they're all the same models)."
     Matching on the model alone was right only while a model happened to sit at one position per
     sector — which the test form does, which is why this went unseen. Built with one model at all six
     of A-1, A-3, B-1, B-3, C-1, C-3, an edit at A-1 reached five of them.
     A row with no position to follow (site-wide kit, a BBU) keeps the model match: there is nothing
     better to key it on, and it is not what Ced is describing. */
  const myPos=rowPosAny(r);
  return T.rows.filter(o=>{
    if(o===r||o.inserted)return false;
    if(normModelKey(printed(o))!==key)return false;
    if(tc&&myType&&canonType(o.cells&&o.cells[tc]).toLowerCase()!==myType)return false;
    const os=rfRowSector(o,list);
    if(mySec&&os&&mySec!=="—"&&os!=="—"&&os===mySec)return false;   // never inside our own sector
    if(myPos){ if(rowPosAny(o)!==myPos)return false; }              // the SAME position, elsewhere
    return true;
  });
}
function rfMirrorEdit(r,col,cols){
  if(!_mirrorRf)return 0;
  const list=cols||((S.analysis&&S.analysis.rfInventory&&S.analysis.rfInventory.columns)||[]);
  if(/sec\W*pos|^sector$/i.test(String(col).trim()))return 0;   // the sector column is what distinguishes them
  const sibs=rfMirrorSiblings(r,list);
  const vc=rfVendorCol(list);
  const isVendor=(vc&&col===vc);
  /* 6fo — WHO OWNS A MIRRORED VENDOR. Measured on the previous build, per keystroke:
         rfMirrorEdit   COMMSCOPE -> ZZVEND      (the mirror copies)
         syncVendors    ZZVEND    -> COMMSCOPE   (and the resolve takes it straight back)
     A vendor is keyed by SEC-POS, not by model (see the vendor link above), and `syncVendors()` walks
     every antenna slot and re-resolves it from that map. A sibling in another sector has a different
     Sec-Pos and no record under it, so the resolve put it back to what the page printed — on the very
     next keystroke, because every keystroke calls `noteVendorEdit` and that syncs.
     Model never had this: it is pinned by `noteMirroredModel` below. 6ef found and fixed exactly this in
     the ANTENNA mirror and added the `quiet` flag to `noteVendorEdit` for it; the RF Inventory mirror
     was never given the same treatment. So each sibling gets its own record under its own Sec-Pos,
     recorded QUIETLY — a sync in the middle of the loop would re-resolve the rows not yet reached — and
     one sync runs after the loop. */
  if(isVendor)try{ noteVendorEdit(r,"rfInventory",rfRowSecPosKey(r,list),
                                  String((r._orig&&r._orig[col])||""),String(r.cells[col]==null?"":r.cells[col]),
                                  true); }catch(e){}
  let n=0;
  sibs.forEach(o=>{
    if(String(o.cells[col])===String(r.cells[col]))return;
    o.cells[col]=r.cells[col]; n++;
    if(rfModelCol(list)===col){
      /* keep it on the row while Link is off; record it under this sector's key while Link is on, so the
         mirrored value travels to the other tabs in ITS sector too (6ek) */
      noteMirroredModel(o,String((o._orig&&o._orig[col])||""),r.cells[col],"rfInventory");
    }
    if(isVendor&&rfRowIsAntenna(o,list)){
      try{ noteVendorEdit(o,"rfInventory",rfRowSecPosKey(o,list),
                          String((o._orig&&o._orig[col])||""),String(r.cells[col]==null?"":r.cells[col]),
                          true); }catch(e){}
    }
  });
  if(isVendor&&n)try{ syncVendors(); }catch(e){}
  if(n){
    LOG("Mirror (RF Inventory): ["+col+"] copied to",n,"row(s) in the other sectors");
    /* 6ed — DO NOT re-render here. This called renderAnalyze(), and it is called from `oninput` — on
       every keystroke. So the first character you typed rebuilt the whole grid, threw away the input you
       were typing into and dropped the caret on the body: the field went empty and the rest of the word
       went nowhere. Measured — typing "ZZMIRRORTEST" into a Model field with Mirror on left the field
       gone and focus on BODY, which is the whole of "the mirror tool is not working".

       The other two grids never had this: they put the value straight into the sibling rows' inputs and
       leave the DOM alone. RF Inventory does the same now — the rows keep their inputs in `_rowUI`. */
    /* 6ek — resolve first, so a mirrored model reaches the other tabs in each sector it landed in and the
       inputs below show what was resolved. syncModels only writes values; it does not render. */
    if(rfModelCol(list)===col)try{ syncModels(); }catch(e){}
    sibs.forEach(o=>{
      const ui=_rowUI.get(o);
      if(!ui||!ui.inputs||!ui.inputs[col])return;      // that sector's sub-tab is not on screen
      const el=ui.inputs[col];
      if(String(el.value)!==String(o.cells[col])){ el.value=o.cells[col]; el.dataset.edited="1"; }
      try{ ui.recolor(); }catch(e){}
    });
    refreshAzFoot();
  }
  return n;
}
function rfMirrorStrike(r,cols){
  if(!_mirrorRf)return 0;
  const sibs=rfMirrorSiblings(r,cols);
  let n=0;
  sibs.forEach(o=>{ if(o.struck!==r.struck){ o.struck=r.struck; n++; } });
  if(n){ LOG("Mirror (RF Inventory): strike copied to",n,"row(s)"); renderAnalyze(); }
  return n;
}
function mirrorEdit(r,field){
  if(!_mirrorSectors)return;
  const detail=(S.analysis&&S.analysis.designSummary)||[];
  const tk=canonType(r.type).toLowerCase(), mk=normModelKey(r.origModel||r.model);   // RRH and RRU count as the same type
  if(!mk)return;
  let _n=0;
  const _mysec=normSector(r.sector);
  detail.forEach(o=>{ if(o===r)return;
    if(normModelKey(o.origModel||o.model)!==mk)return;                 // symmetric siblings share the same (original) model
    if(field!=="type" && canonType(o.type).toLowerCase()!==tk)return;  // for non-type edits, also require same canonical type
    /* 6ed — OTHER SECTORS ONLY, which is what Mirror says it does and what the RF Inventory and antenna
       mirrors have always enforced. This one had no sector test at all, so on a form where one sector
       carries two rows of the same model an edit to one silently overwrote the other — a mirror reaching
       inside the sector it started in. */
    const _os=normSector(o.sector);
    if(_mysec&&_os&&_mysec!=="—"&&_os!=="—"&&_os===_mysec)return;
    _n++;
    if(field==="before")o.before=r.before;
    else if(field==="after")o.after=r.after;
    else if(field==="model"){
      o.model=r.model;
      /* hold it on the row when linking is off; under this sector's key when it is on (6ek) */
      noteMirroredModel(o,o.origModel,r.model,"designSummary");
    }
    else if(field==="struck")o.struck=r.struck;
    else if(field==="type")o.type=r.type;
    const ui=_rowUI.get(o);   // update inputs only if that sector's tab is currently rendered
    if(ui){ if(field==="before"){ui.bi.value=r.before;ui.bi.dataset.edited="1";} else if(field==="after"){ui.ai.value=r.after;ui.ai.dataset.edited="1";} else if(field==="model"){ui.mi.value=r.model;ui.mi.dataset.edited="1";}
      else if(field==="type"&&ui.tsel){ ui.tsel.value=r.type; }
      else if(field==="struck"){ ui.sb.classList.toggle("on",o.struck); ui.sb.textContent="\u26d4"; ui.sb.title=o.struck?"Struck — click to keep this row":"Strike this row"; } ui.recolor(); }
  });
  /* 6ed — and it says what it reached, like the other two do. Silence was the other half of "the mirror
     is not working": on a sector sub-tab the rows it copies to are not on screen, so with no log line
     there was nothing at all to tell you it had happened. */
  if(_n)LOG("Mirror (Design Summary): ["+field+"] copied to",_n,"row(s) in the other sectors");
  /* 6ek — every sibling has now recorded the correction under its own sector's key, so resolve. That is
     what carries a mirrored model out to the other TABS in each sector it reached (and, once every
     sector agrees, to Equipment in Calc) inside this keystroke rather than on the next render. */
  if(_n&&field==="model")try{ syncModels(); }catch(e){}
  refreshAzFoot();
}
const TYPE_OPTIONS=["BBU","ANTENNA","RRH","INTEGRATED ANTENNA RADIO","DIPLEXER","TRIPLEXER","SQUID","SURGE ARRESTOR","FIBER","DC_TRUNK","TMA","RADIO","CABINET"];
function makeTypeSelect(val){
  const sel=el("select","az-in az-type"); const cur=canonType(val||"");
  const opts=TYPE_OPTIONS.slice();
  if(cur && !opts.some(o=>o.toLowerCase()===String(cur).toLowerCase())) opts.unshift(cur);   // keep an unusual printed type as an option
  opts.forEach(o=>{ const op=document.createElement("option"); op.value=o; op.textContent=o; if(o.toLowerCase()===String(cur).toLowerCase())op.selected=true; sel.appendChild(op); });
  return sel;
}
function dsRowUserChanged(r){
  if(r._noGeo) return false;          // never stamp a row we could not locate on the page
  /* Typed Removals/Additions do not move Before or After by design, so nothing below would notice them —
     ask rowCounts instead, or the whole manual-editing mode would never redline anything. */
  if(r.manual && !r.struck){ const c=rowCounts(r); if(c.changed) return true; }
  if(r._fromRf) return false;         // exists only because an RF row was inserted — display only
  if(r.fromRfModel && String(r.model||"")!==String(r.origModel||"")) return true;   // model linked from RF
  if(r._rfAdds){
    /* The count was raised by an inserted RF Inventory row. That link is shown in the grid but must not
       be written onto the Design Summary page, so subtract it and see whether anything ELSE changed. */
    const afterNoRf=int(r.after)-int(r._rfAdds);
    const same = afterNoRf===int(r.origAfter==null?r.after:r.origAfter)
      && int(r.before)===int(r.origBefore==null?r.before:r.origBefore)
      && !r.struck && String(r.model||"")===String(r.origModel||"")
      && canonType(r.type)===canonType(r.origType||r.type)
      && !sectorChanged(r);
    if(same) return false;
  }                       // count raised by an inserted RF Inventory row
  if(r.inserted) return !!(String(r.model||"").trim() || int(r.before) || int(r.after));
  if(sectorChanged(r)) return true;   // reassigned (including a typed label)
  return !!(r.struck || int(r.before)!==int(r.origBefore==null?r.before:r.origBefore) || int(r.after)!==int(r.origAfter==null?r.after:r.origAfter)
    || (r.model!==r.origModel) || (canonType(r.type)!==canonType(r.origType||r.type)));
}
/* 6ew — AND THE CELL IS MARKED, NOT THE ROW. Every editable cell in the modal is painted from here — one
   funnel, seven callers, every tab — so this is where the cell's own mark belongs too. Before, a change
   was shown by washing the whole ROW (or, on Ontel, by a rule down the row's left edge), which says "one
   of the twelve values in this row moved" and leaves you to find it. The mark now sits on the cell that
   moved, in every theme. `markCell` is separate so the two <select> cells, which set their class
   directly, can use it as well. */
function markCell(inp,cls){
  const td=(inp&&inp.closest)?inp.closest("td"):null; if(!td)return;
  td.classList.remove("cellchg","cellsug","cellpre");
  if(cls)td.classList.add(cls);
}
function markInput(inp,val,baseline){
  inp.classList.remove("prefill","useredit","suggested");
  const base=String(baseline==null?val:baseline);
  if(String(val)===base){ markCell(inp,null); return; }  // same as the PDF → normal color
  /* 6cp — three states now, and they are different facts: the tool PROPOSED this (blue), you typed it
     (red), or it was auto-filled to differ from the page (orange). A suggestion you then type over
     becomes yours — the edited flag wins. */
  if(inp.dataset.edited==="1"){ inp.classList.add("useredit"); markCell(inp,"cellchg"); }
  else if(inp.dataset.suggested==="1"){ inp.classList.add("suggested"); markCell(inp,"cellsug"); }
  else { inp.classList.add("prefill"); markCell(inp,"cellpre"); }
}
function ecRow(r){
  const tr=el("tr");
  const tdType=el("td"); const tsel=makeTypeSelect(r.type);
  tsel.onchange=()=>{ azBeginEdit(); r.type=tsel.value; recolor(); }; tdType.appendChild(tsel);
  const tdModel=el("td"); const mi=el("input","az-in wide az-model"); mi.value=r.model; sgTag(mi,r,"model");
  mi.oninput=()=>{
    azBeginEdit(); mi.dataset.edited="1"; r.model=mi.value;
    /* 6ch: this used to force every Equipment-in-Calc edit to be row-local, which meant Link could never
       reach this tab however it was set. It now follows the toggle like the other three. */
    noteModelEdit(r.origModel,mi.value,r,"equipmentCalc");
    recolor();
  }; tdModel.appendChild(mi);
  const tdP=el("td","az-derived");
  const tdC=el("td"); const ci=el("input","az-in num"); ci.value=r.count;
  sgTag(ci,r,"count");
  ci.oninput=()=>{ azBeginEdit(); ci.dataset.edited="1"; r.count=ci.value;
    r._countEdited=true;      // stop the Design Summary totals overwriting what you typed here
    recolor(); }; tdC.appendChild(ci);
  const tdDs=el("td","az-derived");
  const tdCh=el("td");
  const tdS=el("td"); const sb=el("button","az-strk"+(r.struck?" on":""),"\u26d4");
  sb.title=r.struck?"Struck — click to keep this row":"Strike this row (mark it removed)";
  sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck);
    sb.textContent="\u26d4"; sb.title=r.struck?"Struck — click to keep this row":"Strike this row"; recolor(); };
  tdS.appendChild(sb);
  function recolor(){ const ch=ecRowChanged(r);
    tdP.innerHTML=`<b>${int(r.printed)}</b>`;
    tdDs.textContent=r.dsType?(r.dsType+" total"):"—";
    tdCh.innerHTML=`<span class="az-chg ${sgAny(r)?"sugg":(ch?"yes":"no")}">${r.struck?"struck":(sgAny(r)?"suggested":(ch?"edited":"—"))}</span>`;
    tr.classList.toggle("suggrow",sgAny(r));
    markInput(mi,r.model,r.origModel); markInput(ci,r.count,r.printed);
    tsel.classList.toggle("useredit", canonType(r.type)!==canonType(r.origType||r.type));
    markCell(tsel, canonType(r.type)!==canonType(r.origType||r.type) ? "cellchg" : null);
    tr.classList.toggle("chg",ch&&!r.struck); tr.classList.toggle("struck",r.struck);
    refreshAzFoot();
  }
  recolor();
  [tdType,tdModel,tdP,tdC,tdDs,tdCh,tdS].forEach(td=>tr.appendChild(td));
  return tr;
}
function countRow(r,secKey){
  const isDS=(secKey==="designSummary");
  const tr=el("tr");
  if(dsRowUserChanged(r))tr.classList.add("chg"); if(r.struck)tr.classList.add("struck");
  const tdSec=el("td");
  /* 6ca: an ADDED row gets the same control. It used to render its inherited sector as dead text, so a
     row added under Alpha could only ever be an Alpha row. The anchor is `_sec` and is untouched by
     this — only the value that gets written changes. */
  if(isDS){
    const here=normSector(r.sector);
    const raw=String(r.sector==null?"":r.sector).trim();
    const STD=["A","B","C","D","E","F","SITE"];
    /* 6bz — open item 2. "Type a value…" swaps the dropdown for a text input writing straight to
       r.sector; `_secTyped` is what tells the apply path to place it verbatim instead of putting it
       through normSector, which would drop it. Clearing the box returns you to the list. */
    if(r._secTyped||(raw&&STD.indexOf(here)<0)){
      const ti=el("input","az-in az-sec");
      ti.value=raw; ti.placeholder="Sector";
      ti.title="Typed sector — any label is kept exactly as written. Clear it to go back to the list.";
      ti.oninput=()=>{ azBeginEdit(); r._secTyped=true; r.sector=ti.value; recolor(); };
      ti.onblur=()=>{ if(!String(ti.value).trim()){ r._secTyped=false;
        r.sector=(r.origSector!=null?r.origSector:""); renderAnalyze(); } };
      tdSec.appendChild(ti);
    } else {
      const ssel=el("select","az-in az-sec");
      const opts=[...new Set(["A","B","C","D","E","F","SITE",here].filter(v=>v&&v!=="—"))];
      opts.forEach(o=>{ const op=document.createElement("option"); op.value=o;
        op.textContent=(o==="SITE"?"Site":greek(o)+" ("+o+")"); if(o===here)op.selected=true; ssel.appendChild(op); });
      const opT=document.createElement("option"); opT.value="__type__"; opT.textContent="✎ Type a value…";
      ssel.appendChild(opT);
      ssel.title="Reassign this equipment to another sector, or type your own label";
      ssel.onchange=()=>{ azBeginEdit();
        if(ssel.value==="__type__"){ r._secTyped=true; r.sector=(here==="—"?"":here); renderAnalyze(); return; }
        r._secTyped=false; r.sector=ssel.value; renderAnalyze(); };
      tdSec.appendChild(ssel);
    }
  } else { tdSec.className="az-derived"; tdSec.textContent=normSector(r.sector); }
  const tdType=el("td"); const tsel=makeTypeSelect(r.type); tsel.onchange=()=>{ azBeginEdit(); r.type=tsel.value; recolor(); if(isDS)mirrorEdit(r,"type"); }; tdType.appendChild(tsel);
  const tdModel=el("td"); const mi=el("input","az-in wide az-model"); mi.value=r.model; sgTag(mi,r,"model");
  mi.oninput=()=>{ azBeginEdit(); mi.dataset.edited="1"; r.model=mi.value; r._selfEdit=true;
    noteModelEdit(r.origModel,mi.value,r,isDS?"designSummary":undefined); recolor(); if(isDS)mirrorEdit(r,"model"); }; tdModel.appendChild(mi);
  const tdB=el("td"); const bi=el("input","az-in num"); bi.value=r.before; bi.oninput=()=>{ azBeginEdit(); bi.dataset.edited="1"; r.before=bi.value; recolor(); if(isDS)mirrorEdit(r,"before"); if(isDS)ecCountsFollowDs(); }; tdB.appendChild(bi);
  const tdA=el("td"); const ai=el("input","az-in num"); ai.value=r.after; ai.oninput=()=>{ azBeginEdit(); ai.dataset.edited="1"; r.after=ai.value; recolor(); if(isDS)mirrorEdit(r,"after"); if(isDS)ecCountsFollowDs(); }; tdA.appendChild(ai);
  const tdD=el("td","az-derived"); tdD.dataset.role="derived"; 
  const tdC=el("td");
  const tdS=el("td"); tdS.style.whiteSpace="nowrap";
  let sb;
  if(r.inserted){
    tdS.appendChild(el("span","rf-newbadge",r._fromRf?"from RF":"new"));
    if(!r._fromRf){
      const ib2=el("button","az-ins","＋"); ib2.title="Insert another new row below this one";
      ib2.style.marginLeft="5px";
      ib2.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation(); dsInsertAfter(r); dsAdoptAnchor(r); };
      tdS.appendChild(ib2);
      const db2=el("button","az-ins","⧉"); db2.title="Duplicate this new row";
      db2.style.marginLeft="4px";
      db2.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
        dsInsertAfter(r); const nw=dsAdoptAnchor(r);
        if(nw){ nw.type=r.type; nw.model=r.model; nw.before=r.before; nw.after=r.after;
                nw.sector=r.sector; nw.origSector=r.origSector; renderAnalyze(); }
      };
      tdS.appendChild(db2);
    }
    const rm=el("button","az-strk","✕");
    rm.title=r._fromRf?"This row came from an inserted RF Inventory row — removing it removes that row too"
                      :"Remove this inserted row";
    rm.style.marginLeft="5px";
    rm.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
      if(r._fromRf) rfRemoveInsertsFor(r._fromRf);      // otherwise the carry would re-create it
      dsRemoveRow(r); };
    tdS.appendChild(rm);
    sb={classList:{toggle:()=>{}},textContent:""};
  } else {
    sb=el("button","az-strk"+(r.struck?" on":""),"\u26d4");
    sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck); sb.textContent="\u26d4"; recolor(); if(isDS)strikePropagate(r); };
    tdS.appendChild(sb);
    if(isDS){
      const ib=el("button","az-ins","＋"); ib.title="Insert a new blank row below this one";
      ib.style.marginLeft="5px";
      ib.onclick=()=>{ dsInsertAfter(r); dsAdoptAnchor(r); };
      tdS.appendChild(ib);
      const db=el("button","az-ins","⧉"); db.title="Duplicate this row";
      db.style.marginLeft="4px";
      db.onclick=()=>{
        dsInsertAfter(r); const nw=dsAdoptAnchor(r);
        if(nw){ nw.type=r.type; nw.model=r.model; nw.before=r.before; nw.after=r.after;
                nw.sector=r.sector; nw.origSector=r.origSector; renderAnalyze(); }
      };
      tdS.appendChild(db);
    }
  }
  if(r.inserted)tr.classList.add("rf-new");
  _rowUI.set(r,{mi,bi,ai,sb,tsel,recolor});
  function recolor(){ const dd=rowCounts(r); const ch=dsRowUserChanged(r);
    if(r._noGeo){ tr.style.opacity=".55"; tr.title="This row could not be located on the page — it will not be redlined. Re-analyze, or redline it by hand."; }
    if(isDS && _dsManualCounts){
      /* four editable cells instead of the derived read-out */
      if(!tdD.dataset.built){
        tdD.dataset.built="1"; tdD.classList.remove("az-derived"); tdD.innerHTML="";
        /* Same shape as the read-only cell — Existing / Removal / Addition / Final with slashes — but the
           middle two are inputs. Only Removal and Addition are typed; Existing follows Before and Final
           follows After, exactly as before. */
        const box=el("div","cnt4");
        box.appendChild(el("b","cnt4-fx",String(dd.existing)));
        box.appendChild(el("span","cnt4-sl","/"));
        const fields={};
        ["removal","addition"].forEach(k=>{
          const inp=el("input","az-in num tiny"); fields[k]=inp;
          inp.title=(k==="removal")
            ? "Removals — subtracted from Before. Additions follow so Final still equals After."
            : "Additions — Removals follow so Final still equals After.";
          inp.value=String(dd[k]);
          inp.oninput=()=>{
            azBeginEdit();
            if(!r.manual)r.manual={removal:dd.removal,addition:dd.addition};
            r.manual.lead=k;                 // the field you typed leads; the other is derived
            r.manual[k]=inp.value;
            const now=rowCounts(r);
            /* show the derived partner, without stealing focus from the field being typed in */
            const other=(k==="removal")?"addition":"removal";
            if(fields[other]&&document.activeElement!==fields[other]){
              fields[other].value=String(now[other]);
              r.manual[other]=String(now[other]);
            }
            inp.dataset.edited="1"; recolor();
          };
          box.appendChild(inp);
          box.appendChild(el("span","cnt4-sl","/"));
        });
        box.appendChild(el("b","cnt4-fx",String(dd.final)));
        tdD.appendChild(box);
      } else {
        const ins=tdD.querySelectorAll("input");
        ["removal","addition"].forEach((k,i)=>{
          if(ins[i]&&ins[i]!==document.activeElement)ins[i].value=String(dd[k]);
        });
        /* keep the fixed ends in step with Before and After */
        const fx=tdD.querySelectorAll("b.cnt4-fx");
        if(fx[0])fx[0].textContent=String(dd.existing);
        if(fx[1])fx[1].textContent=String(dd.final);
      }
    } else {
      if(tdD.dataset.built){ tdD.dataset.built=""; tdD.classList.add("az-derived"); }
      tdD.innerHTML=`<b>${dd.existing}</b> / <b>${dd.removal}</b> / <b>${dd.addition}</b> / <b>${dd.final}</b>`;
    }
    tdC.innerHTML=`<span class="az-chg ${ch?"yes":"no"}">${r.struck?"strike":ch?"edited":"—"}</span>`;
    markInput(mi,r.model,r.origModel); markInput(bi,r.before,r.origBefore); markInput(ai,r.after,r.origAfter);
    tsel.classList.toggle("useredit", canonType(r.type)!==canonType(r.origType||r.type));
    markCell(tsel, canonType(r.type)!==canonType(r.origType||r.type) ? "cellchg" : null);
    tr.classList.toggle("chg",ch); tr.classList.toggle("struck",r.struck);
    refreshAzFoot(); refreshDerived();
  }
  recolor();
  [tdSec,tdType,tdModel,tdB,tdA,tdD,tdC,tdS].forEach(td=>tr.appendChild(td));
  return tr;
}
function renderDetailsPane(key){
  const rows=(S.analysis&&S.analysis[key])||[];
  const p=el("div","az-pane active");
  const title=(key==="siteDetails")?"Site Details":"RFDS Details";
  if(!rows.length){ p.appendChild(el("div","az-empty","No "+title+" page detected. If your RFDS has one, try Re-analyze.")); return p; }
  p.appendChild(redlineToggleEl(key));
  p.appendChild(el("div","az-secn",title+" — every field as printed. Type a corrected value to redline it; ⛔ strikes the field."));
  const t=el("table","az");
  t.innerHTML="<thead><tr><th>Field</th><th>On page</th><th>Corrected value</th><th>Change</th><th></th></tr></thead>";
  const tb=el("tbody");
  rows.forEach(r=>{
    const tr=el("tr"); if(r.struck)tr.classList.add("struck");
    const tdL=el("td"); tdL.textContent=r.label; tdL.style.fontSize="12px";
    const tdP=el("td","az-derived"); tdP.textContent=r.printed||"—";
    const tdV=el("td"); const inp=el("input","az-in wide"); inp.value=r.value!=null?r.value:"";
    const tdC=el("td");
    const tdS=el("td"); const sb=el("button","az-strk"+(r.struck?" on":""),"⛔"); sb.title="Strike this field";
    const recolor=()=>{ const ch=detailsRowChanged(r);
      tdC.innerHTML=`<span class="az-chg ${ch?"yes":"no"}">${r.struck?"strike":ch?"edited":"—"}</span>`;
      markInput(inp,r.value||"",r.printed||"");
      tr.classList.toggle("chg",ch&&!r.struck); tr.classList.toggle("struck",r.struck); refreshAzFoot(); };
    inp.oninput=()=>{ azBeginEdit(); inp.dataset.edited="1"; r.value=inp.value; recolor(); };
    sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck); recolor(); };
    tdV.appendChild(inp); tdS.appendChild(sb);
    [tdL,tdP,tdV,tdC,tdS].forEach(td=>tr.appendChild(td));
    tb.appendChild(tr); recolor();
  });
  t.appendChild(tb); p.appendChild(t);
  return p;
}
function renderRfPane(){
  const data=(S.analysis&&S.analysis.rfInventory)||{columns:[],rows:[]};
  const p=el("div","az-pane active");
  if(!data.rows||!data.rows.length){ p.appendChild(el("div","az-empty","No RF Inventory rows detected. Try Re-analyze or redline manually.")); return p; }
  carryDsToRf();                                   // 4. Design Summary edits flow in first
  const allCols=(data.columns&&data.columns.length)?data.columns:Object.keys(data.rows[0].cells);
  const cols=rfVisibleCols(allCols);
  p.appendChild(redlineToggleEl("rfInventory"));
  /* 6dv — "Copy diagnostics" and "Audit RF" removed from the tab. Both wrote to the message log for
     debugging and neither did anything for the job; rfDiagnostics() and rfAudit() are still callable
     from the console if they are ever needed again. */
  p.appendChild(rfColToggleBar(allCols));         // 1. per-column show/hide

  // 1. sector sub-tabs
  const groups={}; data.rows.forEach((r,i)=>{ const s=rfRowSector(r,allCols); (groups[s]=groups[s]||[]).push(i); });
  const sectors=Object.keys(groups).sort((a,b)=>sectorRank(a)-sectorRank(b));
  const counts={}; sectors.forEach(s=>counts[s]=groups[s].length);
  if(sectors.indexOf(_rfSub)<0) _rfSub=sectors[0];
  if(sectors.length>1) p.appendChild(sectorTabBar(sectors,_rfSub,s=>{ _rfSub=s; renderAnalyze(); },counts));
  p.appendChild(sectorAccent(_rfSub,"RF Inventory — "+secLabel(_rfSub)));
  p.appendChild(el("div","az-secn","Edit any cell to redline it · ⛔ strikes the whole row · <b>＋</b> inserts a new redline row that gets written in between the rows on the page. Model changes made in Design Summary are carried in automatically (orange)."));

  const t=el("table","az");
  t.innerHTML="<thead><tr>"+cols.map(c=>`<th>${escapeHtml(c)}</th>`).join("")+"<th></th></tr></thead>";
  const tb=el("tbody");
  (groups[_rfSub]||[]).forEach(idx=>{
    const r=data.rows[idx];
    const tr=el("tr"); if(r.struck)tr.classList.add("struck"); if(r.inserted)tr.classList.add("rf-new");
    const inputs={};
    const recolor=()=>{ const ch=rfRowChanged(r,allCols);
      cols.forEach(c=>{ if(inputs[c])markInput(inputs[c],r.cells[c]||"",(r._orig&&r._orig[c]!=null)?r._orig[c]:""); });
      tr.classList.toggle("chg",ch&&!r.struck&&!r.inserted); refreshAzFoot(); };
    cols.forEach((c,ci)=>{
      const td=el("td");
      const isType=/equipment\s*type|^type$/i.test(String(c).trim());
      const isStat=/status/i.test(String(c).trim());
      let inp;
      if(isType||isStat){
        /* the two columns with a fixed vocabulary get a dropdown; anything printed that is not in the
           list is added so nothing read off the page is ever lost */
        inp=el("select","az-in");
        const cur=String(r.cells[c]||"").trim();
        const list=isType?TYPE_OPTIONS.slice():["NEW","EXISTING","UPDATE","REMOVE","DECOM","RELOCATE"];
        const norm=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,"");
        const canon=isType?canonType(cur):cur.toUpperCase();
        if(canon&&!list.some(o=>norm(o)===norm(canon)))list.unshift(canon);
        if(!cur)list.unshift("");
        list.forEach(o=>{ const op=document.createElement("option"); op.value=o; op.textContent=o||"—";
          if(norm(o)===norm(canon))op.selected=true; inp.appendChild(op); });
        inp.onchange=()=>{ azBeginEdit(); inp.dataset.edited="1"; r.cells[c]=inp.value;
          if(r.inserted) carryRfInsertsToDs(); rfMirrorEdit(r,c,allCols); recolor(); };
      } else {
        inp=el("input","az-in"); inp.value=r.cells[c]!=null?r.cells[c]:"";
        if(r.inserted&&ci===0)inp.placeholder="new row…";
        inp.oninput=()=>{ azBeginEdit(); inp.dataset.edited="1"; r.cells[c]=inp.value;
          if(r.inserted) carryRfInsertsToDs();
          if(/model/i.test(String(c).trim())) noteModelEdit((r._orig&&r._orig[c])||"",inp.value,r,"rfInventory");
          /* 6dl — a vendor typed on an ANTENNA row reaches the Antenna Position row at the same Sec-Pos */
          if(c===rfVendorCol(allCols)&&rfRowIsAntenna(r,allCols))
            noteVendorEdit(r,"rfInventory",rfRowSecPosKey(r,allCols),(r._orig&&r._orig[c])||"",inp.value);
          rfMirrorEdit(r,c,allCols);
          recolor(); };
      }
      sgTag(inp,r,c);
      inputs[c]=inp;
      td.appendChild(inp); tr.appendChild(td);
    });
    /* 6ed — the row's own inputs, on the row, so Mirror can put a value into the sibling sectors'
       fields the way the Design Summary and the antenna grids do. Without this the only way to show a
       mirrored value was to rebuild the grid, and rebuilding it is what broke typing — see rfMirrorEdit. */
    _rowUI.set(r,{inputs,recolor,tr});
    const tda=el("td"); tda.style.whiteSpace="nowrap";
    if(r.inserted){
      tda.appendChild(el("span","rf-newbadge","new"));
      /* an inserted row can spawn more of its own — the case at the bottom of a page */
      const ib2=el("button","az-ins","＋"); ib2.title="Insert another new row below this one";
      ib2.style.marginLeft="5px";
      ib2.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation(); rfInsertAfter(idx); rfAdoptAnchor(idx); };
      tda.appendChild(ib2);
      const db2=el("button","az-ins","⧉"); db2.title="Duplicate this new row";
      db2.style.marginLeft="4px";
      db2.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation();
        rfInsertAfter(idx); const nw=rfAdoptAnchor(idx);
        if(nw){ Object.keys(r.cells||{}).forEach(k=>{ nw.cells[k]=r.cells[k]; }); renderAnalyze(); }
      };
      tda.appendChild(db2);
      const rm=el("button","az-strk","✕"); rm.title="Remove this inserted row"; rm.style.marginLeft="5px";
      rm.onclick=ev=>{ ev.preventDefault(); ev.stopPropagation(); rfRemoveRow(r); };
      tda.appendChild(rm);
    } else {
      const sb=el("button","az-strk"+(r.struck?" on":""),"⛔"); sb.title="Strike this row";
      sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck); tr.classList.toggle("struck",r.struck); recolor(); };
      tda.appendChild(sb);
      const ib=el("button","az-ins","＋"); ib.title="Insert a new blank row below this one";
      ib.style.marginLeft="5px";
      ib.onclick=()=>{ rfInsertAfter(idx); rfAdoptAnchor(idx); };
      tda.appendChild(ib);
      const db=el("button","az-ins","⧉"); db.title="Duplicate this row";
      db.style.marginLeft="4px";
      db.onclick=()=>{
        rfInsertAfter(idx); const nw=rfAdoptAnchor(idx);
        if(nw){ Object.keys(r.cells||{}).forEach(k=>{ nw.cells[k]=r.cells[k]; }); renderAnalyze(); }
      };
      tda.appendChild(db);
    }
    tr.appendChild(tda);
    tb.appendChild(tr); recolor();
  });
  t.appendChild(tb); p.appendChild(t);
  return p;
}
const ANT_COLS_DEFAULT=[
  ["secPos","Sec-Pos"],
  ["vendor","Vendor"],["vendorAsBuilt","Vendor (AS-B)"],
  ["model","Model"],["modelAsBuilt","Model (AS-B)"],
  ["radCenterDesign","RAD (DES)"],["radCenterAsBuilt","RAD (AS-B)"],
  ["tipHeight","TIP"],["tipHeightAsBuilt","TIP (AS-B)"],
  ["azimuthDesign","AZM (DES)"],["azimuthAsBuilt","AZM (AS-B)"],
  ["mechDowntiltDesign","MDT (DES)"],["mechDowntiltAsBuilt","MDT (AS-B)"]
];
/* 6ci — the tab used to show ten fields and silently drop the rest of the page. Everything the reader
   found is available now; which rows you see is a toggle, the way RF Inventory and Equipment in Calc
   already work. The canonical ten stay the default because they are the ones that get redlined. */
let _antRows=null;                    // labels currently shown, null = the default set
const ANT_KEY_LABEL={};
ANT_COLS_DEFAULT.forEach(([k,l])=>{ ANT_KEY_LABEL[k]=l; });
function antAllFields(rows){
  const out=[];
  (rows||[]).forEach(r=>(r._fieldOrder||[]).forEach(l=>{ if(out.indexOf(l)<0)out.push(l); }));
  return out;
}
/* a printed label -> the canonical key it feeds, so a toggled-on row edits the same value the redline
   pass reads rather than a second copy of it */
function antColsFor(rows){
  const all=antAllFields(rows);
  if(!all.length)return ANT_COLS_DEFAULT.slice();
  const shown=_antRows||all.filter(l=>antKeyForLabel(l)&&ANT_KEY_LABEL[antKeyForLabel(l)]);
  const cols=shown.map(l=>{
    const k=antKeyForLabel(l);
    return (k&&ANT_KEY_LABEL[k])?[k,ANT_KEY_LABEL[k],l]:["field:"+l,l.length>22?l.slice(0,21)+"…":l,l];
  });
  /* 6dd — "Vendor" and "Vendor (AS-B)" side by side reads as one labelled and one not. When the page
     prints both halves of a pair, the design half says so, exactly as RAD and AZM do. */
  const keys=cols.map(c=>c[0]);
  [["vendor","vendorAsBuilt","Vendor (DES)"],["model","modelAsBuilt","Model (DES)"],
   ["tipHeight","tipHeightAsBuilt","TIP (DES)"]].forEach(([des,ab,lbl])=>{
    if(keys.indexOf(des)>=0&&keys.indexOf(ab)>=0)cols[keys.indexOf(des)][1]=lbl;
  });
  /* 6fu — AND THE AS-BUILT HALF IS OFFERED EVEN WHERE THE PAGE PRINTS ONLY ONE ROW. Ced: "when an rfds
     has no design and as built in antenna position, make sure to default populate the same toggles."
     Asked what should happen on export, where there is no As-Built row to write into, he chose "offer
     them, and stamp beside the Design value" — so the column is a real editable column, not decoration,
     and `stamp()` places its correction next to the printed design figure in the same cell. The
     synthetic column carries a `+` in its printed-label slot so the row-toggle bar, which lists what
     the PAGE prints, does not offer a toggle for a row that is not on the page. */
  const after=[];
  const PAIR=(typeof ANT_PAIR!=="undefined")?ANT_PAIR:{};   /* declared below; only read at run time */
  cols.forEach(c=>{
    after.push(c);
    const ab=PAIR[c[0]];
    if(ab && keys.indexOf(ab)<0 && ANT_KEY_LABEL[ab]) after.push([ab,ANT_KEY_LABEL[ab],"+"+ab]);
  });
  return after;
}
function antRowToggleBar(rows){
  const all=antAllFields(rows);
  if(!all.length)return el("span");
  const shown=antColsFor(rows).map(c=>c[2]);
  const wrap=el("div","rf-cols");
  wrap.appendChild(el("span","rf-cols-lbl","Rows"));
  all.forEach(l=>{
    const on=shown.indexOf(l)>=0;
    const b=el("button","rf-col"+(on?" on":""),escapeHtml(l.length>26?l.slice(0,25)+"…":l));
    b.title=(on?"Hide":"Show")+" "+l;
    b.onclick=()=>{ const cur=shown.slice(); const i=cur.indexOf(l);
      if(i>=0)cur.splice(i,1); else cur.push(l);
      _antRows=all.filter(x=>cur.indexOf(x)>=0);       // keep the page's own order
      renderAnalyze(); };
    wrap.appendChild(b);
  });
  const a=el("button","rf-col","All"); a.title="Show every row the page prints";
  a.onclick=()=>{ _antRows=all.slice(); renderAnalyze(); };
  const d=el("button","rf-col","Default"); d.title="Back to the rows that get redlined";
  d.onclick=()=>{ _antRows=null; renderAnalyze(); };
  wrap.appendChild(a); wrap.appendChild(d);
  return wrap;
}
/* read/write a field that has no canonical key */
function antGet(r,f){ return f.indexOf("field:")===0?((r.fields||{})[f.slice(6)]||""):r[f]; }
function antSet(r,f,v){ if(f.indexOf("field:")===0){ r.fields=r.fields||{}; r.fields[f.slice(6)]=v; } else r[f]=v; }
function antOrig(r,f){ return f.indexOf("field:")===0?((r._origFields||{})[f.slice(6)]||""):r["_orig_"+f]; }

/* 6de — the Design → As-Built pairs, and the reason Mirror left the new ones behind: this map is what
   the grid and `antMirrorEdit` consult, and 6dd never added vendor, model or tip height to it. The design
   value was mirrored across the sectors and its as-built partner stayed on the printed figure. */
const ANT_PAIR={radCenterDesign:"radCenterAsBuilt",azimuthDesign:"azimuthAsBuilt",mechDowntiltDesign:"mechDowntiltAsBuilt",
  vendor:"vendorAsBuilt",model:"modelAsBuilt",tipHeight:"tipHeightAsBuilt"};
/* ...but only on the forms that PRINT the as-built column. A page with one Vendor row must not grow a
   vendorAsBuilt value: nothing would be under the redline. */
const ANT_PAIR_OPT=new Set(["vendorAsBuilt","modelAsBuilt","tipHeightAsBuilt"]);
/* 6fh — AND THE OTHER WAY ROUND. This map was one-directional: correcting a Design value carried its
   As-Built partner, and correcting the As-Built carried nothing — measured, `antPairFor` returned null
   for every as-built field, so typing 15 into Azimuth (As-Built) left Azimuth (Design) on the printed
   figure and the pair disagreed.

   That is not a new rule, it is the existing one finally applied symmetrically. 6db settled the model:
   "the As-Built column IS the Design value", and any difference between them is the thing to redline —
   which is why `antReDerive` copies design onto as-built. Keeping them in lockstep from one side only
   meant the tool quietly disagreed with itself depending on which cell you happened to click.

   No loop: the callers write the partner directly rather than re-entering the edit path, and
   `antReDerive` is a no-op once the two already match. */
const ANT_PAIR_REV=(()=>{ const m={}; Object.keys(ANT_PAIR).forEach(d=>{ m[ANT_PAIR[d]]=d; }); return m; })();
function antPairFor(r,f){
  const p=ANT_PAIR[f];
  if(p){
    /* design -> as-built, but only on the forms that PRINT the as-built column */
    if(ANT_PAIR_OPT.has(p)&&!(r&&r._gf&&r._gf[p]))return null;
    return p;
  }
  /* as-built -> design, and the same standard both ways: only when the target column is on the page.
     A form that does not print Azimuth (Design) must not grow one from an as-built edit. */
  const d=ANT_PAIR_REV[f];
  if(!d)return null;
  if(!(r&&r._gf&&r._gf[d]))return null;
  return d;
}
/* The RFDS prints this table TRANSPOSED — field names down the left, one column per antenna position —
   so the grid is built the same way round. */
function renderAntennaTable(rows,allRows){
  const wrap=el("div","ant-wrap");
  const t=el("table","az ant-t");
  const ANT_COLS=antColsFor(allRows||rows);
  const inputs=rows.map(()=>({}));
  const recolorCol=(r,ci)=>{
    let ch=false;
    ANT_COLS.forEach(([g])=>{
      if(String(antGet(r,g)||"").trim()!==String(antOrig(r,g)||"").trim())ch=true;
      if(inputs[ci][g])markInput(inputs[ci][g],antGet(r,g),antOrig(r,g));
    });
    /* 6ew — `ch` is true when ANY field of this position changed, and this used to put the changed class
       on every cell in the column — including its Sec-Pos header, which is why the orange rule appeared
       on all three positions the moment one value moved. A changed position is not a changed cell. Each
       cell is marked by markInput() above, from its own value; only `struck`, which really is a property
       of the whole position, stays column-wide. */
    wrap.querySelectorAll('[data-col="'+ci+'"]').forEach(td=>{
      td.classList.remove("chg");
      td.classList.toggle("struck",!!r.struck);
    });
    refreshAzFoot();
  };
  const hr=el("tr");
  hr.appendChild(el("th","ant-lbl","Field"));
  rows.forEach((r,ci)=>{ const th=el("th","ant-pos"); th.dataset.col=ci;
    th.textContent=String(r.secPos||("#"+(ci+1))); hr.appendChild(th); });
  const thead=el("thead"); thead.appendChild(hr); t.appendChild(thead);
  const tb=el("tbody");
  ANT_COLS.forEach(([f,label])=>{
    const tr=el("tr");
    tr.appendChild(el("th","ant-lbl",label));
    rows.forEach((r,ci)=>{
      const td=el("td"); td.dataset.col=ci;
      const inp=el("input","az-in"); inp.value=antGet(r,f); inputs[ci][f]=inp;
      inp.oninput=()=>{ azBeginEdit(); inp.dataset.edited="1"; antSet(r,f,inp.value);
        /* 6cu — a value you typed is yours: the derived pass never writes over it. */
        if(f==="tipHeight")r._tipEdited=true;
        if(f==="radCenterAsBuilt")r._radAsBuiltEdited=true;
        if(f==="azimuthAsBuilt")r._azAsBuiltEdited=true;
        if(f==="mechDowntiltAsBuilt")r._mdAsBuiltEdited=true;
        if(f==="vendorAsBuilt")r._venAsBuiltEdited=true;
        if(f==="modelAsBuilt")r._modAsBuiltEdited=true;
        if(f==="tipHeightAsBuilt")r._tipAsBuiltEdited=true;
        if(f==="radCenterDesign")r._radDesEdited=true;
        /* 6cs — a model typed here has to be RECORDED, not just written into the row. Without this the
           next syncModels resolved the row back to its printed model and the redline never happened —
           unless Mirror was on, because the mirror pinned `_ownFix` on the way past. Mirror is not a
           prerequisite for editing a model. noteModelEdit does the right thing either way: into the
           shared map when Link is on, onto the row when it is not. */
        if(f==="model")noteModelEdit(String(r._orig_model||""),inp.value,r,"antennaPosition");
        /* 6dl — and the vendor, keyed by Sec-Pos, so it reaches the RF Inventory antenna row here. */
        if(f==="vendor")noteVendorEdit(r,"antennaPosition",r.secPos||r._orig_secPos,
                                       String(r._orig_vendor||""),inp.value);
        /* 6cu — the derived values follow the value you just typed, instead of being frozen at read
           time: a corrected rad centre re-derives the Tip Height (and a stacked model's pair), and the
           Calculated RAD Center on Equipment in Calc follows too. */
        /* 6de — every antenna edit re-derives. The old list named four fields, so correcting a Vendor
           left its As-Built partner behind until something else happened to trigger a pass. */
        if(true){
          const changed=antReDerive(r);
          if(changed)rows.forEach((r2,c2)=>ANT_COLS.forEach(([g])=>{
            if(inputs[c2][g]&&String(inputs[c2][g].value)!==String(antGet(r2,g)))inputs[c2][g].value=antGet(r2,g); }));
        }
        const _pf=antPairFor(r,f);
        if(_pf){ r[_pf]=inp.value;
          if(inputs[ci][_pf]){ inputs[ci][_pf].value=inp.value; inputs[ci][_pf].dataset.edited="1"; } }
        if(antMirrorEdit(allRows||rows,r,f)){
          rows.forEach((r2,c2)=>ANT_COLS.forEach(([g])=>{ if(inputs[c2][g])inputs[c2][g].value=antGet(r2,g); }));
        }
        /* 6dq — and the linked tabs follow THIS keystroke. Only a model or a vendor edit reached
           syncModels before, so a rad centre typed here did not move Equipment in Calc until something
           else happened to trigger a pass — which is what "it does not change in realtime" was. */
        try{ syncModels(); }catch(e){ LOG&&LOG("antenna edit sync:",e&&e.message||String(e)); }
        recolorCol(r,ci);
      };
      td.appendChild(inp); tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  const sr=el("tr"); sr.appendChild(el("th","ant-lbl",""));
  rows.forEach((r,ci)=>{
    const td=el("td"); td.dataset.col=ci;
    const sb=el("button","az-strk"+(r.struck?" on":""),"\u26D4");
    sb.title="Strike this position";
    sb.onclick=()=>{ azBeginEdit(); r.struck=!r.struck; sb.classList.toggle("on",r.struck); recolorCol(r,ci); };
    td.appendChild(sb); sr.appendChild(td);
  });
  tb.appendChild(sr);
  t.appendChild(tb); wrap.appendChild(t);
  rows.forEach((r,ci)=>recolorCol(r,ci));
  return wrap;
}
/* 6cu — everything that is DERIVED from an antenna row, re-derived after an edit. Called from the grid
   so a corrected rad centre updates the tip, the stacked pair and the Equipment in Calc rad centre
   without waiting for a re-analysis. A tip you typed yourself is never overwritten. */
function antReDerive(r){
  if(!r)return 0;
  let n=0;
  /* 6cv — a model corrected TO a stacked one splits its rad centre in two; corrected away from one, the
     pair is dropped back to what the page printed. A pair you typed yourself is left exactly as typed. */
  if(antIsStacked(r.model)){
    if(!antHasPair(r.radCenterDesign)&&!r._radDesEdited){
      const pair=antStackPair(r.radCenterDesign);
      if(pair){ r.radCenterDesign=pair; r._stackPair=true; n++; }
    }
    /* 6cv — the As-Built column follows the Design one for a stacked antenna, always, unless you have
       typed into it yourself. Only filling it when it was empty left a stale pair behind after the rad
       centre was corrected, and the Equipment in Calc figure followed the stale one. */
    if(!r._radAsBuiltEdited&&antHasPair(r.radCenterDesign)&&String(r.radCenterAsBuilt)!==String(r.radCenterDesign)){
      r.radCenterAsBuilt=r.radCenterDesign; n++;
    }
  } else if(r._stackPair){
    r._stackPair=false;
    if(!r._radDesEdited&&String(r.radCenterDesign)!==String(r._orig_radCenterDesign||"")){
      r.radCenterDesign=String(r._orig_radCenterDesign||""); n++;
    }
  }
  /* 6da — and the As-Built columns follow Design here too, not only at read time: correct a Design value
     and its As-Built partner moves with it unless you have typed into that partner yourself. */
  /* 6fu — THE GUARD 6dd ADDED FOR THREE OF THESE APPLIES TO ALL SIX, and not sweeping it is the same
     mistake this project has now made four times: a fault is found, fixed where it was found, and left
     everywhere else. 6dd gave vendor, model and tip height `onlyIfPrinted` because a form that does not
     print their As-Built row has nothing for the derived value to live in. Rad centre, azimuth and
     downtilt never got it, and it did not show until 6fu offered the As-Built columns on a no-split
     form: the derive filled all three from their Design partners, and Apply then stamped a copy of
     every design figure beside itself — eleven marks on a row nobody had corrected. */
  [["radCenterAsBuilt","radCenterDesign","_radAsBuiltEdited",1],
   ["azimuthAsBuilt","azimuthDesign","_azAsBuiltEdited",1],
   ["mechDowntiltAsBuilt","mechDowntiltDesign","_mdAsBuiltEdited",1],
   ["vendorAsBuilt","vendor","_venAsBuiltEdited",1],
   ["modelAsBuilt","model","_modAsBuiltEdited",1],
   ["tipHeightAsBuilt","tipHeight","_tipAsBuiltEdited",1]].forEach(([ab,des,flag,onlyIfPrinted])=>{
    if(onlyIfPrinted&&!(r._gf&&r._gf[ab]))return;      // 6dd/6fu — only where the page prints the row
    if(r[flag])return;                                                  // you typed it — it is yours
    const dv=String(r[des]==null?"":r[des]).trim(); if(!dv)return;
    if(ab==="radCenterAsBuilt"&&antHasPair(r.radCenterDesign))return;   // the stacked pair is handled above
    /* 6db — no test, no heuristic: the As-Built follows the Design value. */
    if(String(r[ab])!==dv){ r[ab]=dv; n++; }
  });
  /* the tip follows whatever the rad centre now says — one value or two */
  const tipCell=antTipCell(r,r.radCenterDesign);
  if(tipCell&&!r._tipEdited){
    const printed=String(r._orig_tipHeight||"").trim();
    const pp=antParts(printed), cp=antParts(tipCell);
    const far=(pp.length!==cp.length)||cp.some((c,i)=>{
      const a2=parseFloat(String(pp[i]||"").replace(/[^0-9.\-]/g,""));
      return !isFinite(a2)||Math.abs(a2-parseFloat(c))>ANT_TIP_TOL;
    });
    const want=(!printed||far)?tipCell:printed;
    if(String(r.tipHeight)!==want){ r.tipHeight=want; n++; }
  }
  /* 6dq — the rad-centre follow is a whole-table pass now, run once from syncModels after every row
     has re-derived, instead of once per row from in here. */
  return n;
}
/* 6cu — "Calculated RAD Center" on the printed Equipment in Calc table follows the antenna it belongs
   to. Matched by Sec-Pos where that table prints one, otherwise by model. Only ever driven by a rad
   centre you have CHANGED, so a freshly read document is never touched.
   6dq — REWRITTEN as one pass over the table instead of one write per antenna row. The old shape was
   "for each antenna, push its value at whatever matches", which had three faults you could feel:

     · it only ever wrote. Change a rad centre, then change it back, and Equipment in Calc kept the
       first value — nothing put it back, because the push only fired while the two differed.
     · when several antennas share one Equipment in Calc row (that table lists a model ONCE, with a
       quantity), whichever antenna happened to be visited last won. The same edit could settle on a
       different answer depending on row order.
     · it ran only inside syncModels, and a rad-centre keystroke never called syncModels — only a model
       or vendor edit did. So the value moved when you later touched something else, which is exactly
       "sometimes it does not change in realtime".

   Deciding each Equipment in Calc row FROM the antennas — rather than pushing at it — fixes all three:
   it is idempotent, it is order-independent, and reverting an edit reverts the follow. */
function ecRadFollowAntenna(){
  const A=S.analysis, T=A&&A.ecTable;
  if(!T||!T.columns||!T.rows||!T.rows.length)return 0;
  const rc=T.columns.find(c=>/calc\w*\s*rad/i.test(String(c))) ||
           T.columns.find(c=>/rad\s*cent/i.test(String(c)));
  if(!rc)return 0;
  const linked=ecLinked();
  const sp=T.columns.find(c=>/sec\W*pos/i.test(String(c)));
  const mc=rfModelCol(T.columns);
  /* every antenna whose rad centre you have CHANGED, keyed the two ways the table can be matched.
     An antenna still carrying what its own page printed is not a correction and drives nothing. */
  const byPos=new Map(), byModel=new Map();
  ["antennaPosition","antennaExisting","antennaDecom"].forEach(k=>(A[k]||[]).forEach(r=>{
    if(r.struck)return;
    const now=String((r._stackPair?r.radCenterAsBuilt:r.radCenterDesign)||"").trim();
    /* 6dq — what this row PRINTED, as the reader left it. A stacked model has its single printed rad
       centre expanded into a ±2ft pair at read time by the tool itself, so `_orig_radCenterDesign` (the
       single figure) never matches and every stacked antenna looked permanently edited — which pushed a
       pair into Equipment in Calc the moment a document was opened, before anyone had typed anything.
       The baseline for those rows is the pair the reader would derive, not the figure on the page. */
    const wasRaw=String(r._orig_radCenterDesign||"").trim();
    let was=wasRaw;
    if(r._stackPair&&wasRaw&&!antHasPair(wasRaw)){ try{ was=antStackPair(wasRaw)||wasRaw; }catch(e){} }
    if(!now||now===was)return;
    const pos=normSecPos(r.secPos||r._orig_secPos);
    if(pos)byPos.set(pos,now);
    const mk=normModelKey(r.model||r._orig_model);
    if(mk){ const m=byModel.get(mk)||new Map(); m.set(now,(m.get(now)||0)+1); byModel.set(mk,m); }
  }));
  let n=0,conflict=0;
  T.rows.forEach(row=>{
    if(row.inserted||row.struck)return;
    if(row._edited&&row._edited[rc])return;            // a value you typed here is yours
    if(sgHas(row,rc))return;                           // a suggestion is a proposal, not a link's doing
    const printed=(row._orig&&row._orig[rc]!=null)?String(row._orig[rc]):null;
    if(printed==null)return;
    let want=printed;
    if(linked){
      let v=null;
      if(sp){ const p=normSecPos(row.cells[sp]); if(p&&byPos.has(p))v=byPos.get(p); }
      if(v==null&&mc){
        const m=byModel.get(normModelKey(row.cells[mc]));
        if(m&&m.size){
          /* one row, several antennas: take the value most of them agree on, and say so when they
             do not — silently picking one of two different rad centres is how a wrong figure gets
             exported without anybody seeing it happen */
          const rank=[...m.entries()].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0])));
          v=rank[0][0];
          if(rank.length>1)conflict++;
        }
      }
      if(v!=null)want=v;
    }
    if(String(row.cells[rc]||"")!==String(want)){
      row.cells[rc]=want;
      if(String(want)!==String(printed))row._fromAntenna=true; else delete row._fromAntenna;
      n++;
    }
  });
  if(n)LOG("Equipment in Calc: ["+rc+"] followed Antenna Position on "+n+" row(s)"+
           (linked?"":" — link is off, so back to the printed figures"));
  if(conflict)LOG("⚠ Equipment in Calc: "+conflict+" row(s) cover antennas with DIFFERENT rad centres — "+
                  "the one most of them share was used. Check those rows.");
  return n;
}
/* kept for callers that still hand in a single antenna row; the pass above is what decides */
function ecRadFromAntenna(){ return ecRadFollowAntenna(); }
/* sector of an antenna row, from its Sec-Pos (A-1 -> A) */
function antRowSector(r){
  const v=String((r&&(r._orig_secPos||r.secPos))||"").trim();
  const m=v.match(/^([A-Fa-f])\s*[-_ ]?\s*\d*/);
  return m?m[1].toUpperCase():"—";
}
let _antMirror=true;        // 6ek: on by default
/* Mirror an antenna measurement to the same position in the other sectors (A-1 -> B-1, C-1 …).
   Deliberately limited to Rad Center, Tip Height and Mechanical Downtilt: vendor, model and Sec-Pos are
   per-position values and must never be copied across. */
/* Model and vendor mirror too: the same antenna position in another sector normally carries the same
   hardware, so correcting one should correct its siblings. Sector and Sec-Pos never mirror — those are
   what identify the row. */
const ANT_MIRROR_FIELDS=new Set(["radCenterDesign","radCenterAsBuilt","tipHeight","tipHeightAsBuilt",
                                 "azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt",
                                 "model","modelAsBuilt","vendor","vendorAsBuilt"]);
function antPosNum(r){
  const v=String((r&&(r._orig_secPos||r.secPos))||"").trim();
  const m=v.match(/^[A-Za-z]\s*[-_ ]?\s*(\d+)/);
  return m?m[1]:null;
}
/* 6ev — AZIMUTH IS THE EXCEPTION, AND IT GOES THE OTHER WAY. Every other mirrored measurement follows the
   same POSITION into the other sectors (A-1 -> B-1, C-1): a rad centre or a downtilt is a property of the
   mounting height, which the sectors share. An azimuth is not — it is the direction that sector points, so
   copying A-1's azimuth into B-1 and C-1 is the one mirror that is always wrong. What antennas DO share is
   the azimuth of the sector they are in: A-1, A-2 and A-3 nearly always point the same way. So for the two
   azimuth fields the mirror runs WITHIN the sector, across its own positions, and never leaves it. */
const ANT_MIRROR_IN_SECTOR=new Set(["azimuthDesign","azimuthAsBuilt"]);
function antMirrorEdit(rows,src,field){
  if(!_antMirror)return 0;
  if(!ANT_MIRROR_FIELDS.has(field))return 0;
  const inSector=ANT_MIRROR_IN_SECTOR.has(field);
  const sec=antRowSector(src);
  const pos=antPosNum(src);
  /* an azimuth needs a sector to stay inside; everything else needs a position to follow */
  if(inSector ? (!sec||sec==="—") : !pos)return 0;
  /* Pin the SOURCE too. Only the copies were pinned, so if the edit reached the row by any route other
     than the model field it was pulled back to the printed value on the next sync while its mirrors kept
     the correction — the two then disagreed. */
  if(field==="model"){
    noteMirroredModel(src,String(src._orig_model!=null?src._orig_model:src.model||""),src.model,
                      "antennaPosition");
  }
  /* 6ef — WHO OWNS THE MIRRORED VALUE. A copy that nothing owns does not survive the rest of the
     keystroke: `syncVendors()` (reached from the syncModels() the edit handler calls) re-resolves every
     antenna row's vendor from authority, and `antReDerive()` recomputes tip and the as-built columns from
     their design partners. Neither has any notion of "a mirror put this here", so both put the sibling
     straight back to what the page printed — measured, per keystroke:
         antMirrorEdit  COMMSCOPE -> ZZVEND      (the mirror copies)
         syncVendors    ZZVEND    -> COMMSCOPE   (and the resolve takes it back)
     Model was the only field that survived, because it alone was pinned below. So the mirrored row gets
     the SAME ownership record the row you typed into gets — the flags the edit handler sets, and for the
     vendor the same noteVendorEdit call — and it is set BEFORE the derive, or the derive in this same
     pass still wins. */
  const OWN_FLAG={tipHeight:"_tipEdited", radCenterAsBuilt:"_radAsBuiltEdited",
                  azimuthAsBuilt:"_azAsBuiltEdited", mechDowntiltAsBuilt:"_mdAsBuiltEdited",
                  vendorAsBuilt:"_venAsBuiltEdited", modelAsBuilt:"_modAsBuiltEdited",
                  tipHeightAsBuilt:"_tipAsBuiltEdited", radCenterDesign:"_radDesEdited"};
  /* 6ef — read the source value ONCE. It used to be re-read as src[field] on every sibling, which is
     only safe while nothing can change it mid-loop; recording a vendor can, and did. */
  const VAL=src[field];
  if(field==="vendor")try{ noteVendorEdit(src,"antennaPosition",src.secPos||src._orig_secPos,
                                          String(src._orig_vendor||""),String(VAL==null?"":VAL),true); }catch(e){}
  let n=0; const reached=[];
  (rows||[]).forEach(r=>{ if(r===src)return;
    if(inSector){
      if(antRowSector(r)!==sec)return;                 // 6ev: this sector's other positions, nothing else
    }else{
      if(antPosNum(r)!==pos)return;
      if(antRowSector(r)===antRowSector(src))return;   // the same position in the OTHER sectors
    }
    if(String(r[field])!==String(VAL)){ r[field]=VAL; n++; }
    const pair=antPairFor(r,field);
    if(pair&&String(r[pair])!==String(VAL)){ r[pair]=VAL; n++; }
    reached.push(String(r.secPos||r._orig_secPos||("sector "+antRowSector(r))));
    if(OWN_FLAG[field])r[OWN_FLAG[field]]=true;
    /* the vendor's authority is a map keyed by Sec-Pos, not a flag — so record it the way the edit
       handler does, which also keeps Link's behaviour identical for a mirrored value and a typed one. */
    if(field==="vendor")try{ noteVendorEdit(r,"antennaPosition",r.secPos||r._orig_secPos,
                                            String(r._orig_vendor||""),String(VAL==null?"":VAL),true); }catch(e){}
    /* 6de — and everything DERIVED from what just arrived follows it on the mirrored row too: the tip
       from the rad centre, the as-built columns from their design partners. Copying the one field and
       stopping is how a mirrored sector ended up with a corrected Vendor (Design) and an untouched
       Vendor (As-Built). */
    try{ n+=antReDerive(r); }catch(e){}
    /* A mirrored MODEL must survive the next sync, which would otherwise pull the row back to its printed
       value — pin it on the row, the same way the Design Summary mirror does. */
    if(field==="model"){
      noteMirroredModel(r,String(r._orig_model!=null?r._orig_model:r.model||""),src.model,
                        "antennaPosition");
    }
  });
  /* one re-resolve, after every mirrored row has been recorded */
  if(field==="vendor")try{ syncVendors(); }catch(e){}
  /* 6ek — the same for a model: each mirrored row recorded the correction under its own sector's key, so
     resolving now is what carries it to that sector's Design Summary and RF Inventory rows. */
  if(n&&field==="model")try{ syncModels(); }catch(e){}
  /* 6ef — name the rows it reached. Only one sector's columns are on screen at a time, so a mirrored
     value lands somewhere the user cannot see; with no line saying so, a working mirror and a broken one
     look exactly the same from the page. */
  if(n)LOG("Mirror (Antenna):",field,"→",src[field],"copied to",
           (reached.length?reached.join(", "):n+" cell(s)"),
           inSector?("— within sector "+sec):("— position "+pos));
  return n;
}
function renderAntennaPane(){
  const A=S.analysis||{};
  const cats=[["final","Final",A.antennaPosition||[]],["existing","Existing",A.antennaExisting||[]],["decom","Decommissioned",A.antennaDecom||[]]];
  const avail=cats.filter(c=>c[2].length);
  const p=el("div","az-pane active");
  if(!avail.length){ p.appendChild(el("div","az-empty","No Antenna Position Details rows detected. Try Re-analyze.")); return p; }
  if(!avail.find(c=>c[0]===_antSub)) _antSub=avail[0][0];
  const bar=el("div","az-tabs sub"); bar.style.cssText="padding:0;margin-bottom:10px";  /* 6fk — the rule
     that was inline here could not be reached by the emboss: an inline style beats every selector.
     `.az-tabs.sub` draws it as a groove instead. */
  avail.forEach(([k,lbl,rows])=>{ const b=el("button","az-tab"+(k===_antSub?" active":""),lbl+" ("+rows.length+")"); b.onclick=()=>{ _antSub=k; renderAnalyze(); }; bar.appendChild(b); });
  p.appendChild(bar);
  const active=avail.find(c=>c[0]===_antSub);
  const antKey=active[0]==="existing"?"antennaExisting":(active[0]==="decom"?"antennaDecom":"antennaPosition");
  p.appendChild(redlineToggleEl(antKey));
  // sector sub-tabs, read from each row's Sec-Pos
  const rows=active[2];
  const groups={}; rows.forEach(r=>{ const s=antRowSector(r); (groups[s]=groups[s]||[]).push(r); });
  const sectors=Object.keys(groups).sort((a,b)=>sectorRank(a)-sectorRank(b));
  const counts={}; sectors.forEach(s=>counts[s]=groups[s].length);
  if(sectors.indexOf(_antSecSub)<0) _antSecSub=sectors[0];
  if(sectors.length>1) p.appendChild(sectorTabBar(sectors,_antSecSub,s=>{ _antSecSub=s; renderAnalyze(); },counts));
  /* 6fw — the caption bar is gone. Ced: "in antenna position, i do not see the purpose of the box
     below the alpha beta gamma, just remove that in the UI." He is right that it says nothing the
     screen has not already said: the tab above reads ANTENNA POSITION, the sub-tab above that reads
     Final or Existing, and the chip beside it is lit and reads ALPHA (A). Three statements of the same
     fact, one of them a full-width tinted band. RF Inventory still has the identical bar — left alone
     because it was not what was asked for, and one line away if it should go too. */
  p.appendChild(antRowToggleBar(active[2]));
  const mrow=el("label","az-secn"); mrow.style.cssText="display:flex;align-items:center;gap:7px;cursor:pointer;margin:0 0 9px";
  const mcb=el("input"); mcb.type="checkbox"; mcb.checked=_antMirror; mcb.style.cssText="width:auto;margin:0";
  /* an icon toggle beside the checkbox, matching the lane icons elsewhere; both drive _antMirror */
  /* No second mirror here — the lane icon at the top is the only one and it acts on this tab. Two
     controls for one flag meant the state you saw depended on which you had touched last. */
  mcb.onchange=()=>{ _antMirror=mcb.checked; };
  /* the icon is the control; the checkbox stays as the state holder but is not shown */
  mrow.style.display="none";
  mrow.appendChild(mcb);
  p.appendChild(mrow);
  p.appendChild(el("div","az-secn","As-Built prefills from Design; changing a Design value updates its As-Built. Orange = pending redline, red = your edit. ⛔ strikes the row."));
  p.appendChild(renderAntennaTable(groups[_antSecSub]||[],rows));
  return p;
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
/* --- transposed Antenna Position table: fields are rows, positions (B-1,B-2…) are columns --- */
const ANT_ROW={
  secPos:{base:["sec-pos","secpos"],idx:0},
  vendor:{base:["vendor"],idx:0},
  vendorAsBuilt:{base:["vendor"],idx:1},
  model:{base:["model"],idx:0},
  modelAsBuilt:{base:["model"],idx:1},
  radCenterDesign:{base:["radcenter"],idx:0},
  radCenterAsBuilt:{base:["radcenter"],idx:1},
  tipHeight:{base:["tipheight"],idx:0},
  tipHeightAsBuilt:{base:["tipheight"],idx:1},
  azimuthDesign:{base:["azimuth"],idx:0},
  azimuthAsBuilt:{base:["azimuth"],idx:1},
  mechDowntiltDesign:{base:["mechanicaldowntilt","downtilt"],idx:0},
  mechDowntiltAsBuilt:{base:["mechanicaldowntilt","downtilt"],idx:1},
};
/* 6fu — how many rows the PAGE prints for this field. `antFieldRow` falls back to matches[0] when the
   as-built line does not exist, which is what silently stamped an as-built correction on top of the
   design value; the count is what tells the two situations apart. */
function antFieldRowCount(pi,cfg){
  if(!cfg)return 0;
  return pageLines(pi).filter(ln=>cfg.base.some(b=>ln.norm.includes(b))).length;
}
/* the space just right of a printed value, inside its own column. 0.050 keeps it inside the column
   (the columns on these forms are 0.122 apart and antCellAt allows 0.055 either side of centre). */
const ANT_BESIDE_GAP=0.004;
function antBesideBox(cell,colX){
  if(!cell||colX==null)return null;
  const left=cell.nx+(cell.nw||0)+ANT_BESIDE_GAP;
  const right=colX+0.050;
  if(right-left<0.014)return null;                 // no room beside it; the caller says so rather than
  return {nx:left, ny:cell.ny, nw:right-left,      // stamping on top of the printed figure
          nh:cell.nh||0.0134, str:""};
}
function antFieldRow(pi,cfg){
  if(!cfg)return null;
  const lines=pageLines(pi);
  const matches=lines.filter(ln=>cfg.base.some(b=>ln.norm.includes(b)));
  return matches[cfg.idx]||matches[0]||null;
}
/* column center-x of a position header (e.g. "B-1") */
function antColX(pi,secPosVal){
  const it=findOnPage(pi,String(secPosVal));
  return it? (it.nx+(it.nw||0)/2) : null;
}
/* the value cell for a field: nearest page item to (column-x, field-row-y). Tolerant of labels
   that wrap to two lines (e.g. "Mechanical Downtilt" / "(As-Built)"), where the value sits
   vertically centered across both lines rather than on the label's exact text line. */
function antCellAt(pi,colX,labelY){
  if(colX==null||labelY==null)return null;
  let best=null,bd=1e9;
  S.pages[pi].items.forEach(t=>{
    const cx=t.nx+(t.nw||0)/2; if(cx<=0.135)return;          // skip the left label column
    const dx=Math.abs(cx-colX); if(dx>0.055)return;          // must be in this position's column
    const dy=Math.abs((t.ny+t.nh/2)-labelY); if(dy>0.05)return; // must be on this field's row band
    const score=dy+dx*0.2; if(score<bd){ bd=score; best=t; }
  });
  return best;
}
/* find an equipment model. Gather EXACT cell matches across the whole doc first,
   then prefer ones on the section's pages — so a summary copy on page 1 can't win
   over the real row in the section. Falls back to line-span for split models. */
function locateModel(preferList,model){
  const nn=String(model||"").replace(/\s+/g,"").toLowerCase(); if(nn.length<2)return null;
  const prefSet=new Set((preferList||[]).filter(p=>typeof p==="number"&&p>=0));
  const exact=[];
  for(let pi=0;pi<S.pages.length;pi++){ if(S.pages[pi].locked)continue; const it=findOnPage(pi,model); if(it)exact.push({pi,it}); }
  if(exact.length){
    const preferred=exact.filter(e=>prefSet.has(e.pi));
    const pick=preferred.length?preferred[0]:exact[0];
    return {pi:pick.pi,it:pick.it,line:rowBandItems(pick.pi,pick.it)};
  }
  if(nn.length>=4){
    const order=[...prefSet]; for(let i=0;i<S.pages.length;i++) if(!prefSet.has(i)) order.push(i);
    for(const pi of order){ if(!S.pages[pi]||S.pages[pi].locked)continue;
      for(const ln of pageLines(pi)){ if(ln.norm.includes(nn)){
        const anchor=ln.items.find(t=>{ const s=t.str.replace(/\s+/g,"").toLowerCase(); return s.length>1&&(nn.startsWith(s)||s.startsWith(nn.slice(0,3))); })||ln.items[0];
        return {pi,it:anchor,line:ln.items};
      } }
    }
  }
  return null;
}
/* overlay Existing / Removal / Addition / Final on the last 4 numeric cells of a row */
function redlineCountCols(pi,lineItems,vals){
  const nums=(lineItems||[]).filter(t=>/^\d+$/.test(t.str.trim()));
  const order=["existing","removal","addition","final"];
  let applied=0;
  if(nums.length>=4){ nums.slice(-4).forEach((cell,idx)=>{ const nv=String(vals[order[idx]]); if(cell.str.trim()!==nv){ addText(pi,cell.nx,cell.ny,nv,{cell,auto:true}); applied++; } }); }
  else if(nums.length){ const cell=nums[nums.length-1]; const nv=String(vals.final); if(cell.str.trim()!==nv){ addText(pi,cell.nx,cell.ny,nv,{cell,auto:true}); applied++; } }
  return applied;
}
/* union two row lists by sector+model, keeping the SAME object references (shared editing) */
function mergeRows(primary,extra){
  const key=r=>((r.sector||"").trim().toLowerCase())+"|"+String(r.origModel||r.model||"").replace(/\s+/g,"").toLowerCase();
  const seen=new Set((primary||[]).map(key)); const out=(primary||[]).slice();
  (extra||[]).forEach(r=>{ const k=key(r); if(!seen.has(k)){ seen.add(k); out.push(r); } });
  return out;
}
/* every exact match for a model within a set of pages (so counts redline on every table that lists it) */
function locateAll(pageList,model){
  const res=[]; const set=new Set((pageList||[]).filter(p=>typeof p==="number"&&p>=0));
  for(const pi of set){ if(!S.pages[pi]||S.pages[pi].locked)continue; const it=findOnPage(pi,model); if(it)res.push({pi,it,line:rowBandItems(pi,it)}); }
  return res;
}
/* find a printed value on a page, preferring the item nearest a given y (for row-scoped antenna edits) */
function findValueNear(pi,needle,ny){
  const n=String(needle).trim(); if(!n)return null;
  const norm=s=>s.replace(/\s+/g,"").toLowerCase(); const nn=norm(n);
  let cands=S.pages[pi].items.filter(t=>t.str.trim()===n);
  if(!cands.length) cands=S.pages[pi].items.filter(t=>norm(t.str)===nn);
  if(!cands.length&&nn.length>=3) cands=S.pages[pi].items.filter(t=>norm(t.str).includes(nn));
  if(!cands.length)return null;
  if(ny==null)return cands[0];
  cands.sort((a,b)=>Math.abs(a.ny-ny)-Math.abs(b.ny-ny));
  return cands[0];
}
let _azApplying=false, _azApplyMode="add";
function clearAnalyzeRedlines(scopeSet){
  S.annos=S.annos.filter(a=>!(a.fromAnalyze && (!scopeSet||scopeSet.has(a.page))));
  S.lines=S.lines.filter(l=>!(l.fromAnalyze && (!scopeSet||scopeSet.has(l.page))));
}
function applyAnalysis(mode,onlyKey){
  if(!S.analysis){ setStatus("Run Analyze RFDS first.",true); return; }
  mode=mode||"add"; _azApplyMode=mode;
  _azHandHeld=0;      /* 6ev — cells left alone because a redline of yours was already on them */
  /* 6cj — one undo step for the whole run. `pushHistory` was called once here, but every addText and
     addLine inside pushed its own entry as well, so undoing a 31-mark apply meant pressing Ctrl+Z 31
     times. `_histBatch` already exists for exactly this; the batch is closed in the finally below. */
  pushHistory();
  _histBatch++;
  let applied=0, missed=0, firstPi=null; const A=S.analysis; const PF=A.pagesFor||{};
  const _rep={};
  const mark=(k,ok)=>{ (_rep[k]=_rep[k]||{applied:0,missed:0})[ok?"applied":"missed"]++; };
  if(mode==="replace"){
    /* 6ca: "Replace -> this tab" cleared every analyze redline on the tab's PAGES, and sections share
       pages — RFDS Details and Site Details both live on page one by design (see detectSections). So
       replacing one wiped the other and only re-stamped the one. Restrict the clear to pages this tab
       does not share with another section, and say so when pages are held back. */
    let pset=null;
    if(onlyKey){
      const mine=PF[onlyKey]||[];
      const others=new Set();
      Object.keys(PF).forEach(k=>{ if(k!==onlyKey)(PF[k]||[]).forEach(p=>others.add(p)); });
      const solo=mine.filter(p=>!others.has(p)), shared=mine.filter(p=>others.has(p));
      if(shared.length)LOG("Replace ["+onlyKey+"]: page(s) "+shared.map(p=>p+1).join(", ")+
        " are shared with another section — leaving their redlines alone rather than clearing someone else's work.");
      pset=new Set(solo);
    }
    clearAnalyzeRedlines(pset);
  }
  _azApplying=true;
  carryRfInsertsToDs(); syncModels();
  try{
    // ---- Design Summary: three co-dependent tables ----
    const dsPages=PF.designSummary||[];
    const dsT=buildDsTables(dsPages);
    const typeKey=t=>String(typeGroup(t)||"").replace(/\s+/g,"").toLowerCase();
    // 1) By-Sector detail — matched by sector + model, placed with the detail table's own columns
    (A.designSummary||[]).forEach(r=>{
      if(_skipRedline.has("designSummary")||(onlyKey&&onlyKey!=="designSummary"))return;
      /* An RF Inventory insert RAISES this count in the grid so the two tabs stay consistent, but it is
         not written onto the Design Summary page — that placement was unreliable. The link is
         informational; redline the Design Summary yourself if the page needs it. */
      if(r._fromRf||(r._rfAdds&&!dsRowUserChanged(r)))return;
      if(r.inserted){ const res=placeInsertedDsRow(r,dsT); applied+=res.applied; missed+=res.missed;
        for(let q=0;q<res.applied;q++)mark("DSInsertedRows",true); for(let q=0;q<res.missed;q++)mark("DSInsertedRows",false);
        if(res.pi!=null&&firstPi==null)firstPi=res.pi; return; }
      const d=rowCounts(r);
      const modelChanged=r.model&&r.origModel&&r.model!==r.origModel;
      const typeChanged=canonType(r.type)!==canonType(r.origType||r.type);
      if(!dsRowUserChanged(r)) return;   // only redline what the user actually changed
      const mk=normModelKey(r.origModel||r.model);
      const sec=normSector(r.origSector!=null?r.origSector:r.sector);      // find the PRINTED row
      const M=r.origModel||r.model;
      /* stored geometry first — no text matching needed */
      if(r._g&&(r._g.existing||r._g.final)&&typeof r._page==="number"){
        const pi=r._page, G=r._g;
        const fallbackY=(G.final||G.existing||G.model||{}).ny;
        const colFallback={existing:G.existing,removal:G.removal,addition:G.addition,final:G.final};
        const put=(g2,v,al,label)=>{
          if(!g2){
            /* no stored position for this cell: interpolate from the row's other count cells rather
               than dropping the redline silently (this is the "missing one" case) */
            const order=["existing","removal","addition","final"];
            const pts=order.map((k,i)=>({i,g:colFallback[k]})).filter(x=>x.g);
            const idx=order.indexOf(label);
            if(fallbackY!=null&&pts.length>=2&&idx>=0){
              const a0=pts[0], a1=pts[pts.length-1];
              const step=(a1.g.nx-a0.g.nx)/Math.max(1,(a1.i-a0.i));
              const nx=a0.g.nx+step*(idx-a0.i);          // index-aware, so it cannot land on a neighbour
              putLeftAt(pi,Math.max(0,nx),fallbackY,String(v));
              LOG("Analyze DS: no stored cell for",label,"— placed at interpolated column x",nx.toFixed(4));
              return 1;
            }
            LOG("Analyze DS: could not place",label,"=",v); missed++; return 0;
          }
          if((al||"left")==="center"){
            /* model / type / sector are one value per cell: stamp the whole cell as one block */
            stampWholeCell(pi,g2,v,"center");
            LOG("Analyze DS whole cell "+(g2.lines||1)+" line(s) →",v);
            return 1;
          }
          const it=pageItemAt(pi,g2);
          if(it){ if(String(it.str).trim()===String(v))return 0; addText(pi,it.nx,it.ny,String(v),{cell:it,align:al||"left"}); }
          else putLeftAt(pi,g2.nx,g2.ny,String(v));
          return 1; };
        if(r.struck){ const it=G.model?pageItemAt(pi,G.model):null; if(it){ strikeRow(pi,it); applied++; } }
        else{
          if(modelChanged) applied+=put(G.model,r.model,"center");        // text is centred
          if(typeChanged) applied+=put(G.type,canonType(r.type),"center");
          if(sectorChanged(r)){
            /* only write the sector when the printed cell really holds the sector we read — otherwise a
               mis-mapped row would stamp its letter onto someone else's line */
            const sIt=G.sector?pageItemAt(pi,G.sector):null;
            const printedSec=sIt?normSector(sIt.str):null;
            if(printedSec&&printedSec===normSector(r.origSector)) applied+=put(G.sector,sectorOut(r),"center");
            else { missed++; LOG("Analyze DS: sector cell does not match this row — not stamping",
                     sectorOut(r),"(printed:",printedSec,")"); }
          }
        }
        ["existing","removal","addition","final"].forEach(k=>{ applied+=put(G[k],String(d[k]),"left",k); });
        if(firstPi==null)firstPi=pi;
        mark("DesignSummary",true);
        LOG("Analyze DS detail (stored position):",sec,M,d,"page",pi+1);
        return;
      }
      const row=dsT.detail.rows.find(x=>dsRowMatchesModel(x,M)&&dsRowSec(x)===sec)
             || dsT.detail.rows.find(x=>dsRowMatchesModel(x,M));
      if(!row){ missed++; LOG("Analyze DS detail not located:",sec,r.origModel||r.model); return; }
      const it=row.items.find(t=>{const s=normModelKey(t.str); return s.length>2 && mk.indexOf(s)>=0;}) || row.items.find(t=>t.nx>0.18) || row.items[0];
      if(r.struck){ strikeRow(row.pi,it); applied++; applied+=placeCountsInRow(row.pi,row.items,d,false,dsT.detail.cols); }
      else {
        if(modelChanged){ addText(row.pi,it.nx,it.ny,r.model,{cell:it}); applied++; }
        if(typeChanged){ if(placeTextAtCol(row.pi,row.items,dsT.detail.cols&&dsT.detail.cols.type,r.type))applied++; }
        if(sectorChanged(r)){
          if(placeTextAtCol(row.pi,row.items,dsT.detail.cols&&dsT.detail.cols.sector,sectorOut(r)))applied++;
        }
        applied+=placeCountsInRow(row.pi,row.items,d,false,dsT.detail.cols);
      }
      if(firstPi==null)firstPi=row.pi;
      mark("DesignSummary",true); LOG("Analyze DS detail:",sec,r.origModel||r.model,d,"page",row.pi+1);
    });
    /* Item 3: an inserted RF row raises the Design Summary count in the grid for consistency, but
       nothing RF-derived is written onto the Design Summary page — including its derived summaries. */
    const dsForApply=(A.designSummary||[]).map(r=>r._rfAdds?Object.assign({},r,{after:int(r.after)-int(r._rfAdds),_rfAdds:0}):r);
    // 2) Summary by Sector (derived by TYPE) — matched by sector + type
    deriveSummaryBySector(dsForApply).forEach(o=>{
      if(_skipRedline.has("designSummary")||(onlyKey&&onlyKey!=="designSummary"))return;
      /* Do NOT skip a row just because its derived totals show no activity: the PAGE may still print
         something else. Gamma's SQUID derived 1/0/0/1 while the page printed 1/1/1/1, and this guard
         stopped the correction ever being made. placeCountsInRow already leaves identical cells alone. */
      const aliases=typeAliases(o.type), sec=normSector(o.sector);
      const SG=A._dsGeo&&A._dsGeo.bySector&&A._dsGeo.bySector[sec+"|"+canonType(o.type)];
      if(SG){ let n=0;
        ["existing","removal","addition","final"].forEach(k=>{ const g2=SG[k]; if(!g2)return;
          const it=pageItemAt(SG.pi,g2);
          if(it&&String(it.str).trim()!==String(o[k])){
            /* One rule for every Design Summary table: the same call, and the same length rule — a single
               digit sits flush on the printed one, two or more centre in the cell. This used to force
               `align:center` and set `alignUser`, which pinned it and left the summary tables looking
               differently spaced from the detail grid above them. */
            const id=addText(SG.pi,it.nx,it.ny,String(o[k]),{cell:it});
            const m=S.annos.find(z=>z.id===id);
            if(m){ delete m.alignUser; fitCellBox(m); }
            n++;
          }
          else if(!it){
            /* no printed run in that cell — place it on the cell box with the same rule, rather than as a
               free mark centred by hand */
            putRowCell(SG.pi,g2.nx,cellBoxWidth(g2),g2.ny,String(o[k]),g2.nh||0.011);
            n++;
          } });
        if(n){ applied+=n; if(firstPi==null)firstPi=SG.pi; mark("DesignSummary",true);
          LOG("Analyze DS by-sector (stored position):",sec,o.type,o); }
        return; }
      const row=dsT.bySector.rows.find(x=>aliases.some(al=>x.norm.includes(al))&&dsRowSec(x)===sec);
      if(row){ const n=placeCountsInRow(row.pi,row.items,o,false,dsT.bySector.cols); if(n){ applied+=n; if(firstPi==null)firstPi=row.pi; LOG("Analyze DS by-sector:",sec,o.type,o,"page",row.pi+1); } }
      else LOG("Analyze DS by-sector not located:",sec,o.type);
    });
    // 3) Summary by Site (derived by TYPE across all sectors) — matched by type
    deriveSummaryBySite(dsForApply).forEach(o=>{
      if(_skipRedline.has("designSummary")||(onlyKey&&onlyKey!=="designSummary"))return;
      /* Do NOT skip a row just because its derived totals show no activity: the PAGE may still print
         something else. Gamma's SQUID derived 1/0/0/1 while the page printed 1/1/1/1, and this guard
         stopped the correction ever being made. placeCountsInRow already leaves identical cells alone. */
      const aliases=typeAliases(o.type);
      const TG=A._dsGeo&&A._dsGeo.bySite&&A._dsGeo.bySite[canonType(o.type)];
      if(TG){ let n=0;
        ["existing","removal","addition","final"].forEach(k=>{ const g2=TG[k]; if(!g2)return;
          const it=pageItemAt(TG.pi,g2);
          if(it&&String(it.str).trim()!==String(o[k])){ addText(TG.pi,it.nx,it.ny,String(o[k]),{cell:it,align:"left"}); n++; }
          else if(!it){ putLeftAt(TG.pi,g2.nx,g2.ny,String(o[k])); n++; } });
        if(n){ applied+=n; if(firstPi==null)firstPi=TG.pi; mark("DesignSummary",true);
          LOG("Analyze DS by-site (stored position):",o.type,o); }
        return; }
      const row=dsT.bySite.rows.find(x=>aliases.some(al=>x.norm.includes(al)));
      if(row){ const n=placeCountsInRow(row.pi,row.items,o,true,dsT.bySite.cols); if(n){ applied+=n; if(firstPi==null)firstPi=row.pi; LOG("Analyze DS by-site:",o.type,o,"page",row.pi+1); } }
      else LOG("Analyze DS by-site not located:",o.type);
    });
    /* 6cg — Port Level Details: stamp the Antenna Position model over any port row that disagrees.
       Antenna Position is the authority, so the correction only ever goes onto the PORT LEVEL page, and
       only onto rows whose Sec-Pos matches an antenna. The cell overlay is `stampWholeCell`, the same call
       RF Inventory uses, so a model that printed across two lines is covered end to end. */
    if(!(_skipRedline.has("portLevel")||(onlyKey&&onlyKey!=="portLevel"))){
      try{
        const chk=portLevelCheck();
        const plvPages=PF.portLevel||[];
        if(chk.have&&chk.mismatch.length){
          chk.mismatch.forEach(m=>{
            const pi=m.page;
            if(typeof pi!=="number"||pi<0){ missed++; mark("PortLevel",false);
              LOG("⚠ Port Level: no page for Sec-Pos "+m.secPos+" — not written"); return; }
            if(S.pages[pi]&&S.pages[pi].locked){ missed++; mark("PortLevel",false); return; }
            if(plvPages.length&&plvPages.indexOf(pi)<0){
              missed++; mark("PortLevel",false);
              LOG("⚠ Port Level: refused to redline page "+(pi+1)+" — not a Port Level (Final) page"); return; }
            const col=m.col||chk.modelCol;
            const box=m.row&&m.row._g?m.row._g[col]:null;
            if(!box){ missed++; mark("PortLevel",false);
              LOG("⚠ Port Level: Sec-Pos "+m.secPos+" has no printed "+(m.label||"Model")+
                  " cell — this cell was NOT written"); return; }
            stampWholeCell(pi,box,m.correct,"center");
            applied++; mark("PortLevel",true);
            if(firstPi==null)firstPi=pi;
            LOG("Port Level: "+m.secPos+" "+(m.label||"Model")+" "+JSON.stringify(m.printed)+" → "+
                JSON.stringify(m.correct)+" (from Antenna Position) page "+(pi+1));
          });
        }
      }catch(e){ LOG("Port Level apply failed:",e&&e.message||String(e)); }
    }
    // RF Inventory (generic, as-printed) — overlay each changed cell on its printed value; strike whole rows
    const rfPages=PF.rfInventory||[];
    const rfData=A.rfInventory||{columns:[],rows:[]};
    if(!(_skipRedline.has("rfInventory")||(onlyKey&&onlyKey!=="rfInventory"))){
      carryDsToRf();
      if((rfData.rows||[]).some(r=>!r.inserted&&r._y==null)) rfResolveRows(rfData.rows,rfPages);
    }
    /* Every inserted row needs its OWN line. _stackIdx only counts a chain (a row added below another
       added row), so rows added below DIFFERENT printed rows all came out as slot 0 — they landed on the
       same y, and identical text at the same spot is dropped by the duplicate guard. That is why nine
       added rows produced six marks: the three DC_TRUNK / WR-VG86ST-BRD twins collided.
       Slots are therefore assigned across the whole tab, grouped by page and anchor. */
    {
      const _slots=new Map();
      (rfData.rows||[]).forEach(r=>{
        if(!r.inserted)return;
        const key=((typeof r.page==="number")?r.page:-1)+"|"+
                  (r._aboveY!=null?(+r._aboveY).toFixed(3):"?");
        const n=_slots.get(key)||0;
        r._slot=n; _slots.set(key,n+1);
      });
      const groups=[..._slots.entries()].filter(([,n])=>n>1);
      if(groups.length)LOG("RF inserts: "+groups.map(([k,n])=>n+" row(s) share anchor "+k).join(" · "));
    }
    (rfData.rows||[]).forEach(r=>{
      if(_skipRedline.has("rfInventory")||(onlyKey&&onlyKey!=="rfInventory"))return;
      if(r.inserted){ const res=placeInsertedRfRow(r,rfData.columns||Object.keys(r.cells),rfPages);
        applied+=res.applied; missed+=res.missed;
        for(let q=0;q<res.applied;q++)mark("RFInsertedRows",true); for(let q=0;q<res.missed;q++)mark("RFInsertedRows",false); if(res.pi!=null&&firstPi==null)firstPi=res.pi; return; }
      const changedCells=(rfData.columns||Object.keys(r.cells)).filter(c=>String(r.cells[c]||"").trim()!==String(r._orig[c]!=null?r._orig[c]:"").trim()&&String(r.cells[c]||"").trim()!=="");
      if(!r.struck && !changedCells.length) return;
      LOG("Analyze RF row",(r._key||"?")+"#"+(r._keyIdx||0),"page",(r.page||0)+1,
          "changed:",changedCells.join(", "));
      /* The row already knows which page it was read from — trust that first.
         The old code always searched for the row's longest printed value and used whatever page it
         turned up on. Fine when that value is unique (most rows carry a long sector-specific Linked
         Cells id) — but a SQUID row's Linked Cells is "-", so its longest value is the MODEL, and the
         same model appears in several sectors. The search then returned another sector's page, and the
         mark was stamped there or refused, leaving this row's page untouched.
         The anchor search is now only a fallback for rows with no page of their own. */
      const ownPi=(typeof r.page==="number"&&r.page>=0)?r.page:-1;
      let pi=ownPi, loc=null;
      if(ownPi<0||(rfPages.length&&rfPages.indexOf(ownPi)<0)){
        const anchor=r.anchor||Object.values(r._orig).map(String).sort((a,b)=>b.length-a.length)[0]||"";
        loc=anchor?locateModel(rfPages.length?rfPages:[r.page], anchor):null;
        pi=loc?loc.pi:ownPi;
        LOG("Analyze RF: row",(r._key||"?")+"#"+(r._keyIdx||0),"had no usable page — anchor search gave",
            (pi>=0?("page "+(pi+1)):"nothing"));
      }
      if(pi<0||(S.pages[pi]&&S.pages[pi].locked)){ missed++; return; }
      /* never write onto an Existing / Decommissioned / non-RF page, whatever a fallback resolved to */
      if(rfPages.length&&rfPages.indexOf(pi)<0){
        missed++; LOG("Analyze RF: refused to redline page",pi+1,"— not an RF Inventory (Final) page");
        return;
      }
      let band=rfBandAt(pi,r._y);
      if(!band&&loc) band=rfBandAt(pi,loc.it.ny+(loc.it.nh||0)/2);
      if(r.struck){
        /* always a full-row strike: one line across the row's whole width, at its vertical middle,
           computed from every cell box so a multi-line row is struck once end to end */
        const boxes=Object.keys(r._g||{}).map(k=>r._g[k]).filter(Boolean);
        if(boxes.length){
          const left=Math.min(...boxes.map(b=>b.nx));
          const right=Math.max(...boxes.map(b=>b.x2!=null?b.x2:b.nx+(b.nw||0)));
          const top=Math.min(...boxes.map(b=>b.ny));
          const bot=Math.max(...boxes.map(b=>b.y2!=null?b.y2:b.ny+(b.nh||0)));
          const my=(top+bot)/2;
          addLine(pi,Math.max(0,left-0.005),my,Math.min(1,right+0.005),my);
          applied++; if(firstPi==null)firstPi=pi; mark("RFInventory",true);
          LOG("Analyze RF: struck the whole row at y",my.toFixed(4),"page",pi+1);
          return;
        }
        const anchorIt=band?band.items[0]:(loc?loc.it:null);
        if(anchorIt){ strikeRow(pi,anchorIt); applied++; if(firstPi==null)firstPi=pi; } else missed++;
        return;
      }
      const bandY=band?band.y:(loc?loc.it.ny:null);
      changedCells.forEach(c=>{ const cur=r._orig[c], nv=r.cells[c];
        let box=(r._g&&r._g[c])?r._g[c]:null;
        if(!box&&r._g){
          /* A cell that printed nothing has no geometry, so nothing was ever placed there. Build a box
             from a sibling cell (for the row's y) and the column's x — this is the last class of RF edit
             that was quietly going nowhere. */
          const sibs=Object.keys(r._g).map(k=>r._g[k]).filter(Boolean);
          const cx=(rfData&&rfData.colX&&rfData.colX[c]!=null)?rfData.colX[c]:rfColX(pi,c);
          if(sibs.length&&cx!=null){
            const s0=sibs[0], w=0.034, lh=s0.nh||0.011;
            box={nx:Math.max(0,cx-w/2), ny:s0.ny, nw:w, nh:lh,
                 x2:Math.min(1,cx+w/2), y2:(s0.y2!=null?s0.y2:s0.ny+lh),
                 topR:Math.min(1,cx+w/2), topY:s0.ny, lines:1, synth:true};
            LOG("Analyze RF: ["+c+"] had no printed cell — placed from the column x");
          }
        }
        if(box){
          /* The stored box IS the cell — width from its top line, height over every line. Using it for
             every column removes the guesswork that made edits on tall rows land badly or not at all. */
          /* Vendor / Model / Equipment Type hold ONE value. Whether it printed on one line or three,
             the redline is a single block over the whole cell — so nothing of the old value can show
             through and no printed text run has to be resolved first. */
          stampWholeCell(pi,box,nv,"center");
          applied++; if(firstPi==null)firstPi=pi; mark("RFInventory",true);
          LOG("Analyze RF cell ["+c+"] "+(box.lines||1)+" line(s)"
              +" box x "+box.nx.toFixed(4)+"→"+((box.topR!=null?box.topR:box.x2)||0).toFixed(4)
              +" y "+box.ny.toFixed(4)+"→"+(box.y2||0).toFixed(4)+":",cur,"→",nv,"page",pi+1);
          return;
        }
        let it=box?rfItemAt(pi,box):null;                      // the cell we read this value from
        if(!it) it=rfCellFor(pi,band,c,cur);                   // printed value, else the column's header x
        if(!it) it=findValueNear(pi,String(cur==null?"":cur).trim(),bandY);
        if(!it&&r._key){
          /* last resort, as requested: find the row by its Sec-Pos key, then the cell by column x.
             The x comes from the reader's own column map — rfColX() relies on a separate header scan
             that the cell reader never populates, so it was returning null and this path never ran. */
          const ky=rfRowYByKey(pi,r._key,r._keyIdx);
          const cx=(rfData&&rfData.colX&&rfData.colX[c]!=null)?rfData.colX[c]:rfColX(pi,c);
          if(ky!=null&&cx!=null){
            const fh2=0.011;
            /* these tables are centre-aligned, so centre the value ON the column x rather than starting
               its left edge there — starting at the centre pushed the text a half-width to the right */
            putFreeAt(pi,cx,Math.max(0,ky-fh2/2),String(nv));
            applied++; if(firstPi==null)firstPi=pi; mark("RFInventory",true);
            LOG("Analyze RF (by Sec-Pos",r._key+"#"+r._keyIdx+"):",c,"→",nv,"page",pi+1);
            return;
          }
        }
        if(it&&box&&box.y2!=null&&(box.y2-box.ny)>(box.nh||0)*1.35){
          /* the printed value wraps: stamp it, then stretch the mark over the cell's whole box so the
             lines underneath are covered too */
          const id=addText(pi,it.nx,it.ny,String(nv),{cell:it});
          const a2=S.annos.find(z=>z.id===id);
          if(a2){ a2.nx=box.nx; a2.ny=box.ny; a2.nw=Math.max(box.x2-box.nx,a2.nw||0);
                  a2.nh=(box.y2-box.ny); a2.manualW=true; a2.fullcell=true; a2.nowrap=true; }
          applied++; if(firstPi==null)firstPi=pi; mark("RFInventory",true);
          LOG("Analyze RF (multi-line cell):",c,cur,"→",nv,"page",pi+1);
          return;
        }
        if(it){ addText(pi,it.nx,it.ny,String(nv),{cell:it}); applied++; if(firstPi==null)firstPi=pi;
          mark("RFInventory",true); LOG("Analyze RF:",c,cur,"→",nv,"page",pi+1); return; }
        const cx=rfColX(pi,c);                                // empty cell: write at the column, on this row
        if(cx!=null&&band){
          const fh=(band.items[0]&&band.items[0].nh)||0.012;
          putLeftAt(pi,Math.max(0,cx-0.004),Math.max(0,band.y-fh/2),String(nv));
          applied++; if(firstPi==null)firstPi=pi; mark("RFInventory",true); LOG("Analyze RF (blank cell):",c,"→",nv,"page",pi+1); return;
        }
        missed++; mark("RFInventory",false); LOG("Analyze RF: value not located:",c,cur,"row y",r._y,"page",pi+1);
      });
    });
    // Antenna Position (transposed): fields are rows, positions are columns. Applies to Final, Existing and Decommissioned.
    [["antennaPosition",PF.antennaPosition||[]],["antennaExisting",PF.antennaExisting||[]],["antennaDecom",PF.antennaDecom||[]]].forEach(([akey,antPages])=>{
     if(_skipRedline.has(akey)||(onlyKey&&onlyKey!==akey))return;   // e.g. Existing/Decommissioned are excluded by default
     (A[akey]||[]).forEach(r=>{
      const secPos=r._orig_secPos||r.secPos;
      const anchor=[secPos,r._orig_model,r._orig_vendor].find(v=>v&&String(v).trim().length>1);
      const loc=anchor?locateModel(antPages.length?antPages:[r.page], anchor):null;
      const pi=loc?loc.pi:(typeof r.page==="number"?r.page:-1);
      if(pi<0){ if(r.struck)missed++; return; }   // antenna pages may be "locked" (Existing/Decom) — still allow their redlines
      if(r.struck){
        /* 6fw — the column, crossed out. Falls back to the row strike only when the position's column
           cannot be located, and says so, rather than quietly drawing the wrong mark. */
        const sx=antColX(pi,secPos);
        const id=(sx!=null)?crossOutColumn(pi,sx):null;
        if(id!=null){ applied++; if(firstPi==null)firstPi=pi;
          LOG("Analyze antenna: struck",secPos,"\u2014 column crossed out, page",pi+1); }
        else if(loc){ strikeRow(pi,loc.it); applied++; if(firstPi==null)firstPi=pi;
          LOG("\u26a0 Analyze antenna: struck",secPos,"\u2014 could not measure its column, fell back "
              +"to a row strike, page",pi+1); }
        else missed++;
        return;
      }
      const colX=antColX(pi,secPos);   // this position's column
      /* 6cj — the box captured when the cell was READ is the first choice for every field. It is exact,
         it covers a value that printed across two lines, and it exists even for a cell that printed
         nothing. The old search by field-row and column x stays as the fallback for rows read before
         this build. */
      /* 6fu — an As-Built field on a page that prints no As-Built row */
      const _desOf={};
      Object.keys(ANT_PAIR).forEach(d=>{ _desOf[ANT_PAIR[d]]=d; });
      const stamp=(f,label,cur,nv)=>{
        const des=_desOf[f];
        if(des && ANT_ROW[f] && antFieldRowCount(pi,ANT_ROW[f])<2){
          /* the page has one row where the tool models two, so there is no As-Built cell to write in.
             Ced's call: put it beside the design value, in the same cell, rather than on top of it. */
          let dcell=(r._gf&&r._gf[des])||null;
          if(!dcell&&colX!=null&&ANT_ROW[des]){
            const dfr=antFieldRow(pi,ANT_ROW[des]);
            dcell=dfr?antCellAt(pi,colX,dfr.y):null;
          }
          /* and never write a value that only repeats the design figure. The derive is guarded above,
             but a second guard here costs nothing and this is the path where a duplicate would be
             visible on the page rather than merely wrong in the grid. */
          if(String(nv).trim()===String(r[des]==null?"":r[des]).trim())return false;
          const bb=antBesideBox(dcell,colX);
          if(bb){
            const _id=addText(pi,bb.nx,bb.ny,String(nv),{cell:bb});
            const _a=S.annos.find(z=>z.id===_id);
            if(_a){ _a.align="left"; _a.alignSet=true; _a.alignUser=false;
                    _a.besideDesign=true; fitCellBox(_a); }
            applied++; if(firstPi==null)firstPi=pi; mark("Antenna",true);
            LOG("Analyze antenna:",akey,secPos,label,"(no As-Built row on the page) → beside the design value,"
                ,"page",pi+1);
            return true;
          }
          missed++; mark("Antenna",false);
          LOG("⚠ Analyze antenna:",akey,secPos,label,"— the page prints no As-Built row and there is no "
              +"room beside the design value; NOT written");
          return false;
        }
        const box=r._gf&&r._gf[f];
        if(box){
          /* 6cs — a cell that printed on two lines wraps; forcing an alignment on it fights the wrap. */
          /* 6dk — a single character is CENTRED here, not flush left. 6cn moved one-character values to
             the left on the reasoning that centring a replacement on a printed `-` placeholder would
             push it out of its column. Measured against the pages themselves, that is not what these
             tables do: every one of the 579 printed cells on the twelve antenna pages of the reference
             RFDS — dashes, "0", "285", "MB-A64O9X65V-01" alike — sits at 0.50–0.512 of its column, i.e.
             dead centre, and the widest fills 83% of the column, so centring a replacement on a centred
             dash keeps it inside its own column. Flush left was therefore adding a left inset to a value
             that should have been centred, which is exactly the "0" standing right of the Design "0"
             above it in Mechanical Downtilt. A transposed table centres its column; so do we. */
          const _al=(box.lines>1)?null:"center";
          const _sid=stampWholeCell(pi,box,String(nv),_al,{colCentred:true});
          { const _sa=S.annos.find(z=>z.id===_sid); if(_sa)_sa.colCentred=true; }
          applied++; if(firstPi==null)firstPi=pi; mark("Antenna",true);
          LOG("Analyze antenna:",akey,secPos,label,JSON.stringify(cur),"→",JSON.stringify(nv),"page",pi+1);
          return true;
        }
        let cell=null;
        if(f==="secPos"){ cell=findOnPage(pi,String(cur)); }
        else if(colX!=null&&ANT_ROW[f]){ const fr=antFieldRow(pi,ANT_ROW[f]); cell=fr?antCellAt(pi,colX,fr.y):null; }
        if(!cell&&String(cur).trim()) cell=findValueNear(pi,String(cur), loc?loc.it.ny:null);
        /* 6cm — never write into the row-LABEL column. On a transposed antenna table the labels sit on
           the left and the positions are the columns; when the value search misses, findValueNear can
           come back with the label run itself and the correction lands on the word "Model" instead of
           on the antenna. A logged miss is the honest outcome — the same 0.135 the reader uses. */
        if(cell&&(cell.nx+(cell.nw||0)/2)<=0.135){
          LOG("⚠ Analyze antenna:",akey,secPos,label,"— the only match was in the label column; NOT written");
          cell=null;
        }
        if(cell){ const _id=addText(pi,cell.nx,cell.ny,String(nv),{cell});
          /* 6dk — the fallback path centres too, for the same measured reason as the box path above.
             It has to be set explicitly: without alignSet, fitCellBox falls back to the one-character
             rule and the fallback would drift left while the main path centres. */
          { const _a=S.annos.find(z=>z.id===_id);
            if(_a){ _a.colCentred=true; _a.align="center"; _a.alignSet=true; _a.alignUser=false; fitCellBox(_a); } }
          applied++; if(firstPi==null)firstPi=pi;
          mark("Antenna",true); LOG("Analyze antenna:",akey,secPos,label,"→",nv,"page",pi+1); return true; }
        missed++; mark("Antenna",false);
        LOG("⚠ Analyze antenna: no cell for",akey,secPos,label,"— this value was NOT written");
        return false;
      };
      ["radCenterDesign","radCenterAsBuilt","tipHeight","tipHeightAsBuilt","azimuthDesign","azimuthAsBuilt","mechDowntiltDesign","mechDowntiltAsBuilt","vendor","vendorAsBuilt","model","modelAsBuilt","secPos"].forEach(f=>{
        const cur=r["_orig_"+f], nv=r[f];
        if(cur==null||nv==null||String(cur).trim()===String(nv).trim()||String(nv).trim()==="") return;
        stamp(f,f,cur,nv);
      });
      /* 6cj — and every OTHER row on the page. They became editable when the reader started keeping the
         whole table (6ci); until now an edit to one of them changed the grid and redlined nothing. */
      (r._fieldOrder||[]).forEach(label=>{
        if(antKeyForLabel(label))return;                       // already handled above by its canonical key
        const cur=(r._origFields||{})[label], nv=(r.fields||{})[label];
        if(cur==null||nv==null||String(cur).trim()===String(nv).trim()||String(nv).trim()==="")return;
        stamp(label,label,cur,nv);
      });
     });
    });
    // RFDS Details / Site Details — overlay a corrected field value on its printed value
    ["rfdsDetails","siteDetails"].forEach(dk=>{
      if(_skipRedline.has(dk)||(onlyKey&&onlyKey!==dk))return;
      const dPages=PF[dk]||[];
      (A[dk]||[]).forEach(r=>{
        if(!detailsRowChanged(r))return;
        const pages=dPages.length?dPages:[r.page];
        let pi=-1, labelIt=null;
        for(const k of pages){ if(k<0||!S.pages[k])continue; const it=findOnPage(k,r.label); if(it){ pi=k; labelIt=it; break; } }
        if(pi<0){ pi=(typeof r.page==="number")?r.page:-1; }
        if(pi<0){ missed++; LOG("Analyze",dk,": page not found for",r.label); return; }
        const printed=String(r.printed||"").trim();
        if(r._g&&!r.struck){                            // stored position: no searching needed
          const it=pageItemAt(pi,r._g);
          if(it) addText(pi,it.nx,it.ny,String(r.value),{cell:it,align:"left"});
          else putLeftAt(pi,r._g.nx,r._g.ny,String(r.value));
          applied++; if(firstPi==null)firstPi=pi; mark(dk,true);
          LOG("Analyze "+dk+" (stored position):",r.label,printed,"→",r.value,"page",pi+1);
          return;
        }
        if(r.struck){
          const it=printed?findValueNear(pi,printed,labelIt?labelIt.ny:null):labelIt;
          if(it){ strikeRow(pi,it); applied++; if(firstPi==null)firstPi=pi; } else missed++;
          return;
        }
        const it=printed?findValueNear(pi,printed,labelIt?labelIt.ny:null):null;
        if(it){ addText(pi,it.nx,it.ny,String(r.value),{cell:it,align:"left"}); applied++; if(firstPi==null)firstPi=pi;
          mark(dk,true); LOG("Analyze "+dk+":",r.label,printed,"→",r.value,"page",pi+1); }
        else if(labelIt){ // blank field: write just to the right of the label
          const id=addText(pi,Math.min(0.95,labelIt.nx+(labelIt.nw||0)+0.01),labelIt.ny,String(r.value));
          const a=S.annos.find(z=>z.id===id); if(a){ a.nowrap=true; a.align="left"; a.alignSet=true; }
          applied++; if(firstPi==null)firstPi=pi;
          LOG("Analyze "+dk+":",r.label,"(blank) →",r.value,"page",pi+1);
        }
        else { missed++; LOG("Analyze "+dk+": value not located:",r.label,printed); }
      });
    });

    // Equipment in Calculation (Active) — one number per model: the cross-sector total Final,
    // stamped on that row's single quantity cell (not four count columns).
    const ecPages=PF.equipmentCalc||[];
    reflectEcFromDS();
        /* the printed Equipment in Calc table redlines through its own path (cells over their boxes,
       inserted rows written into the gap below their anchor) */
    /* When the printed table is in use it is the ONLY source for this tab. The derived path stamps its
       Design-Summary totals over the same cells — that is where the red "1 → 0" and "3 → 6" on your page
       came from, and why the quantities looked synced. */
    const _ecTableInUse=!!(A&&A.ecTable&&A.ecTable.columns&&A.ecTable.columns.length>=2&&
                           A.ecTable.rows&&A.ecTable.rows.length);
    if(!(_skipRedline.has("equipmentCalc")||(onlyKey&&onlyKey!=="equipmentCalc"))){
      try{
        const _ec=applyEcTable();
        if(_ec){ applied+=_ec.applied; missed+=_ec.missed;
          if(_ec.applied){ mark("EquipmentCalc",true);
            const _T=S.analysis&&S.analysis.ecTable;
            const _p=_T&&_T.rows&&_T.rows.length?_T.rows[0].page:null;
            if(firstPi==null&&typeof _p==="number")firstPi=_p; } }
      }catch(e){ LOG("EC table apply failed:",e&&e.message); }
    }
(A.equipmentCalc||[]).forEach(r=>{
      if(_skipRedline.has("equipmentCalc")||(onlyKey&&onlyKey!=="equipmentCalc"))return;
      if(_ecTableInUse)return;      // the printed table already handled this tab
      if(!ecRowChanged(r))return;
      const loc=locateModel(ecPages.length?ecPages:[r.page], r.origModel||r.model);
      if(!loc){ missed++; LOG("Analyze EC: could not locate:", r.origModel||r.model); return; }
      const {pi,it,line}=loc;
      if(r.struck){
        strikeRow(pi,it); applied++; if(firstPi==null)firstPi=pi;
        /* 6fw — "in all parts": the quantity beside a struck row goes to 0 as well, not merely struck
           through. A reader who sees the strike and the old figure still has to work out which wins. */
        try{
          const qn=ecQtyCellFor(pi,it);
          if(qn && String(qn.str).trim()!=="0"){
            const _id=addText(pi,qn.nx,qn.ny,"0",{cell:qn});
            const _a=S.annos.find(z=>z.id===_id);
            if(_a){ _a.colCentred=true; _a.align="center"; _a.alignSet=true; _a.alignUser=false; fitCellBox(_a); }
            applied++;
            LOG("Analyze EC: struck",r.origModel||r.model,"— quantity",qn.str,"\u2192 0, page",pi+1);
          } else LOG("Analyze EC: struck",r.origModel||r.model,"page",pi+1,
                     qn?"(quantity already 0)":"(no quantity cell found to zero)");
        }catch(e){ LOG("Analyze EC: struck row, quantity not zeroed \u2014",e&&e.message); }
        return;
      }
      if(r.model&&r.origModel&&r.model!==r.origModel){ addText(pi,it.nx,it.ny,r.model,{cell:it}); applied++; if(firstPi==null)firstPi=pi; }
      const nums=(line||[]).filter(t=>/^\d+$/.test(t.str.trim())).sort((a,b)=>a.nx-b.nx);
      const cell=nums.length?nums[nums.length-1]:null;
      if(!cell){ missed++; LOG("Analyze EC: no quantity cell on row for",r.origModel||r.model); return; }
      const nv=String(int(r.count));
      if(cell.str.trim()!==nv){ addText(pi,cell.nx,cell.ny,nv,{cell,align:"left"}); applied++; if(firstPi==null)firstPi=pi; mark("EquipmentInCalc",true); LOG("Analyze EC:",r.origModel||r.model,cell.str.trim(),"→",nv,"page",pi+1); }
    });
  }catch(e){ LOG("applyAnalysis error",e); setStatus("Analyze apply hit an error: "+(e&&e.message||e),true); }
  finally{ _histBatch=Math.max(0,_histBatch-1); updateUndoUI(); }
  _azApplying=false;
  if(_needRelayout){ layoutAnnos(); _needRelayout=false; }   // wrap/height on the marks just stamped
  setMode("select"); selectAnno(null); layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  const parts=Object.keys(_rep).map(k=>`${k} ${_rep[k].applied}${_rep[k].missed?"/-"+_rep[k].missed:""}`);
  /* 6ev — a cell Apply declined because YOUR mark was already there is not a miss and not a silent skip:
     it is a decision, and the run says how many times it made it. */
  const held=_azHandHeld?`, ${_azHandHeld} left as you drew them`:"";
  setStatus(`Analyze: applied ${applied} redline(s)${missed?`, ${missed} not located`:""}${held}${parts.length?" — "+parts.join(" · "):""}. Marks are editable — review before export.`);
  LOG(`Analyze apply done: ${applied} applied, ${missed} missed, ${_azHandHeld} held back for your own redlines`, _rep);
  if(firstPi!=null){ const pg=document.querySelector(`.page[data-idx="${firstPi}"]`); if(pg)pg.scrollIntoView({behavior:"auto",block:"start"}); }
}

/* 5. write an inserted RF Inventory row into the gap between the two printed rows it sits between.
   Each value is placed at the x of the corresponding cell in the row above, on the midline. */
function placeInsertedRfRow(r,cols,rfPages){
  const out={applied:0,missed:0,pi:null};
  const filled=(cols||[]).filter(c=>String(r.cells[c]==null?"":r.cells[c]).trim()!=="");
  if(!filled.length) return out;
  let pi=(typeof r.page==="number")?r.page:-1, line=null, aboveY=r._aboveY;
  /* The anchor row's band y may never have been resolved (_y null), which left aboveY null and dropped the
     row into an anchor search a NEW row can never satisfy — that is how some added rows were silently not
     redlined. Its cell geometry is available, so take the y from that. */
  if(aboveY==null&&r._aboveG){
    const b0=Object.keys(r._aboveG).map(k=>r._aboveG[k]).filter(Boolean)[0];
    if(b0&&b0.ny!=null){ aboveY=b0.ny; LOG("RF insert: anchor band was unresolved — using its cell y",aboveY.toFixed(4)); }
  }
  /* 6bz: the anchor stored at insert time is the authority — prefer it over anything re-derived */
  if(aboveY==null&&r._anchorY!=null){
    aboveY=r._anchorY;
    LOG("RF insert: using the anchor y stored at insert time",(+aboveY).toFixed(4));
  }
  if(pi<0&&typeof r._anchorPage==="number")pi=r._anchorPage;   // and the page too, if it went missing
  if(pi>=0&&aboveY!=null){ const b=rfBandAt(pi,aboveY); if(b){ line=b.items; aboveY=b.y; } }
  if(pi>=0&&aboveY!=null&&!line){
    /* no printed band at that y (a page whose text was unloaded, say) — place from the geometry alone */
    LOG("RF insert: no band at y",aboveY.toFixed(4),"on page",pi+1,"— placing from the column x");
  }
  if(!line){                                        // fallback for rows inserted before this fix
    const above=r.afterAnchor||r.anchor;
    const loc=above?locateModel(rfPages&&rfPages.length?rfPages:[r.page],above):null;
    if(!loc){ out.missed++; LOG("Analyze RF insert: row above not located:",above); return out; }
    pi=loc.pi; line=loc.line; aboveY=loc.it.ny;
  }
  if(pi<0||(S.pages[pi]&&S.pages[pi].locked)){ out.missed++; return out; }
  const fh=(line[0]&&line[0].nh)||0.012;
  /* Halfway between the ROW above and the ROW below — measured from the rows' own cell boxes, not from
     the next text line (which may be the second line of the same row). */
  const all=((S.analysis&&S.analysis.rfInventory&&S.analysis.rfInventory.rows)||[]).filter(x=>!x.inserted&&x.page===pi);
  const boxesOf=x=>Object.keys(x._g||{}).map(k=>x._g[k]).filter(Boolean);
  const aboveRow=all.filter(x=>x._y!=null).reduce((bestx,x)=>
    (bestx==null||Math.abs(x._y-aboveY)<Math.abs(bestx._y-aboveY))?x:bestx,null);
  const belowRow=all.filter(x=>x._y!=null&&x._y>aboveY+0.001).sort((q,w)=>q._y-w._y)[0];
  let aboveBottom=null, belowTop=null;
  if(aboveRow){ const bx=boxesOf(aboveRow); if(bx.length)aboveBottom=Math.max(...bx.map(b=>b.y2!=null?b.y2:b.ny+(b.nh||0))); }
  if(belowRow){ const bx=boxesOf(belowRow); if(bx.length)belowTop=Math.min(...bx.map(b=>b.ny)); }
  let midY;
  if(aboveBottom!=null&&belowTop!=null&&belowTop>aboveBottom+fh*0.5){
    midY=Math.max(0,(aboveBottom+belowTop)/2-fh/2);      // there is a gap between two printed rows
  } else if(aboveBottom!=null){
    /* Nothing below — this is the last printed row on the page. Start just UNDER it and let the stack
       run down the page. The old fallback split the difference with a guessed next line and landed the
       new row on top of the last printed one. */
    midY=Math.min(1-fh,aboveBottom+fh*0.30);
  } else {
    const below=pageLines(pi).filter(l=>l.y>aboveY+fh*0.6);
    const nextY=below.length?below[0].y:(aboveY+fh*1.8);
    midY=Math.max(0,(aboveY+nextY)/2-fh/2);
  }
  /* one line per added row, counted across the whole tab so two rows can never share a line */
  const slot=(r._slot!=null?r._slot:(r._stackIdx||0));
  if(slot) midY+=slot*fh*1.15;
  midY=Math.min(midY,1-fh*1.1);
  out.pi=pi;
  filled.forEach(c=>{
    const v=String(r.cells[c]).trim();
    let cx=rfColX(pi,c);                                     // 1) the column's own header x
    if(cx==null){                                            // 2) the same column in the row above
      const ref=r._above?r._above[c]:null;
      if(ref!=null&&String(ref).trim()!==""){
        const rs=String(ref).trim();
        const cell=line.find(t=>t.str.trim()===rs)||line.find(t=>t.str.trim().toLowerCase()===rs.toLowerCase());
        if(cell)cx=cell.nx+(cell.nw||0)/2;
      }
    }
    if(cx==null){ out.missed++;
      LOG("⚠ Analyze RF insert: no x for column ["+c+"] on row",(r.cells&&r.cells[cols[0]])||"?",
          "— this cell was NOT written"); return; }
    /* The COLUMN's width — from the reader's own column span. Using the anchor cell's TEXT width made a
       duplicate of the same value overflow by its own padding, so "SQUID" wrapped to "SQUI"/"D". */
    /* Two widths matter and they are not the same:
         - the PRINTED CELL (the anchor row's box) is what the page wraps at, so it decides whether this
           value needs to break — a duplicate of a two-line value should break the same way;
         - the COLUMN SPAN is where the text may sit.
       Using the span alone stopped a duplicate wrapping like its original; using the cell alone made a
       value the same size as the one above overflow by its own padding, which is how "SQUID" became
       "SQUI / D". */
    /* Centre the value on its column. No width is used to decide wrapping any more — inserted rows
       always render on one line (see putRowCell). */
    const A2=S.analysis, RF2=A2&&A2.rfInventory;
    const span=RF2&&RF2.colSpan&&RF2.colSpan[c];
    const colW=span?Math.max(0.006,span.to-span.from):0.06;
    /* 6ds — centre on the column's OWN measured centre, which is what the Design Summary and Equipment
       in Calc added rows have always done. This used the span's left edge instead, and a span is cut
       halfway between neighbouring columns — so the value sat on the midpoint of the GAP rather than on
       the middle of the printed column, which is the "not polished" alignment. The width still comes
       from the span (it is where the text may sit); only the centre changes. */
    const centre=(RF2&&RF2.colX&&RF2.colX[c]!=null)?RF2.colX[c]:cx;
    const left=Math.max(0,centre-colW/2);
    putRowCell(pi,left,colW,midY,String(v).toUpperCase(),fh);
    out.applied++;
    LOG("Analyze RF insert:",c,"=",v,"at x",cx.toFixed(4),"y",midY.toFixed(4),"page",pi+1);
  });
  return out;
}

/* rotate an annotation by dragging the ↻ handle */
function startAnnoRotate(ev,a,d,pg){
  ev.preventDefault(); ev.stopPropagation(); pushHistory(); selectAnno(a.id);
  try{d.setPointerCapture(ev.pointerId);}catch(e){}
  const r=d.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const start=Math.atan2(ev.clientY-cy, ev.clientX-cx); const base=a.rot||0;
  const move=e=>{ let deg=base+(Math.atan2(e.clientY-cy, e.clientX-cx)-start)*180/Math.PI;
    if(e.shiftKey)deg=Math.round(deg/15)*15;
    a.rot=Math.round(deg*10)/10; d.style.transform="rotate("+a.rot+"deg)"; positionBar(); };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* init: reflect snap default */
(function(){ const b=$("#snapBtn"); if(b)b.classList.toggle("active",S.snap); })();
/* 6cl: the chooser opens with EVERY section ticked. 6cd restored last session's unticked set from
   localStorage, which meant a section skipped once stayed silently skipped for ever — and with the
   "Read the whole document" button gone there is nothing left to override it in one click. Unticking
   still works, it just does not survive a reload. */
(function(){ try{ localStorage.removeItem(AZ_SCOPE_KEY); }catch(e){} _azScopeOff=new Set(); })();

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
  reportBtn:"\u2261",
  /* a bin: this one empties what the browser has kept, it does not touch the open document */
  cacheBtn:"\u232b",
  /* EDIT */
  undoBtn:"\u21b6", redoBtn:"\u21b7", clearBtn:"\u2327",
  /* ARRANGE — a grid to snap to, overlapping squares to group, a dotted square to select all */
  snapBtn:"\u2317", groupBtn:"\u25a8", selAllBtn:"\u2b1a",
  /* AI ASSIST */
  analyzeBtn:"\u2726", mirrorBtn:"\u21c4", applyCdBtn:"\u25c7", asBuiltBtn:"\u25a4",
  /* 6fd \u2014 the glyph is only the fallback: transferBtn is in RIBBON_SHAPES, so it draws the traced
     two-arrow mark. It still needs an entry here, because iconifyRibbon walks RIBBON_ICONS' keys. */
  transferBtn:"\u21c6",
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
const MODE_ICONS={ select:"\u270b", redline:"\u270e", strikerow:"\u25ad", cross:"\u2612", crossout:"\u2715",
                   line:"\u2571", copyrow:"\u29c9" };
/* 6do — the buttons whose icon is a shape, not a character. `mark` still runs for them (title, aria,
   the .ico sizing) — they only take a different source for the mark itself. */
const RIBBON_SHAPES={
  homeBtn:"--i-home", openBtn:"--i-file", cacheBtn:"--i-cache", analyzeBtn:"--i-star",
  saveBtn:"--i-save", copyBtn:"--i-copy", clearBtn:"--i-clear",
  transferBtn:"--i-transfer",   /* 6fd — the two-arrow transfer mark */
  railToggle:"--i-eye",         /* 6gh — show / hide the page list */
  orgBtn:"--i-org"        /* 6ep — a stack of pages, not another pair of arrows */
};
const MODE_SHAPES={ select:"--i-arrow", redline:"--i-pen", copyrow:"--i-copyrow", crossout:"--i-cross",
                    strikerow:"--i-strikerow", cross:"--i-striketext", line:"--i-line" };
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

/* The lane toggles are wired once at load. They were only attached inside the render pass, so before the
   first render the buttons existed but did nothing. */
(function(){
  const wire=()=>{
    const ll=document.getElementById("laneLink");
    if(ll&&!ll.dataset.wired){
      ll.dataset.wired="1";
      ll.onclick=()=>{ try{ toggleLinkHere(); }catch(e){}
        try{ ll.classList.toggle("on",linkOn()); }catch(e){}
        try{ renderAnalyze(); }catch(e){} };
      try{ ll.classList.toggle("on",linkOn()); }catch(e){}
    }
    const lm=document.getElementById("laneMirror");
    if(lm&&!lm.dataset.wired){
      lm.dataset.wired="1";
      const isAnt=()=>{ try{ return _azTab==="antennaPosition"||_azTab==="antennaExisting"
                                  ||_azTab==="antennaDecom"; }catch(e){ return false; } };
      const cur=()=>{ try{ return mirrorOn(); }catch(e){ return false; } };
      lm.onclick=()=>{ try{ mirrorToggle(); }catch(e){}
        lm.classList.toggle("on",cur());
        try{ renderAnalyze(); }catch(e){} };
      lm.classList.toggle("on",cur());
    }
  };
  /* 6cf: deferred for the same reason as iconifyRibbon above — when the app is injected after the DOM is
     already complete, running immediately means running before the rest of this script has initialised. */
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire); else setTimeout(wire,0);
})();