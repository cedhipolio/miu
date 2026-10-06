  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  gotoPageInstant(0); await sleep(300);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  MA_CALLOUT_TEXT="sample";
  maPlaceCallout(0,0.62,0.40,"sample");
  await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(a=>a.maKind==="callout");
  const ld=S.lines.find(l=>l.maKind==="calloutleader");
  const mid=()=>({cx:box.nx+box.nw/2,cy:box.ny+box.nh/2});
  const centred=()=>{ const p=ld.pts, m=mid();
    return (ld.coSide==="left"||ld.coSide==="right")
      ? Math.abs(p[0][1]-m.cy)<1e-3 : Math.abs(p[0][0]-m.cx)<1e-3; };
  out.start={side:ld.coSide,centred:centred(),perp:(Math.abs(ld.pts[1][0]-ld.pts[0][0])<1e-9||
                                                    Math.abs(ld.pts[1][1]-ld.pts[0][1])<1e-9)};
  /* drag the ARROW round the box: the stub must move to the side it faces, centred each time */
  const put=(x,y)=>{ ld.pts[2]=[x,y]; drawAllLines(); };
  const around=[];
  [[0.10,0.40],[0.62,0.10],[0.10,0.90],[0.95,0.42],[0.55,0.95]].forEach(([x,y])=>{
    put(x,y);
    around.push({at:[x,y],side:ld.coSide,centred:centred(),
                 perp:(Math.abs(ld.pts[1][0]-ld.pts[0][0])<1e-9||Math.abs(ld.pts[1][1]-ld.pts[0][1])<1e-9)});
  });
  out.around=around;
  /* now move it by hand: the elbow slides along the side and stays there */
  put(0.95,0.42);
  ld.coOff=0.15; drawAllLines();
  const p=ld.pts;
  out.manual={off:ld.coOff,y:+((p[0][1]-box.ny)/box.nh).toFixed(3),
              perp:Math.abs(p[1][1]-p[0][1])<1e-9};
  /* and the hand's position survives the arrow moving on the same side */
  put(0.95,0.60);
  out.manualKept=+((ld.pts[0][1]-box.ny)/box.nh).toFixed(3);
  /* the endings: every one draws something, at both ends */
  out.ends=MARK_ENDS.filter(k=>k).map(k=>{
    const sp=endShapePath(k,10,10,40,10,9);
    return {k,d:!!(sp&&sp.d&&sp.d.length>8),fill:!!(sp&&sp.fill)};
  });
  out.endsAllDraw=out.ends.every(e=>e.d);
  out.endCount=MARK_ENDS.length;
  return out;
