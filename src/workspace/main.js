
/* ---- tabs ----------------------------------------------------------------------------------------- */
const WS={tabs:[],active:null,seq:0,nid:0,z:10,host:null,miuHtml:null,rfdsHtml:null,busy:false};
const tdoc=t=>{ try{ return t&&t.frame&&t.frame.contentDocument; }catch(e){ return null; } };
const twin=t=>{ try{ return t&&t.frame&&t.frame.contentWindow; }catch(e){ return null; } };
const live=()=>WS.tabs.filter(t=>t.ready&&tdoc(t));
const byId=id=>WS.tabs.find(t=>t.id===id);
const recent=tool=>WS.tabs.filter(t=>t.tool===tool).sort((a,b)=>b.used-a.used)[0]||null;

function inflateBlob(id){
  const n=document.getElementById(id); if(!n)return Promise.reject(new Error("no "+id+" block"));
  const b=atob(n.textContent.trim()); const u=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
    .then(buf=>new TextDecoder().decode(buf));
}
/* the rules Mark It Up's stylesheet has for its panel and the stamp card, kept whole (with any @media
   around them) — read with the browser's own CSS parser, so nothing is guessed about the syntax */
let MIU_VAR_DEFS=null;
/* the variable block for one tab: only what that tab does not already define for itself — a variable
   both tools share (--panel, --ink …) keeps the tab's own value, so the card sits in the tab's theme */
function cardVarsFor(d){
  if(!MIU_VAR_DEFS)return "";
  const cs=d.defaultView.getComputedStyle(d.documentElement);
  const miss=new Set([...MIU_VAR_DEFS.want].filter(n=>!cs.getPropertyValue(n).trim()));
  let out="";
  MIU_VAR_DEFS.defs.forEach(x=>{ const keep=x.decl.filter(([n])=>miss.has(n)); if(!keep.length)return;
    const sel=x.parts.map(p=>{ const h=(p===":root"||p==="html")?"":p; return [h+" #maPanel",h+" .cop-cal"].map(y=>y.trim()).join(","); }).join(",");
    const body=sel+"{"+keep.map(([n,v])=>n+":"+v).join(";")+"}";
    out+=x.media?("@media "+x.media+"{"+body+"}\n"):(body+"\n"); });
  return out;
}
async function miuPanelCss(){
  try{
    const txt=await inflateBlob("pk-css");
    const sh=new CSSStyleSheet(); sh.replaceSync(txt.replace(/@import[^;]+;/g,""));
    const KEYS=["#maPanel",".mk-head",".ma-",".cop-","#maBody","#maTitle","#maSite","#maClose","#maFoot","#maScope","#maRange",
                "#copStatus","#copGc","#copPoc","#copDate","#copPlace"];
    const hit=sel=>KEYS.some(k=>sel.indexOf(k)>=0);
    const walk=rules=>{ let out="";
      for(const r of rules){
        if(r.selectorText!==undefined){ if(hit(r.selectorText))out+=r.cssText+"\n"; }
        else if(r.cssRules&&r.media){ const inner=walk(r.cssRules); if(inner)out+="@media "+r.media.mediaText+"{"+inner+"}\n"; }
        else if(r.cssRules&&r.conditionText!==undefined){ const inner=walk(r.cssRules); if(inner)out+="@supports "+r.conditionText+"{"+inner+"}\n"; }
        else if(r.type===7&&/cop|ma[A-Z]/.test(r.name||""))out+=r.cssText+"\n";   /* @keyframes for the progress bar */
      }
      return out; };
    MIU_PANEL_CSS=walk(sh.cssRules);
    /* and the scales those rules are written in (type, radius, heights, tints — Mark It Up's ds.css, v60),
       which the RFDS build does not define; scoped to the card so nothing else in the tab changes */
    const tok=[];
    const grab=rules=>{ for(const r of rules){ if(r.selectorText===":root"&&r.style){ for(let i=0;i<r.style.length;i++){ const n=r.style[i];
        if(/^--(fs-|r-|h-|e-|t-|ease|tint-|focus)/.test(n))tok.push(n+":"+r.style.getPropertyValue(n)); } } } };
    grab(sh.cssRules);
    if(tok.length)MIU_PANEL_CSS="#maPanel,.cop-cal{"+tok.join(";")+"}\n"+MIU_PANEL_CSS;
    /* v84 — AND THE VARIABLES THOSE RULES READ. On any theme but Ontel the card is painted from Mark It
       Up's floating-panel variables (--fp-card, --fp-btn, --fp-ink …), which Mark It Up defines on <html>
       per palette and the RFDS build never defines at all — so in an RFDS tab the card came out with no
       background, the page showing through it (Ced's screenshot). Every variable the card's rules read,
       and every variable THOSE read, is copied from wherever Mark It Up's stylesheet sets it on html /
       :root (palette and day/night conditions kept), re-aimed at the card, in Mark It Up's own order. */
    try{
      const want=new Set((MIU_PANEL_CSS.match(/var\(--[\w-]+/g)||[]).map(x=>x.slice(4)));
      const defs=[]; const rootish=p=>/^(:root|html)([.:#\[][^\s>+~]*)?$/.test(p.trim());
      const scan=(rules,media)=>{ for(const r of rules){
        if(r.selectorText!==undefined&&r.style){
          const parts=r.selectorText.split(",").map(x=>x.trim()); if(!parts.every(rootish))continue;
          const decl=[]; for(let i=0;i<r.style.length;i++){ const n=r.style[i]; if(n.startsWith("--"))decl.push([n,r.style.getPropertyValue(n)]); }
          if(decl.length)defs.push({parts,decl,media});
        } else if(r.cssRules&&r.media)scan(r.cssRules,r.media.mediaText); } };
      scan(sh.cssRules,null);
      /* the closure: a variable the card needs pulls in the variables its own definitions use */
      let grew=true;
      while(grew){ grew=false; defs.forEach(d=>d.decl.forEach(([n,v])=>{ if(want.has(n))(v.match(/var\(--[\w-]+/g)||[]).forEach(x=>{ const k=x.slice(4); if(!want.has(k)){ want.add(k); grew=true; } }); })); }
      MIU_VAR_DEFS={defs,want};
      log("stamp card variables:",want.size);
    }catch(e){ log("card variables not copied:",e&&e.message||e); }
    log("stamp card css:",MIU_PANEL_CSS.length,"chars");
  }catch(e){ log("could not read Mark It Up's panel css:",e&&e.message||e); }
}
async function sourceFor(tool){
  if(tool==="miu")return WS.miuHtml;
  /* the RFDS artifact build is a FRAGMENT; in a frame we are its host, so it gets the doctype a host gives */
  if(!WS.rfdsHtml)WS.rfdsHtml="<!doctype html>\n"+await inflateBlob("pk-rfds");
  return WS.rfdsHtml;
}

/* ---- the look: one for every tab -------------------------------------------------------------------
   v79's rule, now for any number of tabs: the tab you go TO takes every shared preference of the tab
   you LEAVE — day/night/system, colour theme, your own colours and saved ones, the tune dials, the
   ribbon's side and width, the page-column width, and whether the page list is pinned. Read from the
   leaving tab's saved preferences (ma.* or rfds.* — one localStorage), applied through the arriving
   tab's own functions so it saves them as its own. Two Mark It Up tabs share ma.*, so "what is saved"
   cannot tell them apart; each tab remembers the look last applied to it instead. */
const LOOK_KEYS=["themeMode","paletteId","palette","customPair","themeTune","ribbonSide","ribbonWidth","colWidth","customThemes"];
const RIB_KEYS=["ribbonSide","ribbonWidth","colWidth","customThemes"];
function lookOf(t){
  const d=tdoc(t); if(!d)return null;
  const L={}; const g=k=>{ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  LOOK_KEYS.forEach(k=>L[k]=g(PRE[t.tool]+"."+k));
  L.theme=g(THEME_K[t.tool]);
  L.light=d.documentElement.classList.contains("light");
  L.rail=!!(d.body&&d.body.classList.contains("railon"));
  /* v83 — and the view switches (page view, two-up): with them out of step the ribbon compacts in one tab
     and not the other, and the MiU|RFDS switch moves when you cross */
  const on=id=>{ const b=d.getElementById(id); return !!(b&&b.classList.contains("on")); };
  L.doc=!d.documentElement.classList.contains("nodoc"); L.pv=on("pageViewBtn"); L.facing=on("facingBtn");
  return L;
}
function seedLook(tool,L){
  if(!L)return;
  try{ LOOK_KEYS.forEach(k=>{ const v=L[k]; if(v==null)localStorage.removeItem(PRE[tool]+"."+k); else localStorage.setItem(PRE[tool]+"."+k,v); });
       if(L.theme!=null)localStorage.setItem(THEME_K[tool],L.theme); }catch(e){}
}
function applyLook(t,L){
  const w=twin(t), d=tdoc(t); if(!w||!d||!L)return;
  const J=v=>{ try{ return JSON.parse(v||"null"); }catch(e){ return null; } };
  const step=(what,fn)=>{ try{ fn(); }catch(e){ log(what+" not matched:",e&&e.message||e); } };
  const sig=JSON.stringify(Object.assign({},L,{rail:undefined,pv:undefined,facing:undefined,doc:undefined}));
  if(t.applied!==sig){
    step("day/night",()=>{ w.applyThemeMode(L.themeMode||(L.light?"light":"dark")); });
    step("colour theme",()=>{ w.setPaletteById(L.paletteId||"pal-ontel");
      const c=J(L.customPair); if(c&&c.a)w.applyCustom(c.a,c.d); });
    step("tune",()=>{ const u=J(L.themeTune)||{}; w.setThemeTune("sat",u.sat!=null?u.sat:100); w.setThemeTune("bri",u.bri!=null?u.bri:100); });
    step("ribbon",()=>{ RIB_KEYS.forEach(k=>{ const v=L[k];
        if(v==null)localStorage.removeItem(PRE[t.tool]+"."+k); else localStorage.setItem(PRE[t.tool]+"."+k,v); });
      w.restoreRibbonPrefs(); });
    t.applied=sig;
  }
  step("view switches",()=>{
    if(!L.doc||d.documentElement.classList.contains("nodoc"))return;
    [["pageViewBtn","pv"],["facingBtn","facing"]].forEach(([id,k])=>{ const b=d.getElementById(id);
      if(b&&!b.disabled&&b.classList.contains("on")!==!!L[k])b.click(); });
  });
  /* v87 — the page list only follows across when BOTH tabs hold a document. Ced: "when changing tabs or
     closing one to home, the other tool closes the page list." An empty tab (the opening screen, or one
     just sent Home) has no pinned list to speak of — `railon` is off there — and copying that "off" onto
     the next tab shut its page list every time you came from an empty one. */
  step("page list",()=>{
    if(!L.doc||d.documentElement.classList.contains("nodoc"))return;
    const on=d.body.classList.contains("railon");
    if(on!==L.rail){ const b=d.getElementById("railToggle"); if(b&&!b.disabled)b.click(); } });
}

/* ---- dressing a tab: the switch, the logo switch, Shift+M ------------------------------------------ */
function swLabel(b,rfds){
  b.setAttribute("role","switch"); b.setAttribute("aria-checked",rfds?"true":"false");
  b.setAttribute("aria-label",rfds?"RFDS mode is on":"Mark It Up is on");
  b.title=rfds?"RFDS is on — click for Mark It Up (Shift+M)":"Mark It Up is on — click for RFDS (Shift+M)";
}
function makeSwitch(d,id,cls,rfds){
  const b=d.createElement("button"); b.type="button"; b.id=id; b.className="btn sm thm-tog mode-tog"+(cls?" "+cls:"");
  b.innerHTML='<span class="thm-tr"><span class="mt-i mt-miu"><i></i></span><span class="mt-i mt-rfds"><i></i></span><span class="thm-k"></span></span>';
  swLabel(b,rfds); return b;
}
const typing=x=>!!(x&&(x.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName||"")));
function dress(t){
  const d=tdoc(t); if(!d||!d.head||d.__wsDressed)return;
  d.__wsDressed=true;
  const st=d.createElement("style"); st.id="wsCss"; st.textContent=CHILD_CSS+(t.tool==="rfds"?PARITY_CSS:""); d.head.appendChild(st);
  if(t.tool==="rfds"){
    /* Mark It Up's COP stamp, in place of the RFDS build's own (v83) */
    if(MIU_PANEL_CSS){ const c=d.createElement("style"); c.id="wsMiuPanelCss"; c.textContent=cardVarsFor(d)+MIU_PANEL_CSS; d.head.appendChild(c); }
    try{ const sc=d.createElement("script"); sc.textContent=RFDS_STAMP_JS; d.head.appendChild(sc); }catch(e){ log("stamp card not added:",e&&e.message||e); }
  }
  const flip=ev=>{ if(ev){ ev.preventDefault(); ev.stopPropagation(); } toggleTool(); };
  const rfds=t.tool==="rfds";
  if(rfds){
    /* the RFDS build has no switch of its own: put one where Mark It Up carries it — after the theme
       picker on the ribbon, after the palette button on the quick bar */
    const put=(sel,id,cls)=>{ if(d.getElementById(id))return; const x=d.getElementById(sel); if(!x)return;
      const after=x.closest(".keep")||(id==="miniMode"&&d.getElementById("miniPal"))||x;
      after.parentNode.insertBefore(makeSwitch(d,id,cls,true),after.nextSibling); };
    put("themeBtn","modeBtn",""); put("miniTheme","miniMode","mb-thm");
  }
  ["modeBtn","miniMode"].forEach(id=>{ const b=d.getElementById(id); if(!b)return; swLabel(b,rfds);
    b.addEventListener("click",flip,true); });
  /* the logo is a switch too (v79) */
  const wm=d.querySelector("h1.logo .logo-wm");
  if(wm&&!wm.querySelector(".logo-swap")){
    const label=rfds?"Switch to Mark It Up":"Switch to RFDS";
    wm.removeAttribute("aria-hidden"); wm.classList.add("mode-logo"); wm.title=label;
    const b=d.createElement("button"); b.type="button"; b.className="logo-swap"; b.setAttribute("aria-label",label);
    wm.appendChild(b); wm.addEventListener("click",flip);
  }
  d.addEventListener("keydown",e=>{
    if(e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.key==="M"||e.key==="m")&&!typing(e.target)){ flip(e); return; }
    if(e.key==="Escape")closeMenu();
  },true);
  d.addEventListener("pointerdown",e=>{ if(!(e.target.closest&&e.target.closest("#modeMenu,.mplus")))closeMenu(); },true);
  /* Help names the build of each tool this workspace carries */
  if(!rfds){
    const add=()=>setTimeout(()=>{ try{ const v=d.querySelector("#helpModal .miu-ver"), n=document.getElementById("pk-rfds");
      if(v&&n&&!/RFDS build/.test(v.textContent))v.textContent+=" · RFDS build "+(n.dataset.sha||"?")+(n.dataset.embedded?" (embedded "+n.dataset.embedded+")":""); }catch(e){} },0);
    d.addEventListener("click",e=>{ if(e.target&&e.target.closest&&e.target.closest("#helpBtn"))add(); },true);
  }
}
function reflectSwitches(){
  live().forEach(t=>{ const d=tdoc(t); ["modeBtn","miniMode"].forEach(id=>{ const b=d.getElementById(id); if(b){
    b.classList.toggle("mode-busy",!!WS.busy); } }); });
}

/* ---- making, showing and closing tabs ------------------------------------------------------------- */
function whenReady(t,ms){
  return new Promise(res=>{
    const t0=Date.now();
    const tick=()=>{
      if(!t.frame.isConnected)return res(false);
      const d=tdoc(t), w=twin(t);
      if(t.frame&&t.loaded&&!d)return res(false);                 /* cross-origin: unreachable */
      const up=d&&w&&d.documentElement&&!d.documentElement.classList.contains("booting")&&typeof w.loadPdf==="function";
      if(up)return res(true);
      if(Date.now()-t0>(ms||30000))return res(false);
      setTimeout(tick,70);
    };
    tick();
  });
}
async function newTab(tool){
  const from=byId(WS.active);
  seedLook(tool,from&&lookOf(from));               /* so it boots in the right look: no flash of another */
  const t={id:"t"+(++WS.nid),tool,frame:null,ready:false,loaded:false,used:0,applied:null};
  const fr=document.createElement("iframe");
  fr.title=tool==="rfds"?"RFDS Redlining Tool":"Mark It Up";
  fr.setAttribute("allow","clipboard-read; clipboard-write; fullscreen");
  fr.dataset.tab=t.id; t.frame=fr;
  WS.tabs.push(t); WS.host.appendChild(fr);
  t.readyP=new Promise(res=>{
    fr.addEventListener("load",async()=>{
      /* every load — including a tool's own Home, which reloads its frame — dresses it again */
      t.loaded=true; t.ready=false; t.applied=null;
      const ok=await whenReady(t);
      t.ready=ok;
      /* a tab reloaded by its own Home boots from its own saved look — the latest — so nothing is
         re-applied to it (that would put back whatever the look was at the last switch); only this tab
         reloads, every other tab and its document are untouched */
      if(ok){ dress(t); if(WS.active===t.id){ alignAll(); renderTabs(true); } else renderTabs(true); }
      res(ok);
    });
  });
  fr.srcdoc=await sourceFor(tool);
  return t;
}
let _fadeT=null;
async function activate(id,opts){
  opts=opts||{};
  const to=byId(id), from=byId(WS.active);
  if(!to||(to===from&&!opts.force))return;
  if(!to.ready){ WS.busy=true; reflectSwitches(); await to.readyP; WS.busy=false; reflectSwitches();
    if(!to.ready){ log("tab did not come up"); return; } }
  /* the arriving tab takes the leaving tab's look, and both ribbons are lined up, BEFORE it fades in */
  if(from&&from.ready)WS.look=lookOf(from);
  applyLook(to,WS.look);
  WS.active=to.id; to.used=++WS.seq;
  alignAll(); renderTabs(true);
  /* a cross-fade: the arriving frame comes up over the leaving one, which stays drawn until it is covered */
  clearTimeout(_fadeT);
  WS.tabs.forEach(t=>{ if(t!==to&&t!==from)t.frame.classList.remove("on","leaving"); });
  to.frame.classList.toggle("instant",!!opts.instant);
  to.frame.style.zIndex=String(++WS.z);
  void to.frame.offsetWidth;
  to.frame.classList.add("on");
  if(from&&from!==to){ from.frame.classList.remove("on"); from.frame.classList.add("leaving");
    _fadeT=setTimeout(()=>{ from.frame.classList.remove("leaving"); },opts.instant?0:380); }
  try{ localStorage.setItem(MODE_KEY,to.tool); }catch(e){}
  tabLooks(to);
  try{ to.frame.focus(); twin(to).focus(); }catch(e){}
}
async function openTab(tool){ const t=await newTab(tool); await activate(t.id); return t; }
async function toggleTool(){
  if(WS.busy)return;
  const cur=byId(WS.active), other=cur&&cur.tool==="rfds"?"miu":"rfds";
  const t=recent(other);
  if(t)return activate(t.id);
  WS.busy=true; reflectSwitches();
  try{ await openTab(other); }finally{ WS.busy=false; reflectSwitches(); }
}
async function closeTab(id){
  const t=byId(id); if(!t||WS.tabs.length<2)return;
  const d=tdoc(t), info=docInfo(t);
  if(info){
    const ask=twin(byId(WS.active));
    let ok=true;
    try{
      if(ask&&typeof ask.uiConfirm==="function"){
        ok=(await ask.uiConfirm({title:"Close this tab?",
          message:"“"+info.name+"” will be closed. Export first if you want to keep its redlines.",
          buttons:[{id:"no",label:"Keep it open",primary:true},{id:"yes",label:"Close tab",danger:true}]}))==="yes";
      } else ok=window.confirm("Close “"+info.name+"”? Export first if you want to keep its redlines.");
    }catch(e){}
    if(!ok)return;
  }
  const wasActive=WS.active===id;
  if(wasActive){
    const next=WS.tabs.filter(x=>x!==t&&x.ready).sort((a,b)=>b.used-a.used)[0];
    if(next)await activate(next.id);
  }
  WS.tabs=WS.tabs.filter(x=>x!==t);
  setTimeout(()=>{ try{ t.frame.remove(); }catch(e){} },420);
  alignAll(); renderTabs(true);
}
/* the browser tab wears the tool you are in */
function tabLooks(t){
  const d=tdoc(t); if(!d)return;
  try{ document.title=d.title||NAME[t.tool];
    ["favIcon","favTouch"].forEach(id=>{ const a=document.getElementById(id), b=d.getElementById(id);
      if(a&&b&&b.getAttribute("href"))a.setAttribute("href",b.getAttribute("href")); }); }catch(e){}
}
