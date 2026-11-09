
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
  return {name:(f&&f.textContent||"").trim()||(n&&n.value||"").trim()||"Untitled.pdf"};
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
    b.setAttribute("role","tab"); b.setAttribute("aria-selected",on?"true":"false");
    b.title=NAME[x.tool]+" — "+x.name;
    b.innerHTML='<i></i><b></b><span class="mx" role="button" aria-label="Close tab" title="Close tab">×</span>';
    b.querySelector("b").textContent=x.name;
    dressPill(b);
    /* the tool's tone over the pill's own surface — stronger on the tab you are in */
    if(cs){ const tone=x.tool==="rfds"?"#3d7bfd":"#fa3237";
      b.style.background="color-mix(in srgb, "+tone+" "+(on?"22%":"13%")+", "+cs.backgroundColor+")"; }
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
  if(lr&&lr.width){ bar.style.left=left+"px"; bar.style.bottom=Math.round(d.defaultView.innerHeight-lr.bottom)+"px";
    bar.style.height=Math.round(lr.height)+"px"; bar.style.maxWidth="calc(100vw - "+(left+16)+"px)"; }
  else { bar.style.left="96px"; bar.style.bottom="12px"; }
}
let _sig="", _asig="";
function renderTabs(force){
  const L=live();
  const list=WS.tabs.map(t=>{ const i=docInfo(t); return {id:t.id,tool:t.tool,name:i?i.name:NAME[t.tool]}; });
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
  const asig=JSON.stringify(list.map(x=>[x.id,x.name]))+"|"+L.map(t=>{ const d=tdoc(t);
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
  setInterval(()=>{ try{ renderTabs(false); }catch(e){} },700);
  window.MIU_WS={tabs:()=>WS.tabs.map(t=>({id:t.id,tool:t.tool,ready:t.ready,active:t.id===WS.active,name:(docInfo(t)||{}).name||null})),
    open:openTab,activate,close:closeTab,toggle:toggleTool,doc:id=>tdoc(byId(id)),win:id=>twin(byId(id)),active:()=>WS.active};
  return true;
}
window.MIU_WS_START=start;
})();
