  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  gotoPageInstant(0); await sleep(400);

  /* ---- 1: the column never widens the body ---- */
  out.zoom={};
  for(const z of [1,1.5,2,3]){
    await setZoom(z); await sleep(550);
    const pg=document.querySelector('.page[data-idx="0"]').getBoundingClientRect();
    const ps=document.getElementById("pages").getBoundingClientRect();
    const tb=document.getElementById("toolbar").getBoundingClientRect();
    const wrap=document.querySelector(".wrap");
    out.zoom["z"+z]={
      col:getComputedStyle(document.documentElement).getPropertyValue("--col-w").trim(),
      /* the column itself always fits the window — the body never scrolls sideways because of it */
      colFits:wrap.getBoundingClientRect().width<=window.innerWidth+1,
      /* While the sheet FITS the column it is centred in it by `margin:auto`, and its left edge is
         on screen. Once it is wider than the column neither can be true, and since 6md neither is
         claimed: the sheet is flush left IN THE COLUMN and centred IN THE WINDOW by the scroll, so
         half the overflow hangs off each side and both edges are reachable. `pageCentred` and
         `pageLeftVisible` therefore read false at 3x and that is the right answer — what has to
         hold at every zoom is the last one. */
      pageCentred:Math.abs((pg.left-ps.left)-(ps.right-pg.right))<3,
      pageLeftVisible:pg.left>=-1,
      centredInWindow:Math.abs((pg.left+pg.width/2)-window.innerWidth/2)<3,
      chromeVisible:tb.left>=0&&tb.left<window.innerWidth};
  }
  await setZoom(1); await sleep(400);

  /* ---- 6: pan vs marquee ---- */
  out.panButton=!!document.querySelector('#tools .tool[data-mode="pan"]');
  setMode("pan"); await sleep(80);
  out.panMode=S.mode;
  out.panCursor=getComputedStyle(document.querySelector('.page[data-idx="0"]')).cursor;
  setMode("select"); await sleep(80);
  out.selCursor=getComputedStyle(document.querySelector('.page[data-idx="0"]')).cursor;

  /* ---- 4: strike & write ---- */
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const P=S.pages[0], it=(P.items||[]).find(t=>/SOH|UTICA|397/.test(t.str))||P.items[6];
  const fid=maStrikeAndWrite(0,it);
  await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const fix=S.annos.find(a=>a.maKind==="fix");
  const st=S.lines.find(l=>l.maKind==="strike");
  const pgEl=document.querySelector('.page[data-idx="0"]');
  const mid=()=>{ const d=document.querySelector(`.anno[data-id="${fix.id}"]`);
    return {y:fix.ny+(d.offsetHeight/pgEl.offsetHeight)/2,
            cx:fix.nx+(d.offsetWidth/pgEl.offsetWidth)/2}; };
  const m0=mid();
  out.strike0={onMiddle:Math.abs(st.y1-m0.y)<2e-3,
               centred:Math.abs(((st.x1+st.x2)/2)-m0.cx)<2e-3,
               level:Math.abs(st.y1-st.y2)<1e-9};
  /* resize the box and the rule follows */
  fix.nw*=1.8; fix.nh*=1.6; fix.manualW=true; layoutAnnos(); drawAllLines(); await sleep(200);
  const m1=mid();
  out.strikeResized={onMiddle:Math.abs(st.y1-m1.y)<3e-3,
                     centred:Math.abs(((st.x1+st.x2)/2)-m1.cx)<3e-3,
                     wider:(st.x2-st.x1)>0};
  /* ungroup: the writing steps above the rule */
  clearMulti(); S.selMulti=new Set([fix.id]); S.selMultiL=new Set([st.id]);
  const lineY=st.y1;
  ungroupSelected(); await sleep(250);
  const d2=document.querySelector(`.anno[data-id="${fix.id}"]`);
  out.ungrouped={textAbove:(fix.ny+d2.offsetHeight/pgEl.offsetHeight)<=lineY+1e-3,
                 groupGone:(fix.group==null&&st.group==null)};

  /* ---- 5: the group frame fits rotated marks ---- */
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const a1=maAddShape(0,"rect",0.20,0.30,0.12,0.06,{});
  const a2=maAddShape(0,"rect",0.40,0.30,0.12,0.06,{});
  S.annos.forEach(a=>{a.rot=45;});
  layoutAnnos(); clearMulti(); S.selMulti=new Set([a1,a2]); paintMulti(); await sleep(250);
  const fr=document.querySelector(".gframe").getBoundingClientRect();
  const boxes=[...document.querySelectorAll(".anno")].map(d=>d.getBoundingClientRect());
  out.groupFrame={fits:boxes.every(b=>b.left>=fr.left-2&&b.right<=fr.right+2&&
                                        b.top>=fr.top-2&&b.bottom<=fr.bottom+2)};
  /* rotating the group keeps the marks' own centres on the turn */
  const before=S.annos.map(a=>({cx:a.nx+a.nw/2,cy:a.ny+a.nh/2}));
  const pgr=pgEl.getBoundingClientRect();
  const bb=multiBBox(pgEl);
  const cx=pgr.left+(bb.l+bb.r)/2, cy=pgr.top+(bb.t+bb.b)/2;
  const rot=document.querySelector(".gframe .grot");
  rot.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:cx+100,clientY:cy,pointerId:9}));
  window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,ctrlKey:true,clientX:cx,clientY:cy+100,pointerId:9}));
  await sleep(80);
  window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:cx,clientY:cy+100,pointerId:9}));
  await sleep(200);
  const after=S.annos.map(a=>({cx:a.nx+a.nw/2,cy:a.ny+a.nh/2}));
  /* a 90° turn about the group centre: each centre's distance from it must be unchanged */
  const W=pgEl.offsetWidth,H=pgEl.offsetHeight;
  const gc={x:(bb.l+bb.r)/2/W,y:(bb.t+bb.b)/2/H};
  const dist=p=>Math.hypot((p.cx-gc.x)*W,(p.cy-gc.y)*H);
  out.groupRotate={rot:S.annos[0].rot,
    radiusKept:before.every((p,i)=>Math.abs(dist(p)-dist(after[i]))<4)};

  /* ---- 3: clicking the callout box shows the leader handles, with no extra redraw ---- */
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  MA_CALLOUT_TEXT="sample"; maPlaceCallout(0,0.62,0.42,"sample"); await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(a=>a.maKind==="callout");
  selectAnno(null); await sleep(150);
  out.handlesBefore=document.querySelectorAll('.page[data-idx="0"] svg.draw circle').length;
  selectAnno(box.id); await sleep(200);          /* no drawAllLines() by hand */
  out.handlesAfter=document.querySelectorAll('.page[data-idx="0"] svg.draw circle').length;

  /* ---- 2: the bar never lies on the mark ---- */
  const bar=document.getElementById("annobar").getBoundingClientRect();
  const bx=document.querySelector(`.anno[data-id="${box.id}"]`).getBoundingClientRect();
  out.barClear=(bar.bottom<=bx.top+1||bar.top>=bx.bottom-1);
  out.barGap=Math.round(bx.top-bar.bottom);
  return out;
