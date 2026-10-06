  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  await setZoom(2); await sleep(700);
  document.body.classList.remove("ribbonhidden");
  MA_CALLOUT_TEXT="sample";
  maPlaceCallout(0,0.55,0.45,"sample"); await sleep(500);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(a=>a.maKind==="callout");
  setMode("select"); selectAnno(box.id); await sleep(400);
  return {scrollX:window.scrollX,zoom:S.scale};
