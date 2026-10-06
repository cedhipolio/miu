  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  MA_CALLOUT_TEXT="sample";
  maPlaceCallout(0,0.30,0.35,"sample");
  await sleep(500);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(a=>a.maKind==="callout");
  const id=maAddShape(0,"rect",0.60,0.28,0.26,0.12,{});
  const a=S.annos.find(z=>z.id===id); a.pat="dots"; a.patCol="#1c60ff";
  const lid=addLine(0,0.62,0.52,0.86,0.60,{col:"#2b8a3e",sw:2,le1:"arrow"});
  layoutAnnos(); drawAllLines();
  setMode("select"); selectAnno(box.id); drawAllLines();
  await sleep(400);
  window.scrollTo(0,document.querySelector('.page[data-idx="0"]').offsetTop-30);
  await sleep(300);
  return {ok:1};
