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

     · THE ORIGINAL (`a.srcOrig`) lives on the mark, so it is saved and reopened with everything else.
       Restore brushes THAT back, not "the picture as it was when this editor opened" — so an edit made
       last week can still be undone by brushing over it.
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
function skEditor(a,opts){
  if(!a||a.kind!=="img"||!a.src){ toast("Select a snapshot first"); return; }
  if(SK_ED)return;
  const wrap=document.createElement("div"); wrap.className="sk-edit";
  const card=document.createElement("div"); card.className="sk-edcard";
  const head=document.createElement("div"); head.className="sk-edhead";
  const ttl=document.createElement("div"); ttl.className="sk-edtitle";
  ttl.textContent=(opts&&opts.title)||"Edit picture";
  const hint=document.createElement("div"); hint.className="sk-edhint";
  /* 6ig/6ip — one line, and it says the two things the buttons do not: Shift-wheel sizes the brush,
     Ctrl-wheel zooms the picture. */
  hint.textContent="Erase and Restore are brushes — hold and sweep. "+
                   "Shift-scroll resizes the brush; Ctrl-scroll zooms.";
  head.appendChild(ttl); head.appendChild(hint);
  /* 6gk — two rows: the tools and the selection on one, the settings and the view on the other, so
     the wand and Invert sit side by side and nothing wraps into a puzzle */
  const bar=document.createElement("div"); bar.className="sk-edbar";
  const bar2=document.createElement("div"); bar2.className="sk-edbar sk-edbar2";
  const stage=document.createElement("div"); stage.className="sk-edstage";
  const box=document.createElement("div"); box.className="sk-edwrap";
  const cv=document.createElement("canvas"); cv.className="sk-edcanvas";
  const ov=document.createElement("canvas"); ov.className="sk-edov";
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
  box.appendChild(cv); box.appendChild(ov); box.appendChild(ring); stage.appendChild(box);
  const foot=document.createElement("div"); foot.className="sk-edfoot";
  card.appendChild(head); card.appendChild(bar); card.appendChild(bar2);
  card.appendChild(stage); card.appendChild(foot);
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
  opts=opts||{};
  let tool="erase", brush=18, tol=40, fillCol="#ffffff", done=false;
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
                   mask:mask?Uint8Array.from(mask):null});
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
    skMaskShow(ov,mask); say(); };
  const push=()=>{ try{ undo.push(shot()); while(undo.length>HIST_MAX)undo.shift();
                         redo.length=0; syncHist(); }catch(e){} };
  const pushGeo=()=>{ try{ undo.push(geoShot()); while(undo.length>HIST_MAX)undo.shift();
                           redo.length=0; syncHist(); }catch(e){} };
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
  const mkb=(where,label,glyph,fn,on,title)=>{
    const b=document.createElement("button");
    b.type="button"; b.className="sk-edb"+(on?" on":"");
    if(title)b.title=title;
    const gl=document.createElement("span"); gl.className="sk-edg"; gl.textContent=glyph;
    const tx=document.createElement("span"); tx.textContent=label;
    b.appendChild(gl); b.appendChild(tx);
    b.onclick=fn; where.appendChild(b); return b;
  };
  const group=where=>{ const d=document.createElement("div"); d.className="sk-edgrp";
                       where.appendChild(d); return d; };

  /* ---- row one: the brushes, then the selection, then the fill ---- */
  const gTools=group(bar), gSel=group(bar), gFill=group(bar);
  let bErase,bRestore,bWipe,bWand,bLasso,bCrop,bInv,bClr,bFill,bErase2,bUndo,bRedo,countTag,zoomTag;
  const say=()=>{
    const n=mask?skMaskCount(mask):0;
    if(countTag)countTag.textContent=n?(n.toLocaleString()+" px selected"):"nothing selected";
    if(bFill)bFill.disabled=!n;
    if(bErase2)bErase2.disabled=!n;
    if(bClr)bClr.disabled=!mask;
  };
  const syncHist=()=>{ if(bUndo)bUndo.disabled=!undo.length; if(bRedo)bRedo.disabled=!redo.length; };
  const setTool=t=>{ tool=t;
    try{ dropBox(); }catch(e){}          /* 6ha — the rows below change height; the picture moves */
    const brushy=(t==="erase"||t==="restore");
    bErase.classList.toggle("on",t==="erase");
    bRestore.classList.toggle("on",t==="restore");
    bWipe.classList.toggle("on",t==="wipe");
    bWand.classList.toggle("on",t==="wand");
    bLasso.classList.toggle("on",t==="lasso");
    if(bCrop)bCrop.classList.toggle("on",t==="crop");
    brushRow.style.display=brushy?"":"none";
    tolRow.style.display=(t==="wand"||t==="wipe")?"":"none";   /* the wand and the line eraser share it */
    /* 6gt — New / Add / Subtract belong to the SELECTION, not to the wand: the lasso builds the same
       mask through the same three chips. */
    modeRow.style.display=(t==="wand"||t==="lasso")?"":"none";
    /* the ring IS the cursor for a brush, so the arrow gets out of its way */
    /* 6gr — Ced: "do not hide the cursor in the ui." The ring says how big the brush is; the pointer
       says exactly where its centre is, and taking the pointer away made a careful rub-out guesswork. */
    cv.style.cursor="crosshair";
    if(ring){ ring.hidden=!brushy; ring.classList.toggle("restore",t==="restore"); }
    sizeRing(); };
  bErase  =mkb(gTools,"Erase","◧",()=>setTool("erase"),true,
               "Rub the picture out — hold and sweep");
  /* 6gk — Ced: "the erase should have a restore counterpart." It paints back the picture as it came
     in, from a copy kept aside when the editor opened, so an over-eager sweep is mended by brushing
     over it rather than undone wholesale. */
  bRestore=mkb(gTools,"Restore","↺",()=>setTool("restore"),false,
               "Brush the original picture back where you erased it");
  /* 6gs — Ced: "add a feature in edit photo where it recognizes the ends of lines in erase function so
     the erasing is easier." A brush has to be traced along a line and stops wherever the hand stops;
     what you actually mean is "this line, all of it". Click one and the connected run of ink is taken,
     end to end — the ends are where the ink stops, which is exactly what the flood finds. */
  bWipe   =mkb(gTools,"Erase line","✂",()=>setTool("wipe"),false,
               "Click a line and the whole run goes, end to end — Shift selects it instead");
  /* 6j3 — RESTORE ALL. Ced: "add restore button on edit photo." Restore beside it is a BRUSH — you
     paint the original back where you rubbed too far — and there was no way to say "put all of it
     back" short of undoing one step at a time. This is that button: the picture as it came in, in one
     press, and it is one undo step like anything else. */
  mkb(gTools,"Restore all","↺↺",()=>{
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
  },false,"Put the whole picture back as it came in — one step, and undoable");
  bWand   =mkb(gSel,"Magic wand","✦",()=>setTool("wand"),false,
               "Click a space to select it — Shift adds another");
  /* 6gt — Ced: "add a lasso effect on edit photo." For everything the wand cannot reach: draw round
     it by hand and what you drew round is selected, through the same three chips. */
  bLasso  =mkb(gSel,"Lasso","◌",()=>setTool("lasso"),false,
               "Draw round a region by hand — Shift adds it, Alt takes it out");
  bInv    =mkb(gSel,"Select inverse","⧉",()=>{
    push();
    mask=skMaskInvert(mask,cv.width*cv.height);
    skMaskShow(ov,mask); say();
    setStatus("Selection inverted.");
  },false,"Swap the selection for everything else");
  bClr    =mkb(gSel,"Deselect","✕",()=>{ push(); mask=null; skMaskShow(ov,null); say(); },false,
               "Drop the selection");
  bFill   =mkb(gFill,"Fill selection","■",()=>{
    if(!mask||!skMaskCount(mask)){ setStatus("Pick a region with the wand first.",true); return; }
    push();
    skMaskFill(g,cv,mask,fillCol);
    setStatus("Filled — under the redlines, so the drawing still reads on top of it.");
  },false,"Paint the selection, underneath everything already drawn");
  /* 6gq — Ced: "add an erase selected feature in edit photos to erase the selected area by magic wand
     tool." The fill's opposite: everything selected is taken out, ink and ground alike. Wand the thing
     you do not want — or wand what you DO want and invert — and it is gone in one press. */
  bErase2=mkb(gFill,"Erase selection","\u2327",()=>{
    if(!mask||!skMaskCount(mask)){ setStatus("Pick a region with the wand first.",true); return; }
    push();
    skMaskErase(g,cv,mask);
    setStatus("Erased everything in the selection.");
  },false,"Rub out everything the wand has selected");
  const col=document.createElement("input");
  col.type="color"; col.value=fillCol; col.className="sk-edcol";
  col.title="What the fill paints — white by default, so a captured drawing reads over the sheet";
  col.oninput=()=>{ fillCol=col.value; };
  gFill.appendChild(col);

  /* ---- row two: the brush or the tolerance, the view, and the history ---- */
  const gSet=group(bar2), gView=group(bar2), gHist=group(bar2);
  const brushRow=document.createElement("label"); brushRow.className="sk-edsize";
  brushRow.appendChild(document.createTextNode("Brush"));
  const rng=document.createElement("input");
  rng.type="range"; rng.min="2"; rng.max="120"; rng.step="1"; rng.value=String(brush);
  const num=document.createElement("span"); num.className="sk-ednum"; num.textContent=brush+"px";
  rng.oninput=()=>{ brush=+rng.value; num.textContent=brush+"px"; sizeRing(); };
  brushRow.appendChild(rng); brushRow.appendChild(num); gSet.appendChild(brushRow);
  const tolRow=document.createElement("label"); tolRow.className="sk-edsize";
  tolRow.appendChild(document.createTextNode("Tolerance"));
  const trng=document.createElement("input");
  trng.type="range"; trng.min="0"; trng.max="160"; trng.step="1"; trng.value=String(tol);
  const tnum=document.createElement("span"); tnum.className="sk-ednum"; tnum.textContent=String(tol);
  trng.oninput=()=>{ tol=+trng.value; tnum.textContent=String(tol); };
  tolRow.appendChild(trng); tolRow.appendChild(tnum); gSet.appendChild(tolRow);
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
  gSet.appendChild(modeRow);

  /* 6gk — AND IT ZOOMS. A capture is several times the resolution of the screen now, so the editor
     has to be able to get close enough to rub out one line of it. Fit, −, +, and ctrl-wheel; the
     stage scrolls when the picture is bigger than it. */
  let zoom=1, fit=1;
  const applyZoom=()=>{
    const W=Math.max(1,Math.round(cv.width*zoom)), H=Math.max(1,Math.round(cv.height*zoom));
    cv.style.width=ov.style.width=W+"px";
    cv.style.height=ov.style.height=H+"px";
    box.style.width=W+"px"; box.style.height=H+"px";
    if(zoomTag)zoomTag.textContent=Math.round(zoom*100)+"%";
    try{ sizeRing(); }catch(e){}
  };
  const setZoom=z=>{ zoom=Math.max(0.05,Math.min(8,z)); applyZoom(); dropBox(); };
  /* 6gr — measured off the STAGE, which is now a fixed box: the fit is the fit in the room there is,
     and zooming afterwards never changes that room. */
  const fitZoom=()=>{
    const r=stage.getBoundingClientRect();
    const availW=Math.max(160,(r.width||900)-26);
    const availH=Math.max(160,(r.height||520)-26);
    fit=Math.min(availW/cv.width,availH/cv.height);
    setZoom(Math.min(1,fit));
  };
  mkb(gView,"","−",()=>setZoom(zoom/1.25),false,"Zoom out");
  zoomTag=document.createElement("span"); zoomTag.className="sk-ednum sk-edzoom";
  gView.appendChild(zoomTag);
  mkb(gView,"","＋",()=>setZoom(zoom*1.25),false,"Zoom in");
  mkb(gView,"Fit","⤢",()=>fitZoom(),false,"Fit the picture in the window");
  mkb(gView,"1:1","▣",()=>setZoom(1),false,"Every pixel of the capture, one for one");
  /* 6gt — AND THE PICTURE TURNS. Ced: "add a rotate tool to rotate the photo itself within the edit
     photo." A quarter at a time, losslessly — the pixels are redrawn with the sides swapped rather
     than resampled, so four turns are exactly what you started with. It is an editing step like any
     other: Undo puts it back, and the mark on the sheet takes the new proportions when you save. */
  const gTurn=group(bar2);
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
  mkb(gTurn,"Rotate left","⟲",()=>turnPic(-1),false,"Turn the picture a quarter anticlockwise");
  mkb(gTurn,"Rotate right","⟳",()=>turnPic(1),false,"Turn the picture a quarter clockwise");
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
  mkb(gTurn,"Flip across","⇋",()=>flipPic("h"),false,"Mirror the picture left to right");
  mkb(gTurn,"Flip down","⇵",()=>flipPic("v"),false,"Mirror the picture top to bottom");
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
  /* 6ha — FREE ROTATION. Ced: "rotate should also has free rotate option." A quarter turn is the one
     you want for a picture taken sideways; a detail lifted off a drawing is almost never out by exactly
     ninety degrees. The slider previews with a CSS transform — no pixels are touched while you sweep it
     — and commits ONE resample when you let go, from the pixels as they were, so sweeping back and
     forth costs nothing in quality. The canvas grows to hold the corners, and the mark on the sheet
     grows with it, because a pixel is still worth the same amount of paper. */
  const freeRow=document.createElement("label"); freeRow.className="sk-edsize sk-edfree";
  freeRow.appendChild(document.createTextNode("Free"));
  const frng=document.createElement("input");
  /* 6iq — A CALMER SLIDER. Ced: "make the rotate slider just be less dramatic." Across the whole 360°
     a pixel of travel was about a degree and a half, so the one thing the free turn is for — taking a
     degree or two of skew out of a photograph — was the one thing it could not do. It covers ±30° in
     quarter-degree steps now, which is the range a hand-held picture actually needs; the four quarter
     turns beside it are how you go further, and the grip on the picture itself turns freely. */
  frng.type="range"; frng.min="-30"; frng.max="30"; frng.step="0.25"; frng.value="0";
  frng.title="Straighten the picture — ±30°, a quarter of a degree at a time. Let go to apply. "+
             "For more, use the quarter turns, or drag the ↻ grip on the picture itself";
  const fnum=document.createElement("span"); fnum.className="sk-ednum"; fnum.textContent="0°";
  const fmtDeg=d=>((Math.round(d*100)/100)+"°");
  const preview=deg=>{ box.style.transform=deg?("rotate("+deg+"deg)"):""; fnum.textContent=fmtDeg(deg); };
  const turnFree=deg=>{
    deg=((+deg%360)+360)%360;
    if(!deg)return;
    const rad=deg*Math.PI/180;
    const w0=cv.width, h0=cv.height;
    const nw=Math.max(1,Math.ceil(Math.abs(w0*Math.cos(rad))+Math.abs(h0*Math.sin(rad))));
    const nh=Math.max(1,Math.ceil(Math.abs(w0*Math.sin(rad))+Math.abs(h0*Math.cos(rad))));
    const spin=src=>{ const t=document.createElement("canvas"); t.width=nw; t.height=nh;
      const tg=t.getContext("2d");
      tg.translate(nw/2,nh/2); tg.rotate(rad); tg.drawImage(src,-src.width/2,-src.height/2);
      return t; };
    pushGeo();
    const pic=spin(cv), og=orig?spin(orig):null;
    cv.width=ov.width=nw; cv.height=ov.height=nh;
    g.clearRect(0,0,nw,nh); g.drawImage(pic,0,0); pic.width=pic.height=0;
    if(og&&orig){ orig.width=nw; orig.height=nh;
      const oc=orig.getContext("2d"); oc.clearRect(0,0,nw,nh); oc.drawImage(og,0,0);
      og.width=og.height=0; }
    mask=null; skMaskShow(ov,mask); say();
    picChanged=true;
    applyZoom(); dropBox();
    setStatus("Turned "+Math.round(deg)+"° — the mark takes the new shape when you save.");
  };
  frng.addEventListener("input",()=>preview(+frng.value));
  const commitFree=()=>{ const deg=+frng.value; frng.value="0"; preview(0); if(deg)turnFree(deg); };
  ["change","pointerup","pointercancel"].forEach(ev=>
    frng.addEventListener(ev,()=>{ setTimeout(commitFree,0); }));
  freeRow.appendChild(frng); freeRow.appendChild(fnum);
  gTurn.appendChild(freeRow);
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
  /* 6j4 — A BORDER ON THE PICTURE. Ced: "in edit photos, add a border increase to make the photo
     pop." This is the MARK's own frame, not pixels painted into the picture — so it stays crisp at any
     zoom, exports as a frame rather than as a smudge of ink, and can be taken off again by dragging it
     back to none. The stage shows it live in the picture's own colour. */
  {
    const row=document.createElement("label"); row.className="sk-edsize sk-edborder";
    row.appendChild(document.createTextNode("Border"));
    const brng=document.createElement("input");
    brng.type="range"; brng.min="0"; brng.max="12"; brng.step="0.5";
    brng.value=String((a&&a.sw!=null)?a.sw:0);
    brng.title="A frame round the picture, in points — 0 for none";
    const bnum=document.createElement("span"); bnum.className="sk-ednum";
    const paintBorder=()=>{
      const v=+brng.value;
      bnum.textContent=v?(v+"pt"):"none";
      try{
        box.style.setProperty("--sk-bord",(v*Math.max(0.4,zoom))+"px");
        box.classList.toggle("bordered",v>0);
        box.style.setProperty("--sk-bordcol",(a&&a.col)||"#fa3237");
      }catch(e){}
    };
    brng.oninput=()=>{ if(a)a.sw=+brng.value; paintBorder(); picChanged=true; };
    brng.onchange=()=>{ try{ layoutAnnos(); autosave(); }catch(e){} };
    paintBorder();
    row.appendChild(brng); row.appendChild(bnum); gTurn.appendChild(row);
  }
  bCrop=mkb(gTurn,"Crop","◱",()=>{ setTool("crop");
    setStatus("Drag a box round what you want to keep — everything outside it goes.");
  },false,"Drag a box round what to keep; everything outside it is cut away");
  /* 6gl — the wheel belongs to the editor while the editor is open: ctrl-wheel zooms the PICTURE, and
     a plain wheel outside the scrolling stage is swallowed rather than scrolling the sheet behind. */
  /* 6ip — SHIFT-WHEEL IS THE BRUSH. Ced: "shift scroll up or down makes the brushes bigger or
     smaller." It is the size you change most and the one control you should never have to go up to the
     bar for, so it rides the wheel under the hand: Shift for the brush, Ctrl for the zoom. The step is
     proportional, so it is fine at 4px and still quick at 90. */
  const bumpBrush=dir=>{
    const step=Math.max(1,Math.round(brush*0.16));
    const v=Math.max(+rng.min,Math.min(+rng.max,brush+dir*step));
    if(v===brush)return;
    brush=v; rng.value=String(v); num.textContent=v+"px"; sizeRing();
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
      setZoom(zoom*(e.deltaY<0?1.12:1/1.12));
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
  },false,"Undo the last change to the picture (Ctrl+Z)");
  bRedo=mkb(gHist,"Redo","↷",()=>{
    const st=redo.pop(); if(!st)return;
    undo.push(shotFor(st)); put(st); syncHist();
  },false,"Redo (Ctrl+Y)");
  countTag=document.createElement("span"); countTag.className="sk-edcount";
  gHist.appendChild(countTag);

  /* ---- the brush ring ----
     6gq — it is the size the brush ACTUALLY is on screen: the brush is measured in the picture's own
     pixels and the picture is shown at whatever zoom, so the ring is brush × zoom. */
  function sizeRing(){
    if(!ring)return;
    const d=Math.max(4,brush*zoom);
    ring.style.width=d+"px"; ring.style.height=d+"px";
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
    const r=boxNow();
    _ringAt=[ev.clientX-r.left, ev.clientY-r.top];
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
  const strokePath=(ctx,x0,y0,x1,y1,w)=>{
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
      /* the box is drawn on the overlay while it is dragged, with the part that will be cut away
         dimmed, so what you are keeping is what you can see */
      const og=ov.getContext("2d");
      skOvShow(ov,true);                 /* 6j2 — the box is drawn on the overlay; keep it up */
      let x1=x, y1=y;
      /* 6j2 — and DRAWN SO IT READS. Ced: "the identifiers is not showing well." One hairline dashed
         rectangle at three times the screen's resolution is a faint grey thread; the marks that say
         what is happening — the corners you are dragging between, and the thirds you line a detail up
         on — were not there at all. The box now carries a dark rule under a white dash, a solid corner
         bracket at each end, and a rule of thirds, every one of them scaled so it is the same weight on
         screen whatever the picture's resolution or the zoom. */
      const paintBox=()=>{
        og.clearRect(0,0,ov.width,ov.height);
        const X=Math.min(x,x1), Y=Math.min(y,y1), W=Math.abs(x1-x), H=Math.abs(y1-y);
        const u=Math.max(1,1/Math.max(0.05,zoom));        /* one screen pixel, in picture pixels */
        og.save();
        og.fillStyle="rgba(8,14,26,.55)";
        og.fillRect(0,0,ov.width,ov.height);
        og.clearRect(X,Y,W,H);
        if(W>2&&H>2){
          /* the thirds, faint, inside the kept region */
          og.strokeStyle="rgba(255,255,255,.35)"; og.lineWidth=u; og.setLineDash([]);
          og.beginPath();
          for(let i=1;i<3;i++){
            og.moveTo(X+W*i/3,Y); og.lineTo(X+W*i/3,Y+H);
            og.moveTo(X,Y+H*i/3); og.lineTo(X+W,Y+H*i/3);
          }
          og.stroke();
        }
        /* the edge: a dark rule with a white dash over it, so it reads on any picture */
        og.setLineDash([]); og.lineWidth=u*3; og.strokeStyle="rgba(8,14,26,.85)";
        og.strokeRect(X,Y,W,H);
        og.lineWidth=u; og.strokeStyle="#ffffff";
        og.setLineDash([u*6,u*4]); og.strokeRect(X,Y,W,H);
        /* solid corner brackets — the identifiers */
        og.setLineDash([]); og.lineWidth=u*3; og.strokeStyle="#4da3ff";
        const c=Math.max(u*8,Math.min(W,H)*0.18);
        og.beginPath();
        og.moveTo(X,Y+c); og.lineTo(X,Y); og.lineTo(X+c,Y);
        og.moveTo(X+W-c,Y); og.lineTo(X+W,Y); og.lineTo(X+W,Y+c);
        og.moveTo(X+W,Y+H-c); og.lineTo(X+W,Y+H); og.lineTo(X+W-c,Y+H);
        og.moveTo(X+c,Y+H); og.lineTo(X,Y+H); og.lineTo(X,Y+H-c);
        og.stroke();
        og.restore();
      };
      try{ cv.setPointerCapture(ev.pointerId); }catch(e){}
      const cmove=e2=>{ const q=at(e2); x1=q[0]; y1=q[1]; paintBox(); };
      const cup=()=>{
        cv.removeEventListener("pointermove",cmove);
        cv.removeEventListener("pointerup",cup);
        cv.removeEventListener("pointercancel",cup);
        skOvShow(ov,false);
        cropTo(x,y,x1,y1);
      };
      cv.addEventListener("pointermove",cmove);
      cv.addEventListener("pointerup",cup);
      cv.addEventListener("pointercancel",cup);
      paintBox();
      return;
    }
    if(tool==="lasso"){
      /* the loop is collected in the picture's own pixels and drawn live over the selection that is
         already there, so you can see what you are adding to */
      const pts=[[x,y]];
      const og=ov.getContext("2d");
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
            const cx=a.nx+a.nw/2, cy=a.ny+a.nh/2;
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
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if((e.ctrlKey||e.metaKey)&&k==="z"&&!e.shiftKey){ e.preventDefault(); e.stopPropagation(); bUndo.click(); return; }
    if((e.ctrlKey||e.metaKey)&&(k==="y"||(k==="z"&&e.shiftKey))){ e.preventDefault(); e.stopPropagation(); bRedo.click(); return; }
  }
  document.addEventListener("keydown",keys,true);
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
