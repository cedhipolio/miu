  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  gotoPageInstant(0); await sleep(300);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  /* a hatched box, a callout and a closed polyline */
  const id=maAddShape(0,"rect",0.12,0.30,0.30,0.12,{});
  const a=S.annos.find(z=>z.id===id);
  a.pat="dots"; a.patCol="#1c60ff"; a.col="#fa3237"; a.sw=2; a.fill="#ffffff";
  MA_CALLOUT_TEXT="New Sector Frame";
  maPlaceCallout(0,0.72,0.42,"New Sector Frame");
  await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const pts=[[0.15,0.55],[0.35,0.55],[0.35,0.68],[0.15,0.55]];
  const lid=addLine(0,pts[0][0],pts[0][1],pts[3][0],pts[3][1],{pts:pts,col:"#2b8a3e",sw:2});
  const cl=S.lines.find(z=>z.id===lid);
  cl.closed=true; cl.fill="#ffec99"; cl.fillOp=0.7; cl.pat="finedots"; cl.patCol="#e8590c";
  layoutAnnos(); drawAllLines(); await sleep(300);
  const before={annos:S.annos.length,lines:S.lines.length,
    co:(S.lines.find(l=>l.maKind==="calloutleader")||{}).coFor!=null};
  await exportPdf(); await sleep(2500);
  return before;
