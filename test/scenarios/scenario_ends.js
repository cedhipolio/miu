  /* every ending, at both ends, drawn and exported */
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  gotoPageInstant(0); await sleep(300);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const kinds=MARK_ENDS.filter(k=>k);
  kinds.forEach((k,i)=>{
    const y=0.20+i*0.045;
    const id=addLine(0,0.18,y,0.52,y,{col:"#fa3237",sw:2,le0:k,le1:k});
  });
  drawAllLines(); await sleep(300);
  const svg=document.querySelector('.page[data-idx="0"] svg.draw');
  const paths=[...svg.querySelectorAll("path")].length;
  await exportPdf(); await sleep(2500);
  return {kinds:kinds.length,lines:S.lines.length,headPaths:paths};
