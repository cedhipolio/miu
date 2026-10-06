  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  const pg=document.querySelector('.page[data-idx="0"]');
  const clr=()=>{S.annos=[];S.lines=[];selectAnno(null);selectLine(null);clearMulti();layoutAnnos();drawAllLines();};
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy,mod)=>Object.assign({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,
                                      bubbles:true,button:0},mod||{});
  const down=o=>pg.dispatchEvent(new PointerEvent("pointerdown",o));
  const move=o=>pg.dispatchEvent(new PointerEvent("pointermove",o));
  const up=o=>pg.dispatchEvent(new PointerEvent("pointerup",o));

  /* ---- the callout's arrowhead is changeable in its own panel ---- */
  clr();
  tpOpen("callout",document.body); await sleep(100);
  const pop=document.getElementById("toolpop");
  out.calloutHasEnds=[...pop.querySelectorAll(".tp-sech")].some(h=>/Line endings/i.test(h.textContent));
  tpSet("le1","oarrow"); await sleep(80);
  out.calloutToolEnd=MA_TOOL_STYLES.callout.le1;
  tpClose();
  MA_CALLOUT_TEXT="Note"; setMode("callout"); await sleep(60);
  down(P(0.30,0.52)); move(P(0.50,0.44)); up(P(0.60,0.42));
  await sleep(500);
  try{document.activeElement.blur();}catch(e){}
  let ld=S.lines.find(l=>l.maKind==="calloutleader");
  out.drawnWith=ld?endsOf(ld)[1]:null;
  /* and changing it on the SELECTED callout reaches the leader */
  const box=S.annos.find(a=>a.maKind==="callout");
  setMode("select"); selectAnno(box.id); await sleep(150);
  tpOpen("callout",document.body,true); await sleep(100);
  tpSet("le1","diamond"); await sleep(150);
  ld=S.lines.find(l=>l.maKind==="calloutleader");
  out.restyledEnd=endsOf(ld)[1];
  tpClose();

  /* ---- the arrow tool's own ending still applies, tool and selection ---- */
  clr();
  tpOpen("arrow",document.body); await sleep(80);
  tpSet("le1","harrow"); await sleep(80);
  tpClose();
  setMode("arrow"); await sleep(60);
  down(P(0.20,0.30)); move(P(0.40,0.36)); up(P(0.40,0.36));
  await sleep(300);
  const ar=S.lines[S.lines.length-1];
  out.arrowDrawn=endsOf(ar)[1];
  selectLine(ar.id); await sleep(100);
  tpOpen("arrow",document.body,true); await sleep(80);
  tpSet("le1","circle"); await sleep(150);
  out.arrowRestyled=endsOf(S.lines.find(l=>l.id===ar.id))[1];
  tpClose();

  /* ---- Ctrl forces the nearest 45° while drawing, and the magnet still works ---- */
  clr();
  setMode("line"); S.snap=false; await sleep(60);
  down(P(0.20,0.30)); move(P(0.60,0.36,{ctrlKey:true})); up(P(0.60,0.36,{ctrlKey:true}));
  await sleep(300);
  const l1=S.lines[S.lines.length-1];
  const angOf=l=>{const w=pg.offsetWidth,h=pg.offsetHeight;
    return Math.round(Math.atan2((l.y2-l.y1)*h,(l.x2-l.x1)*w)*180/Math.PI*10)/10;};
  out.ctrlLevel=angOf(l1);
  clr(); setMode("line"); await sleep(60);
  down(P(0.20,0.30)); move(P(0.40,0.55,{ctrlKey:true})); up(P(0.40,0.55,{ctrlKey:true}));
  await sleep(300);
  out.ctrlDiag=angOf(S.lines[S.lines.length-1]);
  clr(); setMode("line"); await sleep(60);
  down(P(0.20,0.30)); move(P(0.26,0.62,{ctrlKey:true})); up(P(0.26,0.62,{ctrlKey:true}));
  await sleep(300);
  out.ctrlPlumb=angOf(S.lines[S.lines.length-1]);
  /* without Ctrl and with snap off, the angle is left alone */
  clr(); setMode("line"); await sleep(60);
  down(P(0.20,0.30)); move(P(0.60,0.37)); up(P(0.60,0.37));
  await sleep(300);
  out.freeAngle=angOf(S.lines[S.lines.length-1]);
  S.snap=true;

  /* ---- the heads are wider ---- */
  const span=k=>{const sp=endShapePath(k,10,10,60,10,12);
    const ys=(sp.d.match(/-?\d+(\.\d+)?/g)||[]).map(Number).filter((v,i)=>i%2===1);
    return +(Math.max(...ys)-Math.min(...ys)).toFixed(2);};
  out.heads={arrow:span("arrow"),oarrow:span("oarrow"),rarrow:span("rarrow")};
  return out;
