
/* ---- nothing moves when you switch (v80), now across every open tab ---------------------------------
   Two Mark It Up tabs are the same app with the same preferences, so their ribbons agree already; the
   work is between the two KINDS. One Mark It Up tab and one RFDS tab stand as references, every tab is
   lined up against the reference of the other kind (same plan every time, so they all agree), and the
   strips that depend on the document (the detection banner) take the tallest across ALL tabs. */
function parity(dR,dM){
  try{
    const lm=dM.getElementById("logBtn"), lr=dR.getElementById("logBtn");
    if(lm&&lr){ const cs=dM.defaultView.getComputedStyle(lm);
      ["height","boxSizing","paddingTop","paddingRight","paddingBottom","paddingLeft","fontSize","fontWeight","lineHeight",
       "letterSpacing","borderRadius","gap"].forEach(p=>{ lr.style[p]=cs[p]; }); }
  }catch(e){}
  try{
    const hm=dM.querySelector("h1.logo"), hr=dR.querySelector("h1.logo"); if(!hm||!hr)return;
    hr.style.removeProperty("height"); hr.style.removeProperty("transform");
    const H=hm.getBoundingClientRect().height, R=hr.getBoundingClientRect().height;
    if(H>0&&R>0&&Math.abs(H-R)>0.5){ hr.style.height=H+"px"; hr.style.transformOrigin="50% 0"; hr.style.transform="scale("+(H/R).toFixed(4)+")"; }
  }catch(e){}
}
function alignPair(dM,dR){
  modeClearAlign(dM); modeClearAlign(dR);
  const right=dM.body.classList.contains("ribbonright");
  if(right!==dR.body.classList.contains("ribbonright"))return;
  /* v82 — NO EMPTY SEATS INSIDE A GROUP. Ced: "fix the tools in rfds tool, if the tools are less than the
     miu, just retain the size but make sure they are still grouped evenly." v80 gave every Mark It Up
     tool a seat in the RFDS group (and the reverse), which kept the shared tools on the same spot but
     left the RFDS groups full of holes — Redline tools read select, hand, pen, gap, gap, gap. Now a
     group keeps its SLOT (the same width and height as Mark It Up's, so the groups and the separators
     still line up), and inside it each tool packs into its own even grid with no gaps, starting at the
     same edge as Mark It Up's first tool. The tools both have first (Select, Hand, Redline; New, Home,
     Save; Undo, Redo; Snap; Find …) stay on the same spot; the rest close up. */
  const qa=dM.getElementById("miniBar"), qb=dR.getElementById("miniBar");
  if(qa&&qb)modeSeats(qa,qb,true);
  const slots=modeMerge(modeNatural(dM,right),modeNatural(dR,right));
  const last={m:null,r:null};
  const put=(doc,key,item,S,X)=>{
    let el=item&&item.el;
    if(!el){
      el=doc.createElement("div"); el.className="grp mode-spacer"; el.setAttribute("aria-hidden","true"); el.dataset.lbl="";
      const tb=doc.getElementById("toolbar");
      if(last[key])last[key].after(el); else tb.insertBefore(el,modeGroups(doc)[0]||null);
    }
    el.dataset.mslot="1"; el.style.boxSizing="border-box";
    /* the other way too: a group a pixel taller on one side would make its whole row taller */
    if(right)el.style.minHeight=S+"px"; else { el.style.flex="1 1 "+S+"px"; el.style.minWidth=S+"px"; if(X)el.style.minHeight=X+"px"; }
    last[key]=el;
  };
  slots.forEach(s=>{
    const S=Math.ceil(Math.max(s.a?s.a.size:0,s.b?s.b.size:0));
    /* v82 — the cross size is only evened out for the pixel or two the two stylesheets round apart. A
       bigger gap means one of the tabs was caught mid-relayout (a resize lands in every tab at once and
       each re-lays its ribbon on its own timer); copying that height made a one-row ribbon stand three
       rows tall (Ced's screenshot after resizing). */
    const ca=s.a?s.a.cross:0, cb=s.b?s.b.cross:0;
    const X=(s.a&&s.b&&Math.abs(ca-cb)<=6)?Math.ceil(Math.max(ca,cb)):0;
    put(dM,"m",s.a,S,X); put(dR,"r",s.b,S,X);
  });
  /* each shared group's rows start where Mark It Up's do: the RFDS row keeps its own natural, even grid
     and is only moved sideways to Mark It Up's first-tool edge (measured after the slots are set) */
  slots.forEach(s=>{
    if(!s.same)return;
    const k=Math.min(s.a.rows.length,s.b.rows.length);
    for(let q=0;q<k;q++){
      const ra=s.a.rows[q], rb=s.b.rows[q];
      /* v82 — a row far shorter than Mark It Up's (Redline tools: 8 tools against 16) is centred in its
         space instead — Ced: "make the rfds redline tools centered in the space to not make it look
         awkward". Rows of a similar size stay on Mark It Up's first-tool edge. */
      if(rb.getBoundingClientRect().width<=ra.getBoundingClientRect().width*0.67){
        rb.dataset.mslot="row"; rb.style.alignSelf="center"; continue; }
      /* otherwise both rows take the wider of the two natural widths: the same box in the same place, so
         they wrap alike, and each packs its own tools from the same left edge with no gaps between */
      const W=Math.ceil(Math.max(s.a.rw[q],s.b.rw[q]));
      [ra,rb].forEach(r=>{ r.dataset.mslot="1"; r.style.minWidth=W+"px"; r.style.boxSizing="border-box"; });
    }
  });
  dR.querySelectorAll("#toolbar input[id]").forEach(b=>{ const a=dM.getElementById(b.id); if(!a)return;
    const ha=a.getBoundingClientRect().height, hb=b.getBoundingClientRect().height;
    if(ha>0&&hb>0&&Math.abs(ha-hb)>0.4){ b.dataset.mslot="h"; b.style.height=ha+"px"; } });
}
function alignAll(){
  /* v84 — and lining up never moves anyone's page: every tab's scroll is put back exactly as it was. The
     re-lay clears and re-measures, and for that instant a shorter header can clamp a scroll position. */
  const keep=live().map(t=>{ const d=tdoc(t), se=d&&(d.scrollingElement||d.documentElement);
    return se?[se,se.scrollLeft,se.scrollTop]:null; }).filter(Boolean);
  try{ alignAllInner(); }finally{ keep.forEach(([se,x,y])=>{ if(se.scrollLeft!==x||se.scrollTop!==y){ se.scrollLeft=x; se.scrollTop=y; } }); }
}
function alignAllInner(){
  try{
    const L=live(), M=L.filter(t=>t.tool==="miu"), R=L.filter(t=>t.tool==="rfds");
    const act=byId(WS.active);
    L.forEach(t=>modeClearAlign(tdoc(t)));
    if(M.length&&R.length){
      const rm=(act&&act.tool==="miu"&&act.ready)?act:M.slice().sort((a,b)=>b.used-a.used)[0];
      const rr=(act&&act.tool==="rfds"&&act.ready)?act:R.slice().sort((a,b)=>b.used-a.used)[0];
      const dm=tdoc(rm), dr=tdoc(rr);
      R.forEach(t=>parity(tdoc(t),dm));
      M.forEach(t=>{ if(t!==rm)alignPair(tdoc(t),dr); });
      R.forEach(t=>{ if(t!==rr)alignPair(dm,tdoc(t)); });
      alignPair(dm,dr);                                     /* the references last, against each other */
      /* the RFDS sheet takes Mark It Up's page-column margins (MiU centres it on the window, 6lb/6md) */
      const pm=dm.getElementById("pages"), cs=pm&&dm.defaultView.getComputedStyle(pm);
      if(cs)R.forEach(t=>{ const pr=tdoc(t).getElementById("pages"); if(pr){ pr.dataset.mslot="pages";
        pr.style.marginLeft=cs.marginLeft; pr.style.marginRight=cs.marginRight; } });
    }
    /* the strips above the ribbon say different things per document: every tab takes the tallest */
    ["header.app","#detectBanner","#saveStrip"].forEach(sel=>{
      const els=L.map(t=>tdoc(t).querySelector(sel)).filter(e=>e&&e.ownerDocument.defaultView.getComputedStyle(e).display!=="none");
      if(els.length<2)return;
      const H=Math.ceil(Math.max(...els.map(e=>e.getBoundingClientRect().height)));
      els.forEach(e=>{ e.dataset.mslot="1"; e.style.boxSizing="border-box"; e.style.minHeight=H+"px"; });
    });
  }catch(e){ log("alignment skipped:",e&&e.message||e); }
}

/* ---- the tab strip (v80's, for any number) ---------------------------------------------------------
   In every tab, at the same spot: right of the log pill, each tab wearing the pill's own computed look.
   A tab per open copy of a tool — its mark and its file's name (or the tool's name while it is empty),
   a × to close it, and a + at the end for a new Mark It Up or RFDS tab. With a single tab only the +
   shows, so a second one is always one click away. */
function docInfo(t){
  const d=tdoc(t); if(!d||!d.documentElement||d.documentElement.classList.contains("nodoc"))return null;
  const f=d.getElementById("miniFname"), n=d.getElementById("miniName");
  const name=(f&&f.textContent||"").trim()||(n&&n.value||"").trim()||"Untitled.pdf";
  return {name, title:tabTitle(t,d)};
}
/* v88 — THE TAB NAMES ITSELF. Ced: "make miu and rfds tabs autopopulate. for miu, make the tool know if it
   is construction drawings, mount analysis, or structural analysis so it shows as the tab title. show MIU
   if unknown file." A Mark It Up tab is titled with what its document is (miuDocKind, read off the pages)
   and an RFDS tab with what its detection banner says (Final / Preliminary RFDS); either is followed by
   the site code once one is known, so two mount analyses in two tabs can still be told apart. A file
   that is none of the three is just "MIU". The file name stays on the tab's tooltip. */
const EMPTY={miu:"MIU",rfds:"RFDS"};
function tabTitle(t,d){
  const w=d.defaultView, site=((d.getElementById("s_site")||{}).value||"").trim().toUpperCase();
  let kind="";
  try{
    if(t.tool==="miu"){ kind=(typeof w.miuDocKind==="function"&&w.miuDocKind())||""; }
    else{
      const tag=d.getElementById("detectTag"), band=d.getElementById("detectBanner");
      const s=(band&&band.classList.contains("show")&&tag&&tag.textContent||"").trim();
      kind=/PRELIM/i.test(s)?"Preliminary RFDS":/FINAL/i.test(s)?"Final RFDS":"RFDS";
    }
  }catch(e){}
  if(!kind)return EMPTY[t.tool];
  return site&&site.length<=24?kind+" · "+site:kind;
}
const PILL=["height","boxSizing","borderRadius","paddingTop","paddingRight","paddingBottom","paddingLeft","fontFamily",
  "fontSize","fontWeight","letterSpacing","textTransform","background","color","boxShadow","borderTop","borderRight","borderBottom","borderLeft"];
function closeMenu(){ live().forEach(t=>{ const m=tdoc(t).getElementById("modeMenu"); if(m)m.remove(); }); }
function openMenu(d,anchor){
  closeMenu();
  const r=anchor.getBoundingClientRect(), m=d.createElement("div"); m.id="modeMenu"; m.setAttribute("role","menu");
  [["miu","New Mark It Up tab","Any PDF"],["rfds","New RFDS tab","The RFDS redlining tool"]].forEach(([tool,label,sub])=>{
    const b=d.createElement("button"); b.type="button"; b.dataset.tool=tool; b.setAttribute("role","menuitem");
    b.innerHTML="<i></i><span></span>"; b.querySelector("span").innerHTML=label+"<small>"+sub+"</small>";
    b.addEventListener("click",ev=>{ ev.preventDefault(); ev.stopPropagation(); closeMenu();
      if(WS.busy)return; WS.busy=true; reflectSwitches();
      openTab(tool).finally(()=>{ WS.busy=false; reflectSwitches(); }); });
    m.appendChild(b);
  });
  d.body.appendChild(m);
  const h=m.getBoundingClientRect().height;
  m.style.left=Math.round(r.left)+"px"; m.style.top=Math.round(r.top-h-8)+"px";
  try{ m.querySelector("button").focus(); }catch(e){}
}
function stripInto(t,list,left){
  const d=tdoc(t); if(!d||!d.body)return;
  let bar=d.getElementById("modeTabs");
  if(!bar){ bar=d.createElement("div"); bar.id="modeTabs"; bar.setAttribute("role","tablist"); bar.setAttribute("aria-label","Open tabs"); d.body.appendChild(bar); }
  const logb=d.getElementById("logBtn"), lr=logb&&logb.getBoundingClientRect();
  const cs=logb&&d.defaultView.getComputedStyle(logb);
  const dressPill=b=>{ if(cs)PILL.forEach(p=>{ try{ b.style[p]=cs[p]; }catch(e){} }); };
  bar.innerHTML="";
  const many=list.length>1;
  if(many)list.forEach(x=>{
    const on=x.id===t.id;
    const b=d.createElement("button"); b.type="button"; b.className="mtab"+(on?" on":""); b.dataset.tool=x.tool; b.dataset.tab=x.id;
    /* v1.102 — a tab this strip has not shown before slides in */
    d.__wsSeen=d.__wsSeen||new Set(); if(d.__wsSeen.size&&!d.__wsSeen.has(x.id))b.classList.add("enter"); d.__wsSeen.add(x.id);
    b.setAttribute("role","tab"); b.setAttribute("aria-selected",on?"true":"false");
    b.title=NAME[x.tool]+" — "+x.title+(x.name!==NAME[x.tool]?"\n"+x.name:"");
    b.innerHTML='<i></i><b></b><span class="mx" role="button" aria-label="Close tab" title="Close tab">×</span>';
    b.querySelector("b").textContent=x.title;
    dressPill(b);
    /* the tool's tone over the pill's own surface — stronger on the tab you are in */
    if(cs)b.style.background="color-mix(in srgb, var(--tone) "+(on?"30%":"18%")+", "+cs.backgroundColor+")";
    /* neumorphism, as the rest of the chrome (6fi): every tab is raised like the log pill it copies, and
       the tab you are in is pressed in — the same light and shade, turned inward */
    if(on)b.style.boxShadow="inset var(--emb-id,2px) var(--emb-id,2px) var(--emb-ib,4px) var(--emb-page-lo, var(--emb-lo, rgba(0,0,0,.35))),"+
      "inset calc(var(--emb-id,2px) * -1) calc(var(--emb-id,2px) * -1) var(--emb-ib,4px) var(--emb-page-hi, var(--emb-hi, rgba(255,255,255,.06)))";
    b.addEventListener("click",ev=>{ ev.preventDefault(); ev.stopPropagation();
      if(ev.target.closest(".mx"))return closeTab(x.id);
      if(!on)activate(x.id); });
    b.addEventListener("auxclick",ev=>{ if(ev.button===1){ ev.preventDefault(); closeTab(x.id); } });
    bar.appendChild(b);
  });
  const p=d.createElement("button"); p.type="button"; p.className="mtab mplus"; p.innerHTML="<b>+</b>";
  p.title="New tab — Mark It Up or RFDS"; p.setAttribute("aria-label","New tab"); dressPill(p);
  p.style.paddingLeft=p.style.paddingRight="0"; if(lr)p.style.width=Math.round(lr.height)+"px";
  p.addEventListener("click",ev=>{ ev.preventDefault(); ev.stopPropagation();
    if(d.getElementById("modeMenu"))closeMenu(); else openMenu(d,p); });
  bar.appendChild(p);
  bar.dataset.left=left; placeStrip(d,left);
}
/* v87 — THE STRIP SITS ON THE LOG PILL'S LINE, EXACTLY. Ced: "why isn't it aligned on logs". It took its
   bottom from innerHeight − the pill's bottom, and innerHeight counts a horizontal scrollbar while a
   fixed element's `bottom` does not — so whenever the sheet was wide enough to scroll sideways (zoomed in,
   as in Ced's capture) the tabs rode a scrollbar's height above the pill. Now the strip takes the pill's
   OWN computed bottom (and its height), and is re-placed on every poll, not only when a tab changes.
   And nothing may cover it: it sits above the selection bar, the pager and the notices, which are lifted
   clear of it (--ws-lift, CHILD_CSS) while it is on screen. */
function placeStrip(d,left){
  const bar=d&&d.getElementById("modeTabs"), logb=d&&d.getElementById("logBtn"); if(!bar)return;
  const lr=logb&&logb.getBoundingClientRect();
  if(lr&&lr.width){
    const cs=d.defaultView.getComputedStyle(logb);
    /* v87 — Ced: "the shadows are also not showing well on tabs". The strip scrolls sideways when there
       are many tabs, so it clips — and it was exactly a pill high, which cut every tab's shadow off at
       its edges. It now carries a margin of room on every side (PADX/PADY) for the shadow to fall into,
       and is moved out by the same amount so the pills themselves stay on the log pill's line. */
    const PADX=14, PADY=12;
    const lx=(left!=null?left:Math.round(lr.right+8)), by=parseFloat(cs.bottom)||12;
    const L=(lx-PADX)+"px", B=(by-PADY)+"px", H=(Math.round(lr.height)+PADY*2)+"px";
    if(bar.style.padding!==PADY+"px "+PADX+"px")bar.style.padding=PADY+"px "+PADX+"px";
    if(bar.style.left!==L)bar.style.left=L;
    if(bar.style.bottom!==B)bar.style.bottom=B;
    if(bar.style.height!==H)bar.style.height=H;
    const mw="calc(100vw - "+(lx+16-PADX)+"px)"; if(bar.style.maxWidth!==mw)bar.style.maxWidth=mw;
    /* how far a bottom-docked bar has to rise to clear the strip: the strip's top, from the window's foot */
    const lift=by+lr.height+8;
    d.documentElement.style.setProperty("--ws-lift",lift+"px");
  } else { bar.style.left="96px"; bar.style.bottom="12px"; }
  d.documentElement.classList.toggle("ws-tabs",!bar.hidden&&bar.childElementCount>0);
}
/* =================================================================================================
   v94 — THE DOCUMENT GOES TO ITS TOOL. Ced: "auto read the pdf, if it is an rfds, auto change to rfds,
   otherwise, if it isnt rfds, go to miu". When a tab finishes reading a newly opened PDF, its name and
   first pages are read (_miuHandoff, in both tools): an RFDS opened in Mark It Up moves to an RFDS tab,
   and anything else opened in an RFDS tab moves to Mark It Up. The move reuses an empty tab of the right
   tool or opens one, hands it the same file, and closes the tab it was opened in. A document that already
   carries marks is never moved, nor one whose pages have no text to read (a scan) and no RFDS in its name.
   ================================================================================================= */
const RFDS_MARKS=[/RFDS\s*DETAILS/i,/DESIGN\s*SUMMARY/i,/RF\s*INVENTORY/i,/PORT\s*LEVEL/i,/EQUIPMENT\s*IN\s*CALC/i,
  /RF\s*DATA\s*SHEET|RADIO\s*FREQUENCY\s*DATA\s*SHEET/i,/ANTENNA\s*POSITION/i,/ATOLL/i,/\bRFDS\b/i];
const OTHER_DOC=/MOUNT\s+(?:STRUCTURAL\s+)?ANALYS[IE]S|STRUCTURAL\s+ANALYS[IE]S|CONSTRUCTION\s+DRAWINGS?|TOWER\s+ANALYSIS/i;
/* why a document was read the way it was — written to the tab's log, so a wrong call can be reported */
/* v97 — Ced: "they should read it by the pdf name". The name decides first, either way: RFDS (or RF Data
   Sheet) anywhere in it makes it an RFDS; a name that says mount analysis, structural analysis or
   construction drawings (MA, SA, CD) makes it not one. Only a name that says neither is read from its pages. */
const NOT_RFDS_NAME=/MOUNT\s*(?:STRUCTURAL\s*)?(?:ANALYS|MAPPING|MOD)|STRUCTURAL|TOWER\s*ANALYS|CONSTRUCTION|DRAWINGS?|(^|[^A-Z0-9])(MA|SA|CDS?|ZDS?)([^A-Z0-9]|$)/i;
function rfdsVerdict(h){
  const nm=String(h.name||"").replace(/\.pdf$/i,"").replace(/[_.\-]+/g," ");
  if(/RFDS|RF\s*DATA\s*SHEET/i.test(nm))return {rf:true,why:"RFDS in the file name"};
  if(NOT_RFDS_NAME.test(nm))return {rf:false,why:"the file name says another document type"};
  const first=String(h.text||"").split("\n")[0]||"";
  const hits=RFDS_MARKS.filter(rx=>rx.test(h.text)).map(rx=>String(rx.source).slice(0,24));
  if(OTHER_DOC.test(first)&&hits.length<4)return {rf:false,why:"cover page names another document type"};
  return {rf:hits.length>=2,why:hits.length+" RFDS marker(s) in the first pages"+(hits.length?" ("+hits.join(", ")+")":"")};
}
function isRfdsDoc(h){ return rfdsVerdict(h).rf; }
function textless(h){ return String(h.text||"").replace(/\s+/g,"").length<40; }
let _routing=false;
async function autoRoute(){
  if(_routing||window.__MIU_NOROUTE)return;   /* the test suites pin documents where they put them */
  for(const t of live()){
    if(!t.ready)continue;
    let h=null; try{ const w=twin(t); h=w&&typeof w._miuHandoff==="function"?w._miuHandoff():null; }catch(e){ h=null; }
    if(!h){ t._routeKey=null; continue; }
    const key=h.name+"|"+(h.bytes&&h.bytes.byteLength);
    if(t._routeKey===key)continue;
    /* wait for the first pages' text — but not for ever: a page that never yields text is decided on
       what there is after a few seconds */
    if(!h.ready){ if(t._routeWait!==key){ t._routeWait=key; t._routeSince=Date.now(); }
      if(Date.now()-t._routeSince<4000)continue; }
    t._routeKey=key;
    /* v97 — the whole of the first pages, read from the PDF itself; and a document is routed the first
       time it is seen whatever marks it came in with (Ced: "the miu and rfds still do not read the type
       of pdf uploaded" — an RFDS tab can place its own suggestions as it opens, which v94 took for work) */
    try{ const w=twin(t); if(w&&typeof w._miuHandoffText==="function"){ const full=await w._miuHandoffText(); if(full&&full.length>String(h.text||"").length)h.text=full; } }catch(e){}
    const v=rfdsVerdict(h), rf=v.rf;
    try{ const w=twin(t); w.LOG&&w.LOG("Workspace: read “"+h.name+"” as "+(rf?"an RFDS":"not an RFDS")+" — "+v.why); }catch(e){}
    /* v95 — Ced: "if a non rfds was opened in rfds tool, please go to miu". The RFDS tool is for RFDS
       only, so in an RFDS tab anything that does not read as one goes to Mark It Up — a scan included.
       The other way it is stricter: a scan in Mark It Up stays, since nothing says it is an RFDS. */
    if(!rf&&textless(h)&&t.tool!=="rfds")continue;
    const want=rf?"rfds":"miu";
    if(want===t.tool)continue;
    _routing=true;
    try{ await routeTo(t,want,h,key); }catch(e){ try{ console.warn("autoRoute",e); }catch(_){} }
    finally{ _routing=false; }
    return;
  }
}
/* v1.102 — THE NAME DECIDES BEFORE THE FILE IS OPENED. Both tools open every PDF through their own
   `loadPdf(file)` (the drop zone, the Open button, the file field), so the workspace wraps it in each tab:
   a file whose NAME says it belongs in the other tool is handed straight there — it is never drawn in
   the wrong one — and a tab left empty by the hand-over goes. A name that says nothing opens where it
   was dropped, and autoRoute reads its pages as before. */
function nameRoute(name){
  const nm=String(name||"").replace(/\.pdf$/i,"").replace(/[_.\-]+/g," ");
  if(/RFDS|RF\s*DATA\s*SHEET/i.test(nm))return "rfds";
  if(NOT_RFDS_NAME.test(nm))return "miu";
  return null;
}
function interceptOpen(t){
  const w=twin(t); if(!w||typeof w.loadPdf!=="function"||w.loadPdf.__ws)return;
  const orig=w.loadPdf;
  const wrapped=function(file){
    try{
      if(!window.__MIU_NOROUTE&&file&&typeof file==="object"&&file.name&&!_routing){
        const want=nameRoute(file.name);
        if(want&&want!==t.tool){ handOff(t,want,file); return Promise.resolve(); }
      }
    }catch(e){}
    return orig.apply(this,arguments);
  };
  wrapped.__ws=true; wrapped.__orig=orig; w.loadPdf=wrapped;
}
async function handOff(src,want,file){
  _routing=true;
  try{
    const srcEmpty=!docInfo(src);
    let dst=WS.tabs.find(x=>x!==src&&x.tool===want&&x.ready&&!docInfo(x))||claimSpare(want);
    if(!dst){ dst=await newTab(want); await dst.readyP; }
    if(!dst.ready)return;
    const w=twin(dst); const open=(w.loadPdf&&w.loadPdf.__orig)||w.loadPdf;
    await activate(dst.id);
    try{ await open.call(w,file); }catch(e){ log("hand-off open failed:",e&&e.message||e); }
    try{ w.toast&&w.toast(want==="rfds"?"RFDS — opened in the RFDS tool":"Opened in Mark It Up"); }catch(e){}
    if(srcEmpty&&WS.tabs.length>1)dropTab(src);
    else renderTabs(true);
  } finally { _routing=false; }
}
async function routeTo(src,want,h,key){
  let dst=WS.tabs.find(x=>x!==src&&x.tool===want&&x.ready&&!docInfo(x))||claimSpare(want);
  if(!dst){ dst=await newTab(want); await dst.readyP; }
  if(!dst.ready)return;
  dst._routeKey=key;
  const w=twin(dst), d=tdoc(dst), inp=d&&d.getElementById("file"); if(!w||!inp)return;
  const name=/\.pdf$/i.test(h.name)?h.name:(h.name+".pdf");
  const bytes=(h.bytes.slice?h.bytes.slice(0):h.bytes);
  const f=new w.File([bytes],name,{type:"application/pdf"});
  const dt=new w.DataTransfer(); dt.items.add(f); inp.files=dt.files;
  inp.dispatchEvent(new w.Event("change",{bubbles:true}));
  await activate(dst.id);
  /* the tab it was opened in held only this file, unmarked: it goes */
  dropTab(src);
  try{ w.toast&&w.toast(want==="rfds"?"This is an RFDS — opened in the RFDS tool":"Not an RFDS — opened in Mark It Up"); }catch(e){}
}
let _sig="", _asig="";
function renderTabs(force){
  const L=live();
  const list=WS.tabs.map(t=>{ const i=docInfo(t); return {id:t.id,tool:t.tool,name:i?i.name:NAME[t.tool],title:i?i.title:EMPTY[t.tool]}; });
  const sig=JSON.stringify(list)+"|"+WS.active+"|"+L.map(t=>{ const d=tdoc(t); return d.documentElement.className+"/"+d.body.className; }).join(",")+"|"+innerWidth+"x"+innerHeight;
  if(!force&&sig===_sig)return;
  /* v82 — something changed inside a tab on its own (a document opened, a tool's Home, the ribbon moved):
     line everything up again, not only at the next switch — opening a file re-lays that tab's ribbon */
  _sig=sig;
  /* v84 — re-align only on a STRUCTURAL change. v82 re-aligned on any class change in any tab, and a tab
     flips classes all the time while you work (chromeshow as the ribbon peeks in page view, xscrolling,
     dragging …), so the ribbons were being re-laid under the page every few seconds — and a re-lay that
     briefly shortens the header moves the page: Ced's "sometimes the rfds tool and miu is scrolling on
     its own". Now: a document opened or closed, the ribbon moved or folded, the page list pinned, the
     theme, the window size. */
  const KEEP=/^(nodoc|ribbonright|colmax|railon|chromehide|light|pal-[a-z]+)$/;
  const asig=JSON.stringify(list.map(x=>x.id))+"|"+L.map(t=>{ const d=tdoc(t);
      return [...d.documentElement.classList,...d.body.classList].filter(c=>KEEP.test(c)).sort().join("."); }).join(",")+"|"+innerWidth+"x"+innerHeight;
  const changed=_asig!==""&&asig!==_asig; _asig=asig;
  if(changed&&!force){ alignAll(); setTimeout(()=>{ try{ alignAll(); }catch(e){} },500); }
  /* one spot in every tab: right of the widest log pill, so the strip never shifts by a pixel */
  const left=Math.round(Math.max(0,...L.map(t=>{ const l=tdoc(t).getElementById("logBtn"); const r=l&&l.getBoundingClientRect(); return r&&r.width?r.right:0; })))+8;
  L.forEach(t=>stripInto(t,list,left));
  /* and each tab as wide in one copy as in every other */
  try{
    const rows=L.map(t=>[...tdoc(t).querySelectorAll("#modeTabs .mtab:not(.mplus)")]);
    (rows[0]||[]).forEach((_,i)=>{ const W=Math.ceil(Math.max(...rows.map(r=>r[i]?r[i].getBoundingClientRect().width:0)));
      rows.forEach(r=>{ if(r[i]){ r[i].style.width=W+"px"; } }); });
  }catch(e){}
}

/* v86 — THE TAB WEARS THE MARK ON VERCEL TOO. Ced: "the logo of the tool is not showing in vercel".
   The page's icon <link>s are in shell.html, so in the web build they land in <body>, where browsers do
   not honour an icon — the app has always fixed that itself (claimFavicon, 6fa: move ours into <head>,
   drop any other). Since v81 the page the browser opened is the WORKSPACE and never runs the app, so
   nothing moved them and the tab fell back to /favicon.ico, which Vercel does not have. The workspace
   does the same claim; tabLooks() then swaps the hrefs as you change tools. */
function claimIcon(){
  try{
    const head=document.head||document.getElementsByTagName("head")[0]; if(!head)return;
    const mine=document.getElementById("favIcon"), touch=document.getElementById("favTouch");
    if(!mine||!mine.getAttribute("href"))return;
    document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"]').forEach(l=>{ if(l!==mine&&l.parentNode)l.parentNode.removeChild(l); });
    head.appendChild(mine); if(touch)head.appendChild(touch);
  }catch(e){}
}
/* ---- start ---------------------------------------------------------------------------------------- */
async function start(){
  if(!window.__MIU_SHELL_HTML)return false;
  await miuPanelCss();
  WS.miuHtml=window.__MIU_SHELL_HTML
    .replace(/<script id="pk-(ws|rfds)"[^>]*>[^<]*<\/script>/g,"")
    .replace(/<head([^>]*)>/i,"<head$1><script>window.__MIU_CHILD=1<\/script>");
  window.__MIU_SHELL_HTML=null;
  const st=document.createElement("style"); st.id="wsShellCss"; st.textContent=SHELL_CSS; document.head.appendChild(st);
  claimIcon(); setTimeout(claimIcon,1200);
  const host=document.createElement("div"); host.id="wsHost"; document.body.appendChild(host); WS.host=host;
  let first="miu"; try{ if(localStorage.getItem(MODE_KEY)==="rfds"&&document.getElementById("pk-rfds"))first="rfds"; }catch(e){}
  let t=await newTab(first);
  let ok=await t.readyP;
  if(!ok&&first==="rfds"){ t.frame.remove(); WS.tabs=[]; t=await newTab("miu"); ok=await t.readyP; }
  if(!ok||!tdoc(t)){                       /* cannot reach into a frame here: stand down, boot as before */
    log("frames unavailable — running as a single Mark It Up");
    host.remove(); st.remove(); WS.tabs=[]; return false;
  }
  await activate(t.id,{instant:true,force:true});
  const h=document.documentElement; h.classList.remove("booting");
  setTimeout(()=>{ const b=document.getElementById("boot"); if(b)b.classList.add("gone"); },420);
  let rt=null;
  /* after a resize every tab re-lays its own ribbon on its own timers (colmax, row marks, page column):
     line up once they have settled, and once more a little later in case one of them was slow */
  let rt2=null;
  window.addEventListener("resize",()=>{ clearTimeout(rt); clearTimeout(rt2);
    rt=setTimeout(()=>{ alignAll(); renderTabs(true); },350);
    rt2=setTimeout(()=>{ alignAll(); renderTabs(true); },1100); });
  setInterval(()=>{ try{ autoRoute(); }catch(e){} },600);
  /* v1.102 — once the first tab is up and idle, a spare of each tool is booted behind it */
  setTimeout(()=>{ warmSpare(t.tool==="rfds"?"miu":"rfds"); warmSpare(t.tool); },2500);
  setInterval(()=>{ try{ renderTabs(false); live().forEach(t=>{ const d=tdoc(t), b=d&&d.getElementById("modeTabs");
    if(b)placeStrip(d,b.dataset.left?+b.dataset.left:null); }); }catch(e){} },700);
  window.MIU_WS={tabs:()=>WS.tabs.map(t=>({id:t.id,tool:t.tool,ready:t.ready,active:t.id===WS.active,name:(docInfo(t)||{}).name||null,title:(docInfo(t)||{title:EMPTY[t.tool]}).title})),
    open:openTab,activate,close:closeTab,toggle:toggleTool,doc:id=>tdoc(byId(id)),win:id=>twin(byId(id)),active:()=>WS.active};
  return true;
}
window.MIU_WS_START=start;
})();
