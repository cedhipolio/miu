/* v10 — the eight of this round. */
  const out={};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  gotoPageInstant(0); await sleep(300);
  const clear=()=>{ S.annos=[];S.lines=[];S.history=[];S.future=[];selectAnno(null);selectLine(null);
                    clearMulti();layoutAnnos();drawAllLines(); };

  /* ---- 3: Copy row is gone ---- */
  out.copyrowButton=document.querySelectorAll('#tools .tool[data-mode="copyrow"]').length;
  out.copyrowSpec=(typeof TP_SPEC!=="undefined"&&TP_SPEC.copyrow)?1:0;

  /* ---- 1 + 4: fill properties ---- */
  tpOpen("callout",document.querySelector('#tools .tool[data-mode="callout"]')||document.body);
  await sleep(80);
  const pop=document.getElementById("toolpop");
  const sliders=()=>[...pop.querySelectorAll(".tp-sliderrow")].length;
  out.calloutTargets=!!pop.querySelector(".tp-targets");
  out.calloutSliders=sliders();
  /* switch to Fill and drive the opacity slider */
  [...pop.querySelectorAll(".tp-target")].find(b=>/Fill/.test(b.textContent)).click();
  await sleep(80);
  tpApply("fillOp",0.35); await sleep(60);
  out.calloutFillOp=MA_TOOL_STYLES.callout.fillOp;
  tpClose();
  tpOpen("poly",document.querySelector('#tools .tool[data-mode="poly"]')||document.body);
  await sleep(80);
  out.polyTargets=!!document.querySelector("#toolpop .tp-targets");
  out.polyFillLabel=[...document.querySelectorAll("#toolpop .tp-target")].map(b=>b.textContent.trim());
  tpClose();

  /* ---- 5: the dot hatch ---- */
  clear();
  const css=patCss({pat:"dots",patCol:"#1c60ff",patScale:110});
  out.dotCss=css.slice(0,24);
  out.dotSize=patCssSize({pat:"dots",patScale:110});
  out.dotIsDot=patIsDot({pat:"dots"});
  const aId=maAddShape(0,"rect",0.2,0.3,0.25,0.1,{});
  const sh=S.annos.find(z=>z.id===aId); sh.pat="dots"; sh.patCol="#1c60ff";
  layoutAnnos(); await sleep(150);
  const ed=document.querySelector(`.anno[data-id="${aId}"] .ed`);
  out.shapeHatch={img:(ed.style.backgroundImage||"").slice(0,16),size:ed.style.backgroundSize};

  /* ---- 6: the n/s handles only while selected ---- */
  selectAnno(null); await sleep(120);
  const vis=el=>el&&getComputedStyle(el).display!=="none";
  const nH=document.querySelector(`.anno[data-id="${aId}"] .rz.n`);
  out.nHiddenUnselected=!vis(nH);
  selectAnno(aId); await sleep(150);
  out.nShownSelected=vis(document.querySelector(`.anno[data-id="${aId}"] .rz.n`));
  out.rotShown=vis(document.querySelector(`.anno[data-id="${aId}"] .rot`));
  out.movShown=vis(document.querySelector(`.anno[data-id="${aId}"] .mov`));

  /* ---- 7: resizing a rotated shape ---- */
  clear();
  const rId=maAddShape(0,"rect",0.25,0.3,0.2,0.08,{});
  const R=S.annos.find(z=>z.id===rId); R.rot=90;
  layoutAnnos(); selectAnno(rId); await sleep(200);
  const pgEl=document.querySelector('.page[data-idx="0"]');
  const d=document.querySelector(`.anno[data-id="${rId}"]`);
  const e0=d.querySelector(".rz.e").getBoundingClientRect();
  const before={nw:R.nw,nh:R.nh,nx:R.nx,ny:R.ny};
  /* the east handle of a quarter-turned box points DOWN the page; dragging it that way must grow the
     box's own width and leave its other three edges where they are */
  const hx=e0.x+e0.width/2, hy=e0.y+e0.height/2;
  d.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:hx,clientY:hy,pointerId:3}));
  const handle=d.querySelector(".rz.e");
  handle.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:hx,clientY:hy,pointerId:3}));
  window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:hx,clientY:hy+80,pointerId:3}));
  await sleep(60);
  window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:hx,clientY:hy+80,pointerId:3}));
  await sleep(150);
  const W=pgEl.offsetWidth,H=pgEl.offsetHeight;
  out.rotResize={grewW:+(R.nw-before.nw).toFixed(4),heightKept:Math.abs(R.nh-before.nh)<1e-4,
                 /* the west edge, in the rotated frame, must not have moved: its centre shifts by
                    exactly half the growth along the box's own x, which at 90° is +y on screen */
                 cxDrift:+(((R.nx+R.nw/2)-(before.nx+before.nw/2))*W).toFixed(1),
                 cyDrift:+(((R.ny+R.nh/2)-(before.ny+before.nh/2))*H).toFixed(1)};

  /* ---- 8: a stroke carries move and rotate grips ---- */
  clear();
  const lid=addLine(0,0.2,0.3,0.5,0.4,{col:"#fa3237",sw:2});
  drawAllLines(); selectLine(lid); await sleep(200);
  out.strokeGrips=document.querySelectorAll('.page[data-idx="0"] svg.draw g').length;
  const L=S.lines.find(z=>z.id===lid);
  const a0=Math.atan2(L.y2-L.y1,L.x2-L.x1);
  /* turn it with the rotate grip */
  const g=[...document.querySelectorAll('.page[data-idx="0"] svg.draw g')][0];
  const gb=g.getBoundingClientRect();
  g.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,
    clientX:gb.x+gb.width/2,clientY:gb.y+gb.height/2,pointerId:4}));
  window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,ctrlKey:true,
    clientX:gb.x+gb.width/2+60,clientY:gb.y+gb.height/2-60,pointerId:4}));
  await sleep(60);
  window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:gb.x,clientY:gb.y,pointerId:4}));
  await sleep(150);
  const a1=Math.atan2(S.lines[0].y2-S.lines[0].y1,S.lines[0].x2-S.lines[0].x1);
  out.strokeTurned=Math.abs(a1-a0)>0.05;

  /* ---- 2: the callout is one mark ---- */
  clear();
  MA_CALLOUT_TEXT="Note";
  maPlaceCallout(0,0.62,0.45,"Note");
  await sleep(400);
  const box=S.annos.find(a=>a.maKind==="callout");
  const ld=S.lines.find(l=>l.maKind==="calloutleader");
  out.callout={box:!!box,leader:!!ld,coFor:(ld&&ld.coFor)===(box&&box.id),
               boxGroup:box?box.group==null:null, leaderGroup:ld?ld.group==null:null,
               pts:(ld&&ld.pts||[]).length};
  /* the stub is perpendicular to the side it leaves */
  const p=ld.pts;
  out.perp=(Math.abs(p[1][0]-p[0][0])<1e-4||Math.abs(p[1][1]-p[0][1])<1e-4);
  /* selecting the BOX shows the leader's handles */
  selectAnno(box.id); drawAllLines(); await sleep(200);
  out.leaderHandles=document.querySelectorAll('.page[data-idx="0"] svg.draw circle').length;
  /* moving the box moves the arrow too */
  const tip0=[...ld.pts[ld.pts.length-1]];
  const dEl=document.querySelector(`.anno[data-id="${box.id}"]`);
  const r0=dEl.getBoundingClientRect();
  const mov=dEl.querySelector(".mov");
  const mb=mov.getBoundingClientRect();
  mov.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,
    clientX:mb.x+9,clientY:mb.y+9,pointerId:5}));
  window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:mb.x+9-70,clientY:mb.y+9-40,pointerId:5}));
  await sleep(80);
  window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:mb.x+9-70,clientY:mb.y+9-40,pointerId:5}));
  await sleep(200);
  const tip1=S.lines.find(l=>l.maKind==="calloutleader").pts.slice(-1)[0];
  out.arrowFollowed=Math.abs(tip1[0]-tip0[0])>0.01;
  /* deleting the box takes the leader with it */
  pushHistory(); S.annos=S.annos.filter(x=>x.id!==box.id);
  layoutAnnos(); drawAllLines(); await sleep(200);
  out.leaderGoneWithBox=S.lines.filter(l=>l.maKind==="calloutleader").length;
  return out;
