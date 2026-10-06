  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  const clr=()=>{S.annos=[];S.lines=[];selectAnno(null);selectLine(null);clearMulti();layoutAnnos();drawAllLines();};
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>{const r=R();return {clientX:r.left+r.width*fx,clientY:r.top+r.height*fy,bubbles:true,button:0};};
  const down=o=>pg.dispatchEvent(new PointerEvent("pointerdown",o));
  const move=o=>pg.dispatchEvent(new PointerEvent("pointermove",o));
  const up=o=>pg.dispatchEvent(new PointerEvent("pointerup",o));

  /* ---- 1: the callout is dragged — press on the arrow, release where the note goes ---- */
  clr();
  MA_CALLOUT_TEXT="Note";
  setMode("callout"); await sleep(80);
  down(P(0.30,0.50)); move(P(0.45,0.44)); move(P(0.62,0.40)); up(P(0.62,0.40));
  await sleep(500);
  try{document.activeElement.blur();}catch(e){}
  const box=S.annos.find(a=>a.maKind==="callout");
  const ld=S.lines.find(l=>l.maKind==="calloutleader");
  out.drag={box:!!box,leader:!!ld,
    tipAtPress:ld?(Math.abs(ld.pts[2][0]-0.30)<0.01&&Math.abs(ld.pts[2][1]-0.50)<0.01):null,
    boxAtRelease:box?(Math.abs(box.nx-0.62)<0.02):null,
    side:ld&&ld.coSide,
    modeAfter:S.mode};
  /* a bare click still places one, the old way */
  clr(); setMode("callout"); await sleep(60);
  down(P(0.40,0.60)); up(P(0.40,0.60));
  await sleep(400);
  try{document.activeElement.blur();}catch(e){}
  out.click={made:!!S.annos.find(a=>a.maKind==="callout"),modeAfter:S.mode};

  /* ---- 2: snapshot pastes a same-size redlined picture ---- */
  clr();
  const shp=maAddShape(0,"rect",0.22,0.30,0.18,0.05,{});
  addLine(0,0.22,0.40,0.46,0.44,{col:"#fa3237",sw:2,le1:"arrow"});
  layoutAnnos(); drawAllLines(); await sleep(250);
  skPick("snapshot"); await sleep(80);
  const before=S.annos.length;
  const r=[0.18,0.26,0.52,0.48];
  down(P(r[0],r[1])); move(P(r[2],r[3])); up(P(r[2],r[3]));
  await sleep(2500);
  const snap=S.annos.find(a=>a.maKind==="snapshot");
  out.snap={made:S.annos.length-before,isImg:snap&&snap.kind==="img",
    sameSize:snap?(Math.abs(snap.nw-(r[2]-r[0]))<2e-3&&Math.abs(snap.nh-(r[3]-r[1]))<2e-3):null,
    aspect:snap?+(snap.nw/snap.nh).toFixed(3):null,
    hasSrc:!!(snap&&/^data:image\/png/.test(snap.src||"")),
    frame:snap?{col:snap.col,sw:snap.sw,op:snap.fillOp}:null,
    selected:S.sel===(snap&&snap.id), mode:S.mode};
  /* the picture really carries the redlines: sample it for red pixels */
  out.redInside=await new Promise(res=>{
    const im=new Image();
    im.onload=()=>{ const c=document.createElement("canvas"); c.width=im.width; c.height=im.height;
      const g=c.getContext("2d"); g.drawImage(im,0,0);
      const d=g.getImageData(0,0,c.width,c.height).data;
      let red=0; for(let k=0;k<d.length;k+=4){ if(d[k]>170&&d[k+1]<90&&d[k+2]<90)red++; }
      res({w:im.width,h:im.height,red}); };
    im.onerror=()=>res(null);
    im.src=snap.src;
  });
  /* ---- the snapshot's properties, with colours ---- */
  tpOpen("snapshot",document.body); await sleep(120);
  const pop=document.getElementById("toolpop");
  out.panel={title:(pop.querySelector(".tp-title")||{}).textContent,
             swatches:pop.querySelectorAll(".tp-sw").length,
             sliders:pop.querySelectorAll(".tp-sliderrow").length};
  tpClose();
  /* and Edit properties on the pasted snapshot opens that same panel */
  setMode("select"); selectAnno(snap.id); await sleep(150);
  out.toolFor=sbToolFor(maSelectedMarks());
  /* restyling it lands on the mark */
  tpOpen("snapshot",document.body,true); await sleep(120);
  tpApply("col","#12b886"); tpApply("sw",3); tpApply("fillOp",0.6); await sleep(150);
  out.restyled={col:snap.col,sw:snap.sw,op:snap.fillOp};
  tpClose();
  return out;
