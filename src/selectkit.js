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
  /* 6kq — and the drawing tools get their one line too: that they go INTO the picture. */
  hint.textContent="Erase and Restore are brushes — hold and sweep. Pen, Line, Arrow, Box and "+
                   "Ellipse draw into the picture itself, in the ink and weight set below; Shift "+
                   "holds a line to 45° and a box to a square. "+
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
    /* 6lf — a glyph may be DRAWN rather than typed. Ced sent a picture of the bucket he wanted for
       Fill, and an emoji is not a thing you can match to a picture: it is whatever face the machine
       happens to have, in whatever colour that face was designed in, and on this bar it came out as a
       cartoon in someone else's palette beside six monochrome marks. An inline SVG takes the button's
       own `currentColor`, so it goes white on the dark chip and white-on-blue when the tool is on,
       exactly like the glyphs either side of it. Anything that is not markup is still text. */
    const gl=document.createElement("span"); gl.className="sk-edg";
    if(/^\s*<svg\b/i.test(String(glyph||"")))gl.innerHTML=glyph; else gl.textContent=glyph;
    const tx=document.createElement("span"); tx.textContent=label;
    b.appendChild(gl); b.appendChild(tx);
    b.onclick=fn; where.appendChild(b); return b;
  };
  const group=where=>{ const d=document.createElement("div"); d.className="sk-edgrp";
                       where.appendChild(d); return d; };

  /* ---- row one: the brushes, then the selection, then the fill ---- */
  const gTools=group(bar), gDraw=group(bar), gSel=group(bar), gFill=group(bar);
  let bErase,bRestore,bWipe,bWand,bLasso,bCrop,bInv,bClr,bFill,bErase2,bUndo,bRedo,countTag,zoomTag;
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
  /* 6kq — THE FIVE THINGS YOU CAN ADD. The glyphs match the ribbon's own tools so the hand already
     knows them, and each one is the gesture it looks like: pen is freehand, the other four are drawn
     from one corner to the other. Shift constrains — a line to the nearest 45°, a box to a square, an
     ellipse to a circle. */
  drawBtns.pen    =mkb(gDraw,"Pen","✎",()=>setTool("pen"),false,
                       "Draw freehand into the picture");
  drawBtns.line   =mkb(gDraw,"Line","╱",()=>setTool("line"),false,
                       "Drag a straight line — Shift holds it to 45°");
  drawBtns.arrow  =mkb(gDraw,"Arrow","↗",()=>setTool("arrow"),false,
                       "Drag an arrow — the head lands where you let go");
  drawBtns.rect   =mkb(gDraw,"Box","▭",()=>setTool("rect"),false,
                       "Drag a box — Shift makes it square");
  drawBtns.ellipse=mkb(gDraw,"Ellipse","◯",()=>setTool("ellipse"),false,
                       "Drag an ellipse — Shift makes it a circle");
  /* 6la — THE BUCKET. Ced: "add fill option (like bucket)". `Fill selection` paints what the wand
     has already chosen, behind the ink, which is the job for putting a ground under a capture. A
     bucket is the other job: click a space and that space takes the colour, on top, with no
     selection step in between. Same flood as the wand, same tolerance slider, different composite. */
  /* 6lf — Ced: "in edit photo tab, make the fill icon like this", with a picture of a black bucket:
     tall arching handle with a grip at its top, a rim bar across, a tapered body and a bar under the
     base. Traced in the picture's own proportions (it was 358x404, which is the viewBox) so the shape
     is his and not an approximation of it, and drawn in `currentColor` so it is the same ink as every
     other glyph on the bar. */
  const BUCKET_SVG=
    '<svg viewBox="0 0 358 404" fill="currentColor" aria-hidden="true" focusable="false">'+
      '<path d="M75 150 A104 104 0 0 1 283 150" fill="none" stroke="currentColor" stroke-width="17" '+
        'stroke-linecap="round"/>'+
      '<rect x="137" y="13" width="84" height="45" rx="22"/>'+
      '<rect x="57" y="136" width="244" height="23" rx="11"/>'+
      '<path d="M70 169 L288 169 L252 364 L106 364 Z"/>'+
      '<rect x="93" y="373" width="172" height="23" rx="11"/>'+
    '</svg>';
  drawBtns.bucket=mkb(gDraw,"Fill",BUCKET_SVG,()=>setTool("bucket"),false,
                      "Click a space and it takes the ink colour — Shift to pick the space first");
  /* =================================================================================================
     6la — AUTO. Ced: "have a automatic mode that will read the photo and will do what it should do.
     basically it will capture the shape and then erase the lines, and the make the fill ... this is
     not ai assisted tool, it should be aware without ai."
     It is not. It is a crowd detector and three set operations; `skAutoSolid` carries the reasoning
     and the measurements. One press, one undo step, and it says what it took away.
     ================================================================================================= */
  mkb(gTools,"Auto","✺",()=>{
    const res=skAutoSolid(g,cv,autoMinLen);
    if(!res){ setStatus("Nothing to work on — the picture is empty.",true); return; }
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
  },false,"Find the subject, take the stray lines off it, and fill it behind the ink — one press");
  bWand   =mkb(gSel,"Magic wand","✦",()=>setTool("wand"),false,
               "Click a space to select it — Shift adds another");
  /* 6gt — Ced: "add a lasso effect on edit photo." For everything the wand cannot reach: draw round
     it by hand and what you drew round is selected, through the same three chips. */
  bLasso  =mkb(gSel,"Lasso","◌",()=>setTool("lasso"),false,
               "Draw round a region by hand — Shift adds it, Alt takes it out");
  /* 6la — SHAPED SELECT. Ced: "shaped select - within magic wand type tool". The lasso is for a
     region with no shape to it; most of what wants selecting on a drawing is a rectangle, and
     drawing one by hand round it is both slower and worse. It answers to the same three chips. */
  bShapeSel=mkb(gSel,"Shape select","▱",()=>setTool("shapesel"),false,
               "Drag a rectangle or an ellipse over what you want — Shift adds, Alt takes out");
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
  inkRow.appendChild(dcol);
  const drng=document.createElement("input");
  drng.type="range"; drng.min="0.25"; drng.max="12"; drng.step="0.25"; drng.value=String(drawPt);
  const dnum=document.createElement("span"); dnum.className="sk-ednum";
  const dsay=()=>{ dnum.textContent=drawPt.toFixed(2).replace(/\.?0+$/,"")+" pt"; };
  /* 6lf — and the ring is the weight, so it moves with the slider as well as with the wheel */
  drng.oninput=()=>{ drawPt=+drng.value; dsay(); try{ sizeRing(); }catch(e){} };
  dsay();
  inkRow.appendChild(drng); inkRow.appendChild(dnum);
  bInkFill=document.createElement("button");
  bInkFill.type="button"; bInkFill.className="sk-edm";
  bInkFill.textContent="■ Filled";
  bInkFill.title="Paint the inside of a box or an ellipse as well as its edge";
  bInkFill.onclick=()=>{ drawFill=!drawFill; bInkFill.classList.toggle("on",drawFill); };
  inkRow.appendChild(bInkFill);
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
    /* 6lf — Shift-wheel sizes WHATEVER IS IN YOUR HAND. With the pen that is the weight in points,
       on its own slider and with its own step: proportional like the brush's, floored at a quarter
       point so it still moves at the bottom of the range, and rounded to the slider's own 0.25
       so the number under the slider and the stroke on the picture never disagree. */
    if(tool==="pen"){
      const st=Math.max(0.25,Math.round(drawPt*0.18*4)/4);
      const v=Math.max(+drng.min,Math.min(+drng.max,Math.round((drawPt+dir*st)*4)/4));
      if(v===drawPt)return;
      drawPt=v; drng.value=String(v); dsay(); sizeRing();
      return;
    }
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
    /* 6lf — the ring is the width the TOOL IN HAND paints with. For the eraser and Restore that is
       `brush`, already in picture pixels; for the pen it is `drawPx()`, which turns the weight in
       points into picture pixels through the same `ptPx` the stroke itself uses — so the ring is the
       stroke, not an impression of it. `zoom` takes both from picture pixels to screen pixels. */
    const px=(tool==="pen")?drawPx():brush;
    const d=Math.max(4,px*zoom);
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
      const paintInk=ctx=>{
        const [x0,y0,X1,Y1]=geom();
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
      };
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
        push(); paintInk(g); picChanged=true;
        setStatus((tool==="arrow"?"Arrow":(tool==="line"?"Line":(tool==="rect"?"Box":"Ellipse")))+
                  " drawn into the picture at "+drawPt+"pt — it is part of the capture now, so it "+
                  "moves and resizes with it.");
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
  const ink=Uint8Array.from(ink0);
  const strayAll=new Uint8Array(w*h);
  let solid=null, nClosed=0, nEnds=0, R=1;
  const L=minLen>0?minLen:Math.max(12,Math.round(Math.min(w,h)/12));
  const N=Math.max(1,Math.min(6,rounds>0?rounds:3));
  for(let pass=0;pass<N;pass++){
    const got=skAutoPass(ink,w,h,L);
    if(!got)break;
    solid=got.solid; nClosed=got.nClosed; nEnds=got.nEnds; R=got.stroke;
    let took=0;
    for(let p=0;p<ink.length;p++){
      if(ink[p]&&!got.solid[p]){ ink[p]=0; strayAll[p]=1; took++; }
    }
    if(!took)break;
  }
  if(!solid)return null;
  let nStray=0; for(let p=0;p<strayAll.length;p++)nStray+=strayAll[p];
  let nFill=0;
  for(let p=0;p<solid.length;p++)if(solid[p]&&!ink[p])nFill++;
  return {stray:strayAll, solid, nStray, nFill, nInk:total, minLen:L, stroke:R, nClosed, nEnds};
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
