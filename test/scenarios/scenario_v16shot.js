  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,bubbles:true,button:0});
  skPick("snapshot"); await sleep(120);
  pg.dispatchEvent(new PointerEvent("pointerdown",P(0.10,0.14)));
  pg.dispatchEvent(new PointerEvent("pointermove",P(0.56,0.26)));
  pg.dispatchEvent(new PointerEvent("pointerup",P(0.56,0.26)));
  await sleep(2500);
  const a=S.annos.find(x=>x.maKind==="snapshot");
  /* put it where Ced would: below and turned a little */
  a.ny=a.ny+0.22; a.nx=a.nx+0.06; a.rot=-12;
  layoutAnnos(); await sleep(300);
  setMode("select"); selectAnno(a.id); await sleep(300);
  window.scrollTo(0,pg.offsetTop-150); await sleep(300);
  await exportPdf(); await sleep(2500);
  return {rot:a.rot,col:a.col};
