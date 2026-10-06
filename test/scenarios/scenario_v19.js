  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,
                     bubbles:true,button:0,pointerId:13});

  /* ---------- 1. adjusting a shape keeps it in one piece ---------- */
  const outlineBox=a=>{
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const svg=d&&d.querySelector("svg.shapeoutline");
    const ed=d&&d.querySelector(".ed");
    return { svg:svg?{w:Math.round(+svg.getAttribute("width")),h:Math.round(+svg.getAttribute("height"))}:null,
             ed:ed?{w:Math.round(ed.offsetWidth),h:Math.round(ed.offsetHeight)}:null };
  };
  const mkShape=(kind,dash)=>{
    const id=maAddShape(0,kind,0.16,0.20,0.16,0.12,{});
    const a=S.annos.find(z=>z.id===id);
    a.col="#fa3237"; a.sw=2; a.fill="#ffffff"; a.fillOp=1; if(dash)a.dash=dash;
    layoutAnnos(); return a;
  };
  const dragHandle=async(a,pos,dx,dy)=>{
    setMode("select"); selectAnno(a.id); await sleep(120);
    const d=document.querySelector(`.anno[data-id="${a.id}"]`);
    const h=markHandle(a.id,".rz."+pos); if(!h)return false;   /* 6is */
    const r=h.getBoundingClientRect();
    const x=r.left+r.width/2, y=r.top+r.height/2;
    h.dispatchEvent(new PointerEvent("pointerdown",{clientX:x,clientY:y,bubbles:true,pointerId:17,button:0}));
    for(let k=1;k<=6;k++)
      window.dispatchEvent(new PointerEvent("pointermove",
        {clientX:x+dx*k/6,clientY:y+dy*k/6,bubbles:true,pointerId:17}));
    window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:17}));
    await sleep(200); return true;
  };
  {
    const a=mkShape("ellipse");
    out.ellipseBefore=outlineBox(a);
    await dragHandle(a,"e",200,0);
    await dragHandle(a,"s",0,90);
    out.ellipseAfter=outlineBox(a);
    out.ellipseFits=(()=>{ const o=out.ellipseAfter;
      return !!(o.svg&&o.ed&&Math.abs(o.svg.w-o.ed.w)<=2&&Math.abs(o.svg.h-o.ed.h)<=2); })();
    /* and a dashed rectangle, the other kind of mark whose outline is drawn rather than bordered */
    S.annos=[];layoutAnnos();
    const b=mkShape("rect","dash");
    await dragHandle(b,"se",160,110);
    out.dashedAfter=outlineBox(b);
    out.dashedFits=(()=>{ const o=out.dashedAfter;
      return !!(o.svg&&o.ed&&Math.abs(o.svg.w-o.ed.w)<=2&&Math.abs(o.svg.h-o.ed.h)<=2); })();
    out.oneElement=document.querySelectorAll(".anno").length;
    S.annos=[];layoutAnnos();
  }

  /* ---------- 3. a snapshot lands exactly on what it captured ---------- */
  document.querySelector('#tools .tool[data-mode="snapshot"]').click();
  await sleep(150);
  const want={x1:0.14,y1:0.16,x2:0.52,y2:0.28};
  pg.dispatchEvent(new PointerEvent("pointerdown",P(want.x1,want.y1)));
  pg.dispatchEvent(new PointerEvent("pointermove",P(want.x2,want.y2)));
  pg.dispatchEvent(new PointerEvent("pointerup",P(want.x2,want.y2)));
  await sleep(2800);
  const snap=S.annos.find(a=>a.maKind==="snapshot");
  out.onTop=snap?{ dx:+(snap.nx-want.x1).toFixed(4), dy:+(snap.ny-want.y1).toFixed(4),
                   dw:+(snap.nw-(want.x2-want.x1)).toFixed(4),
                   dh:+(snap.nh-(want.y2-want.y1)).toFixed(4), frame:snap.sw }:null;
  out.landsOnIt=!!(out.onTop&&Math.abs(out.onTop.dx)<0.002&&Math.abs(out.onTop.dy)<0.002
                   &&Math.abs(out.onTop.dw)<0.003&&Math.abs(out.onTop.dh)<0.003);

  /* ---------- 2. the editor's wheel does not move the sheet ---------- */
  skEditor(snap); await sleep(900);
  {
    const m=document.querySelector(".sk-edit");
    const stage=m.querySelector(".sk-edstage");
    const zoomOf=()=>m.querySelector(".sk-edzoom").textContent;
    const before={scale:S.scale, sx:window.scrollX, sy:window.scrollY, zoom:zoomOf()};
    stage.dispatchEvent(new WheelEvent("wheel",{deltaY:-120,ctrlKey:true,bubbles:true,cancelable:true}));
    await sleep(200);
    const after={scale:S.scale, sx:window.scrollX, sy:window.scrollY, zoom:zoomOf()};
    /* and a plain wheel over the bar must not scroll the sheet either */
    m.querySelector(".sk-edbar").dispatchEvent(
      new WheelEvent("wheel",{deltaY:240,bubbles:true,cancelable:true}));
    await sleep(150);
    out.wheel={ before, after, sheetStill:(after.scale===before.scale&&after.sy===before.sy),
                pictureZoomed:(after.zoom!==before.zoom),
                stillStill:(window.scrollY===before.sy) };
    [...m.querySelectorAll(".sk-edfb")].find(b=>/Cancel/.test(b.textContent))
      .dispatchEvent(new MouseEvent("click",{bubbles:true}));
    await sleep(200);
  }

  /* ---------- 4. the sheet stays centred as it is zoomed ---------- */
  {
    const look=()=>{ const r=pg.getBoundingClientRect();
      return Math.round(r.left+r.width/2-window.innerWidth/2); };
    const off=[];
    for(const z of [1,1.5,2,2.5,3,3.5]){ await setZoom(z); await sleep(420); off.push(look()); }
    await setZoom(1.2); await sleep(400);
    out.centring={ offsets:off, worst:Math.max(...off.map(Math.abs)),
                   centred:off.every(v=>Math.abs(v)<90) };
  }

  /* ---------- 5. the markup library ---------- */
  {
    /* a real PNG through the real path: File → maAddMarkupFile → the library → the page */
    const c=document.createElement("canvas"); c.width=90; c.height=60;
    const g=c.getContext("2d"); g.fillStyle="#1144ff"; g.fillRect(0,0,90,60);
    g.fillStyle="#ffffff"; g.fillRect(10,10,70,40);
    const blob=await new Promise(res=>c.toBlob(res,"image/png"));
    const file=new File([blob],"antenna 1.png",{type:"image/png"});
    MA_MARKUPS.length=0;
    const rec=await maAddMarkupFile(file);
    out.markup={ made:!!rec, name:rec&&rec.name, src:(rec&&String(rec.src||"")).slice(0,16),
                 w:rec&&rec.w, h:rec&&rec.h, inLibrary:MA_MARKUPS.length };
    out.markupUsable=!!(rec&&/^data:image/.test(String(rec.src||"")));
    /* the thumbnail the panel draws must actually load */
    maSetTab("markups"); maPanelOpen(true); await sleep(300);
    const im=document.querySelector("#maPanel .ma-mk img");
    out.thumb=await new Promise(res=>{
      if(!im)return res({none:true});
      if(im.complete)return res({ok:im.naturalWidth>0,w:im.naturalWidth});
      im.onload=()=>res({ok:true,w:im.naturalWidth});
      im.onerror=()=>res({ok:false,w:0});
      setTimeout(()=>res({ok:im.naturalWidth>0,w:im.naturalWidth}),800);
    });
    maPanelOpen(false);
    /* and dropping it on the page makes a picture mark with that picture in it */
    S.annos=[];S.lines=[];layoutAnnos();
    const id=maPlaceMarkup(rec,0,0.4,0.4);
    await sleep(300);
    const m=S.annos.find(z=>z.id===id);
    out.placed=m?{ kind:m.kind, maKind:m.maKind, src:String(m.src||"").slice(0,16),
                   nw:+m.nw.toFixed(3), nh:+m.nh.toFixed(3) }:null;
    out.placedOk=!!(m&&m.kind==="img"&&/^data:image/.test(String(m.src||"")));
  }
  return out;
