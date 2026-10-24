/* 6n5 — the PAGE's status writer, taken by name here at load, before anything in this file shadows
   it. A top-level `const` is a binding and not a property of `window`, so a shadowed scope cannot
   reach the outer one through `window.setStatus` — it has to be captured while it is still in
   view. This file is packed last, so `setStatus` is already initialised when this line runs. */
const SK_PAGE_STATUS=setStatus;

/* =================================================================================================
   THE SELECT TOOL'S OWN KIT
   =================================================================================================
   Ced, with the Bluebeam menu in front of him: "where are these tools? these should be in dropdown of
   the select tool."

   So the Select button carries a ▾ of its own, and behind it are the seven ways of picking things up
   and pointing at them that live under Select in the reference:

     Rectangle Select   (V)          drag a box — what Select has always done
     Lasso Select       (Shift+O)    draw round what you want, any shape
     Text Select        (Shift+T)    drag over PRINTED text and take it to the clipboard
     Laser Pointer      (Ctrl+L)     a red dot with a fading tail, for talking someone through a sheet
     Snapshot           (Ctrl+G)     drag a region and take a picture of it
     Eraser             (E)          rub marks out — click one, or drag across several
     Format Painter                  pick up one mark's look and brush it onto the next ones

   Each is a MODE, so the ribbon's active state, the mode pill, Escape, and the rule that a tool stays
   in your hand all work on them without knowing anything about them. The gestures are claimed here, in
   a capture-phase listener, rather than threaded through the page's own pointer handler: they are
   whole gestures of their own and none of them draws a mark, so there is nothing for the drawing code
   to share with them.
   ================================================================================================= */

const SK_TOOLS=[
  {mode:"select",  label:"Rectangle Select", key:"V",        glyph:"⬚"},
  {mode:"lasso",   label:"Lasso Select",     key:"Shift+O",  glyph:"⥁"},
  {mode:"textsel", label:"Text Select",      key:"Shift+T",  glyph:"T"},
  {mode:"laser",   label:"Laser Pointer",    key:"Shift+L",  glyph:"●"},
  {mode:"snapshot",label:"Snapshot",         key:"Shift+S",  glyph:"⬛"},
  {mode:"eraser",  label:"Eraser",           key:"Shift+E",  glyph:"◧"},
  {mode:"painter", label:"Format Painter",   key:"Shift+F",  glyph:"◑"}
];
const SK_MODES=SK_TOOLS.map(t=>t.mode);
function skIsKit(m){ return SK_MODES.indexOf(m||S.mode)>=0; }
function skTool(m){ return SK_TOOLS.find(t=>t.mode===(m||S.mode))||SK_TOOLS[0]; }

/* ---- the ▾ on the Select button, and the menu behind it ---------------------------------------- */
function skAttachCaret(){
  const b=document.querySelector('#tools .tool[data-mode="select"]');
  if(!b||b.querySelector(".tcaret"))return;
  const c=document.createElement("span");
  c.className="tcaret"; c.textContent="▾";
  c.title="Rectangle, lasso, text select, laser, snapshot, eraser, format painter";
  c.setAttribute("role","button");
  c.addEventListener("pointerdown",e=>{ e.preventDefault(); e.stopPropagation(); });
  c.addEventListener("click",e=>{ e.preventDefault(); e.stopPropagation(); skMenu(b); });
  b.appendChild(c); b.classList.add("hascaret");
  b.addEventListener("contextmenu",e=>{ e.preventDefault(); skMenu(b); });
}
function skMenu(anchor){
  document.querySelectorAll(".sk-menu").forEach(n=>n.remove());
  const m=document.createElement("div"); m.className="sb-menu sk-menu";
  SK_TOOLS.forEach(t=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sb-mi sk-mi"+(S.mode===t.mode?" on":"");
    b.innerHTML="";
    const g=document.createElement("span"); g.className="sk-g"; g.textContent=t.glyph;
    const l=document.createElement("span"); l.className="sk-l"; l.textContent=t.label;
    const k=document.createElement("span"); k.className="sk-k"; k.textContent=t.key||"";
    b.appendChild(g); b.appendChild(l); b.appendChild(k);
    b.onclick=()=>{ m.remove(); skPick(t.mode); };
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect();
  m.style.left=Math.min(window.innerWidth-m.offsetWidth-8,Math.max(8,r.left))+"px";
  m.style.top=Math.min(window.innerHeight-m.offsetHeight-8,r.bottom+6)+"px";
  const away=ev=>{ if(!m.contains(ev.target)){ m.remove(); document.removeEventListener("pointerdown",away,true); } };
  setTimeout(()=>document.addEventListener("pointerdown",away,true),0);
}
/* Picking one of them puts it in your hand and says so on the Select button. */
function skPick(mode){
  skLaserOff(); skPaintOff(true);
  setMode(mode);
  selectAnno(null); selectLine(null); clearMulti();
  /* 6gk — the Select button stands in for a kit tool only while that tool has no button of its own */
  if(!document.querySelector('#tools .tool[data-mode="'+mode+'"]:not([data-mode="select"])')){
    const b=document.querySelector('#tools .tool[data-mode="select"]');
    if(b){ b.classList.add("active"); b.dataset.kit=mode; b.title=skTool(mode).label; }
  }
  if(mode==="painter"){ skPaintStart(); return; }
  skSay(mode);
}
/* What a kit tool says for itself when it is picked up, from wherever it was picked up. */
function skSay(mode){
  if(mode==="laser"){ setStatus("Laser pointer — move over the sheet. Escape puts it away."); return; }
  const t=skTool(mode);
  setStatus(t.label+(mode==="eraser"?" — click a mark to rub it out, or drag across several."
            :(mode==="textsel"?" — drag over printed text to copy it."
            :(mode==="snapshot"?" — drag the region you want a picture of."
            :(mode==="lasso"?" — draw round what you want to select.":"")))));
}
/* every mode change repaints the button, so switching away from the kit puts the arrow back */
function skSyncButton(){
  const b=document.querySelector('#tools .tool[data-mode="select"]'); if(!b)return;
  /* 6gk — Ced: "have a separate button for it on the ribbon as well and not within the select." The
     Snapshot tool has its own button now, so Select must not also light up when it is in your hand:
     any kit mode with a ribbon button of its own speaks for itself. */
  const own=document.querySelector('#tools .tool[data-mode="'+S.mode+'"]:not([data-mode="select"])');
  const kit=skIsKit(S.mode)&&!own;
  b.classList.toggle("active",kit);
  if(kit){ b.dataset.kit=S.mode; b.title=skTool(S.mode).label; }
  else delete b.dataset.kit;
}

/* ---- gestures ----------------------------------------------------------------------------------
   One capture-phase listener. It claims the press only for the kit's own modes and only on a page, so
   nothing else in the app has to know these exist. */
function skPageAt(t){ return t&&t.closest?t.closest(".page"):null; }
function skNorm(pg,ev){
  const r=pg.getBoundingClientRect();
  return [Math.min(1,Math.max(0,(ev.clientX-r.left)/pg.offsetWidth)),
          Math.min(1,Math.max(0,(ev.clientY-r.top)/pg.offsetHeight))];
}
document.addEventListener("pointerdown",ev=>{
  if(!skIsKit()||S.mode==="select")return;
  if(ev.button!==0)return;
  const pg=skPageAt(ev.target); if(!pg)return;
  if(ev.target.closest(".anno .rz,.anno .rot,.anno .mov,.anno .x"))return;
  const i=+pg.dataset.idx;
  if(S.mode==="laser")return;                       /* nothing to press: it follows the pointer */
  ev.preventDefault(); ev.stopPropagation();
  if(S.mode==="eraser")  return skErase(ev,pg,i);
  if(S.mode==="painter") return skPaintClick(ev,pg,i);
  if(S.mode==="lasso")   return skLasso(ev,pg,i);
  if(S.mode==="textsel") return skBoxDrag(ev,pg,i,"textsel");
  if(S.mode==="snapshot"){
    /* 6in — LASSO SNAPSHOT. Ced: "also add a lasso snapshot under the settings of snapshot." A
       rectangle is the wrong shape for most of what you want to lift off a drawing — a mount, a
       sector, one antenna in a cluster — so the Region chip in the snapshot panel switches the
       gesture to a freehand outline, and the capture is cut to it. */
    let _rg="rect";
    try{ _rg=((typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.snapshot)||{}).region||"rect"; }catch(e){}
    if(_rg==="lasso")return skLassoShot(ev,pg,i);
    return skBoxDrag(ev,pg,i,"snapshot");
  }
},true);

/* ---- LASSO ------------------------------------------------------------------------------------- */
function skLasso(ev,pg,i){
  const svg=pg.querySelector("svg.draw:not(.under)"); if(!svg)return;   /* 6ia — the upper layer */
  const NS="http://www.w3.org/2000/svg";
  const path=document.createElementNS(NS,"polyline");
  path.setAttribute("class","sk-lasso");
  path.setAttribute("fill","rgba(18,104,209,.12)");
  path.setAttribute("stroke",selInk());   /* 6k3 */
  path.setAttribute("stroke-width","2");
  path.setAttribute("stroke-dasharray","5 4");
  path.style.pointerEvents="none";
  svg.appendChild(path);
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const pts=[skNorm(pg,ev)];
  const paint=()=>path.setAttribute("points",pts.map(p=>(p[0]*w).toFixed(1)+","+(p[1]*h).toFixed(1)).join(" "));
  paint();
  const move=e=>{
    const p=skNorm(pg,e);
    const last=pts[pts.length-1];
    if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.002)return;   /* one point per few pixels */
    pts.push(p); paint();
  };
  const up=()=>{
    window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    path.remove();
    if(pts.length<3){ setStatus("Lasso — draw round what you want to select."); return; }
    clearMulti(); selectAnno(null); selectLine(null);
    const inside=(x,y)=>{
      let c=false;
      for(let a=0,b=pts.length-1;a<pts.length;b=a++){
        const xi=pts[a][0],yi=pts[a][1],xj=pts[b][0],yj=pts[b][1];
        if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi))c=!c;
      }
      return c;
    };
    S.annos.forEach(a=>{ if(a.page!==i)return;
      const d=document.querySelector(`.anno[data-id="${a.id}"]`);
      const cw=d?d.offsetWidth/w:(a.nw||0), ch=d?d.offsetHeight/h:(a.nh||0);
      if(inside(a.nx+cw/2,a.ny+ch/2))S.selMulti.add(a.id); });
    S.lines.forEach(l=>{ if(l.page!==i)return;
      const p=linePts(l); const mid=p[Math.floor(p.length/2)];
      if(inside(mid[0],mid[1])||p.every(q=>inside(q[0],q[1])))S.selMultiL.add(l.id); });
    paintMulti();
    const n=multiCount();
    setStatus(n?`${n} mark${n===1?"":"s"} selected.`:"Nothing inside the lasso.");
    if(n)toast(`Selected ${n}`);
  };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* ---- LASSO SNAPSHOT ---------------------------------------------------------------------------
   6in — the same outline the selection lasso draws, used to CUT a capture instead of to pick marks.
   The region handed to `skSnapshot` is the outline's bounding box, and the outline itself goes with it
   so the pixels outside it can be cleared: a lifted detail comes away with the sheet around it left
   behind, which is the whole point of lassoing one. */
function skLassoShot(ev,pg,i){
  const svg=pg.querySelector("svg.draw:not(.under)"); if(!svg)return;
  const NS="http://www.w3.org/2000/svg";
  const path=document.createElementNS(NS,"polyline");
  path.setAttribute("class","sk-lasso");
  path.setAttribute("fill","rgba(250,50,55,.10)");
  path.setAttribute("stroke","#fa3237");
  path.setAttribute("stroke-width","1.5");
  path.setAttribute("stroke-dasharray","5 4");
  path.style.pointerEvents="none";
  svg.appendChild(path);
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const pts=[skNorm(pg,ev)];
  const paint=()=>path.setAttribute("points",
    pts.map(p=>(p[0]*w).toFixed(1)+","+(p[1]*h).toFixed(1)).join(" "));
  paint();
  const move=e=>{
    const p=skNorm(pg,e), last=pts[pts.length-1];
    if(Math.abs(p[0]-last[0])+Math.abs(p[1]-last[1])<0.0015)return;
    pts.push(p); paint();
  };
  const up=async()=>{
    window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    path.remove();
    if(pts.length<3){ setStatus("Lasso snapshot — draw round what you want to lift."); return; }
    const xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
    const r=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
    if((r[2]-r[0])<0.004&&(r[3]-r[1])<0.004){ setStatus("That outline is too small to capture."); return; }
    try{ await skSnapshot(pg,i,r,pts); }catch(e){ LOG&&LOG("lasso snapshot failed",e&&e.message); }
  };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* ---- a dragged box, for TEXT SELECT and SNAPSHOT ----------------------------------------------- */
function skBoxDrag(ev,pg,i,kind){
  const box=document.createElement("div");
  box.className="marquee sk-"+kind;
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const a=skNorm(pg,ev);
  box.style.left=(a[0]*w)+"px"; box.style.top=(a[1]*h)+"px";
  box.style.width="0px"; box.style.height="0px";
  pg.appendChild(box);
  let b=a.slice();
  const move=e=>{
    b=skNorm(pg,e);
    box.style.left=(Math.min(a[0],b[0])*w)+"px"; box.style.top=(Math.min(a[1],b[1])*h)+"px";
    box.style.width=(Math.abs(b[0]-a[0])*w)+"px"; box.style.height=(Math.abs(b[1]-a[1])*h)+"px";
    if(kind==="textsel")skMarkRuns(pg,a,b);
  };
  const up=()=>{
    window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    box.remove();
    const r=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    if((r[2]-r[0])<0.004&&(r[3]-r[1])<0.004){ skClearRuns(pg); return; }
    if(kind==="textsel")skCopyRuns(pg,i,r); else skSnapshot(pg,i,r);
  };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* ---- TEXT SELECT ------------------------------------------------------------------------------- */
function skClearRuns(pg){ pg.querySelectorAll(".tspan.sk-on").forEach(t=>t.classList.remove("sk-on")); }
function skMarkRuns(pg,a,b){
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const l=Math.min(a[0],b[0])*w, t=Math.min(a[1],b[1])*h;
  const rgt=Math.max(a[0],b[0])*w, bot=Math.max(a[1],b[1])*h;
  pg.querySelectorAll(".tspan").forEach(sp=>{
    const x=sp.offsetLeft, y=sp.offsetTop, x2=x+sp.offsetWidth, y2=y+sp.offsetHeight;
    sp.classList.toggle("sk-on",!(x2<l||x>rgt||y2<t||y>bot));
  });
}
async function skCopyRuns(pg,i,r){
  const P=S.pages[i]||{};
  const hits=(P.items||[]).filter(t=>{
    const x=t.nx,y=t.ny,x2=t.nx+(t.nw||0),y2=t.ny+(t.nh||0);
    return !(x2<r[0]||x>r[2]||y2<r[1]||y>r[3]);
  });
  skClearRuns(pg);
  if(!hits.length){ setStatus("No printed text in that box.",true); return; }
  /* read in the order the page prints: down the rows, then across each one */
  const rows=[];
  hits.slice().sort((m,n)=>m.ny-n.ny||m.nx-n.nx).forEach(t=>{
    const row=rows.find(z=>Math.abs(z.y-t.ny)<(t.nh||0.008)*0.7);
    if(row)row.items.push(t); else rows.push({y:t.ny,items:[t]});
  });
  const text=rows.map(z=>z.items.sort((m,n)=>m.nx-n.nx).map(t=>String(t.str||"").trim()).join(" ")).join("\n");
  let how="copied";
  try{ await navigator.clipboard.writeText(text); }
  catch(e){
    try{ const ta=document.createElement("textarea"); ta.value=text; document.body.appendChild(ta);
         ta.select(); document.execCommand("copy"); ta.remove(); }
    catch(_){ how="read"; }
  }
  setStatus(how==="copied"
    ? `${hits.length} run${hits.length===1?"":"s"} copied — paste it wherever it goes.`
    : `${hits.length} run${hits.length===1?"":"s"}: ${text.slice(0,120)}`);
  if(how==="copied")toast("Text copied");
}

/* ---- SNAPSHOT ---------------------------------------------------------------------------------- */
/* =================================================================================================
   6gk — A SNAPSHOT IS TAKEN AT THE RESOLUTION OF WHAT WAS SELECTED
   Ced: "the quality of the snapshot should be the same as the pixel of the selected."

   The capture used to be a crop of the page canvas, and that canvas is rendered at whatever zoom you
   happen to be working at — so a snapshot taken at 100% held 100%-worth of pixels for ever: soft the
   moment it was zoomed into, and soft in the export. The region is RE-RENDERED from the PDF instead,
   at several times the screen's resolution, and only the region: the render transform puts the crop's
   own corner at the canvas origin, so the memory is the size of the crop rather than of the page.
   ================================================================================================= */
async function skSnapshot(pg,i,r,poly){
  let st0={};
  try{ st0=(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.snapshot)||{}; }catch(e){}
  const P=S.pages[i];
  const pgW=pg.offsetWidth, pgH=pg.offsetHeight;
  if(!P||!P.page||!pgW){ setStatus("That page is not rendered yet — scroll it into view and try again.",true); return; }
  const cropW=Math.max(1,(r[2]-r[0])*pgW), cropH=Math.max(1,(r[3]-r[1])*pgH);
  /* three screen pixels per pixel, unless the region is so large that the canvas would be unreasonable */
  let mult=3, MAXPX=26e6;
  if(cropW*cropH*mult*mult>MAXPX)mult=Math.max(1,Math.sqrt(MAXPX/(cropW*cropH)));
  const vp=P.page.getViewport({scale:S.scale*mult});
  const sx=Math.round(r[0]*vp.width), sy=Math.round(r[1]*vp.height);
  const sw=Math.max(1,Math.round(cropW*mult)), sh=Math.max(1,Math.round(cropH*mult));
  const out=document.createElement("canvas"); out.width=sw; out.height=sh;
  const cx=out.getContext("2d");
  let ok=false;
  try{
    await P.page.render({canvasContext:cx,viewport:vp,transform:[1,0,0,1,-sx,-sy]}).promise;
    ok=true;
  }catch(e){ LOG&&LOG("snapshot: high-resolution render declined, cropping the page canvas",e&&e.message); }
  if(!ok){
    /* whatever goes wrong with a fresh render, the page's own canvas is still there to crop */
    const srcCv=pg.querySelector("canvas.pdf");
    if(srcCv){
      const k0=srcCv.width/pgW;
      cx.drawImage(srcCv,Math.round(r[0]*srcCv.width),Math.round(r[1]*srcCv.height),
                   Math.max(1,Math.round(cropW*k0)),Math.max(1,Math.round(cropH*k0)),0,0,sw,sh);
    }
  }
  const k=sw/cropW;            /* canvas pixels per screen pixel, for the overlays below */
  /* 6ie — EVERYTHING THAT IS ON THE SHEET, IN THE ORDER IT IS ON THE SHEET.
     Ced: "snapshot tool is now broken. it should still do what it did on the previous builds, just
     with better capturing on what's on the ui." Two things had come loose under it. The capture read
     ONE stroke layer, and since 6ia there are two — every stroke sent below the marks was missing from
     the picture. And a shape's outline stopped being a CSS border in 6hp: a cloud, a dashed box and
     every ellipse are an SVG child of the mark now, and the capture only knew how to read a border, so
     those shapes came out as bare text. The patch is composited the way the page is stacked — strokes
     below, marks below, strokes above, marks above — and each mark is drawn from the SAME elements the
     screen is showing rather than from a second guess at what they contain. */
  const paintSvgLayer=async sel=>{
    try{
      const svg=pg.querySelector(sel); if(!svg)return;
      const clone=svg.cloneNode(true);
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      clone.setAttribute("width",pgW); clone.setAttribute("height",pgH);
      clone.setAttribute("viewBox","0 0 "+pgW+" "+pgH);
      /* the selection's own furniture is not part of the drawing */
      clone.querySelectorAll("circle,g,.sk-lasso,.polydraft").forEach(n=>{
        const f=n.getAttribute&&n.getAttribute("fill");
        if(f===selInk()||f==="#37a6ff"||n.classList.contains("sk-lasso")||n.classList.contains("polydraft"))n.remove();
      });
      const blob0=new Blob([new XMLSerializer().serializeToString(clone)],{type:"image/svg+xml"});
      const url=URL.createObjectURL(blob0);
      await new Promise(res=>{ const im=new Image();
        im.onload=()=>{ cx.drawImage(im,-sx,-sy,vp.width,vp.height); URL.revokeObjectURL(url); res(); };
        im.onerror=()=>{ URL.revokeObjectURL(url); res(); };
        im.src=url; });
    }catch(e){}
  };
  await paintSvgLayer("svg.draw.under");
  try{ await skDrawAnnos(cx,pg,i,sx,sy,k,true); }catch(e){}
  await paintSvgLayer("svg.draw:not(.under)");
  try{ await skDrawAnnos(cx,pg,i,sx,sy,k,false); }catch(e){}
  /* 6gd — AND IT IS PASTED STRAIGHT BACK ONTO THE SHEET.
     Ced: "snapshot should produce a redline version of the snapshotted area. and the product should
     automatically be pasted, and the size should be the same." So the picture — the sheet with every
     redline over it — becomes a mark of its own, exactly the size of the region it was taken from,
     dropped just clear of it and selected, ready to be dragged where it goes. It goes to the clipboard
     as well, for the email that is usually the next thing to happen to it. */
  /* 6ge — A SNAPSHOT IS A REDLINE OF WHAT IT CAPTURED.
     Ced sent a picture of one in use: the blue mount drawing snapped and pasted beside itself in RED,
     turned to a new angle, with the sheet showing through it. That is the point of the tool on a
     drawing sheet — lift the detail, recolour it, and lay it back down as the proposed change. So the
     capture is converted rather than copied: the page's white drops out to transparent, and whatever
     ink was there becomes the tool's own colour, at the strength it was drawn. */
  /* 6hz — AND BY DEFAULT IT IS A CLEAN PICTURE.
     Ced: "snapshot did not take a clean snapshot. it changed the format of the redlines." 6ge made
     every capture a redline OF what it captured — the white dropped out and every mark in it was
     recoloured to one red — which is what you want when you are lifting a detail to lay it back down
     as the proposed change, and is emphatically not what you want when you are taking a picture of a
     table you have already corrected: the corrections come back a different colour and a different
     weight from the ones on the sheet beside them. So the conversion is a CHOICE now, and the default
     is the plain picture: what was on the sheet, as it was on the sheet. */
  /* 6in — and if the region was lassoed, everything outside the outline is cut away before anything
     else is done to the pixels. `destination-in` against the filled outline does it in one pass, at
     the capture's own resolution, so the edge is as smooth as the rest of the picture. */
  if(poly&&poly.length>2){
    try{
      const mk=document.createElement("canvas"); mk.width=sw; mk.height=sh;
      const mg=mk.getContext("2d");
      mg.fillStyle="#fff"; mg.beginPath();
      poly.forEach((p,k)=>{ const px=p[0]*vp.width-sx, py=p[1]*vp.height-sy;
        if(k)mg.lineTo(px,py); else mg.moveTo(px,py); });
      mg.closePath(); mg.fill();
      cx.save(); cx.globalCompositeOperation="destination-in";
      cx.drawImage(mk,0,0); cx.restore();
    }catch(e){ LOG&&LOG("lasso cut skipped",e&&e.message); }
  }
  /* 6ie — and the conversion is the DEFAULT again. 6hz made a plain picture the default, and Ced:
     "it should still do what it did on the previous builds". A snapshot is a redline of what it
     captured unless the Capture chip in its own panel says Plain. */
  const wantTint=(st0.tint!==false);
  if(wantTint)skRedlineTint(out,(st0.col||"#fa3237"));
  const url=out.toDataURL("image/png");
  /* the region the picture ACTUALLY covers, after the crop was rounded to whole canvas pixels, so the
     mark and the picture inside it are the same shape to the pixel */
  const exact=[sx/vp.width,sy/vp.height,(sx+sw)/vp.width,(sy+sh)/vp.height];
  const id=skPlaceSnapshot(i,exact,url);
  const blob=await new Promise(res=>out.toBlob(res,"image/png"));
  let copied=false;
  if(blob){
    try{
      if(window.ClipboardItem&&navigator.clipboard&&navigator.clipboard.write){
        await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);
        copied=true;
      }
    }catch(e){}
  }
  /* 6ig — one line, not three */
  setStatus(copied?"Snapshot placed and copied.":"Snapshot placed.");
  toast(copied?"Snapshot pasted and copied":"Snapshot pasted");
  return id;
}
/* The snapshot as a mark: same size as the region, offset a little so it does not hide what it was
   taken from, and carrying the snapshot tool's own frame colour and width. */
function skPlaceSnapshot(pi,r,url){
  const w=r[2]-r[0], h=r[3]-r[1];
  /* 6gl — Ced: "make sure the snapshot will land directly on top of the area and not moved at all."
     It used to be dropped a little clear of the region so it did not hide what it was taken from,
     which is the wrong default on a drawing: you take a snapshot of a detail to lay a redline of that
     detail exactly over it, and any offset has to be undone by hand. It lands on the region, to the
     pixel, and one drag moves it wherever else it should go. */
  const off=0;
  let st={};
  try{ st=(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.snapshot)||{}; }catch(e){}
  let id=null;
  historyBatch(()=>{
    id=addText(pi,Math.min(1-w,r[0]+off),Math.min(1-h,r[1]+off),"");
    const a=S.annos.find(z=>z.id===id);
    if(a){
      a.kind="img"; a.src=url; a.maKind="snapshot";
      a.nw=w; a.nh=h; a.manualW=true; a.under=false;
      a.col=st.col||"#fa3237";
      /* 6gk — Ced, twice: "make the border default at 0." The frame used to come from `sw`, which is
         the SHARED stroke-width field every tool writes through the ribbon — so drawing a 3pt line
         and then taking a snapshot gave the snapshot a 3pt frame, whatever the default said. It has
         its own key now, written only by the Frame slider in its own panel, and it starts at none. */
      a.sw=(st.frameSw!=null?st.frameSw:0);
      /* 6ge — what the picture is already coloured with. 6hz: only a capture that WAS converted
         carries this; a plain one leaves it unset, which is how the re-ink pass knows to leave it be. */
      a._tintCol=(st&&st.tint!==false)?a.col:null;
      a.colOp=(st.colOp!=null?st.colOp:1);
      a.fillOp=(st.fillOp!=null?st.fillOp:1);
    }
  });
  layoutAnnos(); updateRail(); updateCount();
  try{ setMode("select"); selectAnno(id); }catch(e){}
  return id;
}

/* =================================================================================================
   6ge — THE TWO PIXEL PASSES
   `skRedlineTint` turns a captured PATCH OF PAGE into a redline: the page's white becomes transparent
   and every bit of ink becomes one colour, kept at the strength it was drawn so a fine line stays fine
   and a solid one stays solid. `skRecolour` changes the colour of a picture that has already been
   through that — it leaves the alpha exactly as it is and only swaps the ink — which is what makes the
   colour in the properties panel work on a snapshot that is already on the page.
   ================================================================================================= */
function skRgb(hex){
  const h=String(hex||"#fa3237").replace("#","");
  const n=(h.length===3)?h.split("").map(c=>c+c).join(""):h;
  return [parseInt(n.slice(0,2),16)||0,parseInt(n.slice(2,4),16)||0,parseInt(n.slice(4,6),16)||0];
}
function skRedlineTint(cv,hex){
  const g=cv.getContext("2d");
  const im=g.getImageData(0,0,cv.width,cv.height), d=im.data;
  const [R,G,B]=skRgb(hex);
  /* white paper drops out; the ramp between is what keeps a grey hatch grey rather than a hard edge */
  const hi=0.94, lo=0.34;
  for(let k=0;k<d.length;k+=4){
    const lum=(0.299*d[k]+0.587*d[k+1]+0.114*d[k+2])/255;
    let al=(hi-lum)/(hi-lo);
    al=al<0?0:(al>1?1:al);
    d[k]=R; d[k+1]=G; d[k+2]=B; d[k+3]=Math.round(al*(d[k+3]/255)*255);
  }
  g.putImageData(im,0,0);
  return cv;
}
function skRecolour(cv,hex){
  const g=cv.getContext("2d");
  const im=g.getImageData(0,0,cv.width,cv.height), d=im.data;
  const [R,G,B]=skRgb(hex);
  for(let k=0;k<d.length;k+=4){
    if(!d[k+3])continue;
    /* 6gf — a WHITE FILL put in by the picture editor is not ink and is left alone: re-inking a
       snapshot changes the lines, not the ground that was painted behind them. */
    if(d[k]>230&&d[k+1]>230&&d[k+2]>230)continue;
    d[k]=R; d[k+1]=G; d[k+2]=B;
  }
  g.putImageData(im,0,0);
  return cv;
}
/* A snapshot whose colour has been changed since it was taken is re-inked here, from its own pixels.
   Called off the draw pass; it does nothing at all unless a colour actually changed. */
let _skTinting=false;
function skSyncSnapshotTint(){
  if(_skTinting)return;
  /* 6hz — only a snapshot that was TAKEN as a redline re-inks itself. A plain capture is a picture of
     the sheet, and the frame colour on its panel is the frame's, not the picture's: re-inking one on a
     colour change would throw away the very thing a plain capture is for. */
  const want=(S.annos||[]).filter(a=>a.maKind==="snapshot"&&a.src&&a._tintCol!=null
                                     &&a._tintCol!==a.col);
  if(!want.length)return;
  _skTinting=true;
  let left=want.length;
  const done=()=>{ if(--left<=0){ _skTinting=false; try{ layoutAnnos(); }catch(e){} } };
  want.forEach(a=>{
    const col=a.col;
    const im=new Image();
    im.onload=()=>{
      try{
        const c=document.createElement("canvas");
        c.width=im.naturalWidth; c.height=im.naturalHeight;
        c.getContext("2d").drawImage(im,0,0);
        skRecolour(c,col);
        /* 6jb — the re-ink lands on the PICTURE; its frame is re-drawn round the new colour after */
        if(a.picRaw){ a.picRaw=c.toDataURL("image/png"); a._frKey=null; }
        else a.src=c.toDataURL("image/png");
        a._tintCol=col;
      }catch(e){ a._tintCol=col; }
      done();
    };
    im.onerror=()=>{ a._tintCol=col; done(); };
    im.src=(typeof maPicUnframed==="function")?maPicUnframed(a):a.src;
  });
}

/* The text marks on a snapshot: ground, rule and the writing itself, at the canvas's own scale. */
/* 6ie — one band of marks, drawn from the elements the screen is actually showing.
   `under` picks the band; the marks inside it go on in their own z order, and each one is built the
   way the page builds it: its ground, then its picture, then its outline — the SVG child that draws a
   cloud, a dashed box or an ellipse — then its text. It is asynchronous because an outline and a
   picture are both images that have to load before they can be put on a canvas. */
async function skDrawAnnos(cx,pg,i,sx,sy,k,under){
  const w=pg.offsetWidth,h=pg.offsetHeight;
  const list=(S.annos||[]).filter(a=>a.page===i&&(under==null||(!!a.under===!!under)))
    .sort((p,q)=>((p.z||0)-(q.z||0))||(S.annos.indexOf(p)-S.annos.indexOf(q)));
  const asImage=src=>new Promise(res=>{ const im=new Image();
    im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; });
  const svgImage=async (node,bw,bh)=>{
    try{
      const c=node.cloneNode(true);
      c.setAttribute("xmlns","http://www.w3.org/2000/svg");
      c.setAttribute("width",bw); c.setAttribute("height",bh);
      const blob=new Blob([new XMLSerializer().serializeToString(c)],{type:"image/svg+xml"});
      const u=URL.createObjectURL(blob);
      const im=await asImage(u);
      URL.revokeObjectURL(u);
      return im;
    }catch(e){ return null; }
  };
  for(const a of list){
    const d=document.querySelector(`.anno[data-id="${a.id}"]`); if(!d)continue;
    const ed=d.querySelector(".ed"); if(!ed)continue;
    const x=a.nx*w*k-sx, y=parseFloat(d.style.top||"0")*k-sy;
    const bw=ed.offsetWidth*k, bh=ed.offsetHeight*k;
    const st=getComputedStyle(ed);
    /* everything this mark draws is prepared before the canvas is touched, so the transform below
       covers the whole of it and nothing lands half-rotated */
    const outline=d.querySelector(":scope > svg.shapeoutline");
    const outIm=outline?await svgImage(outline,ed.offsetWidth,ed.offsetHeight):null;
    const picEl=ed.querySelector("img");
    const picIm=(picEl&&picEl.src)?await asImage(picEl.src):null;
    cx.save();
    if(a.rot){ cx.translate(x+bw/2,y+bh/2); cx.rotate(a.rot*Math.PI/180); cx.translate(-bw/2,-bh/2); }
    else cx.translate(x,y);
    if(st.backgroundColor&&st.backgroundColor!=="rgba(0, 0, 0, 0)"){
      cx.fillStyle=st.backgroundColor; cx.fillRect(0,0,bw,bh);
    }
    if(picIm){
      /* 6ie — a photograph, a markup or a snapshot already on the sheet is part of the picture too,
         at its own opacity and mirrored the way it is mirrored on screen */
      cx.save();
      cx.globalAlpha=(a.fillOp!=null?a.fillOp:1);
      if(a.flipX||a.flipY){ cx.translate(a.flipX?bw:0,a.flipY?bh:0); cx.scale(a.flipX?-1:1,a.flipY?-1:1); }
      try{ cx.drawImage(picIm,0,0,bw,bh); }catch(e){}
      cx.restore();
    }
    const bwid=parseFloat(st.borderTopWidth)||0;
    if(bwid>0){ cx.strokeStyle=st.borderTopColor; cx.lineWidth=bwid*k;
      if(/50%/.test(st.borderRadius)){ cx.beginPath();
        cx.ellipse(bw/2,bh/2,Math.max(1,bw/2-bwid*k/2),Math.max(1,bh/2-bwid*k/2),0,0,Math.PI*2); cx.stroke(); }
      else cx.strokeRect(bwid*k/2,bwid*k/2,bw-bwid*k,bh-bwid*k);
    }
    if(outIm){ try{ cx.drawImage(outIm,0,0,bw,bh); }catch(e){} }
    const txt=String(a.text||"").split("\n");
    if(txt.join("").trim()){
      cx.fillStyle=st.color;
      const fs=(parseFloat(st.fontSize)||10)*k;
      cx.font=(st.fontStyle==="italic"?"italic ":"")+(parseInt(st.fontWeight,10)>=600?"bold ":"")+fs+"px "+st.fontFamily;
      cx.textBaseline="top";
      const pad=4*k;
      const lead=fs*1.22*((a.lnsp!=null&&a.lnsp>0)?a.lnsp:1);
      try{ if(a.lsp)cx.letterSpacing=(a.lsp*S.scale*k)+"px"; }catch(e){}
      txt.forEach((line,n)=>{
        const tw=cx.measureText(line).width;
        const al=a.align||"left";
        const tx=(al==="center")?(bw-tw)/2:((al==="right")?(bw-tw-pad):pad);
        cx.fillText(line,tx,pad+n*lead);
      });
      try{ cx.letterSpacing="0px"; }catch(e){}
    }
    cx.restore();
  }
}

/* =================================================================================================
   6gf / 6gj — THE PICTURE EDITOR
   Ced, first: "have tools to edit the snapshot in a separate prompt like erase, add fill."
   Then: "the edit in snapshot could be better. the eraser should also be seamless and continuous."
   And: "have a magic wand tool that will select spaces and then have select inverse and then the fill
   tool will fill the currently selected portion. but take note that it must be below the layer of the
   red parts."

   And, on the room it needs: "fix the ui of the snapshot part. make it also zoomable, undo redo, the
   erase should have a restore counterpart."

   A snapshot lifted off a drawing is line art on nothing, so laying it over another part of the sheet
   shows both at once. Four tools answer that, and they are the ones a hand expects:

     ERASE    a continuous brush — a stroked path from the last point to this one, so a fast sweep is a
              smooth band rather than a row of dots.
     RESTORE  the same brush, painting the original picture back: an over-eager sweep is mended by
              brushing over it rather than undone wholesale.
     WAND     click a space and that space is selected, bounded by the ink itself; Shift adds another.
     FILL     paints whatever is selected, UNDERNEATH everything already drawn, so the redlines stay on
              top of their new ground rather than being covered by it.

   With SELECT INVERSE beside the wand, "white behind the drawing and nothing else" is: wand the
   outside, invert, fill. The view zooms (Fit, 1:1, ctrl-wheel) because a capture now holds several
   times the screen's pixels, and every change is undoable AND redoable — pixels and selection
   together, since a fill and the selection that shaped it are one action to the hand. Everything
   happens on a copy of the picture; Cancel leaves the mark untouched.
   ================================================================================================= */
/* =================================================================================================
   6gs — AN EDIT YOU CAN COME BACK TO
   Ced: "the edit photo should be reeditable with the history in tact. even if you accidentally closed
   the tab, the edit photo should save that in the storage."

   Three things are kept, and they are kept in three different places because they cost three very
   different amounts:

     · THE ORIGINAL (`a.srcOrig`) lives on the mark, so it survives a save, a copy, an undo and the
       autosave in this browser. Restore brushes THAT back, not "the picture as it was when this editor
       opened" — so an edit made earlier in the session can still be undone by brushing over it.
       6le — it does NOT travel in the EXPORTED PDF any more, and this is the one place that is felt.
       It held a whole second copy of the picture in a string, and three edited photos were enough to
       put both the re-edit payload (3,106,394 chars) and each photo's own tag (1,035,409) past what
       pdf-lib can read back — so the photos came back from a reopen as somebody else's annotations
       and were lost outright. A Restore that reaches one version further back is not worth the photo
       itself. On a reopened file the line below seeds `srcOrig` from the picture as it stands, so
       Restore still works; its floor is the reopen rather than the first edit.
     · THE SESSION'S HISTORY stays in memory, exactly as it was: reopening the editor on the same
       picture puts the same undo and redo stacks back, instantly and at no cost.
     · A TAIL OF THAT HISTORY is written to this browser as PNGs when the editor closes — a few steps,
       inside a byte budget, for the two pictures edited most recently. That is what survives the tab
       being closed. It is best-effort by design: if the browser has no room, the picture and its
       original are still saved and only the undo steps are lost.
   ================================================================================================= */
const SK_EDIT_KEY="ma.picedit.v1";
const SK_HIST_TAIL=4, SK_HIST_BYTES=1400000, SK_HIST_MARKS=2;
let SK_EDIT_MEM={};                       /* markId -> {w,h,undo:[],redo:[]} for this session */
function skEditStore(){
  try{ const raw=localStorage.getItem(SK_EDIT_KEY); const v=raw?JSON.parse(raw):null;
       return (v&&typeof v==="object")?v:{}; }catch(e){ return {}; }
}
function skEditRemember(a,undo,redo,cv){
  /* the session's copy first: free, complete, and what a reopen in this tab uses */
  SK_EDIT_MEM[a.id]={w:cv.width,h:cv.height,undo:undo.slice(-12),redo:redo.slice(-12)};
  /* then the tail, as pictures, for the tab that gets closed */
  try{
    const tail=undo.slice(-SK_HIST_TAIL);
    if(!tail.length){ return; }
    const tmp=document.createElement("canvas");
    const tg=tmp.getContext("2d");
    const steps=[]; let bytes=0;
    for(let k=tail.length-1;k>=0;k--){
      /* 6gt — a step is written at the size IT was taken at: the picture can be turned in the editor,
         and a landscape step squeezed into a portrait canvas would come back cropped */
      const _st=tail[k];
      const sw=_st.w||(_st.cv?_st.cv.width:_st.px.width), sh=_st.h||(_st.cv?_st.cv.height:_st.px.height);
      tmp.width=sw; tmp.height=sh;
      tg.clearRect(0,0,sw,sh);
      if(_st.cv)tg.drawImage(_st.cv,0,0); else tg.putImageData(_st.px,0,0);
      const url=tmp.toDataURL("image/png");
      if(bytes+url.length>SK_HIST_BYTES)break;
      bytes+=url.length; steps.unshift({u:url,w:sw,h:sh,rot:tail[k].rot||0});
    }
    tmp.width=tmp.height=0;
    if(!steps.length)return;
    const store=skEditStore();
    store[a.id]={w:cv.width,h:cv.height,steps,at:Date.now()};
    /* only the last few pictures are worth keeping; the browser's room is not ours to fill */
    const ids=Object.keys(store).sort((x,y)=>(store[y].at||0)-(store[x].at||0));
    ids.slice(SK_HIST_MARKS).forEach(id=>{ delete store[id]; });
    localStorage.setItem(SK_EDIT_KEY,JSON.stringify(store));
  }catch(e){
    LOG&&LOG("picture history could not be kept (no room) — the picture itself is still saved");
    try{ localStorage.removeItem(SK_EDIT_KEY); }catch(_){}
  }
}
/* What this picture's undo stack should start as: this session's if it is here, otherwise whatever was
   written to the browser last time, decoded back into pixels. */
async function skEditRecall(a,cv){
  const mem=SK_EDIT_MEM[a.id];
  if(mem&&mem.w===cv.width&&mem.h===cv.height)return {undo:mem.undo.slice(),redo:mem.redo.slice()};
  const rec=skEditStore()[a.id];
  if(!rec||rec.w!==cv.width||rec.h!==cv.height||!rec.steps||!rec.steps.length)return null;
  const tmp=document.createElement("canvas");
  const tg=tmp.getContext("2d",{willReadFrequently:true});
  const undo=[];
  for(const step of rec.steps){
    /* 6gt — written as a bare url before the picture could be turned; as {u,w,h} since */
    const url=(typeof step==="string")?step:(step&&step.u);
    if(!url)continue;
    const im=await new Promise(res=>{ const z=new Image(); z.onload=()=>res(z); z.onerror=()=>res(null); z.src=url; });
    if(!im)continue;
    const sw=(step&&step.w)||im.naturalWidth||cv.width;
    const sh=(step&&step.h)||im.naturalHeight||cv.height;
    tmp.width=sw; tmp.height=sh;
    tg.clearRect(0,0,sw,sh); tg.drawImage(im,0,0);
    undo.push({px:tg.getImageData(0,0,sw,sh),w:sw,h:sh,mask:null});
  }
  tmp.width=tmp.height=0;
  return undo.length?{undo,redo:[]}:null;
}
let SK_ED=null;
/* 6ha — `opts.onSave(dataUrl)` takes the result somewhere OTHER than a mark on the sheet, which is how
   a markup in the library is edited: same editor, same tools, and the picture goes back to the library
   entry instead of to a page. `opts.title` names the card while it is open. */
/* ==================================================================================================
   6nd — THE EDITOR'S TOOLS WEAR CED'S OWN ICONS.
   Ced sent seventeen marks and said which tool each belongs to: "apply the following icons on edit
   photo respectively: erase, restore, line erase, restore all, auto, pen, fill, wand, lasso,
   invert, deselect, fill and unfill (under wand), rotate right and left, flip horizontal and
   vertical, and crop."

   They are TRACED, not redrawn — `tools/traceicon.py`, the same tracer the bucket and the app's
   own icon set went through. Redrawing a mark by eye gets the idea and loses the drawing: the
   eraser's exact split, the brush's two bands, the angle of the pen's squiggle. Each one is the
   artwork's own contour simplified with Douglas-Peucker at a tolerance just wide enough to swallow
   the antialiased staircase, scaled into a 24-unit box, holes kept as their own subpaths and the
   whole emitted `fill-rule:evenodd`. Three of the sources were low-resolution — the flip-vertical
   pair and the two turn discs — so those were smoothed 4x with Lanczos before tracing and given a
   wider tolerance, or every jag in the original would have become a vertex here.

   One source carried a stock-library watermark under the artwork. It was cropped off before the
   trace rather than tidied afterwards; the first pass kept it and sized both discs to a tenth of
   the box to make room for it.

   Everything is drawn in `currentColor`, so a tool takes the button's ink and turns white when the
   button is on — which is why the two marks Ced sent in colour (the blue sparkle, the red cross)
   get their colour from CSS instead, where it can step aside for the selected state.
   ================================================================================================== */
const ED_ICO_PATHS={
  erase:      "M14.50 18.08L5.36 8.94L11.44 2.86L12.87 1.53L14.20 0.61L14.91 0.41L15.93 0.51L16.85 0.92L17.77 1.63L22.31 6.28L22.93 7.40L23.03 8.53L22.52 9.75L21.91 10.57L14.55 18.03ZM23.08 23.49L7.35 23.49L6.13 22.98L5.31 22.37L1.17 18.23L0.15 16.70L-0.05 15.98L-0.05 15.37L0.15 14.66L1.07 13.33L2.40 11.90L3.98 10.31L13.12 19.46L11.13 21.45L22.98 21.45L23.69 21.75L23.95 22.21L23.95 22.83L23.59 23.29L23.13 23.44Z",
  restore:    "M15.81 16.04L7.01 7.24L8.33 5.93L8.78 5.72L9.31 5.72L9.59 5.83L11.27 6.80L11.97 7.12L12.28 7.19L13.05 7.19L13.75 6.98L14.34 6.59L14.75 6.16L16.15 3.81L17.51 1.75L18.10 0.98L18.68 0.44L19.10 0.19L19.49 0.05L19.87 -0.02L20.50 -0.02L21.20 0.16L21.62 0.37L22.22 0.82L22.48 1.12L22.86 1.78L23.07 2.59L23.07 3.18L22.97 3.67L22.62 4.37L22.11 4.92L21.10 5.69L19.73 6.59L16.76 8.41L16.43 8.75L16.08 9.31L15.87 9.97L15.87 10.78L15.94 11.09L16.15 11.62L17.30 13.64L17.34 14.27L17.16 14.69L15.83 16.02ZM20.59 3.74L20.92 3.62L21.25 3.29L21.39 2.97L21.43 2.73L21.36 2.34L21.18 2.03L21.03 1.87L20.61 1.66L20.40 1.63L20.08 1.66L19.66 1.87L19.43 2.13L19.29 2.45L19.33 3.08L19.54 3.43L19.77 3.62L20.12 3.76L20.57 3.76ZM13.75 18.10L4.95 9.31L6.54 7.71L15.34 16.51L13.77 18.09ZM9.59 23.98L9.38 23.98L9.13 23.81L7.71 22.36L7.64 21.83L7.71 21.03L7.96 20.12L8.29 19.36L7.64 20.22L7.15 21.13L6.89 21.32L6.75 21.32L6.47 21.15L3.83 18.47L3.76 18.12L3.76 17.25L3.83 16.76L4.11 15.71L4.58 14.68L4.08 15.29L3.59 16.02L3.03 17.07L2.80 17.23L2.66 17.23L2.45 17.13L1.00 15.67L0.89 15.50L0.89 15.29L1.24 14.34L1.84 13.15L2.75 11.76L3.87 10.39L4.48 9.78L13.28 18.58L12.33 19.59L11.28 20.96L10.55 22.15L10.13 22.99L9.81 23.79L9.60 23.97Z",
  wipe:       "M13.71 18.28L3.71 18.28L0.97 15.59L0.69 15.21L0.58 14.88L0.58 14.21L0.91 13.55L3.54 10.98L8.02 15.46L8.24 15.57L8.63 15.57L8.96 15.40L9.21 14.99L9.15 14.43L4.62 9.84L11.78 2.68L12.50 2.35L13.05 2.35L13.38 2.46L13.71 2.68L20.60 9.57L20.88 10.18L20.88 10.78L20.60 11.39L13.74 18.25ZM23.12 21.59L0.83 21.59L0.44 21.43L0.03 20.96L-0.03 20.18L0.14 19.85L0.44 19.55L0.88 19.38L23.06 19.38L23.56 19.60L23.81 19.85L23.97 20.18L23.97 20.79L23.86 21.07L23.50 21.43L23.14 21.57Z",
  restoreall: "M14.20 22.29L12.28 22.20L10.45 21.77L9.61 21.45L8.67 20.98L7.78 20.41L7.43 20.11L9.00 18.49L9.19 18.54L9.56 18.82L10.36 19.24L11.81 19.76L12.98 19.95L14.39 19.95L15.33 19.80L16.08 19.62L16.83 19.34L18.05 18.68L18.75 18.16L19.90 17.02L20.70 15.84L21.12 14.95L21.54 13.55L21.68 12.28L21.63 11.02L21.35 9.66L20.88 8.48L20.32 7.50L19.90 6.94L19.12 6.12L18.05 5.27L16.59 4.52L15.09 4.10L14.39 4.01L12.98 4.01L12.05 4.15L10.55 4.62L9.33 5.27L8.62 5.79L7.52 6.89L6.63 8.20L6.16 9.28L5.84 10.45L5.84 10.73L5.74 11.06L5.72 11.98L9.12 12.00L4.55 16.57L-0.02 12.00L3.40 11.95L3.40 11.20L3.49 10.36L3.73 9.28L4.10 8.16L4.71 6.89L5.09 6.28L6.16 4.92L7.31 3.87L8.25 3.21L9.38 2.60L10.17 2.27L11.25 1.95L12.61 1.71L14.20 1.66L15.14 1.76L16.31 1.99L17.58 2.41L18.66 2.93L19.83 3.68L20.67 4.38L21.63 5.39L22.48 6.56L22.99 7.50L23.60 9.09L23.84 10.08L23.98 11.11L23.98 12.84L23.84 13.88L23.60 14.86L23.18 16.03L22.62 17.16L22.10 17.95L21.30 18.94L20.30 19.90L18.98 20.84L17.91 21.40L16.64 21.87L15.14 22.20L14.23 22.27ZM14.02 14.27L13.36 14.27L12.84 14.13L12.28 13.80L11.74 13.22L11.51 12.75L11.37 11.95L11.55 11.06L11.88 10.55L12.28 10.15L12.84 9.82L13.36 9.68L14.02 9.68L14.53 9.82L15.05 10.10L15.54 10.59L15.77 10.97L15.96 11.48L16.01 11.81L15.96 12.47L15.77 12.98L15.54 13.36L15.05 13.85L14.53 14.13L14.04 14.25Z",
  auto:       "M12.12 23.94L11.82 23.94L11.59 23.82L11.32 23.44L10.37 19.95L10.02 18.95L9.31 17.59L8.48 16.46L7.39 15.37L6.86 14.96L6.15 14.48L4.97 13.89L0.24 12.47L-0.03 12.09L-0.03 11.79L0.09 11.56L0.47 11.29L3.96 10.34L4.97 9.99L6.15 9.40L7.45 8.45L8.78 7.06L9.49 6.00L10.02 4.94L10.37 3.93L11.32 0.44L11.59 0.12L11.82 0.00L12.12 0.00L12.35 0.12L12.62 0.44L13.57 3.93L13.92 4.94L14.45 6.00L15.40 7.36L16.49 8.45L17.62 9.28L18.98 9.99L19.98 10.34L23.47 11.29L23.85 11.56L23.97 11.79L23.97 12.09L23.70 12.47L18.98 13.89L17.91 14.42L17.08 14.96L16.55 15.37L15.40 16.52L14.63 17.59L13.92 18.95L13.57 19.95L12.62 23.44L12.50 23.67L12.15 23.91Z",
  pen:        "M6.09 17.84L5.72 17.79L5.37 17.48L5.32 16.97L6.40 11.53L6.49 11.30L17.72 0.07L17.91 -0.02L18.28 -0.02L18.47 0.07L23.09 4.69L23.18 4.92L23.18 5.20L23.09 5.39L11.81 16.66L6.12 17.81ZM8.13 16.08L10.90 15.52L7.64 12.26L7.57 12.33L7.05 15.09L8.11 16.10ZM20.86 23.98L20.30 23.93L20.04 23.67L19.62 22.69L19.24 22.12L18.52 21.35L17.95 20.93L17.39 20.60L16.45 20.23L15.09 19.90L13.88 19.76L12.80 19.76L12.05 19.85L10.88 20.18L9.61 20.79L7.36 22.34L5.72 23.23L4.22 23.70L2.81 23.74L2.16 23.55L1.55 23.18L1.10 22.69L0.91 22.31L0.77 21.75L0.82 20.86L1.05 20.25L1.43 19.69L2.25 18.91L3.61 18.16L4.12 17.98L4.50 17.98L4.80 18.23L4.90 18.42L4.90 18.84L4.80 19.03L4.41 19.29L3.52 19.66L2.95 20.04L2.27 20.72L2.09 21.09L2.04 21.47L2.13 21.80L2.32 22.12L2.53 22.34L2.95 22.52L3.75 22.52L4.83 22.20L6.19 21.54L8.53 19.90L9.98 19.15L10.88 18.82L12.23 18.49L13.03 18.40L14.20 18.40L15.75 18.63L16.97 19.01L18.05 19.48L19.12 20.18L19.99 21.00L20.79 22.12L21.26 23.16L21.30 23.34L21.26 23.62L21.05 23.88L20.88 23.95Z",
  bucket:     "M10.60 23.99L9.95 23.99L9.30 23.87L8.57 23.58L8.21 23.36L7.90 23.12L1.35 16.57L1.01 16.11L0.80 15.70L0.55 14.95L0.48 14.11L0.58 13.39L0.80 12.74L1.16 12.11L1.35 11.87L2.09 11.13L8.51 4.92L5.45 1.83L5.28 1.40L5.28 0.96L5.35 0.72L5.52 0.43L5.83 0.16L6.26 -0.01L6.72 -0.01L6.93 0.06L7.20 0.21L19.01 12.01L19.42 12.62L19.63 13.10L19.75 13.51L19.85 14.21L19.83 14.76L19.75 15.17L19.54 15.82L19.32 16.23L19.01 16.67L12.46 23.22L12.10 23.48L11.59 23.75L11.06 23.92L10.61 23.98ZM17.49 14.33L17.46 14.06L17.37 13.85L17.20 13.60L10.22 6.62L3.44 13.18L3.14 13.48L2.92 13.85L2.85 14.16L2.88 14.34L17.48 14.34ZM21.31 23.99L20.85 23.99L20.37 23.89L19.84 23.65L19.48 23.38L19.27 23.18L19.01 22.82L18.79 22.36L18.67 21.81L18.67 21.42L18.72 21.15L18.89 20.62L19.08 20.16L19.78 18.81L20.65 17.42L20.83 17.28L20.97 17.23L21.19 17.23L21.38 17.31L21.59 17.51L22.38 18.81L23.08 20.16L23.42 21.06L23.49 21.42L23.49 21.81L23.37 22.36L23.16 22.82L22.89 23.18L22.69 23.38L22.32 23.65L21.79 23.89L21.32 23.98Z",
  wand:       "M8.47 10.78L8.35 10.04L7.99 8.87L7.63 8.15L7.05 7.29L6.44 6.64L5.54 5.97L4.82 5.61L3.89 5.36L4.32 5.29L4.86 5.11L5.49 4.80L6.30 4.21L6.91 3.60L7.45 2.88L7.99 1.85L8.31 0.90L8.44 0.00L8.49 0.00L8.49 0.32L8.67 1.13L8.94 1.89L9.34 2.70L9.93 3.51L10.72 4.30L11.57 4.89L12.43 5.25L13.04 5.36L12.20 5.56L11.44 5.92L10.63 6.51L9.97 7.16L9.39 7.97L8.94 8.83L8.58 9.95L8.49 10.76ZM19.41 8.58L19.38 8.24L19.11 7.29L18.66 6.44L18.26 5.90L17.79 5.43L17.07 4.93L16.39 4.66L16.01 4.59L16.62 4.44L17.34 4.08L18.01 3.53L18.39 3.11L19.02 2.07L19.25 1.49L19.38 0.90L19.38 0.63L19.47 0.72L19.47 0.99L19.61 1.53L19.88 2.21L20.60 3.29L21.03 3.71L21.66 4.17L22.11 4.39L22.85 4.59L22.06 4.80L21.61 5.02L21.12 5.38L20.51 5.99L20.15 6.48L19.79 7.16L19.56 7.79L19.43 8.56ZM4.19 23.98L3.78 23.98L3.47 23.84L1.24 21.61L1.10 21.30L1.10 20.89L1.24 20.53L14.23 7.54L14.54 7.41L15.04 7.41L15.35 7.54L17.54 9.73L17.72 10.22L17.67 10.58L17.54 10.85L4.55 23.84L4.21 23.95ZM13.08 13.78L16.55 10.31L14.77 8.53L11.32 11.98L11.32 12.07L13.06 13.80ZM19.41 18.57L19.38 18.28L19.20 17.65L18.89 17.02L18.53 16.53L18.10 16.10L17.65 15.78L17.38 15.65L16.77 15.49L17.29 15.33L17.74 15.11L18.06 14.88L18.62 14.32L19.02 13.69L19.20 13.28L19.38 12.65L19.38 12.34L19.43 12.34L19.52 12.92L19.65 13.33L20.20 14.27L20.58 14.70L21.25 15.20L22.04 15.49L21.48 15.65L20.98 15.92L20.24 16.62L19.70 17.52L19.43 18.55Z",
  lasso:      "M8.96 1.62L8.79 1.54L8.50 0.56L9.11 0.39L10.04 0.24L11.95 0.29L12.02 0.47L11.78 1.40L10.19 1.37L8.99 1.59ZM16.26 3.48L15.13 2.64L13.98 2.03L14.23 0.96L14.50 1.03L15.62 1.62L17.17 2.77L16.29 3.45ZM5.09 4.85L4.21 4.51L4.09 4.38L4.48 3.55L5.31 2.42L5.98 1.81L6.42 1.52L6.69 2.33L6.73 2.67L6.27 3.04L5.85 3.50L5.51 3.99L5.12 4.82ZM19.40 7.35L19.22 7.32L18.78 6.49L17.85 5.12L18.71 4.46L19.42 5.36L20.35 6.93L20.33 7.05L19.42 7.32ZM3.92 10.43L2.82 10.21L3.31 8.89L3.55 7.67L3.60 6.73L3.82 6.76L4.68 7.18L4.68 7.57L4.48 8.79L4.38 8.99L4.29 9.53L3.94 10.41ZM18.17 23.71L18.10 23.68L15.58 18.51L12.81 22.31L12.42 22.75L12.42 8.55L12.88 8.82L23.98 16.92L19.00 16.95L18.93 17.02L21.38 22.07L18.20 23.68ZM22.14 12.78L20.84 11.83L20.55 10.56L20.20 9.62L20.20 9.48L20.28 9.40L21.28 9.13L21.82 10.90L22.16 12.76ZM18.73 22.16L19.79 21.65L19.86 21.58L19.86 21.43L19.76 21.33L17.12 15.84L20.50 15.80L13.57 10.73L13.54 19.27L13.69 19.18L15.40 16.78L15.77 16.36L18.59 22.11L18.71 22.19ZM0.05 15.72L-0.02 15.21L0.22 14.18L0.56 13.44L1.05 12.76L1.47 12.34L2.69 12.49L2.72 12.56L1.40 14.28L1.15 14.82L1.10 15.45L0.07 15.70ZM4.21 19.89L3.43 19.74L2.25 19.25L1.57 18.76L0.76 17.90L0.83 17.83L1.96 17.63L2.50 18.07L3.09 18.42L3.77 18.66L4.31 18.76L4.33 19.18L4.24 19.86ZM10.14 20.23L9.16 19.93L8.28 19.79L7.79 19.79L7.74 19.74L6.56 19.79L6.54 19.47L6.64 18.69L7.05 18.61L8.33 18.66L9.26 18.81L10.14 19.05L10.16 20.20Z",
  invert:     "M3.79 23.99L3.12 23.96L2.64 23.85L2.19 23.69L1.87 23.53L1.39 23.21L0.89 22.75L0.44 22.11L0.23 21.65L0.01 20.85L-0.01 20.61L-0.01 3.36L0.04 2.96L0.28 2.19L0.52 1.73L0.89 1.23L1.39 0.76L1.87 0.44L2.19 0.28L2.64 0.12L3.36 -0.01L20.61 -0.01L21.15 0.07L21.79 0.28L22.24 0.52L22.75 0.89L23.11 1.25L23.53 1.87L23.75 2.32L23.96 3.12L23.99 4.85L23.93 5.07L23.80 5.31L23.49 5.59L23.09 5.72L22.75 5.69L22.40 5.53L22.12 5.23L21.99 4.85L21.96 3.31L21.88 3.04L21.75 2.77L21.59 2.56L21.49 2.49L16.71 7.28L17.13 7.73L17.45 8.16L17.75 8.61L18.07 9.23L18.25 9.68L18.47 10.37L18.57 10.88L18.65 11.57L18.65 12.40L18.57 13.09L18.47 13.60L18.25 14.29L18.07 14.75L17.67 15.49L17.32 16.00L16.95 16.45L16.45 16.95L15.89 17.40L15.36 17.75L14.69 18.09L14.29 18.25L13.49 18.49L12.40 18.65L11.57 18.65L11.07 18.60L10.37 18.47L9.68 18.25L9.23 18.07L8.48 17.67L7.73 17.13L7.25 16.71L2.49 21.47L2.49 21.52L2.69 21.69L3.04 21.88L3.31 21.96L3.81 21.99L4.00 22.04L4.21 22.15L4.49 22.43L4.65 22.83L4.65 23.15L4.60 23.33L4.49 23.55L4.35 23.72L4.00 23.93L3.80 23.97ZM20.61 23.99L8.43 23.99L8.05 23.85L7.75 23.57L7.59 23.23L7.56 22.88L7.64 22.59L7.75 22.40L8.05 22.12L8.43 21.99L20.51 21.99L20.93 21.88L21.20 21.75L21.59 21.41L21.75 21.20L21.88 20.93L21.99 20.51L21.99 7.84L22.04 7.63L22.17 7.39L22.40 7.16L22.59 7.05L22.88 6.97L23.23 7.00L23.57 7.16L23.80 7.39L23.93 7.63L23.99 7.84L23.99 20.61L23.93 21.01L23.69 21.79L23.45 22.24L23.08 22.75L22.59 23.21L22.11 23.53L21.79 23.69L21.33 23.85L21.01 23.93L20.63 23.97ZM8.73 15.25L15.27 8.72L15.27 8.67L15.09 8.49L14.69 8.17L14.32 7.93L13.84 7.69L13.04 7.43L12.29 7.32L11.41 7.35L10.83 7.45L10.40 7.59L9.52 8.01L8.85 8.52L8.49 8.88L8.12 9.36L7.67 10.19L7.45 10.83L7.32 11.65L7.32 12.29L7.37 12.75L7.45 13.15L7.67 13.79L8.12 14.61L8.49 15.09L8.67 15.27L8.72 15.27Z",
  deselect:   "M12.43 23.98L11.52 23.98L11.48 23.94L10.48 23.89L8.92 23.59L7.28 23.03L5.76 22.25L4.46 21.34L3.10 20.06L2.10 18.80L1.15 17.16L0.76 16.25L0.45 15.34L0.11 13.78L-0.02 12.43L-0.02 11.52L0.11 10.18L0.54 8.32L1.15 6.80L2.10 5.16L3.10 3.90L3.90 3.10L5.29 2.01L6.37 1.36L7.71 0.76L8.92 0.37L10.48 0.06L11.48 0.02L11.52 -0.02L12.43 -0.02L14.04 0.15L15.34 0.45L16.68 0.93L17.59 1.36L19.10 2.32L20.06 3.10L21.34 4.46L22.12 5.55L22.90 6.97L23.50 8.62L23.81 9.92L23.94 10.92L23.98 12.43L23.85 13.78L23.50 15.34L23.03 16.68L22.25 18.19L21.64 19.10L20.86 20.06L19.49 21.34L18.19 22.25L16.68 23.03L15.34 23.50L14.04 23.81L12.45 23.96ZM15.05 17.63L15.34 17.52L16.53 16.33L17.39 15.42L17.57 15.08L17.52 14.69L17.26 14.34L14.92 12.00L17.44 9.40L17.57 9.14L17.57 8.88L17.39 8.53L15.34 6.43L15.16 6.35L14.86 6.35L14.60 6.52L12.04 9.08L9.53 6.61L9.23 6.43L8.88 6.43L8.58 6.61L7.62 7.52L6.48 8.66L6.39 8.84L6.39 9.14L6.61 9.44L9.16 11.96L6.52 14.60L6.35 14.95L6.43 15.25L8.58 17.35L8.88 17.52L9.23 17.52L9.57 17.31L12.04 14.84L14.64 17.48L15.03 17.65Z",
  fillsel:    "M12.58 23.96L11.26 23.96L9.10 23.46L7.86 22.88L6.46 21.89L5.17 20.52L4.43 19.37L3.68 17.46L3.43 16.06L3.43 14.65L3.77 12.91L4.51 10.76L5.50 8.69L7.82 4.97L11.54 0.17L11.83 -0.04L12.37 0.17L15.60 4.39L15.68 4.63L15.02 5.38L15.10 6.37L15.89 6.99L16.47 6.99L17.13 6.58L17.67 7.28L19.74 11.59L20.48 14.81L20.40 16.63L19.90 18.46L19.41 19.53L18.41 20.94L17.46 21.89L16.06 22.88L14.32 23.63L12.62 23.92ZM16.39 4.10L16.06 4.10L15.77 3.81L15.85 1.82L16.30 1.61L16.68 1.99L16.68 3.72L16.43 4.06ZM17.88 4.68L17.34 4.55L17.26 4.14L17.42 3.89L18.70 2.69L18.95 2.69L19.24 2.98L19.16 3.48L17.92 4.63ZM16.47 6.58L15.97 6.58L15.52 6.21L15.43 5.46L15.60 5.21L16.06 4.92L16.84 5.21L17.01 6.04L16.51 6.54ZM14.28 6.12L14.52 5.63L14.23 5.34L12.33 5.34L12.12 5.54L12.12 5.96L12.33 6.17L14.23 6.17ZM19.12 6.25L18.12 6.17L17.83 5.79L17.92 5.54L18.12 5.34L20.11 5.34L20.32 5.54L20.32 5.96L20.11 6.17L19.16 6.21ZM13.78 8.77L15.19 7.28L14.90 6.83L14.57 6.83L13.20 8.19L13.28 8.69L13.74 8.81ZM16.26 9.85L16.47 9.81L16.68 9.43L16.68 7.86L16.47 7.49L15.97 7.49L15.77 7.78L15.77 9.52L16.22 9.89Z",
  clearsel:   "M12.66 23.96L10.68 23.88L9.10 23.46L7.86 22.88L6.29 21.72L5.01 20.28L4.01 18.46L3.43 15.97L3.43 14.81L3.85 12.66L4.68 10.34L5.75 8.19L7.74 5.05L11.46 0.25L12.08 -0.04L12.62 0.50L15.27 4.14L15.06 4.51L14.65 4.59L11.92 1.20L10.22 3.23L7.49 7.03L5.67 10.34L4.76 12.74L4.43 14.15L4.43 16.55L5.34 19.12L6.08 20.19L8.11 21.97L10.01 22.80L11.42 23.05L13.16 22.97L14.65 22.55L16.30 21.64L17.92 20.11L18.58 19.12L19.24 17.63L19.57 15.97L19.57 14.73L19.24 12.99L18.66 11.26L16.76 7.45L17.05 6.99L17.59 7.12L19.16 10.10L20.07 12.58L20.48 14.73L20.40 16.63L19.90 18.46L19.24 19.78L18.33 21.02L17.05 22.22L16.06 22.88L14.07 23.71L12.70 23.92ZM16.22 4.10L15.89 4.10L15.60 3.81L15.68 1.82L16.06 1.61L16.51 1.99L16.51 3.72L16.26 4.06ZM17.71 4.68L17.17 4.55L17.17 3.97L18.37 2.77L18.79 2.69L19.08 2.98L19.08 3.31L18.83 3.64L17.75 4.63ZM16.22 6.58L15.81 6.58L15.35 6.21L15.35 5.30L15.89 4.92L16.68 5.21L16.84 6.04L16.26 6.54ZM13.82 6.25L12.17 6.17L11.88 5.79L11.96 5.54L12.50 5.26L14.15 5.34L14.36 5.54L14.36 5.96L13.86 6.21ZM19.94 6.17L17.96 6.17L17.67 5.79L17.75 5.54L17.96 5.34L19.70 5.26L20.15 5.54L19.99 6.12ZM13.57 8.81L13.24 8.81L13.03 8.61L13.20 7.94L14.40 6.83L14.73 6.83L14.94 7.03L15.02 7.28L14.86 7.61L13.61 8.77ZM16.14 9.89L15.60 9.60L15.60 7.70L16.14 7.41L16.51 7.78L16.51 9.52L16.18 9.85Z",
  turnleft:   "M9.97 23.98L10.03 23.98L10.21 23.86L10.36 23.80L10.57 23.65L10.72 23.59L10.78 23.53L10.93 23.47L10.99 23.41L11.14 23.35L11.20 23.29L11.35 23.23L11.41 23.17L11.56 23.11L11.62 23.05L11.77 22.99L11.83 22.93L11.98 22.87L12.05 22.81L12.20 22.75L12.26 22.69L12.62 22.51L12.83 22.36L12.98 22.30L13.04 22.24L13.19 22.18L13.25 22.12L13.40 22.06L13.46 22.00L13.61 21.94L13.67 21.88L13.82 21.82L13.88 21.76L14.03 21.70L14.09 21.64L14.24 21.58L14.30 21.52L14.45 21.46L14.51 21.40L14.87 21.22L15.08 21.07L15.23 21.01L15.29 20.95L15.44 20.89L15.50 20.83L15.65 20.77L15.71 20.71L15.86 20.65L15.92 20.59L16.07 20.53L16.13 20.47L16.28 20.41L16.34 20.35L16.49 20.29L16.55 20.23L16.70 20.17L16.76 20.11L17.12 19.93L17.33 19.78L17.69 19.60L17.77 19.52L17.72 19.48L17.57 19.42L17.51 19.36L17.36 19.30L17.30 19.24L17.15 19.18L17.09 19.12L16.94 19.06L16.88 19.00L16.73 18.94L16.67 18.88L16.31 18.70L16.10 18.55L15.95 18.49L15.89 18.43L15.74 18.37L15.68 18.31L15.53 18.25L15.47 18.19L15.32 18.13L15.26 18.07L15.11 18.01L15.05 17.95L14.90 17.89L14.84 17.83L14.69 17.77L14.63 17.71L14.48 17.65L14.42 17.59L14.27 17.53L14.21 17.47L13.85 17.29L13.64 17.14L13.49 17.08L13.43 17.02L13.28 16.96L13.22 16.90L13.07 16.84L13.01 16.78L12.86 16.72L12.80 16.66L12.65 16.60L12.59 16.54L12.44 16.48L12.38 16.42L12.23 16.36L12.17 16.30L12.02 16.24L11.95 16.18L11.80 16.12L11.74 16.06L11.59 15.99L11.38 15.84L11.23 15.78L11.17 15.72L11.02 15.66L10.96 15.60L10.81 15.54L10.75 15.48L10.60 15.42L10.54 15.36L10.39 15.30L10.33 15.24L10.18 15.18L10.00 15.06L9.96 15.08L9.96 17.66L9.94 17.68L9.91 17.65L9.85 17.65L9.82 17.62L9.76 17.62L9.73 17.59L9.40 17.50L9.25 17.41L8.98 17.32L8.95 17.29L8.92 17.29L8.89 17.26L8.86 17.26L8.83 17.23L8.44 17.05L8.38 16.99L8.29 16.96L8.23 16.90L8.14 16.87L8.08 16.81L7.78 16.63L7.54 16.45L7.42 16.33L7.39 16.33L7.24 16.18L7.21 16.18L6.44 15.41L6.44 15.38L6.17 15.08L6.11 14.96L6.02 14.87L6.02 14.84L5.78 14.51L5.75 14.42L5.60 14.21L5.60 14.18L5.57 14.15L5.57 14.12L5.54 14.09L5.54 14.06L5.51 14.03L5.51 14.00L5.30 13.61L5.30 13.55L5.21 13.40L5.18 13.25L5.12 13.16L5.12 13.10L5.09 13.07L5.09 13.01L4.97 12.71L4.91 12.41L4.88 12.38L4.88 12.26L4.85 12.23L4.82 11.95L4.79 11.92L4.79 11.77L4.76 11.74L4.76 11.59L4.73 11.56L4.73 11.29L4.70 11.26L4.70 10.15L4.73 10.12L4.73 9.82L4.76 9.79L4.76 9.61L4.79 9.58L4.79 9.43L4.82 9.40L4.85 9.10L4.88 9.07L4.94 8.74L5.00 8.62L5.00 8.53L5.03 8.50L5.03 8.44L5.06 8.41L5.15 8.08L5.30 7.78L5.30 7.72L5.33 7.69L5.33 7.66L5.36 7.63L5.36 7.60L5.39 7.57L5.39 7.54L5.42 7.51L5.42 7.48L5.45 7.45L5.63 7.06L5.69 7.00L5.81 6.76L5.99 6.49L6.08 6.40L6.14 6.28L6.26 6.16L6.38 5.98L6.56 5.80L6.56 5.77L7.12 5.21L7.15 5.21L7.48 4.91L7.51 4.91L7.60 4.82L7.63 4.82L7.72 4.73L7.75 4.73L7.84 4.64L8.11 4.46L8.20 4.43L8.47 4.25L8.50 4.25L8.53 4.22L8.56 4.22L8.59 4.19L8.62 4.19L9.01 3.98L9.07 3.98L9.22 3.89L9.28 3.89L9.52 3.77L9.79 3.68L9.88 3.68L10.00 3.62L10.09 3.62L10.21 3.56L10.33 3.56L10.48 3.50L10.60 3.50L10.78 3.44L10.93 3.44L10.96 3.41L11.17 3.41L11.20 3.38L11.50 3.38L11.53 3.35L12.47 3.35L12.50 3.38L12.80 3.38L12.83 3.41L13.04 3.41L13.07 3.44L13.22 3.44L13.25 3.47L13.52 3.50L13.67 3.56L13.79 3.56L13.91 3.62L14.12 3.65L14.15 3.68L14.48 3.77L14.57 3.83L14.63 3.83L14.72 3.89L14.93 3.95L14.96 3.98L14.99 3.98L15.02 4.01L15.05 4.01L15.08 4.04L15.11 4.04L15.14 4.07L15.17 4.07L15.20 4.10L15.59 4.28L15.65 4.34L15.80 4.40L15.86 4.46L16.04 4.55L16.25 4.70L16.49 4.91L16.64 5.00L16.82 5.18L16.85 5.18L17.50 5.83L17.50 5.86L17.65 6.01L17.65 6.04L17.89 6.31L17.89 6.34L18.04 6.52L18.19 6.79L18.31 6.94L18.37 7.09L18.43 7.15L18.43 7.18L18.46 7.21L18.46 7.24L18.67 7.63L18.67 7.69L18.85 8.05L18.85 8.11L18.88 8.14L18.88 8.20L18.91 8.23L18.91 8.29L19.03 8.59L19.03 8.68L19.09 8.80L19.15 9.04L19.15 9.16L19.18 9.19L19.18 9.31L19.21 9.34L19.24 9.70L19.27 9.73L19.27 9.94L19.30 9.97L19.30 11.23L19.27 11.26L19.27 11.53L19.24 11.56L19.24 11.77L19.21 11.95L19.18 11.98L19.18 12.11L19.15 12.14L19.15 12.26L19.12 12.29L19.06 12.62L19.03 12.65L18.97 12.92L18.88 13.10L18.82 13.34L18.73 13.49L18.64 13.76L18.86 13.89L18.92 13.89L19.31 14.10L19.37 14.10L19.40 14.13L19.43 14.13L19.82 14.34L19.88 14.34L20.28 14.55L20.34 14.55L20.37 14.58L20.40 14.58L20.79 14.79L20.85 14.79L21.24 15.00L21.30 15.00L21.66 15.18L21.70 15.14L21.73 15.02L21.85 14.81L21.85 14.75L21.91 14.66L21.91 14.60L22.03 14.36L22.03 14.30L22.06 14.27L22.06 14.21L22.09 14.18L22.09 14.12L22.21 13.82L22.21 13.73L22.30 13.52L22.30 13.43L22.33 13.40L22.33 13.31L22.42 13.04L22.42 12.92L22.45 12.89L22.45 12.77L22.48 12.74L22.48 12.62L22.54 12.44L22.54 12.26L22.60 12.02L22.60 11.77L22.63 11.74L22.63 11.41L22.66 11.38L22.66 10.57L22.69 10.54L22.69 10.24L22.66 10.21L22.66 9.76L22.63 9.73L22.63 9.46L22.60 9.43L22.60 9.22L22.57 9.01L22.54 8.98L22.54 8.83L22.51 8.80L22.51 8.68L22.48 8.65L22.45 8.38L22.42 8.35L22.42 8.26L22.39 8.23L22.39 8.14L22.36 8.11L22.30 7.78L22.24 7.66L22.24 7.57L22.21 7.54L22.21 7.48L22.18 7.45L22.18 7.39L22.15 7.36L22.06 7.03L22.00 6.94L22.00 6.88L21.94 6.79L21.94 6.73L21.88 6.64L21.82 6.43L21.67 6.16L21.67 6.10L21.64 6.07L21.46 5.68L21.40 5.62L21.31 5.41L21.25 5.35L21.22 5.26L21.16 5.20L21.13 5.11L21.07 5.05L21.04 4.96L20.98 4.90L20.80 4.60L20.71 4.51L20.71 4.48L20.47 4.18L20.47 4.15L20.23 3.87L20.23 3.84L20.05 3.63L19.78 3.36L19.78 3.33L19.37 2.93L19.34 2.93L19.04 2.63L18.83 2.45L18.80 2.45L18.68 2.33L18.65 2.33L18.53 2.21L18.29 2.03L18.17 1.97L18.08 1.88L18.05 1.88L17.99 1.82L17.96 1.82L17.63 1.58L17.33 1.43L17.27 1.37L17.06 1.28L17.00 1.22L16.97 1.22L16.94 1.19L16.91 1.19L16.52 0.98L16.46 0.98L16.25 0.86L16.19 0.86L16.04 0.77L15.98 0.77L15.74 0.65L15.68 0.65L15.65 0.62L15.59 0.62L15.56 0.59L15.50 0.59L15.47 0.56L15.41 0.56L15.38 0.53L15.32 0.53L15.02 0.41L14.81 0.38L14.69 0.32L14.60 0.32L14.33 0.23L14.21 0.23L14.18 0.20L13.91 0.17L13.88 0.14L13.73 0.14L13.52 0.08L13.31 0.08L13.28 0.05L13.01 0.05L12.98 0.02L12.56 0.02L12.53 -0.02L11.47 -0.02L11.44 0.02L11.02 0.02L10.99 0.05L10.72 0.05L10.69 0.08L10.51 0.08L10.48 0.11L10.12 0.14L10.09 0.17L9.97 0.17L9.94 0.20L9.67 0.23L9.64 0.26L9.31 0.32L9.19 0.38L9.10 0.38L8.98 0.44L8.89 0.44L8.86 0.47L8.80 0.47L8.77 0.50L8.71 0.50L8.68 0.53L8.35 0.62L8.26 0.68L8.20 0.68L8.11 0.74L7.90 0.80L7.75 0.89L7.69 0.89L7.48 1.01L7.42 1.01L7.18 1.13L7.12 1.19L6.85 1.31L6.79 1.37L6.43 1.55L6.37 1.61L6.34 1.61L6.28 1.67L6.25 1.67L6.19 1.73L5.89 1.91L5.59 2.15L5.56 2.15L5.44 2.27L5.41 2.27L5.29 2.39L5.11 2.51L4.87 2.75L4.84 2.75L4.07 3.51L4.07 3.54L3.89 3.72L3.89 3.75L3.59 4.09L3.59 4.12L3.41 4.33L3.35 4.45L3.26 4.54L3.26 4.57L3.20 4.63L3.20 4.66L2.96 4.99L2.93 5.08L2.87 5.14L2.84 5.23L2.69 5.44L2.69 5.47L2.66 5.50L2.66 5.53L2.63 5.56L2.63 5.59L2.60 5.62L2.60 5.65L2.57 5.68L2.57 5.71L2.54 5.74L2.54 5.77L2.51 5.80L2.51 5.83L2.48 5.86L2.48 5.89L2.27 6.28L2.27 6.34L2.18 6.49L2.18 6.55L2.03 6.85L1.97 7.09L1.91 7.18L1.82 7.45L1.82 7.54L1.76 7.66L1.76 7.75L1.70 7.87L1.64 8.20L1.61 8.23L1.61 8.35L1.58 8.38L1.55 8.62L1.52 8.65L1.52 8.80L1.49 8.83L1.49 8.98L1.46 9.01L1.46 9.19L1.43 9.22L1.43 9.43L1.40 9.46L1.40 9.70L1.37 9.73L1.37 10.18L1.34 10.21L1.34 11.32L1.37 11.35L1.37 11.71L1.40 11.74L1.40 11.98L1.43 12.02L1.43 12.20L1.46 12.23L1.49 12.56L1.52 12.59L1.52 12.71L1.55 12.74L1.58 13.01L1.61 13.04L1.61 13.13L1.64 13.16L1.70 13.49L1.76 13.61L1.76 13.70L1.79 13.73L1.79 13.79L1.82 13.82L1.82 13.88L1.85 13.91L1.85 13.97L1.88 14.00L1.97 14.33L2.03 14.42L2.03 14.48L2.09 14.57L2.15 14.78L2.24 14.93L2.24 14.99L2.27 15.02L2.27 15.05L2.30 15.08L2.30 15.11L2.33 15.14L2.33 15.17L2.36 15.20L2.36 15.23L2.39 15.26L2.39 15.29L2.42 15.32L2.42 15.35L2.45 15.38L2.45 15.41L2.48 15.44L2.66 15.83L2.72 15.89L2.78 16.04L2.84 16.10L2.96 16.34L3.02 16.40L3.02 16.43L3.08 16.49L3.26 16.79L3.35 16.88L3.53 17.15L3.65 17.27L3.77 17.45L3.92 17.60L3.92 17.63L4.19 17.90L4.19 17.93L4.78 18.52L4.81 18.52L5.05 18.76L5.08 18.76L5.38 19.03L5.41 19.03L5.74 19.30L5.86 19.36L5.95 19.45L6.22 19.63L6.31 19.66L6.46 19.78L6.76 19.93L6.82 19.99L7.15 20.14L7.39 20.29L7.45 20.29L7.72 20.44L7.78 20.44L7.93 20.53L7.99 20.53L8.23 20.65L8.29 20.65L8.32 20.68L8.38 20.68L8.41 20.71L8.47 20.71L8.50 20.74L8.56 20.74L8.59 20.77L8.65 20.77L8.68 20.80L8.74 20.80L8.77 20.83L8.83 20.83L9.13 20.95L9.22 20.95L9.49 21.04L9.61 21.04L9.64 21.07L9.73 21.07L9.96 21.15L9.96 23.97Z",   /* v61 — Ced's circular arrow, mirrored */
  turnright:  "M14.03 23.98L13.97 23.98L13.79 23.86L13.64 23.80L13.43 23.65L13.28 23.59L13.22 23.53L13.07 23.47L13.01 23.41L12.86 23.35L12.80 23.29L12.65 23.23L12.59 23.17L12.44 23.11L12.38 23.05L12.23 22.99L12.17 22.93L12.02 22.87L11.95 22.81L11.80 22.75L11.74 22.69L11.38 22.51L11.17 22.36L11.02 22.30L10.96 22.24L10.81 22.18L10.75 22.12L10.60 22.06L10.54 22.00L10.39 21.94L10.33 21.88L10.18 21.82L10.12 21.76L9.97 21.70L9.91 21.64L9.76 21.58L9.70 21.52L9.55 21.46L9.49 21.40L9.13 21.22L8.92 21.07L8.77 21.01L8.71 20.95L8.56 20.89L8.50 20.83L8.35 20.77L8.29 20.71L8.14 20.65L8.08 20.59L7.93 20.53L7.87 20.47L7.72 20.41L7.66 20.35L7.51 20.29L7.45 20.23L7.30 20.17L7.24 20.11L6.88 19.93L6.67 19.78L6.31 19.60L6.23 19.52L6.28 19.48L6.43 19.42L6.49 19.36L6.64 19.30L6.70 19.24L6.85 19.18L6.91 19.12L7.06 19.06L7.12 19.00L7.27 18.94L7.33 18.88L7.69 18.70L7.90 18.55L8.05 18.49L8.11 18.43L8.26 18.37L8.32 18.31L8.47 18.25L8.53 18.19L8.68 18.13L8.74 18.07L8.89 18.01L8.95 17.95L9.10 17.89L9.16 17.83L9.31 17.77L9.37 17.71L9.52 17.65L9.58 17.59L9.73 17.53L9.79 17.47L10.15 17.29L10.36 17.14L10.51 17.08L10.57 17.02L10.72 16.96L10.78 16.90L10.93 16.84L10.99 16.78L11.14 16.72L11.20 16.66L11.35 16.60L11.41 16.54L11.56 16.48L11.62 16.42L11.77 16.36L11.83 16.30L11.98 16.24L12.05 16.18L12.20 16.12L12.26 16.06L12.41 15.99L12.62 15.84L12.77 15.78L12.83 15.72L12.98 15.66L13.04 15.60L13.19 15.54L13.25 15.48L13.40 15.42L13.46 15.36L13.61 15.30L13.67 15.24L13.82 15.18L14.00 15.06L14.04 15.08L14.04 17.66L14.06 17.68L14.09 17.65L14.15 17.65L14.18 17.62L14.24 17.62L14.27 17.59L14.60 17.50L14.75 17.41L15.02 17.32L15.05 17.29L15.08 17.29L15.11 17.26L15.14 17.26L15.17 17.23L15.56 17.05L15.62 16.99L15.71 16.96L15.77 16.90L15.86 16.87L15.92 16.81L16.22 16.63L16.46 16.45L16.58 16.33L16.61 16.33L16.76 16.18L16.79 16.18L17.56 15.41L17.56 15.38L17.83 15.08L17.89 14.96L17.98 14.87L17.98 14.84L18.22 14.51L18.25 14.42L18.40 14.21L18.40 14.18L18.43 14.15L18.43 14.12L18.46 14.09L18.46 14.06L18.49 14.03L18.49 14.00L18.70 13.61L18.70 13.55L18.79 13.40L18.82 13.25L18.88 13.16L18.88 13.10L18.91 13.07L18.91 13.01L19.03 12.71L19.09 12.41L19.12 12.38L19.12 12.26L19.15 12.23L19.18 11.95L19.21 11.92L19.21 11.77L19.24 11.74L19.24 11.59L19.27 11.56L19.27 11.29L19.30 11.26L19.30 10.15L19.27 10.12L19.27 9.82L19.24 9.79L19.24 9.61L19.21 9.58L19.21 9.43L19.18 9.40L19.15 9.10L19.12 9.07L19.06 8.74L19.00 8.62L19.00 8.53L18.97 8.50L18.97 8.44L18.94 8.41L18.85 8.08L18.70 7.78L18.70 7.72L18.67 7.69L18.67 7.66L18.64 7.63L18.64 7.60L18.61 7.57L18.61 7.54L18.58 7.51L18.58 7.48L18.55 7.45L18.37 7.06L18.31 7.00L18.19 6.76L18.01 6.49L17.92 6.40L17.86 6.28L17.74 6.16L17.62 5.98L17.44 5.80L17.44 5.77L16.88 5.21L16.85 5.21L16.52 4.91L16.49 4.91L16.40 4.82L16.37 4.82L16.28 4.73L16.25 4.73L16.16 4.64L15.89 4.46L15.80 4.43L15.53 4.25L15.50 4.25L15.47 4.22L15.44 4.22L15.41 4.19L15.38 4.19L14.99 3.98L14.93 3.98L14.78 3.89L14.72 3.89L14.48 3.77L14.21 3.68L14.12 3.68L14.00 3.62L13.91 3.62L13.79 3.56L13.67 3.56L13.52 3.50L13.40 3.50L13.22 3.44L13.07 3.44L13.04 3.41L12.83 3.41L12.80 3.38L12.50 3.38L12.47 3.35L11.53 3.35L11.50 3.38L11.20 3.38L11.17 3.41L10.96 3.41L10.93 3.44L10.78 3.44L10.75 3.47L10.48 3.50L10.33 3.56L10.21 3.56L10.09 3.62L9.88 3.65L9.85 3.68L9.52 3.77L9.43 3.83L9.37 3.83L9.28 3.89L9.07 3.95L9.04 3.98L9.01 3.98L8.98 4.01L8.95 4.01L8.92 4.04L8.89 4.04L8.86 4.07L8.83 4.07L8.80 4.10L8.41 4.28L8.35 4.34L8.20 4.40L8.14 4.46L7.96 4.55L7.75 4.70L7.51 4.91L7.36 5.00L7.18 5.18L7.15 5.18L6.50 5.83L6.50 5.86L6.35 6.01L6.35 6.04L6.11 6.31L6.11 6.34L5.96 6.52L5.81 6.79L5.69 6.94L5.63 7.09L5.57 7.15L5.57 7.18L5.54 7.21L5.54 7.24L5.33 7.63L5.33 7.69L5.15 8.05L5.15 8.11L5.12 8.14L5.12 8.20L5.09 8.23L5.09 8.29L4.97 8.59L4.97 8.68L4.91 8.80L4.85 9.04L4.85 9.16L4.82 9.19L4.82 9.31L4.79 9.34L4.76 9.70L4.73 9.73L4.73 9.94L4.70 9.97L4.70 11.23L4.73 11.26L4.73 11.53L4.76 11.56L4.76 11.77L4.79 11.95L4.82 11.98L4.82 12.11L4.85 12.14L4.85 12.26L4.88 12.29L4.94 12.62L4.97 12.65L5.03 12.92L5.12 13.10L5.18 13.34L5.27 13.49L5.36 13.76L5.14 13.89L5.08 13.89L4.69 14.10L4.63 14.10L4.60 14.13L4.57 14.13L4.18 14.34L4.12 14.34L3.72 14.55L3.66 14.55L3.63 14.58L3.60 14.58L3.21 14.79L3.15 14.79L2.76 15.00L2.70 15.00L2.34 15.18L2.30 15.14L2.27 15.02L2.15 14.81L2.15 14.75L2.09 14.66L2.09 14.60L1.97 14.36L1.97 14.30L1.94 14.27L1.94 14.21L1.91 14.18L1.91 14.12L1.79 13.82L1.79 13.73L1.70 13.52L1.70 13.43L1.67 13.40L1.67 13.31L1.58 13.04L1.58 12.92L1.55 12.89L1.55 12.77L1.52 12.74L1.52 12.62L1.46 12.44L1.46 12.26L1.40 12.02L1.40 11.77L1.37 11.74L1.37 11.41L1.34 11.38L1.34 10.57L1.31 10.54L1.31 10.24L1.34 10.21L1.34 9.76L1.37 9.73L1.37 9.46L1.40 9.43L1.40 9.22L1.43 9.01L1.46 8.98L1.46 8.83L1.49 8.80L1.49 8.68L1.52 8.65L1.55 8.38L1.58 8.35L1.58 8.26L1.61 8.23L1.61 8.14L1.64 8.11L1.70 7.78L1.76 7.66L1.76 7.57L1.79 7.54L1.79 7.48L1.82 7.45L1.82 7.39L1.85 7.36L1.94 7.03L2.00 6.94L2.00 6.88L2.06 6.79L2.06 6.73L2.12 6.64L2.18 6.43L2.33 6.16L2.33 6.10L2.36 6.07L2.54 5.68L2.60 5.62L2.69 5.41L2.75 5.35L2.78 5.26L2.84 5.20L2.87 5.11L2.93 5.05L2.96 4.96L3.02 4.90L3.20 4.60L3.29 4.51L3.29 4.48L3.53 4.18L3.53 4.15L3.77 3.87L3.77 3.84L3.95 3.63L4.22 3.36L4.22 3.33L4.63 2.93L4.66 2.93L4.96 2.63L5.17 2.45L5.20 2.45L5.32 2.33L5.35 2.33L5.47 2.21L5.71 2.03L5.83 1.97L5.92 1.88L5.95 1.88L6.01 1.82L6.04 1.82L6.37 1.58L6.67 1.43L6.73 1.37L6.94 1.28L7.00 1.22L7.03 1.22L7.06 1.19L7.09 1.19L7.48 0.98L7.54 0.98L7.75 0.86L7.81 0.86L7.96 0.77L8.02 0.77L8.26 0.65L8.32 0.65L8.35 0.62L8.41 0.62L8.44 0.59L8.50 0.59L8.53 0.56L8.59 0.56L8.62 0.53L8.68 0.53L8.98 0.41L9.19 0.38L9.31 0.32L9.40 0.32L9.67 0.23L9.79 0.23L9.82 0.20L10.09 0.17L10.12 0.14L10.27 0.14L10.48 0.08L10.69 0.08L10.72 0.05L10.99 0.05L11.02 0.02L11.44 0.02L11.47 -0.02L12.53 -0.02L12.56 0.02L12.98 0.02L13.01 0.05L13.28 0.05L13.31 0.08L13.49 0.08L13.52 0.11L13.88 0.14L13.91 0.17L14.03 0.17L14.06 0.20L14.33 0.23L14.36 0.26L14.69 0.32L14.81 0.38L14.90 0.38L15.02 0.44L15.11 0.44L15.14 0.47L15.20 0.47L15.23 0.50L15.29 0.50L15.32 0.53L15.65 0.62L15.74 0.68L15.80 0.68L15.89 0.74L16.10 0.80L16.25 0.89L16.31 0.89L16.52 1.01L16.58 1.01L16.82 1.13L16.88 1.19L17.15 1.31L17.21 1.37L17.57 1.55L17.63 1.61L17.66 1.61L17.72 1.67L17.75 1.67L17.81 1.73L18.11 1.91L18.41 2.15L18.44 2.15L18.56 2.27L18.59 2.27L18.71 2.39L18.89 2.51L19.13 2.75L19.16 2.75L19.93 3.51L19.93 3.54L20.11 3.72L20.11 3.75L20.41 4.09L20.41 4.12L20.59 4.33L20.65 4.45L20.74 4.54L20.74 4.57L20.80 4.63L20.80 4.66L21.04 4.99L21.07 5.08L21.13 5.14L21.16 5.23L21.31 5.44L21.31 5.47L21.34 5.50L21.34 5.53L21.37 5.56L21.37 5.59L21.40 5.62L21.40 5.65L21.43 5.68L21.43 5.71L21.46 5.74L21.46 5.77L21.49 5.80L21.49 5.83L21.52 5.86L21.52 5.89L21.73 6.28L21.73 6.34L21.82 6.49L21.82 6.55L21.97 6.85L22.03 7.09L22.09 7.18L22.18 7.45L22.18 7.54L22.24 7.66L22.24 7.75L22.30 7.87L22.36 8.20L22.39 8.23L22.39 8.35L22.42 8.38L22.45 8.62L22.48 8.65L22.48 8.80L22.51 8.83L22.51 8.98L22.54 9.01L22.54 9.19L22.57 9.22L22.57 9.43L22.60 9.46L22.60 9.70L22.63 9.73L22.63 10.18L22.66 10.21L22.66 11.32L22.63 11.35L22.63 11.71L22.60 11.74L22.60 11.98L22.57 12.02L22.57 12.20L22.54 12.23L22.51 12.56L22.48 12.59L22.48 12.71L22.45 12.74L22.42 13.01L22.39 13.04L22.39 13.13L22.36 13.16L22.30 13.49L22.24 13.61L22.24 13.70L22.21 13.73L22.21 13.79L22.18 13.82L22.18 13.88L22.15 13.91L22.15 13.97L22.12 14.00L22.03 14.33L21.97 14.42L21.97 14.48L21.91 14.57L21.85 14.78L21.76 14.93L21.76 14.99L21.73 15.02L21.73 15.05L21.70 15.08L21.70 15.11L21.67 15.14L21.67 15.17L21.64 15.20L21.64 15.23L21.61 15.26L21.61 15.29L21.58 15.32L21.58 15.35L21.55 15.38L21.55 15.41L21.52 15.44L21.34 15.83L21.28 15.89L21.22 16.04L21.16 16.10L21.04 16.34L20.98 16.40L20.98 16.43L20.92 16.49L20.74 16.79L20.65 16.88L20.47 17.15L20.35 17.27L20.23 17.45L20.08 17.60L20.08 17.63L19.81 17.90L19.81 17.93L19.22 18.52L19.19 18.52L18.95 18.76L18.92 18.76L18.62 19.03L18.59 19.03L18.26 19.30L18.14 19.36L18.05 19.45L17.78 19.63L17.69 19.66L17.54 19.78L17.24 19.93L17.18 19.99L16.85 20.14L16.61 20.29L16.55 20.29L16.28 20.44L16.22 20.44L16.07 20.53L16.01 20.53L15.77 20.65L15.71 20.65L15.68 20.68L15.62 20.68L15.59 20.71L15.53 20.71L15.50 20.74L15.44 20.74L15.41 20.77L15.35 20.77L15.32 20.80L15.26 20.80L15.23 20.83L15.17 20.83L14.87 20.95L14.78 20.95L14.51 21.04L14.39 21.04L14.36 21.07L14.27 21.07L14.04 21.15L14.04 23.97Z",   /* v61 — Ced: "rotate icons on edit photo should be changed to this" */
  fliph:      "M14.70 11.81L14.42 11.72L14.33 8.47L5.77 8.47L3.72 9.40L2.23 10.88L2.14 8.56L2.51 7.26L3.26 5.95L4.84 4.37L6.88 3.44L14.33 3.26L14.42 0.00L14.70 -0.09L21.67 5.77L14.79 11.72ZM9.30 23.91L2.14 17.86L9.12 11.81L9.40 11.91L9.49 15.16L17.86 15.16L19.53 14.60L21.58 12.93L21.67 15.07L21.30 16.37L20.56 17.67L18.98 19.26L18.05 19.81L16.00 20.37L9.49 20.37L9.40 23.81Z",
  flipv:      "M18.05 21.70L17.73 21.66L17.89 21.59L16.97 20.75L15.87 19.16L15.12 18.56L14.93 18.04L14.02 17.27L13.99 16.94L13.84 17.01L13.81 16.73L12.01 14.86L12.02 14.47L15.31 14.45L15.27 5.83L15.15 5.96L15.11 5.30L14.36 3.78L13.28 2.48L12.90 2.31L16.04 2.46L16.07 2.67L16.56 2.70L17.87 3.40L19.17 4.69L19.56 5.59L19.94 5.86L20.34 7.79L20.46 7.65L20.47 14.43L23.99 14.50L23.09 15.45L22.90 15.96L22.15 16.57L21.78 17.27L21.21 17.67L20.12 19.26L19.37 19.87L19.17 20.38L18.26 21.15L18.06 21.69ZM10.89 21.72L8.65 21.70L7.38 21.35L7.32 21.13L6.07 20.58L4.59 19.10L4.37 18.39L4.26 18.58L4.06 18.14L3.66 16.20L3.54 16.33L3.53 9.55L-0.01 9.47L1.79 7.42L1.82 7.14L2.91 6.12L2.94 5.84L3.68 5.25L3.88 4.72L4.97 3.69L5.00 3.41L5.86 2.64L5.89 2.31L6.28 2.45L7.34 3.96L7.92 4.35L8.46 5.25L9.76 6.55L9.95 7.06L11.99 9.14L11.98 9.52L8.63 9.54L8.66 18.01L9.60 20.24L10.90 21.71Z",
  crop:       "M23.92 11.54L22.83 11.54L22.45 11.41L22.20 10.16L21.37 8.07L20.36 6.48L19.15 5.10L17.73 3.93L15.80 2.84L15.68 2.97L15.60 3.97L15.39 4.18L12.67 0.63L12.96 0.50L13.80 0.67L16.22 1.42L17.98 2.34L19.65 3.60L21.37 5.39L22.62 7.32L23.54 9.49L23.96 11.50ZM17.39 19.07L15.76 19.02L15.72 17.31L8.20 17.31L7.44 16.98L6.82 16.26L6.56 15.51L6.56 8.15L4.85 8.11L4.81 6.48L6.52 6.44L6.56 4.89L6.69 4.77L8.24 4.81L8.24 15.43L8.45 15.64L18.98 15.64L19.11 15.76L19.11 17.27L17.56 17.31L17.44 17.44L17.44 19.02ZM17.39 14.05L15.89 14.05L15.76 13.92L15.76 8.32L15.55 8.11L9.95 8.11L9.91 6.48L15.64 6.44L16.64 6.86L17.02 7.23L17.44 8.07L17.44 14.01ZM11.12 23.41L8.86 22.91L7.36 22.33L6.10 21.66L4.18 20.24L2.63 18.61L1.55 17.02L0.54 14.84L-0.04 12.42L1.46 12.42L1.88 14.26L2.80 16.26L3.89 17.85L5.44 19.40L6.86 20.40L7.94 20.99L8.24 20.95L8.32 20.03L8.53 19.74L11.16 23.12L11.16 23.37Z",
};
const edIco=k=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
  '<path fill="currentColor" fill-rule="evenodd" d="'+ED_ICO_PATHS[k]+'"/></svg>';
/* ==================================================================================================
   6nf — AUTO IS HOLOGRAPHIC. Ced sent a picture of an iridescent sheet: "make the color of auto be
   like this (holographic)."

   The stops are SAMPLED from that picture, across the brightest band of it, rather than picked by
   eye from the word "holographic": lilac at one end, then the pale blue, the cyan it turns through,
   the mint on the far side of that, and the warm grey-pink it lands on. Read off at eight points
   along the perpendicular to the band — #c6d2fe, #b0d7fc, #6cf7fe, #51f9fc, #81fff2, #bdfbc5,
   #e1e3d9, #e9d0da — and laid on the same diagonal the sheet runs on.

   The gradient is `objectBoundingBox`, so it fits the glyph at whatever size the rail draws it, and
   it carries its own id. Auto is an ACTION and never takes the `on` state, which is the one place a
   fixed-colour glyph would disappear — every other coloured glyph here still gets its colour from
   CSS, where the selected state can take it back. */
/* v60 — AND THE SHEET TAKES THE THEME. Ced: "make the color of the iridescent icon match the theme."
   Each stop now reads `--holo-1…8`, which ds.css derives from the theme's own accent: the same
   eight-step sweep around the colour wheel, but centred on the accent's hue instead of on cyan, so
   Forest shimmers green, Crimson warm, Ontel a cool grey-lilac. The sampled colours stay as each
   stop's fallback, for a browser too old to do the derivation. */
const ED_ICO_AUTO=
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
    '<defs><linearGradient id="skHolo" x1="0" y1="1" x2="1" y2="0">'+
      '<stop offset="0" style="stop-color:var(--holo-1,#c2b7fc)"/>'+
      '<stop offset="0.16" style="stop-color:var(--holo-2,#c6d2fe)"/>'+
      '<stop offset="0.34" style="stop-color:var(--holo-3,#9cdffb)"/>'+
      '<stop offset="0.50" style="stop-color:var(--holo-4,#51f9fc)"/>'+
      '<stop offset="0.64" style="stop-color:var(--holo-5,#81fff2)"/>'+
      '<stop offset="0.78" style="stop-color:var(--holo-6,#bdfbc5)"/>'+
      '<stop offset="0.90" style="stop-color:var(--holo-7,#e1e3d9)"/>'+
      '<stop offset="1" style="stop-color:var(--holo-8,#e9d0da)"/>'+
    '</linearGradient></defs>'+
    '<path fill="url(#skHolo)" fill-rule="evenodd" d="'+ED_ICO_PATHS.auto+'"/>'+
  '</svg>';
/* 6nd — and the five that had no artwork. Ced: "all shapes icon should be thicker." These were
   typographic glyphs, whose weight is the font's and not ours, so they are drawn here at a stroke
   the rest of the set can stand beside: 3 units in a 24-unit box, round caps, round joins. */
/* `style="fill:none"` and not the `fill` attribute: `.sk-edg svg{fill:currentColor}` is a
   stylesheet rule and beats a presentation attribute, which is how the first cut of these came out
   as a solid square, a solid disc and a solid rounded rect instead of outlines. An inline style
   beats the stylesheet, which is the honest place for "this one is drawn in line, not in mass". */
const edStroke=body=>'<svg viewBox="0 0 24 24" style="fill:none" stroke="currentColor" '+
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" '+
  'aria-hidden="true" focusable="false">'+body+'</svg>';
/* v60 — THE LASSO, DRAWN. Ced: "the lasso tool icon, make the dotted line thicker and the arrow
   filled out." The traced artwork had a loop of hairline dashes and an arrow drawn as an outline —
   the lightest glyph in a set whose others are solid. The loop is now a 2.6-unit dotted stroke with
   round caps (dots, not dashes), and the arrow is one solid shape with a knockout edge where it
   crosses the loop, so the two read as separate at 16px. */
const ED_ICO_LASSO='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
  '<path d="M12.6 17.9C7.1 19.2 1.9 17.2 1.9 12.4c0-4.9 4.6-9.6 10.1-9.6 5.4 0 9.6 3.2 9.6 7.4" '+
    'style="fill:none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="0.1 4.1"/>'+
  '<path d="M12.2 9.3 22.6 17.1 17.9 17.4 20.5 22.3 18.1 23.5 15.6 18.6 12.3 21.9Z" '+
    'fill="currentColor" stroke="var(--ske-card, #fff)" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke"/>'+
  '</svg>';
/* v60 — Invert, from the artwork Ced sent: a rounded tile, a light panel on its right half, and a
   disc across the seam whose two halves are each the opposite of what they sit on. Even-odd fill does
   the knocking-out, so the glyph is one colour and inverts with its button like every other. */
const ED_ICO_INVERT='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
  '<path fill="currentColor" fill-rule="evenodd" d="M3 0H21A3 3 0 0 1 24 3V21A3 3 0 0 1 21 24H3A3 3 0 0 1 0 21V3A3 3 0 0 1 3 0Z'+
    'M12 2.67H21.33V21.33H12Z'+
    'M12 5.34A6.66 6.66 0 0 0 12 18.66Z"/>'+
  '<path fill="currentColor" d="M12 5.34A6.66 6.66 0 0 1 12 18.66Z"/>'+
  '</svg>';
const ED_ICO_LINE   =edStroke('<path d="M4.2 19.8 19.8 4.2"/>');
const ED_ICO_ARROW  =edStroke('<path d="M4.4 19.6 19.2 4.8"/><path d="M11.4 4.8h7.8v7.8"/>');
const ED_ICO_BOX    =edStroke('<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="1.8"/>');
const ED_ICO_ELLIPSE=edStroke('<ellipse cx="12" cy="12" rx="8.8" ry="7.2"/>');
const ED_ICO_SHAPE  =edStroke('<rect x="3.6" y="5.6" width="16.8" height="12.8" rx="2.2" '+
                              'stroke-dasharray="4.4 3.4"/>');

function skEditor(a,opts){
  if(!a||a.kind!=="img"||!a.src){ toast("Select a snapshot first"); return; }
  if(SK_ED)return;
  const wrap=document.createElement("div"); wrap.className="sk-edit";
  const card=document.createElement("div"); card.className="sk-edcard";
  const head=document.createElement("div"); head.className="sk-edhead";
  const ttl=document.createElement("div"); ttl.className="sk-edtitle";
  ttl.textContent=(opts&&opts.title)||"Edit picture";
  /* ==================================================================================================
     6ng — AND THE PARAGRAPH IS GONE. Ced, with a shot of it: "also remove the paragraphs here."

     It was two lines of prose explaining what Erase and Restore are, what the five drawing tools do
     and which modifier does what with the wheel — written when the tools were words on a top bar
     and there was nowhere else to say any of it. Every one of those tools now carries a drawn mark,
     its name on hover and its own sentence in the tooltip (6nd, 6ne), so the paragraph was saying a
     third time what the button already says twice, at the cost of 40px off the top of the picture.

     The two things it said that no tool says — that the wheel sizes the brush with Shift and zooms
     with Ctrl — are gestures rather than tools, so they move onto the controls they belong to: the
     brush slider's tooltip and the zoom buttons'. Nothing is lost, it is just filed where it is
     looked for.
     ================================================================================================== */
  /* ==================================================================================================
     6n5 — AND A LINE FOR WHAT THE EDITOR HAS JUST SAID.
     Ced: "auto has stopped working in edit photo."

     Auto has not stopped working — measured on four pictures, it removes the strays and fills behind
     the ink in 96-546ms, and refuses a block of text exactly as it is meant to. What stopped was the
     TELLING. Every message in here goes through `setStatus`, which writes to `#status` in the page
     chrome and to `#miniStatus` on the quick bar — and this editor is `position:fixed; inset:0` at
     z-index 4700, so it covers both. Press Auto on a picture it declines and the explanation of why,
     which is a paragraph long and the whole point of 6mg, is painted underneath the dialog.

     So the editor gets a line of its own, and `skEdWire` shadows `setStatus` with one that writes to
     both. Nothing else changes: every call site in here already says the right thing to the right
     person, it just had nowhere to put it.
     ================================================================================================== */
  /* 6no — AND THE EXPLANATION BLOCK GOES. Ced: "the explanation tab here is not needed", with a
     shot of Auto's three-line success paragraph across the top of the dialog.

     6n5 added it because every message in here was being painted underneath a dialog that covers
     the window, and Auto looked dead as a result. That is still true, so the channel stays — but a
     paragraph that sits there forever is not what it was for. It is a one-line notice now, over the
     picture rather than above it, and an ordinary message fades after a few seconds. An ERROR
     stays, because the one that matters — Auto declining, and why — is the one worth reading. */
  const say=document.createElement("div"); say.className="sk-edsay"; say.hidden=true;
  head.appendChild(ttl);
  /* 6ne — THE NAME, ON HOVER, AT ONCE. Ced: "make the hover to the icon have tool name to have
     ease of understanding to user." Every button already carries a `title`, but a native tooltip
     waits about a second and then shows the whole sentence — which is the right thing to read when
     you are wondering what a tool DOES and the wrong thing when you are hunting for the one called
     Lasso. The word appears beside the button immediately; the sentence still arrives after it, on
     the browser's own schedule, so nothing is lost.

     It is one floating chip rather than a `::after` on each button, because the rail scrolls
     (`overflow-y:auto`) and anything drawn outside a scrolling box is clipped by it. */
  const tip=document.createElement("div"); tip.className="sk-edtip"; tip.hidden=true;
  card.appendChild(tip); card.appendChild(say);   /* 6no — the notice floats over the stage */
  /* ==================================================================================================
     6n3 — THE TOOLS GO DOWN THE LEFT, AND THE SLIDERS GO TO THE FLOOR.
     Ced: "instead of a top bar, make the tool bar on the left of the photo ui for better space
     management. make the tools be separated by the same separator on the ribbon, but horizontally.
     put the free and border undo and redo on the lowest part of the tab in edit photo."

     The card is a landscape box — `100vw - 48px` by `100vh - 48px` — and a picture is usually taller
     than it is wide once it is fitted, so the room that was going spare was at the SIDES and the room
     being spent was at the top. Two rows of buttons across the top took about 96px of height off
     every picture in the editor; the same buttons down the left take 150px of width, which the stage
     was not using. Measured on the fixture at 1512x923: the stage goes from 1414x561 to 1256x657,
     so the fit of a tall capture improves by about a sixth.

     Four pieces now, and each one is named for where it is rather than for what it holds:
       `rail`  — every tool button, in a column, groups divided by the ribbon's dotted rule turned
                 horizontal (its `border-bottom` where the top bars used `border-right`);
       `ctx`   — the settings for the tool in the hand: the brush, the tolerance, the ink, the shape,
                 what the next wand click does. These are not tools and do not belong in the rail;
       `base`  — the lowest strip: the two long sliders, then Undo and Redo, as asked;
       `foot`  — Cancel and Save, which were already there.
     ================================================================================================== */
  /* ==================================================================================================
     6nn — TWO COLUMNS, AND EVERY TOOL GROUP ITS OWN TAB.
     Ced: "in edit photo, put all the tool tabs on the left and stack individual tools. the main tab,
     the brush, rotate, and border. while the undo redo and zoom are stacked on the right."

     6nh floated the tools and 6nk broke the bottom strip into separate panels; this is the same idea
     carried to its end. The left column stacks the tool tab, the brush, the turn and the border —
     each a tab of its own, in the order Ced listed them — and the right column stacks the history
     and the zoom. Nothing sits across the foot of the picture any more, so the stage is as tall as
     the card and only as narrow as the two columns make it.
     ================================================================================================== */
  const body=document.createElement("div"); body.className="sk-edbody";
  const colL=document.createElement("div"); colL.className="sk-edcol-l";
  const colR=document.createElement("div"); colR.className="sk-edcol-r";
  const bar=document.createElement("div"); bar.className="sk-edbar sk-edrail";
  const bar2=document.createElement("div"); bar2.className="sk-edbar sk-edctx";
  const bar3=document.createElement("div"); bar3.className="sk-edbar sk-edbase";
  /* 6ni — and the two strips go into a DOCK. Ced: "incorporate them inside the ui", with the tools
     already floating (6nh). They were two plates lying on the card below the stage; they are one
     panel now, of the same make as the tool rail, resting over the foot of the stage. The stage
     keeps its full height and the picture is held clear of the dock by the stage's own bottom
     padding, exactly as it is held clear of the rail by the left padding. */

  const stage=document.createElement("div"); stage.className="sk-edstage";
  const box=document.createElement("div"); box.className="sk-edwrap";
  const cv=document.createElement("canvas"); cv.className="sk-edcanvas";
  const ov=document.createElement("canvas"); ov.className="sk-edov";
  /* v62 — the layer the drawn lines and shapes live on until Save (see "LIVE SHAPES" below) */
  const ol=document.createElement("canvas"); ol.className="sk-edobj";
  /* 6gq — Ced: "make sure the brush is visible in the UI of the edit photos in snapshot so erasing is
     not confusing." A ring the size of the brush, following the pointer, so you can see what a sweep
     will take before you take it. */
  const ring=document.createElement("div"); ring.className="sk-edring"; ring.hidden=true;
  /* 6iq — THE TURN IS ON THE PICTURE, AND IT IS THE GRIP YOU ALREADY KNOW. Ced: "put rotate on the
     outline of the photo… like the ones on the actual ui of the tool." So it is the same control a
     selected mark carries — one round white ↻ on a blue rule, hanging just below the middle of the
     edge, dragged round the centre, with the angle in the status bar and Shift for 15° steps. One
     gesture to learn, whether you are turning a mark on the sheet or the picture inside the editor. */
  const grips=[(()=>{
    const gp=document.createElement("button");
    gp.type="button"; gp.className="sk-edrot"; gp.textContent="↻";
    gp.title="Drag to turn the picture — the angle is shown as you turn it. Shift snaps to 15°";
    box.appendChild(gp); return gp;
  })()];
  /* ================================================================================================
     6m0 — THE CHEQUER STAYS STILL WHILE THE PICTURE TURNS.
     Ced: "in edit picture, do when rotated, make the transparent background be still so the user have
     visual cues if the shape is straight."

     The chequer was the BOX's own background, and the free-turn preview rotates the box — so the
     squares turned with the picture and the one reference that could tell you whether an edge had come
     square was turning too. A chequer that moves with the thing you are straightening tells you
     nothing; a chequer that stays put is a ruled grid you can line an edge up against.

     It cannot simply be moved outside the box, because it has to be CLIPPED to the picture — a chequer
     spilling past the picture's edge would stop saying "these pixels are transparent", which is the
     other job it does. So it is a child: the clip rides the box and keeps the picture's own rectangle,
     and the pattern inside it is counter-rotated about the same centre and oversized well past the
     corners, which leaves the squares axis-aligned on screen inside a window the shape of the picture.
     ================================================================================================ */
  const bgclip=document.createElement("div"); bgclip.className="sk-edbgclip";
  const bgpat=document.createElement("div"); bgpat.className="sk-edbg";
  bgclip.appendChild(bgpat); box.appendChild(bgclip);
  /* 6mu — THE BRUSH RING IS NOT PART OF THE PICTURE. Ced: "bring the size preview of the edit photo
     tool always in front of ui", with a shot of the ring sliced in half at the top of the canvas.
     It lived inside `.sk-edwrap`, which sits in a stage that scrolls (`overflow:auto`), so the half
     of the ring that reached past the picture's edge was clipped away — exactly when it matters,
     because the edge is where you are being careful. It hangs off the editor's own full-window
     overlay now and is positioned in client coordinates, so it is never clipped by anything and is
     over every part of the editor. */
  box.appendChild(cv); box.appendChild(ol); box.appendChild(ov); stage.appendChild(box); card.appendChild(ring);
  const foot=document.createElement("div"); foot.className="sk-edfoot";
  colL.appendChild(bar); colL.appendChild(bar2); colL.appendChild(bar3);
  body.appendChild(colL); body.appendChild(stage); body.appendChild(colR);
  card.appendChild(head); card.appendChild(body); card.appendChild(foot);
  wrap.appendChild(card); document.body.appendChild(wrap);

  /* 6gs — the picture AS IT WAS FIRST MADE, kept on the mark so it is saved and reopened with it.
     Restore brushes that back, however many sessions ago the erasing happened. */
  /* 6jb — and it is the PICTURE that is opened, not the picture with its frame drawn into it */
  const _raw=(typeof maPicUnframed==="function")?maPicUnframed(a):a.src;
  if(!a.srcOrig)a.srcOrig=_raw;
  const im=new Image();
  im.onload=()=>{
    cv.width=ov.width=im.naturalWidth; cv.height=ov.height=im.naturalHeight;
    const g=cv.getContext("2d",{willReadFrequently:true});
    g.drawImage(im,0,0);
    const orig=document.createElement("canvas");
    orig.width=cv.width; orig.height=cv.height;
    const og=orig.getContext("2d");
    const base=new Image();
    base.onload=()=>{ try{ og.clearRect(0,0,orig.width,orig.height);
        og.drawImage(base,0,0,orig.width,orig.height); }catch(e){} };
    base.onerror=()=>{};
    og.drawImage(im,0,0);                 /* until the original has loaded, this is the best we have */
    base.src=a.srcOrig||_raw;
    skEdWire(a,cv,g,ov,orig,bar,bar2,stage,box,foot,wrap,ring,opts||{});
  };
  im.onerror=()=>{ wrap.remove(); SK_ED=null; setStatus("Could not open that picture.",true); };
  im.src=_raw;
  SK_ED=wrap;
}
function skEdWire(a,cv,g,ov,orig,bar,bar2,stage,box,foot,wrap,ring,opts){
  /* v62 — the live-shape layer skEditor put in the box (made there rather than passed, so the long
     argument list is unchanged for anything else that builds an editor) */
  const ol=box.querySelector(".sk-edobj")||(()=>{ const c=document.createElement("canvas");
    c.className="sk-edobj"; box.insertBefore(c,ov); return c; })();
  /* 6n0 — the sliders' row, found rather than passed: this is the far side of the same function
     boundary the chequer is found across in 6m0, and a fourteenth positional argument for one
     element is worse than a lookup. Not guarded — if the row is missing the sliders have nowhere to
     go, and a lookup that fails should be visible rather than quietly putting them back on the
     tool row. */
  const bar3=wrap.querySelector(".sk-edbase");
  /* 6ne — the name chip, found the same way everything else across this boundary is */
  const _tip=wrap.querySelector(".sk-edtip");
  const tipShow=b=>{
    if(!_tip||!b)return;
    const nm=(b.dataset&&b.dataset.name)||"";
    if(!nm)return;
    _tip.textContent=nm; _tip.hidden=false;
    const r=b.getBoundingClientRect(), cr=_tip.parentElement.getBoundingClientRect();
    /* 6nn — clear of the COLUMN, not of the button. The tools are a grid now, so a chip placed
       beside the button it names lands on top of the button next to it. */
    const col=b.closest(".sk-edcol-l")||b.closest(".sk-edcol-r");
    const edge=col?col.getBoundingClientRect().right:r.right;
    _tip.style.left=Math.round(edge-cr.left+10)+"px";
    _tip.style.top =Math.round(r.top+r.height/2-cr.top-_tip.offsetHeight/2)+"px";
  };
  const tipHide=()=>{ if(_tip)_tip.hidden=true; };
  /* ==================================================================================================
     6ni — A SLIDER SHOWS HOW FAR ALONG IT IS. Ced sent one: a pill track, the part behind the thumb
     filled in blue, a round white thumb, and the reading in a bubble riding above it.

     A native range cannot paint its own filled portion — `::-moz-range-progress` exists and the
     WebKit side has no equivalent — so the fill is a background gradient sized by a custom
     property, and the bubble is placed by a second one. Both are written on the ROW rather than on
     the input, because the bubble is a sibling of the track and has to read the same number.

     `--bx` is in PIXELS and not a percentage: the thumb's centre travels between half a thumb in
     from each end, so a bubble placed at a flat percentage of the width drifts off it by half a
     thumb at each extreme. Measured at the editor's own width that is 9px, which is most of the
     thumb. The colours are sampled from Ced's picture: #0077e4 to #0054b0 across the fill,
     #d5d5d5 for the track, a white thumb on a #a8a6a9 ring. */
  const THUMB=18;
  const edSyncRange=inp=>{
    const row=inp.closest(".sk-edsize"); if(!row)return;
    const mn=+inp.min||0, mx=(+inp.max||100), v=+inp.value;
    const f=(mx>mn)?Math.max(0,Math.min(1,(v-mn)/(mx-mn))):0;
    const w=inp.getBoundingClientRect().width||inp.offsetWidth||0;
    /* the bubble hangs off the ROW and the thumb travels inside the INPUT, which starts after the
       label — so the input's own offset has to be added or the reading floats over the word. */
    const ox=inp.offsetLeft||0;
    row.style.setProperty("--v",(f*100).toFixed(2)+"%");
    row.style.setProperty("--bx",(ox+THUMB/2+f*Math.max(0,w-THUMB)).toFixed(1)+"px");
  };
  const edSyncRanges=()=>{
    try{ wrap.querySelectorAll(".sk-edsize input[type=range]").forEach(edSyncRange); }catch(e){}
  };
  wrap.addEventListener("input",e=>{
    const t=e.target;
    if(t&&t.matches&&t.matches('.sk-edsize input[type=range]'))edSyncRange(t);
  },true);
  window.addEventListener("resize",edSyncRanges);
  /* the sliders are also moved from code — the wheel sizes the brush, a turn commits and the handle
     follows the picture — and those write `value` without firing `input`. One sweep after the editor
     has settled, and a sweep from each of those paths, keeps the paint honest. */
  requestAnimationFrame(()=>requestAnimationFrame(edSyncRanges));
  /* 6nl — the room the dock takes is MEASURED, not guessed. Its height changes with which setting
     the tool in hand shows — the brush row, the ink row with its swatch, the wand's three chips —
     so a constant in the stylesheet is either too big for one of them or too small for another,
     and too small means the picture slides under the panels. The stage's bottom padding follows
     the dock's own height, with the same 10px of air above it that the panels have below them. */
  /* ==================================================================================================
     6nn — THE PICTURE IS HELD CLEAR OF BOTH COLUMNS, BY MEASUREMENT.
     The stage runs the full width of the card and the columns float over it, so what keeps the
     picture out from under them is the stage's own padding. It is read off the columns rather than
     repeated as a constant: the left one is as wide as its widest tab and the right one as wide as
     its buttons, and both change with the theme's metrics. Written to the element's own style
     because `.sk-edstage{...padding:8px...}` is a shorthand later in the sheet and would reset any
     longhand rule here (6nl found that the hard way — a wide picture slid under the tools).
     ================================================================================================== */
  let _fitDock=null;
  {
    const fitCols=()=>{
      if(!stage)return;
      const sr=stage.getBoundingClientRect();
      if(!sr.width)return;
      const L=wrap.querySelector(".sk-edcol-l"), R=wrap.querySelector(".sk-edcol-r");
      if(L){ const r=L.getBoundingClientRect();
        if(r.width)stage.style.paddingLeft=Math.max(8,Math.round(r.right-sr.left+10))+"px"; }
      if(R){ const r=R.getBoundingClientRect();
        if(r.width)stage.style.paddingRight=Math.max(8,Math.round(sr.right-r.left+10))+"px"; }
      stage.style.paddingBottom="";        /* 6nn — nothing sits across the foot any more */
      try{ dropBox(); }catch(e){}
      if(!zoomUser){ try{ fitZoom(); }catch(e){} }
    };
    /* registered, not run: `fitZoom` is a `const` further down and calling this now would reach
       into its temporal dead zone. The first run is the explicit one just before the first fit. */
    _fitDock=fitCols;
    try{ if(window.ResizeObserver){ const ro=new ResizeObserver(fitCols);
      const L=wrap.querySelector(".sk-edcol-l"), R=wrap.querySelector(".sk-edcol-r");
      if(L)ro.observe(L); if(R)ro.observe(R); } }catch(e){}
    window.addEventListener("resize",fitCols);
  }
  bar.addEventListener("pointerover",e=>{ const b=e.target.closest&&e.target.closest(".sk-edb");
    if(b)tipShow(b); });
  bar.addEventListener("pointerout",e=>{ const b=e.target.closest&&e.target.closest(".sk-edb");
    const to=e.relatedTarget;
    if(b&&(!to||!to.closest||!to.closest(".sk-edb")))tipHide(); });
  bar.addEventListener("pointerdown",tipHide);
  bar.addEventListener("scroll",tipHide,{passive:true});
  /* 6n5 — the editor's own voice. This SHADOWS the global `setStatus` for the whole of `skEdWire`,
     so all forty-odd call sites below reach the line the user can actually see without one of them
     being touched; the page's strip is still written too, so the activity log keeps its copy. It is
     declared first because a shadowing `const` is in its temporal dead zone until it is. */
  const _edSay=wrap.querySelector(".sk-edsay");
  let _sayT=0;
  const setStatus=(t,isErr)=>{
    if(_edSay){
      _edSay.textContent=t||""; _edSay.classList.toggle("err",!!isErr); _edSay.hidden=!t;
      /* 6no — an ordinary message has been read by the time it has been there five seconds; an
         error is the one that has to still be there when the eye gets back to it. */
      clearTimeout(_sayT);
      if(t&&!isErr)_sayT=setTimeout(()=>{ try{ _edSay.hidden=true; }catch(e){} },5000);
    }
    try{ SK_PAGE_STATUS(t,isErr); }catch(e){}
  };
  opts=opts||{};
  let tool="erase", brush=18, tol=40, fillCol="#ffffff", done=false;
  /* 6nl — has the HAND set the zoom? Until it has, the picture stays fitted, so the dock reserving
     its room (or giving some back) re-fits rather than leaving the picture hanging past the bottom
     of a stage that just got shorter. The Fit button clears it, because pressing Fit is asking for
     exactly that behaviour back. Declared up here with the rest of the state because `fitDock`,
     written far above the zoom controls, reads it. */
  let zoomUser=false;
  /* =================================================================================================
     6kq — DRAWING INSIDE THE PICTURE. Ced: "add lines and shapes tool in edit picture with
     corresponding editing tools."

     Everything the editor could do until now took ink AWAY — rub it out, follow a line and lift it,
     wand a region and clear it — or put back what was already there. A capture of a drawing detail
     very often needs something ADDED to it: an arrow at the member you are talking about, a box round
     the bolt group, a line where the new steel goes. Doing that with a mark on the sheet puts it in
     the wrong place the moment the picture is moved or resized, because it is a separate mark; drawn
     in HERE it is part of the picture and travels with it.

     Five tools — Pen, Line, Arrow, Box, Ellipse — with the three settings that matter: the colour,
     the weight, and whether a box or an ellipse is filled. They are drawn in the picture's OWN pixels,
     so a stroke is the same weight whatever the zoom and whatever resolution the capture was taken at;
     the weight slider is in points of the mark as it sits on the sheet, which is the only unit that
     means anything to someone looking at the drawing. One `push()` per gesture, so Undo takes back a
     whole line rather than a frame of it, and the preview is on the overlay the crop box and the lasso
     already use, so nothing is committed until the hand comes up.
     ================================================================================================= */
  let drawCol="#fa3237";                 /* the ribbon's redline red, which is what this is for */
  let drawFill=false;                    /* a box or an ellipse: outline, or painted through */
  let drawPt=1.5;                        /* the weight, in POINTS of the mark as it sits on the sheet */
  let brushBox=false;                    /* 6n4 — the nib: round by default, square when asked for */
  let shapeSelEll=false;                 /* 6la — the shaped selection: a rectangle, or an ellipse */
  let autoMinLen=0;                      /* 6la — 0 means "take it from the picture's size" */
  /* 6gs — Ced: "add should also be the default magic wand setting." Selecting one space and then
     another is the common gesture on a drawing — a detail has several enclosed regions — so the wand
     starts in ADD, and New is one chip away when a fresh selection is what is wanted. */
  let wandMode="add";                    /* new · add · subtract, with Shift and Alt as shortcuts */
  let mask=null;                                  /* Uint8Array, one byte per pixel, or nothing */
  /* 6gk — UNDO AND REDO. Ced asked for both; there was one stack and no way forward again. Each entry
     is the pixels and the selection together, because a fill and the selection that shaped it are one
     action to the hand. */
  const undo=[], redo=[];
  /* 6gr — AND THE HISTORY IS CAPPED BY MEMORY. A step is a full copy of the picture: at the resolution
     a capture is taken at now that can be 20MB each, so twenty-four of them is half a gigabyte and the
     tab crawls. The cap is a budget — about 64MB of history — which is dozens of steps on a small
     picture and a handful on a huge one, which is the right trade in both. */
  const STEP_BYTES=Math.max(1,cv.width*cv.height*4);
  const HIST_MAX=Math.max(3,Math.min(24,Math.floor(64e6/STEP_BYTES)));
  /* 6gt — a step carries the SIZE it was taken at, and how far the picture had been turned, because a
     quarter turn is an editing step like any other and undoing one has to put the sides back. */
  let picRot=0;                                   /* quarter turns since the editor opened, 0..3 */
  /* 6gz/6ha — HOW BIG ONE PIXEL OF THE PICTURE IS ON THE SHEET, in points, each way. Everything that
     changes the picture's shape — a quarter turn, a free turn, a crop — leaves this alone or swaps the
     pair, and the mark's printed size on the way out is simply the pixel size times this. It replaces
     the parity test 6gz used, which only knew about quarter turns. */
  const _P0=(S.pages&&S.pages[a.page])||{};
  const _W0=_P0.w1||612, _H0=_P0.h1||792;
  const pw0=cv.width, ph0=cv.height;
  let pxW=(pw0?((a.nw||0)*_W0)/pw0:0), pxH=(ph0?((a.nh||0)*_H0)/ph0:0);
  /* 6kq — AND HOW MANY PICTURE PIXELS ONE POINT IS WORTH. `pxW` is the other way round: how many
     points one picture pixel measures on the sheet. A capture is taken at several times the screen's
     resolution, so the same printed weight is several times as many pixels here — doing it in points
     is what keeps a 1.5pt arrow a 1.5pt arrow whatever the capture's resolution, and what makes a
     line drawn in the picture read like the redlines around it. A picture with no place on a page yet
     — the markup library's own editor opens one — has no scale to convert through, so it falls back
     to the capture's short edge, which puts the default at about three pixels on a small one. */
  const ptPx=()=>(pxW>0.0001?(1/pxW):Math.max(1,Math.min(cv.width,cv.height)/420));
  const drawPx=()=>Math.max(1,drawPt*ptPx());
  let picChanged=false;                 /* the shape was altered at all — the original is re-saved */
  /* 6j0 — HISTORY AS A PICTURE, NOT AS PIXELS. Ced: "the responsiveness of this is too slow." A
     snapshot is taken at the START OF EVERY BRUSH STROKE, and it was `getImageData` over the whole
     canvas — on a capture taken at three times the screen's resolution that is tens of megabytes read
     back out of the GPU into JavaScript memory before the first dab lands, on every stroke, with a
     dozen of them kept. The snapshot is a canvas now: `drawImage` copies it without ever bringing the
     pixels across, and putting one back is another `drawImage`. Nothing else about the history changes,
     and `px` is still read where a step was saved by an older build. */
  const snapCv=src=>{ const c=document.createElement("canvas");
    c.width=src.width; c.height=src.height;
    c.getContext("2d").drawImage(src,0,0); return c; };
  const shot=()=>({cv:snapCv(cv),
                   w:cv.width,h:cv.height,rot:picRot,
                   mask:mask?Uint8Array.from(mask):null,
                   objs:objs.map(o=>Object.assign({},o))});     /* v62 — the live shapes too */
  /* 6gz — A CROP THROWS PIXELS AWAY, so a step that changes the picture's SHAPE carries the untouched
     original with it as well. Only those steps do: a brush stroke is a picture and nothing else, and
     doubling every step's memory to cover the two rare ones would halve how far back the history goes.
     `geoShot` is the heavy one; `shotFor` takes it only when the step being applied changes shape. */
  const origShot=()=>{ try{ return {cv:snapCv(orig),w:orig.width,h:orig.height}; }
                      catch(e){ return null; } };
  const geoShot=()=>{ const st=shot(); st.orig=origShot(); return st; };
  const shapeDiffers=st=>!!(st&&(st.orig||st.w!==cv.width||st.h!==cv.height||st.rot!==picRot));
  const shotFor=st=>(shapeDiffers(st)?geoShot():shot());
  const drawBack=(ctx,st,w,h)=>{
    ctx.clearRect(0,0,w,h);
    if(st.cv)ctx.drawImage(st.cv,0,0); else if(st.px)ctx.putImageData(st.px,0,0);
  };
  const put=st=>{
    /* 6m0 — AND SO DOES UNDO. A run of free turns resamples from the pixels the run began with, and
       putting a history state back replaces those pixels wholesale: carry the run across an Undo and
       the next turn resamples a picture that is no longer on screen, by an angle that includes turns
       the user has just taken back. Found while correcting the free-rotate case in `tools.py`, which
       undoes a 30 degree turn and then asks for 45. The two history pushes end the run for every
       operation that WRITES; this ends it for every one that RESTORES. */
    try{ endSpinRun(); }catch(e){}
    const w=st.w||(st.cv?st.cv.width:st.px.width), h=st.h||(st.cv?st.cv.height:st.px.height);
    const r=(typeof st.rot==="number")?st.rot:picRot;
    if(st.orig){
      /* the shape changed: the original is restored outright rather than turned back */
      orig.width=st.orig.w; orig.height=st.orig.h;
      try{ drawBack(orig.getContext("2d"),st.orig,st.orig.w,st.orig.h); }catch(e){}
      picRot=r;
    }
    else if(r!==picRot){ turnOrig(((r-picRot)%4+4)%4); picRot=r; }
    if(cv.width!==w||cv.height!==h){ cv.width=ov.width=w; cv.height=ov.height=h; applyZoom(); dropBox(); }
    drawBack(g,st,w,h); mask=st.mask?Uint8Array.from(st.mask):null;
    objs=Array.isArray(st.objs)?st.objs.map(o=>Object.assign({},o)):[]; objSel=-1; drawObjs();
    skMaskShow(ov,mask); say(); };
  /* 6m0 — ANY change to the pixels ends a run of free turns, because the base a run resamples from is
     the picture as it was before the run and would silently throw away whatever has been done since.
     Both history pushes are the gate — every brush, fill, crop, quarter turn, flip and Restore goes
     through one of them — and the free turn sets `_inFreeTurn` so its own push does not end the run it
     is part of. One flag and two lines, rather than a hook on each of eleven operations. */
  let _inFreeTurn=false;
  /* 6mh — the pixels the border slider works from, and the same gate keeps them honest: ANY other
     operation goes through `push`, and anything that changes the picture makes the slider's starting
     point stale. Its own push is the one exception, so a drag can go up and back down again. */
  let bordBase=null, bordOrig=null, bordHold=false, bordPushed=false;

  /* =================================================================================================
     v62 — LIVE SHAPES. Ced: "for added lines, shapes in edit photo, make them movable and dont flatten
     them yet unless saved."
     A line, arrow, box or ellipse is kept as an object — two points, a colour, a weight — on its own
     layer over the picture, and drawn into the pixels only when the picture is saved (or when a turn,
     flip, crop or Restore all changes what a pixel position means; that step keeps them live, so Undo
     brings them back movable). Each history step carries them, so Undo and Redo move them too.
     ================================================================================================= */
  let objs=[], objSel=-1;
  function paintObj(ctx,o){
        const tool=o.tool, w=o.w, x0=o.x0, y0=o.y0, X1=o.x1, Y1=o.y1, drawCol=o.col, drawFill=!!o.fill;
        ctx.save();
        ctx.strokeStyle=drawCol; ctx.fillStyle=drawCol;
        /* 6lf — SHARP CORNERS. Ced: "make the shapes all have sharp corners."
           `lineJoin:"round"` put a radius on all four corners of a box — at 12pt on a 1200px capture
           that is a 24px fillet, which reads as a rounded rectangle and not as the box that was
           drawn — and `lineCap:"round"` hung half a stroke width past each end of a line, so a line
           dragged to a corner overshot it. A box, a line and an arrow are drawing instruments and a
           drawing instrument has corners. `miter` for the join, `butt` for the cap, and a miter limit
           high enough that a shallow corner stays a point instead of being cut square by the default
           limit of 10.
           The PEN keeps its round cap and join and is not drawn here: a freehand stroke is dabs joined
           end to end, and butt caps would leave a notch at every one of them. */
        ctx.lineWidth=w; ctx.lineCap="butt"; ctx.lineJoin="miter"; ctx.miterLimit=24;
        if(tool==="line"||tool==="arrow"){
          const dx=X1-x0, dy=Y1-y0, L=Math.hypot(dx,dy)||1, ux=dx/L, uy=dy/L;
          if(tool==="arrow"){
            /* the shaft stops short of the head, so the point is a point and not a blob */
            const hl=Math.max(w*3.4,w+2), hw=hl*0.52;
            ctx.beginPath(); ctx.moveTo(x0,y0);
            ctx.lineTo(X1-ux*hl*0.8,Y1-uy*hl*0.8); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(X1,Y1);
            ctx.lineTo(X1-ux*hl-uy*hw, Y1-uy*hl+ux*hw);
            ctx.lineTo(X1-ux*hl+uy*hw, Y1-uy*hl-ux*hw);
            ctx.closePath(); ctx.fill();
          }else{
            ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(X1,Y1); ctx.stroke();
          }
        }else{
          const X=Math.min(x0,X1), Y=Math.min(y0,Y1);
          const W=Math.abs(X1-x0), H=Math.abs(Y1-y0);
          ctx.beginPath();
          if(tool==="ellipse")ctx.ellipse(X+W/2,Y+H/2,Math.max(0.5,W/2),Math.max(0.5,H/2),0,0,Math.PI*2);
          else ctx.rect(X,Y,W,H);
          if(drawFill)ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

  function drawObjs(){
    if(ol.width!==cv.width||ol.height!==cv.height){ ol.width=cv.width; ol.height=cv.height; }
    ol.style.width=cv.style.width; ol.style.height=cv.style.height;
    const c=ol.getContext("2d"); c.clearRect(0,0,ol.width,ol.height);
    objs.forEach(o=>paintObj(c,o));
    const o=objs[objSel]; if(!o)return;
    const z=Math.max(0.05,zoom), hs=5/z, pad=Math.max(o.w/2,0)+4/z;
    c.save(); c.lineWidth=1.25/z; c.strokeStyle="#2f7be0"; c.setLineDash([4/z,3/z]);
    if(o.tool==="line"||o.tool==="arrow"){
      c.beginPath(); c.moveTo(o.x0,o.y0); c.lineTo(o.x1,o.y1); c.stroke();
    }else{
      const X=Math.min(o.x0,o.x1)-pad, Y=Math.min(o.y0,o.y1)-pad;
      c.strokeRect(X,Y,Math.abs(o.x1-o.x0)+2*pad,Math.abs(o.y1-o.y0)+2*pad);
    }
    c.setLineDash([]); c.fillStyle="#fff";
    objHandles(o).forEach(([hx,hy])=>{ c.beginPath(); c.rect(hx-hs,hy-hs,2*hs,2*hs); c.fill(); c.stroke(); });
    c.restore();
  }
  /* the ends of a line; the four corners of a box or an ellipse's frame (0 and 1 are its two
     defining corners, 2 and 3 the other two) */
  function objHandles(o){
    if(o.tool==="line"||o.tool==="arrow")return [[o.x0,o.y0],[o.x1,o.y1]];
    return [[o.x0,o.y0],[o.x1,o.y1],[o.x1,o.y0],[o.x0,o.y1]];
  }
  function objHit(x,y){
    const z=Math.max(0.05,zoom), tol=7/z;
    for(let i=objs.length-1;i>=0;i--){
      const o=objs[i];
      if(i===objSel){ const H=objHandles(o);
        for(let h=0;h<H.length;h++)if(Math.hypot(x-H[h][0],y-H[h][1])<=tol+2/z)return {i,h}; }
      const near=Math.max(o.w/2,0)+tol;
      if(o.tool==="line"||o.tool==="arrow"){
        const dx=o.x1-o.x0, dy=o.y1-o.y0, L2=dx*dx+dy*dy||1;
        const t=Math.max(0,Math.min(1,((x-o.x0)*dx+(y-o.y0)*dy)/L2));
        if(Math.hypot(x-(o.x0+t*dx),y-(o.y0+t*dy))<=near)return {i,h:-1};
        continue;
      }
      const X0=Math.min(o.x0,o.x1), X1=Math.max(o.x0,o.x1), Y0=Math.min(o.y0,o.y1), Y1=Math.max(o.y0,o.y1);
      if(o.tool==="ellipse"){
        const rx=Math.max(0.5,(X1-X0)/2), ry=Math.max(0.5,(Y1-Y0)/2), cx=X0+rx, cy=Y0+ry;
        const d=Math.hypot((x-cx)/rx,(y-cy)/ry), rr=Math.min(rx,ry);
        if((o.fill&&d<=1)||Math.abs(d-1)*rr<=near)return {i,h:-1};
        continue;
      }
      const inside=x>=X0-near&&x<=X1+near&&y>=Y0-near&&y<=Y1+near;
      const edge=inside&&(Math.abs(x-X0)<=near||Math.abs(x-X1)<=near||Math.abs(y-Y0)<=near||Math.abs(y-Y1)<=near);
      if(edge||(o.fill&&inside))return {i,h:-1};
    }
    return null;
  }
  /* the picture takes them: on Save, or before an operation that changes what a pixel position means */
  function flattenObjs(){
    if(!objs.length)return;
    objs.forEach(o=>paintObj(g,o));
    objs=[]; objSel=-1; drawObjs(); picChanged=true;
  }
  /* a selected shape shows its own ink in the row, and a change in the row restyles it */
  let _inkSync=false;
  function inkFromObj(o){
    if(!o)return; _inkSync=true;
    try{ drawCol=o.col; dcol.value=o.col; drawPt=o.pt||drawPt; drng.value=String(drawPt); dsay();
         drawFill=!!o.fill; if(bInkFill)bInkFill.classList.toggle("on",drawFill);
         try{ edSyncRange(drng); }catch(e){} }
    finally{ _inkSync=false; }
  }
  function restyleSel(){
    const o=objs[objSel]; if(!o||_inkSync)return;
    const w=drawPx();
    if(o.col===drawCol&&o.w===w&&!!o.fill===!!drawFill)return;
    push(); o.col=drawCol; o.w=w; o.pt=drawPt; o.fill=drawFill; drawObjs();
  }
  const push=()=>{ try{ if(!_inFreeTurn)endSpinRun();
                        if(!bordHold){ bordBase=null; bordOrig=null; bordPushed=false; }
                        undo.push(shot()); while(undo.length>HIST_MAX)undo.shift();
                         redo.length=0; syncHist(); }catch(e){} };
  const pushGeo=()=>{ try{ if(!_inFreeTurn)endSpinRun();
                           undo.push(geoShot()); while(undo.length>HIST_MAX)undo.shift();
                           redo.length=0; syncHist(); }catch(e){}
                       /* v62 — a turn, flip, crop or Restore all changes what a pixel position
                          means, so the live shapes are drawn in first; the step just taken holds
                          them live, so Undo brings them back movable */
                       flattenObjs(); };
  /* the ORIGINAL is turned with the picture, so Restore still brushes back the right pixels in the
     right places however many times the picture has been turned. Turned in place, because the restore
     brush closes over this very canvas. */
  function turnOrig(steps){
    steps=((steps%4)+4)%4; if(!steps||!orig)return;
    for(let i=0;i<steps;i++){
      const r=skRotCanvas(orig,1);
      orig.width=r.width; orig.height=r.height;
      const c=orig.getContext("2d");
      c.clearRect(0,0,orig.width,orig.height);
      c.drawImage(r,0,0);
      r.width=r.height=0;
    }
  }
  /* ================================================================================================
     6m2 — AND EVERY BUTTON CARRIES A KEY THAT IS NOT ITS WORDS.
     Shortening five labels to fit two rows broke four cases in `tools.py`, every one of which pressed
     a button by matching a regex against its visible text. That is the same trap v45 found on the
     selection bar and fixed there by matching on `title` instead: a LABEL is a design decision and is
     allowed to change; a handle is a contract and is not. `title` is only half a handle, though — it
     is prose, and prose is edited too.
     So each button gets `data-k`, a short key that names what the button DOES. It is written here,
     once, from the key the call site passes, and the tests press `[data-k="wand"]`. A label may be
     reworded, translated or shortened from now on without touching a test.
     ================================================================================================ */
  const mkb=(where,label,glyph,fn,on,title,key)=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sk-edb"+(on?" on":"");
    if(title)b.title=title;
    b.dataset.k=key||String(label||glyph||"").toLowerCase()
                      .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"b";
    /* 6lf — a glyph may be DRAWN rather than typed. Ced sent a picture of the bucket he wanted for
       Fill, and an emoji is not a thing you can match to a picture: it is whatever face the machine
       happens to have, in whatever colour that face was designed in, and on this bar it came out as a
       cartoon in someone else's palette beside six monochrome marks. An inline SVG takes the button's
       own `currentColor`, so it goes white on the dark chip and white-on-blue when the tool is on,
       exactly like the glyphs either side of it. Anything that is not markup is still text. */
    const gl=document.createElement("span"); gl.className="sk-edg";
    if(/^\s*<svg\b/i.test(String(glyph||"")))gl.innerHTML=glyph; else gl.textContent=glyph;
    const tx=document.createElement("span"); tx.className="sk-edt"; tx.textContent=label;
    b.appendChild(gl); b.appendChild(tx);
    if(label)b.dataset.name=label;      /* 6ne — what the hover chip says */
    b.onclick=fn; where.appendChild(b); return b;
  };
  /* 6n3 — a group may say how it packs: the rail stacks its buttons in a column, but the five zoom
     controls are small and square and read better as a little block of them, so that one group asks
     for `sk-edwrapgrp` and wraps. */
  const group=(where,extra)=>{ const d=document.createElement("div");
                       d.className="sk-edgrp"+(extra?(" "+extra):"");
                       where.appendChild(d); return d; };

  /* ---- the rail, top to bottom: the brushes, the pens, the selection, the fill ---- */
  const gTools=group(bar), gDraw=group(bar), gSel=group(bar), gFill=group(bar);
  let bErase,bRestore,bWipe,bWand,bLasso,bCrop,bCropApply,bInv,bClr,bFill,bErase2,bUndo,bRedo,
      countTag,zoomTag;
  let bShapeSel=null, shapeRow=null;     /* 6la */
  const drawBtns={};                     /* 6kq — pen · line · arrow · box · ellipse */
  const say=()=>{
    const n=mask?skMaskCount(mask):0;
    if(countTag)countTag.textContent=n?(n.toLocaleString()+" px selected"):"nothing selected";
    if(bFill)bFill.disabled=!n;
    if(bErase2)bErase2.disabled=!n;
    if(bClr)bClr.disabled=!mask;
  };
  const syncHist=()=>{ if(bUndo)bUndo.disabled=!undo.length; if(bRedo)bRedo.disabled=!redo.length; };
  const DRAW_TOOLS=["pen","line","arrow","rect","ellipse","bucket"];   /* 6kq, 6la */
  const isDrawTool=t=>DRAW_TOOLS.indexOf(t)>=0;
  const setTool=t=>{ tool=t;
    if(objSel>=0&&!(t==="line"||t==="arrow"||t==="rect"||t==="ellipse")){ objSel=-1; try{ drawObjs(); }catch(e){} }
    try{ dropBox(); }catch(e){}          /* 6ha — the rows below change height; the picture moves */
    /* 6lf — THE PEN HAS A SIZE, SO THE PEN HAS A RING.
       Ced: "in pen, also preview the size of the pen in cursor and apply the shift rule where it
       becomes big or small." The ring has been the eraser's cursor since 6gr and Shift-wheel has sized
       the eraser since 6ip, and the pen — the one other tool whose whole gesture is "how wide is this"
       — had neither: you picked a weight off a slider in points and found out how wide that was by
       drawing with it. Both are the same two rules applied to the same kind of tool, so the pen is
       added to both rather than given a pair of its own. `brushy` is now "this tool paints with a
       width", which is what it always meant. */
    const brushy=(t==="erase"||t==="restore"||t==="pen");
    bErase.classList.toggle("on",t==="erase");
    bRestore.classList.toggle("on",t==="restore");
    bWipe.classList.toggle("on",t==="wipe");
    bWand.classList.toggle("on",t==="wand");
    bLasso.classList.toggle("on",t==="lasso");
    if(bCrop)bCrop.classList.toggle("on",t==="crop");
    /* 6m1 — the crop box belongs to the crop tool: picking up anything else puts it away without
       cutting, and picking Crop up puts it back on the picture's edges. */
    if(t==="crop"){ if(!cropBox)cropOpen(); } else cropClose();
    if(bCropApply)bCropApply.style.display=(t==="crop")?"":"none";
    /* 6kq — the five drawing tools light the same way, and their settings come up with them */
    DRAW_TOOLS.forEach(k=>{ if(drawBtns[k])drawBtns[k].classList.toggle("on",t===k); });
    if(bShapeSel)bShapeSel.classList.toggle("on",t==="shapesel");
    /* the bucket takes its colour from the ink row and its reach from the tolerance row, so it
       shows both and the shape of neither is new to learn */
    if(inkRow)inkRow.style.display=isDrawTool(t)?"":"none";
    if(shapeRow)shapeRow.style.display=(t==="shapesel")?"":"none";
    /* only a closed shape can be filled, so the chip that says so is only there for those two */
    if(bInkFill)bInkFill.style.display=(t==="rect"||t==="ellipse")?"":"none";
    /* 6lf — but the ERASER'S slider is still the eraser's. The pen's weight is in points, on the Ink
       row, because it has to mean the same thing as every other weight on the sheet; the brush's is
       in picture pixels. Two different measures, so two different sliders, and only the one belonging
       to the tool in hand is shown. */
    brushRow.style.display=(t==="erase"||t==="restore")?"":"none";
    tolRow.style.display=(t==="wand"||t==="wipe"||t==="bucket")?"":"none";   /* and the bucket */
    /* 6gt — New / Add / Subtract belong to the SELECTION, not to the wand: the lasso builds the same
       mask through the same three chips. */
    modeRow.style.display=(t==="wand"||t==="lasso"||t==="shapesel")?"":"none";
    /* the ring IS the cursor for a brush, so the arrow gets out of its way */
    /* 6gr — Ced: "do not hide the cursor in the ui." The ring says how big the brush is; the pointer
       says exactly where its centre is, and taking the pointer away made a careful rub-out guesswork. */
    cv.style.cursor="crosshair";
    if(ring){ ring.hidden=!brushy; ring.classList.toggle("restore",t==="restore");
              ring.classList.toggle("pen",t==="pen");
              /* 6lf — and it carries the ink it is about to draw with */
              try{ ring.style.setProperty("--sk-ink",drawCol); }catch(e){} }
    sizeRing(); };
  bErase  =mkb(gTools,"Erase",edIco("erase"),()=>setTool("erase"),true,
               "Rub the picture out — hold and sweep","erase");
  /* 6gk — Ced: "the erase should have a restore counterpart." It paints back the picture as it came
     in, from a copy kept aside when the editor opened, so an over-eager sweep is mended by brushing
     over it rather than undone wholesale. */
  bRestore=mkb(gTools,"Restore",edIco("restore"),()=>setTool("restore"),false,
               "Brush the original picture back where you erased it","restore");
  /* 6gs — Ced: "add a feature in edit photo where it recognizes the ends of lines in erase function so
     the erasing is easier." A brush has to be traced along a line and stops wherever the hand stops;
     what you actually mean is "this line, all of it". Click one and the connected run of ink is taken,
     end to end — the ends are where the ink stops, which is exactly what the flood finds. */
  bWipe   =mkb(gTools,"Erase line",edIco("wipe"),()=>setTool("wipe"),false,
               "Click a line and the whole run goes, end to end — Shift selects it instead","wipe");
  /* 6j3 — RESTORE ALL. Ced: "add restore button on edit photo." Restore beside it is a BRUSH — you
     paint the original back where you rubbed too far — and there was no way to say "put all of it
     back" short of undoing one step at a time. This is that button: the picture as it came in, in one
     press, and it is one undo step like anything else. */
  mkb(gTools,"Restore all",edIco("restoreall"),()=>{
    if(!orig){ setStatus("Nothing to restore from.",true); return; }
    pushGeo();
    if(cv.width!==orig.width||cv.height!==orig.height){
      cv.width=ov.width=orig.width; cv.height=ov.height=orig.height;
      applyZoom(); dropBox();
    }
    g.clearRect(0,0,cv.width,cv.height);
    g.drawImage(orig,0,0);
    mask=null; skMaskShow(ov,null); say();
    setStatus("The picture is back as it came in.");
  },false,"Put the whole picture back as it came in — one step, and undoable","restoreall");
  /* 6kq — THE FIVE THINGS YOU CAN ADD. The glyphs match the ribbon's own tools so the hand already
     knows them, and each one is the gesture it looks like: pen is freehand, the other four are drawn
     from one corner to the other. Shift constrains — a line to the nearest 45°, a box to a square, an
     ellipse to a circle. */
  drawBtns.pen    =mkb(gDraw,"Pen",edIco("pen"),()=>setTool("pen"),false,
                       "Draw freehand into the picture","pen");
  drawBtns.line   =mkb(gDraw,"Line",ED_ICO_LINE,()=>setTool("line"),false,
                       "Drag a straight line — Shift holds it to 45°","line");
  drawBtns.arrow  =mkb(gDraw,"Arrow",ED_ICO_ARROW,()=>setTool("arrow"),false,
                       "Drag an arrow — the head lands where you let go","arrow");
  drawBtns.rect   =mkb(gDraw,"Box",ED_ICO_BOX,()=>setTool("rect"),false,
                       "Drag a box — Shift makes it square","rect");
  drawBtns.ellipse=mkb(gDraw,"Ellipse",ED_ICO_ELLIPSE,()=>setTool("ellipse"),false,
                       "Drag an ellipse — Shift makes it a circle","ellipse");
  /* 6la — THE BUCKET. Ced: "add fill option (like bucket)". `Fill selection` paints what the wand
     has already chosen, behind the ink, which is the job for putting a ground under a capture. A
     bucket is the other job: click a space and that space takes the colour, on top, with no
     selection step in between. Same flood as the wand, same tolerance slider, different composite. */
  /* 6lf — Ced: "in edit photo tab, make the fill icon like this", with a picture of a black bucket:
     tall arching handle with a grip at its top, a rim bar across, a tapered body and a bar under the
     base. Traced in the picture's own proportions (it was 358x404, which is the viewBox) so the shape
     is his and not an approximation of it, and drawn in `currentColor` so it is the same ink as every
     other glyph on the bar. */
  /* 6nd — the old traced bucket is gone: Ced sent a new one, and it is in ED_ICO_PATHS
     with the rest of the set rather than alone here. */
  drawBtns.bucket=mkb(gDraw,"Fill",edIco("bucket"),()=>setTool("bucket"),false,
                      "Click a space and it takes the ink colour — Shift to pick the space first","bucket");
  /* =================================================================================================
     6la — AUTO. Ced: "have a automatic mode that will read the photo and will do what it should do.
     basically it will capture the shape and then erase the lines, and the make the fill ... this is
     not ai assisted tool, it should be aware without ai."
     It is not. It is a crowd detector and three set operations; `skAutoSolid` carries the reasoning
     and the measurements. One press, one undo step, and it says what it took away.
     ================================================================================================= */
  /* 6mg — AND THE PRESS IS ANSWERED BEFORE THE WORK STARTS. Even at a fifth of a second this is the
     one button that goes away and thinks, and at eleven and a half seconds — see `skAutoSolid` — it
     was indistinguishable from a button that does nothing. The bar says what it is doing and the
     window is given a frame to paint that before the thread is taken. */
  let autoBusy=false;
  mkb(gTools,"Auto",ED_ICO_AUTO,async()=>{
    if(autoBusy)return;
    autoBusy=true;
    setStatus("Auto: reading the picture…");
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
    let res=null;
    try{ res=skAutoSolid(g,cv,autoMinLen); } finally { autoBusy=false; }
    if(!res){ setStatus("Nothing to work on — the picture is empty.",true); return; }
    /* 6mg — it looked and did not find one. The picture is left exactly as it was: there is nothing
       to undo and nothing to discover afterwards. */
    if(res.noSubject){
      setStatus("Auto found no subject in this picture — only "+res.keptPct+"% of the ink hangs "+
                "together as one closed shape, so taking the rest would have taken the picture. "+
                "Nothing was changed. Auto is for a drawing with a shape in it; for a region of "+
                "text or a loose sketch, use Erase line or the Wand.",true);
      return;
    }
    push();
    if(res.nStray)skMaskErase(g,cv,res.stray);
    skMaskFill(g,cv,res.solid,fillCol);
    mask=null; skMaskShow(ov,mask); say();
    picChanged=true;
    /* What it did, and — because this is the part that matters — what it could not. A line that
       enters the shape on one side and leaves on the other has both ends on the contour, which
       makes it part of a closed loop, which makes it indistinguishable from a real member by the
       only test there is. Saying so beats letting Ced wonder whether the tool missed it. */
    setStatus("Auto: "+res.nStray.toLocaleString()+" pixels of outside line removed and "+
              res.nFill.toLocaleString()+" filled behind the drawing — the shape was found by its "+
              res.nClosed.toLocaleString()+" closed lines against "+res.nEnds.toLocaleString()+
              " with a free end. A line that crosses right through the shape is left: it closes on "+
              "the outline at both ends, so take it with Erase line. Undo puts all of this back.");
  },false,"Find the subject, take the stray lines off it, and fill it behind the ink — one press","auto");
  bWand   =mkb(gSel,"Wand",edIco("wand"),()=>setTool("wand"),false,
               "Click a space to select it — Shift adds another","wand");
  /* 6gt — Ced: "add a lasso effect on edit photo." For everything the wand cannot reach: draw round
     it by hand and what you drew round is selected, through the same three chips. */
  bLasso  =mkb(gSel,"Lasso",ED_ICO_LASSO,()=>setTool("lasso"),false,
               "Draw round a region by hand — Shift adds it, Alt takes it out","lasso");
  /* 6la — SHAPED SELECT. Ced: "shaped select - within magic wand type tool". The lasso is for a
     region with no shape to it; most of what wants selecting on a drawing is a rectangle, and
     drawing one by hand round it is both slower and worse. It answers to the same three chips. */
  bShapeSel=mkb(gSel,"Shape",ED_ICO_SHAPE,()=>setTool("shapesel"),false,
               "Drag a rectangle or an ellipse over what you want — Shift adds, Alt takes out","shapesel");
  bInv    =mkb(gSel,"Invert",ED_ICO_INVERT,()=>{
    push();
    mask=skMaskInvert(mask,cv.width*cv.height);
    skMaskShow(ov,mask); say();
    setStatus("Selection inverted.");
  },false,"Swap the selection for everything else","invert");
  bClr    =mkb(gSel,"Deselect",edIco("deselect"),()=>{ push(); mask=null; skMaskShow(ov,null); say(); },false,
               "Drop the selection","deselect");
  bFill   =mkb(gFill,"Fill sel.",edIco("fillsel"),()=>{
    if(!mask||!skMaskCount(mask)){ setStatus("Pick a region with the wand first.",true); return; }
    push();
    skMaskFill(g,cv,mask,fillCol);
    setStatus("Filled — under the redlines, so the drawing still reads on top of it.");
  },false,"Paint the selection, underneath everything already drawn","fillsel");
  /* 6gq — Ced: "add an erase selected feature in edit photos to erase the selected area by magic wand
     tool." The fill's opposite: everything selected is taken out, ink and ground alike. Wand the thing
     you do not want — or wand what you DO want and invert — and it is gone in one press. */
  bErase2=mkb(gFill,"Clear sel.",edIco("clearsel"),()=>{
    if(!mask||!skMaskCount(mask)){ setStatus("Pick a region with the wand first.",true); return; }
    push();
    skMaskErase(g,cv,mask);
    setStatus("Erased everything in the selection.");
  },false,"Rub out everything the wand has selected","clearsel");
  const col=document.createElement("input");
  col.type="color"; col.value=fillCol; col.className="sk-edcol";
  col.title="What the fill paints — white by default, so a captured drawing reads over the sheet";
  col.oninput=()=>{ fillCol=col.value; };
  gFill.appendChild(col);

  /* ---- 6n3 — the settings go to the context strip, the view to the rail, the history to the floor */
  /* 6nn — the right column is found, not closed over: it is built in `skEditor` and this is
     `skEdWire`, the far side of the same boundary the chequer and the dock are found across. */
  const colR=wrap.querySelector(".sk-edcol-r");
  /* v62 — ONE COLUMN. Ced: "i think 6 max is better. and also, fit the other tools from right to the
     left as well." The tool grid is six across, which makes the left column wide enough to carry
     the history and the zoom as two short rows at its head — so the right column goes, and the
     picture gets that side of the stage back. */
  const colL=wrap.querySelector(".sk-edcol-l");
  const gSet=group(bar2), gHist=group(colL,"sk-edhist sk-edpanel"), gView=group(colL,"sk-edview sk-edpanel");
  try{ colL.insertBefore(gView,colL.firstChild); colL.insertBefore(gHist,colL.firstChild);
       if(colR)colR.style.display="none"; }catch(e){}
  const brushRow=document.createElement("label"); brushRow.className="sk-edsize";
  brushRow.appendChild(document.createTextNode("Brush"));
  const rng=document.createElement("input");
  rng.type="range"; rng.min="2"; rng.max="120"; rng.step="1"; rng.value=String(brush);
  /* 6ng — the gesture the removed paragraph used to carry */
  rng.title="How wide Erase, Restore and the Pen paint, in picture pixels \u2014 "+
            "or hold Shift and scroll over the picture";
  const num=document.createElement("span"); num.className="sk-ednum"; num.textContent=brush+"px";
  rng.oninput=()=>{ brush=+rng.value; num.textContent=brush+"px"; sizeRing(); };
  brushRow.appendChild(rng); brushRow.appendChild(num);
  /* 6n4 — the nib, beside the size, because it is the other half of the same answer to "how wide and
     what shape is this". Two chips rather than one toggle, so which nib is in hand is readable
     without hovering — the same pattern the Shape row beside it already uses. */
  /* 6n4 — its OWN class, not `sk-edmodes`. Reusing the wand-mode row's class put two more
     chips inside every `.sk-edmodes .sk-edm` lookup, and two cases in `tools.py` read the
     wand's chips exactly that way — the nib is a different question and gets a different
     class, dressed the same. */
  const nibRow=document.createElement("span"); nibRow.className="sk-ednib";
  [["Round","●",false],["Box","■",true]].forEach(([lbl,gl,sq])=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sk-edm"+((sq===brushBox)?" on":"");
    b.textContent=gl+" "+lbl;
    b.title=sq?("A SQUARE nib — it clears right up to a straight edge and into a corner, "+
                "which a round one cannot")
              :"A round nib — the default";
    b.onclick=()=>{ brushBox=sq;
      [...nibRow.querySelectorAll(".sk-edm")].forEach(z=>
        z.classList.toggle("on", /box/i.test(z.textContent)===brushBox));
      sizeRing(); };
    nibRow.appendChild(b);
  });
  brushRow.appendChild(nibRow);
  brushRow.classList.add("sk-edpanel");   /* 6nl */
  gSet.appendChild(brushRow);
  const tolRow=document.createElement("label"); tolRow.className="sk-edsize";
  tolRow.appendChild(document.createTextNode("Tolerance"));
  const trng=document.createElement("input");
  trng.type="range"; trng.min="0"; trng.max="160"; trng.step="1"; trng.value=String(tol);
  const tnum=document.createElement("span"); tnum.className="sk-ednum"; tnum.textContent=String(tol);
  trng.oninput=()=>{ tol=+trng.value; tnum.textContent=String(tol); };
  tolRow.appendChild(trng); tolRow.appendChild(tnum);
  tolRow.classList.add("sk-edpanel");     /* 6nl */
  gSet.appendChild(tolRow);
  /* =================================================================================================
     6kq — WHAT THE DRAWING TOOLS DRAW WITH. It sits beside the brush size and the tolerance because
     it is the same kind of thing: a setting for the tool in the hand, shown only while that tool is
     in it. The weight is in POINTS, not pixels — see `ptPx` — so the slider says the same thing the
     ribbon's own weight chips say, and a line drawn in a 3x capture comes out matching a line drawn
     on the sheet beside it.
     ================================================================================================= */
  let inkRow=null, bInkFill=null;
  inkRow=document.createElement("label"); inkRow.className="sk-edsize";
  inkRow.appendChild(document.createTextNode("Ink"));
  const dcol=document.createElement("input");
  dcol.type="color"; dcol.value=drawCol; dcol.className="sk-edcol";
  dcol.title="What the pen, the line, the arrow and the shapes draw in";
  /* 6lf — the pen's ring is painted in this colour, so it follows the swatch as it is dragged */
  dcol.oninput=()=>{ drawCol=dcol.value;
    try{ if(ring)ring.style.setProperty("--sk-ink",drawCol); }catch(e){} };
  dcol.onchange=()=>{ try{ restyleSel(); }catch(e){} };
  inkRow.appendChild(dcol);
  const drng=document.createElement("input");
  drng.type="range"; drng.min="0.25"; drng.max="12"; drng.step="0.25"; drng.value=String(drawPt);
  const dnum=document.createElement("span"); dnum.className="sk-ednum";
  const dsay=()=>{ dnum.textContent=drawPt.toFixed(2).replace(/\.?0+$/,"")+" pt"; };
  /* 6lf — and the ring is the weight, so it moves with the slider as well as with the wheel */
  drng.oninput=()=>{ drawPt=+drng.value; dsay(); try{ sizeRing(); }catch(e){} };
  drng.onchange=()=>{ try{ restyleSel(); }catch(e){} };
  dsay();
  inkRow.appendChild(drng); inkRow.appendChild(dnum);
  bInkFill=document.createElement("button");
  bInkFill.type="button"; bInkFill.className="sk-edm";
  bInkFill.textContent="■ Filled";
  bInkFill.title="Paint the inside of a box or an ellipse as well as its edge";
  bInkFill.onclick=()=>{ drawFill=!drawFill; bInkFill.classList.toggle("on",drawFill); try{ restyleSel(); }catch(e){} };
  inkRow.appendChild(bInkFill);
  inkRow.classList.add("sk-edpanel");     /* 6nl */
  gSet.appendChild(inkRow);
  /* 6la — what Shape select draws with, and how wide a crowd Auto looks for */
  shapeRow=document.createElement("label"); shapeRow.className="sk-edsize";
  shapeRow.appendChild(document.createTextNode("Shape"));
  [["Rectangle","▭",false],["Ellipse","◯",true]].forEach(([lbl,gl,ell])=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sk-edm"+((ell===shapeSelEll)?" on":"");
    b.textContent=gl+" "+lbl; b.title="Select with a "+lbl.toLowerCase();
    b.onclick=()=>{ shapeSelEll=ell;
      [...shapeRow.querySelectorAll(".sk-edm")].forEach(z=>
        z.classList.toggle("on", /ellipse/i.test(z.textContent)===shapeSelEll)); };
    shapeRow.appendChild(b);
  });
  shapeRow.classList.add("sk-edpanel");   /* 6nl */
  gSet.appendChild(shapeRow);
  /* 6gk — what the next wand click does to the selection. It sits with the tolerance, because both are
     settings for the tool in your hand rather than actions of their own. */
  const modeRow=document.createElement("div"); modeRow.className="sk-edmodes";
  const modeBtns={};
  [["new","New","\u25a1","Select just the region you click"],
   ["add","Add","\uff0b","Add the region you click to the selection (or hold Shift)"],
   ["sub","Subtract","\u2212","Take the region you click out of the selection (or hold Alt)"]]
    .forEach(([k,label,glyph,title])=>{
      const b=document.createElement("button");
      b.type="button"; b.className="sk-edm"+(k===wandMode?" on":"");
      b.title=title; b.textContent=glyph+" "+label;
      b.onclick=()=>{ wandMode=k;
        Object.keys(modeBtns).forEach(z=>modeBtns[z].classList.toggle("on",z===k)); };
      modeBtns[k]=b; modeRow.appendChild(b);
    });
  modeRow.classList.add("sk-edpanel");    /* 6nl */
  gSet.appendChild(modeRow);

  /* 6gk — AND IT ZOOMS. A capture is several times the resolution of the screen now, so the editor
     has to be able to get close enough to rub out one line of it. Fit, −, +, and ctrl-wheel; the
     stage scrolls when the picture is bigger than it. */
  let zoom=1, fit=1;

  const applyZoom=()=>{
    const W=Math.max(1,Math.round(cv.width*zoom)), H=Math.max(1,Math.round(cv.height*zoom));
    cv.style.width=ov.style.width=W+"px";
    cv.style.height=ov.style.height=H+"px";
    try{ drawObjs(); }catch(e){}
    box.style.width=W+"px"; box.style.height=H+"px";
    if(zoomTag)zoomTag.textContent=Math.round(zoom*100)+"%";
    try{ sizeRing(); }catch(e){}
  };
  const setZoom=z=>{ zoom=Math.max(0.05,Math.min(8,z)); applyZoom(); dropBox(); };
  /* 6gr — measured off the STAGE, which is now a fixed box: the fit is the fit in the room there is,
     and zooming afterwards never changes that room. */
  /* 6nl — THE FIT IS TO THE ROOM THAT IS LEFT, NOT TO THE WHOLE STAGE.
     This measured the stage's border box less a flat 26px, which was right when the stage was
     nothing but the picture. It now carries the padding that holds the picture clear of the
     floating rail and the floating dock — 142px on the left and about 137 at the foot — and
     ignoring that fitted a 560x760 capture to a box 137px taller than the one it had to sit in, so
     it hung out of the bottom of the stage. `clientWidth`/`clientHeight` are the padding box, so
     the padding comes off them explicitly. */
  const fitZoom=()=>{
    const cs=getComputedStyle(stage);
    const px=n=>parseFloat(cs[n])||0;
    const cw=(stage.clientWidth||stage.getBoundingClientRect().width||900)
             -px("paddingLeft")-px("paddingRight");
    const ch=(stage.clientHeight||stage.getBoundingClientRect().height||520)
             -px("paddingTop")-px("paddingBottom");
    const availW=Math.max(120,cw-10);
    const availH=Math.max(120,ch-10);
    fit=Math.min(availW/cv.width,availH/cv.height);
    setZoom(Math.min(1,fit));
  };
  mkb(gView,"","−",()=>{zoomUser=true;setZoom(zoom/1.25);},false,"Zoom out \u2014 or hold Ctrl and scroll over the picture","zoomout");
  zoomTag=document.createElement("span"); zoomTag.className="sk-ednum sk-edzoom";
  gView.appendChild(zoomTag);
  mkb(gView,"","＋",()=>{zoomUser=true;setZoom(zoom*1.25);},false,"Zoom in \u2014 or hold Ctrl and scroll over the picture","zoomin");
  mkb(gView,"Fit","⤢",()=>{zoomUser=false;fitZoom();},false,"Fit the picture in the window","fit");
  mkb(gView,"1:1","▣",()=>{zoomUser=true;setZoom(1);},false,"Every pixel of the capture, one for one","oneone");
  /* 6gt — AND THE PICTURE TURNS. Ced: "add a rotate tool to rotate the photo itself within the edit
     photo." A quarter at a time, losslessly — the pixels are redrawn with the sides swapped rather
     than resampled, so four turns are exactly what you started with. It is an editing step like any
     other: Undo puts it back, and the mark on the sheet takes the new proportions when you save. */
  const gTurn=group(bar);              /* 6n3 — the turns and the crop are tools: they go in the rail */
  /* 6n3 — the zoom block is NOT in the rail. Measured at 1512x923 with it there: 907px of content
     in 636px of rail, so Crop, Apply and the zoom itself sat below the fold and had to be scrolled
     to — a reachability regression on the top bars, which showed everything at once. Zoom is a view
     control rather than a tool, so it goes to the base strip beside Undo and Redo, which brings the
     rail to 620px and inside the room there is. */
  const turnPic=dir=>{
    pushGeo();
    const r=skRotCanvas(cv,dir);
    cv.width=ov.width=r.width; cv.height=ov.height=r.height;
    g.clearRect(0,0,cv.width,cv.height);
    g.drawImage(r,0,0);
    r.width=r.height=0;
    turnOrig(dir<0?3:1);
    picRot=(picRot+(dir<0?3:1))%4;
    const _sw=pxW; pxW=pxH; pxH=_sw;      /* 6ha — a quarter turn swaps which way each pixel measures */
    picChanged=true;
    mask=null; skMaskShow(ov,mask); say();
    applyZoom(); dropBox();
    setStatus("Turned a quarter "+(dir<0?"anticlockwise":"clockwise")+
              " — the mark takes the new proportions when you save.");
  };
  mkb(gTurn,"Rotate left",edIco("turnleft"),()=>turnPic(-1),false,"Turn the picture a quarter anticlockwise","turnleft");
  mkb(gTurn,"Rotate right",edIco("turnright"),()=>turnPic(1),false,"Turn the picture a quarter clockwise","turnright");
  /* 6i6 — and the two mirrors, beside the two turns */
  const flipPic=axis=>{
    pushGeo();
    const r=skFlipCanvas(cv,axis);
    g.clearRect(0,0,cv.width,cv.height);
    g.drawImage(r,0,0);
    r.width=r.height=0;
    if(orig){
      const o=skFlipCanvas(orig,axis);
      const c=orig.getContext("2d");
      c.clearRect(0,0,orig.width,orig.height);
      c.drawImage(o,0,0);
      o.width=o.height=0;
    }
    picChanged=true;
    mask=null; skMaskShow(ov,mask); say();
    applyZoom(); dropBox();
    setStatus(axis==="h"?"Flipped left to right." : "Flipped top to bottom.");
  };
  mkb(gTurn,"Flip H",edIco("fliph"),()=>flipPic("h"),false,"Mirror the picture left to right","fliph");
  mkb(gTurn,"Flip V",edIco("flipv"),()=>flipPic("v"),false,"Mirror the picture top to bottom","flipv");
  /* 6gz — CROP. Ced: "add crop on edit photo to crop the final photo." A snapshot is dragged out over
     a drawing and almost always brings a margin of something else with it; erasing that margin leaves
     it as empty pixels the mark still has to carry and still has to be sized around. A crop takes it
     off outright: the picture, the untouched original behind it and the mark's own box on the sheet
     all come down to the region you drew, at the scale the picture already had. */
  const cropTo=(x0,y0,x1,y1)=>{
    const X=Math.max(0,Math.round(Math.min(x0,x1))), Y=Math.max(0,Math.round(Math.min(y0,y1)));
    const W=Math.min(cv.width-X,Math.round(Math.abs(x1-x0)));
    const H=Math.min(cv.height-Y,Math.round(Math.abs(y1-y0)));
    if(W<4||H<4){ skMaskShow(ov,mask); setStatus("Drag a box round what you want to keep.",true); return; }
    pushGeo();
    const cut=(src,sw,sh)=>{ const t=document.createElement("canvas"); t.width=W; t.height=H;
      t.getContext("2d").drawImage(src,X,Y,W,H,0,0,W,H); return t; };
    const kept=cut(cv);
    if(orig){
      const ko=cut(orig);
      orig.width=W; orig.height=H;
      const oc=orig.getContext("2d"); oc.clearRect(0,0,W,H); oc.drawImage(ko,0,0);
      ko.width=ko.height=0;
    }
    cv.width=ov.width=W; cv.height=ov.height=H;
    g.clearRect(0,0,W,H); g.drawImage(kept,0,0);
    kept.width=kept.height=0;
    mask=null; skMaskShow(ov,mask); say();
    picChanged=true;
    applyZoom(); dropBox();
    setTool("erase");
    setStatus("Cropped to "+W+" × "+H+" — the mark takes the new proportions when you save.");
  };
  /* ================================================================================================
     6m1 — THE CROP BOX ARRIVES ON THE PICTURE'S OWN EDGES.
     Ced: "crop should also come from the edges of the photo, not dragged by the user."

     6gz made Crop a drag: press at one corner, sweep to the other, and the moment you let go the
     picture is cut. Measured on entering the tool, the overlay carried exactly zero painted pixels —
     there was nothing on screen at all until the hand started moving, and the only way to take a
     narrow strip off one side was to draw a box round everything else by eye and hope.

     Cropping is almost always SUBTRACTIVE: you have a picture and you want a bit less of it. So the
     box starts as the whole picture, with a grip on every corner and every edge, and you push the
     sides in to the part you want. Nothing is cut until Apply, so the box can be nudged, reconsidered
     and nudged again — Escape leaves the picture alone, Enter applies. Dragging out a fresh box from
     empty space still works for the times you want to pick a small detail out of a large capture, so
     the old gesture is not taken away; it is just no longer the only one.
     ================================================================================================ */
  const CROP_PTS=[[0,0],[0.5,0],[1,0],[1,0.5],[1,1],[0.5,1],[0,1],[0,0.5]];
  let cropBox=null;
  function cropSay(){
    if(!cropBox)return;
    const W=Math.round(cropBox.w), H=Math.round(cropBox.h);
    setStatus("Crop "+W+" × "+H+" — drag the edges or the corners, then Apply. "+
              "Escape leaves the picture as it is.");
  }
  function cropPaint(){
    if(!cropBox)return;
    const og=ov.getContext("2d");
    const X=cropBox.x, Y=cropBox.y, W=cropBox.w, H=cropBox.h;
    const u=Math.max(1,1/Math.max(0.05,zoom));        /* one screen pixel, in picture pixels */
    og.clearRect(0,0,ov.width,ov.height);
    og.save();
    og.fillStyle="rgba(8,14,26,.55)";
    og.fillRect(0,0,ov.width,ov.height);
    og.clearRect(X,Y,W,H);
    if(W>2&&H>2){
      og.strokeStyle="rgba(255,255,255,.35)"; og.lineWidth=u; og.setLineDash([]);
      og.beginPath();
      for(let i=1;i<3;i++){
        og.moveTo(X+W*i/3,Y); og.lineTo(X+W*i/3,Y+H);
        og.moveTo(X,Y+H*i/3); og.lineTo(X+W,Y+H*i/3);
      }
      og.stroke();
    }
    og.setLineDash([]); og.lineWidth=u*3; og.strokeStyle="rgba(8,14,26,.85)";
    og.strokeRect(X,Y,W,H);
    og.lineWidth=u; og.strokeStyle="#ffffff";
    og.setLineDash([u*6,u*4]); og.strokeRect(X,Y,W,H);
    /* 6m1 — and the eight grips, so it is visible that the box is a thing you take hold of */
    og.setLineDash([]);
    const s=Math.max(u*3.5,Math.min(W,H)*0.02);
    og.lineWidth=u*1.5;
    CROP_PTS.forEach(p=>{
      const px=X+W*p[0], py=Y+H*p[1];
      og.fillStyle="#ffffff"; og.fillRect(px-s,py-s,s*2,s*2);
      og.strokeStyle="rgba(8,14,26,.9)"; og.strokeRect(px-s,py-s,s*2,s*2);
    });
    og.restore();
  }
  function cropOpen(){
    cropBox={x:0,y:0,w:cv.width,h:cv.height};
    skOvShow(ov,true);                     /* 6j2 — the box is not a selection; hold the overlay up */
    cropPaint(); cropSay();
    if(bCrop)bCrop.classList.add("on");
  }
  function cropClose(){
    if(!cropBox)return;
    cropBox=null;
    skOvShow(ov,false);
    try{ skMaskShow(ov,mask); }catch(e){}
  }
  function cropApply(){
    if(!cropBox)return;
    const b=cropBox; cropBox=null; skOvShow(ov,false);
    cropTo(b.x,b.y,b.x+b.w,b.y+b.h);
  }
  /* which part of the box the pointer has hold of: a corner, an edge, the inside, or nothing */
  function cropHit(x,y){
    if(!cropBox)return null;
    const t=Math.max(3,10/Math.max(0.05,zoom));       /* ten screen pixels of grab */
    const X=cropBox.x, Y=cropBox.y, W=cropBox.w, H=cropBox.h;
    if(x<X-t||x>X+W+t||y<Y-t||y>Y+H+t)return null;
    let h="";
    if(Math.abs(y-Y)<=t)h+="n"; else if(Math.abs(y-(Y+H))<=t)h+="s";
    if(Math.abs(x-X)<=t)h+="w"; else if(Math.abs(x-(X+W))<=t)h+="e";
    if(h)return h;
    return (x>X&&x<X+W&&y>Y&&y<Y+H)?"move":null;
  }
  /* 6ha — FREE ROTATION. Ced: "rotate should also has free rotate option." A quarter turn is the one
     you want for a picture taken sideways; a detail lifted off a drawing is almost never out by exactly
     ninety degrees. The slider previews with a CSS transform — no pixels are touched while you sweep it
     — and commits ONE resample when you let go, from the pixels as they were, so sweeping back and
     forth costs nothing in quality. The canvas grows to hold the corners, and the mark on the sheet
     grows with it, because a pixel is still worth the same amount of paper. */
  const freeRow=document.createElement("label"); freeRow.className="sk-edsize sk-edfree";
  freeRow.appendChild(document.createTextNode("Rotate"));   /* 6n6 — Ced: "rename it to Rotate" */
  const frng=document.createElement("input");
  /* 6iq — A CALMER SLIDER. Ced: "make the rotate slider just be less dramatic." Across the whole 360°
     a pixel of travel was about a degree and a half, so the one thing the free turn is for — taking a
     degree or two of skew out of a photograph — was the one thing it could not do. It covers ±30° in
     quarter-degree steps now, which is the range a hand-held picture actually needs; the four quarter
     turns beside it are how you go further, and the grip on the picture itself turns freely. */
  frng.type="range"; frng.min="-30"; frng.max="30"; frng.step="0.25"; frng.value="0";
  frng.title="The picture\u2019s own angle — \u00b130\u00b0, a quarter of a degree at a time. The handle sits where the picture sits; let go to apply. "+
             "For more, use the quarter turns, or drag the ↻ grip on the picture itself";
  const fnum=document.createElement("span"); fnum.className="sk-ednum"; fnum.textContent="0°";
  const fmtDeg=d=>((Math.round(d*100)/100)+"°");
  /* 6m0 — the box turns and the chequer inside it turns back, so the grid stays square to the screen.
     The chequer was built with the picture, in `skEditor`; this is `skEdWire`, the other side of the
     same function boundary, so it is found on the box rather than closed over — exactly as the turn
     grip below is. (Written closed-over first, inside a `try`, which swallowed `bgpat is not defined`
     and shipped a build where the chequer turned with the picture and every measurement said so. The
     `try` is gone: a lookup that fails should be visible, and a missing element is handled by asking
     whether it is there.) */
  const bgpat=box.querySelector(".sk-edbg");
  const preview=deg=>{
    box.style.transform=deg?("rotate("+deg+"deg)"):"";
    if(bgpat)bgpat.style.transform=deg?("rotate("+(-deg)+"deg)"):"";
    fnum.textContent=fmtDeg(deg);
  };
  /* ================================================================================================
     6m0 — A FREE TURN TAKES THE SMALLEST ROOM IT CAN, AND A TURN BACK IS A TURN BACK.
     Ced: "do not make the selection or canvass bigger every rotate, always take the smallest space it
     can get."

     Measured on a 749 x 912 capture, sweeping the slider +10, -10, +10, -10 — four gestures that end
     exactly where they started:

         749x912  ->  896x1029  ->  1062x1169  ->  1249x1336  ->  1463x1533

     Nearly double, for nothing. Two separate causes, and both are fixed here.

     ONE: each turn resampled THE RESULT OF THE LAST ONE. A turn's canvas has to be big enough to hold
     the old rectangle's corners, so every turn grows it, and turning back grows it again — the empty
     triangles from the first turn are now picture as far as the second one knows. So a run of free
     turns is accumulated instead: `spinBase` keeps the pixels as they were before the first turn of
     the run and `spinAcc` the total angle, and each commit resamples the BASE by the total. +10 then
     -10 is a 0 degree turn of the original, which is the original, at its original size and with no
     resampling loss either. Anything that changes the pixels for real — a brush, a crop, a quarter
     turn, a flip, Restore all — ends the run, because the base would no longer be the truth.

     TWO: the result is then TRIMMED to its own ink. A turn leaves transparent corners, and on a
     capture lifted off a drawing — which is most of what this editor sees — there is usually a margin
     of nothing round the subject as well. Carrying it costs the mark paper on the sheet and gives the
     hand a box bigger than the thing in it. Fully transparent rows and columns come off the edges;
     a picture with an opaque ground has none and is untouched, which is correct rather than a
     limitation. The mark's own box is pulled in by the same fractions, about its centre, so nothing
     on the sheet appears to move.
     ================================================================================================ */
  let spinBase=null, spinOrigBase=null, spinAcc=0;   /* where a run of free turns began, and its total */
  let trimShiftX=0, trimShiftY=0;                    /* 6m0 — how far a trim moved the subject */
  /* a DECLARATION, not a const: `push`/`pushGeo` are written far above this line and call it, and a
     `const` would leave them reaching into the temporal dead zone if anything ever pushed earlier. */
  function endSpinRun(){
    try{ if(spinBase)spinBase.width=spinBase.height=0;
         if(spinOrigBase)spinOrigBase.width=spinOrigBase.height=0; }catch(e){}
    spinBase=null; spinOrigBase=null; spinAcc=0;
    /* 6n6 — and the handle goes back to the middle with it, because the angle it was reading is no
       longer an angle of anything. A declaration rather than a const for the same reason this
       function is one: it is called from `push`, which is written far above the slider. */
    try{ _freeSync&&_freeSync(); }catch(e){}
  }
  let _freeSync=null;
  const snapCanvas=src=>{ const t=document.createElement("canvas");
    t.width=src.width; t.height=src.height; t.getContext("2d").drawImage(src,0,0); return t; };
  /* the fully transparent border round what is actually drawn, in pixels */
  const inkBounds=c=>{
    try{
      const w=c.width, h=c.height;
      if(!(w>0&&h>0))return null;
      const d=c.getContext("2d",{willReadFrequently:true}).getImageData(0,0,w,h).data;
      let x0=w, y0=h, x1=-1, y1=-1;
      for(let y=0;y<h;y++){
        const row=y*w*4;
        for(let x=0;x<w;x++){
          if(d[row+x*4+3]){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
        }
      }
      if(x1<0)return null;                       /* nothing drawn at all — leave it alone */
      return {x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};
    }catch(e){ return null; }                    /* a tainted canvas reads as "do not trim" */
  };
  const turnFree=deg=>{
    if(!(+deg))return;
    _inFreeTurn=true;
    try{ turnFreeInner(+deg); } finally{ _inFreeTurn=false; }
  };
  const turnFreeInner=deg=>{
    /* 6m0 — accumulate against the pixels the run started from, not against the last result */
    if(!spinBase){ spinBase=snapCanvas(cv); spinOrigBase=orig?snapCanvas(orig):null; spinAcc=0; }
    spinAcc=((spinAcc+ +deg)%360+360)%360;
    const src0=spinBase, srcO=spinOrigBase;
    const rad=spinAcc*Math.PI/180;
    const w0=src0.width, h0=src0.height;
    let nw=Math.max(1,Math.ceil(Math.abs(w0*Math.cos(rad))+Math.abs(h0*Math.sin(rad))));
    let nh=Math.max(1,Math.ceil(Math.abs(w0*Math.sin(rad))+Math.abs(h0*Math.cos(rad))));
    const spin=src=>{ const t=document.createElement("canvas"); t.width=nw; t.height=nh;
      const tg=t.getContext("2d");
      tg.translate(nw/2,nh/2); tg.rotate(rad); tg.drawImage(src,-src.width/2,-src.height/2);
      return t; };
    pushGeo();
    let pic=spin(src0), og=srcO?spin(srcO):null;
    /* 6m0 — and then down to the ink. The two are trimmed by the SAME box, so Restore keeps painting
       the original back in register with the picture it belongs to. */
    const bb=inkBounds(pic);
    let trimL=0, trimT=0, trimR=0, trimB=0;
    if(bb&&(bb.w<nw||bb.h<nh)&&bb.w>=4&&bb.h>=4){
      trimL=bb.x; trimT=bb.y; trimR=nw-(bb.x+bb.w); trimB=nh-(bb.y+bb.h);
      const cut=src=>{ const t=document.createElement("canvas"); t.width=bb.w; t.height=bb.h;
        t.getContext("2d").drawImage(src,bb.x,bb.y,bb.w,bb.h,0,0,bb.w,bb.h); return t; };
      const p2=cut(pic); pic.width=pic.height=0; pic=p2;
      if(og){ const o2=cut(og); og.width=og.height=0; og=o2; }
      /* 6m0 — THE BOX KEEPS ITS CENTRE WHEN IT IS SAVED, so a trim that takes more off one side than
         the other would slide the picture across the sheet. A turn's own corners are symmetric by
         construction — it is turned about its own centre — so this only bites when the picture had an
         off-centre margin to begin with, and then it is exactly the amount the subject moves. It is
         recorded here, in page units, where the scale is known, and added back at save. */
      try{
        const P=(S.pages&&S.pages[a.page])||{};
        const W=P.w1||612, H=P.h1||792;
        trimShiftX+=(((bb.x+bb.w/2)-nw/2)*pxW)/W;
        trimShiftY+=(((bb.y+bb.h/2)-nh/2)*pxH)/H;
      }catch(e){}
      nw=bb.w; nh=bb.h;
    }
    cv.width=ov.width=nw; cv.height=ov.height=nh;
    g.clearRect(0,0,nw,nh); g.drawImage(pic,0,0); pic.width=pic.height=0;
    if(og&&orig){ orig.width=nw; orig.height=nh;
      const oc=orig.getContext("2d"); oc.clearRect(0,0,nw,nh); oc.drawImage(og,0,0);
      og.width=og.height=0; }
    mask=null; skMaskShow(ov,mask); say();
    picChanged=true;
    applyZoom(); dropBox();
    setStatus("Turned "+Math.round(spinAcc>180?spinAcc-360:spinAcc)+"°"+
              ((trimL||trimT||trimR||trimB)?" and trimmed to the picture":"")+
              " — the mark takes the new shape when you save.");
  };
  /* ==================================================================================================
     6n6 — THE SLIDER IS THE ANGLE, NOT A NUDGE. Ced: "free slider is not working good."

     It read as a nudge and behaved as one: every release committed the value as a RELATIVE turn and
     then snapped the handle back to 0. So the reading never told you where the picture actually was,
     and getting from 12 degrees to 15 meant dragging to 3 and knowing why. Worse, a turn committed
     at 12 and then a drag to 12 again gave 24.

     The mechanism underneath was already absolute — 6m0's `spinAcc` is the run's total angle and
     every commit resamples the run's BASE by that total, which is why +10 then -10 gives the
     original back pixel for pixel. The slider just was not wired to it. It is now: the handle sits
     at the picture's own angle, a drag previews the DIFFERENCE as a CSS turn, and the release
     commits that difference so `spinAcc` lands on exactly what the handle says.

     Anything that ends a run of free turns — a brush stroke, a crop, a quarter turn, Restore all —
     makes the base no longer the truth, so `spinAcc` goes back to 0 and the handle goes with it.
     ================================================================================================== */
  const freeSync=()=>{ frng.value=String(((spinAcc+180)%360+360)%360-180);
    fnum.textContent=fmtDeg(+frng.value); try{ edSyncRange(frng); }catch(e){} };
  _freeSync=freeSync;
  frng.addEventListener("input",()=>preview(+frng.value-spinAcc));
  const commitFree=()=>{ const want=+frng.value, d=want-spinAcc;
    preview(0); if(d)turnFree(d); freeSync(); };
  ["change","pointerup","pointercancel"].forEach(ev=>
    frng.addEventListener(ev,()=>{ setTimeout(commitFree,0); }));
  freeRow.appendChild(frng); freeRow.appendChild(fnum);
  freeRow.classList.add("sk-edpanel");    /* 6nl */
  bar3.appendChild(freeRow);                      /* 6n0 — on the sliders' own row, not the tool row */
  /* 6iq — and the grips on the picture drive the same turn. The drag previews with the same CSS
     rotation the slider uses, and the release commits it through `turnFree`, so there is one
     definition of what turning the picture means. */
  /* the grip was built with the picture, in `skEditor`; this is the other side of the same function
     boundary, so it is found on the box rather than handed over */
  [...box.querySelectorAll(".sk-edrot")].forEach(gp=>{
    gp.addEventListener("pointerdown",ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const r=box.getBoundingClientRect();
      const cxm=r.left+r.width/2, cym=r.top+r.height/2;
      const a0=Math.atan2(ev.clientY-cym,ev.clientX-cxm);
      let deg=0;
      try{ gp.setPointerCapture(ev.pointerId); }catch(e){}
      const mv=e=>{
        const a1=Math.atan2(e.clientY-cym,e.clientX-cxm);
        deg=(a1-a0)*180/Math.PI;
        if(e.shiftKey)deg=Math.round(deg/15)*15;
        deg=Math.round(deg*4)/4;
        preview(deg);
        setStatus("Turning "+fmtDeg(deg)+" — let go to apply. Hold Shift for 15° steps.");
      };
      const up=()=>{
        window.removeEventListener("pointermove",mv);
        window.removeEventListener("pointerup",up);
        window.removeEventListener("pointercancel",up);
        preview(0);
        if(Math.abs(deg)>=0.25)turnFree(deg);
      };
      window.addEventListener("pointermove",mv);
      window.addEventListener("pointerup",up);
      window.addEventListener("pointercancel",up);
    });
  });
  /* =================================================================================================
     6mh — THE BORDER IS THE SHAPE'S OWN EDGE, NOT A BOX ROUND IT.
     Ced: "fix the border tool on edit photo. it should not add a border to the box, it must be border
     on the transparent shape. so if the transparent shape is final, toggling and adding border should
     make the edge or outline of the shape thicker."

     6j4 made this the MARK's stroke — `a.sw` — which draws a rectangle round the picture's bounding
     box. On a photo that is a frame and reads as one; on everything this editor is actually used for
     it is wrong, because by the time you reach this slider the picture is a cut-out: Auto, the wand
     and the eraser have taken the paper away and what is left is a silhouette with a shape to it. A
     rectangle round that silhouette's box is not its outline.

     So the border is pixels now, and it is the silhouette grown and laid BEHIND the picture. Grown by
     v and painted underneath, every edge of the shape gains v pixels of the picture's own ink — which
     is exactly "make the edge or outline of the shape thicker" — and nothing is painted over, so a
     drawing's own detail survives it. One pass of `skMaskGrow`, which is separable, so it is live
     under the hand on a two-megapixel capture.

     It is reversible the way a slider should be: `bordBase` holds the pixels the drag started from,
     so going back to 0 removes it, and ANY other operation clears that base through `push` — after
     which the outline is simply part of the picture, as it must be, because the picture is pixels.

     A picture with no transparent edge — a photograph, opaque to its own corners — has no silhouette
     to outline and this does nothing to it. That is the honest answer rather than a frame drawn in
     its place, and the tooltip says so.
     ================================================================================================= */
  {
    const row=document.createElement("label"); row.className="sk-edsize sk-edborder";
    row.appendChild(document.createTextNode("Border"));
    const brng=document.createElement("input");
    brng.type="range"; brng.min="0"; brng.max="12"; brng.step="0.1";   /* 6np */
    brng.value="0";
    brng.title="Thicken the edge of the cut-out shape, in pixels — 0 for none. "+
               "A picture with no transparent edge has no outline to thicken.";
    const bnum=document.createElement("span"); bnum.className="sk-ednum";
    let bordRaf=0, bordWant=0;
    /* 6mk — AND THE PICTURE MAKES ROOM FOR IT. Ced, with a cut-out whose outline is sliced flat
       along the top and left: "the border seems to get cut. make the space in edit photo expand as
       border expand too."

       An outline grown by v needs v pixels of paper outside the shape, and a cut-out made with Auto
       or the wand has none: `skMaskGrow` stops at the canvas edge, so wherever the shape touched it
       the outline was clipped to nothing. The canvas grows by v on every side instead, exactly as
       the free turn's canvas grows to hold the corners — and for the same reason, "because a pixel
       is still worth the same amount of paper", the mark on the sheet grows with it. That part
       needs no code: `put` already recomputes `nw`/`nh` from `cv.width * pxW` about the mark's
       centre whenever the canvas has changed size, which is how Crop and the free turn work too.

       `bordBase` and `bordOrig` are the UNPADDED pixels, so the size is rebuilt from scratch at
       every step of the drag: v=0 returns the canvas to exactly the size it started at, and going
       6 → 3 does not leave the padding from 6 behind. */
    /* ==================================================================================================
       6np — THE BORDER IS CONTINUOUS. Ced: "the stops in border tool in edit picture is too much.
       make it more seamless like a slider."

       It was `step="1"` over 0..12 — thirteen stops — because the thing underneath is a box
       dilation and a dilation's radius is a whole number of pixels. So the slider could only ever
       be thirteen positions however fine its step was made.

       The fraction is painted instead of rounded away. The outline is drawn twice: the mask grown
       by the WHOLE part at full strength, and the ring between that and one pixel further out at
       the FRACTION's strength. At 3.0 that second pass is skipped; at 3.4 the outermost pixel of
       the outline is at 40% and the eye reads a border four tenths of a pixel thicker. The slider
       is `step="0.1"` now — 121 positions — and the thickening is smooth between them.
       ================================================================================================== */
    const bordDraw=()=>{
      bordRaf=0;
      const vf=Math.max(0,bordWant), v=Math.ceil(vf);
      if(!bordBase){
        flattenObjs();                 /* v62 — the border is traced round what is drawn, too */
        bordBase=g.getImageData(0,0,cv.width,cv.height);
        if(orig){ bordOrig=document.createElement("canvas");
                  bordOrig.width=orig.width; bordOrig.height=orig.height;
                  try{ bordOrig.getContext("2d").drawImage(orig,0,0); }catch(e){} }
      }
      /* v+1, not v: at exactly v the outline is complete but lands flush on the new edge, which is
         the thing that reads as cut. One pixel of paper outside it and it cannot. */
      const pad=v?v+1:0;
      const W=bordBase.width+2*pad, H=bordBase.height+2*pad;
      if(cv.width!==W||cv.height!==H){ cv.width=ov.width=W; cv.height=ov.height=H; }
      g.clearRect(0,0,W,H);
      g.putImageData(bordBase,pad,pad);
      if(vf>0){
        try{
          const m=skInkMask(g,cv,40);
          const col=(a&&a.col)||"#fa3237";
          const whole=Math.floor(vf), frac=vf-whole;
          if(whole>0)skMaskFill(g,cv,skMaskGrow(m,W,H,whole),col);
          if(frac>0.02){
            /* the ring one pixel further out, at the fraction's strength. `skMaskFill` paints
               BEHIND what is already drawn, so the ring has to be a mask of its own rather than a
               second full grow — otherwise the stronger pass would be the one underneath. */
            const inner=whole>0?skMaskGrow(m,W,H,whole):m;
            const outer=skMaskGrow(m,W,H,whole+1);
            const ring=new Uint8Array(outer.length);
            for(let i=0;i<outer.length;i++)ring[i]=(outer[i]&&!inner[i])?1:0;
            g.save(); g.globalAlpha=frac;
            skMaskFill(g,cv,ring,col);
            g.restore();
          }
        }catch(e){}
      }
      /* the untouched copy Restore brushes from is padded the same way, or a restored stroke would
         land v pixels off once the picture has grown */
      if(bordOrig&&orig){
        const ow=bordOrig.width+2*pad, oh=bordOrig.height+2*pad;
        orig.width=ow; orig.height=oh;
        const oc=orig.getContext("2d"); oc.clearRect(0,0,ow,oh);
        try{ oc.drawImage(bordOrig,pad,pad); }catch(e){}
      }
      mask=null; picChanged=true;
      try{ skMaskShow(ov,mask); }catch(e){}
      try{ applyZoom(); }catch(e){}
      try{ dropBox(); }catch(e){}
    };
    brng.oninput=()=>{
      const v=+brng.value;
      bnum.textContent=v?(v+"px"):"none";
      /* one undo step per drag, taken before the first pixel moves */
      if(!bordPushed){ bordHold=true; push(); bordHold=false; bordPushed=true; }
      bordWant=v;
      /* 6mh — one repaint per frame however fast the slider is dragged: the grow is cheap but it is
         not free, and a range input fires far oftener than the screen redraws. */
      if(!bordRaf)bordRaf=requestAnimationFrame(bordDraw);
    };
    brng.onchange=()=>{ bordPushed=false; try{ autosave(); }catch(e){} };
    bnum.textContent="none";
    /* 6n0/6n3 — the border row joins the free one on the base strip, and Undo/Redo are moved to the
       end of it so the floor reads left to right as Ced asked for it: free, border, undo, redo. */
    row.appendChild(brng); row.appendChild(bnum);
    row.classList.add("sk-edpanel");      /* 6nl */
    bar3.appendChild(row);
    /* v62 — history and zoom at the head of the one column (6nn had them on the right) */
    colL.insertBefore(gView,colL.firstChild); colL.insertBefore(gHist,colL.firstChild);
  }
  /* 6m1 — one button for both halves of the gesture: it opens the box on the picture's edges, and
     once the box is up it is the Apply. Enter does the same from the keyboard, Escape puts it away. */
  bCrop=mkb(gTurn,"Crop",edIco("crop"),()=>{
    if(cropBox){ cropApply(); return; }
    setTool("crop");
  },false,"Crop the picture — the box starts on its edges; push the sides in, then Apply","crop");
  bCropApply=mkb(gTurn,"Apply","✓",()=>cropApply(),false,"Cut the picture down to the box","cropapply");
  bCropApply.style.display="none";
  /* 6gl — the wheel belongs to the editor while the editor is open: ctrl-wheel zooms the PICTURE, and
     a plain wheel outside the scrolling stage is swallowed rather than scrolling the sheet behind. */
  /* 6ip — SHIFT-WHEEL IS THE BRUSH. Ced: "shift scroll up or down makes the brushes bigger or
     smaller." It is the size you change most and the one control you should never have to go up to the
     bar for, so it rides the wheel under the hand: Shift for the brush, Ctrl for the zoom. The step is
     proportional, so it is fine at 4px and still quick at 90. */
  const bumpBrush=dir=>{
    /* 6lf — Shift-wheel sizes WHATEVER IS IN YOUR HAND. With the pen that is the weight in points,
       on its own slider and with its own step: proportional like the brush's, floored at a quarter
       point so it still moves at the bottom of the range, and rounded to the slider's own 0.25
       so the number under the slider and the stroke on the picture never disagree. */
    if(tool==="pen"){
      const st=Math.max(0.25,Math.round(drawPt*0.18*4)/4);
      const v=Math.max(+drng.min,Math.min(+drng.max,Math.round((drawPt+dir*st)*4)/4));
      if(v===drawPt)return;
      drawPt=v; drng.value=String(v); dsay(); sizeRing();
      try{ edSyncRange(drng); }catch(e){}
      return;
    }
    const step=Math.max(1,Math.round(brush*0.16));
    const v=Math.max(+rng.min,Math.min(+rng.max,brush+dir*step));
    if(v===brush)return;
    brush=v; rng.value=String(v); num.textContent=v+"px"; sizeRing();
    try{ edSyncRange(rng); }catch(e){}
    say&&say();
  };
  const wheel=e=>{
    if(e.shiftKey&&!e.ctrlKey&&!e.metaKey){
      e.preventDefault(); e.stopPropagation();
      bumpBrush(e.deltaY<0?1:-1);
      if(ring&&!ring.hidden)ring.classList.add("on");
      return true;
    }
    if(e.ctrlKey||e.metaKey){
      e.preventDefault(); e.stopPropagation();
      zoomUser=true; setZoom(zoom*(e.deltaY<0?1.12:1/1.12));   /* 6nl */
      return true;
    }
    return false;
  };
  stage.addEventListener("wheel",wheel,{passive:false});
  wrap.addEventListener("wheel",e=>{
    if(wheel(e))return;
    if(!stage.contains(e.target))e.preventDefault();
  },{passive:false});

  bUndo=mkb(gHist,"Undo","↶",()=>{
    const st=undo.pop(); if(!st)return;
    /* 6gz — what goes onto the redo stack has to be able to put the shape back too */
    redo.push(shotFor(st)); while(redo.length>HIST_MAX)redo.shift(); put(st); syncHist();
  },false,"Undo the last change to the picture (Ctrl+Z)","undo");
  bRedo=mkb(gHist,"Redo","↷",()=>{
    const st=redo.pop(); if(!st)return;
    undo.push(shotFor(st)); put(st); syncHist();
  },false,"Redo (Ctrl+Y)","redo");
  countTag=document.createElement("span"); countTag.className="sk-edcount";
  gHist.appendChild(countTag);

  /* ---- the brush ring ----
     6gq — it is the size the brush ACTUALLY is on screen: the brush is measured in the picture's own
     pixels and the picture is shown at whatever zoom, so the ring is brush × zoom. */
  function sizeRing(){
    if(!ring)return;
    /* 6lf — the ring is the width the TOOL IN HAND paints with. For the eraser and Restore that is
       `brush`, already in picture pixels; for the pen it is `drawPx()`, which turns the weight in
       points into picture pixels through the same `ptPx` the stroke itself uses — so the ring is the
       stroke, not an impression of it. `zoom` takes both from picture pixels to screen pixels. */
    const px=(tool==="pen")?drawPx():brush;
    const d=Math.max(4,px*zoom);
    ring.style.width=d+"px"; ring.style.height=d+"px";
    /* 6n4 — and the cursor is the nib's own shape, because the whole point of the ring is that it
       shows you what the sweep will take before you take it. The pen always draws round. */
    ring.classList.toggle("box", brushBox && tool!=="pen");
  }
  /* 6im — THE RING RIDES A FRAME, NOT AN EVENT. Ced: "the responsiveness of this is too slow, make it
     be more responsive and seamless." A pointer can fire 120 events a second and each one was writing
     `left`/`top` on the ring — a layout position, so each write invalidated layout for the stage and
     the two canvases in it, on the same frame the brush was painting on. The position is remembered
     and written once per animation frame instead, through `transform`, which the compositor can move
     without laying anything out. */
  let _ringAt=null, _ringRaf=0, _stroking=false;
  const flushRing=()=>{ _ringRaf=0;
    if(!ring||ring.hidden||!_ringAt)return;
    ring.style.transform=`translate(${_ringAt[0]}px,${_ringAt[1]}px) translate(-50%,-50%)`;
  };
  function moveRing(ev){
    if(!ring||ring.hidden)return;
    /* 6mu — client coordinates, because the ring is on the overlay now and not in the picture */
    _ringAt=[ev.clientX, ev.clientY];
    if(!_ringRaf)_ringRaf=requestAnimationFrame(flushRing);
    if(!ring.classList.contains("on"))ring.classList.add("on");
  }
  cv.addEventListener("pointermove",moveRing,{passive:true});
  cv.addEventListener("pointerenter",ev=>{ if(ring&&!ring.hidden){ ring.classList.add("on"); moveRing(ev); } });
  /* 6io — but not while a stroke is in progress: the hand is allowed off the picture */
  cv.addEventListener("pointerleave",()=>{ if(ring&&!_stroking)ring.classList.remove("on"); });

  /* ---- the gestures ---- */
  /* 6gr — ONE LAYOUT READ, NOT ONE PER EVENT. `getBoundingClientRect` forces the browser to settle the
     layout, and this was being called for every pointermove AND for every coalesced point inside it —
     on a capture three times the screen's resolution that is what made the brush feel like treacle. The
     box is cached and thrown away whenever something that could move it happens. */
  let _box=null;
  const boxNow=()=>(_box||(_box=cv.getBoundingClientRect()));
  const dropBox=()=>{ _box=null; };
  stage.addEventListener("scroll",dropBox,{passive:true});
  window.addEventListener("resize",dropBox);
  try{ if(window.ResizeObserver){ const _ro=new ResizeObserver(()=>dropBox()); _ro.observe(stage); } }catch(e){}
  const at=ev=>{ const r=boxNow();
    return [ (ev.clientX-r.left)/r.width*cv.width,
             (ev.clientY-r.top)/r.height*cv.height ]; };
  /* 6gj — Ced: "the eraser should also be seamless and continuous if the user erases items." A dab
     per pointer event leaves a dotted trail the moment the hand moves faster than the events arrive,
     so a brush stroke is a STROKED PATH from the last point to this one — round cap, round join —
     with a dab at the head so a single click still works. Coalesced events are used where the browser
     has them, which is what keeps a fast sweep smooth rather than polygonal. */
  /* ==================================================================================================
     6n4 — A BOX BRUSH. Ced: "add a box brush on edit photo."

     A round nib cannot clear up to a straight edge: sweeping along the bottom of a title block leaves
     a scalloped margin, and getting into a corner means taking a bite out of what you are keeping.
     A square nib does both, which is why every raster editor has one.

     It is the NIB, not a tool: Erase, Restore and the pen all paint through `strokePath`, so one
     switch here changes all three and there is no second definition to drift. The square sweep is
     drawn as a union of squares stepped along the segment rather than as a stroked line, because a
     stroked line with a square cap is a rectangle PERPENDICULAR to the direction — correct along the
     axes and too narrow on a diagonal, which is exactly where a gap would open. The step is a third
     of the nib, so consecutive squares overlap by two thirds; the cap keeps a flung pointer from
     asking for ten thousand of them, and at that point the squares are still touching because the
     distance they are spread over is what made the count large.
     ================================================================================================== */
  const strokePath=(ctx,x0,y0,x1,y1,w)=>{
    if(brushBox){
      const d=Math.hypot(x1-x0,y1-y0);
      const n=Math.max(1,Math.min(2048,Math.ceil(d/Math.max(1,w/3))));
      for(let i=0;i<=n;i++){ const t=i/n;
        ctx.fillRect(x0+(x1-x0)*t-w/2, y0+(y1-y0)*t-w/2, w, w); }
      return;
    }
    ctx.lineWidth=w; ctx.lineCap="round"; ctx.lineJoin="round";
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1,y1,w/2,0,Math.PI*2); ctx.fill();
  };
  const rubTo=(x0,y0,x1,y1)=>{
    g.save(); g.globalCompositeOperation="destination-out";
    strokePath(g,x0,y0,x1,y1,brush);
    g.restore();
  };
  /* RESTORE: the original, cut to the shape of the stroke, laid back over the picture. Only the
     stroke's own bounding box is touched, so a brush on a four-megapixel capture is still instant. */
  const _sc=document.createElement("canvas");     /* the original, cut to the stroke */
  const _sm=document.createElement("canvas");     /* the stroke itself, as a mask */
  const restoreTo=(x0,y0,x1,y1)=>{
    const pad=brush/2+2;
    const bx=Math.max(0,Math.floor(Math.min(x0,x1)-pad)), by=Math.max(0,Math.floor(Math.min(y0,y1)-pad));
    const bw=Math.min(cv.width-bx,Math.ceil(Math.abs(x1-x0)+pad*2));
    const bh=Math.min(cv.height-by,Math.ceil(Math.abs(y1-y0)+pad*2));
    if(bw<=0||bh<=0)return;
    /* the stroke is drawn on a mask of its own FIRST, because `destination-in` is a whole-canvas
       operation: a line and then a dab under it would intersect to the dab alone, which is exactly
       what made the first Restore rub out rather than bring back. One mask, one composite. */
    _sm.width=bw; _sm.height=bh;
    const mg=_sm.getContext("2d");
    mg.fillStyle="#fff"; mg.strokeStyle="#fff";
    strokePath(mg,x0-bx,y0-by,x1-bx,y1-by,brush);
    _sc.width=bw; _sc.height=bh;
    const sg=_sc.getContext("2d");
    sg.drawImage(orig,bx,by,bw,bh,0,0,bw,bh);
    sg.globalCompositeOperation="destination-in";
    sg.drawImage(_sm,0,0);
    g.drawImage(_sc,0,0,bw,bh,bx,by,bw,bh);
  };
  let last=null;
  /* 6j5 — A SWEEP MAY START OFF THE PICTURE. Ced: "make it possible to edit photo and erase on the
     edge of the photo, do not stop the function on edit photo on the ui box itself and beyond the
     photo." A stroke already CONTINUES past the edge (6io); what it could not do was BEGIN out there,
     because the press had to land on the canvas — and clearing a margin is exactly the job you start
     from outside and sweep in. The stage listens too, and hands the press on with the same
     coordinates, which are simply outside the picture until the hand arrives. */
  stage.addEventListener("pointerdown",ev=>{
    if(ev.target!==stage&&ev.target!==box)return;           /* a button or the canvas answers itself */
    if(tool!=="erase"&&tool!=="restore")return;             /* only the brushes; a click is otherwise a click */
    _brushDown(ev);
  });
  cv.addEventListener("pointerdown",ev=>_brushDown(ev));
  function _brushDown(ev){
    ev.preventDefault();
    /* 6ha — THE CACHED BOX IS ONLY GOOD WITHIN ONE GESTURE. It is there so a brush does not force a
       layout read per pointer event (6gr), and it was thrown away only on a scroll, a zoom or a window
       resize — none of which covers the thing that actually moves the picture most often: the toolbar
       growing or shrinking as tools are switched, which changes how much room the stage has and, now
       that the picture is centred in it, moves the picture by half of that. A click then landed dozens
       of pixels from where it looked. Reading it once per press costs nothing and cannot go stale. */
    dropBox();
    const [x,y]=at(ev);
    if(tool==="wipe"){
      /* the run of ink under the click, taken whole — or, with Shift, selected so you can look at it
         first and then Fill, Invert or Erase selection it */
      push();
      const run=skWand(g,cv,Math.round(x),Math.round(y),tol,null,"new");
      const n=run?skMaskCount(run):0;
      if(!n){ setStatus("Nothing to follow there — click on a line.",true); return; }
      if(ev.shiftKey){ mask=run; skMaskShow(ov,mask); say();
        setStatus(n.toLocaleString()+" pixels — that run is selected."); return; }
      skMaskErase(g,cv,run);
      setStatus("That run is gone — "+n.toLocaleString()+" pixels, end to end.");
      return;
    }
    if(tool==="crop"){
      /* ============================================================================================
         6m1 — the box is already there, on the picture's own edges; a press takes hold of whichever
         part of it is under the pointer. Nothing is cut here — `cropApply` does that, from the Apply
         button or Enter — so the box can be pushed about until it is right.
         ============================================================================================ */
      if(!cropBox)cropOpen();
      skOvShow(ov,true);
      const grab=cropHit(x,y);
      const b0={x:cropBox.x,y:cropBox.y,w:cropBox.w,h:cropBox.h};
      const sx0=x, sy0=y;
      try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
      const kmove=e2=>{
        const q=at(e2); const dx=q[0]-sx0, dy=q[1]-sy0;
        let X=b0.x, Y=b0.y, W=b0.w, H=b0.h;
        if(grab==="move"){
          X=Math.max(0,Math.min(cv.width-W, b0.x+dx));
          Y=Math.max(0,Math.min(cv.height-H,b0.y+dy));
        }else if(grab){
          if(grab.indexOf("w")>=0){ X=b0.x+dx; W=b0.w-dx; }
          if(grab.indexOf("e")>=0){ W=b0.w+dx; }
          if(grab.indexOf("n")>=0){ Y=b0.y+dy; H=b0.h-dy; }
          if(grab.indexOf("s")>=0){ H=b0.h+dy; }
        }else{
          /* 6m1 — a press on the dimmed part still draws a fresh box, the 6gz way */
          X=Math.min(sx0,q[0]); Y=Math.min(sy0,q[1]);
          W=Math.abs(q[0]-sx0); H=Math.abs(q[1]-sy0);
        }
        if(W<0){ X+=W; W=-W; }
        if(H<0){ Y+=H; H=-H; }
        X=Math.max(0,Math.min(cv.width-1,X));
        Y=Math.max(0,Math.min(cv.height-1,Y));
        W=Math.max(4,Math.min(cv.width-X,W));
        H=Math.max(4,Math.min(cv.height-Y,H));
        cropBox={x:X,y:Y,w:W,h:H};
        cropPaint(); cropSay();
      };
      const kup=()=>{
        cv.removeEventListener("pointermove",kmove);
        cv.removeEventListener("pointerup",kup);
        cv.removeEventListener("pointercancel",kup);
      };
      cv.addEventListener("pointermove",kmove);
      cv.addEventListener("pointerup",kup);
      cv.addEventListener("pointercancel",kup);
      return;
    }
    /* 6la — THE BUCKET. The same flood the wand runs, painted rather than selected. Shift makes it
       a selection instead, so one tool covers "colour this space" and "give me this space". */
    if(tool==="bucket"){
      const run=skWand(g,cv,Math.round(x),Math.round(y),tol,null,"new");
      const n=run?skMaskCount(run):0;
      if(!n){ setStatus("Nothing to fill there — the tolerance may be too tight.",true); return; }
      if(ev.shiftKey){ push(); mask=run; skMaskShow(ov,mask); say();
        setStatus(n.toLocaleString()+" pixels selected — Fill paints behind the drawing, the "+
                  "bucket paints on top."); return; }
      push();
      skMaskPaint(g,cv,run,drawCol);
      picChanged=true;
      setStatus("Filled "+n.toLocaleString()+" pixels with "+drawCol+".");
      return;
    }
    /* 6la — SHAPED SELECT: a rectangle or an ellipse, through the same three chips as the wand. */
    if(tool==="shapesel"){
      const og=ov.getContext("2d");
      let x1=x, y1=y;
      skOvShow(ov,true);
      const paint=()=>{
        og.clearRect(0,0,ov.width,ov.height);
        skMaskShow(ov,mask);                 /* what is already selected, underneath */
        const u=Math.max(1,1/Math.max(0.05,zoom));
        og.save();
        og.strokeStyle="rgba(30,110,255,.95)"; og.lineWidth=u*1.4;
        og.setLineDash([u*6,u*4]);
        const X=Math.min(x,x1), Y=Math.min(y,y1), W=Math.abs(x1-x), H=Math.abs(y1-y);
        og.beginPath();
        if(shapeSelEll)og.ellipse(X+W/2,Y+H/2,Math.max(0.5,W/2),Math.max(0.5,H/2),0,0,Math.PI*2);
        else og.rect(X,Y,W,H);
        og.stroke(); og.restore();
      };
      try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
      const smove=e2=>{ const q=at(e2); x1=q[0]; y1=q[1]; paint(); };
      const sup=e2=>{
        cv.removeEventListener("pointermove",smove);
        cv.removeEventListener("pointerup",sup);
        cv.removeEventListener("pointercancel",sup);
        skOvShow(ov,false);
        if(Math.abs(x1-x)<2||Math.abs(y1-y)<2){ skMaskShow(ov,mask);
          setStatus("Drag a shape over what you want selected.",true); return; }
        const m=(e2&&e2.shiftKey)?"add":((e2&&e2.altKey)?"sub":wandMode);
        const hit=skShapeMask(cv,x,y,x1,y1,shapeSelEll);
        push();
        mask=skMaskCombine(mask,hit,m,cv.width*cv.height);
        skMaskShow(ov,mask); say();
        const n=mask?skMaskCount(mask):0;
        setStatus(n?(n.toLocaleString()+" pixels selected"+
                     (m==="add"?" (added)":(m==="sub"?" (subtracted)":""))+
                     " — Fill, Erase selection, or Invert to take everything else.")
                   :"Nothing selected — you took all of it out.",!n);
      };
      cv.addEventListener("pointermove",smove);
      cv.addEventListener("pointerup",sup);
      cv.addEventListener("pointercancel",sup);
      paint();
      return;
    }
    if(tool==="lasso"){
      /* the loop is collected in the picture's own pixels and drawn live over the selection that is
         already there, so you can see what you are adding to */
      const pts=[[x,y]];
      const og=ov.getContext("2d");
      /* =========================================================================================
         6kw — AND THE OVERLAY HAS TO BE UP FOR ANY OF THAT TO BE SEEN. Ced: "the lasso tool preview
         while making a shape does not show in realtime on the first lasso tool usage."
         `skMaskShow` hides the overlay when there is no mask — 6im, because a transparent canvas the
         size of a 3x capture is a layer the browser composites on every repaint — and `paintPath`
         calls it before drawing the loop. On the FIRST lasso there is no mask yet, so the overlay
         was hidden and the dashed path was drawn onto an invisible canvas; from the second lasso on
         there was a mask, the overlay stayed up, and it worked. The crop box says `skOvShow` for
         exactly this reason (6j2) and the lasso never did. It says it now, and puts it back down on
         release so an empty overlay is still taken out of the picture.
         ========================================================================================= */
      skOvShow(ov,true);
      const paintPath=()=>{
        skMaskShow(ov,mask);
        og.save();
        og.strokeStyle="rgba(30,110,255,.95)";
        og.lineWidth=Math.max(1,1.4/Math.max(0.05,zoom));
        og.setLineDash([Math.max(3,6/Math.max(0.05,zoom)),Math.max(2,4/Math.max(0.05,zoom))]);
        og.beginPath(); og.moveTo(pts[0][0],pts[0][1]);
        for(let i=1;i<pts.length;i++)og.lineTo(pts[i][0],pts[i][1]);
        og.stroke(); og.restore();
      };
      try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
      const lmove=e=>{
        const co=(e.getCoalescedEvents?e.getCoalescedEvents():null);
        const list=(co&&co.length)?co:[e];
        list.forEach(q=>{ const [mx,my]=at(q);
          const p=pts[pts.length-1];
          if(!p||Math.abs(mx-p[0])+Math.abs(my-p[1])>0.8)pts.push([mx,my]); });
        paintPath();
      };
      const lup=e=>{
        cv.removeEventListener("pointermove",lmove);
        cv.removeEventListener("pointerup",lup);
        cv.removeEventListener("pointercancel",lup);
        skOvShow(ov,false);                 /* 6kw — down again; skMaskShow decides from here */
        if(pts.length<3){ skMaskShow(ov,mask);
          setStatus("Draw round something — a lasso needs a loop, not a click.",true); return; }
        const m=(e&&e.shiftKey)?"add":((e&&e.altKey)?"sub":wandMode);
        const hit=skLassoMask(cv,pts);
        if(!hit){ skMaskShow(ov,mask); setStatus("That loop enclosed nothing.",true); return; }
        push();
        mask=skMaskCombine(mask,hit,m,cv.width*cv.height);
        skMaskShow(ov,mask); say();
        const n=mask?skMaskCount(mask):0;
        setStatus(n?(n.toLocaleString()+" pixels selected"+
                     (m==="add"?" (added)":(m==="sub"?" (subtracted)":""))+
                     " — Fill, Erase selection, or Invert to take everything else.")
                   :"Nothing selected — you took all of it out.",!n);
      };
      cv.addEventListener("pointermove",lmove);
      cv.addEventListener("pointerup",lup);
      cv.addEventListener("pointercancel",lup);
      paintPath();
      return;
    }
    if(tool==="wand"){
      push();
      const m=ev.shiftKey?"add":(ev.altKey?"sub":wandMode);
      mask=skWand(g,cv,Math.round(x),Math.round(y),tol,mask,m);
      skMaskShow(ov,mask); say();
      const n=mask?skMaskCount(mask):0;
      setStatus(n?(n.toLocaleString()+" pixels selected"+
                   (m==="add"?" (added)":(m==="sub"?" (subtracted)":""))+
                   " — Invert to take everything else, then Fill.")
                 :"Nothing selected — that region is empty, or you took all of it out.",!n);
      return;
    }
    /* =============================================================================================
       6kq — THE DRAWING TOOLS. One gesture is one history step, so Undo takes back a whole arrow
       rather than the last frame of it, and nothing touches the picture until the hand comes up —
       the preview is drawn on the same overlay the crop box and the lasso use. The pen is the
       exception and has to be: a freehand line that only appeared on release would be drawing blind.
       ============================================================================================= */
    if(isDrawTool(tool)){
      const w=drawPx(), og=ov.getContext("2d");
      if(tool==="pen"){
        push();
        try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
        let p=[x,y];
        const dab=(x0,y0,x1,y1)=>{ g.save();
          g.strokeStyle=drawCol; g.fillStyle=drawCol;
          strokePath(g,x0,y0,x1,y1,w); g.restore(); };
        dab(x,y,x,y); _stroking=true;
        const pmove=e=>{
          const co=(e.getCoalescedEvents?e.getCoalescedEvents():null);
          const list=(co&&co.length)?co:[e];
          list.forEach(q=>{ const [mx,my]=at(q); dab(p[0],p[1],mx,my); p=[mx,my]; });
        };
        const pup=()=>{ _stroking=false; picChanged=true;
          window.removeEventListener("pointermove",pmove);
          window.removeEventListener("pointerup",pup);
          window.removeEventListener("pointercancel",pup);
          setStatus("Drawn into the picture — Undo takes the whole stroke back.");
        };
        window.addEventListener("pointermove",pmove);
        window.addEventListener("pointerup",pup);
        window.addEventListener("pointercancel",pup);
        return;
      }
      /* v62 — LIVE SHAPES. A press on a shape already drawn takes hold of it: its body moves it, an
         end (or a corner) reshapes it. Anywhere else draws a new one. */
      if(tool!=="bucket"){
        const hit=objHit(x,y);
        if(hit){
          objSel=hit.i; drawObjs(); push();
          const o=objs[hit.i], o0=Object.assign({},o);
          try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
          let moved=false;
          const mmove=e=>{ const q=at(e), dx=q[0]-x, dy=q[1]-y;
            if(!moved&&Math.hypot(dx,dy)<1)return; moved=true;
            if(hit.h===0){ o.x0=o0.x0+dx; o.y0=o0.y0+dy; }
            else if(hit.h===1){ o.x1=o0.x1+dx; o.y1=o0.y1+dy; }
            else if(hit.h===2){ o.x1=o0.x1+dx; o.y0=o0.y0+dy; }
            else if(hit.h===3){ o.x0=o0.x0+dx; o.y1=o0.y1+dy; }
            else { o.x0=o0.x0+dx; o.y0=o0.y0+dy; o.x1=o0.x1+dx; o.y1=o0.y1+dy; }
            drawObjs(); };
          const mup=()=>{ window.removeEventListener("pointermove",mmove);
            window.removeEventListener("pointerup",mup); window.removeEventListener("pointercancel",mup);
            if(!moved){ undo.pop(); syncHist(); }
            inkFromObj(o);
            setStatus(moved?"Moved — it stays movable until you Save.":
              "Selected — drag it to move, drag an end to reshape, Delete removes it. Ink, weight and Filled change it.");
          };
          window.addEventListener("pointermove",mmove);
          window.addEventListener("pointerup",mup);
          window.addEventListener("pointercancel",mup);
          return;
        }
        if(objSel>=0){ objSel=-1; drawObjs(); }
      }
      let x1=x, y1=y, shifted=false;
      /* where the gesture actually ends, once Shift has had its say */
      const geom=()=>{
        let ax=x1, ay=y1;
        if(shifted){
          if(tool==="line"||tool==="arrow"){
            const dx=ax-x, dy=ay-y, r=Math.hypot(dx,dy);
            const q=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4);
            ax=x+Math.cos(q)*r; ay=y+Math.sin(q)*r;
          }else{
            const s=Math.max(Math.abs(ax-x),Math.abs(ay-y));
            ax=x+((ax<x)?-s:s); ay=y+((ay<y)?-s:s);
          }
        }
        return [x,y,ax,ay];
      };
      /* ONE painter, used for the preview and for the picture, so what you let go of is what lands */
      const paintInk=ctx=>{ const [x0,y0,X1,Y1]=geom();
        paintObj(ctx,{tool,x0,y0,x1:X1,y1:Y1,col:drawCol,w,fill:drawFill}); };
      skOvShow(ov,true);
      const preview=()=>{ og.clearRect(0,0,ov.width,ov.height); paintInk(og); };
      try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
      const dmove=e=>{ const q=at(e); x1=q[0]; y1=q[1]; shifted=!!e.shiftKey; preview(); };
      const dup=e=>{
        window.removeEventListener("pointermove",dmove);
        window.removeEventListener("pointerup",dup);
        window.removeEventListener("pointercancel",dup);
        if(e&&e.shiftKey!=null)shifted=!!e.shiftKey;
        og.clearRect(0,0,ov.width,ov.height);
        skOvShow(ov,false); skMaskShow(ov,mask);
        const [a0,b0,a1,b1]=geom();
        if(Math.hypot(a1-a0,b1-b0)<Math.max(2,w*0.6)){
          setStatus("Too small to draw — drag it out.",true); return; }
        /* v62 — Ced: "for added lines, shapes in edit photo, make them movable and dont flatten them
           yet unless saved." So it is an object on the layer above the picture, not pixels in it. */
        push();
        objs.push({tool, x0:a0, y0:b0, x1:a1, y1:b1, col:drawCol, w, pt:drawPt, fill:drawFill});
        objSel=objs.length-1; drawObjs(); picChanged=true;
        setStatus((tool==="arrow"?"Arrow":(tool==="line"?"Line":(tool==="rect"?"Box":"Ellipse")))+
                  " drawn at "+drawPt+"pt — drag it to move it, drag an end to reshape it. It becomes "+
                  "part of the picture when you Save.");
      };
      window.addEventListener("pointermove",dmove);
      window.addEventListener("pointerup",dup);
      window.addEventListener("pointercancel",dup);
      preview();
      return;
    }
    push();
    try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
    const paint=(x0,y0,x1,y1)=>{ if(tool==="restore")restoreTo(x0,y0,x1,y1); else rubTo(x0,y0,x1,y1); };
    last=[x,y]; paint(x,y,x,y);
    /* 6io — A STROKE DOES NOT STOP AT THE EDGE OF THE PICTURE. Ced: "do not stop the erasing tool
       even if the cursor is outside the premises of the photo." The brush listened on the CANVAS, so
       sweeping off the edge — which is exactly what you do to clear a margin — ended the stroke there
       and the next sweep back on started a new one, leaving the corner behind. The stroke listens on
       the window instead: the hand can go anywhere, the path keeps its continuity, and the part of it
       that falls outside the picture simply has nothing to rub out. The ring stays lit with it, so it
       still reads as one gesture. */
    _stroking=true; if(ring)ring.classList.add("on");
    const move=e=>{
      const pts=(e.getCoalescedEvents?e.getCoalescedEvents():null);
      const list=(pts&&pts.length)?pts:[e];
      list.forEach(q=>{ const [mx,my]=at(q);
        if(last)paint(last[0],last[1],mx,my); last=[mx,my]; });
      moveRing(e);
    };
    const up=()=>{ last=null; _stroking=false;
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",up);
      window.removeEventListener("pointercancel",up); };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",up);
    window.addEventListener("pointercancel",up);
  }

  const close=()=>{ if(done)return; done=true;
                    try{ skEditRemember(a,undo,redo,cv); }catch(e){}
                    wrap.remove(); SK_ED=null;
                    document.removeEventListener("keydown",keys,true); };
  const mkf=(label,fn,primary)=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sk-edfb"+(primary?" primary":"");
    b.textContent=label; b.onclick=fn; foot.appendChild(b); return b;
  };
  mkf("Cancel",()=>{ close(); });
  mkf("Save",()=>{
    flattenObjs();                     /* v62 — the live shapes go into the picture now, and only now */
    /* 6ha — a picture that does not live on a page goes back to whoever asked for it */
    if(opts.onSave){
      try{ opts.onSave(cv.toDataURL("image/png"),cv); }
      catch(e){ setStatus("Could not save that edit: "+(e&&e.message||e),true); }
      close(); return;
    }
    try{
      pushHistory();
      /* 6jb — the box on the mark is the FRAMED one; the maths below is about the picture, so the
         frame comes off first and is drawn again round whatever is saved. */
      if(a._frPadX&&typeof maPicBox==="function"){
        const B=maPicBox(a);
        a.nx=B.nx; a.ny=B.ny; a.nw=B.nw; a.nh=B.nh;
        a._frPadX=a._frPadY=0;
      }
      a.picRaw=undefined; a._frKey=null;
      a.src=cv.toDataURL("image/png");
      a._tintCol=a.col;                    /* the ink was not recoloured here */
      /* 6gt/6gz — A TURNED OR CROPPED PICTURE IS A DIFFERENT SHAPE ON THE SHEET, and the mark takes
         that shape rather than squashing the new picture into the old box. One rule covers both: the
         picture keeps the SCALE it had — points of paper per pixel of picture — so a quarter turn
         swaps the printed width and height exactly, and a crop shrinks the box by whatever fraction was
         cut away. The box keeps its centre. */
      /* the untouched copy Restore works from was turned and cropped with it, so it is saved that way
         too — else reopening the editor would brush back pixels lying on their side, or the margin
         that was just cut off */
      if(picChanged||cv.width!==pw0||cv.height!==ph0){
        try{ a.srcOrig=orig.toDataURL("image/png"); }catch(e){}
      }
      if(a.nw!=null&&a.nh!=null&&pxW>0&&pxH>0&&(picChanged||cv.width!==pw0||cv.height!==ph0)){
        try{
          const P=(S.pages&&S.pages[a.page])||{};
          const W=P.w1||612, H=P.h1||792;
          const nw=(cv.width*pxW)/W, nh=(cv.height*pxH)/H;
          if(nw>0&&nh>0&&isFinite(nw)&&isFinite(nh)){
            /* 6m0 — plus however far a free turn's trim moved the subject inside the picture, so a
               margin cut off one side does not slide the mark across the sheet */
            const cx=a.nx+a.nw/2+(trimShiftX||0), cy=a.ny+a.nh/2+(trimShiftY||0);
            a.nw=nw; a.nh=nh;
            a.nx=Math.max(0,Math.min(1-nw,cx-nw/2));
            a.ny=Math.max(0,Math.min(1-nh,cy-nh/2));
          }
        }catch(e){}
      }
      layoutAnnos(); updateRail(); autosave();
      setStatus("Picture updated.");
    }catch(e){ setStatus("Could not save that edit: "+(e&&e.message||e),true); }
    close();
  },true);
  wrap.addEventListener("pointerdown",e=>{ if(e.target===wrap)close(); });
  function keys(e){
    if(!SK_ED)return;
    const k=(e.key||"").toLowerCase();
    /* 6m1 — while the crop box is up, Escape puts the BOX away rather than the editor, and Enter
       applies it. Nothing is cut by a key that was meant for the dialog. */
    if(e.key==="Escape"&&cropBox){ e.preventDefault(); e.stopPropagation(); setTool("erase");
      setStatus("Crop cancelled — the picture is as it was."); return; }
    if(e.key==="Enter"&&cropBox){ e.preventDefault(); e.stopPropagation(); cropApply(); return; }
    if(e.key==="Escape"&&objSel>=0){ e.preventDefault(); e.stopPropagation(); objSel=-1; drawObjs(); return; }
    if((e.key==="Delete"||e.key==="Backspace")&&objSel>=0&&!/^(INPUT|TEXTAREA)$/.test((e.target&&e.target.tagName)||"")){
      e.preventDefault(); e.stopPropagation(); push(); objs.splice(objSel,1); objSel=-1; drawObjs();
      setStatus("Removed."); return; }
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if((e.ctrlKey||e.metaKey)&&k==="z"&&!e.shiftKey){ e.preventDefault(); e.stopPropagation(); bUndo.click(); return; }
    if((e.ctrlKey||e.metaKey)&&(k==="y"||(k==="z"&&e.shiftKey))){ e.preventDefault(); e.stopPropagation(); bRedo.click(); return; }
  }
  document.addEventListener("keydown",keys,true);
  /* 6nl — the dock reserves its room BEFORE the first fit, or the picture is fitted to a stage
     that is about to get shorter and ends up hanging past the bottom of it. */
  try{ _fitDock&&_fitDock(); }catch(e){}
  fitZoom(); setTool("erase"); say(); syncHist();
  /* 6gs — and the history this picture already has comes back with it: this session's if the editor
     has been open on it before, otherwise the tail written to the browser last time. */
  (async()=>{
    try{
      const had=await skEditRecall(a,cv);
      if(had&&!done){
        undo.length=0; redo.length=0;
        had.undo.forEach(st=>undo.push(st));
        (had.redo||[]).forEach(st=>redo.push(st));
        syncHist();
        if(undo.length)setStatus("Picture opened with "+undo.length+" step"+
          (undo.length===1?"":"s")+" of its history \u2014 Undo goes back through them.");
      }
    }catch(e){}
  })();
}
/* =================================================================================================
   6gj — SELECTING A REGION, AND FILLING IT UNDER THE INK
   Ced: "my suggestion is for it to have a magic wand tool that will select spaces and then have
   select inverse and then the fill tool will fill the currently selected portion. but take note that
   it must be below the layer of the red parts."

   The wand floods from the pixel clicked over everything LIKE it — clear stays with clear, white with
   white, ink with ink — so clicking a space inside a captured outline selects that space and stops at
   the lines around it. Invert turns "this space" into "everything but this space". The fill then paints
   the selection with `destination-over`, which by definition only reaches pixels that are still
   transparent: the redlines are never painted over, they are painted BEHIND. Their antialiased edges
   composite onto the new ground properly, so a filled capture has no halo around its lines.
   ================================================================================================= */
/* =================================================================================================
   6la — SHAPE ARITHMETIC ON A MASK, AND THE AUTOMATIC PASS BUILT OUT OF IT.

   Ced: "have a automatic mode that will read the photo and will do what it should do. basically it
   will capture the shape and then erase the lines, and the make the fill (much better to select the
   outside shape then inverse then fill) ... this is not ai assisted tool, it should be aware without
   ai."

   His recipe is right and it is the last two thirds of the job. Taken on its own it fails on a real
   capture, and it fails in a way that looks worse than doing nothing: a snapshot of a detail brings
   the drawing's OTHER lines with it — grid lines, leaders, the edge of a neighbouring view — and
   those cross the open space around the subject. Flood the outside and a stray line stops the
   flood; invert and the region beyond that line is "inside"; fill it and a white wedge appears
   across the sheet where there should be nothing.

   So the lines come off first, and the question is how to know which ink is the subject when there
   is no model of what a subject looks like. Measured on Ced's own capture:

       the ink is 18.2% of the frame, in 7 connected pieces
       the largest piece is 98.8% of it

   — the strays TOUCH the subject, so labelling cannot separate them and neither can thickness: a
   mount drawn in 3px strokes is as thin as the lines crossing it.

   What does separate them is DENSITY. A subject is a crowd of strokes within a few pixels of each
   other; a stray line is alone. Dilating by the gap the subject's own strokes sit within merges it
   into one solid blob and leaves a stray line as a band twice that wide plus its own width; eroding
   by a little more than the dilation kills the band and leaves the blob. That is a morphological
   closing used as a crowd detector, and on the capture above it keeps 84% of the ink and throws
   away 5,870 pixels of line.

   What survives is a short stub where a stray crossed into the crowd. Those are walked out
   afterwards: a geodesic dilation from the discarded ink, travelling ONLY through ink that an
   opening of 2px would throw away, so it runs along a hairline until the hairline meets something
   solid and stops there rather than eating the subject's own outlines.

   Then, and only then, Ced's three steps: flood the outside, invert, fill — underneath the ink, so
   the lines still read on top of the new ground.

   Everything here is a Uint8Array of one byte per pixel. The box operations are separable and run as
   a sliding count, so a dilation by 8 on a four-megapixel capture is two passes and no inner loop.
   ================================================================================================= */

/* A square dilation of a mask by `r`, in two separable passes with a sliding count — so growing a
   four-megapixel mask by eight pixels is two passes and no inner loop. */
function skMaskGrow(m,w,h,r){
  if(!(r>0))return Uint8Array.from(m);
  const a=new Uint8Array(w*h), b=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const o=y*w; let cnt=0;
    for(let x=0;x<=r&&x<w;x++)cnt+=m[o+x]?1:0;
    for(let x=0;x<w;x++){
      a[o+x]=cnt>0?1:0;
      const add=x+r+1, rem=x-r;
      if(add<w)cnt+=m[o+add]?1:0;
      if(rem>=0)cnt-=m[o+rem]?1:0;
    }
  }
  for(let x=0;x<w;x++){
    let cnt=0;
    for(let y=0;y<=r&&y<h;y++)cnt+=a[y*w+x]?1:0;
    for(let y=0;y<h;y++){
      b[y*w+x]=cnt>0?1:0;
      const add=y+r+1, rem=y-r;
      if(add<h)cnt+=a[add*w+x]?1:0;
      if(rem>=0)cnt-=a[rem*w+x]?1:0;
    }
  }
  return b;
}

/* =================================================================================================
   6lg — HOW CROWDED IS IT HERE? The mean of a mask over a (2r+1) square around every pixel, as a
   fraction from 0 to 1. Separable and running — two passes of a sliding sum — so the window costs the
   same whatever r is, which matters because r grows with the stroke width. `Float32Array` because the
   answer is a proportion, not a count. The borders divide by the part of the window that is on the
   picture, so an arc running near an edge is not reported as emptier than it is.
   ================================================================================================= */
function skDensity(m,w,h,r){
  const a=new Float32Array(w*h), b=new Float32Array(w*h);
  for(let y=0;y<h;y++){
    const o=y*w; let s=0;
    for(let x=0;x<=r&&x<w;x++)s+=m[o+x]?1:0;
    for(let x=0;x<w;x++){
      const n=Math.min(w-1,x+r)-Math.max(0,x-r)+1;
      a[o+x]=s/n;
      const add=x+r+1, rem=x-r;
      if(add<w)s+=m[o+add]?1:0;
      if(rem>=0)s-=m[o+rem]?1:0;
    }
  }
  for(let x=0;x<w;x++){
    let s=0;
    for(let y=0;y<=r&&y<h;y++)s+=a[y*w+x];
    for(let y=0;y<h;y++){
      const n=Math.min(h-1,y+r)-Math.max(0,y-r)+1;
      b[y*w+x]=s/n;
      const add=y+r+1, rem=y-r;
      if(add<h)s+=a[add*w+x];
      if(rem>=0)s-=a[rem*w+x];
    }
  }
  return b;
}
/* =================================================================================================
   6lg — HOW THICK IS THE LINE HERE? A chamfer distance transform of the ink: two passes, forward and
   back, with the 3-4 weights, divided by 3 at the end. That is within a few per cent of the true
   Euclidean distance to the nearest blank pixel, which at a skeleton pixel is half the stroke's
   width. A few per cent does not matter here because what the rule compares is a RATIO — this arc's
   thickness against the picture's own median — and both ends of it are measured the same way.
   ================================================================================================= */
function skDistIn(m,w,h){
  const BIG=1e9, d=new Float32Array(w*h);
  for(let p=0;p<m.length;p++)d[p]=m[p]?BIG:0;
  const at=(x,y)=>((x<0||y<0||x>=w||y>=h)?0:d[y*w+x]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x; if(!d[p])continue;
    let v=d[p];
    v=Math.min(v, at(x-1,y)+3, at(x,y-1)+3, at(x-1,y-1)+4, at(x+1,y-1)+4);
    d[p]=v;
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const p=y*w+x; if(!d[p])continue;
    let v=d[p];
    v=Math.min(v, at(x+1,y)+3, at(x,y+1)+3, at(x+1,y+1)+4, at(x-1,y+1)+4);
    d[p]=v;
  }
  for(let p=0;p<d.length;p++)d[p]/=3;
  return d;
}
/* =================================================================================================
   6lg — THE SKELETON, BROKEN AT ITS JUNCTIONS. A thinned picture is a graph; cutting out the pixels
   with three or more neighbours leaves its ARCS, each a single run of line between two meetings.
   That is the unit a rule about "a line" has to be written in: a whole stray leader is one arc, and
   so is one member of a mount between the two places it joins something.
   Returns a list of arcs, each an array of pixel indices.
   ================================================================================================= */
function skArcs(sk,w,h){
  const nb=(p)=>{ const x=p%w, y=(p/w)|0; let n=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const X=x+dx, Y=y+dy;
      if(X<0||Y<0||X>=w||Y>=h)continue;
      if(sk[Y*w+X])n++;
    }
    return n; };
  const body=new Uint8Array(w*h);
  for(let p=0;p<sk.length;p++)if(sk[p]&&nb(p)<3)body[p]=1;
  const seen=new Uint8Array(w*h), out=[];
  const stack=[];
  for(let p0=0;p0<body.length;p0++){
    if(!body[p0]||seen[p0])continue;
    const run=[]; stack.length=0; stack.push(p0); seen[p0]=1;
    while(stack.length){
      const p=stack.pop(); run.push(p);
      const x=p%w, y=(p/w)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const X=x+dx, Y=y+dy;
        if(X<0||Y<0||X>=w||Y>=h)continue;
        const q=Y*w+X;
        if(body[q]&&!seen[q]){ seen[q]=1; stack.push(q); }
      }
    }
    out.push(run);
  }
  return out;
}
/* The biggest 8-connected piece of a mask, on its own. A scanline flood, the same shape as the
   wand's, so a four-megapixel capture is one pass and a stack of spans rather than of pixels. */
function skMaskLargest(m,w,h){
  const seen=new Uint8Array(w*h);
  let best=null,bestN=0;
  const stack=[];
  for(let p0=0;p0<m.length;p0++){
    if(!m[p0]||seen[p0])continue;
    const cur=[]; let n=0;
    stack.length=0; stack.push(p0);
    seen[p0]=1;
    while(stack.length){
      const p=stack.pop(); cur.push(p); n++;
      const x=p%w, y=(p/w)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const nx=x+dx, ny=y+dy;
        if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const q=ny*w+nx;
        if(m[q]&&!seen[q]){ seen[q]=1; stack.push(q); }
      }
    }
    if(n>bestN){ bestN=n; best=cur; }
  }
  const out=new Uint8Array(w*h);
  if(best)for(let i=0;i<best.length;i++)out[best[i]]=1;
  return out;
}

/* A mask plus every region of its complement that the border cannot reach — "select the outside,
   then inverse", which is exactly how Ced described the fill. */
function skMaskHoles(m,w,h){
  const seen=new Uint8Array(w*h);
  const stack=[];
  const push=(x,y)=>{ if(x>=0&&x<w&&y>=0&&y<h){ const p=y*w+x; if(!m[p]&&!seen[p]){ seen[p]=1; stack.push(p); } } };
  for(let x=0;x<w;x++){ push(x,0); push(x,h-1); }
  for(let y=0;y<h;y++){ push(0,y); push(w-1,y); }
  while(stack.length){
    const p=stack.pop(), x=p%w, y=(p/w)|0;
    push(x-1,y); push(x+1,y); push(x,y-1); push(x,y+1);
  }
  const out=new Uint8Array(w*h);
  for(let p=0;p<out.length;p++)out[p]=seen[p]?0:1;
  return out;
}

/* =================================================================================================
   6la — THINNING, by Zhang and Suen. Every stroke comes down to a line one pixel wide, with its
   connectivity intact — which is the only reason the next function can talk about "ends" at all.
   Two sub-iterations per round, each marking a whole generation before deleting any of it, because
   deleting as you go would let one deletion change its neighbour's answer and break the stroke.
   ================================================================================================= */
function skThin(src,w,h){
  const m=Uint8Array.from(src);
  const at=(x,y)=>(x<0||y<0||x>=w||y>=h)?0:m[y*w+x];
  const doomed=[];
  for(let pass=0;pass<200;pass++){
    let any=false;
    for(let step=0;step<2;step++){
      doomed.length=0;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        if(!m[y*w+x])continue;
        /* the eight neighbours, clockwise from north — P2..P9 in the paper */
        const p2=at(x,y-1), p3=at(x+1,y-1), p4=at(x+1,y), p5=at(x+1,y+1),
              p6=at(x,y+1), p7=at(x-1,y+1), p8=at(x-1,y), p9=at(x-1,y-1);
        const B=p2+p3+p4+p5+p6+p7+p8+p9;
        if(B<2||B>6)continue;
        const seq=[p2,p3,p4,p5,p6,p7,p8,p9,p2];
        let A=0; for(let i=0;i<8;i++)if(!seq[i]&&seq[i+1])A++;
        if(A!==1)continue;                      /* more than one run: deleting would break it */
        if(step===0){ if(p2*p4*p6||p4*p6*p8)continue; }
        else        { if(p2*p4*p8||p2*p6*p8)continue; }
        doomed.push(y*w+x);
      }
      if(doomed.length){ any=true; for(let i=0;i<doomed.length;i++)m[doomed[i]]=0; }
    }
    if(!any)break;
  }
  return m;
}

/* =================================================================================================
   6la — AND THE WHOLE POINT OF IT. Ced: "i'd suggest you look for the shape by looking at lines that
   does not have an end."

   That is the right test and it is better than the one it replaced. A drawn object is made of closed
   contours — an outline comes back to where it started — while a line arriving from somewhere else
   in the drawing has two ends, or one end and a frame edge, which is the same thing because the
   outside of the picture is empty.

   So: delete every thinned pixel with one neighbour or none, and keep deleting. An open line is
   eaten from its tip inward and disappears entirely; a loop has no pixel with one neighbour and is
   untouched. What is left is the shape.

   Measured on Ced's own capture: 8,120 thinned pixels, of which 6,855 are closed and 1,265 are ends.

   One concession. A SHORT branch is a detail, not an intruder — the tick on a bracket, the stub of a
   bolt — and pruning takes those too. Branches under `minLen` are put back, which on the same
   capture restores 39 of the 50 and leaves the long ones gone.
   ================================================================================================= */
function skPruneEnds(sk,w,h,minLen){
  const m=Uint8Array.from(sk);
  const deg=(x,y)=>{
    let n=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx, ny=y+dy;
      if(nx>=0&&ny>=0&&nx<w&&ny<h&&m[ny*w+nx])n++;
    }
    return n;
  };
  const doomed=[];
  for(let round=0;round<4000;round++){
    doomed.length=0;
    for(let p=0;p<m.length;p++){
      if(!m[p])continue;
      if(deg(p%w,(p/w)|0)<=1)doomed.push(p);
    }
    if(!doomed.length)break;
    for(let i=0;i<doomed.length;i++)m[doomed[i]]=0;
  }
  /* what was taken, and which of it was too short to have been an intruder */
  const spur=new Uint8Array(w*h);
  for(let p=0;p<spur.length;p++)spur[p]=(sk[p]&&!m[p])?1:0;
  if(minLen>0){
    const seen=new Uint8Array(w*h), stack=[];
    for(let p0=0;p0<spur.length;p0++){
      if(!spur[p0]||seen[p0])continue;
      const run=[]; stack.length=0; stack.push(p0); seen[p0]=1;
      while(stack.length){
        const p=stack.pop(); run.push(p);
        const x=p%w, y=(p/w)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;
          const nx=x+dx, ny=y+dy;
          if(nx<0||ny<0||nx>=w||ny>=h)continue;
          const q=ny*w+nx;
          if(spur[q]&&!seen[q]){ seen[q]=1; stack.push(q); }
        }
      }
      if(run.length<minLen)for(let i=0;i<run.length;i++){ m[run[i]]=1; spur[run[i]]=0; }
    }
  }
  return {closed:m, spur};
}

/* Every ink pixel goes to whichever thinned line reaches it first — the one that stayed closed, or
   the one that was pruned away. A plain queue, so "first" means "nearest along the ink". */
function skInfluence(ink,a,b,w,h){
  const own=new Uint8Array(w*h);
  const q=new Int32Array(w*h);
  let head=0, tail=0;
  for(let p=0;p<ink.length;p++){
    if(!ink[p])continue;
    if(a[p]){ own[p]=1; q[tail++]=p; }
    else if(b[p]){ own[p]=2; q[tail++]=p; }
  }
  while(head<tail){
    const p=q[head++], o=own[p], x=p%w, y=(p/w)|0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx, ny=y+dy;
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const r=ny*w+nx;
      if(ink[r]&&!own[r]){ own[r]=o; q[tail++]=r; }
    }
  }
  return own;
}

/* Which pixels of the picture are INK: anything that is not see-through. */
function skInkMask(g,cv,aMin){
  const w=cv.width,h=cv.height;
  const d=g.getImageData(0,0,w,h).data;
  const m=new Uint8Array(w*h), t=(aMin==null?40:aMin);
  for(let p=0;p<m.length;p++)if(d[p*4+3]>t)m[p]=1;
  return m;
}

/* Paint a mask ON TOP, which is what a bucket does — `skMaskFill` paints behind, which is what a
   ground does. Two different jobs and two different composites; keeping one function for both is
   how a fill ends up under the thing it was meant to cover. */
function skMaskPaint(g,cv,mask,hex){
  const w=cv.width,h=cv.height;
  const t=document.createElement("canvas"); t.width=w; t.height=h;
  const tg=t.getContext("2d");
  const im=tg.createImageData(w,h), d=im.data;
  const c=skRgb(hex||"#ffffff");
  for(let p=0;p<mask.length;p++){
    if(!mask[p])continue;
    const k=p*4; d[k]=c[0]; d[k+1]=c[1]; d[k+2]=c[2]; d[k+3]=255;
  }
  tg.putImageData(im,0,0);
  g.drawImage(t,0,0);
  t.width=t.height=0;
}

/* A rectangle or an ellipse, as a mask — the shaped selection Ced asked the wand's chips to take. */
function skShapeMask(cv,x0,y0,x1,y1,ell){
  const w=cv.width,h=cv.height;
  const m=new Uint8Array(w*h);
  const X=Math.max(0,Math.floor(Math.min(x0,x1))), Y=Math.max(0,Math.floor(Math.min(y0,y1)));
  const X1=Math.min(w,Math.ceil(Math.max(x0,x1))),  Y1=Math.min(h,Math.ceil(Math.max(y0,y1)));
  if(X1<=X||Y1<=Y)return m;
  if(!ell){
    for(let y=Y;y<Y1;y++)for(let x=X;x<X1;x++)m[y*w+x]=1;
    return m;
  }
  const cx=(X+X1)/2, cy=(Y+Y1)/2, rx=(X1-X)/2, ry=(Y1-Y)/2;
  for(let y=Y;y<Y1;y++)for(let x=X;x<X1;x++){
    const u=(x+0.5-cx)/rx, v=(y+0.5-cy)/ry;
    if(u*u+v*v<=1)m[y*w+x]=1;
  }
  return m;
}

/* =================================================================================================
   6la — THE AUTOMATIC PASS. Ced: "dont regenerate the selected shape, just remove the outer lines of
   the bigger shape and do the fill."

   Three steps, in his words and his order, and the first one is his idea:

     1. FIND THE SHAPE by the lines that have no end (`skThin` then `skPruneEnds`). What survives is
        the closed contours; every ink pixel then goes to whichever thinned line is nearest, the
        closed one or a pruned one, so the shape is identified in terms of the ORIGINAL pixels.
     2. REMOVE THE OUTER LINES: the silhouette is the shape plus everything the outside cannot reach,
        and ink beyond it goes. Nothing inside is touched.
     3. FILL, behind the ink, so the drawing still reads on top of its new ground.

   Nothing is redrawn. The subject's pixels at the end of this are the same pixels, bit for bit, as
   at the start — measured on Ced's capture, 36,073 of 37,867 kept and 1,794 outer-line pixels taken.

   What it does NOT do is chase a line that enters the shape on one side and leaves on the other.
   Such a line has both ends on the contour, which makes it part of a cycle, which makes it
   indistinguishable from a real member by the only test we have. `Erase line` takes one in a click,
   and that is a better answer than a heuristic that can eat a bracket.
   ================================================================================================= */
/* 6lg — Auto's two thresholds, and both are measurements rather than taste: see `skAutoPass`.
   DENS — above 0.20 the mount's own outer rails started going grey; 0.17 leaves them and takes the
   leaders.  THIN — a leader is the lightest line on the sheet. Measured per arc against the
   picture's median stroke: on Ced's capture the leaders came out at 2.0-2.2 against a median of 4,
   and on the test picture at 2.48 against 4.0, while everything belonging to either subject was at
   the median or above. 0.70 of the median sits in the gap on both. */
const AUTO_LONE_DENS=0.17, AUTO_LONE_THIN=0.70;
/* ====================================================================================================
   6mg — AUTO LOOKS AT A SMALLER COPY, AND IT HAS TO. Ced: "auto mode in edit picture is completely
   broken."

   Every rule in `skAutoPass` is written in units of the picture's own stroke — the comment above says
   so, deliberately, "so the same rule holds on a capture of the same drawing at twice the
   resolution". The work, however, was not: `skThin` and `skPruneEnds` both walk the whole picture
   once per unit of `minLen`, and `minLen` is itself a fraction of the picture, so the cost goes up
   with the CUBE of the capture's size. Nobody noticed because every test picture is 560x760.

   A real snapshot is not. Dragged over the equipment layout of a 45-page mount analysis the capture
   is 1410x1369 — 1,930,290 pixels, two and a half times the test picture — and Auto profiled like
   this, with every function on the path timed:

       skAutoPass    3 calls   8,256 ms
         skPruneEnds 3 calls   5,401 ms      ← 65% of it, 114 passes over 1.9M pixels each
         skThin      3 calls   1,595 ms
         skMaskHoles 6 calls     459 ms
         skDensity   3 calls     224 ms
       the whole press                       11,622 ms, on the one thread, with nothing on screen

   Eleven and a half seconds in which the window does not move and the picture does not change. That
   is indistinguishable from a button that does nothing, which is what it looked like.

   So the ANALYSIS runs on a copy no bigger than this, and the answer is brought back to full size at
   the end. A cell of the small copy is ink if ANY of the pixels under it is: a leader is the thinnest
   thing in the picture and the one the whole method turns on, so it must survive the shrink even at
   the cost of thickening it. Nothing else changes, because nothing else was ever measured in pixels.
   420k is one quarter of this capture and still four times the resolution every threshold was
   measured at. */
const AUTO_MAX_PX=420000;
/* The small copy is generous — a cell is ink if any pixel under it is — so blowing the answer back
   up overshoots the subject by up to `f` pixels all round. `skAutoSolid` trims that off against the
   real ink before anything is erased or filled, which is the same last step the full-size version
   always did. */
function skMaskShrink(m,w,h,f){
  const ws=Math.max(1,Math.ceil(w/f)), hs=Math.max(1,Math.ceil(h/f));
  const o=new Uint8Array(ws*hs);
  for(let y=0;y<h;y++){
    const r=(y/f)|0, row=y*w, orow=r*ws;
    for(let x=0;x<w;x++)if(m[row+x])o[orow+((x/f)|0)]=1;
  }
  return {m:o,w:ws,h:hs};
}
function skMaskBlow(m,ws,hs,f,w,h){
  const o=new Uint8Array(w*h);
  for(let y=0;y<h;y++){
    const srow=(((y/f)|0))*ws, orow=y*w;
    for(let x=0;x<w;x++)if(m[srow+((x/f)|0)])o[orow+x]=1;
  }
  return o;
}
/* 6mg — AND IT NEVER TAKES THE PICTURE AWAY. Measured on a snapshot of a page of text — not what Auto
   is for, but a thing a hand does by accident — the three passes removed 98.7% of the ink and left a
   blank stage. There is no picture for which "almost all of it was stray" is the right answer: it
   means no subject was found, and saying so is more use than an empty canvas and an undo to discover.
   Half is well clear of the worst honest case measured (the mount drawing keeps 80%). */
const AUTO_MIN_KEEP=0.50;
function skAutoSolid(g,cv,minLen,rounds){
  const w=cv.width,h=cv.height;
  const ink0=skInkMask(g,cv,40);
  let total=0; for(let p=0;p<ink0.length;p++)total+=ink0[p];
  if(!total)return null;
  /* =================================================================================================
     AND IT GOES ROUND MORE THAN ONCE, which is what makes it work on a real capture.

     A stray that crosses another stray, or that enters the shape and comes out again, is part of a
     cycle in the thinned picture — both of its ends are attached to something — so the free-end test
     cannot see it on the first look. Take away the part that IS outside the shape and those ends
     come loose, and the next look finds them. Measured on a capture with three lines drawn corner to
     corner through the subject: one pass leaves 576 of 1,061 outside pixels, and each further pass
     takes most of what the one before it freed.

     It stops when a pass finds nothing, so a clean picture costs one pass and nothing else.
     ================================================================================================= */
  /* 6mg — the copy the passes run on. f=1 on anything already small enough, which is every picture
     the suite uses, so their numbers are the numbers they always were. */
  const f=Math.max(1,Math.ceil(Math.sqrt((w*h)/AUTO_MAX_PX)));
  const small=(f>1)?skMaskShrink(ink0,w,h,f):{m:Uint8Array.from(ink0),w:w,h:h};
  const sw=small.w, sh=small.h;
  const ink=small.m;
  let body=null, nClosed=0, nEnds=0, R=1;
  const L=(minLen>0?minLen:Math.max(12,Math.round(Math.min(w,h)/12)))/f;
  const N=Math.max(1,Math.min(6,rounds>0?rounds:3));
  for(let pass=0;pass<N;pass++){
    const got=skAutoPass(ink,sw,sh,Math.max(4,Math.round(L)));
    if(!got)break;
    body=got.solid; nClosed=got.nClosed; nEnds=got.nEnds; R=got.stroke*f;
    let took=0;
    for(let p=0;p<ink.length;p++){
      if(ink[p]&&!got.solid[p]){ ink[p]=0; took++; }
    }
    if(!took)break;
  }
  if(!body)return null;
  /* back to full size, and trimmed against the real ink — which is the same closing step the pass
     itself does, and the reason blowing a coarse answer up does not leave a halo round the subject */
  const bodyUp=(f>1)?skMaskBlow(body,sw,sh,f,w,h):body;
  const solid=skMaskHoles((function(){
    const k=new Uint8Array(w*h);
    for(let p=0;p<ink0.length;p++)k[p]=(ink0[p]&&bodyUp[p])?1:0;
    return k;
  })(),w,h);
  const strayAll=new Uint8Array(w*h);
  let nStray=0, nKeep=0, nFill=0;
  for(let p=0;p<ink0.length;p++){
    if(!ink0[p]){ if(solid[p])nFill++; continue; }
    if(solid[p])nKeep++; else { strayAll[p]=1; nStray++; }
  }
  /* 6mg — a pass that would take most of the picture has not found a subject */
  if(nKeep<total*AUTO_MIN_KEEP)
    return {noSubject:true, nInk:total, keptPct:Math.round(100*nKeep/total)};
  return {stray:strayAll, solid, nStray, nFill, nInk:total, minLen:L*f, stroke:R, nClosed, nEnds};
}

/* One look: find the shape by the lines with no end, and return the region it encloses. */
function skAutoPass(ink,w,h,L){
  let total=0; for(let p=0;p<ink.length;p++)total+=ink[p];
  if(!total)return null;
  let sk=skThin(ink,w,h);
  /* =================================================================================================
     6lg — A LINE WITH NO END, THAT IS STILL NOT PART OF THE SHAPE.
     Ced: "improve the auto mode in edit picture."

     The no-end rule is his and it is right, and this is where it runs out. A leader that crosses the
     subject — in one side and out the other — has both of its ends attached to the contour, so it is
     part of a cycle and the free-end test cannot see it. Worse than that: it makes the contour and
     the leader ONE closed thing, so `skMaskLargest` hands back the leader as part of the shape and
     the region it encloses swells to cover the leader's whole run. Measured on Ced's own capture
     (388x535, 37,867 ink pixels): the largest closed component was 7,504 skeleton pixels of 7,541 —
     effectively the entire picture — and the pass removed 1,148 pixels, 3.0%, while the leaders ran
     visibly across the drawing.

     Three candidate rules were measured on that capture before this one was written:
       · CONTINUITY — is this chord the same line as a stump left outside? It is exact, but it needs
         the outside to have been removed first and here it had not: 2 chords, 195 pixels, 0.5%.
       · THE PICTURE'S EDGE as a line end — a leader runs off the capture, the subject does not.
         No change at all: no skeleton pixel sits on the border row, so nothing seeds.
       · STRAIGHTNESS — a leader is straight. It does not separate: every arc in this drawing is
         0.98-0.99 straight, because a mount is drawn out of straight lines too.

     Two things do separate, and an arc has to fail BOTH before it is dropped.

     WHERE IT IS. A leader crosses empty paper; a member of a mount has the rest of the mount around
     it. Measured per arc, ink within a window of 14px: the long arcs ran 0.075 to 0.149 and
     everything belonging to the mount ran 0.18 to 0.92 — two populations with a clear gap. At 0.20
     and 0.24 the lower assembly's own outer rails went grey, which is the bracket this was warned
     against eating; 0.17 leaves them.

     HOW HEAVY IT IS. Density alone was not enough, and `behave.py` said so before this shipped: on
     its Auto picture — a nest of rectangles with a small bracket floating above it and three lines
     ruled across — the sparse rule took the bracket, because a bracket on its own IS alone. What the
     bracket is not is THIN. A leader is the lightest line on the sheet; the thing it points at is
     drawn heavier. Measured per arc against the picture's own median stroke: Ced's leaders 2.0-2.2
     against a median of 4, the test picture's 2.48 against 4.0, and every part of either subject at
     the median or above. Both pictures have the same gap in the same place, so the test is a ratio
     and not a number of pixels.

     Together: 1,148 pixels removed became 1,557 on Ced's capture, and the test picture's bracket and
     its 12px pipe come through whole. A smaller gain than density alone was reporting — that version
     took 2,394 — and the difference is the part that was eating subjects.

     Both lengths are in units of the stroke the picture is drawn with rather than in pixels, so the
     same rule holds on a capture of the same drawing at twice the resolution.

     It does not get everything, and the picture says which: a leader that STOPS at the subject rather
     than crossing it, and one that runs alongside other ink, are both still there. `Erase line` takes
     either in one click. This is one measured step, not a solution.
     ================================================================================================= */
  {
    let nThin0=0; for(let p=0;p<sk.length;p++)nThin0+=sk[p];
    const R0=Math.max(1,Math.min(24,Math.round(total/Math.max(1,nThin0)/2)+1));
    const rad=Math.max(6,Math.round(R0*4.7));      /* 14px at the stroke this capture is drawn with */
    const minArc=Math.max(16,Math.round(R0*10));   /* 30px there; a leader is many times a stroke */
    const dens=skDensity(ink,w,h,rad);
    const dist=skDistIn(ink,w,h);
    /* the picture's own stroke, as the middle of what its skeleton sits on */
    const th=[];
    for(let p=0;p<sk.length;p++)if(sk[p])th.push(dist[p]*2);
    th.sort((a,b)=>a-b);
    const med=th.length?th[th.length>>1]:0;
    const arcs=skArcs(sk,w,h);
    const lone=new Uint8Array(w*h);
    let nLone=0;
    for(let i=0;i<arcs.length;i++){
      const run=arcs[i];
      if(run.length<minArc)continue;
      let s=0,t=0;
      for(let k=0;k<run.length;k++){ s+=dens[run[k]]; t+=dist[run[k]]*2; }
      if(s/run.length>AUTO_LONE_DENS)continue;
      if(med>0&&t/run.length>med*AUTO_LONE_THIN)continue;
      nLone++;
      for(let k=0;k<run.length;k++)lone[run[k]]=1;
    }
    if(nLone){
      const cut=Uint8Array.from(sk);
      for(let p=0;p<cut.length;p++)if(lone[p])cut[p]=0;
      sk=cut;
    }
  }
  const {closed,spur}=skPruneEnds(sk,w,h,L);
  let nClosed=0; for(let p=0;p<closed.length;p++)nClosed+=closed[p];
  if(!nClosed)return null;                       /* nothing in the picture closes: leave it alone */
  /* the biggest closed thing is the subject; a stray loop somewhere else is not */
  const main=skMaskLargest(closed,w,h);
  /* =================================================================================================
     THE SHAPE IS ITS CONTOUR, FILLED — not everything the contour can be walked to.
     The first attempt asked which thinned line each ink pixel was nearest, the closed one or a
     pruned one, and gave the pixel to the winner. Measured on Ced's capture that handed 36,423 of
     37,867 to the subject: a stray whose thinned line survived — and some do, because where two
     lines cross the thinning leaves a little ladder with no free end on it — drags all of its ink
     in with it, and then nothing is outside the shape and nothing is removed.

     The contour does not need walking to. It is a closed loop, so the region it encloses is simply
     the part of the picture the outside cannot reach, and the strokes that drew it straddle it by
     half their own width. Grown by that much, it covers the subject exactly and reaches nothing
     else. `R` is measured from the picture rather than assumed: the ink divided by the length of
     its own skeleton is the mean stroke width, which on this capture is 4.5 pixels.
     ================================================================================================= */
  let nThin=0; for(let p=0;p<sk.length;p++)nThin+=sk[p];
  const R=Math.max(1,Math.min(24,Math.round(total/Math.max(1,nThin)/2)+1));
  const body=skMaskGrow(skMaskHoles(main,w,h),w,h,R);
  const solid=skMaskHoles((function(){
    const k=new Uint8Array(w*h);
    for(let p=0;p<ink.length;p++)k[p]=(ink[p]&&body[p])?1:0;
    return k;
  })(),w,h);
  return {solid, stroke:R, nClosed,
          nEnds:(function(){ let n=0; for(let p=0;p<spur.length;p++)n+=spur[p]; return n; })()};
}

function skMaskCount(mask){
  if(!mask)return 0;
  let n=0; for(let p=0;p<mask.length;p++)if(mask[p])n++;
  return n;
}
function skMaskInvert(mask,n){
  const out=new Uint8Array(n);
  if(!mask){ out.fill(1); return out; }
  for(let p=0;p<n;p++)out[p]=mask[p]?0:1;
  return out;
}
/* 6gk — Ced: "in magic wand, there should be an option to add or subtract an area of selection."
   The flood is the same either way; what changes is what is done with it. `mode` is "new" (this region
   only), "add" (this region as well) or "sub" (this region taken out of what is selected), with Shift
   and Alt as the shortcuts for the last two. */
function skWand(g,cv,x0,y0,tol,addTo,mode){
  const w=cv.width,h=cv.height;
  if(x0<0||y0<0||x0>=w||y0>=h)return addTo||null;
  const im=g.getImageData(0,0,w,h), d=im.data;
  const k0=(y0*w+x0)*4;
  const sr=d[k0], sg=d[k0+1], sb=d[k0+2], sa=d[k0+3];
  const t=Math.max(0,tol|0);
  /* clear pixels are their own kind: an empty space and a white fill are not the same thing to the
     eye, so they are not the same thing to the wand either */
  const like=(sa<40)
    ? (k=>d[k+3]<40+t*0.5)
    : (k=>{ if(Math.abs(d[k+3]-sa)>Math.max(24,t))return false;
            return Math.abs(d[k]-sr)<=t && Math.abs(d[k+1]-sg)<=t && Math.abs(d[k+2]-sb)<=t; });
  if(!like(k0))return addTo||null;
  const hit=new Uint8Array(w*h);          /* the region this click found, on its own */
  const seen=new Uint8Array(w*h);
  /* a scanline flood: left and right to the walls, then the rows above and below that run */
  const stack=[x0,y0];
  while(stack.length){
    const y=stack.pop(), sx=stack.pop();
    if(y<0||y>=h)continue;
    let x=sx;
    if(seen[y*w+x]||!like((y*w+x)*4))continue;
    while(x>0 && !seen[y*w+x-1] && like((y*w+x-1)*4))x--;
    let spanUp=false, spanDown=false;
    for(;x<w && like((y*w+x)*4);x++){
      const p=y*w+x;
      if(seen[p])continue;
      seen[p]=1; hit[p]=1;
      if(y>0){ const up=like(((y-1)*w+x)*4);
        if(up&&!spanUp&&!seen[(y-1)*w+x]){ stack.push(x,y-1); spanUp=true; }
        else if(!up)spanUp=false; }
      if(y<h-1){ const dn=like(((y+1)*w+x)*4);
        if(dn&&!spanDown&&!seen[(y+1)*w+x]){ stack.push(x,y+1); spanDown=true; }
        else if(!dn)spanDown=false; }
    }
  }
  if(mode!=="add"&&mode!=="sub")return hit;          /* a fresh selection */
  const m=addTo?Uint8Array.from(addTo):new Uint8Array(w*h);
  if(mode==="sub"){ for(let p=0;p<m.length;p++)if(hit[p])m[p]=0; }
  else { for(let p=0;p<m.length;p++)if(hit[p])m[p]=1; }
  return m;
}
/* 6gt — THE LASSO. Ced: "add a lasso effect on edit photo." The wand is the right tool when what you
   want is bounded by the picture's own lines, and the wrong one when it is not — a corner of a
   photograph, a blob of shading, half a detail. The lasso takes whatever you draw round: the path is
   closed on release and everything inside it becomes the selection, through the same New / Add /
   Subtract chips the wand uses, so the two tools build one selection between them. */
function skLassoMask(cv,pts){
  const w=cv.width,h=cv.height;
  if(!pts||pts.length<3)return null;
  const t=document.createElement("canvas"); t.width=w; t.height=h;
  const tg=t.getContext("2d",{willReadFrequently:true});
  tg.fillStyle="#ffffff";
  tg.beginPath(); tg.moveTo(pts[0][0],pts[0][1]);
  for(let i=1;i<pts.length;i++)tg.lineTo(pts[i][0],pts[i][1]);
  tg.closePath(); tg.fill();
  const d=tg.getImageData(0,0,w,h).data;
  const m=new Uint8Array(w*h);
  let n=0;
  for(let p=0,k=3;p<m.length;p++,k+=4)if(d[k]>10){ m[p]=1; n++; }
  t.width=t.height=0;
  return n?m:null;
}
/* one place where two masks meet, whichever tool found the second one */
function skMaskCombine(base,hit,mode,n){
  if(!hit)return base||null;
  if(mode!=="add"&&mode!=="sub")return hit;
  const m=base?Uint8Array.from(base):new Uint8Array(n);
  if(mode==="sub"){ for(let p=0;p<m.length;p++)if(hit[p])m[p]=0; }
  else { for(let p=0;p<m.length;p++)if(hit[p])m[p]=1; }
  return m;
}
/* 6gt — A QUARTER TURN. Ced: "add a rotate tool to rotate the photo itself within the edit photo."
   Lossless: the pixels are redrawn onto a canvas with the sides swapped, so a picture can be turned
   four times and be exactly what it started as. */
/* 6i6 — MIRROR A CANVAS. Ced: "also add flip in edit photo … flip vertical or horizontal." A flip is
   the one transform the editor was missing: a detail lifted off the left of a drawing and laid back
   down on the right has to face the other way, and turning it in quarters cannot get there. */
function skFlipCanvas(src,axis){
  const out=document.createElement("canvas");
  out.width=src.width; out.height=src.height;
  const g=out.getContext("2d");
  g.save();
  if(axis==="h"){ g.translate(src.width,0); g.scale(-1,1); }
  else          { g.translate(0,src.height); g.scale(1,-1); }
  g.drawImage(src,0,0);
  g.restore();
  return out;
}
function skRotCanvas(src,dir){
  const w=src.width,h=src.height;
  const out=document.createElement("canvas");
  out.width=h; out.height=w;
  const g=out.getContext("2d");
  g.save();
  if(dir<0){ g.translate(0,w); g.rotate(-Math.PI/2); }   /* anticlockwise */
  else     { g.translate(h,0); g.rotate(Math.PI/2); }    /* clockwise    */
  g.drawImage(src,0,0);
  g.restore();
  return out;
}
/* 6j2 — hold the overlay up for something that is not a selection (the crop box), and let it go */
function skOvShow(ov,on){ try{ ov._keep=!!on; ov.style.display=on?"block":(ov._maskOn?"block":"none"); }catch(e){} }
function skMaskShow(ov,mask){
  try{ ov._maskOn=!!mask; }catch(e){}
  const g=ov.getContext("2d");
  g.clearRect(0,0,ov.width,ov.height);
  /* 6im — and an empty overlay is TAKEN OUT of the picture rather than left over it. It is the same
     size as the capture — three times the screen's resolution — and a transparent canvas of that size
     is still a layer the browser composites on every single repaint while the brush is moving.
     6j2 — but the overlay is not only the selection: the CROP box is drawn on it too. Hiding it on an
     empty mask hid the crop box with it, which is Ced's "the crop is not showing" — my own
     optimisation, one version later. `skOvShow` is how anything else says it needs the overlay up. */
  try{ if(!ov._keep)ov.style.display=mask?"block":"none"; }catch(e){}
  if(!mask)return;
  const w=ov.width,h=ov.height;
  const im=g.createImageData(w,h), d=im.data;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const p=y*w+x; if(!mask[p])continue;
      const edge=(x===0||y===0||x===w-1||y===h-1||
                  !mask[p-1]||!mask[p+1]||!mask[p-w]||!mask[p+w]);
      const k=p*4;
      if(edge){ d[k]=30; d[k+1]=110; d[k+2]=255; d[k+3]=240; }
      else     { d[k]=40; d[k+1]=130; d[k+2]=255; d[k+3]=64; }
    }
  }
  g.putImageData(im,0,0);
}
/* 6gq — EVERYTHING THE WAND HAS SELECTED, TAKEN OUT. The mask is drawn once onto a canvas of its own
   and composited with `destination-out`, for the same reason the restore brush does it that way: the
   composite modes that reach outside the shape being drawn must be applied in a single operation. */
function skMaskErase(g,cv,mask){
  const w=cv.width,h=cv.height;
  const t=document.createElement("canvas"); t.width=w; t.height=h;
  const tg=t.getContext("2d");
  const im=tg.createImageData(w,h), d=im.data;
  for(let p=0;p<mask.length;p++){
    if(!mask[p])continue;
    const k=p*4; d[k]=0; d[k+1]=0; d[k+2]=0; d[k+3]=255;
  }
  tg.putImageData(im,0,0);
  g.save();
  g.globalCompositeOperation="destination-out";
  g.drawImage(t,0,0);
  g.restore();
  t.width=t.height=0;
}
function skMaskFill(g,cv,mask,hex){
  const w=cv.width,h=cv.height;
  const t=document.createElement("canvas"); t.width=w; t.height=h;
  const tg=t.getContext("2d");
  const im=tg.createImageData(w,h), d=im.data;
  const c=skRgb(hex||"#ffffff");          /* [r,g,b] — the same reader the tint uses */
  for(let p=0;p<mask.length;p++){
    if(!mask[p])continue;
    const k=p*4; d[k]=c[0]; d[k+1]=c[1]; d[k+2]=c[2]; d[k+3]=255;
  }
  tg.putImageData(im,0,0);
  g.save();
  /* the whole point: BEHIND what is already drawn */
  g.globalCompositeOperation="destination-over";
  g.drawImage(t,0,0);
  g.restore();
  t.width=t.height=0;
}

/* ---- ERASER ------------------------------------------------------------------------------------ */
function skHitMark(ev){
  const el=document.elementFromPoint(ev.clientX,ev.clientY);
  if(!el)return null;
  const an=el.closest&&el.closest(".anno");
  if(an)return {kind:"anno",id:+an.dataset.id};
  const lid=el.getAttribute&&el.getAttribute("data-lid");
  if(lid)return {kind:"line",id:+lid};
  return null;
}
function skErase(ev,pg,i){
  let n=0; let touched=false;
  const rub=e=>{
    const hit=skHitMark(e); if(!hit)return;
    if(!touched){ pushHistory(); touched=true; }
    if(hit.kind==="anno"){
      const a=S.annos.find(z=>z.id===hit.id);
      S.annos=S.annos.filter(z=>z.id!==hit.id);
      /* a callout goes whole, the way it does everywhere else */
      if(a&&a.maKind==="callout")S.lines=S.lines.filter(z=>z.coFor!==a.id);
    }else{
      const l=S.lines.find(z=>z.id===hit.id);
      if(l&&l.group!=null)S.lines=S.lines.filter(z=>!(z.group===l.group&&z.maKind===l.maKind));
      else S.lines=S.lines.filter(z=>z.id!==hit.id);
    }
    n++;
    selectAnno(null); selectLine(null); clearMulti();
    layoutAnnos(); drawAllLines(); updateRail(); updateCount();
  };
  rub(ev);
  const move=e=>rub(e);
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up);
    if(n){ autosave(); setStatus(`${n} mark${n===1?"":"s"} rubbed out.`); }
    else setStatus("Eraser — click a mark to rub it out, or drag across several."); };
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}

/* ---- FORMAT PAINTER ---------------------------------------------------------------------------- */
let SK_LOOK=null;
const SK_KEYS_A=["col","colOp","sw","dash","fill","fillOp","bg","bgNone","font","size",
                 "uline","strikeout","align","valign","pat","patCol","patScale","patRot","patOp","hl"];
const SK_KEYS_L=["col","colOp","sw","dash","lpat","le0","le1","hl","fill","fillOp",
                 "pat","patCol","patScale","patRot","patOp"];
function skPaintStart(){
  SK_LOOK=null;
  /* if something is selected when the painter is picked up, that is what it picks up */
  try{
    const sel=maSelectedMarks();
    const o=sel.annos[0]||sel.lines[0];
    if(o)skPaintPick(o,!!sel.annos.length);
  }catch(e){}
  setStatus(SK_LOOK?"Format painter loaded — click a mark to give it this look. Escape puts it down."
                   :"Format painter — click the mark whose look you want, then click the ones to give it to.");
}
function skPaintPick(o,isAnno){
  const look={};
  (isAnno?SK_KEYS_A:SK_KEYS_L).forEach(k=>{ if(o[k]!=null)look[k]=o[k]; });
  if(!isAnno){ const e=endsOf(o); look.le0=e[0]; look.le1=e[1]; }
  SK_LOOK=look;
}
function skPaintOff(quiet){
  if(!SK_LOOK)return;
  SK_LOOK=null;
  if(!quiet)setStatus("Format painter put down.");
}
function skPaintClick(ev,pg,i){
  const hit=skHitMark(ev);
  if(!hit){ setStatus("Click a mark — the painter works on marks, not on the page."); return; }
  const o=(hit.kind==="anno")?S.annos.find(z=>z.id===hit.id):S.lines.find(z=>z.id===hit.id);
  if(!o)return;
  if(!SK_LOOK){
    skPaintPick(o,hit.kind==="anno");
    toast("Look picked up");
    setStatus("Now click the marks to give it to. Escape puts the painter down.");
    return;
  }
  pushHistory();
  const keys=(hit.kind==="anno")?SK_KEYS_A:SK_KEYS_L;
  keys.forEach(k=>{ if(SK_LOOK[k]!=null)o[k]=SK_LOOK[k]; });
  if(hit.kind==="line")try{ syncArrowFlag(o); }catch(e){}
  layoutAnnos(); drawAllLines(); updateRail(); autosave();
  setStatus("Painted. Escape puts the painter down.");
}

/* ---- LASER POINTER -----------------------------------------------------------------------------
   6hx — Ced: "improve laser pointer, it should be more like a continuous flare, not just dots."
   It WAS dots: one element per sample, each fading on its own timer, so a quick sweep left a dotted
   line across the sheet and a slow one left a clot. A laser is a continuous thing — a bright head and
   a streak behind it that fades from the tail.

   So it is drawn, on one full-screen canvas, from a trail of recent positions: a stroke that tapers
   and fades along its length, laid down in a few passes so the core reads white-hot and the outside
   glows. The trail is kept in TIME, not in count, so the streak is the same length at any speed, and
   it fades away on its own the moment the pointer stops. One element, one animation frame, nothing to
   clean up but the canvas.
   ================================================================================================= */
let SK_LASER=null;
const SK_LASER_MS=420;          /* how long a point stays in the streak */
function skLaserOn(){
  if(SK_LASER)return;
  const cv=document.createElement("canvas");
  cv.className="sk-lasercv";
  document.body.appendChild(cv);
  const ctx=cv.getContext("2d");
  const fit=()=>{
    const r=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(innerWidth*r); cv.height=Math.round(innerHeight*r);
    cv.style.width=innerWidth+"px"; cv.style.height=innerHeight+"px";
    ctx.setTransform(r,0,0,r,0,0);
  };
  fit();
  const trail=[];
  let at=null, raf=0;
  const move=e=>{ at=[e.clientX,e.clientY]; trail.push({x:e.clientX,y:e.clientY,t:performance.now()}); };
  const draw=()=>{
    raf=requestAnimationFrame(draw);
    const now=performance.now();
    while(trail.length&&now-trail[0].t>SK_LASER_MS)trail.shift();
    ctx.clearRect(0,0,innerWidth,innerHeight);
    if(trail.length>1){
      /* three passes over the same path: a wide soft glow, a mid body, a hot core. Each segment is
         stroked on its own so the width and the opacity can taper along the streak. */
      const passes=[[13,"rgba(255,45,52,0.16)"],[6,"rgba(255,70,76,0.45)"],[2.2,"rgba(255,225,225,0.95)"]];
      ctx.lineCap="round"; ctx.lineJoin="round";
      passes.forEach(([w,col])=>{
        ctx.strokeStyle=col;
        for(let i=1;i<trail.length;i++){
          const p=trail[i-1], q=trail[i];
          const age=(now-q.t)/SK_LASER_MS;          /* 0 at the head, 1 at the tail */
          const k=Math.max(0,1-age);
          ctx.globalAlpha=k*k;                       /* the tail thins out faster than it dims */
          ctx.lineWidth=Math.max(0.4,w*(0.35+0.65*k));
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke();
        }
      });
      ctx.globalAlpha=1;
    }
    if(at){
      /* the head: a white centre in a red flare */
      const [x,y]=at;
      const g=ctx.createRadialGradient(x,y,0,x,y,16);
      g.addColorStop(0,"rgba(255,255,255,1)");
      g.addColorStop(0.18,"rgba(255,90,95,0.95)");
      g.addColorStop(0.45,"rgba(255,45,52,0.45)");
      g.addColorStop(1,"rgba(255,45,52,0)");
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(x,y,16,0,Math.PI*2); ctx.fill();
    }
  };
  raf=requestAnimationFrame(draw);
  window.addEventListener("pointermove",move,{passive:true});
  window.addEventListener("resize",fit);
  SK_LASER={cv,move,fit,raf};
  document.body.classList.add("laseron");
}
function skLaserOff(){
  if(!SK_LASER)return;
  window.removeEventListener("pointermove",SK_LASER.move);
  window.removeEventListener("resize",SK_LASER.fit);
  cancelAnimationFrame(SK_LASER.raf);
  SK_LASER.cv.remove();
  document.querySelectorAll(".sk-laser,.sk-lasercv").forEach(n=>n.remove());
  SK_LASER=null;
  document.body.classList.remove("laseron");
}

/* 6gf — Ced: "make sure it does not have a border at first." The default is no frame, but a style
   remembered from an earlier version still carried one, so it is cleared once, against a flag of its
   own rather than by bumping the style key and wiping every other tool the user has set up. */
function skFrameMigrate(){
  try{
    /* 6gk — the key is bumped because the first migration wrote the shared `sw`, which anything could
       then overwrite; this one sets the snapshot's OWN frame width, which nothing else touches. */
    if(localStorage.getItem("ma.snapframe.v2"))return;
    localStorage.setItem("ma.snapframe.v2","1");
    if(typeof MA_TOOL_STYLES!=="undefined"&&MA_TOOL_STYLES.snapshot){
      MA_TOOL_STYLES.snapshot.sw=0;
      MA_TOOL_STYLES.snapshot.frameSw=0;
      if(typeof maSaveToolStyles==="function")maSaveToolStyles();
    }
  }catch(e){}
}

/* ---- wiring ------------------------------------------------------------------------------------ */
(function skWire(){
  const boot=()=>{
    skAttachCaret();
    skFrameMigrate();
    /* the kit follows every mode change: the laser goes away, the painter is put down, the button
       shows what is in your hand */
    const base=setMode;
    setMode=function(m){
      if(m!=="laser")skLaserOff();
      if(m!=="painter")skPaintOff(true);
      /* 6i0 — putting a tool down puts the property brush down with it */
      try{ if(typeof sbStopPaint==="function")sbStopPaint(true); }catch(e){}
      base(m);
      skSyncButton();
      /* 6gk — a kit tool picked from its OWN ribbon button says what it does, the same as one picked
         from the menu; Select is left alone so it cannot talk over the message a tool just left. */
      if(m!=="select"&&skIsKit(m)){ try{ skSay(m); }catch(e){} }
      if(m==="laser")skLaserOn();
    };
    skSyncButton();
    /* the shortcuts from the reference menu */
    document.addEventListener("keydown",e=>{
      if(_editTarget&&_editTarget())return;
      const t=e.target;
      if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable))return;
      const k=(e.key||"").toLowerCase();
      /* 6i4 — THE KIT KEEPS TO SHIFT. Ced: "make all the hot keys work too." Ctrl+G was claimed here
         for Snapshot AND in the engine for Group, and both fired: one chord grouped the selection and
         then changed the tool out from under it, so the Ctrl+Shift+G that should have ungrouped it had
         nothing selected to work on. Ctrl+G is Group, which is what every other program means by it and
         what this tool's own button says; Ctrl+L belongs to the browser's address bar. So the whole kit
         sits on Shift, where nothing else is. */
      if(e.ctrlKey||e.metaKey)return;
      if(e.shiftKey){
        /* E is the Text tool's key here, so the eraser takes Shift+E rather than stealing it */
        if(k==="o"){ e.preventDefault(); skPick("lasso"); }
        else if(k==="t"){ e.preventDefault(); skPick("textsel"); }
        else if(k==="e"){ e.preventDefault(); skPick("eraser"); }
        else if(k==="s"){ e.preventDefault(); skPick("snapshot"); }
        else if(k==="l"){ e.preventDefault(); skPick("laser"); }
        else if(k==="f"){ e.preventDefault(); skPick("painter"); }
        return;
      }
      if(k==="v"){ e.preventDefault(); skPick("select"); }
      else if(e.key==="Escape"&&skIsKit()&&S.mode!=="select"){ skPick("select"); }
    });
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
  else boot();
})();
