/* v9b — item 6 (centring when zoomed) and a closed polyline through an export. */
  const out={};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const host=document.getElementById("pages");
  const pbox=()=>{ const p=document.querySelector('.page[data-idx="0"]');
                   const r=p.getBoundingClientRect(); return {l:r.left,r:r.right,w:r.width}; };

  gotoPageInstant(0); await sleep(400);
  for(const z of [1,1.5,2,3]){
    await setZoom(z); await sleep(500);
    const b=pbox(), hr=host.getBoundingClientRect();
    const left=b.l-hr.left+host.scrollLeft;                 /* gap inside the scroller, left side */
    const right=host.scrollWidth-(left+b.w);                /* and right */
    out["z"+z]={w:Math.round(b.w),left:Math.round(left),right:Math.round(right),
                clipped:left<-1, centred:Math.abs(left-right)<6};
  }
  await setZoom(1); await sleep(400);

  /* a closed polyline, exported */
  S.annos=[]; S.lines=[]; layoutAnnos(); drawAllLines();
  const pts=[[0.2,0.3],[0.4,0.3],[0.4,0.44],[0.2,0.3]];
  const id=addLine(0,pts[0][0],pts[0][1],pts[3][0],pts[3][1],{pts:pts,col:"#fa3237",sw:2});
  const l=S.lines.find(z=>z.id===id);
  l.closed=true; l.fill="#ffec99"; l.fillOp=0.6;
  drawAllLines(); await sleep(250);
  out.polygon=document.querySelectorAll("#pages polygon").length;
  out.fillOnScreen=(()=>{ const g=document.querySelector("#pages polygon");
    return g?{fill:g.getAttribute("fill"),op:g.getAttribute("fill-opacity")}:null; })();
  await exportPdf(); await sleep(2500);
  out.exported=true;
  return out;
