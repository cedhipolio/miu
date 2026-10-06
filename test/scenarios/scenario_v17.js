  const out={}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  maPanelOpen(false); gotoPageInstant(0); await sleep(400);
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const pg=document.querySelector('.page[data-idx="0"]');
  const R=()=>pg.getBoundingClientRect();
  const P=(fx,fy)=>({clientX:R().left+R().width*fx,clientY:R().top+R().height*fy,
                     bubbles:true,button:0,pointerId:11});

  /* ---------- 1. small / medium / large tips ---------- */
  const q=addLine(0,0.2,0.2,0.6,0.2,{col:"#fa3237",sw:1.5,le1:"arrow"});
  const l0=S.lines.find(z=>z.id===q);
  const sizes=[];
  [0.68,1,1.5].forEach(v=>{ l0.leSz=v; drawAllLines();
    const p=[...pg.querySelectorAll("svg.draw path")].pop();
    const d=p?p.getAttribute("d"):"";
    const xs=(d.match(/-?\d+(\.\d+)?/g)||[]).map(Number);
    sizes.push({v, head:Math.round(headSizeOf(l0,1.5*S.scale,S.scale)*100)/100,
                file:Math.round(headSizeOf(l0,1.5)*100)/100, pts:xs.length});
  });
  out.tips={sizes, scaleOk:sizes.every(s=>Math.abs(s.head-s.file*S.scale)<1e-6),
            grows:(sizes[0].file<sizes[1].file&&sizes[1].file<sizes[2].file),
            deflt:tipScaleOf({})};
  /* and the chips are in the panel */
  tpOpen("arrow",document.querySelector('#tools .tool[data-mode="arrow"]'));
  await sleep(150);
  {
    const pop=document.getElementById("toolpop");
    const row=pop.querySelector(".tp-tips");
    out.tipChips=row?[...row.querySelectorAll("button")].map(b=>b.title):null;
    const big=row&&[...row.querySelectorAll("button")].find(b=>/Large/.test(b.title));
    if(big)big.dispatchEvent(new MouseEvent("click",{bubbles:true}));
    out.tipSet=MA_TOOL_STYLES.arrow.leSz;
    tpApply("leSz",1); tpClose();
  }
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines(); await sleep(100);

  /* ---------- 2. the Length tool ---------- */
  setMode("dim"); await sleep(80);
  pg.dispatchEvent(new PointerEvent("pointerdown",P(0.20,0.46)));
  pg.dispatchEvent(new PointerEvent("pointermove",P(0.56,0.46)));
  pg.dispatchEvent(new PointerEvent("pointerup",P(0.56,0.46)));
  await sleep(400);
  let l=S.lines.find(z=>z.maKind==="dim");
  let lab=l?S.annos.find(z=>z.id===l.dimFor):null;
  out.blank={ made:!!l, reading:lab?lab.text:null, empty:!!lab&&lab.text==="",
              manual:!!l.dimManual, focused:!!document.querySelector(".anno.editing"),
              selectedIsPart:(S.sel===lab.id||S.selLine===(l&&l.id)) };
  /* typing the dimension by hand, the way a user would */
  const ed=document.querySelector(`.anno[data-id="${lab.id}"] .ed`);
  ed.textContent="12'-6\" A.G.L."; ed.dispatchEvent(new Event("input",{bubbles:true}));
  ed.blur(); await sleep(150);
  drawAllLines(); layoutAnnos(); await sleep(120);
  out.typed={ text:lab.text, held:(lab.text.indexOf("A.G.L.")>=0) };
  /* the reading can be written in on request, and then follows the run again */
  selectLine(l.id);
  maDimWriteIn(); await sleep(150);
  out.writeIn={ text:lab.text, auto:!l.dimManual };
  const was=lab.text; l.x2=0.72; drawAllLines(); layoutAnnos(); await sleep(120);
  out.writeInFollows=(lab.text!==was);

  /* ONE MARK: the selection catches both halves, whichever one it starts from */
  selectLine(l.id); await sleep(60);
  let sel=maSelectedMarks();
  out.oneFromRun={ lines:sel.lines.length, annos:sel.annos.length,
                   hasLabel:sel.annos.some(z=>z.id===lab.id), count:sbCount() };
  selectAnno(lab.id); selectLine(null); await sleep(60);
  sel=maSelectedMarks();
  out.oneFromReading={ lines:sel.lines.length, annos:sel.annos.length,
                       hasRun:sel.lines.some(z=>z.id===l.id) };
  /* a click on the reading selects the measurement and drags the whole of it */
  selectAnno(null); selectLine(null);
  const d=document.querySelector(`.anno[data-id="${lab.id}"]`);
  const ed2=d.querySelector(".ed");
  const r=ed2.getBoundingClientRect();
  const x0=l.x1, mid0=(l.x1+l.x2)/2, ly0=lab.ny;
  ed2.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,clientX:r.left+6,clientY:r.top+6,button:0}));
  await sleep(60);
  out.clickPicksRun=(S.selLine===l.id);
  window.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+66,clientY:r.top+6,bubbles:true}));
  await sleep(60);
  window.dispatchEvent(new PointerEvent("pointerup",{bubbles:true}));
  await sleep(120);
  out.dragMovesBoth={ runMoved:Math.abs(l.x1-x0)>0.005,
                      readingFollowed:Math.abs((lab.nx+maDimBox(lab).w/2)-((l.x1+l.x2)/2))<0.004,
                      midMoved:Math.abs((l.x1+l.x2)/2-mid0)>0.005 };
  /* the panel: the reading's own font, size and style, and the stroke's still there */
  selectLine(l.id);
  tpOpen("dim",document.querySelector('#tools .tool[data-mode="dim"]'),true);
  await sleep(200);
  {
    const pop=document.getElementById("toolpop");
    out.panel={ secs:[...pop.querySelectorAll(".tp-sech")].map(n=>n.textContent.trim()),
                fonts:!!pop.querySelector(".tp-fonts"),
                deco:!!pop.querySelector(".tp-deco"),
                ends:!!pop.querySelector(".tp-ends"),
                tips:!!pop.querySelector(".tp-tips"),
                writeIn:[...pop.querySelectorAll("button")].some(b=>/Write in/.test(b.textContent)) };
    /* a font set with the measurement selected lands on its reading */
    const tf=[...pop.querySelectorAll(".tp-fonts button")].find(b=>/Times/.test(b.textContent));
    if(tf)tf.dispatchEvent(new MouseEvent("click",{bubbles:true}));
    await sleep(120);
    out.readingFont=lab.font;
    tpApply("size",16); await sleep(120);
    out.readingSize=lab.size;
    tpClose();
  }
  /* the ✕ on the reading takes the measurement with it */
  const xb=document.querySelector(`.anno[data-id="${lab.id}"] .x`);
  xb.dispatchEvent(new MouseEvent("click",{bubbles:true}));
  await sleep(200);
  out.deleteWhole={ lines:S.lines.length, annos:S.annos.length };

  /* ---------- 3 + 4. the picture editor ---------- */
  S.annos=[];S.lines=[];layoutAnnos();drawAllLines();
  const mk=async()=>{
    /* a little picture: a red ring on nothing, so there is an inside, an outside and ink */
    const c=document.createElement("canvas"); c.width=c.height=60;
    const g=c.getContext("2d");
    g.strokeStyle="#fa3237"; g.lineWidth=4; g.beginPath(); g.arc(30,30,20,0,Math.PI*2); g.stroke();
    const id=addText(0,0.2,0.3,"");
    const a=S.annos.find(z=>z.id===id);
    a.kind="img"; a.maKind="snapshot"; a.nw=0.2; a.nh=0.2; a.manualW=true;
    a.src=c.toDataURL("image/png"); a.col="#fa3237"; a.sw=0;
    layoutAnnos();
    return a;
  };
  const a=await mk();
  skEditor(a); await sleep(500);
  const m=document.querySelector(".sk-edit");
  out.editor={ open:!!m, buttons:[...m.querySelectorAll(".sk-edb")].map(b=>b.textContent.trim()),
               overlay:!!m.querySelector(".sk-edov"), colour:!!m.querySelector(".sk-edcol") };
  const cv=m.querySelector(".sk-edcanvas"), ov=m.querySelector(".sk-edov");
  const g=cv.getContext("2d",{willReadFrequently:true});
  const pxAt=(x,y)=>{ const d=g.getImageData(x,y,1,1).data; return [d[0],d[1],d[2],d[3]]; };
  const rect=()=>cv.getBoundingClientRect();
  const CP=(x,y)=>{ const r=rect();
    return {clientX:r.left+r.width*(x/cv.width), clientY:r.top+r.height*(y/cv.height),
            bubbles:true, pointerId:21, button:0}; };
  const press=b=>[...m.querySelectorAll(".sk-edb")].find(z=>new RegExp(b,"i").test(z.textContent))
                   .dispatchEvent(new MouseEvent("click",{bubbles:true}));

  /* 3. a fast sweep must leave a CONTINUOUS band, not a row of dots */
  out.before={ centre:pxAt(30,30), ring:pxAt(30,10), ringLow:pxAt(30,49) };
  press("Erase");
  /* a narrow brush, and a sweep along the very bottom, so the ring itself is left whole */
  { const rg=m.querySelector(".sk-edsize input[type=range]");
    rg.value="6"; rg.dispatchEvent(new Event("input",{bubbles:true})); }
  cv.dispatchEvent(new PointerEvent("pointerdown",CP(2,57)));
  window.dispatchEvent(new PointerEvent("pointermove",CP(58,57)));   /* one big jump */
  cv.dispatchEvent(new PointerEvent("pointermove",CP(58,57)));
  cv.dispatchEvent(new PointerEvent("pointerup",CP(58,57)));
  await sleep(120);
  {
    /* walk the band: every pixel along it must have been rubbed out */
    let gaps=0, n=0;
    for(let x=4;x<56;x++){ const p=pxAt(x,57); n++; if(p[3]>20)gaps++; }
    out.sweep={ checked:n, gaps:gaps, seamless:(gaps===0) };
  }

  /* 4. wand the inside, invert, fill — and the ink must stay on top */
  press("Magic wand");
  cv.dispatchEvent(new PointerEvent("pointerdown",CP(30,30)));
  await sleep(200);
  out.wand={ tag:m.querySelector(".sk-edcount").textContent,
             painted:(()=>{ const d=ov.getContext("2d").getImageData(30,30,1,1).data;
                            return d[3]>0; })() };
  press("Fill selection"); await sleep(200);
  out.filledInside={ centre:pxAt(30,30), ringKept:pxAt(30,10),
                     outsideStillClear:pxAt(2,2) };
  press("Undo"); await sleep(120);
  press("Select inverse"); await sleep(200);
  out.inverted=m.querySelector(".sk-edcount").textContent;
  press("Fill selection"); await sleep(250);
  out.filledOutside={ outside:pxAt(2,2), ringKept:pxAt(30,10), inside:pxAt(30,30) };
  /* saving writes it back to the mark */
  [...m.querySelectorAll(".sk-edfb")].find(b=>/Save/.test(b.textContent))
    .dispatchEvent(new MouseEvent("click",{bubbles:true}));
  await sleep(400);
  out.saved={ closed:!document.querySelector(".sk-edit"),
              src:(S.annos[0].src||"").slice(0,14), tint:S.annos[0]._tintCol };
  return out;
