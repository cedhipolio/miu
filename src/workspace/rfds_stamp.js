/* v83 — THE COP STAMP, MARK IT UP'S WAY, IN AN RFDS TAB. Ced: "make the stamping the same process and ui
   on both. use the stamping on MiU as it is more optimized. also apply the same color."
   Runs INSIDE an RFDS tab (the workspace injects it), so it sees the RFDS build's own stamp engine —
   stampSpec, addStamp, stampApplyFields — and drives it from Mark It Up's card: the same panel, the same
   fields in the same order, the same preloaded contractor and POC (shared with Mark It Up, "ma.copStamp"),
   the same calendar, the same scope (every page / this page / a range), the same one button that stamps
   the pages that have none and brings the ones that do up to the card, with the same progress bar, and
   the same Switch REDLINED ↔ AS-BUILT. The RFDS build's own popover is retired. The look is Mark It Up's
   own stylesheet rules for that card, lifted out of its CSS by the workspace. If a future RFDS build
   drops any of the engine functions this needs, the adapter steps aside and the build's own stamp stays. */
(function(){
  "use strict";
  /* v85 — Ced: "no need to prompt the stamp tool on rfds tool after saving rfds". The RFDS build asks,
     1.6s after every export, to open the separate stamp tool — stamping now happens here, on the card,
     before saving, so the prompt is retired (a function declaration, so replacing it on window is enough). */
  try{ if(typeof window.promptStampTool==="function")window.promptStampTool=function(){}; }catch(e){}
  const need=["stampSpec","addStamp","stampApplyFields","allStamps","stampsOn","pushHistory","layoutAnnos","updateRail","updateCount"];
  if(window.__miuStamp||need.some(n=>typeof window[n]!=="function")||typeof S==="undefined")return;
  window.__miuStamp=true;
  const $=id=>document.getElementById(id);
  const PREF="ma.copStamp";
  const GCS=(typeof STAMP_GCS!=="undefined"&&STAMP_GCS.length)?STAMP_GCS:[];
  const POCS=(typeof STAMP_POCS!=="undefined"&&STAMP_POCS.length)?STAMP_POCS:[];
  const today=d=>{ d=d||new Date(); return (d.getMonth()+1)+"/"+d.getDate()+"/"+d.getFullYear(); };
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function prefs(){
    let o={}; try{ o=JSON.parse(localStorage.getItem(PREF)||"{}")||{}; }catch(e){}
    return {status:o.status==="AS-BUILT"?"AS-BUILT":"REDLINED", gc:typeof o.gc==="string"?o.gc:"",
            poc:typeof o.poc==="string"?o.poc:"", place:["auto","tr","tl","br","bl"].indexOf(o.place)>=0?o.place:"auto",
            font:o.font, date:today()};
  }
  function savePrefs(f){ try{ const o=JSON.parse(localStorage.getItem(PREF)||"{}")||{};
    Object.assign(o,{status:f.status,gc:f.gc,poc:f.poc,place:f.place}); localStorage.setItem(PREF,JSON.stringify(o)); }catch(e){} }
  const F=prefs();

  /* ---- the panel: Mark It Up's #maPanel, built the way maRenderStampTab builds it ---- */
  const pan=document.createElement("div"); pan.id="maPanel"; pan.setAttribute("aria-hidden","true"); pan.dataset.ma="stamp";
  pan.innerHTML='<div class="mk-head"><b id="maTitle">COP stamp</b><span class="ma-site" id="maSite"></span>'+
    '<button class="btn sm" id="maClose" title="Close (Esc)">✕</button></div><div class="ma-body" id="maBody"></div>';
  document.body.appendChild(pan);
  const body=pan.querySelector("#maBody");
  const sec=document.createElement("div"); sec.className="ma-sec"; body.appendChild(sec);
  const note=t=>{ const p=document.createElement("p"); p.className="ma-note"; p.textContent=t; sec.appendChild(p); return p; };
  const field=html=>{ const w=document.createElement("div"); w.innerHTML=html; sec.appendChild(w); return w; };
  note("The stamp is placed on every page in range and follows this card as you change it — move it or resize it like any other mark.");
  const stW=field('<label class="ma-f"><span>Status</span><select id="copStatus"><option value="REDLINED">REDLINED</option><option value="AS-BUILT">AS-BUILT</option></select></label>');
  const stSel=stW.querySelector("select"); stSel.value=F.status;
  function pick(label,id,items,value){
    const w=document.createElement("div");
    const known=items.indexOf(value)>=0;
    w.innerHTML='<label class="ma-f"><span>'+esc(label)+'</span><select id="'+id+'"></select></label>';
    const sel=w.querySelector("select"); items.forEach(v=>sel.add(new Option(v,v))); sel.add(new Option("Other…","__other__"));
    sel.value=(value&&known)?value:(value?"__other__":items[0]);
    const other=document.createElement("input"); other.type="text"; other.className="ma-in cop-other"; other.placeholder="Type it";
    other.spellcheck=false; other.value=known?"":(value||""); other.style.display=sel.value==="__other__"?"block":"none";
    w.appendChild(other); sec.appendChild(w);
    const read=()=>((sel.value==="__other__")?other.value:sel.value).trim().toUpperCase();
    sel.onchange=()=>{ other.style.display=sel.value==="__other__"?"block":"none"; if(sel.value==="__other__")other.focus(); touched(); };
    other.oninput=()=>touched();
    return {sel,other,read,set(v){ const k=items.indexOf(v)>=0; sel.value=k?v:(v?"__other__":items[0]); other.value=k?"":(v||"");
      other.style.display=sel.value==="__other__"?"block":"none"; }};
  }
  const gc=pick("General contractor","copGc",GCS,F.gc);
  const poc=pick("Point of contact","copPoc",POCS,F.poc);
  const dtW=field('<label class="ma-f cop-hascal"><span>Date</span><input type="text" id="copDate" spellcheck="false">'+
    '<button type="button" class="cop-calbtn" title="Pick the date from a calendar" aria-label="Pick the date from a calendar"></button></label>');
  const dtIn=dtW.querySelector("input"); dtIn.value=F.date;
  const plW=field('<label class="ma-f"><span>Placement</span><select id="copPlace"><option value="auto">Auto — find clear space</option>'+
    '<option value="tr">Top right</option><option value="tl">Top left</option><option value="br">Bottom right</option><option value="bl">Bottom left</option></select></label>');
  const plSel=plW.querySelector("select"); plSel.value=F.place;
  const pv=document.createElement("div"); pv.className="cop-stage"; sec.appendChild(pv);
  const scW=field('<label class="ma-f"><span>Pages</span><select id="maScope"><option value="all">Every page</option>'+
    '<option value="page">The page I am on</option><option value="range">A range…</option></select></label>'+
    '<label class="ma-f" style="display:none"><span>Range</span><input type="text" id="maRange" placeholder="e.g. 1-8, 12, 30-" spellcheck="false"></label>');
  const scSel=scW.querySelector("select"), rgIn=scW.querySelector("#maRange"), rgL=rgIn.closest("label");
  scSel.onchange=()=>{ rgL.style.display=scSel.value==="range"?"":"none"; relabel(); }; rgIn.oninput=relabel;
  const flip=document.createElement("button"); flip.type="button"; flip.className="ma-go"; flip.textContent="Switch REDLINED ↔ AS-BUILT"; sec.appendChild(flip);
  note("The stamp button stamps the pages in range that have none and brings the ones that do up to this card, where they are. With stamps selected, it and Switch act on those only.");
  const foot=document.createElement("div"); foot.id="maFoot"; foot.className="ma-foot";
  foot.innerHTML='<button type="button" class="ma-stampgo"><span class="ma-stampico" aria-hidden="true"></span><span class="ma-stamplbl">Stamp</span><div class="ma-stampsub"></div></button>';
  pan.appendChild(foot);
  const go=foot.querySelector(".ma-stampgo"), lbl=go.querySelector(".ma-stamplbl"), sub=go.querySelector(".ma-stampsub");

  /* ---- what the card says ---- */
  const fields=()=>({status:stSel.value||"REDLINED", gc:gc.read(), poc:poc.read(), date:dtIn.value.trim()||today()});
  function paint(){
    const f=fields(), sp=stampSpec(f,612,792);
    const room=Math.max(120,(pv.clientWidth||290)-24), Z=Math.min(2.4,room/Math.max(1,sp.w));
    pv.innerHTML="";
    const wrap=document.createElement("div"); wrap.className="cop-pvwrap"; wrap.style.height=(sp.h*Z).toFixed(1)+"px";
    const box=document.createElement("div"); box.className="cop-pv";
    box.style.width=(sp.w*Z).toFixed(1)+"px"; box.style.height=(sp.h*Z).toFixed(1)+"px";
    box.style.borderWidth=Math.max(0.5,sp.border*Z).toFixed(2)+"px";
    box.style.fontFamily="Arial, Helvetica, sans-serif"; box.style.setProperty("--cop-pvw","700");
    const lines=[[sp.title,sp.titlePt]].concat(sp.rows.map(r=>[r,sp.rowPt]));
    lines.forEach(([t,pt],i)=>{ const cap=i?sp.cap.r:sp.cap.t, base=sp.baselines[i];
      const d=document.createElement("div"); d.className="cop-pv-l"; d.textContent=t||"—";
      const lh=pt*1.22; d.style.fontSize=(pt*Z).toFixed(2)+"px"; d.style.left=(sp.pad*Z).toFixed(1)+"px";
      d.style.width=((sp.w-sp.pad*2)*Z).toFixed(1)+"px"; d.style.lineHeight=d.style.height=(lh*Z).toFixed(2)+"px";
      d.style.top=((base-cap-(lh-cap)/2)*Z).toFixed(1)+"px"; box.appendChild(d); });
    wrap.appendChild(box); pv.appendChild(wrap);
    let k=1; try{ const P0=S.pages[visiblePageIdx()]||S.pages[0]; if(P0&&typeof stampSheetScale==="function")k=stampSheetScale(P0.w1,P0.h1); }catch(e){}
    const c=document.createElement("div"); c.className="cop-pv-cap";
    c.textContent=sp.w.toFixed(1)+" × "+sp.h.toFixed(1)+" pt on letter · ×"+k.toFixed(2)+" on this sheet"; pv.appendChild(c);
  }
  /* the scope, read the way Mark It Up reads it */
  function scopePages(){
    const n=(S.pages||[]).length, all=[...Array(n).keys()];
    if(scSel.value==="page"){ let p=0; try{ p=visiblePageIdx(); }catch(e){} return [p]; }
    if(scSel.value!=="range")return all;
    const out=new Set();
    String(rgIn.value||"").split(/[,;\s]+/).forEach(t=>{ const m=t.match(/^(\d*)\s*-\s*(\d*)$/);
      if(m){ const a=m[1]?+m[1]:1, b=m[2]?+m[2]:n; for(let i=Math.max(1,a);i<=Math.min(n,b);i++)out.add(i-1); }
      else if(/^\d+$/.test(t)){ const i=+t; if(i>=1&&i<=n)out.add(i-1); } });
    return [...out].sort((a,b)=>a-b);
  }
  const selectedStamps=()=>{ const ids=new Set(); if(S.sel!=null)ids.add(S.sel); try{ (S.selMulti||new Set()).forEach(i=>ids.add(i)); }catch(e){}
    return allStamps().filter(a=>ids.has(a.id)); };
  function plan(){
    const sel=selectedStamps(); if(sel.length)return {update:sel,place:[],selected:true};
    const update=[], place=[];
    scopePages().forEach(pi=>{ const P=S.pages[pi]; if(!P||P.dropped)return; const g=stampsOn(pi); if(g.length)update.push(...g); else place.push(pi); });
    return {update,place,selected:false};
  }
  function relabel(){
    const p=plan();
    const verb=(p.update.length&&!p.place.length)?"Update stamp":(p.place.length&&!p.update.length)?"Stamp":(p.update.length&&p.place.length)?"Stamp & update":"Stamp";
    lbl.textContent=verb;
    sub.textContent=p.selected?(p.update.length+" selected"):[p.place.length?(p.place.length+" to stamp"):"",p.update.length?(p.update.length+" to update"):""].filter(Boolean).join(" · ")||"No pages in range";
    go.title=verb; go.setAttribute("aria-label",verb+" — "+sub.textContent);
    try{ $("maSite").textContent=S.name||""; }catch(e){}
  }
  /* realtime, as in Mark It Up: every stamp in scope follows the card while you type; a burst is one undo */
  let _liveT=0,_burst=0;
  function touched(quiet){
    const f=fields(); savePrefs(Object.assign({},f,{place:plSel.value})); paint(); relabel();
    if(quiet)return;
    clearTimeout(_liveT); _liveT=setTimeout(()=>{
      const p=plan(); const list=p.update; if(!list.length)return;
      const now=Date.now(); if(now-_burst>1200){ try{ pushHistory(); }catch(e){} } _burst=now;
      stampApplyFields(f,list); try{ autosave(); }catch(e){}
    },20);
  }
  [stSel,plSel].forEach(n=>n.addEventListener("change",()=>touched()));
  dtIn.addEventListener("input",()=>touched());

  /* ---- the button: stamp what has none, bring the rest up to the card, with Mark It Up's progress bar ---- */
  function progress(btn){
    btn.querySelectorAll(".cop-prog").forEach(n=>n.remove());
    const ov=document.createElement("span"); ov.className="cop-prog"; ov.setAttribute("aria-hidden","true");
    ov.innerHTML='<span class="cop-progfill"></span><span class="cop-progstamp"></span><span class="cop-progtxt"><span class="cop-progpill"></span></span>';
    btn.appendChild(ov); btn.classList.add("cop-busy");
    const mark=ov.querySelector(".cop-progstamp"), txt=ov.querySelector(".cop-progpill");
    let reduce=false; try{ reduce=matchMedia("(prefers-reduced-motion: reduce)").matches; }catch(e){}
    const set=(k,l)=>{ const p=Math.max(0,Math.min(1,k)); ov.style.setProperty("--p",p.toFixed(4)); txt.textContent=l; ov.classList.toggle("cop-txtleft",p>0.5); };
    set(0,"Getting ready…");
    return {step(i,n,pg){ set(n?i/n:1,(typeof pg==="number"?"Stamping page "+pg:"Updating stamps")+"  —  "+Math.min(i+1,n)+" / "+n);
        if(!reduce){ mark.classList.remove("thump"); void mark.offsetWidth; mark.classList.add("thump"); } },
      done(l){ set(1,"✓ "+(l||"Done")); ov.classList.add("cop-progdone");
        return new Promise(r=>setTimeout(()=>{ ov.classList.add("cop-progout"); setTimeout(()=>{ ov.remove(); btn.classList.remove("cop-busy"); r(); },reduce?0:200); },reduce?200:550)); }};
  }
  go.onclick=async()=>{
    const f=fields();
    if(!f.gc||!f.poc){ setStatus("Pick a general contractor and a point of contact first.",true); return; }
    if(!S.doc||!(S.pages||[]).length){ setStatus("Open a document before stamping.",true); return; }
    const p=plan();
    if(!p.update.length&&!p.place.length){ setStatus("No pages in that range.",true); return; }
    go.disabled=true; const prog=progress(go);
    const nAll=p.place.length+(p.update.length?1:0);
    const beat=()=>new Promise(r=>{ let d=false; const g=()=>{ if(!d){ d=true; r(); } }; try{ requestAnimationFrame(g); }catch(e){} setTimeout(g,30); });
    let placed=0;
    pushHistory();                                   /* the whole run is one undo, as in Mark It Up */
    try{
      if(p.update.length){ prog.step(0,nAll,"stamps"); stampApplyFields(f,p.update); await beat(); }
      let k=p.update.length?1:0;
      const type=(typeof stampDetectType==="function")?stampDetectType(S.name||""):undefined;
      for(const pi of p.place){
        prog.step(k++,nAll,pi+1);
        const a=await addStamp(pi,f,plSel.value,type,null);
        if(a)placed++;
        await beat();
      }
    }finally{ go.disabled=false; }
    try{ if(typeof _stLast!=="undefined")_stLast={status:f.status,gc:f.gc,poc:f.poc,date:f.date,place:plSel.value}; }catch(e){}
    layoutAnnos(); updateRail(); updateCount(); try{ autosave(); }catch(e){}
    const parts=[]; if(placed)parts.push(placed===1?"stamped page "+(p.place[0]+1):"stamped "+placed+" pages");
    if(p.update.length)parts.push("updated "+p.update.length+" stamp"+(p.update.length===1?"":"s"));
    const msg=parts.length?parts.join(" and ").replace(/^./,c=>c.toUpperCase())+".":"Nothing to do.";
    setStatus(msg); try{ await prog.done(parts.join(" · ").replace(/^./,c=>c.toUpperCase())||"Nothing to do"); }catch(e){}
    relabel();
  };
  flip.onclick=()=>{
    const sel=selectedStamps(), list=sel.length?sel:allStamps();
    if(!list.length){ setStatus("There are no stamps on this document yet.",true); return; }
    pushHistory();
    let to=null;
    list.forEach(a=>{ const cur=(a.st&&a.st.status)||"REDLINED"; const nx=/^AS/i.test(cur)?"REDLINED":"AS-BUILT"; if(!to)to=nx; stampApplyFields({status:nx},[a]); });
    try{ autosave(); }catch(e){}
    setStatus("Switched "+list.length+" stamp"+(list.length===1?"":"s")+(to?" to "+to:"")+".");
  };

  /* ---- the calendar (Mark It Up's, v74) ---- */
  function calendar(anchor,input){
    document.querySelectorAll(".cop-cal").forEach(n=>n.remove());
    const parse=s=>{ const m=String(s||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m?new Date(+m[3],+m[1]-1,+m[2]):null; };
    const sel=parse(input.value)||new Date(); let view=new Date(sel.getFullYear(),sel.getMonth(),1);
    const box=document.createElement("div"); box.className="cop-cal"; box.setAttribute("role","dialog"); box.setAttribute("aria-label","Pick a date");
    const close=()=>{ box.remove(); document.removeEventListener("pointerdown",away,true); document.removeEventListener("keydown",key,true); };
    const away=e=>{ if(!box.contains(e.target)&&e.target!==anchor)close(); };
    const key=e=>{ if(e.key==="Escape"){ e.stopPropagation(); close(); } };
    const draw=()=>{
      box.innerHTML="";
      const h=document.createElement("div"); h.className="cop-calh";
      const pr=document.createElement("button"); pr.type="button"; pr.textContent="‹"; pr.title="Previous month";
      const nx=document.createElement("button"); nx.type="button"; nx.textContent="›"; nx.title="Next month";
      const tt=document.createElement("span"); tt.textContent=view.toLocaleString(undefined,{month:"long",year:"numeric"});
      pr.onclick=e=>{ e.stopPropagation(); view=new Date(view.getFullYear(),view.getMonth()-1,1); draw(); };
      nx.onclick=e=>{ e.stopPropagation(); view=new Date(view.getFullYear(),view.getMonth()+1,1); draw(); };
      h.append(pr,tt,nx); box.appendChild(h);
      const g=document.createElement("div"); g.className="cop-calg";
      ["S","M","T","W","T","F","S"].forEach(t=>{ const d=document.createElement("span"); d.className="cop-caldow"; d.textContent=t; g.appendChild(d); });
      for(let i=0;i<view.getDay();i++)g.appendChild(document.createElement("span"));
      const days=new Date(view.getFullYear(),view.getMonth()+1,0).getDate(), td=new Date();
      for(let dd=1;dd<=days;dd++){ const b=document.createElement("button"); b.type="button"; b.textContent=String(dd);
        const dt=new Date(view.getFullYear(),view.getMonth(),dd);
        if(dt.toDateString()===sel.toDateString())b.classList.add("on"); if(dt.toDateString()===td.toDateString())b.classList.add("today");
        b.onclick=e=>{ e.stopPropagation(); input.value=today(dt); input.dispatchEvent(new Event("input",{bubbles:true})); close(); };
        g.appendChild(b); }
      box.appendChild(g);
      const ft=document.createElement("div"); ft.className="cop-calf";
      const tb=document.createElement("button"); tb.type="button"; tb.textContent="Today";
      tb.onclick=e=>{ e.stopPropagation(); input.value=today(); input.dispatchEvent(new Event("input",{bubbles:true})); close(); };
      ft.appendChild(tb); box.appendChild(ft);
    };
    draw(); document.body.appendChild(box);
    try{ const cs=getComputedStyle(pan), v=n=>cs.getPropertyValue(n).trim();
      const bg=v("--mp-bg")||cs.backgroundColor, ink=v("--mp-ink")||cs.color;
      box.style.setProperty("--cal-bg",bg); box.style.setProperty("--cal-ink",ink); box.style.setProperty("--cal-sunk",v("--mp-sunk")||bg);
      box.style.setProperty("--cal-line",v("--mp-line")||"transparent"); box.style.setProperty("--cal-dim",v("--mp-dim")||ink);
      box.style.setProperty("--cal-hi",v("--mp-hi")||"rgba(255,255,255,.06)"); box.style.setProperty("--cal-lo",v("--mp-lo")||"rgba(0,0,0,.45)"); }catch(e){}
    const r=anchor.getBoundingClientRect();
    box.style.left=Math.max(8,Math.min(innerWidth-box.offsetWidth-8,r.right-box.offsetWidth))+"px";
    const below=r.bottom+6, above=r.top-box.offsetHeight-6;
    box.style.top=((below+box.offsetHeight<innerHeight-8||above<8)?below:above)+"px";
    setTimeout(()=>{ document.addEventListener("pointerdown",away,true); document.addEventListener("keydown",key,true); },0);
  }
  dtW.querySelector(".cop-calbtn").addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); calendar(e.currentTarget,dtIn); });

  /* ---- opening, placing and moving it, as Mark It Up's panel does ---- */
  let anchor=null, pos=null;
  function place(){
    if(!pan.classList.contains("show"))return;
    const w=pan.offsetWidth||360, h=pan.offsetHeight||520; let left,top;
    if(pos){ left=pos.left; top=pos.top; }
    else if(anchor&&anchor.getBoundingClientRect){ const r=anchor.getBoundingClientRect(); left=r.left; top=r.bottom+6;
      if(top+h>innerHeight-8&&r.top-6-h>8)top=r.top-6-h; }
    else { left=innerWidth-w-16; top=76; }
    left=Math.max(8,Math.min(left,innerWidth-w-8)); top=Math.max(8,Math.min(top,Math.max(8,innerHeight-h-8)));
    pan.style.left=left+"px"; pan.style.top=top+"px"; if(pos)pos={left,top};
  }
  function open(src){
    if(src)anchor=src;
    /* a stamp already on the document is the authority: the card opens on what it says (the date stays today) */
    const first=allStamps()[0];
    if(first&&first.st){ const st=first.st; if(st.status)stSel.value=st.status; if(st.gc)gc.set(st.gc); if(st.poc)poc.set(st.poc);
      if(first.stPlace)plSel.value=first.stPlace; }
    pan.classList.add("show"); pan.setAttribute("aria-hidden","false");
    try{ $("stampBtn").classList.add("on"); }catch(e){}
    touched(true); place();
  }
  function close(){ pan.classList.remove("show"); pan.setAttribute("aria-hidden","true"); document.querySelectorAll(".cop-cal").forEach(n=>n.remove());
    try{ $("stampBtn").classList.remove("on"); }catch(e){} }
  pan.querySelector("#maClose").onclick=close;
  pan.addEventListener("pointerdown",e=>{
    if(e.button!==0)return; const head=e.target.closest&&e.target.closest(".mk-head");
    if(!head||e.target.closest("button,input,select,textarea,a,label"))return;
    const r=pan.getBoundingClientRect(), dx=e.clientX-r.left, dy=e.clientY-r.top;
    try{ pan.setPointerCapture(e.pointerId); }catch(_){} pan.classList.add("dragging");
    const mv=ev=>{ pos={left:ev.clientX-dx,top:ev.clientY-dy}; place(); };
    const up=()=>{ pan.classList.remove("dragging"); pan.removeEventListener("pointermove",mv); pan.removeEventListener("pointerup",up); };
    pan.addEventListener("pointermove",mv); pan.addEventListener("pointerup",up); e.preventDefault();
  });
  pan.addEventListener("dblclick",e=>{ if(e.target.closest(".mk-head")&&!e.target.closest("button")){ pos=null; place(); } });
  addEventListener("resize",place); addEventListener("scroll",place,true);
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&pan.classList.contains("show")&&!document.querySelector(".cop-cal")){ close(); } });
  /* the ribbon's stamp button (and the quick bar's, which presses it) opens this card instead of the old popover */
  const btn=$("stampBtn");
  if(btn)btn.addEventListener("click",ev=>{
    ev.stopImmediatePropagation(); ev.preventDefault();
    const src=(ev.isTrusted?btn:(window._stampSrc||document.activeElement||btn));
    pan.classList.contains("show")?close():open(src&&src.getBoundingClientRect?src:btn);
  },true);
  try{ const old=$("stampPanel"); if(old)old.classList.remove("show"); }catch(e){}
  setInterval(()=>{ if(pan.classList.contains("show"))relabel(); },700);
  touched(true);
})();
