  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  const clr=()=>{S.annos=[];S.lines=[];selectAnno(null);selectLine(null);clearMulti();layoutAnnos();drawAllLines();};

  /* ---- 2: the Select dropdown ---- */
  const selBtn=document.querySelector('#tools .tool[data-mode="select"]');
  out.caret=!!selBtn.querySelector(".tcaret");
  selBtn.querySelector(".tcaret").dispatchEvent(new MouseEvent("click",{bubbles:true}));
  await sleep(120);
  const menu=document.querySelector(".sk-menu");
  out.menu=menu?[...menu.querySelectorAll(".sk-l")].map(e=>e.textContent):null;
  menu.remove();
  /* each one takes the tool */
  out.modes={};
  for(const m of ["lasso","textsel","eraser","painter","snapshot","laser","select"]){
    skPick(m); await sleep(60);
    out.modes[m]=S.mode;
  }
  out.laserGone=document.querySelectorAll(".sk-laser").length;
  skPick("laser"); await sleep(80);
  window.dispatchEvent(new PointerEvent("pointermove",{clientX:400,clientY:400}));
  await sleep(60);
  out.laserDots=document.querySelectorAll(".sk-laser").length;
  skPick("select"); await sleep(80);
  out.laserOff=document.querySelectorAll(".sk-laser").length;

  /* lasso picks up what it surrounds */
  clr();
  const a1=maAddShape(0,"rect",0.20,0.30,0.10,0.05,{});
  const a2=maAddShape(0,"rect",0.60,0.30,0.10,0.05,{});
  layoutAnnos(); await sleep(150);
  skPick("lasso"); await sleep(60);
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R.left+R.width*fx,clientY:R.top+R.height*fy});
  const send=(t,o)=>pg.dispatchEvent(new PointerEvent(t,Object.assign({bubbles:true,button:0},o)));
  const sendW=(t,o)=>window.dispatchEvent(new PointerEvent(t,Object.assign({bubbles:true},o)));
  send("pointerdown",P(0.16,0.26));
  [[0.34,0.26],[0.34,0.38],[0.16,0.38],[0.16,0.27]].forEach(([x,y])=>sendW("pointermove",P(x,y)));
  sendW("pointerup",P(0.16,0.27));
  await sleep(200);
  out.lasso={picked:[...S.selMulti].length,which:(S.selMulti.has(a1)?"first":"?")};

  /* eraser rubs a mark out */
  skPick("eraser"); await sleep(60);
  const before=S.annos.length;
  const d1=document.querySelector(`.anno[data-id="${a1}"]`).getBoundingClientRect();
  send("pointerdown",{clientX:d1.left+d1.width/2,clientY:d1.top+d1.height/2});
  sendW("pointerup",{clientX:d1.left+d1.width/2,clientY:d1.top+d1.height/2});
  await sleep(200);
  out.eraser={before,after:S.annos.length};

  /* format painter carries a look from one mark to another */
  clr();
  const b1=maAddShape(0,"rect",0.20,0.30,0.10,0.05,{});
  const b2=maAddShape(0,"rect",0.60,0.30,0.10,0.05,{});
  const m1=S.annos.find(z=>z.id===b1); m1.col="#7048e8"; m1.sw=5;
  layoutAnnos(); await sleep(150);
  skPick("painter"); await sleep(60);
  const r1=document.querySelector(`.anno[data-id="${b1}"]`).getBoundingClientRect();
  send("pointerdown",{clientX:r1.left+5,clientY:r1.top+5});
  await sleep(120);
  const r2=document.querySelector(`.anno[data-id="${b2}"]`).getBoundingClientRect();
  send("pointerdown",{clientX:r2.left+5,clientY:r2.top+5});
  await sleep(200);
  const m2=S.annos.find(z=>z.id===b2);
  out.painter={col:m2.col,sw:m2.sw};
  skPick("select");

  /* text select copies printed runs */
  clr();
  skPick("textsel"); await sleep(60);
  const it=(S.pages[0].items||[]).find(t=>/SOH|UTICA|397/.test(t.str));
  send("pointerdown",P(it.nx-0.01,it.ny-0.004));
  sendW("pointermove",P(it.nx+(it.nw||0.1)+0.01,it.ny+(it.nh||0.01)+0.004));
  sendW("pointerup",P(it.nx+(it.nw||0.1)+0.01,it.ny+(it.nh||0.01)+0.004));
  await sleep(400);
  out.textsel=(document.querySelector("#status")||{}).textContent;
  skPick("select");

  /* ---- 5: ctrl-click adds to a single selection ---- */
  clr();
  const c1=maAddShape(0,"rect",0.20,0.30,0.10,0.05,{});
  const c2=maAddShape(0,"rect",0.60,0.30,0.10,0.05,{});
  layoutAnnos(); await sleep(150);
  setMode("select"); selectAnno(c1); await sleep(100);
  const ed2=document.querySelector(`.anno[data-id="${c2}"] .ed`);
  ed2.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,ctrlKey:true}));
  await sleep(200);
  out.ctrlClick={n:multiCount(),has1:S.selMulti.has(c1),has2:S.selMulti.has(c2)};

  /* ---- 3: the frame follows a group drag ---- */
  clr();
  const g1=maAddShape(0,"rect",0.20,0.30,0.10,0.05,{});
  const g2=maAddShape(0,"rect",0.36,0.30,0.10,0.05,{});
  layoutAnnos(); clearMulti(); S.selMulti=new Set([g1,g2]); paintMulti(); await sleep(200);
  const f0=document.querySelector(".gframe").getBoundingClientRect();
  const mv=document.querySelector(".gframe .gmove");
  mv.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:f0.left+20,clientY:f0.top+10,pointerId:11}));
  sendW("pointermove",{clientX:f0.left+120,clientY:f0.top+70,pointerId:11});
  await sleep(120);
  const fMid=document.querySelector(".gframe").getBoundingClientRect();
  sendW("pointerup",{clientX:f0.left+120,clientY:f0.top+70,pointerId:11});
  await sleep(150);
  out.frameFollows={moved:Math.round(fMid.left-f0.left),
                    withMarks:Math.abs((fMid.left-f0.left)-100)<6};

  /* ---- 4: strike & write ---- */
  clr();
  const run=(S.pages[0].items||[]).find(t=>/SOH|UTICA|397/.test(t.str));
  maStrikeAndWrite(0,run); await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const fix=S.annos.find(x=>x.maKind==="fix"), st=S.lines.find(l=>l.maKind==="strike");
  const dd=()=>document.querySelector(`.anno[data-id="${fix.id}"]`);
  const hOf=()=>dd().offsetHeight/pg.offsetHeight, wOf=()=>dd().offsetWidth/pg.offsetWidth;
  out.sw0={above:(fix.ny+hOf())<=st.y1+1e-3,
           centred:Math.abs((fix.nx+wOf()/2)-((st.x1+st.x2)/2))<3e-3,
           lineY:+st.y1.toFixed(4)};
  const lineWas={y:st.y1,x1:st.x1,x2:st.x2};
  fix.nw*=1.7; fix.manualW=true; layoutAnnos(); drawAllLines(); await sleep(250);
  out.swResized={lineStill:(st.y1===lineWas.y&&st.x1===lineWas.x1&&st.x2===lineWas.x2),
                 above:(fix.ny+hOf())<=st.y1+1e-3,
                 centred:Math.abs((fix.nx+wOf()/2)-((st.x1+st.x2)/2))<3e-3};

  /* ---- 1: the bar clears a callout's leader ---- */
  clr();
  MA_CALLOUT_TEXT="Note"; maPlaceCallout(0,0.55,0.55,"Note"); await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(x=>x.maKind==="callout");
  setMode("select"); selectAnno(box.id); await sleep(250);
  const bar=document.getElementById("annobar").getBoundingClientRect();
  const ld=S.lines.find(l=>l.maKind==="calloutleader");
  const ptsScr=ld.pts.map(p=>({x:R.left+p[0]*pg.offsetWidth,y:R.top+p[1]*pg.offsetHeight}));
  const hitsLeader=ptsScr.some(p=>p.x>=bar.left-6&&p.x<=bar.right+6&&p.y>=bar.top-6&&p.y<=bar.bottom+6);
  const bx=document.querySelector(`.anno[data-id="${box.id}"]`).getBoundingClientRect();
  out.barClear={overBox:!(bar.bottom<=bx.top+1||bar.top>=bx.bottom-1),overLeader:hitsLeader};
  return out;
