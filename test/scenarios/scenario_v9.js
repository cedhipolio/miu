/* v9 — items 8 (apply-to-pages dropdown), 10 (panel display), 11 (per-tool exclusivity). */
  const out={};
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  /* ---------- 11: the callout's rectangle is not the Box tool's rectangle ---------- */
  MA_TOOL_STYLES.box=Object.assign({},MA_TOOL_STYLES.box,{col:"#1144ff",sw:3,fill:"#ffee00"});
  MA_TOOL_STYLES.callout=Object.assign({},MA_TOOL_STYLES.callout,{col:"#fa3237",sw:1,fill:"#ffffff"});
  tpOpen("callout",document.querySelector('#tools .tool[data-mode="callout"]')||document.body);
  await sleep(60);
  /* change the callout's border colour through the panel */
  tpApply("col","#00aa55"); await sleep(40);
  out.calloutCol=MA_TOOL_STYLES.callout.col;
  out.boxColUntouched=MA_TOOL_STYLES.box.col;
  /* the callout panel must actually expose the rectangle's controls */
  const pop=document.getElementById("toolpop");
  out.calloutHasSwatches=!!pop.querySelector(".tp-swatches");
  out.calloutHasTargets=!!pop.querySelector(".tp-targets");
  out.calloutHasPattern=[...pop.querySelectorAll(".tp-sech")].some(h=>/Pattern/i.test(h.textContent));
  out.calloutHasLineStyle=[...pop.querySelectorAll(".tp-sech")].some(h=>/Line style/i.test(h.textContent));

  /* ---------- 10: header fixed, body scrolls, state survives a rebuild ---------- */
  out.hasScroller=!!pop.querySelector(".tp-scroll");
  out.headOutsideScroll=!!(pop.firstChild&&pop.firstChild.classList.contains("tp-head"));
  const secs=[...pop.querySelectorAll(".tp-sec")];
  const adv=secs[secs.length-1];
  const advTitle=adv.querySelector(".tp-sech span").textContent;
  out.advOpenBefore=adv.classList.contains("open");
  adv.querySelector(".tp-sech").click(); await sleep(20);
  const openNow=pop.querySelector(".tp-sec:last-of-type").classList.contains("open");
  tpApply("sw",2.5); await sleep(60);                      /* forces a full rebuild */
  const adv2=[...document.querySelectorAll("#toolpop .tp-sec")].pop();
  out.advTitle=advTitle;
  out.advStateKept=(adv2.classList.contains("open")===openNow);
  /* the scroll position survives too */
  const sc=document.querySelector("#toolpop .tp-scroll");
  sc.scrollTop=90; sc.dispatchEvent(new Event("scroll")); await sleep(20);
  tpApply("sw",3); await sleep(60);
  out.scrollKept=document.querySelector("#toolpop .tp-scroll").scrollTop;
  /* dragging the header moves the card and it stays inside the window */
  const head=document.querySelector("#toolpop .tp-head");
  const before=document.getElementById("toolpop").getBoundingClientRect().left;
  head.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:400,clientY:200,pointerId:7}));
  head.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:700,clientY:400,pointerId:7}));
  head.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:700,clientY:400,pointerId:7}));
  await sleep(40);
  const r2=document.getElementById("toolpop").getBoundingClientRect();
  out.moved=Math.round(r2.left-before);
  /* shove it far off and confirm the clamp */
  head.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,clientX:r2.left+20,clientY:r2.top+10,pointerId:8}));
  head.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:9000,clientY:9000,pointerId:8}));
  head.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:9000,clientY:9000,pointerId:8}));
  await sleep(40);
  const r3=document.getElementById("toolpop").getBoundingClientRect();
  out.clamped=(r3.right<=window.innerWidth-4&&r3.bottom<=window.innerHeight-4&&r3.left>=4&&r3.top>=4);
  tpClose();

  /* ---------- 8: apply to pages ---------- */
  out.pages=S.pages.length;
  /* drop a box on page 1 and select it */
  const mk=()=>{ const a={id:seq++,page:0,nx:0.2,ny:0.2,nw:0.2,nh:0.06,text:"",shape:"rect",
      col:"#fa3237",sw:1.5,fill:"#ffffff",fillOp:1}; S.annos.push(a); return a; };
  const a=mk(); layoutAnnos(); selectAnno(a.id); await sleep(40);
  const before2=S.annos.length;
  const p=sbApplyToPages();
  await sleep(120);
  const dlg=document.querySelector(".sb-ask");
  out.dialog=!!dlg;
  const sel=dlg&&dlg.querySelector(".sb-askselect");
  out.choices=sel?[...sel.options].map(o=>o.textContent):null;
  out.fieldHiddenForAll=dlg?(dlg.querySelector(".sb-askinput").style.display==="none"):null;
  sel.value="custom"; sel.dispatchEvent(new Event("change")); await sleep(20);
  out.fieldShownForCustom=(dlg.querySelector(".sb-askinput").style.display!=="none");
  sel.value="even"; sel.dispatchEvent(new Event("change")); await sleep(20);
  out.fieldHiddenForEven=(dlg.querySelector(".sb-askinput").style.display==="none");
  dlg.querySelector(".sb-askb.primary").click();
  await p; await sleep(120);
  const evens=S.annos.filter(x=>x.shape==="rect"&&x.nw===0.2).map(x=>x.page).sort((m,n)=>m-n);
  out.made=S.annos.length-before2;
  out.landedOn=evens;
  out.allEven=evens.slice(1).every(pi=>pi%2===1);   /* page 2,4,… are index 1,3,… */
  return out;
