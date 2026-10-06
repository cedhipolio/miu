  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,bubbles:true,button:0,pointerId:7});

  /* --- the formatter, on its own --- */
  out.fmt={
    twelve:maFmtFeetIn(12,16), foot:maFmtFeetIn(12.0,16), zero:maFmtFeetIn(0,16),
    halfIn:maFmtFeetIn(6.5,16), sixteenth:maFmtFeetIn(54.0625,16),
    round8:maFmtFeetIn(54.0625,8), inches:maFmtLen(30,"in",16),
    decft:maFmtLen(30,"ftd",16), mm:maFmtLen(1,"mm",16), m:maFmtLen(39.3701,"m",16)
  };
  out.parse={ a:maParseLen("12' 6\""), b:maParseLen("12'-6 1/2\""), c:maParseLen("150\""),
              d:maParseLen("12.5'"), e:maParseLen("450mm"), f:maParseLen("nonsense") };

  /* --- draw one with the tool, exactly as a hand would ---
     6gj — the reading is the user's to type now, so the measuring machinery is exercised with the
     tool's "fill new ones in for me" dial turned ON; the blank-by-default behaviour is scenario_v17's. */
  MA_TOOL_STYLES.dim=Object.assign({},MA_TOOL_STYLES.dim||{},{dimAuto:true});
  setMode("dim"); await sleep(60);
  out.mode=S.mode; out.pill=document.getElementById("modePill").textContent;
  pg.dispatchEvent(new PointerEvent("pointerdown",P(0.20,0.50)));
  pg.dispatchEvent(new PointerEvent("pointermove",P(0.20,0.50)));
  await sleep(40);
  out.hud=(document.getElementById("lenHUD")||{}).textContent;
  pg.dispatchEvent(new PointerEvent("pointermove",P(0.50,0.50)));
  await sleep(40);
  out.hudMid=(document.getElementById("lenHUD")||{}).textContent;
  pg.dispatchEvent(new PointerEvent("pointerup",P(0.50,0.50)));
  await sleep(300);

  const l=S.lines.find(z=>z.maKind==="dim");
  const lab=l?S.annos.find(z=>z.id===l.dimFor):null;
  out.made={
    lines:S.lines.length, annos:S.annos.length,
    kind:l&&l.maKind, ends:l?[l.le0,l.le1]:null, scale:l&&l.dimScale,
    owns:!!lab, labKind:lab&&lab.maKind, text:lab&&lab.text,
    above:lab?(lab.under===false):null, ground:lab&&lab.bg, groundOp:lab&&lab.fillOp,
    selected:(S.selLine===(l&&l.id))
  };
  /* the reading is the length, at 1/4" = 1'-0" */
  out.paperIn=l?Math.round(maDimPaperInches(l)*1000)/1000:null;
  out.realIn=l?Math.round(maDimInches(l)*100)/100:null;

  /* it sits at the middle of the run, turned with it */
  const mid=l?maDimMid(l):null;
  const box=lab?maDimBox(lab):null;
  out.centred=(lab&&mid&&box)?{
    dx:Math.round((lab.nx+box.w/2-mid[0])*1e4)/1e4,
    dy:Math.round((lab.ny+box.h/2-mid[1])*1e4)/1e4, rot:lab.rot } : null;

  /* --- drag the far end: the reading re-measures and follows --- */
  const before=lab.text, bx=lab.nx;
  l.pts=null; l.x2=0.80; l.y2=0.50;
  drawAllLines(); layoutAnnos(); await sleep(120);
  out.afterDrag={ text:lab.text, grew:(lab.text!==before), moved:(Math.abs(lab.nx-bx)>0.001) };

  /* --- a run drawn the other way keeps its reading upright --- */
  l.x1=0.80; l.y1=0.50; l.x2=0.30; l.y2=0.62;
  drawAllLines(); layoutAnnos(); await sleep(120);
  out.upright={ rot:lab.rot, ok:(lab.rot>-91&&lab.rot<91) };

  /* --- the scale changes the reading, not the geometry --- */
  l.x1=0.20;l.y1=0.50;l.x2=0.50;l.y2=0.50;
  l.dimScale=96; drawAllLines(); layoutAnnos(); await sleep(120);
  out.at96=lab.text;
  l.dimUnit="in"; drawAllLines(); layoutAnnos(); await sleep(80);
  out.inInches=lab.text;
  l.dimUnit="ft"; l.dimScale=48; drawAllLines(); layoutAnnos(); await sleep(80);
  out.back=lab.text;

  /* --- typed over by hand: the words stay --- */
  lab.text="12'-0\" F.O.S."; drawAllLines(); layoutAnnos(); await sleep(120);
  out.manual={ text:lab.text, flagged:!!l.dimManual };
  l.x2=0.70; drawAllLines(); layoutAnnos(); await sleep(120);
  out.manualHeld=lab.text;
  l.dimManual=false; lab._dimAuto=null; drawAllLines(); await sleep(60);

  /* --- dragged off the run: it keeps the offset and still travels --- */
  lab.ny-=0.05; maDimLabelFreed(lab);
  drawAllLines(); layoutAnnos(); await sleep(120);
  out.freed={ free:!!lab.dimFree, off:lab.dimOff&&lab.dimOff.map(v=>Math.round(v*1e3)/1e3) };
  const offBefore=lab.ny;
  l.x1+=0.05; l.x2+=0.05; drawAllLines(); layoutAnnos(); await sleep(120);
  out.travels={ stillAbove:Math.abs(lab.ny-offBefore)<0.004,
                followedX:Math.abs((lab.nx+maDimBox(lab).w/2)-(maDimMid(l)[0]+lab.dimOff[0]))<0.004 };

  /* --- the panel: the Measurement section is there and writes --- */
  tpOpen("dim",document.querySelector('#tools .tool[data-mode="dim"]'));
  await sleep(150);
  const pop=document.getElementById("toolpop");
  out.panel={ title:(pop.querySelector(".tp-title")||{}).textContent,
              sections:[...pop.querySelectorAll(".tp-sec .tp-sech, .tp-sech")].map(n=>n.textContent.trim()),
              pills:[...pop.querySelectorAll("select.tp-pill")].length,
              hasCalibrate:!![...pop.querySelectorAll("button")].some(b=>/Calibrate/.test(b.textContent)),
              hasEnds:!!pop.querySelector(".tp-ends") };
  tpClose(); await sleep(60);

  /* --- deleting the run takes the reading with it --- */
  selectLine(l.id); await sleep(60);
  S.lines=S.lines.filter(z=>z.id!==l.id);
  drawAllLines(); layoutAnnos(); await sleep(150);
  out.deleted={ lines:S.lines.length, annos:S.annos.length,
                labels:S.annos.filter(z=>z.maKind==="dimlabel").length };
  return out;
